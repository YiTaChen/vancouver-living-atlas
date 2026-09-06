/** Original entry/vent interfaces for the existing Convention Centre envelope.
 * Current podium top is local 0.8m; no new plaza or habitat skirt is generated. */
import * as THREE from 'three';
import type { Point3 } from './facade-surface';
export type ConventionSurfaceOptions = {
  resolvedEntries?: ConventionEntry[];
  actualSurface?: (x: number, z: number) => number | null | undefined;
};
export type ConventionEdge = {
  roofIndex: number;
  edgeIndex: number;
  length: number;
  outwardX: number;
  outwardZ: number;
  at: (t: number, y: number) => Point3;
  roofY: (t: number) => number;
};
export type ConventionEntry = {
  left: number;
  right: number;
  threshold: number;
  head: number;
  depth: number;
  roofIndex: number;
  edgeIndex: number;
  status: 'model-podium' | 'selected-rendered-surface';
};
export type ConventionSink = {
  detail: boolean;
  triangle: (
    key: string,
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
  ) => void;
};
const YAW = -0.403;
export function conventionEntryPoint(
  edge: ConventionEdge,
  e: ConventionEntry,
  t: number,
  y: number,
  depth = e.depth,
): Point3 {
  const base = edge.at(t, e.threshold);
  return [base[0] - edge.outwardX * depth, y, base[2] - edge.outwardZ * depth];
}
export function planConventionEntries(
  edge: ConventionEdge,
  options: ConventionSurfaceOptions = {},
) {
  const entries: ConventionEntry[] = [],
    rejected: { station: number; reason: string }[] = [],
    worldNormalX =
      Math.cos(YAW) * edge.outwardX + Math.sin(YAW) * edge.outwardZ;
  // Source LMN identifies the west facade's operable door/window system. These
  // two interpreted stations are not a survey of named entrances or retail units.
  if (
    edge.length < 35 ||
    worldNormalX > -0.45 ||
    Math.min(edge.roofY(0), edge.roofY(1)) < 6.5
  )
    return { entries, rejected };
  const columns = Math.floor(edge.length / 10.5),
    stations = [0.33, 0.67].map(
      (t) =>
        (Math.min(columns, Math.max(0, Math.floor(t * (columns + 1)))) + 0.5) /
        (columns + 1),
    );
  for (const station of [...new Set(stations)]) {
    const half = 1.3 / edge.length,
      left = station - half,
      right = station + half;
    let threshold = 0.82,
      reason = '';
    if (options.actualSurface) {
      const heights: number[] = [];
      for (const t of [
        left + 0.04 / edge.length,
        station,
        right - 0.04 / edge.length,
      ])
        for (const d of [-0.025, 0.85]) {
          const q = edge.at(t, 0.9),
            h = options.actualSurface(
              q[0] - edge.outwardX * d,
              q[2] - edge.outwardZ * d,
            );
          if (h === null || h === undefined || !Number.isFinite(h)) {
            reason = 'Missing selected podium/terrain surface';
            break;
          }
          heights.push(h);
        }
      if (!reason && Math.max(...heights) - Math.min(...heights) > 0.18)
        reason = 'Door/recess surface relief exceeds 18cm';
      if (!reason) threshold = Math.max(...heights) + 0.02;
    }
    // Keep clear of the existing localY5.3 floor slab and original ground storey.
    const head = Math.min(
      threshold + 2.6,
      4.8,
      edge.roofY(left) - 1,
      edge.roofY(right) - 1,
    );
    if (!reason && (threshold < 0.8 || head - threshold < 2.25))
      reason = 'Insufficient retained podium-storey clearance';
    if (reason) {
      rejected.push({ station, reason });
      continue;
    }
    entries.push({
      left,
      right,
      threshold,
      head,
      depth: 0.85,
      roofIndex: edge.roofIndex,
      edgeIndex: edge.edgeIndex,
      status: options.actualSurface
        ? 'selected-rendered-surface'
        : 'model-podium',
    });
  }
  return { entries, rejected };
}
/** Split a ground glass quad around accepted apertures. Existing glazing above
 * and beside the doors remains, even when a door spans two old LOD bay widths. */
