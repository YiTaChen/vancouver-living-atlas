import test from 'node:test';
import assert from 'node:assert/strict';
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
const poseOf = (s) =>
  structuredClone({ position: s.position, quaternion: s.quaternion });
function profileWorld(grade = 0.08) {
  const top = 4 * grade;
  const knots = [
    [-100, 0],
    [0, 0],
    [4, top],
    [8, top],
    [12, 0],
    [16, 0],
    [20, top],
    [24, top],
    [28, 0],
    [200, 0],
  ];
  const faces = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const [a, ay] = knots[i],
      [b, by] = knots[i + 1];
    const vertices = [
      [-50, ay, a],
      [50, ay, a],
      [50, by, b],
      [-50, by, b],
    ];
    for (const [j, indices] of [
      [0, [0, 1, 2]],
      [1, [0, 2, 3]],
    ])
      faces.push(
        triangleFace(
          `road:${i}`,
          `triangle:${i}:${String(j)}`,
          'ground',
          indices.map((n) => vertices[n]),
          true,
          'ground:0',
          [0, 1, -(by - ay) / (b - a)],
        ),
      );
  }
  return new TeslaWorld({
    sources: [fixedFacesSource('continuous-physical-grades', faces)],
  });
}

test('a real four-wheel frame crosses repeated 8% and 12% grades, crests and sags, reverses and parks without a ground collision loop', () => {
  for (const dt of [1 / 120, 1 / 30])
    for (const grade of [0.08, 0.12]) {
      const world = profileWorld(grade);
      const initial = { position: [0, height, -10], quaternion: [0, 0, 0, 1] };
      const contact = world.support({
        pose: initial,
        shape,
        maxDistance: height + 0.35,
        adhesion: false,
      });
      assert(contact);
      const state = createTesla(initial.position, 0, contact);
      try {
        for (let i = 0; i < 720 && state.position[2] < 35; i++) {
          const report = stepTesla(state, { throttle: 1 }, dt, world, shape);
          assert.equal(report.environmentFailures, 0);
          assert.equal(report.collisions, 0);
          assert.equal(state.mode, 'ground');
          assert.equal(state.attachment, null);
          const proof = world.support({
            pose: state,
            shape,
            maxDistance: height + 0.35,
            preferredSurfaceId: state.contact.surfaceId,
            adhesion: false,
          });
          assert(
            proof,
            'every accepted frame retains its actual four-wheel and union proof',
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
        }
        assert(state.position[2] >= 35);
        for (let i = 0; i < 180; i++)
          stepTesla(state, { brake: true }, 1 / 120, world, shape);
        assert.deepEqual(state.velocity, [0, 0, 0]);
        const stopped = poseOf(state);
        for (let i = 0; i < 60; i++)
          stepTesla(state, {}, 1 / 120, world, shape);
        assert.deepEqual(poseOf(state), stopped);
        for (let i = 0; i < 120; i++) {
          const report = stepTesla(
            state,
            { throttle: -0.2 },
            1 / 120,
            world,
            shape,
          );
          assert.equal(report.collisions, 0);
        }
        assert(state.position[2] < stopped.position[2] - 1);
        for (let i = 0; i < 60; i++)
          stepTesla(state, { brake: true }, 1 / 120, world, shape);
        stepTesla(state, { park: true }, 1 / 120, world, shape);
        assert(state.parked);
        const parked = poseOf(state);
        for (let i = 0; i < 60; i++)
          stepTesla(state, {}, 1 / 120, world, shape);
        assert.deepEqual(poseOf(state), parked);
      } finally {
        world.dispose();
      }
    }
});

test('a parked vehicle rechecks its actual body and loses the parking claim when a physical obstacle appears', () => {
  let enabled = false;
  const vertices = [
    [-30, 0, -30],
    [-30, 0, 30],
    [30, 0, 30],
    [30, 0, -30],
  ];
  const floor = [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) =>
    triangleFace(
      'floor',
      `floor:${i}`,
      'ground',
      indices.map((n) => vertices[n]),
      true,
      'ground:0',
      [0, 1, 0],
    ),
  );
  const obstacle = floor.map((f, i) => {
    const face = triangleFace(
      'new-physical-obstacle',
      `obstacle:${i}`,
      'obstacle',
      f.triangle.map((p) => [p[0], 1, p[2]]),
      false,
      undefined,
      [0, 1, 0],
    );
    face.enabled = () => enabled;
    return face;
  });
  const world = new TeslaWorld({
    sources: [
      fixedFacesSource('floor', floor),
      fixedFacesSource('new-obstacle', obstacle),
    ],
  });
  const state = createTesla([0, height, 0], 0, {
    surfaceId: 'floor',
    kind: 'ground',
    point: [0, 0, 0],
    normal: [0, 1, 0],
    adherable: true,
  });
  try {
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    const parked = poseOf(state);
    assert(state.parked);
    enabled = true;
    const report = stepTesla(state, {}, 1 / 60, world, shape);
    assert.equal(state.parked, false);
    assert(report.collisions > 0);
    assert.equal(state.collisionSurfaceId, 'new-physical-obstacle');
    assert.deepEqual(
      poseOf(state),
      parked,
      'a newly occupied body does not teleport or depenetrate through another face',
    );
    assert.deepEqual(state.velocity, [0, 0, 0]);
    enabled = false;
    stepTesla(state, {}, 1 / 60, world, shape);
    assert.equal(
      state.parked,
      false,
      'a previous parking permission is not restored automatically',
    );
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(state.parked);
  } finally {
    world.dispose();
  }
});

