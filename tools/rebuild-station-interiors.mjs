/** Rebuild one reviewed stage, or all five, then regenerate exactly the data the
 * game loads. Authoring modules are the maintained source of these interiors. */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildRuntimeStations,
  SOURCE,
} from './build-skytrain-runtime-stations.mjs';
const stages = {
  waterfront: ['./station-interiors/waterfront.mjs', 'rebuildWaterfront'],
  burrard: ['./station-interiors/dunsmuir.mjs', 'rebuildBurrard'],
  granville: ['./station-interiors/dunsmuir.mjs', 'rebuildGranville'],
  'stadium-chinatown': ['./station-interiors/southeast.mjs', 'rebuildStadium'],
  'yaletown-roundhouse': [
    './station-interiors/southeast.mjs',
    'rebuildYaletown',
  ],
};
const requested = process.argv.slice(2);
const ids = requested.length ? requested : Object.keys(stages);
const source = JSON.parse(readFileSync(SOURCE));
for (const id of ids) {
  if (!stages[id]) throw new Error('Unknown station ' + id);
  const [path, name] = stages[id],
    mod = await import(path);
  const i = source.stations.findIndex((s) => s.stationId === id);
  source.stations[i] = mod[name](source.stations[i]);
  console.log(
    `Rebuilt ${id}: ${source.stations[i].floorSurfaces.length} passenger surfaces, ${source.stations[i].connections.length} connections`,
  );
}
writeFileSync(SOURCE, JSON.stringify(source, null, 2) + '\n');
buildRuntimeStations();
