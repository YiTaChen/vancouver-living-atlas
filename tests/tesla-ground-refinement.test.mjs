import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { TESLA_DEFAULT_SHAPE: shape } = await import(cityModule('tesla-state'));
function profileFaces() {
  const knots = [
    [-100, 0],
    [0, 0],
    [4, 0.64],
    [8, 0.64],
    [12, 0],
    [16, 0],
    [20, 0.64],
    [24, 0.64],
    [28, 0],
    [200, 0],
  ];
  return knots.slice(1).flatMap(([z1, y1], i) => {
    const [z0, y0] = knots[i],
      vertices = [
        [-50, y0, z0],
        [50, y0, z0],
        [50, y1, z1],
        [-50, y1, z1],
      ];
    return [
      [0, 1, 2],
      [0, 2, 3],
    ].map((indices, j) =>
      triangleFace(
        `road:${i}`,
        `road:${i}:${j}`,
        'ground',
        indices.map((n) => vertices[n]),
        true,
        'ground:0',
        [0, 1, -(y1 - y0) / (z1 - z0)],
      ),
    );
  });
}
const worldFor = (faces, World = TeslaWorld) =>
  new World({ sources: [fixedFacesSource('physical-ground', faces)] });
const fit = (world, pose, maxAdjustmentM = 0.35, accepts) =>
  world.fitGround(
    { pose, shape, preferredSurfaceId: 'road:0', maxAdjustmentM },
    accepts,
  );
const fallbackPose = {
  position: [0, 0.9131128630750251, 0.8926149097496877],
  quaternion: [-0.06813405655623363, 0, 0, 0.997676175087484],
};

