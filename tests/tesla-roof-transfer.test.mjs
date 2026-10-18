import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const { teslaPrismSource } = await import(cityModule('tesla-city-world'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const { teslaFrame } = await import(cityModule('tesla-math'));
const shape = createTeslaRoadsterShape();
const height = shape.halfExtents[1] + shape.clearance;
const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/tesla-real-departure.json', import.meta.url),
  ),
);
const sourceSurfaceId = 'building:2281:wall:0:7';
const physicalFaces = () =>
  fixture.wall.faces.map((f) =>
    triangleFace(
      f.surfaceId,
      f.triangleId,
      f.kind,
      f.triangle,
      f.adherable,
      f.supportGroup,
      f.normal,
    ),
  );
const vector = (p) => new THREE.Vector3(...p);
const tuple = (p) => [p.x, p.y, p.z];
function actualQuery() {
  const wall = fixture.wall.faces.find((f) => f.surfaceId === sourceSurfaceId),
    normal = vector(wall.normal),
    top = Math.max(...wall.triangle.map((p) => p[1])),
    position = vector(fixture.wall.initial.position),
    distance = position.clone().sub(vector(wall.triangle[0])).dot(normal);
  position.addScaledVector(normal, height - distance);
  position.y = top - shape.halfExtents[2] - shape.clearance - 0.005;
  return {
    pose: {
      position: tuple(position),
      quaternion: teslaFrame(wall.normal, [0, 1, 0]).quaternion,
    },
    shape,
    sourceSurfaceId,
  };
}
function assertPlan(world, query, plan) {
  assert.ok(plan, 'a route exists on actual geometry');
  assert.equal(plan.sourceSurfaceId, query.sourceSurfaceId);
  assert.equal(plan.contact.kind, 'roof');
  assert.ok(plan.waypoints.length <= 8);
  assert.equal(plan.ignoreSurfaceIds[0], query.sourceSurfaceId);
  assert.equal(plan.ignoreSurfaceIds.at(-1), plan.contact.surfaceId);
  assert.ok(plan.ignoreSurfaceIds.slice(1, -1).every((id) => id === undefined));
  let previous = query.pose;
  for (const [index, waypoint] of plan.waypoints.entries()) {
    assert.ok(
      vector(previous.position).distanceTo(vector(waypoint.position)) <= 12,
    );
    assert.equal(
      world.sweep({
        from: previous,
        to: waypoint,
        shape,
        ignoreSurfaceId: plan.ignoreSurfaceIds[index],
      }),
      null,
    );
    previous = waypoint;
  }
  const roof = world.support({
    pose: previous,
    shape,
    maxDistance: height + 0.02,
    adhesion: true,
    preferredSurfaceId: plan.contact.surfaceId,
  });
  assert.equal(roof?.surfaceId, plan.contact.surfaceId);
}

test('actual building 2281 offers a fully swept rounded route to its actual full-footprint roof', () => {
  const world = new TeslaWorld({
    sources: [fixedFacesSource('actual-wall-roof', physicalFaces())],
  });
  try {
    const query = actualQuery();
    assert.equal(
      world.support({
        pose: query.pose,
        shape,
        maxDistance: height + 0.02,
        adhesion: true,
        preferredSurfaceId: sourceSurfaceId,
      })?.surfaceId,
      sourceSurfaceId,
    );
    const plan = world.planWallToRoof(query);
    assertPlan(world, query, plan);
    assert.equal(plan.contact.surfaceId, 'building:2281:roof');
    assert.ok(plan.waypoints.at(-1).position[1] > 47.68);
  } finally {
    world.dispose();
  }
});

test('missing actual roof, disabled source, early approach and unsupported wall poses never manufacture a transfer', () => {
  for (const variant of [
    'roofless',
    'disabled',
    'roof-disabled',
    'early',
    'unsupported',
    'bad-id',
    'nonfinite',
    'descending',
    'misaligned',
    'tiny-source-penetration',
  ]) {
    const faces = physicalFaces().filter(
      (f) => variant !== 'roofless' || f.kind !== 'roof',
    );
    if (variant === 'disabled')
      for (const f of faces)
        if (f.surfaceId === sourceSurfaceId) f.enabled = () => false;
    if (variant === 'roof-disabled')
      for (const f of faces) if (f.kind === 'roof') f.enabled = () => false;
    const world = new TeslaWorld({
      sources: [fixedFacesSource('actual-wall-roof', faces)],
    });
    try {
      const query = actualQuery();
      if (variant === 'early') query.pose.position[1] -= 3;
      if (variant === 'unsupported') query.pose.position[1] += 2;
      if (variant === 'bad-id')
        query.sourceSurfaceId = 'building:2281:wall:bogus';
      if (variant === 'nonfinite') query.pose.position[0] = NaN;
      if (variant === 'descending')
        query.pose.quaternion = teslaFrame(
          [-0.7035877260378928, 0, -0.7106084095821181],
          [0, -1, 0],
        ).quaternion;
      if (variant === 'misaligned') query.pose.quaternion = [0, 0, 0, 1];
      if (variant === 'tiny-source-penetration') {
        const q = new THREE.Quaternion(...query.pose.quaternion).multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            0.0001,
          ),
        );
        query.pose.quaternion = [q.x, q.y, q.z, q.w];
      }
      assert.equal(world.planWallToRoof(query), null, variant);
    } finally {
      world.dispose();
    }
  }
});

