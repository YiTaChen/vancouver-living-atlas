import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { actualTrain, station } from './helpers/skytrain-geometry.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
const { SkyTrainWorldPath, SkyTrainTerminalPath } = await import(
  cityModule('skytrain-world-path')
);
const { trainStopFor, stationWorldPose } = await import(
  cityModule('skytrain-stations')
);
const { project } = await import(cityModule('geo'));
const data = JSON.parse(
  readFileSync('public/data/transit/skytrain-world-routes.json', 'utf8'),
);
const pose = () => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
});
function sourceStop(route, index) {
  const stop = route.stops[index],
    motionSign = ['eastbound', 'southbound'].includes(route.direction) ? 1 : -1;
  if (stop.stationId) {
    const local = trainStopFor(
        station(stop.stationId),
        route.lineId,
        route.direction,
      ),
      world = stationWorldPose(
        station(stop.stationId),
        cityElevation,
        local.position,
        local.quaternion,
      );
    return {
      position: new THREE.Vector3(...world.position),
      quaternion: new THREE.Quaternion(...world.quaternion),
      motionSign,
    };
  }
  const points =
      route.segments[Math.min(index, route.segments.length - 1)].coordinates,
    ending = index === route.stops.length - 1,
    [ax, az] = project(points[ending ? points.length - 2 : 0]),
    [bx, bz] = project(points[ending ? points.length - 1 : 1]),
    [x, z] = project(points[ending ? points.length - 1 : 0]),
    heading = Math.atan2((bx - ax) * motionSign, (bz - az) * motionSign);
  return {
    position: new THREE.Vector3(x, route.lineId === 'expo' ? 10 : -16, z),
    quaternion: new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      heading,
    ),
    motionSign,
  };
}

for (const line of ['expo', 'canada']) {
  test(`${line}: actual train continues through the downtown edge on a full source leg with exact authored platform frames`, async () => {
    const train = await actualTrain(line),
      edge =
        line === 'expo' ? 'main-street-science-world' : 'yaletown-roundhouse';
    try {
      for (const route of data.routes.filter(
        (route) => route.lineId === line,
      )) {
        const edgeIndex = route.stops.findIndex(
            (stop) => stop.stationId === edge,
          ),
          outward = ['eastbound', 'southbound'].includes(route.direction),
          segmentIndex = outward ? edgeIndex : edgeIndex - 1,
          start = sourceStop(route, segmentIndex),
          end = sourceStop(route, segmentIndex + 1),
          original = JSON.stringify(route.segments[segmentIndex].coordinates),
          path = new SkyTrainWorldPath(route, segmentIndex, start, end);
        assert.equal(JSON.stringify(path.sourceCoordinates), original);
        assert.equal(
          JSON.stringify(route.segments[segmentIndex].coordinates),
          original,
        );
        assert(path.length > start.position.distanceTo(end.position));
        for (const [distance, stop] of [
          [0, start],
          [path.length, end],
        ]) {
          const actual = path.sampleDistance(distance);
          assert(actual.position.distanceTo(stop.position) < 1e-8);
          assert(actual.quaternion.angleTo(stop.quaternion) < 1e-7);
          for (const offset of [-35, -10, 10, 35]) {
            const car = path.sampleDistance(
                distance + offset * stop.motionSign,
              ),
              expected = new THREE.Vector3(0, 0, offset)
                .applyQuaternion(stop.quaternion)
                .add(stop.position);
            assert(
              car.position.distanceTo(expected) < 0.03,
              'whole consist retains straight authored platform track',
            );
          }
        }
        for (const progress of [0, 0.01, 0.2, 0.5, 0.8, 0.99, 1]) {
          train.setPathPose(path, progress);
          for (const [index, car] of train.carFrames.entries()) {
            const offset =
                line === 'expo'
                  ? [26.85, 8.95, -8.95, -26.85][index]
                  : [10.5, -10.5][index],
              expected = path.sampleDistance(
                progress * path.length + offset * path.start.motionSign,
              );
            assert(
              car
                .getWorldPosition(new THREE.Vector3())
                .distanceTo(expected.position) < 1e-6,
            );
            assert(
              car
                .getWorldQuaternion(new THREE.Quaternion())
                .angleTo(expected.quaternion) < 1e-7,
            );
          }
        }
      }
    } finally {
      train.dispose();
    }
  });
  test(`${line}: real Waterfront terminal crossover stops and reverses on tail track without spinning or folding the occupied consist`, async () => {
    const train = await actualTrain(line),
      pair = data.routes.filter((route) => route.lineId === line),
      arriving = pair.find(
        (route) => route.stops.at(-1).stationId === 'waterfront',
      ),
      departing = pair.find(
        (route) => route.stops[0].stationId === 'waterfront',
      ),
      start = sourceStop(arriving, arriving.stops.length - 1),
      end = sourceStop(departing, 0),
      path = new SkyTrainTerminalPath(start, end, line),
      forward = new THREE.Vector3(0, 0, 1).applyQuaternion(start.quaternion);
    try {
      const previous = pose();
      path.sampleDistance(0, previous);
      for (let i = 0; i <= 200; i++) {
        const progress = i / 200;
        train.setPathPose(path, progress);
        const actual = path.sampleDistance(progress * path.length);
        assert(
          new THREE.Vector3(0, 0, 1)
            .applyQuaternion(actual.quaternion)
            .dot(forward) > 0.97,
        );
        assert(actual.quaternion.angleTo(previous.quaternion) < 0.08);
        assert(Math.abs(actual.position.y - start.position.y) < 1e-7);
        previous.position.copy(actual.position);
        previous.quaternion.copy(actual.quaternion);
        for (let j = 1; j < train.carFrames.length; j++) {
          const gap = train.carFrames[j]
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(
              train.carFrames[j - 1].getWorldPosition(new THREE.Vector3()),
            );
          assert(
            Math.abs(gap - (line === 'expo' ? 17.9 : 21)) < 0.15,
            'cars remain in their own ordered physical track positions',
          );
        }
      }
      const before = path.sampleDistance(path.length * (0.5 - 1e-5)),
        stopped = path.sampleDistance(path.length * 0.5),
        after = path.sampleDistance(path.length * (0.5 + 1e-5));
      assert(stopped.position.distanceTo(path.tail) < 1e-7);
      assert(
        before.position.distanceTo(after.position) < 1e-6,
        'velocity tends to zero at the physical reversal',
      );
      assert(path.tail.distanceTo(start.position) > 190);
      assert(path.sampleDistance(0).position.distanceTo(start.position) < 1e-8);
      assert(
        path.sampleDistance(path.length).position.distanceTo(end.position) <
          1e-8,
      );
      assert(
        path.sampleDistance(path.length).quaternion.angleTo(start.quaternion) <
          1e-7,
      );
      for (const offset of [-26.85, 26.85]) {
        const a = path.sampleCarDistance(path.length * (0.5 - 1e-5), offset),
          b = path.sampleCarDistance(path.length * (0.5 + 1e-5), offset);
        assert(
          a.position.distanceTo(b.position) < 1e-6,
          'the same physical car stays continuous across direction reversal',
        );
      }
    } finally {
      train.dispose();
    }
  });
}
