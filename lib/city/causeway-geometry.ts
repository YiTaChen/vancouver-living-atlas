import { orderedBounds } from './ordered-bounds';
/** Original MIT. Pure position arrays; no Three, DOM, renderer or terrain mutation.
 * Source centerline XY and baked final asphalt Y remain the anchors.
 */
import type { SurfaceSegment, XZ } from './causeway-profile';
export type XYZ = readonly [number, number, number];
export type BufferKind =
  | 'asphalt'
  | 'shoulder'
  | 'curb'
  | 'slab'
  | 'retaining'
  | 'paintWhite'
  | 'paintYellow'
  | 'rails';
export interface Identity {
  routeId: string;
  surfaceId: string;
  layer: number;
  sourceId: number;
}
export interface TopTriangle {
  buffer: 'asphalt' | 'shoulder';
  offset: number;
  identities: Identity[];
  s0: number;
  s1: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  role: 'road' | 'shoulder' | 'junction';
  inputIndex: number;
}
export interface GroundPolygon {
  outer: readonly XZ[];
  holes?: readonly (readonly XZ[])[];
}
export interface GeometryOptions {
  groundRoadTop?: (x: number, z: number) => number;
  groundElevation?: (x: number, z: number) => number;
  tapers?: readonly { routeId: string; startM?: number; endM?: number }[];
  bridgeSourceIds?: ReadonlySet<number>;
  retainingRouteIds?: ReadonlySet<string>;
  noFill?: readonly GroundPolygon[];
  shoulderWidthM?: number;
  shoulderRiseM?: number;
  slabDepthM?: number;
  miterLimit?: number;
  seamGridM?: number;
  rails?: boolean;
  paint?: boolean;
  /** Disable endpoint fans when the parent provides its own junction mesh. */
  junctionFills?: boolean;
  allowedModes?: (
    identity: Identity,
    kind: 'road' | 'shoulder',
  ) => readonly ('walk' | 'drive')[];
  railAllowed?: (identity: Identity, x: number, z: number) => boolean;
}
export interface GeometryResult {
  buffers: Record<BufferKind, number[]>;
  topTriangles: TopTriangle[];
  sections: Section[];
  perSegment: {
    inputIndex: number;
    segment: SurfaceSegment;
    asphalt: number[];
    shoulder: number[];
    topTriangleIndices: number[];
  }[];
  surfaces: {
    triangles: number[];
    surfaceId: string;
    layer: number;
    routeId: string;
    sourceId: number;
    inputIndex: number;
    kind: 'road' | 'shoulder';
    allowedModes: readonly ('walk' | 'drive')[];
  }[];
  stats: {
    inputSegments: number;
    topTriangles: number;
    triangles: number;
    gapFills: number;
    noFillWallSplits: number;
  };
}
interface V {
  x: number;
  z: number;
  cx: number;
  cz: number;
  h: number;
  s: number;
}
export interface Section {
  routeId: string;
  s: number;
  center: XYZ;
  left: XYZ;
  right: XYZ;
  outerLeft: XYZ;
  outerRight: XYZ;
}
interface Piece {
  segment: SurfaceSegment;
  a: V[];
  b: V[];
}
interface PlanTri {
  p: V[];
  identity: Identity;
  bounds: number[];
}
const eps = 1e-8;
const f32 = Math.fround;
const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: XZ, b: XZ) => a[0] * b[1] - a[1] * b[0];
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (t: number) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const identity = (s: SurfaceSegment): Identity => ({
  routeId: s.routeId,
  surfaceId: s.surfaceId,
  layer: s.layer,
  sourceId: s.sourceId,
});
const xy = (v: V): XZ => [v.x, v.z];
const box = (p: readonly V[]) => [
  Math.min(...p.map((v) => v.x)),
  Math.min(...p.map((v) => v.z)),
  Math.max(...p.map((v) => v.x)),
  Math.max(...p.map((v) => v.z)),
];
const area = (p: readonly V[]) =>
  Math.abs(
    p.reduce((n, a, i) => {
      const b = p[(i + 1) % p.length];
      return n + a.x * b.z - b.x * a.z;
    }, 0),
  ) / 2;
