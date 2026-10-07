import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { buildRoadGraph } = await import(cityModule('road-graph'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const {
  validatedSidewalkRoute,
  sampleSidewalkRoute,
  sidewalkStationWindow,
  SIDEWALK_MAX_WINDOWS_PER_EDGE,
  TrunkClearanceIndex,
} = await import(cityModule('city-life/sidewalk-route'));
const { CityPedestrians, nearbySidewalkMeshes } = await import(
  cityModule('city-life/city-pedestrians')
);

const graphFor = (overrides = {}) =>
  buildRoadGraph(
    [
      {
        id: 'source-footway',
        name: 'Test Street',
        roadClass: 'local',
        width: 8,
        corridorWidth: 12,
        level: 'ground',
        points: [
          [0, 0],
          [80, 0],
        ],
        ...overrides,
      },
    ],
    { nodeIntersections: false },
  );
function paving(x0 = 0, x1 = 80, z0 = -7, z1 = 7, slope = 0) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        x0,
        1.18 + x0 * slope,
        z0,
        x1,
        1.18 + x1 * slope,
        z0,
        x1,
        1.18 + x1 * slope,
        z1,
        x0,
        1.18 + x0 * slope,
        z0,
        x1,
        1.18 + x1 * slope,
        z1,
        x0,
        1.18 + x0 * slope,
        z1,
      ],
      3,
    ),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = 'Clipped sidewalks 0,0';
  mesh.userData.walkSurface = true;
  return mesh;
}
function floorProbe(meshes) {
  const index = new GroundSurfaceIndex(meshes);
  return (x, z) => {
    const y = index.sample(x, z, 1.18);
    return y === undefined ? undefined : { y, surfaceId: 'ground', layer: 0 };
  };
}
function disposePaving(meshes) {
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

test('sidewalk route requires the actual clipped paving through both endpoints and every sample', () => {
  const graph = graphFor();
  const meshes = [paving()];
  const route = validatedSidewalkRoute(
    graph,
    graph.edges[0],
    1,
    floorProbe(meshes),
  );
  assert.ok(route);
  assert.ok(route.points.length >= 81);
  assert.ok(Math.abs(route.points[0][0] - 10) < 1e-9);
  assert.ok(Math.abs(route.points.at(-1)[0] - 70) < 1e-9);
  assert.ok(
    route.points.every(
      (p) => Math.abs(p[2] - 5) < 1e-9 && Math.abs(p[1] - 1.195) < 1e-6,
    ),
  );
  assert.equal(
    validatedSidewalkRoute(graph, graph.edges[0], 1, () => undefined),
    null,
  );
  const clipped = [paving(0, 35), paving(36, 80)];
  assert.equal(
    validatedSidewalkRoute(graph, graph.edges[0], 1, floorProbe(clipped)),
    null,
    'one metre missing physical floor cannot use terrain fallback',
  );
  const missingStart = [paving(11, 80)];
  assert.equal(
    validatedSidewalkRoute(graph, graph.edges[0], 1, floorProbe(missingStart)),
    null,
  );
  disposePaving([...meshes, ...clipped, ...missingStart]);
});

test('sidewalk route rejects grade, wrong floor/layer, protected paving and protected source roads', () => {
  const graph = graphFor();
  const gentle = [paving(0, 80, -7, 7, 0.19)],
    steep = [paving(0, 80, -7, 7, 0.21)];
  // The index anchor follows this authored grade rather than pretending terrain is flat.
  const probeGrade = (meshes, slope) => {
    const index = new GroundSurfaceIndex(meshes);
    return (x, z) => {
      const y = index.sample(x, z, 1.18 + x * slope);
      return y === undefined ? undefined : { y, surfaceId: 'ground', layer: 0 };
    };
  };
  assert.ok(
    validatedSidewalkRoute(graph, graph.edges[0], 1, probeGrade(gentle, 0.19)),
  );
  assert.equal(
    validatedSidewalkRoute(graph, graph.edges[0], 1, probeGrade(steep, 0.21)),
    null,
  );
  for (const proof of [
    { y: 1.18, surfaceId: 'ground', layer: 1 },
    { y: 1.18, surfaceId: 'station', layer: 0 },
    { y: 1.18, surfaceId: 'ground', layer: 0, protectedSurface: true },
    { y: NaN, surfaceId: 'ground', layer: 0 },
  ])
    assert.equal(
      validatedSidewalkRoute(graph, graph.edges[0], 1, () => proof),
      null,
    );
  for (const overrides of [
    { name: 'Lions Gate Bridge' },
    { name: 'Stanley Park Causeway' },
    { level: 'upper' },
    { roadClass: 'private' },
    { roadClass: 'bikeway' },
  ]) {
    const protectedGraph = graphFor(overrides);
    let called = 0;
    assert.equal(
      validatedSidewalkRoute(protectedGraph, protectedGraph.edges[0], 1, () => {
        called++;
        return { y: 1.18, surfaceId: 'ground', layer: 0 };
      }),
      null,
    );
    assert.equal(called, 0);
  }
  disposePaving([...gentle, ...steep]);
});

test('out-and-back sampling returns along the same physical footway without an endpoint teleport', () => {
  const graph = graphFor();
  const mesh = paving();
  const route = validatedSidewalkRoute(
    graph,
    graph.edges[0],
    1,
    floorProbe([mesh]),
  );
  const half = route.lengthM / 2;
  const outbound = sampleSidewalkRoute(route, half / 2),
    inbound = sampleSidewalkRoute(route, half * 1.5);
  assert.deepEqual(outbound.position, inbound.position);
  assert.ok(
    Math.abs(inbound.yawRadians - outbound.yawRadians - Math.PI) < 1e-9,
  );
  for (const boundary of [half, route.lengthM]) {
    const before = sampleSidewalkRoute(route, boundary - 0.01).position;
    const after = sampleSidewalkRoute(route, boundary + 0.01).position;
    assert.ok(
      new THREE.Vector3(...before).distanceTo(new THREE.Vector3(...after)) <
        1e-9,
    );
  }
  assert.ok(
    new THREE.Vector3(...sampleSidewalkRoute(route, -0.2).position).distanceTo(
      new THREE.Vector3(
        ...sampleSidewalkRoute(route, route.lengthM - 0.2).position,
      ),
    ) < 1e-9,
  );
  assert.throws(
    () => sampleSidewalkRoute(route, NaN),
    /Invalid sidewalk station/,
  );
  disposePaving([mesh]);
});

test('nearby floor indexing excludes upper/protected/hidden/clipped and remote meshes', () => {
  const root = new THREE.Group(),
    ground = paving(),
    protectedMesh = paving(),
    upper = paving(),
    hidden = paving(),
    clipped = paving(),
    remote = paving(5000, 5080);
  protectedMesh.userData.protectedSurface = true;
  upper.userData.layer = 1;
  hidden.visible = false;
  clipped.geometry.setDrawRange(0, 0);
  root.add(ground, protectedMesh, upper, hidden, clipped, remote);
  assert.deepEqual(nearbySidewalkMeshes(root, 0, 0), [ground]);
  ground.userData.surfaceId = 'underground';
  assert.deepEqual(nearbySidewalkMeshes(root, 0, 0), []);
  ground.userData.surfaceId = 'ground';
  root.visible = false;
  assert.deepEqual(nearbySidewalkMeshes(root, 0, 0), []);
  disposePaving([ground, protectedMesh, upper, hidden, clipped, remote]);
});

function fakeEngine(graph, meshes) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  camera.position.set(40, 6, 25);
  camera.lookAt(40, 6, 50); // Streets are behind the camera: safe initial births.
  const roads = new THREE.Group();
  roads.add(...meshes);
  let floorQueries = 0;
  const engine = {
    camera,
    roads,
    scene: new THREE.Scene(),
    compatibleGraphics: false,
    settings: { quality: 'high', buildings: true, mode: 'orbit' },
    data: { roadGraph: graph },
    elevation: () => 0,
    navigation: {
      clearGround: () => {
        floorQueries++;
        return true;
      },
    },
  };
  return { engine, floorQueries: () => floorQueries };
}

