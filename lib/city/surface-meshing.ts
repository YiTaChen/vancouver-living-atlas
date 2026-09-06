import type { Point } from './road-graph';
export type HeightField = (x: number, z: number) => number;

/** A single piecewise-planar relief field. Its fixed SW/NE diagonal is shared by
 * asphalt, sidewalk, paint and curb geometry, including T-junction vertices. */
export function gridHeightField(raw: HeightField, cell = 12): HeightField {
  const cache = new Map<string, number>();
  const vertex = (x: number, z: number) => {
    const key = `${x},${z}`;
    if (!cache.has(key)) cache.set(key, raw(x * cell, z * cell));
    return cache.get(key)!;
  };
  return (x, z) => {
    const gx = Math.floor(x / cell),
      gz = Math.floor(z / cell),
      u = x / cell - gx,
      v = z / cell - gz,
      a = vertex(gx, gz),
      d = vertex(gx + 1, gz + 1);
    if (u >= v) {
      const b = vertex(gx + 1, gz);
      return a + (b - a) * u + (d - b) * v;
    }
    const c = vertex(gx, gz + 1);
    return a + (d - c) * u + (c - a) * v;
  };
}
function clip(poly: Point[], signedDistance: (p: Point) => number) {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = signedDistance(a),
      db = signedDistance(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
/** height must be the shared gridHeightField (plus a constant surface offset).
 * Clipping to both half-cells prevents curved-height cracks and floating paint. */
export function drapeTriangles(
  vertices: readonly Point[],
  indices: readonly number[],
  height: HeightField,
  cell = 12,
) {
  if (!(cell > 0 && Number.isFinite(cell)))
    throw new Error('Invalid surface grid');
  const positions: number[] = [],
    uv: number[] = [];
  for (let n = 0; n < indices.length; n += 3) {
    const tri = indices.slice(n, n + 3).map((i) => vertices[i]);
    const x0 = Math.floor(Math.min(...tri.map((p) => p[0])) / cell),
      x1 = Math.floor(Math.max(...tri.map((p) => p[0])) / cell),
      z0 = Math.floor(Math.min(...tri.map((p) => p[1])) / cell),
      z1 = Math.floor(Math.max(...tri.map((p) => p[1])) / cell);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 200000)
      throw new Error('Surface triangle exceeds grid budget');
    for (let x = x0; x <= x1; x++) {
      const strip = clip(
        clip(tri, (p) => p[0] - x * cell),
        (p) => (x + 1) * cell - p[0],
      );
      if (strip.length < 3) continue;
      for (let z = z0; z <= z1; z++) {
        const square = clip(
          clip(strip, (p) => p[1] - z * cell),
          (p) => (z + 1) * cell - p[1],
        );
        for (const side of [-1, 1]) {
          const p = clip(
            square,
            (p) => side * (p[0] - x * cell - (p[1] - z * cell)),
          );
          for (let i = 1; i < p.length - 1; i++) {
            const a = p[0],
              b = p[i],
              c = p[i + 1],
              area =
                (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if (Math.abs(area) < 1e-6) continue;
            for (const q of area > 0 ? [a, c, b] : [a, b, c]) {
              const y = height(q[0], q[1]);
              if (!Number.isFinite(y))
                throw new Error('Non-finite surface height');
              positions.push(q[0], y, q[1]);
              uv.push(q[0] / 3, q[1] / 3);
            }
          }
        }
      }
    }
    if (positions.length > 12e6)
      throw new Error('Draped surface exceeds vertex budget');
  }
  return { positions, uv };
}
/** A polyline with vertices on every cell edge and fixed grid diagonal it crosses. */
export function splitGridLine(a: Point, b: Point, cell = 12): Point[] {
  const cuts = [0, 1],
    dx = b[0] - a[0],
    dz = b[1] - a[1];
  for (const [origin, delta] of [
    [a[0], dx],
    [a[1], dz],
    [a[0] - a[1], dx - dz],
  ]) {
    if (Math.abs(delta) < 1e-9) continue;
    for (
      let k = Math.ceil(Math.min(origin, origin + delta) / cell);
      k <= Math.floor(Math.max(origin, origin + delta) / cell);
      k++
    ) {
      const t = (k * cell - origin) / delta;
      if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  return cuts
    .filter((t, i) => i === 0 || t - cuts[i - 1] > 1e-8)
    .map((t) => [a[0] + dx * t, a[1] + dz * t]);
}
