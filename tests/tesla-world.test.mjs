import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { CityTeslaWorld, teslaPrismSource, teslaMeshSource } = await import(
  cityModule('tesla-city-world')
);
const { TravelSurfaceIndex } = await import(cityModule('travel-surfaces'));
const { WaterWorld } = await import(cityModule('water-world'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const { planPitchedRoof, pitchedRoofTriangles } = await import(
  cityModule('building-roof')
);
const shape = { halfExtents: [1.04, 0.62, 2.34], clearance: 0.06 };
const pose = (x, y, z, normal = [0, 1, 0]) => {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(...normal),
  );
  return { position: [x, y, z], quaternion: [q.x, q.y, q.z, q.w] };
};
const polygon = [
  [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
];
const prism = (overrides = {}) =>
  teslaPrismSource({
    id: 'building:fixture',
    polygon,
    minY: 0,
    maxY: 10,
    ...overrides,
  });

test('translating away from an exact roof edge clears t=0 contact while inward, overlapping and rotating hulls still collide', () => {
  const face = triangleFace(
    'roof-edge',
    'roof-edge:0',
    'roof',
    [
      [0, 0, 0],
      [20, 0, 0],
      [0, 0, 20],
    ],
    true,
    'roof-edge',
    [0, 1, 0],
  );
  const world = new TeslaWorld({
    sources: [fixedFacesSource('roof-edge', [face])],
  });
  const edgeX = -shape.halfExtents[0] - shape.clearance;
  const from = pose(edgeX, -0.4, 5);
  try {
    assert.equal(sweep(world, from, pose(edgeX - 1, -0.4, 5)), null);
    assert.equal(
      sweep(world, from, pose(edgeX + 1, -0.4, 5))?.fraction,
      0,
      'entering the roof from the same boundary still collides',
    );
    assert.equal(
      sweep(world, pose(edgeX + 0.001, -0.4, 5), pose(edgeX - 1, -0.4, 5))
        ?.fraction,
      0,
      'a real initial overlap is not excused by outward velocity',
    );
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      0.1,
    );
    assert(
      sweep(world, from, {
        position: from.position,
        quaternion: [q.x, q.y, q.z, q.w],
      }),
      'rotation into the edge retains the complete angular envelope',
    );
    const fast = sweep(world, pose(-20, -0.4, 5), pose(20, -0.4, 5));
    assert(fast && fast.fraction > 0 && fast.fraction < 1);
  } finally {
    world.dispose();
  }
});

test('actual building 2281 roof tangent permits a fixed wall-frame outward step and still blocks its reverse', () => {
  const sample = JSON.parse(
    readFileSync(
      new URL('./fixtures/tesla-real-departure.json', import.meta.url),
    ),
  );
  const face = sample.wall.faces.find(
    (face) => face.triangleId === 'building:2281:roof:2',
  );
  assert(face);
  const world = new TeslaWorld({
    sources: [
      fixedFacesSource('actual-roof-edge', [
        triangleFace(
          face.surfaceId,
          face.triangleId,
          face.kind,
          face.triangle,
          face.adherable,
          face.supportGroup,
          face.normal,
        ),
      ]),
    ],
  });
  const quaternion = [
    -0.6561384789268586, 0.2743381937700839, 0.26359494773524844,
    0.6517196908479657,
  ];
  const from = {
    position: [249.20809555815705, 45.3351843641063, 147.30499932716143],
    quaternion,
  };
  const to = {
    position: [249.1494632476539, 45.3351843641063, 147.24578195969625],
    quaternion,
  };
  const actualShape = { halfExtents: [1.14, 0.62, 2.34], clearance: 0.06 };
  try {
    assert.equal(world.sweep({ from, to, shape: actualShape }), null);
    const inward = {
      position: from.position.map((v, i) => 2 * v - to.position[i]),
      quaternion,
    };
    const entering = world.sweep({ from, to: inward, shape: actualShape });
    assert(entering && entering.fraction >= 0 && entering.fraction < 1e-10);
    const overlapped = {
      position: from.position.map((v, i) => v + (v - to.position[i]) * 0.012),
      quaternion,
    };
    assert.equal(
      world.sweep({ from: overlapped, to, shape: actualShape })?.fraction,
      0,
    );
  } finally {
    world.dispose();
  }
});

test('ordinary ground joins only Float32-scale seams while millimetre holes, excluded peers and strict deck or roof gaps remain unsupported', () => {
  const rectangleFaces = (id, x0, x1, kind, group) => {
    const a = [x0, 0, -10],
      b = [x0, 0, 10],
      c = [x1, 0, 10],
      d = [x1, 0, -10];
    return [
      triangleFace(`${id}:0`, `${id}:0`, kind, [a, b, c], true, group),
      triangleFace(`${id}:1`, `${id}:1`, kind, [a, c, d], true, group),
    ];
  };
  for (const [gap, kind, group, allowed] of [
    [0.0000024, 'ground', 'ground:0', true],
    [0.001, 'ground', 'ground:0', false],
    [0.01, 'ground', 'ground:0', false],
    [0.001, 'ground', 'protected:bridge:1', false],
    [0.001, 'roof', 'roof', false],
  ]) {
    const halfGap = Number(gap) / 2;
    const faces = [
      ...rectangleFaces('left', -10, -halfGap, kind, group),
      ...rectangleFaces('right', halfGap, 10, kind, group),
    ];
    const world = new TeslaWorld({
      sources: [fixedFacesSource('seamed-source', faces)],
    });
    const query = {
      pose: pose(-0.5, 0.68, 0),
      shape,
      maxDistance: 1,
      adhesion: true,
    };
    try {
      assert.equal(!!world.support(query), allowed, `${group}, ${gap}m gap`);
      assert.equal(
        world.support(query, (face) => face.surfaceId.startsWith('left:')),
        null,
        'ordinary seam tolerance never restores a caller-excluded peer',
      );
    } finally {
      world.dispose();
    }
  }
});

test('proven ordinary tyre suspension clears nonadherable low paving without granting support or excusing steps, walls and other layers', () => {
  const ordinaryFloor = () => {
    const floor = ground();
    for (const face of floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -100, -100),
        new THREE.Vector3(100, 100, 100),
      ),
    ))
      face.supportGroup = 'ground:0';
    return floor;
  };
  const lowPaving = (kind, group, height) =>
    fixedFacesSource('paving', [
      triangleFace(
        'paving:0',
        'paving:0',
        kind,
        [
          [-8, height, -8],
          [-8, height, 8],
          [8, height, 8],
        ],
        false,
        group,
        [0, 1, 0],
      ),
      triangleFace(
        'paving:1',
        'paving:1',
        kind,
        [
          [-8, height, -8],
          [8, height, 8],
          [8, height, -8],
        ],
        false,
        group,
        [0, 1, 0],
      ),
    ]);
  for (const [kind, group, height, hasFloor, shouldBlock] of [
    ['ground', 'ground:0', 0.02, true, false],
    ['ground', 'ground:0', 0.08, true, true],
    ['ground', 'ground:0', 0.02, false, true],
    ['ground', 'protected:bridge:1', 0.02, true, true],
    ['roof', 'roof', 0.02, true, true],
    ['obstacle', 'water:fixture', 0.02, true, true],
  ]) {
    const floor = ordinaryFloor();
    const world = new TeslaWorld({
      sources: [
        ...(hasFloor ? [floor] : []),
        lowPaving(kind, group, Number(height)),
      ],
    });
    try {
      assert.equal(
        !!sweep(world, pose(0, 0.68, -1), pose(0, 0.68, 1), {
          ignoreSurfaceId: 'floor:-40:-40:0:0',
        }),
        shouldBlock,
        `${kind}/${group}, ${height}m, real support=${hasFloor}`,
      );
      assert.equal(
        world.support(
          {
            pose: pose(0, Number(height) + 0.68, 0),
            shape,
            maxDistance: 1,
            adhesion: true,
          },
          (face) => face.surfaceId.startsWith('paving:'),
        ),
        null,
        'nonadherable paving never supplies support',
      );
    } finally {
      world.dispose();
    }
  }
  const floor = ordinaryFloor();
  const world = new TeslaWorld({
    sources: [
      floor,
      fixedFacesSource('steep-ground-wall', [
        triangleFace(
          'steep-ground-wall',
          'steep-ground-wall:0',
          'ground',
          [
            [-8, 0, 0],
            [8, 0, 0],
            [0, 4, 0],
          ],
          false,
          'ground:0',
          [0, 0, -1],
        ),
      ]),
    ],
  });
  try {
    assert(
      sweep(world, pose(0, 0.68, -4), pose(0, 0.68, 4), {
        ignoreSurfaceId: 'floor:-40:-40:0:0',
      }),
      'the same proven support never removes a substantial steep ground face',
    );
  } finally {
    world.dispose();
  }
});

