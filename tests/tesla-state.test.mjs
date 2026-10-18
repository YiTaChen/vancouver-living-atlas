import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTesla,
  placeTesla,
  stepTesla,
  teslaVehicleFrame,
  TESLA_DEFAULT_SHAPE,
  TESLA_LIMITS,
} = await import(cityModule('tesla-state'));
const {
  teslaFrame,
  teslaRotate,
  teslaTransportForward,
  teslaDot,
  teslaLength,
} = await import(cityModule('tesla-math'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const EMPTY_WORLD = { support: () => null, sweep: () => null };
const FLOOR = {
  surfaceId: 'floor',
  kind: 'ground',
  point: [0, 0, 0],
  normal: [0, 1, 0],
  adherable: true,
};
const WALL = {
  surfaceId: 'wall',
  kind: 'wall',
  point: [0, 0, 30],
  normal: [0, 0, -1],
  adherable: true,
};
const height =
  TESLA_DEFAULT_SHAPE.halfExtents[1] + TESLA_DEFAULT_SHAPE.clearance;
const near = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const speed = (s) => Math.hypot(...s.velocity);
function world({
  floor = true,
  wall = false,
  adherable = true,
  roof = false,
  awning = false,
  ordinaryGround = false,
} = {}) {
  const faces = [];
  if (floor)
    faces.push(
      triangleFace(
        'floor',
        'f0',
        'ground',
        [
          [-200, 0, -200],
          [200, 0, -200],
          [200, 0, 200],
        ],
        true,
        ordinaryGround ? 'ground:0' : 'floor',
        [0, 1, 0],
      ),
      triangleFace(
        'floor',
        'f1',
        'ground',
        [
          [-200, 0, -200],
          [200, 0, 200],
          [-200, 0, 200],
        ],
        true,
        ordinaryGround ? 'ground:0' : 'floor',
        [0, 1, 0],
      ),
    );
  if (wall)
    faces.push(
      triangleFace(
        'wall',
        'w0',
        'wall',
        [
          [-60, 0, 30],
          [60, 0, 30],
          [60, 100, 30],
        ],
        adherable,
        'wall',
        [0, 0, -1],
      ),
      triangleFace(
        'wall',
        'w1',
        'wall',
        [
          [-60, 0, 30],
          [60, 100, 30],
          [-60, 100, 30],
        ],
        adherable,
        'wall',
        [0, 0, -1],
      ),
    );
  if (roof)
    faces.push(
      triangleFace(
        'roof',
        'r0',
        'roof',
        [
          [-60, 100, 30],
          [60, 100, 30],
          [60, 100, 100],
        ],
        true,
        'roof',
        [0, 1, 0],
      ),
      triangleFace(
        'roof',
        'r1',
        'roof',
        [
          [-60, 100, 30],
          [60, 100, 100],
          [-60, 100, 100],
        ],
        true,
        'roof',
        [0, 1, 0],
      ),
    );
  if (awning)
    faces.push(
      triangleFace(
        'awning',
        'a0',
        'obstacle',
        [
          [-10, 3.2, 20],
          [10, 3.2, 20],
          [10, 3.2, 30],
        ],
        false,
        'awning',
        [0, -1, 0],
      ),
      triangleFace(
        'awning',
        'a1',
        'obstacle',
        [
          [-10, 3.2, 20],
          [10, 3.2, 30],
          [-10, 3.2, 30],
        ],
        false,
        'awning',
        [0, -1, 0],
      ),
    );
  return new TeslaWorld({
    sources: [fixedFacesSource('test-physical-triangles', faces)],
  });
}
function run(s, seconds, input = {}, environment = EMPTY_WORLD, dt = 1 / 60) {
  for (let remaining = seconds; remaining > 1e-8; remaining -= dt)
    stepTesla(s, input, Math.min(remaining, dt), environment);
  return s;
}
function assertFinite(s) {
  assert.ok(
    [...s.position, ...s.velocity, ...s.quaternion, s.heading, s.timeS].every(
      Number.isFinite,
    ),
  );
  near(Math.hypot(...s.quaternion), 1);
  assert.ok(speed(s) <= TESLA_LIMITS.maxSpeedMps + 1e-7);
}

test('contact placement uses chassis centre and metadata-driven wheel-plane offset', () => {
  const shape = { halfExtents: [1, 0.7, 2.4], clearance: 0.08 };
  const s = placeTesla(FLOOR, 0.4, shape);
  near(s.position[1], 0.78);
  assert.equal(s.mode, 'ground');
  assert.equal(s.flightAssist, false);
  near(s.heading, 0.4);
  const vertical = placeTesla({ ...WALL, point: [0, 15, 30] }, 0, shape);
  near(vertical.position[2], 29.22);
  near(teslaDot(teslaVehicleFrame(vertical).up, WALL.normal), 1);
});

test('real triangle ground permits acceleration, reverse, steering and braking without losing the physical floor', () => {
  const environment = world(),
    s = placeTesla(FLOOR);
  run(s, 2, { throttle: 1 }, environment);
  assert.equal(s.mode, 'ground');
  assert.ok(s.position[2] > 35 && speed(s) > 35);
  near(s.position[1], height);
  const heading = s.heading;
  run(s, 0.3, { throttle: 1, steer: 0.6 }, environment);
  assert.ok(Math.abs(s.heading - heading) > 0.05);
  run(s, 2, { brake: true }, environment);
  assert.equal(speed(s), 0);
  run(s, 1, { throttle: -1 }, environment);
  assert.ok(teslaDot(s.velocity, teslaVehicleFrame(s).forward) < -5);
  assertFinite(s);
});

test('jump detaches once on a held button, can rise indefinitely, then brakes into an exact hover', () => {
  const environment = world(),
    s = placeTesla(FLOOR);
  const first = stepTesla(s, { jump: true, lift: 1 }, 1 / 60, environment);
  assert.equal(s.mode, 'air');
  assert.equal(s.flightAssist, true);
  assert.equal(first.transitions, 1);
  run(s, 3, { jump: true, lift: 1 }, environment);
  assert.ok(s.position[1] > 40);
  near(s.velocity[1], TESLA_LIMITS.liftSpeedMps);
  run(s, 2, { brake: true }, environment);
  const stopped = [...s.position];
  assert.equal(speed(s), 0);
  run(s, 5, { brake: true }, environment);
  assert.deepEqual(s.position, stopped);
});

test('a verified road departure clears adjacent suspension triangles without ignoring an overhead obstacle', () => {
  for (const ceiling of [false, true]) {
    const elevated = [
      triangleFace(
        'skin0',
        'skin0',
        'ground',
        [
          [-200, 0.002, -200],
          [200, 0.002, -200],
          [200, 0.002, 200],
        ],
        true,
        'ground:0',
        [0, 1, 0],
      ),
      triangleFace(
        'skin1',
        'skin1',
        'ground',
        [
          [-200, 0.002, -200],
          [200, 0.002, 200],
          [-200, 0.002, 200],
        ],
        true,
        'ground:0',
        [0, 1, 0],
      ),
    ];
    const floor = [
      triangleFace(
        'base0',
        'base0',
        'ground',
        [
          [-200, 0, -200],
          [200, 0, -200],
          [200, 0, 200],
        ],
        true,
        'ground:0',
        [0, 1, 0],
      ),
      triangleFace(
        'base1',
        'base1',
        'ground',
        [
          [-200, 0, -200],
          [200, 0, 200],
          [-200, 0, 200],
        ],
        true,
        'ground:0',
        [0, 1, 0],
      ),
    ];
    const faces = [...floor, ...elevated];
    if (ceiling)
      faces.push(
        triangleFace(
          'ceiling',
          'ceiling0',
          'obstacle',
          [
            [-200, 1.45, -200],
            [200, 1.45, -200],
            [200, 1.45, 200],
          ],
          false,
          'ceiling',
          [0, -1, 0],
        ),
        triangleFace(
          'ceiling',
          'ceiling1',
          'obstacle',
          [
            [-200, 1.45, -200],
            [200, 1.45, 200],
            [-200, 1.45, 200],
          ],
          false,
          'ceiling',
          [0, -1, 0],
        ),
      );
    const environment = new TeslaWorld({
      sources: [fixedFacesSource('suspension-road', faces)],
    });
    try {
      const state = createTesla([0, height, 0], 0, {
        ...FLOOR,
        surfaceId: 'base0',
      });
      for (let i = 0; i < 180; i++)
        stepTesla(state, { jump: i === 0, lift: 1 }, 1 / 60, environment);
      if (ceiling) assert(state.position[1] <= 1.45 - height + 0.002);
      else {
        assert.equal(state.mode, 'air');
        assert(state.position[1] > 30);
        assert.equal(state.departureContact, null);
      }
    } finally {
      environment.dispose();
    }
  }
});

test('departure identity is revalidated before it can exempt one exact support face', () => {
  const state = createTesla([0, height, 0], 0, FLOOR),
    ignored = [];
  const report = stepTesla(state, { jump: true, lift: 1 }, 1 / 60, {
    support: () => null,
    sweep: (query) => {
      ignored.push(query.ignoreSurfaceId);
      return { ...FLOOR, fraction: 0 };
    },
  });
  assert(ignored.length > 0);
  assert(ignored.every((id) => id === undefined));
  assert(report.collisions > 0);
  near(state.position[1], height);
});

test('boosted free flight has no fuel or stamina expiration and remains speed bounded', () => {
  const s = createTesla([0, 200, 0]);
  run(s, 180, { throttle: 1, lift: 0.2, boost: true }, EMPTY_WORLD, 0.1);
  assert.equal(s.mode, 'air');
  assert.equal(s.flightAssist, true);
  assert.ok(s.position[2] > 20_000);
  near(s.velocity[2], TESLA_LIMITS.boostedAirSpeedMps);
  assert.equal('fuel' in s, false);
  assert.equal('stamina' in s, false);
  assertFinite(s);
});

test('flight toggle edges allow gravity descent and physical landing without converting vertical impact into forward speed', () => {
  const environment = world(),
    s = createTesla([0, 12, 0]);
  stepTesla(s, { flightToggle: true }, 1 / 60, environment);
  assert.equal(s.flightAssist, false);
  run(s, 0.5, { flightToggle: true }, environment);
  assert.equal(s.flightAssist, false, 'held F is not toggled every frame');
  run(s, 4, {}, environment);
  assert.equal(s.mode, 'ground');
  near(s.position[1], height);
  assert.equal(speed(s), 0);
  assertFinite(s);
});

test('continuous sweep stops a boosted vehicle at a thin non-adherable wall', () => {
  const environment = world({ wall: true, adherable: false });
  const s = createTesla([0, 20, 0]);
  s.velocity = [0, 0, 140];
  s.adhesionArmed = false;
  const report = stepTesla(s, { throttle: 1, boost: true }, 0.25, environment);
  assert.ok(report.collisions > 0);
  assert.ok(
    s.position[2] <=
      30 -
        TESLA_DEFAULT_SHAPE.halfExtents[2] -
        TESLA_DEFAULT_SHAPE.clearance +
        1e-4,
  );
  assert.equal(s.attachment, null);
  assert.equal(s.contact, null);
  assertFinite(s);
});

test('ground-to-wall transition sweeps its lift and rotation instead of pitching the long body through the ground', () => {
  const environment = world({ wall: true });
  const s = placeTesla(FLOOR);
  let sawTransition = false,
    maximumStep = 0,
    previous = [...s.position];
  for (let frame = 0; frame < 360 && s.mode !== 'wall'; frame++) {
    stepTesla(s, { throttle: 1 }, 1 / 60, environment);
    maximumStep = Math.max(maximumStep, distance(s.position, previous));
    previous = [...s.position];
    sawTransition ||= Boolean(s.attachment);
    const up = teslaVehicleFrame(s).up;
    const forward = teslaVehicleFrame(s).forward;
    const radiusY =
      Math.abs(up[1]) * TESLA_DEFAULT_SHAPE.halfExtents[1] +
      Math.abs(forward[1]) * TESLA_DEFAULT_SHAPE.halfExtents[2];
    assert.ok(
      s.position[1] - radiusY >= -1e-5,
      'body stays above actual ground during the wall pivot',
    );
    assertFinite(s);
  }
  assert.equal(sawTransition, true);
  assert.equal(s.mode, 'wall');
  assert.equal(s.contact.surfaceId, 'wall');
  assert.ok(maximumStep < TESLA_LIMITS.maxSpeedMps / 60 + 1e-4);
  near(teslaDot(teslaVehicleFrame(s).up, WALL.normal), 1);
  assert.ok(s.position[1] > TESLA_DEFAULT_SHAPE.halfExtents[2]);
});

test('an already clear upper-wheel-travel pose can start a wall transition while its next true obstacle still blocks it', () => {
  for (const awning of [false, true]) {
    const actual = world({ wall: true, ordinaryGround: true, awning }),
      state = createTesla(
        [
          0,
          height + TESLA_DEFAULT_SHAPE.groundSupport.suspensionTravel,
          30 -
            TESLA_DEFAULT_SHAPE.halfExtents[2] -
            TESLA_DEFAULT_SHAPE.clearance,
        ],
        0,
        FLOOR,
      );
    // No fitting proposal is exposed here: this isolates the legal current
    // pose and the subsequent complete transition against real triangles.
    const environment = {
      support: (query) => actual.support(query),
      sweep: (query) => actual.sweep(query),
      sweepGroundDeparture: (query) => actual.sweepGroundDeparture(query),
    };
    try {
      assert(
        actual.support({
          pose: state,
          shape: TESLA_DEFAULT_SHAPE,
          maxDistance: 1.03,
          preferredSurfaceId: FLOOR.surfaceId,
          adhesion: true,
        }),
      );
      assert.equal(
        actual.sweep({ from: state, to: state, shape: TESLA_DEFAULT_SHAPE }),
        null,
      );
      stepTesla(state, { throttle: 1 }, 1 / 60, environment);
      if (awning) {
        assert.equal(state.attachment, null);
        assert.equal(state.mode, 'ground');
      } else assert(state.attachment);
    } finally {
      actual.dispose();
    }
  }
});

test('wall adhesion is armed state and parking holds exact position and full orientation without key pressure or gravity drift', () => {
  const environment = world({ wall: true });
  const s = placeTesla({ ...WALL, point: [0, 20, 30] });
  run(s, 1, { throttle: 1 }, environment);
  assert.ok(s.position[1] > 25);
  stepTesla(s, { park: true }, 1 / 60, environment);
  const parkedPosition = [...s.position],
    parkedQuaternion = [...s.quaternion];
  run(s, 8, { park: true, steer: 1 }, environment);
  assert.equal(s.parked, true);
  assert.equal(s.adhesionArmed, true);
  assert.equal(s.mode, 'wall');
  assert.deepEqual(s.position, parkedPosition);
  assert.deepEqual(s.quaternion, parkedQuaternion);
  assert.equal(speed(s), 0);
  run(s, 0.5, { throttle: 1 }, environment);
  assert.equal(s.parked, false);
  assert.ok(s.position[1] > parkedPosition[1]);
});

test('parking during the swept wall manoeuvre queues a stable arrival instead of dropping the passenger frame', () => {
  const environment = world({ wall: true }),
    s = placeTesla(FLOOR);
  for (let frame = 0; frame < 240 && !s.attachment; frame++)
    stepTesla(s, { throttle: 1 }, 1 / 60, environment);
  assert.ok(s.attachment);
  stepTesla(s, { park: true }, 1 / 60, environment);
  run(s, 3, {}, environment);
  assert.equal(s.mode, 'wall');
  assert.equal(s.parked, true);
  const position = [...s.position],
    quaternion = [...s.quaternion];
  run(s, 3, {}, environment);
  assert.deepEqual(s.position, position);
  assert.deepEqual(s.quaternion, quaternion);
});

test('an actual awning blocking the corner manoeuvre refuses wall attachment and retains the valid ground pose', () => {
  const environment = world({ wall: true, awning: true }),
    s = placeTesla(FLOOR);
  run(s, 4, { throttle: 1 }, environment);
  assert.equal(s.mode, 'ground');
  assert.equal(s.contact.surfaceId, 'floor');
  assert.equal(s.attachment, null);
  near(s.position[1], height);
  near(teslaVehicleFrame(s).up[1], 1);
  assert.ok(s.position[2] < 30);
  assertFinite(s);
});

test('disarming a parked wall releases outward before re-levelling; a held toggle cannot reattach it', () => {
  const environment = world({ wall: true });
  const s = placeTesla({ ...WALL, point: [0, 20, 30] });
  stepTesla(s, { park: true }, 1 / 60, environment);
  const initialZ = s.position[2];
  run(s, 1.5, { adhesionToggle: true }, environment);
  assert.equal(s.adhesionArmed, false);
  assert.equal(s.mode, 'air');
  assert.equal(s.parked, false);
  assert.equal(s.contact, null);
  assert.ok(s.position[2] < initialZ - 2);
  near(teslaVehicleFrame(s).up[1], 1, 0.01);
  assertFinite(s);
});

test('a wall or tree contact without adhesion permission never becomes a parking surface', () => {
  const obstacle = {
    ...WALL,
    kind: 'obstacle',
    adherable: false,
    fraction: 0.5,
  };
  const s = createTesla([0, 20, 0]);
  s.velocity = [0, 0, 20];
  const environment = { sweep: () => obstacle, support: () => null };
  stepTesla(s, { throttle: 1, park: true }, 0.1, environment);
  assert.equal(s.parked, false);
  assert.equal(s.contact, null);
  assert.equal(s.attachment, null);
  assert.equal(s.mode, 'air');
});

test('a supported roof uses its own surface identity and never teleports to the ground below', () => {
  const environment = world({ roof: true });
  const roof = {
    ...FLOOR,
    surfaceId: 'roof',
    kind: 'roof',
    point: [0, 100, 60],
  };
  const s = placeTesla(roof);
  stepTesla(s, { park: true }, 1 / 60, environment);
  run(s, 3, {}, environment);
  assert.equal(s.contact.surfaceId, 'roof');
  assert.equal(s.mode, 'ground');
  near(s.position[1], 100 + height);
  const missingRoof = world();
  const gap = { sweep: (q) => missingRoof.sweep(q), support: () => null };
  run(s, 0.5, {}, gap);
  assert.equal(s.mode, 'air');
  assert.equal(s.contact, null);
  assert.ok(s.position[1] < 100 + height);
  assert.ok(
    s.position[1] > 90,
    'missing roof support is gravity descent, not a ground snap',
  );
});

test('upright chase and full vehicle cockpit frames stay separate on every wall orientation', () => {
  for (const normal of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const s = placeTesla({ ...WALL, point: [0, 20, 0], normal }, 0.7);
    const q = [...s.quaternion],
      position = [...s.position];
    const frame = teslaVehicleFrame(s);
    assert.deepEqual(frame.chaseUp, [0, 1, 0]);
    assert.equal(frame.chaseForward[1], 0);
    near(teslaLength(frame.chaseForward), 1);
    near(teslaDot(frame.up, normal), 1);
    assert.deepEqual(frame.quaternion, q);
    frame.position[0] = 999;
    assert.deepEqual(
      s.position,
      position,
      'camera frame cannot mutate the body position',
    );
  }
});

test('parallel transport preserves the climbing tangent through floor-wall-roof and antiparallel normals', () => {
  const climbing = teslaTransportForward([0, 1, 0], [0, 0, -1], [0, 0, 1]);
  near(teslaDot(climbing, [0, 1, 0]), 1);
  const onRoof = teslaTransportForward([0, 0, -1], [0, 1, 0], climbing);
  near(teslaDot(onRoof, [0, 0, 1]), 1);
  const opposite = teslaTransportForward([0, 1, 0], [0, -1, 0], [0, 0, 1]);
  near(teslaLength(opposite), 1);
  near(teslaDot(opposite, [0, -1, 0]), 0);
  const degenerate = teslaFrame([0, 0, 1], [0, 0, 2]);
  near(teslaDot(degenerate.up, degenerate.forward), 0);
  near(Math.hypot(...degenerate.quaternion), 1);
  near(
    teslaDot(teslaRotate(degenerate.quaternion, [0, 1, 0]), degenerate.up),
    1,
  );
});

test('fixed substeps account for normal elapsed time consistently at 30, 60 and 120 Hz', () => {
  const states = [30, 60, 120].map((hz) =>
    run(
      createTesla([0, 30, 0]),
      2,
      { throttle: 1, steer: 0.3, lift: 0.4 },
      EMPTY_WORLD,
      1 / hz,
    ),
  );
  for (const s of states) {
    near(s.timeS, 2);
    assertFinite(s);
    assert.ok(distance(s.position, states[0].position) < 1e-6);
  }
  const s = createTesla([0, 30, 0]);
  const report = stepTesla(s, { throttle: 1 }, 10, EMPTY_WORLD);
  near(report.simulatedS, 0.25);
  near(report.droppedS, 9.75);
  assert.equal(report.substeps, 30);
  near(s.timeS, 0.25);
  assert.ok(distance(s.position, [0, 30, 0]) < TESLA_LIMITS.maxSpeedMps * 0.25);
});

test('world failures and malformed collisions fail closed while invalid dt leaves the state unchanged', () => {
  for (const sweep of [
    () => {
      throw new Error('unavailable');
    },
    () => ({ ...WALL, fraction: NaN }),
  ]) {
    const s = createTesla([0, 30, 0]);
    s.velocity = [0, 0, 70];
    const position = [...s.position];
    const report = stepTesla(s, { throttle: 1 }, 0.1, {
      sweep,
      support: () => null,
    });
    assert.deepEqual(s.position, position);
    assert.ok(report.environmentFailures > 0);
    assertFinite(s);
  }
  const s = createTesla([0, 30, 0]);
  const before = structuredClone(s);
  for (const dt of [NaN, Infinity, -1])
    assert.throws(
      () => stepTesla(s, {}, dt, EMPTY_WORLD),
      /Invalid Tesla simulation step/,
    );
  assert.deepEqual(s, before);
  stepTesla(
    s,
    { throttle: NaN, lift: Infinity, steer: -Infinity },
    0.1,
    EMPTY_WORLD,
  );
  assertFinite(s);
  assert.equal(speed(s), 0);
});
