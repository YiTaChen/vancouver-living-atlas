/** Pending source-authoring physics QA. Use only with station/path physical
 * tests, not packet provenance/reproduction tests. No public asset is written.
 *
 * node --import ./tests/helpers/station-authored-fixtures.mjs --test \
 *   tests/skytrain-articulated-clearance.test.mjs \
 *   tests/skytrain-ride-path.test.mjs tests/station-rail-envelope.test.mjs
 */
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import {
  SOURCE,
  makeRuntimeStation,
} from '../../tools/build-skytrain-runtime-stations.mjs';
import { rebuildWaterfront } from '../../tools/station-interiors/waterfront.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../../tools/station-interiors/dunsmuir.mjs';
import {
  rebuildStadium,
  rebuildYaletown,
} from '../../tools/station-interiors/southeast.mjs';
import { cityModule } from './city-modules.mjs';

const { SKYTRAIN_STREET_ENTRANCES } = await import(
  cityModule('skytrain-street-access')
);
const read = fs.readFileSync,
  source = JSON.parse(read(SOURCE)),
  overrides = new Map();
for (const { id, rebuild } of [
  { id: 'waterfront', rebuild: rebuildWaterfront },
  { id: 'burrard', rebuild: rebuildBurrard },
  { id: 'granville', rebuild: rebuildGranville },
  { id: 'stadium-chinatown', rebuild: rebuildStadium },
  { id: 'yaletown-roundhouse', rebuild: rebuildYaletown },
]) {
  const built = rebuild(source.stations.find((s) => s.stationId === id));
  const datum = built.authoredInterior.mappedHorizontalBasis?.datumLonLat;
  if (datum) SKYTRAIN_STREET_ENTRANCES[id][0].lonlat = [...datum];
  overrides.set(
    resolve(`public/models/skytrain-stations/${id}.json`),
    JSON.stringify(makeRuntimeStation(built, 'a'.repeat(64))),
  );
}
// Reviewed phase3 references are switched with the phase3 public packet.
SKYTRAIN_STREET_ENTRANCES['stadium-chinatown'][0].lonlat = [
  -123.110108, 49.2798687,
];
SKYTRAIN_STREET_ENTRANCES['stadium-chinatown'][1].lonlat = [
  -123.10849, 49.2788731,
];

SKYTRAIN_STREET_ENTRANCES['yaletown-roundhouse'][0].lonlat = [
  -123.121947, 49.2745277,
];
if (
  !SKYTRAIN_STREET_ENTRANCES['yaletown-roundhouse'].some(
    (e) => e.id === 'davie-elevator',
  )
)
  SKYTRAIN_STREET_ENTRANCES['yaletown-roundhouse'].push({
    id: 'davie-elevator',
    label: 'Davie Street · separate elevator entrance',
    lonlat: [-123.121882, 49.2745181],
    bearing: 45,
    source: SKYTRAIN_STREET_ENTRANCES['yaletown-roundhouse'][0].source,
    coordinateSource: 'https://www.openstreetmap.org/node/9133604358',
  });

fs.readFileSync = function (path, options) {
  const filename = path instanceof URL ? fileURLToPath(path) : path,
    data =
      typeof filename === 'string'
        ? overrides.get(resolve(filename))
        : undefined;
  if (data === undefined) return read.call(this, path, options);
  return typeof options === 'string' || options?.encoding
    ? data
    : Buffer.from(data);
};
syncBuiltinESMExports();
