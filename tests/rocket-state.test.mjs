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
  ROCKET_SUPPORT_RELEASE_DELAY,
} = await import(cityModule('rocket-state'));
const dt = 1 / 60;
const rocketKinds = Object.keys(ROCKET_CONFIGS);
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
  assert.deepEqual(
    Object.fromEntries(
      rocketKinds.map((kind) => [
        kind,
        {
          build: ROCKET_CONFIGS[kind].buildDuration,
          countdown: ROCKET_CONFIGS[kind].countdownDuration,
        },
      ]),
    ),
    {
      small: { build: 6, countdown: 5 },
      large: { build: 10, countdown: 5 },
      'super-heavy': { build: 16, countdown: 5 },
    },
  );
  for (const kind of rocketKinds) {
    const config = ROCKET_CONFIGS[kind];
    let s = createRocket(kind, 0, 0, 0);
    assert.equal(launchRocket(s).phase, 'building');
    s = run(s, config.buildDuration / 2);
    assert(s.buildProgress > 0.49 && s.buildProgress < 0.51);
    s = run(s, config.buildDuration / 2 + 0.1);
    assert.equal(s.phase, 'ready');
    s = launchRocket(s);
    assert.equal(s.phase, 'countdown');
    assert.equal(s.countdown, 5);
    s = run(s, config.countdownDuration - 1);
    assert.equal(s.phase, 'countdown');
    assert(s.countdown > 0.9 && s.countdown < 1.1);
    s = run(s, 1 + config.ignitionDuration * 0.42);
    assert.equal(s.phase, 'ignition');
    assert(s.throttle > 0.35 && s.throttle < 0.5);
    assert.equal(s.position.y, 0);
    assert(sampleRocketEffects(s).groundExposure > 0.35);
    assert.equal(
      s.events.filter((event) => event.type === 'ignition').length,
      1,
    );
  }
});
test('all three vehicle classes reach 100km by continuous staged ascent without changing the earlier flight pace', () => {
  for (const kind of rocketKinds) {
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
      assert(s.flightElapsed > (kind === 'super-heavy' ? 65 : 60));
      assert(s.flightElapsed < (kind === 'super-heavy' ? 75 : 70));
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
test('all three vehicle classes account for every stage dry mass and fuel reserve', () => {
  for (const kind of rocketKinds) {
    const config = ROCKET_CONFIGS[kind];
    const s = createRocket(kind, 0, 0, 0, { kind: 'platform' });
    assert.equal(
      config.dryMass,
      config.stages.boost.dryMass +
        config.stages.upper.dryMass +
        (config.strapOns?.dryMass ?? 0),
    );
    assert.equal(
      config.fuelMass,
      config.stages.boost.fuelMass +
        config.stages.upper.fuelMass +
        (config.strapOns?.fuelMass ?? 0),
    );
    assert.equal(s.mass, config.dryMass + config.fuelMass);
    assert.equal(s.mass, rocketMass(s));
    const flight = run(
      launchRocket(prepared(kind)),
      config.countdownDuration + config.ignitionDuration + 2,
    );
    assert(flight.boosterFuel < s.boosterFuel);
    if (config.strapOns) assert(flight.strapFuel < s.strapFuel);
    assert.equal(flight.upperFuel, s.upperFuel);
    assert.equal(flight.mass, rocketMass(flight));
    assert(Math.abs(s.mass - flight.mass - (s.fuel - flight.fuel)) < 1e-6);
  }
  const titan = ROCKET_CONFIGS['super-heavy'],
    atlas = ROCKET_CONFIGS.large;
  assert.equal(
    (titan.dryMass + titan.fuelMass) / (atlas.dryMass + atlas.fuelMass),
    4.6,
  );
  const accelerationRatio =
    titan.maxThrust /
    (titan.dryMass + titan.fuelMass) /
    (atlas.maxThrust / (atlas.dryMass + atlas.fuelMass));
  assert(accelerationRatio > 0.9 && accelerationRatio < 1.1);
  assert.equal(
    titan.radius,
    6.3,
    'closed flaps do not inflate aerodynamic core radius',
  );
  assert.equal(titan.footprintRadius, 14.1);
  assert.equal(titan.upperFootprintRadius, 10.1);
});

test('Titan lights four external boosters with its core and drops their real mass before either central stage', () => {
  const config = ROCKET_CONFIGS['super-heavy'];
  const initial = createRocket('super-heavy', 0, 0, 0, {
    kind: 'platform',
    seed: 13,
  });
  assert.equal(initial.stage, 'strap-on');
  assert.equal(initial.strapAttached, true);
  assert.equal(initial.boosterAttached, true);
  assert.equal(initial.mass, 1_886_000);
  assert.equal(config.dryMass, 460_000);
  assert.equal(config.strapOns.dryMass, 4 * 35_000);
  assert.equal(config.strapOns.fuelMass, 4 * 125_000);
  assert.equal(
    config.maxThrust,
    config.strapOns.maxThrust + config.stages.boost.maxThrust,
  );
  let s = launchRocket(run(initial, config.buildDuration + 0.1));
  const ready = structuredClone(s);
  s = run(s, config.countdownDuration - 0.1);
  assert.equal(s.phase, 'countdown');
  assert.equal(
    s.fuel,
    ready.fuel,
    'neither propulsion system burns before ignition',
  );
  s = run(s, 0.1 + config.ignitionDuration * 0.5);
  assert.equal(s.phase, 'ignition');
  assert(
    s.strapFuel < initial.strapFuel && s.boosterFuel < initial.boosterFuel,
  );
  assert.equal(s.upperFuel, initial.upperFuel);
  const consumedStrap = initial.strapFuel - s.strapFuel;
  const consumedCore = initial.boosterFuel - s.boosterFuel;
  assert(
    Math.abs(
      consumedStrap / consumedCore -
        config.strapOns.fuelPerSecond / config.stages.boost.fuelPerSecond,
    ) < 1e-9,
  );
  assert(
    s.stageThrust > config.maxThrust * 0.45 &&
      s.stageThrust < config.maxThrust * 0.55,
  );
  const ignition = s.events.find((event) => event.type === 'ignition');
  assert.equal(
    s.events.find((event) => event.type === 'core-ignition').time,
    ignition.time,
  );
  let before = s;
  while (s.strapAttached && s.elapsed < 60) {
    before = s;
    s = stepRocket(s, {}, dt);
  }
  assert.equal(s.stage, 'strap-separating');
  assert.equal(s.strapFuel, 0);
  assert.equal(s.strapAttached, false);
  assert.equal(s.boosterAttached, true, 'the central core remains attached');
  assert(s.boosterFuel > 0 && s.boosterFuel < initial.boosterFuel);
  assert.equal(s.upperFuel, initial.upperFuel);
  assert.equal(
    s.separation,
    null,
    'strap release does not overwrite central-core separation',
  );
  assert.equal(s.mass, rocketMass(s));
  assert(
    Math.abs(
      before.mass - s.mass - config.strapOns.dryMass - (before.fuel - s.fuel),
    ) < 1e-6,
  );
  assert.deepEqual(s.strapSeparation.position, s.position);
  assert.deepEqual(s.strapSeparation.velocity, s.velocity);
  assert.deepEqual(s.strapSeparation.attitude, s.attitude);
  assert.equal(s.strapSeparation.time, s.elapsed);
  assert.equal(s.strapSeparation.flightTime, s.flightElapsed);
  assert.equal(
    s.events.find((event) => event.type === 'strap-on-separation').magnitude,
    140_000,
  );
  assert(
    Math.abs(s.velocity.y - before.velocity.y) < 2.5,
    'release cannot teleport momentum',
  );
  assert(Math.abs(s.position.y - before.position.y) < 25);
  const released = structuredClone(s);
  s = run(s, config.strapSeparationDuration - dt * 2);
  assert.equal(s.stage, 'strap-separating');
  assert(
    s.boosterFuel < released.boosterFuel,
    'the core burns throughout release',
  );
  assert(s.stageThrust > config.stages.boost.maxThrust * 0.99);
  assert(sampleRocketEffects(s).engine > 0.5);
  assert.equal(s.upperFuel, initial.upperFuel);
  s = run(s, 0.15);
  assert.equal(s.stage, 'boost');
  assert(s.throttle > 0.99 && s.stageThrust > 0);
  assert.deepEqual(s.strapSeparation, released.strapSeparation);
  const result = untilDone(s);
  assert.equal(result.phase, 'space');
  assert(result.flightElapsed > 65 && result.flightElapsed < 75);
  assert.equal(result.strapAttached, false);
  assert.equal(result.boosterAttached, false);
  assert.equal(result.mass, config.stages.upper.dryMass + result.upperFuel);
  assert(
    Math.abs(
      initial.mass -
        result.mass -
        (initial.fuel - result.fuel) -
        config.strapOns.dryMass -
        config.stages.boost.dryMass,
    ) < 1e-6,
  );
  assert.deepEqual(
    result.events
      .filter((event) =>
        [
          'ignition',
          'core-ignition',
          'liftoff',
          'strap-on-burnout',
          'strap-on-separation',
          'core-only',
          'booster-burnout',
          'stage-separation',
          'upper-ignition',
          'mission-complete',
        ].includes(event.type),
      )
      .map((event) => event.type),
    [
      'ignition',
      'core-ignition',
      'liftoff',
      'strap-on-burnout',
      'strap-on-separation',
      'core-only',
      'booster-burnout',
      'stage-separation',
      'upper-ignition',
      'mission-complete',
    ],
  );
  assert.deepEqual(released.strapSeparation, result.strapSeparation);
});

test('manual Titan commands scale both burning systems and stopping throttle never spends hidden fuel', () => {
  const config = ROCKET_CONFIGS['super-heavy'];
  let s = run(
    launchRocket(
      prepared('super-heavy', { kind: 'platform', seed: 13 }),
      'manual',
    ),
    config.countdownDuration + config.ignitionDuration + 3,
    { throttle: 0.7, stabilize: true, windScale: 0 },
  );
  s = run(s, 0.5, { throttle: 0.4, stabilize: true, windScale: 0 });
  const before = structuredClone(s);
  s = run(s, 1, {
    throttle: 0.4,
    pitch: 0.7,
    roll: -0.4,
    stabilize: true,
    windScale: 0,
  });
  assert.equal(s.stage, 'strap-on');
  assert(s.attitude.pitch > before.attitude.pitch + 0.01);
  assert(s.attitude.roll < before.attitude.roll - 0.005);
  assert(
    Math.abs(
      before.strapFuel - s.strapFuel - config.strapOns.fuelPerSecond * 0.4,
    ) < 1e-6,
  );
  assert(
    Math.abs(
      before.boosterFuel -
        s.boosterFuel -
        config.stages.boost.fuelPerSecond * 0.4,
    ) < 1e-6,
  );
  assert.equal(s.upperFuel, before.upperFuel);
  s = run(s, 0.5, { throttle: 0, stabilize: true, windScale: 0 });
  assert.equal(s.throttle, 0);
  assert.equal(sampleRocketEffects(s).engine, 0);
  const stopped = structuredClone(s);
  s = run(s, 0.5, { throttle: 0, stabilize: true, windScale: 0 });
  assert.equal(s.strapFuel, stopped.strapFuel);
  assert.equal(s.boosterFuel, stopped.boosterFuel);
  assert.equal(s.upperFuel, stopped.upperFuel);
  assert.equal(s.mass, stopped.mass);
  const resumed = stepRocket(s, { auto: true }, dt);
  assert(Math.abs(resumed.attitude.pitch - s.attitude.pitch) < 0.01);
  assert.equal(untilDone(resumed).phase, 'space');
});

test('Titan abort and impact shut down all live engines without a later automatic stage ignition', () => {
  const config = ROCKET_CONFIGS['super-heavy'];
  for (const target of [
    'strap-on',
    'strap-separating',
    'boost',
    'separating',
    'upper',
  ]) {
    let s = run(
      launchRocket(prepared('super-heavy', { kind: 'platform', seed: 13 })),
      config.countdownDuration + config.ignitionDuration + 2,
    );
    while (
      s.stage !== target &&
      !['space', 'crashed'].includes(s.phase) &&
      s.elapsed < 100
    )
      s = stepRocket(s, {}, dt);
    assert.equal(s.stage, target);
    const snapshot = structuredClone(s),
      lastEvent = s.nextEventId;
    const aborted = run(stepRocket(s, { abort: true }, dt), 2);
    assert.equal(aborted.phase, 'aborted');
    assert.equal(aborted.stage, 'coast');
    assert.equal(aborted.throttle, 0);
    assert.equal(aborted.stageThrust, 0);
    assert.equal(sampleRocketEffects(aborted).engine, 0);
    assert.equal(aborted.strapFuel, snapshot.strapFuel);
    assert.equal(aborted.boosterFuel, snapshot.boosterFuel);
    assert.equal(aborted.upperFuel, snapshot.upperFuel);
    assert(
      !aborted.events.some(
        (event) =>
          event.id >= lastEvent &&
          [
            'core-only',
            'upper-ignition',
            'strap-on-separation',
            'stage-separation',
          ].includes(event.type),
      ),
    );
    const crashed = run(crashRocket(s), 2);
    assert.equal(crashed.phase, 'crashed');
    assert.equal(crashed.fuel, snapshot.fuel);
    assert.equal(crashed.stageThrust, 0);
    assert.equal(sampleRocketEffects(crashed).engine, 0);
    assert.deepEqual(
      s,
      snapshot,
      'separation and abort operations do not mutate input states',
    );
  }
});

test('Scout and Atlas retain their original two-stage event order without any external booster fuel or mass', () => {
  for (const kind of ['small', 'large']) {
    assert.equal(ROCKET_CONFIGS[kind].strapOns, undefined);
    const s = prepared(kind, { kind: 'platform', seed: 13 });
    assert.equal(s.stage, 'boost');
    assert.equal(s.strapAttached, false);
    assert.equal(s.strapFuel, 0);
    assert.equal(s.strapSeparation, null);
    const result = untilDone(launchRocket(s));
    assert.equal(result.phase, 'space');
    assert(result.flightElapsed > 60 && result.flightElapsed < 70);
    assert.deepEqual(
      result.events.map((event) => event.type),
      [
        'ready',
        'countdown',
        'ignition',
        'liftoff',
        'booster-burnout',
        'stage-separation',
        'upper-ignition',
        'mission-complete',
      ],
    );
    assert.equal(result.strapFuel, 0);
    assert.equal(result.strapSeparation, null);
    assert.equal(
      result.mass,
      ROCKET_CONFIGS[kind].stages.upper.dryMass + result.upperFuel,
    );
  }
});

test('Titan requires a firm launch foundation and ordinary roofs or lake beds give way', () => {
  for (const support of [
    { kind: 'roof-small', groundY: 0, seed: 13 },
    { kind: 'roof-large', groundY: 0, seed: 13 },
    { kind: 'ground', strength: 0.8, groundY: 0, seed: 13 },
    { kind: 'lake', groundY: 0, seed: 13 },
  ]) {
    const y = support.kind.startsWith('roof') ? 30 : 0;
    const result = untilDone(launchRocket(prepared('super-heavy', support, y)));
    assert.equal(
      result.phase,
      'crashed',
      `${support.kind} must not carry Titan`,
    );
    assert(result.supportCollapsed);
    const collapsed = result.events.find((e) => e.type === 'support-collapsed');
    const impact = result.events.find((e) => e.type === 'impact');
    assert(collapsed && impact && impact.time - collapsed.time > 1.5);
    assert(result.maxAltitude < 20);
  }
  const grounded = untilDone(
    launchRocket(
      prepared('super-heavy', {
        kind: 'ground',
        strength: 1,
        seed: 13,
      }),
    ),
  );
  assert.equal(grounded.phase, 'space');
  assert.equal(grounded.supportIntegrity, 1);
  assert(!grounded.supportCollapsed);
  const lighter = untilDone(
    launchRocket(
      prepared('large', {
        kind: 'ground',
        strength: 0.8,
        seed: 13,
      }),
    ),
  );
  assert.equal(
    lighter.phase,
    'space',
    'the new foundation load does not change Atlas',
  );
});

test('Titan retains responsive manual gimbal and throttle control and can return to the physical autopilot', () => {
  const config = ROCKET_CONFIGS['super-heavy'];
  let s = run(
    launchRocket(
      prepared('super-heavy', { kind: 'platform', seed: 13 }),
      'manual',
    ),
    config.countdownDuration + config.ignitionDuration + 6.5,
    { stabilize: true, windScale: 0 },
  );
  const before = structuredClone(s);
  s = run(s, 1, {
    pitch: 0.7,
    roll: 0.3,
    throttle: 0.75,
    stabilize: true,
    windScale: 0,
  });
  assert.equal(s.phase, 'flight');
  assert(s.attitude.pitch > before.attitude.pitch + 0.04);
  assert(s.attitude.roll > before.attitude.roll + 0.015);
  assert.equal(s.throttle, 0.75);
  const resumed = stepRocket(s, { auto: true }, dt);
  assert(Math.abs(resumed.attitude.pitch - s.attitude.pitch) < 0.01);
  assert.equal(untilDone(resumed).phase, 'space');
});

test('Titan exhaust affects a wider area and supplies stronger impulses without changing earlier vehicle samples', () => {
  const effects = Object.fromEntries(
    rocketKinds.map((kind) => {
      const config = ROCKET_CONFIGS[kind];
      const state = run(
        launchRocket(prepared(kind)),
        config.countdownDuration + config.ignitionDuration * 0.95,
      );
      assert.equal(state.phase, 'ignition');
      const effect = sampleRocketEffects(state);
      assert(
        Math.abs(
          effect.blastRadius / Math.sqrt(effect.groundExposure) -
            config.blastRadius,
        ) < 1e-8,
      );
      assert(
        Math.abs(
          effect.heatRadius / Math.sqrt(effect.groundExposure) -
            config.heatRadius,
        ) < 1e-8,
      );
      return [kind, effect];
    }),
  );
  assert.equal(ROCKET_CONFIGS['super-heavy'].effectStrength, 2.2);
  assert(effects['super-heavy'].blastRadius > 200);
  assert(effects['super-heavy'].heatRadius > 95);
  assert(effects['super-heavy'].blastRadius > effects.large.blastRadius * 2);
  assert(effects['super-heavy'].heatRadius > effects.large.heatRadius * 2);
  assert(
    effects['super-heavy'].debrisImpulse > effects.large.debrisImpulse * 1.7,
  );
  assert(effects['super-heavy'].shake > effects.large.shake * 1.7);
  for (const [kind, impulse, shake] of [
    ['small', 18, 0.4],
    ['large', 48, 1],
  ]) {
    assert.equal(ROCKET_CONFIGS[kind].effectStrength, 1);
    assert(
      Math.abs(
        effects[kind].debrisImpulse / effects[kind].groundExposure - impulse,
      ) < 1e-8,
    );
    assert(
      Math.abs(effects[kind].shake / effects[kind].groundExposure - shake) <
        1e-8,
    );
  }
});

test('sea and river placement sinks immediately; even auto cannot launch it', () => {
  for (const rocketKind of rocketKinds) {
    for (const kind of ['ocean', 'river']) {
      const s = createRocket(rocketKind, 0, 2, 0, { kind });
      assert.equal(s.phase, 'sinking');
      const next = run(launchRocket(s), 5, { launch: true, auto: true });
      assert.equal(next.phase, 'sinking');
      assert(next.position.y < s.position.y - 8);
      assert.equal(next.fuel, s.fuel);
      assert.equal(sampleRocketEffects(next).engine, 0);
    }
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
  let s = run(
    launchRocket(prepared('small'), 'manual'),
    ROCKET_CONFIGS.small.countdownDuration +
      ROCKET_CONFIGS.small.ignitionDuration +
      6.5,
    {
      stabilize: true,
    },
  );
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
  let s = run(
    launchRocket(prepared('large')),
    ROCKET_CONFIGS.large.countdownDuration +
      ROCKET_CONFIGS.large.ignitionDuration +
      4,
  );
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
  for (const kind of rocketKinds) {
    const cfg = ROCKET_CONFIGS[kind];
    let s = launchRocket(prepared(kind));
    const deadline =
      s.elapsed +
      cfg.countdownDuration +
      cfg.ignitionDuration +
      cfg.stages.boost.fuelMass / cfg.stages.boost.fuelPerSecond +
      2;
    let previous;
    while (s.boosterAttached && s.elapsed < deadline) {
      previous = s;
      s = stepRocket(s, {}, dt);
    }
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

test('a collapsing roof visibly sags, loses support, and freely falls before the impact', () => {
  let s = launchRocket(
    prepared('large', { kind: 'roof-small', groundY: 0, seed: 13 }, 8),
  );
  while (!s.supportCollapsed && s.elapsed < 20) s = stepRocket(s, {}, dt);
  const collapse = structuredClone(s);
  assert.equal(s.phase, 'falling');
  assert.equal(s.failureStage, 'support-collapse');
  assert.equal(s.supportCollapseElapsed, 0);
  assert.equal(s.wreckage, null);
  assert.equal(s.throttle, 0);
  assert.equal(sampleRocketEffects(s).engine, 0);
  s = run(s, ROCKET_SUPPORT_RELEASE_DELAY - 0.1);
  assert.equal(s.failureStage, 'support-collapse');
  assert(s.position.y > 7.4 && s.position.y < 8);
  assert(!s.events.some((e) => e.type === 'impact'));
  s = run(s, 0.2);
  assert.equal(s.failureStage, 'freefall');
  assert.equal(s.phase, 'falling');
  assert(s.velocity.y < -0.9);
  assert.equal(s.events.filter((e) => e.type === 'support-lost').length, 1);
  const result = untilDone(s);
  assert.equal(result.phase, 'crashed');
  assert.equal(result.failureStage, 'wreckage');
  assert(result.elapsed - collapse.elapsed > 2.4);
  assert(result.elapsed - collapse.elapsed < 3.1);
  assert(result.wreckage.velocity.y < -10);
  assert.equal(
    result.fuel,
    collapse.fuel,
    'failed supports shut the engine down',
  );
  assert.deepEqual(
    result.events
      .filter((e) =>
        ['support-collapsed', 'support-lost', 'impact', 'ruptured'].includes(
          e.type,
        ),
      )
      .map((e) => e.type),
    ['support-collapsed', 'support-lost', 'impact', 'ruptured'],
  );
});

test('unstable lake support has a readable collapse and sinks below the vanished bed before impact', () => {
  let s = launchRocket(prepared('large', { kind: 'lake', seed: 7 }));
  while (!s.supportCollapsed && s.elapsed < 20) s = stepRocket(s, {}, dt);
  const collapseTime = s.elapsed;
  s = untilDone(s);
  assert.equal(s.phase, 'crashed');
  assert(s.elapsed - collapseTime > 2);
  assert(s.position.y < s.origin.y - 2);
  assert(s.wreckage.velocity.y < -5);
  assert(s.events.some((e) => e.type === 'support-lost'));
});

test('a low roof keeps collapsing after an early vehicle impact without moving its wreckage snapshot', () => {
  const impact = untilDone(
    launchRocket(
      prepared(
        'large',
        {
          kind: 'roof-small',
          groundY: 0,
          seed: 13,
        },
        2.45,
      ),
    ),
  );
  assert.equal(impact.phase, 'crashed');
  assert(
    impact.supportCollapseElapsed > 2 && impact.supportCollapseElapsed < 2.6,
  );
  const pose = structuredClone({
    time: impact.wreckage.time,
    position: impact.wreckage.position,
    velocity: impact.wreckage.velocity,
    attitude: impact.wreckage.attitude,
    angularVelocity: impact.wreckage.angularVelocity,
  });
  const settled = run(impact, 5);
  assert(settled.supportCollapseElapsed >= 2.6);
  assert(
    Math.abs(
      settled.supportCollapseElapsed - impact.supportCollapseElapsed - 5,
    ) < 1e-8,
  );
  assert.deepEqual(
    {
      time: settled.wreckage.time,
      position: settled.wreckage.position,
      velocity: settled.wreckage.velocity,
      attitude: settled.wreckage.attitude,
      angularVelocity: settled.wreckage.angularVelocity,
    },
    pose,
  );
  assert(
    impact.supportCollapseElapsed < 2.6,
    'previous snapshots remain unchanged',
  );
});

test('impact preserves incoming wreckage momentum and a seeded fuel explosion follows the rupture later', () => {
  const airborne = run(
    launchRocket(prepared('large', { kind: 'platform', seed: 13 })),
    10,
  );
  const frozen = structuredClone(airborne);
  const impact = crashRocket(airborne, 'A falling vehicle struck a building.');
  assert.deepEqual(impact.wreckage.position, airborne.position);
  assert.deepEqual(impact.wreckage.velocity, airborne.velocity);
  assert.deepEqual(impact.wreckage.attitude, airborne.attitude);
  assert.deepEqual(impact.wreckage.angularVelocity, airborne.angularVelocity);
  assert.equal(impact.wreckage.cause, 'impact');
  assert.equal(impact.wreckage.exploded, false);
  assert.equal(impact.wreckage.explosionTime, null);
  assert(impact.wreckage.explosionDelay >= 0.65);
  assert.equal(impact.events.at(-1).type, 'ruptured');
  const waiting = run(impact, 0.5);
  assert.equal(waiting.wreckage.explosionTime, null);
  const exploded = run(waiting, 0.5);
  assert.equal(exploded.wreckage.exploded, true);
  assert(exploded.wreckage.explosionTime - impact.wreckage.time >= 0.65);
  assert(exploded.wreckage.explosionTime - impact.wreckage.time < 0.95);
  assert.equal(exploded.events.at(-1).type, 'exploded');
  assert.equal(
    run(exploded, 5).events.filter((e) => e.type === 'exploded').length,
    1,
  );
  assert.deepEqual(exploded.wreckage.velocity, airborne.velocity);
  assert.deepEqual(impact.wreckage.position, airborne.position);
  assert.equal(
    impact.wreckage.exploded,
    false,
    'terminal stepping is immutable',
  );
  assert.deepEqual(airborne, frozen);
});

test('low-energy or dry collisions rupture without a fuel explosion; fueled hard impacts vary by seed', () => {
  for (const dry of [false, true]) {
    let s = prepared('small', { kind: 'platform', seed: 13 });
    s = {
      ...s,
      velocity: { x: dry ? 40 : 0, y: dry ? -20 : -2, z: 0 },
      ...(dry ? { fuel: 0, boosterFuel: 0, upperFuel: 0 } : {}),
    };
    const result = run(crashRocket(s), 3);
    assert.equal(result.wreckage.explosionDelay, null);
    assert.equal(result.wreckage.exploded, false);
    assert(!result.events.some((e) => e.type === 'exploded'));
    assert(result.events.some((e) => e.type === 'ruptured'));
  }
  let explosions = 0;
  for (let seed = 0; seed < 30; seed++) {
    const s = {
      ...createRocket('large', 0, 20, 0, { kind: 'platform', seed }),
      velocity: { x: 0, y: -20, z: 0 },
    };
    if (run(crashRocket(s), 2).wreckage.exploded) explosions++;
  }
  assert(
    explosions > 0 && explosions < 30,
    `seeded outcomes: ${explosions}/30`,
  );
});

function fireExposedLaunch(seed = 1) {
  // Isolate external forest heating from the preparation clock: the caller
  // begins its fire exposure at ignition rather than during the countdown.
  return run(
    launchRocket(prepared('small', { kind: 'platform', seed })),
    ROCKET_CONFIGS.small.countdownDuration + dt * 2,
  );
}
function burningLaunch(seed = 1) {
  let s = fireExposedLaunch(seed);
  const limit = s.elapsed + 10;
  while (s.fireIntensity === 0 && s.elapsed < limit)
    s = stepRocket(s, { fireExposure: 1 }, dt);
  return s;
}

test('nearby fire first ignites the vehicle visibly, then may burst its fueled tanks during flight', () => {
  const burning = burningLaunch();
  assert(burning.fireIntensity > 0);
  assert(burning.heat > 0.6);
  assert.equal(burning.wreckage, null);
  assert(!burning.events.some((e) => e.type === 'exploded'));
  const result = untilDone(burning, { fireExposure: 1 }, 20);
  assert.equal(result.phase, 'crashed');
  assert.equal(result.wreckage.cause, 'fire');
  assert.equal(result.wreckage.exploded, true);
  assert.equal(result.wreckage.explosionTime, result.wreckage.time);
  assert(
    result.wreckage.position.y > 100,
    'failure happens after actual ascent',
  );
  assert(result.wreckage.velocity.y > 10, 'airburst retains ascent momentum');
  assert(result.fireDamage > 0);
  const ignited = result.events.find((e) => e.type === 'vehicle-ignited');
  const exploded = result.events.find((e) => e.type === 'exploded');
  assert(exploded.time - ignited.time >= 3);
  assert(
    !result.events.some((e) => e.type === 'impact'),
    'airburst is not an impact',
  );
  assert.equal(sampleRocketEffects(result).engine, 0);
});

test('escaping a forest fire or shutting the engine down cools the same burning snapshot before tank failure', () => {
  const burning = burningLaunch();
  const original = structuredClone(burning);
  const escaped = run(burning, 15);
  const shutdown = run(burning, 15, { abort: true });
  assert.equal(escaped.phase, 'flight');
  assert.equal(escaped.fireIntensity, 0);
  assert.equal(escaped.heat, 0);
  assert.equal(shutdown.phase, 'aborted');
  assert.equal(shutdown.fireIntensity, 0);
  assert.equal(shutdown.fuel, burning.fuel);
  assert(shutdown.fireDamage < escaped.fireDamage);
  for (const s of [escaped, shutdown]) {
    assert(s.fireDamage > 0);
    assert(s.events.some((e) => e.type === 'vehicle-extinguished'));
    assert(!s.events.some((e) => e.type === 'exploded'));
  }
  assert.equal(
    untilDone(escaped).phase,
    'space',
    'a scorched but intact rocket can escape',
  );
  assert.deepEqual(burning, original);
});

test('severely heated tanks can burst after leaving the fire while emergency shutdown arrests the internal fire', () => {
  const hot = run(fireExposedLaunch(1), 5, { fireExposure: 1 });
  assert.equal(hot.phase, 'flight');
  assert(hot.heat > 0.95 && hot.fireIntensity > 0.8);
  assert(hot.fireElapsed > 2 && hot.wreckage === null);
  const departed = untilDone(hot, { fireExposure: 0 });
  assert.equal(departed.wreckage.cause, 'fire');
  assert(departed.wreckage.explosionTime > hot.elapsed + 1);
  assert(departed.wreckage.position.y > hot.position.y + 100);
  const shutdown = run(hot, 15, { abort: true, fireExposure: 0 });
  assert.equal(shutdown.phase, 'aborted');
  assert.equal(shutdown.wreckage, null, 'a ballistic vehicle is still intact');
  assert.equal(shutdown.fireIntensity, 0);
  assert(shutdown.heat < 0.1);
  assert(shutdown.events.some((e) => e.type === 'vehicle-extinguished'));
  assert(!shutdown.events.some((e) => e.type === 'exploded'));
});

test('forest fire susceptibility is seeded, deterministic and does not make every launch explode', () => {
  const start = fireExposedLaunch;
  const vulnerable = start(1),
    resistant = start(0);
  const fire = { fireExposure: 1 };
  const damaged = run(vulnerable, 10, fire);
  assert.deepEqual(damaged, run(vulnerable, 10, fire));
  assert.equal(damaged.phase, 'crashed');
  const safe = run(resistant, 10, fire);
  assert.equal(safe.phase, 'flight');
  assert.equal(safe.fireIntensity, 0);
  assert(!safe.events.some((e) => e.type === 'exploded'));
  let warm = run(start(1), 1, { fireExposure: 0.4 });
  assert(warm.heat > 0 && warm.heat < 0.3);
  warm = run(warm, 5, { fireExposure: Number.NaN });
  assert.equal(warm.heat, 0);
  assert.equal(warm.fireDamage, 0);
  assert.equal(warm.fireIntensity, 0);
});
