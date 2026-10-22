import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFixture, load, THREE, geo } from '../tools/causeway-cpu.mjs';
const f = createFixture(),
  { e, nav } = f,
  p = e.data.stanleyWestRamp;
const source = JSON.parse(
  fs.readFileSync(
    new URL('../lib/city/stanley-west-ramp-source.json', import.meta.url),
  ),
);
const publicRoads = fs.readFileSync(
  new URL('../public/data/roads.geojson', import.meta.url),
  'utf8',
);
const { createCausewayTriangleLookup } = load('lib/city/causeway-geometry.ts');
e.settings = { trees: true, buildings: true, quality: 'balanced' };
e.detailedTrees = { trees: [], syncBroken() {} };
e.data.streetLampPoints = [];
e.vehicleImpacts = new (load(
  'lib/city/vehicle-impact-world.ts',
).VehicleImpactWorld)(e);
nav.condition = new (load('lib/city/vehicle-condition.ts').VehicleCondition)(
  e,
  nav.car,
  1550,
  0.7,
);
const length = (points) =>
  points
    .slice(1)
    .reduce(
      (n, b, i) => n + Math.hypot(b[0] - points[i][0], b[1] - points[i][1]),
      0,
    );
function replay(points, identity, kmh) {
  const first = points[0],
    hit = e.data.travelSurfaces
      .lookup(...first)
      .find(
        (h) =>
          h.surfaceId === identity.surfaceId &&
          h.layer === identity.layer &&
          h.allowedModes.includes('drive'),
      );
  assert(hit, 'explicit actual supported start floor');
  nav.mode = 'drive';
  nav.surface = 'bridge';
  nav.surfaceId = hit.surfaceId;
  nav.surfaceLayer = hit.layer;
  nav.position.set(first[0], hit.y, first[1]);
  nav.yaw = Math.atan2(points[1][0] - first[0], points[1][1] - first[1]);
  nav.car.position.copy(nav.position);
  nav.car.rotation.y = nav.yaw;
  nav.speed = 0;
  nav.condition.repair(0);
  const floors = [`${nav.surfaceId}:${nav.surfaceLayer}`];
  let distance = 0,
    moves = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]),
      n = Math.ceil(l / (kmh / 3.6 / 30));
    for (let j = 1; j <= n; j++) {
      const q = [
          a[0] + ((b[0] - a[0]) * j) / n,
          a[1] + ((b[1] - a[1]) * j) / n,
        ],
        dx = q[0] - nav.position.x,
        dz = q[1] - nav.position.z;
      nav.yaw = Math.atan2(dx, dz);
      nav.car.rotation.y = nav.yaw;
      nav.speed = kmh / 3.6;
      nav.move(dx, dz);
      assert(
        Math.hypot(nav.position.x - q[0], nav.position.z - q[1]) < 0.025,
        JSON.stringify({
          i,
          j,
          kmh,
          q,
          actual: nav.position.toArray(),
          floor: nav.surfaceId,
          layer: nav.surfaceLayer,
          damage: nav.condition.damage,
        }),
      );
      assert(nav.speed >= (kmh / 3.6) * 0.99);
      nav.car.position.copy(nav.position);
      const floor = `${nav.surfaceId}:${nav.surfaceLayer}`;
      if (floor !== floors.at(-1)) floors.push(floor);
      moves++;
    }
    distance += l;
  }
  assert.equal(nav.condition.damage.overall, 0);
  return { floors, distance, moves };
}

