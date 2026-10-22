import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, load } from '../tools/causeway-cpu.mjs';
import { replayTeslaSourceRoute } from './helpers/tesla-source-route.mjs';
const { e } = createFixture();
e.landmarkDetails = [];
e.settings = { buildings: true, trees: true };
e.vehicleImpacts = new (load(
  'lib/city/vehicle-impact-world.ts',
).VehicleImpactWorld)(e);
const world = new (load('lib/city/tesla-city-world.ts').CityTeslaWorld)(e),
  shape = load('lib/city/tesla-shape.ts').createTeslaRoadsterShape(),
  fixture = { e, world, shape };
after(() => world.dispose());
const ground = { surfaceId: 'ground', layer: 0 },
  upper = { surfaceId: 'park:prospect-overpass', layer: 2 };
function clippedSource(points, centers) {
  let length = 0;
  const pieces = points.slice(1).map((b, i) => {
    const a = points[i],
      start = length,
      distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
    length += distance;
    return { a, b, start, length: distance };
  });
  function station(center) {
    let nearest;
    for (const p of pieces) {
      const dx = p.b[0] - p.a[0],
        dz = p.b[1] - p.a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((center[0] - p.a[0]) * dx + (center[1] - p.a[1]) * dz) /
              (p.length * p.length),
          ),
        ),
        distance = Math.hypot(
          p.a[0] + dx * t - center[0],
          p.a[1] + dz * t - center[1],
        );
      if (!nearest || distance < nearest.distance)
        nearest = { distance, s: p.start + p.length * t };
    }
    assert.ok(
      nearest.distance < 0.05,
      'declared seam lies on the actual source route',
    );
    return nearest.s;
  }
  function at(d) {
    const p = pieces.find((p) => p.start + p.length >= d) || pieces.at(-1),
      t = (d - p.start) / p.length;
    return [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
  }
  const stations = centers.map(station),
    lo = Math.min(...stations) - 9,
    hi = Math.max(...stations) + 9;
  assert.ok(
    lo >= 0 && hi <= length,
    'full original source approach exists on both sides',
  );
  return [
    at(lo),
    ...pieces.filter((p) => p.start > lo && p.start < hi).map((p) => p.a),
    at(hi),
  ];
}
const p = e.data.prospectOverpass,
  main = p.routes[0].points,
  groundGates = p.gates.filter((g) => g.geometry.kind === 'gate'),
  center = (g) => [
    (g.geometry.a[0] + g.geometry.b[0]) / 2,
    (g.geometry.a[1] + g.geometry.b[1]) / 2,
  ];
const west = e.data.stanleyWestRamp.qaRoutes.westExit;
function sourceTail(points, length) {
  const result = [points[0]];
  for (let i = 1; i < points.length && length > 0; i++) {
    const a = points[i - 1],
      b = points[i],
      distance = Math.hypot(b[0] - a[0], b[1] - a[1]),
      t = Math.min(1, length / distance);
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    length -= distance;
  }
  assert.ok(
    length < 1e-6,
    'the original source contains its entire unchanged approach',
  );
  return result;
}
const ramp = p.qaRoutes.ramp.points,
  join = main.findIndex(
    (point) =>
      Math.hypot(point[0] - ramp.at(-1)[0], point[1] - ramp.at(-1)[1]) < 0.001,
  ),
  north = e.data.causeway.segments
    .filter((s) => s.routeId === 'causeway-north')
    .sort((a, b) => a.s0 - b.s0),
  lowerPoints = [north[0].a, ...north.map((s) => s.b)],
  entry = lowerPoints.findIndex(
    (point) => Math.hypot(point[0] - ramp[0][0], point[1] - ramp[0][1]) < 0.001,
  );
assert.ok(join >= 0 && entry >= 0, 'actual original shared source nodes exist');
const upperTail = sourceTail(
    [main[join], ...main.slice(0, join).reverse()],
    15,
  ),
  lowerTail = sourceTail(
    [lowerPoints[entry], ...lowerPoints.slice(0, entry).reverse()],
    15,
  ).reverse();
