import * as THREE from 'three';
import type { CabinOwner } from './skytrain-cabin-assets';

export type CabinPoint = [number, number, number];
export interface PassengerSeat {
  id: string;
  /** Car-zero-local floor datum beneath the authored pelvis. */
  position: CabinPoint;
  eyeHeight: number;
  eyeOffsetXZ: readonly [number, number];
  seatHeight: number;
  yaw: number;
  /** Immutable, clear body origins beside the actual cushion. */
  approaches: readonly CabinPoint[];
}
interface Face {
  structural: boolean;
  a: THREE.Vector2;
  b: THREE.Vector2;
  c: THREE.Vector2;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const radius = 0.19;
const segmentDistance = (
  p: THREE.Vector2,
  a: THREE.Vector2,
  b: THREE.Vector2,
) => {
  const dx = b.x - a.x,
    dz = b.y - a.y,
    length = dx * dx + dz * dz;
  const t = length
    ? THREE.MathUtils.clamp(
        ((p.x - a.x) * dx + (p.y - a.y) * dz) / length,
        0,
        1,
      )
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dz);
};
function touches(p: THREE.Vector2, f: Face, padding = radius) {
  const cross = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const area = cross(f.a, f.b, f.c),
    a = cross(f.a, f.b, p),
    b = cross(f.b, f.c, p),
    c = cross(f.c, f.a, p);
  if (
    Math.abs(area) > 1e-8 &&
    ((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0))
  )
    return true;
  return (
    Math.min(
      segmentDistance(p, f.a, f.b),
      segmentDistance(p, f.b, f.c),
      segmentDistance(p, f.c, f.a),
    ) < padding
  );
}
/** CPU-only passenger collision derived once from the loaded cabin. Merged
 * furniture stays merged for rendering; individual triangles protect the aisle. */
