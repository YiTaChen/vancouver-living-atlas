import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { buildRoadGraph } = await import(cityModule('road-graph'));
const { buildPavement } = await import(cityModule('pavement'));
const road = (
  id,
  points,
  width = 10,
  roadClass = 'Residential',
  level = 'ground',
) => ({ id, name: id, width, roadClass, points, level });
const graph = (roads) => buildRoadGraph(roads, { nodeIntersections: false });
const area2 = (p) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
const triangles = (mesh) =>
  Array.from({ length: mesh.indices.length / 3 }, (_, i) =>
    mesh.indices.slice(i * 3, i * 3 + 3).map((n) => mesh.vertices[n]),
  );
// Independent SAT invariant: sharing an edge/corner is permitted; positive-area intersection is not.
function positiveOverlap(a, b) {
  for (const p of [a, b])
    for (let i = 0; i < p.length; i++) {
      const from = p[i],
        to = p[(i + 1) % p.length],
        length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length < 1e-7) continue;
      const nx = -(to[1] - from[1]) / length,
        ny = (to[0] - from[0]) / length;
      const aa = a.map(([x, y]) => x * nx + y * ny),
        bb = b.map(([x, y]) => x * nx + y * ny);
      if (
        Math.min(Math.max(...aa), Math.max(...bb)) -
          Math.max(Math.min(...aa), Math.min(...bb)) <=
        1e-6
      )
        return false;
    }
  return true;
}
function contains(mesh, [x, y]) {
  return triangles(mesh).some((tri) =>
    tri.every((a, i) => {
      const b = tri[(i + 1) % 3];
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-6;
    }),
  );
}
function sourceRectangles(g) {
  return g.edges.map((e) => {
    const a = g.nodes[e.a].point,
      b = g.nodes[e.b].point;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]),
      nx = ((-(b[1] - a[1]) / len) * e.width) / 2,
      ny = (((b[0] - a[0]) / len) * e.width) / 2;
    return {
      level: g.nodes[e.a].level,
      points: [
        [a[0] + nx, a[1] + ny],
        [a[0] - nx, a[1] - ny],
        [b[0] - nx, b[1] - ny],
        [b[0] + nx, b[1] + ny],
      ],
    };
  });
}
function validate(g, result) {
  const paving = triangles(result.sidewalks),
    asphalt = triangles(result.asphalt);
  for (const mesh of [result.sidewalks, result.asphalt]) {
    assert.ok(
      mesh.vertices.every((p) => p.length === 2 && p.every(Number.isFinite)),
    );
    assert.ok(
      mesh.indices.every(
        (i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length,
      ),
    );
    assert.equal(mesh.levels.length, mesh.vertices.length);
    assert.ok(triangles(mesh).every((tri) => area2(tri) > 1e-7));
  }
  for (let i = 0; i < paving.length; i++) {
    const level = result.sidewalks.levels[result.sidewalks.indices[i * 3]];
    for (const p of [...sourceRectangles(g), ...result.junctionPatches])
      if (p.level === level)
        assert.equal(
          positiveOverlap(paving[i], p.points),
          false,
          `sidewalk ${i} overlaps road corridor`,
        );
    for (let j = i + 1; j < paving.length; j++)
      if (result.sidewalks.levels[result.sidewalks.indices[j * 3]] === level)
        assert.equal(
          positiveOverlap(paving[i], paving[j]),
          false,
          `duplicate sidewalk area ${i}/${j}`,
        );
  }
  for (let i = 0; i < asphalt.length; i++)
    for (let j = i + 1; j < asphalt.length; j++) {
      if (
        result.asphalt.levels[result.asphalt.indices[i * 3]] ===
        result.asphalt.levels[result.asphalt.indices[j * 3]]
      )
        assert.equal(
          positiveOverlap(asphalt[i], asphalt[j]),
          false,
          `duplicate asphalt area ${i}/${j}`,
        );
    }
  assert.ok(
    result.curbs.every(
      (c) =>
        [...c.a, ...c.b].every(Number.isFinite) &&
        Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]) <= 12 + 1e-6,
    ),
  );
}

