/** LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Original pure evaluator for the jointly solved southern Causeway.
 * JSON is a versioned data asset. This module does not mutate terrain or source XY.
 * Use the baked segments for BOTH renderer and registry; curve queries are design
 * values, never a second independently sampled navigation surface.
 */
import {
  createChain,
  type SourceWay,
  type Project,
  type SurfaceSegment,
} from './causeway-profile';

export interface Knot {
  sM: number;
  topY: number;
  grade: number;
}
export interface RouteData {
  id: string;
  lengthM: number;
  ranges: {
    sourceId: number;
    start: number;
    end: number;
    sourceLength: number;
    reversed: boolean;
  }[];
  knots: Knot[];
}
export interface SouthData {
  schemaVersion: number;
  features: SourceWay[];
  routes: RouteData[];
  lowerPathIds: number[];
  bikeTieIn: {
    sourceId: number;
    coordinates: number[][];
    lengthM: number;
    startTopY: number;
    endTopY: number;
    startGrade: number;
    endGrade: number;
    roadJoin: { route: string; sM: number };
  };
}
const near = (a: number, b: number, eps = 1e-7) => Math.abs(a - b) <= eps;
const finite = (...n: number[]) => n.every(Number.isFinite);

/** C1 piecewise Hermite. Outside the closed design window returns undefined. */
export function cubicAlignment(knots: readonly Knot[]) {
  if (
    knots.length < 2 ||
    knots.some(
      (k, i) =>
        !finite(k.sM, k.topY, k.grade) || (i > 0 && k.sM <= knots[i - 1].sM),
    )
  )
    throw new Error('Invalid cubic alignment');
  const curves = knots.slice(1).map((b, i) => {
    const a = knots[i],
      length = b.sM - a.sM;
    return {
      start: a.sM,
      end: b.sM,
      length,
      y0: a.topY,
      A: 2 * a.topY - 2 * b.topY + length * (a.grade + b.grade),
      B: -3 * a.topY + 3 * b.topY - length * (2 * a.grade + b.grade),
      C: length * a.grade,
    };
  });
  const find = (s: number) => {
    if (!Number.isFinite(s)) throw new Error('Invalid chainage');
    if (s < knots[0].sM - 1e-9 || s > knots.at(-1)!.sM + 1e-9) return undefined;
    return curves.find((c) => s <= c.end + 1e-9) ?? curves.at(-1)!;
  };
  const height = (s: number): number | undefined => {
    const c = find(s);
    if (!c) return undefined;
    const t = Math.min(1, Math.max(0, (s - c.start) / c.length));
    return ((c.A * t + c.B) * t + c.C) * t + c.y0;
  };
  const grade = (s: number): number | undefined => {
    const c = find(s);
    if (!c) return undefined;
    const t = Math.min(1, Math.max(0, (s - c.start) / c.length));
    return (3 * c.A * t * t + 2 * c.B * t + c.C) / c.length;
  };
  let maxAbsoluteGrade = 0;
  for (const c of curves) {
    for (const t of [
      0,
      1,
      ...(Math.abs(c.A) > 1e-12 && -c.B / (3 * c.A) > 0 && -c.B / (3 * c.A) < 1
        ? [-c.B / (3 * c.A)]
        : []),
    ]) {
      maxAbsoluteGrade = Math.max(
        maxAbsoluteGrade,
        Math.abs((3 * c.A * t * t + 2 * c.B * t + c.C) / c.length),
      );
    }
  }
  return { height, grade, maxAbsoluteGrade, curves };
}

