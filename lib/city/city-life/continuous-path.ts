import * as THREE from 'three';
import { sameSurface, type SurfaceIdentity } from '../surface-reachability';
export type XYZ = readonly [number, number, number];
export interface LaneCurve extends SurfaceIdentity {
  segmentId: string;
  sourceId: string;
  points: readonly [XYZ, XYZ, XYZ, XYZ];
  /** A declared connection is required across surface identities, even at identical XYZ. */
  connectionFromPrevious?: string;
}
interface Sample {
  station: number;
  segment: number;
  t: number;
}
const vector = (p: XYZ) => new THREE.Vector3(...p);
// Find derivative-zero candidates analytically: regular sample spacing can miss
// an internal cusp, whose normalized tangent flips by 180 degrees.
function quadraticRoots(a: number, b: number, c: number) {
  const epsilon = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  if (Math.abs(a) <= epsilon) return Math.abs(b) <= epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  // Stable quadratic form avoids subtracting nearly equal magnitudes.
  const q = -0.5 * (b + (b >= 0 ? root : -root));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}
function rejectInternalCusps(points: readonly [XYZ, XYZ, XYZ, XYZ]) {
  const coefficients = [0, 1, 2].map((axis) => {
    const [p0, p1, p2, p3] = points.map((p) => p[axis]);
    return [
      -p0 + 3 * p1 - 3 * p2 + p3,
      2 * (p0 - 2 * p1 + p2),
      p1 - p0,
    ] as const;
  });
  const candidates = [
    0,
    1,
    ...coefficients.flatMap(([a, b, c]) => quadraticRoots(a, b, c)),
  ];
  for (const t of candidates)
    if (t >= 0 && t <= 1) {
      const [x, y, z] = coefficients.map(([a, b, c]) => (a * t + b) * t + c);
      if (Math.hypot(x, y, z) < 1e-7) throw new Error('Internal path cusp');
      if (Math.hypot(x, z) < 1e-7)
        throw new Error('Non-drivable vertical tangent');
    }
}
/** Offline-authored cubic lane/track chain, no automatic XZ intersection connectivity.
 * Vertical elevations are inputs, never terrain+clearance guesses for tunnels. */
export class ContinuousPath {
  private curves: THREE.CubicBezierCurve3[] = [];
  private samples: Sample[] = [];
  readonly segments: readonly LaneCurve[];
  readonly length: number;
  constructor(
    segments: readonly LaneCurve[],
    readonly subdivisions = 64,
  ) {
    if (
      !segments.length ||
      !Number.isInteger(subdivisions) ||
      subdivisions < 8 ||
      subdivisions > 4096
    )
      throw new Error('Invalid path sampling');
    this.segments = structuredClone(segments);
    for (const segment of this.segments) {
      for (const point of segment.points) Object.freeze(point);
      Object.freeze(segment.points);
      Object.freeze(segment);
    }
    Object.freeze(this.segments);
    const ids = new Set<string>();
    let station = 0;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      if (
        !segment.segmentId ||
        ids.has(segment.segmentId) ||
        !segment.sourceId ||
        !segment.surfaceId ||
        !Number.isFinite(segment.layer) ||
        segment.points.length !== 4 ||
        segment.points.some((p) => p.length !== 3 || !p.every(Number.isFinite))
      )
        throw new Error('Invalid lane segment');
      ids.add(segment.segmentId);
      rejectInternalCusps(segment.points);
      const curve = new THREE.CubicBezierCurve3(
        ...(segment.points.map(vector) as [
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
          THREE.Vector3,
        ]),
      );
      if (
        curve.v0.distanceTo(curve.v1) < 1e-6 ||
        curve.v2.distanceTo(curve.v3) < 1e-6
      )
        throw new Error('Degenerate path tangent');
      if (index) {
        const previous = this.curves[index - 1],
          identity = segments[index - 1];
        if (previous.v3.distanceTo(curve.v0) > 0.00001)
          throw new Error('Disconnected path');
        if (previous.getTangent(1).dot(curve.getTangent(0)) < 0.99985)
          throw new Error('Discontinuous heading at path join');
        if (!sameSurface(identity, segment) && !segment.connectionFromPrevious)
          throw new Error('Missing explicit surface connection');
      }
      this.curves.push(curve);
      let previous = curve.getPoint(0);
      this.samples.push({ station, segment: index, t: 0 });
      for (let n = 1; n <= subdivisions; n++) {
        const t = n / subdivisions,
          point = curve.getPoint(t),
          length = point.distanceTo(previous);
        if (length < 1e-8) throw new Error('Degenerate curve interval');
        const tangent = curve.getTangent(t);
        if (
          ![tangent.x, tangent.y, tangent.z].every(Number.isFinite) ||
          Math.hypot(tangent.x, tangent.z) < 1e-4
        )
          throw new Error('Non-drivable tangent');
        station += length;
        this.samples.push({ station, segment: index, t });
        previous = point;
      }
    }
    this.length = station;
  }
  sample(stationM: number) {
    if (!Number.isFinite(stationM)) throw new Error('Invalid path station');
    const distance = THREE.MathUtils.clamp(stationM, 0, this.length);
    let low = 0,
      high = this.samples.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (this.samples[mid].station <= distance) low = mid;
      else high = mid;
    }
    let a = this.samples[low];
    const b = this.samples[high];
    // Repeated join sample belongs to the following curve, never interpolate across curves.
    if (a.segment !== b.segment) {
      a = b;
    }
    const t =
      b.station === a.station
        ? a.t
        : a.t +
          ((b.t - a.t) * (distance - a.station)) / (b.station - a.station);
    const curve = this.curves[a.segment],
      position = curve.getPoint(t),
      forward = curve.getTangent(t).normalize();
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), forward)
      .normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, forward),
    );
    return {
      position,
      rotation,
      forward,
      surfaceId: this.segments[a.segment].surfaceId,
      layer: this.segments[a.segment].layer,
      segmentId: this.segments[a.segment].segmentId,
    };
  }
  /** Each car samples independently. Caller must retain sufficient approach/exit path. */
  cars(headStationM: number, offsetsM: readonly number[]) {
    if (
      !offsetsM.every((v) => Number.isFinite(v) && v >= 0) ||
      !Number.isFinite(headStationM) ||
      offsetsM.some(
        (offset) =>
          headStationM - offset < 0 || headStationM - offset > this.length,
      )
    )
      throw new Error('Consist extends beyond validated path');
    return offsetsM.map((offset) => this.sample(headStationM - offset));
  }
}
/** Fixed rider stays in car-local coordinates through yaw, pitch and representation changes. */
export function riderWorldTransform(
  carPosition: THREE.Vector3,
  carRotation: THREE.Quaternion,
  localPosition: XYZ,
  localRotation: readonly [number, number, number, number],
) {
  if (
    ![
      ...carPosition.toArray(),
      ...carRotation.toArray(),
      ...localPosition,
      ...localRotation,
    ].every(Number.isFinite) ||
    Math.abs(carRotation.length() - 1) > 1e-5 ||
    Math.abs(Math.hypot(...localRotation) - 1) > 1e-5
  )
    throw new Error('Invalid rider transform');
  return {
    position: vector(localPosition)
      .applyQuaternion(carRotation)
      .add(carPosition),
    rotation: carRotation
      .clone()
      .multiply(new THREE.Quaternion(...localRotation)),
  };
}
