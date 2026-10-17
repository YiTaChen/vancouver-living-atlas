import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { buildRoadGraph } = await import(cityModule('road-graph'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { FURNITURE_FOOTPRINTS, planStreetFurniture, StreetFurnitureBlockers } =
  await import(cityModule('street-furniture-placement'));

const road = (overrides = {}) => ({
  id: 'source-public-road',
  name: 'ROBSON ST',
  roadClass: 'Arterial',
  width: 10,
  corridorWidth: 20,
  level: 'ground',
  points: [
    [0, 0],
    [240, 0],
  ],
  ...overrides,
});
const graphFor = (...roads) =>
  buildRoadGraph(roads.length ? roads : [road()], { nodeIntersections: false });
function floor({
  zMin = 5,
  zMax = 10,
  holes = [],
  height = (x) => 8 + x * 0.002,
} = {}) {
  return (x, z) =>
    x >= 0 &&
    x <= 240 &&
    Math.abs(z) >= zMin &&
    Math.abs(z) <= zMax &&
    !holes.some(([a, b]) => x >= a && x <= b)
      ? height(x, z)
      : undefined;
}
const plan = (options = {}) =>
  planStreetFurniture({
    graph: graphFor(),
    sidewalkAt: floor(),
    allowed: () => true,
    blocked: () => false,
    ...options,
  });
const comparable = (result) =>
  result.placements
    .map((p) => ({
      ...p,
      x: Number(p.x.toFixed(7)),
      z: Number(p.z.toFixed(7)),
      yaw: Number(p.yaw.toFixed(7)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

test('wide real ground footways admit stable representative kinds at the measured datum', () => {
  const result = plan();
  assert.equal(result.placements.length, 10);
  assert.equal(result.stats.accepted, 10);
  assert.equal(new Set(result.placements.map((p) => p.id)).size, 10);
  for (const kind of ['cedar-bench', 'garbage-bin', 'bicycle-rack'])
    assert(result.stats.byKind[kind] > 0, kind);
  for (const p of result.placements) {
    assert(Math.abs(Math.abs(p.z) - 6.4) < 1e-8);
    assert.deepEqual(p.sourceIds, ['source-public-road']);
    assert.deepEqual(p.streetNames, ['ROBSON ST']);
    const shape = FURNITURE_FOOTPRINTS[p.kind];
    const datum = 8 + (p.x + shape.halfX) * 0.002;
    assert(Math.abs(p.y - datum - 0.008) < 1e-8);
  }
});

test('source microvertices, reversed directions and input order preserve IDs and physical slots', () => {
  const straight = graphFor(road());
  const segmented = graphFor(
    road({
      points: [
        [0, 0],
        [13, 0],
        [67, 0],
        [141, 0],
        [240, 0],
      ],
    }),
  );
  const reversed = graphFor(
    road({
      points: [
        [240, 0],
        [141, 0],
        [67, 0],
        [13, 0],
        [0, 0],
      ],
    }),
  );
  assert.deepEqual(
    comparable(plan({ graph: straight })),
    comparable(plan({ graph: segmented })),
  );
  assert.deepEqual(
    comparable(plan({ graph: straight })),
    comparable(plan({ graph: reversed })),
  );
  const other = road({
    id: 'another-public-road',
    points: [
      [0, 80],
      [240, 80],
    ],
  });
  const allFloor = () => 4;
  assert.deepEqual(
    comparable(plan({ graph: graphFor(road(), other), sidewalkAt: allFloor })),
    comparable(plan({ graph: graphFor(other, road()), sidewalkAt: allFloor })),
  );
});

test('actual triangle paving, including clipped holes, controls acceptance instead of terrain fallback', () => {
  const meshes = [];
  for (const sign of [-1, 1])
    for (const [start, end] of [
      [0, 70],
      [74, 240],
    ]) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(end - start, 5).rotateX(-Math.PI / 2),
      );
      mesh.position.set((start + end) / 2, 2, sign * 7.5);
      meshes.push(mesh);
    }
  const index = new GroundSurfaceIndex(meshes);
  const result = plan({ sidewalkAt: (x, z) => index.sample(x, z, 2) });
  assert(result.placements.length > 0);
  assert(result.placements.every((p) => Math.abs(p.x - 72) > 3));
  assert(result.stats.rejected['missing-pavement'] > 0);
  assert.equal(plan({ sidewalkAt: () => undefined }).placements.length, 0);
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('the complete furnishing footprint and continuous 1.8m passage must both have real paving', () => {
  const full = plan();
  assert(full.placements.length > 0);
  assert.equal(
    plan({ sidewalkAt: floor({ zMax: 7.7 }) }).placements.length,
    0,
    'prop ground alone cannot authorize a missing walking corridor',
  );
  assert.equal(
    plan({
      sidewalkAt: floor({
        holes: [
          [23.9, 24.1],
          [71.9, 72.1],
          [119.9, 120.1],
          [167.9, 168.1],
          [215.9, 216.1],
        ],
      }),
    }).placements.length,
    0,
    'a longitudinal hole through the approach invalidates every local continuous strip',
  );
  const clippedCorners = plan({
    sidewalkAt: (x, z) => (Math.abs(z) > 6.15 ? 2 : undefined),
  });
  assert(
    clippedCorners.placements.length < full.placements.length,
    'back corners of bench/bin cannot hang over absent paving',
  );
});

test('narrow, private and non-ground road sources cannot grant furniture placement', () => {
  for (const overrides of [
    { corridorWidth: 14 },
    { roadClass: 'Private' },
    { roadClass: 'Lane' },
    { roadClass: 'Bikeway' },
    { roadClass: 'Freeway' },
    { level: 'deck' },
    { name: 'Georgia Viaduct' },
    { name: 'Causeway' },
    { width: NaN },
  ]) {
    // The graph parser rejects invalid widths before there can be a display source.
    if (Number.isNaN(overrides.width)) {
      const graph = graphFor();
      graph.edges[0].width = NaN;
      assert.equal(plan({ graph }).placements.length, 0);
    } else
      assert.equal(
        plan({ graph: graphFor(road(overrides)) }).placements.length,
        0,
        JSON.stringify(overrides),
      );
  }
});

test('slope, region holes and root-owned tree/door/lamp exclusions fail closed', () => {
  assert.equal(
    plan({ sidewalkAt: floor({ height: (x) => x * 0.15 }) }).placements.length,
    0,
  );
  assert.equal(plan({ sidewalkAt: () => NaN }).placements.length, 0);
  assert.equal(plan({ allowed: () => false }).placements.length, 0);
  assert.equal(plan({ blocked: () => true }).placements.length, 0);
  const withExclusions = plan({
    blocked: (x, z, radius) => Math.hypot(x - 24, z - 6.4) < 1.5 + radius,
  });
  assert(withExclusions.placements.length > 0);
  assert(
    withExclusions.placements.every((p) => Math.hypot(p.x - 24, p.z - 6.4) > 2),
  );
  assert(
    plan({ allowed: (_x, z) => Math.abs(z) <= 7 }).placements.length === 0,
    'region mask also covers the complete walking corridor',
  );
});

test('intersections and crossings remain clear; neighbouring source paths retain 6m prop spacing', () => {
  const crossing = graphFor(
    road(),
    road({
      id: 'cross-street',
      name: 'BURRARD ST',
      points: [
        [72, -120],
        [72, 0],
        [72, 120],
      ],
    }),
  );
  // Explicit source junction point on both source lines, as in city topology.
  const intersecting = graphFor(
    road({
      points: [
        [0, 0],
        [72, 0],
        [240, 0],
      ],
    }),
    road({
      id: 'cross-street',
      name: 'BURRARD ST',
      points: [
        [72, -120],
        [72, 0],
        [72, 120],
      ],
    }),
  );
  const result = plan({ graph: intersecting, sidewalkAt: () => 1 });
  assert(result.placements.length > 0);
  assert(result.placements.every((p) => Math.hypot(p.x - 72, p.z) > 13));
  assert(crossing.edges.length > 0);
  const parallel = plan({
    graph: graphFor(
      road(),
      road({
        id: 'close-parallel-source',
        points: [
          [0, 2],
          [240, 2],
        ],
      }),
    ),
    sidewalkAt: () => 1,
  });
  for (let a = 0; a < parallel.placements.length; a++)
    for (let b = a + 1; b < parallel.placements.length; b++)
      assert(
        Math.hypot(
          parallel.placements[a].x - parallel.placements[b].x,
          parallel.placements[a].z - parallel.placements[b].z,
        ) > 6,
      );
});

const placement = (overrides = {}) => ({
  id: 'furniture-fixture',
  kind: 'cedar-bench',
  x: 16,
  y: 2,
  z: -16,
  yaw: Math.PI / 4,
  sourceIds: ['fixture'],
  streetNames: ['ROBSON ST'],
  ...overrides,
});
const world = (p, x, z) => [
  p.x + Math.cos(p.yaw) * x + Math.sin(p.yaw) * z,
  p.z - Math.sin(p.yaw) * x + Math.cos(p.yaw) * z,
];

test('static blockers use actual oriented footprints, rounded circle corners and bench asymmetry', () => {
  const p = placement();
  const blockers = new StreetFurnitureBlockers([p]);
  assert.equal(blockers.blocked(...world(p, 1, -0.39)), true);
  assert.equal(
    blockers.blocked(...world(p, 0, 0.34)),
    false,
    'bench front ends at .301 while rear ends at -.401',
  );
  assert.equal(
    blockers.blocked(...world(p, 1.2, 0.5), 0.2),
    false,
    'diagonal corner is outside the rounded circle-vs-box contact',
  );
  assert.equal(blockers.blocked(...world(p, 1.2, 0.5), 0.3), true);
  assert.equal(
    blockers.blocked(p.x + 1.2, p.z + 1.2),
    false,
    'rotated footprint cannot become a solid world bounding square',
  );
  assert.equal(blockers.blocked(0, 0), false);
});

test('blockers own immutable world occupancy across render changes and bound invalid queries', () => {
  const p = placement({ kind: 'bicycle-rack', x: -0.1, z: 15.9, yaw: 0 });
  const blockers = new StreetFurnitureBlockers([p]);
  p.x = 999;
  p.kind = 'garbage-bin';
  assert.equal(blockers.blocked(-0.1, 15.9), true);
  assert.equal(
    blockers.blocked(-0.6, 15.9, 0.03),
    true,
    'negative cell boundary is queried with finite circle radius',
  );
  assert.equal(blockers.blocked(-0.1, 16.2, 0.2), false);
  for (const args of [
    [NaN, 0],
    [0, Infinity],
    [0, 0, -1],
    [0, 0, 1e10],
  ])
    assert.equal(blockers.blocked(...args), true);
  assert.throws(() => new StreetFurnitureBlockers([placement({ yaw: NaN })]));
});

test('current Robson and Water source paving supports all three kinds without populating narrow Georgia sidewalks', async () => {
  const { readFile } = await import('node:fs/promises');
  const { cityRoadGraph } = await import(cityModule('street-layout'));
  const { buildPavement } = await import(cityModule('pavement'));
  const { createDowntownNightPolicy } = await import(
    cityModule('downtown-night-policy')
  );
  const roads = JSON.parse(
    await readFile(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
  );
  const trees = JSON.parse(
    await readFile(
      new URL('../public/data/trees.json', import.meta.url),
      'utf8',
    ),
  );
  const graph = cityRoadGraph(roads, trees.trees);
  const pavement = buildPavement(graph, {
    sidewalkWidth: (edge) =>
      edge.classes.every((c) => /lane|private|non.city|bikeway/i.test(c))
        ? 0
        : Math.max(2, (edge.corridorWidth - edge.width) / 2),
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      pavement.sidewalks.vertices.flatMap(([x, z]) => [x, 2, z]),
      3,
    ),
  );
  geometry.setIndex(pavement.sidewalks.indices);
  const mesh = new THREE.Mesh(geometry);
  const index = new GroundSurfaceIndex([mesh]);
  const result = plan({
    graph,
    sidewalkAt: (x, z) => index.sample(x, z, 2),
    allowed: createDowntownNightPolicy([], () => true),
  });
  assert(
    result.placements.length > 0 && result.placements.length < result.stats.cap,
  );
  for (const count of Object.values(result.stats.byKind)) assert(count > 0);
  assert(
    result.placements.every((p) =>
      p.streetNames.every((n) => /\b(?:WATER|ROBSON) ST$/i.test(n)),
    ),
  );
  assert(result.placements.some((p) => p.streetNames.includes('ROBSON ST')));
  assert(result.placements.some((p) => p.streetNames.includes('WATER ST')));
  // This checks real clipped XY surfaces at a flat test datum, not relief,
  // source fixture locations or the root's additional building/tree exclusions.
  mesh.geometry.dispose();
  mesh.material.dispose();
});
