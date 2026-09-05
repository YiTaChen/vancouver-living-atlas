import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
const threeURL = import.meta.resolve('three');
async function moduleAt(path, replacements = {}) {
  let src = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  src = src
    .replaceAll("from 'three'", `from '${threeURL}'`)
    .replaceAll(
      "from 'three/addons/utils/BufferGeometryUtils.js'",
      `from '${import.meta.resolve('three/addons/utils/BufferGeometryUtils.js')}'`,
    );
  for (const [name, url] of Object.entries(replacements))
    src = src.replaceAll(`from '${name}'`, `from '${url}'`);
  const js = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const url =
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  return { url, exports: await import(url) };
}
const quality = await moduleAt('lib/city/quality.ts');
const geometry = await moduleAt('lib/city/assets/tree-geometry.ts');
const geo = await moduleAt('lib/city/geo.ts');
const detail = await moduleAt('lib/city/detailed-trees.ts', {
  './assets/tree-geometry': geometry.url,
  './quality': quality.url,
  './geo': geo.url,
});

test('pixel budgets bound desktop, Retina and oversized viewports; Ultra increases real resolution', () => {
  for (const q of ['balanced', 'high', 'ultra'])
    for (const [w, h, dpr] of [
      [1920, 1080, 1],
      [1920, 1080, 2],
      [3840, 2160, 3],
      [10000, 1000, 2],
      [0, 0, 1],
    ]) {
      const ratio = quality.exports.qualityPixelRatio(q, w, h, dpr);
      assert(Number.isFinite(ratio) && ratio > 0);
      assert(
        Math.max(1, w) * Math.max(1, h) * ratio * ratio <=
          quality.exports.QUALITY[q].pixels + 1e-6,
      );
      assert(Math.max(w, h) * ratio <= 4096 + 1e-6);
    }
  assert(
    quality.exports.qualityPixelRatio('ultra', 1920, 1080, 1) >
      quality.exports.qualityPixelRatio('high', 1920, 1080, 1),
  );
});

test('all authored tree variants have finite, bounded geometry and an explicit solid canopy mask', () => {
  for (const conifer of [false, true])
    for (const variant of [0, 1, 2])
      for (const tier of ['medium', 'ultra']) {
        const model = geometry.exports.createTreeGeometry(
          conifer,
          variant,
          tier,
        );
        let tris = 0;
        for (const g of Object.values(model)) {
          g.computeBoundingBox();
          assert(
            g.boundingBox.min.y >= -1e-5 && g.boundingBox.max.y <= 1.00001,
          );
          for (const a of Object.values(g.attributes))
            for (const n of a.array) assert(Number.isFinite(n));
          tris += (g.index?.count || g.getAttribute('position').count) / 3;
        }
        assert(tris <= (tier === 'medium' ? 580 : 4400));
        const mask = model.foliage.getAttribute('aSolid');
        assert(mask);
        assert([...mask.array].some((n) => n === 1));
        assert([...mask.array].some((n) => n === 0));
      }
});

test('near-tree pool preserves far instances while loading, restores shared LOD matrices and bounds counts', () => {
  // oxlint-disable-next-line typescript/unbound-method -- save the method to restore this isolated fixture
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    const trees = Array.from({ length: 550 }, (_, i) => ({
      x: i * 0.015,
      z: 0,
      h: 10,
      conifer: false,
      seed: i,
    }));
    const mat = new THREE.MeshBasicMaterial(),
      g = new THREE.BoxGeometry(1, 1, 1);
    const far = new THREE.InstancedMesh(g, mat, trees.length),
      low = new THREE.InstancedMesh(g, mat, trees.length);
    low.instanceMatrix = far.instanceMatrix;
    for (let i = 0; i < trees.length; i++) {
      const m = new THREE.Matrix4().makeTranslation(trees[i].x, 3, 0);
      far.setMatrixAt(i, m);
      detail.exports.registerTree(trees[i], far, i, m);
    }
    const before = new Float32Array(far.instanceMatrix.array);
    const e = {
      settings: { quality: 'high', trees: true },
      camera: new THREE.PerspectiveCamera(),
      vegetation: new THREE.Group(),
      elevation: () => 3,
      renderer: { shadowMap: {}, capabilities: { getMaxAnisotropy: () => 8 } },
      extraTextures: new Set(),
      data: {},
    };
    e.camera.position.set(0, 10, 15);
    const system = new detail.exports.DetailedTrees(e, trees);
    system.update();
    assert.equal(system.hidden.size, 0);
    assert.deepEqual(far.instanceMatrix.array, before);
    system.assetsReady = true;
    system.update(true);
    assert(system.hidden.size > 0);
    assert(system.hidden.size <= 450);
    assert.strictEqual(low.instanceMatrix, far.instanceMatrix);
    for (let i = 0; i < 8; i++) {
      e.settings.quality = i % 2 ? 'high' : 'ultra';
      system.update(true);
      assert(system.pools.every((p) => p.count <= 240));
      e.settings.quality = 'balanced';
      system.update(true);
      assert.equal(system.hidden.size, 0);
      assert.deepEqual(far.instanceMatrix.array, before);
    }
    e.settings.quality = 'ultra';
    system.update(true);
    e.camera.position.set(5000, 20, 5000);
    system.update();
    assert.equal(system.hidden.size, 0);
    assert.deepEqual(low.instanceMatrix.array, before);
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});