test('four actual model wheel contacts propose a bounded real-ground frame while support still validates the given pose', () => {
  const modelShape = createTeslaRoadsterShape(),
    slope = 0.04,
    vertices = [
      [-20, -20 * slope, -20],
      [-20, -20 * slope, 20],
      [20, 20 * slope, 20],
      [20, 20 * slope, -20],
    ],
    faces = [
      triangleFace(
        'fit:0',
        'fit:0',
        'ground',
        vertices.slice(0, 3),
        true,
        'ground:0',
      ),
      triangleFace(
        'fit:1',
        'fit:1',
        'ground',
        [vertices[0], vertices[2], vertices[3]],
        true,
        'ground:0',
      ),
    ],
    world = new TeslaWorld({ sources: [fixedFacesSource('fit', faces)] }),
    query = {
      pose: pose(0, 0.88, 0),
      shape: modelShape,
      preferredSurfaceId: 'fit:0',
      maxAdjustmentM: 0.35,
    },
    before = structuredClone(query);
  try {
    assert.equal(
      world.support({ ...query, maxDistance: 1.2, adhesion: false }),
      null,
      'a chassis 20cm above its wheel contacts has no current suspension proof',
    );
    const fitted = world.fitGround(query);
    assert(fitted);
    assert.deepEqual(query, before);
    assert(fitted.pose.position[1] < query.pose.position[1] - 0.1);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(...fitted.pose.quaternion),
    );
    assert(up.distanceTo(new THREE.Vector3(-slope, 1, 0).normalize()) < 1e-6);
    const actual = faces.find(
      (face) => face.surfaceId === fitted.contact.surfaceId,
    );
    assert(actual);
    assert.deepEqual(fitted.contact.normal, actual.normal);
    assert(
      new THREE.Triangle(...actual.triangle.map((p) => new THREE.Vector3(...p)))
        .closestPointToPoint(
          new THREE.Vector3(...fitted.contact.point),
          new THREE.Vector3(),
        )
        .distanceTo(new THREE.Vector3(...fitted.contact.point)) < 1e-7,
    );
    assert(
      world.support({
        pose: fitted.pose,
        shape: modelShape,
        maxDistance: 1.2,
        adhesion: false,
      }),
    );
    assert.equal(world.fitGround({ ...query, maxAdjustmentM: 0.05 }), null);
    assert.equal(
      world.fitGround(query, (face) => face.surfaceId !== 'fit:1'),
      null,
    );
    for (const face of faces) face.enabled = () => false;
    assert.equal(world.fitGround(query), null);
  } finally {
    world.dispose();
  }
});

test('wheel fitting never invents a roof, protected layer, narrow-hole floor or motion through a real body obstacle', () => {
  const modelShape = createTeslaRoadsterShape();
  for (const group of ['protected:bridge:1', 'roof']) {
    const floor = ground(0, -40, -40, 80, group === 'roof' ? 'roof' : 'ground');
    const faces = floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -1, -100),
        new THREE.Vector3(100, 1, 100),
      ),
    );
    for (const face of faces) face.supportGroup = group;
    const world = new TeslaWorld({ sources: [floor] });
    try {
      assert.equal(
        world.fitGround({
          pose: pose(0, 0.68, 0),
          shape: modelShape,
          preferredSurfaceId: faces[0].surfaceId,
          maxAdjustmentM: 0.35,
        }),
        null,
      );
    } finally {
      world.dispose();
    }
  }
  const floors = [-1, 1].flatMap((side) => {
    const x0 = side < 0 ? -10 : 0.0005,
      x1 = side < 0 ? -0.0005 : 10,
      a = [x0, 0, -10],
      b = [x0, 0, 10],
      c = [x1, 0, 10],
      d = [x1, 0, -10];
    return [
      triangleFace(
        `hole:${side}:0`,
        `hole:${side}:0`,
        'ground',
        [a, b, c],
        true,
        'ground:0',
      ),
      triangleFace(
        `hole:${side}:1`,
        `hole:${side}:1`,
        'ground',
        [a, c, d],
        true,
        'ground:0',
      ),
    ];
  });
  const holeWorld = new TeslaWorld({
    sources: [fixedFacesSource('hole', floors)],
  });
  try {
    assert.equal(
      holeWorld.fitGround({
        pose: pose(-0.5, 0.68, 0),
        shape: modelShape,
        preferredSurfaceId: 'hole:-1:0',
        maxAdjustmentM: 0.35,
      }),
      null,
    );
  } finally {
    holeWorld.dispose();
  }
  const floor = ground();
  const floorFaces = floor.load(
    new THREE.Box3(
      new THREE.Vector3(-100, -1, -100),
      new THREE.Vector3(100, 1, 100),
    ),
  );
  for (const face of floorFaces) face.supportGroup = 'ground:0';
  const world = new TeslaWorld({
    sources: [
      floor,
      fixedFacesSource('body-obstacle', [
        triangleFace(
          'body-obstacle',
          'body-obstacle',
          'obstacle',
          [
            [-8, 0, 0],
            [8, 0, 0],
            [0, 8, 0],
          ],
          false,
          'obstacle',
          [0, 0, -1],
        ),
      ]),
    ],
  });
  try {
    const fitted = world.fitGround({
      pose: pose(0, 0.68, 0),
      shape: modelShape,
      preferredSurfaceId: floorFaces[0].surfaceId,
      maxAdjustmentM: 0.35,
    });
    assert.equal(
      fitted,
      null,
      'a fitted frame cannot authorize a pose already inside a physical wall',
    );
  } finally {
    world.dispose();
  }
});

test('model ground body preserves measured rear clearance and front curb clearance independently of wheel suspension travel', () => {
  const modelShape = createTeslaRoadsterShape();
  for (const [height, z, shouldBlock] of [
    [0.07, -2.25, false],
    [0.1, -2.25, true],
    [0.12, -2.25, true],
    [0.13, 2.25, false],
    [0.16, 2.25, true],
  ]) {
    const floor = ground();
    const floorFaces = floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -1, -100),
        new THREE.Vector3(100, 1, 100),
      ),
    );
    for (const face of floorFaces) face.supportGroup = 'ground:0';
    const a = [-0.2, height, Number(z) - 0.04],
      b = [-0.2, height, Number(z) + 0.04],
      c = [0.2, height, Number(z) + 0.04],
      d = [0.2, height, Number(z) - 0.04];
    const world = new TeslaWorld({
      sources: [
        floor,
        fixedFacesSource('rear-ridge', [
          triangleFace(
            'rear-ridge:0',
            'rear-ridge:0',
            'ground',
            [a, b, c],
            false,
            'ground:0',
          ),
          triangleFace(
            'rear-ridge:1',
            'rear-ridge:1',
            'ground',
            [a, c, d],
            false,
            'ground:0',
          ),
        ]),
      ],
    });
    const p = pose(0, 0.68, 0);
    try {
      assert(
        world.support({
          pose: p,
          shape: modelShape,
          maxDistance: 1,
          adhesion: false,
        }),
        'all four actual tyres still contact the flat floor',
      );
      assert.equal(
        !!world.sweep({
          from: p,
          to: p,
          shape: modelShape,
          ignoreSurfaceId: floorFaces[0].surfaceId,
        }),
        shouldBlock,
        `${height}m ridge under body section at z=${z}`,
      );
    } finally {
      world.dispose();
    }
  }
});

test('minimum ground heave uses only available wheel travel and measured body clearance, retaining ceiling and over-travel collisions', () => {
  const modelShape = createTeslaRoadsterShape();
  for (const [height, ceiling, expectedHeave] of [
    [0, false, 0],
    [0.1, false, 0.02],
    [0.12, false, 0.04],
    [0.14, false, null],
    [0.1, true, null],
  ]) {
    const floor = ground(),
      floorFaces = floor.load(
        new THREE.Box3(
          new THREE.Vector3(-100, -1, -100),
          new THREE.Vector3(100, 1, 100),
        ),
      );
    for (const face of floorFaces) face.supportGroup = 'ground:0';
    const extras = [];
    if (height > 0)
      extras.push(
        triangleFace(
          'ridge',
          'ridge:0',
          'ground',
          [
            [-0.2, height, -2.3],
            [-0.2, height, -2.2],
            [0.2, height, -2.2],
          ],
          false,
          'ground:0',
        ),
        triangleFace(
          'ridge',
          'ridge:1',
          'ground',
          [
            [-0.2, height, -2.3],
            [0.2, height, -2.2],
            [0.2, height, -2.3],
          ],
          false,
          'ground:0',
        ),
      );
    if (ceiling)
      extras.push(
        triangleFace(
          'ceiling',
          'ceiling:0',
          'obstacle',
          [
            [-10, 1.37, -10],
            [10, 1.37, -10],
            [10, 1.37, 10],
          ],
          false,
          'ceiling',
        ),
        triangleFace(
          'ceiling',
          'ceiling:1',
          'obstacle',
          [
            [-10, 1.37, -10],
            [10, 1.37, 10],
            [-10, 1.37, 10],
          ],
          false,
          'ceiling',
        ),
      );
    const world = new TeslaWorld({
      sources: [floor, fixedFacesSource('extras', extras)],
    });
    try {
      const initial = pose(0, 0.68, 0),
        result = world.fitGround({
          pose: initial,
          shape: modelShape,
          preferredSurfaceId: floorFaces[0].surfaceId,
          maxAdjustmentM: 0.35,
        });
      if (expectedHeave === null) {
        assert.equal(
          result,
          null,
          `ridge ${height}m / ceiling ${ceiling} cannot fit inside the actual suspension interval`,
        );
        continue;
      }
      assert(result);
      assert(
        Math.abs(result.pose.position[1] - 0.68 - expectedHeave) < 1e-5,
        'choose the smallest feasible source-derived heave rather than always raising the body',
      );
      assert(
        world.support({
          pose: result.pose,
          shape: modelShape,
          maxDistance: 1,
          adhesion: false,
        }),
      );
      assert.equal(
        world.sweep({
          from: result.pose,
          to: result.pose,
          shape: modelShape,
          ignoreSurfaceId: result.contact.surfaceId,
        }),
        null,
      );
      if (height)
        assert(
          world.sweep({
            from: initial,
            to: result.pose,
            shape: modelShape,
            ignoreSurfaceId: result.contact.surfaceId,
          }),
          'a proposal never authorizes motion out of an already intersecting given pose',
        );
    } finally {
      world.dispose();
    }
  }
});

