import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { teslaRotate, teslaDot } = await import(cityModule('tesla-math'));
const height = shape.halfExtents[1] + shape.clearance;
const poseOf = (s) =>
  structuredClone({ position: s.position, quaternion: s.quaternion });
const query = (pose, preferredSurfaceId) => ({
  pose,
  shape,
  preferredSurfaceId,
  maxDistance: height + 0.35,
  adhesion: false,
});

function rectangle(id, x0, x1, z0, z1, y = 0, options = {}) {
  const vertices = [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ];
  return [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) => {
    const face = triangleFace(
      `${id}:${i}`,
      `${id}:${i}`,
      options.kind ?? 'ground',
      indices.map((n) => vertices[n]),
      options.adherable ?? true,
      options.group ?? 'ground:0',
      [0, 1, 0],
    );
    if (options.enabled) face.enabled = options.enabled;
    return face;
  });
}
function riser(id, z, rise, normal) {
  const vertices = [
    [-40, 0, z],
    [-40, rise, z],
    [40, rise, z],
    [40, 0, z],
  ];
  return [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) =>
    triangleFace(
      `${id}:${i}`,
      `${id}:${i}`,
      'ground',
      indices.map((n) => vertices[n]),
      true,
      'ground:0',
      normal,
    ),
  );
}
function steppedFaces(rise, { vertical = true, top = {}, hole } = {}) {
  let lower = rectangle('approach', -40, 40, -80, 0);
  if (hole) {
    const [x, z, size] = hole;
    const x0 = x - size / 2,
      x1 = x + size / 2,
      z0 = z - size / 2,
      z1 = z + size / 2;
    lower = [
      ...rectangle('approach-left', -40, x0, -80, 0),
      ...rectangle('approach-right', x1, 40, -80, 0),
      ...rectangle('approach-rear', x0, x1, -80, z0),
      ...rectangle('approach-front', x0, x1, z1, 0),
    ];
  }
  return [
    ...lower,
    ...rectangle('curb-top', -40, 40, 0, 8, rise, top),
    ...rectangle('departure', -40, 40, 8, 80),
    ...(vertical
      ? [
          ...riser('curb-up-riser', 0, rise, [0, 0, -1]),
          ...riser('curb-down-riser', 8, rise, [0, 0, 1]),
        ]
      : []),
  ];
}
function worldFor(faces) {
  return new TeslaWorld({ sources: [fixedFacesSource('curb-scene', faces)] });
}
function startOn(
  world,
  position = [0, height, -6],
  heading = 0,
  id = 'approach:0',
) {
  const raw = {
    position,
    quaternion: [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)],
  };
  const fit = world.fitGround({
    pose: raw,
    shape,
    preferredSurfaceId: id,
    maxAdjustmentM: 0.35,
  });
  assert(fit, `actual source must supply the approach pose: ${id}`);
  const state = createTesla(fit.pose.position, heading, fit.contact);
  // The initial frame is supplied by actual geometry, not by a fabricated
  // contact, clearance, wheel height or permission in the test.
  state.quaternion = [...fit.pose.quaternion];
  assert(world.support(query(state, fit.contact.surfaceId)));
  assert.equal(
    world.sweep({
      from: state,
      to: state,
      shape,
      ignoreSurfaceId: fit.contact.surfaceId,
    }),
    null,
    'approach starts with the unchanged complete collision body clear',
  );
  return state;
}
function safeFrame(state, input, dt, world, label) {
  const report = stepTesla(state, input, dt, world, shape);
  const detail = JSON.stringify({
    label,
    position: state.position,
    mode: state.mode,
    collision: state.collisionSurfaceId,
    report,
  });
  assert.equal(report.environmentFailures, 0, detail);
  assert.equal(report.collisions, 0, detail);
  assert.equal(state.mode, 'ground', detail);
  assert.equal(
    state.attachment,
    null,
    'a tyre roll must not use a wall/curb attachment',
  );
  assert.equal(
    state.groundDeparture,
    null,
    'no jet-assisted departure is requested',
  );
  assert(!state.vortex, 'no Vortex move is requested');
  const proof = world.support(query(state, state.contact?.surfaceId));
  assert(proof, `each accepted frame keeps fresh physical support: ${detail}`);
  assert.equal(
    world.sweep({
      from: state,
      to: state,
      shape,
      ignoreSurfaceId: proof.surfaceId,
    }),
    null,
    `each accepted frame keeps the actual complete body clear: ${detail}`,
  );
  return report;
}
function cruiseUntil(
  state,
  world,
  done,
  { dt, targetMps, label, limitS = 20 },
) {
  let reached = false;
  for (let frame = 0; frame < Math.ceil(limitS / dt); frame++) {
    if (done(state)) {
      reached = true;
      break;
    }
    const forward = teslaRotate(state.quaternion, [0, 0, 1]);
    const speed = teslaDot(state.velocity, forward);
    safeFrame(
      state,
      { throttle: speed < targetMps ? (targetMps <= 2 ? 0.2 : 1) : 0 },
      dt,
      world,
      label,
    );
  }
  assert(
    reached,
    `${label}: vehicle must progress beyond the curb instead of looping at it`,
  );
}
function stopAndRestart(state, world, dt, parked, label) {
  for (let i = 0; i < Math.ceil(0.6 / dt); i++)
    safeFrame(state, { brake: true }, dt, world, label);
  assert(
    state.velocity.every((value) => value === 0),
    label,
  );
  if (parked) {
    safeFrame(state, { park: true }, dt, world, label);
    assert(state.parked, label);
  }
  const stopped = poseOf(state);
  for (let i = 0; i < 12; i++) safeFrame(state, {}, dt, world, label);
  assert.deepEqual(
    poseOf(state),
    stopped,
    `${label}: supported stop must not creep`,
  );
  for (let i = 0; i < Math.ceil(0.4 / dt); i++)
    safeFrame(state, { throttle: 0.2 }, dt, world, label);
  assert(!state.parked, `${label}: throttle resumes ordinary driving`);
  assert(
    Math.hypot(
      state.position[0] - stopped.position[0],
      state.position[2] - stopped.position[2],
    ) > 0.1,
    `${label}: a stopped tyre on a curb must restart`,
  );
}

