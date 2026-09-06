/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Pure arrays only. All source centreline XY is retained.
 * main.start/end are geographic coordinates and must use the app projection.
 * The returned rounded asphalt triangles are also the authoritative drive floor.
 * The existing bridge body/towers/cables are retained by the caller. */
import type { SurfaceSegment, Project, XZ } from './causeway-profile';
import type { CrossSectionData } from './main-cross-section';
import { createMainCrossSection } from './main-cross-section';

type XYZ = readonly [number, number, number];
export type MainBuffer =
  | 'asphalt'
  | 'platform'
  | 'paintWhite'
  | 'paintYellow'
  | 'rails';
export interface MainTravelSurface {
  routeId: string;
  surfaceId: string;
  layer: number;
  allowedModes: readonly ('walk' | 'drive')[];
  triangles: readonly number[];
}
export interface MainRoadOptions {
  main: { start: readonly number[]; end: readonly number[] };
  project: Project;
  crossSection: CrossSectionData;
  topY?: number;
  routeId?: string;
  surfaceId?: string;
  layer?: number;
  maxStepM?: number;
  platformDropM?: number;
  platformThicknessM?: number;
  bodyWidthM?: number;
  paint?: boolean;
  rails?: boolean;
  /** Omit road-edge barriers in the complex source entrance fan. Outer walkway
   * rails are intentionally absent from this module. Widths/gaps are display. */
  railGaps?: readonly { s0: number; s1: number }[];
}
export interface MainRoadSection {
  s: number;
  sourceCenter: XZ;
  asphaltWest: number;
  asphaltEast: number;
  centerShift: number;
  width: number;
  platformWest: number;
  platformEast: number;
}
export interface MainRoadResult {
  segments: SurfaceSegment[];
  buffers: Record<MainBuffer, number[]>;
  sections: MainRoadSection[];
  perSegment: {
    inputIndex: number;
    segment: SurfaceSegment;
    asphalt: number[];
    centerShift0: number;
    centerShift1: number;
  }[];
  surfaces: MainTravelSurface[];
  stats: {
    segments: number;
    triangles: Record<MainBuffer, number>;
    minAsphaltWidthM: number;
    maxAsphaltWidthM: number;
    maxSectionStepM: number;
    localWingEndM: number;
    railGaps: readonly { s0: number; s1: number }[];
  };
}
const f32 = Math.fround,
  eps = 1e-8;
