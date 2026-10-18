import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const height = shape.halfExtents[1] + shape.clearance;
const pose = (state) =>
  structuredClone({ position: state.position, quaternion: state.quaternion });

function fixture() {
  let groundEnabled = true,
    obstacleEnabled = false,
    upperEnabled = false;
  const ground = (id, y, enabled) => {
    const points = [
      [-30, y, -30],
      [30, y, -30],
      [30, y, 30],
      [-30, y, 30],
    ];
    return [
      [points[0], points[1], points[2]],
      [points[0], points[2], points[3]],
    ].map((triangle, i) => {
      const face = triangleFace(
        `${id}:${i}`,
        `${id}:${i}`,
        'ground',
        triangle,
        true,
        'ground:0',
        [0, 1, 0],
      );
      face.enabled = enabled;
      return face;
    });
  };
  const obstacle = triangleFace(
    'new-physical-obstacle',
    'new-physical-obstacle:0',
    'obstacle',
    [
      [0, -10, -20],
      [0, 20, -20],
      [0, 5, 20],
    ],
    false,
    'new-physical-obstacle',
    [1, 0, 0],
  );
  obstacle.enabled = () => obstacleEnabled;
  const actual = new TeslaWorld({
    sources: [
      fixedFacesSource('live-standby-geometry', [
        ...ground('ground', 0, () => groundEnabled),
        ...ground('upper', 0.02, () => upperEnabled),
        obstacle,
      ]),
    ],
  });
  const initial = { position: [0, height, 0], quaternion: [0, 0, 0, 1] },
    contact = actual.support({
      pose: initial,
      shape,
      preferredSurfaceId: 'ground:0',
      maxDistance: 1.03,
      adhesion: true,
    });
  assert(contact);
  const state = createTesla(initial.position, 0, contact),
    calls = { support: [], sweep: [], fit: [], departure: [] };
  const world = {
    support(query) {
      calls.support.push(structuredClone(query));
      return actual.support(query);
    },
    sweep(query) {
      calls.sweep.push(structuredClone(query));
      return actual.sweep(query);
    },
    fitGround(query) {
      calls.fit.push(structuredClone(query));
      return actual.fitGround(query);
    },
    sweepGroundDeparture(query) {
      calls.departure.push(structuredClone(query));
      return actual.sweepGroundDeparture(query);
    },
  };
  return {
    state,
    world,
    calls,
    actual,
    disableGround: () => (groundEnabled = false),
    addObstacle: () => (obstacleEnabled = true),
    enableUpper: () => (upperEnabled = true),
  };
}

test('a stationary ground frame re-proves its exact wheels and actual body once, without fitting or integration', () => {
  const f = fixture(),
    { state, calls, world } = f;
  try {
    state.quaternion = [0, 0, 0, 1 + Number.EPSILON];
    state.impact = 0.6;
    state.detachRemainingS = 0.1;
    const before = pose(state),
      quaternion = state.quaternion;
    const report = stepTesla(state, { brake: true }, 0.5, world, shape);
    assert.equal(report.simulatedS, 0.25);
    assert.equal(report.droppedS, 0.25);
    assert.equal(report.substeps, 0);
    assert.equal(report.collisions, 0);
    assert.equal(report.environmentFailures, 0);
    assert.equal(state.timeS, 0.25);
    assert(Math.abs(state.impact - 0.1) < 1e-12);
    assert.equal(state.detachRemainingS, 0);
    assert.deepEqual(pose(state), before);
    assert.equal(state.quaternion, quaternion);
    assert.deepEqual(state.velocity, [0, 0, 0]);
    assert.equal(calls.support.length, 1);
    assert.equal(calls.sweep.length, 1);
    assert.equal(calls.fit.length, 0);
    assert.equal(calls.support[0].preferredSurfaceId, state.contact.surfaceId);
    assert.equal(calls.sweep[0].ignoreSurfaceId, state.contact.surfaceId);
    assert.deepEqual(calls.sweep[0].from, before);
    assert.deepEqual(calls.sweep[0].to, before);
    for (let i = 0; i < 20; i++) {
      const next = stepTesla(state, { brake: true }, 1 / 15, world, shape);
      assert.equal(next.substeps, 0);
      assert.deepEqual(pose(state), before);
    }
    assert.equal(
      calls.support.length,
      21,
      'permission is re-proven each frame',
    );
    assert.equal(calls.sweep.length, 21);
    assert.equal(calls.fit.length, 0);
  } finally {
    f.actual.dispose();
  }
});

