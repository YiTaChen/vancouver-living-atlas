import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  close,
  assertPlacement,
  assertFiniteGroup,
  geometryDigest,
  disposeGroup,
  assertLOD,
} from './helpers/landmark-test-utils.mjs';
const { createLandmarkGroundSampler, landmarkLocalXZ } = await import(
  cityModule('landmark-ground')
);
const { resolveLandmarkGroundPlan } = await import(
  cityModule('resolve-landmark-plan')
);
const { createResolvedLandmark } = await import(
  cityModule('landmark-resolved-factory')
);
const { MARINE_ENTRY_CONTRACT, marineEntryPoint } = await import(
  cityModule('assets/marine-entry')
);
const { LandmarkDetail } = await import(cityModule('landmark-detail'));
const placements = {
  marine: { lon: -123.117146, lat: 49.287449, yaw: 0.77, baseY: 14.22 },
  science: { lon: -123.1039114, lat: 49.2733499, yaw: 0, baseY: 3.4 },
  canada: { lon: -123.111352, lat: 49.2886214, yaw: -1.073, baseY: 3.5 },
};
// Controlled actual-surface fixtures, not claims of a surveyed flat forecourt.
const plans = ['marine', 'science', 'canada'].map((kind) => {
  const result = resolveLandmarkGroundPlan(
    kind,
    () => (kind === 'marine' ? 16 : 4.2),
    'test-flat-selected-surface',
  );
  assert.equal(result.status, 'ready');
  return result.plan;
});
const plan = (kind) => plans.find((p) => p.kind === kind);
const marineRing = [
  [32.9118, -1.5642],
  [36.1335, 4.4905],
  [41.6661, 14.8483],
  [36.4917, 14.8857],
  [14.3355, 15.0481],
  [-12.5488, 15.2466],
  [-14.6768, 15.261],
  [-24.6089, -12.0469],
  [-13.7349, -16.5436],
  [-7.7538, -18.9776],
  [17.9156, -29.6578],
].map(([x, z]) => [x * 0.975, z * 0.975]);
const scienceAnnex = [
  [25, -29],
  [36, -48],
  [46, -44],
  [56, -29],
  [63, -11],
  [65, 8],
  [60, 23],
  [31, 14],
];
const canadaDeck = [
  [-46, -96],
  [-46, 230],
  [-12, 212],
  [41, 173],
  [61, 157],
  [39, 124],
  [39, -273],
  [34, -282],
  [24, -282],
  [18, -275],
];
function triangle(y, protectedSurface = false) {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, y, 0, 0, y, 10, 10, y, 0], 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.walkSurface = true;
  mesh.userData.protectedSurface = protectedSurface;
  return mesh;
}
test('city test loader normalizes nested asset and parent paths', () => {
  assert.equal(cityModule('assets/../geo'), cityModule('geo'));
  assert.equal(
    cityModule('./assets/marine-entry.ts'),
    cityModule('assets/marine-entry'),
  );
  assert.equal(typeof MARINE_ENTRY_CONTRACT, 'object');
});
test('landmark ground sampler retains transformed slopes and excludes nearby protected floors/water', () => {
  const root = new THREE.Group(),
    ground = triangle(2),
    bridge = triangle(4, true),
    water = triangle(3);
  water.userData.walkSurface = false;
  ground.geometry.getAttribute('position').setY(2, 3);
  root.add(ground, bridge, water);
  root.position.set(100, 0, 200);
  root.rotation.y = 0.6;
  root.updateMatrixWorld(true);
  const world = new THREE.Vector3(2, 0, 2).applyMatrix4(root.matrixWorld);
  const index = createLandmarkGroundSampler(
    [root, root],
    [{ x: world.x, z: world.z, radius: 8 }],
    () => 2,
  );
  close(index.sample(world.x, world.z), 2.2, 1e-8);
  assert.equal(index.sourceMeshes, 1);
  assert.equal(index.triangles, 1);
  assert.equal(index.sample(world.x + 100, world.z), undefined);
  const expected = new THREE.Vector3(12, 0, -8)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.77)
    .add(new THREE.Vector3(799, 0, -151));
  const actual = landmarkLocalXZ([799, -151], 0.77, 12, -8);
  close(actual[0], expected.x, 1e-12);
  close(actual[1], expected.z, 1e-12);
  disposeGroup(root);
});
test('ground plans require actual finite surfaces; fixed Canada pier never samples water', () => {
  for (const kind of ['marine', 'science'])
    for (const value of [undefined, NaN, Infinity])
      assert.equal(
        resolveLandmarkGroundPlan(kind, () => value, 'test').status,
        'unavailable',
      );
  assert.equal(
    resolveLandmarkGroundPlan('marine', () => 16, '').status,
    'unavailable',
  );
  const canada = resolveLandmarkGroundPlan(
    'canada',
    () => {
      throw new Error('must not sample water');
    },
    'test',
  );
  assert.equal(canada.status, 'ready');
  assert.deepEqual(canada.plan.placement, placements.canada);
  assert.equal(canada.plan.deckTopY, 1.3);
  close(plan('marine').thresholdY, 1.795, 1e-12);
  assert.equal(plan('marine').approachSamples.length, 3);
  assert.equal(plan('science').thresholdY, 1.02);
  assert.equal(plan('science').canopySoffitY, 4.15);
  assert.equal(plan('science').footings.length, 6);
  for (const footing of plan('science').footings)
    close(footing.surfaceY, 0.8, 1e-12);
});
test('Stage7 DTOs preserve verified model anchors, solid footprints and roof heights', () => {
  for (const p of plans)
    for (const detail of [false, true]) {
      const g = createResolvedLandmark(detail, structuredClone(p)),
        box = assertFiniteGroup(g);
      assertPlacement(g, placements[p.kind]);
      const footprints = g.userData.solidFootprints;
      if (p.kind === 'marine') {
        assert.deepEqual(footprints, [[...marineRing, marineRing[0]]]);
        close(box.max.y, 98);
        close(g.userData.thresholdY, 1.795, 1e-12);
      }
      if (p.kind === 'science') {
        assert.equal(footprints.length, 2);
        assert.equal(footprints[0].length, 49);
        for (const [x, z] of footprints[0])
          close(Math.hypot(x, z), 37.4, 1e-10);
        assert.deepEqual(footprints[1], [...scienceAnnex, scienceAnnex[0]]);
        close(box.max.y, detail ? 48.421958923339844 : 48.21291732788086);
        assert.equal(g.userData.entrance.thresholdY, 1.02);
        assert.equal(g.userData.entrance.footings.length, 4);
        for (const f of g.userData.entrance.footings)
          close(f.baseY, 0.815, 1e-10);
      }
      if (p.kind === 'canada') {
        assert.deepEqual(footprints, [[...canadaDeck, canadaDeck[0]]]);
        close(box.max.y, 81.44200134277344);
        close(box.min.z, -282.4200134277344);
        close(box.max.z, 230.4199981689453);
      }
      assert.equal(
        g.userData.nightMaterials.length,
        p.kind === 'marine' ? 2 : p.kind === 'science' ? 4 : detail ? 6 : 5,
      );
      disposeGroup(g);
    }
});
test('resolved factory rejects incomplete/moved DTOs instead of inventing a fallback', () => {
  const incomplete = structuredClone(plan('science'));
  incomplete.footings.pop();
  assert.throws(() => createResolvedLandmark(false, incomplete), /Incomplete/);
  const duplicate = structuredClone(plan('science'));
  duplicate.footings[1] = duplicate.footings[0];
  assert.throws(() => createResolvedLandmark(false, duplicate), /Duplicate/);
  const missing = structuredClone(plan('science'));
  delete missing.thresholdY;
  assert.throws(() => createResolvedLandmark(false, missing), /height plan/);
  const moved = structuredClone(plan('marine'));
  moved.placement.yaw += 0.1;
  assert.throws(() => createResolvedLandmark(false, moved), /placement/);
  const pier = structuredClone(plan('canada'));
  pier.deckTopY = 5.3;
  assert.throws(() => createResolvedLandmark(false, pier), /datum/);
});
test('Marine entry is a real aperture across the old eight-metre shell seam', () => {
  const p = plan('marine'),
    g = createResolvedLandmark(true, p),
    n = MARINE_ENTRY_CONTRACT.outwardNormalLocal;
  g.updateMatrixWorld(true);
  for (const y of [p.thresholdY + 1.8, 7.99, 8.01]) {
    const ray = new THREE.Raycaster(
        new THREE.Vector3(...marineEntryPoint(0, y, 3)),
        new THREE.Vector3(-n[0], 0, -n[1]),
      ),
      hits = ray.intersectObject(g, true);
    assert.ok(hits.length);
    assert.ok(hits[0].distance > 3.5, `shell blocks threshold at ${y}`);
  }
  disposeGroup(g);
});
test('serialized Stage7 DTOs are geometry deterministic and real LOD lifecycle preserves night/footprints', () => {
  for (const p of plans) {
    const a = createResolvedLandmark(false, p),
      b = createResolvedLandmark(false, JSON.parse(JSON.stringify(p)));
    assert.equal(geometryDigest(a), geometryDigest(b));
    disposeGroup(a);
    disposeGroup(b);
    assertLOD(
      LandmarkDetail,
      createResolvedLandmark,
      p,
      p.kind === 'science' ? 2 : 0,
    );
  }
});
