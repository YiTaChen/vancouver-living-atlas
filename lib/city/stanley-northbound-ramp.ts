/** Exact primary Park Drive -> northbound Causeway ramp. It owns one finite
 * ground entry, a physical green cycle crossing and the unchanged main join. */
import {
  buildCausewayGeometry,
  createCausewayTriangleLookup,
  type GroundPolygon,
  type GeometryResult,
  type Identity,
  type TopTriangle,
} from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { conformMergePaving } from './stanley-south-ramp';
import { forwardGate, type SurfaceConnection } from './surface-reachability';
import source from './stanley-northbound-ramp-source.json';
const ROUTE = 'stanley:northbound-motor-ramp',
  ID = { surfaceId: 'lions:road', layer: 1 },
  GROUND = { surfaceId: 'ground', layer: 0 },
  distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  smooth = (v: number) => {
    const t = Math.max(0, Math.min(1, v));
    return t * t * (3 - 2 * t);
  };
/** Exact finite segment separation keeps the entire entry gate outside the
 * retained Park road footprint, including its two ordinary traffic lanes. */
function segmentSeparation(a: XZ, b: XZ, c: XZ, d: XZ) {
  const pointDistance = (p: XZ, q: XZ, r: XZ) => {
    const dx = r[0] - q[0],
      dz = r[1] - q[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - q[0]) * dx + (p[1] - q[1]) * dz) / (dx * dx + dz * dz),
        ),
      );
    return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dz);
  };
  const cross = (p: XZ, q: XZ, r: XZ) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