export function buildMainRoadGeometry(
  options: MainRoadOptions,
): MainRoadResult {
  const { project, main } = options,
    origin = project(main.start),
    end = project(main.end);
  const dx = end[0] - origin[0],
    dz = end[1] - origin[1],
    length = Math.hypot(dx, dz),
    tx = dx / length,
    tz = dz / length,
    nx = -tz,
    nz = tx;
  const top = options.topY ?? 65.95,
    drop = options.platformDropM ?? 0.15,
    thickness = options.platformThicknessM ?? 0.25;
  const maxStep = options.maxStepM ?? 3,
    bodyHalf = (options.bodyWidthM ?? 20) / 2;
  const surfaceId = options.surfaceId ?? 'lions:road',
    routeId = options.routeId ?? 'lions:main-road',
    layer = options.layer ?? 1;
  const railGaps = options.railGaps ?? [{ s0: 0, s1: 36 }];
  if (
    ![
      ...origin,
      ...end,
      length,
      top,
      drop,
      thickness,
      maxStep,
      bodyHalf,
      layer,
    ].every(Number.isFinite) ||
    length <= 0 ||
    drop <= 0 ||
    thickness <= 0 ||
    maxStep <= 0 ||
    maxStep > 3 ||
    bodyHalf <= 0
  )
    throw new Error('Invalid main road geometry options');
  if (Math.abs(length - options.crossSection.lengthM) > 0.001)
    throw new Error('Cross-section frame differs from original main source');
  for (const gap of railGaps)
    if (![gap.s0, gap.s1].every(Number.isFinite) || gap.s1 < gap.s0)
      throw new Error('Invalid rail gap');
  const section = createMainCrossSection(options.crossSection),
    cache = new Map<number, MainRoadSection>();
  const at = (s: number): MainRoadSection => {
    let value = cache.get(s);
    if (value) return value;
    const q = section(s);
    if (!q) throw new Error(`Incomplete main walkway envelope at ${s}`);
    // 0.5mm reserve absorbs Float32 world-space rounding; adaptive subdivision
    // below limits curved envelope interpolation error to less than0.2mm.
    const west = q.asphaltWest + 0.0005,
      east = q.asphaltEast - 0.0005;
    const sourceCenter: XZ =
      s === 0
        ? [...origin]
        : s === length
          ? [...end]
          : [origin[0] + tx * s, origin[1] + tz * s];
    value = {
      s,
      sourceCenter,
      asphaltWest: west,
      asphaltEast: east,
      centerShift: (west + east) / 2,
      width: east - west,
      platformWest: Math.min(-bodyHalf, q.platformOuterWest),
      platformEast: Math.max(bodyHalf, q.platformOuterEast),
    };
    cache.set(s, value);
    return value;
  };
  const cuts = [
    0,
    length,
    ...options.crossSection.lines.flatMap((l) => l.knots.map((k) => k.s)),
    ...railGaps.flatMap((g) => [g.s0, g.s1]),
  ];
  // Paint phase boundaries belong to geometry cuts, so separate batches do not
  // restart dashes and never leave partial-length lane markings at a bake seam.
  for (let s = 0; s < length; s += 10) {
    cuts.push(s, s + 6);
  }
  cuts.sort((a, b) => a - b);
  const sourceCuts = cuts.filter(
    (s, i) => s >= 0 && s <= length && (!i || Math.abs(s - cuts[i - 1]) > eps),
  );
  const all: MainRoadSection[] = [at(0)];
  function split(a: MainRoadSection, b: MainRoadSection, depth = 0) {
    let error = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const p = at(a.s + (b.s - a.s) * t),
        mix = (
          key: 'asphaltWest' | 'asphaltEast' | 'platformWest' | 'platformEast',
        ) => a[key] + (b[key] - a[key]) * t;
      error = Math.max(
        error,
        p.asphaltWest - mix('asphaltWest'),
        mix('asphaltEast') - p.asphaltEast,
        Math.abs(mix('platformWest') - p.platformWest) * 0.05,
        Math.abs(mix('platformEast') - p.platformEast) * 0.05,
      );
    }
    if (b.s - a.s > maxStep + eps || error > 0.0002) {
      if (depth >= 22)
        throw new Error('Cannot resolve source entrance envelope');
      const m = at((a.s + b.s) / 2);
      split(a, m, depth + 1);
      split(m, b, depth + 1);
    } else all.push(b);
  }
  for (let i = 1; i < sourceCuts.length; i++)
    split(at(sourceCuts[i - 1]), at(sourceCuts[i]));
  const buffers: Record<MainBuffer, number[]> = {
    asphalt: [],
    platform: [],
    paintWhite: [],
    paintYellow: [],
    rails: [],
  };
  const point = (p: MainRoadSection, o: number, y: number): XYZ => [
    p.sourceCenter[0] + nx * o,
    y,
    p.sourceCenter[1] + nz * o,
  ];
  function tri(kind: MainBuffer, a: XYZ, b: XYZ, c: XYZ, normal: XYZ) {
    const p = a.map(f32) as unknown as XYZ,
      q = b.map(f32) as unknown as XYZ,
      r = c.map(f32) as unknown as XYZ;
    if (![...p, ...q, ...r].every(Number.isFinite))
      throw new Error('Non-finite emitted triangle');
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
      v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]],
      n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
    if (Math.hypot(...n) < 1e-10) return;
    if (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0)
      buffers[kind].push(...p, ...r, ...q);
    else buffers[kind].push(...p, ...q, ...r);
  }
  const quad = (k: MainBuffer, a: XYZ, b: XYZ, c: XYZ, d: XYZ, n: XYZ) => {
    tri(k, a, b, c, n);
    tri(k, a, c, d, n);
  };
  const strip = (
    k: MainBuffer,
    a: MainRoadSection,
    b: MainRoadSection,
    wa: number,
    ea: number,
    wb: number,
    eb: number,
    y: number,
  ) =>
    quad(
      k,
      point(a, wa, y),
      point(b, wb, y),
      point(b, eb, y),
      point(a, ea, y),
      [0, 1, 0],
    );
  const beam = (a: XYZ, b: XYZ, width: number, height: number) => {
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      l = Math.hypot(dx, dz);
    if (l < eps) return;
    const nx = -dz / l,
      nz = dx / l,
      h = height / 2,
      w = width / 2;
    // Narrow Jersey-style section: broad foot, sloping lower face and slim top.
    // Its road-facing foot stays exactly outside the authoritative asphalt.
    const profile = [
      [-w, -h],
      [w, -h],
      [w * 0.55, -h * 0.15],
      [w * 0.4, h],
      [-w * 0.4, h],
      [-w * 0.55, -h * 0.15],
    ];
    const corners = (p: XYZ): XYZ[] =>
      profile.map(([x, y]) => [p[0] + nx * x, p[1] + y, p[2] + nz * x]);
    const p = corners(a),
      q = corners(b);
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length,
        ux = profile[j][0] - profile[i][0],
        uy = profile[j][1] - profile[i][1];
      quad('rails', p[i], q[i], q[j], p[j], [nx * uy, -ux, nz * uy]);
    }
    for (let i = 1; i < profile.length - 1; i++) {
      tri('rails', p[0], p[i], p[i + 1], [-dx / l, 0, -dz / l]);
      tri('rails', q[0], q[i], q[i + 1], [dx / l, 0, dz / l]);
    }
  };
  const segments: SurfaceSegment[] = [],
    perSegment: MainRoadResult['perSegment'] = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1],
      b = all[i],
      start = buffers.asphalt.length;
    strip(
      'asphalt',
      a,
      b,
      a.asphaltWest,
      a.asphaltEast,
      b.asphaltWest,
      b.asphaltEast,
      top,
    );
    const segment: SurfaceSegment = {
      a: a.sourceCenter,
      b: b.sourceCenter,
      h0: f32(top),
      h1: f32(top),
      width: (a.width + b.width) / 2,
      s0: a.s,
      s1: b.s,
      sourceId: 4755915,
      routeId,
      surfaceId,
      layer,
    };
    segments.push(segment);
    perSegment.push({
      inputIndex: i - 1,
      segment,
      asphalt: buffers.asphalt.slice(start),
      centerShift0: a.centerShift,
      centerShift1: b.centerShift,
    });
    const platformTop = top - drop,
      bottom = platformTop - thickness;
    strip(
      'platform',
      a,
      b,
      a.platformWest,
      a.platformEast,
      b.platformWest,
      b.platformEast,
      platformTop,
    );
    quad(
      'platform',
      point(a, a.platformWest, bottom),
      point(b, b.platformWest, bottom),
      point(b, b.platformEast, bottom),
      point(a, a.platformEast, bottom),
      [0, -1, 0],
    );
    quad(
      'platform',
      point(a, a.platformWest, bottom),
      point(b, b.platformWest, bottom),
      point(b, b.platformWest, platformTop),
      point(a, a.platformWest, platformTop),
      [-nx, 0, -nz],
    );
    quad(
      'platform',
      point(a, a.platformEast, bottom),
      point(b, b.platformEast, bottom),
      point(b, b.platformEast, platformTop),
      point(a, a.platformEast, platformTop),
      [nx, 0, nz],
    );
    if (i === 1)
      quad(
        'platform',
        point(a, a.platformWest, bottom),
        point(a, a.platformEast, bottom),
        point(a, a.platformEast, platformTop),
        point(a, a.platformWest, platformTop),
        [-tx, 0, -tz],
      );
    if (i === all.length - 1)
      quad(
        'platform',
        point(b, b.platformWest, bottom),
        point(b, b.platformEast, bottom),
        point(b, b.platformEast, platformTop),
        point(b, b.platformWest, platformTop),
        [tx, 0, tz],
      );
    if (options.paint !== false) {
      const pa = top + 0.012;
      for (const side of [-1, 1]) {
        const oa = side < 0 ? a.asphaltWest + 0.18 : a.asphaltEast - 0.18,
          ob = side < 0 ? b.asphaltWest + 0.18 : b.asphaltEast - 0.18;
        strip(
          'paintWhite',
          a,
          b,
          oa - 0.06,
          oa + 0.06,
          ob - 0.06,
          ob + 0.06,
          pa,
        );
      }
      if (((a.s + b.s) / 2) % 10 < 6)
        for (const ratio of [1 / 3, 2 / 3]) {
          const oa = a.asphaltWest + a.width * ratio,
            ob = b.asphaltWest + b.width * ratio;
          strip(
            'paintYellow',
            a,
            b,
            oa - 0.05,
            oa + 0.05,
            ob - 0.05,
            ob + 0.05,
            pa,
          );
        }
    }
    if (
      options.rails !== false &&
      !railGaps.some((g) => a.s < g.s1 - eps && b.s > g.s0 + eps)
    )
      for (const side of [-1, 1]) {
        const oa = side < 0 ? a.asphaltWest - 0.12 : a.asphaltEast + 0.12,
          ob = side < 0 ? b.asphaltWest - 0.12 : b.asphaltEast + 0.12;
        beam(point(a, oa, top + 0.425), point(b, ob, top + 0.425), 0.24, 0.85);
      }
  }
  return {
    segments,
    buffers,
    sections: all,
    perSegment,
    surfaces: [
      {
        surfaceId,
        routeId,
        layer,
        allowedModes: ['drive'],
        triangles: buffers.asphalt,
      },
    ],
    stats: {
      segments: segments.length,
      triangles: Object.fromEntries(
        Object.entries(buffers).map(([k, v]) => [k, v.length / 9]),
      ) as Record<MainBuffer, number>,
      minAsphaltWidthM: Math.min(...all.map((s) => s.width)),
      maxAsphaltWidthM: Math.max(...all.map((s) => s.width)),
      maxSectionStepM: Math.max(...segments.map((s) => s.s1 - s.s0)),
      localWingEndM: Math.max(
        0,
        ...all
          .filter(
            (s) =>
              s.platformWest < -bodyHalf - eps ||
              s.platformEast > bodyHalf + eps,
          )
          .map((s) => s.s),
      ),
      railGaps,
    },
  };
}
