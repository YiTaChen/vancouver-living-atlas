import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFixture,
  samplePolyline,
  load,
  THREE,
  geo,
} from '../tools/causeway-cpu.mjs';

// Rebuild actual terrain, cut ordinary pavement, protected triangles and real
// collision rails in the runtime order. No hand-authored replacement floor.
const f = createFixture(),
  p = f.e.data.prospectOverpass;
const upper = 'park:prospect-overpass';
const { VehicleImpactWorld } = load('lib/city/vehicle-impact-world.ts');
const { VehicleCondition } = load('lib/city/vehicle-condition.ts');
const { CityTeslaWorld } = load('lib/city/tesla-city-world.ts');
const { createTeslaRoadsterShape } = load('lib/city/tesla-shape.ts');
f.e.landmarkDetails = [];
f.e.settings = { buildings: true };
f.e.vehicleImpacts = new VehicleImpactWorld(f.e);
f.nav.condition = new VehicleCondition(f.e, f.nav.car, 1550, 0.7);
const shape = createTeslaRoadsterShape();
const world = new CityTeslaWorld(f.e);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const hitAt = (point, identity) =>
  f.index
    .lookup(...point)
    .find((h) => h.surfaceId === identity && h.allowedModes.includes('drive'));
function replay(points, startIdentity, speedKmh = 80) {
  // Full production move/CCD calls at no more than one 30Hz frame's travel.
  points = samplePolyline(points, speedKmh / 3.6 / 30);
  const first = points[0],
    hit = hitAt(first, startIdentity),
    nav = f.nav;
  nav.mode = 'drive';
  nav.surface = hit ? 'bridge' : 'ground';
  nav.surfaceId = hit?.surfaceId;
  nav.surfaceLayer = hit?.layer;
  nav.position.set(first[0], hit?.y ?? nav.roadHeight(...first), first[1]);
  nav.car.rotation.y = Math.atan2(
    points[1][0] - first[0],
    points[1][1] - first[1],
  );
  const changes = [],
    initialDamage = nav.condition.damage.overall;
  let maxRise = 0,
    previous = nav.position.y;
  for (const [i, q] of points.slice(1).entries()) {
    const dx = q[0] - nav.position.x,
      dz = q[1] - nav.position.z;
    nav.yaw = Math.atan2(dx, dz);
    nav.speed = speedKmh / 3.6;
    const before = nav.surfaceId ?? 'ground';
    const from = {
      position: [nav.position.x, nav.position.y + 0.7, nav.position.z],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), nav.car.rotation.y)
        .toArray(),
    };
    const collision = f.e.vehicleImpacts.sweep({
      from,
      to: {
        position: [q[0], from.position[1], q[1]],
        quaternion: new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), nav.yaw)
          .toArray(),
      },
      shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
    });
    nav.move(dx, dz);
    nav.car.rotation.y = nav.yaw;
    assert(
      dist([nav.position.x, nav.position.z], q) < 0.02,
      JSON.stringify({
        i,
        q,
        actual: nav.position.toArray(),
        identity: nav.surfaceId,
        speed: nav.speed,
        collision,
        mesh:
          collision &&
          f.e.roads.children.find(
            (m) =>
              m.userData.impactObstacleId ===
              collision.surfaceId.split(':face')[0],
          )?.name,
      }),
    );
    maxRise = Math.max(maxRise, Math.abs(nav.position.y - previous));
    previous = nav.position.y;
    const after = nav.surfaceId ?? 'ground';
    if (after !== before) changes.push(after);
  }
  assert.equal(
    nav.condition.damage.overall,
    initialDamage,
    'actual guardrails must not be ignored or struck along the centreline',
  );
  return { changes, maxRise };
}
test('primary OSM alignment distinguishes true bridge and at-grade east ramp; canonical capture semantics stay stable', () => {
  assert.equal(f.road.input[0].routeId, 'causeway-south-east');
  assert.equal(f.paths.input[0].routeId, 'causeway-east-path');
  assert.deepEqual(p.sourceIds, [1585, 1599, 1778, 1812, 1819]);
  assert.deepEqual(p.qaRoutes.bridge.osmSourceIds, [41998497]);
  assert.deepEqual(p.qaRoutes.ramp.osmSourceIds, [877408902, 41998501]);
  assert.deepEqual(
    f.e.data.roads.features[1585].geometry.coordinates[0],
    [-123.1437529, 49.3096637],
  );
  assert(
    dist(p.center, geo.project([-123.14258684214506, 49.31107368890673])) <
      0.001,
  );
  assert(
    !p.segments.some((s) =>
      [1580, 1603, 1763, 1700, 1809].includes(s.sourceId),
    ),
    'approximate Causeway/cycle ROWs never become an invented high bridge',
  );
  assert(
    f.e.roads.children.some(
      (m) =>
        m.userData.parkTreeClearance &&
        m.userData.asphaltSurface &&
        m.userData.protectedSurface,
    ),
  );
});

