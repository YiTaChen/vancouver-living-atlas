/** Original MIT prototype. Pure math; no Three.js, DOM, engine or global state.
 * All height values are FINAL ROAD TOP metres. Do not add the old +0.06 again.
 * Source XY is never smoothed, translated or replaced with an endpoint chord.
 */
export type XZ = readonly [number, number];
export type Project = (coordinate: readonly number[]) => XZ;
export type Elevation = (x: number, z: number) => number;
export interface SourceWay {
  properties: { sourceId: number; roadWidthM?: number };
  geometry: { coordinates: readonly (readonly number[])[] };
}
export const NORTH_WAY_IDS = [
  325793279, 70954678, 1252160596, 70954663, 475320408,
] as const;
export const SHORT_BRIDGE_WAY_IDS = [
  42000575, 44032488, 363693708, 363693713,
] as const;
export const LOWER_PATH_IDS = [
  363686270, 648864806, 44032491, 115939816, 74267973,
] as const;
export const ROAD_TOP_OFFSET_M = 1.11;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const finite = (...values: number[]) => values.every(Number.isFinite);

export interface Span {
  a: XZ;
  b: XZ;
  start: number;
  length: number;
  sourceId: number;
  width: number;
}
export interface WayRange {
  start: number;
  end: number;
  reversed: boolean;
}
export interface Chain {
  spans: Span[];
  length: number;
  ranges: Map<number, WayRange>;
  at: (chainage: number) => {
    x: number;
    z: number;
    sourceId: number;
    width: number;
  };
}

/** orderedIds are SOUTH->NORTH (or the chosen route direction), regardless of OSM way direction. */
export function createChain(
  ways: readonly SourceWay[],
  orderedIds: readonly number[],
  project: Project,
  firstReversed = false,
): Chain {
  if (!orderedIds.length || new Set(orderedIds).size !== orderedIds.length)
    throw new Error('Require unique ordered way IDs');
  const byId = new Map(ways.map((way) => [way.properties.sourceId, way]));
  const spans: Span[] = [],
    ranges = new Map<number, WayRange>();
  let length = 0,
    end: XZ | undefined;
  for (const [index, sourceId] of orderedIds.entries()) {
    const way = byId.get(sourceId);
    if (!way || way.geometry.coordinates.length < 2)
      throw new Error(`Missing/short source way ${sourceId}`);
    const points = way.geometry.coordinates.map(project);
    if (points.some((p) => !finite(...p)))
      throw new Error(`Non-finite XY ${sourceId}`);
    let reversed = index === 0 ? firstReversed : false;
    if (end) {
      if (distance(end, points[0]) < 1e-6) reversed = false;
      else if (distance(end, points[points.length - 1]) < 1e-6) reversed = true;
      else
        throw new Error(
          `Disconnected route at ${sourceId}; do not bridge an XY gap`,
        );
    }
    if (reversed) points.reverse();
    const start = length;
    for (let i = 1; i < points.length; i++) {
      const len = distance(points[i - 1], points[i]);
      if (len < 1e-8) continue;
      spans.push({
        a: points[i - 1],
        b: points[i],
        start: length,
        length: len,
        sourceId,
        width: way.properties.roadWidthM ?? 11.3,
      });
      length += len;
    }
    if (length === start) throw new Error(`Zero-length source way ${sourceId}`);
    ranges.set(sourceId, { start, end: length, reversed });
    end = points[points.length - 1];
  }
  const at = (s: number) => {
    if (!Number.isFinite(s)) throw new Error('Non-finite chainage');
    s = clamp(s, 0, length);
    const span =
      spans.find((v) => s <= v.start + v.length + 1e-9) ??
      spans[spans.length - 1];
    const t = clamp((s - span.start) / span.length, 0, 1);
    return {
      x: mix(span.a[0], span.b[0], t),
      z: mix(span.a[1], span.b[1], t),
      sourceId: span.sourceId,
      width: span.width,
    };
  };
  return { spans, ranges, length, at };
}

export interface VerticalProfile {
  length: number;
  height: (s: number) => number;
  grade: (s: number) => number;
  startGrade: number;
  endGrade: number;
  maxAbsoluteGrade: number;
  endpointGradesAdjusted: boolean;
}

/** Monotone cubic Hermite with a conservative Fritsch-Carlson slope limiter.
 * A requested boundary derivative must already be compatible with the secant
 * to remain exactly C1; callers can inspect endpointGradesAdjusted and reject.
 */
