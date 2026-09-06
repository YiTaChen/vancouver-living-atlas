import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const {
  buildRoadGraph,
  directionsAt,
  createCrossings,
  measurePath,
  sampleAt,
  sampleStations,
  junctionSetback,
} = await import(cityModule('road-graph'));
const road = (id, points, extra = {}) => ({
  id,
  name: id,
  roadClass: 'Arterial',
  width: 18,
  points,
  ...extra,
});
const crossRoads = (x = 0) => [
  road(`horizontal:${x}`, [
    [x - 100, 0],
    [x + 100, 0],
  ]),
  road(`vertical:${x}`, [
    [x, -100],
    [x, 100],
  ]),
];
const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('proper intersection is noded into one four-way junction', () => {
  const g = buildRoadGraph(crossRoads());
  assert.equal(g.edges.length, 4);
  assert.equal(g.junctions.length, 1);
  assert.equal(g.junctions[0].approaches.length, 4);
  assert.equal(createCrossings(g).crossings.length, 4);
});
test('T endpoint on an unsplit segment is noded; small survey mismatch snaps', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [100, 0],
    ]),
    road('b', [
      [0, 0.3],
      [0, 100],
    ]),
  ]);
  assert.equal(g.junctions.length, 1);
  assert.equal(g.junctions[0].approaches.length, 3);
  assert.equal(createCrossings(g).crossings.length, 3);
});
test('different explicit levels do not join and create no crossing', () => {
  const g = buildRoadGraph(
    crossRoads().map((r, i) => ({ ...r, level: i ? 'bridge' : 'ground' })),
  );
  assert.equal(g.edges.length, 2);
  assert.equal(g.junctions.length, 0);
  assert.equal(createCrossings(g).crossings.length, 0);
});
test('reversed duplicate and partial overlap edges deduplicate with provenance', () => {
  const g = buildRoadGraph([
    road('a', [
      [0, 0],
      [100, 0],
    ]),
    road('b', [
      [100, 0],
      [0, 0],
    ]),
    road('c', [
      [25, 0],
      [75, 0],
    ]),
  ]);
  assert.equal(g.edges.length, 3);
  assert.ok(g.stats.duplicates >= 3);
  assert.equal(
    g.edges.find((e) => Math.abs(e.length - 50) < 1e-6).sourceIds.length,
    3,
  );
  assert.equal(createCrossings(g).crossings.length, 0);
  near(
    g.edges.reduce((s, e) => s + e.length, 0),
    100,
  );
});
test('bend and arbitrary intermediate vertices do not imply crossings', () => {
  const g = buildRoadGraph([
    road('curve', [
      [0, 0],
      [10, 0],
      [30, 5],
      [60, 20],
      [100, 20],
    ]),
  ]);
  assert.equal(g.junctions.length, 0);
  assert.equal(createCrossings(g).crossings.length, 0);
  assert.equal(g.paths.length, 1);
  assert.equal(g.paths[0].edgeIds.length, 4);
});
test('close outgoing bearings merge without merging opposite continuation', () => {
  const g = buildRoadGraph(
    [
      road('a', [
        [0, 0],
        [100, 0],
      ]),
      road('b', [
        [0, 0],
        [100, 8],
      ]),
      road('c', [
        [0, 0],
        [-100, 0],
      ]),
    ],
    { nodeIntersections: false },
  );
  const node = g.nodes.find((n) => n.point[0] === 0 && n.point[1] === 0);
  assert.equal(directionsAt(g, node.id).length, 2);
  assert.equal(g.junctions.length, 0);
});
test('bearing merge does not transitively swallow a broad fork', () => {
  const rays = [0, 9, 18].map((d, i) =>
    road(String(i), [
      [0, 0],
      [
        100 * Math.cos((d * Math.PI) / 180),
        100 * Math.sin((d * Math.PI) / 180),
      ],
    ]),
  );
  const g = buildRoadGraph(rays, { nodeIntersections: false });
  const n = g.nodes.find((n) => n.edgeIds.length === 3);
  assert.equal(directionsAt(g, n.id).length, 2);
});
test('setback accounts for road widths; all corners clear turning corridor', () => {
  const g = buildRoadGraph([
    road(
      'a',
      [
        [-100, 0],
        [100, 0],
      ],
      { width: 18 },
    ),
    road(
      'b',
      [
        [0, -100],
        [0, 100],
      ],
      { width: 14 },
    ),
  ]);
  const junction = g.junctions[0],
    horizontal = junction.approaches.find((a) => a.direction[0] > 0.9);
  near(
    junctionSetback(horizontal, junction.approaches),
    3.3 / 2 + 14 / 2 + 1.25,
  );
  const c = createCrossings(g).crossings.find(
    (c) => c.approachId === horizontal.id,
  );
  assert.ok(c.corners.every(([x]) => x >= 14 / 2 + 1.25 - 1e-7));
});
test('dense initial polyline vertex does not truncate usable crossing approach', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [100, 0],
    ]),
    road('b', [
      [0, -100],
      [0, 100],
    ]),
  ]);
  assert.equal(createCrossings(g).crossings.length, 4);
});
test('too-short approach is rejected, not clamped onto next intersection', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [6, 0],
    ]),
    road('b', [
      [0, -100],
      [0, 100],
    ]),
  ]);
  const result = createCrossings(g);
  assert.equal(result.crossings.length, 3);
  assert.equal(result.rejected[0].reason, 'short-approach');
});
test('width change before crossing is rejected rather than painting outside narrow road', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [0, 0],
      [5, 0],
    ]),
    road(
      'b',
      [
        [5, 0],
        [100, 0],
      ],
      { width: 9 },
    ),
    road('c', [
      [0, -100],
      [0, 100],
    ]),
  ]);
  const result = createCrossings(g);
  assert.equal(result.crossings.length, 3);
  assert.equal(
    result.rejected.filter((r) => r.reason === 'width-transition').length,
    1,
  );
});
test('crossing spanning a curve is rejected even if centre tangent is straight', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [0, 0],
      [11, 0],
      [14, 3],
      [100, 3],
    ]),
    road('b', [
      [0, -100],
      [0, 100],
    ]),
  ]);
  const result = createCrossings(g);
  assert.equal(result.crossings.length, 3);
  assert.equal(
    result.rejected.filter((r) => r.reason === 'curved-approach').length,
    1,
  );
});
test('overlapping proposals from adjacent junctions are both removed', () => {
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [125, 0],
    ]),
    road('b', [
      [0, -100],
      [0, 100],
    ]),
    road('c', [
      [24, -100],
      [24, 100],
    ]),
  ]);
  const result = createCrossings(g);
  assert.equal(result.crossings.length, 6);
  assert.equal(
    result.rejected.filter((r) => r.reason === 'overlapping-proposals').length,
    2,
  );
});
test('acute skew crossing is safely omitted when required setback exceeds budget', () => {
  const a = Math.PI / 9;
  const g = buildRoadGraph([
    road('a', [
      [-100, 0],
      [100, 0],
    ]),
    road('b', [
      [-100 * Math.cos(a), -100 * Math.sin(a)],
      [100 * Math.cos(a), 100 * Math.sin(a)],
    ]),
  ]);
  const result = createCrossings(g);
  assert.equal(result.crossings.length, 0);
  assert.equal(
    result.rejected.filter((r) => r.reason === 'acute-junction').length,
    4,
  );
});
test('arc-length phase is invariant under adding intermediate vertices', () => {
  const a = measurePath([
      [0, 0],
      [100, 0],
    ]),
    b = measurePath([
      [0, 0],
      [7, 0],
      [32, 0],
      [32, 0],
      [100, 0],
    ]);
  assert.deepEqual(
    sampleStations(a, 15, 8).map((s) => s.point),
    sampleStations(b, 15, 8).map((s) => s.point),
  );
  assert.deepEqual(
    sampleStations(a, 15, 8, 20, 50).map((s) => s.distance),
    [23, 38],
  );
  const corner = sampleAt(
    measurePath([
      [0, 0],
      [10, 0],
      [10, 10],
    ]),
    15,
  );
  assert.deepEqual(corner.point, [10, 5]);
  assert.deepEqual(corner.tangent, [0, 1]);
});
test('closed loop emits each edge once and no invented junction', () => {
  const g = buildRoadGraph([
    road('ring', [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
      [0, 0],
    ]),
  ]);
  assert.equal(g.paths.length, 1);
  assert.equal(g.paths[0].closed, true);
  near(g.paths[0].length, 200);
  assert.equal(g.paths[0].edgeIds.length, 4);
  assert.equal(g.junctions.length, 0);
});
test('geometry does not mutate source and input permutation preserves result', () => {
  const inputs = crossRoads(),
    original = structuredClone(inputs);
  const a = buildRoadGraph(inputs),
    b = buildRoadGraph([...inputs].reverse());
  assert.deepEqual(inputs, original);
  assert.deepEqual(a, b);
  assert.ok(a.nodes.every((n) => n.point.every(Number.isFinite)));
});
test('invalid finite values fail early; degenerate points generate no NaNs', () => {
  assert.throws(() =>
    buildRoadGraph([
      road('bad', [
        [NaN, 0],
        [1, 1],
      ]),
    ]),
  );
  assert.throws(() =>
    buildRoadGraph([
      road(
        'bad',
        [
          [0, 0],
          [1, 1],
        ],
        { width: Infinity },
      ),
    ]),
  );
  const g = buildRoadGraph([
    road('tiny', [
      [1, 1],
      [1, 1],
    ]),
  ]);
  assert.equal(g.edges.length, 0);
  assert.equal(sampleAt(measurePath([[1, 1]]), 0), null);
  assert.throws(() =>
    sampleStations(
      measurePath([
        [0, 0],
        [100, 0],
      ]),
      0,
    ),
  );
});
