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
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
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

test('authored open-city aprons render exactly their own sloping support triangles without filling source stairwells', () => {
  const data = adaptSkyTrainStationFrame(
      JSON.parse(readFileSync('public/models/skytrain-stations/burrard.json')),
      JSON.parse(readFileSync('public/models/skytrain-routes.json')),
    ),
    owner = new SkyTrainStationOwner(
      data,
      (x, z) => 20 + x * 0.015 - z * 0.01,
      'balanced',
      true,
    );
  try {
    const mesh = owner.group.children.find(
        (object) => object.name === 'station-authored-street-apron-support',
      ),
      sourceIds = new Set(data.floors.map((f) => f.id)),
      aprons = owner.geometryData.floors.filter(
        (f) => f.kind === 'street-apron' && !sourceIds.has(f.id),
      );
    assert(mesh?.isMesh && !mesh.isInstancedMesh);
    assert(aprons.length > 0);
    assert.deepEqual(
      mesh.userData.stationFloorIds,
      aprons.map((f) => f.id),
    );
    assert.equal(
      mesh.geometry.getAttribute('position').count,
      aprons.reduce((sum, f) => sum + f.vertices.length, 0),
    );
    assert.equal(
      mesh.geometry.index.count,
      aprons.reduce((sum, f) => sum + f.indices.length, 0),
    );
    const vertices = aprons.flatMap((f) => f.vertices),
      positions = mesh.geometry.getAttribute('position');
    for (const [index, p] of vertices.entries())
      assert(
        new THREE.Vector3()
          .fromBufferAttribute(positions, index)
          .distanceTo(new THREE.Vector3(...p)) < 1e-5,
      );
    const f = aprons[0],
      triangle = f.indices
        .slice(0, 3)
        .map((i) => new THREE.Vector3(...f.vertices[i])),
      centroid = triangle
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .multiplyScalar(1 / 3),
      world = new THREE.Vector3(...owner.toWorld(centroid.toArray()));
    assert(
      new Set(f.vertices.map((p) => p[1].toFixed(4))).size > 1,
      'terrain grid is actually sloping',
    );
    owner.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
        world.clone().add(new THREE.Vector3(0, 1, 0)),
        new THREE.Vector3(0, -1, 0),
      ),
      hit = ray.intersectObject(mesh)[0];
    assert(
      hit && hit.point.distanceTo(world) < 1e-4,
      'the visible GPU triangle matches the exact walking support',
    );
    const flight = data.connections.find(
        (c) => c.id === 'burrard-park-stairs-1',
      ),
      tread = flight.treads[3].vertices
        .reduce(
          (sum, p) => sum.add(new THREE.Vector3(...p)),
          new THREE.Vector3(),
        )
        .multiplyScalar(0.25),
      stairEye = new THREE.Vector3(...owner.toWorld(tread.toArray())).add(
        new THREE.Vector3(0, 20, 0),
      );
    assert.equal(
      new THREE.Raycaster(
        stairEye,
        new THREE.Vector3(0, -1, 0),
      ).intersectObject(mesh).length,
      0,
      'the added surface cannot cover the maintained first stair flight',
    );
    owner.setCutaway(-10);
    assert.equal(
      mesh.material.clippingPlanes[0],
      mesh.userData.stationCutawayPlane,
    );
    assert(
      mesh.material.clippingPlanes[0].distanceToPoint(world) < 0,
      'the apron clips above an underground avatar',
    );
    owner.setCutaway(null);
    assert(mesh.material.clippingPlanes[0].distanceToPoint(world) > 0);
    let geometryDisposals = 0,
      materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
    owner.dispose();
    owner.dispose();
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
  } finally {
    owner.dispose();
  }
});

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
