import * as THREE from 'three';
import { project } from './geo';

export type TrainKind = 'steam' | 'skytrain';
export interface RailRouteData {
  id: string;
  kind: TrainKind;
  name: string;
  coordinates: number[][];
  sourceIds: number[];
  clearance: number;
  speed: number;
}

/** A single open alignment: every axle and both rails use this same metre scale. */
export class RailPath {
  points: THREE.Vector3[];
  distances: number[] = [0];
  length = 0;
  constructor(points: THREE.Vector3[]) {
    this.points = points.filter(
      (p, i) => i === 0 || p.distanceTo(points[i - 1]) > 0.001,
    );
    if (this.points.length < 2)
      throw new Error('Rail alignment needs two distinct points');
    for (let i = 1; i < this.points.length; i++) {
      this.length += this.points[i].distanceTo(this.points[i - 1]);
      this.distances.push(this.length);
    }
  }
  sample(distance: number, out = new THREE.Vector3()) {
    const d = THREE.MathUtils.clamp(distance, 0, this.length);
    let low = 0,
      high = this.distances.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (this.distances[mid] <= d) low = mid;
      else high = mid;
    }
    return out.lerpVectors(
      this.points[low],
      this.points[high],
      (d - this.distances[low]) / (this.distances[high] - this.distances[low]),
    );
  }
}

export function makeRailPath(
  route: RailRouteData,
  elevation: (x: number, z: number) => number,
) {
  const source = route.coordinates.map((c) => {
    const [x, z] = project(c);
    return new THREE.Vector3(x, 0, z);
  });
  const curve = new THREE.CatmullRomCurve3(source, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(600, source.length * 12);
  const groundPath = new RailPath(source);
  const count = Math.ceil(groundPath.length / 3);
  // Waterfront has a narrow mapped corridor beside buildings: retain its
  // exact segments. Densely surveyed SkyTrain nodes allow gentle interpolation.
  const points =
    route.kind === 'steam'
      ? Array.from({ length: count + 1 }, (_, i) =>
          groundPath.sample((i * groundPath.length) / count),
        )
      : curve.getSpacedPoints(Math.ceil(curve.getLength() / 3));
  for (const p of points) p.y = elevation(p.x, p.z) + route.clearance + 0.65;
  // The terrain grid contains road/shore interpolation noise. Raise low samples
  // to a gentle rail grade, never bury a rail under the existing terrain.
  const grade = route.kind === 'steam' ? 0.025 : 0.055;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].z - points[i - 1].z,
    );
    points[i].y = Math.max(points[i].y, points[i - 1].y - d * grade);
  }
  for (let i = points.length - 2; i >= 0; i--) {
    const d = Math.hypot(
      points[i].x - points[i + 1].x,
      points[i].z - points[i + 1].z,
    );
    points[i].y = Math.max(points[i].y, points[i + 1].y - d * grade);
  }
  return new RailPath(points);
}

export function carriageOpacity(
  distance: number,
  length: number,
  halfLength: number,
) {
  return (
    THREE.MathUtils.smoothstep(distance, halfLength, halfLength + 24) *
    (1 -
      THREE.MathUtils.smoothstep(
        distance,
        length - halfLength - 24,
        length - halfLength,
      ))
  );
}

/** Cars never wrap separately: the whole consist exits before a new pass starts. */
export function trainHeadDistance(
  elapsed: number,
  speed: number,
  length: number,
  consistLength: number,
  phase: number,
) {
  const span = length + consistLength + 100;
  return ((((elapsed * speed + phase * span) % span) + span) % span) - 40;
}
