import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, load, THREE } from '../tools/causeway-cpu.mjs';
const { e, nav, road } = createFixture();
const { createCausewayTriangleLookup } = load('lib/city/causeway-geometry.ts');
const { VehicleImpactWorld } = load('lib/city/vehicle-impact-world.ts');
const { VehicleCondition } = load('lib/city/vehicle-condition.ts');
e.settings = { trees: true, buildings: true, quality: 'balanced' };
e.detailedTrees = { trees: [], syncBroken() {} };
e.data.streetLampPoints = [];
e.vehicleImpacts = new VehicleImpactWorld(e);
nav.condition = new VehicleCondition(e, nav.car, 1550, 0.7);
const ramp = e.data.stanleySouthRamp;
const widthShape = { halfExtents: [1, 0.65, 2.4], clearance: 0.02 };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function measured(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(cumulative.at(-1) + distance(points[i - 1], points[i]));
  return {
    length: cumulative.at(-1),
    at(s) {
      let i = cumulative.findIndex((d, j) => j > 0 && d >= s - 1e-8);
      if (i < 0) i = points.length - 1;
      const a = points[i - 1],
        b = points[i],
        l = cumulative[i] - cumulative[i - 1],
        t = Math.min(1, Math.max(0, (s - cumulative[i - 1]) / l));
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    },
  };
}
function replay(points, identity, speedKmh) {
  const route = measured(points),
    first = route.at(0),
    hit =
      identity === 'ground'
        ? undefined
        : e.data.travelSurfaces
            .lookup(...first.point)
            .find(
              (h) =>
                h.surfaceId === identity && h.allowedModes.includes('drive'),
            );
  if (identity !== 'ground')
    assert(hit, 'explicit source-owned start floor exists');
  nav.mode = 'drive';
  nav.surface = hit ? 'bridge' : 'ground';
  nav.surfaceId = hit?.surfaceId;
  nav.surfaceLayer = hit?.layer;
  nav.position.set(
    first.point[0],
    hit?.y ?? nav.roadHeight(...first.point),
    first.point[1],
  );
  nav.yaw = first.yaw;
  nav.car.rotation.y = first.yaw;
  nav.speed = 0;
  nav.condition.repair(0);
  const floors = [nav.surfaceId ?? 'ground'];
  let maxRise = 0,
    previousY = nav.position.y;
  const speed = speedKmh / 3.6,
    step = speed / 30;
  for (let s = step; s < route.length + step; s += step) {
    const target = route.at(Math.min(s, route.length)),
      dx = target.point[0] - nav.position.x,
      dz = target.point[1] - nav.position.z;
    nav.yaw = Math.atan2(dx, dz);
    nav.speed = speed;
    nav.move(dx, dz);
    assert(
      distance([nav.position.x, nav.position.z], target.point) < 0.025,
      JSON.stringify({
        s,
        speedKmh,
        target,
        actual: nav.position.toArray(),
        speed: nav.speed,
        floor: nav.surfaceId,
      }),
    );
    assert(
      nav.speed >= speed * 0.99,
      JSON.stringify({
        s,
        speedKmh,
        speed: nav.speed,
        hit: nav.condition.damage.lastHit,
      }),
    );
    maxRise = Math.max(maxRise, Math.abs(nav.position.y - previousY));
    previousY = nav.position.y;
    const floor = nav.surfaceId ?? 'ground';
    if (floor !== floors.at(-1)) floors.push(floor);
    nav.car.position.copy(nav.position);
    nav.car.rotation.y = nav.yaw;
  }
  assert.equal(nav.condition.damage.overall, 0);
  return { floors, maxRise, length: route.length };
}

test('actual source-owned on-ramp is asphalt under both tyres before its explicit mainline entry', () => {
  assert(ramp);
  assert.equal(
    e.data.causewayConnections.filter(
      (c) => c.id === 'stanley-south-legal-motor-ramp',
    ).length,
    1,
  );
  for (const s of ramp.segments) {
    const x = (s.a[0] + s.b[0]) / 2,
      z = (s.a[1] + s.b[1]) / 2,
      dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      l = Math.hypot(dx, dz),
      y = (s.h0 + s.h1) / 2;
    for (const lateral of [-1, 0, 1]) {
      const px = x + (dz / l) * lateral,
        pz = z - (dx / l) * lateral;
      assert(
        e.data.roadSurface.sample(px, pz, y) !== undefined,
        `actual paved tyre at ${s.s0}/${lateral}`,
      );
    }
  }
  const p = ramp.gate.point,
    ground = e.data.roadSurface.sample(...p, ramp.gate.height),
    upper = e.data.travelSurfaces
      .lookup(...p)
      .find(
        (h) => h.surfaceId === 'lions:road' && h.allowedModes.includes('drive'),
      );
  assert(upper);
  assert(
    Math.abs(ground - upper.y) <= 0.025,
    JSON.stringify({ ground, upper }),
  );
});

