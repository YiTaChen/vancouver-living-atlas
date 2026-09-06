/** Original MIT. Bounded Causeway pedestrian connectors; no Three.js or scene state.
 * Source XY is immutable. Input Y values are FINAL asphalt top. A path top is
 * baked once and must feed geometry, support, rails and navigation together.
 */
import {
  createChain,
  bakeSurface,
  type Chain,
  type Elevation,
  type Project,
  type SourceWay,
  type SurfaceSegment,
  type XZ,
} from './causeway-profile';
import { cubicAlignment } from './south-profile';
import { createWalkwayAttachment } from './walkway-attachments';

export interface WalkSource extends SourceWay {
  properties: SourceWay['properties'] & {
    sourceNodeIds: readonly number[];
    sourceTags?: Record<string, string | undefined>;
    width?: number;
    widthM?: number;
    allowedModes?: readonly string[];
  };
}
export interface WalkSourceJSON {
  features: readonly WalkSource[];
}
export interface EndpointGate {
  id: string;
  nodeId: number;
  coordinate: readonly number[];
  point: XZ;
  topY: number;
  routeId: string;
  surfaceId: string;
  layer: 1;
  allowedModes: readonly ['walk'];
  neighborSourceId: number;
  neighborSurfaceId: 'ground';
  neighborLayer: 0;
  neighborNodeIsInterior: boolean;
  radiusM: number;
  maximumStepM: number;
}
export interface WalkJoin {
  nodeId: number;
  coordinate: readonly number[];
  point: XZ;
  topY: number;
  fromSourceId: number;
  toSourceId: number;
  fromSurfaceId: string;
  toSurfaceId: string;
  /** A shared node is not permission to traverse a foot=no branch. */
  allowedModes: readonly ['walk'];
}
export interface SupportSample {
  inputIndex: number;
  sourceId: number;
  routeId: string;
  point: XZ;
  topY: number;
  slabDepthM: number;
  groundY: number;
  undersideAboveGroundM: number;
  supportRequired: boolean;
  /** Segment ribbon footprint; renderer must additionally account for its miter joins. */
  footprint: XZ[];
  policy: 'slab-only-no-embankment';
}
const SOUTH_IDS = [363686510, 70954677, 1277976049] as const;
const WEST_IDS = [70954679, 1349155154, 1349155147] as const;
const UPPER_ROAD_IDS = [
  44032485, 257712148, 325793279, 70954678, 1252160596, 70954663, 475320408,
  4755915,
] as const;
const EAST_ROAD_IDS = [
  363651505, 44032487, 74233348, 44032490, 363693708, 363693711, 690349457,
  44032488, 44032489,
] as const;
export const BLOCKED_IMPLICIT_PATH_IDS = [120254690, 975314385] as const;
const finite = (...v: number[]) => v.every(Number.isFinite);
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const point = (c: Chain, s: number): XZ => {
  const p = c.at(s);
  return [p.x, p.z];
};
const key = (p: XZ) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

/** Joins an explicitly whitelisted road chain, resetting per-route chainages.
 * This handles source257712148 split between the solved south window and the
 * unchanged central road. Disconnected, branched or duplicate road inputs fail.
 */
