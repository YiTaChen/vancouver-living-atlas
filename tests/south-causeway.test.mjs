import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const { createSouthCausewayNetwork, cubicAlignment } = await import(
  cityModule('south-profile')
);
import { sampleAttachedSurface } from '../lib/city/causeway-profile.ts';
const load = (name) =>
  JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const data = load('../lib/city/south-profile-data.json'),
  report = load('../docs/visual-quality/causeway/south-crossing-report.json');
const MX = 111320 * Math.cos((49.286 * Math.PI) / 180),
  project = ([lon, lat]) => [(lon + 123.128) * MX, -(lat - 49.286) * 111320];
const snapshot = JSON.stringify(data),
  network = createSouthCausewayNetwork(data, project);
const close = (a, b, e = 1e-8) =>
  assert.ok(Math.abs(a - b) <= e, `${a} != ${b} +/- ${e}`);
const get = (id) => network.routes.find((r) => r.info.id === id);

test('pure factory preserves source data and all five real short-bridge plan lines', () => {
  assert.equal(JSON.stringify(data), snapshot);
  for (const id of [42000575, 44032488, 363693708, 363693713, 363693709]) {
    const source = data.features.find((f) => f.properties.sourceId === id);
    for (const p of source.geometry.coordinates) {
      const xy = project(p);
      assert.ok(
        network.segments
          .filter((s) => s.sourceId === id)
          .some((s) =>
            [s.a, s.b].some(
              (q) => Math.hypot(q[0] - xy[0], q[1] - xy[1]) < 1e-7,
            ),
          ),
      );
    }
  }
});
test('complete graph joins southern branches and northern merge with identical C1 values', () => {
  for (const field of ['height', 'grade']) {
    close(get('east').vertical[field](0), get('west').vertical[field](0));
    close(
      get('east').vertical[field](get('east').info.lengthM),
      get('west').vertical[field](get('west').info.lengthM),
    );
    close(
      get('east').vertical[field](get('east').info.lengthM),
      get('shared').vertical[field](0),
    );
  }
  const bike = get('bike-exit');
  close(
    bike.vertical.height(0),
    get('west').vertical.height(data.bikeTieIn.roadJoin.sM),
  );
  close(bike.vertical.height(bike.info.lengthM), 5.577344026815245);
  close(bike.vertical.grade(bike.info.lengthM), 0.02364444085804864);
});
test('all analytic cubic grades, including interior extrema, satisfy 6 percent', () => {
  for (const r of network.routes)
    assert.ok(
      r.vertical.maxAbsoluteGrade <= 0.06 + 1e-8,
      `${r.info.id} grade ${r.vertical.maxAbsoluteGrade}`,
    );
  for (const s of network.segments)
    assert.ok(
      Math.abs(s.h1 - s.h0) / Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) <=
        0.06 + 1e-8,
    );
});
test('every cubic and source-way seam is C1, not four overlapping independent bumps', () => {
  for (const r of network.routes) {
    for (let i = 1; i < r.info.knots.length - 1; i++) {
      const k = r.info.knots[i];
      close(r.vertical.height(k.sM), k.topY);
      close(r.vertical.grade(k.sM), k.grade);
      close(
        r.vertical.height(k.sM - 1e-7),
        r.vertical.height(k.sM + 1e-7),
        2e-8,
      );
      close(r.vertical.grade(k.sM - 1e-7), r.vertical.grade(k.sM + 1e-7), 2e-8);
    }
  }
});
test('13 true centreline crossings, including three park-access crossings, gain headroom', () => {
  assert.equal(report.centrelineCrossings.length, 13);
  for (const c of report.centrelineCrossings) {
    const upper = network.sampleFeature(c.upperWayId, c.upperChainage);
    close(upper, c.proposedTopY);
    assert.ok(upper - 0.75 - c.lowerCurrentRenderedTopY >= 3);
  }
});
test('all 382 full-deck width overlap constraints have the reserve against slab soffit', () => {
  assert.equal(report.fullRibbonConstraints.length, 382);
  for (const c of report.fullRibbonConstraints) {
    const y = get(c.route).vertical.height(c.s);
    assert.ok(y - 0.75 - c.lowerTopY >= 3.0399999);
  }
});
test('lower source path IDs never receive an upper road override', () => {
  for (const id of data.lowerPathIds)
    assert.equal(network.sampleFeature(id, 0), undefined);
  assert.equal(data.lowerPathIds.length, 5);
});
test('only first 99.56m of 1496.72m central source is covered by southern window', () => {
  const r = report.northReturn;
  close(r.sourceChainageM, 99.55694323955987);
  close(network.sampleFeature(257712148, r.sourceChainageM), r.topY);
  assert.equal(
    network.sampleFeature(257712148, r.sourceChainageM + 0.01),
    undefined,
  );
  assert.equal(network.sampleFeature(257712148, 750), undefined);
  assert.equal(network.sampleFeature(475320408, 30), undefined);
  close(get('shared').vertical.grade(get('shared').info.lengthM), r.grade);
});
test('reversed source ways use native source chainage correctly', () => {
  for (const r of network.routes)
    for (const w of r.info.ranges) {
      const sourceEnd = w.reversed ? w.sourceLength : 0;
      close(
        network.sampleFeature(w.sourceId, sourceEnd),
        r.vertical.height(w.start),
      );
    }
});
test('renderer and scoped navigation read exactly the same <=3m baked segments', () => {
  for (const s of network.segments) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    assert.ok(len <= 3 + 1e-7);
    const t = 0.371,
      x = s.a[0] + (s.b[0] - s.a[0]) * t,
      z = s.a[1] + (s.b[1] - s.a[1]) * t;
    const y = sampleAttachedSurface(network.segments, x, z, {
      routeId: s.routeId,
      layer: 1,
      maxDistanceM: 0.005,
    });
    assert.ok(y);
    close(y.y, s.h0 + (s.h1 - s.h0) * t);
    assert.equal(
      sampleAttachedSurface(network.segments, x, z, {
        routeId: s.routeId,
        layer: 0,
        maxDistanceM: 0.005,
      }),
      undefined,
    );
  }
});
test('invalid outside samples fail or stay outside, with no endpoint plateau extension', () => {
  assert.throws(() => network.sampleFeature(44032486, NaN));
  assert.equal(network.sampleFeature(44032486, -1), undefined);
  assert.equal(get('east').vertical.height(-0.01), undefined);
  assert.throws(() => createSouthCausewayNetwork(data, project, 15));
  assert.throws(() =>
    cubicAlignment([
      { sM: 0, topY: 0, grade: 0 },
      { sM: 0, topY: 1, grade: 0 },
    ]),
  );
});
test('changed original source geometry fails closed rather than moving the profile', () => {
  const copy = structuredClone(data);
  copy.features.find(
    (f) => f.properties.sourceId === 44032486,
  ).geometry.coordinates[1][0] += 0.00001;
  assert.throws(
    () => createSouthCausewayNetwork(copy, project),
    /Changed geographic source/,
  );
});