test('actual South ramp inner paving matches unchanged main triangles and removes only the intersecting raised shoulder', () => {
  const main = createCausewayTriangleLookup(road.result),
    ground = createCausewayTriangleLookup(ramp.geometry),
    mainIdentity = { surfaceId: 'lions:road', layer: 1 },
    rampIdentity = { surfaceId: 'ground', layer: 0 };
  let overlapping = 0,
    worst = 0;
  for (const t of ramp.geometry.topTriangles) {
    if (t.buffer !== 'asphalt') continue;
    const p = ramp.geometry.buffers.asphalt.slice(t.offset, t.offset + 9);
    assert(
      (p[5] - p[2]) * (p[6] - p[0]) - (p[3] - p[0]) * (p[8] - p[2]) > 1e-9,
      'every actual Float32 ramp face stays non-degenerate and faces upward',
    );
    const normal = new THREE.Vector3(...p.slice(3, 6))
      .sub(new THREE.Vector3(...p.slice(0, 3)))
      .cross(
        new THREE.Vector3(...p.slice(6, 9)).sub(
          new THREE.Vector3(...p.slice(0, 3)),
        ),
      )
      .normalize();
    assert(
      normal.y > 0.92,
      `clipped paving must not create a steep skinny ridge: ${JSON.stringify({ normal: normal.toArray(), p })}`,
    );
    for (const weights of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1 / 3, 1 / 3, 1 / 3],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ]) {
      const x = p[0] * weights[0] + p[3] * weights[1] + p[6] * weights[2],
        z = p[2] * weights[0] + p[5] * weights[1] + p[8] * weights[2],
        a = main.heightAt(x, z, mainIdentity, 'road'),
        b = ground.heightAt(x, z, rampIdentity, 'road');
      if (!a || !b) continue;
      overlapping++;
      worst = Math.max(worst, Math.abs(a.y - b.y));
    }
  }
  assert(overlapping > 100);
  assert(worst <= 0.025, `actual inner-paving overlap differs by ${worst}m`);
  // Centroid of the real native Tesla collision, originally protected666 face8:
  // a 26cm-high, non-drivable West shoulder through the mapped motor merge.
  const oldShoulder = [
    (-612.43994140625 - 611.12799072265625 - 612.620849609375) / 3,
    (-1147.700927734375 - 1150.0625 - 1149.9139404296875) / 3,
  ];
  assert(ground.heightAt(...oldShoulder, rampIdentity, 'road'));
  assert.equal(
    main.heightAt(...oldShoulder, mainIdentity, 'shoulder'),
    undefined,
  );
  for (const formerSliver of [
    [-611.466736, -1141.562948],
    [-614.097961, -1114.825114],
  ]) {
    assert(ground.heightAt(...formerSliver, rampIdentity, 'road'));
    assert.equal(
      main.heightAt(...formerSliver, mainIdentity, 'shoulder'),
      undefined,
      'Float32 subdivision seams must not leave submillimetre raised shoulder slivers',
    );
  }
});
for (const reverse of [false, true])
  for (const speed of [50, 120, 205])
    test(`real North Lagoon to Causeway route ${reverse ? 'reverse' : 'forward'} at ${speed}km/h keeps full CCD and crosses only the explicit entry gate`, () => {
      const points = ramp.qaRoutes.southEntry.points,
        report = replay(
          reverse ? [...points].reverse() : points,
          reverse ? 'lions:road' : 'ground',
          speed,
        );
      assert.deepEqual(
        report.floors,
        reverse ? ['lions:road', 'ground'] : ['ground', 'lions:road'],
      );
      assert(report.maxRise < 0.4);
      assert(report.length > 170);
    });

test('main Causeway centre retains its floor while passing the side-ramp gate in both directions', () => {
  const segments = e.data.causeway.segments
    .filter(
      (s) =>
        s.routeId === 'causeway-south-west' &&
        [363687651, 74233349].includes(s.sourceId),
    )
    .sort((a, b) => a.s0 - b.s0);
  const points = [segments[0].a, ...segments.map((s) => s.b)];
  for (const reverse of [false, true]) {
    const report = replay(
      reverse ? [...points].reverse() : points,
      'lions:road',
      50,
    );
    assert.deepEqual(report.floors, ['lions:road']);
  }
});

test('the on-ramp opening does not disable a nearby unrelated physical barrier', () => {
  const untouched = [];
  e.roads.traverse((o) => {
    if (o instanceof THREE.Mesh && /Stanley Park Causeway rails/.test(o.name))
      untouched.push(o);
  });
  assert(untouched.length > 0);
  assert(e.vehicleImpacts.sources.some((s) => s.id.startsWith('guardrail:')));
  const id = {
      routeId: 'causeway-south-west',
      surfaceId: 'lions:road',
      layer: 1,
      sourceId: 363687651,
    },
    p = ramp.points[0];
  assert.equal(ramp.railAllowed(id, ...p), true);
  assert.equal(
    ramp.railAllowed({ ...id, sourceId: 363693711 }, ...ramp.gate.point),
    true,
  );
  const side = e.data.causeway.segments.find(
    (s) =>
      s.routeId === 'causeway-south-east' &&
      s.sourceId === 363693711 &&
      s.s0 > 180 &&
      s.s1 < 205,
  );
  assert(side);
  const x = (side.a[0] + side.b[0]) / 2,
    z = (side.a[1] + side.b[1]) / 2,
    y = (side.h0 + side.h1) / 2,
    dx = side.b[0] - side.a[0],
    dz = side.b[1] - side.a[1],
    length = Math.hypot(dx, dz),
    yaw = Math.atan2(dx, dz),
    quaternion = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .toArray();
  const hit = e.vehicleImpacts.sweep({
    from: { position: [x, y + 0.7, z], quaternion },
    to: {
      position: [x + (dz / length) * 10, y + 0.7, z - (dx / length) * 10],
      quaternion,
    },
    shape: widthShape,
  });
  assert(
    hit && hit.surfaceId.startsWith('guardrail:'),
    'an actual untouched mainline barrier still physically stops the full car body',
  );
});

test.after(() => {
  e.vehicleImpacts.dispose();
  nav.condition.dispose();
});
