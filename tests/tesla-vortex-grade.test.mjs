import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { historicalTeslaCaptureAdapter } from './helpers/tesla-historical-capture.mjs';

const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
  teslaVehicleFrame,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { CityTeslaWorld, teslaPrismSource } = await import(
  cityModule('tesla-city-world')
);
const { teslaFrame, teslaDot } = await import(cityModule('tesla-math'));
const height = shape.halfExtents[1] + shape.clearance;
const box = (id, minY, maxY) =>
  teslaPrismSource({
    id,
    polygon: [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    ],
    minY,
    maxY,
    obstacle: true,
  });
const captured = {
  position: [-157.41509144225796, 24.527395172450255, -307.49263583618574],
  quaternion: [
    -0.03734026243025841, 0.3847445332018134, -0.010055468434421488,
    0.922212685082743,
  ],
  heading: 0.7919362054644239,
};
const entryPose = {
  position: [-157.41511414209359, 24.530286913829137, -307.4927885851381],
  quaternion: [
    -0.03744494276165156, 0.38476648503687993, -0.009471413629660282,
    0.9222054654890075,
  ],
  heading: 0.7890989694020802,
};
function actualDefault(pose = captured) {
  const saved = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-default-entry-canopy.json', import.meta.url),
    ),
  );
  pose = historicalTeslaCaptureAdapter(saved.shape, shape)(pose);
  const roads = new THREE.Group();
  const geometries = [];
  for (const source of saved.groundMeshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(source.vertices, 3),
    );
    const mesh = new THREE.Mesh(geometry);
    Object.assign(mesh.userData, {
      asphaltSurface: source.asphaltSurface,
      walkSurface: true,
    });
    roads.add(mesh);
    geometries.push(geometry);
  }
  const world = new CityTeslaWorld({
    roads,
    terrain: new THREE.Group(),
    data: {
      flightBuildingVolumes: saved.flightBuildingVolumes,
      buildingRoofs: new Map(saved.buildingRoofs),
      streetLampPoints: saved.streetLampPoints,
    },
    settings: { buildings: true },
    detailedTrees: { trees: saved.trees },
    landmarkDetails: [],
    streetFurniture: null,
    elevation: (x, z) => {
      const index = saved.streetLampPoints.findIndex(
        (p) => Math.hypot(p[0] - x, p[1] - z) < 1e-5,
      );
      assert(index >= 0, 'every fixture lamp has a real terrain datum');
      return saved.streetLampElevations[index];
    },
  });
  const contact = world.support({
    pose,
    shape,
    maxDistance: 1.03,
    adhesion: false,
  });
  assert(contact);
  const state = createTesla(pose.position, pose.heading, contact);
  state.quaternion = [...pose.quaternion];
  return {
    world,
    state,
    dispose: () => {
      world.dispose();
      geometries.forEach((g) => g.dispose());
    },
  };
}