const overlap = (a: number[], b: number[]) =>
  a[0] <= b[2] + eps &&
  a[2] >= b[0] - eps &&
  a[1] <= b[3] + eps &&
  a[3] >= b[1] - eps;
const mixV = (a: V, b: V, t: number): V => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
  cx: a.cx + (b.cx - a.cx) * t,
  cz: a.cz + (b.cz - a.cz) * t,
  h: a.h + (b.h - a.h) * t,
  s: a.s + (b.s - a.s) * t,
});
function clip(poly: V[], signed: (v: V) => number): V[] {
  const out: V[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = signed(a),
      db = signed(b);
    if (da >= -eps) out.push(a);
    if (da >= 0 !== db >= 0) out.push(mixV(a, b, da / (da - db)));
  }
  return out.filter(
    (v, i) => !i || Math.hypot(v.x - out[i - 1].x, v.z - out[i - 1].z) > 1e-7,
  );
}
/** Difference against a convex triangle, preserving interpolated source attributes. */
function subtractTriangle(poly: V[], triangle: V[]): V[][] {
  if (poly.length < 3 || area(poly) < 1e-7) return [];
  if (area(triangle) < 1e-7) return [poly];
  const sign =
    cross(
      [triangle[1].x - triangle[0].x, triangle[1].z - triangle[0].z],
      [triangle[2].x - triangle[0].x, triangle[2].z - triangle[0].z],
    ) >= 0
      ? 1
      : -1;
  let inside = poly;
  const out: V[][] = [];
  for (let i = 0; i < 3 && inside.length >= 3; i++) {
    const a = triangle[i],
      b = triangle[(i + 1) % 3];
    const signed = (v: V) =>
      sign * ((b.x - a.x) * (v.z - a.z) - (b.z - a.z) * (v.x - a.x));
    const outside = clip(inside, (v) => -signed(v));
    if (outside.length >= 3 && area(outside) > 1e-7) out.push(outside);
    inside = clip(inside, signed);
    if (area(inside) < 1e-7) break;
  }
  return out;
}
function inRing(p: XZ, ring: readonly XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function inNoFill(p: XZ, areas: readonly GroundPolygon[]) {
  return areas.some(
    (poly) =>
      inRing(p, poly.outer) && !(poly.holes ?? []).some((h) => inRing(p, h)),
  );
}
/** Split wall/line precisely at polygon boundaries; midpoint decides each interval. */
function openIntervals(a: XZ, b: XZ, areas: readonly GroundPolygon[]) {
  const d: XZ = [b[0] - a[0], b[1] - a[1]],
    cuts = [0, 1];
  for (const poly of areas)
    for (const ring of [poly.outer, ...(poly.holes ?? [])])
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i],
          q = ring[(i + 1) % ring.length],
          e: XZ = [q[0] - p[0], q[1] - p[1]],
          det = cross(d, e);
        if (Math.abs(det) < eps) continue;
        const delta: XZ = [p[0] - a[0], p[1] - a[1]],
          t = cross(delta, e) / det,
          u = cross(delta, d) / det;
        if (t > eps && t < 1 - eps && u >= -eps && u <= 1 + eps) cuts.push(t);
      }
  cuts.sort((a, b) => a - b);
  const unique = cuts.filter((v, i) => !i || v - cuts[i - 1] > eps),
    out: [number, number][] = [];
  for (let i = 1; i < unique.length; i++) {
    const t = unique[i - 1],
      u = unique[i],
      m = (t + u) / 2;
    if (!inNoFill([a[0] + d[0] * m, a[1] + d[1] * m], areas)) out.push([t, u]);
  }
  return out;
}

