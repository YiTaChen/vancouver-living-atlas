import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const url = (s) =>
    'data:text/javascript;base64,' + Buffer.from(s).toString('base64'),
  threeURL = import.meta.resolve('three');
const fakeThree = url(
  `export * from '${threeURL}';import {Texture} from '${threeURL}';export class TextureLoader {load(path,ok,_progress,error){const texture=new Texture();globalThis.__treeLoads.push({path,ok,error,texture});return texture;}}`,
);
const fakeFactory = url(
  `import {BoxGeometry} from '${threeURL}';export function createTreeGeometry(conifer,variant,detail){globalThis.__treeFactories.push({conifer,variant,detail});return {trunk:new BoxGeometry(),foliage:new BoxGeometry()};}`,
);
const compile = (name, imports = {}) =>
  url(
    ts
      .transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(
        /from ['"]([^'"]+)['"]/g,
        (_, id) => `from '${imports[id] || id}'`,
      ),
  );
const selection = compile('../lib/city/tree-selection.ts'),
  { DetailedTrees } = await import(
    compile('../lib/city/detailed-trees.ts', {
      three: fakeThree,
      './tree-selection': selection,
      './assets/tree-geometry': fakeFactory,
      './geo': cityModule('geo'),
      './quality': cityModule('quality'),
    })
  );
function setup() {
  globalThis.__treeLoads = [];
  globalThis.__treeFactories = [];
  let elevations = 0;
  const e = {
    disposed: false,
    data: {},
    settings: { quality: 'high', trees: true },
    camera: { position: new THREE.Vector3(0, 20, 0) },
    vegetation: new THREE.Group(),
    extraTextures: new Set(),
    renderer: { shadowMap: {}, capabilities: { getMaxAnisotropy: () => 8 } },
    elevation: () => {
      elevations++;
      return 17;
    },
  };
  const base = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      30,
    ),
    trees = Array.from({ length: 30 }, (_, seed) => {
      const matrix = new THREE.Matrix4().makeTranslation(
        seed * 0.5,
        17,
        seed % 3,
      );
      base.setMatrixAt(seed, matrix);
      return {
        x: seed * 0.5,
        z: seed % 3,
        h: 15,
        conifer: seed % 2 === 0,
        seed,
        slots: [{ mesh: base, index: seed, matrix }],
      };
    });
  return {
    e,
    base,
    trees,
    d: new DetailedTrees(e, trees),
    elevations: () => elevations,
  };
}
const settle = (which, ok = true) => {
  const q = globalThis.__treeLoads.find((q) => q.path.includes(which));
  (ok ? q.ok : q.error)(q.texture);
};
test('High waits for BOTH atlases, builds at most one medium pool per update, and preserves fallback until usable', () => {
  const f = setup();
  assert.equal(f.elevations(), 0);
  f.d.update(true);
  assert.equal(globalThis.__treeFactories.length, 0);
  assert.equal(f.d.hidden.size, 0);
  settle('leaf');
  f.d.update();
  assert.equal(f.d.assetsReady, false);
  assert.equal(globalThis.__treeFactories.length, 0);
  settle('bark');
  for (let i = 1; i <= 6; i++) {
    f.d.update();
    assert.equal(globalThis.__treeFactories.length, i);
    assert.equal(f.d.pools.length, i);
  }
  assert.ok(globalThis.__treeFactories.every((p) => p.detail === 'medium'));
  assert.equal(f.d.hidden.size, 30);
  assert.equal(f.e.data.detailedTreeCount, 30);
  f.d.update();
  assert.equal(globalThis.__treeFactories.length, 6);
  f.e.settings.quality = 'balanced';
  f.d.update();
  assert.equal(f.d.hidden.size, 0);
  for (const t of f.trees) {
    const m = new THREE.Matrix4();
    f.base.getMatrixAt(t.seed, m);
    assert.deepEqual(m.elements, t.slots[0].matrix.elements);
  }
});
test('Ultra adds only missing pools incrementally; return to High creates nothing and keeps dense SSAO enumeration', () => {
  const f = setup();
  f.d.update();
  settle('leaf');
  settle('bark');
  for (let i = 0; i < 6; i++) f.d.update();
  f.e.settings.quality = 'ultra';
  for (let i = 7; i <= 12; i++) {
    f.d.update();
    assert.equal(globalThis.__treeFactories.length, i);
    assert.equal(f.d.pools.length, i);
  }
  assert.ok(
    globalThis.__treeFactories.slice(6).every((p) => p.detail === 'ultra'),
  );
  assert.equal(f.d.pools.map((p) => p.foliage).filter(Boolean).length, 12);
  assert.equal(f.d.hidden.size, 30);
  f.e.settings.quality = 'high';
  f.d.update();
  assert.equal(globalThis.__treeFactories.length, 12);
  assert.ok(f.d.pools.slice(6).every((p) => p.count === 0));
});
test('failed bark and dispose-during-load cannot hide base trees or allocate geometry later', () => {
  const f = setup();
  f.d.update();
  settle('leaf');
  settle('bark', false);
  for (let i = 0; i < 10; i++) f.d.update();
  assert.equal(f.d.hidden.size, 0);
  assert.equal(globalThis.__treeFactories.length, 0);
  const g = setup();
  g.d.update();
  g.e.disposed = true;
  settle('leaf');
  settle('bark');
  g.d.update(true);
  assert.equal(globalThis.__treeFactories.length, 0);
  assert.equal(g.d.hidden.size, 0);
});
test('moving away cancels further pool growth and returns every replacement to its original slots', () => {
  const f = setup();
  f.d.update();
  settle('leaf');
  settle('bark');
  f.d.update();
  assert.equal(globalThis.__treeFactories.length, 1);
  f.e.camera.position.set(0, 10000, 0);
  f.d.update();
  for (let i = 0; i < 10; i++) f.d.update();
  assert.equal(globalThis.__treeFactories.length, 1);
  assert.equal(f.d.hidden.size, 0);
});

