import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const {
  TrafficStopState,
  ROADSTER_ACCELERATION,
  ROADSTER_TOP_SPEED,
  inSpeedEnforcementArea,
} = await import(cityModule('traffic-stop-state'));
const { project } = await import(cityModule('geo'));
const tick = (s, seconds, speed = 30, eligible = true) => {
  for (let i = 0; i < Math.round(seconds * 100); i++)
    s.update(0.01, speed, eligible);
};
test('only continuous >100 km/h for five real seconds in city triggers', () => {
  const s = new TrafficStopState();
  assert.equal(s.nextTriggerSpeedKmh, 100);
  tick(s, 4.99);
  assert.equal(s.phase, 'idle');
  s.update(0.01, 100 / 3.6, true);
  assert.equal(s.speeding, 0);
  tick(s, 4);
  s.update(0.01, 40, false);
  assert.equal(s.speeding, 0);
  tick(s, 5);
  assert.equal(s.phase, 'braking');
  assert.equal(s.nextTriggerSpeedKmh, 200);
});
test('stop completes its sequence and only rearms above the doubled speed threshold', () => {
  const s = new TrafficStopState();
  tick(s, 5);
  tick(s, 10, 20);
  assert.equal(s.phase, 'braking');
  s.update(0.01, 0, true);
  assert.equal(s.phase, 'exit');
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    seen.add(s.phase);
    s.update(0.01, 0, true);
  }
  assert.deepEqual(
    [...seen],
    ['exit', 'approach', 'talk', 'return', 'enter', 'depart', 'idle'],
  );
  assert.equal(s.speeding, 0);
  tick(s, 5);
  assert.equal(s.phase, 'idle');
  tick(s, 5, 200 / 3.6);
  assert.equal(s.phase, 'idle');
  tick(s, 4.99, 201 / 3.6);
  assert.equal(s.phase, 'idle');
  s.update(0.01, 201 / 3.6, true);
  assert.equal(s.phase, 'braking');
  assert.equal(s.nextTriggerSpeedKmh, 400);
});
test('cancellation releases every stage and preserves the consumed speed tier', () => {
  for (const phase of [
    'braking',
    'exit',
    'approach',
    'talk',
    'return',
    'enter',
    'depart',
  ]) {
    const s = new TrafficStopState();
    tick(s, 5);
    assert.equal(s.nextTriggerSpeedKmh, 200);
    s.phase = phase;
    s.speeding = 5;
    s.cancel();
    assert.equal(s.active, false);
    assert.equal(s.speeding, 0);
    assert.equal(s.nextTriggerSpeedKmh, 200);
    tick(s, 10);
    assert.equal(s.active, false);
    tick(s, 5, 201 / 3.6);
    assert.equal(s.phase, 'braking');
    assert.equal(s.nextTriggerSpeedKmh, 400);
  }
});
test('each speed tier triggers once, including after cancellation and at future higher speeds', () => {
  const s = new TrafficStopState();
  for (const threshold of [100, 200, 400]) {
    assert.equal(s.nextTriggerSpeedKmh, threshold);
    tick(s, 5, (threshold + 1) / 3.6);
    assert.equal(s.phase, 'braking');
    assert.equal(s.nextTriggerSpeedKmh, threshold * 2);
    tick(s, 10, (threshold * 3) / 3.6);
    assert.equal(s.phase, 'braking');
    assert.equal(s.nextTriggerSpeedKmh, threshold * 2);
    s.cancel();
    tick(s, 10, threshold / 3.6);
    assert.equal(s.phase, 'idle');
    assert.equal(s.nextTriggerSpeedKmh, threshold * 2);
  }
  assert.equal(new TrafficStopState().nextTriggerSpeedKmh, 100);
});
test('partial speeding and ineligible travel never consume a tier or survive interruption', () => {
  const s = new TrafficStopState();
  tick(s, 4.99);
  s.cancel();
  assert.equal(s.nextTriggerSpeedKmh, 100);
  tick(s, 4.99);
  assert.equal(s.phase, 'idle');
  s.update(0.01, 300 / 3.6, false);
  assert.equal(s.speeding, 0);
  tick(s, 10, 300 / 3.6, false);
  assert.equal(s.nextTriggerSpeedKmh, 100);
  tick(s, 5);
  s.cancel();
  tick(s, 4, 201 / 3.6);
  s.update(0.01, 200 / 3.6, true);
  assert.equal(s.speeding, 0);
  tick(s, 4.99, 201 / 3.6);
  assert.equal(s.phase, 'idle');
  assert.equal(s.nextTriggerSpeedKmh, 200);
});
test('the current roadster cannot trigger the 400 km/h tier after two stops', () => {
  const s = new TrafficStopState();
  for (let i = 0; i < 2; i++) {
    tick(s, 5, ROADSTER_TOP_SPEED);
    assert.equal(s.phase, 'braking');
    s.cancel();
  }
  assert.equal(s.nextTriggerSpeedKmh, 400);
  tick(s, 60, ROADSTER_TOP_SPEED);
  assert.equal(s.phase, 'idle');
  assert.equal(s.speeding, 0);
});
test('roadster exceeds 200 km/h with stronger acceleration; park excluded from city', () => {
  assert.ok(ROADSTER_TOP_SPEED * 3.6 > 200);
  assert.ok(ROADSTER_ACCELERATION > 8);
  assert.equal(inSpeedEnforcementArea(...project([-123.1258, 49.2831])), true);
  assert.equal(inSpeedEnforcementArea(...project([-123.148, 49.307])), false);
  assert.equal(inSpeedEnforcementArea(...project([-123.14, 49.32])), false);
});

