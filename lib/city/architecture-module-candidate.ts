/** LOCAL VISUAL QA: robson-sill-blender-candidate-v1. No production placement. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  architectureWork,
  type ArchitectureBox,
  type ArchitecturePart,
} from './architecture-plan';
import {
  ARCHITECTURE_BUDGET,
  type ArchitecturalDetails,
  type ArchitectureQAAdapter,
  type ArchitectureQAContext,
} from './architecture-details';
import { cityReliefMaterial } from './city-surface-material';
import type { CityMaterialLibrary } from './material-library';
import manifest from '../../tools/assets/architecture-details/runtime-candidate/manifest.json';

export const ARCHITECTURE_MODULE_CANDIDATE = {
  id: 'robson-sill-blender-candidate-v1',
  query: 'architectureModules',
  value: 'robson-sills',
  maximumInstances: 64,
  maximumExtraTriangles: 1280,
  maximumTemplates: 2,
  nearDistance: 60,
  farDistance: 150,
  hysteresis: 10,
  sources: [
    {
      sourceKey: '153090',
      edgeKey: '-564.925,-658.545|-576.282,-669.010',
      sourceFeature: '132886',
    },
    {
      sourceKey: '153102',
      edgeKey: '-580.273,-672.830|-591.064,-683.035',
      sourceFeature: '132843',
    },
  ],
} as const;
export type ArchitectureCandidateLOD = 'auto' | 0 | 1;
export type ArchitectureCandidateLoader = (
  lod: 0 | 1,
) => Promise<THREE.Object3D>;
type SelectedSill = {
  part: ArchitecturePart;
  box: ArchitectureBox;
  sourceKey: string;
  edgeKey: string;
  yaw: number;
};

export function architectureSourceEdgeKey(a: number[], b: number[]) {
  return [a, b]
    .map((point) => point.map((n) => n.toFixed(3)).join(','))
    .sort((x, y) => x.localeCompare(y))
    .join('|');
}
export function architectureBoxKey(box: ArchitectureBox) {
  return [box.x, box.y, box.z, box.width, box.height, box.depth, box.yaw]
    .map((n) => n.toFixed(5))
    .join(',');
}

/** Re-run the existing planner only for two named source structures once. Match
 * existing boxes by their full placement/size key; never generate population. */
export function selectArchitectureCandidateSills(
  parts: readonly ArchitecturePart[],
) {
  const found = new Map<string, SelectedSill>();
  const ambiguous = new Set<string>();
  for (const source of ARCHITECTURE_MODULE_CANDIDATE.sources) {
    for (const part of parts.filter((p) => p.key === source.sourceKey)) {
      const ring = part.polygon[0];
      const edgeIndex = ring.findIndex(
        (a, i) =>
          architectureSourceEdgeKey(a, ring[(i + 1) % ring.length]) ===
          source.edgeKey,
      );
      if (edgeIndex < 0) continue;
      const a = ring[edgeIndex],
        b = ring[(edgeIndex + 1) % ring.length];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      const sign =
        ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return sum + p[0] * q[1] - q[0] * p[1];
        }, 0) > 0
          ? 1
          : -1;
      const nx = (sign * dz) / length,
        nz = (-sign * dx) / length;
      for (const box of architectureWork([part], 'street')) {
        if (
          !box ||
          box.kind !== 'sill' ||
          box.surface !== 'masonry' ||
          Math.abs(box.height - 0.16) > 1e-6 ||
          Math.abs(box.depth - 0.31) > 1e-6 ||
          box.width < 1.4 ||
          box.width > 5 ||
          box.y - part.ground < part.profile.groundStoreyM + 0.5
        )
          continue;
        const along = ((box.x - a[0]) * dx + (box.z - a[1]) * dz) / length;
        const normal = (box.x - a[0]) * nx + (box.z - a[1]) * nz;
        if (
          along < box.width / 2 ||
          along > length - box.width / 2 ||
          Math.abs(normal - 0.085) > 1e-5
        )
          continue;
        const key = architectureBoxKey(box);
        if (found.has(key)) ambiguous.add(key);
        found.set(key, {
          part,
          box,
          sourceKey: part.key,
          edgeKey: source.edgeKey,
          yaw: Math.atan2(nx, nz),
        });
      }
    }
  }
  for (const key of ambiguous) found.delete(key);
  return new Map(
    [...found]
      .sort(
        ([, a], [, b]) =>
          a.sourceKey.localeCompare(b.sourceKey) ||
          a.box.y - b.box.y ||
          a.box.x - b.box.x ||
          a.box.z - b.box.z,
      )
      .slice(0, ARCHITECTURE_MODULE_CANDIDATE.maximumInstances),
  );
}

