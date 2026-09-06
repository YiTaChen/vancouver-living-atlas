import { BeachSurfaceIndex, type BeachFixture } from './beach-surface';
import type { FeatureCollection } from './types';

export interface BeachCoastData {
  version: number;
  sourceHashes: Record<string, string>;
  land: FeatureCollection;
  fixtures: BeachFixture;
  replaceTriangles: string[];
  outsidePositions: number[];
  /** Final physical terrain Y, shared by rendering, elevation and draft tests. */
  profilePositions: number[];
  groundObstacleFootprints: number[][][][];
  replacementPathIds: number[];
  pathPositions: number[];
  shoreline: FeatureCollection;
  beachOverlays: FeatureCollection;
  statistics: Record<string, number>;
}
type P = readonly [number, number];
interface Tri {
  p: number[];
  inv: number;
  maxY: number;
}
const cross = (a: P, b: P, c: P) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const pointDistance2 = (p: P, a: P, b: P) => {
  const x = b[0] - a[0],
    z = b[1] - a[1],
    n = x * x + z * z;
  const t = n
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / n))
    : 0;
  return (p[0] - a[0] - t * x) ** 2 + (p[1] - a[1] - t * z) ** 2;
};
const edgeDistance2 = (a: P, b: P, c: P, d: P) => {
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    pointDistance2(a, c, d),
    pointDistance2(b, c, d),
    pointDistance2(c, a, b),
    pointDistance2(d, a, b),
  );
};
function barycentric(x: number, z: number, t: Tri) {
  const p = t.p,
    dx = x - p[0],
    dz = z - p[2];
  const u = (dx * (p[8] - p[2]) - dz * (p[6] - p[0])) * t.inv;
  const v = ((p[3] - p[0]) * dz - (p[5] - p[2]) * dx) * t.inv;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7 ? [u, v] : undefined;
}

/** Static local geometry index. The final piecewise planar height is the
 * renderer's actual surface, not a second independently sampled terrain. */
export class BeachGround {
  readonly surface: BeachSurfaceIndex;
  readonly replacements: Set<string>;
  private cells = new Map<string, Tri[]>();
  private bounds: [number, number, number, number][];
  constructor(readonly data: BeachCoastData) {
    this.surface = new BeachSurfaceIndex(data.fixtures);
    this.replacements = new Set(data.replaceTriangles);
    this.bounds = data.fixtures.beaches.map((b) => {
      const pts = b.profilePolygons.flat(2);
      return [
        Math.min(...pts.map((p) => p[0])),
        Math.min(...pts.map((p) => p[1])),
        Math.max(...pts.map((p) => p[0])),
        Math.max(...pts.map((p) => p[1])),
      ];
    });
    if (data.profilePositions.length % 9)
      throw new Error('Incomplete beach ground');
    for (let i = 0; i < data.profilePositions.length; i += 9) {
      const p = data.profilePositions.slice(i, i + 9);
      if (!p.every(Number.isFinite)) throw new Error('Non-finite beach ground');
      const area =
        (p[3] - p[0]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[6] - p[0]);
      if (Math.abs(area) < 1e-10) continue;
      const tri = { p, inv: 1 / area, maxY: Math.max(p[1], p[4], p[7]) };
      for (
        let x = Math.floor(Math.min(p[0], p[3], p[6]) / 16);
        x <= Math.floor(Math.max(p[0], p[3], p[6]) / 16);
        x++
      )
        for (
          let z = Math.floor(Math.min(p[2], p[5], p[8]) / 16);
          z <= Math.floor(Math.max(p[2], p[5], p[8]) / 16);
          z++
        ) {
          const key = `${x},${z}`,
            cell = this.cells.get(key) || [];
          cell.push(tri);
          this.cells.set(key, cell);
        }
    }
  }
  near(x: number, z: number, pad = 0) {
    pad += 0.001;
    return this.bounds.some(
      (b) =>
        x >= b[0] - pad &&
        x <= b[2] + pad &&
        z >= b[1] - pad &&
        z <= b[3] + pad,
    );
  }
  height(x: number, z: number): number | undefined {
    if (!this.near(x, z)) return undefined;
    for (const t of this.cells.get(
      `${Math.floor(x / 16)},${Math.floor(z / 16)}`,
    ) || []) {
      const uv = barycentric(x, z, t);
      if (uv)
        return t.p[1] + uv[0] * (t.p[4] - t.p[1]) + uv[1] * (t.p[7] - t.p[1]);
    }
    return undefined;
  }
  /** Conservative full-capsule draft test against every intersecting rendered
   * triangle. Highest vertex bounds that triangle's entire linear surface.
   * A 4m grid can stop a hull up to one triangle early; it never misses shallow
   * terrain between a handful of point probes. Coast edges still use WaterWorld. */
  allowsHull(
    x: number,
    z: number,
    yaw: number,
    halfLength: number,
    radius: number,
    draft = 0.6,
    clearance = 0.2,
  ) {
    if (
      ![x, z, yaw, halfLength, radius, draft, clearance].every(
        Number.isFinite,
      ) ||
      halfLength < 0 ||
      radius < 0 ||
      draft < 0 ||
      clearance < 0
    )
      return false;
    if (!this.near(x, z, halfLength + radius)) return true;
    const inner = Math.max(0, halfLength - radius),
      dx = Math.sin(yaw) * inner,
      dz = Math.cos(yaw) * inner;
    const a: P = [x - dx, z - dz],
      b: P = [x + dx, z + dz],
      r2 = radius * radius,
      seen = new Set<Tri>(),
      ceiling = this.data.fixtures.seaLevel - draft - clearance;
    for (
      let gx = Math.floor((x - halfLength - radius) / 16);
      gx <= Math.floor((x + halfLength + radius) / 16);
      gx++
    )
      for (
        let gz = Math.floor((z - halfLength - radius) / 16);
        gz <= Math.floor((z + halfLength + radius) / 16);
        gz++
      )
        for (const t of this.cells.get(`${gx},${gz}`) || []) {
          if (seen.has(t)) continue;
          seen.add(t);
          if (t.maxY <= ceiling) continue;
          const p: P[] = [
            [t.p[0], t.p[2]],
            [t.p[3], t.p[5]],
            [t.p[6], t.p[8]],
          ];
          if (
            barycentric(...a, t) ||
            barycentric(...b, t) ||
            p.some((q, i) => edgeDistance2(a, b, q, p[(i + 1) % 3]) <= r2)
          )
            return false;
        }
    return true;
  }
}
