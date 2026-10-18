import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const { stepTesla } = await import(cityModule('tesla-state'));
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/tesla-robson-route.json', import.meta.url)),
);
const shape = createTeslaRoadsterShape(fixture.shape.clearance);
assert.deepEqual(shape.halfExtents, fixture.shape.halfExtents);
const actualWorld = () =>
  new TeslaWorld({
    sources: [
      fixedFacesSource(
        'actual-Robson-route',
        fixture.faces.map((f) =>
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
const forwardDistance = (state, initial) =>
  (state.position[0] - initial.position[0]) * Math.sin(initial.heading) +
  (state.position[2] - initial.position[2]) * Math.cos(initial.heading);

test('real GPU-reported Robson ground seam advances through overlapping physical asphalt triangles without fallback attachments', () => {
  for (const dt of [1 / 43, 1 / 60]) {
    const world = actualWorld(),
      state = structuredClone(fixture.capturedSeamState),
      initial = structuredClone(state);
    let collisions = 0;
    try {
      for (
        let elapsed = 0;
        elapsed < 3 && forwardDistance(state, initial) < 20;
        elapsed += dt
      ) {
        const r = stepTesla(state, { throttle: 1 }, dt, world, shape);
        collisions += r.collisions;
        assert.equal(r.environmentFailures, 0);
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
      }
      assert(
        forwardDistance(state, initial) > 20,
        'cross the actual stalled seam and continue at least twenty metres',
      );
      assert.equal(
        collisions,
        0,
        'road continuation uses full ground support, not repeated collision/attachment recovery',
      );
      assert(
        Math.hypot(...state.velocity) > 40,
        'road triangles do not repeatedly cap resumed speed at 30m/s',
      );
    } finally {
      world.dispose();
    }
  }
});

test('same real QA Robson spawn sustains ten seconds of throttle across the complete natural road route', () => {
  const world = actualWorld(),
    state = structuredClone(fixture.initial),
    initial = structuredClone(state);
  let collisions = 0;
  try {
    for (let i = 0; i < 600; i++) {
      const r = stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
      assert.equal(r.environmentFailures, 0);
      collisions += r.collisions;
      assert.equal(state.mode, 'ground', `ordinary ground at frame ${i}`);
      assert.equal(
        state.attachment,
        null,
        `no fallback attachment at frame ${i}`,
      );
    }
    assert(
      forwardDistance(state, initial) > 500,
      'continue along the complete real ten-second route without placements or resets',
    );
    assert.equal(collisions, 0);
  } finally {
    world.dispose();
  }
});

test('public launch and held ascent leave naturally driven road grades at several positions and speeds', () => {
  const world = actualWorld(),
    state = structuredClone(fixture.initial),
    checkpoints = new Set([0, 120, 240, 330, 420]),
    launches = [];
  try {
    for (let frame = 0; frame <= 420; frame++) {
      if (checkpoints.has(frame)) {
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
        launches.push({ frame, state: structuredClone(state) });
      }
      if (frame < 420) stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
    }
    for (const { frame, state: flying } of launches) {
      const height = flying.position[1];
      for (let i = 0; i < 30; i++) {
        const report = stepTesla(
          flying,
          { jump: i === 0, lift: 1 },
          1 / 60,
          world,
          shape,
        );
        assert.equal(report.environmentFailures, 0);
        assert.equal(flying.mode, 'air', `launch at route frame ${frame}`);
        assert.equal(flying.attachment, null);
      }
      assert(
        flying.position[1] > height + 2,
        `launch at route frame ${frame} must rise beyond the tyre departure envelope`,
      );
      assert.equal(flying.groundDeparture, null);
    }
  } finally {
    world.dispose();
  }
});

test('actual nearly collinear asphalt sliver at the next Robson seam cannot become a phantom vertical obstacle', () => {
  const world = actualWorld(),
    state = structuredClone(fixture.capturedSecondSeamState),
    initial = structuredClone(state);
  let collisions = 0;
  try {
    for (let i = 0; i < 60 && forwardDistance(state, initial) < 2; i++) {
      const r = stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
      collisions += r.collisions;
      assert.equal(r.environmentFailures, 0);
      assert.equal(state.mode, 'ground');
      assert.equal(state.attachment, null);
    }
    assert(forwardDistance(state, initial) > 2);
    assert.equal(
      collisions,
      0,
      'the complete real road footprint remains the support proof',
    );
  } finally {
    world.dispose();
  }
});

test('actual shared-edge Robson grade fits the authored wheels and body without fallback attachments', () => {
  const world = actualWorld(),
    state = structuredClone(fixture.capturedThirdSeamState),
    initial = structuredClone(state);
  let collisions = 0;
  try {
    assert(
      world.support({
        pose: state,
        shape,
        preferredSurfaceId: state.contact.surfaceId,
        maxDistance: 1.03,
        adhesion: true,
      }),
      'the saved pose has complete real four-wheel support',
    );
    for (let i = 0; i < 60 && forwardDistance(state, initial) < 2; i++) {
      const r = stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
      collisions += r.collisions;
      assert.equal(r.environmentFailures, 0);
      assert.equal(state.mode, 'ground');
      assert.equal(state.attachment, null);
    }
    assert(forwardDistance(state, initial) > 2);
    assert.equal(collisions, 0);
  } finally {
    world.dispose();
  }
});