function releaseImported(scene: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const images = new Set<{ close(): void }>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometry.add(object.geometry);
    for (const mat of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(mat);
  });
  for (const mat of materials)
    for (const value of Object.values(mat)) {
      if (!(value instanceof THREE.Texture)) continue;
      textures.add(value);
      const image = value.image;
      if (
        image &&
        typeof image === 'object' &&
        typeof image.close === 'function'
      )
        images.add(image);
    }
  geometry.forEach((item) => item.dispose());
  textures.forEach((item) => item.dispose());
  images.forEach((item) => item.close());
  materials.forEach((item) => item.dispose());
}

/** Extract actual Blender GLB geometry. Embedded preview materials/images never
 * reach a render: release all originals, bind the engine-owned shared atlas. */
export function extractArchitectureCandidate(
  scene: THREE.Object3D,
  lod: 0 | 1,
) {
  let result: THREE.BufferGeometry | null = null;
  try {
    const meshes: THREE.Mesh[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes.push(object);
    });
    if (meshes.length !== 1 || meshes[0] instanceof THREE.SkinnedMesh)
      throw new Error('Architecture candidate requires one static mesh');
    const mesh = meshes[0];
    result = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const expected = manifest.lods[lod];
    const triangles =
      (result.index?.count ?? result.getAttribute('position').count) / 3;
    if (triangles !== expected.triangles)
      throw new Error('Architecture candidate triangle contract');
    for (const name of ['position', 'normal', 'uv', 'tangent']) {
      const attr = result.getAttribute(name);
      if (!attr || !Array.from(attr.array).every(Number.isFinite))
        throw new Error(`Architecture candidate ${name}`);
    }
    result.computeBoundingBox();
    const bounds = result.boundingBox!;
    for (let i = 0; i < 3; i++)
      if (
        Math.abs(bounds.min.getComponent(i) - expected.bounds.min[i]) > 1e-5 ||
        Math.abs(bounds.max.getComponent(i) - expected.bounds.max[i]) > 1e-5
      )
        throw new Error('Architecture candidate physical bounds');
    result.clearGroups();
    return result;
  } catch (error) {
    result?.dispose();
    throw error;
  } finally {
    releaseImported(scene);
  }
}

async function defaultLoader(lod: 0 | 1) {
  // Static new URL references emit these two GLBs only in the QA import graph.
  const url =
    lod === 0
      ? new URL(
          '../../tools/assets/architecture-details/runtime-candidate/assets/sandstone-sill.lod0.glb',
          import.meta.url,
        ).href
      : new URL(
          '../../tools/assets/architecture-details/runtime-candidate/assets/sandstone-sill.lod1.glb',
          import.meta.url,
        ).href;
  return (await new GLTFLoader().loadAsync(url)).scene;
}

type Host = {
  details: ArchitecturalDetails;
  camera: THREE.PerspectiveCamera;
  settings(): { quality: string; buildings: boolean };
  compatibleGraphics: boolean;
  library: CityMaterialLibrary;
  onChange?(): void;
};

export class ArchitectureModuleCandidate implements ArchitectureQAAdapter {
  readonly selected: Map<string, SelectedSill>;
  readonly material: THREE.MeshStandardMaterial;
  readonly affectedCells = new Set<string>();
  readonly templates = new Map<0 | 1, THREE.BufferGeometry>();
  readonly ownedBatchGeometry = new Set<THREE.BufferGeometry>();
  status:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'failed'
    | 'compatible-fallback'
    | 'disposed' = 'idle';
  error: string | null = null;
  private disposed = false;
  private started = false;
  private regime: 0 | 1 | null = null;
  private lodMode: ArchitectureCandidateLOD = 'auto';
  private focus = new THREE.Vector3();