test('a disabled source or a different highest physical floor wakes the original fixed-step path', () => {
  for (const change of ['disabled', 'higher-floor']) {
    const f = fixture(),
      { state, world, calls } = f;
    try {
      assert.equal(stepTesla(state, {}, 1 / 60, world, shape).substeps, 0);
      if (change === 'disabled') f.disableGround();
      else f.enableUpper();
      const report = stepTesla(state, { brake: true }, 1 / 60, world, shape);
      assert(report.substeps > 0);
      assert(calls.fit.length > 0);
      if (change === 'disabled') {
        assert.equal(state.mode, 'air');
        assert.equal(state.groundDeparture, null);
      } else {
        assert.equal(state.mode, 'ground');
        assert(state.contact.surfaceId.startsWith('upper:'));
        assert(state.position[1] > height);
      }
    } finally {
      f.actual.dispose();
    }
  }
});

test('a newly enabled real obstacle cannot inherit a previous stationary body permission', () => {
  const f = fixture(),
    { state, world } = f;
  try {
    assert.equal(stepTesla(state, {}, 1 / 60, world, shape).substeps, 0);
    const before = pose(state);
    f.addObstacle();
    const report = stepTesla(state, { brake: true }, 1 / 15, world, shape);
    assert(report.substeps > 0);
    assert(report.collisions > 0);
    assert.equal(state.collisionSurfaceId, 'new-physical-obstacle');
    assert.deepEqual(pose(state), before);
  } finally {
    f.actual.dispose();
  }
});

test('Space wakes from stationary proof immediately and Q remains an active air control', () => {
  const f = fixture(),
    { state, world } = f;
  try {
    assert.equal(
      stepTesla(state, { brake: true }, 1 / 60, world, shape).substeps,
      0,
    );
    const report = stepTesla(
      state,
      { jump: true, lift: 1 },
      1 / 60,
      world,
      shape,
    );
    assert(report.substeps > 0);
    assert.equal(state.mode, 'air');
    assert(state.position[1] > height);
    for (let i = 0; i < 60; i++)
      stepTesla(state, { lift: 1 }, 1 / 60, world, shape);
    for (let i = 0; i < 90; i++) {
      const down = stepTesla(state, { lift: -1 }, 1 / 60, world, shape);
      assert(down.substeps > 0);
    }
    assert(state.velocity[1] < -10);
    assert.equal(state.groundDeparture, null);
  } finally {
    f.actual.dispose();
  }
});

test('support and body-query failures fall back to real substeps instead of granting standby', () => {
  for (const fail of ['support', 'sweep']) {
    const f = fixture();
    try {
      const world = {
        ...f.world,
        [fail]: () => {
          throw new Error('live geometry unavailable');
        },
      };
      const report = stepTesla(f.state, {}, 1 / 15, world, shape);
      assert(report.substeps > 0);
      assert(report.environmentFailures > 0);
      assert(f.state.position.every(Number.isFinite));
      assert.equal(f.state.groundDeparture, null);
    } finally {
      f.actual.dispose();
    }
  }
});

