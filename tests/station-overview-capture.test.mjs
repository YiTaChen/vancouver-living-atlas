import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
import { station } from './helpers/skytrain-geometry.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { prepareStationOverviewViewpoint } from '../tools/station-interiors/capture-overview-view.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
for (const id of [
  'waterfront',
  'burrard',
  'granville',
  'stadium-chinatown',
  'yaletown-roundhouse',
])
  for (const openWorld of [false, true])
    test(`${id} overview uses a genuine body-clear lowest platform and the normal occupied-level cut plane, openWorld=${openWorld}`, () => {
      const owner = new SkyTrainStationOwner(
        station(id),
        cityElevation,
        'balanced',
        openWorld,
      );
      try {
        const view = prepareStationOverviewViewpoint(owner),
          platform = owner.data.platforms.find((p) => p.id === view.platformId),
          expectedY = Math.min(
            ...owner.data.platforms.map((p) => p.floorHeight),
          );
        assert(platform);
        assert.equal(view.floorId, platform.surfaceId);
        assert(Math.abs(view.foot.position[1] - expectedY) < 0.01);
        assert(owner.isClearFoot(view.foot));
        assert.deepEqual(
          owner.floorAt(view.foot.position, view.floorId).position,
          view.foot.position,
        );
        const world = owner.toWorld(view.foot.position),
          camera = {
            toArray: () => [world[0] + 55, world[1] + 85, world[2] + 65],
          };
        owner.updateCutaway(camera, view.foot.position[1]);
        assert.equal(owner.group.userData.stationCutaway, true);
        for (const { mesh, minimumY } of owner.overheadMeshes)
          assert.equal(mesh.visible, minimumY <= expectedY + 2.8);
        assert.throws(
          () =>
            prepareStationOverviewViewpoint({
              data: owner.data,
              geometryData: owner.geometryData,
              floorAt: () => null,
              isClearFoot: () => true,
            }),
          /No supported body-clear/,
        );
      } finally {
        owner.dispose();
      }
    });
