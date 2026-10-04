import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
const {
  extractMatureTree,
  withoutTreeTextureReferences,
  MATURE_TREE_SPECIES,
  installSourceHeightBarkUV,
} = await import(cityModule('assets/mature-trees'));
const manifest = JSON.parse(
  readFileSync('tools/assets/mature-tree-templates/manifest.json'),
);
const payload = (species) => {
  const b = readFileSync(
    `public/models/blender/mature-trees/mature-${species}.lod0.glb`,
  );
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const json = (b) =>
  JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(b, 20, new DataView(b).getUint32(12, true)),
    ),
  );

test('adopted tree geometry and four shared maps match the delivered source bytes', () => {
  for (const species of MATURE_TREE_SPECIES) {
    const file = `mature-${species}.lod0.glb`,
      bytes = readFileSync(`public/models/blender/mature-trees/${file}`);
    assert.deepEqual(
      bytes,
      readFileSync(`tools/assets/mature-tree-templates/exports/${file}`),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      manifest.assets.find((a) => a.variant === species).lods[0].sha256,
    );
  }
  for (const file of [
    'bark_basecolor.png',
    'bark_normal.png',
    'bark_orm.png',
    'leaf_atlas_rgba.png',
  ])
    assert.deepEqual(
      readFileSync(`public/models/blender/mature-trees/textures/${file}`),
      readFileSync(
        `tools/assets/mature-tree-templates/exports/textures/${file}`,
      ),
    );
});

test('real GLB extraction retains all triangles, metre datum, bark UV and per-LOD alpha roles', async () => {
  for (const species of MATURE_TREE_SPECIES) {
    const input = payload(species),
      filtered = withoutTreeTextureReferences(input),
      before = json(input),
      after = json(filtered);
    assert.deepEqual(after.accessors, before.accessors);
    assert.deepEqual(after.nodes, before.nodes);
    assert.equal(after.images, undefined);
    assert.equal(after.textures, undefined);
    const gltf = await new GLTFLoader().parseAsync(filtered, ''),
      parts = extractMatureTree(gltf.scene);
    let triangles = 0;
    const bounds = new THREE.Box3();
    for (const geometry of Object.values(parts))
      if (geometry) {
        triangles += geometry.index.count / 3;
        bounds.union(geometry.boundingBox);
        assert(geometry.getAttribute('normal'));
        assert(geometry.getAttribute('uv'));
        assert.equal(geometry.groups.length, 0);
        for (const a of Object.values(geometry.attributes))
          assert(Array.from(a.array).every(Number.isFinite));
      }
    assert.equal(
      triangles,
      manifest.assets.find((a) => a.variant === species).lods[0].triangles,
    );
    assert(Math.abs(bounds.min.y) < 1e-6);
    assert(Math.abs(bounds.max.y - 1) < 1e-6);
    assert.equal(
      parts.core !== null,
      ['douglas-fir', 'western-redcedar'].includes(species),
      'near broadleaf cores must use the alpha-cutout role',
    );
    const matrix = new THREE.Matrix4().makeScale(22.9, 22.9, 22.9),
      physical = bounds.clone().applyMatrix4(matrix);
    assert(
      Math.abs(physical.max.y - 22.9) < 1e-5,
      'source-height matrix must not make a 229m tree',
    );
    Object.values(parts).forEach((g) => g?.dispose());
  }
});

test('source height changes bark tile density but never leaf atlas UV; malformed payload is rejected', () => {
  const shader = { vertexShader: '#include <uv_vertex>' };
  installSourceHeightBarkUV(shader);
  assert(shader.vertexShader.includes('length(instanceMatrix[1].xyz) / 10.0'));
  for (const name of [
    'vMapUv',
    'vNormalMapUv',
    'vRoughnessMapUv',
    'vMetalnessMapUv',
  ])
    assert(shader.vertexShader.includes(`${name} *= treeScale`));
  assert.throws(() => withoutTreeTextureReferences(new ArrayBuffer(12)));
});

