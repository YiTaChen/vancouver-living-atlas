import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
} = await import(cityModule('tesla-state'));
const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/tesla-real-departure.json', import.meta.url),
  ),
);
const restoreGround = ({ initial }) => {
  assert.equal(initial.mode, 'ground');
  const state = createTesla(initial.position, initial.heading, initial.contact);
  state.quaternion = [...initial.quaternion];
  return state;
};
const actualWorld = (sample, extra = []) =>
  new TeslaWorld({
    sources: [
      fixedFacesSource('actual-local-city-patch', [
        ...sample.faces.map((face) =>
          triangleFace(
            face.surfaceId,
            face.triangleId,
            face.kind,
            face.triangle,
            face.adherable,
            face.supportGroup,
            face.normal,
          ),
        ),
        ...extra,
      ]),
    ],
  });

function attachActualFacade(world) {
  const state = restoreGround(fixture.wall);
  for (let i = 0; i < 240 && state.mode !== 'wall'; i++)
    stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
  assert.equal(state.mode, 'wall');
  return state;
}

const upY = (q) => 1 - 2 * (q[0] * q[0] + q[2] * q[2]);

test('actual Robson ground pose lifts through adjacent road triangles using public jump and held ascent', () => {
  const world = actualWorld(fixture.jump),
    state = restoreGround(fixture.jump);
  try {
    for (let i = 0; i < 180; i++)
      stepTesla(state, { jump: i === 0, lift: 1 }, 1 / 60, world, shape);
    assert.equal(state.mode, 'air');
    assert(state.position[1] - fixture.jump.initial.position[1] > 30);
    assert.equal(state.departureContact, null);
    assert.equal(state.contact, null);
  } finally {
    world.dispose();
  }
});

test('actual facade approach sweeps out of road contact, attaches to building 2281 and parks exactly for eight seconds', () => {
  const world = actualWorld(fixture.wall),
    state = restoreGround(fixture.wall);
  let beganTransition = false;
  try {
    for (let i = 0; i < 240 && state.mode !== 'wall'; i++) {
      const before = [...state.position];
      stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
      beganTransition ||= !!state.attachment;
      assert(
        Math.hypot(...state.position.map((v, k) => v - before[k])) <= 0.201,
        'corner transfer obeys the bounded swept motion speed',
      );
    }
    assert(beganTransition);
    assert.equal(state.mode, 'wall');
    assert.equal(state.contact.surfaceId, 'building:2281:wall:0:7');
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(state.parked);
    const parked = structuredClone({
      position: state.position,
      quaternion: state.quaternion,
    });
    for (let i = 0; i < 480; i++) stepTesla(state, {}, 1 / 60, world, shape);
    assert(state.parked);
    assert.deepEqual(
      { position: state.position, quaternion: state.quaternion },
      parked,
    );
  } finally {
    world.dispose();
  }
});

test('an added physical ceiling still blocks the same actual facade manoeuvre despite adjacent road suspension triangles', () => {
  const y = fixture.wall.initial.position[1] + 1;
  const a = [230, y, 130],
    b = [270, y, 130],
    c = [270, y, 170],
    d = [230, y, 170];
  const world = actualWorld(fixture.wall, [
    triangleFace(
      'test-ceiling',
      'test-ceiling:0',
      'obstacle',
      [a, b, c],
      false,
      'test-ceiling',
      [0, -1, 0],
    ),
    triangleFace(
      'test-ceiling',
      'test-ceiling:1',
      'obstacle',
      [a, c, d],
      false,
      'test-ceiling',
      [0, -1, 0],
    ),
  ]);
  const state = restoreGround(fixture.wall);
  try {
    for (let i = 0; i < 60; i++) {
      stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
      assert.equal(state.attachment, null);
      assert.equal(state.mode, 'ground');
      assert(state.position[1] < y - shape.halfExtents[1]);
    }
  } finally {
    world.dispose();
  }
});

