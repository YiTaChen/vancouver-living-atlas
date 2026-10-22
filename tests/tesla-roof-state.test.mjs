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
const { teslaPrismSource } = await import(cityModule('tesla-city-world'));
const {
  teslaFrame,
  teslaDot,
  teslaSubtract,
  teslaScale,
  teslaAdd,
  teslaRotate,
} = await import(cityModule('tesla-math'));
const saved = JSON.parse(
  readFileSync(
    new URL('./fixtures/tesla-real-departure.json', import.meta.url),
  ),
).wall;
const sourceId = 'building:2281:wall:0:7';
const height = shape.halfExtents[1] + shape.clearance;
function physicalWorld(enabled = () => true, extra = []) {
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
    face.enabled = () => enabled(f);
    return face;
  });
  return new TeslaWorld({
    sources: [fixedFacesSource('actual-wall-and-roof', faces), ...extra],
  });
}

function renderedCorniceSources(fixture) {
  return fixture.instanceMatrices.map((m, i) => {
    const polygon = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ].map(([x, z]) => [
      m[12] + x * m[0] + z * m[8],
      m[14] + x * m[2] + z * m[10],
    ]);
    return teslaPrismSource({
      id: `actual-rendered:${fixture.boxes[i].kind}`,
      polygon: [polygon],
      minY: m[13] - m[5] / 2,
      maxY: m[13] + m[5] / 2,
      obstacle: true,
    });
  });
}

function currentCornicePose(fixture, belowM = 0) {
  const quaternion = [...fixture.state.quaternion];
  const normal = fixture.state.contact.normal;
  const distance = teslaDot(
    teslaSubtract(fixture.state.position, fixture.state.contact.point),
    normal,
  );
  const position = teslaAdd(
    fixture.state.position,
    teslaScale(normal, height - distance),
  );
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((axis) => teslaRotate(quaternion, axis));
  const verticalExtent = (body) =>
    body.clearance +
    axes.reduce(
      (sum, axis, i) => sum + Math.abs(axis[1]) * body.halfExtents[i],
      0,
    );
  // Preserve the capture's exact cornice penetration/clearance while placing
  // the new car at its measured wall-normal offset. Source masonry stays fixed.
  position[1] += verticalExtent(fixture.shape) - verticalExtent(shape) - belowM;
  return { position, quaternion };
}

test('the actual rendered cornice triggers a swept roof route while the full wall footprint still fits', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-roof-cornice.json', import.meta.url),
    ),
  );
  const world = physicalWorld(() => true, renderedCorniceSources(fixture));
  const { position, quaternion } = currentCornicePose(fixture, 0.001);
  const state = createTesla(
    position,
    fixture.state.heading,
    fixture.state.contact,
  );
  state.quaternion = quaternion;
  try {
    const next = {
      position: [position[0], position[1] + 0.002, position[2]],
      quaternion: state.quaternion,
    };
    assert.equal(
      world.support({
        pose: next,
        shape,
        preferredSurfaceId: sourceId,
        maxDistance: height + 0.02,
        adhesion: true,
      })?.surfaceId,
      sourceId,
      'the cornice blocks before a roof-edge support failure can trigger',
    );
    assert.match(
      world.sweep({ from: state, to: next, shape, ignoreSurfaceId: sourceId })
        ?.surfaceId ?? '',
      /^actual-rendered:cornice:/,
    );
    assert(
      world.planWallToRoof({ pose: state, shape, sourceSurfaceId: sourceId }),
      'the complete route clears actual parapet, coping and cornice',
    );
    stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
    assert(
      state.attachment?.roofTransfer,
      'the predicted collision initiates the already proved route',
    );
    finishTransfer(state, world);
    stepTesla(state, {}, 1 / 60, world, shape);
    assert.equal(state.contact?.surfaceId, 'building:2281:roof');
    assert.equal(state.surfaceHolding, true);
    assert.equal(state.parked, false);
  } finally {
    world.dispose();
  }
});