function roadChain(
  segments: readonly SurfaceSegment[],
  ids: readonly number[],
) {
  const selected = segments
    .filter(
      (s) =>
        ids.includes(s.sourceId) &&
        s.surfaceId === 'lions:road' &&
        s.layer === 1,
    )
    .map((s) => ({ ...s, h0: Math.fround(s.h0), h1: Math.fround(s.h1) }));
  for (const id of ids)
    if (!selected.some((s) => s.sourceId === id))
      throw new Error(`Missing final upper road source ${id}`);
  const next = new Map<string, SurfaceSegment>(),
    ends = new Set(selected.map((s) => key(s.b)));
  for (const s of selected) {
    if (next.has(key(s.a)))
      throw new Error('Duplicate/branched upper road tessellation');
    next.set(key(s.a), s);
  }
  const starts = selected.filter((s) => !ends.has(key(s.a)));
  if (starts.length !== 1)
    throw new Error('Upper road must be a contiguous directed source chain');
  const out: SurfaceSegment[] = [];
  let current: SurfaceSegment | undefined = starts[0],
    station = 0;
  while (current) {
    const s = current,
      prev = out.at(-1),
      length = distance(s.a, s.b);
    if (!finite(...s.a, ...s.b, s.h0, s.h1, length) || length < 1e-8)
      throw new Error('Invalid final road segment');
    if (
      prev &&
      (distance(prev.b, s.a) > 1e-6 || Math.abs(prev.h1 - s.h0) > 1e-6)
    )
      throw new Error('Unresolved final road XYZ seam');
    out.push({ ...s, s0: station, s1: station + length });
    station += length;
    current = next.get(key(s.b));
    if (out.length > selected.length) throw new Error('Cyclic upper road');
  }
  if (out.length !== selected.length)
    throw new Error('Disconnected final upper road');
  return out;
}
function checkedSources(json: WalkSourceJSON) {
  const map = new Map<number, WalkSource>();
  for (const f of json.features) {
    const id = f.properties.sourceId,
      prior = map.get(id);
    if (
      prior &&
      JSON.stringify(prior.geometry.coordinates) !==
        JSON.stringify(f.geometry.coordinates)
    )
      throw new Error(`Conflicting source XY ${id}`);
    if (f.properties.sourceNodeIds.length !== f.geometry.coordinates.length)
      throw new Error(`Source node/XY mismatch ${id}`);
    map.set(id, f);
  }
  const required = [
    ...SOUTH_IDS,
    ...WEST_IDS,
    116061622,
    120254725,
    70954671,
    70954672,
  ];
  for (const id of required)
    if (!map.has(id)) throw new Error(`Missing source path ${id}`);
  for (const id of [...SOUTH_IDS, ...WEST_IDS])
    if (map.get(id)!.properties.sourceTags?.foot === 'no')
      throw new Error(`Source ${id} does not permit walking`);
  return map;
}
function sharedNode(a: WalkSource, b: WalkSource, node: number) {
  const i = a.properties.sourceNodeIds.indexOf(node),
    j = b.properties.sourceNodeIds.indexOf(node);
  if (
    i < 0 ||
    j < 0 ||
    JSON.stringify(a.geometry.coordinates[i]) !==
      JSON.stringify(b.geometry.coordinates[j])
  )
    throw new Error(`Missing exact shared source node ${node}`);
  return a.geometry.coordinates[i];
}
export interface UpperWalkwayOptions {
  roadSegments: readonly SurfaceSegment[];
  elevation: Elevation;
  project: Project;
  sources: WalkSourceJSON;
  maxStepM?: number;
  /** Defaults match the current engine's northernCausewayWalkways identities. */
  eastWalkSurfaceId?: string;
  westMainWalkSurfaceId?: string;
  /** Optional exact existing ground-mesh datum at the two verified source nodes. */
  groundPathTop?: Elevation;
}
export function createUpperWalkwayProfiles(options: UpperWalkwayOptions) {
  const { roadSegments, elevation, project } = options,
    step = options.maxStepM ?? 3;
  if (!finite(step) || step <= 0 || step > 3)
    throw new Error('Upper connectors require a tessellation step in (0,3]m');
  const source = checkedSources(options.sources),
    features = [...source.values()].map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        roadWidthM:
          f.properties.roadWidthM ??
          f.properties.widthM ??
          f.properties.width ??
          (f.properties.sourceTags?.highway === 'footway' ? 3 : 4),
      },
    }));
  const eastSurface = options.eastWalkSurfaceId ?? 'lions:east-walk';
  const westMainSurface = options.westMainWalkSurfaceId ?? 'lions:west-upper';
  const get = (id: number) => source.get(id)!;
  const south = createChain(features, SOUTH_IDS, project),
    west = createChain(features, WEST_IDS, project, true);
  const eastRoad = roadChain(roadSegments, EAST_ROAD_IDS),
    upperRoad = roadChain(roadSegments, UPPER_ROAD_IDS);
  const eastAttach = createWalkwayAttachment(eastRoad, {
    maxDistanceM: 15,
    topOffsetM: 0.13,
  });
  const upperAttach = createWalkwayAttachment(upperRoad, {
    maxDistanceM: 22,
    endpointAllowanceM: 0.12,
    topOffsetM: 0.13,
  });
  const attach = (chain: Chain, s: number, kind: 'east' | 'upper') => {
    const p = point(chain, s),
      hit = (kind === 'east' ? eastAttach : upperAttach)(...p);
    if (!hit)
      throw new Error(`Unbound explicit ${kind} path attachment at ${s}`);
    return hit.y;
  };
  const ground =
    options.groundPathTop ?? ((x: number, z: number) => elevation(x, z) + 1.5);
  const b = south.ranges.get(70954677)!,
    southStart = ground(...point(south, 0));
  // Use exact current bridge tessellation to set approach endpoint derivatives.
  const bridgeChain = createChain(features, [70954677], project);
  const bridge = bakeSurface(
    bridgeChain,
    (s) => attach(bridgeChain, s, 'east'),
    { maxStepM: step, routeId: 'bridge', layer: 1 },
  );
  const bridgeStart = bridge[0].h0,
    bridgeEnd = bridge.at(-1)!.h1;
  const firstGrade =
    (bridge[0].h1 - bridge[0].h0) / (bridge[0].s1 - bridge[0].s0);
  const lastGrade =
    (bridge.at(-1)!.h1 - bridge.at(-1)!.h0) /
    (bridge.at(-1)!.s1 - bridge.at(-1)!.s0);
  const previous = get(116061622),
    previousPoints = previous.geometry.coordinates.map(project),
    prevEnd = previousPoints.at(-1)!;
  if (distance(prevEnd, point(south, 0)) > 1e-6)
    throw new Error('Southern ground path does not meet exact source endpoint');
  const prev = previousPoints.at(-2)!,
    groundGrade =
      (ground(...prevEnd) - ground(...prev)) / distance(prevEnd, prev);
  const northPath = createChain(features, [70954671], project),
    nextSpan = northPath.spans[0];
  const nextStep = nextSpan.length / Math.ceil(nextSpan.length / step),
    southEnd = attach(northPath, 0, 'upper');
  const nextGrade =
    (attach(northPath, nextStep, 'upper') - southEnd) / nextStep;
  const southBefore = cubicAlignment([
    { sM: 0, topY: southStart, grade: groundGrade },
    { sM: b.start, topY: bridgeStart, grade: firstGrade },
  ]);
  // Two quadratic-height halves share one derivative. This avoids a single
  // cubic's .036 percentage-point slope overshoot while keeping BOTH exact
  // endpoint tangents; it does not modify the clearance-critical bridge.
  const afterLength = south.length - b.end,
    midGrade =
      (2 * (southEnd - bridgeEnd)) / afterLength - (lastGrade + nextGrade) / 2;
  const southAfter = cubicAlignment([
    { sM: b.end, topY: bridgeEnd, grade: lastGrade },
    {
      sM: b.end + afterLength / 2,
      topY: bridgeEnd + ((lastGrade + midGrade) * afterLength) / 4,
      grade: midGrade,
    },
    { sM: south.length, topY: southEnd, grade: nextGrade },
  ]);
  const southHeight = (s: number) =>
    s < b.start
      ? southBefore.height(s)!
      : s > b.end
        ? southAfter.height(s)!
        : attach(south, s, 'east');
  // The actual zebra crossing and short west footway retain exact road attachment
  // at their shared nodes. Only full70954679 is a local ground-to-deck profile.
  const w = west.ranges.get(70954679)!,
    westStart = ground(...point(west, 0));
  const westEnd = attach(west, west.length, 'upper'),
    westRampEnd = attach(west, w.end, 'upper');
  const nextWest = west.spans.find((s) => s.start >= w.end - 1e-7)!;
  const westNextStep = nextWest.length / Math.ceil(nextWest.length / step);
  const westEndGrade =
    (attach(west, w.end + westNextStep, 'upper') - westRampEnd) / westNextStep;
  const westRamp = cubicAlignment([
    { sM: 0, topY: westStart, grade: 0 },
    { sM: w.end, topY: westRampEnd, grade: westEndGrade },
  ]);
  const westHeight = (s: number) =>
    s < w.end ? westRamp.height(s)! : attach(west, s, 'upper');
  const routes = [
    {
      routeId: 'lions:south:walk-entry',
      surfaceId: eastSurface,
      allowedModes: ['walk'] as const,
      chain: south,
      height: southHeight,
      curves: [southBefore, southAfter],
    },
    {
      routeId: 'lions:west:walk-entry',
      surfaceId: 'lions:west:walk-entry',
      allowedModes: ['walk'] as const,
      chain: west,
      height: westHeight,
      curves: [westRamp],
    },
  ];
  for (const r of routes)
    if (r.curves.some((c) => c.maxAbsoluteGrade > 0.060001))
      throw new Error(`Connector exceeds 6 percent design grade: ${r.routeId}`);
  const segments = routes.flatMap((r) =>
    bakeSurface(r.chain, r.height, {
      maxStepM: step,
      routeId: r.routeId,
      surfaceId: r.surfaceId,
      layer: 1,
    }),
  );
  const joins: WalkJoin[] = [];
  function join(
    from: number,
    to: number,
    node: number,
    topY: number,
    fromSurfaceId: string,
    toSurfaceId: string,
  ) {
    const coordinate = sharedNode(get(from), get(to), node),
      p = project(coordinate);
    joins.push({
      nodeId: node,
      coordinate,
      point: p,
      topY,
      fromSourceId: from,
      toSourceId: to,
      fromSurfaceId,
      toSurfaceId,
      allowedModes: ['walk'],
    });
  }
  join(
    363686510,
    70954677,
    845618424,
    bridgeStart,
    routes[0].surfaceId,
    routes[0].surfaceId,
  );
  join(
    70954677,
    1277976049,
    845618474,
    bridgeEnd,
    routes[0].surfaceId,
    routes[0].surfaceId,
  );
  join(
    1277976049,
    70954671,
    11863825732,
    southEnd,
    routes[0].surfaceId,
    routes[0].surfaceId,
  );
  join(
    70954679,
    1349155154,
    12479914690,
    westRampEnd,
    routes[1].surfaceId,
    routes[1].surfaceId,
  );
  join(
    1349155154,
    1349155147,
    12479914695,
    attach(west, west.ranges.get(1349155154)!.end, 'upper'),
    routes[1].surfaceId,
    routes[1].surfaceId,
  );
  join(
    1349155147,
    70954672,
    4890367275,
    westEnd,
    routes[1].surfaceId,
    westMainSurface,
  );
  // The separately mapped pedestrian crossing shares this exact node; the
  // neighboring foot=no cycleway1349155151 receives no permission.
  if (
    source.has(1349155153) &&
    get(1349155153).properties.allowedModes?.includes('walk')
  )
    join(
      1349155154,
      1349155153,
      12479914695,
      attach(west, west.ranges.get(1349155154)!.end, 'upper'),
      routes[1].surfaceId,
      westMainSurface,
    );
  const gates: EndpointGate[] = [];
  function gate(
    route: (typeof routes)[number],
    node: number,
    from: number,
    neighbor: number,
    topY: number,
  ) {
    const coordinate = sharedNode(get(from), get(neighbor), node),
      point = project(coordinate),
      index = get(neighbor).properties.sourceNodeIds.indexOf(node);
    gates.push({
      id: `${route.routeId}:ground`,
      nodeId: node,
      coordinate,
      point,
      topY,
      routeId: route.routeId,
      surfaceId: route.surfaceId,
      layer: 1,
      allowedModes: ['walk'],
      neighborSourceId: neighbor,
      neighborSurfaceId: 'ground',
      neighborLayer: 0,
      neighborNodeIsInterior:
        index > 0 && index < get(neighbor).properties.sourceNodeIds.length - 1,
      radiusM: 0.6,
      maximumStepM: 0.02,
    });
  }
  gate(routes[0], 12482619447, 363686510, 116061622, southStart);
  gate(routes[1], 1348815783, 70954679, 120254725, westStart);
  const supports: SupportSample[] = segments.map((s, inputIndex) => {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length = Math.hypot(dx, dz),
      nx = ((dz / length) * s.width) / 2,
      nz = ((-dx / length) * s.width) / 2;
    const p: XZ = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2],
      topY = (s.h0 + s.h1) / 2,
      groundY = elevation(...p),
      slabDepthM = s.sourceId === 70954677 ? 0.75 : 0.3;
    return {
      inputIndex,
      sourceId: s.sourceId,
      routeId: s.routeId,
      point: p,
      topY,
      slabDepthM,
      groundY,
      undersideAboveGroundM: topY - slabDepthM - groundY,
      supportRequired: topY - slabDepthM - groundY > 0.5,
      footprint: [
        [s.a[0] - nx, s.a[1] - nz],
        [s.a[0] + nx, s.a[1] + nz],
        [s.b[0] + nx, s.b[1] + nz],
        [s.b[0] - nx, s.b[1] - nz],
      ],
      policy: 'slab-only-no-embankment',
    };
  });
  const report = routes.map((r) => {
    const local = segments.filter((s) => s.routeId === r.routeId),
      support = supports.filter((s) => s.routeId === r.routeId);
    return {
      routeId: r.routeId,
      surfaceId: r.surfaceId,
      lengthM: r.chain.length,
      sourceIds: [...r.chain.ranges.keys()],
      startTopY: local[0].h0,
      endTopY: local.at(-1)!.h1,
      maxBakedGrade: Math.max(
        ...local.map((s) => Math.abs(s.h1 - s.h0) / (s.s1 - s.s0)),
      ),
      maxAnalyticApproachGrade: Math.max(
        ...r.curves.map((c) => c.maxAbsoluteGrade),
      ),
      maxUndersideAboveGroundM: Math.max(
        ...support.map((s) => s.undersideAboveGroundM),
      ),
    };
  });
  return {
    segments,
    routes,
    joins,
    groundEndpointGates: gates,
    supports,
    report,
    excludedGroundSourceIds: [...SOUTH_IDS, ...WEST_IDS],
    blockedImplicitPathIds: [...BLOCKED_IMPLICIT_PATH_IDS],
    /** Native source-way chainage; undefined outside these SIX explicit sources. */
    sampleFeature(sourceId: number, s: number): number | undefined {
      if (!finite(s)) return undefined;
      for (const r of routes) {
        const range = r.chain.ranges.get(sourceId);
        if (!range) continue;
        if (s < 0 || s > range.end - range.start) return undefined;
        const station = range.reversed ? range.end - s : range.start + s;
        const seg = segments.find(
          (v) =>
            v.routeId === r.routeId &&
            v.sourceId === sourceId &&
            station >= v.s0 - 1e-8 &&
            station <= v.s1 + 1e-8,
        );
        return seg
          ? seg.h0 +
              (seg.h1 - seg.h0) *
                Math.min(1, Math.max(0, (station - seg.s0) / (seg.s1 - seg.s0)))
          : undefined;
      }
      return undefined;
    },
  };
}