test('the actual hosted default launch sweeps its bounded grade clearance, completes 360 degrees and naturally lands', () => {
  const { world, state, dispose } = actualDefault();
  const initialContact = structuredClone(state.contact);
  const headingForward = [Math.sin(state.heading), 0, Math.cos(state.heading)];
  const expectedGrade =
    -teslaDot(initialContact.normal, headingForward) / initialContact.normal[1];
  let completed = false,
    landed = false,
    winding = 0,
    previousAngle = 0,
    sawGrade = false;
  let maxLift = 0,
    maxProgress = 0,
    preparationSteps = 0;
  const sweep = world.sweep.bind(world);
  const preparationRises = [];
  world.sweep = (query) => {
    if (
      state.vortexPreparing &&
      state.vortexPreparationLiftTargetM >
        state.vortexPreparationLiftM + 1e-9 &&
      query.to.position[1] > query.from.position[1]
    ) {
      assert.equal(query.ignoreSurfaceId, undefined);
      assert.equal(query.to.position[0], query.from.position[0]);
      assert.equal(query.to.position[2], query.from.position[2]);
      assert.deepEqual(query.to.quaternion, query.from.quaternion);
      preparationRises.push(structuredClone(query));
    }
    return sweep(query);
  };
  try {
    for (let i = 0; i < 360 && !landed; i++) {
      const wasActive = !!state.vortex;
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 120,
        world,
        shape,
      );
      assert.equal(report.environmentFailures, 0);
      if (!completed) {
        assert.equal(
          report.collisions,
          0,
          `early collision at step ${i}: ${state.collisionSurfaceId}`,
        );
        const up = teslaVehicleFrame(state).up;
        const right = [
          Math.cos(captured.heading),
          0,
          -Math.sin(captured.heading),
        ];
        const angle = Math.atan2(-teslaDot(up, right), up[1]);
        winding += Math.atan2(
          Math.sin(angle - previousAngle),
          Math.cos(angle - previousAngle),
        );
        previousAngle = angle;
      }
      if (state.vortex) {
        sawGrade = true;
        assert(Math.abs(state.vortex.gradeMPerM - expectedGrade) < 1e-12);
        maxProgress = Math.max(maxProgress, state.vortex.elapsedS / 1.4);
      }
      maxLift = Math.max(maxLift, state.vortexPreparationLiftM);
      preparationSteps += state.vortexPreparing;
      if (wasActive && !state.vortex) {
        assert(maxProgress > 0.99);
        completed = true;
        assert.equal(state.flightAssist, false);
        assert(Math.abs(winding - Math.PI * 2) < 1e-6);
      }
      landed = completed && state.mode === 'ground';
      assert(
        [...state.position, ...state.quaternion, ...state.velocity].every(
          Number.isFinite,
        ),
      );
    }
    assert(
      sawGrade && completed && landed,
      JSON.stringify({ completed, landed, state }),
    );
    assert(Math.abs(maxLift - 0.35) < 1e-9);
    assert(preparationRises.length > 0 && preparationSteps < 60);
    assert.equal(state.parked, false);
    assert.equal(state.contact.kind, 'ground');
    assert.equal(state.vortexPreparationLiftM, 0);
  } finally {
    dispose();
  }
});

test('both actual default poses complete and land across fixed and observed irregular render partitions', () => {
  // The browser capture samples these frame deltas about every 100ms; cycling
  // them tests the observed irregular partitions, not an invented full trace.
  const observed = [
    0.0163, 0.0333, 0.0159, 0.0164, 0.0486, 0.0334, 0.0152, 0.0168, 0.016,
    0.0173, 0.035, 0.0162, 0.0168,
  ];
  for (const [name, deltas] of [
    ['120Hz', [1 / 120]],
    ['60Hz', [1 / 60]],
    ['30Hz', [1 / 30]],
    ['360Hz', [1 / 360]],
    ['67ms', [0.067]],
    ['observed-irregular', observed],
  ])
    for (const [poseIndex, pose] of [captured, entryPose].entries()) {
      const { world, state, dispose } = actualDefault(pose);
      let completed = false,
        landed = false,
        motion = null,
        time = 0;
      const activeHits = [];
      const sweep = world.sweep.bind(world);
      world.sweep = (query) => {
        const hit = sweep(query);
        if (hit && state.vortex && !state.vortexPreparing) activeHits.push(hit);
        return hit;
      };
      const context = `${String(name)} actual pose ${poseIndex}`;
      try {
        for (let i = 0; time < 4 && !landed; i++) {
          const active = !!state.vortex;
          const dt = deltas[i % deltas.length];
          const report = stepTesla(
            state,
            { vortex: i === 0 },
            dt,
            world,
            shape,
          );
          time += dt;
          assert.equal(report.environmentFailures, 0, context);
          assert.equal(
            activeHits.length,
            0,
            `${context} at ${time}s: ${state.collisionSurfaceId}`,
          );
          motion ??= state.vortex;
          if (active && !state.vortex) {
            assert.equal(motion.elapsedS, 1.4, context);
            completed = true;
            if (!state.attachment)
              assert.equal(state.flightAssist, false, context);
          }
          landed = completed && state.mode === 'ground';
        }
        assert(completed && landed, context);
      } finally {
        dispose();
      }
    }
});

