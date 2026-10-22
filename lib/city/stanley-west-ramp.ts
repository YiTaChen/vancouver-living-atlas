/** Primary-source motor exit from the lower Causeway to Park Drive's upper
 * northern approach. Public coordinates and both existing road datums stay fixed. */
import {
  buildCausewayGeometry,
  createCausewayTriangleLookup,
  type GeometryResult,
  type GroundPolygon,
  type Identity,
} from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { conformMergePaving } from './stanley-south-ramp';
import { forwardGate, type SurfaceConnection } from './surface-reachability';
import source from './stanley-west-ramp-source.json';

const ROUTE = 'stanley:west-motor-ramp',
  UPPER = 'park:prospect-overpass',
  lowerIds = new Set(source.route.lowerWayIds),
  distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
function nearest(point: XZ, segments: readonly SurfaceSegment[]) {
  let best:
    | {
        distance: number;
        point: XZ;
        y: number;
        station: number;
        segment: SurfaceSegment;
      }
    | undefined;
  for (const s of segments) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      l2 = dx * dx + dz * dz;
    if (l2 < 1e-9) continue;
    const t = Math.max(
        0,
        Math.min(1, ((point[0] - s.a[0]) * dx + (point[1] - s.a[1]) * dz) / l2),
      ),
      q: XZ = [s.a[0] + dx * t, s.a[1] + dz * t],
      d = distance(point, q);
    if (!best || d < best.distance)
      best = {
        distance: d,
        point: q,
        y: s.h0 + (s.h1 - s.h0) * t,
        station: s.s0 + (s.s1 - s.s0) * t,
        segment: s,
      };
  }
  if (!best)
    throw new Error('West ramp requires its explicit existing road datum');
  return best;
}
export function prepareStanleyWestRamp(options: {
  project: (coordinate: readonly number[]) => XZ;
  lowerSegments: readonly SurfaceSegment[];
  upperGeometry: GeometryResult;
  groundRoadTop: (x: number, z: number) => number;
}) {
  const lower = options.lowerSegments.filter(
      (s) => s.routeId === 'causeway-north',
    ),
    upper = options.upperGeometry.perSegment.map((s) => s.segment),
    lowerGeometry = buildCausewayGeometry(lower, {
      groundRoadTop: options.groundRoadTop,
      rails: false,
      paint: false,
    }),
    lowerLookup = createCausewayTriangleLookup(lowerGeometry),
    upperLookup = createCausewayTriangleLookup(options.upperGeometry),
    lowerIdentity = { surfaceId: 'lions:road', layer: 1 },
    upperIdentity = { surfaceId: UPPER, layer: 2 },
    ways = source.route.wayIds.map((id) =>
      source.ways.find((w) => w.id === id)!,
    );
  for (let i = 0; i < ways.length; i++)
    if (
      !ways[i] ||
      ways[i].tags.oneway !== 'yes' ||
      (i && ways[i - 1].nodeIds.at(-1) !== ways[i].nodeIds[0])
    )
      throw new Error('Invalid/disconnected source-owned West motor exit');
  const points: XZ[] = [],
    spans: SurfaceSegment[] = [];
  let station = 0;
  for (const way of ways) {
    const coordinates = way.coordinates.map(options.project);
    for (const p of coordinates)
      if (!points.length || distance(points.at(-1)!, p) > 1e-7) points.push(p);
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1],
        b = coordinates[i],
        length = distance(a, b);
      spans.push({
        a,
        b,
        h0: 0,
        h1: 0,
        s0: station,
        s1: station + length,
        width: source.model.widthM,
        sourceId: way.id,
        routeId: ROUTE,
        ...upperIdentity,
      });
      station += length;
    }
  }
  const length = station,
    start = points[0],
    end = points.at(-1)!,
    lowerStart = lowerLookup.heightAt(...start, lowerIdentity, 'road'),
    upperEnd = upperLookup.heightAt(...end, upperIdentity, 'road');
  if (!lowerStart || !upperEnd)
    throw new Error(
      'West motor exit must share actual lower and upper asphalt',
    );
  const at = (station: number): XZ => {
    const s = spans.find((s) => station <= s.s1 + 1e-7) ?? spans.at(-1)!,
      t = Math.max(0, Math.min(1, (station - s.s0) / (s.s1 - s.s0)));
    return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
  };
  const [a, b, c] = upperLookup.vertices(upperEnd.triangle),
    det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]),
    gx = ((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / det,
    gz = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / det,
    endPlane = (x: number, z: number) =>
      a[1] + gx * (x - a[0]) + gz * (z - a[2]),
    profileStart = length - source.model.endBlendLengthM,
    profileEnd = length - source.model.endBlendReserveM,
    profileLength = profileEnd - profileStart,
    profileStartY = options.groundRoadTop(...at(profileStart)),
    profileEndY = endPlane(...at(profileEnd)),
    profileStartSlope =
      options.groundRoadTop(...at(profileStart + 0.5)) -
      options.groundRoadTop(...at(profileStart - 0.5)),
    profileEndSlope =
      endPlane(...at(profileEnd + 0.5)) - endPlane(...at(profileEnd - 0.5));
  const profile = (station: number) => {
    const t = Math.max(
        0,
        Math.min(1, (station - profileStart) / profileLength),
      ),
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * profileStartY +
      (t3 - 2 * t2 + t) * profileLength * profileStartSlope +
      (-2 * t3 + 3 * t2) * profileEndY +
      (t3 - t2) * profileLength * profileEndSlope
    );
  };
  const height = (x: number, z: number) => {
    const p: XZ = [x, z],
      s = nearest(p, spans).station,
      ground = options.groundRoadTop(x, z);
    if (!Number.isFinite(ground))
      throw new Error('Non-finite West motor road datum');
    if (s < source.model.startBlendEndM) {
      const n = nearest(p, lower),
        actual = lowerLookup.heightAt(x, z, lowerIdentity, 'road'),
        top =
          actual?.y ??
          lowerLookup.heightAt(...n.point, lowerIdentity, 'road')?.y ??
          n.y,
        w = actual
          ? 1
          : 1 -
            smooth(
              (distance(p, start) - source.model.startBlendStartM) /
                (source.model.startBlendEndM - source.model.startBlendStartM),
            );
      return ground + (top - ground) * w;
    }
    if (s > profileStart) {
      const actual = upperLookup.heightAt(x, z, upperIdentity, 'road');
      if (actual) return actual.y;
      if (s >= profileEnd) return endPlane(x, z);
      const center = at(s),
        w = smooth((s - profileStart) / profileLength),
        groundCross = ground - options.groundRoadTop(...center),
        planeCross = endPlane(x, z) - endPlane(...center);
      // A chainage profile avoids switching to an unrelated nearest main-road
      // branch while the exit is still tens of metres away from its junction.
      return profile(s) + groundCross * (1 - w) + planeCross * w;
    }
    return ground;
  };
  const segments: SurfaceSegment[] = [];
  for (const span of spans) {
    const count = Math.ceil((span.s1 - span.s0) / 1.5);
    for (let j = 0; j < count; j++) {
      const t = j / count,
        u = (j + 1) / count,
        a: XZ = [
          span.a[0] + (span.b[0] - span.a[0]) * t,
          span.a[1] + (span.b[1] - span.a[1]) * t,
        ],
        b: XZ = [
          span.a[0] + (span.b[0] - span.a[0]) * u,
          span.a[1] + (span.b[1] - span.a[1]) * u,
        ];
      segments.push({
        ...span,
        a,
        b,
        h0: height(...a),
        h1: height(...b),
        s0: span.s0 + (span.s1 - span.s0) * t,
        s1: span.s0 + (span.s1 - span.s0) * u,
      });
    }
  }
  const geometry = buildCausewayGeometry(segments, {
    shoulderWidthM: 0.01,
    shoulderRiseM: 0,
    slabDepthM: 0,
    bridgeSourceIds: new Set(),
    rails: false,
    paint: true,
    groundRoadTop: options.groundRoadTop,
    surfaceTop: (_route, x, z) => height(x, z),
    allowedModes: (id) =>
      id.sourceId === 256879277 ? ['drive', 'walk'] : ['drive'],
  });
  const bothGeometry: GeometryResult = {
    ...lowerGeometry,
    buffers: {
      ...lowerGeometry.buffers,
      asphalt: [
        ...lowerGeometry.buffers.asphalt,
        ...options.upperGeometry.buffers.asphalt,
      ],
    },
    topTriangles: [
      ...lowerGeometry.topTriangles.filter((t) => t.buffer === 'asphalt'),
      ...options.upperGeometry.topTriangles
        .filter((t) => t.buffer === 'asphalt')
        .map((t) => ({
          ...t,
          offset: t.offset + lowerGeometry.buffers.asphalt.length,
        })),
    ],
  };
  conformMergePaving(geometry, bothGeometry, height);
  const rampLookup = createCausewayTriangleLookup(geometry),
    sections = new Map(geometry.sections.map((s) => [s.s, s]));
  const openingFor = (selected: readonly SurfaceSegment[]) =>
    selected.map((s): GroundPolygon => {
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
  const lowerOpenings = openingFor(
      segments.filter((s) => s.s0 < source.model.startBlendEndM),
    ),
    upperOpenings = openingFor(
      segments.filter((s) => s.s1 > length - source.model.endBlendReserveM),
    );
  const scope = (id: Identity) =>
    id.routeId === 'causeway-north' &&
    id.surfaceId === 'lions:road' &&
    id.layer === 1 &&
    lowerIds.has(id.sourceId)
      ? 'lower'
      : id.routeId === 'prospect:main' &&
          id.surfaceId === UPPER &&
          id.layer === 2 &&
          id.sourceId === 1819
        ? 'upper'
        : undefined;
  const shoulderOpenings = (id: Identity): readonly GroundPolygon[] =>
    scope(id) === 'lower'
      ? lowerOpenings
      : scope(id) === 'upper'
        ? upperOpenings
        : [];
  const railAllowed = (id: Identity, x: number, z: number) => {
    const side = scope(id);
    if (!side) return true;
    const candidate = nearest([x, z], segments),
      inRange =
        side === 'lower'
          ? candidate.station < source.model.startBlendEndM
          : candidate.station > length - source.model.endBlendReserveM;
    return (
      !inRange ||
      candidate.distance >
        source.model.widthM / 2 + source.model.railClearanceMarginM
    );
  };
  const first = spans[0],
    dx = (first.b[0] - first.a[0]) / (first.s1 - first.s0),
    dz = (first.b[1] - first.a[1]) / (first.s1 - first.s0);
  let entry: { point: XZ; station: number; height: number } | undefined;
  for (let s = 0; s < first.s1; s += 0.1) {
    const p: XZ = [first.a[0] + dx * s, first.a[1] + dz * s],
      n = nearest(p, lower);
    if (
      n.distance >= source.model.widthM / 2 + 1 &&
      n.distance <= n.segment.width / 2 - 0.5 &&
      lowerLookup.heightAt(...p, lowerIdentity, 'road')
    ) {
      entry = { point: p, station: s, height: height(...p) };
      break;
    }
  }
  if (!entry)
    throw new Error(
      'West motor exit requires an off-mainline finite entry gate',
    );
  const connections: SurfaceConnection[] = [
    {
      id: 'stanley-west-legal-motor-exit',
      from: lowerIdentity,
      to: upperIdentity,
      allowedModes: ['drive'],
      twoWay: true,
      maxSeamStep: 0.025,
      geometry: forwardGate(entry.point, [dx, dz], source.model.widthM),
    },
  ];
  const pathTop = (sourceId: number, x: number, z: number, base: number) =>
    sourceId === source.route.crossingWayId
      ? (rampLookup.heightAt(x, z, upperIdentity, 'road')?.y ?? height(x, z))
      : base;
  const trace = (
    profile: readonly SurfaceSegment[],
    from: number,
    to: number,
  ) => {
    const direction = Math.sign(to - from),
      stations = [
        ...new Set([
          from,
          to,
          ...profile
            .flatMap((s) => [s.s0, s.s1])
            .filter(
              (s) => direction * (s - from) > 0 && direction * (to - s) > 0,
            ),
        ]),
      ].sort((a, b) => (a - b) * direction);
    return stations.map((station): XZ => {
      const s = profile.find(
        (s) => station >= s.s0 - 1e-7 && station <= s.s1 + 1e-7,
      );
      if (!s)
        throw new Error(
          'West QA approach must remain on the source-owned existing floor',
        );
      const t = Math.max(0, Math.min(1, (station - s.s0) / (s.s1 - s.s0)));
      return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
    });
  };
  const prefixFloor = nearest(start, lower),
    suffixFloor = nearest(end, upper),
    prefixDirection =
      Math.sign(
        (prefixFloor.segment.b[0] - prefixFloor.segment.a[0]) * dx +
          (prefixFloor.segment.b[1] - prefixFloor.segment.a[1]) * dz,
      ) || 1,
    tail = spans.at(-1)!,
    suffixDirection =
      Math.sign(
        (suffixFloor.segment.b[0] - suffixFloor.segment.a[0]) *
          (tail.b[0] - tail.a[0]) +
          (suffixFloor.segment.b[1] - suffixFloor.segment.a[1]) *
            (tail.b[1] - tail.a[1]),
      ) || 1,
    prefix = trace(
      lower,
      prefixFloor.station - prefixDirection * 20,
      prefixFloor.station,
    ),
    suffix = trace(
      upper,
      suffixFloor.station,
      suffixFloor.station + suffixDirection * 15,
    ),
    fullRoute = [...prefix.slice(0, -1), ...points, ...suffix.slice(1)],
    qa = {
      points: fullRoute,
      width: source.model.widthM,
      sourceIds: [1713, ...source.route.wayIds],
      osmSourceIds: source.route.wayIds,
      identity: lowerIdentity,
      reverseIdentity: upperIdentity,
    };
  return {
    points,
    sourceIds: source.route.wayIds,
    segments,
    geometry,
    connections,
    railAllowed,
    shoulderOpenings,
    pathTop,
    entry,
    length,
    width: source.model.widthM,
    verticalProfile: {
      kind: 'source-chainage Hermite to the unchanged upper endpoint plane',
      startM: profileStart,
      endM: profileEnd,
      maxCenterGrade: Math.max(
        ...segments.map((s) => Math.abs(s.h1 - s.h0) / (s.s1 - s.s0)),
      ),
    },
    routes: [{ id: 'stanley-west-legal-motor-exit', ...qa }],
    rampEntry: {
      center: start,
      radiusM: 20,
      sourceNodeId: source.route.startNode,
      lowerSourceIds: source.route.lowerWayIds,
      rampRouteId: ROUTE,
      crossingSourceId: source.route.crossingWayId,
      maxSeamStepM: 0.025,
    },
    qaRoutes: {
      westExit: qa,
    },
  };
}
export type StanleyWestRamp = ReturnType<typeof prepareStanleyWestRamp>;
