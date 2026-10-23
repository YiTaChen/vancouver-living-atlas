import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../tools/station-interiors/dunsmuir.mjs';
import { cityModule } from './helpers/city-modules.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const packet = JSON.parse(readFileSync(SOURCE));
for (const [id, rebuild] of [
  ['burrard', rebuildBurrard],
  ['granville', rebuildGranville],
]) {
  test(`${id}: enclosed elevator landings retain open approach doors and solid rear walls`, () => {
    const source = rebuild(packet.stations.find((s) => s.stationId === id)),
      owner = new SkyTrainStationOwner(
        makeRuntimeStation(source, 'a'.repeat(64)),
        () => 0,
      );
    try {
      assert(source.authoredInterior.elevatorLandings.length > 0);
      for (const landing of source.authoredInterior.elevatorLandings) {
        const [dx, , dz] = landing.outwardDirectionM;
        let foot = owner.floorAt(landing.pointM, landing.floorId);
        assert(
          foot && owner.isClearFoot(foot),
          `${landing.floorId}: lift endpoint supports the body`,
        );
        for (let i = 0; i < 22; i++)
          foot = owner.walk(foot, dx * 0.075, dz * 0.075);
        assert(
          Math.hypot(
            foot.position[0] - landing.pointM[0],
            foot.position[2] - landing.pointM[2],
          ) > 1.6,
          `${landing.floorId}: the open lift portal must reach its real landing`,
        );
        for (let i = 0; i < 22; i++)
          foot = owner.walk(foot, -dx * 0.075, -dz * 0.075);
        assert(
          Math.hypot(
            foot.position[0] - landing.pointM[0],
            foot.position[2] - landing.pointM[2],
          ) < 0.06,
        );
        for (let i = 0; i < 25; i++)
          foot = owner.walk(foot, -dx * 0.075, -dz * 0.075);
        assert(
          Math.hypot(
            foot.position[0] - landing.pointM[0],
            foot.position[2] - landing.pointM[2],
          ) < 0.95,
          `${landing.floorId}: the real shaft back wall stops the body`,
        );
      }
    } finally {
      owner.dispose();
    }
  });
}
