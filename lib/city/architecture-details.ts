import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project, rings } from './geo';
import { replacedBuilding } from './replaced-buildings';
import { type Profile } from './facade-profile';
import type { PitchedRoof } from './building-roof';
import { roofCellWork } from './architecture-roof-budget';
import {
  architectureWork,
  type ArchitectureBox,
  type ArchitecturePart,
  type ArchitectureTier,
} from './architecture-plan';

export type ArchitectureQAContext = {
  id: string;
  tier: ArchitectureTier;
  surface: 'masonry' | 'metal';
  sourcePart(box: ArchitectureBox): ArchitecturePart | undefined;
};
/** The implementation is imported only by the separately gated visual-QA UI. */
export interface ArchitectureQAAdapter {
  readonly affectedCells: ReadonlySet<string>;
  didAttach?(): void;
  assemble(
    boxes: readonly ArchitectureBox[],
    context: ArchitectureQAContext,
  ): {
    meshes: THREE.InstancedMesh[];
    consumed: Set<number>;
  } | null;
  update(): boolean;
  dispose(): void;
}
type Cell = { id: string; parts: ArchitecturePart[]; bounds: THREE.Box3 };
type RecordState = {
  id: string;
  cell: Cell;
  tier: ArchitectureTier;
  group: THREE.Group;
  ready: boolean;
  lastUsed: number;
  count: number;
};
type Build = {
  record: RecordState;
  work: Generator<ArchitectureBox | null>;
  masonry: ArchitectureBox[];
  metal: ArchitectureBox[];
  qaSourceParts?: WeakMap<ArchitectureBox, ArchitecturePart>;
};
export const ARCHITECTURE_BUDGET = {
  cellMetres: 220,
  roofInstancesPerCell: 650,
  streetInstancesPerCell: 1800,
  cachedCells: 38,
  maxStepsPerFrame: 96,
  buildMs: 1.25,
} as const;

/** Bounded, original architectural appearance layered over unchanged GIS/collision.
 * Instance data is prepared cooperatively; at most one small cell uploads/frame.
 * No per-window objects, network fetch, texture allocation or unbounded cache. */