  constructor(
    private host: Host,
    private loader: ArchitectureCandidateLoader = defaultLoader,
  ) {
    const requested = selectArchitectureCandidateSills(
      host.details.cells.flatMap((cell) => cell.parts),
    );
    this.selected = new Map();
    const requestedParts = new Set(
      [...requested.values()].map((item) => item.part),
    );
    // Only admit boxes actually emitted before the unchanged production cell
    // cap. A source being eligible in isolation does not prove it is rendered.
    for (const cell of host.details.cells) {
      if (!cell.parts.some((part) => requestedParts.has(part))) continue;
      let count = 0;
      planned: for (const part of cell.parts)
        for (const box of architectureWork([part], 'street')) {
          if (!box) continue;
          if (++count > ARCHITECTURE_BUDGET.streetInstancesPerCell)
            break planned;
          const key = architectureBoxKey(box),
            match = requested.get(key);
          if (match?.part === part) {
            this.selected.set(key, match);
            this.affectedCells.add(cell.id);
          }
        }
    }
    this.material = cityReliefMaterial(host.library);
    this.material.name = 'QA Blender sill using shared city atlas';
    for (const { box } of this.selected.values())
      this.focus.add(new THREE.Vector3(box.x, box.y, box.z));
    if (this.selected.size) this.focus.multiplyScalar(1 / this.selected.size);
    this.regime = this.chooseLOD();
  }