test('straight road retains side pavements and no disk/end-cap across travel direction', () => {
  const g = graph([
      road('a', [
        [0, 0],
        [100, 0],
      ]),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.equal(contains(r.sidewalks, [50, 6]), true);
  assert.equal(contains(r.sidewalks, [50, 0]), false);
  assert.equal(contains(r.asphalt, [102, 0]), false);
  assert.equal(contains(r.sidewalks, [102, 0]), false);
  assert.equal(r.junctionPatches.length, 0);
  const area = triangles(r.sidewalks).reduce((s, t) => s + area2(t) / 2, 0);
  assert.ok(Math.abs(area - 400) < 1e-5);
});
test('four-way intersection opens every sidewalk throat and never covers incident asphalt', () => {
  const g = graph([
      road(
        'h',
        [
          [-60, 0],
          [0, 0],
          [60, 0],
        ],
        18,
      ),
      road(
        'v',
        [
          [0, -60],
          [0, 0],
          [0, 60],
        ],
        14,
      ),
    ]),
    r = buildPavement(g);
  validate(g, r);
  for (const p of [
    [0, 10],
    [0, -10],
    [8, 0],
    [-8, 0],
  ])
    assert.equal(contains(r.sidewalks, p), false);
  assert.equal(contains(r.sidewalks, [8, 10]), true);
});
test('T intersection with private access keeps access asphalt and cuts major-road sidewalk', () => {
  const g = graph([
      road(
        'h',
        [
          [-60, 0],
          [0, 0],
          [60, 0],
        ],
        18,
      ),
      road(
        'private',
        [
          [0, 0],
          [0, 60],
        ],
        6,
        'Private',
      ),
    ]),
    r = buildPavement(g);
  validate(g, r);
  for (const x of [-2.9, 0, 2.9]) {
    assert.equal(contains(r.asphalt, [x, 10]), true);
    assert.equal(contains(r.sidewalks, [x, 10]), false);
  }
  assert.equal(
    contains(r.sidewalks, [4, 40]),
    false,
    'no newly invented private-road sidewalk',
  );
  assert.equal(
    contains(r.sidewalks, [0, -10]),
    true,
    'opposite through sidewalk stays connected',
  );
  assert.ok(
    !r.curbs.some(
      (c) =>
        Math.abs(c.a[1] - 9) < 1e-6 &&
        Math.abs(c.b[1] - 9) < 1e-6 &&
        Math.min(c.a[0], c.b[0]) < 2.9 &&
        Math.max(c.a[0], c.b[0]) > -2.9,
    ),
  );
});
test('lane included in asphalt mask does not get synthetic sidewalks', () => {
  const g = graph([
      road(
        'main',
        [
          [-60, 0],
          [0, 0],
          [60, 0],
        ],
        10,
      ),
      road(
        'lane',
        [
          [0, 0],
          [0, 40],
        ],
        4,
        'Lane',
      ),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.equal(contains(r.asphalt, [0, 30]), true);
  assert.equal(contains(r.sidewalks, [3, 30]), false);
  assert.equal(contains(r.sidewalks, [0, 6]), false);
});
test('degree-2 bend receives bevel asphalt and an outer sidewalk connector', () => {
  const g = graph([
      road('bend', [
        [-60, 0],
        [0, 0],
        [0, 60],
      ]),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.equal(
    contains(r.asphalt, [2, -2]),
    true,
    'fills original rectangular ribbon gap',
  );
  assert.equal(
    contains(r.sidewalks, [3, -3]),
    true,
    'fills outer sidewalk bend gap',
  );
  assert.equal(
    contains(r.asphalt, [4, -4]),
    false,
    'does not inflate corner into a square/disk',
  );
  assert.equal(
    contains(r.sidewalks, [-6, 6]),
    true,
    'inside corner strips union without duplicates',
  );
});
test('acute junction has finite bounded hull rather than a long miter spike', () => {
  const angle = (7 * Math.PI) / 180;
  const g = graph([
      road('a', [
        [0, 0],
        [100, 0],
      ]),
      road('b', [
        [0, 0],
        [100 * Math.cos(angle), 100 * Math.sin(angle)],
      ]),
      road('c', [
        [0, 0],
        [-100, 0],
      ]),
    ]),
    r = buildPavement(g);
  validate(g, r);
  for (const patch of r.junctionPatches)
    for (const p of patch.points) assert.ok(Math.hypot(...p) <= 5 + 1e-6);
  assert.ok(r.asphalt.vertices.length < 500);
  assert.ok(r.sidewalks.vertices.length < 500);
});
test('width-transition sidewalks connect conservatively while narrow lane stays clear', () => {
  const g = graph([
      road(
        'a',
        [
          [-60, 0],
          [0, 0],
        ],
        10,
      ),
      road(
        'b',
        [
          [0, 0],
          [60, 0],
        ],
        18,
      ),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.equal(contains(r.sidewalks, [-0.1, 8]), true);
  assert.equal(contains(r.sidewalks, [0.1, 8]), false);
});
test('nearby un-noded crossing still cuts ground-level pavement through asphalt mask', () => {
  const g = graph([
      road('a', [
        [-60, 0],
        [60, 0],
      ]),
      road('b', [
        [0, -60],
        [0, 60],
      ]),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.equal(g.junctions.length, 0);
  assert.equal(contains(r.sidewalks, [0, 6]), false);
});
test('explicit topology levels are isolated for mask subtraction and indexed vertices', () => {
  const g = graph([
      road(
        'ground',
        [
          [-60, 0],
          [60, 0],
        ],
        10,
      ),
      road(
        'overpass',
        [
          [0, -60],
          [0, 60],
        ],
        10,
        'Residential',
        'bridge',
      ),
    ]),
    r = buildPavement(g);
  validate(g, r);
  assert.ok(
    r.sidewalkPolygons.some(
      (p) => p.level === 'ground' && p.points.some(([x]) => x < -50),
    ),
  );
  const area = triangles(r.sidewalks).reduce((s, t) => s + area2(t) / 2, 0);
  assert.ok(Math.abs(area - 960) < 1e-5);
});
test('empty graph and invalid geometry budgets fail safely without partial mesh return', () => {
  const empty = buildPavement(graph([]));
  assert.equal(empty.asphalt.indices.length, 0);
  assert.equal(empty.curbs.length, 0);
  const g = graph([
    road('a', [
      [0, 0],
      [100, 0],
    ]),
  ]);
  assert.throws(() => buildPavement(g, { maxVertices: 2 }), /budget/);
  assert.throws(() => buildPavement(g, { sidewalkWidth: () => NaN }), /width/);
});
test('connected curb extension reclaims asphalt without covering the remaining driving lane', () => {
  const g = graph([
    road(
      'r',
      [
        [0, 0],
        [100, 0],
      ],
      8,
    ),
  ]);
  const bulb = [
    [40, 4.5],
    [40, 4],
    [43, 2.8],
    [47, 2.8],
    [50, 4],
    [50, 4.5],
  ];
  const p = buildPavement(g, {
    sidewalkExtensions: [{ points: bulb, level: 'ground' }],
  });
  const contains = (polys, q) =>
    polys.some(({ points: r }) =>
      r.every((a, i) => {
        const b = r[(i + 1) % r.length];
        return (
          (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) >= -1e-7
        );
      }),
    );
  assert(!contains(p.asphaltPolygons, [45, 3.6]));
  assert(contains(p.sidewalkPolygons, [45, 3.6]));
  assert(contains(p.asphaltPolygons, [45, 2.7]));
  assert(contains(p.sidewalkPolygons, [45, 5]));
});
