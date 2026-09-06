/** Original geometry based on the user's Lions Gate Bridge exterior reference.
 * Consume the actual mitered walkway sections, never resample triangle edges:
 * floating-point misses in that lookup used to drop complete railing panels.
 */
import type { GeometryResult, XYZ } from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { bridgeStation } from './walkway-attachments';
export const LIONS_WALK_SOURCES = new Set([70954668, 70954672]);
export function buildLionsRailings(
  paths: GeometryResult,
  segments: SurfaceSegment[],
  start: XZ,
  end: XZ,
) {
  const positions: number[] = [],
    spans: { side: string; s0: number; s1: number; a: XYZ; b: XYZ }[] = [];
  const quad = (a: XYZ, b: XYZ, c: XYZ, d: XYZ) =>
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const beam = (a: XYZ, b: XYZ, width: number, depth: number) => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      len = Math.hypot(dx, dz),
      nx = len > 1e-8 ? -dz / len : 1,
      nz = len > 1e-8 ? dx / len : 0;
    const corners = (p: XYZ): XYZ[] =>
      len > 1e-8
        ? [
            [
              p[0] - (nx * width) / 2,
              p[1] - depth / 2,
              p[2] - (nz * width) / 2,
            ],
            [
              p[0] + (nx * width) / 2,
              p[1] - depth / 2,
              p[2] + (nz * width) / 2,
            ],
            [
              p[0] + (nx * width) / 2,
              p[1] + depth / 2,
              p[2] + (nz * width) / 2,
            ],
            [
              p[0] - (nx * width) / 2,
              p[1] + depth / 2,
              p[2] - (nz * width) / 2,
            ],
          ]
        : [
            [p[0] - width / 2, p[1], p[2] - depth / 2],
            [p[0] + width / 2, p[1], p[2] - depth / 2],
            [p[0] + width / 2, p[1], p[2] + depth / 2],
            [p[0] - width / 2, p[1], p[2] + depth / 2],
          ];
    const p = corners(a),
      q = corners(b);
    for (let i = 0; i < 4; i++)
      quad(p[i], q[i], q[(i + 1) % 4], p[(i + 1) % 4]);
    quad(p[3], p[2], p[1], p[0]);
    quad(q[0], q[1], q[2], q[3]);
  };
  const lift = (p: XYZ, h: number): XYZ => [p[0], p[1] + h, p[2]];
  for (const source of LIONS_WALK_SOURCES) {
    const parts = segments.filter((s) => s.sourceId === source);
    if (!parts.length) continue;
    const lo = Math.min(...parts.map((s) => s.s0)),
      hi = Math.max(...parts.map((s) => s.s1)),
      route = parts[0].routeId;
    const sections = paths.sections
      .filter(
        (s) => s.routeId === route && s.s >= lo - 1e-5 && s.s <= hi + 1e-5,
      )
      .sort((a, b) => a.s - b.s);
    const edge = sections.map((s) => {
      const l = bridgeStation([s.outerLeft[0], s.outerLeft[2]], start, end),
        r = bridgeStation([s.outerRight[0], s.outerRight[2]], start, end);
      // Choose the edge away from the road. Inner edge already has a concrete barrier.
      const p =
        Math.abs(l.offsetEastM) > Math.abs(r.offsetEastM)
          ? s.outerLeft
          : s.outerRight;
      return { s: s.s, p, station: bridgeStation([p[0], p[2]], start, end).s };
    });
    for (let i = 1; i < edge.length; i++) {
      const a = edge[i - 1],
        b = edge[i];
      if (b.s - a.s < 1e-7) continue;
      const cuts = [0, 1];
      // Preserve tower openings on the west side, but trim exactly at their
      // boundaries instead of rejecting neighbouring panels in their entirety.
      if (source === 70954672)
        for (const t of [184, 190, 656, 662]) {
          const f = (t - a.station) / (b.station - a.station);
          if (f > 0 && f < 1) cuts.push(f);
        }
      cuts.sort((a, b) => a - b);
      const at = (t: number): XYZ =>
        a.p.map((v, k) => v + (b.p[k] - v) * t) as unknown as XYZ;
      for (let j = 1; j < cuts.length; j++) {
        const t0 = cuts[j - 1],
          t1 = cuts[j],
          mid = a.station + ((b.station - a.station) * (t0 + t1)) / 2;
        if (
          source === 70954672 &&
          ((mid > 184 && mid < 190) || (mid > 656 && mid < 662))
        )
          continue;
        const p = at(t0),
          q = at(t1),
          s0 = a.s + (b.s - a.s) * t0,
          s1 = a.s + (b.s - a.s) * t1;
        spans.push({
          side: source === 70954668 ? 'east' : 'west',
          s0,
          s1,
          a: p,
          b: q,
        });
        beam(lift(p, 1.16), lift(q, 1.16), 0.095, 0.09);
        beam(lift(p, 0.14), lift(q, 0.14), 0.065, 0.065);
        for (
          let s = Math.ceil((s0 - 1e-7) / 0.16) * 0.16;
          s < s1 - 1e-7;
          s += 0.16
        ) {
          const v = at((s - a.s) / (b.s - a.s));
          beam(lift(v, 0.16), lift(v, 1.13), 0.025, 0.025);
        }
        for (
          let s = Math.ceil((s0 - 1e-7) / 2.4) * 2.4;
          s < s1 - 1e-7;
          s += 2.4
        ) {
          const v = at((s - a.s) / (b.s - a.s));
          beam(lift(v, -0.02), lift(v, 1.21), 0.105, 0.105);
        }
      }
    }
  }
  return { positions, spans };
}
