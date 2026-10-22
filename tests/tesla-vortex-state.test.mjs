import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
  teslaVehicleFrame,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { teslaPrismSource } = await import(cityModule('tesla-city-world'));
const height = shape.halfExtents[1] + shape.clearance;
const floor = {
  surfaceId: 'ground:asphalt:stunt',
  kind: 'ground',
  point: [0, 0, 0],
  normal: [0, 1, 0],
  adherable: true,
};
const groundFaces = () => [
  triangleFace(
    floor.surfaceId,
    'stunt-road:0',
    'ground',
    [
      [-100, 0, -50],
      [100, 0, -50],
      [100, 0, 200],
    ],
    true,
    'ground:0',
    floor.normal,
  ),
  triangleFace(
    floor.surfaceId,
    'stunt-road:1',
    'ground',
    [
      [-100, 0, -50],
      [100, 0, 200],
      [-100, 0, 200],
    ],
    true,
    'ground:0',
    floor.normal,
  ),
];
const box = (id, x, z, halfX, halfZ, minY, maxY) =>
  teslaPrismSource({
    id,
    polygon: [
      [
        [x - halfX, z - halfZ],
        [x + halfX, z - halfZ],
        [x + halfX, z + halfZ],
        [x - halfX, z + halfZ],
      ],
    ],
    minY,
    maxY,
    obstacle: true,
  });
const environment = (extra = []) =>
  new TeslaWorld({
    sources: [fixedFacesSource('actual-stunt-road', groundFaces()), ...extra],
  });
const grounded = () => createTesla([0, height, 0], 0, floor);
const finite = (s) =>
  assert(
    [...s.position, ...s.velocity, ...s.quaternion].every(Number.isFinite),
  );

function currentSlopedLaunch(world, saved, lowerM = 0) {
  const fitted = world.fitGround({
    pose: saved.initial,
    shape,
    preferredSurfaceId: saved.initial.contact.surfaceId,
    maxAdjustmentM: 0.35,
  });
  assert(fitted, 'the unchanged captured road must fit all four current tyres');
  const position = fitted.pose.position.map(
    (v, i) => v - (i === 1 ? lowerM : 0),
  );
  const state = createTesla(position, saved.initial.heading, fitted.contact);
  state.quaternion = [...fitted.pose.quaternion];
  assert(
    world.support({
      pose: state,
      shape,
      preferredSurfaceId: fitted.contact.surfaceId,
      maxDistance: height + 0.35,
      adhesion: false,
    }),
    'the retargeted launch still has live physical tyre support',
  );
  return state;
}

test('V performs one fully swept barrel roll over five physical car envelopes and naturally lands without P', () => {
  const cars = [8, 13.5, 19, 24.5, 30].map((z, i) =>
    box(`physical-car:${i}`, 0, z, 1.1, 2.1, 0.05, 1.9),
  );
  const world = environment(cars),
    state = grounded();
  let maxY = state.position[1],
    roll = 0,
    previousAngle = 0,
    activeFrames = 0;
  const collisionEvents = [];
  try {
    for (let i = 0; i < 240; i++) {
      const report = stepTesla(state, { vortex: true }, 1 / 60, world, shape);
      if (report.collisions)
        collisionEvents.push({
          id: state.collisionSurfaceId,
          active: !!state.vortex,
          position: [...state.position],
        });
      assert.equal(report.environmentFailures, 0);
      maxY = Math.max(maxY, state.position[1]);
      const up = teslaVehicleFrame(state).up;
      const angle = Math.atan2(-up[0], up[1]);
      roll += Math.atan2(
        Math.sin(angle - previousAngle),
        Math.cos(angle - previousAngle),
      );
      previousAngle = angle;
      activeFrames += !!state.vortex;
      finite(state);
    }
    assert(
      collisionEvents.every(
        (event) => !event.active && event.id === floor.surfaceId,
      ),
      JSON.stringify(collisionEvents),
    );
    assert(Math.abs(maxY - height - 4.9) < 0.02);
    assert(
      Math.abs(roll - 2 * Math.PI) < 1e-6,
      `actual accumulated roll ${roll}`,
    );
    assert(activeFrames > 80 && activeFrames < 140);
    assert.equal(state.vortex, null, 'held V does not chain another stunt');
    assert.equal(state.mode, 'ground');
    assert.equal(state.contact.kind, 'ground');
    assert.equal(state.parked, false);
    assert(state.position[2] > 38);
    stepTesla(state, {}, 1 / 60, world, shape);
    stepTesla(state, { vortex: true }, 1 / 60, world, shape);
    assert(
      state.vortex,
      'a released and re-pressed V can start again without a fuel/cooldown gate',
    );
  } finally {
    world.dispose();
  }
});

