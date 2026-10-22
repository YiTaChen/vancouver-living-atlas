import type { FeatureCollection } from './types';
import type { XZ } from './causeway-profile';
import { unproject } from './geo';
import source from './stanley-drive-corrections-source.json';

const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
function line(points: readonly XZ[]) {
  const stations = [0];
  for (let i = 1; i < points.length; i++)
    stations.push(stations[i - 1] + distance(points[i - 1], points[i]));
  const at = (station: number): XZ => {
    station = Math.max(0, Math.min(stations.at(-1)!, station));
    const i = Math.max(
      1,
      stations.findIndex((s) => s >= station - 1e-8),
    );
    const t = Math.max(
      0,
      Math.min(
        1,
        (station - stations[i - 1]) / (stations[i] - stations[i - 1]),
      ),
    );
    return [
      points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
      points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
    ];
  };
  const nearest = (point: XZ) => {
    let best = { distance: Infinity, station: 0, point: points[0] };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = stations[i] - stations[i - 1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * (b[0] - a[0]) +
            (point[1] - a[1]) * (b[1] - a[1])) /
            length ** 2,
        ),
      );
      const p: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        gap = distance(point, p);
      if (gap < best.distance)
        best = {
          distance: gap,
          station: stations[i - 1] + length * t,
          point: p,
        };
    }
    return best;
  };
  return { stations, at, nearest, length: stations.at(-1)! };
}
function sampleRange(
  actual: ReturnType<typeof line>,
  from: number,
  to: number,
) {
  const length = Math.abs(to - from),
    direction = Math.sign(to - from);
  const stations = [
    ...new Set([
      0,
      length,
      ...actual.stations
        .map((s) => (s - from) * direction)
        .filter((s) => s > 0 && s < length),
      ...Array.from({ length: Math.ceil(length / 2) }, (_, i) => i * 2).filter(
        (s) => s < length,
      ),
    ]),
  ].sort((a, b) => a - b);
  return {
    length,
    direction,
    stations,
    points: stations.map((s) => actual.at(from + direction * s)),
  };
}

/** One verified ROW correction. Source buildings and vehicle collision are
 * preserved; only the matching local ordinary-road copy changes its XY. */