test('a thin physical barrier across the real transfer arc is never skipped with source-face permission', () => {
  const query = actualQuery(),
    baseline = new TeslaWorld({
      sources: [fixedFacesSource('actual', physicalFaces())],
    });
  let plan;
  try {
    plan = baseline.planWallToRoof(query);
    assert.ok(plan);
  } finally {
    baseline.dispose();
  }
  const at = plan.waypoints[3].position,
    barrier = teslaPrismSource({
      id: 'roof:thin-transfer-obstacle',
      polygon: [
        [
          [at[0] - 8, at[2] - 8],
          [at[0] + 8, at[2] - 8],
          [at[0] + 8, at[2] + 8],
          [at[0] - 8, at[2] + 8],
        ],
      ],
      minY: at[1] - 0.005,
      maxY: at[1] + 0.005,
      obstacle: true,
    }),
    world = new TeslaWorld({
      sources: [fixedFacesSource('actual', physicalFaces()), barrier],
    });
  try {
    assert.equal(world.planWallToRoof(query), null);
  } finally {
    world.dispose();
  }
});

const boxQuery = () => ({
  pose: {
    position: [0, 10 - shape.halfExtents[2] - shape.clearance - 0.005, -height],
    quaternion: teslaFrame([0, 0, -1], [0, 1, 0]).quaternion,
  },
  shape,
  sourceSurfaceId: 'building:box:wall:0:0',
});
const boxPrism = (overrides = {}) =>
  teslaPrismSource({
    id: 'building:box',
    polygon: [
      [
        [-12, 0],
        [12, 0],
        [12, 30],
        [-12, 30],
      ],
    ],
    minY: 0,
    maxY: 10,
    ...overrides,
  });

test('roof landing follows the actual pitched plane rather than an invented flat top', () => {
  const normal = tuple(new THREE.Vector3(0, 1, -0.1).normalize()),
    world = new TeslaWorld({
      sources: [
        boxPrism({
          maxY: 13,
          wallTop: 10,
          roofTriangles: [
            {
              vertices: [
                [-12, 10, 0],
                [12, 10, 0],
                [12, 13, 30],
              ],
              normal,
              roof: true,
            },
            {
              vertices: [
                [-12, 10, 0],
                [12, 13, 30],
                [-12, 13, 30],
              ],
              normal,
              roof: true,
            },
          ],
        }),
      ],
    });
  try {
    const query = boxQuery(),
      plan = world.planWallToRoof(query);
    assertPlan(world, query, plan);
    assert.deepEqual(plan.contact.normal, normal);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(...plan.waypoints.at(-1).quaternion),
    );
    assert.ok(up.dot(vector(normal)) > 1 - 1e-10);
    assert.ok(plan.contact.point[1] > 10.1);
  } finally {
    world.dispose();
  }
});

test('courtyard holes, raised parapets and physical overhangs reject a route while preserving the original wall', () => {
  for (const variant of ['hole', 'parapet', 'overhang']) {
    const extra =
      variant === 'hole'
        ? []
        : [
            teslaPrismSource({
              id: `physical:${variant}`,
              obstacle: true,
              polygon:
                variant === 'parapet'
                  ? [
                      [
                        [-12, -0.02],
                        [12, -0.02],
                        [12, 0.02],
                        [-12, 0.02],
                      ],
                    ]
                  : [
                      [
                        [-12, -6],
                        [12, -6],
                        [12, 0.5],
                        [-12, 0.5],
                      ],
                    ],
              minY: variant === 'parapet' ? 10 : 10.5,
              maxY: variant === 'parapet' ? 15 : 10.55,
            }),
          ];
    const source =
      variant === 'hole'
        ? boxPrism({
            polygon: [
              [
                [-12, 0],
                [12, 0],
                [12, 30],
                [-12, 30],
              ],
              [
                [-10, 1],
                [-10, 28],
                [10, 28],
                [10, 1],
              ],
            ],
          })
        : boxPrism();
    const world = new TeslaWorld({ sources: [source, ...extra] });
    try {
      const query = boxQuery();
      assert.equal(
        world.support({
          pose: query.pose,
          shape,
          maxDistance: height + 0.02,
          preferredSurfaceId: query.sourceSurfaceId,
          adhesion: true,
        })?.surfaceId,
        query.sourceSurfaceId,
        variant,
      );
      assert.equal(world.planWallToRoof(query), null, variant);
    } finally {
      world.dispose();
    }
  }
});

test('a roof on a different source cannot impersonate a roofless facade and finite world bounds still apply', () => {
  const wall = boxPrism(),
    roof = triangleFace(
      'building:other:roof',
      'other:roof:0',
      'roof',
      [
        [-12, 10, 0],
        [12, 10, 0],
        [0, 10, 30],
      ],
      true,
      'building:other:roof',
      [0, 1, 0],
    );
  const roofless = {
    ...wall,
    load: (region) => wall.load(region).filter((face) => face.kind !== 'roof'),
  };
  const world = new TeslaWorld({
    sources: [roofless, fixedFacesSource('other', [roof])],
  });
  try {
    assert.equal(world.planWallToRoof(boxQuery()), null);
  } finally {
    world.dispose();
  }
  const bounded = new TeslaWorld({
    sources: [boxPrism()],
    validPosition: (p) => p[1] <= 10,
  });
  try {
    assert.equal(bounded.planWallToRoof(boxQuery()), null);
  } finally {
    bounded.dispose();
  }
});
