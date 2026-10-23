import * as THREE from 'three';
import { project } from './geo';

/** Existing City/OSM reconciled rock islands, public/data/beach-coast.json.
 * These identify the two complete source rings; mainland coast, beach profiles
 * and open shoreline fragments never enter this local rendering correction. */
export const SIWASH_CLOSED_ROCK_ISLANDS = [
  {
    vertices: 27,
    areaM2: 107.88158983,
    centre: [-123.1560181124, 49.3087515252],
  },
  {
    vertices: 15,
    areaM2: 25.13270404,
    centre: [-123.1559010683, 49.3087405536],
  },
] as const;

/** Local source coast surrounding Siwash and its mapped lookout. Whole source
 * segments outside this window retain their original construction byte-for-byte.
 * No boundary clipping, shoreline relocation or region-wide change is applied. */
export const SIWASH_MAINLAND_SHORE_WINDOW = {
  minLon: -123.15645,
  maxLon: -123.1549,
  minLat: 49.3079,
  maxLat: 49.30915,
} as const;

/** At the steep mainland edge the old +/-4.5m segment ribbons also made radial
 * fingers, stretching onto water at every sharp source vertex. A source-edge
 * skirt has no horizontal expansion or new walkable offshore surface. Adjacent
 * faces share the same finite elevation at their actual common endpoint. */
export function createSiwashMainlandSkirtPositions(
  a: readonly number[],
  b: readonly number[],
  elevation: (x: number, z: number) => number,
): number[] | null {
  const w = SIWASH_MAINLAND_SHORE_WINDOW;
  const inside = (point: readonly number[]) =>
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= w.minLon &&
    point[0] <= w.maxLon &&
    point[1] >= w.minLat &&
    point[1] <= w.maxLat;
  if (!inside(a) || !inside(b)) return null;
  const pa = project(a),
    pb = project(b);
  if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.1) return null;
  const top = ([x, z]: readonly number[]) => {
    const y = Math.max(0.7, elevation(x, z)) + 1.15;
    if (!Number.isFinite(y)) throw new Error('Invalid source shoreline height');
    return [x, y, z];
  };
  const ta = top(pa),
    tb = top(pb),
    ba = [pa[0], 0.1, pa[1]],
    bb = [pb[0], 0.1, pb[1]];
  return [...ta, ...ba, ...bb, ...ta, ...bb, ...tb];
}

/** A nine-metre-wide strip around metre-scale closed rocks produces overlapping
 * radial spokes over water. Replace only these two existing island perimeters
 * with their exact triangulated rock footprint and a short sea-facing side.
 * No geographic inputs, land/water classification or route data are modified.
 * Positions merge into the existing opaque rock batch, without another draw.
 */
export function createSiwashClosedRockPositions(
  line: readonly (readonly number[])[],
  elevation: (x: number, z: number) => number,
): number[] | null {
  if (![15, 27].includes(line.length)) return null;
  const first = line[0],
    last = line[line.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1])
    return null;
  if (line.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    return null;
  // Reject distant rings before allocating vectors or testing their topology.
  if (
    line.some(
      (p) =>
        p[0] < -123.15612 ||
        p[0] > -123.15585 ||
        p[1] < 49.30869 ||
        p[1] > 49.30881,
    )
  )
    return null;
  const points = line.slice(0, -1).map(project),
    origin = points[0];
  let twiceArea = 0,
    cx = 0,
    cz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      ax = a[0] - origin[0],
      az = a[1] - origin[1],
      bx = b[0] - origin[0],
      bz = b[1] - origin[1],
      cross = ax * bz - bx * az;
    twiceArea += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) return null;
  cx = origin[0] + cx / (3 * twiceArea);
  cz = origin[1] + cz / (3 * twiceArea);
  const adopted = SIWASH_CLOSED_ROCK_ISLANDS.some((island) => {
    const centre = project(island.centre);
    return (
      island.vertices === line.length &&
      Math.abs(Math.abs(twiceArea) / 2 - island.areaM2) < 0.02 &&
      Math.hypot(cx - centre[0], cz - centre[1]) < 0.1
    );
  });
  if (!adopted) return null;

  const top = points.map(([x, z]) => {
      const y = Math.max(0.7, elevation(x, z)) + 1.15;
      if (!Number.isFinite(y))
        throw new Error('Invalid source rock island height');
      return [x, y, z] as const;
    }),
    positions: number[] = [],
    outline = points.map((p) => new THREE.Vector2(...p));
  for (const triangle of THREE.ShapeUtils.triangulateShape(outline, [])) {
    const [a, b, c] = triangle.map((index) => points[index]),
      cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // Clockwise XZ winding faces upward in the city's Y-up coordinates.
    const order =
      cross > 0 ? [triangle[0], triangle[2], triangle[1]] : triangle;
    for (const index of order) positions.push(...top[index]);
  }
  for (let i = 0; i < top.length; i++) {
    const a = top[i],
      b = top[(i + 1) % top.length],
      bottomA = [a[0], 0.1, a[2]],
      bottomB = [b[0], 0.1, b[2]];
    const face =
      twiceArea < 0
        ? [a, bottomA, bottomB, a, bottomB, b]
        : [a, bottomB, bottomA, a, b, bottomB];
    for (const point of face) positions.push(...point);
  }
  return positions;
}