test('actual facade top-edge exit clears the real roof before braking, hovering and returning upright', () => {
  const world = actualWorld(fixture.wall);
  try {
    const state = attachActualFacade(world);
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(state.parked);
    stepTesla(state, {}, 1 / 60, world, shape);
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(!state.parked);
    let leftWall = false,
      finalCollisions = 0;
    for (let i = 0; i < 300; i++) {
      const before = [...state.position];
      const input =
        i < 72
          ? { throttle: 1 }
          : i < 132
            ? { brake: true }
            : i === 132
              ? { park: true }
              : {};
      const result = stepTesla(state, input, 1 / 60, world, shape);
      leftWall ||= state.mode === 'air';
      assert.equal(result.environmentFailures, 0);
      assert(Math.hypot(...state.position.map((v, k) => v - before[k])) < 0.5);
      if (i >= 240) finalCollisions += result.collisions;
    }
    assert(leftWall, 'drive up the real facade until its full support ends');
    assert.equal(state.mode, 'air');
    assert.equal(state.departureContact, null);
    assert(upY(state.quaternion) > 0.999);
    assert.equal(
      finalCollisions,
      0,
      'no repeated zero-fraction collision loop',
    );
    assert.deepEqual(state.velocity, [0, 0, 0]);
  } finally {
    world.dispose();
  }
});

test('public Space release close to the real facade finishes safe withdrawal even when brake and hover follow immediately', () => {
  const world = actualWorld(fixture.wall);
  try {
    const state = attachActualFacade(world);
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(state.parked);
    const initial = [...state.position];
    const normal = [...state.contact.normal];
    for (let i = 0; i < 240; i++)
      stepTesla(
        state,
        { jump: i === 0, brake: i < 60, park: i === 1 },
        1 / 60,
        world,
        shape,
      );
    assert.equal(state.mode, 'air');
    assert.equal(state.departureContact, null);
    assert(upY(state.quaternion) > 0.999);
    assert(
      state.position.reduce(
        (sum, v, k) => sum + (v - initial[k]) * normal[k],
        0,
      ) > 2,
    );
  } finally {
    world.dispose();
  }
});

test('wall release preserves a true obstacle in its outward clearance path', () => {
  const probeWorld = actualWorld(fixture.wall);
  const probe = attachActualFacade(probeWorld);
  probeWorld.dispose();
  const contact = probe.contact,
    normal = contact.normal,
    tangent = [normal[2], 0, -normal[0]],
    distance = 1.5;
  const point = (across, y) =>
    contact.point.map(
      (v, k) =>
        v + normal[k] * distance + tangent[k] * across + (k === 1 ? y : 0),
    );
  const a = point(-8, -10),
    b = point(8, -10),
    c = point(8, 10),
    d = point(-8, 10);
  const obstacle = [
    triangleFace(
      'release-obstacle',
      'release-obstacle:0',
      'obstacle',
      [a, b, c],
      false,
    ),
    triangleFace(
      'release-obstacle',
      'release-obstacle:1',
      'obstacle',
      [a, c, d],
      false,
    ),
  ];
  const world = actualWorld(fixture.wall, obstacle);
  try {
    for (let i = 0; i < 120; i++) {
      stepTesla(probe, { jump: i === 0, brake: true }, 1 / 60, world, shape);
      const planeDistance = probe.position.reduce(
        (sum, v, k) => sum + (v - contact.point[k]) * normal[k],
        0,
      );
      assert(
        planeDistance <=
          distance - shape.halfExtents[1] - shape.clearance + 0.002,
      );
    }
    assert.equal(probe.mode, 'air');
    assert.equal(probe.collisionSurfaceId, 'release-obstacle');
    assert(
      upY(probe.quaternion) < 0.1,
      'blocked clearance keeps the safe wall frame',
    );
  } finally {
    world.dispose();
  }
});
