import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTeslaVortex,
  sampleTeslaVortex,
  canStartTeslaVortex,
  TESLA_VORTEX_LIMITS: limits,
} = await import(cityModule('tesla-vortex'));
const { teslaRotate, teslaDot } = await import(cityModule('tesla-math'));

const candidate = () => ({
  position: [0, 0.68, 0],
  velocity: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  heading: 0,
  mode: 'ground',
  detachRemainingS: 0,
  vortex: null,
  attachment: null,
  departureContact: null,
  groundDeparture: null,
});

test('the vault performs a continuous full barrel roll about its forward axis at every heading, with upright lift and landing windows', () => {
  for (const heading of [0, Math.PI / 2, Math.PI - 0.01, -2.1]) {
    const motion = createTeslaVortex(heading),
      forward = [Math.sin(heading), 0, Math.cos(heading)];
    let previousAngle = 0,
      winding = 0,
      previousQuaternion;
    for (let i = 0; i <= 168; i++) {
      const sample = sampleTeslaVortex(motion, i / 120),
        up = teslaRotate(sample.quaternion, [0, 1, 0]),
        right = [Math.cos(heading), 0, -Math.sin(heading)],
        bank = Math.atan2(-teslaDot(up, right), up[1]),
        delta = Math.atan2(
          Math.sin(bank - previousAngle),
          Math.cos(bank - previousAngle),
        );
      winding += delta;
      previousAngle = bank;
      assert(Math.abs(Math.hypot(...sample.quaternion) - 1) < 1e-12);
      assert(
        teslaDot(teslaRotate(sample.quaternion, [0, 0, 1]), forward) >
          1 - 1e-12,
      );
      assert(sample.velocity.every(Number.isFinite));
      assert(sample.thrust >= 0 && sample.thrust <= 1);
      if (sample.phase !== 'roll') assert(up[1] > 1 - 1e-12);
      if (previousQuaternion) {
        const dot = Math.abs(
          sample.quaternion.reduce(
            (sum, n, k) => sum + n * previousQuaternion[k],
            0,
          ),
        );
        assert(
          2 * Math.acos(Math.min(1, dot)) < 0.11,
          '120Hz samples do not conceal a complete endpoint-only rotation',
        );
      }
      previousQuaternion = sample.quaternion;
    }
    assert(Math.abs(winding - 2 * Math.PI) < 1e-10);
    assert.equal(
      motion.elapsedS,
      0,
      'sampling does not advance the live simulation',
    );
    assert.equal(sampleTeslaVortex(motion, limits.durationS).phase, 'done');
  }
});

test('a stationary-road vault trajectory clears the complete rotating body over five car-sized obstacles and finishes upright in descent', () => {
  const motion = createTeslaVortex(0),
    cars = [8, 13.5, 19, 24.5, 30].map((z) => ({
      z,
      halfLength: 2.1,
      height: 1.9,
    })),
    seen = new Set(),
    position = [0, 1.03, 0],
    corners = [];
  for (const x of [-1.14, 1.14])
    for (const y of [-0.62, 0.62])
      for (const z of [-2.34, 2.34]) corners.push([x, y, z]);
  let peak = position[1];
  const h = 1 / 1200;
  for (let i = 0; i < 1680; i++) {
    const sample = sampleTeslaVortex(motion, (i + 0.5) * h);
    for (let axis = 0; axis < 3; axis++)
      position[axis] += sample.velocity[axis] * h;
    peak = Math.max(peak, position[1]);
    const body = corners.map((p) =>
        teslaRotate(sample.quaternion, p).map((v, k) => v + position[k]),
      ),
      minZ = Math.min(...body.map((p) => p[2])),
      maxZ = Math.max(...body.map((p) => p[2])),
      minY = Math.min(...body.map((p) => p[1]));
    for (const [index, car] of cars.entries()) {
      if (maxZ < car.z - car.halfLength || minZ > car.z + car.halfLength)
        continue;
      seen.add(index);
      assert(
        minY > car.height + 0.06,
        `full rolling body stays above car ${index + 1}`,
      );
    }
  }
  assert.equal(seen.size, 5);
  assert(position[2] > 39 && position[2] < 40);
  assert(peak > 5.8 && peak < 6.1);
  assert(Math.abs(position[1] - 1.03) < 1e-9);
  const landing = sampleTeslaVortex(motion, limits.durationS);
  assert(landing.velocity[1] < 0);
  assert.deepEqual(teslaRotate(landing.quaternion, [0, 1, 0]), [0, 1, 0]);
});