test('strict ground withdrawal preserves fresh wheel and source proof while checking every ordinary body and every other obstacle', () => {
  const modelShape = createTeslaRoadsterShape(),
    floor = ground(),
    floorFaces = floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -1, -100),
        new THREE.Vector3(100, 1, 100),
      ),
    );
  let enabled = true;
  for (const face of floorFaces) {
    face.supportGroup = 'ground:0';
    face.enabled = () => enabled;
  }
  const ridge = triangleFace(
    'low-rear-ridge',
    'low-rear-ridge',
    'ground',
    [
      [-0.3, 0.07, -2.3],
      [0.3, 0.07, -2.3],
      [0, 0.07, -2.1],
    ],
    false,
    'ground:0',
  );
  const world = new TeslaWorld({
    sources: [floor, fixedFacesSource('ridge', [ridge])],
    validPosition: (p) => p[1] <= 2,
  });
  const origin = pose(0, 0.68, 0),
    to = pose(0, 0.88, 0),
    sourceSurfaceId = floorFaces[0].surfaceId;
  const query = {
    origin,
    from: origin,
    to,
    shape: modelShape,
    sourceSurfaceId,
  };
  try {
    assert(
      world.sweep({
        from: origin,
        to,
        shape: modelShape,
        ignoreSurfaceId: sourceSurfaceId,
      }),
      'ordinary air-endpoint sweep retains its complete tyre-plane hull',
    );
    assert.equal(
      world.sweepGroundDeparture(query),
      null,
      'fresh ordinary launch checks the real body instead of inventing material beneath the authored chassis',
    );
    const inverse = { ...to, quaternion: to.quaternion.map((v) => -v) };
    assert.equal(
      world.sweepGroundDeparture({ ...query, to: inverse }),
      null,
      'quaternion signs describe the same fixed physical orientation',
    );
    assert.equal(
      world.sweepGroundDeparture({
        ...query,
        from: pose(0, 0.8, 0),
        to: pose(0, 1.03, 0),
      }),
      null,
      'later strictly vertical segments retain the same fresh origin',
    );
    const rotated = pose(0, 0.88, 0, [0.01, 1, 0]);
    for (const patch of [
      { to: pose(0.001, 0.88, 0) },
      { from: pose(0, 0.78, 0.001) },
      { to: rotated },
      { to: pose(0, 1.031, 0) },
      { from: pose(0, 0.78, 0), to: pose(0, 0.77, 0) },
      { from: pose(0, 0.679, 0) },
      { origin: pose(0, 0.88, 0) },
      { sourceSurfaceId: 'missing' },
      { to: pose(0, NaN, 0) },
      { shape: { ...modelShape, groundSupport: undefined } },
    ])
      assert.equal(
        world.sweepGroundDeparture({ ...query, ...patch })?.fraction,
        0,
        'invalid or unproved withdrawal fails closed',
      );
    enabled = false;
    assert.equal(
      world.sweepGroundDeparture(query)?.fraction,
      0,
      'cached geometry never preserves stale source permission',
    );
    enabled = true;
    assert.equal(world.sweepGroundDeparture(query), null);
    for (const face of floorFaces) face.supportGroup = 'protected:bridge:1';
    assert.equal(
      world.sweepGroundDeparture(query)?.fraction,
      0,
      'protected decks do not acquire ordinary withdrawal permission',
    );
    for (const face of floorFaces) face.supportGroup = 'ground:0';
    ridge.enabled = () => false;
    assert.equal(world.sweepGroundDeparture(query), null);
  } finally {
    world.dispose();
  }
  for (const kind of ['obstacle', 'roof', 'ground']) {
    const groundFloor = ground(),
      faces = groundFloor.load(
        new THREE.Box3(
          new THREE.Vector3(-100, -1, -100),
          new THREE.Vector3(100, 1, 100),
        ),
      );
    for (const face of faces) face.supportGroup = 'ground:0';
    const obstacle = triangleFace(
      'launch-blocker',
      'launch-blocker',
      kind,
      [
        [-8, 1.46, -8],
        [8, 1.46, -8],
        [0, 1.46, 8],
      ],
      false,
      kind === 'ground' ? 'protected:bridge:1' : 'launch-blocker',
    );
    const blockerWorld = new TeslaWorld({
      sources: [groundFloor, fixedFacesSource('launch-blocker', [obstacle])],
    });
    try {
      const hit = blockerWorld.sweepGroundDeparture({
        ...query,
        sourceSurfaceId: faces[0].surfaceId,
        ignoreSurfaceId: obstacle.surfaceId,
      });
      assert.equal(
        hit?.surfaceId,
        'launch-blocker',
        `${kind} keeps its complete physical collision envelope even when the caller asks to ignore it`,
      );
      assert(hit.fraction > 0 && hit.fraction < 1);
    } finally {
      blockerWorld.dispose();
    }
  }
});

test('ordinary departure never ignores material on its exact source and never accepts a body-intersecting origin', () => {
  const modelShape = createTeslaRoadsterShape(),
    floor = ground(),
    floorFaces = floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -1, -100),
        new THREE.Vector3(100, 1, 100),
      ),
    );
  for (const face of floorFaces) face.supportGroup = 'ground:0';
  const sourceSurfaceId = floorFaces[0].surfaceId,
    ridge = triangleFace(
      sourceSurfaceId,
      'same-source-rear-ridge',
      'ground',
      [
        [-0.3, 0.1, -2.3],
        [0.3, 0.1, -2.3],
        [0, 0.1, -2.1],
      ],
      false,
      'ground:0',
    ),
    world = new TeslaWorld({
      sources: [floor, fixedFacesSource('same-source-ridge', [ridge])],
    }),
    origin = pose(0, 0.68, 0);
  try {
    assert(
      world.support({
        pose: origin,
        shape: modelShape,
        maxDistance: 1,
        adhesion: false,
      }),
      'wheel and union proof alone is insufficient body permission',
    );
    const query = {
      from: origin,
      to: pose(0, 0.88, 0),
      origin,
      sourceSurfaceId,
      shape: modelShape,
    };
    assert.equal(world.sweepGroundDeparture(query)?.fraction, 0);
    assert.equal(
      world.sweep({
        from: origin,
        to: origin,
        shape: modelShape,
        ignoreSurfaceId: sourceSurfaceId,
      })?.surfaceId,
      sourceSurfaceId,
      'a fitted source is checked with its actual non-wheel body instead of skipped',
    );
  } finally {
    world.dispose();
  }
});

test('cached source XZ bounds retain wheel height contacts through the full fifty-micrometre edge tolerance and keep permissions live', () => {
  const modelShape = createTeslaRoadsterShape(),
    p = pose(0, 0.68, 0),
    wheel = modelShape.groundSupport.wheelContacts[0];
  for (const axis of [0, 2])
    for (const sign of [-1, 1])
      for (const gap of [0, 49e-6, 49.999e-6, 50e-6, 50.001e-6, 51e-6, 1e-3]) {
        const floor = ground(),
          floorFaces = floor.load(
            new THREE.Box3(
              new THREE.Vector3(-100, -1, -100),
              new THREE.Vector3(100, 1, 100),
            ),
          );
        for (const face of floorFaces) face.supportGroup = 'ground:0';
        const other = axis === 0 ? 2 : 0,
          a = [wheel[0], 0.06, wheel[2]],
          b = [...a],
          c = [...a];
        a[axis] -= sign * gap;
        b[axis] -= sign * gap;
        c[axis] -= sign * (gap + 0.1);
        a[other] -= 0.1;
        b[other] += 0.1;
        const upper = triangleFace(
            'wheel-adjacent-upper',
            'wheel-adjacent-upper',
            'ground',
            [a, b, c],
            true,
            'ground:0',
            [0, 1, 0],
          ),
          world = new TeslaWorld({
            sources: [floor, fixedFacesSource('wheel-adjacent-upper', [upper])],
          }),
          query = {
            pose: p,
            shape: modelShape,
            maxDistance: 1,
            preferredSurfaceId: floorFaces[0].surfaceId,
            adhesion: false,
          };
        const outsideTolerance = Math.abs(wheel[axis] - a[axis]) > 50e-6;
        try {
          assert.equal(
            !!world.support(query),
            outsideTolerance,
            `axis ${axis} / sign ${sign} / ${gap}m gap: the actual 6cm upper source is detected through 50µm, exceeding the unchanged 5cm wheel travel`,
          );
          assert(
            world.support(query, (face) => face.surfaceId !== upper.surfaceId),
            'caller permissions still filter every cached source',
          );
          upper.enabled = () => false;
          assert(
            world.support(query),
            'a cached but disabled upper source supplies no wheel height',
          );
          upper.enabled = () => true;
          assert.equal(
            !!world.support(query),
            outsideTolerance,
            'warming geometry does not change source qualification or edge tolerance',
          );
        } finally {
          world.dispose();
        }
      }
});