const routes = [
  {
    id: 'entire West legal motor source plus unchanged lower and upper approaches',
    points: west.points,
    forwardIdentity: west.identity,
    reverseIdentity: west.reverseIdentity,
  },
  {
    id: 'entire East motor ramp with both original 15m source approaches and the real cycle crossing',
    points: [...lowerTail, ...ramp.slice(1), ...upperTail.slice(1)],
    forwardIdentity: { surfaceId: 'lions:road', layer: 1 },
    reverseIdentity: upper,
  },
  {
    id: 'entire South legal motor source with the unchanged 20m upper continuation',
    points: e.data.stanleySouthRamp.qaRoutes.southEntry.points,
    forwardIdentity: ground,
    reverseIdentity: { surfaceId: 'lions:road', layer: 1 },
  },
  {
    id: 'entire Northbound1693 legal motor ramp with original ground and main-road approaches',
    points: e.data.stanleyNorthboundRamp.qaRoutes.northbound.points,
    forwardIdentity: e.data.stanleyNorthboundRamp.qaRoutes.northbound.identity,
    reverseIdentity:
      e.data.stanleyNorthboundRamp.qaRoutes.northbound.reverseIdentity,
  },
  ...groundGates.map((g) => ({
    id: g.id,
    points: clippedSource(main, [center(g)]),
    forwardIdentity: g.id === 'prospect:north-ground' ? ground : upper,
    reverseIdentity: g.id === 'prospect:north-ground' ? upper : ground,
  })),
  {
    id: 'entire new Prospect upper source including both ordinary-ground seams and the actual slab',
    points: clippedSource(main, groundGates.map(center)),
    forwardIdentity: ground,
    reverseIdentity: ground,
  },
];
test('actual West bumper cap retains its source-owned body proof after the rear tyres leave the seam', () => {
  // Captured from the public reverse replay at 312.88m. Both tyre rectangles
  // are already on the original Causeway source, while a small West cap still
  // enters the rotating rear corner between the main source's edge/grid probes.
  const from = {
      position: [-1127.6760848605536, 58.57506869558065, -2667.637505653286],
      quaternion: [
        -0.0032958815591042504, 0.9486301251758107, 0.023225411800188576,
        0.31551640689572064,
      ],
    },
    to = {
      position: [-1127.6253106770255, 58.57902099373743, -2667.7062519840606],
      quaternion: [
        -0.003368152201982952, 0.9496075415004542, 0.023215041229432694,
        0.3125623690352424,
      ],
    },
    source = 'protected:1515:face:2';
  for (const pose of [from, to]) {
    const proof = world.support({
      pose,
      shape,
      maxDistance: 1.03,
      preferredSurfaceId: source,
      adhesion: false,
    });
    assert.equal(
      proof?.surfaceId,
      source,
      'all four current tyres still require actual main-road support',
    );
    assert.equal(world.identity(proof)?.surfaceId, 'lions:road');
  }
  assert.equal(
    world.sweep({ from, to, shape, ignoreSurfaceId: source }),
    null,
    'the complete rotating measured body clears the actual shared paving cap',
  );
  const fit = world.fitGround({
    pose: to,
    from,
    shape,
    preferredSurfaceId: source,
    maxAdjustmentM: 0.35,
  });
  assert.ok(
    fit,
    'route-aware fit must retain the same source-owned corner proof',
  );
  assert.ok(
    Math.hypot(
      ...fit.pose.position.map((value, axis) => value - to.position[axis]),
    ) < 0.01,
    'the proof uses the requested road pose, not a lateral reroute or artificial lift',
  );
  assert.ok(
    world.sweep({
      from,
      to,
      shape: { halfExtents: shape.halfExtents, clearance: shape.clearance },
      ignoreSurfaceId: source,
    }),
    'a hull without actual tyre/body metadata cannot inherit the ground-body permission',
  );
});
for (const route of routes)
  for (const reverse of [false, true]) {
    test(`actual public TeslaState: ${route.id}, ${reverse ? 'reverse' : 'forward'}`, () => {
      const result = replayTeslaSourceRoute(fixture, route, reverse);
      const { lionsContacts, ...summary } = result;
      assert.equal(result.completed, true, JSON.stringify(summary));
      assert.equal(result.collisions, 0);
      assert.equal(result.air, 0);
      assert.ok(result.floors.every((f) => f.allowedModes.includes('drive')));
      const allowed = new Set(['ground:0', 'park:prospect-overpass:2']);
      if (route.id.includes('West')) {
        allowed.delete('ground:0');
        allowed.add('lions:road:1');
        allowed.add('lions:west-upper:1');
      }
      if (route.id.includes('East')) {
        allowed.delete('ground:0');
        allowed.add('lions:road:1');
        allowed.add('lions:east-walk:1');
      }
      if (
        route.id.includes('South legal') ||
        route.id.includes('Northbound1693')
      ) {
        allowed.delete('park:prospect-overpass:2');
        allowed.add('lions:road:1');
        if (route.id.includes('Northbound1693'))
          allowed.add('lions:east-walk:1');
      }
      assert.ok(
        result.floors.length >= 2,
        'the actual source transition was crossed',
      );
      // The main road crosses the same physical plane as the legal East
      // driveway: its actual ramp contact retains lions:road/1 identity there.
      if (route.id.includes('entire new Prospect upper')) {
        allowed.add('lions:road:1');
        const junction = p.gates.find(
          (g) => g.id === 'prospect:east-exit-main-junction',
        );
        for (const contact of lionsContacts) {
          assert.equal(contact.routeId, 'prospect:east-exit');
          assert.ok(
            Math.hypot(
              contact.position[0] - junction.geometry.center[0],
              contact.position[2] - junction.geometry.center[1],
            ) <=
              junction.geometry.radius +
                Math.hypot(shape.halfExtents[0], shape.halfExtents[2]),
          );
        }
      }
      assert.ok(
        result.floors.every((f) => allowed.has(`${f.surfaceId}:${f.layer}`)),
        JSON.stringify(result.floors),
      );
      assert.ok(result.progress >= result.length - 5);
    });
  }