const threeURL = import.meta.resolve('three');
const asModule = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const fakeThree = asModule(
  `export * from '${threeURL}';import{Texture}from'${threeURL}';export class TextureLoader{loadAsync(url){return new Promise((resolve,reject)=>globalThis.__matureTextureJobs.push({url,resolve:()=>resolve(new Texture()),reject}));}}`,
);
const source = ts
  .transpileModule(readFileSync('lib/city/assets/mature-trees.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(
    /from ['"]([^'"]+)['"]/g,
    (_, id) =>
      `from '${id === 'three' ? fakeThree : id === '../geo' ? cityModule('geo') : import.meta.resolve(id)}'`,
  );
const { MatureTrees } = await import(asModule(source));
const host = () => ({
  disposed: false,
  vegetation: new THREE.Group(),
  renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
});
async function withLoad(action) {
  const original = globalThis.fetch;
  globalThis.__matureTextureJobs = [];
  globalThis.fetch = async (url) => {
    const species = MATURE_TREE_SPECIES.find((s) =>
      url.includes(`mature-${s}.`),
    );
    return { ok: true, arrayBuffer: async () => payload(species) };
  };
  try {
    await action();
  } finally {
    globalThis.fetch = original;
    delete globalThis.__matureTextureJobs;
  }
}

test('near broadleaf pool owns four maps, four possible draws, exact source matrices and matching color/shadow coverage', async () =>
  withLoad(async () => {
    const h = host(),
      owner = new MatureTrees(h),
      pending = owner.load();
    assert.equal(
      owner.add({ x: 0, y: 0, z: 0, h: 10, conifer: false, seed: 12 }),
      false,
    );
    globalThis.__matureTextureJobs.forEach((j) => j.resolve());
    assert.equal(await pending, true);
    const tree = { x: 13, y: 7, z: -8, h: 22.9, conifer: false, seed: 12 };
    owner.reset();
    assert(owner.add(tree));
    owner.finish();
    assert.equal(owner.state().textureCount, 4);
    assert.equal(owner.group.children.length, 4);
    assert.equal(
      owner.add({ ...tree, conifer: true }),
      false,
      'WebGL-rejected conifer templates must never replace source trees',
    );
    const meshes = owner.group.children.filter((m) => m.count);
    const matrix = new THREE.Matrix4();
    meshes[0].getMatrixAt(0, matrix);
    assert(
      Math.abs(new THREE.Vector3().setFromMatrixScale(matrix).y - 22.9) < 1e-5,
    );
    assert.deepEqual(
      new THREE.Vector3().setFromMatrixPosition(matrix).toArray(),
      [13, 7, -8],
    );
    const leaf = meshes.find((m) => m.userData.alphaFoliage);
    assert.equal(leaf.material.map, leaf.customDepthMaterial.map);
    assert.equal(leaf.material.alphaTest, leaf.customDepthMaterial.alphaTest);
    assert.equal(leaf.material.map.flipY, false);
    assert.equal(leaf.material.map.premultiplyAlpha, false);
    const released = { geometry: 0, texture: 0, material: 0, instance: 0 };
    const mats = new Set(),
      maps = new Set();
    for (const m of owner.group.children) {
      m.geometry.addEventListener('dispose', () => released.geometry++);
      m.addEventListener('dispose', () => released.instance++);
      mats.add(m.material);
      if (m.customDepthMaterial) mats.add(m.customDepthMaterial);
    }
    for (const m of mats) {
      m.addEventListener('dispose', () => released.material++);
      for (const value of Object.values(m))
        if (value instanceof THREE.Texture) maps.add(value);
    }
    for (const map of maps)
      map.addEventListener('dispose', () => released.texture++);
    owner.dispose();
    owner.dispose();
    assert.deepEqual(released, {
      geometry: 4,
      texture: 4,
      material: 3,
      instance: 4,
    });
    assert.equal(h.vegetation.children.length, 0);
  }));

test('partial texture failure and dispose during asynchronous load keep all source trees visible and release late data', async () =>
  withLoad(async () => {
    const h = host(),
      owner = new MatureTrees(h),
      pending = owner.load();
    globalThis.__matureTextureJobs.forEach((j, i) =>
      i === 0 ? j.reject(new Error('missing map')) : j.resolve(),
    );
    assert.equal(await pending, false);
    assert.equal(owner.status, 'failed');
    assert.equal(owner.group.children.length, 0);
    assert.equal(owner.state().textureCount, 0);
    owner.dispose();
    globalThis.__matureTextureJobs = [];
    const late = new MatureTrees(h),
      loading = late.load();
    late.dispose();
    globalThis.__matureTextureJobs.forEach((j) => j.resolve());
    assert.equal(await loading, false);
    assert.equal(late.status, 'disposed');
    assert.equal(late.state().textureCount, 0);
    assert.equal(h.vegetation.children.length, 0);
  }));
