import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  actualTrain,
  stationOwner,
  routes,
  ridePath,
  resourceDisposals,
} from './helpers/skytrain-geometry.mjs';

function reachableSpace(space, spawn) {
  const key = (point) => `${point[0].toFixed(2)}:${point[2].toFixed(2)}`;
  const queue = [spawn],
    discovered = new Set([key(spawn)]);
  for (let i = 0; i < queue.length; i++) {
    assert(
      queue.length < 10000,
      'a single real cabin reachability search has a strict finite work bound',
    );
    const point = queue[i];
    for (const [dx, dz] of [
      [0.1, 0],
      [-0.1, 0],
      [0, 0.1],
      [0, -0.1],
    ]) {
      const next = [
          Math.round((point[0] + dx) * 100) / 100,
          point[1],
          Math.round((point[2] + dz) * 100) / 100,
        ],
        id = key(next);
      if (!discovered.has(id) && space.clear(next)) {
        discovered.add(id);
        queue.push(next);
      }
    }
  }
  return queue;
}
for (const line of ['expo', 'canada']) {
  test(`${line}: every actual GLB cushion is approachable inside its own car, with swept furniture/door/end-wall collisions`, async () => {
    const train = await actualTrain(line),
      space = train.passengerSpace;
    try {
      assert.equal(space.seats.length, line === 'expo' ? 22 : 20);
      assert.equal(space.clear([]), false);
      assert.equal(space.clear([0, train.floorAboveRail, NaN]), false);
      const reachable = reachableSpace(space, space.doorSpawn('left'));
      for (const seat of space.seats) {
        assert(seat.seatHeight > 0.45 && seat.seatHeight < 0.6, seat.id);
        assert(seat.eyeHeight > 1 && seat.eyeHeight < 1.3, seat.id);
        assert(
          seat.approaches.length > 0 && seat.approaches.length <= 64,
          seat.id,
        );
        for (const approach of seat.approaches) {
          assert(
            space.clear(approach),
            `${seat.id} has an actual free standing origin`,
          );
          assert(
            space.clearSegment(approach, seat.position, true),
            `${seat.id} approach does not cross a structural screen`,
          );
        }
        const descriptor = train.owner.descriptor.viewpoints.find(
          (view) => view.id === seat.id,
        );
        const authored = new THREE.Vector3(...descriptor.positionM).add(
          train.owner.group.position,
        );
        const resolved = new THREE.Vector3(...seat.position).add(
          new THREE.Vector3(
            seat.eyeOffsetXZ[0],
            seat.eyeHeight,
            seat.eyeOffsetXZ[1],
          ),
        );
        assert(
          authored.distanceTo(resolved) < 1e-5,
          `${seat.id} preserves the actual authored eye and pelvis offset`,
        );

        assert.equal(
          space.clear(seat.position),
          false,
          `walking cannot pass through ${seat.id}`,
        );
        assert(
          reachable.some((point) => space.canSit(seat, point)),
          `walk from the boarding door to ${seat.id}`,
        );
      }
      for (const side of ['left', 'right']) {
        const spawn = space.doorSpawn(side);
        assert(space.clear(spawn));
        let point = spawn;
        for (let i = 0; i < 100; i++)
          point = space.walk(point, side === 'left' ? 0.3 : -0.3, 0);
        assert(
          Math.abs(point[0]) < 1.25,
          'opening a door cannot let cabin walking escape sideways',
        );
        assert(space.clear(point));
        assert.deepEqual(space.walk(point, Infinity, 0), point);
        assert.deepEqual(space.walk(point, 100, 0), point);
      }
      for (const point of reachable)
        assert(
          Math.abs(point[2]) < (line === 'expo' ? 7.8 : 10.3),
          'no intercar traversal or exterior walking',
        );
    } finally {
      train.dispose();
    }
    assert.equal(train.passengerSpace, null);
  });
  test(`${line}: seated eye and feet remain attached to the occupied articulated car through real track curves and station resets`, async () => {
    const train = await actualTrain(line),
      seat = train.passengerSpace.seats[0];
    const segment = routes.segments.find((row) => row.lineId === line),
      path = ridePath(segment);
    const eye = new THREE.Vector3(),
      quaternion = new THREE.Quaternion();
    train.setPassengerLocal(seat.position, seat.eyeHeight, seat.eyeOffsetXZ);
    for (const progress of [0, 0.13, 0.42, 0.81, 1]) {
      train.setPathPose(path, progress);
      train.passengerWorldPose(eye, quaternion);
      const expected = new THREE.Vector3(...seat.position).add(
        new THREE.Vector3(
          seat.eyeOffsetXZ[0],
          seat.eyeHeight,
          seat.eyeOffsetXZ[1],
        ),
      );
      train.carFrames[0].localToWorld(expected);
      assert(eye.distanceTo(expected) < 1e-7);
      assert(
        new THREE.Vector3(
          ...train.passengerPointToWorld(seat.position),
        ).distanceTo(train.passenger.getWorldPosition(new THREE.Vector3())) <
          1e-7,
      );
    }
    train.resetCarFrames();
    assert.deepEqual(train.passenger.position.toArray(), seat.position);
    const verifyDisposed = resourceDisposals(train.group);
    train.dispose();
    verifyDisposed();
  });
}
test('all seven authored station bench inventories produce floor-verified seats and safe stands, then become unavailable on disposal', () => {
  for (const id of [
    'waterfront',
    'burrard',
    'granville',
    'stadium-chinatown',
    'main-street-science-world',
    'vancouver-city-centre',
    'yaletown-roundhouse',
  ]) {
    const owner = stationOwner(id),
      seats = owner.benchSeats();
    assert(seats.length > 0, id);
    assert.equal(
      owner.benchSeats(),
      seats,
      'static station inventory is cached',
    );
    for (const seat of seats) {
      const part = owner.data.parts.find((part) =>
        seat.id.startsWith(part.id + ':'),
      );
      assert(part && /bench/.test(part.id));
      assert(owner.isClearFoot(seat.stand), seat.id);
      assert(owner.canApproachSeat(seat, seat.stand), seat.id);
      assert.equal(
        owner.canApproachSeat(seat, {
          ...seat.stand,
          layer: seat.stand.layer + 1,
        }),
        false,
      );
      const underBench = owner.floorAt(seat.position, seat.stand.surfaceId);
      assert.equal(
        owner.canApproachSeat(seat, underBench),
        false,
        'the cushion cannot be approached through its collision body',
      );
      assert.equal(
        owner.floorAt(seat.position, seat.stand.surfaceId)?.layer,
        seat.stand.layer,
      );
      assert(
        Math.abs(
          seat.position[1] +
            seat.seatHeight -
            (part.position[1] + part.size[1] / 2),
        ) < 1e-6,
      );
    }
    owner.dispose();
    assert.deepEqual(owner.benchSeats(), []);
    assert.equal(owner.isClearFoot(seats[0].stand), false);
  }
});

