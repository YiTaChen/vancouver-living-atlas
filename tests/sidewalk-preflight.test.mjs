import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { buildRoadGraph } = await import(cityModule('road-graph'));
const { validatedSidewalkRuns, TrunkClearanceIndex } = await import(
  cityModule('city-life/sidewalk-route')
);
const graphAt = (x = 0, z = 0) =>
  buildRoadGraph(
    [
      {
        id: 'source-sidewalk',
        name: 'Robson St',
        roadClass: 'local',
        width: 8,
        corridorWidth: 12,
        level: 'ground',
        points: [
          [x - 50, z],
          [x + 50, z],
        ],
      },
    ],
    { nodeIntersections: false },
  );
const floor = () => ({ y: 1.18, surfaceId: 'ground', layer: 0 });

test('static trunk preflight keeps exact pilot routes for varied terrain, offsets and boundary trunks', () => {
  let seed = 0x61b7e42;
  const rand = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
  for (let iteration = 0; iteration < 350; iteration++) {
    const x = (rand() - 0.5) * 2000,
      z = (rand() - 0.5) * 2000;
    const angle = rand() * 2 * Math.PI,
      dx = Math.cos(angle),
      dz = Math.sin(angle);
    const graph = buildRoadGraph(
      [
        {
          id: `test-${iteration}`,
          name: 'Robson St',
          roadClass: 'local',
          width: 8,
          corridorWidth: 12,
          level: 'ground',
          points: [
            [x, z],
            [x + dx * 100, z + dz * 100],
          ],
        },
      ],
      { nodeIntersections: false },
    );
    const edge = graph.edges[0],
      side = iteration % 2 ? 1 : -1;
    const nx = -dz * side,
      nz = dx * side;
    const along = 10 + rand() * 80;
    // Include exact and neighbouring floating point values at the trunk radius.
    const lateral =
      5 +
      (iteration % 3 === 0
        ? 0.95
        : iteration % 3 === 1
          ? 0.95 - 1e-10
          : 0.95 + 1e-10);
    const trees = new TrunkClearanceIndex([
      { x: x + dx * along + nx * lateral, z: z + dz * along + nz * lateral },
    ]);
    const clearSegment = (a, b) => trees.clearSegment(a, b);
    const varyingFloor = (px, pz) => {
      const station = (px - x) * dx + (pz - z) * dz;
      if (iteration % 5 === 0 && station > 48 && station < 52) return undefined;
      return {
        y: 1.18 + Math.sin(station / 30) * 0.04,
        surfaceId: 'ground',
        layer: 0,
      };
    };
    const original = validatedSidewalkRuns(graph, edge, side, varyingFloor, {
      clearSegment,
    });
    const preflight = validatedSidewalkRuns(graph, edge, side, varyingFloor, {
      clearSegment,
      preflightTrunks: trees,
    });
    assert.deepEqual(preflight, original, `iteration ${iteration}`);
  }
});

test('a known trunk can reject a fragment before floor probes without skipping proof of surviving runs', () => {
  const graph = graphAt(50),
    edge = graph.edges[0];
  const trees = new TrunkClearanceIndex([{ x: 29.9, z: 5 }]);
  const clearSegment = (a, b) => trees.clearSegment(a, b);
  let originalCalls = 0,
    preflightCalls = 0;
  const original = validatedSidewalkRuns(
    graph,
    edge,
    1,
    () => {
      originalCalls++;
      return floor();
    },
    { clearSegment },
  );
  const candidate = validatedSidewalkRuns(
    graph,
    edge,
    1,
    () => {
      preflightCalls++;
      return floor();
    },
    { clearSegment, preflightTrunks: trees },
  );
  assert.deepEqual(candidate, original);
  assert(
    preflightCalls < originalCalls,
    `${preflightCalls} < ${originalCalls}`,
  );
  assert(
    candidate.length && preflightCalls,
    'clear surviving runs retain normal full floor proof',
  );
});

test('preflight retains route output across changing real interior and furniture collision states', async () => {
  const { PublicInteriors } = await import(cityModule('interiors'));
  const { StreetNavigation } = await import(cityModule('navigation'));
  const { CityStreetFurniture } = await import(
    cityModule('street-furniture-world')
  );
  const { StreetFurnitureBlockers } = await import(
    cityModule('street-furniture-placement')
  );
  const engine = {
    settings: { buildings: true },
    data: {},
    onLand: () => true,
  };
  const interior = Object.create(PublicInteriors.prototype);
  Object.assign(interior, { e: engine, waterfrontAuthority: null, sites: [] });
  engine.interiors = interior;
  const furniture = Object.create(CityStreetFurniture.prototype);
  Object.assign(furniture, { e: engine, renderer: { ready: true } });
  engine.streetFurniture = furniture;
  const nav = Object.create(StreetNavigation.prototype);
  Object.assign(nav, { e: engine, collisions: new Map() });
  const rectangle = (left, right, low, high) => [
    [left, low],
    [right, low],
    [right, high],
    [left, high],
  ];
  for (let step = 0; step < 90; step++) {
    const shift = (step % 3) * 3;
    const graph = buildRoadGraph(
      [
        {
          id: 'source',
          name: 'Robson St',
          roadClass: 'local',
          width: 8 + (step % 2),
          corridorWidth: 13,
          level: 'ground',
          points: [
            [shift, 0],
            [100 + shift, 0],
          ],
        },
      ],
      { nodeIntersections: false },
    );
    const edge = graph.edges[0],
      side = step % 2 ? 1 : -1;
    const trees = new TrunkClearanceIndex([
      { x: 25 + ((step * 7) % 70), z: side * (5 + (step % 2) * 0.5) },
    ]);
    interior.sites =
      step % 3
        ? [
            {
              id: 'canada',
              origin: { x: 0, z: 0 },
              yaw: 0,
              polys: [rectangle(20 + (step % 12), 55, -8, 8)],
              doors: [],
              approach: { x: -999, z: -999, w: 1, d: 1 },
              obstacles: step % 2 ? [{ x: 36, z: side * 5, w: 1, d: 3 }] : [],
              legacyHallObstacles: [],
            },
          ]
        : [];
    furniture.blockers = new StreetFurnitureBlockers(
      step % 4
        ? [{ kind: 'cedar-bench', x: 55 + (step % 12), z: side * 5, yaw: 0 }]
        : [],
    );
    const clearSegment = (a, b) => trees.clearSegment(a, b);
    const probe = (x, z) =>
      nav.clearGround(x, z, 'walk', true)
        ? { y: 1.18, surfaceId: 'ground', layer: 0 }
        : undefined;
    const original = validatedSidewalkRuns(graph, edge, side, probe, {
      clearSegment,
    });
    const candidate = validatedSidewalkRuns(graph, edge, side, probe, {
      clearSegment,
      preflightTrunks: trees,
    });
    assert.deepEqual(candidate, original, `dynamic state ${step}`);
  }
});