test('versioned primary West exit preserves exact source XY and public city source while runtime replaces only the documented ROW', () => {
  assert(p);
  assert.deepEqual(source.route.wayIds, [41998502, 877408900, 256879277]);
  assert.deepEqual(
    source.ways.map((w) => w.version),
    [16, 3, 11],
  );
  assert.match(source.sourceSha256, /^[0-9a-f]{64}$/);
  const points = [];
  for (const [i, w] of source.ways.entries())
    points.push(...w.coordinates.slice(i ? 1 : 0).map(geo.project));
  assert.deepEqual(p.points, points);
  assert(Math.abs(p.length - 294.75275637863774) < 1e-6);
  assert.deepEqual(
    JSON.parse(publicRoads).features[1713].geometry.coordinates,
    source.route.citySourceCoordinates,
  );
  assert.equal(
    fs.readFileSync(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
    publicRoads,
  );
  assert.deepEqual(
    [...new Set(p.segments.map((s) => s.sourceId))],
    source.route.wayIds,
  );
  assert(Math.abs(length(p.qaRoutes.westExit.points) - p.length - 35) < 0.01);
  assert(p.geometry.buffers.asphalt.length / 9 <= 8192);
  const maxGrade = Math.max(
    ...p.segments.map((s) => Math.abs(s.h1 - s.h0) / (s.s1 - s.s0)),
  );
  assert(maxGrade <= 0.14, `new West vertical transition grade ${maxGrade}`);
  const c = p.connections[0];
  assert.equal(c.id, 'stanley-west-legal-motor-exit');
  assert.deepEqual(c.from, { surfaceId: 'lions:road', layer: 1 });
  assert.deepEqual(c.to, { surfaceId: 'park:prospect-overpass', layer: 2 });
  assert.deepEqual(c.allowedModes, ['drive']);
  assert(c.twoWay);
});

test('actual new West paving shares both existing road planes, crosses the green path at one grade and retains pedestrian source permissions', () => {
  const ramp = createCausewayTriangleLookup(p.geometry),
    lower = createCausewayTriangleLookup(f.road.result),
    upper = createCausewayTriangleLookup(e.data.prospectOverpass.geometry),
    identity = { surfaceId: 'park:prospect-overpass', layer: 2 };
  let overlaps = 0,
    maxDifference = 0;
  for (const t of p.geometry.topTriangles) {
    if (t.buffer !== 'asphalt') continue;
    const v = p.geometry.buffers.asphalt.slice(t.offset, t.offset + 9);
    assert(
      (v[5] - v[2]) * (v[6] - v[0]) - (v[3] - v[0]) * (v[8] - v[2]) > 1e-9,
    );
    for (const weights of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1 / 3, 1 / 3, 1 / 3],
    ]) {
      const x = v[0] * weights[0] + v[3] * weights[1] + v[6] * weights[2],
        z = v[2] * weights[0] + v[5] * weights[1] + v[8] * weights[2],
        b = ramp.heightAt(x, z, identity, 'road');
      for (const [index, id] of [
        [lower, { surfaceId: 'lions:road', layer: 1 }],
        [upper, identity],
      ]) {
        const a = index.heightAt(x, z, id, 'road');
        if (a && b) {
          overlaps++;
          maxDifference = Math.max(maxDifference, Math.abs(a.y - b.y));
        }
      }
    }
  }
  assert(overlaps > 100);
  assert(maxDifference <= 0.025, `real overlap delta ${maxDifference}`);
  for (const s of p.geometry.surfaces) {
    assert(s.allowedModes.includes('drive'));
    assert.equal(s.allowedModes.includes('walk'), s.sourceId === 256879277);
  }
  const crossing = source.relatedWays
    .find((w) => w.id === 1074018477)
    .coordinates.map(geo.project);
  let atGrade = 0;
  for (let i = 1; i < crossing.length; i++) {
    for (let j = 0; j <= 20; j++) {
      const t = j / 20,
        x = crossing[i - 1][0] + (crossing[i][0] - crossing[i - 1][0]) * t,
        z = crossing[i - 1][1] + (crossing[i][1] - crossing[i - 1][1]) * t,
        road = ramp.heightAt(x, z, identity, 'road');
      if (!road) continue;
      assert(Math.abs(p.pathTop(1074018477, x, z, -100) - road.y) < 1e-6);
      atGrade++;
    }
  }
  assert(atGrade > 0);
  assert.equal(p.pathTop(77451357, ...p.points.at(-1), -123), -123);
});
for (const reverse of [false, true])
  for (const kmh of [50, 120, 205])
    test(`actual complete West exit with main approaches ${reverse ? 'reverse' : 'forward'} ${kmh}km/h preserves all physical barriers`, () => {
      const q = p.qaRoutes.westExit,
        report = replay(
          reverse ? [...q.points].reverse() : q.points,
          reverse ? q.reverseIdentity : q.identity,
          kmh,
        );
      assert.deepEqual(
        report.floors,
        reverse
          ? ['park:prospect-overpass:2', 'lions:road:1']
          : ['lions:road:1', 'park:prospect-overpass:2'],
      );
      assert(report.distance > 329);
    });

test('West entry opens only its source-owned side, keeps mainline floor identity and preserves an actual opposite guardrail', () => {
  const near = e.data.causeway.segments
      .filter(
        (s) =>
          s.routeId === 'causeway-north' &&
          [70954678, 1252160596].includes(s.sourceId),
      )
      .sort((a, b) => a.s0 - b.s0),
    points = [near[0].a, ...near.map((s) => s.b)];
  for (const reverse of [false, true]) {
    const r = replay(
      reverse ? [...points].reverse() : points,
      { surfaceId: 'lions:road', layer: 1 },
      50,
    );
    assert.deepEqual(r.floors, ['lions:road:1']);
  }
  const first = p.points[0],
    s = near.find(
      (s) => Math.hypot(s.b[0] - first[0], s.b[1] - first[1]) < 0.01,
    ),
    dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1],
    l = Math.hypot(dx, dz),
    n = [dz / l, -dx / l],
    q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz))
      .toArray(),
    hit = e.vehicleImpacts.sweep({
      from: { position: [first[0], s.h1 + 0.7, first[1]], quaternion: q },
      to: {
        position: [first[0] - n[0] * 12, s.h1 + 0.7, first[1] - n[1] * 12],
        quaternion: q,
      },
      shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
    });
  assert(
    hit?.surfaceId.startsWith('guardrail:'),
    'untouched opposite physical barrier remains',
  );
  assert(
    p.railAllowed(
      {
        routeId: 'other',
        surfaceId: 'lions:road',
        layer: 1,
        sourceId: 70954678,
      },
      ...p.points[0],
    ),
  );
  assert.deepEqual(
    p.shoulderOpenings({
      routeId: 'causeway-north',
      surfaceId: 'other',
      layer: 1,
      sourceId: 70954678,
    }),
    [],
  );
});
test.after(() => {
  e.vehicleImpacts.dispose();
  nav.condition.dispose();
});
