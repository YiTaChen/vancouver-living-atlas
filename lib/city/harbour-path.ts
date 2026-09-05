import { project } from './geo';
export type HarbourKind = 'cruise' | 'seaplane' | 'helicopter';
export interface HarbourRouteData {
  id: string;
  kind: HarbourKind;
  name: string;
  coordinates: number[][];
  altitudesM: number[];
  displaySimplified: true;
}
export class HarbourPath {
  points: number[][];
  lengths: number[] = [0];
  times: number[] = [0];
  length = 0;
  duration = 0;
  constructor(public source: HarbourRouteData) {
    this.points = source.coordinates.map((p, i) => {
      const [x, z] = project(p);
      return [x, source.altitudesM[i], z];
    });
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1],
        b = this.points[i],
        length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const height = (a[1] + b[1]) / 2;
      const speed =
        source.kind === 'cruise'
          ? 6
          : source.kind === 'helicopter'
            ? Math.min(42, 5 + height * 0.6)
            : Math.min(48, 3.8 + height * 2.2 + i * 0.27);
      this.length += length;
      this.duration += length / speed;
      this.lengths.push(this.length);
      this.times.push(this.duration);
    }
  }
  sample(time: number) {
    const t = Math.max(0, Math.min(this.duration, time));
    let low = 0,
      high = this.times.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (this.times[mid] <= t) low = mid;
      else high = mid;
    }
    const i = Math.min(low, this.points.length - 2),
      a = this.points[i],
      b = this.points[i + 1],
      u = (t - this.times[i]) / (this.times[i + 1] - this.times[i] || 1);
    return {
      x: a[0] + (b[0] - a[0]) * u,
      y: a[1] + (b[1] - a[1]) * u,
      z: a[2] + (b[2] - a[2]) * u,
      yaw: Math.atan2(b[0] - a[0], b[2] - a[2]),
      pitch: Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2])),
      distance: this.lengths[i] + (this.lengths[i + 1] - this.lengths[i]) * u,
    };
  }
}
/** Far overview and sub-pixel craft are hidden; the player boat is independent. */
export function harbourVisible(
  length: number,
  distance: number,
  viewportHeight: number,
  fov: number,
  overviewDistance: number,
) {
  return (
    overviewDistance < 4400 &&
    (length * viewportHeight) /
      (2 * Math.tan((fov * Math.PI) / 360) * Math.max(1, distance)) >
      4.5
  );
}
