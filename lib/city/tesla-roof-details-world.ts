/** Conservative physical envelopes of the currently rendered roof instances.
 * No appearance plan is regenerated and no hidden/unadmitted detail is solid.
 * Streaming can introduce a real visible obstacle beneath an existing vehicle;
 * ordinary collision/recovery owns that case, rather than moving the vehicle. */
import * as THREE from 'three';
import {
  TeslaWorld,
  triangleFace,
  type TeslaGeometrySource,
} from './tesla-world';
import type { TeslaSweepHit, TeslaSweepQuery, TeslaVec3 } from './tesla-state';

interface RoofRecord {
  id: string;
  tier: string;
  ready: boolean;
  group: THREE.Group;
  cell: { bounds: THREE.Box3 };
}
interface RoofHost {
  settings: { buildings: boolean };
  architecturalDetails?: {
    root: THREE.Group;
    records: ReadonlyMap<string, RoofRecord>;
  } | null;
}
interface MeshVersion {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  count: number;
  instances: number;
  vertices: number;
  matrix: number[];
}
interface Entry {
  world: TeslaWorld;
  versions: MeshVersion[];
  children: readonly THREE.Object3D[];
  instances: number;
}
const MAX_RECORDS = 4;
// Source cell bounds include roofs+5m vertically. The roof kit's largest
// outward cornice is .085+.5/2=.335m; this broad-phase margin is not hull skin.
const CELL_MARGIN = 0.5;
const intersectsCell = (cell: THREE.Box3, query: THREE.Box3) =>
  cell.min.x - CELL_MARGIN <= query.max.x &&
  cell.max.x + CELL_MARGIN >= query.min.x &&
  cell.min.y - CELL_MARGIN <= query.max.y &&
  cell.max.y + CELL_MARGIN >= query.min.y &&
  cell.min.z - CELL_MARGIN <= query.max.z &&
  cell.max.z + CELL_MARGIN >= query.min.z;
const tuple = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
const positionVersion = (geometry: THREE.BufferGeometry) => {
  const attribute = geometry.getAttribute('position');
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : (attribute?.version ?? -1);
};
function visibleBelow(object: THREE.Object3D, root: THREE.Object3D) {
  let reached = false;
  for (let item: THREE.Object3D | null = object; item; item = item.parent) {
    if (!item.visible) return false;
    reached ||= item === root;
  }
  return reached;
}
const invalid = (point: TeslaVec3): TeslaSweepHit => ({
  surfaceId: 'tesla:rendered-roof-details-unavailable',
  kind: 'obstacle',
  point,
  normal: [0, 1, 0],
  adherable: false,
  fraction: 0,
});
export function nearestTeslaRoofDetailHit(
  a: TeslaSweepHit | null,
  b: TeslaSweepHit | null,
) {
  return !a ? b : !b || a.fraction <= b.fraction ? a : b;
}
function instanceSource(
  id: string,
  box: THREE.Box3,
  matrix: THREE.Matrix4,
  enabled: () => boolean,
): TeslaGeometrySource {
  const corners = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
  ].map((p) => new THREE.Vector3(...p).applyMatrix4(matrix));
  const bounds = new THREE.Box3().setFromPoints(corners),
    center = bounds.getCenter(new THREE.Vector3()),
    inverse = matrix.clone().invert();
  return {
    id,
    bounds,
    enabled,
    inside: (point) =>
      enabled() &&
      box
        .clone()
        .expandByScalar(-1e-7)
        .containsPoint(new THREE.Vector3(...point).applyMatrix4(inverse)),
    load: () => {
      // Twelve faces are created only for a nearby collision tile, not for all
      // 650 admitted instances in a cell. Geometry is immutable in this epoch.
      const faces = [];
      for (const [side, indices] of [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
      ].entries()) {
        for (const [triangle, indices3] of [
          [indices[0], indices[1], indices[2]],
          [indices[0], indices[2], indices[3]],
        ].entries()) {
          const points = indices3.map((i) => corners[i]) as [
              THREE.Vector3,
              THREE.Vector3,
              THREE.Vector3,
            ],
            normal = new THREE.Triangle(...points).getNormal(
              new THREE.Vector3(),
            );
          if (normal.dot(points[0].clone().sub(center)) < 0) normal.negate();
          const face = triangleFace(
            id,
            `${id}:${side}:${triangle}`,
            'obstacle',
            [tuple(points[0]), tuple(points[1]), tuple(points[2])],
            false,
            id,
            tuple(normal),
          );
          face.enabled = enabled;
          faces.push(face);
        }
      }
      return faces;
    },
  };
}