test('true upper bridge is above unchanged Causeway, has a finite physical slab and bounded 1D approach grades', () => {
  const high = hitAt(p.center, upper),
    low = hitAt(p.center, 'lions:road');
  assert(high && low);
  assert(high.y - 0.5 - low.y >= 5.2);
  assert(Math.abs(low.y - 64.17442943076449) < 0.002);
  const segment = f.e.data.causeway.segments.find(
    (s) => s.routeId === 'causeway-north' && s.s0 === 0,
  );
  assert(Math.abs(segment.h0 - 54.66090516798405) < 1e-8);
  assert(p.segments.every((s) => s.surfaceId === upper && s.layer === 2));
  const grade = Math.max(
    ...p.segments.map((s) => Math.abs(s.h1 - s.h0) / dist(s.a, s.b)),
  );
  assert(grade < 0.22, `new maximum grade ${grade}`);
  assert(f.e.data.prospectSlabMeshes.length > 0);
  assert(
    !(f.e.data.flightBridgeVolumes ?? []).some(
      (v) => v.source === 'prospect-point-overpass',
    ),
  );
});

test('actual slab outside faces and real road tops preserve aircraft collision while leaving the Causeway headroom open', () => {
  const { FlightWorld } = load('lib/city/flight-world.ts'),
    world = new FlightWorld(f.e),
    [x, z] = p.center,
    top = p.deckTop;
  const v = (a, b, c) => new THREE.Vector3(a, b, c);
  assert(
    world.hit(v(x, top + 2, z), v(x, top - 2, z), 0.01),
    'real asphalt top or slab underside must catch descent',
  );
  assert(
    world.hit(v(x - 10, top - 0.25, z), v(x + 10, top - 0.25, z), 0.01),
    'exposed lateral slab remains solid',
  );
  assert(
    !world.hit(v(x - 10, top + 1, z), v(x + 10, top + 1, z), 0.05),
    'no closed-box cap may protrude above road',
  );
  assert(
    !world.hit(v(x - 10, top - 2, z), v(x + 10, top - 2, z), 0.05),
    'underpass remains open below the true slab',
  );
});

test('complete real main crossing passes actual Drive CCD both directions through both ordinary-ground gates', () => {
  for (const route of p.routes)
    for (const speed of [50, 120, 205])
      for (const reverse of [false, true]) {
        const report = replay(
          reverse ? [...route.points].reverse() : route.points,
          undefined,
          speed,
        );
        assert.deepEqual(report.changes, [upper, 'ground'], route.id);
        assert(
          report.maxRise < Math.max(0.31, (speed / 3.6 / 30) * 0.23 + 0.03),
          route.id,
        );
      }
});

test('corrected actual east off-ramp passes full Drive CCD both ways and joins the raised main road at the real shared node', () => {
  const ramp = p.qaRoutes.ramp.points,
    main = f.e.data.roads.features[1812].geometry.coordinates.map(geo.project);
  const after = samplePolyline(main, 0.5).filter((_, i) => i < 145);
  const points = [...ramp, ...after.slice(1)];
  const report = replay(points, 'lions:road');
  assert.deepEqual(report.changes, [upper, 'ground']);
  assert(report.maxRise < 0.31, `ramp forward height change ${report.maxRise}`);
  const reverse = replay([...points].reverse());
  assert.deepEqual(reverse.changes, [upper, 'lions:road']);
  assert(
    reverse.maxRise < 0.31,
    `ramp reverse height change ${reverse.maxRise}`,
  );
});