test('route-aware ride height cannot bypass a real wall, an initially overlapping origin or invalid origin data', () => {
  const world = worldFor([
    ...rectangle('road', -40, 40, -40, 40),
    ...riser('actual-wall', 0, 2, [0, 0, -1]),
  ]);
  const pose = { position: [0, height, 6], quaternion: [0, 0, 0, 1] };
  const sweep = world.sweep.bind(world);
  let routeSweeps = 0;
  world.sweep = (q) => {
    routeSweeps++;
    return sweep(q);
  };
  const fit = (from) =>
    world.fitGround({
      pose,
      shape,
      preferredSurfaceId: 'road:0',
      maxAdjustmentM: 0.35,
      ...(from ? { from } : {}),
    });
  try {
    assert(fit(), 'the destination alone has a real floor and a clear body');
    for (const position of [
      [0, height, -6],
      [0, height, 0],
      [0, Number.NaN, -6],
    ]) {
      routeSweeps = 0;
      assert.equal(
        fit({ position, quaternion: [0, 0, 0, 1] }),
        null,
        'a clear destination never grants permission through the route or origin',
      );
      assert(
        routeSweeps <= 12,
        'failed OLS and fallback share one bounded route-search budget',
      );
    }
    assert(fit({ position: [0, height, 5], quaternion: [0, 0, 0, 1] }));
  } finally {
    world.dispose();
  }
});

