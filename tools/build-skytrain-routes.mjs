import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'tools/transit/city-life-sources/transit-source-snapshot.json';
const RELEASE_ID = 'translink-gtfs-26SEP_20261002-regional-skytrain';
const OUTPUT = 'public/models/skytrain-routes.json';
const LINES = {
  expo: [
    'waterfront',
    'burrard',
    'granville',
    'stadium-chinatown',
    'main-street-science-world',
  ],
  canada: ['waterfront', 'vancouver-city-centre', 'yaletown-roundhouse'],
};
const required = (condition, message) => {
  if (!condition) throw new Error(`Invalid SkyTrain route source: ${message}`);
};
const finitePoint = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

/** Retain every original GTFS bend between adjacent projected station stops;
 * only the first/last vertex of each segment is interpolated. No network,
 * source mutation, platform pose or vertical survey is involved. */
export function buildSkyTrainRoutes(sourceText) {
  const source = JSON.parse(sourceText);
  required(
    source.schemaVersion === 1 &&
      source.packageId === 'city-life-transit-sources',
    'snapshot identity',
  );
  required(
    Array.isArray(source.services) && Array.isArray(source.paths),
    'snapshot collections',
  );
  const segments = [];
  const seen = new Set();
  for (const service of source.services) {
    if (!Object.hasOwn(LINES, service.lineId)) continue;
    const path = source.paths.find((value) => value.pathId === service.pathId);
    required(
      path && path.sourceShapeId === service.sourceShapeId,
      'matching shape identity',
    );
    const coordinates = path.coordinates,
      distances = path.cumulativeStationM;
    required(
      Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        coordinates.every(finitePoint),
      'coordinates',
    );
    required(
      Array.isArray(distances) &&
        distances.length === coordinates.length &&
        distances.every(Number.isFinite),
      'arc-length stations',
    );
    required(
      distances[0] === 0 &&
        distances.every((v, i) => !i || v >= distances[i - 1]) &&
        distances.at(-1) > 0,
      'ordered arc lengths',
    );
    required(
      Array.isArray(service.orderedStops) && service.orderedStops.length >= 2,
      'ordered service stops',
    );
    const at = (station) => {
      if (station <= distances[0]) return [...coordinates[0]];
      if (station >= distances.at(-1)) return [...coordinates.at(-1)];
      let i = 0;
      while (i + 1 < distances.length && distances[i + 1] <= station) i++;
      const fraction =
        (station - distances[i]) / (distances[i + 1] - distances[i]);
      return coordinates[i].map(
        (value, axis) => value + (coordinates[i + 1][axis] - value) * fraction,
      );
    };
    for (let i = 1; i < service.orderedStops.length; i++) {
      const a = service.orderedStops[i - 1],
        b = service.orderedStops[i];
      const order = LINES[service.lineId];
      const from = order.indexOf(a.stationId),
        to = order.indexOf(b.stationId);
      required(
        from >= 0 && to >= 0 && Math.abs(from - to) === 1,
        'adjacent regional stops',
      );
      required(
        Number.isFinite(a.pathStationM) &&
          Number.isFinite(b.pathStationM) &&
          a.pathStationM >= 0 &&
          b.pathStationM > a.pathStationM &&
          b.pathStationM <= distances.at(-1),
        'valid stop interval',
      );
      const direction =
        service.lineId === 'expo'
          ? to > from
            ? 'eastbound'
            : 'westbound'
          : to > from
            ? 'southbound'
            : 'northbound';
      required(
        service.directionId === direction,
        'direction agrees with stop order',
      );
      required(
        typeof a.sourceStopId === 'string' &&
          typeof b.sourceStopId === 'string',
        'platform stop identities',
      );
      const key = `${service.lineId}:${a.stationId}:${b.stationId}`;
      required(!seen.has(key), 'duplicate directed segment');
      seen.add(key);
      const points = [at(a.pathStationM)];
      for (let k = 0; k < distances.length; k++)
        if (distances[k] > a.pathStationM && distances[k] < b.pathStationM)
          points.push([...coordinates[k]]);
      points.push(at(b.pathStationM));
      segments.push({
        lineId: service.lineId,
        from: a.stationId,
        to: b.stationId,
        direction,
        sourceShapeId: service.sourceShapeId,
        sourceStopIds: [a.sourceStopId, b.sourceStopId],
        planarLengthM: b.pathStationM - a.pathStationM,
        coordinates: points,
      });
    }
  }
  required(segments.length === 12, 'complete twelve directed segments');
  return {
    schema: 1,
    source: RELEASE_ID,
    sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
    scope:
      'GTFS planar alignment; runtime station endpoints and vertical profiles are representative, not surveyed',
    segments,
  };
}

export const serializeSkyTrainRoutes = (data) => JSON.stringify(data) + '\n';

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((value) => value !== '--check'))
    throw new Error('Usage: node tools/build-skytrain-routes.mjs [--check]');
  const text = serializeSkyTrainRoutes(
    buildSkyTrainRoutes(await readFile(SOURCE, 'utf8')),
  );
  if (args.includes('--check')) {
    if ((await readFile(OUTPUT, 'utf8')) !== text)
      throw new Error(
        'SkyTrain route output is stale; regenerate with node tools/build-skytrain-routes.mjs',
      );
    process.stdout.write(
      'SkyTrain route output matches its exact local GTFS source.\n',
    );
  } else {
    await writeFile(OUTPUT, text);
    process.stdout.write(
      `Wrote ${OUTPUT} from the retained local GTFS source.\n`,
    );
  }
}