export class ArchitecturalDetails {
  readonly root = new THREE.Group();
  readonly cells: Cell[];
  readonly records = new Map<string, RecordState>();
  readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  readonly materials = {
    masonry: new THREE.MeshStandardMaterial({
      roughness: 0.79,
      metalness: 0.02,
    }),
    metal: new THREE.MeshStandardMaterial({ roughness: 0.57, metalness: 0.38 }),
  };
  readonly stats = {
    selectedCells: 0,
    pendingCells: 0,
    buildingCells: 0,
    readySelectedCells: 0,
    readyCells: 0,
    visibleCells: 0,
    visibleInstances: 0,
    allocatedInstances: 0,
    droppedAtBudget: 0,
    maxPlanMs: 0,
    maxAttachmentMs: 0,
  };
  private selected = new Set<string>();
  private pending: RecordState[] = [];
  private build: Build | null = null;
  private last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private quality = '';
  private tick = 0;
  private disposed = false;
  private qaAdapter: ArchitectureQAAdapter | null = null;
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 1, 0);
  private color = new THREE.Color();

  constructor(
    private e: Pick<
      CityEngine,
      'data' | 'buildings' | 'camera' | 'settings' | 'renderer'
    >,
  ) {
    this.root.name =
      'Vancouver architecture — streamed roofs and lowrise fronts';
    this.e.buildings.add(this.root);
    const groups = new Map<string, Cell>();
    const profiles = e.data.buildingProfiles as Map<string, Profile>;
    const foundations = e.data.buildingFoundations as Map<string, number>;
    const bodyRoofs = e.data.buildingRoofs as
      | Map<string, PitchedRoof>
      | undefined;
    const structureParts = new Map<string, ArchitecturePart[]>();
    const allParts: ArchitecturePart[] = [];
    for (const f of e.data.buildings.features) {
      const p = f.properties,
        key = String(p.structureId ?? p.buildingId ?? p.id);
      const height = Number(p.height),
        minHeight = Math.max(0, Number(p.minHeight) || 0);
      const ground = foundations?.get(key),
        profile = profiles?.get(key);
      if (
        replacedBuilding(p) ||
        ground === undefined ||
        !profile ||
        !Number.isFinite(height) ||
        height <= minHeight ||
        height < 5 ||
        height > 300
      )
        continue;
      for (const source of rings(f)) {
        const polygon = source.map((r) => r.slice(0, -1).map(project));
        if (polygon[0].length < 3) continue;
        const part = {
          key,
          polygon,
          height,
          minHeight,
          ground,
          profile,
          roof: true,
          roofEaveHeight: bodyRoofs?.get(key)?.eaveHeight,
        };
        allParts.push(part);
        if (!structureParts.has(key)) structureParts.set(key, []);
        structureParts.get(key)!.push(part);
      }
    }
    for (const part of allParts) {
      const { key, polygon, height, minHeight, ground } = part;
      const bounds = new THREE.Box3();
      for (const [x, z] of polygon[0]) {
        bounds.expandByPoint(new THREE.Vector3(x, ground + minHeight, z));
        bounds.expandByPoint(new THREE.Vector3(x, ground + height + 5, z));
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const id = `${Math.floor(center.x / ARCHITECTURE_BUDGET.cellMetres)},${Math.floor(center.z / ARCHITECTURE_BUDGET.cellMetres)}`;
      let cell = groups.get(id);
      if (!cell) {
        cell = { id, bounds: new THREE.Box3(), parts: [] };
        groups.set(id, cell);
      }
      cell.bounds.union(bounds);
      part.roofExclusions = structureParts
        .get(key)!
        .filter((p) => p.height > height + 0.05)
        .map((p) => p.polygon);
      cell.parts.push(part);
    }
    this.cells = [...groups.values()];
    // Source-file reordering must not reshuffle the visible subset at a cell budget.
    for (const cell of this.cells)
      cell.parts.sort(
        (a, b) =>
          a.key.localeCompare(b.key) ||
          a.minHeight - b.minHeight ||
          a.height - b.height ||
          a.polygon[0][0][0] - b.polygon[0][0][0] ||
          a.polygon[0][0][1] - b.polygon[0][0][1],
      );
  }

  /** QA-only replacement hook; the normal build cannot enable this adapter. */
  setQAModuleAdapter(adapter: ArchitectureQAAdapter | null) {
    if (process.env.VANCOUVER_VISUAL_QA !== '1' || this.disposed) {
      adapter?.dispose();
      return false;
    }
    if (adapter === this.qaAdapter) return true;
    const cells = new Set([
      ...(this.qaAdapter?.affectedCells ?? []),
      ...(adapter?.affectedCells ?? []),
    ]);
    this.qaAdapter?.dispose();
    this.qaAdapter = adapter;
    this.invalidateQAStreetCells(cells);
    return true;
  }
  invalidateQAStreetCells(cells: ReadonlySet<string>) {
    if (process.env.VANCOUVER_VISUAL_QA !== '1' || this.disposed) return;
    if (!cells.size) return;
    const affected = (record: RecordState) =>
      record.tier === 'street' && cells.has(record.cell.id);
    if (this.build && affected(this.build.record)) this.cancelBuild();
    this.pending = this.pending.filter((record) => !affected(record));
    for (const record of this.records.values())
      if (affected(record)) this.release(record);
    this.last.set(Infinity, Infinity, Infinity);
  }
  update(force = false) {
    if (this.disposed) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1' && this.qaAdapter?.update())
      this.invalidateQAStreetCells(this.qaAdapter.affectedCells);
    this.tick++;
    const q = this.e.settings.buildings ? this.e.settings.quality : 'off';
    if (
      force ||
      q !== this.quality ||
      this.last.distanceToSquared(this.e.camera.position) > 30 * 30
    ) {
      this.quality = q;
      this.last.copy(this.e.camera.position);
      const distances = this.cells
        .map((cell) => ({
          cell,
          distance: cell.bounds.distanceToPoint(this.last),
        }))
        .sort(
          (a, b) =>
            a.distance - b.distance || a.cell.id.localeCompare(b.cell.id),
        );
      const roofRange =
        q === 'ultra' ? 2500 : q === 'high' ? 1700 : q === 'balanced' ? 650 : 0;
      const streetRange = q === 'ultra' ? 550 : q === 'high' ? 300 : 0;
      const selected: {
        cell: Cell;
        tier: ArchitectureTier;
        distance: number;
      }[] = [];
      for (const [tier, range, limit] of [
        ['roof', roofRange, q === 'ultra' ? 20 : q === 'high' ? 16 : 6],
        ['street', streetRange, q === 'ultra' ? 10 : 7],
      ] as const) {
        if (!range) continue;
        selected.push(
          ...distances
            .filter((p) => p.distance < range)
            .slice(0, limit)
            .map((p) => ({ ...p, tier })),
        );
      }
      // Nearby street architecture is ready before more distant rooftop decoration.
      selected.sort(
        (a, b) =>
          a.distance +
          (a.tier === 'roof' ? 100 : 0) -
          (b.distance + (b.tier === 'roof' ? 100 : 0)),
      );
      this.selected = new Set(selected.map((p) => `${p.cell.id}/${p.tier}`));
      if (this.build && !this.selected.has(this.build.record.id))
        this.cancelBuild();
      this.pending = [];
      for (const { cell, tier } of selected) {
        const id = `${cell.id}/${tier}`;
        let record = this.records.get(id);
        if (!record) {
          record = {
            id,
            cell,
            tier,
            group: new THREE.Group(),
            ready: false,
            lastUsed: this.tick,
            count: 0,
          };
          record.group.name = `Architecture ${id}`;
          record.group.visible = false;
          this.records.set(id, record);
        }
        record.lastUsed = this.tick;
        if (!record.ready && record !== this.build?.record)
          this.pending.push(record);
      }
      for (const record of this.records.values()) {
        const visible = record.ready && this.selected.has(record.id);
        if (record.group.visible !== visible)
          this.e.renderer.shadowMap.needsUpdate = true;
        record.group.visible = visible;
      }
      this.evict();
    }
    this.pump();
    this.refreshStats();
  }

  private *qaStreetWork(
    parts: readonly ArchitecturePart[],
    sources: WeakMap<ArchitectureBox, ArchitecturePart>,
  ) {
    if (process.env.VANCOUVER_VISUAL_QA !== '1') return;
    for (const part of parts)
      for (const box of architectureWork([part], 'street')) {
        if (box) sources.set(box, part);
        yield box;
      }
  }
  private pump() {
    if (!this.build) {
      const record = this.pending.shift();
      if (!record) return;
      const qaSourceParts =
        process.env.VANCOUVER_VISUAL_QA === '1' && record.tier === 'street'
          ? new WeakMap<ArchitectureBox, ArchitecturePart>()
          : undefined;
      this.build = {
        qaSourceParts,
        record,
        work:
          record.tier === 'roof'
            ? roofCellWork(
                record.cell.parts,
                ARCHITECTURE_BUDGET.roofInstancesPerCell,
                this.e.camera.position.toArray(),
              )
            : qaSourceParts
              ? this.qaStreetWork(record.cell.parts, qaSourceParts)
              : architectureWork(record.cell.parts, record.tier),
        masonry: [],
        metal: [],
      };
    }
    const build = this.build,
      start = performance.now();
    const limit =
      build.record.tier === 'roof'
        ? ARCHITECTURE_BUDGET.roofInstancesPerCell
        : ARCHITECTURE_BUDGET.streetInstancesPerCell;
    let complete = false;
    for (let step = 0; step < ARCHITECTURE_BUDGET.maxStepsPerFrame; step++) {
      const value = build.work.next();
      if (value.done) {
        complete = true;
        break;
      }
      if (value.value) build[value.value.surface].push(value.value);
      if (build.masonry.length + build.metal.length >= limit) {
        this.stats.droppedAtBudget++;
        build.work.return(undefined);
        complete = true;
        break;
      }
      if (performance.now() - start >= ARCHITECTURE_BUDGET.buildMs) break;
    }
    this.stats.maxPlanMs = Math.max(
      this.stats.maxPlanMs,
      performance.now() - start,
    );
    if (!complete) return;
    const attachStart = performance.now();
    for (const surface of ['masonry', 'metal'] as const) {
      let boxes = build[surface];
      if (!boxes.length) continue;
      if (process.env.VANCOUVER_VISUAL_QA === '1' && this.qaAdapter) {
        const replacement = this.qaAdapter.assemble(boxes, {
          id: build.record.id,
          tier: build.record.tier,
          surface,
          sourcePart: (box) => build.qaSourceParts?.get(box),
        });
        if (replacement) {
          const valid = [...replacement.consumed].every(
            (index) =>
              Number.isInteger(index) && index >= 0 && index < boxes.length,
          );
          const count = replacement.meshes.reduce(
            (sum, mesh) => sum + mesh.count,
            0,
          );
          if (!valid || count !== replacement.consumed.size)
            throw new Error(
              'QA architecture replacements must preserve population',
            );
          boxes = boxes.filter((_, index) => !replacement.consumed.has(index));
          for (const mesh of replacement.meshes) build.record.group.add(mesh);
          build.record.count += count;
        }
      }
      if (!boxes.length) continue;
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        this.materials[surface],
        boxes.length,
      );
      mesh.name = `${build.record.id}/${surface}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        this.position.set(b.x, b.y, b.z);
        this.rotation.setFromAxisAngle(this.axis, b.yaw);
        this.scale.set(b.width, b.height, b.depth);
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(i, this.matrix);
        mesh.setColorAt(i, this.color.setHex(b.color));
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      build.record.group.add(mesh);
      build.record.count += boxes.length;
    }
    build.record.ready = true;
    build.record.group.visible = this.selected.has(build.record.id);
    this.root.add(build.record.group);
    this.e.renderer.shadowMap.needsUpdate = true;
    // CPU matrix/bounds attachment only; actual GPU/driver cost is measured in
    // the normal renderer's frame-time observer, not mislabeled here as upload.
    this.stats.maxAttachmentMs = Math.max(
      this.stats.maxAttachmentMs,
      performance.now() - attachStart,
    );
    this.build = null;
    this.evict();
    if (process.env.VANCOUVER_VISUAL_QA === '1') this.qaAdapter?.didAttach?.();
  }

  private cancelBuild() {
    this.build?.work.return(undefined);
    this.build = null;
  }
  private release(record: RecordState) {
    record.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        if (process.env.VANCOUVER_VISUAL_QA === '1')
          o.userData.releaseArchitectureCandidate?.();
        o.dispose();
      }
    });
    record.group.clear();
    record.group.removeFromParent();
    this.records.delete(record.id);
  }
  private evict() {
    const removable = [...this.records.values()]
      .filter((r) => !this.selected.has(r.id) && r !== this.build?.record)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (
      this.records.size > ARCHITECTURE_BUDGET.cachedCells &&
      removable.length
    )
      this.release(removable.shift()!);
  }
  private refreshStats() {
    this.stats.selectedCells = this.selected.size;
    this.stats.pendingCells = this.pending.length + Number(this.build !== null);
    this.stats.buildingCells = Number(this.build !== null);
    this.stats.readySelectedCells = 0;
    this.stats.readyCells = 0;
    this.stats.visibleCells = 0;
    this.stats.visibleInstances = 0;
    this.stats.allocatedInstances = 0;
    for (const record of this.records.values()) {
      this.stats.readyCells += Number(record.ready);
      this.stats.allocatedInstances += record.count;
      if (record.group.visible) {
        this.stats.readySelectedCells++;
        this.stats.visibleCells++;
        this.stats.visibleInstances += record.count;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (process.env.VANCOUVER_VISUAL_QA === '1') this.qaAdapter?.dispose();
    this.qaAdapter = null;
    this.cancelBuild();
    this.pending.length = 0;
    this.selected.clear();
    for (const record of this.records.values()) this.release(record);
    this.root.removeFromParent();
    this.geometry.dispose();
    this.materials.masonry.dispose();
    this.materials.metal.dispose();
    this.refreshStats();
  }
}
