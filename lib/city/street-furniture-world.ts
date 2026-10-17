import * as THREE from 'three';
import type { CityEngine } from './engine';
import { GroundSurfaceIndex } from './ground-surface';
import { StreetFurniture } from './street-furniture';
import type { RoadGraph } from './road-graph';
import {
  planStreetFurniture,
  StreetFurnitureBlockers,
  type FurniturePlacement,
} from './street-furniture-placement';

export interface FrontageApproach {
  x: number;
  z: number;
  yaw: number;
}
interface Circle {
  x: number;
  z: number;
  radius: number;
}
class CircleIndex {
  private readonly cells = new Map<string, Circle[]>();
  constructor(circles: readonly Circle[]) {
    for (const circle of circles) {
      if (![circle.x, circle.z, circle.radius].every(Number.isFinite)) continue;
      for (
        let x = Math.floor((circle.x - circle.radius) / 16);
        x <= Math.floor((circle.x + circle.radius) / 16);
        x++
      )
        for (
          let z = Math.floor((circle.z - circle.radius) / 16);
          z <= Math.floor((circle.z + circle.radius) / 16);
          z++
        ) {
          const key = `${x},${z}`;
          const bucket = this.cells.get(key) ?? [];
          bucket.push(circle);
          this.cells.set(key, bucket);
        }
    }
  }
  blocked(x: number, z: number, radius: number) {
    for (
      let gx = Math.floor((x - radius) / 16);
      gx <= Math.floor((x + radius) / 16);
      gx++
    )
      for (
        let gz = Math.floor((z - radius) / 16);
        gz <= Math.floor((z + radius) / 16);
        gz++
      )
        for (const circle of this.cells.get(`${gx},${gz}`) ?? [])
          if (
            (x - circle.x) ** 2 + (z - circle.z) ** 2 <=
            (radius + circle.radius) ** 2
          )
            return true;
    return false;
  }
}

/** Static scene proof. Authoritative rendered ground footways, never terrain
 * height alone, authorize an asset. The height field is only the query anchor. */
