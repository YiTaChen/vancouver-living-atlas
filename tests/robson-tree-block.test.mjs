import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cityModule } from './helpers/city-modules.mjs';

const { project, inPolygon } = await import(cityModule('geo'));
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

// Polygon intersection for a sampled vehicle rectangle. This is a geometric
// check against source footprints, not the engine's dynamic collision model.
const cross = (a, b, p) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const onSegment = (a, b, p) =>
  Math.abs(cross(a, b, p)) < 1e-8 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-8 &&
  p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-8 &&
  p[1] <= Math.max(a[1], b[1]) + 1e-8;
const segmentsIntersect = (a, b, c, d) => {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    w = cross(c, d, b);
  return (
    (((x > 0 && y < 0) || (x < 0 && y > 0)) &&
      ((z > 0 && w < 0) || (z < 0 && w > 0))) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
};
const rectangleIntersectsPolygon = (rect, rings) =>
  rect.some((point) => inPolygon(point, rings)) ||
  rings[0].some((point) => inPolygon(point, [rect])) ||
  rings.some((ring) =>
    ring.some((point, i) =>
      rect.some((corner, j) =>
        segmentsIntersect(
          point,
          ring[(i + 1) % ring.length],
          corner,
          rect[(j + 1) % rect.length],
        ),
      ),
    ),
  );

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
  assert.equal(roads[0].width, 18);
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

void test('real pilot tree rows and the retained-width junction stay connected in the full road network', async () => {
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
  // The remote causeway masks and Water Street curb extension are not part of
  // this source-only fixture; neither intersects the Robson/Burrard junction.
  const features = roads.features;
  const g = cityRoadGraph(roads, sourceTrees);
  const pilotIds = [215, 940];
  for (const id of pilotIds) {
    const edges = g.edges.filter((edge) => edge.sourceIds.includes(`${id}:0`));
    assert(edges.length > 0);
    assert(
      edges.every(
        (edge) =>
          Math.abs(edge.width - (id === 215 ? 18 : 12.1)) < 1e-9 &&
          edge.corridorWidth === 22,
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
  for (const point of [local[1], local[2]]) {
    const junction = g.junctions.find((candidate) => {
      const node = g.nodes[candidate.nodeId];
      return (
        Math.hypot(node.point[0] - point[0], node.point[1] - point[1]) < 1e-6
      );
    });
    assert(junction);
    assert.equal(junction.approaches.length, 4);
  }
  const pavement = buildPavement(g, {
    sidewalkWidth: (edge) =>
      edge.classes.every((c) => /lane|private|non.city|bikeway/i.test(c))
        ? 0
        : Math.max(2, (edge.corridorWidth - edge.width) / 2),
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
      w = id === 215 ? 18 : 12.1;
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
  // The existing minor-road intersection cuts through the sidewalks. Limit
  // this sample to the actual local surface, but construct it from the full
  // source road graph rather than just the intersection's immediate roads.
  const nearby = (surface) => {
    const indices = [];
    for (let i = 0; i < surface.indices.length; i += 3) {
      const triangle = surface.indices.slice(i, i + 3);
      const points = triangle.map((index) => surface.vertices[index]);
      const xs = points.map((p) => p[0]),
        zs = points.map((p) => p[1]);
      if (
        Math.min(...xs) <= local[1][0] + 25 &&
        Math.max(...xs) >= local[1][0] - 25 &&
        Math.min(...zs) <= local[1][1] + 25 &&
        Math.max(...zs) >= local[1][1] - 25
      )
        indices.push(...triangle);
    }
    return { vertices: surface.vertices, indices };
  };
  const asphalt = nearby(pavement.asphalt),
    sidewalk = nearby(pavement.sidewalks);
  const dx = local[2][0] - local[1][0],
    dz = local[2][1] - local[1][1],
    length = Math.hypot(dx, dz);
  const tangent = [dx / length, dz / length],
    normal = [-tangent[1], tangent[0]];
  const world = (station, lateral) => [
    local[1][0] + tangent[0] * station + normal[0] * lateral,
    local[1][1] + tangent[1] * station + normal[1] * lateral,
  ];
  for (let station = -12; station <= 12; station += 0.5) {
    for (const lateral of [0, -10, 10]) {
      const point = world(station, lateral);
      assert(
        contains(asphalt, point) || contains(sidewalk, point),
        `surface gap at ${station}, ${lateral}`,
      );
    }
    // This is a sampled straight/gradual lane transition, not an assertion
    // that arbitrary driving or crossing turns are collision-free.
    const blend = Math.max(0, Math.min(1, (station + 4) / 8));
    for (const side of [-1, 1]) {
      const lane = side * (18 * 0.23 * (1 - blend) + 12.1 * 0.23 * blend);
      for (const along of [-2.4, 0, 2.4])
        for (const across of [-1, 0, 1])
          assert(contains(asphalt, world(station + along, lane + across)));
    }
  }
  // This is a source-data conflict, not a new obstruction solved by narrowing.
  // Keep the 215 source width and its collision polygon unchanged.
  const buildings = JSON.parse(
    await readFile(
      new URL('../public/data/buildings.geojson', import.meta.url),
      'utf8',
    ),
  );
  const conflict = buildings.features.find(
    (feature) => feature.properties.id === 161863,
  );
  assert(conflict && conflict.geometry.type === 'Polygon');
  const polygon = conflict.geometry.coordinates.map((ring) =>
    ring.map(project),
  );
  assert(
    inPolygon(
      pointOn(
        ...features[215].geometry.coordinates.map(project),
        0.75,
        18 * 0.23,
      ),
      polygon,
    ),
  );

  // Reconstruct the 18 m baseline over the same graph and unchanged source
  // building. The bodies are 4.8 m long by 2 m wide, sampled every 0.25 m.
  // These are geometric snapshots, not a continuous sweep, engine collision,
  // actual generated traffic routes, or proof that arbitrary turns are safe.
  const baselineGraph = {
    ...g,
    edges: g.edges.map((edge) =>
      edge.sourceIds.includes('940:0') ? { ...edge, width: 18 } : edge,
    ),
  };
  const baselineAsphalt = nearby(
    buildPavement(baselineGraph, {
      sidewalkWidth: (edge) =>
        edge.classes.every((c) => /lane|private|non.city|bikeway/i.test(c))
          ? 0
          : Math.max(2, (edge.corridorWidth - edge.width) / 2),
    }).asphalt,
  );
  const body = (station, lateral) =>
    [
      [-2.4, -1],
      [-2.4, 1],
      [2.4, 1],
      [2.4, -1],
    ].map(([along, across]) => world(station + along, lateral + across));
  let baselineOverlaps = 0,
    smoothOverlaps = 0,
    identicalOverlaps = 0;
  for (let station = -12; station <= 12; station += 0.25) {
    const blend = Math.max(0, Math.min(1, (station + 4) / 8));
    for (const side of [-1, 1]) {
      const baselineLane = side * 18 * 0.23;
      const smoothLane = side * (18 * 0.23 * (1 - blend) + 12.1 * 0.23 * blend);
      const baselineBody = body(station, baselineLane);
      const samePositionBody = body(station, baselineLane);
      const smoothBody = body(station, smoothLane);
      const before = rectangleIntersectsPolygon(baselineBody, polygon);
      const samePosition = rectangleIntersectsPolygon(
        samePositionBody,
        polygon,
      );
      const smooth = rectangleIntersectsPolygon(smoothBody, polygon);
      assert.equal(
        samePosition,
        before,
        `same position at ${station}, ${side}`,
      );
      assert(!smooth || before, `new building overlap at ${station}, ${side}`);
      baselineOverlaps += Number(before);
      identicalOverlaps += Number(samePosition);
      smoothOverlaps += Number(smooth);
      // On the same unchanged road centerline, both surface models support
      // the entire body at center and corners around the junction.
      for (const point of body(station, 0)) {
        assert(contains(baselineAsphalt, point));
        assert(contains(asphalt, point));
      }
    }
  }
  assert(baselineOverlaps > 0 && smoothOverlaps > 0);
  assert.equal(identicalOverlaps, baselineOverlaps);
});