test('the tiny existing captured cornice intrusion stays blocked, and a true route obstruction remains solid', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-roof-cornice.json', import.meta.url),
    ),
  );
  const actual = physicalWorld(() => true, renderedCorniceSources(fixture));
  try {
    const pose = currentCornicePose(fixture);
    assert(
      actual.sweep({ from: pose, to: pose, shape, ignoreSurfaceId: sourceId }),
      'captured existing ~0.155 micrometre intrusion is never waived',
    );
    assert.equal(
      actual.planWallToRoof({ pose, shape, sourceSurfaceId: sourceId }),
      null,
    );
  } finally {
    actual.dispose();
  }
  const roofY = fixture.provenance.roofY;
  const p = currentCornicePose(fixture).position;
  const obstruction = teslaPrismSource({
    id: 'true-roof-ceiling',
    polygon: [
      [
        [p[0] - 15, p[2] - 15],
        [p[0] + 15, p[2] - 15],
        [p[0] + 15, p[2] + 15],
        [p[0] - 15, p[2] + 15],
      ],
    ],
    minY: roofY + 0.8,
    maxY: roofY + 0.82,
    obstacle: true,
  });
  const world = physicalWorld(
    () => true,
    [...renderedCorniceSources(fixture), obstruction],
  );
  const state = createTesla(
    currentCornicePose(fixture, 0.001).position,
    fixture.state.heading,
    fixture.state.contact,
  );
  state.quaternion = [...fixture.state.quaternion];
  try {
    for (let i = 0; i < 12; i++)
      stepTesla(state, { throttle: 1 }, 1 / 60, world, shape);
    assert.equal(state.attachment, null);
    assert.equal(state.mode, 'wall');
    assert(state.position[1] < roofY);
    assert.match(state.collisionSurfaceId ?? '', /^actual-rendered:cornice:/);
  } finally {
    world.dispose();
  }
});
function onActualRoad() {
  const state = createTesla(
    saved.initial.position,
    saved.initial.heading,
    saved.initial.contact,
  );
  state.quaternion = [...saved.initial.quaternion];
  return state;
}
function nearActualEdge(world) {
  const face = saved.faces.find((f) => f.surfaceId === sourceId),
    top = Math.max(...face.triangle.map((p) => p[1]));
  const distance = teslaDot(
    teslaSubtract(saved.initial.position, face.triangle[0]),
    face.normal,
  );
  const p = [
    ...teslaAdd(
      saved.initial.position,
      teslaScale(face.normal, height - distance),
    ),
  ];
  p[1] = top - shape.halfExtents[2] - shape.clearance - 0.005;
  const pose = {
    position: p,
    quaternion: teslaFrame(face.normal, [0, 1, 0]).quaternion,
  };
  const proof = world.support({
    pose,
    shape,
    preferredSurfaceId: sourceId,
    maxDistance: height + 0.02,
    adhesion: true,
  });
  assert.equal(proof?.surfaceId, sourceId);
  const state = createTesla(p, saved.initial.heading, proof);
  state.quaternion = pose.quaternion;
  return state;
}
function startTransfer(world, state = nearActualEdge(world)) {
  for (let i = 0; i < 120 && !state.attachment?.roofTransfer; i++)
    stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
  assert(state.attachment?.roofTransfer);
  return state;
}
function finishTransfer(state, world, input = {}) {
  for (let i = 0; i < 600 && state.attachment; i++)
    stepTesla(state, input, 1 / 60, world, shape);
  assert.equal(state.attachment, null);
  return state;
}

