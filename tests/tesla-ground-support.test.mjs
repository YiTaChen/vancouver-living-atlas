import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { TESLA_DEFAULT_SHAPE: shape } = await import(cityModule('tesla-state'));
const { teslaFrame, teslaRotate } = await import(cityModule('tesla-math'));
const height = shape.halfExtents[1] + shape.clearance;
const flat = { position: [0, height, 0], quaternion: [0, 0, 0, 1] };
function rectangle(id, x0, x1, z0, z1, options = {}) {
  const {
    grade = 0,
    kind = 'ground',
    group = 'ground:0',
    adherable = true,
    y = 0,
  } = options;
  const vertices = [
    [x0, y + grade * z0, z0],
    [x0, y + grade * z1, z1],
    [x1, y + grade * z1, z1],
    [x1, y + grade * z0, z0],
  ];
  return [
    [0, 1, 2],
    [0, 2, 3],
  ].map((indices, i) =>
    triangleFace(
      `${id}:${i}`,
      `${id}:${i}`,
      kind,
      indices.map((n) => vertices[n]),
      adherable,
      group,
      [0, 1, -grade],
    ),
  );
}
function worldFor(faces) {
  return new TeslaWorld({ sources: [fixedFacesSource('actual-floor', faces)] });
}
const query = (pose = flat, model = shape) => ({
  pose,
  shape: model,
  maxDistance: height + 0.35,
  adhesion: false,
});
function holeFaces(x, z, size = 0.001, options = {}) {
  const a = x - size / 2,
    b = x + size / 2,
    c = z - size / 2,
    d = z + size / 2;
  return [
    ...rectangle('left', -10, a, -10, 10, options),
    ...rectangle('right', b, 10, -10, 10, options),
    ...rectangle('rear', a, b, -10, c, options),
    ...rectangle('front', a, b, d, 10, options),
  ];
}

test('ordinary model tyres can support clear body overhang while legacy, roof and protected footprints stay complete', () => {
  for (const [kind, group, model, allowed] of [
    ['ground', 'ground:0', shape, true],
    [
      'ground',
      'ground:0',
      { halfExtents: shape.halfExtents, clearance: shape.clearance },
      false,
    ],
    ['roof', 'roof:0', shape, false],
    ['ground', 'protected:bridge:1', shape, false],
  ]) {
    const faces = rectangle('narrow-floor', -1, 1, -1.5, 1.5, { kind, group });
    const world = worldFor(faces);
    try {
      const proof = world.support(query(flat, model));
      assert.equal(
        !!proof,
        allowed,
        `${kind}/${group}/${!!model.groundSupport}`,
      );
      if (proof) {
        assert.equal(
          world.sweep({
            from: flat,
            to: flat,
            shape: model,
            ignoreSurfaceId: proof.surfaceId,
          }),
          null,
        );
        assert.equal(proof.point[1], 0);
        assert.deepEqual(proof.normal, [0, 1, 0]);
      }
    } finally {
      world.dispose();
    }
  }
});

test('each actual tyre rejects a one-millimetre physical hole under a pitched frame and either quaternion sign', () => {
  const grade = 0.06;
  const normal = [0, 1 / Math.hypot(1, grade), -grade / Math.hypot(1, grade)];
  const pose = {
    position: normal.map((n) => n * height),
    quaternion: teslaFrame(normal, [0.4, grade, 1]).quaternion,
  };
  for (const wheel of shape.groundSupport.wheelContacts) {
    const rotated = teslaRotate(pose.quaternion, wheel);
    const point = rotated.map((value, i) => value + pose.position[i]);
    const world = worldFor(holeFaces(point[0], point[2], 0.001, { grade }));
    try {
      for (const sign of [-1, 1]) {
        const actual = {
          ...pose,
          quaternion: pose.quaternion.map((n) => n * sign),
        };
        assert.equal(
          world.support(query(actual)),
          null,
          `missing real tyre at ${point}`,
        );
        assert.equal(
          world.fitGround({
            pose: actual,
            shape,
            preferredSurfaceId: 'left:0',
            maxAdjustmentM: 0.35,
          }),
          null,
        );
      }
    } finally {
      world.dispose();
    }
  }
});