function tiltedWorld(grade, kind = 'ground') {
  const normal = [0, 1 / Math.hypot(1, grade), -grade / Math.hypot(1, grade)];
  const vertices = [
    [-100, -50 * grade, -50],
    [100, -50 * grade, -50],
    [100, 150 * grade, 150],
    [-100, 150 * grade, 150],
  ];
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) =>
    triangleFace(
      `tilted-${kind}`,
      `triangle:${i}`,
      kind,
      indices.map((n) => vertices[n]),
      true,
      kind === 'ground' ? 'ground:0' : 'roof:0',
      normal,
    ),
  );
  const floor = {
    surfaceId: `tilted-${kind}`,
    kind,
    point: [0, 0, 0],
    normal,
    adherable: true,
  };
  const quaternion = teslaFrame(normal, [0, grade, 1]).quaternion;
  const position = normal.map((n) => n * height);
  const state = createTesla(position, 0, floor);
  state.quaternion = quaternion;
  return { faces, state, floor };
}

test('an uphill physical road and five solid cars retain a complete swept roll and natural landing', () => {
  const grade = 0.08;
  const { faces, state } = tiltedWorld(grade);
  const cars = [8, 13.5, 19, 24.5, 30].map((z, i) =>
    teslaPrismSource({
      id: `tilted-physical-car:${i}`,
      polygon: [
        [
          [-1.1, z - 2.1],
          [1.1, z - 2.1],
          [1.1, z + 2.1],
          [-1.1, z + 2.1],
        ],
      ],
      minY: (z - 2.1) * grade + 0.05,
      maxY: (z + 2.1) * grade + 1.9,
      obstacle: true,
    }),
  );
  const world = new TeslaWorld({
    sources: [fixedFacesSource('tilted-road', faces), ...cars],
  });
  let maximum = 0,
    completed = false,
    landed = false;
  try {
    for (let i = 0; i < 360 && !landed; i++) {
      const wasActive = !!state.vortex;
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 120,
        world,
        shape,
      );
      assert.equal(report.environmentFailures, 0);
      if (!completed)
        assert.equal(
          report.collisions,
          0,
          `stunt hit ${state.collisionSurfaceId}`,
        );
      if (state.vortex) {
        assert(Math.abs(state.vortex.gradeMPerM - grade) < 1e-12);
        maximum = Math.max(maximum, state.vortex.elapsedS / 1.4);
      }
      if (wasActive && !state.vortex) {
        assert(maximum > 0.99);
        completed = true;
      }
      landed = completed && state.mode === 'ground';
    }
    assert(completed && landed);
    assert(state.position[2] > 38);
    assert.equal(state.parked, false);
  } finally {
    world.dispose();
  }
});

test('only a freshly proved gentle launch floor supplies tangent momentum; free air has none and an unavailable steep floor cannot launch', () => {
  for (const kind of ['ground', 'roof']) {
    const { faces, state } = tiltedWorld(0.08, kind);
    // The stored contact is stale, but the real wheel pose and fresh source are not.
    state.contact.normal = [0, 1, 0];
    const world = new TeslaWorld({
      sources: [fixedFacesSource('fresh-floor', faces)],
    });
    try {
      stepTesla(state, { vortex: true }, 1e-6, world, shape);
      assert(state.vortex);
      assert(Math.abs(state.vortex.gradeMPerM - 0.08) < 1e-12);
      const air = createTesla([0, 20, 0], 0);
      stepTesla(air, { vortex: true }, 1e-6, world, shape);
      assert.equal(
        air.vortex.gradeMPerM,
        0,
        'a floor beneath a free-air launch grants no tangent momentum',
      );
    } finally {
      world.dispose();
    }
  }
  const { faces, state } = tiltedWorld(0.5);
  const world = new TeslaWorld({
    sources: [fixedFacesSource('steep-floor', faces)],
  });
  try {
    stepTesla(state, { vortex: true }, 1e-6, world, shape);
    assert.equal(
      state.vortex,
      null,
      'the actual drive-floor proof rejects this steep source',
    );
  } finally {
    world.dispose();
  }
});

