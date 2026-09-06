import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  resolveSurfaceStep as step,
  sampleKnownSurface,
  stateFromPick,
  forwardGate,
} from '../lib/city/surface-reachability.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const identity = (surfaceId, layer = 0) => ({ surfaceId, layer });
const hit = (id, y, allowedModes = ['walk', 'drive'], layer = 0) => ({
  ...identity(id, layer),
  y,
  allowedModes,
});
const state = (id, x, z, y, layer = 0) => ({ ...identity(id, layer), x, z, y });
const connection = (from, to, geometry, extra = {}) => ({
  id: `${from.surfaceId}:${to.surfaceId}`,
  from,
  to,
  geometry,
  allowedModes: ['walk', 'drive'],
  twoWay: true,
  ...extra,
});

test('all ten actual Causeway crossings keep lower identity beneath a top 3.75m above', () => {
  const data = JSON.parse(
    fs.readFileSync(
      path.join(here, '../docs/visual-quality/causeway/crossing-audit.json'),
    ),
  );
  const mx = 111320 * Math.cos((49.286 * Math.PI) / 180);
  for (const c of data.crossings) {
    const [lon, lat] = c.coordinate,
      x = (lon + 123.128) * mx,
      z = -(lat - 49.286) * 111320;
    const lower = hit(
      `path:${c.lowerPathId}`,
      c.lowerCurrentRenderedTopY,
      ['walk'],
      -1,
    );
    // 3m headroom plus 0.75m slab is a display fixture, not surveyed bridge Y.
    const upper = hit(
      `bridge:${c.upperWayId}`,
      lower.y + 3.75,
      ['walk', 'drive'],
      1,
    );
    assert.ok(
      Math.abs(upper.y - lower.y) < 4,
      'the old ±4m highest-floor rule would permit this',
    );
    const lookup = () => [lower, upper];
    assert.equal(sampleKnownSurface(lookup(), lower, 'walk'), lower);
    const r = step({
      current: state(lower.surfaceId, x - 0.5, z, lower.y, -1),
      to: [x + 0.5, z],
      mode: 'walk',
      lookup,
      connections: [],
    });
    assert.ok(r.ok);
    assert.equal(r.hit.surfaceId, lower.surfaceId);
    assert.equal(r.hit.y, lower.y);
    const above = step({
      current: state(upper.surfaceId, x - 0.5, z, upper.y, 1),
      to: [x + 0.5, z],
      mode: 'drive',
      lookup,
      connections: [],
    });
    assert.ok(above.ok);
    assert.equal(above.hit.surfaceId, upper.surfaceId);
  }
});

test('same numeric layer or coincident height never authorizes another route', () => {
  const r = step({
    current: state('ramp-a', 0, 0, 10, 1),
    to: [1, 0],
    mode: 'drive',
    lookup: () => [hit('ramp-b', 10, ['walk', 'drive'], 1)],
    connections: [],
  });
  assert.deepEqual(r, { ok: false, reason: 'surface-ended' });
});

test('deck end cannot fall back to nearby terrain despite nearly identical height', () => {
  const r = step({
    current: state('bridge', 0, 0, 10, 1),
    to: [1, 0],
    mode: 'walk',
    lookup: () => [hit('ground', 9.9)],
    connections: [],
  });
  assert.deepEqual(r, { ok: false, reason: 'surface-ended' });
});

test('explicit continuous entry gate works forward and backward despite overlapping terrain', () => {
  const ground = hit('ground', 10),
    ramp = hit('ramp', 10, ['walk', 'drive'], 1);
  const portal = connection(ground, ramp, forwardGate([0, 0], [1, 0], 8));
  const lookup = (x) => [ground, { ...ramp, y: 10 + Math.max(0, x) * 0.048 }];
  const forward = step({
    current: state('ground', -0.5, 0, 10),
    to: [0.5, 0],
    mode: 'drive',
    lookup,
    connections: [portal],
  });
  assert.ok(forward.ok);
  assert.equal(forward.hit.surfaceId, 'ramp');
  assert.equal(forward.hit.y, 10.024);
  const back = step({
    current: state('ramp', 0.5, 0, 10.024, 1),
    to: [-0.5, 0],
    mode: 'drive',
    lookup,
    connections: [portal],
  });
  assert.ok(back.ok);
  assert.equal(back.hit.surfaceId, 'ground');
});

test('gate has finite width and standing on it does not change floor', () => {
  const ground = hit('ground', 10),
    ramp = hit('ramp', 10, ['walk', 'drive'], 1);
  const portal = connection(ground, ramp, forwardGate([0, 0], [1, 0], 8)),
    lookup = () => [ground, ramp];
  const outside = step({
    current: state('ground', -0.5, 5, 10),
    to: [0.5, 5],
    mode: 'walk',
    lookup,
    connections: [portal],
  });
  assert.ok(outside.ok);
  assert.equal(outside.hit.surfaceId, 'ground');
  const still = step({
    current: state('ground', 0, 0, 10),
    to: [0, 0],
    mode: 'walk',
    lookup,
    connections: [portal],
  });
  assert.ok(still.ok);
  assert.equal(still.hit.surfaceId, 'ground');
});