export function prepareStanleyDriveCorrections(options: {
  roads: FeatureCollection;
  project: (coordinate: readonly number[]) => XZ;
}) {
  const rule = source.correction,
    feature = options.roads.features[rule.citySourceId];
  if (
    JSON.stringify(feature.geometry.coordinates) !==
    JSON.stringify(rule.citySourceCoordinates)
  )
    throw new Error('Stanley local road correction City source changed');
  const original = rule.citySourceCoordinates.map(options.project),
    actual = line(source.way.coordinates.map(options.project));
  const first = actual.nearest(original[0]),
    last = actual.nearest(original.at(-1)!);
  if (Math.max(first.distance, last.distance) > rule.maxEndpointOffsetM)
    throw new Error(
      'Stanley local road correction exceeds its bounded endpoint joins',
    );
  const range = sampleRange(actual, first.station, last.station);
  const firstPoints = range.points.map((p, i): XZ => {
    const a = 1 - smooth(range.stations[i] / rule.startBlendM);
    return [
      p[0] + (original[0][0] - first.point[0]) * a,
      p[1] + (original[0][1] - first.point[1]) * a,
    ];
  });
  const coordinates = firstPoints.map((p) => unproject(...p));
  // The old shared node itself enters the retained building buffer. Move only
  // this junction to the actual motor road; both exterior main nodes stay fixed.
  coordinates[0] = [
    rule.citySourceCoordinates[0][0],
    rule.citySourceCoordinates[0][1],
  ];
  options.roads.features[rule.citySourceId] = {
    ...feature,
    properties: { ...feature.properties },
    geometry: { type: 'LineString', coordinates },
  };
  const adjacent = options.roads.features[rule.adjacentMainSourceId],
    branch = options.roads.features[rule.junctionBranchSourceId];
  if (
    JSON.stringify(adjacent.geometry.coordinates) !==
      JSON.stringify(rule.adjacentMainSourceCoordinates) ||
    JSON.stringify(branch.geometry.coordinates) !==
      JSON.stringify(rule.junctionBranchSourceCoordinates)
  )
    throw new Error('Stanley local junction source changed');
  const nextOriginal = rule.adjacentMainSourceCoordinates.map(options.project),
    nextLast = actual.nearest(nextOriginal.at(-1)!);
  if (nextLast.distance > rule.maxEndpointOffsetM)
    throw new Error('Stanley adjacent main join exceeds bounded offset');
  const nextRange = sampleRange(actual, last.station, nextLast.station);
  const nextPoints = nextRange.points.map((p, i): XZ => {
    const w =
      1 -
      smooth(
        (nextRange.length - nextRange.stations[i]) / rule.adjacentMainEndBlendM,
      );
    return [
      p[0] + (nextOriginal.at(-1)![0] - nextLast.point[0]) * w,
      p[1] + (nextOriginal.at(-1)![1] - nextLast.point[1]) * w,
    ];
  });
  const nextCoordinates = nextPoints.map((p) => unproject(...p));
  nextCoordinates[0] = coordinates.at(-1)!;
  nextCoordinates[nextCoordinates.length - 1] = [
    rule.adjacentMainSourceCoordinates.at(-1)![0],
    rule.adjacentMainSourceCoordinates.at(-1)![1],
  ];
  options.roads.features[rule.adjacentMainSourceId] = {
    ...adjacent,
    properties: { ...adjacent.properties },
    geometry: { type: 'LineString', coordinates: nextCoordinates },
  };
  const branchOriginal = rule.junctionBranchSourceCoordinates.map(
      options.project,
    ),
    branchLine = line(branchOriginal);
  if (distance(branchOriginal.at(-1)!, original.at(-1)!) > 1e-4)
    throw new Error('Stanley branch must share the corrected source junction');
  const branchStations = [
    ...new Set([
      ...branchLine.stations,
      ...Array.from(
        { length: Math.ceil(branchLine.length / 2) },
        (_, i) => i * 2,
      ),
    ]),
  ].sort((a, b) => a - b);
  const branchPoints = branchStations.map((s): XZ => {
    const p = branchLine.at(s),
      w = smooth(
        (s - (branchLine.length - rule.junctionBranchBlendM)) /
          rule.junctionBranchBlendM,
      );
    return [
      p[0] + (last.point[0] - original.at(-1)![0]) * w,
      p[1] + (last.point[1] - original.at(-1)![1]) * w,
    ];
  });
  const branchCoordinates = branchPoints.map((p) => unproject(...p));
  branchCoordinates[0] = [
    rule.junctionBranchSourceCoordinates[0][0],
    rule.junctionBranchSourceCoordinates[0][1],
  ];
  branchCoordinates[branchCoordinates.length - 1] = coordinates.at(-1)!;
  options.roads.features[rule.junctionBranchSourceId] = {
    ...branch,
    properties: { ...branch.properties },
    geometry: { type: 'LineString', coordinates: branchCoordinates },
  };
  const points = [...firstPoints, ...nextPoints.slice(1)];
  const excluded = source.exclusion,
    phantom = options.roads.features[excluded.citySourceId];
  if (
    JSON.stringify(phantom.geometry.coordinates) !==
    JSON.stringify(excluded.citySourceCoordinates)
  )
    throw new Error('Stanley excluded phantom ROW City source changed');
  // Preserve collection indices and original public data. Empty runtime parts
  // remove this proven non-road from pavement, driving graph and minimap only.
  options.roads.features[excluded.citySourceId] = {
    ...phantom,
    properties: { ...phantom.properties },
    geometry: { type: 'MultiLineString', coordinates: [] },
  };
  const full = {
    sourceIds: [rule.citySourceId, rule.adjacentMainSourceId],
    osmSourceIds: [source.way.sourceId],
    points,
    width: Number(feature.properties.width),
    identity: { surfaceId: 'ground', layer: 0 },
  };
  const failure = actual.nearest([-2110.135930855, -1671.156657581]),
    failureStation = (failure.station - first.station) * range.direction;
  // Native QA starts before the old building conflict; CPU tests use full.
  const qaPoints = points.filter(
    (_, i) =>
      i >=
      range.stations.findIndex((s) => s >= Math.max(0, failureStation - 20)),
  );
  return {
    routes: [{ id: 'stanley-verified-retail-curve', ...full }],
    junctionBranches: [
      {
        id: 'stanley-retained-parking-junction',
        ...full,
        sourceIds: [rule.junctionBranchSourceId, rule.adjacentMainSourceId],
        points: [...branchPoints, ...nextPoints.slice(1)],
      },
    ],
    qaRoutes: { retailCurve: { ...full, points: qaPoints } },
    sourceId: rule.citySourceId,
    sourceWayId: source.way.sourceId,
    sourceVersion: source.way.version,
    originalLengthM: line(original).length + line(nextOriginal).length,
    correctedSourceIds: [
      rule.citySourceId,
      rule.adjacentMainSourceId,
      rule.junctionBranchSourceId,
    ],
    excludedSourceIds: [excluded.citySourceId],
    sourceRangeM: [first.station, nextLast.station],
    correctedLengthM: line(points).length,
    endpointOffsetsM: [first.distance, last.distance],
    startBlendM: rule.startBlendM,
    endBlendM: rule.adjacentMainEndBlendM,
    sharedJunctionShiftM: last.distance,
  };
}
