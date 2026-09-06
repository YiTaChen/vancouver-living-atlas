import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
import { trimRoad } from '../lib/city/road-trim.ts';
const { TravelSurfaceIndex } = await import(cityModule('travel-surfaces'));
const { prepareCauseway } = await import(cityModule('causeway'));
const { cityRoadGraph } = await import(cityModule('street-layout'));
const { buildPavement } = await import(cityModule('pavement'));
const { buildCausewayGeometry } = await import(cityModule('causeway-geometry'));
const load = (name) =>
  JSON.parse(
    fs.readFileSync(new URL('../public/data/' + name, import.meta.url), 'utf8'),
  );
const dem = load('terrain.json'),
  MX = 111320 * Math.cos((49.286 * Math.PI) / 180);
function elevation(x, z) {
  const lon = x / MX - 123.128,
    lat = 49.286 - z / 111320,
    [west, south, east, north] = dem.bounds,
    w = dem.width,
    h = dem.height,
    V = dem.heights;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const u = clamp(((lon - west) / (east - west)) * (w - 1), 0, w - 1),
    v = clamp(((north - lat) / (north - south)) * (h - 1), 0, h - 1);
  const i = Math.min(w - 2, Math.floor(u)),
    j = Math.min(h - 2, Math.floor(v)),
    a = u - i,
    b = v - j;
  return Math.max(
    1.2,
    (V[j * w + i] * (1 - a) + V[j * w + i + 1] * a) * (1 - b) +
      (V[(j + 1) * w + i] * (1 - a) + V[(j + 1) * w + i + 1] * a) * b,
  );
}
const engine = {
  data: { bridges: load('bridges.json'), roads: load('roads.geojson') },
  elevation,
};
prepareCauseway(engine);
const data = engine.data.causeway;
test('generated canopy clearance checks whole disk across spatial cells and triangle edges', () => {
  const index = new TravelSurfaceIndex([
    {
      surfaceId: 'test',
      layer: 1,
      routeId: 'test',
      allowedModes: ['walk'],
      triangles: [60, 1, 0, 70, 1, 0, 60, 1, 10],
    },
  ]);
  assert.equal(index.overlapsDisk(61, 1, 0), true);
  assert.equal(index.overlapsDisk(59, 5, 1.01), true);
  assert.equal(index.overlapsDisk(59, 5, 0.99), false);
  assert.equal(index.overlapsDisk(71, 0, 1.01), true);
  assert.equal(index.overlapsDisk(71, 11, 1), false);
  assert.equal(index.overlapsDisk(200, 200, 30), false);
});
test('complete trimmed City graph accepts every source fragment without duplicate IDs', () => {
  const graph = cityRoadGraph(engine.data.roads, [], data.cuts);
  assert.ok(graph.edges.length > 1000);
  const ids = new Set(graph.edges.flatMap((edge) => edge.sourceIds));
  assert.ok(ids.has('1785:0'));
  assert.ok(graph.edges.every((edge) => Number.isFinite(edge.length)));
  const split = cityRoadGraph(
    {
      type: 'FeatureCollection',
      features: [
        {
          properties: { name: 'Example', width: 9 },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-123.128, 49.286],
              [-123.127, 49.286],
            ],
          },
        },
      ],
    },
    [],
    new Map([['0:0', [[20, 30]]]]),
  );
  assert.deepEqual(
    [...new Set(split.edges.flatMap((e) => e.sourceIds))].sort(),
    ['0:0', '0:0:fragment-1'],
  );
});
test('canonical preparation validates City datum/source and preserves central north seam', () => {
  assert.ok(data.segments.length > 600);
  const central = data.segments.filter((s) => s.routeId === 'causeway-central'),
    north = data.segments.filter((s) => s.routeId === 'causeway-north');
  assert.ok(Math.abs(central.at(-1).h1 - north[0].h0) < 1e-7);
  const shared = data.segments.filter(
    (s) => s.routeId === 'causeway-south-shared',
  );
  assert.ok(Math.abs(shared.at(-1).h1 - central[0].h0) < 1e-7);
  assert.deepEqual(
    [...data.cuts.keys()].sort(),
    [
      '1589:0',
      '1595:0',
      '1608:0',
      '1720:0',
      '1721:0',
      '1785:0',
      '561:0',
      '819:0',
    ].sort(),
  );
});
test('source-chain cuts retain original bend and surviving endpoints, never add bridge across removed interval', () => {
  const points = [
    [0, 0],
    [20, 0],
    [20, 30],
  ];
  assert.equal(trimRoad(points, [])[0], points);
  assert.deepEqual(
    trimRoad(points, [
      [5, 10],
      [25, 35],
    ]),
    [
      [
        [0, 0],
        [5, 0],
      ],
      [
        [10, 0],
        [20, 0],
        [20, 5],
      ],
      [
        [20, 15],
        [20, 30],
      ],
    ],
  );
});
test('physical floor index distinguishes overlapping floors and accepts only actual triangles', () => {
  const triangle = (y) => [0, y, 0, 10, y, 0, 0, y, 10];
  const surfaces = [
    {
      triangles: triangle(2),
      surfaceId: 'lower',
      layer: 0,
      routeId: 'trail',
      allowedModes: ['walk'],
    },
    {
      triangles: triangle(5.8),
      surfaceId: 'upper',
      layer: 1,
      routeId: 'bridge',
      allowedModes: ['drive'],
    },
  ];
  const index = new TravelSurfaceIndex(surfaces);
  assert.deepEqual(
    index.lookup(2, 2).map((h) => [h.surfaceId, h.y]),
    [
      ['lower', 2],
      ['upper', 5.8],
    ],
  );
  assert.equal(index.lookup(9, 9).length, 0);
});
test('exact baked top triangle lookup matches centerline through every main south/north source span', () => {
  const geometry = buildCausewayGeometry(data.segments, {
    groundRoadTop: (x, z) => engine.data.roadRelief(x, z) + 1.05,
    rails: false,
    paint: false,
  });
  const index = new TravelSurfaceIndex(geometry.surfaces);
  for (const s of data.segments)
    for (const t of [0.1, 0.5, 0.9]) {
      const x = s.a[0] + (s.b[0] - s.a[0]) * t,
        z = s.a[1] + (s.b[1] - s.a[1]) * t;
      const hit = index
        .lookup(x, z)
        .find(
          (h) =>
            h.surfaceId === 'lions:road' && h.allowedModes.includes('drive'),
        );
      assert.ok(hit, `${s.routeId} ${s.sourceId} at ${t}`);
      assert.ok(
        Math.abs(hit.y - (s.h0 + (s.h1 - s.h0) * t)) < 0.035,
        `${s.routeId} center top error`,
      );
    }
});
test('pavement replacement mask cuts both asphalt and sidewalks without phantom curb across opening', () => {
  const graph = cityRoadGraph({
    type: 'FeatureCollection',
    features: [
      {
        properties: { name: 'Example', width: 10, class: 'Arterial' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-123.128, 49.286],
            [-123.127, 49.286],
          ],
        },
      },
    ],
  });
  const pavement = buildPavement(graph, {
    exclusions: [
      {
        level: 'ground',
        points: [
          [20, -20],
          [30, -20],
          [30, 20],
          [20, 20],
        ],
      },
    ],
  });
  const inside = (mesh) =>
    mesh.indices.some(
      (_, i) =>
        i % 3 === 0 &&
        [0, 1, 2].every((j) => {
          const x = mesh.vertices[mesh.indices[i + j]][0];
          return x > 20.0001 && x < 29.9999;
        }),
    );
  assert.equal(inside(pavement.asphalt), false);
  assert.equal(inside(pavement.sidewalks), false);
  assert.ok(pavement.curbs.every((c) => Math.abs(c.a[0] - c.b[0]) > 0.001));
});
