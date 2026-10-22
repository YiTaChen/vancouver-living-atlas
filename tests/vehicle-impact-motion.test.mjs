import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: shape,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, fixedFacesSource, triangleFace } = await import(
  cityModule('tesla-world')
);
const { resolveVehicleImpact } = await import(cityModule('vehicle-impact'));
const height = shape.halfExtents[1] + shape.clearance;
const pose = (s) => ({
  position: [...s.position],
  quaternion: [...s.quaternion],
});
const close = (a, b, tolerance = 1e-7) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);

function scene({ planes = [], floorLimit = 100 } = {}) {
  const enabled = new Map(planes.map((p) => [p.id, true]));
  const floor = [
    [
      [-100, 0, -100],
      [100, 0, -100],
      [100, 0, floorLimit],
    ],
    [
      [-100, 0, -100],
      [100, 0, floorLimit],
      [-100, 0, floorLimit],
    ],
  ].map((vertices, i) =>
    triangleFace(
      'floor',
      `floor:${i}`,
      'ground',
      vertices,
      true,
      'ground:0',
      [0, 1, 0],
    ),
  );
  const sources = [fixedFacesSource('floor', floor)];
  for (const p of planes) {
    const verts =
      p.axis === 'x'
        ? [
            [p.at, -1, -100],
            [p.at, 10, -100],
            [p.at, 10, 100],
            [p.at, -1, 100],
          ]
        : [
            [-100, -1, p.at],
            [-100, 10, p.at],
            [100, 10, p.at],
            [100, -1, p.at],
          ];
    const faces = [
      [0, 1, 2],
      [0, 2, 3],
    ].map((indices, i) => {
      const face = triangleFace(
        p.id,
        `${p.id}:${i}`,
        p.kind ?? 'obstacle',
        indices.map((n) => verts[n]),
        false,
        p.id,
        p.axis === 'x' ? [-1, 0, 0] : [0, 0, -1],
      );
      face.enabled = () => enabled.get(p.id);
      return face;
    });
    const source = fixedFacesSource(p.id, faces);
    source.enabled = () => enabled.get(p.id);
    sources.push(source);
  }
  const world = new TeslaWorld({ sources });
  const state = (speed = 70, heading = 0) => {
    const s = createTesla([0, height, 0], heading);
    const contact = world.support({
      pose: s,
      shape,
      maxDistance: height + 0.2,
      adhesion: false,
    });
    assert(contact, 'initial full tyre support');
    s.contact = contact;
    s.mode = 'ground';
    s.parked = false;
    s.velocity = [Math.sin(heading) * speed, 0, Math.cos(heading) * speed];
    return s;
  };
  return { world, enabled, state };
}

