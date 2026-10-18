import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { stepTesla } = await import(cityModule('tesla-state'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/tesla-stanley-park.json', import.meta.url)),
);
const shape = createTeslaRoadsterShape();
assert.deepEqual(
  shape,
  fixture.shape,
  'use the same authored tyres and body clearances',
);
function actualWorld(item) {
  return new TeslaWorld({
    sources: [
      fixedFacesSource(
        'canonical-Stanley-Park',
        item.faces.map((f) =>
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
  });
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function freshInitial(item, world) {
  const state = structuredClone(item.initial);
  const proof = world.support({
    pose: state,
    shape,
    maxDistance: 1.03,
    preferredSurfaceId: state.contact.surfaceId,
    adhesion: true,
  });
  assert.equal(
    proof?.surfaceId,
    state.contact.surfaceId,
    'saved ground ownership still requires a fresh actual full-footprint proof',
  );
  assert.equal(
    world.sweep({
      from: state,
      to: state,
      shape,
      ignoreSurfaceId: proof.surfaceId,
    }),
    null,
  );
  return state;
}
function stopReverseResume(item, world, state) {
  for (let i = 0; i < 60; i++) {
    const report = stepTesla(state, { brake: true }, 1 / 60, world, shape);
    assert.equal(report.environmentFailures, 0);
  }
  assert.equal(state.mode, 'ground');
  assert(
    state.velocity.every((v) => v === 0),
    'all physical velocity components stop',
  );
  const stopped = {
    position: [...state.position],
    quaternion: [...state.quaternion],
  };
  for (let i = 0; i < 60; i++) {
    const report = stepTesla(state, {}, 1 / 60, world, shape);
    assert.equal(report.collisions, 0);
    assert.equal(report.environmentFailures, 0);
  }
  assert.deepEqual(
    state.position,
    stopped.position,
    'stop remains exact while actual support is fresh',
  );
  assert.deepEqual(state.quaternion, stopped.quaternion);
  for (let i = 0; i < 60; i++) {
    const report = stepTesla(state, { throttle: -0.12 }, 1 / 60, world, shape);
    assert.equal(report.environmentFailures, 0);
    assert.equal(
      report.collisions,
      0,
      `${item.seed.id}: reverse keeps its actual obstacle proof`,
    );
  }
  assert.equal(state.mode, 'ground');
  assert(distance(state.position, stopped.position) > 1);
  const reversed = state.position.slice();
  for (let i = 0; i < 60; i++)
    stepTesla(state, { brake: true }, 1 / 60, world, shape);
  for (let i = 0; i < 60; i++) {
    const report = stepTesla(state, { throttle: 0.12 }, 1 / 60, world, shape);
    assert.equal(report.environmentFailures, 0);
    assert.equal(report.collisions, 0);
  }
  assert.equal(state.mode, 'ground');
  assert(
    distance(state.position, reversed) > 0.5,
    'ordinary throttle resumes after a real stop/reverse',
  );
}

test('actual Stanley Park Drive segments retain full ground ownership while driving, stopping, reversing and resuming', () => {
  const roads = fixture.cases.filter((c) => c.seed.kind === 'road');
  assert(roads.length >= 2);
  for (const item of roads) {
    const world = actualWorld(item);
    try {
      const state = freshInitial(item, world),
        initial = state.position.slice();
      for (let i = 0; i < 360 && distance(state.position, initial) < 20; i++) {
        const report = stepTesla(
          state,
          { throttle: 0.12 },
          1 / 60,
          world,
          shape,
        );
        assert.equal(report.environmentFailures, 0);
        assert.equal(report.collisions, 0, item.seed.id);
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
      }
      assert(distance(state.position, initial) > 20);
      stopReverseResume(item, world, state);
    } finally {
      world.dispose();
    }
  }
});

test('the actual Stanley Park Seawall crosses gentle adjoining triangles in both directions across render partitions', () => {
  const item = fixture.cases.find((c) => c.seed.kind === 'path');
  assert(item);
  for (const dt of [1 / 60, 1 / 30, 0.067]) {
    const world = actualWorld(item);
    try {
      const state = freshInitial(item, world),
        initial = state.position.slice();
      for (
        let elapsed = 0;
        elapsed < 6 && distance(state.position, initial) < 15;
        elapsed += dt
      ) {
        const report = stepTesla(state, { throttle: 0.12 }, dt, world, shape);
        assert.equal(report.environmentFailures, 0);
        assert.equal(
          report.collisions,
          0,
          `actual path forward dt${dt}: ${state.collisionSurfaceId}`,
        );
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
      }
      assert(distance(state.position, initial) >= 15);
      for (let elapsed = 0; elapsed < 1; elapsed += dt)
        stepTesla(state, { brake: true }, dt, world, shape);
      assert(state.velocity.every((v) => v === 0));
      const turnaround = state.position.slice();
      for (
        let elapsed = 0;
        elapsed < 6 && distance(state.position, turnaround) < 15;
        elapsed += dt
      ) {
        const report = stepTesla(state, { throttle: -0.12 }, dt, world, shape);
        assert.equal(report.environmentFailures, 0);
        assert.equal(
          report.collisions,
          0,
          `actual path reverse dt${dt}: ${state.collisionSurfaceId}`,
        );
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
      }
      assert(distance(state.position, turnaround) >= 15);
      stopReverseResume(item, world, state);
    } finally {
      world.dispose();
    }
  }
});

test('actual park turf keeps tree trunks and low crowns physical and still permits reversing away', () => {
  const turf = fixture.cases.filter((c) => c.seed.kind === 'turf');
  assert(turf.length >= 2);
  for (const item of turf) {
    const world = actualWorld(item);
    try {
      const state = freshInitial(item, world);
      let treeHit = false;
      for (let i = 0; i < 360; i++) {
        const report = stepTesla(
          state,
          { throttle: 0.12 },
          1 / 60,
          world,
          shape,
        );
        assert.equal(report.environmentFailures, 0);
        if (
          report.collisions &&
          state.collisionSurfaceId?.startsWith('tree:')
        ) {
          treeHit = true;
          break;
        }
      }
      assert(
        treeHit,
        'a tree source is a real obstacle, not a tyre-fit seam to ignore',
      );
      for (let i = 0; i < 60; i++)
        stepTesla(state, { brake: true }, 1 / 60, world, shape);
      const stopped = state.position.slice();
      for (let i = 0; i < 60; i++) {
        const report = stepTesla(
          state,
          { throttle: -0.12 },
          1 / 60,
          world,
          shape,
        );
        assert.equal(report.collisions, 0);
        assert.equal(report.environmentFailures, 0);
      }
      assert(distance(state.position, stopped) > 1);
      assert.equal(state.mode, 'ground');
    } finally {
      world.dispose();
    }
  }
});

test('an actually clear park launch completes the public Vortex and naturally reacquires real ground', () => {
  const item = fixture.cases.find(
    (c) =>
      c.observed?.vortex?.completed &&
      c.observed.vortex.landed &&
      c.observed.vortex.stuntCollisions === 0,
  );
  assert(
    item,
    'the canonical audit must retain a complete actual clear park route, not fabricate an airborne success',
  );
  const world = actualWorld(item);
  try {
    const state = freshInitial(item, world);
    let motion = null,
      landed = false,
      sawInverted = false;
    for (let i = 0; i < 300 && !landed; i++) {
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 60,
        world,
        shape,
      );
      motion ??= state.vortex;
      assert.equal(report.environmentFailures, 0);
      if (motion?.elapsedS !== 1.4)
        assert.equal(
          report.collisions,
          0,
          `actual clear park stunt: ${state.collisionSurfaceId}`,
        );
      const q = state.quaternion;
      sawInverted ||= 1 - 2 * (q[0] * q[0] + q[2] * q[2]) < -0.5;
      landed = motion?.elapsedS === 1.4 && state.mode === 'ground';
    }
    assert(sawInverted);
    assert.equal(motion?.elapsedS, 1.4);
    assert(landed);
    assert.equal(state.vortex, null);
    assert.equal(state.flightAssist, false);
    assert.equal(state.contact.kind, 'ground');
    assert(
      world.support({
        pose: state,
        shape,
        preferredSurfaceId: state.contact.surfaceId,
        maxDistance: 1.03,
        adhesion: true,
      }),
    );
  } finally {
    world.dispose();
  }
});