export function buildCausewayGeometry(
  input: readonly SurfaceSegment[],
  options: GeometryOptions = {},
): GeometryResult {
  const shoulder = options.shoulderWidthM ?? 1.5,
    rise = options.shoulderRiseM ?? 0.13,
    slabDepth = options.slabDepthM ?? 0.75,
    miterLimit = options.miterLimit ?? 2,
    grid = options.seamGridM ?? 12;
  if (
    ![shoulder, rise, slabDepth, miterLimit, grid].every(Number.isFinite) ||
    shoulder <= 0 ||
    rise < 0 ||
    slabDepth < 0 ||
    miterLimit < 1 ||
    grid <= 0
  )
    throw new Error('Invalid causeway geometry options');
  const bridgeIds =
    options.bridgeSourceIds ??
    new Set([42000575, 44032488, 363693708, 363693713, 363693709]);
  const noFill = options.noFill ?? [];
  const buffers = Object.fromEntries(
    [
      'asphalt',
      'shoulder',
      'curb',
      'slab',
      'retaining',
      'paintWhite',
      'paintYellow',
      'rails',
    ].map((k) => [k, []]),
  ) as unknown as Record<BufferKind, number[]>;
  const topTriangles: TopTriangle[] = [],
    sections: Section[] = [],
    pieces: Piece[] = [],
    plans: PlanTri[] = [];
  let gapFills = 0,
    noFillWallSplits = 0;
  const groups = new Map<string, SurfaceSegment[]>();
  for (const s of input) {
    if (
      ![...s.a, ...s.b, s.h0, s.h1, s.s0, s.s1, s.width, s.layer].every(
        Number.isFinite,
      ) ||
      s.s1 <= s.s0 ||
      s.width <= 0 ||
      dist(s.a, s.b) < 1e-6
    )
      throw new Error('Invalid baked surface');
    const list = groups.get(s.routeId) ?? [];
    list.push(s);
    groups.set(s.routeId, list);
  }
  for (const list of groups.values()) list.sort((a, b) => a.s0 - b.s0);
  const defaults = [...groups.keys()].flatMap<{
    routeId: string;
    startM?: number;
    endM?: number;
  }>((routeId) =>
    /south-(east|west)$/.test(routeId)
      ? [{ routeId, startM: 30 }]
      : /south-park-access$/.test(routeId)
        ? [{ routeId, endM: 20 }]
        : [],
  );
  const tapers = options.tapers ?? defaults;
  const weights = (routeId: string, s: number) => {
    const rule = tapers.find((r) => r.routeId === routeId),
      g = groups.get(routeId)!;
    if (!rule || !options.groundRoadTop) return 0;
    return Math.max(
      rule.startM ? 1 - smooth((s - g[0].s0) / rule.startM) : 0,
      rule.endM ? 1 - smooth((g.at(-1)!.s1 - s) / rule.endM) : 0,
    );
  };
  const topY = (v: V, routeId: string, offset = 0) => {
    const w = weights(routeId, v.s),
      delta = w
        ? options.groundRoadTop!(v.x, v.z) - options.groundRoadTop!(v.cx, v.cz)
        : 0;
    const y = v.h + delta * w + offset;
    if (!Number.isFinite(y)) throw new Error('Non-finite ground callback');
    return y;
  };
  function tri(
    buffer: BufferKind,
    a: XYZ,
    b: XYZ,
    c: XYZ,
    meta?: Omit<
      TopTriangle,
      'buffer' | 'offset' | 'minX' | 'minZ' | 'maxX' | 'maxZ'
    >,
  ) {
    if (![...a, ...b, ...c].every(Number.isFinite))
      throw new Error('Invalid geometry vertex');
    const aa = a.map(f32) as unknown as XYZ,
      bb = b.map(f32) as unknown as XYZ,
      cc = c.map(f32) as unknown as XYZ;
    const nx =
        (bb[1] - aa[1]) * (cc[2] - aa[2]) - (bb[2] - aa[2]) * (cc[1] - aa[1]),
      ny =
        (bb[2] - aa[2]) * (cc[0] - aa[0]) - (bb[0] - aa[0]) * (cc[2] - aa[2]),
      nz =
        (bb[0] - aa[0]) * (cc[1] - aa[1]) - (bb[1] - aa[1]) * (cc[0] - aa[0]);
    if (Math.hypot(nx, ny, nz) < 1e-9) return;
    const verts = meta && ny < 0 ? [aa, cc, bb] : [aa, bb, cc],
      offset = buffers[buffer].length;
    for (const v of verts) buffers[buffer].push(...v);
    if (meta)
      topTriangles.push({
        ...meta,
        buffer: buffer as 'asphalt' | 'shoulder',
        offset,
        minX: Math.min(aa[0], bb[0], cc[0]),
        minZ: Math.min(aa[2], bb[2], cc[2]),
        maxX: Math.max(aa[0], bb[0], cc[0]),
        maxZ: Math.max(aa[2], bb[2], cc[2]),
      });
  }
  const quad = (buffer: BufferKind, a: XYZ, b: XYZ, c: XYZ, d: XYZ) => {
    tri(buffer, a, b, c);
    tri(buffer, a, c, d);
  };
  const inputIndices = new Map(input.map((s, i) => [s, i]));
  function emitTop(
    poly: V[],
    buffer: 'asphalt' | 'shoulder',
    ids: Identity[],
    role: TopTriangle['role'],
    offsetY = 0,
    inputIndex = -1,
  ) {
    if (poly.length < 3 || area(poly) < 1e-7) return;
    const routeId = ids[0].routeId;
    const emit = (p: V[]) => {
      for (let j = 1; j < p.length - 1; j++) {
        const q = [p[0], p[j], p[j + 1]],
          v = q.map((a) => [a.x, topY(a, routeId, offsetY), a.z] as XYZ);
        tri(buffer, v[0], v[1], v[2], {
          identities: ids,
          role,
          inputIndex,
          s0: Math.min(...q.map((v) => v.s)),
          s1: Math.max(...q.map((v) => v.s)),
        });
      }
    };
    // At the City seam clip against the same 12m cells/diagonals. This makes
    // station0 transverse boundary exactly conform to the actual planar field.
    if (!poly.some((p) => weights(routeId, p.s) > 0)) {
      emit(poly);
      return;
    }
    const b = box(poly);
    for (let gx = Math.floor(b[0] / grid); gx <= Math.floor(b[2] / grid); gx++)
      for (
        let gz = Math.floor(b[1] / grid);
        gz <= Math.floor(b[3] / grid);
        gz++
      ) {
        let p = clip(
          clip(
            clip(
              clip(poly, (v) => v.x - gx * grid),
              (v) => (gx + 1) * grid - v.x,
            ),
            (v) => v.z - gz * grid,
          ),
          (v) => (gz + 1) * grid - v.z,
        );
        for (const side of [-1, 1]) {
          const q = clip(
            p,
            (v) => side * (v.x - gx * grid - (v.z - gz * grid)),
          );
          if (q.length >= 3) emit(q);
        }
      }
  }
  const endpoints: { section: V[]; seg: SurfaceSegment; atStart: boolean }[] =
    [];
  for (const [routeId, list] of groups) {
    const crossSections: V[][] = [];
    for (let i = 0; i <= list.length; i++) {
      const prev = list[i - 1],
        next = list[i],
        s = next ?? prev,
        center = next?.a ?? prev.b,
        h = next?.h0 ?? prev.h1,
        station = next?.s0 ?? prev.s1;
      if (
        prev &&
        next &&
        (dist(prev.b, next.a) > 1e-5 ||
          Math.abs(prev.s1 - next.s0) > 1e-5 ||
          Math.abs(prev.h1 - next.h0) > 1e-5 ||
          prev.layer !== next.layer ||
          prev.surfaceId !== next.surfaceId)
      )
        throw new Error(`Disconnected baked route ${routeId}`);
      const dir = (v: SurfaceSegment): XZ => {
        const l = dist(v.a, v.b);
        return [(v.b[0] - v.a[0]) / l, (v.b[1] - v.a[1]) / l];
      };
      const d0 = dir(prev ?? next),
        d1 = dir(next ?? prev),
        n0: XZ = [d0[1], -d0[0]],
        n1: XZ = [d1[1], -d1[0]];
      if (d0[0] * d1[0] + d0[1] * d1[1] < -0.95)
        throw new Error(`Near reversal needs explicit junction: ${routeId}`);
      const sum: XZ = [n0[0] + n1[0], n0[1] + n1[1]],
        ln = Math.hypot(...sum),
        m: XZ = ln > eps ? [sum[0] / ln, sum[1] / ln] : n1;
      const factor = Math.min(
          miterLimit,
          1 / Math.max(0.01, m[0] * n1[0] + m[1] * n1[1]),
        ),
        half = ((prev?.width ?? s.width) + (next?.width ?? s.width)) / 4;
      const vertex = (lateral: number): V => ({
        x: center[0] + m[0] * lateral * factor,
        z: center[1] + m[1] * lateral * factor,
        cx: center[0],
        cz: center[1],
        h,
        s: station,
      });
      const c = [
        vertex(-half - shoulder),
        vertex(-half),
        vertex(0),
        vertex(half),
        vertex(half + shoulder),
      ];
      crossSections.push(c);
      const cv = (v: V, add = 0): XYZ => [
        f32(v.x),
        f32(topY(v, routeId, add)),
        f32(v.z),
      ];
      sections.push({
        routeId,
        s: station,
        center: cv(c[2]),
        left: cv(c[1]),
        right: cv(c[3]),
        outerLeft: cv(c[0], rise),
        outerRight: cv(c[4], rise),
      });
    }
    endpoints.push(
      { section: crossSections[0], seg: list[0], atStart: true },
      { section: crossSections.at(-1)!, seg: list.at(-1)!, atStart: false },
    );
    list.forEach((s, i) => {
      const a = crossSections[i],
        b = crossSections[i + 1];
      pieces.push({ segment: s, a, b });
      for (const [lo, hi] of [
        [1, 2],
        [2, 3],
      ])
        for (const p of [
          [a[lo], b[lo], b[hi]],
          [a[lo], b[hi], a[hi]],
        ]) {
          plans.push({ p, identity: identity(s), bounds: box(p) });
          emitTop(p, 'asphalt', [identity(s)], 'road', 0, inputIndices.get(s)!);
        }
    });
  }
  const planIndex = orderedBounds(plans, p => p.bounds, 24, eps);
  // Fill only uncovered endpoint sectors; subtract existing asphalt plans so
  // the fan does not overlay/slant over already-rendered approach triangles.
  if (options.junctionFills !== false) {
    const used = new Set<number>();
    for (let i = 0; i < endpoints.length; i++) {
      if (used.has(i)) continue;
      const group = [i];
      used.add(i);
      for (let j = i + 1; j < endpoints.length; j++)
        if (
          endpoints[i].seg.layer === endpoints[j].seg.layer &&
          dist(xy(endpoints[i].section[2]), xy(endpoints[j].section[2])) <
            1e-5 &&
          Math.abs(endpoints[i].section[2].h - endpoints[j].section[2].h) < 1e-5
        ) {
          group.push(j);
          used.add(j);
        }
      if (group.length < 2) continue;
      const center = endpoints[i].section[2],
        ids = group.map((j) => identity(endpoints[j].seg));
      const rim = group
        .flatMap((j) => [endpoints[j].section[1], endpoints[j].section[3]])
        .sort(
          (a, b) =>
            Math.atan2(a.z - center.z, a.x - center.x) -
            Math.atan2(b.z - center.z, b.x - center.x),
        );
      for (let j = 0; j < rim.length; j++) {
        const a = rim[j],
          b = rim[(j + 1) % rim.length];
        let candidates = [[center, a, b]];
        const bounds = box(candidates[0]);
        for (const plan of planIndex.query(bounds))
          if (overlap(bounds, plan.bounds))
            candidates = candidates.flatMap((poly) =>
              subtractTriangle(poly, plan.p),
            );
        for (const poly of candidates)
          if (poly.length >= 3 && area(poly) > 1e-7) {
            emitTop(poly, 'asphalt', ids, 'junction');
            gapFills++;
          }
      }
    }
  }
  const otherRoads = (s: SurfaceSegment, bounds: number[]) =>
    planIndex.query(bounds).filter(
      (p) =>
        p.identity.routeId !== s.routeId &&
        p.identity.layer === s.layer &&
        overlap(bounds, p.bounds),
    );
  const unobstructed = (poly: V[], s: SurfaceSegment) => {
    let result = [poly];
    for (const p of otherRoads(s, box(poly)))
      result = result.flatMap((v) => subtractTriangle(v, p.p));
    return result;
  };
  const covered = (p: V, s: SurfaceSegment) =>
    otherRoads(s, [p.x, p.z, p.x, p.z]).some((t) => {
      const a = t.p[0],
        b = t.p[1],
        c = t.p[2],
        det = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      const u = ((p.x - a.x) * (c.z - a.z) - (p.z - a.z) * (c.x - a.x)) / det,
        v = ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) / det;
      return u >= -eps && v >= -eps && u + v <= 1 + eps;
    });
  for (const piece of pieces) {
    const { segment: s, a, b } = piece;
    for (const [outer, inner] of [
      [0, 1],
      [4, 3],
    ]) {
      for (const p of unobstructed([a[outer], b[outer], b[inner], a[inner]], s))
        emitTop(
          p,
          'shoulder',
          [identity(s)],
          'shoulder',
          rise,
          inputIndices.get(s)!,
        );
      const mid = mixV(a[inner], b[inner], 0.5);
      if (!covered(mid, s))
        quad(
          'curb',
          [a[inner].x, topY(a[inner], s.routeId), a[inner].z],
          [b[inner].x, topY(b[inner], s.routeId), b[inner].z],
          [b[inner].x, topY(b[inner], s.routeId, rise), b[inner].z],
          [a[inner].x, topY(a[inner], s.routeId, rise), a[inner].z],
        );
      if (bridgeIds.has(s.sourceId)) {
        // Shoulder rises .13; bottom is ASPHALT-.75, never shoulder-.75.
        quad(
          'slab',
          [a[outer].x, a[outer].h - slabDepth, a[outer].z],
          [b[outer].x, b[outer].h - slabDepth, b[outer].z],
          [b[outer].x, topY(b[outer], s.routeId, rise), b[outer].z],
          [a[outer].x, topY(a[outer], s.routeId, rise), a[outer].z],
        );
      } else if (
        options.retainingRouteIds?.has(s.routeId) &&
        options.groundElevation
      ) {
        const intervals = openIntervals(xy(a[outer]), xy(b[outer]), noFill);
        noFillWallSplits += Math.max(0, intervals.length - 1);
        for (const [t, u] of intervals) {
          const p = mixV(a[outer], b[outer], t),
            q = mixV(a[outer], b[outer], u),
            py = topY(p, s.routeId, rise),
            qy = topY(q, s.routeId, rise),
            gy = options.groundElevation(p.x, p.z),
            hy = options.groundElevation(q.x, q.z);
          if (Math.max(py - gy, qy - hy) > 0.2)
            quad(
              'retaining',
              [p.x, Math.min(py, gy), p.z],
              [q.x, Math.min(qy, hy), q.z],
              [q.x, qy, q.z],
              [p.x, py, p.z],
            );
        }
      }
    }
    if (bridgeIds.has(s.sourceId)) {
      quad(
        'slab',
        [a[0].x, a[0].h - slabDepth, a[0].z],
        [a[4].x, a[4].h - slabDepth, a[4].z],
        [b[4].x, b[4].h - slabDepth, b[4].z],
        [b[0].x, b[0].h - slabDepth, b[0].z],
      );
      const list = groups.get(s.routeId)!,
        index = list.indexOf(s);
      for (const [section, end] of [
        [a, index === 0 || !bridgeIds.has(list[index - 1].sourceId)],
        [
          b,
          index === list.length - 1 || !bridgeIds.has(list[index + 1].sourceId),
        ],
      ] as const)
        if (end) {
          quad(
            'slab',
            [section[0].x, section[0].h - slabDepth, section[0].z],
            [section[4].x, section[4].h - slabDepth, section[4].z],
            [section[4].x, topY(section[4], s.routeId, rise), section[4].z],
            [section[0].x, topY(section[0], s.routeId, rise), section[0].z],
          );
        }
    }
  }
  const result: GeometryResult = {
    buffers,
    topTriangles,
    sections,
    perSegment: [],
    surfaces: [],
    stats: {
      inputSegments: input.length,
      topTriangles: topTriangles.length,
      triangles: 0,
      gapFills,
      noFillWallSplits,
    },
  };
  const lookup = createCausewayTriangleLookup(result);
  const point = (piece: Piece, t: number, ratio: number) => {
    const c =
        ratio < 0
          ? mixV(piece.a[2], piece.a[1], -ratio)
          : mixV(piece.a[2], piece.a[3], ratio),
      d =
        ratio < 0
          ? mixV(piece.b[2], piece.b[1], -ratio)
          : mixV(piece.b[2], piece.b[3], ratio);
    return mixV(c, d, t);
  };
  // A box beam generated directly from endpoints, suitable for one merged mesh.
  const beam = (a: XYZ, b: XYZ, width: number, height: number) => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      l = Math.hypot(dx, dz),
      nx = l > eps ? dz / l : 1,
      nz = l > eps ? -dx / l : 0;
    const corners = (p: XYZ) =>
        [
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
        ].map(([x, y]) =>
          l > eps
            ? ([
                p[0] + (nx * x * width) / 2,
                p[1] + (y * height) / 2,
                p[2] + (nz * x * width) / 2,
              ] as XYZ)
            : ([p[0] + (x * width) / 2, p[1], p[2] + (y * height) / 2] as XYZ),
        ),
      p = corners(a),
      q = corners(b);
    for (let k = 0; k < 4; k++)
      quad('rails', p[k], q[k], q[(k + 1) % 4], p[(k + 1) % 4]);
    quad('rails', ...(p as [XYZ, XYZ, XYZ, XYZ]));
    quad('rails', ...(q as [XYZ, XYZ, XYZ, XYZ]));
  };
  for (const piece of pieces) {
    const s = piece.segment,
      scope = { surfaceId: s.surfaceId, layer: s.layer },
      length = s.s1 - s.s0;
    if (options.paint !== false && !/bike-exit/.test(s.routeId)) {
      const lanes =
        /central|north|shared/.test(s.routeId) && s.width >= 10
          ? [-1 / 3, 1 / 3]
          : [];
      for (const ratio of [...lanes, -1 + 0.5 / s.width, 1 - 0.5 / s.width]) {
        const edge = Math.abs(ratio) > 0.5;
        for (let begin = s.s0; begin < s.s1 - eps;) {
          const period = Math.floor(begin / 10),
            end = Math.min(
              s.s1,
              (period + 1) * 10,
              edge
                ? s.s1
                : period * 10 + (begin < period * 10 + 6 - eps ? 6 : 10),
            );
          if (edge || begin < period * 10 + 6 - eps) {
            const ta = (begin - s.s0) / length,
              tb = (end - s.s0) / length,
              half = 0.12 / s.width,
              vs = [
                point(piece, ta, ratio - half),
                point(piece, tb, ratio - half),
                point(piece, tb, ratio + half),
                point(piece, ta, ratio + half),
              ];
            const ys = vs.map((p) => lookup.heightAt(p.x, p.z, scope, 'road'));
            if (ys.every((y) => y !== undefined)) {
              const p = vs.map((v, i) => [v.x, ys[i]!.y + 0.018, v.z] as XYZ);
              quad(edge ? 'paintWhite' : 'paintYellow', p[0], p[1], p[2], p[3]);
            }
          }
          begin = end > begin + eps ? end : begin + 1e-6;
        }
      }
    }
    if (options.rails !== false && !/bike-exit/.test(s.routeId))
      for (const side of [-1, 1]) {
        const ratio = side * (1 + 0.5 / s.width),
          p = point(piece, 0, ratio),
          q = point(piece, 1, ratio),
          mid = mixV(p, q, 0.5);
        if ([p, q, mid].some((v) => covered(v, s))) continue;
        if (
          options.railAllowed &&
          ![p, q, mid].every((v) => options.railAllowed!(identity(s), v.x, v.z))
        )
          continue;
        const y0 = lookup.heightAt(p.x, p.z, scope, 'shoulder'),
          y1 = lookup.heightAt(q.x, q.z, scope, 'shoulder');
        if (!y0 || !y1) continue;
        beam([p.x, y0.y + 1.05, p.z], [q.x, y1.y + 1.05, q.z], 0.13, 0.16);
        for (
          let station = Math.ceil(s.s0 / 3) * 3;
          station < s.s1 - eps;
          station += 3
        ) {
          const v = point(piece, (station - s.s0) / length, ratio);
          if (covered(v, s)) continue;
          const y = lookup.heightAt(v.x, v.z, scope, 'shoulder');
          if (y) beam([v.x, y.y, v.z], [v.x, y.y + 1.1, v.z], 0.11, 0.11);
        }
      }
  }
  result.perSegment = input.map((segment, inputIndex) => ({
    inputIndex,
    segment,
    asphalt: [],
    shoulder: [],
    topTriangleIndices: [],
  }));
  topTriangles.forEach((t, index) => {
    if (t.inputIndex < 0) return;
    const p = result.perSegment[t.inputIndex];
    p[t.buffer].push(...buffers[t.buffer].slice(t.offset, t.offset + 9));
    p.topTriangleIndices.push(index);
  });
  for (const p of result.perSegment)
    for (const kind of ['road', 'shoulder'] as const) {
      const id = identity(p.segment),
        triangles = kind === 'road' ? p.asphalt : p.shoulder;
      const allowedModes =
        options.allowedModes?.(id, kind) ??
        (kind === 'shoulder'
          ? []
          : /bike-exit/.test(id.routeId)
            ? ['walk']
            : ['drive']);
      if (triangles.length)
        result.surfaces.push({
          triangles,
          ...id,
          inputIndex: p.inputIndex,
          kind,
          allowedModes,
        });
    }
  // Junction fill is explicit shared identity; parent may register it once per
  // matching surfaceId/layer. It is not assigned to an arbitrary road segment.
  const junctions = new Map<
    string,
    { identity: Identity; triangles: number[] }
  >();
  for (const t of topTriangles)
    if (t.role === 'junction')
      for (const id of t.identities) {
        const key = `${id.surfaceId}:${id.layer}`;
        let item = junctions.get(key);
        if (!item) {
          item = { identity: id, triangles: [] };
          junctions.set(key, item);
        }
        if (
          t.identities.find(
            (i) => i.surfaceId === id.surfaceId && i.layer === id.layer,
          ) === id
        )
          item.triangles.push(
            ...buffers[t.buffer].slice(t.offset, t.offset + 9),
          );
      }
  for (const { identity: id, triangles } of junctions.values())
    result.surfaces.push({
      ...id,
      routeId: 'junction',
      inputIndex: -1,
      kind: 'road',
      triangles,
      allowedModes: options.allowedModes?.(id, 'road') ?? ['drive'],
    });
  result.stats.triangles = Object.values(buffers).reduce(
    (n, a) => n + a.length / 9,
    0,
  );
  return result;
}