test('breakage re-sweeps the entire remaining body route and still stops at the next rigid obstacle', () => {
  const { world, enabled, state } = scene({
    planes: [
      { id: 'tree:1', at: 2.55 },
      { id: 'wall:1', at: 2.75 },
    ],
  });
  const calls = [];
  world.impact = ({ hit, velocity }) => {
    calls.push(hit.surfaceId);
    const result = resolveVehicleImpact({
      velocity,
      normal: hit.normal,
      massKg: 2000,
      obstacle: {
        id: hit.surfaceId,
        kind: hit.surfaceId === 'tree:1' ? 'tree' : 'rigid',
        diameterM: 0.1,
      },
    });
    if (result.broken) enabled.set(hit.surfaceId, false);
    return { velocity: result.velocity, passThrough: result.broken };
  };
  const s = state(),
    start = pose(s);
  try {
    const report = stepTesla(s, {}, 1 / 120, world, shape);
    assert.deepEqual(calls, ['tree:1', 'wall:1']);
    assert.equal(enabled.get('tree:1'), false);
    assert(report.collisions >= 2 && report.environmentFailures === 0);
    assert(s.position[2] > start.position[2]);
    assert(s.position[2] + shape.halfExtents[2] + shape.clearance < 2.75);
    assert(s.velocity[2] <= 0);
    assert.equal(
      world.sweep({
        from: s,
        to: s,
        shape,
        ignoreSurfaceId: s.contact?.surfaceId,
      }),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('one fixed substep can break at most four distinct props and leaves the fifth blocking', () => {
  const planes = Array.from({ length: 5 }, (_, i) => ({
    id: `prop:${i}`,
    at: 2.55 + i * 0.04,
  }));
  const { world, enabled, state } = scene({ planes }),
    calls = [];
  world.impact = ({ hit, velocity }) => {
    calls.push(hit.surfaceId);
    enabled.set(hit.surfaceId, false);
    return { velocity, passThrough: true };
  };
  const s = state();
  try {
    const report = stepTesla(s, {}, 1 / 120, world, shape);
    assert.equal(calls.length, 4);
    assert.equal(new Set(calls).size, 4);
    assert.equal(enabled.get('prop:4'), true);
    assert.equal(s.collisionSurfaceId, 'prop:4');
    assert(
      s.position[2] + shape.halfExtents[2] + shape.clearance < planes[4].at,
    );
    assert.equal(report.environmentFailures, 0);
  } finally {
    world.dispose();
  }
});

test('a pass-through claim without actual source removal remains blocking and is not charged repeatedly', () => {
  const { world, state } = scene({ planes: [{ id: 'unchanged', at: 2.55 }] });
  let calls = 0;
  world.impact = ({ velocity }) => {
    calls++;
    return { velocity, passThrough: true };
  };
  const s = state();
  try {
    stepTesla(s, {}, 1 / 120, world, shape);
    assert.equal(calls, 1);
    assert(s.position[2] + shape.halfExtents[2] + shape.clearance < 2.55);
    assert(s.velocity[2] <= 0);
  } finally {
    world.dispose();
  }
});

test('legacy worlds and a declined impact hook retain identical movement and collision reports', () => {
  const a = scene({ planes: [{ id: 'wall', at: 2.55 }] }),
    b = scene({ planes: [{ id: 'wall', at: 2.55 }] }),
    sa = a.state(),
    sb = b.state();
  b.world.impact = () => null;
  try {
    for (let i = 0; i < 60; i++) {
      assert.deepEqual(
        stepTesla(sa, { throttle: 0.2 }, 1 / 120, a.world, shape),
        stepTesla(sb, { throttle: 0.2 }, 1 / 120, b.world, shape),
      );
      assert.deepEqual(sa, sb);
    }
  } finally {
    a.world.dispose();
    b.world.dispose();
  }
});

test('speculative sweeps, ground fitting, zero-duration and a supported parked vehicle do not invoke impact', () => {
  const { world, state } = scene({ planes: [{ id: 'tree', at: 2.55 }] });
  let calls = 0;
  world.impact = () => {
    calls++;
    throw new Error('not an actual movement');
  };
  const s = state(0),
    next = { ...pose(s), position: [0, height, 1] };
  try {
    assert(
      world.sweep({
        from: s,
        to: next,
        shape,
        ignoreSurfaceId: s.contact.surfaceId,
      }),
    );
    assert(
      world.fitGround({
        pose: s,
        shape,
        maxAdjustmentM: 0.05,
        preferredSurfaceId: s.contact.surfaceId,
      }),
    );
    assert.equal(
      world.fitGround({
        pose: next,
        shape,
        maxAdjustmentM: 0.05,
        preferredSurfaceId: s.contact.surfaceId,
      }),
      null,
    );
    stepTesla(s, {}, 0, world, shape);
    s.parked = true;
    for (let i = 0; i < 30; i++) stepTesla(s, {}, 1 / 120, world, shape);
    assert.equal(calls, 0);
    assert(s.parked);
  } finally {
    world.dispose();
  }
});

test('an energy-gaining or nonfinite response fails closed before accepting movement', () => {
  for (const velocity of [
    [0, 0, 1000],
    [NaN, 0, 0],
  ]) {
    const { world, state } = scene({ planes: [{ id: 'tree', at: 2.55 }] });
    const s = state(),
      original = pose(s);
    world.impact = () => ({ velocity, passThrough: true });
    try {
      const report = stepTesla(s, {}, 1 / 120, world, shape);
      assert.equal(report.environmentFailures, 1);
      assert.deepEqual(s.position, original.position);
      assert.deepEqual(s.velocity, [0, 0, 0]);
    } finally {
      world.dispose();
    }
  }
});

test('a faulty environment sentinel is blocked without presenting it as a physical impact', () => {
  const { world, state } = scene();
  const s = state();
  let calls = 0;
  world.sweep = ({ from, to }) =>
    to.position[2] > from.position[2] + 1e-9
      ? {
          surfaceId: 'tesla:invalid-query',
          kind: 'obstacle',
          point: from.position,
          normal: [0, 0, -1],
          adherable: false,
          fraction: 0,
        }
      : null;
  world.impact = () => {
    calls++;
    return null;
  };
  try {
    stepTesla(s, {}, 1 / 120, world, shape);
    assert.equal(calls, 0);
    close(s.position[2], 0);
  } finally {
    world.dispose();
  }
});

test('barrier alignment cannot turn the full body through an obstructed rotation', () => {
  const heading = 0.4,
    at =
      Math.cos(heading) * (shape.halfExtents[0] + shape.clearance) +
      Math.sin(heading) * (shape.halfExtents[2] + shape.clearance) +
      0.025,
    { world, state } = scene({ planes: [{ id: 'rail', axis: 'x', at }] }),
    s = state(40, heading),
    original = pose(s),
    baseSweep = world.sweep.bind(world);
  let blockedRotations = 0;
  world.sweep = (q) => {
    const distance = Math.hypot(
        ...q.to.position.map((v, i) => v - q.from.position[i]),
      ),
      changedQ = q.to.quaternion.some(
        (v, i) => Math.abs(v - q.from.quaternion[i]) > 1e-7,
      );
    if (distance < 1e-9 && changedQ) {
      blockedRotations++;
      return {
        surfaceId: 'rotation-obstacle',
        kind: 'obstacle',
        point: q.from.position,
        normal: [-1, 0, 0],
        adherable: false,
        fraction: 0,
      };
    }
    return baseSweep(q);
  };
  world.impact = ({ hit, velocity }) => {
    const result = resolveVehicleImpact({
      velocity,
      normal: hit.normal,
      massKg: 2000,
      obstacle: { id: 'rail', kind: 'guardrail' },
    });
    return { velocity: result.velocity, passThrough: false };
  };
  try {
    const report = stepTesla(s, {}, 1 / 120, world, shape);
    assert(report.collisions > 0);
    assert(
      blockedRotations > 0,
      'the proposed change of heading was actually swept',
    );
    for (let i = 0; i < 4; i++)
      close(s.quaternion[i], original.quaternion[i], 1e-12);
    assert(s.position[0] < at);
  } finally {
    world.dispose();
  }
});

test('optional mechanical condition keeps pristine defaults exact and scales ground boost acceleration and speed', () => {
  const a = scene(),
    b = scene(),
    sa = a.state(0),
    sb = b.state(0);
  try {
    for (let i = 0; i < 30; i++) {
      assert.deepEqual(
        stepTesla(sa, { throttle: 1, boost: true }, 1 / 120, a.world, shape),
        stepTesla(
          sb,
          { throttle: 1, boost: true, drivePower: 1, driveSpeedFactor: 1 },
          1 / 120,
          b.world,
          shape,
        ),
      );
      assert.deepEqual(sa, sb);
    }
    const pristine = a.state(0),
      damaged = b.state(0);
    stepTesla(pristine, { throttle: 1, boost: true }, 1 / 120, a.world, shape);
    stepTesla(
      damaged,
      { throttle: 1, boost: true, drivePower: 0.55, driveSpeedFactor: 0.65 },
      1 / 120,
      b.world,
      shape,
    );
    close(damaged.velocity[2] / pristine.velocity[2], 0.55);
    const fast = b.state(100);
    stepTesla(
      fast,
      { throttle: 1, boost: true, drivePower: 0.55, driveSpeedFactor: 0.65 },
      1 / 120,
      b.world,
      shape,
    );
    assert(fast.velocity[2] <= 65 + 1e-9);
  } finally {
    a.world.dispose();
    b.world.dispose();
  }
});