for (const { path, names } of [
  {
    path: 'primary-landmarks',
    names: ['createScienceWorld', 'createCanadaPlace'],
  },
  {
    path: 'secondary-landmarks',
    names: ['createBCPlace', 'createHarbourCentre', 'createMarineBuilding'],
  },
  { path: 'convention-centre', names: ['createConventionCentre'] },
]) {
  const { exports: factory } = await moduleAt(`lib/city/assets/${path}.ts`);
  test(`${path} has finite geometry, closed water collision rings and cheaper medium models`, () => {
    for (const name of names) {
      let medium = 0;
      for (const detailed of [false, true]) {
        const group = factory[name](detailed);
        let tris = 0;
        assert(group.userData.placement.lon < 0);
        assert(group.children.length <= 20);
        group.traverse((o) => {
          if (o.isMesh) {
            const pos = o.geometry.getAttribute('position');
            for (const n of pos.array) assert(Number.isFinite(n));
            tris += (o.geometry.index?.count || pos.count) / 3;
          }
        });
        assert(tris < 100000);
        if (!detailed) medium = tris;
        else assert(tris > medium);
        for (const r of group.userData.solidFootprints)
          assert(
            Math.hypot(r[0][0] - r.at(-1)[0], r[0][1] - r.at(-1)[1]) < 1e-5,
          );
      }
    }
  });
}

const replacements = await moduleAt('lib/city/replaced-buildings.ts');
const facades = await moduleAt('lib/city/facade-details.ts', {
  './geo': geo.url,
  './replaced-buildings': replacements.url,
});
test('facade cells are lazy, use the shared foundation and evict geometry with a bounded cache', () => {
  const features = Array.from({ length: 42 }, (_, i) => ({
    properties: { buildingId: i, height: 52 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [12, 0],
          [12, 12],
          [0, 12],
          [0, 0],
        ].map(([x, z]) => geo.exports.unproject(x + i * 190, z)),
      ],
    },
  }));
  const e = {
    data: { buildings: { features } },
    camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'balanced', buildings: true },
    buildings: new THREE.Group(),
    renderer: { shadowMap: { needsUpdate: false } },
  };
  const foundations = new Map(features.map((f, i) => [String(i), 42]));
  const detail = new facades.exports.FacadeDetails(e, foundations);
  assert(detail.cells.every((c) => !c.mesh));
  detail.update();
  assert.equal(e.buildings.children.length, 0);
  e.settings.quality = 'high';
  e.camera.position.set(0, 60, 25);
  detail.update();
  assert(e.buildings.children.length > 0);
  for (const c of detail.cells.filter((c) => c.mesh)) {
    c.mesh.geometry.computeBoundingBox();
    assert(c.mesh.geometry.boundingBox.min.y > 42);
    assert(c.mesh.geometry.boundingBox.max.y < 95);
  }
  for (let i = 1; i < 42; i++) {
    e.camera.position.set(i * 190, 60, 25);
    e.renderer.shadowMap.needsUpdate = false;
    detail.update();
    assert(detail.cells.filter((c) => c.mesh).length <= 32);
    assert(detail.cells.filter((c) => c.mesh?.visible).length <= 24);
    assert(e.renderer.shadowMap.needsUpdate);
  }
  e.settings.quality = 'balanced';
  detail.update();
  assert(detail.cells.every((c) => !c.mesh?.visible));
  assert(replacements.exports.replacedBuilding({ buildingId: 152366 }));
  assert(
    replacements.exports.replacedBuilding({ structureId: 'osm-structure-19' }),
  );
  assert(!replacements.exports.replacedBuilding({ buildingId: 123 }));
});
