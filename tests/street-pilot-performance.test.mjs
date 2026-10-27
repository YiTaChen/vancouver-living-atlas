import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { buildRoadGraph } = await import(cityModule('road-graph'));
const { CityPedestrians } = await import(
  cityModule('city-life/city-pedestrians')
);
const { createRuntimePerformanceDiagnostics } = await import(
  cityModule('runtime-performance')
);
const {
  STREET_SHOWCASE_BOUNDS,
  STREET_SHOWCASE_SEGMENTS,
  STREET_SHOWCASE_GLSL,
} = await import(cityModule('street-quality-profile'));

function makeCity(roads, clearGround = () => true) {
  const graph = buildRoadGraph(roads, { nodeIntersections: false });
  const paving = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 500),
    new THREE.MeshBasicMaterial(),
  );
  paving.rotation.x = -Math.PI / 2;
  paving.position.y = 1.18;
  paving.name = 'Clipped sidewalks performance-fixture';
  paving.userData.walkSurface = true;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  camera.position.set(0, 6, 0);
  camera.lookAt(0, 6, 150);
  const pavingRoot = new THREE.Group();
  pavingRoot.add(paving);
  const engine = {
    camera,
    roads: pavingRoot,
    scene: new THREE.Scene(),
    compatibleGraphics: false,
    settings: { quality: 'high', buildings: true, mode: 'orbit' },
    data: { roadGraph: graph },
    elevation: () => 0,
    detailedTrees: { trees: [] },
    navigation: { clearGround },
  };
  const city = new CityPedestrians(engine);
  city.renderer.load = async () => {};
  return {
    city,
    graph,
    engine,
    dispose() {
      city.dispose();
      paving.geometry.dispose();
      paving.material.dispose();
    },
  };
}

function street(i, z) {
  return {
    id: `street-${i}`,
    name: `Test Street ${i}`,
    roadClass: 'local',
    width: 8,
    corridorWidth: 12,
    level: 'ground',
    points: [
      [-40, z],
      [40, z],
    ],
  };
}

test('equal-distance windows retain edge/side order and rerank after camera movement', () => {
  const fixture = makeCity(
    [street(0, 50), street(1, 30), street(2, 60), street(3, 20)],
    () => false,
  );
  try {
    fixture.engine.camera.position.z = 40;
    fixture.engine.camera.lookAt(0, 6, 190);
    fixture.city.update(0.2);
    const keys = () => [...fixture.city.attempted.keys()];
    const edge0 = fixture.graph.edges[0].id;
    const edge3 = fixture.graph.edges[3].id;
    assert.deepEqual(keys(), [
      `footway:${edge0}:-1:run0`,
      `footway:${edge0}:1:run0`,
    ]);
    fixture.engine.camera.position.z = 21;
    fixture.engine.camera.lookAt(0, 6, 170);
    fixture.city.update(0.2);
    assert.deepEqual(keys().slice(2), [
      `footway:${edge3}:-1:run0`,
      `footway:${edge3}:1:run0`,
    ]);
  } finally {
    fixture.dispose();
  }
});

test('a full nearby route cache remains stable and still frees only unselected routes after travel', () => {
  let queries = 0;
  const fixture = makeCity(
    Array.from({ length: 44 }, (_, i) => street(i, (i - 22) * 5)),
    () => {
      queries++;
      return true;
    },
  );
  try {
    for (let i = 0; i < 45 && fixture.city.stats().routes < 64; i++)
      fixture.city.update(0.2);
    assert.equal(fixture.city.stats().routes, 64);
    assert.equal(fixture.city.stats().actorStates, 128);
    const oldRoutes = [...fixture.city.routes.keys()];
    const oldStates = new Map(fixture.city.walkers);
    const floorQueries = queries;
    for (let i = 0; i < 5; i++) fixture.city.update(0.2);
    assert.deepEqual([...fixture.city.routes.keys()], oldRoutes);
    assert.equal(
      queries,
      floorQueries,
      'a full nearby cache has no room for another proof',
    );
    for (const [id, state] of oldStates)
      assert.equal(fixture.city.walkers.get(id), state);
    const selected = fixture.city.selected.map((s) => s.actorId);
    fixture.engine.camera.position.z = 205;
    fixture.engine.camera.lookAt(0, 6, 350);
    fixture.city.update(0.2);
    const newRoutes = [...fixture.city.routes.keys()];
    assert.equal(newRoutes.length, 64);
    assert(
      newRoutes.some((id) => !oldRoutes.includes(id)),
      'travel makes room for another real route',
    );
    assert(
      oldRoutes.some((id) => !fixture.city.routes.has(id)),
      'a stale route is released',
    );
    for (const id of selected)
      assert.equal(fixture.city.walkers.get(id), oldStates.get(id));
    assert(fixture.city.stats().attemptedRoutes <= 256);
  } finally {
    fixture.dispose();
  }
});