function line(
  points: readonly XZ[],
  sourceId: number,
  width: number,
  routeId = ROUTE,
) {
  let station = 0;
  const spans: SurfaceSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const l = distance(points[i - 1], points[i]);
    spans.push({
      a: points[i - 1],
      b: points[i],
      h0: 0,
      h1: 0,
      s0: station,
      s1: station + l,
      width,
      sourceId,
      routeId,
      ...ID,
    });
    station += l;
  }
  return { spans, length: station };
}
function nearest(point: XZ, spans: readonly SurfaceSegment[]) {
  let best:
    | {
        distance: number;
        point: XZ;
        station: number;
        y: number;
        segment: SurfaceSegment;
      }
    | undefined;
  for (const s of spans) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      l2 = dx * dx + dz * dz,
      t = Math.max(
        0,
        Math.min(1, ((point[0] - s.a[0]) * dx + (point[1] - s.a[1]) * dz) / l2),
      ),
      p: XZ = [s.a[0] + dx * t, s.a[1] + dz * t],
      d = distance(point, p);
    if (!best || d < best.distance)
      best = {
        distance: d,
        point: p,
        station: s.s0 + (s.s1 - s.s0) * t,
        y: s.h0 + (s.h1 - s.h0) * t,
        segment: s,
      };
  }
  if (!best) throw new Error('Northbound ramp requires its explicit main road');
  return best;
}
function at(station: number, spans: readonly SurfaceSegment[]): XZ {
  const s = spans.find((s) => station <= s.s1 + 1e-7) ?? spans.at(-1)!,
    t = Math.max(0, Math.min(1, (station - s.s0) / (s.s1 - s.s0)));
  return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
}
function trace(spans: readonly SurfaceSegment[], from: number, to: number) {
  const sign = Math.sign(to - from),
    stations = [
      ...new Set([
        from,
        to,
        ...spans
          .flatMap((s) => [s.s0, s.s1])
          .filter((s) => sign * (s - from) > 0 && sign * (to - s) > 0),
      ]),
    ].sort((a, b) => (a - b) * sign);
  return stations.map((s) => at(s, spans));
}
export function prepareStanleyNorthboundRamp(options: {
  project: (coordinate: readonly number[]) => XZ;
  lowerSegments: readonly SurfaceSegment[];
  groundRoadTop: (x: number, z: number) => number;
}) {
  const ways = source.route.wayIds.map((id) =>
      source.ways.find((w) => w.id === id)!,
    ),
    points: XZ[] = [],
    spans: SurfaceSegment[] = [];
  let station = 0;
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i];
    if (
      !w ||
      w.tags.oneway !== 'yes' ||
      (i && ways[i - 1].nodeIds.at(-1) !== w.nodeIds[0])
    )
      throw new Error('Disconnected primary northbound motor ramp');
    const coordinates = w.coordinates.map(options.project);
    for (const p of coordinates)
      if (!points.length || distance(points.at(-1)!, p) > 1e-7) points.push(p);
    const current = line(coordinates, w.id, source.model.widthM);
    for (const s of current.spans)
      spans.push({ ...s, s0: s.s0 + station, s1: s.s1 + station });
    station += current.length;
  }
  const main = options.lowerSegments.filter(
      (s) =>
        s.routeId === 'causeway-north' &&
        source.route.lowerWayIds.includes(s.sourceId),
    ),
    mainGeometry = buildCausewayGeometry(
      options.lowerSegments.filter((s) => s.routeId === 'causeway-north'),
      { groundRoadTop: options.groundRoadTop, rails: false, paint: false },
    ),
    mainLookup = createCausewayTriangleLookup(mainGeometry),
    parkWay = source.relatedWays.find(
      (w) => w.id === source.route.parkMainWayId,
    )!,
    park = line(
      parkWay.coordinates.map(options.project),
      parkWay.id,
      6,
      'stanley:park-main-reference',
    ),
    start = points[0],
    end = points.at(-1)!,
    width = source.model.widthM,
    length = station,
    join = mainLookup.heightAt(...end, ID, 'road');
  if (!join || distance(nearest(end, main).point, end) > 0.001)
    throw new Error(
      'Northbound ramp must share its actual Causeway source node',
    );
  const planes = new Map<
    TopTriangle,
    { x: number; z: number; y: number; gx: number; gz: number }
  >();
  const extend = (t: TopTriangle, x: number, z: number) => {
    let p = planes.get(t);
    if (!p) {
      const [a, b, c] = mainLookup.vertices(t),
        d = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      p = {
        x: a[0],
        z: a[2],
        y: a[1],
        gx: ((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / d,
        gz: ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / d,
      };
      planes.set(t, p);
    }
    return p.y + p.gx * (x - p.x) + p.gz * (z - p.z);
  };
  const profileStart = source.model.verticalProfileStartM,
    profileEnd = length - source.model.verticalProfileEndBeforeJoinM,
    profileLength = profileEnd - profileStart,
    startPoint = at(profileStart, spans),
    endPoint = at(profileEnd, spans),
    startBefore = at(profileStart - 0.5, spans),
    startAfter = at(profileStart + 0.5, spans),
    endBefore = at(profileEnd - 0.5, spans),
    endAfter = at(profileEnd + 0.5, spans),
    startTangentLength = distance(startBefore, startAfter),
    startRight: XZ = [
      (startAfter[1] - startBefore[1]) / startTangentLength,
      -(startAfter[0] - startBefore[0]) / startTangentLength,
    ],
    startHeight = options.groundRoadTop(...startPoint),
    endHeight = extend(join.triangle, ...endPoint),
    startSlope =
      options.groundRoadTop(...startAfter) -
      options.groundRoadTop(...startBefore),
    endSlope =
      extend(join.triangle, ...endAfter) - extend(join.triangle, ...endBefore),
    startCross =
      options.groundRoadTop(
        startPoint[0] + startRight[0] * 0.5,
        startPoint[1] + startRight[1] * 0.5,
      ) -
      options.groundRoadTop(
        startPoint[0] - startRight[0] * 0.5,
        startPoint[1] - startRight[1] * 0.5,
      );
  if (!(profileLength > 20))
    throw new Error(
      'Northbound source profile requires a finite smoothing span',
    );
  const height = (x: number, z: number) => {
    const actual = mainLookup.heightAt(x, z, ID, 'road');
    if (actual) return actual.y;
    const n = nearest([x, z], spans),
      ground = options.groundRoadTop(x, z);
    if (!Number.isFinite(ground))
      throw new Error('Invalid northbound road datum');
    if (n.station <= profileStart) return ground;
    if (n.station >= profileEnd) return extend(join.triangle, x, z);
    const t = (n.station - profileStart) / profileLength,
      t2 = t * t,
      t3 = t2 * t,
      center =
        (2 * t3 - 3 * t2 + 1) * startHeight +
        (t3 - 2 * t2 + t) * profileLength * startSlope +
        (-2 * t3 + 3 * t2) * endHeight +
        (t3 - t2) * profileLength * endSlope,
      segmentLength = distance(n.segment.a, n.segment.b),
      right: XZ = [
        (n.segment.b[1] - n.segment.a[1]) / segmentLength,
        -(n.segment.b[0] - n.segment.a[0]) / segmentLength,
      ],
      lateral = (x - n.point[0]) * right[0] + (z - n.point[1]) * right[1],
      endCross =
        extend(
          join.triangle,
          n.point[0] + right[0] * 0.5,
          n.point[1] + right[1] * 0.5,
        ) -
        extend(
          join.triangle,
          n.point[0] - right[0] * 0.5,
          n.point[1] - right[1] * 0.5,
        ),
      crossBlend = smooth(t),
      rawFade = smooth((n.station - profileStart) / 8),
      groundCross = ground - options.groundRoadTop(...n.point),
      startOffset =
        groundCross * (1 - rawFade) + startCross * lateral * rawFade;
    return (
      center + startOffset * (1 - crossBlend) + endCross * lateral * crossBlend
    );
  };
  const segments: SurfaceSegment[] = [];
  for (const s of spans) {
    const count = Math.ceil((s.s1 - s.s0) / 1.5);
    for (let j = 0; j < count; j++) {
      const t = j / count,
        u = (j + 1) / count,
        a: XZ = [
          s.a[0] + (s.b[0] - s.a[0]) * t,
          s.a[1] + (s.b[1] - s.a[1]) * t,
        ],
        b: XZ = [
          s.a[0] + (s.b[0] - s.a[0]) * u,
          s.a[1] + (s.b[1] - s.a[1]) * u,
        ];
      segments.push({
        ...s,
        a,
        b,
        h0: height(...a),
        h1: height(...b),
        s0: s.s0 + (s.s1 - s.s0) * t,
        s1: s.s0 + (s.s1 - s.s0) * u,
      });
    }
  }
  const geometry = buildCausewayGeometry(segments, {
    shoulderWidthM: 0.01,
    shoulderRiseM: 0,
    slabDepthM: 0,
    bridgeSourceIds: new Set(),
    groundRoadTop: options.groundRoadTop,
    surfaceTop: (_route, x, z) => height(x, z),
    rails: false,
    paint: true,
    allowedModes: () => ['drive'],
  });
  conformMergePaving(geometry, mainGeometry, height);
  const lookup = createCausewayTriangleLookup(geometry),
    sections = new Map(geometry.sections.map((s) => [s.s, s])),
    terminal = segments.filter((s) => s.s1 > length - 40),
    openings: GroundPolygon[] = terminal.map((s) => {
      const a = sections.get(s.s0)!,
        b = sections.get(s.s1)!,
        l = distance(s.a, s.b),
        dx = (s.b[0] - s.a[0]) / l,
        dz = (s.b[1] - s.a[1]) / l,
        m = source.model.shoulderNumericalOverlapM;
      const edge = (v: typeof a, side: -1 | 1, endSide: -1 | 1): XZ => {
        const w = Math.hypot(v.right[0] - v.left[0], v.right[2] - v.left[2]),
          p = side < 0 ? v.left : v.right;
        return [
          p[0] + ((v.right[0] - v.left[0]) / w) * side * m + dx * endSide * m,
          p[2] + ((v.right[2] - v.left[2]) / w) * side * m + dz * endSide * m,
        ];
      };
      return {
        outer: [edge(a, -1, -1), edge(a, 1, -1), edge(b, 1, 1), edge(b, -1, 1)],
      };
    });
  const scope = (id: Identity) =>
      ((id.routeId === 'causeway-north' && id.sourceId === 325793279) ||
        (id.routeId === 'causeway-central' && id.sourceId === 257712148)) &&
      id.surfaceId === ID.surfaceId &&
      id.layer === ID.layer &&
      source.route.mergeShoulderWayIds.includes(id.sourceId),
    shoulderOpenings = (id: Identity): readonly GroundPolygon[] =>
      scope(id) ? openings : [],
    railAllowed = (id: Identity, x: number, z: number) =>
      !scope(id) ||
      nearest([x, z], terminal).distance >
        width / 2 + source.model.railClearanceMarginM;
  const first = spans[0],
    firstLength = distance(first.a, first.b),
    direction: XZ = [
      (first.b[0] - first.a[0]) / firstLength,
      (first.b[1] - first.a[1]) / firstLength,
    ];
  let entry: { point: XZ; station: number; height: number } | undefined;
  for (let s = 0; s < firstLength; s += 0.1) {
    const p: XZ = [
        first.a[0] + direction[0] * s,
        first.a[1] + direction[1] * s,
      ],
      gate = forwardGate(p, direction, width),
      clear = park.spans.every(
        (road) =>
          segmentSeparation(gate.a, gate.b, road.a, road.b) >
          road.width / 2 + 0.25,
      ),
      seamPoints = [gate.a, p, gate.b];
    if (
      clear &&
      seamPoints.every((q) => {
        const top = lookup.heightAt(...q, ID, 'road');
        return (
          top &&
          Math.abs(top.y - options.groundRoadTop(...q)) <=
            source.model.maxSeamStepM
        );
      })
    ) {
      entry = { point: p, station: s, height: height(...p) };
      break;
    }
  }
  if (!entry)
    throw new Error(
      'Northbound ramp requires a finite off-Park-main ground entry',
    );
  const connections: SurfaceConnection[] = [
    {
      id: 'stanley-northbound-legal-motor-ramp',
      from: GROUND,
      to: ID,
      twoWay: true,
      allowedModes: ['drive'],
      maxSeamStep: source.model.maxSeamStepM,
      geometry: forwardGate(entry.point, direction, width),
    },
  ];
  const parkStation = nearest(start, park.spans).station,
    prefix = trace(park.spans, parkStation - 20, parkStation),
    suffix = trace(main, 0, 20),
    fullRoute = [...prefix.slice(0, -1), ...points, ...suffix.slice(1)],
    qa = {
      points: fullRoute,
      width,
      sourceIds: [1693, ...source.route.wayIds],
      osmSourceIds: source.route.wayIds,
      identity: GROUND,
      reverseIdentity: ID,
    };
  const conformPathGeometry = (paths: GeometryResult) =>
    conformMergePaving(
      paths,
      geometry,
      height,
      new Set([source.route.crossingWayId]),
    );
  const pathTop = (sourceId: number, x: number, z: number, base: number) =>
    sourceId === source.route.crossingWayId
      ? (lookup.heightAt(x, z, ID, 'road')?.y ?? height(x, z))
      : base;
  return {
    points,
    segments,
    geometry,
    sourceIds: source.route.wayIds,
    length,
    width,
    connections,
    railAllowed,
    shoulderOpenings,
    pathTop,
    conformPathGeometry,
    shoulderSourceIds: source.route.mergeShoulderWayIds,
    verticalProfile: {
      kind: 'source-chainage Hermite to one unchanged actual join plane',
      startM: profileStart,
      endM: profileEnd,
      maxCenterGrade: Math.max(
        ...segments.map((s) => Math.abs(s.h1 - s.h0) / distance(s.a, s.b)),
      ),
    },
    entry,
    merge: end,
    groundEntry: {
      center: start,
      radiusM: 20,
      gateId: connections[0].id,
      from: GROUND,
      to: ID,
    },
    rampEntry: {
      center: end,
      radiusM: 20,
      lowerSourceIds: source.route.lowerWayIds,
      rampRouteId: ROUTE,
      crossingSourceId: source.route.crossingWayId,
      maxSeamStepM: source.model.maxSeamStepM,
    },
    routes: [{ id: 'stanley-northbound-legal-motor-ramp', ...qa }],
    qaRoutes: { northbound: qa },
  };
}
export type StanleyNorthboundRamp = ReturnType<
  typeof prepareStanleyNorthboundRamp
>;