test('a real preferred ground contact just outside collision bounds is re-proved without granting missing, distant, protected, disabled or no-ignore permissions', () => {
  const fixture = JSON.parse(
      readFileSync(
        new URL('./fixtures/tesla-robson-route.json', import.meta.url),
      ),
    ),
    faces = fixture.faces.map((face) =>
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
    sourceSurfaceId = 'ground:asphalt:9:face:3535',
    source = faces.find((face) => face.surfaceId === sourceSurfaceId),
    modelShape = createTeslaRoadsterShape(),
    p = {
      position: [693.6292041051609, 29.428374834901845, 614.7494793311361],
      quaternion: [
        0.013229256291083616, 0.38588121194760927, 0.0023965863775550615,
        0.9224505045895762,
      ],
    },
    world = new TeslaWorld({
      sources: [fixedFacesSource('actual-robson-late', faces)],
    });
  assert(source);
  const radius =
    Math.hypot(...modelShape.halfExtents) + modelShape.clearance + 0.01;
  assert(
    Math.max(...source.triangle.map((p) => p[2])) < p.position[2] - radius,
    'the real source is outside every collision candidate at this unchanged pose',
  );
  try {
    const query = {
        from: p,
        to: p,
        shape: modelShape,
        ignoreSurfaceId: sourceSurfaceId,
      },
      supportQuery = {
        pose: p,
        shape: modelShape,
        maxDistance: 0.88,
        preferredSurfaceId: sourceSurfaceId,
        adhesion: false,
      };
    assert.equal(world.support(supportQuery)?.surfaceId, sourceSurfaceId);
    assert.equal(
      world.sweep(query),
      null,
      'fresh actual source/whole-floor proof restores the authored body query without lifting the vehicle',
    );
    assert(
      world.sweep({ ...query, ignoreSurfaceId: undefined }),
      'no-ignore remains the full tyre-plane envelope',
    );
    assert(
      world.sweep({ ...query, ignoreSurfaceId: 'missing-ground' }),
      'an arbitrary ID never grants a body exception',
    );
    assert(
      world.sweep({
        ...query,
        shape: { ...modelShape, groundSupport: undefined },
      }),
      'legacy shapes keep their original contact bounds',
    );
    const far = faces.find(
      (face) =>
        face.kind === 'ground' &&
        face.supportGroup === 'ground:0' &&
        face.triangle.every((p) => p[0] < 300),
    );
    assert(far);
    assert(
      world.sweep({ ...query, ignoreSurfaceId: far.surfaceId }),
      'a distant real source is not a support identity',
    );
    source.enabled = () => false;
    assert(
      world.sweep(query),
      'disabled cached source permission is not preserved',
    );
    source.enabled = () => true;
    assert.equal(world.sweep(query), null);
    source.supportGroup = 'protected:bridge:1';
    assert(
      world.sweep(query),
      'protected source identities never use ordinary proof fallback',
    );
    source.supportGroup = 'ground:0';
    assert.equal(world.sweep(query), null);
  } finally {
    world.dispose();
  }
});

test('malformed body sections fail closed instead of omitting any part of the model envelope', () => {
  const modelShape = createTeslaRoadsterShape(),
    sections = modelShape.groundSupport.bodySections;
  assert(sections);
  const badSections = [
    [],
    sections.slice(1),
    [...sections].reverse(),
    sections.map((section, i) =>
      i === 1 ? { ...section, minZ: section.minZ + 0.001 } : section,
    ),
    sections.map((section, i) =>
      i === 0 ? { ...section, minZ: NaN } : section,
    ),
    sections.map((section, i) =>
      i === 0 ? { ...section, clearance: 0.01 } : section,
    ),
    sections.map((section, i) =>
      i === 0 ? { ...section, clearance: 2 } : section,
    ),
  ];
  const floor = ground();
  const faces = floor.load(
    new THREE.Box3(
      new THREE.Vector3(-100, -1, -100),
      new THREE.Vector3(100, 1, 100),
    ),
  );
  for (const face of faces) face.supportGroup = 'ground:0';
  const world = new TeslaWorld({ sources: [floor] }),
    p = pose(0, 0.68, 0);
  try {
    for (const bodySections of badSections) {
      const invalidShape = {
        ...modelShape,
        groundSupport: { ...modelShape.groundSupport, bodySections },
      };
      assert.equal(
        world.support({
          pose: p,
          shape: invalidShape,
          maxDistance: 1,
          adhesion: false,
        }),
        null,
      );
      assert.equal(
        world.fitGround({
          pose: p,
          shape: invalidShape,
          maxAdjustmentM: 0.35,
          preferredSurfaceId: faces[0].surfaceId,
        }),
        null,
      );
      assert.equal(
        world.sweep({ from: p, to: p, shape: invalidShape })?.surfaceId,
        'tesla:invalid-query',
      );
    }
  } finally {
    world.dispose();
  }
});

test('an offset front body section cannot skip a thin plane struck only during the rotation arc', () => {
  const modelShape = createTeslaRoadsterShape(),
    front = modelShape.groundSupport.bodySections.at(-1),
    offset = new THREE.Vector3(
      0,
      front.clearance / 2,
      (front.minZ + front.maxZ) / 2,
    ),
    corner = new THREE.Vector3(
      modelShape.halfExtents[0],
      -modelShape.halfExtents[1] + front.clearance,
      front.maxZ,
    ),
    normal = corner.clone().normalize().negate(),
    rotationAxis = offset
      .clone()
      .cross(corner.clone().sub(offset))
      .cross(normal)
      .normalize(),
    center = new THREE.Vector3(0, 0.68, 0),
    distance = corner.length() + modelShape.clearance - 0.00003,
    point = center.clone().addScaledVector(normal, -distance),
    u = rotationAxis.clone().multiplyScalar(10),
    v = normal.clone().cross(rotationAxis).multiplyScalar(10),
    a = point.clone().sub(u).sub(v),
    b = point.clone().add(u).sub(v),
    c = point.clone().add(u).add(v),
    d = point.clone().sub(u).add(v),
    floor = ground();
  const floorFaces = floor.load(
    new THREE.Box3(
      new THREE.Vector3(-100, -100, -100),
      new THREE.Vector3(100, 100, 100),
    ),
  );
  for (const face of floorFaces) face.supportGroup = 'ground:0';
  const world = new TeslaWorld({
    sources: [
      floor,
      fixedFacesSource('mid-arc', [
        triangleFace(
          'mid-arc',
          'mid-arc:0',
          'ground',
          [a.toArray(), b.toArray(), c.toArray()],
          false,
          'ground:0',
          normal.toArray(),
        ),
        triangleFace(
          'mid-arc',
          'mid-arc:1',
          'ground',
          [a.toArray(), c.toArray(), d.toArray()],
          false,
          'ground:0',
          normal.toArray(),
        ),
      ]),
    ],
  });
  const rotatedPose = (angle) => {
    const q = new THREE.Quaternion().setFromAxisAngle(rotationAxis, angle);
    return { position: center.toArray(), quaternion: q.toArray() };
  };
  const from = rotatedPose(-0.01),
    to = rotatedPose(0.01),
    ignoreSurfaceId = floorFaces[0].surfaceId;
  try {
    for (const p of [from, to]) {
      assert(
        world.support({
          pose: p,
          shape: modelShape,
          maxDistance: 1,
          adhesion: false,
        }),
        'both endpoints have all four real tyre contacts',
      );
      assert.equal(
        world.sweep({ from: p, to: p, shape: modelShape, ignoreSurfaceId }),
        null,
        'both physical endpoint bodies clear the plane',
      );
    }
    assert(
      normal.dot(center.clone().add(corner).sub(point)) - modelShape.clearance <
        -0.00002,
      'the actual body corner and clearance intersect at the middle orientation',
    );
    const hit = world.sweep({ from, to, shape: modelShape, ignoreSurfaceId });
    assert(
      hit && hit.surfaceId === 'mid-arc',
      'a proxy-centre chord cannot authorize the physical offset arc',
    );
  } finally {
    world.dispose();
  }
});

test('wheel support retains the actual upper ordinary floor instead of borrowing it for a preferred lower source contact', () => {
  const floors = [ground(), ground(0.2)],
    modelShape = createTeslaRoadsterShape();
  for (const floor of floors)
    for (const face of floor.load(
      new THREE.Box3(
        new THREE.Vector3(-100, -1, -100),
        new THREE.Vector3(100, 1, 100),
      ),
    ))
      face.supportGroup = 'ground:0';
  const world = new TeslaWorld({ sources: floors });
  try {
    const preferredSurfaceId = 'floor:-40:-40:0:0',
      p = pose(0, 0.88, 0),
      supported = world.support({
        pose: p,
        shape: modelShape,
        maxDistance: 1.1,
        preferredSurfaceId,
        adhesion: false,
      });
    assert(supported && supported.surfaceId.startsWith('floor:-40:-40:0.2:'));
    assert.equal(
      world.support({
        pose: pose(0, 0.68, 0),
        shape: modelShape,
        maxDistance: 1.1,
        preferredSurfaceId,
        adhesion: false,
      }),
      null,
    );
    const fitted = world.fitGround({
      pose: p,
      shape: modelShape,
      preferredSurfaceId,
      maxAdjustmentM: 0.35,
    });
    assert(fitted && fitted.contact.surfaceId.startsWith('floor:-40:-40:0.2:'));
    assert.equal(
      world.fitGround({
        pose: p,
        preferredSurfaceId,
        maxAdjustmentM: 0.35,
        shape: {
          ...modelShape,
          groundSupport: {
            ...modelShape.groundSupport,
            wheelContacts: undefined,
          },
        },
      }),
      null,
    );
  } finally {
    world.dispose();
  }
});
const sweep = (world, from, to, overrides = {}) =>
  world.sweep({ from, to, shape, ...overrides });
const support = (world, p, extra = {}) =>
  world.support({ pose: p, shape, maxDistance: 1.2, adhesion: true, ...extra });
function ground(y = 0, x = -40, z = -40, size = 80, kind = 'ground') {
  const a = [x, y, z],
    b = [x, y, z + size],
    c = [x + size, y, z + size],
    d = [x + size, y, z];
  return fixedFacesSource(`floor:${x}:${z}:${y}`, [
    triangleFace(
      `floor:${x}:${z}:${y}:0`,
      `tri:${x}:${z}:${y}:0`,
      kind,
      [a, b, c],
      true,
      `floor-group:${y}`,
    ),
    triangleFace(
      `floor:${x}:${z}:${y}:1`,
      `tri:${x}:${z}:${y}:1`,
      kind,
      [a, c, d],
      true,
      `floor-group:${y}`,
    ),
  ]);
}

test('continuous full-body sweep catches a thin facade at speed, roof descent and body width', () => {
  const world = new TeslaWorld({
    sources: [
      prism({
        polygon: [
          [
            [0, 0],
            [0.02, 0],
            [0.02, 20],
            [0, 20],
          ],
        ],
      }),
    ],
  });
  const hit = sweep(world, pose(-100, 5, 10), pose(100, 5, 10));
  assert(hit && hit.kind === 'wall');
  assert(
    Math.abs(hit.fraction - (100 - shape.halfExtents[0] - 0.06) / 200) < 1e-5,
  );
  assert.deepEqual(hit.normal, [-1, 0, 0]);
  assert(
    sweep(world, pose(-10, 5, -1), pose(10, 5, -1)),
    'front/rear body extent catches a facade beyond its centre ray',
  );
  const roofWorld = new TeslaWorld({ sources: [prism()] });
  const roof = sweep(roofWorld, pose(10, 30, 10), pose(10, 5, 10));
  assert(roof && roof.kind === 'roof');
  assert(Math.abs(roof.fraction - (30 - 10.68) / 25) < 1e-5);
  assert.equal(sweep(roofWorld, pose(-10, 11, 10), pose(30, 11, 10)), null);
  assert.equal(sweep(roofWorld, pose(-10, -3, 10), pose(30, -3, 10)), null);
});

test('actual wall normal and full car footprint permit adhesion and exact face ignore never removes the other corner', () => {
  const world = new TeslaWorld({ sources: [prism()] });
  const p = pose(-0.68, 5, 10, [-1, 0, 0]);
  const contact = support(world, p);
  assert(contact && contact.kind === 'wall');
  assert.deepEqual(contact.normal, [-1, 0, 0]);
  assert.equal(support(world, p, { adhesion: false }), null);
  assert.equal(
    sweep(world, p, p, { ignoreSurfaceId: contact.surfaceId }),
    null,
  );
  assert(
    sweep(
      world,
      pose(-0.68, 5, 10, [-1, 0, 0]),
      pose(-0.68, 5, -2, [-1, 0, 0]),
      { ignoreSurfaceId: contact.surfaceId },
    ) === null,
    'leaving a facade is possible; support, rather than fake continued floor, ends at the edge',
  );
  assert.equal(
    support(world, pose(-0.68, 5, 1, [-1, 0, 0])),
    null,
    'parking requires every part of the 4.68m body footprint to fit',
  );
  assert(
    sweep(
      world,
      pose(-0.68, 5, 10, [-1, 0, 0]),
      pose(5, 5, -0.68, [0, 0, -1]),
      { ignoreSurfaceId: contact.surfaceId },
    ),
    'rotating through the adjacent facade is blocked even while the old wall is ignored',
  );
});

test('roof support preserves courtyards and catches a small hole entirely between corner probes', () => {
  const hole = [
    [9.95, 9.95],
    [10.05, 9.95],
    [10.05, 10.05],
    [9.95, 10.05],
  ];
  const world = new TeslaWorld({
    sources: [prism({ polygon: [...polygon, hole] })],
  });
  assert(support(world, pose(4, 10.68, 4))?.kind === 'roof');
  assert.equal(support(world, pose(9, 10.68, 10)), null);
  const courtyard = new TeslaWorld({
    sources: [
      prism({
        polygon: [
          ...polygon,
          [
            [6, 6],
            [14, 6],
            [14, 14],
            [6, 14],
          ],
        ],
      }),
    ],
  });
  assert.equal(sweep(courtyard, pose(10, 2, 10), pose(10, 8, 10)), null);
  assert.equal(support(courtyard, pose(10, 10.68, 10)), null);
});

test('rotation-only sweeps catch protruding body corners and inside spawns fail closed', () => {
  const world = new TeslaWorld({ sources: [prism()] });
  const from = pose(-1.2, 5, 10);
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );
  assert.equal(sweep(world, from, from), null);
  assert(
    sweep(world, from, {
      position: from.position,
      quaternion: [q.x, q.y, q.z, q.w],
    }),
  );
  assert.equal(sweep(world, pose(10, 5, 10), pose(10, 5, 10)).fraction, 0);
  assert(world.cameraSweep([-5, 5, 10], [25, 5, 10], 0.25));
});