test('city consumer preserves visible identities across quality changes and adds no population work in a city view', () => {
  const graph = graphFor(),
    mesh = paving(),
    { engine, floorQueries } = fakeEngine(graph, [mesh]);
  const city = new CityPedestrians(engine);
  let loads = 0;
  city.renderer.load = async () => {
    loads++;
  }; // CPU fixture never downloads assets.
  city.update(0.2);
  const first = city.stats();
  assert.equal(first.selected, 4);
  assert.equal(first.rendered, 4);
  assert.equal(first.floorIndexedMeshes, 1);
  assert.equal(first.nearbyCandidates, 4);
  assert.equal(first.safeNearbyCandidates, 4);
  assert.ok(first.closestCandidateM > 0 && first.closestCandidateM < 100);
  assert.ok(first.renderer.populatedBatches <= 8);
  const observed = city.debugPoses();
  assert.equal(observed.length, 4);
  assert.ok(
    observed.every(
      (p) =>
        p.surfaceId === 'ground' &&
        p.layer === 0 &&
        p.rendered &&
        p.movementHz === 2,
    ),
  );
  observed[0].position[0] = 999999;
  assert.notEqual(
    city.debugPoses()[0].position[0],
    999999,
    'QA pose copies cannot mutate population',
  );
  engine.camera.lookAt(40, 1.18, 0);
  engine.settings.quality = 'balanced';
  city.update(0.2);
  assert.equal(
    city.stats().selected,
    4,
    'onscreen existing identities are not treated as new unsafe births',
  );
  assert.equal(city.stats().budget, 24);
  for (const side of [-1, 1])
    for (const seed of [0, 1])
      assert.ok(
        city.renderer.actorSlot(
          `footway:${graph.edges[0].id}:${side}:run0:${seed}`,
        ),
      );
  const beforeFarQueries = floorQueries(),
    beforeFarLoads = loads;
  engine.camera.position.y = 600;
  city.update(0.2);
  for (let i = 0; i < 50; i++) city.update(0.05);
  const far = city.stats();
  assert.equal(far.selected, 0);
  assert.equal(far.rendered, 0);
  assert.equal(far.renderer.populatedBatches, 0);
  assert.equal(far.closestCandidateM, null);
  assert.equal(far.safeNearbyCandidates, 0);
  assert.deepEqual(far.renderedIds, []);
  assert.deepEqual(city.debugPoses(), []);
  assert.equal(floorQueries(), beforeFarQueries);
  assert.equal(loads, beforeFarLoads);
  assert.equal(far.actorStates, first.actorStates);
  city.dispose();
  assert.equal(city.stats().floorIndexedMeshes, 0);
  disposePaving([mesh]);
});

