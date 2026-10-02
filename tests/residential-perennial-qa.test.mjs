import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createResidentialGround } = await import(
  cityModule('residential-ground')
);
const { createPerennialQAEvidence } = await import(
  cityModule('residential-perennial-qa')
);
const { unproject } = await import(cityModule('geo'));

function fixture(count = 5) {
  const terrain = new THREE.Group(),
    roads = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const points = [-20, -20, 820, 410, 820, -20, -20, -20, -20, 410, 820, 410];
  const positions = [];
  for (let i = 0; i < points.length; i += 2)
    positions.push(
      points[i],
      points[i] * 0.015 + points[i + 1] * 0.01,
      points[i + 1],
    );
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  terrain.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const features = Array.from({ length: count }, (_, i) => {
    const x = (i % 30) * 25,
      z = Math.floor(i / 30) * 20;
    return {
      properties: { buildingId: `qa-home-${i}`, height: 8 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [x, z],
            [x + 16, z],
            [x + 16, z + 10],
            [x, z + 10],
            [x, z],
          ].map(([x, z]) => unproject(x, z)),
        ],
      },
    };
  });
  return {
    terrain,
    roads,
    buildings: new THREE.Group(),
    extraTextures: new Set(),
    elevation: (x, z) => x * 0.015 + z * 0.01,
    data: {
      buildings: { features },
      buildingProfiles: new Map(
        features.map((f) => [
          f.properties.buildingId,
          { kind: 'domestic-cladding', pitchM: 3, seed: 0 },
        ]),
      ),
    },
  };
}
function run(e, flag, query) {
  const oldFlag = process.env.VANCOUVER_VISUAL_QA,
    oldWindow = globalThis.window;
  try {
    process.env.VANCOUVER_VISUAL_QA = flag;
    globalThis.window = { location: { search: query } };
    createResidentialGround(e);
  } finally {
    if (oldFlag === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = oldFlag;
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
}
function meshes(e) {
  return e.buildings.children.map((lod) => ({
    lod,
    mesh: lod.levels[0].object,
  }));
}
function dispose(e) {
  const geometries = new Set(),
    materials = new Set();
  for (const root of [e.terrain, e.roads, e.buildings])
    root.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
  for (const x of [...geometries, ...materials]) x.dispose();
  for (const root of [e.terrain, e.roads, e.buildings]) root.clear();
}

void test('perennial QA is explicit, unambiguous and default off', () => {
  for (const query of [
    '',
    '?qaPerennial=1',
    '?qaPerennial=BLENDER',
    '?qaPerennial=blender&qaPerennial=baseline',
  ])
    assert.equal(createPerennialQAEvidence(query), null);
  assert.equal(
    createPerennialQAEvidence('?qaPerennial=blender').variant,
    'blender',
  );
  assert.equal(
    createPerennialQAEvidence('?qaPerennial=baseline').variant,
    'baseline',
  );
});

void test('production ignores opt-in; QA default uses byte-identical legacy geometry and no evidence', () => {
  const base = fixture();
  run(base, '0', '');
  for (const [flag, query] of [
    ['0', '?qaPerennial=blender'],
    ['1', ''],
    ['1', '?qaPerennial=typo'],
  ]) {
    const e = fixture();
    run(e, flag, query);
    assert.deepEqual(e.data.residentialGround, base.data.residentialGround);
    assert.equal(e.data.residentialPerennialQA, undefined);
    meshes(e).forEach(({ mesh }, i) => {
      for (const key of ['position', 'color', 'normal'])
        assert.deepEqual(
          mesh.geometry.getAttribute(key).array,
          meshes(base)[i].mesh.geometry.getAttribute(key).array,
        );
    });
    dispose(e);
  }
  dispose(base);
});

void test('QA replacement preserves accepted source/bed/plant placements, caps, material and LOD budgets', () => {
  const before = fixture(510),
    after = fixture(510);
  const inputs = JSON.stringify(after.data.buildings);
  run(before, '1', '?qaPerennial=baseline');
  run(after, '1', '?qaPerennial=blender');
  assert.equal(after.data.residentialGround.plots, 500);
  assert.deepEqual(after.data.residentialGround, before.data.residentialGround);
  assert.deepEqual(
    after.data.residentialPerennialQA.beds,
    before.data.residentialPerennialQA.beds,
  );
  assert.deepEqual(
    after.data.residentialPerennialQA.plants,
    before.data.residentialPerennialQA.plants,
  );
  assert.equal(JSON.stringify(after.data.buildings), inputs);
  assert.equal(after.extraTextures.size, 0);
  const materials = new Set();
  meshes(after).forEach(({ mesh, lod }, i) => {
    const previous = meshes(before)[i];
    materials.add(mesh.material);
    assert.deepEqual(lod.position, previous.lod.position);
    assert.deepEqual(
      lod.levels.map((v) => [v.distance, v.hysteresis]),
      previous.lod.levels.map((v) => [v.distance, v.hysteresis]),
    );
    assert.equal(lod.levels[1].object.children.length, 0);
    for (const attribute of ['position', 'normal', 'color'])
      assert.equal(
        mesh.geometry.getAttribute(attribute).array.byteLength,
        previous.mesh.geometry.getAttribute(attribute).array.byteLength,
      );
    for (const name of ['position', 'normal', 'color'])
      assert.ok(mesh.geometry.getAttribute(name).array.every(Number.isFinite));
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.roughness, 1);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.userData.walkSurface, undefined);
    assert.equal(mesh.geometry.groups.length, 0);
  });
  assert.equal(materials.size, 1);
  assert.equal(
    after.data.residentialGround.triangles,
    before.data.residentialGround.triangles,
  );
  dispose(before);
  dispose(after);
});

void test('QA lifecycle allocates only existing mesh/material resources and does not share evidence across builds', () => {
  const first = fixture(),
    second = fixture();
  run(first, '1', '?qaPerennial=blender');
  run(second, '1', '?qaPerennial=baseline');
  assert.notEqual(
    first.data.residentialPerennialQA,
    second.data.residentialPerennialQA,
  );
  const resources = new Set();
  for (const { mesh } of meshes(first)) {
    resources.add(mesh.geometry);
    resources.add(mesh.material);
  }
  const events = new Map([...resources].map((r) => [r, 0]));
  for (const r of resources)
    r.addEventListener('dispose', () => events.set(r, events.get(r) + 1));
  const evidence = structuredClone(first.data.residentialPerennialQA);
  dispose(first);
  assert.ok([...events.values()].every((n) => n === 1));
  assert.deepEqual(
    first.data.residentialPerennialQA,
    evidence,
    'diagnostic evidence has no GPU object references',
  );
  first.terrain = fixture().terrain;
  run(first, '1', '');
  assert.equal(first.data.residentialPerennialQA, undefined);
  assert.equal(second.data.residentialPerennialQA.variant, 'baseline');
  dispose(first);
  dispose(second);
});

void test('compiled production removes the candidate module/data and URL control; QA includes them', () => {
  // Keep Vite's types in the configured TS project rather than expanding the
  // shared inferred JS test project and changing unrelated lint diagnostics.
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', 'tools/verify-residential-perennial-bundle.mts'],
    { cwd: new URL('..', import.meta.url), timeout: 60_000 },
  );
});