test('tangent ground travel stays smooth, supports cannot jump a floor or land on a tiny pedestal', () => {
  const world = new TeslaWorld({
    sources: [ground(0), ground(8, -40, -40, 80)],
  });
  const hit = support(world, pose(0, 0.68, 0), { adhesion: false });
  assert(hit && Math.abs(hit.point[1]) < 1e-8);
  assert.equal(sweep(world, pose(-10, 0.68, 0), pose(10, 0.68, 0)), null);
  assert.equal(
    support(
      new TeslaWorld({ sources: [ground(0, -0.5, -0.5, 1)] }),
      pose(0, 0.68, 0),
    ),
    null,
  );
  assert.equal(support(world, pose(0, 3, 0), { maxDistance: 1.2 }), null);
});

test('actual mesh transforms and sloped physical normals survive local loading', () => {
  const geometry = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2);
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) * 0.1);
  const parent = new THREE.Group();
  parent.position.set(100, 5, -80);
  const mesh = new THREE.Mesh(geometry);
  parent.add(mesh);
  const world = new TeslaWorld({
    sources: [teslaMeshSource(mesh, 'actual-road', 'ground', true)],
  });
  const n = new THREE.Vector3(-0.1, 1, 0).normalize();
  const contact = support(
    world,
    pose(100 + n.x * 0.68, 5 + n.y * 0.68, -80, [n.x, n.y, n.z]),
    { adhesion: false },
  );
  assert(contact);
  assert(Math.abs(contact.normal[0] - n.x) < 1e-6);
  assert(Math.abs(contact.point[1] - 5) < 0.01);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('pitched source roofs keep the actual eave/gable planes instead of inventing a flat roof at ridge height', () => {
  const roof = planPitchedRoof(
    [
      [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
    ],
    8,
    0,
    'gabled',
    'fixture',
    1,
  );
  assert(roof);
  const world = new TeslaWorld({
    sources: [
      prism({
        polygon: [roof.ring],
        maxY: 8,
        wallTop: roof.eaveHeight,
        roofTriangles: pitchedRoofTriangles(roof, 0),
      }),
    ],
  });
  assert.equal(support(world, pose(6, 8.68, 1), { adhesion: false }), null);
  assert.equal(
    sweep(
      world,
      pose(-2, roof.eaveHeight + 1.5, 1),
      pose(-2, roof.eaveHeight + 1.6, 1),
    ),
    null,
  );
});

test('local cache stays bounded and distant geometry is never loaded by city-wide sweeps', () => {
  let remoteLoads = 0;
  const remote = ground(0, 10_000, 10_000, 20),
    load = remote.load;
  remote.load = (region) => {
    remoteLoads++;
    return load(region);
  };
  const world = new TeslaWorld({
    sources: [
      remote,
      ...Array.from({ length: 30 }, (_, i) => ground(0, i * 64, -10, 20)),
    ],
    maxCachedTiles: 8,
  });
  for (let i = 0; i < 30; i++) support(world, pose(i * 64 + 10, 0.68, 0));
  assert.equal(remoteLoads, 0);
  assert(world.stats().cachedTiles <= 8);
  assert(world.stats().loadedTiles > 8);
});

function cityFixture({ protectedModes = ['drive'], water = false } = {}) {
  const roads = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
  );
  mesh.userData.asphaltSurface = true;
  mesh.userData.walkSurface = true;
  roads.add(mesh);
  const surfaces = new TravelSurfaceIndex([
    {
      surfaceId: 'bridge:road',
      routeId: 'bridge',
      layer: 1,
      allowedModes: protectedModes,
      triangles: [
        -40, 8, -40, -40, 8, 40, 40, 8, 40, -40, 8, -40, 40, 8, 40, 40, 8, -40,
      ],
    },
  ]);
  const e = {
    roads,
    terrain: new THREE.Group(),
    data: {
      flightBuildingVolumes: [],
      buildingRoofs: new Map(),
      travelSurfaces: surfaces,
      streetLampPoints: [],
    },
    landmarkDetails: [],
    detailedTrees: { trees: [] },
    settings: { buildings: true },
    elevation: () => 999,
    waterWorld: { at: () => (water ? { level: 0, id: 'sea' } : null) },
    streetFurniture: null,
  };
  return {
    e,
    dispose: () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

test('ground recovery uses actual road mesh, retains underpass identity and accepts only driveable protected layers', () => {
  const { e, dispose } = cityFixture();
  const world = new CityTeslaWorld(e);
  try {
    const below = world.groundPoseNear([0, 0, 0], shape, 0, 0);
    assert(
      below &&
        below.identity.surfaceId === 'ground' &&
        below.contact.point[1] === 0,
    );
    const bridge = world.groundPoseNear([0, 8, 0], shape, 0, 0, {
      surfaceId: 'bridge:road',
      layer: 1,
    });
    assert(
      bridge && bridge.identity.layer === 1 && bridge.contact.point[1] === 8,
    );
    assert.equal(
      world.groundPoseNear([0, 0, 0], shape, 0, 0, {
        surfaceId: 'bridge:road',
        layer: 1,
      }),
      null,
    );
    assert.equal(
      world.groundPoseNear([200, 0, 200], shape, 0, 0),
      null,
      'elevation999 never invents a road',
    );
  } finally {
    world.dispose();
    dispose();
  }
  const foot = cityFixture({ protectedModes: ['walk'] });
  const footWorld = new CityTeslaWorld(foot.e);
  try {
    assert.equal(
      footWorld.groundPoseNear([0, 8, 0], shape, 0, 0, {
        surfaceId: 'bridge:road',
        layer: 1,
      }),
      null,
    );
  } finally {
    footWorld.dispose();
    foot.dispose();
  }
});

test('water never becomes recovery ground and runtime furniture obstacles follow readiness/visibility', () => {
  const fixture = cityFixture({ water: true });
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(world.groundPoseNear([0, 0, 0], shape, 0, 0), null);
  } finally {
    world.dispose();
    fixture.dispose();
  }
  const f = cityFixture();
  f.e.streetFurniture = {
    ready: false,
    placements: [
      { id: 'bench', kind: 'cedar-bench', x: 0, y: 0, z: 0, yaw: 0 },
    ],
  };
  const furniture = new CityTeslaWorld(f.e);
  try {
    assert.equal(sweep(furniture, pose(-6, 1, 0), pose(6, 1, 0)), null);
    f.e.streetFurniture.ready = true;
    assert.equal(
      sweep(furniture, pose(-6, 1, 0), pose(6, 1, 0)).kind,
      'obstacle',
    );
    f.e.settings.buildings = false;
    assert.equal(sweep(furniture, pose(-6, 1, 0), pose(6, 1, 0)), null);
  } finally {
    furniture.dispose();
    f.dispose();
  }
});

test('explicit inside escape finds full-body clear space, while invalid coordinates never enter grid loops', () => {
  const world = new TeslaWorld({ sources: [prism()] });
  const inside = pose(10, 5, 10);
  const escaped = world.escape(inside, shape, 8);
  assert(escaped);
  assert.deepEqual(
    inside.position,
    [10, 5, 10],
    'recovery never mutates the simulation pose',
  );
  assert.equal(sweep(world, escaped, escaped), null);
  assert.equal(sweep(world, inside, pose(40, 5, 10)).fraction, 0);
  for (const value of [NaN, Infinity, 1e300])
    assert.equal(
      sweep(world, pose(value, 5, 10), pose(value, 5, 10)).fraction,
      0,
    );
  assert.equal(support(world, pose(1e300, 0, 0)), null);
});

test('city spawn aligns the complete chassis with the physical road normal before its final collision proof', () => {
  const fixture = cityFixture();
  const mesh = fixture.e.roads.children[0];
  const p = mesh.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) * 0.15);
  const world = new CityTeslaWorld(fixture.e);
  try {
    const spawn = world.groundPoseNear([0, 0, 0], shape, 0.4, 0);
    assert(spawn);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(...spawn.pose.quaternion),
    );
    assert(up.distanceTo(new THREE.Vector3(...spawn.contact.normal)) < 1e-6);
    assert.equal(sweep(world, spawn.pose, spawn.pose), null);
  } finally {
    world.dispose();
    fixture.dispose();
  }
});