test('the primary green at-grade crossing shares the motor-ramp physical floor without opening adjacent cycle paths', () => {
  const crossing = f.paths.result.surfaces.filter(
    (s) => s.sourceId === 1252160599,
  );
  assert(crossing.length);
  assert(
    crossing.every(
      (s) =>
        s.allowedModes.includes('walk') && s.allowedModes.includes('drive'),
    ),
  );
  const { createCausewayTriangleLookup } = load(
    'lib/city/causeway-geometry.ts',
  );
  const roads = createCausewayTriangleLookup(f.road.result);
  let samples = 0,
    maxGap = 0;
  for (const surface of crossing)
    for (let i = 0; i < surface.triangles.length; i += 9) {
      const v = surface.triangles.slice(i, i + 9);
      const x = (v[0] + v[3] + v[6]) / 3,
        z = (v[2] + v[5] + v[8]) / 3;
      const road = roads.heightAt(
        x,
        z,
        { surfaceId: 'lions:road', layer: 1 },
        'road',
      );
      if (!road) continue;
      samples++;
      maxGap = Math.max(maxGap, Math.abs((v[1] + v[4] + v[7]) / 3 - road.y));
    }
  assert(samples >= 4);
  assert(maxGap < 0.015, `crossing floor differs ${maxGap}m`);
  assert(
    f.paths.result.surfaces
      .filter((s) => [877408903, 877408901].includes(s.sourceId))
      .every((s) => !s.allowedModes.includes('drive')),
  );
});

test('lower Causeway drives both directions under true bridge and its original lateral rails remain physical', () => {
  const points = p.qaRoutes.lower.points;
  for (const reverse of [false, true]) {
    const report = replay(
      reverse ? [...points].reverse() : points,
      'lions:road',
    );
    assert.deepEqual(report.changes, []);
    assert(report.maxRise < 0.05);
  }
  const s = f.e.data.causeway.segments.find(
      (s) => s.routeId === 'causeway-north' && dist(s.a, p.center) < 4,
    ),
    center = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2],
    dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1],
    len = dist(s.a, s.b),
    right = [dz / len, -dx / len],
    y = (s.h0 + s.h1) / 2 + 0.7;
  const from = {
      position: [center[0], y, center[1]],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz))
        .toArray(),
    },
    to = {
      ...from,
      position: [center[0] + right[0] * 12, y, center[1] + right[1] * 12],
    };
  assert(
    f.e.vehicleImpacts
      .sweep({
        from,
        to,
        shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
      })
      ?.surfaceId.startsWith('guardrail:'),
  );
});

test('actual Tesla full-footprint proof supports both physical floors at true crossing in both headings', () => {
  for (const name of ['bridge', 'lower']) {
    const route = p.qaRoutes[name],
      hit = hitAt(p.center, route.identity.surfaceId),
      ps = route.points,
      yaw = Math.atan2(ps.at(-1)[0] - ps[0][0], ps.at(-1)[1] - ps[0][1]);
    assert(hit);
    for (const heading of [yaw, yaw + Math.PI]) {
      const spawn = world.groundPoseNear(
        [p.center[0], hit.y, p.center[1]],
        shape,
        heading,
        0,
        route.identity,
      );
      assert(
        spawn,
        JSON.stringify({ name, heading, point: [...p.center], y: hit.y }),
      );
      assert.equal(
        world.sweep({
          from: spawn.pose,
          to: spawn.pose,
          shape,
          ignoreSurfaceId: spawn.contact.surfaceId,
        }),
        null,
      );
    }
  }
});

