import type { Point } from './road-graph';

/** Subtract reviewed source-chainage windows without changing surviving XY. */
export function trimRoad(
  points: Point[],
  removed: readonly (readonly [number, number])[],
): Point[][] {
  if (!removed.length) return points.length > 1 ? [points] : [];
  const result: Point[][] = [];
  let current: Point[] = [],
    station = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-8) continue;
    const stops = [
      ...new Set([
        station,
        station + length,
        ...removed
          .flatMap((r) => [...r])
          .filter((s) => s > station && s < station + length),
      ]),
    ].sort((a, b) => a - b);
    const at = (s: number): Point =>
      s === station
        ? a
        : s === station + length
          ? b
          : [
              a[0] + ((b[0] - a[0]) * (s - station)) / length,
              a[1] + ((b[1] - a[1]) * (s - station)) / length,
            ];
    for (let j = 1; j < stops.length; j++) {
      const lo = stops[j - 1],
        hi = stops[j],
        mid = (lo + hi) / 2;
      if (removed.some(([start, end]) => mid >= start && mid <= end)) {
        if (current.length > 1) result.push(current);
        current = [];
      } else {
        if (!current.length) current.push(at(lo));
        current.push(at(hi));
      }
    }
    station += length;
  }
  if (current.length > 1) result.push(current);
  return result;
}