test('maneuver eligibility has no resource budget, but refuses active transitions and invalid physical poses', () => {
  for (const mode of ['ground', 'wall', 'air']) {
    const s = candidate();
    s.mode = mode;
    s.parked = true;
    assert.equal(canStartTeslaVortex(s), true);
  }
  for (const patch of [
    { vortex: createTeslaVortex(0) },
    { attachment: {} },
    { groundDeparture: {} },
    { departureContact: {} },
    { detachRemainingS: 0.1 },
    { heading: NaN },
    { velocity: [0, Infinity, 0] },
    { quaternion: [0, 0, 0, 0] },
    { position: [NaN, 0, 0] },
  ])
    assert.equal(canStartTeslaVortex({ ...candidate(), ...patch }), false);
  assert.equal(canStartTeslaVortex(null), false);
});

test('stunt requests bound momentum and reject nonfinite animation data without changing their caller', () => {
  assert.equal(
    createTeslaVortex(0, 0).forwardSpeedMps,
    limits.minForwardSpeedMps,
  );
  assert.equal(
    createTeslaVortex(0, -160).forwardSpeedMps,
    limits.maxForwardSpeedMps,
  );
  assert.equal(createTeslaVortex(0, 40, true).restoreFlightAssist, true);
  assert.throws(() => createTeslaVortex(NaN), RangeError);
  assert.throws(() => createTeslaVortex(0, Infinity), RangeError);
  const motion = Object.freeze(createTeslaVortex(0, 40));
  for (const time of [NaN, Infinity, -0.01])
    assert.throws(() => sampleTeslaVortex(motion, time), RangeError);
  assert.throws(
    () => sampleTeslaVortex({ ...motion, forwardSpeedMps: 1000 }),
    RangeError,
  );
  assert.equal(sampleTeslaVortex(motion, 10).phase, 'done');
  assert.equal(sampleTeslaVortex(motion, 10).thrust, 0);
});

test('captured finite floor grade adds tangent momentum while preserving the relative-floor vault arc and roll timing', () => {
  for (const grade of [-0.2, 0, 0.2]) {
    const motion = createTeslaVortex(0.7, 40, false, grade);
    let relativeHeight = 0;
    const h = 1 / 120;
    for (let i = 0; i < 168; i++) {
      const time = (i + 0.5) * h;
      const sample = sampleTeslaVortex(motion, time);
      const forwardSpeed = Math.hypot(sample.velocity[0], sample.velocity[2]);
      assert(
        Math.abs(sample.velocity[1] - grade * forwardSpeed - (14 - 20 * time)) <
          1e-12,
      );
      relativeHeight += (sample.velocity[1] - grade * forwardSpeed) * h;
      assert.deepEqual(
        sample.quaternion,
        sampleTeslaVortex(createTeslaVortex(0.7, 40), time).quaternion,
      );
    }
    assert(Math.abs(relativeHeight) < 1e-12);
    assert.equal(sampleTeslaVortex(motion, 1.4).phase, 'done');
  }
  assert.equal(createTeslaVortex(0).gradeMPerM, 0);
  for (const grade of [NaN, Infinity, -Infinity])
    assert.throws(() => createTeslaVortex(0, 30, false, grade), RangeError);
  for (const grade of [-100, 100])
    assert.equal(
      createTeslaVortex(0, 30, false, grade).gradeMPerM,
      Math.sign(grade) * limits.maxGradeMPerM,
    );
  for (const grade of [NaN, Infinity, 0.431, -0.431])
    assert.throws(
      () => sampleTeslaVortex({ ...createTeslaVortex(0), gradeMPerM: grade }),
      RangeError,
    );
});