export class TeslaRenderedRoofDetailsWorld {
  private readonly cache = new Map<RoofRecord, Entry>();
  private disposed = false;
  private builds = 0;
  constructor(private readonly host: RoofHost) {}
  private active(record: RoofRecord, root: THREE.Group) {
    return (
      this.host.settings.buildings &&
      record.ready &&
      record.tier === 'roof' &&
      this.host.architecturalDetails?.root === root &&
      this.host.architecturalDetails.records.get(record.id) === record &&
      visibleBelow(record.group, root)
    );
  }
  private entry(record: RoofRecord, root: THREE.Group): Entry {
    record.group.updateWorldMatrix(true, false);
    // Production roof batches are direct InstancedMesh children. Inspect only
    // their tiny identity/version list, never traverse the city or triangles.
    for (const child of record.group.children)
      child.updateWorldMatrix(false, false);
    const old = this.cache.get(record),
      meshes = record.group.children.filter(
        (child): child is THREE.InstancedMesh =>
          child instanceof THREE.InstancedMesh &&
          child.visible &&
          child.count > 0,
      );
    if (
      old &&
      old.children.length === record.group.children.length &&
      old.children.every((child, i) => child === record.group.children[i]) &&
      old.versions.length === meshes.length &&
      old.versions.every((v, i) => {
        const mesh = meshes[i];
        return (
          v.mesh === mesh &&
          v.geometry === mesh.geometry &&
          v.count === mesh.count &&
          v.instances === mesh.instanceMatrix.version &&
          v.vertices === positionVersion(mesh.geometry) &&
          v.matrix.every((value, k) => value === mesh.matrixWorld.elements[k])
        );
      })
    ) {
      this.cache.delete(record);
      this.cache.set(record, old);
      return old;
    }
    old?.world.dispose();
    const versions: MeshVersion[] = [],
      sources: TeslaGeometrySource[] = [];
    let instances = 0;
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (
        !box ||
        box.isEmpty() ||
        ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
      )
        throw new Error('Invalid rendered roof geometry');
      const version: MeshVersion = {
        mesh,
        geometry,
        count: mesh.count,
        instances: mesh.instanceMatrix.version,
        vertices: positionVersion(geometry),
        matrix: [...mesh.matrixWorld.elements],
      };
      versions.push(version);
      const enabled = () =>
        this.active(record, root) &&
        mesh.parent === record.group &&
        mesh.visible &&
        mesh.geometry === geometry &&
        mesh.instanceMatrix.version === version.instances &&
        positionVersion(geometry) === version.vertices &&
        version.matrix.every(
          (value, i) => mesh.matrixWorld.elements[i] === value,
        ) &&
        mesh.count === version.count;
      for (let index = 0; index < mesh.count; index++) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(index, matrix);
        matrix.premultiply(mesh.matrixWorld);
        if (
          !matrix.elements.every(Number.isFinite) ||
          Math.abs(matrix.determinant()) < 1e-12
        )
          throw new Error('Invalid rendered roof transform');
        sources.push(
          instanceSource(
            `architecture:${record.id}:${mesh.uuid}:${index}`,
            box,
            matrix,
            enabled,
          ),
        );
        instances++;
      }
    }
    const entry = {
      world: new TeslaWorld({ sources, maxCachedTiles: 4 }),
      versions,
      children: [...record.group.children],
      instances,
    };
    this.cache.set(record, entry);
    this.builds++;
    while (this.cache.size > MAX_RECORDS) {
      const oldest = this.cache.keys().next().value!;
      this.cache.get(oldest)!.world.dispose();
      this.cache.delete(oldest);
    }
    return entry;
  }
  sweep(query: TeslaSweepQuery): TeslaSweepHit | null {
    if (this.disposed) return invalid(query.from.position);
    const architecture = this.host.architecturalDetails;
    for (const [record, entry] of this.cache)
      if (architecture?.records.get(record.id) !== record) {
        entry.world.dispose();
        this.cache.delete(record);
      }
    if (
      !this.host.settings.buildings ||
      !architecture ||
      !visibleBelow(architecture.root, architecture.root)
    )
      return null;
    const radius =
        Math.hypot(...query.shape.halfExtents) + query.shape.clearance + 0.01,
      bounds = new THREE.Box3()
        .setFromPoints([
          new THREE.Vector3(...query.from.position),
          new THREE.Vector3(...query.to.position),
        ])
        .expandByScalar(radius);
    if (
      ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    )
      return invalid(query.from.position);
    let first: TeslaSweepHit | null = null;
    try {
      for (const record of architecture.records.values()) {
        // Cell bounds include the source roofs plus the existing five-metre
        // detail envelope. Only local, ready, actually visible roof records load.
        if (
          record.tier !== 'roof' ||
          !record.ready ||
          !intersectsCell(record.cell.bounds, bounds) ||
          !this.active(record, architecture.root)
        )
          continue;
        first = nearestTeslaRoofDetailHit(
          first,
          this.entry(record, architecture.root).world.sweep({
            ...query,
            ignoreSurfaceId: undefined,
          }),
        );
        if (first?.fraction === 0) break;
      }
    } catch {
      return invalid(query.from.position);
    }
    return first;
  }
  stats() {
    const entries = [...this.cache.values()];
    return {
      maxCachedRecords: MAX_RECORDS,
      cachedRecords: entries.length,
      builtRecords: this.builds,
      instanceSources: entries.reduce((n, entry) => n + entry.instances, 0),
      cachedTiles: entries.reduce(
        (n, entry) => n + entry.world.stats().cachedTiles,
        0,
      ),
      cachedFaces: entries.reduce(
        (n, entry) => n + entry.world.stats().cachedFaces,
        0,
      ),
    };
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.cache.values()) entry.world.dispose();
    this.cache.clear();
  }
}