test('patrol/officer remain grounded, reach driver side, return and release input', async () => {
  const THREE = await import('three');
  const { TrafficStop } = await import(cityModule('traffic-stop'));
  const [x, z] = project([-123.1258, 49.2831]);
  const n = {
    e: { scene: new THREE.Scene() },
    position: new THREE.Vector3(x, 1.25, z),
    yaw: 0,
    speed: 32,
    mode: 'drive',
    surface: 'ground',
    keys: new Set(['w']),
    setTouchAxes() {},
    clearGround: () => true,
    groundHeight: () => 0,
  };
  const stop = new TrafficStop(n);
  for (let i = 0; i < 500; i++) stop.update(0.01);
  assert.equal(stop.state.phase, 'braking');
  n.speed = 0;
  let talked = false,
    returned = false;
  for (let i = 0; i < 2500; i++) {
    stop.update(0.01);
    if (stop.state.phase === 'talk') {
      talked = true;
      assert.equal(stop.caption, 'please safe driving');
      assert.ok(Math.abs(stop.officer.group.position.x - x - 1.7) < 1e-6);
      assert.ok(Math.abs(stop.officer.group.position.z - z) < 1e-6);
      assert.equal(stop.officer.group.position.y, 0.02);
      assert.equal(stop.car.position.y, 0.04);
    }
    if (stop.state.phase === 'return') returned = true;
  }
  assert.ok(talked && returned);
  assert.equal(stop.active, false);
  assert.equal(stop.group.visible, false);
  assert.equal(n.keys.size, 0);
  n.speed = 32;
  for (let i = 0; i < 600; i++) stop.update(0.01);
  assert.equal(stop.active, false);
  n.speed = 60;
  for (const [mode, surface] of [
    ['walk', 'ground'],
    ['boat', 'ground'],
    ['drive', 'bridge'],
  ]) {
    n.mode = mode;
    n.surface = surface;
    for (let i = 0; i < 600; i++) stop.update(0.01);
    assert.equal(stop.active, false);
    assert.equal(stop.state.nextTriggerSpeedKmh, 200);
  }
  n.mode = 'drive';
  n.surface = 'ground';
  for (let i = 0; i < 500; i++) stop.update(0.01);
  assert.equal(stop.state.phase, 'braking');
  assert.equal(stop.state.nextTriggerSpeedKmh, 400);
  stop.destroy();
  assert.equal(n.e.scene.children.length, 0);
});