  async start() {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.host.compatibleGraphics) {
      this.status = 'compatible-fallback';
      return;
    }
    this.status = 'loading';
    const loaded = await Promise.allSettled(
      ([0, 1] as const).map(async (lod) => {
        const scene = await this.loader(lod);
        if (this.disposed) {
          releaseImported(scene);
          return;
        }
        const geometry = extractArchitectureCandidate(scene, lod);
        if (this.disposed) {
          geometry.dispose();
          return;
        }
        this.templates.set(lod, geometry);
      }),
    );
    if (this.disposed) return;
    const failed = loaded.find((item) => item.status === 'rejected');
    if (failed || this.templates.size !== 2) {
      this.error =
        failed?.status === 'rejected'
          ? String(failed.reason)
          : 'Missing LOD template';
      this.templates.forEach((geometry) => geometry.dispose());
      this.templates.clear();
      this.status = 'failed';
    } else this.status = 'ready';
    this.host.details.invalidateQAStreetCells(this.affectedCells);
  }

  setLOD(mode: ArchitectureCandidateLOD) {
    if (this.disposed || this.lodMode === mode) return;
    this.lodMode = mode;
    this.regime = this.chooseLOD();
    this.host.details.invalidateQAStreetCells(this.affectedCells);
  }
  private chooseLOD(): 0 | 1 | null {
    if (
      this.host.compatibleGraphics ||
      !this.host.settings().buildings ||
      !['high', 'ultra'].includes(this.host.settings().quality) ||
      !this.selected.size
    )
      return null;
    const distance = this.host.camera.position.distanceTo(this.focus);
    const { nearDistance, farDistance, hysteresis } =
      ARCHITECTURE_MODULE_CANDIDATE;
    if (
      distance >
      farDistance + (this.regime === null ? -hysteresis : hysteresis)
    )
      return null;
    if (this.lodMode !== 'auto') return this.lodMode;
    if (this.regime === 0) return distance > nearDistance + hysteresis ? 1 : 0;
    if (this.regime === 1) return distance < nearDistance - hysteresis ? 0 : 1;
    return distance < nearDistance ? 0 : 1;
  }
  update() {
    const next = this.chooseLOD();
    if (next === this.regime) return false;
    this.regime = next;
    return true;
  }

  assemble(boxes: readonly ArchitectureBox[], context: ArchitectureQAContext) {
    const lod = this.regime;
    if (
      this.disposed ||
      this.status !== 'ready' ||
      context.surface !== 'masonry' ||
      context.tier !== 'street' ||
      lod === null
    )
      return null;
    const chosen = boxes
      .map((box, index) => ({
        box,
        index,
        match: this.selected.get(architectureBoxKey(box)),
      }))
      .filter(
        (item) =>
          item.match !== undefined &&
          item.match.part === context.sourcePart(item.box),
      );
    if (!chosen.length) return null;
    const geometry = this.templates.get(lod)!.clone();
    this.ownedBatchGeometry.add(geometry);
    const sizes = new Float32Array(chosen.length * 3),
      slots = new Float32Array(chosen.length).fill(1);
    chosen.forEach(({ box }, index) =>
      sizes.set([box.width / 1.4, 1, 1], index * 3),
    );
    geometry.setAttribute(
      'aReliefSize',
      new THREE.InstancedBufferAttribute(sizes, 3),
    );
    geometry.setAttribute(
      'aReliefSurface',
      new THREE.InstancedBufferAttribute(slots, 1),
    );
    const mesh = new THREE.InstancedMesh(
      geometry,
      this.material,
      chosen.length,
    );
    mesh.name = `${context.id}/Blender sill LOD${lod}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const rotation = new THREE.Quaternion(),
      axis = new THREE.Vector3(0, 1, 0);
    const position = new THREE.Vector3(),
      scale = new THREE.Vector3(),
      matrix = new THREE.Matrix4();
    const centre = new THREE.Vector3(0, 0.08, 0.13),
      color = new THREE.Color();
    chosen.forEach(({ box, match }, index) => {
      rotation.setFromAxisAngle(axis, match!.yaw);
      position
        .copy(centre)
        .applyQuaternion(rotation)
        .negate()
        .add(new THREE.Vector3(box.x, box.y, box.z));
      scale.set(box.width / 1.4, 1, 1);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.setHex(box.color));
    });
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.userData.architectureCandidate = {
      id: ARCHITECTURE_MODULE_CANDIDATE.id,
      lod,
      sources: chosen.map(({ match }) => ({
        sourceKey: match!.sourceKey,
        edgeKey: match!.edgeKey,
      })),
      replacedBoxes: chosen.map(({ box }) => ({ ...box })),
      perInstanceTriangles: manifest.lods[lod].triangles,
      originalPerInstanceTriangles: 12,
    };
    mesh.userData.releaseArchitectureCandidate = () => {
      if (this.ownedBatchGeometry.delete(geometry)) geometry.dispose();
    };
    return {
      meshes: [mesh],
      consumed: new Set(chosen.map(({ index }) => index)),
    };
  }

  didAttach() {
    this.host.onChange?.();
  }

  snapshot() {
    let allocated = 0,
      visible = 0,
      batches = 0,
      triangles = 0;
    this.host.details.root.traverse((object) => {
      if (
        !(object instanceof THREE.InstancedMesh) ||
        !object.userData.architectureCandidate
      )
        return;
      allocated += object.count;
      let shown = true;
      for (let node: THREE.Object3D | null = object; node; node = node.parent)
        shown &&= node.visible;
      if (shown) {
        visible += object.count;
        batches++;
        triangles +=
          object.count *
          object.userData.architectureCandidate.perInstanceTriangles;
      }
    });
    return {
      id: ARCHITECTURE_MODULE_CANDIDATE.id,
      status: this.status,
      error: this.error,
      sources: ARCHITECTURE_MODULE_CANDIDATE.sources,
      selectedExistingInstances: this.selected.size,
      allocatedReplacements: allocated,
      visibleReplacements: visible,
      visibleBatches: batches,
      visibleTriangles: triangles,
      visibleTriangleDelta: triangles - visible * 12,
      maximumInstances: ARCHITECTURE_MODULE_CANDIDATE.maximumInstances,
      maximumExtraTriangles:
        ARCHITECTURE_MODULE_CANDIDATE.maximumExtraTriangles,
      lodMode: this.lodMode,
      activeLOD: this.regime,
      templates: this.templates.size,
      sharedAtlasReady: this.host.library.ready.value === 1,
      retainedPrivateTextureObjects: 0,
      previewTexturePolicy:
        'Embedded maps decode transiently and are disposed before attachment; shared atlas is retained by engine',
      affectedCells: [...this.affectedCells],
      candidateGPUAndVisualGate: 'unverified',
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.status = 'disposed';
    this.templates.forEach((geometry) => geometry.dispose());
    this.templates.clear();
    this.ownedBatchGeometry.forEach((geometry) => geometry.dispose());
    this.ownedBatchGeometry.clear();
    this.material.dispose();
  }
}