function cubicProfile(
  length: number,
  y0: number,
  y1: number,
  requestedM0: number,
  requestedM1: number,
  limitMonotone: boolean,
): VerticalProfile {
  if (!finite(length, y0, y1, requestedM0, requestedM1) || length <= 0)
    throw new Error('Invalid profile');
  const delta = (y1 - y0) / length;
  let m0 = requestedM0,
    m1 = requestedM1;
  if (limitMonotone && Math.abs(delta) < 1e-12) m0 = m1 = 0;
  else if (limitMonotone) {
    if (m0 / delta < 0) m0 = 0;
    if (m1 / delta < 0) m1 = 0;
    const norm = Math.hypot(m0 / delta, m1 / delta);
    if (norm > 3) {
      m0 *= 3 / norm;
      m1 *= 3 / norm;
    }
  }
  // y(t) = A*t^3 + B*t^2 + C*t + D
  const A = 2 * y0 - 2 * y1 + length * (m0 + m1);
  const B = -3 * y0 + 3 * y1 - length * (2 * m0 + m1);
  const C = length * m0;
  const height = (s: number) => {
    if (!Number.isFinite(s)) throw new Error('Non-finite chainage');
    if (s <= 0) return y0;
    if (s >= length) return y1;
    const t = s / length;
    return ((A * t + B) * t + C) * t + y0;
  };
  const grade = (s: number) => {
    if (!Number.isFinite(s)) throw new Error('Non-finite chainage');
    const t = clamp(s / length, 0, 1);
    return (3 * A * t * t + 2 * B * t + C) / length;
  };
  const extremum = Math.abs(A) > 1e-12 ? -B / (3 * A) : -1;
  const grades = [m0, m1];
  if (extremum > 0 && extremum < 1) grades.push(grade(extremum * length));
  return {
    length,
    height,
    grade,
    startGrade: m0,
    endGrade: m1,
    maxAbsoluteGrade: Math.max(...grades.map(Math.abs)),
    endpointGradesAdjusted:
      Math.abs(m0 - requestedM0) > 1e-12 || Math.abs(m1 - requestedM1) > 1e-12,
  };
}

export function monotoneProfile(
  length: number,
  y0: number,
  y1: number,
  m0: number,
  m1: number,
): VerticalProfile {
  return cubicProfile(length, y0, y1, m0, m1, true);
}

/** Matches the current approach renderer's final straight subsegment grade.
 * This does not refit/lift the 1.5 km central Causeway.
 */
export function currentIncomingGrade(
  way: SourceWay,
  project: Project,
  elevation: Elevation,
  joinedEnd: XZ,
  maxStepM = 15,
): number {
  const ps = way.geometry.coordinates.map(project);
  if (distance(ps[ps.length - 1], joinedEnd) > 1e-6) {
    if (distance(ps[0], joinedEnd) > 1e-6)
      throw new Error('Incoming way does not meet profile');
    ps.reverse();
  }
  const b = ps[ps.length - 1];
  let i = ps.length - 2;
  while (i >= 0 && distance(ps[i], b) < 1e-8) i--;
  if (i < 0 || maxStepM <= 0) throw new Error('Invalid incoming segment');
  const a = ps[i],
    len = distance(a, b),
    step = len / Math.ceil(len / maxStepM);
  const t = 1 - step / len;
  const x = mix(a[0], b[0], t),
    z = mix(a[1], b[1], t);
  return (elevation(b[0], b[1]) - elevation(x, z)) / step;
}

export interface NorthProfile {
  chain: Chain;
  vertical: VerticalProfile;
  sampleFeature: (
    sourceId: number,
    sourceChainage: number,
  ) => number | undefined;
}
export function createNorthCausewayProfile(
  ways: readonly SourceWay[],
  project: Project,
  elevation: Elevation,
  mainRoadTopY: number,
  incomingRenderStepM = 15,
): NorthProfile {
  const chain = createChain(ways, NORTH_WAY_IDS, project);
  const first = chain.at(0);
  const incoming = ways.find((w) => w.properties.sourceId === 257712148);
  if (!incoming) throw new Error('Missing central Causeway incoming tangent');
  const m0 = currentIncomingGrade(
    incoming,
    project,
    elevation,
    [first.x, first.z],
    incomingRenderStepM,
  );
  const vertical = monotoneProfile(
    chain.length,
    elevation(first.x, first.z) + ROAD_TOP_OFFSET_M,
    mainRoadTopY,
    m0,
    0,
  );
  if (vertical.endpointGradesAdjusted)
    throw new Error(
      'Incoming tangent incompatible; revise the local seam rather than silently break C1',
    );
  return {
    chain,
    vertical,
    sampleFeature(sourceId, sourceChainage) {
      const r = chain.ranges.get(sourceId);
      if (!r) return undefined; // all other Causeway ways remain unchanged
      if (!Number.isFinite(sourceChainage))
        throw new Error('Non-finite source chainage');
      const local = clamp(sourceChainage, 0, r.end - r.start);
      return vertical.height(r.reversed ? r.end - local : r.start + local);
    },
  };
}