test('the tyre rectangle still proves continuous interior floor and cannot bridge a millimetre hole between wheel probes', () => {
  const world = worldFor(holeFaces(0.2, 0.3));
  try {
    assert.equal(world.support(query()), null);
    assert.equal(
      world.fitGround({
        pose: flat,
        shape,
        preferredSurfaceId: 'left:0',
        maxAdjustmentM: 0.35,
      }),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('a tyre or interior floor excluded, disabled, nonadherable or moved to another layer never inherits ordinary support', () => {
  for (const variant of [
    'reject',
    'disabled',
    'nonadherable',
    'protected',
    'roof',
  ]) {
    const quadrants = [
      ...rectangle('rear-left', -5, 0, -5, 0),
      ...rectangle('rear-right', 0, 5, -5, 0),
      ...rectangle('front-left', -5, 0, 0, 5),
      ...rectangle('front-right', 0, 5, 0, 5),
    ];
    const removed = quadrants.filter((face) =>
      face.surfaceId.startsWith('front-right:'),
    );
    if (variant === 'disabled')
      for (const face of removed) face.enabled = () => false;
    if (variant === 'nonadherable')
      for (const face of removed) face.adherable = false;
    if (variant === 'protected')
      for (const face of removed) face.supportGroup = 'protected:other:1';
    if (variant === 'roof')
      for (const face of removed) {
        face.kind = 'roof';
        face.supportGroup = 'roof:other';
      }
    const world = worldFor(quadrants);
    try {
      assert.equal(
        world.support(
          query(),
          variant === 'reject'
            ? (face) => !face.surfaceId.startsWith('front-right:')
            : undefined,
        ),
        null,
        variant,
      );
    } finally {
      world.dispose();
    }
  }
});

test('a clear tyre support area never grants body clearance through overhang obstacles, ceilings or raised ground', () => {
  const floor = rectangle('small-floor', -1, 1, -1.5, 1.5);
  for (const variant of ['body-overhang', 'ceiling', 'raised-ground']) {
    const extra =
      variant === 'body-overhang'
        ? [
            triangleFace(
              'overhang-solid',
              'overhang-solid',
              'obstacle',
              [
                [1.1, 0.2, -4],
                [1.1, 3, -4],
                [1.1, 3, 4],
              ],
              false,
              'obstacle',
              [-1, 0, 0],
            ),
          ]
        : variant === 'ceiling'
          ? rectangle('physical-ceiling', -5, 5, -5, 5, {
              kind: 'obstacle',
              group: 'obstacle',
              adherable: false,
              y: 1,
            })
          : rectangle('true-raised-ground', -0.5, 0.5, -0.3, 0.3, {
              y: 0.2,
              adherable: false,
            });
    const world = worldFor([...floor, ...extra]);
    try {
      const proof = world.support(query());
      assert(proof, 'support and actual-body clearance remain separate proofs');
      const hit = world.sweep({
        from: flat,
        to: flat,
        shape,
        ignoreSurfaceId: proof.surfaceId,
      });
      assert(hit, variant);
      assert.equal(hit.fraction, 0, variant);
    } finally {
      world.dispose();
    }
  }
});

test('asymmetric authored tyre bounds use their real offset and degenerate support rectangles fail closed', () => {
  const offset = {
    ...shape,
    groundSupport: {
      ...shape.groundSupport,
      wheelContacts: shape.groundSupport.wheelContacts.map((p) => [
        p[0] + 0.1,
        p[1],
        p[2] + 0.2,
      ]),
    },
  };
  const world = worldFor(
    rectangle('offset-tyre-floor', -0.806, 1.006, -1.2, 1.6),
  );
  try {
    assert(world.support(query(flat, offset)));
    const degenerate = {
      ...shape,
      groundSupport: {
        ...shape.groundSupport,
        wheelContacts: shape.groundSupport.wheelContacts.map((p) => [
          0,
          p[1],
          p[2],
        ]),
      },
    };
    assert.equal(world.support(query(flat, degenerate)), null);
  } finally {
    world.dispose();
  }
});

test('an overhead ordinary triangle cannot borrow the lower tyres and claim their supported floor', () => {
  const world = worldFor([
    ...rectangle('actual-lower-floor', -10, 10, -10, 10),
    // The finite face stays clear of all tyres and the body; only its infinite
    // extension passes above the chassis and near the preferred source probe.
    ...rectangle('overhead-ground', -1, 1, 2, 4, { y: 1.5, grade: 0.1 }),
  ]);
  try {
    const proof = world.support({
      ...query(),
      preferredSurfaceId: 'overhead-ground:0',
    });
    assert(proof);
    assert(proof.surfaceId.startsWith('actual-lower-floor:'));
    assert.equal(proof.point[1], 0);
    assert.deepEqual(proof.normal, [0, 1, 0]);
    assert.equal(
      world.sweep({
        from: flat,
        to: flat,
        shape,
        ignoreSurfaceId: proof.surfaceId,
      }),
      null,
    );
  } finally {
    world.dispose();
  }
});
