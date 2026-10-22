import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createVehicleDrift,
  resetVehicleDrift,
  stepVehicleDrift,
  vehicleDriftIntensity,
  VEHICLE_DRIFT_LIMITS,
} = await import(cityModule('vehicle-drift'));

const step = (state, changes = {}) =>
  stepVehicleDrift(state, {
    dt: 1 / 60,
    speed: 24,
    steer: 0.8,
    held: true,
    grounded: true,
    normalYawDelta: 0.02,
    ...changes,
  });
const settled = (changes = {}) => {
  const state = createVehicleDrift();
  for (let i = 0; i < 120; i++) step(state, changes);
  return state;
};
const near = (a, b, tolerance = 1e-9) =>
  assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('unheld ordinary driving preserves exact scalar speed and legacy yaw at every input direction', () => {
  for (const speed of [-5, 0, 5, 21, 60, 120])
    for (const steer of [-1, 0, 1]) {
      const state = createVehicleDrift();
      const normalYawDelta = steer * 0.013;
      const result = step(state, { held: false, speed, steer, normalYawDelta });
      assert.deepEqual(result, {
        yawScale: 1,
        yawDelta: normalYawDelta,
        travelYawOffset: 0,
        speed,
        intensity: 0,
        active: false,
      });
      assert.deepEqual(state, createVehicleDrift());
    }
});

test('a held drift button alone cannot initiate a slide, smoke or propulsion', () => {
  for (const speed of [0, 5, 24, 120]) {
    const state = createVehicleDrift();
    for (let i = 0; i < 300; i++) {
      const result = step(state, { speed, steer: 0 });
      assert.equal(result.speed, speed);
      assert.equal(result.yawScale, 1);
      assert.equal(result.travelYawOffset, 0);
      assert.equal(result.intensity, 0);
      assert.equal(result.active, false);
    }
  }
});

test('drift initiates only above the entry threshold, with lower-speed hysteresis', () => {
  const state = createVehicleDrift();
  for (let i = 0; i < 90; i++) step(state, { speed: 5 });
  assert.deepEqual(state, createVehicleDrift());
  for (let i = 0; i < 90; i++) step(state, { speed: 7 });
  assert(state.active);
  assert(state.slipAngle < -0.1);
  const rolling = step(state, { speed: 5 });
  assert(state.active);
  assert(rolling.intensity > 0);
  const slow = step(state, { speed: 3 });
  assert.equal(slow.intensity, 0);
  assert.deepEqual(state, createVehicleDrift());
});

test('left/right drift is symmetric, separates travel from body yaw and never exceeds32degrees', () => {
  const left = createVehicleDrift(),
    right = createVehicleDrift();
  for (let i = 0; i < 600; i++) {
    const a = step(left, { speed: 60, steer: 1, normalYawDelta: 0.02 });
    const b = step(right, { speed: 60, steer: -1, normalYawDelta: -0.02 });
    assert(a.travelYawOffset < 0);
    assert(b.travelYawOffset > 0);
    near(a.travelYawOffset, -b.travelYawOffset);
    near(a.yawDelta, -b.yawDelta);
    near(a.speed, b.speed);
    assert(
      Math.abs(a.travelYawOffset) <= VEHICLE_DRIFT_LIMITS.maximumSlipRadians,
    );
    assert(a.yawScale >= 1 && a.yawScale <= 1.28 + 1e-12);
    assert(a.speed > 0 && a.speed <= 60);
  }
  assert(step(left, { speed: 60, steer: 1 }).active);
});

test('classic and roadster/Tesla tuning are bounded while sharing the same control semantics', () => {
  const classic = settled({ profile: 'classic', steer: 1, speed: 60 });
  const roadster = settled({ profile: 'roadster', steer: 1, speed: 60 });
  const tesla = settled({ profile: 'tesla', steer: 1, speed: 60 });
  near(Math.abs(classic.slipAngle), (24 * Math.PI) / 180, 0.0001);
  near(Math.abs(roadster.slipAngle), (32 * Math.PI) / 180, 0.0001);
  near(tesla.slipAngle, roadster.slipAngle);
  assert(classic.active && roadster.active && tesla.active);
});

test('countersteer catches the existing slide before permitting the opposite slide', () => {
  const catching = settled({ steer: 1 });
  const continuing = { ...catching };
  const before = Math.abs(catching.slipAngle);
  for (let i = 0; i < 6; i++) {
    step(catching, { steer: -1 });
    step(continuing, { steer: 1 });
  }
  assert(catching.slipAngle < 0, 'lateral travel cannot instantly reverse');
  assert(Math.abs(catching.slipAngle) < before * 0.4);
  assert(Math.abs(catching.slipAngle) < Math.abs(continuing.slipAngle));
});

