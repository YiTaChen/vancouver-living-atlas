import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);
const { TravelCameraCollision } = await import(
  cityModule('travel-camera-collision')
);
const fixture = () => {
  const data = JSON.parse(
    readFileSync('public/models/skytrain-stations/burrard.json'),
  );
  data.authoredInterior = {
    revision: 'renderer-regression-fixture',
    dimensions: 'representative',
    references: [{ url: 'https://www.translink.ca/', note: 'Test fixture.' }],
  };
  data.obstacles = [];
  data.parts = [
    {
      id: 'fixture-lower-wall',
      position: [0, -7, -3],
      size: [8, 4, 0.2],
      yaw: 0,
      material: 'concrete',
      role: 'wall',
    },
    {
      id: 'fixture-ceiling',
      position: [0, -5.9, 0],
      size: [8, 0.2, 8],
      yaw: 0,
      material: 'cream',
      role: 'ceiling',
    },
    {
      id: 'fixture-sloped-soffit',
      position: [5, -7, 0],
      size: [0.2, 0.2, 4],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35)
        .toArray(),
      yaw: 0,
      material: 'stainless',
      role: 'soffit',
    },
  ];
  data.signs = [
    {
      text: 'EXPO LINE',
      position: [0, -6.5, 0],
      width: 3,
      height: 0.4,
      yaw: 0,
      background: '#004b7d',
    },
  ];
  return data;
};
const partMesh = (owner, id) =>
  owner.group.children.find((mesh) =>
    mesh.userData.stationPartIds?.includes(id),
  );

test('authored interiors render their exact parts and sloped transforms without generic circulation', () => {
  const data = fixture(),
    owner = new SkyTrainStationOwner(data, () => 42);
  try {
    const meshes = owner.group.children.filter(
      (mesh) => mesh instanceof THREE.InstancedMesh,
    );
    assert.equal(
      meshes.reduce((sum, mesh) => sum + mesh.count, 0),
      3,
    );
    assert(
      !owner.group.children.some((mesh) =>
        /underground|escalator/.test(mesh.name),
      ),
    );
    const mesh = partMesh(owner, 'fixture-sloped-soffit'),
      matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion();
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
    assert(
      Math.abs(
        rotation.dot(new THREE.Quaternion(...data.parts[2].quaternion)),
      ) > 0.999999,
    );
    assert(mesh.userData.stationOverhead);
    assert.equal(
      partMesh(owner, 'fixture-ceiling').material.color.getHex(),
      0xe4dfd2,
    );
  } finally {
    owner.dispose();
  }
});

test('cutaway removes overhead camera obstacles and clips upper walls while preserving lower wall collision', () => {
  const owner = new SkyTrainStationOwner(fixture(), () => 42),
    collision = new TravelCameraCollision(),
    roof = partMesh(owner, 'fixture-ceiling'),
    wall = partMesh(owner, 'fixture-lower-wall'),
    world = (point) => new THREE.Vector3(...owner.toWorld(point)),
    pivot = world([0, -7.9, 0]),
    desired = world([0, -3.5, -6]);
  try {
    assert(collision.resolve(pivot, desired, [roof]).distanceTo(desired) > 1);
    owner.setCutaway(-9);
    assert.equal(roof.visible, false);
    assert(
      collision.resolve(pivot, desired, [roof]).distanceTo(desired) < 1e-8,
    );
    const upperPivot = world([0, -5.5, 0]),
      upperDesired = world([0, -5.5, -7]),
      lowerPivot = world([0, -8, 0]),
      lowerDesired = world([0, -8, -7]);
    assert(
      collision
        .resolve(upperPivot, upperDesired, [wall])
        .distanceTo(upperDesired) < 1e-8,
    );
    assert(
      collision
        .resolve(lowerPivot, lowerDesired, [wall])
        .distanceTo(lowerDesired) > 3,
    );
    owner.updateCutaway(world([0, -7.35, 0]), -9);
    assert.equal(owner.group.userData.stationCutaway, false);
    assert.equal(roof.visible, true);
    assert(
      collision
        .resolve(upperPivot, upperDesired, [wall])
        .distanceTo(upperDesired) > 3,
    );
  } finally {
    owner.dispose();
  }
});

test('authored transforms and signs fail closed and escalator treads retain the walking graph', () => {
  const data = fixture(),
    connection = data.connections.find((item) => item.treads.length);
  assert(connection);
  connection.type = 'escalator';
  assert.equal(validateRuntimeStation(data), data);
  const owner = new SkyTrainStationOwner(data, () => 42);
  try {
    assert.equal(
      owner.floors.filter((floor) =>
        floor.id.startsWith(`${connection.id}:step:`),
      ).length,
      connection.treads.length,
    );
  } finally {
    owner.dispose();
  }
  for (const mutate of [
    (value) => (value.parts[2].quaternion = [0, 0, 0, 0]),
    (value) => (value.signs[0].position[1] = NaN),
    (value) => (value.signs[0].width = -1),
    (value) =>
      (value.authoredInterior.references[0].url = 'javascript:alert(1)'),
  ]) {
    const invalid = fixture();
    mutate(invalid);
    assert.throws(() => validateRuntimeStation(invalid));
  }
});
