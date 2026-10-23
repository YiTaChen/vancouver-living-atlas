import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  actualTrain,
  ridePath,
  routes,
  resourceDisposals,
} from './helpers/skytrain-geometry.mjs';

const vector = (point) => new THREE.Vector3(...point);
const close = (actual, expected, context) =>
  assert(actual.distanceTo(expected) < 1e-6, context);
const lamps = (train) => {
  const result = [];
  train.group.traverse((node) => {
    if (node instanceof THREE.PointLight) result.push(node);
  });
  return result;
};

for (const line of ['expo', 'canada']) {
  test(`${line}: every actual seat, eye, floor and rider follows its selected articulated car without cabin duplication`, async () => {
    const train = await actualTrain(line),
      space = train.passengerSpace,
      source = train.owner,
      originalLamps = lamps(train),
      avatar = new THREE.Object3D(),
      path = ridePath(
        routes.segments.find((segment) => segment.lineId === line),
      );
    train.passenger.add(avatar);
    assert.equal(train.passengerCarIndex, 0);
    assert.equal(train.passengerFrame, train.carFrames[0]);
    assert.equal(originalLamps.length, 2);
    const geometries = new Set(),
      materials = new Set();
    train.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.add(material);
    });
    try {
      for (let carIndex = 0; carIndex < train.carFrames.length; carIndex++) {
        assert.equal(train.selectPassengerCar(carIndex), true);
        assert.equal(train.passengerCarIndex, carIndex);
        const frame = train.passengerFrame,
          cabin =
            line === 'canada' && carIndex === 1
              ? train.carFrames[1].getObjectByName(
                  'Canada Line second car — shared original geometry',
                )
              : source.group;
        assert(cabin);
        assert.equal(train.passenger.parent, frame);
        if (line === 'expo') assert.equal(source.group.parent, frame);
        for (const light of originalLamps) assert.equal(light.parent, frame);
        assert.deepEqual(new Set(lamps(train)), new Set(originalLamps));
        assert.equal(train.passengerSpace, space);
        for (const progress of [0, 0.21, 0.57, 0.83, 1]) {
          train.setPathPose(path, progress);
          const frameQuaternion = frame.getWorldQuaternion(
              new THREE.Quaternion(),
            ),
            up = new THREE.Vector3(0, 1, 0).applyQuaternion(frameQuaternion);
          const expectedQuaternion = train.carFrames[
            carIndex
          ].getWorldQuaternion(new THREE.Quaternion());
          if (line === 'canada' && carIndex === 1)
            expectedQuaternion.multiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.PI,
              ),
            );
          assert(frameQuaternion.angleTo(expectedQuaternion) < 1e-6);
          for (const seat of space.seats) {
            train.setPassengerLocal(
              seat.position,
              seat.eyeHeight,
              seat.eyeOffsetXZ,
            );
            const eye = new THREE.Vector3(),
              quaternion = new THREE.Quaternion(),
              foot = frame.localToWorld(vector(seat.position));
            train.passengerWorldPose(eye, quaternion);
            assert(quaternion.angleTo(frameQuaternion) < 1e-6);
            close(avatar.getWorldPosition(new THREE.Vector3()), foot, seat.id);
            close(vector(train.passengerPointToWorld(seat.position)), foot);
            const descriptor = source.descriptor.viewpoints.find(
                (view) => view.id === seat.id,
              ),
              authoredEye = cabin
                .getObjectByName(descriptor.nodeId)
                .getWorldPosition(new THREE.Vector3())
                .add(
                  vector(descriptor.offsetM).applyQuaternion(frameQuaternion),
                );
            close(eye, authoredEye, `${line} car ${carIndex}: ${seat.id} eye`);
            const ray = new THREE.Raycaster(
                foot.clone().addScaledVector(up, 1.2),
                up.clone().negate(),
                0,
                1.3,
              ),
              hits = ray.intersectObject(cabin, true);
            assert(
              hits.some(
                (hit) =>
                  /seat|priority/.test(hit.object.name) &&
                  Math.abs(
                    hit.point.clone().sub(foot).dot(up) - seat.seatHeight,
                  ) < 0.03,
              ),
              `${line} car ${carIndex}: ${seat.id} rests on its actual cushion`,
            );
          }
          const spawn = space.doorSpawn('left'),
            spawnWorld = vector(train.passengerPointToWorld(spawn)),
            floor = cabin.getObjectByName(
              line === 'expo'
                ? 'interior-batch-floor'
                : 'interior-batch-canada-floor',
            );
          const floorRay = new THREE.Raycaster(
            spawnWorld.clone().addScaledVector(up, 0.25),
            up.clone().negate(),
            0,
            0.5,
          );
          assert(
            floorRay
              .intersectObject(floor, false)
              .some((hit) => hit.point.distanceTo(spawnWorld) < 1e-5),
            `${line} car ${carIndex} keeps the selected aisle on the real floor`,
          );
        }
      }
      train.resetCarFrames();
      assert.equal(train.passengerCarIndex, train.carFrames.length - 1);
      let floorCount = 0;
      train.group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        if (/^interior-batch-(canada-)?floor$/.test(node.name)) floorCount++;
        assert(geometries.has(node.geometry));
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          assert(materials.has(material));
      });
      assert.equal(floorCount, line === 'expo' ? 1 : 2);
      const verifyDisposed = resourceDisposals(train.group);
      train.dispose();
      train.dispose();
      verifyDisposed();
    } finally {
      train.dispose();
    }
  });
}

test('passenger selection validates indexes, survives same-line reload, clamps a shorter consist and stays released after disposal', async () => {
  const train = await actualTrain('expo');
  const seat = train.passengerSpace.seats[0];
  train.setPassengerLocal(seat.position, seat.eyeHeight, seat.eyeOffsetXZ);
  assert(train.selectPassengerCar(3));
  const before = train.passengerFrame,
    passenger = train.passenger,
    local = passenger.position.clone();
  for (const invalid of [-1, 4, 1.5, NaN, Infinity]) {
    assert.equal(train.selectPassengerCar(invalid), false);
    assert.equal(train.passengerCarIndex, 3);
    assert.equal(train.passengerFrame, before);
    close(passenger.position, local);
  }
  assert(await train.load('expo', 'high', false));
  assert.equal(train.passengerCarIndex, 3);
  assert.equal(train.passenger.parent, train.carFrames[3]);
  assert.equal(train.owner.group.parent, train.carFrames[3]);
  assert.equal(lamps(train).length, 2);
  const loading = train.load('expo', 'balanced', false);
  assert(train.selectPassengerCar(2));
  assert(await loading);
  assert.equal(train.passengerCarIndex, 2);
  assert.equal(train.owner.group.parent, train.passengerFrame);
  assert(await train.load('canada', 'balanced', false));
  assert.equal(train.passengerCarIndex, 0);
  assert.equal(train.passenger.parent, train.carFrames[0]);
  assert(train.selectPassengerCar(1));
  const frame = train.passengerFrame;
  assert.equal(frame.parent, train.carFrames[1]);
  assert(await train.load('canada', 'high', false));
  assert.equal(train.passengerCarIndex, 1);
  assert.equal(train.passenger.parent, train.passengerFrame);
  assert.equal(lamps(train).length, 2);
  train.dispose();
  assert.equal(train.selectPassengerCar(0), false);
  assert.equal(train.passengerFrame, train.group);
  train.setPassengerLocal([0, 1, 0]);
  assert.equal(train.carFrames.length, 0);
  assert.equal(train.passengerSpace, null);
  assert.equal(lamps(train).length, 0);
  assert.equal(await train.load('expo', 'high', false), false);
});