test('a real ceiling or thin wall interrupts V without teleporting or acquiring a magnetic surface', () => {
  for (const kind of ['ceiling', 'wall']) {
    const obstacle =
      kind === 'ceiling'
        ? box('true-ceiling', 0, 10, 12, 30, 3, 3.02)
        : box('thin-stunt-wall', 0, 18, 8, 0.005, 0, 30);
    const world = environment([obstacle]),
      state = grounded();
    let hit = false;
    try {
      for (let i = 0; i < 180 && !hit; i++) {
        const before = [...state.position];
        const report = stepTesla(
          state,
          { vortex: i === 0 },
          1 / 60,
          world,
          shape,
        );
        assert(
          Math.hypot(...state.position.map((v, k) => v - before[k])) < 1.5,
        );
        hit ||= report.collisions > 0;
      }
      assert(hit, kind);
      assert.equal(state.vortex, null);
      assert.equal(state.attachment, null);
      assert.equal(state.flightAssist, true);
      finite(state);
    } finally {
      world.dispose();
    }
  }
});

test('a physical side barrier clear of the upright car still blocks its rotating corner', () => {
  const world = environment([
      box('roll-corner-barrier', 1.265, 20, 0.005, 17, 0, 15),
    ]),
    state = grounded();
  let hit = false;
  try {
    for (let i = 0; i < 120 && !hit; i++) {
      const before = [...state.position];
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 60,
        world,
        shape,
      );
      if (report.collisions) {
        hit = true;
        assert.equal(
          state.collisionSurfaceId.startsWith('roll-corner-barrier:'),
          true,
        );
        assert.equal(
          world.sweep({
            from: { position: before, quaternion: [0, 0, 0, 1] },
            to: { position: state.position, quaternion: [0, 0, 0, 1] },
            shape,
          }),
          null,
          'the same translation is clear when the body is upright',
        );
      }
    }
    assert(hit, 'the actual rotating chassis envelope is collision tested');
    assert.equal(state.vortex, null);
    assert.equal(state.attachment, null);
  } finally {
    world.dispose();
  }
});

test('B, fresh Space, P and F cancel an active roll without snapping its full orientation', () => {
  for (const input of [
    { brake: true },
    { jump: true },
    { park: true },
    { flightToggle: true },
  ]) {
    const world = environment(),
      state = grounded();
    try {
      stepTesla(state, { vortex: true }, 1 / 60, world, shape);
      for (let i = 0; i < 40; i++) stepTesla(state, {}, 1 / 60, world, shape);
      assert(state.vortex && !state.vortexPreparing);
      const q = [...state.quaternion];
      stepTesla(state, input, 1 / 120, world, shape);
      assert.equal(state.vortex, null);
      assert.equal(state.vortexPreparing, false);
      assert(
        Math.abs(
          q.reduce((sum, value, i) => sum + value * state.quaternion[i], 0),
        ) > 0.99,
        'normal assisted orientation converges without a snap',
      );
      finite(state);
    } finally {
      world.dispose();
    }
  }
});

test('the actual sloped Robson launch obeys strict departure before its roll clock advances', () => {
  const saved = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-real-departure.json', import.meta.url),
    ),
  ).jump;
  const faces = saved.faces.map((f) =>
    triangleFace(
      f.surfaceId,
      f.triangleId,
      f.kind,
      f.triangle,
      f.adherable,
      f.supportGroup,
      f.normal,
    ),
  );
  const world = new TeslaWorld({
    sources: [fixedFacesSource('actual-graded-launch', faces)],
  });
  const state = currentSlopedLaunch(world, saved);
  let strictCalls = 0,
    sawRoll = false;
  const departure = world.sweepGroundDeparture.bind(world);
  world.sweepGroundDeparture = (query) => {
    strictCalls++;
    assert.equal(state.vortex.elapsedS, 0);
    return departure(query);
  };
  try {
    for (let i = 0; i < 120; i++) {
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 60,
        world,
        shape,
      );
      assert.equal(report.environmentFailures, 0);
      if (state.groundDeparture) assert.equal(state.vortex.elapsedS, 0);
      if (state.vortex?.elapsedS > 0.2) sawRoll = true;
      finite(state);
    }
    assert(strictCalls > 0);
    assert(sawRoll);
    assert.equal(state.groundDeparture, null);
    assert.equal(state.vortex, null);
  } finally {
    world.dispose();
  }
});