test('the actual central glass partition blocks sitting from the boarding pocket until the passenger walks into the aisle', async () => {
  const train = await actualTrain('expo'),
    space = train.passengerSpace;
  try {
    let point = space.doorSpawn('left');
    for (let i = 0; i < 7; i++) point = space.walk(point, 0, -0.18);
    assert(
      Math.abs(point[0] - 0.65) < 1e-8 && Math.abs(point[2] + 0.72) < 1e-8,
    );
    assert(
      space.clear(point),
      'the stopped player still occupies valid cabin floor',
    );
    const cushion = space.seats.find((seat) => seat.id === 'seat-long-left-5');
    assert(
      Math.hypot(
        point[0] - cushion.position[0],
        point[2] - cushion.position[2],
      ) < 1.45,
      'range alone would incorrectly allow this seat',
    );
    assert.equal(
      space.canSit(cushion, point),
      false,
      'no teleport through the original partition',
    );
    assert.equal(
      space.seats.some((seat) => space.canSit(seat, point)),
      false,
    );
    for (let i = 0; i < 3; i++) point = space.walk(point, -0.18, 0);
    for (let i = 0; i < 4; i++) point = space.walk(point, 0, -0.18);
    assert(
      space.canSit(cushion, point),
      'walking around the partition exposes the cushion',
    );
    assert(
      cushion.approaches.some((approach) =>
        space.clearSegment(point, approach),
      ),
      'the approach is an unobstructed body sweep',
    );
    const transverse = space.seats.find(
      (seat) => seat.id === 'seat-single-right-1',
    );
    const behind = [0.1, 0.95, 0.8];
    assert(space.clear(behind));
    assert.equal(
      space.canSit(transverse, behind),
      false,
      'a nearby rear aisle point cannot teleport through a seat back',
    );
    const observation = space.seats.find(
      (seat) => seat.id === 'seat-observation',
    );
    assert(
      observation.approaches.some(
        (approach) => approach[2] < observation.position[2],
      ),
      'tight observation chair keeps rear/side aisle access',
    );
  } finally {
    train.dispose();
  }
});
