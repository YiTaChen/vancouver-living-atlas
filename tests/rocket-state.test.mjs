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
  rocketMass,
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
  s = run(s, ROCKET_CONFIGS.large.buildDuration / 2);
  assert(s.buildProgress > 0.49 && s.buildProgress < 0.51);
  s = run(s, ROCKET_CONFIGS.large.buildDuration / 2 + 0.1);
  assert.equal(s.phase, 'ready');
  s = launchRocket(s);
  assert.equal(s.phase, 'countdown');
  s = run(s, ROCKET_CONFIGS.large.countdownDuration - 1);
  assert.equal(s.phase, 'countdown');
  assert(s.countdown > 0.9 && s.countdown < 1.1);
  s = run(s, 1 + ROCKET_CONFIGS.large.ignitionDuration * 0.42);
  assert.equal(s.phase, 'ignition');
  assert(s.throttle > 0.35 && s.throttle < 0.5);
  assert.equal(s.position.y, 0);
  assert(sampleRocketEffects(s).groundExposure > 0.35);
  assert.equal(s.events.filter((event) => event.type === 'ignition').length, 1);
});
test('both vehicle sizes reach 100km by continuous staged ascent in about 65 seconds', () => {
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
      assert(s.flightElapsed > 60 && s.flightElapsed < 70);
      assert(s.fuel > 0 && s.fuel < ROCKET_CONFIGS[kind].fuelMass);
      assert(
        Math.hypot(s.position.x - s.origin.x, s.position.z - s.origin.z) >
          1_000,
      );
      assert(s.events.some((event) => event.type === 'mission-complete'));
      assert.equal(s.throttle, 0);
      assert.equal(s.integrity, 1);
      assert.equal(s.boosterAttached, false);
      assert.equal(s.stage, 'coast');
      assert(s.events.some((event) => event.type === 'stage-separation'));
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
  assert(s.supportIntegrity < 0.95 && s.supportIntegrity > 0.8);
  const launch = untilDone(launchRocket(s));
  assert(launch.supportCollapsed);
  assert.equal(launch.phase, 'crashed');
  assert(launch.failureReason);
});
test('small rockets turn more readily; sustained manual steering can invert and crash', () => {
  const airborne = (kind) =>
    run(
      launchRocket(prepared(kind), 'manual'),
      ROCKET_CONFIGS[kind].countdownDuration +
        ROCKET_CONFIGS[kind].ignitionDuration +
        0.2,
      { windScale: 0 },
    );
  const small = run(airborne('small'), 0.5, {
    roll: 0.5,
    windScale: 0,
  });
  const large = run(airborne('large'), 0.5, {
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
  let s = run(launchRocket(prepared('large')), 8);
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
  let s = run(
    launchRocket(prepared('large')),
    ROCKET_CONFIGS.large.countdownDuration +
      ROCKET_CONFIGS.large.ignitionDuration * 0.85,
  );
  const ground = sampleRocketEffects(s);
  assert(ground.groundExposure > 0.7);
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

test('a spent booster drops its actual dry mass once without moving the virtual launch base', () => {
  for (const kind of ['small', 'large']) {
    let s = launchRocket(prepared(kind));
    let previous;
    while (s.boosterAttached && s.elapsed < 45) {
      previous = s;
      s = stepRocket(s, {}, dt);
    }
    const cfg = ROCKET_CONFIGS[kind];
    assert.equal(s.stage, 'separating');
    assert.equal(s.boosterFuel, 0);
    assert.equal(
      s.upperFuel,
      cfg.stages.upper.fuelMass,
      'upper-stage fuel is reserved during boost',
    );
    assert.equal(s.fuel, s.upperFuel);
    assert.equal(s.mass, rocketMass(s));
    assert(
      Math.abs(
        previous.mass -
          s.mass -
          cfg.stages.boost.dryMass -
          previous.boosterFuel,
      ) < 1e-6,
    );
    assert.deepEqual(
      s.separation.position,
      s.position,
      'detached and surviving stages share the exact same pose at separation',
    );
    assert.deepEqual(
      s.separation.velocity,
      s.velocity,
      'time and momentum come from the same physical instant',
    );
    assert(
      Math.abs(s.position.y - previous.position.y) < 40,
      'separation never teleports the upper stage',
    );
    assert(Math.abs(s.velocity.y - previous.velocity.y) < 5);
    assert(
      Math.abs(s.velocity.y - previous.velocity.y - s.acceleration.y * dt) <
        1e-8,
      'only the integrated gravity and drag change velocity during separation',
    );
    assert.equal(s.throttle, 0);
    assert.equal(s.stageThrust, 0);
    assert.equal(sampleRocketEffects(s).engine, 0);
    const events = s.events.filter((e) =>
      ['booster-burnout', 'stage-separation'].includes(e.type),
    );
    assert.deepEqual(
      events.map((e) => e.type),
      ['booster-burnout', 'stage-separation'],
    );
    assert.equal(events[1].magnitude, cfg.stages.boost.dryMass);
    const separated = structuredClone(s);
    s = run(s, cfg.separationDuration - 2 * dt);
    assert.equal(s.stage, 'separating');
    assert.equal(s.upperFuel, cfg.stages.upper.fuelMass);
    s = run(s, 0.2);
    assert.equal(s.stage, 'upper');
    assert(s.upperFuel < cfg.stages.upper.fuelMass);
    assert(s.stageThrust > 0);
    assert.equal(s.boosterFuel, 0);
    assert.equal(
      s.events.filter((e) => e.type === 'stage-separation').length,
      1,
    );
    assert.equal(s.events.filter((e) => e.type === 'upper-ignition').length, 1);
    assert.deepEqual(
      separated.separation,
      s.separation,
      'the detached booster launch snapshot stays immutable',
    );
    const direction = rocketDirection(s.attitude),
      nozzle = sampleRocketEffects(s).nozzle;
    assert(
      Math.abs(
        nozzle.y -
          s.position.y -
          direction.y * cfg.height * cfg.upperNozzleFraction,
      ) < 1e-8,
    );
  }
});

test('upper-stage exhaustion cuts thrust and emits one burnout and one aggregate fuel-empty event', () => {
  let s = launchRocket(prepared());
  while (s.stage !== 'upper') s = stepRocket(s, {}, dt);
  // A near-empty upper-stage fixture isolates the exact exhaustion boundary.
  // No successful phase or altitude is assigned.
  s = {
    ...s,
    upperFuel: 0.25,
    fuel: 0.25,
    mass: ROCKET_CONFIGS.small.stages.upper.dryMass + 0.25,
  };
  s = run(s, 1);
  assert.equal(s.stage, 'coast');
  assert.equal(s.upperFuel, 0);
  assert.equal(s.fuel, 0);
  assert.equal(s.mass, ROCKET_CONFIGS.small.stages.upper.dryMass);
  assert.equal(s.stageThrust, 0);
  assert.equal(sampleRocketEffects(s).engine, 0);
  assert.equal(s.events.filter((e) => e.type === 'upper-burnout').length, 1);
  assert.equal(s.events.filter((e) => e.type === 'fuel-empty').length, 1);
  assert.equal(s.events.filter((e) => e.type === 'stage-separation').length, 1);
});

test('aborting during separation cannot light the upper engine or consume its reserved fuel', () => {
  let s = launchRocket(prepared('large'));
  while (s.stage !== 'separating') s = stepRocket(s, {}, dt);
  const upperFuel = s.upperFuel;
  s = stepRocket(s, { abort: true }, dt);
  s = run(s, 2);
  assert.equal(s.phase, 'aborted');
  assert.equal(s.stage, 'coast');
  assert.equal(s.upperFuel, upperFuel);
  assert.equal(s.throttle, 0);
  assert.equal(s.stageThrust, 0);
  assert(!s.events.some((e) => e.type === 'upper-ignition'));
});

test('mission completion shuts down thrust while preserving a continuous moving space coast', () => {
  const complete = untilDone(launchRocket(prepared('small')));
  assert.equal(complete.phase, 'space');
  const next = stepRocket(complete, {}, dt);
  assert.equal(next.phase, 'space');
  assert.equal(next.stage, 'coast');
  assert.equal(next.throttle, 0);
  assert.equal(next.stageThrust, 0);
  assert(
    next.position.y > complete.position.y + 20,
    'coast keeps the actual arrival momentum',
  );
  assert(Math.abs(next.velocity.y - complete.velocity.y) < 0.2);
  assert.equal(next.fuel, complete.fuel);
  const observing = run(next, 120);
  assert(observing.position.y > next.position.y);
  assert(observing.velocity.y > 0);
  assert.equal(
    observing.events.filter((e) => e.type === 'mission-complete').length,
    1,
  );
});

test('a detached upper stage lands on its real nozzle or inverted nose without a ghost booster collision', () => {
  let upper = launchRocket(prepared('small'));
  while (upper.stage !== 'upper') upper = stepRocket(upper, {}, dt);
  const h = ROCKET_CONFIGS.small.height,
    nozzleHeight = h * ROCKET_CONFIGS.small.upperNozzleFraction;
  const low = {
    ...upper,
    origin: { x: 0, y: 0, z: 0 },
    support: { kind: 'ground', groundY: 0 },
    position: { x: 0, y: -3, z: 0 },
    velocity: { x: 0, y: -2, z: 0 },
    attitude: { pitch: 0, roll: 0 },
    angularVelocity: { pitch: 0, roll: 0 },
    altitude: 0,
    throttle: 0,
    targetThrottle: 0,
  };
  const clear = stepRocket(low, { auto: false, throttle: 0, windScale: 0 }, dt);
  assert.equal(
    clear.phase,
    'flight',
    'a virtual base below terrain is harmless while the remaining vehicle is above it',
  );
  const landing = stepRocket(
    { ...low, position: { x: 0, y: -nozzleHeight + 0.01, z: 0 } },
    { auto: false, throttle: 0, windScale: 0 },
    dt,
  );
  assert.equal(landing.phase, 'crashed');
  assert(
    Math.abs(landing.position.y + nozzleHeight) < 1e-9,
    'the surviving nozzle contacts the ground; the virtual base does not snap to it',
  );
  const nose = stepRocket(
    {
      ...low,
      position: { x: 0, y: h - 0.1, z: 0 },
      attitude: { pitch: Math.PI, roll: 0 },
    },
    { auto: false, throttle: 0, windScale: 0 },
    dt,
  );
  assert.equal(nose.phase, 'crashed');
  assert(
    Math.abs(nose.position.y - h) < 1e-9,
    'an inverted surviving nose is the actual contact point',
  );
});