test('a physical ceiling in the first strict withdrawal cancels V and freshly returns to its actual origin', () => {
  const saved = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-real-departure.json', import.meta.url),
    ),
  ).jump;
  const faces = saved.faces.map((f) =>
    triangleFace(
      f.surfaceId,
      f.triangleId,
      f.kind,
      f.triangle,
      f.adherable,
      f.supportGroup,
      f.normal,
    ),
  );
  const floorWorld = new TeslaWorld({
    sources: [fixedFacesSource('actual-launch-floor', faces)],
  });
  const state = currentSlopedLaunch(floorWorld, saved);
  floorWorld.dispose();
  const origin = [...state.position];
  const { up, forward } = teslaVehicleFrame(state);
  const rightY =
    2 *
    (state.quaternion[0] * state.quaternion[1] +
      state.quaternion[3] * state.quaternion[2]);
  const top =
    state.position[1] +
    Math.abs(rightY) * shape.halfExtents[0] +
    Math.abs(up[1]) * shape.halfExtents[1] +
    Math.abs(forward[1]) * shape.halfExtents[2] +
    shape.clearance;
  const ceiling = box(
    'first-withdrawal-ceiling',
    state.position[0],
    state.position[2],
    10,
    10,
    top + 0.03,
    top + 0.05,
  );
  const world = new TeslaWorld({
    sources: [fixedFacesSource('actual-launch-floor', faces), ceiling],
  });
  let collisions = 0;
  try {
    for (let i = 0; i < 120; i++) {
      collisions += stepTesla(
        state,
        { vortex: true },
        1 / 60,
        world,
        shape,
      ).collisions;
      assert(!state.vortex || state.vortex.elapsedS === 0);
    }
    assert(collisions > 0);
    assert.equal(state.vortex, null);
    assert.equal(state.vortexPreparing, false);
    assert.equal(state.groundDeparture, null);
    assert.equal(state.mode, 'ground');
    assert(Math.hypot(...state.position.map((v, i) => v - origin[i])) < 0.03);
  } finally {
    world.dispose();
  }
});

test('B or P during strict V preparation returns safely; a removed floor cancels rather than keeping V busy', () => {
  for (const variant of ['brake', 'park', 'disabled']) {
    const saved = JSON.parse(
      readFileSync(
        new URL('./fixtures/tesla-real-departure.json', import.meta.url),
      ),
    ).jump;
    let enabled = true;
    const faces = saved.faces.map((f) => {
      const face = triangleFace(
        f.surfaceId,
        f.triangleId,
        f.kind,
        f.triangle,
        f.adherable,
        f.supportGroup,
        f.normal,
      );
      face.enabled = () => enabled;
      return face;
    });
    const world = new TeslaWorld({
      sources: [fixedFacesSource('actual-launch-floor', faces)],
    });
    const state = currentSlopedLaunch(world, saved, 0.02);
    try {
      stepTesla(state, { vortex: true }, 0.001, world, shape);
      assert(state.vortexPreparing && state.groundDeparture);
      if (variant === 'disabled') enabled = false;
      for (let i = 0; i < 90; i++)
        stepTesla(
          state,
          variant === 'disabled' ? {} : { [variant]: i === 0 },
          1 / 60,
          world,
          shape,
        );
      assert.equal(state.vortex, null);
      assert.equal(state.vortexPreparing, false);
      assert.equal(state.groundDeparture, null);
      if (variant !== 'disabled') assert.equal(state.mode, 'ground');
      finite(state);
    } finally {
      world.dispose();
    }
  }
});