export interface SurfaceSegment {
  a: XZ;
  b: XZ;
  h0: number;
  h1: number;
  width: number;
  s0: number;
  s1: number;
  sourceId: number;
  routeId: string;
  layer: number;
  surfaceId: string;
}

/** Single authoritative tessellation. Feed these exact endpoint Y values to
 * asphalt triangles, bridgeSurface registry, rail feet and path attachment.
 * Source vertices and source-way boundaries always remain segment endpoints.
 */
export function bakeSurface(
  chain: Chain,
  height: (s: number) => number,
  options: {
    maxStepM?: number;
    routeId: string;
    layer: number;
    surfaceId?: string;
  },
): SurfaceSegment[] {
  const maxStep = options.maxStepM ?? 5;
  if (!finite(maxStep, options.layer) || maxStep <= 0)
    throw new Error('Invalid surface options');
  const result: SurfaceSegment[] = [];
  for (const span of chain.spans) {
    const count = Math.ceil(span.length / maxStep);
    for (let i = 0; i < count; i++) {
      const t = i / count,
        u = (i + 1) / count;
      const s0 = span.start + span.length * t,
        s1 = span.start + span.length * u;
      const h0 = height(s0),
        h1 = height(s1);
      if (!finite(h0, h1)) throw new Error('Non-finite surface height');
      result.push({
        a: [mix(span.a[0], span.b[0], t), mix(span.a[1], span.b[1], t)],
        b: [mix(span.a[0], span.b[0], u), mix(span.a[1], span.b[1], u)],
        h0,
        h1,
        s0,
        s1,
        sourceId: span.sourceId,
        width: span.width,
        routeId: options.routeId,
        layer: options.layer,
        surfaceId: options.surfaceId ?? options.routeId,
      });
    }
  }
  return result;
}

/** Attach a KNOWN parallel path/rail to the baked road profile while preserving
 * its original XY. Explicit route+layer scope is mandatory: never call this
 * globally for every nearby path or the lower tunnel is raised into the road.
 */
export function sampleAttachedSurface(
  segments: readonly SurfaceSegment[],
  x: number,
  z: number,
  scope: {
    routeId: string;
    layer: number;
    maxDistanceM: number;
    topOffsetM?: number;
  },
):
  | {
      x: number;
      z: number;
      y: number;
      s: number;
      sourceId: number;
      distance: number;
    }
  | undefined {
  if (
    !finite(x, z, scope.maxDistanceM, scope.topOffsetM ?? 0) ||
    scope.maxDistanceM < 0
  )
    throw new Error('Invalid attachment query');
  let best: ReturnType<typeof sampleAttachedSurface>;
  const scoped = segments.filter(
    (seg) => seg.routeId === scope.routeId && seg.layer === scope.layer,
  );
  let routeStart = Infinity,
    routeEnd = -Infinity,
    bestIsBeyondRoute = false;
  for (const seg of scoped) {
    routeStart = Math.min(routeStart, seg.s0);
    routeEnd = Math.max(routeEnd, seg.s1);
  }
  for (const seg of scoped) {
    const dx = seg.b[0] - seg.a[0],
      dz = seg.b[1] - seg.a[1],
      len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) continue;
    const rawT = ((x - seg.a[0]) * dx + (z - seg.a[1]) * dz) / len2;
    // Internal vertex caps are needed on the outside of a curve. Reject only
    // if the nearest candidate lies beyond an ACTUAL route endpoint, otherwise
    // a known parallel path can develop holes between adjacent curved spans.
    const beyond =
      (rawT < -1e-9 && Math.abs(seg.s0 - routeStart) < 1e-8) ||
      (rawT > 1 + 1e-9 && Math.abs(seg.s1 - routeEnd) < 1e-8);
    const t = clamp(rawT, 0, 1);
    const d = Math.hypot(x - seg.a[0] - dx * t, z - seg.a[1] - dz * t);
    if (d > scope.maxDistanceM || (best && d >= best.distance)) continue;
    best = {
      x,
      z,
      y: mix(seg.h0, seg.h1, t) + (scope.topOffsetM ?? 0),
      s: mix(seg.s0, seg.s1, t),
      sourceId: seg.sourceId,
      distance: d,
    };
    bestIsBeyondRoute = beyond;
  }
  return bestIsBeyondRoute ? undefined : best;
}

