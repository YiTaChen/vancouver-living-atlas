import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cityModule } from './helpers/city-modules.mjs';
const { constrainCarriageway: constrain } = await import(
  cityModule('tree-road-clearance')
);
const line = [
  [0, 0],
  [100, 0],
];
const trees = (stations = [20, 40, 60, 80], d = 6.5) =>
  stations.flatMap((x) => [-1, 1].map((s) => ({ point: [x, s * d] })));

test('two supported rows narrow asphalt while preserving corridor and all tree XY', () => {
  const t = trees(),
    before = JSON.stringify(t),
    r = constrain(line, t, 18);
  assert.equal(r.asphaltWidth, 11.4);
  assert.equal(r.corridorWidth, 22);
  assert.equal(r.sidewalkEach, 5.3);
  assert.equal(r.asphaltWidth + 2 * r.sidewalkEach, r.corridorWidth);
  assert.equal(JSON.stringify(t), before);
  for (const s of r.sides) {
    assert.ok(s.eligible && s.row.length === 4 && s.spanFraction >= 0.35);
  }
});

test('one side, fewer than three trees, or short longitudinal span cannot authorize narrowing', () => {
  assert.equal(
    constrain(
      line,
      trees().filter((t) => t.point[1] > 0),
      18,
    ).asphaltWidth,
    undefined,
  );
  assert.equal(constrain(line, trees([20, 80]), 18).asphaltWidth, undefined);
  const clustered = constrain(line, trees([20, 25, 30]), 18);
  assert.equal(clustered.asphaltWidth, undefined);
  assert.equal(clustered.sides[0].reason, 'short-span');
});

test('end/intersection points and duplicate records cannot fabricate a full row', () => {
  const end = constrain(line, trees([1, 3, 6, 93, 95, 99]), 18);
  assert.equal(end.asphaltWidth, undefined);
  const repeated = Array.from({ length: 50 }, () => trees([20, 80])).flat();
  const r = constrain(line, repeated, 18);
  assert.equal(r.asphaltWidth, undefined);
  assert.equal(r.sides[0].candidates, 2);
});

test('isolated bad coordinate is rejected; broad scattered lateral data fails row evidence', () => {
  const t = trees();
  t.push({ point: [50, 1.4] }, { point: [52, -1.4] });
  assert.equal(constrain(line, t, 18).asphaltWidth, 11.4);
  const noisy = [20, 40, 60, 80].flatMap((x, i) =>
    [-1, 1].map((s) => ({ point: [x, s * [2, 5, 8, 11][i]] })),
  );
  const r = constrain(line, noisy, 18);
  assert.equal(r.asphaltWidth, undefined);
  assert.equal(r.sides[0].reason, 'noisy');
});

test('minimum/cap never widen an existing narrow road and disclose limited clearance', () => {
  const floor = constrain(line, trees(undefined, 3.5), 18);
  assert.equal(floor.asphaltWidth, 6);
  assert.equal(floor.limitedByMinimum, true);
  const cap = constrain(line, trees(), 9);
  assert.equal(cap.asphaltWidth, undefined);
  assert.equal(cap.reason, 'already-clear');
  assert.equal(cap.corridorWidth, 13);
  assert.equal(constrain(line, trees(), 4).asphaltWidth, undefined);
});

test('curved route stationing and side reversal produce the same width', () => {
  const curve = [
      [0, 0],
      [50, 0],
      [50, 50],
    ],
    t = [];
  for (const x of [20, 40])
    for (const s of [-1, 1]) t.push({ point: [x, s * 6.5] });
  for (const z of [10, 30])
    for (const s of [-1, 1]) t.push({ point: [50 + s * 6.5, z] });
  const a = constrain(curve, t, 18),
    b = constrain([...curve].reverse(), [...t].reverse(), 18);
  assert.equal(a.asphaltWidth, 11.4);
  assert.equal(a.asphaltWidth, b.asphaltWidth);
  assert.ok(a.sides.every((s) => s.spanFraction >= 0.35));
});