test('a registered connection with a 3m seam is rejected, not excused by the 4m sanity guard', () => {
  const a = hit('ground', 10),
    b = hit('bad-ramp', 13, ['walk', 'drive'], 1),
    lookup = () => [a, b];
  const r = step({
    current: state('ground', -0.5, 0, 10),
    to: [0.5, 0],
    mode: 'drive',
    lookup,
    connections: [connection(a, b, forwardGate([0, 0], [1, 0], 8))],
  });
  assert.deepEqual(r, { ok: false, reason: 'discontinuous-seam' });
});

test('drive cannot select a parallel walk-only bridge path', () => {
  const road = hit('road', 10, ['walk', 'drive'], 1),
    pathHit = hit('path', 10.16, ['walk'], 1);
  assert.equal(
    sampleKnownSurface([road, pathHit], pathHit, 'drive'),
    undefined,
  );
  assert.equal(stateFromPick(0, 0, pathHit, 'drive'), undefined);
  const portal = connection(road, pathHit, forwardGate([0, 0], [1, 0], 3), {
    allowedModes: ['walk'],
  });
  const r = step({
    current: state('road', -0.5, 0, 10, 1),
    to: [0.5, 0],
    mode: 'drive',
    lookup: () => [road, pathHit],
    connections: [portal],
  });
  assert.deepEqual(r, { ok: false, reason: 'mode-not-allowed' });
});

test('an explicit graph-node junction allows a right-angle turn after the old footprint ends', () => {
  const a = hit('incoming', 10),
    b = hit('outgoing', 10.1);
  const lookup = (x, z) => (z > 0.01 ? [b] : x < -0.01 ? [a] : [a, b]);
  const portal = connection(a, b, {
    kind: 'junction',
    center: [0, 0],
    radius: 2,
  });
  const r = step({
    current: state('incoming', -0.5, 0, 10),
    to: [0, 0.5],
    mode: 'walk',
    lookup,
    connections: [portal],
  });
  assert.ok(r.ok);
  assert.equal(r.hit.surfaceId, 'outgoing');
});

test('ambiguous overlapping entry gates fail rather than choosing nearest height', () => {
  const a = hit('ground', 10),
    b = hit('ramp-b', 10),
    c = hit('ramp-c', 10);
  const gate = forwardGate([0, 0], [1, 0], 8),
    lookup = () => [a, b, c];
  const r = step({
    current: state('ground', -0.5, 0, 10),
    to: [0.5, 0],
    mode: 'walk',
    lookup,
    connections: [connection(a, b, gate), connection(a, c, gate)],
  });
  assert.deepEqual(r, { ok: false, reason: 'ambiguous-connection' });
});

test('direct pick retains precise upper identity and serialized return state', () => {
  const upper = hit('lions:main', 65.95, ['walk', 'drive'], 1);
  const seeded = stateFromPick(-900, -2900, upper, 'drive');
  assert.deepEqual(seeded, state('lions:main', -900, -2900, 65.95, 1));
  const restored = JSON.parse(JSON.stringify(seeded));
  const r = step({
    current: restored,
    to: [-900, -2901],
    mode: 'drive',
    lookup: () => [upper, hit('terrain', 65.9)],
    connections: [],
  });
  assert.ok(r.ok);
  assert.equal(r.hit.surfaceId, 'lions:main');
});

test('exact Lions south main-seam coordinate supports both directions with shared road-top Y', () => {
  const bridges = JSON.parse(
    fs.readFileSync(path.resolve(here, '../public/data/bridges.json')),
  );
  const s = bridges.mainSpines.find((s) => s.kind === 'lions'),
    mx = 111320 * Math.cos((49.286 * Math.PI) / 180);
  const p = ([lon, lat]) => [(lon + 123.128) * mx, -(lat - 49.286) * 111320],
    a = p(s.start),
    b = p(s.end),
    L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tangent = [(b[0] - a[0]) / L, (b[1] - a[1]) / L],
    y = s.estimatedDeckM + 1.95;
  const north = hit('lions:causeway:north', y, ['walk', 'drive'], 1),
    main = hit('lions:main', y, ['walk', 'drive'], 1);
  const c = connection(north, main, forwardGate(a, tangent, 11.3)),
    lookup = () => [north, main];
  const prev = [a[0] - tangent[0], a[1] - tangent[1]],
    next = [a[0] + tangent[0], a[1] + tangent[1]];
  const r = step({
    current: state(north.surfaceId, ...prev, y, 1),
    to: next,
    mode: 'drive',
    lookup,
    connections: [c],
  });
  assert.ok(r.ok);
  assert.equal(r.hit.surfaceId, 'lions:main');
  const reverse = step({
    current: state(main.surfaceId, ...next, y, 1),
    to: prev,
    mode: 'drive',
    lookup,
    connections: [c],
  });
  assert.ok(reverse.ok);
  assert.equal(reverse.hit.surfaceId, 'lions:causeway:north');
});

test('invalid values are rejected and read-only queries do not alter candidates', () => {
  const hits = [hit('a', 10)],
    copy = JSON.stringify(hits);
  assert.deepEqual(
    step({
      current: state('a', 0, 0, NaN),
      to: [1, 0],
      mode: 'walk',
      lookup: () => hits,
      connections: [],
    }),
    { ok: false, reason: 'invalid-query' },
  );
  assert.ok(
    step({
      current: state('a', 0, 0, 10),
      to: [1, 0],
      mode: 'walk',
      lookup: () => hits,
      connections: [],
    }).ok,
  );
  assert.equal(JSON.stringify(hits), copy);
  assert.throws(() => forwardGate([0, 0], [0, 0], 8));
});
