/** Build playable, continuous route circuits from the committed TransLink source
 * packet. Source vertices are retained; junctions use evidenced same-stop joins.
 * No road connector, U-turn, inferred schedule, or straight-line shortcut is made. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const input = new URL(
  './city-life-sources/transit-source-snapshot.json',
  import.meta.url,
);
const bytes = await readFile(input);
const source = JSON.parse(bytes);
const mx = 111320 * Math.cos((49.286 * Math.PI) / 180);
const project = ([lon, lat]) => [
  (lon + 123.128) * mx,
  -(lat - 49.286) * 111320,
];
const services = new Map(source.services.map((s) => [s.serviceId, s]));
const paths = new Map(source.paths.map((p) => [p.pathId, p]));
const short = (id) => services.get(id + ':regional');
function part(id, from, to) {
  const service = short(id),
    path = paths.get(service.pathId);
  const at = (station) => {
    let i = 0;
    while (
      i < path.cumulativeStationM.length - 2 &&
      path.cumulativeStationM[i + 1] < station
    )
      i++;
    const ratio =
      (station - path.cumulativeStationM[i]) /
      (path.cumulativeStationM[i + 1] - path.cumulativeStationM[i]);
    return path.coordinates[i].map(
      (v, k) => v + (path.coordinates[i + 1][k] - v) * ratio,
    );
  };
  return {
    service,
    path,
    coordinates: [
      at(from),
      ...path.coordinates.filter(
        (_, i) =>
          path.cumulativeStationM[i] > from && path.cumulativeStationM[i] < to,
      ),
      at(to),
    ],
    stops: service.orderedStops.filter(
      (s) => s.pathStationM >= from - 0.01 && s.pathStationM <= to + 0.01,
    ),
    from,
    to,
  };
}
const pairs = [
  ['bus-5:eastbound', 'bus-6:westbound'],
  ['bus-5:westbound', 'bus-6:eastbound'],
];
const routes = pairs.map((ids, index) => {
  const joins = ids.map((id, i) => {
    const next = ids[(i + 1) % ids.length];
    const evidence = source.busContinuityEvidence.find(
      (e) =>
        e.fromServiceId === id + ':regional' &&
        e.toServiceId === next + ':regional',
    );
    if (
      !evidence ||
      evidence.evidenceStatus !==
        'same_active_block_adjacent_trips_same_stop' ||
      evidence.planarJoinAtScheduledStop.projectionGapM > 0.05 ||
      evidence.planarJoinAtScheduledStop.headingDifferenceDegrees > 1
    )
      throw Error('Unproven circuit join');
    return evidence;
  });
  const parts = ids.map((id, i) =>
    part(
      id,
      joins[(i + 1) % ids.length].planarJoinAtScheduledStop.toPathStationM,
      joins[i].planarJoinAtScheduledStop.fromPathStationM,
    ),
  );
  const points = [],
    stops = [],
    legs = [];
  let length = 0;
  for (const p of parts) {
    const start = length;
    for (const coord of p.coordinates) {
      const xy = project(coord),
        last = points.at(-1);
      if (last) {
        const gap = Math.hypot(xy[0] - last[0], xy[1] - last[1]);
        if (gap < 0.03) continue;
        length += gap;
      }
      points.push([...xy, length]);
    }
    // Reproject each actual stop onto this retained polyline; path source uses
    // a slightly different local metric from the scene's geographic projection.
    for (const stop of p.stops) {
      const q = project(stop.shapeProjectionLonLat);
      let best = null;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        if (a[2] < start - 0.03) continue;
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          d2 = dx * dx + dz * dz;
        const t = Math.max(
          0,
          Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / d2),
        );
        const distance = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dz);
        if (!best || distance < best.distance)
          best = { distance, station: a[2] + t * (b[2] - a[2]) };
      }
      if (!best || best.distance > 0.1)
        throw Error('Stop lost from source shape');
      if (!stops.some((s) => Math.abs(s.stationM - best.station) < 0.1))
        stops.push({
          id: stop.serviceStopId,
          sourceStopId: stop.sourceStopId,
          stopCode: stop.stopCode,
          name: stop.name,
          lonLat: stop.lonLat,
          sourceServiceId: p.service.serviceId,
          headsign: p.service.sourceHeadsign,
          stationM: best.station,
        });
    }
    legs.push({
      sourceServiceId: p.service.serviceId,
      sourceShapeId: p.path.sourceShapeId,
      sourceTripId: p.service.sourceTripId,
      sourceShapeRowsSha256: p.path.fullSourceShapeRowsSha256,
      headsign: p.service.sourceHeadsign,
      fromM: start,
      toM: length,
      sourceFromStationM: p.from,
      sourceToStationM: p.to,
    });
  }
  const first = points[0],
    last = points.at(-1);
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.05)
    throw Error('Circuit endpoints do not meet');
  // Exact identity at a coincident source endpoint avoids numerical drift.
  last[0] = first[0];
  last[1] = first[1];
  return {
    id: 'translink-5-6-circuit-' + index,
    points,
    stops: stops
      .filter((s) => s.stationM < length - 0.1)
      .sort((a, b) => a.stationM - b.stationM),
    legs,
    lengthM: length,
    joins,
  };
});
const packet = {
  schemaVersion: 1,
  sourcePacketSha256: createHash('sha256').update(bytes).digest('hex'),
  source: source.source,
  legend:
    'Route and arrival data used in this product or service is provided by permission of TransLink. TransLink assumes no responsibility for the accuracy or currency of the Data used in this product or service.',
  termsUrl: source.attribution.termsUrl,
  simulation:
    'Offline route geometry and stop identities. Illustrative speed, dwell and spacing; not a live arrival or exact timetable. Ground/door clearance is checked in the world at runtime.',
  construction:
    'GTFS vertices retained between evidenced coincident scheduled-stop projections; same active blocks support 5/6 continuations. No invented connector or endpoint wrap.',
  routes,
};
await writeFile(
  new URL('../../public/data/transit/bus-world-routes.json', import.meta.url),
  JSON.stringify(packet),
);
console.log(
  `Built ${routes.length} GTFS circuits, ${routes.reduce((n, r) => n + r.stops.length, 0)} stops, ${(routes.reduce((n, r) => n + r.lengthM, 0) / 1000).toFixed(2)} km`,
);