test('a true ceiling blocks the added preparation rise without extending ordinary-ground departure permission', () => {
  const { faces, state } = tiltedWorld(0.08);
  const frame = teslaVehicleFrame(state);
  const top =
    state.position[1] +
    Math.abs(frame.up[1]) * shape.halfExtents[1] +
    Math.abs(frame.forward[1]) * shape.halfExtents[2] +
    shape.clearance;
  const ceilingY = top + 0.13;
  const world = new TeslaWorld({
    sources: [
      fixedFacesSource('real-tilted-floor', faces),
      box('thin-prep-ceiling', ceilingY, ceilingY + 0.001),
    ],
  });
  let queued = false,
    blocked = false;
  const strict = world.sweepGroundDeparture.bind(world);
  world.sweepGroundDeparture = (query) => {
    assert(query.to.position[1] - query.origin.position[1] <= 0.35 + 1e-9);
    return strict(query);
  };
  try {
    for (let i = 0; i < 120 && !blocked; i++) {
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 120,
        world,
        shape,
      );
      queued ||= state.vortexPreparationLiftTargetM > 0;
      assert.equal(report.environmentFailures, 0);
      if (report.collisions) {
        blocked = true;
        assert(state.collisionSurfaceId.startsWith('thin-prep-ceiling:'));
        assert.equal(state.vortex, null);
        assert.equal(state.vortexPreparing, false);
      }
    }
    assert(queued && blocked);
    assert(state.position[1] < ceilingY);
  } finally {
    world.dispose();
  }
});

test('a steep physical floor exhausts the 35cm extra-rise cap and cancels instead of expanding its collision allowance', () => {
  const { faces, state } = tiltedWorld(0.4);
  const world = new TeslaWorld({
    sources: [fixedFacesSource('steep-alignment-floor', faces)],
  });
  let lifted = 0,
    blocked = false;
  try {
    for (let i = 0; i < 180 && !blocked; i++) {
      const report = stepTesla(
        state,
        { vortex: i === 0 },
        1 / 120,
        world,
        shape,
      );
      lifted = Math.max(lifted, state.vortexPreparationLiftM);
      assert.equal(report.environmentFailures, 0);
      assert(state.vortexPreparationLiftM <= 0.35 + 1e-9);
      if (report.collisions) {
        blocked = true;
        assert.equal(state.collisionSurfaceId, 'tilted-ground');
        assert.equal(state.vortex, null);
      }
    }
    assert(
      blocked && Math.abs(lifted - 0.35) < 1e-9,
      JSON.stringify({ lifted, blocked, state }),
    );
  } finally {
    world.dispose();
  }
});

test('non-driveable ground and ordinary obstacles blocking alignment do not authorize preparation lift', () => {
  for (const kind of ['obstacle', 'ground']) {
    const { faces, state: groundState } = tiltedWorld(0.08);
    const barrier = faces.map((f, i) =>
      triangleFace(
        'non-driveable-rotation-plane',
        `barrier:${i}`,
        kind,
        f.triangle.map((p) => [p[0], p[1] + 0.02, p[2]]),
        false,
        undefined,
        f.normal,
      ),
    );
    const world = new TeslaWorld({
      sources: [fixedFacesSource('barrier', barrier)],
    });
    const state = createTesla(
      groundState.position.map((v, i) => v + (i === 1 ? 0.1 : 0)),
      0,
    );
    state.quaternion = [...groundState.quaternion];
    let blocked = false;
    try {
      assert.equal(world.sweep({ from: state, to: state, shape }), null);
      for (let i = 0; i < 120 && !blocked; i++) {
        const report = stepTesla(
          state,
          { vortex: i === 0 },
          1 / 120,
          world,
          shape,
        );
        assert.equal(state.vortexPreparationLiftM, 0, kind);
        if (report.collisions) {
          blocked = true;
          assert.equal(
            state.collisionSurfaceId,
            'non-driveable-rotation-plane',
          );
          assert.equal(state.vortex, null);
        }
      }
      assert(blocked, kind);
    } finally {
      world.dispose();
    }
  }
});

