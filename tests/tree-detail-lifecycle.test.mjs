import test, { beforeEach, afterEach } from 'node:test';
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
const fakeMatureTrees = url(`
  import {Group} from '${threeURL}';
  export class MatureTrees {
    status='idle'; count=0; group=new Group(); pending=null;
    constructor(host){host.vegetation.add(this.group);this.group.visible=false;}
    load(){
      globalThis.__matureLoads.push(this);
      if(this.pending)return this.pending;
      this.status='loading';
      this.pending=new Promise(resolve=>{this.complete=(success=true)=>{
        if(this.status==='disposed'){resolve(false);return;}
        this.status=success?'ready':'failed';resolve(success);
      };});
      return this.pending;
    }
    reset(){this.count=0;}
    add(tree){
      globalThis.__matureAdds.push(tree);
      if(this.status!=='ready'||tree.conifer)return false;
      this.count++;return true;
    }
    finish(){this.group.visible=this.count>0;}
    state(){return {status:this.status,count:this.count};}
    dispose(){this.status='disposed';this.count=0;this.group.removeFromParent();}
  }
`);
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
      )
      .replace(
        /import\(['"]([^'"]+)['"]\)/g,
        (_, id) => `import('${imports[id] || id}')`,
      ),
  );
let previousQA;
beforeEach(() => {
  previousQA = process.env.VANCOUVER_VISUAL_QA;
  process.env.VANCOUVER_VISUAL_QA = '1';
});
afterEach(() => {
  if (previousQA === undefined) delete process.env.VANCOUVER_VISUAL_QA;
  else process.env.VANCOUVER_VISUAL_QA = previousQA;
});
const selection = compile('../lib/city/tree-selection.ts'),
  { DetailedTrees } = await import(
    compile('../lib/city/detailed-trees.ts', {
      three: fakeThree,
      './tree-selection': selection,
      './assets/tree-geometry': fakeFactory,
      './assets/mature-trees': fakeMatureTrees,
      './assets/tree-material-candidate': cityModule(
        'assets/tree-material-candidate',
      ),
      './geo': cityModule('geo'),
      './quality': cityModule('quality'),
    })
  );