export interface CrossingConstraint {
  upperChainage: number;
  lowerTopY: number;
  lowerPathId: number;
}
/** Required UNIFORM bridge-span lift for an explicitly chosen visual clearance.
 * This reports a value; it does not invent a surveyed engineering clearance.
 * Lower paths are never lifted by this function.
 */
export function requiredBridgeLift(
  bridgeBaseHeight: (s: number) => number,
  constraints: readonly CrossingConstraint[],
  headroomM: number,
  slabThicknessM: number,
): number {
  if (
    !finite(headroomM, slabThicknessM) ||
    headroomM <= 0 ||
    slabThicknessM < 0
  )
    throw new Error('Invalid clearance');
  return Math.max(
    0,
    ...constraints.map((c) => {
      const h = bridgeBaseHeight(c.upperChainage);
      if (!finite(h, c.upperChainage, c.lowerTopY))
        throw new Error('Invalid crossing');
      return c.lowerTopY + headroomM + slabThicknessM - h;
    }),
  );
}

/** A short bridge with TWO LOCAL APPROACH RAMPS. The window is in a connected
 * route's chainage, not one short OSM way. Requests outside it return undefined
 * so the caller uses original terrain. Shared graph nodes must be solved once
 * before building this profile; never add an independent bump to each way.
 */
export function createLocalBridgeWindow(p: {
  enter: number;
  bridgeStart: number;
  bridgeEnd: number;
  leave: number;
  enterTop: number;
  bridgeStartTop: number;
  bridgeEndTop: number;
  leaveTop: number;
  enterGrade: number;
  leaveGrade: number;
}) {
  const { enter, bridgeStart, bridgeEnd, leave } = p;
  if (
    ![
      enter,
      bridgeStart,
      bridgeEnd,
      leave,
      p.enterTop,
      p.bridgeStartTop,
      p.bridgeEndTop,
      p.leaveTop,
      p.enterGrade,
      p.leaveGrade,
    ].every(Number.isFinite) ||
    !(enter < bridgeStart && bridgeStart < bridgeEnd && bridgeEnd < leave)
  )
    throw new Error('Invalid local bridge window');
  const deckGrade =
    (p.bridgeEndTop - p.bridgeStartTop) / (bridgeEnd - bridgeStart);
  // Local ramps may have a crest/sag: preserve exact endpoint derivatives rather
  // than applying a monotone limiter that would introduce a sharp deck join.
  // maxAbsoluteGrade is mandatory review data; lengthen ramps if too steep.
  const approach = cubicProfile(
    bridgeStart - enter,
    p.enterTop,
    p.bridgeStartTop,
    p.enterGrade,
    deckGrade,
    false,
  );
  const departure = cubicProfile(
    leave - bridgeEnd,
    p.bridgeEndTop,
    p.leaveTop,
    deckGrade,
    p.leaveGrade,
    false,
  );
  return {
    height(s: number): number | undefined {
      if (!Number.isFinite(s)) throw new Error('Non-finite chainage');
      if (s < enter || s > leave) return undefined;
      if (s < bridgeStart) return approach.height(s - enter);
      if (s <= bridgeEnd)
        return mix(
          p.bridgeStartTop,
          p.bridgeEndTop,
          (s - bridgeStart) / (bridgeEnd - bridgeStart),
        );
      return departure.height(s - bridgeEnd);
    },
    grade(s: number): number | undefined {
      if (s < enter || s > leave) return undefined;
      if (s < bridgeStart) return approach.grade(s - enter);
      if (s <= bridgeEnd) return deckGrade;
      return departure.grade(s - bridgeEnd);
    },
    maxAbsoluteGrade: Math.max(
      approach.maxAbsoluteGrade,
      Math.abs(deckGrade),
      departure.maxAbsoluteGrade,
    ),
  };
}