test('state rejects suspension metadata beyond the same five-centimetre policy used by the actual world', () => {
  const world = profileWorld();
  const state = createTesla([0, height, -10]);
  const before = structuredClone(state);
  try {
    for (const travel of [0.050001, 0.1, 0.2]) {
      const invalid = {
        ...shape,
        groundSupport: { ...shape.groundSupport, suspensionTravel: travel },
      };
      assert.throws(() => stepTesla(state, {}, 1 / 60, world, invalid));
      assert.deepEqual(state, before);
    }
  } finally {
    world.dispose();
  }
});

test('the reproduced sixteen-percent crease keeps a fresh legal driving frame through the whole repeated profile across frame cadences', () => {
  for (const dt of [1 / 120, 1 / 30, 0.067]) {
    const world = profileWorld(0.16);
    const initial = { position: [0, height, -10], quaternion: [0, 0, 0, 1] };
    const contact = world.support({
      pose: initial,
      shape,
      maxDistance: height + 0.35,
      adhesion: false,
    });
    const state = createTesla(initial.position, 0, contact);
    let stalledS = 0;
    try {
      for (let i = 0; i < Math.ceil(6 / dt) && state.position[2] < 38; i++) {
        const previous = state.position[2];
        const report = stepTesla(state, { throttle: 1 }, dt, world, shape);
        assert.equal(report.environmentFailures, 0);
        assert.equal(state.mode, 'ground');
        assert.equal(state.attachment, null);
        stalledS = state.position[2] - previous < 1e-5 ? stalledS + dt : 0;
        assert(
          stalledS < 0.2,
          'a rejected preferred refit must not trap an already legal requested frame',
        );
        const proof = world.support({
          pose: state,
          shape,
          maxDistance: height + 0.35,
          preferredSurfaceId: state.contact.surfaceId,
          adhesion: false,
        });
        assert(proof);
        assert.equal(
          world.sweep({
            from: state,
            to: state,
            shape,
            ignoreSurfaceId: proof.surfaceId,
          }),
          null,
        );
      }
      assert(state.position[2] >= 38);
    } finally {
      world.dispose();
    }
  }
});

test('a true finite crest-body obstruction retains collision and permits a fresh public jump', () => {
  const blocked = {
    position: [0, 0.8659671814213877, 27.457524528342063],
    quaternion: [0, 0.9983342655302342, 0.05769483744849384, 0],
  };
  const world = profileWorld(0.16);
  const proof = world.support({
    pose: blocked,
    shape,
    maxDistance: height + 0.35,
    preferredSurfaceId: 'road:7',
    adhesion: false,
  });
  assert(proof);
  assert.equal(
    world.sweep({
      from: blocked,
      to: blocked,
      shape,
      ignoreSurfaceId: proof.surfaceId,
    }),
    null,
  );
  const state = createTesla(blocked.position, Math.PI, proof);
  state.quaternion = [...blocked.quaternion];
  try {
    for (let frame = 0; frame < 240; frame++) {
      const input = { jump: frame === 0, lift: 1 };
      const report = stepTesla(state, input, 1 / 120, world, shape);
      assert.equal(report.environmentFailures, 0);
    }
    assert.equal(state.mode, 'air');
    assert(state.position[1] > blocked.position[1] + 10);
  } finally {
    world.dispose();
  }
});