for (const rise of [0.05, 0.1, 0.13])
  test(`authored tyres roll up and down a ${rise}m physical curb at slow/normal speeds and oblique headings`, async (t) => {
    for (const [heading, dt, targetMps] of [
      [0, 1 / 60, 2],
      [0, 1 / 30, 8],
      [Math.PI / 7.2, 1 / 30, 2],
      [Math.PI / 7.2, 1 / 60, 8],
      [-Math.PI / 7.2, 0.067, 2],
      [-Math.PI / 7.2, 0.067, 8],
    ])
      await t.test(`heading=${heading},dt=${dt},speed=${targetMps}`, () => {
        const world = worldFor(steppedFaces(rise));
        try {
          const state = startOn(world, [0, height, -6], heading);
          const label = `rise=${rise},heading=${heading},dt=${dt},speed=${targetMps}`;
          cruiseUntil(state, world, (s) => s.position[2] > 4, {
            dt,
            targetMps,
            label,
          });
          assert(
            Math.abs(state.position[1] - height - rise) < 0.055,
            'front and rear tyres must reach the actual top before parking',
          );
          stopAndRestart(state, world, dt, true, `${label}/top`);
          cruiseUntil(state, world, (s) => s.position[2] > 13, {
            dt,
            targetMps,
            label,
          });
          assert(Math.abs(state.position[1] - height) < 0.055);
          stopAndRestart(state, world, dt, false, `${label}/lower-road`);
        } finally {
          world.dispose();
        }
      });
  });

test('a front axle partly climbing a 13cm curb can brake, hold its exact pose and drive on', () => {
  const world = worldFor(steppedFaces(0.13));
  try {
    const state = startOn(world);
    cruiseUntil(state, world, (s) => s.position[2] >= -1.5, {
      dt: 1 / 60,
      targetMps: 2,
      label: 'partly-climbing-stop',
    });
    assert(
      state.position[2] < -1.2,
      'brake while front tyre arcs engage the edge',
    );
    stopAndRestart(state, world, 1 / 60, false, 'partly-climbing-stop');
    cruiseUntil(state, world, (s) => s.position[2] > 4, {
      dt: 1 / 60,
      targetMps: 2,
      label: 'partly-climbing-restart',
    });
  } finally {
    world.dispose();
  }
});