function setup() {
  globalThis.__treeLoads = [];
  globalThis.__treeFactories = [];
  globalThis.__matureLoads = [];
  globalThis.__matureAdds = [];
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

test('High never loads or admits mature trees; Ultra loads once and restores the High baseline after an eight-tree near pool', async () => {
  const f = populated(),
    highCounts = f.d.pools.map((pool) => pool.count);
  assert.equal(globalThis.__matureLoads.length, 0);
  assert.equal(globalThis.__matureAdds.length, 0);
  assert.equal(f.d.getGeometryCandidateState().status, 'idle');
  f.e.settings.quality = 'ultra';
  f.d.update();
  assert.equal(globalThis.__matureLoads.length, 1);
  assert.equal(f.d.getGeometryCandidateState().status, 'loading');
  for (let i = 0; i < 5; i++) f.d.update();
  assert.equal(
    globalThis.__matureLoads.length,
    1,
    'in-flight load is never restarted',
  );
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  f.d.matureTrees.complete();
  await new Promise(setImmediate);
  f.d.update();
  assert.equal(f.d.getGeometryCandidateState().count, 8);
  assert.equal(f.d.matureTrees.group.visible, true);
  assert(globalThis.__matureAdds.every((tree) => !tree.conifer));
  assert.equal(
    f.d.pools.reduce((sum, pool) => sum + pool.count, 0),
    22,
  );
  const adds = globalThis.__matureAdds.length;
  f.e.settings.quality = 'high';
  f.d.update();
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  assert.equal(f.d.matureTrees.group.visible, false);
  assert.equal(
    globalThis.__matureAdds.length,
    adds,
    'High never attempts an admission',
  );
  assert.deepEqual(
    f.d.pools.slice(0, 6).map((pool) => pool.count),
    highCounts,
  );
  assert(f.d.pools.slice(6).every((pool) => pool.count === 0));
  assert.equal(f.d.hidden.size, 30);
  f.e.settings.quality = 'balanced';
  f.d.update();
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  assert.equal(f.d.hidden.size, 0);
  for (const tree of f.trees) {
    const matrix = new THREE.Matrix4();
    f.base.getMatrixAt(tree.seed, matrix);
    assert.deepEqual(matrix.elements, tree.slots[0].matrix.elements);
  }
  f.d.dispose();
  disposePoolScene(f);
});

test('Ultra lazy load requires a close broadleaf, and explicit QA loading in High still cannot admit one', async () => {
  for (const condition of [
    'conifers-only',
    'outside-45m',
    'trees-off',
    'baseline',
  ]) {
    const f = setup();
    f.e.settings.quality = 'ultra';
    if (condition === 'conifers-only')
      f.trees.forEach((tree) => {
        tree.conifer = true;
      });
    if (condition === 'outside-45m') f.e.camera.position.set(0, 20, 100);
    if (condition === 'trees-off') f.e.settings.trees = false;
    if (condition === 'baseline') await f.d.setGeometryCandidate('baseline');
    f.d.update(true);
    assert.equal(globalThis.__matureLoads.length, 0, condition);
    assert.equal(globalThis.__matureAdds.length, 0, condition);
    f.d.dispose();
    disposePoolScene(f);
  }
  const f = setup(),
    requested = f.d.setGeometryCandidate('blender');
  assert.equal(
    globalThis.__matureLoads.length,
    1,
    'explicit QA preload remains available',
  );
  f.d.matureTrees.complete();
  assert.equal(await requested, true);
  f.d.update(true);
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  assert.equal(globalThis.__matureAdds.length, 0);
  assert.equal(
    f.d.hidden.size,
    0,
    'pending baseline atlases leave original instances visible',
  );
  f.d.dispose();
  disposePoolScene(f);
});

test('loaded Ultra trees return to original slots in High when old atlases failed; late completion cannot revive High or a disposed owner', async () => {
  const f = setup();
  f.e.settings.quality = 'ultra';
  f.d.update();
  settle('leaf');
  settle('bark', false);
  f.d.matureTrees.complete();
  await new Promise(setImmediate);
  f.d.update();
  assert.equal(f.d.hidden.size, 8);
  assert.equal(f.d.pools.length, 0);
  f.e.settings.quality = 'high';
  f.d.update();
  assert.equal(f.d.hidden.size, 0);
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  for (const tree of f.trees) {
    const matrix = new THREE.Matrix4();
    f.base.getMatrixAt(tree.seed, matrix);
    assert.deepEqual(matrix.elements, tree.slots[0].matrix.elements);
  }
  f.d.dispose();
  disposePoolScene(f);
  for (const finishIn of ['high', 'disposed']) {
    const g = setup();
    g.e.settings.quality = 'ultra';
    g.d.update();
    if (finishIn === 'high') {
      g.e.settings.quality = 'high';
      g.d.update();
    } else g.d.dispose();
    g.d.refresh = false;
    g.d.matureTrees.complete();
    await new Promise(setImmediate);
    if (finishIn === 'disposed') assert.equal(g.d.refresh, false);
    g.d.update();
    assert.equal(g.d.hidden.size, 0);
    assert.equal(g.d.getGeometryCandidateState().count, 0);
    assert.equal(globalThis.__matureAdds.length, 0);
    g.d.dispose();
    disposePoolScene(g);
  }
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

async function candidateRequests(run) {
  const original = THREE.ImageLoader.prototype.load,
    requests = [];
  THREE.ImageLoader.prototype.load = function (url, ok, _progress, error) {
    requests.push({ url, ok, error });
    return {};
  };
  try {
    return await run(requests);
  } finally {
    THREE.ImageLoader.prototype.load = original;
  }
}
async function waitForCandidateRequests(requests) {
  for (let i = 0; i < 20 && requests.length === 0; i++)
    await new Promise(setImmediate);
  assert.equal(
    requests.length,
    5,
    'lazy module loads only when the QA setter requests it',
  );
}
function completeCandidate(requests) {
  requests.forEach((request, i) =>
    request.ok({ width: 1024 >> i, height: 1024 >> i }),
  );
}
function populated() {
  const f = setup();
  f.d.update();
  settle('leaf');
  settle('bark');
  for (let i = 0; i < 6; i++) f.d.update();
  return f;
}
function disposePoolScene(f) {
  f.d.group.traverse((mesh) => {
    mesh.customDepthMaterial?.dispose();
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    if (mesh.isInstancedMesh) mesh.dispose();
  });
  for (const texture of f.e.extraTextures) texture.dispose();
}

test('production refuses material candidates without loading images or allocating any candidate resources', async () => {
  const f = populated(),
    materials = f.d.pools.map((pool) => pool.foliage.material);
  for (const flag of [undefined, '0']) {
    if (flag === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = flag;
    await candidateRequests(async (requests) => {
      assert.equal(await f.d.setMaterialCandidate('leaf-rgba'), false);
      assert.equal(await f.d.setMaterialCandidate('baseline'), false);
      assert.equal(requests.length, 0);
    });
    assert.deepEqual(f.d.getMaterialCandidateState(), {
      requested: 'baseline',
      active: 'baseline',
      status: 'idle',
      extraTextures: 0,
    });
    assert.equal(f.e.extraTextures.size, 2);
    assert.deepEqual(
      f.d.pools.map((pool) => pool.foliage.material),
      materials,
    );
  }
  f.d.dispose();
  disposePoolScene(f);
});

test('explicit leaf opt-in swaps color and shadow together without changing any selected source, matrix, geometry or LOD cost', async () => {
  const f = populated(),
    originals = f.d.pools.map((pool) => ({
      geometry: pool.foliage.geometry,
      material: pool.foliage.material,
      depth: pool.foliage.customDepthMaterial,
      matrix: pool.foliage.instanceMatrix.array.slice(),
      count: pool.count,
    })),
    hidden = [...f.d.hidden],
    sources = JSON.stringify(
      f.d.trees.map(({ x, y, z, h, seed, variant }) => ({
        x,
        y,
        z,
        h,
        seed,
        variant,
      })),
    );
  assert.deepEqual(f.d.getMaterialCandidateState(), {
    requested: 'baseline',
    active: 'baseline',
    status: 'idle',
    extraTextures: 0,
  });
  let pending;
  await candidateRequests(async (requests) => {
    pending = f.d.setMaterialCandidate('leaf-rgba');
    assert.equal(f.d.getMaterialCandidateState().active, 'baseline');
    assert.equal(f.d.pools[0].foliage.material, originals[0].material);
    await waitForCandidateRequests(requests);
    completeCandidate(requests);
  });
  assert.equal(await pending, true);
  assert.equal(f.d.getMaterialCandidateState().active, 'leaf-rgba');
  assert.equal(f.e.extraTextures.size, 3);
  f.d.pools.forEach((pool, i) => {
    assert.equal(pool.foliage.geometry, originals[i].geometry);
    assert.deepEqual(pool.foliage.instanceMatrix.array, originals[i].matrix);
    assert.equal(pool.count, originals[i].count);
    assert.notEqual(pool.foliage.material, originals[i].material);
    assert.equal(
      pool.foliage.material.map,
      pool.foliage.customDepthMaterial.map,
    );
  });
  assert.deepEqual([...f.d.hidden], hidden);
  assert.equal(
    JSON.stringify(
      f.d.trees.map(({ x, y, z, h, seed, variant }) => ({
        x,
        y,
        z,
        h,
        seed,
        variant,
      })),
    ),
    sources,
  );
  assert.equal(globalThis.__treeFactories.length, 6);
  assert.equal(await f.d.setMaterialCandidate('baseline'), true);
  f.d.pools.forEach((pool, i) => {
    assert.equal(pool.foliage.material, originals[i].material);
    assert.equal(pool.foliage.customDepthMaterial, originals[i].depth);
  });
  assert.equal(globalThis.__treeFactories.length, 6);
  f.d.dispose();
  disposePoolScene(f);
});

test('switching back while loading or a failed leaf mip cannot override the chosen baseline', async () => {
  for (const failure of [false, true]) {
    const f = populated();
    let pending, baseline;
    await candidateRequests(async (requests) => {
      pending = f.d.setMaterialCandidate('leaf-rgba');
      await waitForCandidateRequests(requests);
      if (failure) requests[2].error(new Error('missing mip'));
      else baseline = f.d.setMaterialCandidate('baseline');
      completeCandidate(requests);
    });
    if (baseline) assert.equal(await baseline, true);
    assert.equal(await pending, false);
    assert.equal(f.d.getMaterialCandidateState().active, 'baseline');
    assert.equal(f.d.hidden.size, 30);
    f.d.dispose();
    disposePoolScene(f);
  }
});

test('active candidate disposal releases dormant baseline leaf/depth while scene retains active candidate ownership', async () => {
  const f = populated(),
    counts = {
      leaf: 0,
      depth: 0,
      trunk: 0,
      candidateLeaf: 0,
      candidateDepth: 0,
    };
  for (const [key, material] of Object.entries(f.d.materials))
    material.addEventListener('dispose', () => counts[key]++);
  let pending;
  await candidateRequests(async (requests) => {
    pending = f.d.setMaterialCandidate('leaf-rgba');
    await waitForCandidateRequests(requests);
    completeCandidate(requests);
  });
  await pending;
  const pool = f.d.pools[0];
  pool.foliage.material.addEventListener(
    'dispose',
    () => counts.candidateLeaf++,
  );
  pool.foliage.customDepthMaterial.addEventListener(
    'dispose',
    () => counts.candidateDepth++,
  );
  f.d.dispose();
  f.d.dispose();
  assert.deepEqual(counts, {
    leaf: 1,
    depth: 1,
    trunk: 0,
    candidateLeaf: 0,
    candidateDepth: 0,
  });
  assert.equal(await f.d.setMaterialCandidate('baseline'), false);
  disposePoolScene(f);
  assert.equal(counts.leaf, 1);
  assert.equal(counts.depth, 1);
  assert.ok(
    counts.trunk > 0 && counts.candidateLeaf > 0 && counts.candidateDepth > 0,
  );
});