test('the actual road approach climbs its facade, smoothly reaches its roof and automatically stops without P', () => {
  const world = physicalWorld(),
    state = onActualRoad();
  let sawWall = false,
    sawRoofTransfer = false;
  try {
    for (let i = 0; i < 1200 && state.contact?.kind !== 'roof'; i++) {
      const before = [...state.position];
      sawRoofTransfer ||= !!state.attachment?.roofTransfer;
      const report = stepTesla(
        state,
        sawRoofTransfer ? {} : { throttle: 0.14 },
        1 / 60,
        world,
        shape,
      );
      sawWall ||= state.mode === 'wall';
      assert.equal(report.environmentFailures, 0);
      assert(Math.hypot(...state.position.map((v, k) => v - before[k])) < 0.25);
    }
    assert(sawWall && sawRoofTransfer);
    assert.equal(state.contact?.surfaceId, 'building:2281:roof');
    assert.equal(state.mode, 'ground');
    for (let i = 0; i < 300 && !state.surfaceHolding; i++)
      stepTesla(state, {}, 1 / 60, world, shape);
    assert(state.surfaceHolding);
    assert.equal(state.wallHolding, false);
    assert.equal(state.parked, false);
    const pose = structuredClone({
      position: state.position,
      quaternion: state.quaternion,
    });
    for (let i = 0; i < 480; i++) stepTesla(state, {}, 1 / 60, world, shape);
    assert.deepEqual(
      { position: state.position, quaternion: state.quaternion },
      pose,
    );
    stepTesla(state, { adhesionToggle: true }, 1 / 60, world, shape);
    assert.equal(state.adhesionArmed, false);
    assert.equal(state.contact.kind, 'roof');
    assert(state.surfaceHolding, 'Free Drive preserves ordinary roof rest');
    for (let i = 0; i < 24; i++)
      stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
    assert.equal(state.surfaceHolding, false);
    assert.equal(state.contact.kind, 'roof');
    assert(
      Math.hypot(...state.position.map((v, k) => v - pose.position[k])) > 0.1,
    );
    for (let i = 0; i < 30; i++)
      stepTesla(state, { brake: true }, 1 / 60, world, shape);
    assert(state.surfaceHolding);
  } finally {
    world.dispose();
  }
});

test('B and optional P during a roof corner queue a safely completed stop rather than dropping the frame', () => {
  for (const input of [{ brake: true }, { park: true }]) {
    const world = physicalWorld();
    try {
      const state = startTransfer(world);
      stepTesla(state, input, 1 / 60, world, shape);
      finishTransfer(state, world, input.brake ? input : {});
      stepTesla(state, {}, 1 / 60, world, shape);
      assert.equal(state.contact.kind, 'roof');
      assert.equal(state.parked, !!input.park);
      assert.equal(state.surfaceHolding, !input.park);
      assert.deepEqual(state.velocity, [0, 0, 0]);
    } finally {
      world.dispose();
    }
  }
});

test('Space, F and Free Drive cancel early or rotating roof corners through the real source-wall guard', () => {
  for (const stage of ['first', 'arc'])
    for (const input of [
      { jump: true },
      { flightToggle: true },
      { adhesionToggle: true },
    ]) {
      const world = physicalWorld();
      try {
        const state = startTransfer(world);
        if (stage === 'arc') {
          for (let i = 0; i < 300 && state.attachment?.index < 3; i++)
            stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
          assert(state.attachment?.roofTransfer);
        }
        stepTesla(state, input, 1 / 60, world, shape);
        assert.equal(state.attachment, null);
        assert.equal(state.mode, 'air');
        assert.equal(state.surfaceHolding, false);
        let finalCollisions = 0;
        for (let i = 0; i < 240; i++) {
          const result = stepTesla(
            state,
            { brake: true },
            1 / 60,
            world,
            shape,
          );
          if (i > 180) finalCollisions += result.collisions;
          assert.equal(result.environmentFailures, 0);
          assert(
            [...state.position, ...state.quaternion].every(Number.isFinite),
          );
        }
        assert.equal(
          finalCollisions,
          0,
          `${stage} ${Object.keys(input).join(',')} does not form a contact loop`,
        );
        assert.equal(state.departureContact, null);
      } finally {
        world.dispose();
      }
    }
});

