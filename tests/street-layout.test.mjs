import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { buildRoadGraph } = await import(cityModule('road-graph'));
const { cityRoadGraph, streetPaint } = await import(
  cityModule('street-layout')
);
const road = (id, points, roadClass = 'Arterial') => ({
  id,
  name: id,
  points,
  roadClass,
  width: 18,
  crossingEligible: roadClass === 'Arterial',
});

test('a private/alley mouth retains pavement topology without adding zebra crossings', () => {
  const g = buildRoadGraph(
    [
      road('street', [
        [-100, 0],
        [0, 0],
        [100, 0],
      ]),
      road(
        'alley',
        [
          [0, 0],
          [0, 100],
        ],
        'Lane',
      ),
    ],
    { nodeIntersections: false },
  );
  assert.equal(g.junctions.length, 1);
  assert.equal(streetPaint(g).crossings.length, 0);
});
test('paint phase does not restart at a source microsegment', () => {
  const a = streetPaint(
    buildRoadGraph([
      road('a', [
        [0, 0],
        [180, 0],
      ]),
    ]),
  );
  const b = streetPaint(
    buildRoadGraph([
      road('a', [
        [0, 0],
        [21, 0],
        [43, 0],
        [87, 0],
        [180, 0],
      ]),
    ]),
  );
  assert.equal(a.paint.length, b.paint.length);
  for (let i = 0; i < a.paint.length; i++) {
    assert(
      Math.hypot(
        a.paint[i].center[0] - b.paint[i].center[0],
        a.paint[i].center[1] - b.paint[i].center[1],
      ) < 1e-7,
    );
    assert.deepEqual(a.paint[i].tangent, b.paint[i].tangent);
  }
});
test('center-line paint does not overlap valid crossing footprints', () => {
  const g = buildRoadGraph([
    road('x', [
      [-100, 0],
      [100, 0],
    ]),
    road('z', [
      [0, -100],
      [0, 100],
    ]),
  ]);
  const { paint, crossings } = streetPaint(g);
  assert.equal(crossings.length, 4);
  for (const dash of paint.filter((p) => p.width === 0.16))
    for (const c of crossings) {
      const dx = dash.center[0] - c.center[0],
        dz = dash.center[1] - c.center[1];
      const along = Math.abs(dx * c.tangent[0] + dz * c.tangent[1]);
      const across = Math.abs(dx * c.tangent[1] - dz * c.tangent[0]);
      assert(
        along > c.depth / 2 + dash.length / 2 ||
          across > c.width / 2 + dash.width / 2,
      );
    }
});
test('city adapter retains minor roads and excludes known grade-separated corridors', () => {
  const feature = (name, roadClass, lat) => ({
    properties: { name, class: roadClass, width: 8 },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-123.13, lat],
        [-123.12, lat],
      ],
    },
  });
  const g = cityRoadGraph({
    features: [
      feature('Access', 'Private', 49.28),
      feature('Alley', 'Lane', 49.281),
      feature('Lions Gate Causeway', 'Arterial', 49.3),
    ],
  });
  assert.equal(g.edges.length, 2);
  assert(g.edges.every((e) => !e.crossingEligible));
});
