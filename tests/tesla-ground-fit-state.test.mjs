import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { createTesla, stepTesla } = await import(cityModule('tesla-state'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const {
  TESLA_ROADSTER_GROUND_SUPPORT: modelSupport,
  TESLA_ROADSTER_DIMENSIONS: dimensions,
} = await import(cityModule('assets/tesla-roadster-contract'));
const shape = createTeslaRoadsterShape();
const rideHeight = shape.halfExtents[1] + shape.clearance;
const floor = {
  surfaceId: 'actual-ground',
  kind: 'ground',
  point: [0, 0, 0],
  normal: [0, 1, 0],
  adherable: true,
};
const grounded = () =>
  createTesla([0, shape.halfExtents[1] + shape.clearance, 0], 0, floor);
const pose = (state) =>
  structuredClone({ position: state.position, quaternion: state.quaternion });

// These adapters isolate state authority/bounds. Actual geometry and route
// proofs live in the world and frozen canonical-city regression suites.
const adapter = (fitGround, extra = {}) => ({
  fitGround,
  support: () => structuredClone(floor),
  sweep: () => null,
  ...extra,
});

test('the runtime shape maps the authored tyre-plane points once and shares conservative body metadata', () => {
  assert.deepEqual(shape.halfExtents, dimensions.halfExtents);
  assert.deepEqual(
    shape.groundSupport.wheelContacts,
    modelSupport.wheelContacts.map((p) => [
      p[0],
      p[1] - (dimensions.halfExtents[1] + shape.clearance),
      p[2],
    ]),
  );
  assert.equal(
    shape.groundSupport.chassisClearance,
    modelSupport.chassisClearance,
  );
  assert.equal(
    shape.groundSupport.suspensionTravel,
    modelSupport.suspensionTravel,
  );
  assert.equal(shape.groundSupport.wheelRadius, dimensions.wheelRadius);
  assert.deepEqual(shape.groundSupport.bodySections, modelSupport.bodySections);
  const second = createTeslaRoadsterShape();
  assert.notEqual(shape, second);
  assert.notEqual(
    shape.groundSupport.wheelContacts,
    second.groundSupport.wheelContacts,
  );
  assert.throws(() => createTeslaRoadsterShape(Number.NaN));
});

test('invalid body-section metadata cannot leave an unmodelled gap in ordinary-ground collision', () => {
  const state = grounded(),
    before = pose(state),
    invalidShape = {
      ...shape,
      groundSupport: {
        ...shape.groundSupport,
        bodySections: [
          { minZ: -shape.halfExtents[2], maxZ: 0, clearance: 0.08 },
        ],
      },
    };
  assert.throws(() =>
    stepTesla(
      state,
      {},
      1 / 60,
      adapter(() => null),
      invalidShape,
    ),
  );
  assert.deepEqual(pose(state), before);
});

test('an invalid circular tread radius cannot enlarge the authored wheel contact region', () => {
  for (const wheelRadius of [0, -0.35, 1, Infinity, Number.NaN]) {
    const state = grounded(),
      before = structuredClone(state),
      invalidShape = {
        ...shape,
        groundSupport: { ...shape.groundSupport, wheelRadius },
      };
    assert.throws(() =>
      stepTesla(
        state,
        {},
        1 / 60,
        adapter(() => null),
        invalidShape,
      ),
    );
    assert.deepEqual(state, before);
  }
});

test('a fitted driving attitude remains separate from the actual contact normal and parked poses stay exact', () => {
  const state = grounded(),
    angle = 0.02,
    q = [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  let fits = 0;
  const world = adapter((query) => {
    fits++;
    return {
      pose: {
        position: [query.pose.position[0], 0.7, query.pose.position[2]],
        quaternion: q,
      },
      contact: floor,
    };
  });
  for (let i = 0; i < 60; i++)
    stepTesla(state, { throttle: 0.2 }, 1 / 60, world, shape);
  assert.equal(state.mode, 'ground');
  assert.deepEqual(state.contact.normal, [0, 1, 0]);
  assert(Math.abs(state.quaternion[0] - q[0]) < 1e-8);
  assert(
    Math.abs(state.position[1] - 0.7) < 1e-8,
    'physical contact normal must not flatten the fitted ride height',
  );
  stepTesla(state, { park: true }, 1 / 60, world, shape);
  const parked = pose(state),
    calls = fits;
  for (let i = 0; i < 120; i++) stepTesla(state, {}, 1 / 60, world, shape);
  assert.deepEqual(pose(state), parked);
  assert.equal(
    fits,
    calls,
    'a parked vehicle does not keep adjusting its frame',
  );
});

test('the desired high-speed endpoint is fitted and validated before any wheel pose is applied', () => {
  const state = grounded();
  state.velocity = [0, 0, 74];
  const height = (z) => (z > 0.3 ? rideHeight + 0.1 : rideHeight);
  const world = adapter(
    (query) => ({
      pose: {
        position: [
          query.pose.position[0],
          height(query.pose.position[2]),
          query.pose.position[2],
        ],
        quaternion: [0, 0, 0, 1],
      },
      contact: floor,
    }),
    {
      support: (query) =>
        Math.abs(query.pose.position[1] - height(query.pose.position[2])) < 1e-8
          ? structuredClone(floor)
          : null,
    },
  );
  const report = stepTesla(state, { throttle: 1 }, 1 / 120, world, shape);
  assert.equal(report.collisions, 0);
  assert.equal(state.mode, 'ground');
  assert.equal(state.attachment, null);
  assert(state.position[2] > 0.6);
  assert(Math.abs(state.position[1] - (rideHeight + 0.1)) < 1e-8);
});

test('current and destination fitting share one bounded correction budget per substep', () => {
  const state = grounded();
  const world = adapter((query) => ({
    pose: {
      position: [
        query.pose.position[0],
        rideHeight + 0.32,
        query.pose.position[2],
      ],
      quaternion: [0, 0, 0, 1],
    },
    contact: floor,
  }));
  stepTesla(state, { steer: 1 }, 1 / 120, world, shape);
  assert(
    Math.abs(state.position[1] - (rideHeight + 0.1)) < 1e-8,
    'two fit calls cannot double the 12m/s correction allowance',
  );
});

test('a proposal cannot bypass an actual obstacle or an unproven intermediate pose', () => {
  for (const blockedBy of ['obstacle', 'intermediate']) {
    const state = grounded(),
      before = pose(state);
    const world = adapter(
      () => ({
        pose: { position: [0, rideHeight + 0.32, 0], quaternion: [0, 0, 0, 1] },
        contact: floor,
      }),
      {
        support: (query) =>
          blockedBy === 'intermediate' &&
          query.pose.position[1] > rideHeight + 0.01 &&
          query.pose.position[1] < rideHeight + 0.31
            ? null
            : structuredClone(floor),
        sweep: (query) =>
          blockedBy === 'obstacle' &&
          query.to.position[1] > query.from.position[1] + 1e-8
            ? {
                surfaceId: 'physical-ceiling',
                kind: 'obstacle',
                point: [0, rideHeight + 0.07, 0],
                normal: [0, -1, 0],
                adherable: false,
                fraction: 0,
              }
            : null,
      },
    );
    stepTesla(state, { steer: 1 }, 1 / 120, world, shape);
    assert.deepEqual(pose(state), before, blockedBy);
    assert.equal(state.mode, 'ground');
  }
});

test('malformed or non-ground fitted poses fail closed and cannot take vehicle ownership', () => {
  const invalid = [
    {
      pose: { position: [0, Number.NaN, 0], quaternion: [0, 0, 0, 1] },
      contact: floor,
    },
    { pose: { position: [0, 2, 0], quaternion: [0, 0, 0, 1] }, contact: floor },
    {
      pose: { position: [0, rideHeight, 0], quaternion: [0, 0, 0, 0] },
      contact: floor,
    },
    {
      pose: { position: [0, rideHeight, 0], quaternion: [0, 1, 0, 0] },
      contact: floor,
    },
    {
      pose: { position: [0, rideHeight, 0], quaternion: [0, 0, 0, 1] },
      contact: { ...floor, kind: 'roof' },
    },
  ];
  for (const result of invalid) {
    const state = grounded(),
      before = pose(state);
    const report = stepTesla(
      state,
      { steer: 1 },
      1 / 120,
      adapter(() => result),
      shape,
    );
    assert(report.environmentFailures > 0);
    assert.deepEqual(pose(state), before);
    assert.equal(state.mode, 'ground');
    assert.equal(state.attachment, null);
  }
});

test('a modelled-ground departure holds XZ and orientation until the entire air hull is clear, even with brake or park', () => {
  for (const command of ['brake', 'park']) {
    const state = grounded(),
      origin = pose(state),
      withdrawals = [];
    state.velocity = [0, 0, 25];
    const world = adapter(() => null, {
      sweep: (query) =>
        query.ignoreSurfaceId !== floor.surfaceId &&
        query.from.position[1] < rideHeight + 0.18
          ? { ...floor, fraction: 0 }
          : null,
      sweepGroundDeparture: (query) => {
        withdrawals.push(structuredClone(query));
        assert.deepEqual(query.origin, origin);
        assert.equal(query.sourceSurfaceId, floor.surfaceId);
        assert.equal(query.ignoreSurfaceId, undefined);
        for (const p of [query.from, query.to]) {
          assert.equal(p.position[0], origin.position[0]);
          assert.equal(p.position[2], origin.position[2]);
          assert.deepEqual(p.quaternion, origin.quaternion);
          assert(p.position[1] <= origin.position[1] + 0.35 + 1e-9);
        }
        assert(query.to.position[1] > query.from.position[1]);
        assert(query.to.position[1] - query.from.position[1] <= 0.1 + 1e-9);
        return null;
      },
    });
    const report = stepTesla(
      state,
      { jump: true, [command]: true, steer: 1 },
      1 / 60,
      world,
      shape,
    );
    assert.equal(report.environmentFailures, 0);
    assert.equal(report.collisions, 0);
    assert.equal(withdrawals.length, 2);
    assert.equal(state.mode, 'air');
    assert(state.position[1] >= rideHeight + 0.18);
    assert.equal(state.position[0], origin.position[0]);
    assert.equal(state.position[2], origin.position[2]);
    assert.deepEqual(state.quaternion, origin.quaternion);
    assert.equal(state.groundDeparture, null);
    assert.deepEqual(state.velocity, [0, 0, 0]);
  }
});

test('a failed special departure query stays blocked and cannot fall back to normal air movement', () => {
  for (const failure of ['throw', 'fraction']) {
    const state = grounded(),
      before = pose(state);
    const world = adapter(() => null, {
      sweep: (query) =>
        query.ignoreSurfaceId === floor.surfaceId
          ? null
          : { ...floor, fraction: 0 },
      sweepGroundDeparture: () => {
        if (failure === 'throw') throw new Error('unavailable source');
        return { ...floor, fraction: Number.NaN };
      },
    });
    const report = stepTesla(
      state,
      { jump: true, throttle: 1, lift: 1, steer: 1 },
      1 / 60,
      world,
      shape,
    );
    assert(report.environmentFailures > 0);
    assert(report.collisions > 0);
    assert.deepEqual(pose(state), before);
    assert.equal(state.mode, 'air');
    assert.equal(state.groundDeparture, null);
    assert.deepEqual(state.velocity, [0, 0, 0]);
  }
});

test('automatic loss of support never creates a launch guard that can hold ordinary air controls', () => {
  const state = grounded();
  let sourceAvailable = true,
    departureQueries = 0;
  const world = adapter(() => null, {
    support: () => (sourceAvailable ? floor : null),
    sweep: () => null,
    sweepGroundDeparture: () => {
      departureQueries++;
      throw new Error('a missing source cannot authorize departure');
    },
  });
  sourceAvailable = false;
  stepTesla(state, { lift: 1 }, 1 / 60, world, shape);
  assert.equal(state.mode, 'air');
  assert.equal(state.groundDeparture, null);
  assert.equal(departureQueries, 0);
  const height = state.position[1];
  for (let i = 0; i < 6; i++)
    stepTesla(state, { lift: 1, throttle: 1 }, 0.1, world, shape);
  assert(state.position[1] > height);
  assert(state.position[2] > 0);
  assert.equal(departureQueries, 0);
});

test('explicit descent reverses a blocked launch only through a freshly re-proven same-XZ segment', () => {
  const state = grounded(),
    origin = pose(state),
    calls = [];
  const ceiling = {
    surfaceId: 'actual-overhead',
    kind: 'obstacle',
    point: [0, 1.5, 0],
    normal: [0, -1, 0],
    adherable: false,
    fraction: 0,
  };
  const world = adapter(() => null, {
    sweep: (query) =>
      query.ignoreSurfaceId === floor.surfaceId
        ? null
        : { ...floor, fraction: 0 },
    sweepGroundDeparture: (query) => {
      calls.push(structuredClone(query));
      assert.deepEqual(query.origin, origin);
      assert(query.to.position[1] >= query.from.position[1]);
      return query.to.position[1] > rideHeight + 0.15 ? ceiling : null;
    },
  });
  stepTesla(state, { jump: true, lift: 1 }, 1 / 60, world, shape);
  assert.equal(state.mode, 'air');
  assert(state.groundDeparture);
  assert(Math.abs(state.position[1] - (rideHeight + 0.1)) < 1e-9);
  const blocked = pose(state);
  stepTesla(state, { lift: -1 }, 1 / 120, world, shape);
  assert.deepEqual(pose(state), origin);
  assert.equal(state.mode, 'ground');
  assert.equal(state.groundDeparture, null);
  assert.deepEqual(state.velocity, [0, 0, 0]);
  assert.deepEqual(calls.at(-1).from, origin);
  assert.deepEqual(calls.at(-1).to, blocked);
});
