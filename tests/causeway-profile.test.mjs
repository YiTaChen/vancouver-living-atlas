import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createChain,
  createNorthCausewayProfile,
  currentIncomingGrade,
  bakeSurface,
  sampleAttachedSurface,
  monotoneProfile,
  requiredBridgeLift,
  createLocalBridgeWindow,
  NORTH_WAY_IDS,
  SHORT_BRIDGE_WAY_IDS,
  LOWER_PATH_IDS,
} from '../lib/city/causeway-profile.ts';

const dataDir = new URL('../public/data/', import.meta.url);
const load = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, dataDir), 'utf8'));
const bridges = load('bridges.json'),
  dem = load('terrain.json');
const MX = 111320 * Math.cos((49.286 * Math.PI) / 180);
const project = ([lon, lat]) => [
  (lon + 123.128) * MX,
  -(lat - 49.286) * 111320,
];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function elevation(x, z) {
  const lon = x / MX - 123.128,
    lat = 49.286 - z / 111320;
  const [west, south, east, north] = dem.bounds,
    w = dem.width,
    h = dem.height,
    V = dem.heights;
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
const ways = bridges.features.filter((f) => f.properties.role === 'causeway');
const main = bridges.mainSpines.find((s) => s.kind === 'lions');
const profile = createNorthCausewayProfile(
  ways,
  project,
  elevation,
  main.estimatedDeckM + 1.95,
);
const { chain, vertical } = profile;
const segments = bakeSurface(chain, vertical.height, {
  routeId: 'causeway-north',
  layer: 1,
});
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} ± ${tolerance}`,
  );

test('actual five source ways form a 314.69 m chain in geographic order', () => {
  near(chain.length, 314.69, 0.02);
  assert.deepEqual([...chain.ranges.keys()], [...NORTH_WAY_IDS]);
  near(chain.at(chain.length).x, project(main.start)[0]);
  near(chain.at(chain.length).z, project(main.start)[1]);
});
test('final top Y starts at current pavement and exactly meets rendered main bridge', () => {
  near(vertical.height(0), 54.66090516798405);
  near(vertical.height(chain.length), 65.95);
  near(segments[0].h0, 54.66090516798405);
  near(segments.at(-1).h1, 65.95);
  near(65.95 - (elevation(...project(main.start)) + 1.11), 13.199971706684437);
});
test('north curve is monotone, gentle and C1 at its two ends', () => {
  const previous = ways.find((w) => w.properties.sourceId === 257712148);
  const start = chain.at(0);
  near(
    vertical.grade(0),
    currentIncomingGrade(previous, project, elevation, [start.x, start.z]),
  );
  near(vertical.grade(chain.length), 0);
  assert.equal(vertical.endpointGradesAdjusted, false);
  assert.ok(vertical.maxAbsoluteGrade < 0.06);
  for (let s = 0; s <= chain.length; s += 0.2) {
    assert.ok(vertical.grade(s) >= -1e-10);
    assert.ok(
      vertical.height(s) >= vertical.height(0) - 1e-8 &&
        vertical.height(s) <= 65.95 + 1e-8,
    );
  }
});
test('baked samples preserve every original source vertex and never straighten XY', () => {
  for (const id of NORTH_WAY_IDS) {
    for (const coord of ways.find((w) => w.properties.sourceId === id).geometry
      .coordinates) {
      const [x, z] = project(coord);
      assert.ok(
        segments.some((s) =>
          [s.a, s.b].some((p) => Math.hypot(p[0] - x, p[1] - z) < 1e-8),
        ),
      );
    }
  }
  for (const s of segments)
    assert.ok(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) <= 5 + 1e-8);
});
test('per-way shared endpoints have identical height and XY', () => {
  for (let i = 1; i < segments.length; i++) {
    near(segments[i - 1].h1, segments[i].h0);
    near(segments[i - 1].b[0], segments[i].a[0]);
    near(segments[i - 1].b[1], segments[i].a[1]);
  }
  for (let i = 1; i < NORTH_WAY_IDS.length; i++) {
    const a = chain.ranges.get(NORTH_WAY_IDS[i - 1]),
      b = chain.ranges.get(NORTH_WAY_IDS[i]);
    near(
      profile.sampleFeature(NORTH_WAY_IDS[i - 1], a.end - a.start),
      profile.sampleFeature(NORTH_WAY_IDS[i], 0),
    );
  }
});
test('existing central Causeway and four southern overpass ways are not globally lifted', () => {
  for (const id of [257712148, ...SHORT_BRIDGE_WAY_IDS])
    assert.equal(profile.sampleFeature(id, 10), undefined);
});
test('5 m tessellation is within 3 mm of analytic Hermite height', () => {
  for (const s of segments)
    for (const t of [0.25, 0.5, 0.75])
      near(
        s.h0 + (s.h1 - s.h0) * t,
        vertical.height(s.s0 + (s.s1 - s.s0) * t),
        0.003,
      );
});
test('mesh and registry use the same piecewise linear surface, not independently resampled terrain', () => {
  for (const s of segments) {
    const t = 0.37,
      x = s.a[0] + (s.b[0] - s.a[0]) * t,
      z = s.a[1] + (s.b[1] - s.a[1]) * t;
    const result = sampleAttachedSurface(segments, x, z, {
      routeId: 'causeway-north',
      layer: 1,
      maxDistanceM: 0.01,
    });
    assert.ok(result);
    near(result.y, s.h0 + (s.h1 - s.h0) * t);
  }
});
test('parallel rail/path attachment preserves source XY and supports an explicit kerb offset', () => {
  const s = segments[25],
    dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1],
    len = Math.hypot(dx, dz);
  const x = (s.a[0] + s.b[0]) / 2 + (dz / len) * 8,
    z = (s.a[1] + s.b[1]) / 2 - (dx / len) * 8;
  const q = sampleAttachedSurface(segments, x, z, {
    routeId: 'causeway-north',
    layer: 1,
    maxDistanceM: 12,
    topOffsetM: 0.16,
  });
  assert.ok(q);
  near(q.x, x);
  near(q.z, z);
  near(q.y, (s.h0 + s.h1) / 2 + 0.16);
});
test('attachment refuses wrong layer, wrong route and excessive lateral distance', () => {
  const p = chain.at(100);
  assert.equal(
    sampleAttachedSurface(segments, p.x, p.z, {
      routeId: 'causeway-north',
      layer: 0,
      maxDistanceM: 20,
    }),
    undefined,
  );
  assert.equal(
    sampleAttachedSurface(segments, p.x, p.z, {
      routeId: 'unrelated-tunnel',
      layer: 1,
      maxDistanceM: 20,
    }),
    undefined,
  );
  assert.equal(
    sampleAttachedSurface(segments, p.x + 100, p.z + 100, {
      routeId: 'causeway-north',
      layer: 1,
      maxDistanceM: 0.01,
    }),
    undefined,
  );
});
test('attached path does not extend an endpoint plateau outside the actual north route', () => {
  const s = segments.at(-1),
    dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1];
  assert.equal(
    sampleAttachedSurface(segments, s.b[0] + dx * 2, s.b[1] + dz * 2, {
      routeId: 'causeway-north',
      layer: 1,
      maxDistanceM: 3,
    }),
    undefined,
  );
});
test('known parallel path can attach outside an internal corner without a sampling hole', () => {
  const c = createChain(
    [
      {
        properties: { sourceId: 1 },
        geometry: {
          coordinates: [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
        },
      },
    ],
    [1],
    (p) => p,
  );
  const ss = bakeSurface(c, (s) => s, {
    routeId: 'corner',
    layer: 1,
    maxStepM: 5,
  });
  const q = sampleAttachedSurface(ss, 12, -2, {
    routeId: 'corner',
    layer: 1,
    maxDistanceM: 5,
  });
  assert.ok(q);
  near(q.y, 10);
  near(q.x, 12);
  near(q.z, -2);
});
test('reversed OSM way orientation is solved without modifying source input', () => {
  const input = [
    {
      properties: { sourceId: 1 },
      geometry: {
        coordinates: [
          [0, 0],
          [10, 0],
        ],
      },
    },
    {
      properties: { sourceId: 2 },
      geometry: {
        coordinates: [
          [20, 0],
          [10, 0],
        ],
      },
    },
  ];
  const snapshot = JSON.stringify(input),
    c = createChain(input, [1, 2], (p) => p);
  assert.equal(c.ranges.get(2).reversed, true);
  near(c.length, 20);
  near(c.at(15).x, 15);
  assert.equal(JSON.stringify(input), snapshot);
});
test('disconnected graph is rejected rather than filling a gap with invented road', () => {
  assert.throws(
    () =>
      createChain(
        [
          {
            properties: { sourceId: 1 },
            geometry: {
              coordinates: [
                [0, 0],
                [10, 0],
              ],
            },
          },
          {
            properties: { sourceId: 2 },
            geometry: {
              coordinates: [
                [11, 0],
                [20, 0],
              ],
            },
          },
        ],
        [1, 2],
        (p) => p,
      ),
    /Disconnected/,
  );
});
test('monotone limiter prevents overshoot when user-supplied tangents are excessive', () => {
  const p = monotoneProfile(100, 0, 5, 1, -1);
  assert.equal(p.endpointGradesAdjusted, true);
  for (let s = 0; s <= 100; s += 0.2) {
    assert.ok(p.height(s) >= -1e-8 && p.height(s) <= 5 + 1e-8);
    assert.ok(p.grade(s) >= -1e-8);
  }
});
test('all four short bridge IDs and five lower path IDs are explicit, disjoint scopes', () => {
  assert.equal(SHORT_BRIDGE_WAY_IDS.length, 4);
  assert.equal(LOWER_PATH_IDS.length, 5);
  assert.ok(SHORT_BRIDGE_WAY_IDS.every((id) => !LOWER_PATH_IDS.includes(id)));
});
test('clearance is measured from upper soffit to lower final surface, not centreline height alone', () => {
  const constraints = [
    { upperChainage: 10, lowerTopY: 2, lowerPathId: 44032491 },
    { upperChainage: 30, lowerTopY: 3, lowerPathId: 74267973 },
  ];
  const lower = JSON.stringify(constraints),
    lift = requiredBridgeLift(() => 4, constraints, 3, 0.75);
  near(lift, 2.75);
  for (const c of constraints) assert.ok(4 + lift - 0.75 - c.lowerTopY >= 3);
  assert.equal(JSON.stringify(constraints), lower);
});
test('actual four-bridge crossing audit satisfies chosen clearance after reported lift', () => {
  const audit = JSON.parse(
    fs.readFileSync(
      new URL(
        '../docs/visual-quality/causeway/crossing-audit.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(audit.crossings.length, 10);
  for (const id of SHORT_BRIDGE_WAY_IDS) {
    const cs = audit.crossings.filter((c) => c.upperWayId === id);
    assert.ok(cs.length >= 2);
    const lift = Math.max(
      ...cs.map((c) => c.uniformLiftForIllustrative3mHeadroom),
    );
    for (const c of cs)
      assert.ok(
        c.linearEndpointDeckY + lift - 0.75 - c.lowerCurrentRenderedTopY >=
          3 - 1e-8,
      );
  }
});
test('local bridge window preserves outside road and exact C1 deck transitions', () => {
  const p = createLocalBridgeWindow({
    enter: 0,
    bridgeStart: 100,
    bridgeEnd: 140,
    leave: 240,
    enterTop: 4,
    bridgeStartTop: 7,
    bridgeEndTop: 7.4,
    leaveTop: 4.8,
    enterGrade: 0.008,
    leaveGrade: 0.008,
  });
  assert.equal(p.height(-0.01), undefined);
  assert.equal(p.height(240.01), undefined);
  near(p.height(0), 4);
  near(p.height(100), 7);
  near(p.height(140), 7.4);
  near(p.height(240), 4.8);
  near(p.grade(0), 0.008);
  near(p.grade(240), 0.008);
  near(p.grade(100 - 1e-6), p.grade(100 + 1e-6), 1e-8);
  near(p.grade(140 - 1e-6), p.grade(140 + 1e-6), 1e-8);
  assert.ok(p.maxAbsoluteGrade < 0.05);
});
test('bad numbers, zero lengths and invalid ramp bounds fail clearly', () => {
  assert.throws(() => monotoneProfile(0, 1, 2, 0, 0));
  assert.throws(() => vertical.height(NaN));
  assert.throws(() =>
    bakeSurface(chain, vertical.height, {
      routeId: 'x',
      layer: 1,
      maxStepM: 0,
    }),
  );
  assert.throws(() => requiredBridgeLift(() => 4, [], 0, 0.75));
  assert.throws(() =>
    createLocalBridgeWindow({
      enter: 0,
      bridgeStart: 0,
      bridgeEnd: 10,
      leave: 20,
      enterTop: 0,
      bridgeStartTop: 0,
      bridgeEndTop: 0,
      leaveTop: 0,
      enterGrade: 0,
      leaveGrade: 0,
    }),
  );
});