test('raw motion, tiny residual velocity and active transitions never enter the stationary shortcut', () => {
  const inputs = [
    { throttle: 1 },
    { steer: 1e-12 },
    { lift: -1 },
    { pitch: 1e-12 },
    { roll: 1e-12 },
    { steer: Number.NaN },
    { boost: true },
    { jump: true },
    { flightToggle: true },
    { adhesionToggle: true },
    { park: true },
  ];
  for (const raw of inputs) {
    const f = fixture();
    try {
      assert(stepTesla(f.state, raw, 1 / 60, f.world, shape).substeps > 0);
    } finally {
      f.actual.dispose();
    }
  }
  for (const active of [
    'velocity',
    'attachment',
    'departure',
    'ground-departure',
  ]) {
    const f = fixture(),
      { state } = f;
    try {
      if (active === 'velocity') state.velocity = [0, 0, 1e-12];
      if (active === 'departure')
        state.departureContact = structuredClone(state.contact);
      if (active === 'ground-departure')
        state.groundDeparture = {
          origin: pose(state),
          surfaceId: state.contact.surfaceId,
          resumeVelocity: [0, 0, 0],
          returning: false,
        };
      if (active === 'attachment')
        state.attachment = {
          contact: structuredClone(state.contact),
          waypoints: [pose(state)],
          ignoreSurfaceIds: [state.contact.surfaceId],
          index: 0,
          resumeSpeed: 0,
          parkOnArrival: false,
        };
      assert(stepTesla(state, {}, 1 / 60, f.world, shape).substeps > 0, active);
    } finally {
      f.actual.dispose();
    }
  }
});

test('a finite non-unit quaternion retains the original normalization path instead of preserving an invalid pose', () => {
  const f = fixture();
  try {
    f.state.quaternion = [0, 0, 0, 0.8];
    const report = stepTesla(f.state, {}, 1 / 60, f.world, shape);
    assert(report.substeps > 0);
    assert(Math.abs(Math.hypot(...f.state.quaternion) - 1) < 1e-12);
    assert(f.calls.fit.length > 0);
  } finally {
    f.actual.dispose();
  }
});

test('the actual far-road curb pose stays exact while stationary and public reverse or launch still escapes safely', () => {
  const saved = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-stationary-curb.json', import.meta.url),
    ),
  );
  for (const action of ['idle', 'reverse', 'launch']) {
    const actual = new TeslaWorld({
        sources: [
          fixedFacesSource(
            'actual-far-road-curb',
            saved.faces.map((f) =>
              triangleFace(
                f.surfaceId,
                f.triangleId,
                f.kind,
                f.triangle,
                f.adherable,
                f.supportGroup,
                f.normal,
              ),
            ),
          ),
        ],
      }),
      state = structuredClone(saved.initial),
      before = pose(state);
    let fitting = 0,
      collisions = 0;
    const world = {
      support: (query) => actual.support(query),
      sweep: (query) => actual.sweep(query),
      sweepGroundDeparture: (query) => actual.sweepGroundDeparture(query),
      fitGround: (query) => {
        fitting++;
        return actual.fitGround(query);
      },
    };
    try {
      for (let i = 0; i < (action === 'idle' ? 75 : 60); i++) {
        const report = stepTesla(
          state,
          action === 'idle'
            ? { brake: true }
            : action === 'reverse'
              ? { throttle: -0.2 }
              : { jump: i === 0, lift: 1 },
          action === 'idle' ? 0.067 : 1 / 60,
          world,
          saved.shape,
        );
        collisions += report.collisions;
        assert.equal(report.environmentFailures, 0);
        if (action === 'idle') {
          assert.equal(report.substeps, 0);
          assert.deepEqual(pose(state), before);
        } else assert(report.substeps > 0);
      }
      assert.equal(collisions, 0);
      assert.equal(state.attachment, null);
      assert.equal(state.groundDeparture, null);
      if (action === 'idle') {
        assert.equal(fitting, 0);
        assert.equal(state.mode, 'ground');
      } else if (action === 'reverse') {
        assert.equal(state.mode, 'ground');
        assert(
          Math.hypot(
            state.position[0] - before.position[0],
            state.position[2] - before.position[2],
          ) > 2,
        );
      } else {
        assert.equal(state.mode, 'air');
        assert(state.position[1] > before.position[1] + 15);
      }
    } finally {
      actual.dispose();
    }
  }
});
