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
const { CityInteractions } = await import(cityModule('city-interactions'));
const { TravelCameraCollision, TRAVEL_PITCH_LIMIT, travelLookDirection } =
  await import(cityModule('travel-camera-collision'));
const UP = new THREE.Vector3(0, 1, 0);
const stationIds = [
  'waterfront',
  'burrard',
  'granville',
  'stadium-chinatown',
  'main-street-science-world',
  'vancouver-city-centre',
  'yaletown-roundhouse',
];
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
        walker: { group: new THREE.Group(), setSeated() {}, update() {} },
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
    frame = view.aboard ? view.train.passengerFrame : view.owner.group,
    up = UP.clone().applyQuaternion(
      frame.getWorldQuaternion(new THREE.Quaternion()),
    ),
    forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  return {
    feet,
    up,
    head: feet.clone().addScaledVector(up, seat ? seat.seatHeight + 0.9 : 1.8),
    soles: feet
      .clone()
      .addScaledVector(up, 0.12)
      .addScaledVector(forward, seat ? 0.45 : 0),
  };
}
function expectedDirection(view) {
  const direction = travelLookDirection(
    view.yaw + view.lookYaw + (view.aboard ? 0 : view.owner.yaw),
    view.distanceView >= 2
      ? -Math.atan(0.28) - THREE.MathUtils.clamp(-view.pitch, -0.22, 1.1)
      : view.pitch,
  );
  if (view.aboard)
    direction.applyQuaternion(
      view.train.passengerFrame.getWorldQuaternion(new THREE.Quaternion()),
    );
  return direction;
}
function assertStableChase(h, seat, label, checkFraming = true) {
  const yaw = h.view.yaw,
    lookYaw = h.view.lookYaw;
  h.view.updateCamera();
  h.city.camera.updateMatrixWorld(true);
  const points = anchors(h.view, seat),
    camera = h.city.camera,
    pivot = points.feet
      .clone()
      .addScaledVector(points.up, seat ? seat.seatHeight + 0.43 : 1.13),
    direction = expectedDirection(h.view),
    expected = pivot
      .clone()
      .addScaledVector(direction, -Math.min(14, h.view.distanceView));
  assert(h.city.navigation.walker.group.visible, label);
  assert(
    camera.position.distanceTo(expected) < 1e-7,
    `${label}: requested chase ray owns the exact position`,
  );
  assert(h.city.controls.target.distanceTo(pivot) < 1e-7, label);
  assert(
    camera.getWorldDirection(new THREE.Vector3()).dot(direction) > 0.999999,
    `${label}: camera cannot reverse or choose a side view`,
  );
  assert.equal(
    h.view.yaw,
    yaw,
    `${label}: rendering never rotates the pedestrian`,
  );
  assert.equal(h.view.lookYaw, lookYaw);
  assert.equal(
    h.calls(),
    0,
    'walls, roofs and chairs are handled by rendering and never search or contract the camera ray',
  );
  assert.equal(
    camera.userData.skyTrainBodyView,
    undefined,
    'no geometry-selected view survives in a cache',
  );
  assert(camera.fov >= 55 - 1e-8 && camera.fov <= 100);
  if (checkFraming)
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
}