test('park access shares east fork and has an explicit short City seam connector', () => {
  const east = get('east'),
    park = get('park-access'),
    fork = east.info.ranges.find((r) => r.sourceId === 363651505).end;
  close(park.vertical.height(0), east.vertical.height(fork));
  close(park.vertical.grade(0), east.vertical.grade(fork));
  close(park.info.lengthM, 273.53938758887836, 1e-6);
  close(park.vertical.height(park.info.lengthM), data.parkAccessTieIn.topY);
  assert.ok(data.parkAccessTieIn.planGapM < 0.4);
  assert.equal(
    report.centrelineCrossings.filter((c) => c.addedParkAccess).length,
    3,
  );
  close(
    park.vertical.height(data.parkAccessTieIn.preservedBusFork.routeChainageM),
    data.parkAccessTieIn.preservedBusFork.topY,
  );
  assert.ok(Math.abs(data.parkAccessTieIn.connectorGrade) < 0.06);
});
test('current City datum is validated before generating roads; unexpected change is refused', () => {
  assert.doesNotThrow(() =>
    createSouthCausewayNetwork(data, project, 3, {
      groundRoadTop: () => report.southStart.topY,
    }),
  );
  assert.throws(
    () =>
      createSouthCausewayNetwork(data, project, 3, {
        groundRoadTop: () => report.southStart.topY + 0.1,
      }),
    /City ground datum changed/,
  );
});
