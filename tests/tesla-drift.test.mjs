import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTesla,
  placeTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { teslaRotate, teslaDot } = await import(cityModule('tesla-math'));
const height = shape.halfExtents[1] + shape.clearance;
const floor = {
  surfaceId: 'road-floor',
  kind: 'ground',
  point: [0, 0, 0],
  normal: [0, 1, 0],
  adherable: true,
};
function road({ wallX, group = 'ground:0' } = {}) {
  const corners = [
    [-500, 0, -500],
    [500, 0, -500],
    [500, 0, 500],
    [-500, 0, 500],
  ];
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) =>
    triangleFace(
      'road-floor',
      `road:${i}`,
      'ground',
      indices.map((n) => corners[n]),
      true,
      group,
      [0, 1, 0],
    ),
  );
  if (wallX !== undefined) {
    const vertices = [
      [wallX, -1, -500],
      [wallX, 4, -500],
      [wallX, 4, 500],
      [wallX, -1, 500],
    ];
    for (const [i, indices] of [
      [0, [0, 1, 2]],
      [1, [0, 2, 3]],
    ])
      faces.push(
        triangleFace(
          'solid-side-barrier',
          `side:${String(i)}`,
          'obstacle',
          indices.map((n) => vertices[n]),
          false,
          'solid-side-barrier',
          [Math.sign(-wallX), 0, 0],
        ),
      );
  }
  return new TeslaWorld({
    sources: [fixedFacesSource('physical-drift-road', faces)],
    modelGroundGroups: group === 'ground:0' ? [] : [group],
  });
}
function start(world, speed = 30) {
  const pose = { position: [0, height, 0], quaternion: [0, 0, 0, 1] };
  const contact = world.support({
    pose,
    shape,
    maxDistance: height + 0.35,
    adhesion: false,
  });
  assert(contact);
  const state = createTesla(pose.position, 0, contact);
  state.velocity = [0, 0, speed];
  return state;
}
function run(state, seconds, input, world, dt = 1 / 60) {
  let collisions = 0;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    const report = stepTesla(
      state,
      input,
      Math.min(dt, seconds - elapsed),
      world,
      shape,
    );
    assert.equal(report.environmentFailures, 0);
    collisions += report.collisions;
  }
  return collisions;
}
const angle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
const velocityYaw = (state) => Math.atan2(state.velocity[0], state.velocity[2]);
const seedSlide = (state) => {
  state.drift = { slipAngle: -0.4, engagement: 1, active: true };
  state.velocity = [-Math.sin(0.4) * 30, 0, Math.cos(0.4) * 30];
};

test('optional drift input preserves exact legacy/no-drift trajectories and low-speed controls do not initiate a slide', () => {
  const world = road();
  try {
    const a = start(world),
      b = start(world);
    run(a, 0.5, { throttle: 0.4, steer: 0.3 }, world);
    run(b, 0.5, { throttle: 0.4, steer: 0.3, drift: false }, world);
    assert.deepEqual(a, b);
    for (const speed of [0, 2, -8]) {
      const state = start(world, speed);
      run(state, 0.1, { drift: true, steer: 0.5 }, world);
      assert.deepEqual(state.drift, {
        slipAngle: 0,
        engagement: 0,
        active: false,
      });
    }
  } finally {
    world.dispose();
  }
});

test('road drifting moves along a different accepted direction from the bonnet, retaining tangential momentum', () => {
  for (const group of ['ground:0', 'protected:park-motor-bridge:2']) {
    const world = road({ group });
    let successfulFits = 0;
    const fit = world.fitGround.bind(world);
    world.fitGround = (query) => {
      const result = fit(query);
      if (result) successfulFits++;
      return result;
    };
    try {
      const state = start(world);
      assert.equal(
        run(state, 0.8, { steer: 0.45, drift: true, throttle: 0.2 }, world),
        0,
      );
      assert.equal(state.mode, 'ground');
      assert(
        successfulFits > 0,
        'the actual fitted-destination branch retains lateral velocity',
      );
      assert(state.drift.slipAngle < -0.12, JSON.stringify(state.drift));
      assert(Math.abs(state.drift.slipAngle) <= (32 * Math.PI) / 180);
      assert(
        Math.abs(
          angle(velocityYaw(state) - state.heading) - state.drift.slipAngle,
        ) < 1e-6,
      );
      assert(
        Math.hypot(...state.velocity) > 22,
        'a heading projection must not drain the slide on every substep',
      );
      assert(
        state.position[2] > 15,
        'this is translated motion, not only a visual chassis rotation',
      );
      assert(
        world.support({
          pose: state,
          shape,
          maxDistance: height + 0.35,
          preferredSurfaceId: state.contact.surfaceId,
          adhesion: false,
        }),
      );
      assert.equal(
        world.sweep({
          from: state,
          to: state,
          shape,
          ignoreSurfaceId: state.contact.surfaceId,
        }),
        null,
      );
    } finally {
      world.dispose();
    }
  }
});