test('failed or pending atlases release all three no-pool materials once; late loads never allocate and Engine owns textures', () => {
  for (const failure of ['leaf', 'bark', 'pending']) {
    const f = setup();
    f.d.update();
    const counts = { trunk: 0, leaf: 0, depth: 0 };
    for (const [key, material] of Object.entries(f.d.materials))
      material.addEventListener('dispose', () => counts[key]++);
    let textures = 0;
    for (const texture of f.e.extraTextures)
      texture.addEventListener('dispose', () => textures++);
    if (failure !== 'pending') {
      settle(failure, false);
      settle(failure === 'leaf' ? 'bark' : 'leaf');
    }
    assert.equal(f.d.pools.length, 0);
    f.d.dispose();
    f.d.dispose();
    settle('leaf');
    settle('bark');
    f.d.initialize();
    f.d.update(true);
    assert.deepEqual(counts, { trunk: 1, leaf: 1, depth: 1 });
    assert.equal(f.d.pools.length, 0);
    assert.equal(globalThis.__treeFactories.length, 0);
    assert.equal(f.d.assetsReady, false);
    assert.equal(textures, 0);
    for (const texture of f.e.extraTextures) texture.dispose();
    assert.equal(textures, 2);
  }
});

test('an existing pool keeps scene ownership; early disposal does not double-dispose shared materials', () => {
  const f = setup();
  f.d.update();
  settle('leaf');
  settle('bark');
  f.d.update();
  assert.equal(f.d.pools.length, 1);
  const counts = { trunk: 0, leaf: 0, depth: 0 };
  for (const [key, material] of Object.entries(f.d.materials))
    material.addEventListener('dispose', () => counts[key]++);
  f.d.dispose();
  f.d.dispose();
  assert.deepEqual(counts, { trunk: 0, leaf: 0, depth: 0 });
  f.d.group.traverse((mesh) => {
    mesh.customDepthMaterial?.dispose();
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    if (mesh.isInstancedMesh) mesh.dispose();
  });
  assert.deepEqual(counts, { trunk: 1, leaf: 1, depth: 1 });
  f.d.update(true);
  assert.equal(f.d.pools.length, 1);
});
