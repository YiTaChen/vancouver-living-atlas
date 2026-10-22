import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createRocket,
  stepRocket,
  launchRocket,
  crashRocket,
  sampleRocketEffects,
  rocketDirection,
  ROCKET_CONFIGS,
  SPACE_ALTITUDE,
} = await import(cityModule('rocket-state'));
const dt = 1 / 60;
function run(state, seconds, input = {}) {
  let s = state;
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++)
    s = stepRocket(s, input, dt);
  return s;
}
function prepared(kind = 'small', support = { kind: 'ground' }, y = 0) {
  const building = createRocket(kind, 12, y, 34, support);
  return run(building, ROCKET_CONFIGS[kind].buildDuration + 0.1);
}
function untilDone(state, input = {}, limit = 200) {
  let s = state;
  for (
    let frame = 0;
    frame < limit * 60 && !['space', 'crashed', 'sinking'].includes(s.phase);
    frame++
  ) {
    s = stepRocket(s, input, dt);
  }
  return s;
}
test('construction, countdown and ignition are timed; a launch cannot skip construction', () => {
  let s = createRocket('large', 0, 0, 0);
  assert.equal(launchRocket(s).phase, 'building');
  s = run(s, 5);
  assert(s.buildProgress > 0.49 && s.buildProgress < 0.51);
  s = run(s, 5.1);
  assert.equal(s.phase, 'ready');
  s = launchRocket(s);
  assert.equal(s.phase, 'countdown');
  s = run(s, 4);
  assert.equal(s.phase, 'countdown');
  assert(s.countdown > 0.9 && s.countdown < 1.1);
  s = run(s, 2);
  assert.equal(s.phase, 'ignition');
  assert(s.throttle > 0.35 && s.throttle < 0.5);
  assert.equal(s.position.y, 0);
  assert(sampleRocketEffects(s).groundExposure > 0.35);
  assert.equal(s.events.filter((event) => event.type === 'ignition').length, 1);
});
test('both vehicle sizes reach 100km by continuous physical ascent in about two minutes', () => {
  for (const kind of ['small', 'large']) {
    for (const seed of [0, 123, 2814]) {
      let s = launchRocket(prepared(kind, { kind: 'platform', seed }));
      let previous = s;
      while (!['space', 'crashed'].includes(s.phase) && s.elapsed < 200) {
        previous = s;
        s = stepRocket(s, {}, dt);
        assert(
          Math.abs(s.position.y - previous.position.y) < 60,
          'no teleport or altitude jump',
        );
      }
      assert.equal(
        s.phase,
        'space',
        `${kind}, seed ${seed}: ${s.failureReason}`,
      );
      assert(s.altitude >= SPACE_ALTITUDE && s.altitude < SPACE_ALTITUDE + 60);
      assert(s.flightElapsed > 120 && s.flightElapsed < 180);
      assert(s.fuel > 0 && s.fuel < ROCKET_CONFIGS[kind].fuelMass);
      assert(
        Math.hypot(s.position.x - s.origin.x, s.position.z - s.origin.z) >
          1_000,
      );
      assert(s.events.some((event) => event.type === 'mission-complete'));
      assert.equal(s.throttle, 0);
      assert.equal(s.integrity, 1);
    }
  }
});
test('sea and river placement sinks immediately; even auto cannot launch it', () => {
  for (const kind of ['ocean', 'river']) {
    const s = createRocket('large', 0, 2, 0, { kind });
    assert.equal(s.phase, 'sinking');
    const next = run(launchRocket(s), 5, { launch: true, auto: true });
    assert.equal(next.phase, 'sinking');
    assert(next.position.y < s.position.y - 8);
    assert.equal(next.fuel, s.fuel);
    assert.equal(sampleRocketEffects(next).engine, 0);
  }
});
test('a small roof supports Scout; Atlas exhaust collapses the same roof and auto does not rescue it', () => {
  const support = { kind: 'roof-small', groundY: 0, seed: 13 };
  const small = untilDone(launchRocket(prepared('small', support, 8)));
  assert.equal(small.phase, 'space');
  assert(!small.supportCollapsed);
  const large = untilDone(launchRocket(prepared('large', support, 8)));
  assert.equal(large.phase, 'crashed');
  assert(large.supportCollapsed);
  assert(large.events.some((event) => event.type === 'support-collapsed'));
  assert(large.events.some((event) => event.type === 'impact'));
  assert(large.maxAltitude < 100);
  const reinforced = untilDone(
    launchRocket(prepared('large', { ...support, strength: 1 }, 8)),
  );
  assert.equal(reinforced.phase, 'space');
});
test('a lake bed weakens during construction and collapses under Atlas exhaust', () => {
  const s = prepared('large', { kind: 'lake', seed: 7 });
  assert(s.supportIntegrity < 0.9);
  const launch = untilDone(launchRocket(s));
  assert(launch.supportCollapsed);
  assert.equal(launch.phase, 'crashed');
  assert(launch.failureReason);
});
test('small rockets turn more readily; sustained manual steering can invert and crash', () => {
  const small = run(launchRocket(prepared('small'), 'manual'), 9, {
    roll: 0.5,
    windScale: 0,
  });
  const large = run(launchRocket(prepared('large'), 'manual'), 9, {
    roll: 0.5,
    windScale: 0,
  });
  assert(Math.abs(small.attitude.roll) > Math.abs(large.attitude.roll) * 2);
  const crash = untilDone(launchRocket(prepared('small'), 'manual'), {
    pitch: 1,
  });
  assert.equal(crash.phase, 'crashed');
  assert(crash.events.some((event) => event.type === 'impact'));
});
test('manual steering mistakes are recoverable by switching to the physical autopilot', () => {
  let s = run(launchRocket(prepared('small'), 'manual'), 10, {
    stabilize: true,
  });
  s = run(s, 0.5, { pitch: 0.65, stabilize: true });
  assert(s.attitude.pitch > 0.03);
  const next = stepRocket(s, { auto: true }, dt);
  assert(
    Math.abs(next.attitude.pitch - s.attitude.pitch) < 0.02,
    'switch does not snap attitude',
  );
  const result = untilDone(next);
  assert.equal(result.phase, 'space');
});
test('aborting cuts thrust and leaves a ballistic fall to an impact', () => {
  let s = run(launchRocket(prepared('large')), 20);
  assert(s.altitude > 100);
  const fuel = s.fuel;
  s = stepRocket(s, { abort: true }, dt);
  assert.equal(s.phase, 'aborted');
  assert.equal(s.throttle, 0);
  s = untilDone(s, {}, 100);
  assert.equal(s.phase, 'crashed');
  assert.equal(s.fuel, fuel);
});
test('wind, replay and snapshots are deterministic without mutating their inputs', () => {
  const s = launchRocket(
    prepared('small', { kind: 'ground', seed: 91 }),
    'manual',
  );
  const snapshot = structuredClone(s);
  assert.deepEqual(run(s, 15), run(s, 15));
  assert.deepEqual(s, snapshot);
  const windy = run(s, 15, { windScale: 1 });
  const calm = run(s, 15, { windScale: 0 });
  assert(Math.abs(windy.attitude.roll) > Math.abs(calm.attitude.roll));
  assert(Math.abs(windy.position.x - calm.position.x) > 5);
});
test('exhaust exposure falls with altitude and ends after a crash or completion', () => {
  let s = run(launchRocket(prepared('large')), 8);
  const ground = sampleRocketEffects(s);
  assert(ground.groundExposure > 0.8);
  s = run(s, 12);
  assert(sampleRocketEffects(s).groundExposure < ground.groundExposure * 0.05);
  assert.equal(sampleRocketEffects(untilDone(s)).engine, 0);
  const direction = rocketDirection({ pitch: 0.4, roll: -0.3 });
  assert(
    Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12,
  );
});
test('an external city collision preserves impact position and records the physical speed', () => {
  const s = run(launchRocket(prepared('small')), 15);
  const next = crashRocket(s, 'Struck a bridge.');
  assert.equal(next.phase, 'crashed');
  assert.deepEqual(next.position, s.position);
  assert.equal(next.throttle, 0);
  assert.equal(next.integrity, 0);
  assert.equal(next.failureReason, 'Struck a bridge.');
  assert(
    Math.abs(
      next.events.at(-1).magnitude - Math.hypot(...Object.values(s.velocity)),
    ) < 1e-9,
  );
  assert.equal(crashRocket(next).events.length, next.events.length);
  assert.equal(s.phase, 'flight');
});