test('source tree crowns and lamp poles are nonadherable swept obstacles', () => {
  for (const kind of ['tree', 'lamp']) {
    const fixture = cityFixture();
    fixture.e.elevation = () => 0;
    if (kind === 'tree')
      fixture.e.detailedTrees.trees = [{ x: 0, z: 0, h: 10 }];
    else fixture.e.data.streetLampPoints = [[0, 0, 0]];
    const world = new CityTeslaWorld(fixture.e);
    try {
      const hit = sweep(world, pose(-20, 4, 0), pose(20, 4, 0));
      assert(hit && hit.kind === 'obstacle' && !hit.adherable);
      assert.equal(support(world, pose(-0.81, 4, 0, [-1, 0, 0])), null);
    } finally {
      world.dispose();
      fixture.dispose();
    }
  }
});

test('disposed geometry worlds release cached faces and fail closed rather than allowing collision-free travel', () => {
  const world = new TeslaWorld({ sources: [ground()] });
  assert(support(world, pose(0, 0.68, 0)));
  assert(world.stats().cachedFaces > 0);
  world.dispose();
  world.dispose();
  assert.equal(world.stats().cachedFaces, 0);
  assert.equal(world.stats().cachedTiles, 0);
  assert.equal(support(world, pose(0, 0.68, 0)), null);
  assert.equal(sweep(world, pose(0, 4, 0), pose(5, 4, 0)).fraction, 0);
});

