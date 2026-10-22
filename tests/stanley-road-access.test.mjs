import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFixture, load, geo } from '../tools/causeway-cpu.mjs';
const { prepareStanleyRoadAccess } = load('lib/city/stanley-road-access.ts');
const raw = JSON.parse(fs.readFileSync('public/data/roads.geojson', 'utf8'));
test('only verified car ROW copies change; exact parking prefix, true Avison access and original source data remain intact', () => {
  const roads = structuredClone(raw),
    originals = [...roads.features];
  const before = JSON.stringify(raw),
    result = prepareStanleyRoadAccess(roads);
  assert.deepEqual(
    result.excludedSourceIds,
    [
      1700, 1605, 1782, 1580, 1603, 1763, 1618, 1619, 1625, 1809, 1660, 1719,
      1766, 1708, 1591, 1595, 1608,
    ],
  );
  for (const id of result.excludedSourceIds)
    assert.deepEqual(roads.features[id].geometry, {
      type: 'MultiLineString',
      coordinates: [],
    });
  assert.deepEqual(
    roads.features[1581].geometry.coordinates,
    raw.features[1581].geometry.coordinates.slice(0, 4),
  );
  for (let i = 0; i < roads.features.length; i++)
    if (
      ![
        1700, 1605, 1782, 1581, 1580, 1603, 1763, 1618, 1619, 1625, 1809, 1660,
        1719, 1766, 1708, 1591, 1595, 1608,
      ].includes(i)
    )
      assert.equal(roads.features[i], originals[i]);
  assert.equal(JSON.stringify(raw), before);
  assert(raw.features.some((f) => /avison/i.test(f.properties.name)));
});
test('pinned source mismatch fails before any runtime feature is changed', () => {
  const roads = structuredClone(raw);
  roads.features[1581].geometry.coordinates[0][0] += 0.001;
  const before = JSON.stringify(roads);
  assert.throws(() => prepareStanleyRoadAccess(roads), /source 1581 changed/);
  assert.equal(JSON.stringify(roads), before);
});

const { e, nav } = createFixture();
test('runtime graph has no unlayered cycle-bridge or pond car ROW; real motor bridge, water and Avison remain', () => {
  assert.deepEqual(
    e.data.stanleyRoadAccess.excludedSourceIds,
    [
      1700, 1605, 1782, 1580, 1603, 1763, 1618, 1619, 1625, 1809, 1660, 1719,
      1766, 1708, 1591, 1595, 1608,
    ],
  );
  for (const edge of e.data.roadGraph.edges)
    assert(
      !edge.sourceIds.some((id) =>
        [
          1700, 1605, 1782, 1580, 1603, 1763, 1618, 1619, 1625, 1809, 1660,
          1719, 1766, 1708, 1591, 1595, 1608,
        ].includes(Number(id.split(':')[0])),
      ),
    );
  assert(
    e.data.causeway.main.surfaces.some((s) => s.allowedModes.includes('drive')),
  );
  const water = [-226.4311577751306, -1383.3199360077688];
  assert(e.data.waterPolys.some((p) => geo.inPolygon(water, p)));
  assert.equal(nav.clearGround(...water, 'drive'), false);
  assert.equal(
    nav.clearGround(-920.7975715632654, -3041.4830838761786, 'drive'),
    false,
  );
  for (const id of [1573, 1586, 1672, 1681, 1692, 1769, 1770, 1811])
    assert.deepEqual(e.data.roads.features[id], raw.features[id]);
});
const points = e.data.stanleyRoadAccess.retainedParkingCoordinates.map(
  geo.project,
);
for (const reverse of [false, true])
  for (const speed of [50, 120, 205])
    test(`retained real parking approach stays on supported dry asphalt ${reverse ? 'reverse' : 'forward'} at ${speed}km/h`, () => {
      const route = reverse ? [...points].reverse() : points;
      const a = route[0];
      nav.mode = 'drive';
      nav.surface = 'ground';
      nav.surfaceId = undefined;
      nav.surfaceLayer = 0;
      nav.position.set(a[0], nav.roadHeight(...a), a[1]);
      for (let i = 1; i < route.length; i++) {
        const p = route[i - 1],
          q = route[i],
          dx = q[0] - p[0],
          dz = q[1] - p[1],
          length = Math.hypot(dx, dz),
          n = Math.ceil(length / (speed / 3.6 / 30));
        for (let j = 1; j <= n; j++) {
          const target = [p[0] + (dx * j) / n, p[1] + (dz * j) / n];
          const y = e.data.roadSurface.sample(
            ...target,
            e.elevation(...target) + 1.05,
          );
          assert.notEqual(y, undefined, 'actual rendered parking asphalt');
          assert(
            nav.clearGround(...target, 'drive'),
            'dry parking permissions',
          );
          nav.yaw = Math.atan2(dx, dz);
          nav.car.rotation.y = nav.yaw;
          nav.speed = speed / 3.6;
          nav.move(target[0] - nav.position.x, target[1] - nav.position.z);
          assert(
            Math.hypot(nav.position.x - target[0], nav.position.z - target[1]) <
              0.025,
          );
          assert(nav.speed >= (speed / 3.6) * 0.99);
          nav.car.position.copy(nav.position);
        }
      }
    });
