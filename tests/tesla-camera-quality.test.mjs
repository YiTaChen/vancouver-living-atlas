import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { teslaCameraFrame } = await import(cityModule('tesla-camera'));
const { preferredTeslaQuality, TeslaQualityPolicy } = await import(
  cityModule('tesla-quality')
);
const {
  createTeslaRoadster,
  TESLA_ROADSTER_ANCHORS,
  TESLA_ROADSTER_DIMENSIONS,
} = await import(cityModule('assets/tesla-roadster'));
const options = {
  heading: 0.8,
  distance: 7.5,
  lookYaw: 0,
  lookPitch: 0,
  clearance: 0.06,
};
const poseFor = (q) => ({ position: [10, 20, 30], quaternion: q.toArray() });
const nearVector = (actual, expected) =>
  assert.ok(
    actual.distanceTo(expected) < 1e-8,
    `${actual.toArray()} != ${expected.toArray()}`,
  );

test('chase camera keeps its gravity-level horizon regardless of wall, roll or inverted vehicle attitude', () => {
  for (const q of [
    new THREE.Quaternion(),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(1.1, 0.7, -0.6)),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI,
    ),
  ]) {
    const pose = poseFor(q),
      before = structuredClone(pose);
    const frame = teslaCameraFrame(pose, 'chase', options);
    nearVector(frame.up, new THREE.Vector3(0, 1, 0));
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
      frame.quaternion,
    );
    assert.ok(
      Math.abs(screenRight.y) < 1e-10,
      'horizon has no vehicle-induced roll',
    );
    assert.deepEqual(pose, before);
    assert.ok(frame.near > 0 && frame.fov < 90);
  }
});

test('wall chase stays on the outward side of all facade orientations and retains a level horizon', () => {
  for (const normal of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const pose = poseFor(new THREE.Quaternion());
    const frame = teslaCameraFrame(pose, 'chase', {
      ...options,
      wallNormal: normal,
    });
    const towardCamera = frame.position.clone().sub(frame.target);
    assert.ok(towardCamera.dot(new THREE.Vector3(...normal)) > 1);
    nearVector(frame.up, new THREE.Vector3(0, 1, 0));
  }
});

test('cockpit eye and its full orientation follow the actual vehicle frame without moving outside the authored cabin', () => {
  const model = createTeslaRoadster({ quality: 'high' });
  try {
    model.group.updateMatrixWorld(true);
    const level = model.group.children.find(
      (child) => child.isGroup && child.visible,
    );
    const body = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.6, -0.4, 1.2),
    );
    const pose = poseFor(body),
      frame = teslaCameraFrame(pose, 'cockpit', options);
    const center = new THREE.Vector3(...pose.position);
    const localEye = frame.position
      .clone()
      .sub(center)
      .applyQuaternion(body.clone().invert());
    localEye.y += TESLA_ROADSTER_DIMENSIONS.contactToCenter + options.clearance;
    nearVector(
      localEye,
      new THREE.Vector3(...TESLA_ROADSTER_ANCHORS.driverEye),
    );
    nearVector(frame.up, new THREE.Vector3(0, 1, 0).applyQuaternion(body));
    nearVector(
      frame.target.clone().sub(frame.position).normalize(),
      new THREE.Vector3(0, 0, 1).applyQuaternion(body),
    );
    // The donor has an outward-facing removable glass canopy. Inspect its
    // actual inside surface without changing the production culling policy.
    const glass = level.getObjectByName('removable-roof:glass').material;
    glass.side = THREE.DoubleSide;
    const roofRay = new THREE.Raycaster(localEye, new THREE.Vector3(0, 1, 0));
    const roof = roofRay.intersectObject(level, true)[0];
    glass.side = THREE.FrontSide;
    assert.ok(
      roof && roof.distance > frame.near && roof.distance < 0.25,
      'the eye and near plane lie beneath the actual closed glass canopy',
    );
    const viewRay = new THREE.Raycaster(localEye, new THREE.Vector3(0, 0, 1));
    const blockers = viewRay
      .intersectObject(level, true)
      .filter((hit) => !hit.object.material.transparent && hit.distance < 0.6);
    assert.equal(
      blockers.length,
      0,
      'authored dashboard and yoke leave the neutral driving view clear',
    );
    assert.equal(frame.fov, 70);
  } finally {
    model.dispose();
  }
});

test('cockpit head look rotates in car-local space while preserving the exact driver eye', () => {
  const body = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2,
  );
  const pose = poseFor(body),
    neutral = teslaCameraFrame(pose, 'cockpit', options);
  const frame = teslaCameraFrame(pose, 'cockpit', {
    ...options,
    lookYaw: 0.5,
    lookPitch: -0.2,
  });
  nearVector(frame.position, neutral.position);
  const expected = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.5, 0, 'YXZ')),
    )
    .applyQuaternion(body);
  nearVector(frame.target.clone().sub(frame.position).normalize(), expected);
});

const context = {
  preference: 'auto',
  city: 'high',
  compatible: false,
  cockpit: false,
  speedMps: 0,
};
test('separate model Auto considers compatible rendering, speed and cockpit detail while manual tiers stay exact', () => {
  assert.equal(preferredTeslaQuality(context), 'medium');
  assert.equal(preferredTeslaQuality({ ...context, city: 'ultra' }), 'high');
  assert.equal(preferredTeslaQuality({ ...context, speedMps: 60 }), 'low');
  assert.equal(
    preferredTeslaQuality({ ...context, cockpit: true, speedMps: 60 }),
    'high',
  );
  assert.equal(
    preferredTeslaQuality({ ...context, compatible: true, cockpit: true }),
    'low',
  );
  for (const preference of ['low', 'medium', 'high'])
    assert.equal(
      preferredTeslaQuality({
        ...context,
        preference,
        compatible: true,
        speedMps: 140,
      }),
      preference,
    );
});

test('Auto quality waits for a sustained context and threshold jitter does not churn model tiers', () => {
  const policy = new TeslaQualityPolicy();
  assert.equal(policy.update(0, context), 'medium');
  assert.equal(policy.update(100, { ...context, speedMps: 50 }), 'medium');
  assert.equal(policy.update(2_299, { ...context, speedMps: 50 }), 'medium');
  assert.equal(policy.update(2_300, { ...context, speedMps: 50 }), 'low');
  for (let now = 2_400; now < 5_000; now += 100)
    assert.equal(
      policy.update(now, { ...context, speedMps: now % 200 ? 41.9 : 42.1 }),
      'low',
    );
  assert.equal(policy.update(5_000, context), 'low');
  assert.equal(policy.update(7_200, context), 'medium');
  assert.equal(
    policy.update(7_201, {
      ...context,
      preference: 'high',
      compatible: true,
      speedMps: 150,
    }),
    'high',
  );
});

test('manual-to-Auto return settles before changing the forced mesh tier', () => {
  const policy = new TeslaQualityPolicy();
  assert.equal(policy.update(0, { ...context, preference: 'high' }), 'high');
  assert.equal(policy.update(10, { ...context, compatible: true }), 'high');
  assert.equal(policy.update(2_209, { ...context, compatible: true }), 'high');
  assert.equal(policy.update(2_210, { ...context, compatible: true }), 'low');
});
