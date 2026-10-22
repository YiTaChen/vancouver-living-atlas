import * as THREE from 'three';
import type { BusCabinSurfaces } from './bus-cabin-surfaces';
import type { VehiclePassengerContract } from './city-life/vehicle-profile-adapter';

export type BusCabinPoint = [number, number, number];
export interface BusPassengerSeat {
  id: string;
  /** Vehicle-local floor under the authored pelvis, never a camera datum. */
  position: BusCabinPoint;
  yaw: number;
  seatHeight: number;
  eyeHeight: number;
  eyeOffsetXZ: readonly [number, number];
  approaches: readonly BusCabinPoint[];
}
interface Face {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}
interface CollisionNode {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  faces?: readonly Face[];
  left?: CollisionNode;
  right?: CollisionNode;
}
const RADIUS = 0.18;
const HEIGHT = 1.72;
const STEP = 0.18;
const finite = (p: readonly number[]) =>
  p.length === 3 && p.every(Number.isFinite);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontalDistance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);
function segmentDistance(
  x: number,
  z: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = dx * dx + dz * dz;
  const t = length
    ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / length, 0, 1)
    : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function touches(x: number, z: number, face: Face, radius: number) {
  if (
    x < face.minX - radius - 1e-8 ||
    x > face.maxX + radius + 1e-8 ||
    z < face.minZ - radius - 1e-8 ||
    z > face.maxZ + radius + 1e-8
  )
    return false;
  const [a, b, c] = face.vertices;
  const cross = (u: THREE.Vector3, v: THREE.Vector3) =>
    (v.x - u.x) * (z - u.z) - (v.z - u.z) * (x - u.x);
  const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const ab = cross(a, b),
    bc = cross(b, c),
    ca = cross(c, a);
  return (
    (Math.abs(area) > 1e-9 &&
      ((ab >= -1e-9 && bc >= -1e-9 && ca >= -1e-9) ||
        (ab <= 1e-9 && bc <= 1e-9 && ca <= 1e-9))) ||
    Math.min(
      segmentDistance(x, z, a, b),
      segmentDistance(x, z, b, c),
      segmentDistance(x, z, c, a),
    ) < radius
  );
}

/** Exact triangles at leaves; this only skips bounds that the capsule cannot
 * intersect. Render tessellation therefore does not multiply walking costs. */
function collisionTree(faces: Face[]): CollisionNode | undefined {
  if (!faces.length) return undefined;
  const node: CollisionNode = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  let minCenterX = Infinity,
    maxCenterX = -Infinity,
    minCenterZ = Infinity,
    maxCenterZ = -Infinity;
  for (const face of faces) {
    node.minX = Math.min(node.minX, face.minX);
    node.maxX = Math.max(node.maxX, face.maxX);
    node.minY = Math.min(node.minY, face.minY);
    node.maxY = Math.max(node.maxY, face.maxY);
    node.minZ = Math.min(node.minZ, face.minZ);
    node.maxZ = Math.max(node.maxZ, face.maxZ);
    const x = face.minX + face.maxX,
      z = face.minZ + face.maxZ;
    minCenterX = Math.min(minCenterX, x);
    maxCenterX = Math.max(maxCenterX, x);
    minCenterZ = Math.min(minCenterZ, z);
    maxCenterZ = Math.max(maxCenterZ, z);
  }
  if (faces.length <= 20) {
    node.faces = faces;
    return node;
  }
  const splitX = maxCenterX - minCenterX > maxCenterZ - minCenterZ,
    midpoint = splitX
      ? (minCenterX + maxCenterX) / 2
      : (minCenterZ + maxCenterZ) / 2;
  let left: Face[] = [],
    right: Face[] = [];
  for (const face of faces)
    ((splitX ? face.minX + face.maxX : face.minZ + face.maxZ) < midpoint
      ? left
      : right
    ).push(face);
  if (Math.min(left.length, right.length) < faces.length * 0.1) {
    faces.sort(
      splitX
        ? (a, b) => a.minX + a.maxX - b.minX - b.maxX
        : (a, b) => a.minZ + a.maxZ - b.minZ - b.maxZ,
    );
    left = faces.slice(0, Math.floor(faces.length / 2));
    right = faces.slice(left.length);
  }
  node.left = collisionTree(left);
  node.right = collisionTree(right);
  return node;
}
function intersectsTree(
  node: CollisionNode | undefined,
  x: number,
  z: number,
  minY: number,
  maxY: number,
  radius: number,
): boolean {
  if (!node || node.maxY <= minY || node.minY >= maxY) return false;
  const dx = Math.max(node.minX - x, 0, x - node.maxX),
    dz = Math.max(node.minZ - z, 0, z - node.maxZ);
  if (dx * dx + dz * dz > (radius + 1e-8) ** 2) return false;
  if (node.faces) {
    for (const face of node.faces)
      if (face.maxY > minY && face.minY < maxY && touches(x, z, face, radius))
        return true;
    return false;
  }
  return (
    intersectsTree(node.left, x, z, minY, maxY, radius) ||
    intersectsTree(node.right, x, z, minY, maxY, radius)
  );
}