export interface SouthOptions {
  /** Current Stage2 12m roadRelief +1.05; validate BEFORE makeRoads. No silent offset. */
  groundRoadTop?: (x: number, z: number) => number;
  /** Existing live bridges/path ways override corresponding frozen input. */
  liveSourceWays?: readonly SourceWay[];
}
export function createSouthCausewayNetwork(
  data: SouthData,
  project: Project,
  maxStepM = 3,
  options: SouthOptions = {},
) {
  if (
    data.schemaVersion !== 1 ||
    !(Number.isFinite(maxStepM) && maxStepM > 0 && maxStepM <= 5)
  )
    throw new Error('Unsupported data or step (0,5]m');
  const sourceMap = new Map(
    data.features.map((f) => [f.properties.sourceId, f]),
  );
  for (const f of options.liveSourceWays ?? [])
    if (sourceMap.has(f.properties.sourceId))
      sourceMap.set(f.properties.sourceId, f);
  const routes = data.routes.map((info) => {
    const chain = createChain(
      [...sourceMap.values()],
      info.ranges.map((r) => r.sourceId),
      project,
      info.ranges[0].reversed,
    );
    if (
      info.lengthM > chain.length + 1e-7 ||
      !near(info.knots[0].sM, 0) ||
      !near(info.knots.at(-1)!.sM, info.lengthM)
    )
      throw new Error(`Bad window ${info.id}`);
    for (const expected of info.ranges) {
      const actual = chain.ranges.get(expected.sourceId)!;
      if (
        actual.reversed !== expected.reversed ||
        !near(actual.start, expected.start) ||
        !near(actual.end - actual.start, expected.sourceLength)
      )
        throw new Error(`Changed geographic source ${expected.sourceId}`);
    }
    const vertical = cubicAlignment(info.knots);
    if (vertical.maxAbsoluteGrade > 0.060001)
      throw new Error(`Unsafe display slope ${info.id}`);
    return { info, chain, vertical };
  });
  // Check that data edits cannot silently separate fork heights.
  const east = routes.find((r) => r.info.id === 'east'),
    west = routes.find((r) => r.info.id === 'west'),
    shared = routes.find((r) => r.info.id === 'shared');
  if (!east || !west || !shared) throw new Error('Missing network branch');
  for (const getter of ['height', 'grade'] as const) {
    if (
      !near(east.vertical[getter](0)!, west.vertical[getter](0)!) ||
      !near(
        east.vertical[getter](east.info.lengthM)!,
        west.vertical[getter](west.info.lengthM)!,
      ) ||
      !near(
        east.vertical[getter](east.info.lengthM)!,
        shared.vertical[getter](0)!,
      )
    )
      throw new Error('Disconnected profile at a shared node');
  }
  const park = routes.find((r) => r.info.id === 'park-access');
  if (park) {
    const eastFork = east.info.ranges.find(
      (r) => r.sourceId === 363651505,
    )!.end;
    for (const field of ['height', 'grade'] as const)
      if (!near(park.vertical[field](0)!, east.vertical[field](eastFork)!))
        throw new Error('Disconnected park access fork');
  }
  if (options.groundRoadTop) {
    const p = east.chain.at(0),
      actual = options.groundRoadTop(p.x, p.z);
    if (
      !Number.isFinite(actual) ||
      !near(actual, east.vertical.height(0)!, 0.005)
    )
      throw new Error(
        'City ground datum changed; regenerate joint data, do not shift upper roads or lower paths',
      );
  }
  // Common authoritative tessellation: original XY vertices AND all cubic
  // breakpoints, then <=3m spacing. No shortcut chords through road bends.
  const segments: SurfaceSegment[] = [];
  for (const route of routes) {
    const { chain, info, vertical } = route;
    for (const span of chain.spans) {
      if (span.start >= info.lengthM - 1e-9) break;
      const end = Math.min(info.lengthM, span.start + span.length);
      const breaks = [
        span.start,
        ...info.knots
          .map((k) => k.sM)
          .filter((s) => s > span.start + 1e-8 && s < end - 1e-8),
        end,
      ];
      for (let k = 1; k < breaks.length; k++) {
        const a = breaks[k - 1],
          b = breaks[k],
          count = Math.ceil((b - a) / maxStepM);
        for (let j = 0; j < count; j++) {
          const s0 = a + ((b - a) * j) / count,
            s1 = a + ((b - a) * (j + 1)) / count;
          const xy = (s: number): [number, number] => {
            const t = (s - span.start) / span.length;
            return [
              span.a[0] + (span.b[0] - span.a[0]) * t,
              span.a[1] + (span.b[1] - span.a[1]) * t,
            ];
          };
          segments.push({
            a: xy(s0),
            b: xy(s1),
            h0: vertical.height(s0)!,
            h1: vertical.height(s1)!,
            width: span.width,
            s0,
            s1,
            sourceId: span.sourceId,
            routeId: `causeway-south-${info.id}`,
            layer: 1,
            surfaceId: `causeway-south-${info.id}`,
          });
        }
      }
    }
  }
  const sampleFeature = (
    sourceId: number,
    sourceChainageM: number,
  ): number | undefined => {
    if (!finite(sourceChainageM)) throw new Error('Invalid source chainage');
    for (const route of routes) {
      const range = route.info.ranges.find((r) => r.sourceId === sourceId);
      if (!range || sourceChainageM < 0 || sourceChainageM > range.sourceLength)
        continue;
      const s =
        range.start +
        (range.reversed
          ? range.sourceLength - sourceChainageM
          : sourceChainageM);
      return route.vertical.height(s);
    }
    return undefined;
  };
  return { routes, segments, sampleFeature };
}