/** Mandatory identity scope. Geometry and lookup read the same Float32-rounded
 * buffers, including mitres, seam cells and junction fill triangles. */
export function createCausewayTriangleLookup(
  geometry: Pick<GeometryResult, 'buffers' | 'topTriangles'>,
  cellSize = 24,
) {
  if (!(cellSize > 0)) throw new Error('Invalid lookup grid');
  const cells = new Map<string, TopTriangle[]>();
  for (const tri of geometry.topTriangles)
    for (
      let x = Math.floor(tri.minX / cellSize);
      x <= Math.floor(tri.maxX / cellSize);
      x++
    )
      for (
        let z = Math.floor(tri.minZ / cellSize);
        z <= Math.floor(tri.maxZ / cellSize);
        z++
      ) {
        const key = `${x}:${z}`,
          list = cells.get(key) ?? [];
        list.push(tri);
        cells.set(key, list);
      }
  const vertices = (t: TopTriangle) =>
    [0, 3, 6].map(
      (i) =>
        geometry.buffers[t.buffer].slice(
          t.offset + i,
          t.offset + i + 3,
        ) as unknown as XYZ,
    );
  const accepts = (
    t: TopTriangle,
    scope: { surfaceId: string; layer: number },
  ) =>
    t.identities.some(
      (i) => i.surfaceId === scope.surfaceId && i.layer === scope.layer,
    );
  const heightAt = (
    x: number,
    z: number,
    scope: { surfaceId: string; layer: number },
    role?: 'road' | 'shoulder',
  ) => {
    if (!scope?.surfaceId || ![x, z, scope.layer].every(Number.isFinite))
      throw new Error('Explicit surface identity required');
    let best: { y: number; triangle: TopTriangle } | undefined;
    for (const t of cells.get(
      `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`,
    ) ?? []) {
      if (
        !accepts(t, scope) ||
        (role &&
          (role === 'road' ? t.role === 'shoulder' : t.role !== 'shoulder'))
      )
        continue;
      const [a, b, c] = vertices(t),
        det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / det,
        v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / det;
      if (u < -2e-5 || v < -2e-5 || u + v > 1 + 2e-5) continue;
      const y = a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]);
      if (!best || y > best.y) best = { y, triangle: t };
    }
    return best;
  };
  return { heightAt, vertices };
}