test('releasing drift recovers grip smoothly and braking ends the slide without a propulsion gain', () => {
  const world = road();
  try {
    const state = start(world);
    run(state, 0.6, { steer: 0.5, drift: true }, world);
    const before = state.drift.slipAngle,
      speed = Math.hypot(...state.velocity);
    stepTesla(state, {}, 1 / 120, world, shape);
    assert(Math.abs(state.drift.slipAngle) > Math.abs(before) * 0.7);
    assert(Math.abs(state.drift.slipAngle) < Math.abs(before));
    run(state, 1, {}, world);
    assert(Math.abs(state.drift.slipAngle) < 0.0001);
    assert(Math.hypot(...state.velocity) < speed);
    assert(Math.hypot(...state.velocity) > speed * 0.6);
    seedSlide(state);
    stepTesla(state, { drift: true, brake: true }, 1 / 60, world, shape);
    assert.deepEqual(state.drift, {
      slipAngle: 0,
      engagement: 0,
      active: false,
    });
    assert(Math.hypot(...state.velocity) < 30);
  } finally {
    world.dispose();
  }
});

test('lateral drift is swept against the real complete body and a solid side barrier remains blocking', () => {
  const wallX = -2.3,
    world = road({ wallX });
  try {
    const state = start(world);
    seedSlide(state);
    assert(run(state, 0.25, { drift: true }, world) > 0);
    assert(
      state.position[0] >= wallX + shape.halfExtents[0] - 0.01,
      JSON.stringify(state.position),
    );
    assert.equal(state.mode, 'ground');
    assert.equal(state.attachment, null);
    assert.deepEqual(state.drift, {
      slipAngle: 0,
      engagement: 0,
      active: false,
    });
    assert.equal(
      world.sweep({
        from: state,
        to: state,
        shape,
        ignoreSurfaceId: state.contact.surfaceId,
      }),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('launch, contact loss, parking, roofs and walls clear or ignore ground drift', () => {
  const world = road();
  try {
    const state = start(world);
    seedSlide(state);
    stepTesla(
      state,
      { jump: true, lift: 1, drift: true },
      1 / 60,
      world,
      shape,
    );
    assert.equal(state.mode, 'air');
    assert.deepEqual(state.drift, {
      slipAngle: 0,
      engagement: 0,
      active: false,
    });
    const lost = start(world);
    seedSlide(lost);
    stepTesla(
      lost,
      { drift: true },
      1 / 60,
      { support: () => null, sweep: () => null },
      shape,
    );
    assert.equal(lost.mode, 'air');
    assert.deepEqual(lost.drift, {
      slipAngle: 0,
      engagement: 0,
      active: false,
    });
    const parked = start(world);
    seedSlide(parked);
    stepTesla(parked, { park: true, drift: true }, 1 / 60, world, shape);
    const pose = structuredClone({
      position: parked.position,
      quaternion: parked.quaternion,
    });
    run(parked, 0.2, { drift: true }, world);
    assert.equal(parked.parked, true);
    assert.deepEqual(
      { position: parked.position, quaternion: parked.quaternion },
      pose,
    );
    assert.deepEqual(parked.drift, {
      slipAngle: 0,
      engagement: 0,
      active: false,
    });
    for (const contact of [
      { ...floor, surfaceId: 'roof', kind: 'roof' },
      {
        ...floor,
        surfaceId: 'wall',
        kind: 'wall',
        normal: [0, 0, -1],
        point: [0, 10, 30],
      },
    ]) {
      const a = placeTesla(contact),
        b = placeTesla(contact);
      const forward = teslaRotate(a.quaternion, [0, 0, 1]);
      a.velocity = b.velocity = forward.map((v) => v * 15);
      const adapter = { support: () => contact, sweep: () => null };
      run(a, 0.1, { steer: 0.2, drift: true }, adapter);
      run(b, 0.1, { steer: 0.2 }, adapter);
      assert.deepEqual(a, b, contact.kind);
      assert.equal(
        teslaDot(a.velocity, teslaRotate(a.quaternion, [0, 0, 1])) > 0,
        true,
      );
    }
  } finally {
    world.dispose();
  }
});

test('30Hz and120Hz render steps run the same bounded drift movement and the same collision authority', () => {
  const world = road();
  try {
    const a = start(world),
      b = start(world);
    assert.equal(
      run(a, 1, { throttle: 0.2, steer: 0.35, drift: true }, world, 1 / 30),
      0,
    );
    assert.equal(
      run(b, 1, { throttle: 0.2, steer: 0.35, drift: true }, world, 1 / 120),
      0,
    );
    assert(Math.hypot(...a.position.map((v, i) => v - b.position[i])) < 1e-6);
    assert(Math.abs(a.drift.slipAngle - b.drift.slipAngle) < 1e-7);
    assert(
      Math.abs(Math.hypot(...a.velocity) - Math.hypot(...b.velocity)) < 1e-7,
    );
  } finally {
    world.dispose();
  }
});
