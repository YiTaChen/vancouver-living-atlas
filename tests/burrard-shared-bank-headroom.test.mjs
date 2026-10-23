import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildBurrard } from '../tools/station-interiors/dunsmuir.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const source = JSON.parse(readFileSync(SOURCE)),
  rebuilt = rebuildBurrard(
    source.stations.find((s) => s.stationId === 'burrard'),
  ),
  data = makeRuntimeStation(rebuilt, 'a'.repeat(64)),
  hall = 'burrard-ticket-atrium';
const visible = (object) => {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return true;
};
function renderedTop(owner, point) {
  const world = owner.toWorld(point),
    ray = new THREE.Raycaster(
      new THREE.Vector3(world[0], world[1] + 0.9, world[2]),
      new THREE.Vector3(0, -1, 0),
      0,
      1.2,
    );
  return ray
    .intersectObject(owner.group, true)
    .find((hit) => visible(hit.object));
}

test('Burrard shared street-bank well removes false flat floor through its real structural plinth and retains the clear underpass', () => {
  const owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
  owner.group.updateMatrixWorld(true);
  try {
    const info = rebuilt.authoredInterior.sharedStreetBankWell;
    assert(Math.abs(info.cutBoundsM.minX + 10.3) < 1e-8);
    assert(Math.abs(info.cutBoundsM.maxX - 0.3) < 1e-8);
    assert.equal(info.cutBoundsM.minZ, -105);
    assert(info.cutBoundsM.maxZ > -100.6 && info.cutBoundsM.maxZ < -100.4);
    for (const point of [
      [-0.40575, -6.5, -103.80815384545],
      [-9.586, -6.5, -104.78507692295],
      [-6.1, -6.5, -104],
    ])
      assert.equal(
        owner.floorAt(point, hall),
        null,
        'interlane/cheek floor cannot support a body inside the shared bank',
      );
    const physical = renderedTop(owner, [-0.40575, -6.5, -103.80815384545]);
    assert(
      physical &&
        physical.point.y -
          owner.toWorld([-0.40575, -6.5, -103.80815384545])[1] >
          0.5,
      'actual raised structure remains rendered; it was not removed to hide the conflict',
    );
    const underpass = owner.floorAt([-5, -6.5, -99.5], hall);
    assert(underpass && owner.isClearFoot(underpass));
    let samples = 0;
    for (let x = -10; x <= 0; x += 0.4)
      for (let z = -105.6; z <= -98.2; z += 0.3) {
        const foot = owner.floorAt([x, -6.5, z], hall);
        if (!foot || !owner.isClearFoot(foot)) continue;
        const hit = renderedTop(owner, foot.position);
        assert(hit, `real rendered floor at ${foot.position}`);
        const partId = hit.object.userData.stationPartIds?.[hit.instanceId],
          part = owner.geometryData.parts.find((p) => p.id === partId),
          height = hit.point.y - owner.toWorld(foot)[1];
        // A tread extends 1 mm past the exact Z=-105 landing seam. That
        // intentional first riser must remain stepable in both directions.
        if (
          Math.abs(z + 105) < 1e-8 &&
          ['stair-tread', 'escalator-tread'].includes(part?.role) &&
          height > 0 &&
          height <= 0.221
        )
          continue;
        assert(
          Math.abs(height) < 0.01,
          `no raised bank penetrates a clear supported floor at ${foot.position}: ${hit.point.y - owner.toWorld(foot)[1]}m, ${hit.object.userData.stationPartIds?.[hit.instanceId] ?? hit.object.name}`,
        );
        samples++;
      }
    assert(
      samples > 50,
      'physical height proof covers retained landing and underpass',
    );
    let foot = owner.floorAt([-3, -6.5, -105.6], hall);
    assert(foot && owner.isClearFoot(foot));
    for (const direction of [1, -1])
      for (let i = 0; i < 12; i++) {
        const next = owner.walk(foot, 0, direction * 0.075);
        assert(owner.isClearFoot(next));
        assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
        foot = next;
      }
    assert(Math.abs(foot.position[2] + 105.6) < 0.03);
    assert(Math.abs(foot.position[1] + 6.5) < 1e-8);
    assert(owner.stats().drawCalls <= 32);
  } finally {
    owner.dispose();
  }
});
