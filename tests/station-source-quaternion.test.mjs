import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { interior } from '../tools/station-interiors/builder.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);

test('source quaternion survives authoring and export into matching rendered and physical walls', () => {
  const source = JSON.parse(readFileSync(SOURCE)).stations.find(
      (station) => station.stationId === 'burrard',
    ),
    builder = interior(source, 'source-quaternion-regression', [
      {
        url: 'https://www.translink.ca/',
        note: 'Synthetic transform regression fixture.',
      },
    ]),
    rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.2, Math.PI / 4, -0.1, 'YXZ'),
    ),
    quaternion = rotation.toArray(),
    floorY = source.floorSurfaces.find(
      (floor) => floor.surfaceId === 'burrard-upper',
    ).verticesM[0][1];
  for (const platform of source.platforms)
    builder.platform(platform.surfaceId, { columns: false, roof: false });
  builder.entrance(
    'quaternion-fixture-entry',
    'Fixture entry',
    'burrard-upper',
    [0, floorY, -4],
  );
  builder.box(
    'quaternion-fixture-wall',
    [0, floorY + 1, 0],
    [0.2, 2, 4],
    'cream',
    'wall',
    0,
    true,
    quaternion,
  );
  const authored = builder.finish(),
    data = makeRuntimeStation(authored, 'a'.repeat(64)),
    obstacle = data.obstacles.find(
      (part) => part.id === 'quaternion-fixture-wall',
    );
  assert.deepEqual(authored.obstacles[0].rotationQuaternionXYZW, quaternion);
  assert.deepEqual(obstacle.quaternion, quaternion);
  assert.equal(validateRuntimeStation(data), data);
  const owner = new SkyTrainStationOwner(data, () => 0);
  try {
    const mesh = owner.group.children.find((part) =>
        part.userData.stationPartIds?.includes(obstacle.id),
      ),
      matrix = new THREE.Matrix4(),
      rendered = new THREE.Quaternion();
    mesh.getMatrixAt(mesh.userData.stationPartIds.indexOf(obstacle.id), matrix);
    matrix.decompose(new THREE.Vector3(), rendered, new THREE.Vector3());
    assert(rendered.normalize().angleTo(rotation) < 1e-6);
    const point = (x, z) => {
      const p = new THREE.Vector3(x, 0, z).applyQuaternion(rotation);
      return owner.floorAt([p.x, floorY, p.z], 'burrard-upper');
    };
    const wallPoint = point(0, 1.2),
      clearPoint = point(0.95, 1.2);
    assert(wallPoint && clearPoint);
    assert(
      !owner.isClearFoot(wallPoint),
      'the actual rotated wall blocks the pedestrian body',
    );
    assert(
      owner.isClearFoot(clearPoint),
      'nearby floor outside the rotated wall remains usable',
    );
    const malformed = structuredClone(data);
    malformed.obstacles[0].quaternion = [0, 0, 0, 0];
    assert.throws(() => validateRuntimeStation(malformed));
  } finally {
    owner.dispose();
  }
});