for (const line of ['expo', 'canada']) {
  test(`${line}: all actual seats keep the requested rear chase through walls at every zoom and aspect without camera searches`, async () => {
    const train = await actualTrain(line);
    let occluded = 0;
    try {
      for (const seat of train.passengerSpace.seats)
        for (const distance of [2.05, 4, 8, 14])
          for (const aspect of [1.6, 0.72, 0.46]) {
            const h = controller(train, seat, { distance, aspect });
            assertStableChase(
              h,
              seat,
              `${line}:${seat.id}:${distance}:${aspect}`,
            );
            const camera = h.city.camera.position.clone(),
              pivot = h.city.controls.target;
            if (
              h.collision
                .resolve(pivot, camera, [train.group], 0.12)
                .distanceTo(camera) > 0.05
            )
              occluded++;
            h.view.updateCamera();
            assert(h.city.camera.position.distanceTo(camera) < 1e-8);
            assert.equal(h.calls(), 0);
          }
      assert(
        occluded > 0,
        'real cabin walls/chairs lie across chase rays and must be handled without moving their camera',
      );
    } finally {
      train.dispose();
    }
  });
  test(`${line}: articulated selected cars preserve requested yaw/pitch and seated free look, with true near-vertical first person`, async () => {
    const train = await actualTrain(line),
      seat = train.passengerSpace.seats[0],
      path = ridePath(routes.segments.find((row) => row.lineId === line));
    try {
      for (let car = 0; car < train.carFrames.length; car++) {
        train.selectPassengerCar(car);
        const h = controller(train, seat);
        h.view.lookYaw = 0.73;
        for (const progress of [0, 0.17, 0.47, 0.84, 1]) {
          train.setPathPose(path, progress);
          assertStableChase(h, seat, `${line}:car${car}:${progress}`);
        }
        for (const pitch of [
          -TRAVEL_PITCH_LIMIT,
          -0.3,
          0,
          0.4,
          TRAVEL_PITCH_LIMIT,
        ]) {
          h.view.pitch = pitch;
          assertStableChase(h, seat, `${line}:car${car}:pitch${pitch}`, false);
        }
        h.view.distanceView = 0.8;
        for (const pitch of [-TRAVEL_PITCH_LIMIT, TRAVEL_PITCH_LIMIT]) {
          h.view.pitch = pitch;
          h.view.updateCamera();
          h.city.camera.updateMatrixWorld(true);
          assert(
            h.city.camera
              .getWorldDirection(new THREE.Vector3())
              .dot(expectedDirection(h.view)) > 0.999999,
          );
          assert.equal(h.city.navigation.walker.group.visible, false);
          assert.equal(
            h.view.yaw,
            seat.yaw,
            'seated free look never twists the authored sitting pose',
          );
          assert.equal(h.view.lookYaw, 0.73);
        }
      }
    } finally {
      train.dispose();
    }
  });
}

test('every actual station bench retains a stable rear camera beneath its roof when resized from desktop to portrait', () => {
  for (const id of stationIds) {
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
        assertStableChase(h, seat, `${id}:${seat.id}`);
        const before = h.city.camera.position.clone();
        h.city.camera.aspect = 0.46;
        h.city.camera.updateProjectionMatrix();
        assertStableChase(h, seat, `${id}:${seat.id}:resized`);
        assert(
          h.city.camera.position.distanceTo(before) < 1e-8,
          'portrait framing can widen FOV but never orbit the subject',
        );
      }
    } finally {
      owner.dispose();
    }
  }
});

test('all seventeen physical station stair routes retain chase heading on ascent and descent through actual treads and roofs', () => {
  let checkedRoutes = 0,
    heightChanges = 0;
  for (const id of stationIds) {
    const owner = new SkyTrainStationOwner(
      station(id),
      cityElevation,
      'balanced',
      true,
    );
    try {
      for (const route of owner.streetRoutes()) {
        checkedRoutes++;
        for (const points of [route.points, [...route.points].reverse()]) {
          const h = controller(null, null);
          Object.assign(h.view, {
            occupied: null,
            phase: 'station',
            owner,
            cabinSeat: null,
            stationSeat: null,
            yaw: 0.7,
            lookYaw: -0.2,
          });
          let previousY;
          for (const point of points) {
            const foot = owner.floorAt(point);
            assert(foot && owner.isClearFoot(foot));
            h.view.foot = foot;
            if (
              previousY !== undefined &&
              Math.abs(previousY - foot.position[1]) > 0.05
            )
              heightChanges++;
            previousY = foot.position[1];
            assertStableChase(h, null, `${id}:${route.entranceId}:${point[1]}`);
          }
        }
      }
    } finally {
      owner.dispose();
    }
  }
  assert.equal(checkedRoutes, 17);
  assert(
    heightChanges > 20,
    'the actual route samples include rising and descending station geometry',
  );
});

