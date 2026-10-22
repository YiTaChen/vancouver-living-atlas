import * as THREE from 'three';
import type { CityEngine } from './engine';
import { boxSource, teslaMeshSource } from './tesla-city-world';
import { TeslaWorld, type TeslaGeometrySource } from './tesla-world';
import type { TeslaSweepQuery, TeslaVec3 } from './tesla-state';
import type { ImpactObstacle } from './vehicle-impact';

export interface ImpactProp extends ImpactObstacle {
  position: TeslaVec3;
  heightM: number;
  radiusM: number;
}
/** Session-local mutations. Static collider tiles keep live enabled callbacks;
 * a broken prop never reappears merely because its render LOD was evicted. */
export class VehicleImpactWorld {
  readonly props = new Map<string, ImpactProp>();
  readonly sources: TeslaGeometrySource[] = [];
  readonly broken = new Set<string>();
  readonly debris = new THREE.Group();
  revision = 0;
  private world: TeslaWorld;
  private debrisWorld: TeslaWorld | null = null;
  private fallen: {
    group: THREE.Group;
    axis: THREE.Vector3;
    elapsed: number;
    prop: ImpactProp;
    source?: TeslaGeometrySource;
  }[] = [];
  private disposed = false;
  constructor(readonly e: CityEngine) {
    this.debris.name = 'Session impact debris';
    e.scene.add(this.debris);
    for (const [i, t] of (e.detailedTrees?.trees ?? []).entries()) {
      const id = `tree:${i}`;
      // Geometry-derived strength diameter, NOT surveyed municipal DBH.
      const diameter = Math.max(0.08, t.h * (t.conifer ? 0.042 : 0.038));
      const r = Math.max(0.18, t.h * 0.035);
      const prop: ImpactProp = {
        id,
        kind: 'tree',
        diameterM: diameter,
        position: [t.x, t.y, t.z],
        heightM: t.h,
        radiusM: r,
      };
      this.props.set(id, prop);
      this.sources.push(
        boxSource(
          `${id}:trunk`,
          [t.x - r, t.y, t.z - r],
          [t.x + r, t.y + t.h, t.z + r],
          undefined,
          () => !this.isBroken(id),
        ),
      );
      // Foliage is not a solid rectangular wall. The conservative trunk and
      // branch envelope remains physical, including during flight.
    }
    for (const [i, [x, z]] of (e.data.streetLampPoints ?? []).entries()) {
      const id = `lamp:${i}`,
        y = e.elevation(x, z) + 1;
      this.props.set(id, {
        id,
        kind: 'lamp',
        diameterM: 0.16,
        breakaway: true,
        position: [x, y, z],
        heightM: 8,
        radiusM: 0.13,
      });
      this.sources.push(
        boxSource(
          id,
          [x - 0.13, y, z - 0.13],
          [x + 0.13, y + 8, z + 0.13],
          undefined,
          () => !this.isBroken(id),
        ),
      );
    }
    let rail = 0;
    e.roads.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        !/ rails(?: |$)|outer pedestrian railing/.test(object.name)
      )
        return;
      const id = `guardrail:${rail++}`;
      // These shipped bridge/causeway barriers are concrete or pedestrian
      // rails, not documented energy-absorbing W-beam end terminals.
      const concrete = /Lions Gate Bridge|Stanley Park Causeway/.test(
        object.name,
      );
      object.userData.impactObstacleId = id;
      this.props.set(id, {
        id,
        kind: 'guardrail',
        material: concrete ? 'concrete' : 'steel',
        position: [0, 0, 0],
        heightM: 1,
        radiusM: 0.2,
      });
      this.sources.push(teslaMeshSource(object, id, 'obstacle', false));
    });
    this.world = new TeslaWorld({ sources: this.sources, maxCachedTiles: 64 });
  }
  isBroken(id: string) {
    return this.broken.has(id);
  }
  obstacle(surfaceId: string): ImpactObstacle {
    const id = surfaceId.match(
      /^(tree:\d+|lamp:\d+|guardrail:\d+|debris:(?:tree|lamp):\d+)(?::|$)/,
    )?.[1];
    return (id && this.props.get(id)) || { id: id ?? surfaceId, kind: 'rigid' };
  }
  sweepDebris(query: TeslaSweepQuery) {
    return this.debrisWorld?.sweep(query) ?? null;
  }
  sweep(query: TeslaSweepQuery) {
    const a = this.world.sweep(query),
      b = this.sweepDebris(query);
    return !a ? b : !b ? a : a.fraction <= b.fraction ? a : b;
  }
  breakProp(id: string, velocity: TeslaVec3) {
    if (this.disposed || this.broken.has(id)) return false;
    const prop = this.props.get(id);
    if (!prop || !['tree', 'lamp'].includes(prop.kind)) return false;
    this.broken.add(id);
    this.revision++;
    if (prop.kind === 'lamp')
      this.e.traffic?.breakLamp(Number(id.split(':')[1]));
    this.e.detailedTrees?.syncBroken();
    // Only the newest 48 nearby falls own render resources. Logical broken
    // state remains, even after a debris visual is retired.
    if (this.fallen.length >= 48) {
      this.retire(this.fallen.shift()!);
      this.rebuildDebris();
    }
    const group = new THREE.Group(),
      r = prop.kind === 'tree' ? prop.diameterM! / 2 : 0.1;
    group.position.fromArray(prop.position);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.65, r, prop.heightM, 7),
      new THREE.MeshStandardMaterial({
        color: prop.kind === 'tree' ? 0x71563d : 0x475a59,
        roughness: 0.9,
      }),
    );
    trunk.position.y = prop.heightM / 2 + 0.12;
    group.add(trunk);
    if (prop.kind === 'tree') {
      const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(prop.heightM * 0.22, 0),
        new THREE.MeshStandardMaterial({ color: 0x365235, roughness: 1 }),
      );
      crown.position.y = prop.heightM * 0.7;
      crown.scale.set(1, 1.4, 1);
      group.add(crown);
    } else {
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.14, 0.35),
        trunk.material,
      );
      head.position.set(-0.7, 7.9, 0);
      group.add(head);
    }
    const d = new THREE.Vector3(velocity[0], 0, velocity[2]);
    if (d.lengthSq() < 1e-9) d.set(0, 0, 1);
    d.normalize();
    this.debris.add(group);
    this.fallen.push({
      group,
      axis: new THREE.Vector3(d.z, 0, -d.x),
      elapsed: 0,
      prop,
    });
    return true;
  }
  update(dt: number) {
    if (this.disposed) return;
    const h = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    let changed = false;
    for (const fall of this.fallen) {
      fall.elapsed = Math.min(1.6, fall.elapsed + h);
      const t = fall.elapsed / 1.6;
      fall.group.quaternion.setFromAxisAngle(fall.axis, (t * t * Math.PI) / 2);
      const r = fall.prop.kind === 'tree' ? fall.prop.diameterM! / 2 : 0.1;
      fall.group.position.y =
        fall.prop.position[1] +
        Math.sin((t * Math.PI) / 2) * Math.max(0, r - 0.12);
      if (t >= 1 && !fall.source) {
        fall.group.updateWorldMatrix(true, true);
        fall.source = boxSource(
          `debris:${fall.prop.id}`,
          [-r, 0.12, -r],
          [r, fall.prop.heightM + 0.12, r],
          fall.group.matrixWorld.clone(),
        );
        changed = true;
      }
      fall.group.visible =
        this.e.camera.position.distanceToSquared(fall.group.position) <
        450 * 450;
    }
    if (changed) this.rebuildDebris();
  }
  private rebuildDebris() {
    this.debrisWorld?.dispose();
    this.debrisWorld = new TeslaWorld({
      sources: this.fallen.flatMap((f) => (f.source ? [f.source] : [])),
      maxCachedTiles: 16,
    });
  }
  private retire(fall: (typeof this.fallen)[number]) {
    fall.group.removeFromParent();
    const materials = new Set<THREE.Material>();
    fall.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
    materials.forEach((m) => m.dispose());
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fallen.forEach((f) => this.retire(f));
    this.fallen = [];
    this.debris.removeFromParent();
    this.world.dispose();
    this.debrisWorld?.dispose();
  }
}