export function conventionGlassPieces(
  left: number,
  right: number,
  low: number,
  high: number,
  entries: readonly ConventionEntry[],
) {
  const cuts = [
      left,
      right,
      ...entries
        .flatMap((e) => [e.left, e.right])
        .filter((t) => t > left && t < right),
    ].sort((a, b) => a - b),
    pieces: { left: number; right: number; low: number; high: number }[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1],
      b = cuts[i];
    if (b - a < 1e-10) continue;
    const mid = (a + b) / 2,
      e = entries.find((e) => mid > e.left - 1e-10 && mid < e.right + 1e-10);
    if (!e) pieces.push({ left: a, right: b, low, high });
    else {
      if (e.threshold > low)
        pieces.push({
          left: a,
          right: b,
          low,
          high: Math.min(e.threshold, high),
        });
      if (e.head < high)
        pieces.push({ left: a, right: b, low: Math.max(low, e.head), high });
    }
  }
  return pieces.filter((p) => p.high - p.low > 0.00001);
}
/** Remove the old front mullion only inside the accepted doorway height band. */
export function conventionMullionPieces(
  t: number,
  low: number,
  high: number,
  entries: readonly ConventionEntry[],
) {
  const e = entries.find((e) => t > e.left + 1e-7 && t < e.right - 1e-7);
  if (!e) return [[low, high]] as [number, number][];
  return [
    [low, Math.min(high, e.threshold)],
    [Math.max(low, e.head), high],
  ].filter((p) => p[1] - p[0] > 0.001) as [number, number][];
}
function quad(
  m: ConventionSink,
  key: string,
  a: Point3,
  b: Point3,
  c: Point3,
  d: Point3,
  normal: Point3,
) {
  const n = new THREE.Vector3(...b)
    .sub(new THREE.Vector3(...a))
    .cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a)));
  if (n.dot(new THREE.Vector3(...normal)) < 0) {
    [a, d] = [d, a];
    [b, c] = [c, b];
  }
  m.triangle(key, [...a], [...b], [...c]);
  m.triangle(key, [...a], [...c], [...d]);
}
export function drawConventionInterfaces(
  m: ConventionSink,
  edge: ConventionEdge,
  entries: readonly ConventionEntry[],
) {
  const normal: Point3 = [edge.outwardX, 0, edge.outwardZ],
    at = edge.at;
  for (const e of entries) {
    const { left: l, right: r, threshold: b, head: h } = e,
      p = (t: number, y: number, d = e.depth) =>
        conventionEntryPoint(edge, e, t, y, d),
      mid = (l + r) / 2,
      frontLeft = at(l, b),
      frontRight = at(r, b),
      tangent = new THREE.Vector3(...frontRight)
        .sub(new THREE.Vector3(...frontLeft))
        .normalize(),
      t: Point3 = [tangent.x, 0, tangent.z];
    quad(m, 'metal', frontLeft, p(l, b), p(l, h), at(l, h), t);
    quad(m, 'metal', p(r, b), frontRight, at(r, h), p(r, h), [-t[0], 0, -t[2]]);
    quad(m, 'wood-shadow', at(l, h), p(l, h), p(r, h), at(r, h), [0, -1, 0]);
    quad(m, 'concrete', frontLeft, frontRight, p(r, b), p(l, b), [0, 1, 0]);
    quad(m, 'glass-grey', p(l, b), p(r, b), p(r, h), p(l, h), normal);
    const frame = 0.045 / edge.length;
    for (const [a, z, y0, y1] of [
      [l, l + frame, b, h],
      [r - frame, r, b, h],
      [mid - frame / 2, mid + frame / 2, b, h],
      [l, r, b, b + 0.06],
      [l, r, h - 0.06, h],
    ])
      quad(
        m,
        'metal',
        p(a, y0, 0.8),
        p(z, y0, 0.8),
        p(z, y1, 0.8),
        p(a, y1, 0.8),
        normal,
      );
    // Two full-scale leaves with shallow crash rails, not a rendered interior.
    quad(
      m,
      'metal',
      p(l, b + 1.0, 0.78),
      p(r, b + 1.0, 0.78),
      p(r, b + 1.045, 0.78),
      p(l, b + 1.045, 0.78),
      normal,
    );
    if (m.detail)
      for (const t of [mid - 0.13 / edge.length, mid + 0.13 / edge.length])
        quad(
          m,
          'metal',
          p(t - frame / 2, b + 0.95, 0.745),
          p(t + frame / 2, b + 0.95, 0.745),
          p(t + frame / 2, b + 1.3, 0.745),
          p(t - frame / 2, b + 1.3, 0.745),
          normal,
        );
  }
  // Low-cost soffit damper interfaces only on the westward exposed facade.
  if (Math.cos(YAW) * edge.outwardX + Math.sin(YAW) * edge.outwardZ > -0.45)
    return;
  const vents = Math.floor(edge.length / 12);
  for (let i = 0; i < vents; i++) {
    const mid = (i + 0.5) / vents,
      half = 1.25 / edge.length,
      a = mid - half,
      b = mid + half;
    const p = (t: number, inset: number, drop = 0): Point3 => {
      const q = at(t, 0.9);
      return [
        q[0] + edge.outwardX * (4.2 - inset),
        edge.roofY(t) - 0.89 - drop,
        q[2] + edge.outwardZ * (4.2 - inset),
      ];
    };
    quad(m, 'metal', p(a, 3.0), p(a, 3.4), p(b, 3.4), p(b, 3.0), [0, -1, 0]);
    if (m.detail)
      for (const inset of [3.05, 3.16, 3.27])
        quad(
          m,
          'wood',
          p(a, inset, 0.015),
          p(a, inset + 0.045, 0.015),
          p(b, inset + 0.045, 0.015),
          p(b, inset, 0.015),
          [0, -1, 0],
        );
  }
}