class InputCanvas extends EventTarget {
  setAttribute() {}
  focus() {}
  setPointerCapture() {}
}
function dispatch(target, type, values) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, values);
  target.dispatchEvent(event);
}
test('actual desktop/touch drag followed by movement, station/cabin sitting or F standing retains the visible heading', async () => {
  const previous = new Map(
    ['window', 'document', 'Element'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ getContext: () => null }),
  });
  globalThis.Element = InputCanvas;
  try {
    for (const pointerType of ['mouse', 'touch']) {
      const owner = new SkyTrainStationOwner(
          station('main-street-science-world'),
          cityElevation,
          'balanced',
          true,
        ),
        canvas = new InputCanvas(),
        city = {
          scene: new THREE.Scene(),
          camera: new THREE.PerspectiveCamera(65, 1.6, 0.05, 10000),
          elevation: cityElevation,
          data: {},
          uniforms: {
            night: { value: 0 },
            skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
          },
          settings: {
            mode: 'walk',
            buildings: true,
            trains: false,
            quality: 'balanced',
          },
          controls: { target: new THREE.Vector3(), update() {} },
          renderer: { domElement: canvas },
          navigation: {
            mode: 'orbit',
            position: new THREE.Vector3(),
            walker: { group: new THREE.Group(), setSeated() {}, update() {} },
          },
        },
        view = new SkyTrainWorldTravel(city);
      try {
        const point = owner.streetRoutes()[0].points.at(-1),
          foot = owner.floorAt(point),
          desiredYaw = foot.yaw || 0;
        Object.assign(view, {
          phase: 'station',
          station: owner.data.id,
          owner,
          foot,
          yaw: desiredYaw - 1.1,
          distanceView: 4,
        });
        view.updateCamera();
        dispatch(canvas, 'pointerdown', {
          pointerId: 4,
          pointerType,
          button: 0,
          clientX: 0,
          clientY: 0,
        });
        dispatch(canvas, 'pointermove', {
          pointerId: 4,
          pointerType,
          clientX: -1.1 / 0.004,
          clientY: 0,
        });
        assert(Math.abs(view.lookYaw - 1.1) < 1e-8);
        const beforeDirection = city.camera.getWorldDirection(
            new THREE.Vector3(),
          ),
          before = new THREE.Vector3(...view.interactionOrigin);
        if (pointerType === 'mouse')
          dispatch(window, 'keydown', { code: 'KeyW', repeat: false });
        else view.setTouchAxes(0, 1);
        view.update(0.05);
        const afterDirection = city.camera.getWorldDirection(
            new THREE.Vector3(),
          ),
          displacement = new THREE.Vector3(...view.interactionOrigin).sub(
            before,
          ),
          flatDirection = beforeDirection.clone().setY(0).normalize();
        assert.equal(view.lookYaw, 0);
        assert(Math.abs(view.yaw - desiredYaw) < 1e-8);
        assert(
          afterDirection.dot(beforeDirection) > 0.999999,
          'starting movement retains exactly the view chosen by dragging',
        );
        assert(
          displacement.length() > 0.01,
          'the actual supported station walker moves',
        );
        assert(
          displacement.normalize().dot(flatDirection) > 0.99,
          'forward input follows the visible camera heading',
        );
        view.clearInput();
        const seat = owner.benchSeats()[0];
        Object.assign(view, {
          foot: seat.stand,
          stationSeat: null,
          yaw: seat.yaw + 0.4,
          lookYaw: 0,
        });
        view.updateCamera();
        dispatch(canvas, 'pointerdown', {
          pointerId: 8,
          pointerType,
          button: 0,
          clientX: 0,
          clientY: 0,
        });
        dispatch(canvas, 'pointermove', {
          pointerId: 8,
          pointerType,
          clientX: -1 / 0.004,
          clientY: 0,
        });
        const approachHeading = city.camera.getWorldDirection(
          new THREE.Vector3(),
        );
        assert(
          view.sitStation(owner, seat),
          'the actual supported bench approach still authorizes sitting',
        );
        assert.equal(
          view.yaw,
          seat.yaw,
          'the seated body uses the actual chair heading',
        );
        assert(Math.abs(view.lookYaw - 1.4) < 1e-8);
        assert(
          city.camera
            .getWorldDirection(new THREE.Vector3())
            .dot(approachHeading) > 0.999999,
          'sitting preserves the view chosen by real pointer movement while the body turns toward its chair',
        );
        const seatedLook = view.lookYaw;
        dispatch(canvas, 'pointerdown', {
          pointerId: 9,
          pointerType,
          button: 0,
          clientX: 0,
          clientY: 0,
        });
        dispatch(canvas, 'pointermove', {
          pointerId: 9,
          pointerType,
          clientX: -Math.PI / 0.004,
          clientY: 0,
        });
        assert(Math.abs(view.lookYaw - seatedLook - Math.PI) < 1e-8);
        const seatedHeading = city.camera.getWorldDirection(
          new THREE.Vector3(),
        );
        city.skyTrainTravel = view;
        const interactions = new CityInteractions(city);
        try {
          interactions.setInputEnabled(true);
          interactions.update(0, true);
          dispatch(window, 'keydown', {
            code: 'KeyF',
            key: 'f',
            repeat: false,
          });
          assert.equal(
            view.passengerSeated,
            false,
            'the actual F dispatcher safely stands from the real station bench',
          );
          assert.equal(view.lookYaw, 0);
          assert(Math.abs(view.yaw - seat.yaw - seatedLook - Math.PI) < 1e-8);
          assert(
            city.camera
              .getWorldDirection(new THREE.Vector3())
              .dot(seatedHeading) > 0.999999,
            'standing after a half-turn free look cannot flip the camera back toward the seat',
          );
          assert.deepEqual(view.foot.position, seat.stand.position);
        } finally {
          interactions.dispose();
        }
        const cabin = await actualTrain(
            pointerType === 'mouse' ? 'expo' : 'canada',
          ),
          cabinSeat = cabin.passengerSpace.seats[0];
        view.train = cabin;
        city.scene.add(cabin.group);
        cabin.selectPassengerCar(cabin.carFrames.length - 1);
        Object.assign(view, {
          phase: 'riding',
          occupied: {},
          stationSeat: null,
          cabinSeat: null,
          cabinFoot: [...cabinSeat.approaches[0]],
          yaw: cabinSeat.yaw + 0.2,
          lookYaw: 0,
        });
        view.updateCamera();
        dispatch(canvas, 'pointerdown', {
          pointerId: 11,
          pointerType,
          button: 0,
          clientX: 0,
          clientY: 0,
        });
        dispatch(canvas, 'pointermove', {
          pointerId: 11,
          pointerType,
          clientX: -0.7 / 0.004,
          clientY: 0,
        });
        const cabinApproach = city.camera.getWorldDirection(
          new THREE.Vector3(),
        );
        assert(
          view.sitCabin(cabinSeat),
          'the actual selected-car cushion remains safely approachable',
        );
        assert.equal(view.yaw, cabinSeat.yaw);
        assert(Math.abs(view.lookYaw - 0.9) < 1e-8);
        assert(
          city.camera
            .getWorldDirection(new THREE.Vector3())
            .dot(cabinApproach) > 0.999999,
          'the actual Expo/Canada cabin chair cannot force the camera to its own heading',
        );
      } finally {
        view.dispose();
        owner.dispose();
      }
    }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
