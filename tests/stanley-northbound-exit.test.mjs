import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, load } from '../tools/causeway-cpu.mjs';
const { e, nav } = createFixture(),
  exit = e.data.stanleyNorthboundExit;
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
test('real northbound exit gets bounded visible ground pavement while retaining the original floor gate', () => {
  assert(exit);
  assert.equal(
    e.data.causewayConnections.filter((c) => c.id === 'park-access-city')
      .length,
    1,
  );
  assert(Math.abs(exit.fullLengthM - 262.3865556800381) < 1e-6);
  assert(Math.abs(exit.pavedLengthM - 132.3865556800381) < 1e-6);
  assert(exit.geometry.buffers.asphalt.length / 9 <= 2048);
  assert.equal(exit.geometry.buffers.paintYellow.length, 0);
  assert.deepEqual(
    [...new Set(exit.segments.map((s) => s.sourceId))],
    [156891517, 604336388, 1299818249, 116061634, 1299818248],
  );
  for (const s of exit.segments) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length = Math.hypot(dx, dz),
      x = (s.a[0] + s.b[0]) / 2,
      z = (s.a[1] + s.b[1]) / 2;
    for (const side of [-1.1, 0, 1.1]) {
      const px = x + (dz / length) * side,
        pz = z - (dx / length) * side,
        y = exit.height(px, pz);
      const actual = e.data.roadSurface.sample(px, pz, y + 0.01);
      assert.notEqual(
        actual,
        undefined,
        'actual float32 pavement under both tyres',
      );
      assert(Math.abs(actual - y) < 0.06, 'continuous authored grade');
    }
  }
});
for (const reverse of [false, true])
  for (const speed of [50, 120, 205])
    test(`complete262m source-owned exit ${reverse ? 'reverse' : 'forward'} at ${speed}km/h retains full CCD and all ground tyre support`, () => {
      const points = reverse ? [...exit.points].reverse() : exit.points,
        first = points[0];
      nav.mode = 'drive';
      nav.condition.repair(0);
      const start = reverse
        ? undefined
        : e.data.travelSurfaces
            .lookup(...first)
            .find(
              (h) =>
                h.surfaceId === 'lions:road' &&
                h.allowedModes.includes('drive'),
            );
      if (!reverse) assert(start);
      nav.surface = start ? 'bridge' : 'ground';
      nav.surfaceId = start?.surfaceId;
      nav.surfaceLayer = start?.layer;
      nav.position.set(
        first[0],
        start?.y ?? nav.roadHeight(...first),
        first[1],
      );
      nav.yaw = Math.atan2(points[1][0] - first[0], points[1][1] - first[1]);
      nav.car.rotation.y = nav.yaw;
      const floors = [nav.surfaceId ?? 'ground'];
      let groundSamples = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz),
          n = Math.ceil(length / (speed / 3.6 / 30));
        for (let j = 1; j <= n; j++) {
          const p = [a[0] + (dx * j) / n, a[1] + (dz * j) / n];
          nav.yaw = Math.atan2(dx, dz);
          nav.speed = speed / 3.6;
          nav.move(p[0] - nav.position.x, p[1] - nav.position.z);
          assert(
            Math.hypot(nav.position.x - p[0], nav.position.z - p[1]) < 0.025,
            JSON.stringify({
              reverse,
              speed,
              p,
              actual: nav.position.toArray(),
              hit: nav.condition.damage.lastHit,
            }),
          );
          assert(nav.speed >= (speed / 3.6) * 0.99);
          const floor = nav.surfaceId ?? 'ground';
          if (floor !== floors.at(-1)) floors.push(floor);
          if (floor === 'ground') {
            groundSamples++;
            for (const side of [-1, 0, 1]) {
              const x = p[0] + (dz / length) * side,
                z = p[1] - (dx / length) * side;
              assert.notEqual(
                e.data.roadSurface.sample(x, z, nav.position.y),
                undefined,
                'ground wheels must not drive through bare dirt',
              );
            }
          }
          nav.car.position.copy(nav.position);
          nav.car.rotation.y = nav.yaw;
        }
      }
      assert(groundSamples > 30);
      assert.equal(nav.condition.damage.overall, 0);
      assert.deepEqual(
        floors,
        reverse ? ['ground', 'lions:road'] : ['lions:road', 'ground'],
      );
    });