test('release restores grip smoothly, with no residual drift mode or extra drag once settled', () => {
  const state = settled({ steer: 1 });
  const previous = state.slipAngle;
  const first = step(state, { held: false, steer: 0 });
  assert(first.travelYawOffset < 0);
  assert(Math.abs(first.travelYawOffset) < Math.abs(previous));
  for (let i = 0; i < 180; i++) step(state, { held: false, steer: 0 });
  assert.deepEqual(state, createVehicleDrift());
  const final = step(state, { held: false, speed: 31, normalYawDelta: 0.04 });
  assert.equal(final.speed, 31);
  assert.equal(final.yawDelta, 0.04);
  assert.equal(final.yawScale, 1);
});

test('normal brakes, reverse and losing road contact cancel slip without replacing caller braking or flight physics', () => {
  for (const changes of [
    { brake: true },
    { grounded: false },
    { speed: -12 },
    { speed: 0 },
  ]) {
    const state = settled();
    const result = step(state, changes);
    assert.deepEqual(state, createVehicleDrift());
    assert.equal(result.speed, changes.speed ?? 24);
    assert.equal(result.yawDelta, 0.02);
    assert.equal(result.intensity, 0);
  }
});

test('constant input response is independent of30/60/120Hz and varying frame spacing', () => {
  const simulate = (dts, feedback) => {
    const state = createVehicleDrift();
    let time = 0,
      speed = 30,
      yaw = 0,
      i = 0;
    while (time < 3 - 1e-10) {
      const dt = Math.min(dts[i++ % dts.length], 3 - time);
      const result = step(state, {
        dt,
        speed,
        steer: 0.75,
        normalYawDelta: dt * 0.75,
      });
      if (feedback) speed = result.speed;
      yaw += result.yawDelta;
      time += dt;
    }
    return { ...state, speed, yaw };
  };
  const fixed = simulate([1 / 120], false);
  for (const dts of [[1 / 30], [1 / 60], [1 / 120, 1 / 30, 1 / 60]]) {
    const result = simulate(dts, false);
    near(result.slipAngle, fixed.slipAngle, 1e-10);
    near(result.engagement, fixed.engagement, 1e-10);
    near(result.yaw, fixed.yaw, 1e-10);
    const actual = simulate(dts, true);
    const reference = simulate([1 / 120], true);
    near(actual.speed, reference.speed, 0.006);
    near(actual.slipAngle, reference.slipAngle, 0.003);
    near(actual.yaw, reference.yaw, 0.003);
  }
});

test('a sustained drifting coast only loses energy and decays safely into low-speed grip', () => {
  const state = createVehicleDrift();
  let speed = 40,
    last = speed;
  for (let i = 0; i < 9000; i++) {
    const result = step(state, { speed, steer: 1 });
    assert(result.speed <= last);
    assert(result.speed >= 0);
    assert(Number.isFinite(result.travelYawOffset));
    speed = result.speed;
    last = speed;
  }
  assert(speed <= VEHICLE_DRIFT_LIMITS.exitSpeedMps);
  assert.deepEqual(state, createVehicleDrift());
});

test('FX selector is read-only, agrees with actual drift output, and suppresses stopped/invalid speeds', () => {
  const state = settled();
  const result = step(state);
  const copy = { ...state };
  near(vehicleDriftIntensity(state, result.speed), result.intensity);
  for (const speed of [0, -10, NaN, Infinity])
    assert.equal(vehicleDriftIntensity(state, speed), 0);
  assert.deepEqual(state, copy);
  resetVehicleDrift(state);
  assert.deepEqual(state, createVehicleDrift());
});

test('malformed inputs fail closed and oversized frames cannot create unbounded slip', () => {
  for (const changes of [
    { dt: NaN },
    { dt: -1 },
    { dt: Infinity },
    { speed: NaN },
  ]) {
    const state = settled();
    const result = step(state, changes);
    assert.deepEqual(state, createVehicleDrift());
    assert(Number.isFinite(result.speed));
    assert.equal(result.intensity, 0);
  }
  const state = settled();
  state.engagement = NaN;
  step(state);
  assert.deepEqual(state, createVehicleDrift());
  const afterPause = step(state, { dt: 50, steer: 999 });
  assert(
    Math.abs(afterPause.travelYawOffset) <=
      VEHICLE_DRIFT_LIMITS.maximumSlipRadians,
  );
  assert(afterPause.speed <= 24);
});
