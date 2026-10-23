import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  actualTrain,
  station,
  routes,
  ridePath,
} from './helpers/skytrain-geometry.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const { TravelCameraCollision, TRAVEL_PITCH_LIMIT, travelLookDirection } =
  await import(cityModule('travel-camera-collision'));
const UP = new THREE.Vector3(0, 1, 0);
function controller(train, seat, options = {}) {
  const camera = new THREE.PerspectiveCamera(
      65,
      options.aspect ?? 1.6,
      0.05,
      10000,
    ),
    attributes = new Map(),
    city = {
      camera,
      settings: { mode: 'walk' },
      controls: { target: new THREE.Vector3() },
      renderer: {
        domElement: {
          setAttribute: (key, value) => attributes.set(key, value),
        },
      },
      navigation: {
        position: new THREE.Vector3(),
        walker: {
          group: new THREE.Group(),
          setSeated() {},
          update() {},
        },
      },
    },
    collision = new TravelCameraCollision();
  let calls = 0;
  const view = Object.assign(Object.create(SkyTrainWorldTravel.prototype), {
    city,
    phase: 'riding',
    occupied: {},
    train,
    cabinSeat: seat,
    cabinFoot: seat?.position ??
      train?.passengerSpace.doorSpawn('left') ?? [0, 0, 0],
    yaw: seat?.yaw ?? 0,
    lookYaw: 0,
    pitch: -0.03,
    distanceView: options.distance ?? 4,
    avatarSeated: false,
    cameraCollision: {
      resolve(...args) {
        calls++;
        return collision.resolve(...args);
      },
    },
  });
  return { view, city, attributes, collision, calls: () => calls };
}
function anchors(view, seat) {
  const feet = new THREE.Vector3(...view.interactionOrigin),
    quaternion = view.city.navigation.walker.group.quaternion,
    up = UP.clone().applyQuaternion(
      view.aboard
        ? view.train.carFrames[0].getWorldQuaternion(new THREE.Quaternion())
        : view.owner.group.quaternion,
    ),
    forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  return {
    feet,
    head: feet
      .clone()
      .addScaledVector(up, seat ? seat.seatHeight + 0.9 : 1.8)
      .addScaledVector(forward, seat ? 0.08 : 0),
    soles: feet
      .clone()
      .addScaledVector(up, 0.12)
      .addScaledVector(forward, seat ? 0.45 : 0),
    torso: feet
      .clone()
      .addScaledVector(up, seat ? seat.seatHeight + 0.72 : 1.05)
      .addScaledVector(forward, seat ? 0.12 : 0),
  };
}
function assertBodyView(h, seat, roots, label) {
  h.view.updateCamera();
  h.city.camera.updateMatrixWorld(true);
  const points = anchors(h.view, seat),
    camera = h.city.camera;
  assert(h.city.navigation.walker.group.visible, label);
  assert(camera.position.toArray().every(Number.isFinite));
  assert(
    camera.position.distanceTo(points.torso) > 0.55,
    `${label}: camera stays outside the body`,
  );
  for (const point of [points.head, points.soles]) {
    const projected = point.clone().project(camera);
    assert(projected.toArray().every(Number.isFinite), label);
    assert(
      Math.abs(projected.x) < 1 &&
        Math.abs(projected.y) < 1 &&
        projected.z > -1 &&
        projected.z < 1,
      `${label}: body remains framed ${projected.toArray().join(',')}`,
    );
  }
  for (const point of [points.head, points.torso]) {
    assert(
      h.collision
        .resolve(point, camera.position, roots, 0.02)
        .distanceTo(camera.position) < 0.005,
      `${label}: actual seats, walls and screens cannot obscure face/torso`,
    );
  }
  const cached = camera.userData.skyTrainBodyView;
  assert(cached, `${label}: a safe body view is cached`);
  const pivot = cached.root.localToWorld(cached.target.clone());
  assert(
    h.collision
      .resolve(pivot, camera.position, roots, 0.12)
      .distanceTo(camera.position) < 0.005,
    `${label}: the entire camera sphere stays clear of actual geometry`,
  );
}

for (const line of ['expo', 'canada']) {
  test(`${line}: every actual GLB seat has a clear framed third-person body view at close/far zoom on desktop and mobile`, async () => {
    const train = await actualTrain(line);
    try {
      for (const seat of train.passengerSpace.seats)
        for (const distance of [2.05, 4, 8, 14])
          for (const aspect of [1.6, 0.72]) {
            const h = controller(train, seat, { distance, aspect });
            assertBodyView(
              h,
              seat,
              [train.group],
              `${seat.id}, zoom ${distance}, aspect ${aspect}`,
            );
            const before = h.calls();
            h.view.updateCamera();
            assert.equal(
              h.calls() - before,
              1,
              'steady seated frames recheck collision once without repeating candidate search',
            );
          }
    } finally {
      train.dispose();
    }
  });
  test(`${line}: standing, seated articulation and near-vertical first-person viewing retain the occupied car`, async () => {
    const train = await actualTrain(line),
      seat = train.passengerSpace.seats[0],
      segment = routes.segments.find((row) => row.lineId === line),
      path = ridePath(segment);
    try {
      const standing = controller(train, null);
      assertBodyView(
        standing,
        null,
        [train.group],
        `${line} standing boarding pocket`,
      );
      const seated = controller(train, seat);
      for (const progress of [0, 0.17, 0.47, 0.84, 1]) {
        train.setPathPose(path, progress);
        assertBodyView(
          seated,
          seat,
          [train.group],
          `${line} articulated ${progress}`,
        );
      }
      seated.view.distanceView = 0.8;
      for (const pitch of [-TRAVEL_PITCH_LIMIT, TRAVEL_PITCH_LIMIT]) {
        seated.view.pitch = pitch;
        seated.view.updateCamera();
        const expected = travelLookDirection(seat.yaw, pitch).applyQuaternion(
          train.carFrames[0].getWorldQuaternion(new THREE.Quaternion()),
        );
        seated.city.camera.updateMatrixWorld(true);
        assert(
          seated.city.camera
            .getWorldDirection(new THREE.Vector3())
            .dot(expected) > 0.999999,
        );
        assert.equal(seated.city.navigation.walker.group.visible, false);
      }
    } finally {
      train.dispose();
    }
  });
}

test('every actual authored station bench retains a clear third-person body beneath its real station roof', () => {
  for (const id of [
    'waterfront',
    'burrard',
    'granville',
    'stadium-chinatown',
    'main-street-science-world',
    'vancouver-city-centre',
    'yaletown-roundhouse',
  ]) {
    const owner = new SkyTrainStationOwner(
      station(id),
      cityElevation,
      'balanced',
      true,
    );
    try {
      for (const seat of owner.benchSeats()) {
        const h = controller(null, null);
        Object.assign(h.view, {
          occupied: null,
          phase: 'station',
          owner,
          stationSeat: seat,
          cabinSeat: null,
          foot: seat.stand,
          yaw: seat.yaw,
        });
        assertBodyView(h, seat, [owner.group], `${id}:${seat.id}`);
      }
    } finally {
      owner.dispose();
    }
  }
});
