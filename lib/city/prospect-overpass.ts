import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { FeatureCollection } from './types';
import { lines, unproject } from './geo';
import {
  buildCausewayGeometry,
  type GeometryResult,
  type GeometryOptions,
  type GroundPolygon,
  type Identity,
} from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { forwardGate, type SurfaceConnection } from './surface-reachability';
import source from './prospect-point-source.json';
import { drapeTriangles } from './surface-meshing';

export const PROSPECT_OVERPASS_SURFACE = 'park:prospect-overpass';
/** Actual OSM motor-road geometry fixes approximate City ROW alignment.
 * The bridge is way41998497, NOT the east off-ramp41998501 (City1585).
 * Headroom, width and approach elevations remain explicit game estimates. */
export const PROSPECT_OVERPASS_MODEL = {
  headroomM: 5.2,
  slabDepthM: 0.5,
  layer: 2,
  widthM: 6,
  southApproachM: 60,
} as const;
type Route = {
  sourceIds: number[];
  osmSourceIds: number[];
  points: XZ[];
  width: number;
  identity: { surfaceId: string; layer: number };
};
export interface ProspectOverpass {
  center: XZ;
  deckTop: number;
  segments: SurfaceSegment[];
  rampSegments: SurfaceSegment[];
  rampEntry: {
    center: XZ;
    radiusM: number;
    sourceNodeId: number;
    lowerSourceIds: number[];
    rampRouteId: string;
    crossingSourceId: number;
    maxSeamStepM: number;
  };
  cuts: Map<string, [number, number][]>;
  gates: SurfaceConnection[];
  sourceIds: number[];
  correctedSourceIds: number[];
  northCorrection: {
    sourceId: number;
    originalCutStationM: number;
    originalLengthM: number;
    newLengthM: number;
    joinBlendM: number;
    osmWayIds: number[];
  };
  junctionHeight: (
    routeId: string,
    x: number,
    z: number,
    base: number,
  ) => number;
  junctionShoulderOpenings: (identity: Identity) => readonly GroundPolygon[];
  sourceRanges: {
    sourceId: number;
    sourceStartM: number;
    sourceEndM: number;
    routeStartM: number;
    routeEndM: number;
  }[];
  routes: { id: string; sourceIds: number[]; points: XZ[] }[];
  qaRoutes: { ramp: Route; bridge: Route; lower: Route };
  /** Before mesh registration, apply a verified access road's physical
   * shoulder/rail openings. Rebuilding preserves every main asphalt plane. */
  setAccessOpenings: (
    options: Pick<GeometryOptions, 'railAllowed' | 'shoulderOpenings'>,
  ) => void;
  geometry: GeometryResult;
}
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lengthOf = (points: readonly XZ[]) =>
  points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0);