test('a legal requested frame survives a sixteen-percent crease with the nearest feasible height above or below the request', () => {
  const world = worldFor(profileFaces());
  try {
    for (const sign of [-1, 1])
      for (const dy of [-0.04, 0.04]) {
        const requested = {
          position: [
            0,
            fallbackPose.position[1] + dy,
            fallbackPose.position[2],
          ],
          quaternion: fallbackPose.quaternion.map((n) => n * sign),
        };
        const result = fit(world, requested);
        assert(result);
        assert(
          Math.abs(
            Math.abs(
              result.pose.quaternion.reduce(
                (sum, n, i) => sum + n * requested.quaternion[i],
                0,
              ),
            ) - 1,
          ) < 1e-12,
          'the fallback never invents a new pitch or roll',
        );
        assert(
          Math.abs(result.pose.position[1] - fallbackPose.position[1]) < 1e-9,
        );
        assert((result.pose.position[1] - requested.position[1]) * dy < 0);
        const support = world.support({
          pose: result.pose,
          shape,
          maxDistance: 1.03,
          preferredSurfaceId: result.contact.surfaceId,
          adhesion: false,
        });
        assert(support);
        assert.equal(
          world.sweep({
            from: result.pose,
            to: result.pose,
            shape,
            ignoreSurfaceId: support.surfaceId,
          }),
          null,
        );
        assert.equal(
          fit(world, requested, 0),
          null,
          'a needed correction cannot escape an exhausted adjustment budget',
        );
      }
    assert.equal(
      fit(world, { ...fallbackPose, position: [0, Number.NaN, 0] }),
      null,
    );
    assert.equal(
      fit(world, fallbackPose, 0.35, () => false),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('fixed-frame fitting rejects missing physical tyres, incompatible wheel heights and actual body obstacles', () => {
  for (const failure of [
    'missing',
    'disabled',
    'nonadherable',
    'layer',
    'wheel-interval',
    'body',
    'ceiling',
  ]) {
    const faces = profileFaces();
    if (['missing', 'disabled', 'nonadherable', 'layer'].includes(failure)) {
      const front = faces.filter((face) => face.surfaceId === 'road:1');
      if (failure === 'missing')
        for (const face of front)
          face.triangle = face.triangle.map((p) => [p[0] + 1000, p[1], p[2]]);
      if (failure === 'disabled')
        for (const face of front) face.enabled = () => false;
      if (failure === 'nonadherable')
        for (const face of front) face.adherable = false;
      if (failure === 'layer')
        for (const face of front) face.supportGroup = 'protected:other:1';
    } else if (failure === 'wheel-interval') {
      // A small real raised patch lies under one tyre. Three floor heights stay
      // unchanged, so neither one plane nor the requested frame has 5cm travel.
      const x = 0.896,
        z = 2.2,
        vertices = [
          [x - 0.2, 0.5, z - 0.3],
          [x + 0.2, 0.5, z - 0.3],
          [x + 0.2, 0.5, z + 0.3],
          [x - 0.2, 0.5, z + 0.3],
        ];
      for (const [i, ix] of [
        [0, [0, 1, 2]],
        [1, [0, 2, 3]],
      ])
        faces.push(
          triangleFace(
            `raised-wheel:${String(i)}`,
            `raised-wheel:${String(i)}`,
            'ground',
            ix.map((n) => vertices[n]),
            true,
            'ground:0',
            [0, 1, 0],
          ),
        );
    } else {
      if (failure === 'body') {
        faces.push(
          triangleFace(
            'physical-obstacle:0',
            'physical-obstacle:0',
            'obstacle',
            [
              [0, -1, -10],
              [0, 3, -10],
              [0, 3, 10],
            ],
            false,
            'obstacle',
            [-1, 0, 0],
          ),
        );
        faces.push(
          triangleFace(
            'physical-obstacle:1',
            'physical-obstacle:1',
            'obstacle',
            [
              [0, -1, -10],
              [0, 3, 10],
              [0, -1, 10],
            ],
            false,
            'obstacle',
            [-1, 0, 0],
          ),
        );
      } else
        faces.push(
          triangleFace(
            'physical-ceiling',
            'physical-ceiling',
            'obstacle',
            [
              [-10, 1, -10],
              [10, 1, -10],
              [0, 1, 10],
            ],
            false,
            'obstacle',
            [0, -1, 0],
          ),
        );
    }
    const world = worldFor(faces);
    try {
      assert.equal(
        fit(world, fallbackPose, 0.35, (face) => face.kind === 'ground'),
        null,
        failure,
      );
    } finally {
      world.dispose();
    }
  }
});

const clearTurn = {
  from: {
    position: [0, 1.186111068893996, 8.358728409247792],
    quaternion: [0.035944862691106055, 0, 0, 0.9993537746194376],
  },
  to: {
    position: [0, 1.1828860143581823, 8.358728409247792],
    quaternion: [0.04760129400360363, 0, 0, 0.9988664158981333],
  },
  shape,
  ignoreSurfaceId: 'road:2',
};

test('bounded analytic time intervals clear a real finite crest turn with either quaternion sign', async () => {
  const world = worldFor(profileFaces());
  try {
    for (const sign of [-1, 1]) {
      const query = {
        ...clearTurn,
        from: {
          ...clearTurn.from,
          quaternion: clearTurn.from.quaternion.map((n) => n * sign),
        },
        to: {
          ...clearTurn.to,
          quaternion: clearTurn.to.quaternion.map((n) => n * sign),
        },
      };
      assert.equal(world.sweep(query), null);
    }
    const sourceUrl = cityModule('tesla-world');
    const code = Buffer.from(sourceUrl.split(',')[1], 'base64').toString();
    assert(code.includes('let remaining = 127;'));
    const limitedCode = code.replace(
      'let remaining = 127;',
      'let remaining = 0;',
    );
    const { TeslaWorld: LimitedWorld } = await import(
      'data:text/javascript;base64,' +
        Buffer.from(limitedCode).toString('base64')
    );
    const limited = worldFor(profileFaces(), LimitedWorld);
    try {
      assert(
        limited.sweep(clearTurn),
        'without a complete interval proof the original conservative collision remains',
      );
    } finally {
      limited.dispose();
    }
    const blocked = {
      ...clearTurn,
      from: {
        ...clearTurn.from,
        position: [0, 0.9, clearTurn.from.position[2]],
      },
    };
    assert(
      world.sweep(blocked),
      'a real initial body overlap never becomes permission to rotate out',
    );
  } finally {
    world.dispose();
  }
});