test('a newly overlapping physical source invalidates the current pose instead of borrowing an earlier clear preparation proof', () => {
  const { faces, state: groundState } = tiltedWorld(0.08);
  let enabled = false;
  const barrier = faces.map((f, i) => {
    const face = triangleFace(
      'new-overlap',
      `overlap:${i}`,
      'obstacle',
      f.triangle.map((p) => [p[0], p[1] + 0.12, p[2]]),
      false,
      undefined,
      f.normal,
    );
    face.enabled = () => enabled;
    return face;
  });
  const world = new TeslaWorld({
    sources: [
      fixedFacesSource('floor', faces),
      fixedFacesSource('dynamic-overlap', barrier),
    ],
  });
  const state = createTesla(
    groundState.position.map((v, i) => v + (i === 1 ? 0.1 : 0)),
    0,
  );
  state.quaternion = [...groundState.quaternion];
  try {
    stepTesla(state, { vortex: true }, 1e-6, world, shape);
    assert(state.vortex);
    enabled = true;
    const before = [...state.position];
    const report = stepTesla(state, {}, 1 / 120, world, shape);
    assert(report.collisions > 0);
    assert.equal(state.vortex, null);
    assert.deepEqual(state.position, before);
    assert.equal(state.vortexPreparationLiftM, 0);
  } finally {
    world.dispose();
  }
});

test('the millimetre separating landing target still rejects a thin ceiling and unavailable adjacent ground', () => {
  for (const variant of ['ceiling', 'permission']) {
    const { faces } = tiltedWorld(0.08);
    if (variant === 'permission')
      for (const face of faces) face.adherable = false;
    const world = new TeslaWorld({
      sources: [
        fixedFacesSource('landing-floor', faces),
        ...(variant === 'ceiling' ? [box('one-mm-ceiling', 2, 2.001)] : []),
      ],
    });
    const state = createTesla([0, 0.88, 0], 0);
    state.flightAssist = false;
    state.velocity = [0, -5, 0];
    let hit = false;
    try {
      assert.equal(world.sweep({ from: state, to: state, shape }), null);
      for (let i = 0; i < 30; i++) {
        const report = stepTesla(state, {}, 1 / 120, world, shape);
        hit ||= report.collisions > 0;
        assert.equal(state.attachment, null, variant);
        assert.equal(state.mode, 'air', variant);
        assert(state.position[1] < 1, variant);
      }
      assert(hit, variant);
    } finally {
      world.dispose();
    }
  }
});

test('failed alignment queries and corrupted lift budgets cancel without raw movement or borrowed clearance', () => {
  for (const variant of ['throw', 'nonfinite-budget', 'over-budget']) {
    const { faces, state: floorState } = tiltedWorld(0.08);
    const world = new TeslaWorld({
      sources: [fixedFacesSource('real-floor', faces)],
    });
    const state = createTesla(
      floorState.position.map((v, i) => v + (i === 1 ? 0.1 : 0)),
      0,
    );
    state.quaternion = [...floorState.quaternion];
    try {
      stepTesla(state, { vortex: true }, 1e-6, world, shape);
      assert(state.vortex);
      const sweep = world.sweep.bind(world);
      world.sweep = (query) => {
        if (
          variant === 'throw' &&
          query.to.quaternion.some(
            (value, i) => value !== query.from.quaternion[i],
          )
        )
          throw new Error('live geometry lookup failed');
        return sweep(query);
      };
      if (variant === 'nonfinite-budget') state.vortexPreparationLiftM = NaN;
      if (variant === 'over-budget') state.vortexPreparationLiftTargetM = 0.351;
      const before = structuredClone({
        position: state.position,
        quaternion: state.quaternion,
      });
      const report = stepTesla(state, {}, 1 / 120, world, shape);
      assert.equal(report.environmentFailures, 1, variant);
      assert.equal(state.vortex, null);
      assert.deepEqual(
        { position: state.position, quaternion: state.quaternion },
        before,
      );
      assert.equal(state.vortexPreparationLiftM, 0);
      assert.equal(state.vortexPreparationLiftTargetM, 0);
    } finally {
      world.dispose();
    }
  }
});