function nearestOn(points: readonly XZ[], target: XZ) {
  let best = Infinity,
    station = 0,
    at = 0,
    point: XZ = points[0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = distance(a, b),
      t = Math.max(
        0,
        Math.min(
          1,
          ((target[0] - a[0]) * dx + (target[1] - a[1]) * dz) /
            (length * length),
        ),
      ),
      q: XZ = [a[0] + dx * t, a[1] + dz * t];
    if (distance(q, target) < best) {
      best = distance(q, target);
      at = station + length * t;
      point = q;
    }
    station += length;
  }
  return { distance: best, station: at, point };
}
function sliceLine(points: readonly XZ[], start: number, end: number) {
  const result: XZ[] = [];
  let station = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = distance(a, b),
      lo = Math.max(0, (start - station) / length),
      hi = Math.min(1, (end - station) / length);
    if (hi > lo) {
      if (!result.length)
        result.push([a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo]);
      result.push([a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi]);
    }
    station += length;
  }
  return result;
}
function bake(
  points: readonly XZ[],
  height: (station: number, p: XZ) => number,
  options: {
    sourceId: number;
    routeId: string;
    surfaceId: string;
    layer: number;
    station?: number;
    width?: number;
  },
) {
  const result: SurfaceSegment[] = [];
  let station = options.station ?? 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = distance(a, b),
      count = Math.ceil(length / 2);
    for (let j = 0; j < count; j++) {
      const t = j / count,
        u = (j + 1) / count,
        p: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        q: XZ = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      result.push({
        ...options,
        a: p,
        b: q,
        h0: height(station + t * length, p),
        h1: height(station + u * length, q),
        s0: station + t * length,
        s1: station + u * length,
        width: options.width ?? 6,
      });
    }
    station += length;
  }
  return result;
}
function crossing(a: XZ, b: XZ, c: XZ, d: XZ): XZ | undefined {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    ex = d[0] - c[0],
    ez = d[1] - c[1],
    det = dx * ez - dz * ex;
  if (Math.abs(det) < 1e-9) return;
  const t = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / det,
    u = ((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / det;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
    return [a[0] + dx * t, a[1] + dz * t];
}
/** Close the measured ~15mm City/protected miter wedge with real asphalt, not
 * a collision tolerance. Both bounded 8cm-long caps use the identical 12m datum
 * clipping and Float32 vertices as the adjacent rendered ground pavement. */
function closeGroundSeams(
  g: GeometryResult,
  segments: readonly SurfaceSegment[],
  groundTop: (x: number, z: number) => number,
) {
  for (const inputIndex of [0, segments.length - 1]) {
    const s = segments[inputIndex],
      p = inputIndex === 0 ? s.a : s.b,
      dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length = Math.hypot(dx, dz),
      tx = dx / length,
      tz = dz / length,
      nx = tz,
      nz = -tx,
      w = s.width / 2 + 0.025;
    const points: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([along, side]) => [
      p[0] + tx * along * 0.04 + nx * side * w,
      p[1] + tz * along * 0.04 + nz * side * w,
    ]);
    const triangles = drapeTriangles(
        points,
        [0, 1, 2, 0, 2, 3],
        groundTop,
      ).positions.map(Math.fround),
      offset = g.buffers.asphalt.length,
      id = {
        routeId: s.routeId,
        surfaceId: s.surfaceId,
        layer: s.layer,
        sourceId: s.sourceId,
      };
    g.buffers.asphalt.push(...triangles);
    g.perSegment[inputIndex].asphalt.push(...triangles);
    for (let n = 0; n < triangles.length; n += 9) {
      const q = triangles.slice(n, n + 9),
        index = g.topTriangles.length;
      g.topTriangles.push({
        buffer: 'asphalt',
        offset: offset + n,
        identities: [id],
        s0: inputIndex === 0 ? s.s0 : s.s1,
        s1: inputIndex === 0 ? s.s0 : s.s1,
        minX: Math.min(q[0], q[3], q[6]),
        maxX: Math.max(q[0], q[3], q[6]),
        minZ: Math.min(q[2], q[5], q[8]),
        maxZ: Math.max(q[2], q[5], q[8]),
        role: 'road',
        inputIndex,
      });
      g.perSegment[inputIndex].topTriangleIndices.push(index);
    }
    g.surfaces.push({
      ...id,
      inputIndex,
      kind: 'road',
      triangles,
      allowedModes: ['drive', 'walk'],
    });
    g.stats.topTriangles = g.topTriangles.length;
    g.stats.triangles += triangles.length / 9;
  }
  return g;
}
/** Called before ordinary pavement. Update ONLY the verified bridge and ramp
 * source copies and their immediately adjacent endpoints; no regional rewrite. */
export function prepareProspectOverpass(options: {
  roads: FeatureCollection;
  project: (coordinate: readonly number[]) => XZ;
  groundRoadTop: (x: number, z: number) => number;
  lowerSegments: readonly SurfaceSegment[];
}): ProspectOverpass {
  const byId = new Map(source.ways.map((w) => [w.sourceId, w]));
  const bridgeCoordinates = [...byId.get(41998497)!.coordinates].reverse(); // City1599 runs north -> south
  const original = (id: number) => lines(options.roads.features[id])[0];
  const replacements = new Map<number, number[][]>();
  replacements.set(1599, bridgeCoordinates);
  const north = [...byId.get(120254680)!.coordinates].reverse();
  replacements.set(1819, north);
  // The 2008 relocated Prospect roadway is absent from the approximate City
  // hairpin. Retain the outer City road and replace only its terminal portion
  // with the verified motor-road chain. A 60m blend joins its ~14m ROW offset.
  const actualNorth = [1044497045, 363404510, 887923788, 1299847009].flatMap(
    (id, i) => {
      const c = byId.get(id)!.coordinates.map(options.project);
      return i ? c.slice(1) : c;
    },
  );
  const actualPrefixLength = [1044497045, 363404510, 887923788].reduce(
    (n, id) => n + lengthOf(byId.get(id)!.coordinates.map(options.project)),
    0,
  );
  const actualNorthPart = sliceLine(
    actualNorth,
    0,
    actualPrefixLength + 100,
  ).reverse();
  const cityNorth = original(1790).map(options.project),
    target = actualNorthPart[0];
  let best = Infinity,
    cityCut = 0,
    cutPoint: XZ = cityNorth[0],
    sourceStation = 0;
  for (let i = 1; i < cityNorth.length; i++) {
    const a = cityNorth[i - 1],
      b = cityNorth[i],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = distance(a, b),
      t = Math.max(
        0,
        Math.min(
          1,
          ((target[0] - a[0]) * dx + (target[1] - a[1]) * dz) /
            (length * length),
        ),
      ),
      q: XZ = [a[0] + dx * t, a[1] + dz * t],
      gap = distance(q, target);
    if (gap < best) {
      best = gap;
      cityCut = sourceStation + length * t;
      cutPoint = q;
    }
    sourceStation += length;
  }
  if (best > 25)
    throw new Error(
      'Relocated Prospect road must have a bounded City transition',
    );
  let blendStation = 0;
  const newNorth = actualNorthPart.map((point, i) => {
    if (i) blendStation += distance(actualNorthPart[i - 1], point);
    const w = 1 - smooth(blendStation / 60);
    return [
      point[0] + (cutPoint[0] - target[0]) * w,
      point[1] + (cutPoint[1] - target[1]) * w,
    ] as XZ;
  });
  replacements.set(
    1790,
    [...sliceLine(cityNorth, 0, cityCut), ...newNorth.slice(1)].map((p) =>
      unproject(...p),
    ),
  );
  const rampJoin = byId.get(41998501)!.coordinates.at(-1)!;
  const physicalMain = byId.get(41998494)!.coordinates;
  const joinIndex = physicalMain.findIndex(
    (p) => distance(options.project(p), options.project(rampJoin)) < 1e-5,
  );
  if (joinIndex < 0)
    throw new Error('Off-ramp must share the actual main-road source node');
  const south = physicalMain.slice(joinIndex).reverse();
  replacements.set(1778, south);
  const junctionSource = source.parkOnrampJunctionCorrection;
  for (const id of junctionSource.citySourceIds) {
    const expected =
      junctionSource.originalCityCoordinates[
        String(id) as keyof typeof junctionSource.originalCityCoordinates
      ];
    if (JSON.stringify(original(id)) !== JSON.stringify(expected))
      throw new Error(`Prospect main junction City source changed: ${id}`);
  }
  const actualSouth = physicalMain
      .slice(0, joinIndex + 1)
      .reverse()
      .map(options.project),
    sharedIndex = byId
      .get(junctionSource.mainWayId)!
      .sourceNodeIds.indexOf(junctionSource.sharedNodeId),
    sharedCoordinates = physicalMain[sharedIndex],
    shared = options.project(sharedCoordinates),
    sharedStation = nearestOn(actualSouth, shared).station,
    exterior = options.project(original(1784).at(-1)!),
    exteriorMatch = nearestOn(actualSouth, exterior);
  if (
    sharedIndex < 0 ||
    exteriorMatch.station <= sharedStation ||
    exteriorMatch.distance > junctionSource.maxFarEndOffsetM
  )
    throw new Error('Actual Park main junction requires a bounded City join');
  const southExtension: XZ[] = [];
  for (let s = 0; s < sharedStation + 1.999; s += 2) {
    const at = Math.min(s, sharedStation),
      point =
        sliceLine(actualSouth, at, Math.min(at + 0.0001, sharedStation)).at(
          0,
        ) ?? shared;
    southExtension.push(point);
  }
  const southCoordinates = southExtension.map((p) => unproject(...p));
  southCoordinates[southCoordinates.length - 1] = [
    sharedCoordinates[0],
    sharedCoordinates[1],
  ];
  replacements.set(1812, southCoordinates);
  const continuation = sliceLine(
      actualSouth,
      sharedStation,
      exteriorMatch.station,
    ),
    continuationLength = lengthOf(continuation);
  let continuationStation = 0;
  const continuationCoordinates = continuation.map((point, i) => {
    if (i) continuationStation += distance(continuation[i - 1], point);
    const weight = smooth(
      (continuationStation - continuationLength + junctionSource.farEndBlendM) /
        junctionSource.farEndBlendM,
    );
    return unproject(
      point[0] + (exterior[0] - exteriorMatch.point[0]) * weight,
      point[1] + (exterior[1] - exteriorMatch.point[1]) * weight,
    );
  });
  continuationCoordinates[0] = [sharedCoordinates[0], sharedCoordinates[1]];
  continuationCoordinates[continuationCoordinates.length - 1] = [
    original(1784).at(-1)![0],
    original(1784).at(-1)![1],
  ];
  replacements.set(1784, continuationCoordinates);
  const rampCoordinates = [
    ...byId.get(877408902)!.coordinates,
    ...byId.get(41998501)!.coordinates.slice(1),
  ];
  replacements.set(1585, rampCoordinates);
  for (const [id, coordinates] of replacements) {
    const f = options.roads.features[id];
    options.roads.features[id] = {
      ...f,
      properties: { ...f.properties },
      geometry: { type: 'LineString', coordinates },
    };
  }
  const projected = (id: number) => original(id).map(options.project),
    bridge = projected(1599),
    northPoints = projected(1819),
    southFull = projected(1778),
    southExtensionFull = projected(1812),
    southPoints = sliceLine(
      southExtensionFull,
      0,
      PROSPECT_OVERPASS_MODEL.southApproachM,
    );
  let center: XZ | undefined;
  for (let i = 1; i < bridge.length; i++)
    for (const s of options.lowerSegments)
      center ??= crossing(bridge[i - 1], bridge[i], s.a, s.b);
  if (!center)
    throw new Error('Actual Prospect bridge must cross the original Causeway');
  const near = options.lowerSegments.filter((s) => {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      t = Math.max(
        0,
        Math.min(
          1,
          ((center![0] - s.a[0]) * dx + (center![1] - s.a[1]) * dz) /
            (dx * dx + dz * dz),
        ),
      );
    return distance(center!, [s.a[0] + dx * t, s.a[1] + dz * t]) < 22;
  });
  const deckTop =
    Math.max(...near.flatMap((s) => [s.h0, s.h1])) +
    PROSPECT_OVERPASS_MODEL.headroomM +
    PROSPECT_OVERPASS_MODEL.slabDepthM;
  const northLength = lengthOf(northPoints),
    bridgeLength = lengthOf(bridge),
    bridgeEnd = northLength + bridgeLength,
    southLength = lengthOf(southFull) + lengthOf(southPoints);
  const hermite = (
    a: number,
    b: number,
    ma: number,
    mb: number,
    t: number,
    length: number,
  ) =>
    (2 * t ** 3 - 3 * t * t + 1) * a +
    (t ** 3 - 2 * t * t + t) * length * ma +
    (-2 * t ** 3 + 3 * t * t) * b +
    (t ** 3 - t * t) * length * mb;
  const northGround = options.groundRoadTop(...northPoints[0]),
    southGround = options.groundRoadTop(...southPoints.at(-1)!);
  const northNext = sliceLine(northPoints, 0, 1).at(-1)!,
    southNext = sliceLine(southExtensionFull, 60, 61).at(-1)!;
  const northSlope = options.groundRoadTop(...northNext) - northGround,
    southSlope = options.groundRoadTop(...southNext) - southGround;
  const height = (station: number, _point: XZ) =>
    station < northLength
      ? hermite(
          northGround,
          deckTop,
          northSlope,
          0,
          station / northLength,
          northLength,
        )
      : station > bridgeEnd
        ? hermite(
            deckTop,
            southGround,
            0,
            southSlope,
            (station - bridgeEnd) / southLength,
            southLength,
          )
        : deckTop;
  const segments: SurfaceSegment[] = [],
    sourceRanges: ProspectOverpass['sourceRanges'] = [];
  let station = 0;
  for (const [sourceId, points] of [
    [1819, northPoints],
    [1599, bridge],
    [1778, southFull],
    [1812, southPoints],
  ] as const) {
    const length = lengthOf(points);
    segments.push(
      ...bake(points, height, {
        sourceId,
        routeId: 'prospect:main',
        surfaceId: PROSPECT_OVERPASS_SURFACE,
        layer: 2,
        station,
      }),
    );
    sourceRanges.push({
      sourceId,
      sourceStartM: 0,
      sourceEndM: length,
      routeStartM: station,
      routeEndM: station + length,
    });
    station += length;
  }
  const ramp = projected(1585),
    rampLength = lengthOf(ramp),
    rampStart =
      options.lowerSegments.find((s) => distance(s.a, ramp[0]) < 1e-5) ??
      options.lowerSegments.find((s) => distance(s.b, ramp[0]) < 1e-5);
  if (!rampStart)
    throw new Error('Actual off-ramp must share a Causeway source node');
  const startTop =
      distance(rampStart.a, ramp[0]) < 1e-5 ? rampStart.h0 : rampStart.h1,
    rampEndTop = height(bridgeEnd + lengthOf(southFull), ramp.at(-1)!);
  const rampSegments = bake(
    ramp,
    (s, _p) => startTop + (rampEndTop - startTop) * smooth(s / rampLength),
    {
      sourceId: 1585,
      routeId: 'prospect:east-exit',
      surfaceId: 'lions:road',
      layer: 1,
      width: 6,
    },
  );
  // Both physical ribbons share one small road plane at the actual T junction.
  // Merely matching their centre endpoints leaves two overlapping sloping tops
  // up to ~40cm apart where a car changes ribbons. Blend the same 3D plane into
  // each approach, preserving the original Causeway floor everywhere else.
  const join = ramp.at(-1)!,
    before = sliceLine(
      southFull,
      lengthOf(southFull) - 1,
      lengthOf(southFull),
    )[0],
    after = sliceLine(southExtensionFull, 0, 1).at(-1)!,
    mt: XZ = [after[0] - before[0], after[1] - before[1]],
    rt: XZ = [join[0] - ramp.at(-2)![0], join[1] - ramp.at(-2)![1]],
    ml = Math.hypot(...mt),
    rl = Math.hypot(...rt),
    mainT: XZ = [mt[0] / ml, mt[1] / ml],
    rampT: XZ = [rt[0] / rl, rt[1] / rl],
    det = mainT[0] * rampT[1] - mainT[1] * rampT[0],
    joinStation = bridgeEnd + lengthOf(southFull),
    mainSlope =
      height(joinStation + 0.5, join) - height(joinStation - 0.5, join),
    gx = (mainSlope * rampT[1]) / det,
    gz = (-mainSlope * rampT[0]) / det;
  const junctionHeight = (
    routeId: string,
    x: number,
    z: number,
    base: number,
  ) => {
    if (routeId !== 'prospect:main' && routeId !== 'prospect:east-exit')
      return base;
    if (routeId === 'prospect:east-exit') {
      const d = distance([x, z], ramp[0]);
      if (d < 20) {
        let nearest = Infinity,
          top = base;
        for (const s of options.lowerSegments) {
          const dx = s.b[0] - s.a[0],
            dz = s.b[1] - s.a[1],
            t = Math.max(
              0,
              Math.min(
                1,
                ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / (dx * dx + dz * dz),
              ),
            ),
            gap = distance([x, z], [s.a[0] + t * dx, s.a[1] + t * dz]);
          if (gap < nearest) {
            nearest = gap;
            top = s.h0 + (s.h1 - s.h0) * t;
          }
        }
        const w = 1 - smooth((d - 8) / 12);
        base = base + (top - base) * w;
      }
    }
    const d = distance([x, z], join);
    if (d >= 20) return base;
    const plane = rampEndTop + gx * (x - join[0]) + gz * (z - join[1]),
      w = 1 - smooth((d - 8) / 12);
    return base + (plane - base) * w;
  };
  const cuts = new Map<string, [number, number][]>([
    ['1585:0', [[0, rampLength]]],
    ['1599:0', [[0, bridgeLength]]],
    ['1819:0', [[0, northLength]]],
    ['1778:0', [[0, lengthOf(southFull)]]],
    ['1812:0', [[0, lengthOf(southPoints)]]],
  ]);
  const gates: SurfaceConnection[] = [];
  const gate = (
    id: string,
    point: XZ,
    direction: XZ,
    surfaceId: string,
    layer: number,
  ) =>
    gates.push({
      id,
      from: { surfaceId: 'ground', layer: 0 },
      to: { surfaceId, layer },
      allowedModes: ['drive', 'walk'],
      twoWay: true,
      maxSeamStep: 0.025,
      geometry: forwardGate(point, direction, 6.01),
    });
  gate(
    'prospect:north-ground',
    segments[0].a,
    [segments[0].b[0] - segments[0].a[0], segments[0].b[1] - segments[0].a[1]],
    PROSPECT_OVERPASS_SURFACE,
    2,
  );
  const last = segments.at(-1)!;
  gate(
    'prospect:south-ground',
    last.b,
    [last.a[0] - last.b[0], last.a[1] - last.b[1]],
    PROSPECT_OVERPASS_SURFACE,
    2,
  );
  const rampLast = rampSegments.at(-1)!;
  gates.push({
    id: 'prospect:east-exit-main-junction',
    from: { surfaceId: 'lions:road', layer: 1 },
    to: { surfaceId: PROSPECT_OVERPASS_SURFACE, layer: 2 },
    allowedModes: ['drive'],
    twoWay: true,
    maxSeamStep: 0.025,
    geometry: { kind: 'junction', center: rampLast.b, radius: 6.1 },
  });
  const rampFirst = rampSegments[0];
  gates.push({
    id: 'prospect:causeway-east-exit',
    from: { surfaceId: 'lions:road', layer: 1 },
    to: { surfaceId: 'lions:road', layer: 1 },
    allowedModes: ['drive'],
    twoWay: true,
    maxSeamStep: 0.025,
    geometry: { kind: 'junction', center: rampFirst.a, radius: 3.1 },
  });
  const northernGround = projected(1790),
    northGroundTail = sliceLine(
      northernGround,
      lengthOf(northernGround) - 15,
      lengthOf(northernGround),
    );
  const routePoints = [
    ...northGroundTail,
    ...northPoints.slice(1),
    ...bridge.slice(1),
    ...southFull.slice(1),
    ...southExtensionFull.slice(1),
  ];
  const fullNorthRoute = [
    ...sliceLine(
      northernGround,
      Math.max(0, cityCut - 15),
      lengthOf(northernGround),
    ),
    ...routePoints.slice(northGroundTail.length),
  ];
  const lowerNear = options.lowerSegments.filter(
    (s) => distance(s.a, center!) < 45 || distance(s.b, center!) < 45,
  );
  let geometry: GeometryResult | undefined;
  const openingQuad = (s: SurfaceSegment): GroundPolygon => {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length = Math.hypot(dx, dz),
      tx = dx / length,
      tz = dz / length,
      w = s.width / 2 + 0.002;
    return {
      outer: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([along, side]) => {
        const p = along < 0 ? s.a : s.b;
        return [
          p[0] + tx * along * 0.002 + tz * side * w,
          p[1] + tz * along * 0.002 - tx * side * w,
        ] as XZ;
      }),
    };
  };
  const eastRampOpenings = rampSegments
      .filter((s) => s.s1 > rampSegments.at(-1)!.s1 - 12)
      .map(openingQuad),
    eastMainOpenings = segments
      .filter(
        (s) =>
          [1778, 1812].includes(s.sourceId) &&
          (distance(s.a, ramp.at(-1)!) < 12 ||
            distance(s.b, ramp.at(-1)!) < 12),
      )
      .map(openingQuad);
  const junctionShoulderOpenings = (id: Identity): readonly GroundPolygon[] =>
    id.routeId === 'prospect:main' &&
    id.surfaceId === PROSPECT_OVERPASS_SURFACE &&
    id.layer === 2 &&
    [1778, 1812].includes(id.sourceId)
      ? eastRampOpenings
      : id.routeId === 'prospect:east-exit' &&
          id.surfaceId === 'lions:road' &&
          id.layer === 1 &&
          id.sourceId === 1585
        ? eastMainOpenings
        : [];
  let accessOpenings: Pick<
    GeometryOptions,
    'railAllowed' | 'shoulderOpenings'
  > = {};
  return {
    center,
    deckTop,
    segments,
    rampSegments,
    rampEntry: {
      center: ramp[0],
      radiusM: 12,
      sourceNodeId: byId.get(877408902)!.sourceNodeIds[0],
      lowerSourceIds: [325793279, 70954678],
      rampRouteId: 'prospect:east-exit',
      crossingSourceId: 1252160599,
      maxSeamStepM: 0.025,
    },
    cuts,
    gates,
    sourceIds: [1585, 1599, 1778, 1812, 1819],
    correctedSourceIds: [1585, 1599, 1778, 1784, 1790, 1812, 1819],
    northCorrection: {
      sourceId: 1790,
      originalCutStationM: cityCut,
      originalLengthM: sourceStation,
      newLengthM: lengthOf(northernGround),
      joinBlendM: 60,
      osmWayIds: [1044497045, 363404510, 887923788, 1299847009],
    },
    sourceRanges,
    junctionHeight,
    junctionShoulderOpenings,
    routes: [
      {
        id: 'prospect-real-main-crossing',
        sourceIds: [1790, 1819, 1599, 1778, 1812],
        points: routePoints,
      },
      {
        id: 'prospect-relocated-full-approach',
        sourceIds: [1790, 1819, 1599, 1778, 1812],
        points: fullNorthRoute,
      },
    ],
    qaRoutes: {
      ramp: {
        sourceIds: [1585],
        osmSourceIds: [877408902, 41998501],
        points: ramp,
        width: 6,
        identity: { surfaceId: 'lions:road', layer: 1 },
      },
      bridge: {
        sourceIds: [1599],
        osmSourceIds: [41998497],
        points: bridge,
        width: 6,
        identity: { surfaceId: PROSPECT_OVERPASS_SURFACE, layer: 2 },
      },
      lower: {
        sourceIds: [...new Set(lowerNear.map((s) => s.sourceId))],
        osmSourceIds: [70954663],
        points: [lowerNear[0].a, ...lowerNear.map((s) => s.b)],
        width: Math.min(...lowerNear.map((s) => s.width)),
        identity: { surfaceId: 'lions:road', layer: 1 },
      },
    },
    setAccessOpenings(openings) {
      accessOpenings = openings;
      geometry = undefined;
    },
    get geometry() {
      return (geometry ||= closeGroundSeams(
        buildCausewayGeometry(segments, {
          shoulderWidthM: 0.3,
          shoulderRiseM: 0.08,
          slabDepthM: 0.5,
          splitSlabEndCaps: true,
          groundRoadTop: options.groundRoadTop,
          surfaceTop: junctionHeight,
          shoulderOpenings: (id) => [
            ...junctionShoulderOpenings(id),
            ...(accessOpenings.shoulderOpenings?.(id) ?? []),
          ],
          tapers: [{ routeId: 'prospect:main', startM: 12, endM: 12 }],
          bridgeSourceIds: new Set([1599]),
          rails: true,
          // At-grade main-road/off-ramp junction: its real roadway is an opening,
          // rather than a continuous roadside rail through the vehicle entrance.
          railAllowed: (id, x, z) =>
            (accessOpenings.railAllowed?.(id, x, z) ?? true) &&
            !rampSegments.some((s) => {
              if (distance(s.b, ramp.at(-1)!) > 12) return false;
              const dx = s.b[0] - s.a[0],
                dz = s.b[1] - s.a[1],
                t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((x - s.a[0]) * dx + (z - s.a[1]) * dz) /
                      (dx * dx + dz * dz),
                  ),
                );
              return (
                distance([x, z], [s.a[0] + dx * t, s.a[1] + dz * t]) <
                s.width / 2 + 0.4
              );
            }),
          paint: true,
          allowedModes: (_id, kind) =>
            kind === 'road' ? ['drive', 'walk'] : ['walk'],
        }),
        segments,
        options.groundRoadTop,
      ));
    },
  };
}
/** Only the real upper bridge has a physical slab. The off-ramp is at grade. */
export function registerProspectSlab(
  e: CityEngine,
  overpass: ProspectOverpass,
) {
  const meshes: THREE.Mesh[] = [];
  e.roads.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.prospectBridgeCollision)
      meshes.push(object);
  });
  if (
    overpass.geometry.buffers.slab.length &&
    !meshes.some((m) => m.userData.prospectSlab)
  )
    throw new Error(
      'Prospect slab requires its actual rendered collision mesh',
    );
  // Flight collides with the real road tops as well as slab sides/underside.
  // Tesla already has road-top ground faces; its adapter consumes only slabs.
  e.data.flightBridgeSurfaceMeshes = [
    ...(e.data.flightBridgeSurfaceMeshes ?? []),
    ...meshes,
  ];
  e.data.prospectSlabMeshes = meshes.filter((m) => m.userData.prospectSlab);
}