test('cold high-altitude city consumer does not construct any floor index, actors or template request', () => {
  const graph = graphFor(),
    mesh = paving(),
    { engine, floorQueries } = fakeEngine(graph, [mesh]);
  engine.camera.position.y = 600;
  const city = new CityPedestrians(engine);
  let loads = 0;
  city.renderer.load = async () => {
    loads++;
  };
  for (let i = 0; i < 100; i++) city.update(0.05);
  const stats = city.stats();
  assert.equal(stats.floorIndexedMeshes, 0);
  assert.equal(stats.actorStates, 0);
  assert.equal(stats.routes, 0);
  assert.equal(stats.selected, 0);
  assert.equal(stats.rendered, 0);
  assert.equal(loads, 0);
  assert.equal(floorQueries(), 0);
  city.dispose();
  disposePaving([mesh]);
});

test('fixed-step background movement interpolates small visible steps and discards hidden-tab time', () => {
  const graph = graphFor(),
    mesh = paving(),
    { engine } = fakeEngine(graph, [mesh]);
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  city.update(0.2);
  const id = `footway:${graph.edges[0].id}:-1:run0:0`;
  const position = () => {
    const slot = city.renderer.actorSlot(id);
    assert.ok(slot);
    const [variant, lod] = slot.key.split(':');
    const batch = city.renderer.group.children.find(
      (m) => m.name === `City life / ${variant} / LOD${lod}`,
    );
    const matrix = new THREE.Matrix4();
    batch.getMatrixAt(slot.slot, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  };
  const initial = position();
  let previous = initial;
  for (let i = 0; i < 300; i++) {
    city.update(0.01);
    const next = position();
    assert.ok(
      next.distanceTo(previous) <= 0.012,
      '2Hz actor simulation must not become half-metre render jumps',
    );
    previous = next;
  }
  assert.ok(previous.distanceTo(initial) > 2);
  city.setHidden(true);
  city.update(30);
  assert.ok(position().distanceTo(previous) < 1e-10);
  city.setHidden(false);
  city.update(0.01);
  assert.ok(position().distanceTo(previous) < 0.012);
  city.dispose();
  disposePaving([mesh]);
});

test('travelling across many neighborhoods keeps one actor/render budget and a bounded local floor index', () => {
  const inputs = Array.from({ length: 60 }, (_, i) => ({
    id: `street-${i}`,
    name: `Test Street ${i}`,
    roadClass: 'local',
    width: 8,
    corridorWidth: 12,
    level: 'ground',
    points: [
      [i * 200, 0],
      [i * 200 + 80, 0],
    ],
  }));
  const graph = buildRoadGraph(inputs, { nodeIntersections: false });
  const meshes = inputs.map((_, i) => paving(i * 200, i * 200 + 80));
  const { engine } = fakeEngine(graph, meshes);
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  for (let i = 0; i < 60; i++) {
    engine.camera.position.x = i * 200 + 40;
    engine.camera.lookAt(engine.camera.position.x, 6, 50);
    city.update(0.2);
    city.update(0.2);
    const stats = city.stats();
    assert.ok(stats.selected <= 32 && stats.rendered <= 32);
    assert.ok(stats.routes <= 64 && stats.actorStates <= 128);
    assert.ok(stats.attemptedRoutes <= 256);
    assert.ok(
      stats.floorIndexedMeshes <= 7,
      'a local index must not copy all sixty city meshes',
    );
    assert.equal(stats.renderer.allocatedBatches, 8);
    assert.ok(stats.renderer.populatedBatches <= 8);
  }
  city.dispose();
  disposePaving(meshes);
});

test('source-tree clearance checks continuous segments and tries only parallel routes with real body-width paving', () => {
  const graph = graphFor(),
    mesh = paving();
  const trees = new TrunkClearanceIndex([{ x: 30.375, z: 5.9 }]);
  assert.equal(
    trees.clearSegment([30, 1.18, 5], [30.75, 1.18, 5]),
    false,
    'trunk between floor samples must still block .6m trunk + .35m arms',
  );
  assert.equal(trees.clearSegment([NaN, 0, 0], [1, 0, 0]), false);
  const options = (offsetFromCurbM) => ({
    offsetFromCurbM,
    clearSegment: (a, b) => trees.clearSegment(a, b),
  });
  assert.equal(
    validatedSidewalkRoute(
      graph,
      graph.edges[0],
      1,
      floorProbe([mesh]),
      options(1),
    ),
    null,
  );
  const inner = validatedSidewalkRoute(
    graph,
    graph.edges[0],
    1,
    floorProbe([mesh]),
    options(0.55),
  );
  assert.ok(inner);
  assert.ok(inner.points.every((p) => Math.abs(p[2] - 4.55) < 1e-9));
  assert.ok(
    inner.points.every((p) => p[2] - 0.35 > graph.edges[0].width / 2),
    'arms remain off the carriageway',
  );
  assert.equal(
    validatedSidewalkRoute(
      graph,
      graph.edges[0],
      1,
      floorProbe([mesh]),
      options(1.45),
    ),
    null,
  );
  const narrow = paving(0, 80, 4.5, 4.6);
  assert.equal(
    validatedSidewalkRoute(
      graph,
      graph.edges[0],
      1,
      floorProbe([narrow]),
      options(0.55),
    ),
    null,
    'a centre on paving is insufficient when arms fall outside it',
  );
  disposePaving([mesh, narrow]);
});

test('city route validation uses existing world tree data once and leaves blocked footways empty', () => {
  const graph = graphFor(),
    mesh = paving(),
    { engine } = fakeEngine(graph, [mesh]);
  engine.detailedTrees = {
    trees: [
      { x: 30, z: 4.55 },
      { x: 30, z: 5 },
      { x: 30, z: 5.45 },
    ],
  };
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  city.update(0.2);
  assert.equal(city.stats().indexedTreeTrunks, 3);
  assert.equal(
    city.stats().routes,
    1,
    'positive-side routes cannot pass through any trunk or step onto the road',
  );
  assert.ok(city.debugPoses().every((pose) => pose.position[2] < 0));
  engine.camera.position.y = 600;
  city.update(0.2);
  assert.equal(city.stats().selected, 0);
  assert.equal(
    city.stats().indexedTreeTrunks,
    3,
    'far view reuses bounded static metadata without per-frame global scanning',
  );
  city.dispose();
  disposePaving([mesh]);
});

test('fixed source windows cover long-edge interiors and preserve junction trims and floor/tree proofs', () => {
  const graph = graphFor({
      points: [
        [0, 0],
        [2000, 0],
      ],
    }),
    edge = graph.edges[0],
    mesh = paving(900, 1100);
  const first = sidewalkStationWindow(graph, edge, 0),
    middle = sidewalkStationWindow(graph, edge, 12),
    last = sidewalkStationWindow(graph, edge, 24);
  assert.equal(first.startM, 10);
  assert.equal(first.endM, 90);
  assert.equal(middle.startM, 970);
  assert.equal(middle.endM, 1050);
  assert.equal(last.endM, 1990);
  assert.equal(sidewalkStationWindow(graph, edge, 25), null);
  for (const index of [-1, 0.5, NaN, Infinity, SIDEWALK_MAX_WINDOWS_PER_EDGE])
    assert.equal(sidewalkStationWindow(graph, edge, index), null);
  const route = validatedSidewalkRoute(graph, edge, 1, floorProbe([mesh]), {
    windowIndex: 12,
  });
  assert.ok(route);
  assert.equal(route.routeId, `footway:${edge.id}:1:run12`);
  assert.equal(route.sourceStartM, 970);
  assert.equal(route.sourceEndM, 1050);
  assert.equal(route.points[0][0], 970);
  assert.equal(route.points.at(-1)[0], 1050);
  assert.equal(
    validatedSidewalkRoute(graph, edge, 1, floorProbe([mesh])),
    null,
    'missing source-end floor does not prevent proving a separate middle window',
  );
  const trees = new TrunkClearanceIndex([{ x: 1000.375, z: 5 }]);
  assert.equal(
    validatedSidewalkRoute(graph, edge, 1, floorProbe([mesh]), {
      windowIndex: 12,
      clearSegment: (a, b) => trees.clearSegment(a, b),
    }),
    null,
    'middle windows still reject a trunk between physical floor samples',
  );
  const gap = [paving(900, 1000), paving(1001, 1100)];
  assert.equal(
    validatedSidewalkRoute(graph, edge, 1, floorProbe(gap), {
      windowIndex: 12,
    }),
    null,
    'middle windows retain clipped-floor refusal',
  );
  const oversized = graphFor({
    points: [
      [0, 0],
      [1e9, 0],
    ],
  });
  assert.equal(sidewalkStationWindow(oversized, oversized.edges[0], 0), null);
  disposePaving([mesh, ...gap]);
});

test('cold long-edge midpoint selects its fixed nearest segment window before a closer source-node distractor', () => {
  const graph = buildRoadGraph(
    [
      {
        id: 'distractor',
        name: 'Other Street',
        roadClass: 'local',
        width: 8,
        corridorWidth: 12,
        level: 'ground',
        points: [
          [980, 125],
          [1060, 125],
        ],
      },
      {
        id: 'long',
        name: 'Long Street',
        roadClass: 'local',
        width: 8,
        corridorWidth: 12,
        level: 'ground',
        points: [
          [0, 0],
          [2000, 0],
        ],
      },
    ],
    { nodeIntersections: false },
  );
  const edge = graph.edges.find((e) => e.sourceIds.includes('long')),
    mesh = paving(900, 1100),
    { engine } = fakeEngine(graph, [mesh]);
  engine.compatibleGraphics = true;
  engine.camera.position.x = 1000;
  engine.camera.lookAt(1000, 6, 50);
  const city = new CityPedestrians(engine);
  let loads = 0;
  city.renderer.load = async () => {
    loads++;
  };
  city.update(0.2);
  const stats = city.stats(),
    observed = city.debugPoses();
  assert.equal(
    stats.attemptedRoutes,
    2,
    'cold selection stays at two validations',
  );
  assert.equal(stats.routes, 2);
  assert.equal(stats.selected, 4);
  assert.equal(stats.nearbyCandidates, 4);
  assert.equal(stats.safeNearbyCandidates, 4);
  assert.ok(stats.closestCandidateM < 60);
  assert.ok(loads > 0, 'nearby safe actors can request shared model resources');
  assert.ok(observed.every((p) => p.routeId.startsWith(`footway:${edge.id}:`)));
  assert.ok(
    observed.every((p) => p.sourceWindow === 12 && p.sourceStartM === 970),
  );
  assert.ok(
    observed.every((p) => p.position[0] >= 970 && p.position[0] <= 1050),
  );
  city.dispose();
  disposePaving([mesh]);
});

test('camera travel changes source windows without moving existing route identities or exceeding the union budget', () => {
  const graph = graphFor({
      points: [
        [0, 0],
        [2000, 0],
      ],
    }),
    mesh = paving(0, 2000),
    { engine } = fakeEngine(graph, [mesh]);
  engine.camera.position.x = 1000;
  engine.camera.lookAt(1000, 6, 50);
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  city.update(0.2);
  const initial = city.debugPoses();
  assert.equal(initial.length, 4);
  engine.camera.position.x = 1010;
  engine.camera.lookAt(1010, 6, 50);
  city.update(0.2);
  for (const before of initial) {
    const after = city.debugPoses().find((p) => p.actorId === before.actorId);
    assert.ok(after, 'nearby identities remain selected as the camera moves');
    assert.equal(after.sourceWindow, before.sourceWindow);
    assert.equal(after.sourceStartM, before.sourceStartM);
    assert.equal(after.sourceEndM, before.sourceEndM);
    assert.ok(
      new THREE.Vector3(...after.position).distanceTo(
        new THREE.Vector3(...before.position),
      ) < 0.4,
      'camera displacement is not applied to a fixed actor route',
    );
  }
  for (let x = 1200; x <= 1800; x += 100) {
    engine.camera.position.x = x;
    engine.camera.lookAt(x, 6, 50);
    city.update(0.2);
    const stats = city.stats();
    assert.ok(stats.nearbyCandidates > 0 && stats.closestCandidateM < 60);
    assert.ok(stats.selected <= 32 && stats.rendered <= 32);
    assert.ok(stats.routes <= 64 && stats.actorStates <= 128);
    assert.ok(stats.attemptedRoutes <= 256);
    assert.ok(
      city
        .debugPoses()
        .every((p) => p.sourceStartM >= 10 && p.sourceEndM <= 1990),
    );
  }
  const latestRendered = city.debugPoses().filter((p) => p.rendered);
  assert.ok(latestRendered.length > 0);
  assert.ok(latestRendered.every((p) => p.sourceWindow > 12));
  city.dispose();
  disposePaving([mesh]);
});

test('diagonal source-segment cell coverage finds a midpoint far from both source nodes', () => {
  const graph = graphFor({
      points: [
        [0, 0],
        [2000, 2000],
      ],
    }),
    mesh = paving(0, Math.hypot(2000, 2000)),
    { engine } = fakeEngine(graph, [mesh]);
  mesh.rotation.y = -Math.PI / 4;
  const normal = 1 / Math.sqrt(2);
  engine.camera.position.set(1000 - 25 * normal, 6, 1000 + 25 * normal);
  engine.camera.lookAt(
    engine.camera.position.x - 100,
    6,
    engine.camera.position.z + 100,
  );
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  city.update(0.2);
  assert.equal(city.stats().attemptedRoutes, 2);
  assert.equal(city.stats().routes, 2);
  assert.ok(city.stats().nearbyCandidates > 0);
  assert.ok(city.stats().safeNearbyCandidates > 0);
  assert.ok(city.stats().selected > 0);
  assert.ok(city.stats().closestCandidateM < 60);
  assert.ok(city.debugPoses().every((p) => p.sourceWindow === 17));
  city.dispose();
  disposePaving([mesh]);
});

test('crossing a floor-index cell retries an incomplete window proof and preserves already proven identities', () => {
  const graph = graphFor({
      points: [
        [690, 0],
        [930, 0],
      ],
    }),
    edge = graph.edges[0],
    meshes = Array.from({ length: 24 }, (_, i) =>
      paving(690 + i * 10, 700 + i * 10),
    ),
    { engine } = fakeEngine(graph, meshes);
  engine.camera.position.x = 599;
  engine.camera.lookAt(599, 6, 50);
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  for (let i = 0; i < 3; i++) city.update(0.2);
  assert.equal(city.stats().routes, 2);
  assert.equal(city.stats().attemptedRoutes, 4);
  assert.ok(city.stats().floorIndexedMeshes < meshes.length);
  const validId = `footway:${edge.id}:-1:run0`,
    partialId = `footway:${edge.id}:-1:run1`,
    provenRoute = city.routes.get(validId),
    provenActor = city.walkers.get(`${validId}:0`).actor;
  assert.ok(provenRoute);
  assert.equal(city.routes.has(partialId), false);
  engine.camera.position.x = 820;
  engine.camera.lookAt(820, 6, 50);
  city.update(0.2);
  const stats = city.stats();
  assert.equal(stats.floorIndexedMeshes, meshes.length);
  assert.equal(stats.routes, 4);
  assert.equal(city.routes.get(validId), provenRoute);
  assert.equal(city.walkers.get(`${validId}:0`).actor, provenActor);
  assert.ok(city.routes.has(partialId));
  assert.ok(city.routes.has(`footway:${edge.id}:1:run1`));
  assert.ok(stats.closestCandidateM < 40);
  assert.ok(stats.nearbyCandidates > 0 && stats.selected > 0);
  assert.ok(city.debugPoses().some((p) => p.sourceWindow === 1 && p.rendered));
  city.dispose();
  disposePaving(meshes);
});
