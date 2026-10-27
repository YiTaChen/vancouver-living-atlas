import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cityModule } from './helpers/city-modules.mjs';

const { project } = await import(cityModule('geo'));
const { cityRoadGraph } = await import(cityModule('street-layout'));
const { buildPavement } = await import(cityModule('pavement'));
const { applyRobsonPilotTreeBlock } = await import(
  cityModule('robson-tree-block')
);

const source = [
  [-123.1217906, 49.2826345],
  [-123.1222754, 49.2829491],
  [-123.1228089, 49.2832957],
];
const local = source.map(project);
const pointOn = (a, b, t, offset) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = Math.hypot(dx, dz);
  return [
    a[0] + t * dx - (offset * dz) / length,
    a[1] + t * dz + (offset * dx) / length,
  ];
};
const input = (id, points) => ({
  id,
  name: 'ROBSON ST',
  roadClass: 'Arterial',
  width: 18,
  corridorWidth: 22,
  level: 'ground',
  crossingEligible: true,
  points,
});
const syntheticTrees = () =>
  [0.18, 0.36, 0.6, 0.84].flatMap((t) => {
    const side = t < 0.5 ? 0 : 1,
      position = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    return [-7, 7].map((d) => ({
      point: pointOn(local[side], local[side + 1], position, d),
    }));
  });
const contains = (surface, p) => {
  for (let i = 0; i < surface.indices.length; i += 3) {
    const tri = surface.indices.slice(i, i + 3).map((n) => surface.vertices[n]);
    const signs = tri.map((a, n) => {
      const b = tri[(n + 1) % 3];
      return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    });
    if (signs.every((n) => n >= -1e-7) || signs.every((n) => n <= 1e-7))
      return true;
  }
  return false;
};

void test('exact contiguous source segments use two-sided tree evidence without moving geography', () => {
  const roads = [
    input('a', [local[0], local[1]]),
    input('b', [local[2], local[1]]),
    input('outside', [
      [0, 0],
      [100, 0],
    ]),
  ];
  const trees = syntheticTrees(),
    originalPoints = JSON.stringify(roads.map((x) => x.points)),
    originalTrees = JSON.stringify(trees);
  applyRobsonPilotTreeBlock(roads, trees);
  assert.equal(roads[0].width, 12.4);
  assert.equal(roads[1].width, 12.4);
  assert.equal(roads[2].width, 18);
  assert.deepEqual(
    roads.map((x) => x.corridorWidth),
    [22, 22, 22],
  );
  assert.equal(JSON.stringify(roads.map((x) => x.points)), originalPoints);
  assert.equal(JSON.stringify(trees), originalTrees);
});

void test('incomplete, ambiguous, clipped or unsupported data retain all existing widths', () => {
  for (const variant of ['one', 'duplicate', 'clipped', 'class', 'sparse']) {
    const roads = [
      input('a', [local[0], local[1]]),
      input('b', [local[1], local[2]]),
    ];
    if (variant === 'one') roads.pop();
    if (variant === 'duplicate')
      roads.push(input('copy', [local[0], local[1]]));
    if (variant === 'clipped')
      roads[1].points = [pointOn(local[1], local[2], 0.01, 0), local[2]];
    if (variant === 'class') roads[1].roadClass = 'Private';
    applyRobsonPilotTreeBlock(
      roads,
      variant === 'sparse' ? syntheticTrees().slice(0, 2) : syntheticTrees(),
    );
    assert(
      roads.every((x) => x.width === 18),
      variant,
    );
  }
});

void test('real pilot tree rows move from asphalt into connected sidewalks while centre and junction topology remain', async () => {
  const roads = JSON.parse(
    await readFile(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
  );
  const sourceTrees = JSON.parse(
    await readFile(
      new URL('../public/data/trees.json', import.meta.url),
      'utf8',
    ),
  ).trees;
  // Actual source segments meeting the two intersections, retained in original order.
  const indices = [85, 215, 417, 762, 940, 1917, 1940];
  const features = indices.map((i) => roads.features[i]);
  const g = cityRoadGraph({ features }, sourceTrees);
  const pilotIds = [1, 4];
  for (const id of pilotIds) {
    const edges = g.edges.filter((edge) => edge.sourceIds.includes(`${id}:0`));
    assert(edges.length > 0);
    assert(
      edges.every(
        (edge) =>
          Math.abs(edge.width - 12.1) < 1e-9 && edge.corridorWidth === 22,
      ),
    );
    for (const edge of edges)
      for (const node of [g.nodes[edge.a], g.nodes[edge.b]]) {
        const p = features[id].geometry.coordinates.map(project),
          dx = p[1][0] - p[0][0],
          dz = p[1][1] - p[0][1];
        assert(
          Math.abs(
            (node.point[0] - p[0][0]) * dz - (node.point[1] - p[0][1]) * dx,
          ) < 1e-4,
        );
      }
  }
  assert.equal(g.junctions.length, 2);
  assert(g.junctions.every((junction) => junction.approaches.length === 4));
  const pavement = buildPavement(g, {
    sidewalkWidth: (edge) => Math.max(2, (edge.corridorWidth - edge.width) / 2),
  });
  for (const treeId of [11313, 19329, 19330]) {
    const p = project(sourceTrees[treeId]);
    assert(!contains(pavement.asphalt, p), `tree ${treeId} is outside asphalt`);
    assert(contains(pavement.sidewalks, p), `tree ${treeId} is on sidewalk`);
  }
  // The existing lane offset remains inside each revised carriageway, with
  // the original trees beyond its one-metre lateral vehicle footprint.
  for (const id of pilotIds) {
    const line = features[id].geometry.coordinates.map(project),
      w = 12.1;
    for (const t of [0.25, 0.5, 0.75])
      for (const side of [-1, 1]) {
        const p = pointOn(line[0], line[1], t, side * w * 0.23);
        assert(contains(pavement.asphalt, p));
        for (const treeId of [11313, 19329, 19330])
          assert(
            Math.hypot(
              p[0] - project(sourceTrees[treeId])[0],
              p[1] - project(sourceTrees[treeId])[1],
            ) > 1,
          );
      }
  }
});