/** One local CPU index for the currently owned interior. Actual floor and
 * furniture triangles stay independent of merged render batches and bus motion. */
export class BusPassengerSpace {
  readonly seats: readonly BusPassengerSeat[];
  private readonly floors: Face[] = [];
  private readonly bodyTree: CollisionNode | undefined;
  private readonly structuralTree: CollisionNode | undefined;
  private readonly standing: BusCabinPoint[] = [];
  private readonly ceiling: number;
  private readonly cache = new Map<string, boolean>();
  private origin: BusCabinPoint | null = null;
  private originClear: boolean | null = null;

  constructor(
    root: THREE.Object3D,
    vehicle: Record<string, unknown>,
    anchors: VehiclePassengerContract['anchors'],
    _surfaces?: BusCabinSurfaces,
  ) {
    this.ceiling = Number(
      (vehicle.ceiling as { undersideHeightM?: number } | undefined)
        ?.undersideHeightM,
    );
    if (!Number.isFinite(this.ceiling))
      throw new Error('Missing bus passenger ceiling');
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const cushions: Face[] = [],
      body: Face[] = [],
      structure: Face[] = [];
    const triangle = new THREE.Triangle(),
      normal = new THREE.Vector3();
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      const floor = materials.some((material) =>
        ['bus-v2-floor', 'transit-floor'].includes(
          String(material.userData.shared_surface_id),
        ),
      );
      const marking = materials.every(
        (material) => material.userData.shared_surface_id === 'bus-v2-marking',
      );
      if (marking || /light|button/.test(node.name)) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(
        inverse,
        node.matrixWorld,
      );
      const positions = node.geometry.getAttribute('position'),
        index = node.geometry.index;
      const structural = /panel|glass|fixture|rubber/.test(node.name),
        seat = /seat/.test(node.name) && !/shell/.test(node.name);
      const count = index?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        const vertices = [0, 1, 2].map((j) =>
          new THREE.Vector3()
            .fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
            .applyMatrix4(matrix),
        ) as Face['vertices'];
        const normalY = triangle.set(...vertices).getNormal(normal).y;
        const minY = Math.min(...vertices.map((v) => v.y)),
          maxY = Math.max(...vertices.map((v) => v.y));
        const minX = Math.min(...vertices.map((v) => v.x)),
          maxX = Math.max(...vertices.map((v) => v.x)),
          minZ = Math.min(...vertices.map((v) => v.z)),
          maxZ = Math.max(...vertices.map((v) => v.z));
        const face = {
          vertices,
          minX,
          maxX,
          minZ,
          maxZ,
          minY,
          maxY,
        };
        if (floor) {
          if (normalY > 0.99) {
            this.floors.push(face);
          }
          continue;
        }
        if (seat && normalY > 0.7) cushions.push(face);
        if (maxY < 0.5 || minY > this.ceiling) continue;
        body.push(face);
        if (structural) structure.push(face);
      }
    });
    this.bodyTree = collisionTree(body);
    this.structuralTree = collisionTree(structure);
    if (!this.floors.length)
      throw new Error('Missing actual bus passenger floor');
    const descriptions = Array.isArray(vehicle.seats)
      ? (vehicle.seats as Record<string, unknown>[])
      : [];
    this.seats = anchors
      .filter((a) => a.anchor.kind === 'seat')
      .flatMap((anchor) => {
        const metadata = descriptions.find(
          (row) => row.seatId === anchor.anchor.anchorId,
        );
        if (!metadata) return [];
        const actualPelvis = root.getObjectByName(
          String(metadata.pelvisAnchorNodeId),
        );
        const actualEye = root.getObjectByName(
          String(metadata.cameraAnchorNodeId),
        );
        if (
          !actualPelvis ||
          !actualEye ||
          !anchor.cameraEyePointM ||
          actualPelvis
            .getWorldPosition(new THREE.Vector3())
            .applyMatrix4(inverse)
            .distanceTo(new THREE.Vector3(...anchor.anchor.translationM)) >
            0.004 ||
          actualEye
            .getWorldPosition(new THREE.Vector3())
            .applyMatrix4(inverse)
            .distanceTo(new THREE.Vector3(...anchor.cameraEyePointM)) > 0.004
        )
          return [];
        const pelvis = anchor.anchor.translationM,
          floor = this.floorAt(pelvis[0], pelvis[2]);
        const expected = Number(metadata.seatSurfaceHeightM);
        const hit = new THREE.Vector3(),
          ray = new THREE.Ray(
            new THREE.Vector3(pelvis[0], expected + 0.06, pelvis[2]),
            new THREE.Vector3(0, -1, 0),
          );
        let best = Infinity,
          height = NaN;
        for (const face of cushions) {
          if (!ray.intersectTriangle(...face.vertices, false, hit)) continue;
          const delta = Math.abs(hit.y - expected);
          if (delta < 0.06 && delta < best) {
            best = delta;
            height = hit.y;
          }
        }
        if (
          floor === null ||
          !Number.isFinite(height) ||
          height - floor < 0.25 ||
          height - floor > 0.75 ||
          !anchor.cameraEyePointM
        )
          return [];
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
          new THREE.Quaternion(...anchor.anchor.rotationQuaternionXYZW),
        );
        const result: BusPassengerSeat = {
          id: anchor.anchor.anchorId,
          position: [pelvis[0], floor, pelvis[2]],
          yaw: Math.atan2(forward.x, forward.z),
          seatHeight: height - floor,
          eyeHeight: anchor.cameraEyePointM[1] - floor,
          eyeOffsetXZ: [
            anchor.cameraEyePointM[0] - pelvis[0],
            anchor.cameraEyePointM[2] - pelvis[2],
          ],
          approaches: [],
        };
        return [result];
      });
    if (
      this.seats.length !==
      anchors.filter((a) => a.anchor.kind === 'seat').length
    )
      throw new Error(
        'Bus seat lacks its actual cushion, floor or authored anchor',
      );
    for (const anchor of anchors.filter((a) => a.datum === 'feet')) {
      const p = anchor.anchor.translationM;
      if (this.clear(p)) this.standing.push([...p]);
    }
    for (const seat of this.seats) seat.approaches = this.approaches(seat);
  }

  private floorAt(x: number, z: number): number | null {
    let height = -Infinity;
    for (const face of this.floors) {
      if (touches(x, z, face, 0)) height = Math.max(height, face.vertices[0].y);
    }
    return Number.isFinite(height) ? height : null;
  }
  private solid(
    point: readonly number[],
    structural = false,
    targetHeight = 0.6,
    minimumHeight = 0.2,
  ) {
    const [x, floor, z] = point;
    return intersectsTree(
      structural ? this.structuralTree : this.bodyTree,
      x,
      z,
      floor + (structural ? minimumHeight : 0.17),
      floor + (structural ? targetHeight : HEIGHT),
      structural ? 0.035 : RADIUS,
    );
  }
  clear(point: readonly number[]) {
    if (!finite(point)) return false;
    const [x, y, z] = point,
      floor = this.floorAt(x, z);
    if (
      floor === null ||
      Math.abs(floor - y) > 0.025 ||
      this.ceiling - floor < HEIGHT + 0.06
    )
      return false;
    for (const [dx, dz] of [
      [-RADIUS, 0],
      [RADIUS, 0],
      [0, -RADIUS],
      [0, RADIUS],
    ]) {
      const edge = this.floorAt(x + dx, z + dz);
      if (edge === null || Math.abs(edge - floor) > STEP + 1e-4) return false;
    }
    return !this.solid(point);
  }
  spawn(): BusCabinPoint | null {
    return this.standing[0] ? [...this.standing[0]] : null;
  }
  standingEyeHeight(point: readonly number[]) {
    return Math.min(1.65, this.ceiling - point[1] - 0.1);
  }
  safeStand(from: readonly number[]): BusCabinPoint | null {
    if (!this.clear(from)) return null;
    // Walking may straddle a 16cm rear stair, but a stand-up destination needs
    // the whole foot disc on one level, rather than balancing on a tread edge.
    for (const [dx, dz] of [
      [-RADIUS, 0],
      [RADIUS, 0],
      [0, -RADIUS],
      [0, RADIUS],
    ]) {
      const floor = this.floorAt(from[0] + dx, from[2] + dz);
      if (floor === null || Math.abs(floor - from[1]) > 0.025) return null;
    }
    return [...from] as BusCabinPoint;
  }
  walk(from: readonly number[], dx: number, dz: number): BusCabinPoint {
    const current = [...from] as BusCabinPoint;
    if (!this.clear(current) || ![dx, dz].every(Number.isFinite))
      return current;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
    if (steps > 2048) return current;
    for (let i = 0; i < steps; i++) {
      const tryStep = (x: number, z: number) => {
        const y = this.floorAt(x, z);
        if (y === null || Math.abs(y - current[1]) > STEP + 1e-4) return false;
        const next: BusCabinPoint = [x, y, z];
        if (!this.clear(next)) return false;
        current.splice(0, 3, ...next);
        return true;
      };
      if (!tryStep(current[0] + dx / steps, current[2] + dz / steps)) {
        tryStep(current[0] + dx / steps, current[2]);
        tryStep(current[0], current[2] + dz / steps);
      }
    }
    return current;
  }
  private structuralPath(from: readonly number[], seat: BusPassengerSeat) {
    const length = horizontalDistance(from, seat.position),
      count = Math.max(1, Math.ceil(length / 0.05));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const p = [
        from[0] + (seat.position[0] - from[0]) * t,
        from[1],
        from[2] + (seat.position[2] - from[2]) * t,
      ];
      if (this.solid(p, true, seat.seatHeight + 0.75, seat.seatHeight + 0.1))
        return false;
    }
    return true;
  }
  private approaches(seat: BusPassengerSeat): BusCabinPoint[] {
    const result: BusCabinPoint[] = [];
    for (let i = 0; i < 24; i++) {
      const angle = seat.yaw + (i / 24) * Math.PI * 2;
      if (Math.cos(angle - seat.yaw) < -0.05) continue;
      for (const radius of [0.45, 0.65, 0.85, 1.05, 1.25]) {
        const x = seat.position[0] + Math.sin(angle) * radius,
          z = seat.position[2] + Math.cos(angle) * radius;
        const floor = this.floorAt(x, z);
        const p: BusCabinPoint = [x, floor ?? NaN, z];
        if (
          floor !== null &&
          Math.abs(floor - seat.position[1]) < 0.03 &&
          this.safeStand(p) !== null &&
          this.structuralPath(p, seat)
        )
          result.push(p);
      }
    }
    return result;
  }
  canSit(seat: BusPassengerSeat, from: readonly number[]) {
    if (!this.seats.includes(seat) || !finite(from)) return false;
    if (!this.origin || distance(this.origin, from) > 1e-7) {
      this.origin = [...from] as BusCabinPoint;
      this.cache.clear();
      this.originClear = null;
    }
    const cached = this.cache.get(seat.id);
    if (cached !== undefined) return cached;
    const dx = from[0] - seat.position[0],
      dz = from[2] - seat.position[2];
    const front = dx * Math.sin(seat.yaw) + dz * Math.cos(seat.yaw);
    if (
      distance(from, seat.position) > 1.45 ||
      Math.abs(from[1] - seat.position[1]) >= 0.03 ||
      front <= -0.025
    ) {
      this.cache.set(seat.id, false);
      return false;
    }
    if (this.originClear === null)
      this.originClear = this.safeStand(from) !== null;
    // Start with the nearest already validated aisle point. Trying the whole
    // authored approach fan in angular order made a few walking positions scan
    // many long, obstructed paths through detailed upholstery every frame.
    const approaches = [...seat.approaches].sort(
      (a, b) =>
        (a[0] - from[0]) ** 2 +
        (a[2] - from[2]) ** 2 -
        ((b[0] - from[0]) ** 2 + (b[2] - from[2]) ** 2),
    );
    const valid =
      this.originClear &&
      this.structuralPath(from, seat) &&
      approaches.some((p) => this.clearWalkSegment(from, p));
    this.cache.set(seat.id, valid);
    return valid;
  }
  private clearWalkSegment(from: readonly number[], to: readonly number[]) {
    const dx = to[0] - from[0],
      dz = to[2] - from[2],
      steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.05));
    for (let i = 0; i <= steps; i++)
      if (
        !this.clear([
          from[0] + (dx * i) / steps,
          from[1],
          from[2] + (dz * i) / steps,
        ])
      )
        return false;
    return true;
  }
}