export class SkyTrainPassengerSpace {
  readonly seats: readonly PassengerSeat[];
  private readonly faces: Face[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly cells = new Map<string, Face[]>();
  private readonly sitCache = new Map<string, boolean>();
  private sitOrigin: CabinPoint | null = null;
  private sitOriginClear = false;
  constructor(
    owner: CabinOwner,
    private readonly floor: number,
  ) {
    owner.group.updateWorldMatrix(true, true);
    const frame = owner.group.parent!;
    const inverse = frame.matrixWorld.clone().invert();
    const vertices = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];
    const seatSurfaces: THREE.Triangle[] = [];
    owner.group.traverse((node) => {
      if (
        !(node instanceof THREE.Mesh) ||
        !node.name.startsWith('interior-batch-')
      )
        return;
      const matrix = new THREE.Matrix4().multiplyMatrices(
        inverse,
        node.matrixWorld,
      );
      const g = node.geometry,
        positions = g.getAttribute('position'),
        index = g.index;
      if (node.name.endsWith('floor')) {
        g.computeBoundingBox();
        this.bounds.union(g.boundingBox!.clone().applyMatrix4(matrix));
        return;
      }
      if (
        !/seat|priority|rail|panel|shell|metal|rubber|wall|glass/.test(
          node.name,
        )
      )
        return;
      const count = index?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        for (let j = 0; j < 3; j++)
          vertices[j]
            .fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
            .applyMatrix4(matrix);
        const [a, b, c] = vertices;
        if (/seat|priority/.test(node.name)) {
          const triangle = new THREE.Triangle(a.clone(), b.clone(), c.clone());
          if (Math.abs(triangle.getNormal(new THREE.Vector3()).y) > 0.7)
            seatSurfaces.push(triangle);
        }
        const minY = Math.min(a.y, b.y, c.y),
          maxY = Math.max(a.y, b.y, c.y);
        if (maxY < floor + 0.14 || minY > floor + 1.65) continue;
        // The shell batch also contains cushion pans/backs. Low seat plinths
        // stay solid for walking; only taller structural screens participate
        // in the separate seating visibility ray to the authored pelvis.
        this.faces.push({
          structural:
            /panel|rubber|wall|glass/.test(node.name) && maxY > floor + 0.75,
          a: new THREE.Vector2(a.x, a.z),
          b: new THREE.Vector2(b.x, b.z),
          c: new THREE.Vector2(c.x, c.z),
          minX: Math.min(a.x, b.x, c.x),
          maxX: Math.max(a.x, b.x, c.x),
          minZ: Math.min(a.z, b.z, c.z),
          maxZ: Math.max(a.z, b.z, c.z),
        });
      }
    });
    // Expanded face buckets preserve exact triangle checks while keeping aisle
    // queries local; far parts of a merged rendering batch are never scanned.
    for (const face of this.faces) {
      for (
        let x = Math.floor((face.minX - radius) / 0.5);
        x <= Math.floor((face.maxX + radius) / 0.5);
        x++
      )
        for (
          let z = Math.floor((face.minZ - radius) / 0.5);
          z <= Math.floor((face.maxZ + radius) / 0.5);
          z++
        ) {
          const key = `${x}:${z}`,
            bucket = this.cells.get(key) ?? [];
          bucket.push(face);
          this.cells.set(key, bucket);
        }
    }
    this.seats = owner.descriptor.viewpoints
      .filter((v) => v.kind === 'seat')
      .flatMap((view) => {
        const node = owner.group.getObjectByName(view.nodeId);
        if (!node) return [];
        const eye = node
          .getWorldPosition(new THREE.Vector3())
          .applyMatrix4(inverse)
          .add(new THREE.Vector3(...view.offsetM));
        const pelvisNode = owner.group.getObjectByName(
          view.nodeId.replace(/-camera$/, '-pelvis'),
        );
        const pelvis =
          pelvisNode
            ?.getWorldPosition(new THREE.Vector3())
            .applyMatrix4(inverse) ?? eye;
        let surface = -Infinity;
        const point = new THREE.Vector3(pelvis.x, pelvis.y, pelvis.z),
          closest = new THREE.Vector3();
        for (const triangle of seatSurfaces) {
          triangle.closestPointToPoint(point, closest);
          if (
            Math.hypot(closest.x - pelvis.x, closest.z - pelvis.z) < 0.2 &&
            closest.y > floor + 0.3 &&
            closest.y < floor + 0.7
          )
            surface = Math.max(surface, closest.y);
        }
        if (!Number.isFinite(surface)) return [];
        return [
          {
            id: view.id,
            position: [pelvis.x, floor, pelvis.z] as CabinPoint,
            eyeHeight: eye.y - floor,
            eyeOffsetXZ: [eye.x - pelvis.x, eye.z - pelvis.z] as const,
            seatHeight: surface - floor,
            yaw: Math.atan2(view.facingXZ[0], view.facingXZ[1]),
            approaches: [] as CabinPoint[],
          },
        ];
      });
    for (const seat of this.seats) seat.approaches = this.buildApproaches(seat);
  }
  private buildApproaches(seat: PassengerSeat): readonly CabinPoint[] {
    const result: CabinPoint[] = [];
    const observation = seat.id === 'seat-observation';
    // Try the front first, then both sides. The observation seat's original
    // tight front arrangement also needs its rear aisle-side approach.
    for (let angle = 0; angle < 32; angle++) {
      const offset =
        ((angle % 2 ? 1 : -1) * Math.ceil(angle / 2) * Math.PI) / 16;
      if (!observation && Math.cos(offset) < -0.05) continue;
      const heading = seat.yaw + offset;
      let nearest: CabinPoint | null = null,
        farthest: CabinPoint | null = null;
      for (const distance of [0.5, 0.65, 0.8, 0.95, 1.1, 1.25]) {
        const point: CabinPoint = [
          seat.position[0] + Math.sin(heading) * distance,
          this.floor,
          seat.position[2] + Math.cos(heading) * distance,
        ];
        if (
          this.clear(point) &&
          this.clearSegment(point, seat.position, true)
        ) {
          nearest ??= point;
          farthest = point;
        }
      }
      if (nearest) result.push(nearest);
      if (farthest && farthest !== nearest) result.push(farthest);
    }
    return result;
  }
  private clearSegment(
    from: readonly number[],
    to: readonly number[],
    structuralOnly = false,
  ) {
    const dx = to[0] - from[0],
      dz = to[2] - from[2];
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
    for (let i = 0; i <= count; i++) {
      const point: CabinPoint = [
        from[0] + (dx * i) / count,
        this.floor,
        from[2] + (dz * i) / count,
      ];
      if (!this.clearPoint(point, structuralOnly)) return false;
    }
    return true;
  }
  clear(point: readonly number[]) {
    return this.clearPoint(point, false);
  }
  private clearPoint(point: readonly number[], structuralOnly: boolean) {
    if (
      point.length !== 3 ||
      !point.every(Number.isFinite) ||
      this.bounds.isEmpty() ||
      Math.abs(point[1] - this.floor) > 0.01
    )
      return false;
    const [x, , z] = point;
    const padding = structuralOnly ? 0.04 : radius;
    if (
      x < this.bounds.min.x + padding ||
      x > this.bounds.max.x - padding ||
      z < this.bounds.min.z + padding ||
      z > this.bounds.max.z - padding
    )
      return false;
    const p = new THREE.Vector2(x, z);
    return !(
      this.cells.get(`${Math.floor(x / 0.5)}:${Math.floor(z / 0.5)}`) ?? []
    ).some(
      (f) =>
        (!structuralOnly || f.structural) &&
        x >= f.minX - padding &&
        x <= f.maxX + padding &&
        z >= f.minZ - padding &&
        z <= f.maxZ + padding &&
        touches(p, f, padding),
    );
  }
  walk(from: CabinPoint, dx: number, dz: number): CabinPoint {
    if (
      ![dx, dz].every(Number.isFinite) ||
      Math.hypot(dx, dz) > 8 ||
      !this.clear(from)
    )
      return [...from];
    let next: CabinPoint = [...from];
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
    const attempt = (x: number, z: number) => {
      const point: CabinPoint = [x, this.floor, z];
      if (!this.clear(point)) return false;
      next = point;
      return true;
    };
    for (let i = 0; i < count; i++)
      if (!attempt(next[0] + dx / count, next[2] + dz / count)) {
        if (Math.abs(dx) > 1e-9) attempt(next[0] + dx / count, next[2]);
        if (Math.abs(dz) > 1e-9) attempt(next[0], next[2] + dz / count);
      }
    return next;
  }
  doorSpawn(side: 'left' | 'right', z = 0): CabinPoint {
    // Keep the selected physical doorway's longitudinal position. Alighting
    // owns the threshold crossing even while the door is visibly open.
    for (const x of [side === 'left' ? 0.65 : -0.65, 0, 0.3, -0.3]) {
      const point: CabinPoint = [x, this.floor, z];
      if (this.clear(point)) return point;
    }
    throw new Error('No clear passenger door threshold');
  }
  canSit(seat: PassengerSeat, from: readonly number[]) {
    const dx = from[0] - seat.position[0],
      dz = from[2] - seat.position[2];
    if (Math.hypot(dx, dz) >= 1.45) return false;
    if (
      seat.id !== 'seat-observation' &&
      dx * Math.sin(seat.yaw) + dz * Math.cos(seat.yaw) < -0.12
    )
      return false;
    if (
      !this.sitOrigin ||
      from.some((value, index) => value !== this.sitOrigin![index])
    ) {
      this.sitOrigin = [from[0], from[1], from[2]];
      this.sitOriginClear = this.clear(from);
      this.sitCache.clear();
    }
    if (!this.sitOriginClear) return false;
    const cached = this.sitCache.get(seat.id);
    if (cached !== undefined) return cached;
    // Sweep only as far as a free, cushion-side standing origin. Occupied
    // cushions remain solid; structural partitions never become seat portals.
    const allowed =
      this.clearSegment(from, seat.position, true) &&
      seat.approaches.some((point) => this.clearSegment(from, point));
    this.sitCache.set(seat.id, allowed);
    return allowed;
  }
}
