import type { Coord, Feature } from './types';
export const ORIGIN: Coord = [-123.128, 49.286];
export const MX = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180),
  MZ = 111320;
export function project(c: number[]): [number, number] {
  return [(c[0] - ORIGIN[0]) * MX, -(c[1] - ORIGIN[1]) * MZ];
}
export function unproject(x: number, z: number): Coord {
  return [x / MX + ORIGIN[0], ORIGIN[1] - z / MZ];
}
export function rings(f: Feature): number[][][][] {
  return f.geometry.type === 'MultiPolygon'
    ? f.geometry.coordinates
    : [f.geometry.coordinates];
}
export function lines(f: Feature): number[][][] {
  return f.geometry.type === 'MultiLineString'
    ? f.geometry.coordinates
    : [f.geometry.coordinates];
}
interface RingIndex {
  xmin: number;
  xmax: number;
  zmin: number;
  zmax: number;
  step: number;
  buckets: number[][];
}
const indexCache = new WeakMap<number[][], RingIndex>();
function ringIndex(r: number[][]): RingIndex {
  const cached = indexCache.get(r);
  if (cached) return cached;
  let xmin = Infinity,
    xmax = -Infinity,
    zmin = Infinity,
    zmax = -Infinity;
  for (const p of r) {
    xmin = Math.min(xmin, p[0]);
    xmax = Math.max(xmax, p[0]);
    zmin = Math.min(zmin, p[1]);
    zmax = Math.max(zmax, p[1]);
  }
  const step = 64,
    buckets: number[][] = Array.from(
      { length: Math.max(1, Math.floor((zmax - zmin) / step) + 1) },
      () => [],
    );
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      b = r[j];
    if (a[1] === b[1]) continue;
    const lo = Math.floor((Math.min(a[1], b[1]) - zmin) / step),
      hi = Math.floor((Math.max(a[1], b[1]) - zmin) / step);
    for (let k = lo; k <= hi; k++) buckets[k].push(i, j);
  }
  const result = { xmin, xmax, zmin, zmax, step, buckets };
  indexCache.set(r, result);
  return result;
}
// Exact ray crossing with horizontal edge buckets. No shoreline simplification.
export function inside(p: number[], r: number[][]) {
  if (!r.length) return false;
  const v = ringIndex(r);
  if (p[0] < v.xmin || p[0] > v.xmax || p[1] < v.zmin || p[1] > v.zmax)
    return false;
  const candidates = v.buckets[Math.floor((p[1] - v.zmin) / v.step)] || [];
  let result = false;
  for (let k = 0; k < candidates.length; k += 2) {
    const a = r[candidates[k]],
      b = r[candidates[k + 1]];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
export function inPolygon(p: number[], poly: number[][][]) {
  return inside(p, poly[0]) && !poly.slice(1).some((r) => inside(p, r));
}
export function hash(n: number) {
  const a = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return a - Math.floor(a);
}
