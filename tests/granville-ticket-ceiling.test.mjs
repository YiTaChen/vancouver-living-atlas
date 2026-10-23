import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildGranville } from '../tools/station-interiors/dunsmuir.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const packet = JSON.parse(readFileSync(SOURCE)),
  base = packet.stations.find((s) => s.stationId === 'granville'),
  rebuilt = rebuildGranville(base);

test('actual Granville original hall has physical ceiling panels and frame seams within existing overhead material batches', () => {
  const prefix = 'granville-original-ticket-hall-ceiling-',
    panels = rebuilt.geometryParts.filter((p) =>
      p.id.startsWith(prefix + 'panel-'),
    ),
    grid = rebuilt.geometryParts.filter((p) =>
      p.id.startsWith(prefix + 'grid-'),
    ),
    batches = new Set(base.geometryParts.map((p) => `${p.role}:${p.material}`));
  assert.equal(panels.length, 100);
  assert.equal(grid.length, 22);
  for (const part of [...panels, ...grid]) {
    assert.equal(part.role, 'ceiling');
    assert(batches.has(`${part.role}:${part.material}`));
    assert(part.centerM[1] - part.sizeM[1] / 2 > 0.03);
    assert(part.centerM[0] - part.sizeM[0] / 2 >= 72 - 1e-8);
    assert(part.centerM[0] + part.sizeM[0] / 2 <= 83.5 + 1e-8);
    assert(part.centerM[2] - part.sizeM[2] / 2 >= -110 - 1e-8);
    assert(part.centerM[2] + part.sizeM[2] / 2 <= -100 + 1e-8);
  }
  assert.match(
    rebuilt.authoredInterior.originalTicketHallCeiling.status,
    /inferred, not surveyed/,
  );
  const data = makeRuntimeStation(rebuilt, 'a'.repeat(64)),
    owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
  try {
    assert(
      owner.stats().drawCalls <= 32,
      `strict station budget: ${owner.stats().drawCalls}`,
    );
    assert(owner.stats().triangles < 50_000);
    assert(owner.stats().instances < 4_000);
    const foot = owner.floorAt(
      [77.3, -3, -103.6],
      'granville-original-ticket-hall',
    );
    assert(
      foot && owner.isClearFoot(foot),
      'original hall viewpoint retains body clearance',
    );
  } finally {
    owner.dispose();
  }
});