test('walk mode crosses the real Park Drive bridge and both ground gates in both directions', () => {
  for (const route of p.routes)
    for (const reverse of [false, true]) {
      const points = samplePolyline(
          reverse ? [...route.points].reverse() : route.points,
          0.75,
        ),
        first = points[0],
        nav = f.nav;
      nav.mode = 'walk';
      nav.surface = 'ground';
      nav.surfaceId = undefined;
      nav.surfaceLayer = undefined;
      nav.position.set(first[0], nav.groundHeight(...first), first[1]);
      const changes = [];
      for (const q of points.slice(1)) {
        const before = nav.surfaceId ?? 'ground';
        nav.move(q[0] - nav.position.x, q[1] - nav.position.z);
        assert(
          dist([nav.position.x, nav.position.z], q) < 0.02,
          JSON.stringify({
            route: route.id,
            q,
            position: nav.position.toArray(),
            identity: nav.surfaceId,
          }),
        );
        const after = nav.surfaceId ?? 'ground';
        if (after !== before) changes.push(after);
      }
      assert.deepEqual(changes, [upper, 'ground']);
    }
  assert(
    f.index.surfaces
      .filter((s) => s.surfaceId === 'lions:road')
      .every((s) => !s.allowedModes.includes('walk')),
    'a park-road connection does not open the Causeway trunk to walkers',
  );
});

test('the at-grade ramp/main intersection has one shared physical top across its overlapping ribbons', () => {
  const join = p.qaRoutes.ramp.points.at(-1);
  let overlaps = 0,
    maxDifference = 0;
  for (let x = -7; x <= 7; x++)
    for (let z = -7; z <= 7; z++) {
      const hits = f.index.lookup(join[0] + x, join[1] + z),
        main = hits.find(
          (h) => h.surfaceId === upper && h.allowedModes.includes('drive'),
        ),
        ramp = hits.find(
          (h) =>
            h.surfaceId === 'lions:road' &&
            h.routeId === 'prospect:east-exit' &&
            h.allowedModes.includes('drive'),
        );
      if (main && ramp) {
        overlaps++;
        maxDifference = Math.max(maxDifference, Math.abs(main.y - ramp.y));
      }
    }
  assert(overlaps > 12);
  assert(
    maxDifference < 0.005,
    `overlapping actual junction floors differ ${maxDifference}m`,
  );
});

test('real East junction openings remove former raised-shoulder contacts while keeping shoulders beyond the access corridor', () => {
  const { createCausewayTriangleLookup } = load(
      'lib/city/causeway-geometry.ts',
    ),
    ramp = createCausewayTriangleLookup(f.road.result),
    main = createCausewayTriangleLookup(p.geometry);
  // Exact centroids of the two actual shoulder faces that stopped the full
  // Tesla State replay before this source-owned physical junction correction.
  for (const point of [
    [-1081.1877, -2643.5678],
    [-1082.74, -2640.999],
  ]) {
    assert(
      ramp.heightAt(...point, { surfaceId: 'lions:road', layer: 1 }, 'road'),
    );
    assert.equal(
      main.heightAt(...point, { surfaceId: upper, layer: 2 }, 'shoulder'),
      undefined,
    );
  }
  assert(
    p.geometry.surfaces.some(
      (s) =>
        s.kind === 'shoulder' && s.sourceId === 1812 && s.triangles.length > 0,
    ),
    'unrelated shoulders remain physical',
  );
});
test.after(() => {
  world.dispose();
  f.nav.condition.dispose();
  f.e.vehicleImpacts.dispose();
});

// The legal northbound ramp is attached at the primary main-road node rather
// than a nearby approximate City ROW point with no rendered pavement.
test('Park main1812/1784 shares the actual northbound-ramp node and retains continuous physical asphalt', () => {
  const a = geo.lines(f.e.data.roads.features[1812])[0],
    b = geo.lines(f.e.data.roads.features[1784])[0],
    shared = [-123.142738, 49.3086419];
  assert.deepEqual(a.at(-1), shared);
  assert.deepEqual(b[0], shared);
  assert.deepEqual(b.at(-1), [-123.1414202, 49.3084342]);
  assert(
    dist(geo.project(shared), f.e.data.stanleyNorthboundRamp.points[0]) < 1e-6,
  );
  const points = [
    ...a.map(geo.project).slice(-15),
    ...b.map(geo.project).slice(1),
  ];
  for (const q of samplePolyline(points, 0.25))
    assert(
      f.e.data.roadSurface.sample(...q, f.e.data.roadRelief(...q) + 1.05),
      `missing main asphalt ${q}`,
    );
  for (const speed of [50, 120, 205])
    for (const reverse of [false, true]) {
      const report = replay(
        reverse ? [...points].reverse() : points,
        undefined,
        speed,
      );
      assert.deepEqual(report.changes, []);
    }
});
