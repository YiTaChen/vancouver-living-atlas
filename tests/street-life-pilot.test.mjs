import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { buildRoadGraph } = await import(cityModule('road-graph'));
const { project } = await import(cityModule('geo'));
const { validatedSidewalkRoute, validatedSidewalkRuns, sampleSidewalkRoute,
  TrunkClearanceIndex } = await import(cityModule('city-life/sidewalk-route'));
const { CityPedestrians, sidewalkBirthStation } = await import(cityModule('city-life/city-pedestrians'));

const graphAt = (x = 0, z = 0) => buildRoadGraph([{
  id: 'source-sidewalk', name: 'Robson St', roadClass: 'local', width: 8,
  corridorWidth: 12, level: 'ground', points: [[x - 50, z], [x + 50, z]],
}], { nodeIntersections: false });
const floor = () => ({ y: 1.18, surfaceId: 'ground', layer: 0 });

test('pilot proof fragments reunite a complete sidewalk with stable source identity', () => {
  const graph = graphAt(50), edge = graph.edges[0];
  const routes = validatedSidewalkRuns(graph, edge, 1, floor);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeId, `footway:${edge.id}:1:run0`);
  assert.equal(routes[0].sourceStartM, 10);
  assert.equal(routes[0].sourceEndM, 90);
  assert.equal(routes[0].lengthM, 160);
  assert(routes[0].points.every((p) => p[0] >= 10 && p[0] <= 90 && p[2] === 5));
  assert.deepEqual(validatedSidewalkRuns(graph, edge, 1, floor), routes,
    'source windows do not depend on the camera');
});

test('pilot proof keeps separate real floor runs without bridging a clipped gap or a trunk', () => {
  const graph = graphAt(50), edge = graph.edges[0];
  const gap = (x) => x >= 40 && x <= 49 ? undefined : floor();
  assert.equal(validatedSidewalkRoute(graph, edge, 1, gap), null,
    'the legacy all-window contract still rejects incomplete floor');
  const routes = validatedSidewalkRuns(graph, edge, 1, gap);
  assert.deepEqual(routes.map((r) => [r.sourceStartM, r.sourceEndM]), [[10, 30], [50, 90]]);
  for (const route of routes) {
    for (let station = 0; station < route.lengthM; station += 0.25) {
      const [x, , z] = sampleSidewalkRoute(route, station).position;
      assert(!(x >= 40 && x <= 49));
      assert(z - 0.35 > edge.width / 2, 'the full body stays on the footway');
    }
  }
  const trees = new TrunkClearanceIndex([{ x: 50, z: 5 }]);
  const safe = validatedSidewalkRuns(graph, edge, 1, floor, {
    clearSegment: (a, b) => trees.clearSegment(a, b),
  });
  assert(safe.length > 0);
  for (const route of safe)
    for (let i = 1; i < route.points.length; i++)
      assert(trees.clearSegment(route.points[i - 1], route.points[i]));
  for (const proof of [undefined, { y: 1.18, surfaceId: 'upper', layer: 0 },
    { y: 1.18, surfaceId: 'ground', layer: 1 },
    { y: 1.18, surfaceId: 'ground', layer: 0, protectedSurface: true }])
    assert.deepEqual(validatedSidewalkRuns(graph, edge, 1, () => proof), []);
});

test('one-time near births use only offscreen physical route stations with body separation', () => {
  const graph = graphAt(50), route = validatedSidewalkRoute(graph, graph.edges[0], 1, floor);
  const center = [40, 3, 5], visible = (p) => p[0] >= 40;
  const first = sidewalkBirthStation(route, 0, center, visible);
  assert.notEqual(first, null);
  const a = sampleSidewalkRoute(route, first).position;
  assert(a[0] < 40);
  assert(Math.hypot(...a.map((n, i) => n - center[i])) >= 6);
  assert(Math.hypot(...a.map((n, i) => n - center[i])) < 15);
  const second = sidewalkBirthStation(route, 1, center, visible, [a]);
  const b = sampleSidewalkRoute(route, second).position;
  assert(b[0] < 40);
  assert(Math.hypot(...a.map((n, i) => n - b[i])) >= 2.4);
  assert.equal(sidewalkBirthStation(route, 0, center, () => true), null,
    'an entirely visible path receives no safe birth position');
});

function consumerAt(x, z) {
  const graph = graphAt(x, z);
  const pavement = new THREE.Mesh(new THREE.PlaneGeometry(100, 14), new THREE.MeshBasicMaterial());
  pavement.rotation.x = -Math.PI / 2;
  pavement.position.set(x, 1.18, z);
  pavement.name = 'Clipped sidewalks pilot-fixture';
  pavement.userData.walkSurface = true;
  const roads = new THREE.Group(); roads.add(pavement);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  camera.position.set(x, 6, z + 25); camera.lookAt(x, 6, z + 50);
  let queries = 0;
  const engine = {
    camera, roads, scene: new THREE.Scene(), compatibleGraphics: false,
    settings: { quality: 'high', buildings: true, mode: 'orbit' },
    data: { roadGraph: graph }, elevation: () => 0,
    detailedTrees: { trees: [{ x, z: z - 5 }, { x, z: z + 5 }] },
    navigation: { clearGround: () => { queries++; return true; } },
  };
  const city = new CityPedestrians(engine); city.renderer.load = async () => {};
  return { city, engine, queries: () => queries, dispose() {
    city.dispose(); pavement.geometry.dispose(); pavement.material.dispose();
  } };
}

test('Robson pilot recovers valid nearby sidewalks within existing global budgets; outside uses original proof', () => {
  const [x, z] = project([-123.1228089, 49.2832957]);
  const pilot = consumerAt(x, z), outside = consumerAt(0, 0);
  try {
    pilot.city.update(0.2); outside.city.update(0.2);
    const stats = pilot.city.stats();
    assert.equal(stats.attemptedRoutes, 2, 'one activation still probes only two source sides');
    assert.equal(stats.routes, 4, 'two separated safe portions on each footway survive');
    assert.equal(stats.selected, 8);
    assert(stats.closestCandidateM < 35);
    assert(stats.rendered <= 32 && stats.actorStates <= 128);
    assert(pilot.queries() <= 2000, 'fixed fragments and offsets bound floor work');
    assert.equal(outside.city.stats().routes, 0, 'outside the pilot a blocked full window remains unchanged');
    const initial = pilot.city.debugPoses();
    pilot.engine.camera.position.x += 2;
    pilot.engine.camera.lookAt(x + 2, 6, z + 50);
    pilot.city.update(0.2);
    for (const before of initial) {
      const after = pilot.city.debugPoses().find((p) => p.actorId === before.actorId);
      assert(after);
      assert.equal(after.sourceStartM, before.sourceStartM);
      assert.equal(after.sourceEndM, before.sourceEndM);
      assert(new THREE.Vector3(...after.position).distanceTo(new THREE.Vector3(...before.position)) < 0.4);
    }
  } finally { pilot.dispose(); outside.dispose(); }
});