export function prepareCityFurniture(e: CityEngine) {
  const startedAt = performance.now();
  const graph = e.data.roadGraph as RoadGraph;
  const queryRegions: THREE.Box3[] = [];
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a]?.point,
      b = graph.nodes[edge.b]?.point;
    if (
      !a ||
      !b ||
      ![...a, ...b, edge.width, edge.corridorWidth].every(Number.isFinite) ||
      edge.width <= 0 ||
      (edge.corridorWidth - edge.width) / 2 < 3.8
    )
      continue;
    // Coarse superset of the planner's eligible edges, including extra road
    // classes/layers rather than duplicating its appearance policy. All actual
    // footprint and 1.8m passage probes stay within corridor half-width +4m,
    // including the <=3.011m longitudinal approach beyond a station. Any mesh
    // able to answer one of those probes must intersect this XZ envelope.
    const pad = edge.corridorWidth / 2 + 4;
    queryRegions.push(
      new THREE.Box3(
        new THREE.Vector3(
          Math.min(a[0], b[0]) - pad,
          -Infinity,
          Math.min(a[1], b[1]) - pad,
        ),
        new THREE.Vector3(
          Math.max(a[0], b[0]) + pad,
          Infinity,
          Math.max(a[1], b[1]) + pad,
        ),
      ),
    );
  }
  const meshes: THREE.Mesh[] = [];
  const worldBounds = new THREE.Box3();
  let prefilterMeshes = 0;
  e.roads.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !object.userData.walkSurface ||
      object.userData.asphaltSurface ||
      object.userData.protectedSurface ||
      !/^(Clipped sidewalks|Water Street brick footways) /.test(object.name) ||
      (object.userData.layer !== undefined && object.userData.layer !== 0) ||
      (object.userData.surfaceId !== undefined &&
        object.userData.surfaceId !== 'ground')
    )
      return;
    for (
      let parent: THREE.Object3D | null = object;
      parent;
      parent = parent.parent
    )
      if (!parent.visible) return;
    prefilterMeshes++;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (!object.geometry.boundingBox) return;
    object.updateWorldMatrix(true, false);
    worldBounds
      .copy(object.geometry.boundingBox)
      .applyMatrix4(object.matrixWorld);
    if (!queryRegions.some((region) => region.intersectsBox(worldBounds)))
      return;
    meshes.push(object);
  });
  const floor = new GroundSurfaceIndex(meshes);
  const floorBuiltAt = performance.now();
  const allowed = (x: number, z: number) =>
    e.traffic?.downtownAt(x, z) === true;
  const circles: Circle[] = [];
  for (const tree of e.detailedTrees?.trees ?? [])
    if (tree.x > -2100 && tree.x < 2600 && tree.z > -1300 && tree.z < 1700)
      circles.push({
        x: tree.x,
        z: tree.z,
        radius: Math.max(0.6, tree.h * 0.035),
      });
  for (const [x, z] of e.data.streetLampPoints ?? [])
    circles.push({ x, z, radius: 0.3 });
  const obstacles = new CircleIndex(circles);
  const approaches = e.data.streetFrontageApproaches as
    | FrontageApproach[]
    | undefined;
  const approachCells = new Map<string, FrontageApproach[]>();
  for (const approach of approaches ?? []) {
    // Full representative 1.8m-wide approach, from the facade toward the curb.
    for (
      let x = Math.floor((approach.x - 9) / 16);
      x <= Math.floor((approach.x + 9) / 16);
      x++
    )
      for (
        let z = Math.floor((approach.z - 9) / 16);
        z <= Math.floor((approach.z + 9) / 16);
        z++
      ) {
        const key = `${x},${z}`,
          bucket = approachCells.get(key) ?? [];
        bucket.push(approach);
        approachCells.set(key, bucket);
      }
  }
  const blocked = (x: number, z: number, radius: number) => {
    if (obstacles.blocked(x, z, radius)) return true;
    for (const approach of approachCells.get(
      `${Math.floor(x / 16)},${Math.floor(z / 16)}`,
    ) ?? []) {
      const dx = x - approach.x,
        dz = z - approach.z;
      const cos = Math.cos(approach.yaw),
        sin = Math.sin(approach.yaw);
      const along = cos * dx - sin * dz,
        out = sin * dx + cos * dz;
      if (
        Math.abs(along) <= 0.9 + radius &&
        out >= -radius &&
        out <= 7 + radius
      )
        return true;
    }
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.707, 0.707],
      [-0.707, 0.707],
      [0.707, -0.707],
      [-0.707, -0.707],
    ])
      if (e.waterWorld.solidAt(x + dx * radius, z + dz * radius)) return true;
    return false;
  };
  const exclusionsBuiltAt = performance.now();
  const plan = planStreetFurniture({
    graph,
    allowed,
    blocked,
    sidewalkAt: (x, z) =>
      floor.sample(
        x,
        z,
        (e.data.roadRelief?.(x, z) ?? e.elevation(x, z)) + 1.18,
      ),
  });
  return {
    ...plan,
    proof: {
      sidewalkMeshes: meshes.length,
      prefilterMeshes,
      obstacleSources: circles.length,
      approachSources: approaches?.length ?? 0,
      buildMs: performance.now() - startedAt,
      floorBuildMs: floorBuiltAt - startedAt,
      exclusionsBuildMs: exclusionsBuiltAt - floorBuiltAt,
      planningMs: performance.now() - exclusionsBuiltAt,
    },
  };
}

/** Ground occupancy is stable while its renderer streams, changes LOD or moves
 * out of range. Pending occupancy protects pedestrian routes and bus exits;
 * the player only collides with successfully loaded, visible-ready assets. */
export class CityStreetFurniture {
  readonly placements: FurniturePlacement[];
  readonly renderer: StreetFurniture;
  readonly blockers: StreetFurnitureBlockers;
  readonly plan: ReturnType<typeof prepareCityFurniture>;
  constructor(private readonly e: CityEngine) {
    this.plan = prepareCityFurniture(e);
    this.placements = this.plan.placements;
    this.blockers = new StreetFurnitureBlockers(this.placements);
    this.renderer = new StreetFurniture(e, this.placements);
  }
  get ready() {
    return this.renderer.ready;
  }
  blocked(x: number, z: number, radius = 0.35, pending = false) {
    return (
      (pending || (this.e.settings.buildings && this.ready)) &&
      this.blockers.blocked(x, z, radius)
    );
  }
  update(force = false) {
    this.renderer.update(force);
  }
  stats() {
    return {
      plan: this.plan.stats,
      proof: this.plan.proof,
      renderer: this.renderer.stats(),
    };
  }
  dispose() {
    this.renderer.dispose();
  }
}