test('live facade or roof source removal aborts the roof route without retaining stale surface ownership', () => {
  for (const removed of [sourceId, 'building:2281:roof']) {
    let live = true;
    const world = physicalWorld((face) => live || face.surfaceId !== removed);
    try {
      const state = startTransfer(world);
      live = false;
      stepTesla(state, {}, 1 / 60, world, shape);
      assert.equal(state.attachment, null);
      assert.equal(state.contact, null);
      assert.equal(state.surfaceHolding, false);
      assert.equal(state.mode, 'air');
    } finally {
      world.dispose();
    }
  }
});

test('Space and V launch from the actual roof in Free Drive without using the ordinary-road departure allowance', () => {
  for (const command of ['jump', 'vortex']) {
    const world = physicalWorld();
    try {
      const state = finishTransfer(startTransfer(world), world);
      stepTesla(state, {}, 1 / 60, world, shape);
      assert.equal(state.contact.kind, 'roof');
      state.adhesionArmed = false;
      const startY = state.position[1];
      let collisions = 0;
      for (let i = 0; i < 30; i++) {
        collisions += stepTesla(
          state,
          { [command]: i === 0, ...(command === 'jump' ? { lift: 1 } : {}) },
          1 / 60,
          world,
          shape,
        ).collisions;
        assert.equal(state.groundDeparture, null);
      }
      assert.equal(collisions, 0);
      assert.equal(state.mode, 'air');
      assert(state.position[1] > startY + 2);
      if (command === 'vortex') assert(state.vortex?.elapsedS > 0.2);
    } finally {
      world.dispose();
    }
  }
});

test('V from the actual facade withdraws and turns outward before any barrel-roll time advances', () => {
  const world = physicalWorld();
  try {
    const state = nearActualEdge(world),
      normal = [...state.contact.normal],
      origin = [...state.position];
    stepTesla(state, { vortex: true }, 1 / 60, world, shape);
    assert(state.vortex && state.vortexPreparing);
    for (let i = 0; i < 240 && state.vortexPreparing; i++) {
      const report = stepTesla(state, {}, 1 / 60, world, shape);
      assert.equal(report.collisions, 0);
      if (state.vortexPreparing) assert.equal(state.vortex?.elapsedS, 0);
    }
    assert(state.vortex);
    assert.equal(state.vortexPreparing, false);
    assert(teslaDot(teslaSubtract(state.position, origin), normal) > 2);
    assert(
      teslaDot(
        [Math.sin(state.vortex.heading), 0, Math.cos(state.vortex.heading)],
        normal,
      ) > 0.99,
    );
    assert.equal(state.departureContact, null);
    for (let i = 0; i < 6; i++) stepTesla(state, {}, 1 / 60, world, shape);
    assert(state.vortex?.elapsedS > 0);
    assert(teslaDot(teslaSubtract(state.position, origin), normal) > 2);
  } finally {
    world.dispose();
  }
});

test('generic roof plans cannot hide an under-plane target, rotating source permission or diagonal roof descent', () => {
  for (const variant of ['under', 'rotate-first', 'diagonal-last']) {
    const world = physicalWorld();
    const original = world.planWallToRoof.bind(world);
    world.planWallToRoof = (query) => {
      const plan = original(query);
      assert(plan);
      if (variant === 'under') plan.waypoints.at(-1).position[1] -= 0.03;
      if (variant === 'rotate-first')
        plan.waypoints[0].quaternion = [0, 0, 0, 1];
      if (variant === 'diagonal-last') plan.waypoints.at(-1).position[0] += 0.1;
      return plan;
    };
    try {
      const state = nearActualEdge(world);
      for (let i = 0; i < 60 && state.mode === 'wall'; i++)
        stepTesla(state, { throttle: 0.14 }, 1 / 60, world, shape);
      assert.equal(state.attachment?.roofTransfer, undefined, variant);
      assert.notEqual(state.contact?.kind, 'roof');
    } finally {
      world.dispose();
    }
  }
});
