import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFixture, samplePolyline } from '../tools/causeway-cpu.mjs';
const f = createFixture(),
  data = f.e.data.stanleyDriveCorrections;
const original = JSON.parse(
  fs.readFileSync(
    new URL('../public/data/roads.geojson', import.meta.url),
    'utf8',
  ),
);
const source = JSON.parse(
  fs.readFileSync(
    new URL(
      '../lib/city/stanley-drive-corrections-source.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('primary motor-road correction preserves both City nodes, retained buildings and the proven nonmotor source paths', () => {
  assert.equal(data.sourceId, 1593);
  assert.equal(data.sourceWayId, 363404509);
  assert.equal(data.sourceVersion, 22);
  const coords = f.e.data.roads.features[1593].geometry.coordinates;
  assert.deepEqual(coords[0], original.features[1593].geometry.coordinates[0]);
  assert.deepEqual(
    f.e.data.roads.features[1834].geometry.coordinates.at(-1),
    original.features[1834].geometry.coordinates.at(-1),
  );
  assert.deepEqual(
    coords.at(-1),
    f.e.data.roads.features[1834].geometry.coordinates[0],
  );
  assert.deepEqual(
    coords.at(-1),
    f.e.data.roads.features[1786].geometry.coordinates.at(-1),
  );
  assert.deepEqual(
    f.e.data.roads.features[1786].geometry.coordinates[0],
    original.features[1786].geometry.coordinates[0],
  );
  assert(data.endpointOffsetsM.every((v) => v < 12));
  assert(data.correctedLengthM > 200 && data.correctedLengthM < 300);
  assert(
    f.e.data.buildings.features.some(
      (b) => String(b.properties.id) === '132319',
    ),
  );
  for (const id of [120629380, 363572755]) {
    const path = f.e.data.paths.features.find((p) => p.properties.id === id);
    assert(path);
    assert.deepEqual(
      path.geometry.coordinates,
      source.exclusion.primaryWays.find((w) => w.sourceId === id).coordinates,
    );
  }
  assert(
    f.nav.blocked(-2109.951220015469, -1671.581176851078),
    'old ROW still physically enters the retained retail building',
  );
});

test('only proven phantom motor source1760 is absent from runtime road graph and pavement input; original source remains saved', () => {
  assert.deepEqual(data.excludedSourceIds, [1760]);
  assert.equal(original.features[1760].geometry.coordinates.length, 2);
  assert.deepEqual(f.e.data.roads.features[1760].geometry, {
    type: 'MultiLineString',
    coordinates: [],
  });
  assert(
    !f.e.data.roadGraph.edges.some((e) =>
      e.sourceIds.some((id) => id.startsWith('1760:')),
    ),
  );
  for (const id of [1614, 1683, 1761, 1762])
    assert.deepEqual(
      f.e.data.roads.features[id],
      original.features[id],
      `adjacent source${id} must remain unchanged`,
    );
});

test('full corrected ordinary Drive route passes retained building collision in both directions at50/120/205kmh', () => {
  for (const speed of [50, 120, 205])
    for (const reverse of [false, true])
      for (const route of [...data.routes, ...data.junctionBranches]) {
        const points = samplePolyline(
          reverse ? [...route.points].reverse() : route.points,
          speed / 3.6 / 30,
        );
        const nav = f.nav,
          first = points[0];
        nav.mode = 'drive';
        nav.surface = 'ground';
        nav.surfaceId = undefined;
        nav.surfaceLayer = undefined;
        nav.position.set(first[0], nav.roadHeight(...first), first[1]);
        nav.car.rotation.y = Math.atan2(
          points[1][0] - first[0],
          points[1][1] - first[1],
        );
        for (const q of points.slice(1)) {
          const dx = q[0] - nav.position.x,
            dz = q[1] - nav.position.z;
          nav.yaw = Math.atan2(dx, dz);
          nav.speed = speed / 3.6;
          nav.move(dx, dz);
          nav.car.rotation.y = nav.yaw;
          assert(
            Math.hypot(nav.position.x - q[0], nav.position.z - q[1]) < 0.02,
            JSON.stringify({
              speed,
              reverse,
              q,
              actual: nav.position.toArray(),
              blocked: f.nav.blocked(...q),
            }),
          );
          assert.notEqual(
            f.e.data.roadSurface.sample(...q, nav.position.y),
            undefined,
            'the whole corrected source route and branch must use actual rendered asphalt',
          );
        }
      }
});