test('current Water and Robson records support exactly ten local constraints; retained row centres clear asphalt', async () => {
  const roads = JSON.parse(
    await readFile(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
  );
  const treeData = JSON.parse(
    await readFile(
      new URL('../public/data/trees.json', import.meta.url),
      'utf8',
    ),
  );
  const { project, lines } = await import(cityModule('geo'));
  const actual = {
    trees: treeData.trees.map((p, id) => ({ point: project(p), id })),
    features: [],
  };
  roads.features.forEach((f, index) => {
    if (
      !/^(WATER|ROBSON) ST$/.test(f.properties.name) ||
      f.properties.width < 12
    )
      return;
    lines(f).forEach((line, part) =>
      actual.features.push({
        id: `${index}:${part}`,
        points: line.map(project),
        originalWidth: f.properties.width,
      }),
    );
  });
  const expected = {
    '29:0': 8.2,
    '846:0': 7.7,
    '31:0': 12,
    '85:0': 11.7,
    '214:0': 12.4,
    '330:0': 12.1,
    '384:0': 12.1,
    '1218:0': 12.9,
    '1360:0': 12.2,
    '1543:0': 12.4,
  };
  let n = 0,
    cleared = 0;
  for (const f of actual.features) {
    const r = constrain(f.points, actual.trees, f.originalWidth);
    assert.equal(r.asphaltWidth, expected[f.id], f.id);
    if (r.asphaltWidth === undefined) continue;
    n++;
    assert.equal(r.corridorWidth, 22);
    assert.equal(r.asphaltWidth + 2 * r.sidewalkEach, 22);
    for (const side of r.sides) {
      assert.ok(side.row.length >= 3 && side.spanFraction >= 0.35);
      for (const t of side.row) {
        assert.ok(t.distance >= r.asphaltWidth / 2);
        cleared++;
      }
    }
    assert.equal(
      constrain([...f.points].reverse(), actual.trees, f.originalWidth)
        .asphaltWidth,
      r.asphaltWidth,
    );
  }
  assert.equal(n, 10);
  console.log(
    JSON.stringify({
      constrainedFeatures: n,
      retainedRowTreesClearAsphalt: cleared,
    }),
  );
});

test('invalid input cannot silently emit a non-finite pavement width', () => {
  assert.throws(() => constrain(line, trees(), NaN));
  assert.throws(() => constrain(line, trees(), 18, { quantile: Infinity }));
  assert.throws(() =>
    constrain(
      [
        [0, 0],
        [NaN, 1],
      ],
      trees(),
      18,
    ),
  );
  assert.equal(
    constrain(
      [
        [0, 0],
        [0, 0],
      ],
      trees(),
      18,
    ).asphaltWidth,
    undefined,
  );
  assert.equal(
    constrain(
      [
        [0, 0],
        [15, 0],
      ],
      trees(),
      18,
    ).reason,
    'short-route',
  );
});
test('numbered block fragments share bilateral tree evidence without merging entire named streets', async () => {
  const { groupNumberedBlocks } = await import(cityModule('numbered-blocks'));
  const roads = [
    {
      id: 'a',
      name: '200-300 WATER ST',
      width: 18,
      points: [
        [0, 0],
        [50, 0],
      ],
    },
    {
      id: 'b',
      name: '200-300 WATER ST',
      width: 18,
      points: [
        [100, 0],
        [50, 0],
      ],
    },
    {
      id: 'c',
      name: 'WATER ST',
      width: 18,
      points: [
        [100, 0],
        [200, 0],
      ],
    },
  ];
  const grouped = groupNumberedBlocks(roads);
  assert.equal(grouped.blocks.length, 1);
  assert.equal(grouped.blocks[0].length, 100);
  assert.deepEqual(grouped.blocks[0].points, [
    [0, 0],
    [50, 0],
    [100, 0],
  ]);
  assert.deepEqual(grouped.ignored, ['c']);
  assert.equal(
    constrain(grouped.blocks[0].points, trees(), 18).asphaltWidth,
    11.4,
  );
  roads[1].level = 'bridge';
  assert.equal(groupNumberedBlocks(roads).blocks.length, 0);
});
test('actual numbered Water Street block regains connected sidewalks on both original fragments', async () => {
  const { cityRoadGraph } = await import(cityModule('street-layout'));
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
  ).trees;
  const graph = cityRoadGraph(roads, trees);
  for (const id of ['673:0', '1465:0']) {
    const edges = graph.edges.filter((e) => e.sourceIds.includes(id));
    assert(edges.length);
    for (const e of edges) {
      assert.equal(e.width, 8.4);
      assert.equal(e.corridorWidth, 22);
    }
  }
});
