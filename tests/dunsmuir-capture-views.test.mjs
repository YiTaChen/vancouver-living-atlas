import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
import { station } from './helpers/skytrain-geometry.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import {
  DUNSMUIR_HALL_VIEWPOINTS,
  prepareDunsmuirHallViewpoint,
} from '../tools/station-interiors/capture-dunsmuir-views.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
for (const spec of DUNSMUIR_HALL_VIEWPOINTS)
  for (const openWorld of [false, true])
    test(`${spec.stationId} actual interior ticket-hall capture has supported body and interior chase footprint, openWorld=${openWorld}`, () => {
      const owner = new SkyTrainStationOwner(
        station(spec.stationId),
        cityElevation,
        'balanced',
        openWorld,
      );
      try {
        const view = prepareDunsmuirHallViewpoint(spec, owner);
        assert.equal(view.foot.surfaceId, spec.floorId);
        assert(owner.isClearFoot(view.foot));
        assert.equal(
          owner.floorAt(view.foot.position, spec.floorId).position[1],
          view.foot.position[1],
        );
        const run =
            view.thirdDistance * Math.cos(Math.atan(0.28) - view.thirdPitch),
          chaseXZ = [
            view.foot.position[0] - Math.sin(view.yaw) * run,
            view.foot.position[1],
            view.foot.position[2] - Math.cos(view.yaw) * run,
          ];
        assert(
          owner.floorAt(chaseXZ, spec.floorId),
          'dedicated third-person view stays over the actual hall footprint',
        );
        const required =
          spec.stationId === 'burrard'
            ? [
                'burrard-ticket-atrium-truss-',
                'burrard-ticket-atrium-ticket-machine-',
              ]
            : [
                'granville-original-ticket-hall-round-column',
                'granville-original-ticket-hall-ceiling',
              ];
        for (const prefix of required)
          assert(owner.geometryData.parts.some((p) => p.id.startsWith(prefix)));
        assert.throws(
          () =>
            prepareDunsmuirHallViewpoint(
              { ...spec, offsetFromBoundsCenter: [1000, 0, 1000] },
              owner,
            ),
          /Unsupported ticket-hall viewpoint/,
        );
      } finally {
        owner.dispose();
      }
    });