test('ordinary sidewalk is physical ground but never a road recovery or protected-floor permission', () => {
  const fixture = cityFixture();
  const sidewalk = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
  );
  sidewalk.position.set(100, 0.13, 0);
  sidewalk.userData.walkSurface = true;
  fixture.e.roads.add(sidewalk);
  const protectedWalk = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
  );
  protectedWalk.position.set(150, 8, 0);
  protectedWalk.userData.walkSurface = true;
  protectedWalk.userData.protectedSurface = true;
  protectedWalk.userData.surfaceId = 'pedestrian-deck';
  protectedWalk.userData.layer = 1;
  fixture.e.roads.add(protectedWalk);
  const world = new CityTeslaWorld(fixture.e);
  try {
    const contact = support(world, pose(100, 0.81, 0));
    assert(contact && contact.kind === 'ground');
    assert.equal(world.groundPoseNear([100, 0.13, 0], shape, 0, 0), null);
    assert.equal(support(world, pose(150, 8.68, 0)), null);
  } finally {
    world.dispose();
    fixture.dispose();
    for (const mesh of [sidewalk, protectedWalk]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test('full city adapter crosses the real .13m curb and sidewalk before attaching and parking on a facade', async () => {
  const { createTesla, stepTesla } = await import(cityModule('tesla-state'));
  const fixture = cityFixture();
  fixture.e.roads.clear();
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 60).rotateX(-Math.PI / 2),
  );
  asphalt.position.set(0, 0, -30);
  asphalt.userData.walkSurface = true;
  asphalt.userData.asphaltSurface = true;
  const footway = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 12).rotateX(-Math.PI / 2),
  );
  footway.position.set(0, 0.13, 6);
  footway.userData.walkSurface = true;
  fixture.e.roads.add(asphalt, footway);
  fixture.e.data.travelSurfaces = new TravelSurfaceIndex([]);
  fixture.e.data.flightBuildingVolumes = [
    {
      polygon: [
        [
          [-15, 12],
          [15, 12],
          [15, 30],
          [-15, 30],
        ],
      ],
      minY: 0,
      maxY: 40,
    },
  ];
  const world = new CityTeslaWorld(fixture.e);
  try {
    const spawn = world.groundPoseNear([0, 0, -20], shape, 0, 0);
    assert(spawn);
    const state = createTesla(spawn.pose.position, 0, spawn.contact);
    let curbLift = false,
      sidewalkReached = false,
      wallReached = false;
    for (let i = 0; i < 2400; i++) {
      stepTesla(state, { throttle: 0.35 }, 1 / 120, world, shape);
      if (state.attachment?.contact.surfaceId.startsWith('ground:footway:'))
        curbLift = true;
      assert(
        state.position[1] >= 0.65,
        `body fell below the physical footway: ${JSON.stringify(state.position)}`,
      );
      if (
        state.mode === 'ground' &&
        state.position[2] > 3 &&
        state.position[1] > 0.79
      )
        sidewalkReached = true;
      if (state.mode === 'wall') {
        wallReached = true;
        break;
      }
    }
    assert(curbLift, 'the real .13m raised curb must retain its swept lift');
    assert(
      sidewalkReached,
      `sidewalk not reached: ${JSON.stringify({ pose: state.position, mode: state.mode, collision: state.collisionSurfaceId, contact: state.contact, attachment: state.attachment })}`,
    );
    assert(
      wallReached,
      `facade not reached: ${JSON.stringify({ pose: state.position, mode: state.mode, collision: state.collisionSurfaceId })}`,
    );
    stepTesla(state, { park: true }, 1 / 60, world, shape);
    assert(state.parked);
    const parked = structuredClone({
      position: state.position,
      quaternion: state.quaternion,
      id: state.contact.surfaceId,
    });
    for (let i = 0; i < 480; i++) stepTesla(state, {}, 1 / 60, world, shape);
    assert.deepEqual(
      {
        position: state.position,
        quaternion: state.quaternion,
        id: state.contact.surfaceId,
      },
      parked,
    );
  } finally {
    world.dispose();
    fixture.dispose();
    for (const mesh of [asphalt, footway]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test('broadleaf street canopy leaves actual air beneath its crown while trunk and upper foliage still obstruct', () => {
  const fixture = cityFixture();
  fixture.e.elevation = () => 0;
  fixture.e.detailedTrees.trees = [
    { x: 0, z: 0, y: 0, h: 10, conifer: false, seed: 1 },
  ];
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(sweep(world, pose(-10, 0.68, 3), pose(10, 0.68, 3)), null);
    assert(
      sweep(world, pose(-10, 0.68, 0), pose(10, 0.68, 0))?.surfaceId.includes(
        ':trunk:',
      ),
    );
    assert(
      sweep(world, pose(-10, 5, 3), pose(10, 5, 3))?.surfaceId.includes(
        ':crown:',
      ),
    );
  } finally {
    world.dispose();
    fixture.dispose();
  }
});

test('whole-land mesh is lazy physical terrain with bounded coarse metadata and never a road recovery floor', () => {
  const fixture = cityFixture();
  fixture.e.roads.clear();
  fixture.e.data.travelSurfaces = new TravelSurfaceIndex([]);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(20_000, 20_000).rotateX(-Math.PI / 2),
  );
  mesh.userData.walkSurface = true;
  const positions = mesh.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, positions.getX(i) * 0.1 + 2);
  fixture.e.terrain.add(mesh);
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(world.stats().cachedFaces, 0);
    assert.equal(world.stats().loadedTiles, 0);
    assert(
      world.stats().sourceCells < 16,
      'whole terrain/water bounds must not fill city-wide tile bins',
    );
    assert.equal(world.stats().broadSources, 2);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-0.1, 1, 0).normalize(),
    );
    const p = {
      position: [0, 2, 0].map(
        (v, i) =>
          v + new THREE.Vector3(-0.1, 1, 0).normalize().toArray()[i] * 0.68,
      ),
      quaternion: q.toArray(),
    };
    const contact = support(world, p);
    assert(contact?.surfaceId.startsWith('ground:footway:'));
    assert(Math.abs(contact.point[1] - 2) < 0.01);
    assert(Math.abs(contact.normal[0] + 0.099503719) < 1e-6);
    assert.equal(world.groundPoseNear([0, 2, 0], shape, 0, 0), null);
    const hit = sweep(world, pose(10, 20, 10), pose(10, -3, 10));
    assert.equal(hit?.kind, 'ground');
    assert(world.stats().cachedTiles <= 48);
  } finally {
    world.dispose();
    fixture.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('exact water footprints stop descent and submerged crossing while preserving dry islands, pond holes and bridge floors', () => {
  const fixture = cityFixture();
  fixture.e.roads.clear();
  const bridge = fixture.e.data.travelSurfaces.surfaces[0];
  fixture.e.data.travelSurfaces = new TravelSurfaceIndex([
    {
      ...bridge,
      triangles: bridge.triangles.map((value, i) =>
        i % 3 === 2 ? value + 120 : value,
      ),
    },
  ]);
  const rectangle = (x0, z0, x1, z1) => [
    [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
      [x0, z0],
    ],
  ];
  const pond = {
    id: 'pond',
    name: 'small pond',
    kind: 'lake',
    level: 2,
    navigable: false,
    polygon: [...rectangle(-65, -20, -35, 20), rectangle(-55, -7, -45, 7)[0]],
  };
  const empty = { type: 'FeatureCollection', features: [] };
  fixture.e.waterWorld = new WaterWorld(
    [rectangle(-300, -300, 0, 300), rectangle(8, -10, 14, 10)],
    empty,
    [pond],
    empty,
    empty,
  );
  fixture.e.data.waterSurfaces = [pond];
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(world.stats().cachedFaces, 0);
    const sea = sweep(world, pose(30, 20, 40), pose(30, -5, 40));
    assert(sea?.surfaceId.startsWith('water:sea:'));
    assert.equal(sea.kind, 'obstacle');
    assert.equal(sea.adherable, false);
    assert(Math.abs(sea.point[1] - 0.1) < 1e-6);
    assert.equal(
      sweep(world, pose(-20, 20, 40), pose(-20, -5, 40)),
      null,
      'dry land is never blocked by the ocean rectangle',
    );
    assert.equal(
      sweep(world, pose(11, 6, 0), pose(11, -5, 0)),
      null,
      'small land island survives local water triangulation',
    );
    assert.equal(
      sweep(world, pose(-50, 6, 0), pose(-50, -5, 0)),
      null,
      'pond island/inner hole stays dry',
    );
    const pondHit = sweep(world, pose(-40, 6, 0), pose(-40, -5, 0));
    assert(pondHit?.surfaceId.startsWith('water:pond:'));
    assert.equal(
      pondHit.point[1],
      2,
      'non-navigable ponds use their real rendered level',
    );
    const shore = sweep(world, pose(-10, -2, 50), pose(10, -2, 50));
    assert(shore?.surfaceId.startsWith('water:shore:'));
    assert.equal(shore.adherable, false);
    assert(
      support(world, pose(20, 8.68, 120))?.surfaceId.startsWith('protected:'),
    );
    assert.equal(
      sweep(world, pose(10, 8.68, 120), pose(30, 8.68, 120)),
      null,
      'water never blocks motion on the real protected bridge above it',
    );
    assert.equal(
      support(world, pose(30, 0.78, 40)),
      null,
      'water is never support',
    );
  } finally {
    world.dispose();
    fixture.dispose();
  }
});

test('mapped city ceiling permits the controller 1800m flight ceiling and camera margin through 2000m', () => {
  const fixture = cityFixture();
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(sweep(world, pose(0, 1799, 0), pose(0, 1800, 0)), null);
    assert.equal(sweep(world, pose(0, 1800, 0), pose(0, 2000, 0)), null);
    assert.equal(
      sweep(world, pose(0, 2000, 0), pose(0, 2000.01, 0))?.fraction,
      0,
    );
  } finally {
    world.dispose();
    fixture.dispose();
  }
});

test('ordinary ground uses the real triangle union across overlapping road edges at all curb heights', () => {
  for (const height of [0, 0.03, 0.13]) {
    const terrain = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
      ),
      asphalt = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 30).rotateX(-Math.PI / 2),
      );
    asphalt.position.y = height;
    const world = new TeslaWorld({
      sources: [
        teslaMeshSource(terrain, 'ground:terrain', 'ground', true, 'ground:0'),
        teslaMeshSource(asphalt, 'ground:asphalt', 'ground', true, 'ground:0'),
      ],
    });
    try {
      for (const x of [0, 3.5, 5.5]) {
        const query = {
          pose: pose(x, height + 0.68, 0),
          shape,
          maxDistance: 1.1,
          adhesion: false,
        };
        const contact = world.support(query);
        assert(contact, `ground union hole at height=${height},x=${x}`);
        if (x === 5.5)
          assert(
            !contact.surfaceId.includes('asphalt'),
            'contact must belong to actual ground under center',
          );
        if (x >= 3.5)
          assert.equal(
            world.support(query, (face) => face.surfaceId.includes('asphalt')),
            null,
            'strict road proof never borrows terrain peers',
          );
      }
    } finally {
      world.dispose();
      for (const mesh of [terrain, asphalt]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  }
});