function actualCurbFixture() {
  const bytes = readFileSync(
    new URL('./fixtures/tesla-stationary-curb.json', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '1d52afeae3df4adc1d822527ee2c6a843c7a077a728af9d3ded48557a9243742',
    'the saved canonical geometry is reused exactly',
  );
  const saved = JSON.parse(bytes);
  const world = worldFor(
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
  );
  const forward = teslaRotate(saved.initial.quaternion, [0, 0, 1]);
  const approach = saved.initial.position.map((p, i) => p - forward[i]);
  const state = startOn(
    world,
    approach,
    saved.initial.heading,
    saved.initial.contact.surfaceId,
  );
  const start = [...state.position];
  const progress = (s) =>
    (s.position[0] - start[0]) * forward[0] +
    (s.position[2] - start[2]) * forward[2];
  return { world, saved, state, progress };
}

test('the actual 13cm street-side curb admits a natural front-axle climb, exact stop and public reverse back to its real road', () => {
  const { world, saved, state, progress } = actualCurbFixture();
  try {
    cruiseUntil(state, world, (s) => progress(s) > 2.25, {
      dt: 1 / 60,
      targetMps: 2,
      label: 'canonical-front-axle-climb',
      limitS: 5,
    });
    for (let i = 0; i < 36; i++)
      safeFrame(state, { brake: true }, 1 / 60, world, 'canonical-curb-stop');
    assert(state.velocity.every((value) => value === 0));
    const asphalt = saved.faces.find(
      (f) => f.surfaceId === saved.initial.contact.surfaceId,
    );
    for (const [i, wheel] of shape.groundSupport.wheelContacts.entries()) {
      const rotated = teslaRotate(state.quaternion, wheel);
      const point = rotated.map((value, j) => value + state.position[j]);
      const aboveAsphalt =
        point.reduce(
          (sum, value, j) =>
            sum + (value - asphalt.triangle[0][j]) * asphalt.normal[j],
          0,
        ) / asphalt.normal[1];
      if (i < 2)
        assert(
          aboveAsphalt > 0.08 && aboveAsphalt < 0.19,
          'both front tyre datums rise onto the physical 13cm footway',
        );
      else
        assert(
          Math.abs(aboveAsphalt) < 0.055,
          'the rear axle remains on the actual approach road',
        );
    }
    const stopped = poseOf(state);
    for (let i = 0; i < 30; i++)
      safeFrame(state, {}, 1 / 60, world, 'canonical-curb-hold');
    assert.deepEqual(
      poseOf(state),
      stopped,
      'braking on the real edge must not creep',
    );
    let reversed = false;
    for (let i = 0; i < 240; i++) {
      if (progress(state) < 0.1) {
        reversed = true;
        break;
      }
      const forward = teslaRotate(state.quaternion, [0, 0, 1]);
      const speed = teslaDot(state.velocity, forward);
      safeFrame(
        state,
        { throttle: speed > -2 ? -0.2 : 0 },
        1 / 60,
        world,
        'canonical-curb-reverse',
      );
    }
    assert(
      reversed,
      'ordinary reverse must roll the front tyres down and return to the safe road',
    );
    for (let i = 0; i < 36; i++)
      safeFrame(state, { brake: true }, 1 / 60, world, 'canonical-road-stop');
    assert(state.velocity.every((value) => value === 0));
    // This canonical sidewalk is only 2m wide in the travel direction, shorter
    // than the 2.78m wheelbase. Its different far-edge drop is tested below.
    // No medium landmark meshes or runtime furniture exist in this extraction;
    // this is not proof of whole-city or complete runtime-model clearance.
  } finally {
    world.dispose();
  }
});

test('the actual narrow footway far edge retains its separate 1.38m drop rejection without inventing grounded passage', () => {
  const { world, state, progress } = actualCurbFixture();
  try {
    let collisions = 0;
    for (let i = 0; i < 240; i++) {
      const forward = teslaRotate(state.quaternion, [0, 0, 1]);
      const speed = teslaDot(state.velocity, forward);
      const report = stepTesla(
        state,
        { throttle: speed < 2 ? 0.2 : 0 },
        1 / 60,
        world,
        shape,
      );
      collisions += report.collisions;
      assert.equal(report.environmentFailures, 0);
      assert(
        [...state.position, ...state.quaternion, ...state.velocity].every(
          Number.isFinite,
        ),
      );
      if (state.mode === 'ground') {
        const proof = world.support(query(state, state.contact?.surfaceId));
        assert(
          proof,
          'ground mode cannot claim tyre support across the real far-edge drop',
        );
        assert.equal(
          world.sweep({
            from: state,
            to: state,
            shape,
            ignoreSurfaceId: proof.surfaceId,
          }),
          null,
          'safe rejection preserves the actual complete resting body',
        );
      }
    }
    assert(
      collisions > 0,
      'the unsupported far-side route must remain rejected',
    );
    assert(
      progress(state) < 3.2,
      'the 2m platform must not be extended to carry the car across its 1.38m far-side drop',
    );
  } finally {
    world.dispose();
  }
});

test('tyre arcs do not invent ordinary support over a real millimetre hole inside the tyre rectangle', () => {
  const clear = worldFor(steppedFaces(0.13));
  let fitted;
  try {
    fitted = clear.fitGround({
      pose: { position: [0, height, -1.45], quaternion: [0, 0, 0, 1] },
      shape,
      preferredSurfaceId: 'approach:0',
      maxAdjustmentM: 0.35,
    });
    assert(fitted, 'the control scene must have actual tyre support');
  } finally {
    clear.dispose();
  }
  // Pitch moves the rear tyre datum in XZ. Remove the floor under the
  // geometry-fitted tyre itself, rather than under its old flat-pose location.
  const rotatedRearTyre = teslaRotate(
    fitted.pose.quaternion,
    shape.groundSupport.wheelContacts[2],
  );
  const rearTyre = rotatedRearTyre.map(
    (value, i) => value + fitted.pose.position[i],
  );
  for (const [x, z] of [
    [0.2, -1.1],
    [rearTyre[0], rearTyre[2]],
  ]) {
    const world = worldFor(steppedFaces(0.13, { hole: [x, z, 0.001] }));
    try {
      assert.equal(
        world.support(query(fitted.pose, fitted.contact.surfaceId)),
        null,
      );
      assert.equal(
        world.fitGround({
          pose: fitted.pose,
          shape,
          preferredSurfaceId: fitted.contact.surfaceId,
          maxAdjustmentM: 0.35,
        }),
        null,
        `missing physical floor at ${x},${z} cannot be supplied by a neighbouring tyre arc`,
      );
    } finally {
      world.dispose();
    }
  }
});

test('a disabled, excluded, nonadherable, roof or protected top cannot supply ordinary tyre-arc support', () => {
  const raw = { position: [0, height + 0.065, -0.9], quaternion: [0, 0, 0, 1] };
  for (const variant of [
    'disabled',
    'excluded',
    'nonadherable',
    'roof',
    'protected',
  ]) {
    const top =
      variant === 'disabled'
        ? { enabled: () => false }
        : variant === 'nonadherable'
          ? { adherable: false }
          : variant === 'roof'
            ? { kind: 'roof', group: 'roof:1' }
            : variant === 'protected'
              ? { group: 'protected:bridge:1' }
              : {};
    const world = worldFor(steppedFaces(0.13, { top }));
    const accepts =
      variant === 'excluded'
        ? (face) => !face.surfaceId.startsWith('curb-top:')
        : undefined;
    try {
      assert.equal(
        world.support(query(raw, 'approach:0'), accepts),
        null,
        variant,
      );
      assert.equal(
        world.fitGround(
          {
            pose: raw,
            shape,
            preferredSurfaceId: 'approach:0',
            maxAdjustmentM: 0.35,
          },
          accepts,
        ),
        null,
        variant,
      );
    } finally {
      world.dispose();
    }
  }
});

test('a physically high curb and an actual overhead obstruction still stop the complete vehicle', () => {
  // Clear the current complete hull on the approach, then intersect it after
  // the real 13 cm rise. A fixed 1.45 m ceiling now clears the lower Roadster.
  const ceilingY = 2 * height + 0.08;
  assert(ceilingY > 2 * height && ceilingY < 2 * height + 0.13);
  for (const variant of ['high-curb', 'ceiling']) {
    const faces = steppedFaces(variant === 'high-curb' ? 0.45 : 0.13);
    if (variant === 'ceiling')
      faces.push(
        ...rectangle('physical-ceiling', -40, 40, -1, 4, ceilingY, {
          kind: 'obstacle',
          group: 'ceiling',
          adherable: false,
        }),
      );
    const world = worldFor(faces);
    try {
      const state = startOn(world);
      let collisions = 0;
      for (let i = 0; i < 240; i++) {
        const report = stepTesla(
          state,
          { throttle: 0.2 },
          1 / 60,
          world,
          shape,
        );
        collisions += report.collisions;
        assert.equal(report.environmentFailures, 0, variant);
        assert(
          [...state.position, ...state.quaternion, ...state.velocity].every(
            Number.isFinite,
          ),
          variant,
        );
      }
      assert(
        collisions > 0,
        `${variant} must retain its actual swept collision`,
      );
      assert(
        state.position[2] < 0,
        `${variant} cannot be crossed by granting tyre permission`,
      );
    } finally {
      world.dispose();
    }
  }
});
