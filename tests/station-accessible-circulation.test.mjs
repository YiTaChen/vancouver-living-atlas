import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebuildWaterfront } from '../tools/station-interiors/waterfront.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../tools/station-interiors/dunsmuir.mjs';
import {
  rebuildStadium,
  rebuildYaletown,
} from '../tools/station-interiors/southeast.mjs';

const packet = JSON.parse(
  readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
);
for (const [id, rebuild, entryNames] of [
  [
    'waterfront',
    rebuildWaterfront,
    ['waterfront-cordova-entry', 'cordova-lobby'],
  ],
  ['burrard', rebuildBurrard, []],
  ['granville', rebuildGranville, ['granville-dunsmuir-entry']],
  [
    'stadium-chinatown',
    rebuildStadium,
    ['stadium-beatty-entry', 'stadium-keefer-entry'],
  ],
  ['yaletown-roundhouse', rebuildYaletown, []],
])
  test(`${id}: accessible street entrances reach all boarding surfaces without stairs or escalators`, () => {
    const station = rebuild(packet.stations.find((s) => s.stationId === id));
    const entrances = station.entrances.filter(
      (e) =>
        entryNames.includes(e.entranceId) ||
        /accessible|lift/.test(e.entranceId),
    );
    assert(
      entrances.length > 0,
      'station retains an actual accessible street entrance',
    );
    for (const entry of entrances) {
      const reachable = new Set([entry.surfaceId]);
      for (const floor of reachable)
        for (const c of station.connections.filter(
          (c) => c.type === 'walk' || c.type === 'elevator',
        )) {
          if (c.fromSurfaceId === floor) reachable.add(c.toSurfaceId);
          if (c.toSurfaceId === floor) reachable.add(c.fromSurfaceId);
        }
      for (const platform of station.platforms)
        assert(
          reachable.has(platform.surfaceId),
          `${id}/${entry.entranceId}: step-free route must reach ${platform.surfaceId}`,
        );
    }
  });