test('opt-in subspans preserve actor behavior through quality changes and restore wrapper ownership', () => {
  const normal = makeCity([street(0, 0)]),
    traced = makeCity([street(0, 0)]);
  let now = 0;
  const diagnostics = createRuntimePerformanceDiagnostics({
    enabled: true,
    observerClass: null,
    performance: null,
    now: () => ++now,
  });
  const originalPrepare = traced.city.prepareNearby;
  const originalRenderer = traced.city.renderer.update;
  try {
    assert.equal(Object.hasOwn(normal.city, 'prepareNearby'), false);
    assert.equal(Object.hasOwn(normal.city.renderer, 'update'), false);
    diagnostics.wrap(traced.city, 'update', 'pedestrians');
    traced.city.installPerformanceDiagnostics(diagnostics);
    assert.notEqual(traced.city.prepareNearby, originalPrepare);
    assert.notEqual(traced.city.renderer.update, originalRenderer);
    for (const [i, quality] of ['high', 'balanced', 'high'].entries()) {
      normal.engine.settings.quality = quality;
      traced.engine.settings.quality = quality;
      diagnostics.beginFrame(i * 200, {
        visible: true,
        mode: 'orbit',
        quality,
      });
      normal.city.update(0.2);
      traced.city.update(0.2);
      diagnostics.endFrame();
      assert.deepEqual(traced.city.debugPoses(), normal.city.debugPoses());
      const spans = diagnostics.snapshot().frames[i].spans;
      assert.equal(spans.pedestrians.calls, 1);
      assert.equal(spans['pedestrian-prepare'].calls, 1);
      assert.equal(spans['pedestrian-renderer'].calls, 1);
    }
    diagnostics.dispose();
    assert.equal(traced.city.prepareNearby, originalPrepare);
    assert.equal(traced.city.renderer.update, originalRenderer);
    assert.equal(Object.hasOwn(traced.city, 'prepareNearby'), false);
    assert.equal(Object.hasOwn(traced.city.renderer, 'update'), false);
  } finally {
    diagnostics.dispose();
    normal.dispose();
    traced.dispose();
  }
});

// Float32 reference for the pre-existing GLSL segment operation. Tests include
// the actual rounded shader constants and points on both sides of each fade.
const f = Math.fround;
function segmentSquared(p, a, b) {
  const dx = f(b[0] - a[0]),
    dz = f(b[1] - a[1]);
  const x = f(p[0] - a[0]),
    z = f(p[1] - a[1]);
  const numerator = f(f(x * dx) + f(z * dz));
  const denominator = Math.max(f(f(dx * dx) + f(dz * dz)), f(0.000001));
  const t = Math.max(0, Math.min(1, f(numerator / denominator)));
  const rx = f(x - f(dx * t)),
    rz = f(z - f(dz * t));
  return f(f(rx * rx) + f(rz * rz));
}
function smoothWeight(distance) {
  const t = Math.max(0, Math.min(1, f(f(distance - 32) / f(85 - 32))));
  return f(1 - f(f(t * t) * f(3 - f(2 * t))));
}

test('one square root preserves the original float32 mask across fade bands, ties and bounds', () => {
  const segments = STREET_SHOWCASE_SEGMENTS.map((s) => ({
    a: s.a.map((v) => f(Number(v.toFixed(6)))),
    b: s.b.map((v) => f(Number(v.toFixed(6)))),
  }));
  assert.match(STREET_SHOWCASE_GLSL, /float d=sqrt\(min\(/);
  assert.match(STREET_SHOWCASE_GLSL, /return 1\.-smoothstep\(32\.0,85\.0,d\)/);
  const samples = [];
  let seed = 0x41676e74;
  for (let i = 0; i < 20000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x =
      STREET_SHOWCASE_BOUNDS.minX +
      ((STREET_SHOWCASE_BOUNDS.maxX - STREET_SHOWCASE_BOUNDS.minX) * seed) /
        0x100000000;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const z =
      STREET_SHOWCASE_BOUNDS.minZ +
      ((STREET_SHOWCASE_BOUNDS.maxZ - STREET_SHOWCASE_BOUNDS.minZ) * seed) /
        0x100000000;
    samples.push([f(x), f(z)]);
  }
  for (const s of segments) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length = Math.hypot(dx, dz);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1])
      for (const radius of [0, 31.999, 32, 32.001, 84.999, 85, 85.001])
        for (const sign of [-1, 1])
          samples.push([
            f(s.a[0] + fraction * dx - (sign * radius * dz) / length),
            f(s.a[1] + fraction * dz + (sign * radius * dx) / length),
          ]);
  }
  for (const point of samples) {
    const squared = segments.map((s) => segmentSquared(point, s.a, s.b));
    const previous = Math.min(...squared.map((v) => f(Math.sqrt(v))));
    const optimized = f(Math.sqrt(Math.min(...squared)));
    assert.equal(
      optimized,
      previous,
      `distance mismatch at ${point.join(',')}`,
    );
    assert.equal(
      smoothWeight(optimized),
      smoothWeight(previous),
      `fade mismatch at ${point.join(',')}`,
    );
  }
});