test('actual city recovery cannot credit a terrain-covered hole or edge to an asphalt triangle', () => {
  const fixture = cityFixture();
  fixture.e.roads.clear();
  fixture.e.data.travelSurfaces = new TravelSurfaceIndex([]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 8, 0, 0, 8, 0, 30], 3),
  );
  const road = new THREE.Mesh(geometry);
  road.userData.asphaltSurface = true;
  road.userData.walkSurface = true;
  fixture.e.roads.add(road);
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
  );
  terrain.userData.walkSurface = true;
  fixture.e.terrain.add(terrain);
  const world = new CityTeslaWorld(fixture.e);
  try {
    assert.equal(
      world.groundPoseNear([1, 1, 20], shape, 0, 0),
      null,
      'triangle AABB is not the physical asphalt polygon',
    );
    assert.equal(
      world.groundPoseNear([7.6, 1, 20], shape, 0, 0),
      null,
      'whole chassis must fit road even when the remaining footprint is safe terrain',
    );
  } finally {
    world.dispose();
    fixture.dispose();
    for (const mesh of [road, terrain]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test('protected driveable decks retain exact plane and XYZ seam proof instead of ordinary curb suspension tolerance', () => {
  for (const height of [0, 0.13]) {
    const left = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 30).rotateX(-Math.PI / 2),
      ),
      right = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 30).rotateX(-Math.PI / 2),
      );
    left.position.x = -2;
    right.position.set(2, height, 0);
    const world = new TeslaWorld({
      sources: [
        teslaMeshSource(
          left,
          'protected:left',
          'ground',
          true,
          'protected:bridge:1',
        ),
        teslaMeshSource(
          right,
          'protected:right',
          'ground',
          true,
          'protected:bridge:1',
        ),
      ],
    });
    try {
      assert.equal(!!support(world, pose(-0.5, 0.68, 0)), height === 0);
    } finally {
      world.dispose();
      for (const mesh of [left, right]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  }
});

test('yaw steering on a real two-triangle floor moves freely while angular wall sweeps remain conservative', async () => {
  const { createTesla, stepTesla } = await import(cityModule('tesla-state'));
  const faces = ground(0, -100, -100, 200).load(
    new THREE.Box3(
      new THREE.Vector3(-200, -1, -200),
      new THREE.Vector3(200, 1, 200),
    ),
  );
  for (const face of faces) face.supportGroup = 'ground:0';
  const world = new TeslaWorld({ sources: [fixedFacesSource('road', faces)] });
  try {
    const contact = support(world, pose(0, 0.68, 0));
    assert(contact);
    const state = createTesla([0, 0.68, 0], 0, contact);
    let collisions = 0;
    for (let i = 0; i < 120; i++)
      collisions += stepTesla(
        state,
        { throttle: 1, steer: 1 },
        1 / 60,
        world,
        shape,
      ).collisions;
    assert(Math.hypot(state.position[0], state.position[2]) > 10);
    assert(Math.abs(state.heading) > 0.1);
    assert.equal(state.mode, 'ground');
    assert.equal(collisions, 0);
  } finally {
    world.dispose();
  }
});

test('airborne height bands avoid loading ground geometry while retaining tall facades and returning to the same ground tile', () => {
  let groundLoads = 0;
  const floor = ground();
  const loadFloor = floor.load;
  floor.load = (region) => {
    groundLoads++;
    return loadFloor(region);
  };
  const wall = fixedFacesSource('tall-wall', [
    triangleFace(
      'wall',
      'wall0',
      'wall',
      [
        [-1, 0, -30],
        [-1, 300, -30],
        [-1, 300, 30],
      ],
      true,
      'wall',
      [-1, 0, 0],
    ),
    triangleFace(
      'wall',
      'wall1',
      'wall',
      [
        [-1, 0, -30],
        [-1, 300, 30],
        [-1, 0, 30],
      ],
      true,
      'wall',
      [-1, 0, 0],
    ),
  ]);
  const world = new TeslaWorld({ sources: [floor, wall] });
  try {
    const hit = sweep(world, pose(-20, 180, 0), pose(20, 180, 0));
    assert.equal(hit?.kind, 'wall');
    assert.equal(
      groundLoads,
      0,
      'aerial XZ tiles never load ground-only source triangles',
    );
    assert(support(world, pose(-10, 0.68, 0)));
    assert(
      groundLoads > 0,
      'returning to an already queried XZ tile still loads its real ground band',
    );
    assert(
      sweep(world, pose(-20, 96, 0), pose(20, 96, 0)),
      'cross-band collision faces cannot vanish at the 96m band boundary',
    );
  } finally {
    world.dispose();
  }
});

test('proven ordinary-ground suspension crosses real grade seams while a raised curb still requires a swept lift', async () => {
  const { createTesla, stepTesla } = await import(cityModule('tesla-state'));
  for (const grade of [
    0.001, 0.014, 0.03, 0.05, -0.001, -0.014, -0.03, -0.05,
  ]) {
    const vertices = [
      [-20, 0, -20],
      [20, 0, -20],
      [20, 0, 0],
      [-20, 0, 0],
      [-20, 0, 120],
      [20, 0, 120],
    ];
    vertices[4][1] = vertices[5][1] = 120 * grade;
    const faces = [
      [0, 1, 2],
      [0, 2, 3],
      [3, 2, 5],
      [3, 5, 4],
    ].map((ids, i) =>
      triangleFace(
        `ground:ramp:${i}`,
        `ramp:${i}`,
        'ground',
        ids.map((id) => vertices[id]),
        true,
        'ground:0',
        i < 2 ? [0, 1, 0] : [0, 1, -grade],
      ),
    );
    const world = new TeslaWorld({
      sources: [fixedFacesSource('ramp', faces)],
    });
    try {
      const contact = support(world, pose(0, 0.68, -5));
      assert(contact);
      const state = createTesla([0, 0.68, -5], 0, contact);
      let failures = 0;
      for (let i = 0; i < 240; i++)
        failures += stepTesla(
          state,
          { throttle: 0.2 },
          1 / 60,
          world,
          shape,
        ).environmentFailures;
      assert(
        state.position[2] > 8,
        `grade seam blocked motion: ${JSON.stringify({ grade, pose: state.position, collision: state.collisionSurfaceId })}`,
      );
      assert.equal(state.mode, 'ground');
      assert.equal(failures, 0);
      assert(Math.sign(state.contact.normal[2]) === -Math.sign(grade));
      assert(
        Math.abs(state.position[1] - (grade * state.position[2] + 0.68)) < 0.04,
      );
    } finally {
      world.dispose();
    }
  }
});

test('warm immutable face geometry never caches changing groups, enabled state, adhesion or caller permissions', () => {
  const faces = ground(0, -40, -40, 80).load(
    new THREE.Box3(
      new THREE.Vector3(-50, -1, -50),
      new THREE.Vector3(50, 1, 50),
    ),
  );
  for (const face of faces) face.supportGroup = 'ground:0';
  let enabled = true;
  faces[1].enabled = () => enabled;
  const world = new TeslaWorld({
    sources: [fixedFacesSource('ground', faces)],
  });
  const query = {
    pose: pose(0, 0.68, 0),
    shape,
    maxDistance: 1.1,
    adhesion: false,
  };
  const original = structuredClone(
    faces.map((face) => ({ triangle: face.triangle, normal: face.normal })),
  );
  try {
    assert(world.support(query));
    for (let i = 0; i < 20; i++) {
      const from = pose(0, 0.68, 0),
        to = {
          ...pose(0.05, 0.68, 0.05),
          quaternion: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.1)
            .toArray(),
        };
      assert.equal(sweep(world, from, to), null);
      assert(world.support(query));
    }
    enabled = false;
    assert.equal(world.support(query), null);
    enabled = true;
    assert(world.support(query));
    faces[1].supportGroup = 'different-floor';
    assert.equal(world.support(query), null);
    faces[1].supportGroup = 'ground:0';
    assert(world.support(query));
    faces[0].adherable = false;
    assert.equal(world.support(query), null);
    faces[0].adherable = true;
    assert(world.support(query));
    assert.equal(
      world.support(query, (face) => face.surfaceId === faces[0].surfaceId),
      null,
    );
    assert(world.support(query));
    for (const face of faces) face.kind = 'roof';
    assert.equal(world.support(query)?.kind, 'roof');
    assert.deepEqual(
      faces.map((face) => ({ triangle: face.triangle, normal: face.normal })),
      original,
      'SAT and local scratch operations never mutate cached source vertices/normals',
    );
  } finally {
    world.dispose();
  }
});
