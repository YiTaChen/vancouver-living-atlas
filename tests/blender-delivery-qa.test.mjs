import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { BLENDER_DELIVERY_MODELS: models, DeliveryModelPreview, deliveryModelEvidence, disposeDeliveryModel, loadDeliveryGLTF } = await import(cityModule('blender-delivery-qa'));
const model = models.find((item) => item.package === 'rooftop-equipment' && item.level === 1);
function fixture(triangles = model.triangles) {
  const scene = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(triangles * 9);
  positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  scene.add(new THREE.Mesh(geometry, material));
  const disposed = { geometry: 0, material: 0, texture: 0 };
  for (const [name, object] of Object.entries({ geometry, material, texture })) object.addEventListener('dispose', () => disposed[name]++);
  return { scene, animations: [], geometry, texture, material, disposed };
}
test('catalog exposes delivered LODs with fixed asset framing and excludes rejected drivers', () => {
  assert.equal(new Set(models.map((item) => item.key)).size, models.length);
  assert.equal(new Set(models.map((item) => item.package)).size, 12);
  assert.equal(models.filter((item) => item.package === 'mature-tree-templates').length, 12);
  assert.equal(models.filter((item) => item.package === 'traffic-car-templates').length, 6);
  assert.deepEqual([...new Set(models.filter((item) => item.package === 'citizen-character-variants').map((item) => item.asset))].sort(), ['vancouver-citizen', 'vancouver-police']);
  for (const item of models) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert(item.bytes > 0 && item.triangles > 0);
    assert.match(item.file, /^exports\/[a-z0-9_.-]+\.glb$/);
    const lod0 = models.find((candidate) => candidate.package === item.package && candidate.asset === item.asset && candidate.level === 0);
    assert.deepEqual(item.frameBounds, lod0.frameBounds, 'LOD switching must preserve camera scale');
  }
});
test('validated replacements use content cache keys and release shared resources exactly once', async () => {
  const first = fixture(), second = fixture(), queue = [first, second], urls = [];
  const preview = new DeliveryModelPreview(() => false, async (url) => { urls.push(url); return queue.shift(); });
  assert.equal(await preview.select(model.key), true);
  assert.deepEqual(first.disposed, { geometry: 0, material: 0, texture: 0 });
  assert.equal(preview.snapshot().activeModels, 1);
  assert.equal(preview.snapshot().evidence.triangles, model.triangles);
  assert.equal(await preview.select(model.key), true);
  assert.deepEqual(first.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(preview.group.children.length, 1);
  assert.equal(preview.group.children[0], second.scene);
  assert.deepEqual(urls, Array(2).fill(`/__offline-assets/${model.package}/${model.file}?v=${model.sha256.slice(0, 12)}`));
  preview.clear(); preview.clear();
  assert.deepEqual(second.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(preview.snapshot().activeModels, 0);
});
test('failed model or invalid positions preserve the last valid owned model', async () => {
  const first = fixture(), broken = fixture(model.triangles + 1), queue = [first, broken];
  const preview = new DeliveryModelPreview(() => false, async () => queue.shift());
  await preview.select(model.key);
  await assert.rejects(preview.select(model.key), /triangle contract/);
  assert.equal(preview.status, 'ready');
  assert.equal(preview.group.children[0], first.scene);
  assert.deepEqual(first.disposed, { geometry: 0, material: 0, texture: 0 });
  assert.deepEqual(broken.disposed, { geometry: 1, material: 1, texture: 1 });
  const invalid = fixture(); invalid.geometry.attributes.position.array[0] = NaN;
  assert.throws(() => deliveryModelEvidence(invalid.scene, model), /invalid positions/);
  disposeDeliveryModel(invalid.scene); preview.clear();
});
test('a GLB that settles with missing external maps or wrong channel color space cannot pass inspection', () => {
  const textured = models.find((item) => item.package === 'roof-surface-studies');
  const asset = fixture(textured.triangles);
  asset.material.name = textured.requiredMaps[0].material;
  assert.throws(() => deliveryModelEvidence(asset.scene, textured), /texture contract/);
  const maps = [];
  for (const requirement of textured.requiredMaps) {
    const texture = new THREE.Texture({ width: 512, height: 512 });
    texture.colorSpace = requirement.colorSpace;
    asset.material[requirement.channel] = texture; maps.push(texture);
  }
  assert.equal(deliveryModelEvidence(asset.scene, textured).triangles, textured.triangles);
  asset.material.normalMap.colorSpace = THREE.SRGBColorSpace;
  assert.throws(() => deliveryModelEvidence(asset.scene, textured), /texture contract/);
  maps.forEach((texture) => texture.dispose()); disposeDeliveryModel(asset.scene);
});
test('per-load dependency failure rejects a resolved GLTF and disposes it before publishing', async () => {
  const first = fixture(), broken = fixture();
  let loads = 0;
  const loader = async (url) => {
    if (!loads++) return first;
    return loadDeliveryGLTF(url, (manager) => ({ loadAsync: async () => {
      manager.onError('/__offline-assets/missing-map.png');
      return broken;
    } }));
  };
  const preview = new DeliveryModelPreview(() => false, loader);
  await preview.select(model.key);
  await assert.rejects(preview.select(model.key), /Delivered dependency failed.*missing-map/);
  assert.deepEqual(broken.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.deepEqual(first.disposed, { geometry: 0, material: 0, texture: 0 });
  assert.equal(preview.group.children[0], first.scene);
  assert.equal(preview.status, 'ready');
  preview.clear();
});
test('bounds evidence describes the frozen idle pose actually added to the scene', async () => {
  const asset = fixture();
  asset.animations = [new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 2, 0, 0, 2, 0])])];
  const preview = new DeliveryModelPreview(() => false, async () => asset);
  await preview.select(model.key);
  assert.equal(asset.scene.position.y, 2);
  assert.equal(preview.snapshot().evidence.bounds.min[1], 2);
  assert.equal(preview.snapshot().evidence.bounds.max[1], 3);
  preview.clear();
});
test('cleared, superseded or destroyed async loads never publish late resources', async () => {
  for (const outcome of ['clear', 'supersede', 'destroy']) {
    let resolve, unavailable = false;
    const old = fixture(), next = fixture();
    const preview = new DeliveryModelPreview(() => unavailable, () => new Promise((ready) => { resolve = ready; }));
    const pending = preview.select(model.key), ready = resolve;
    if (outcome === 'clear') preview.clear();
    if (outcome === 'destroy') unavailable = true;
    let replacement;
    if (outcome === 'supersede') { replacement = preview.select(model.key); resolve(next); await replacement; }
    ready(old);
    assert.equal(await pending, false);
    assert.deepEqual(old.disposed, { geometry: 1, material: 1, texture: 1 });
    assert.equal(preview.group.children.length, outcome === 'supersede' ? 1 : 0);
    preview.clear();
  }
});
test('engine geometry disposal closes imported skeleton textures and shared ImageBitmap once', async () => {
  const OriginalImageBitmap = globalThis.ImageBitmap;
  class Bitmap { closes = 0; close() { this.closes++; } }
  globalThis.ImageBitmap = Bitmap;
  try {
    const asset = fixture(), bitmap = new Bitmap();
    asset.texture.source.data = bitmap;
    const bone = new THREE.Bone(), skeleton = new THREE.Skeleton([bone]);
    skeleton.computeBoneTexture();
    let boneTextures = 0; skeleton.boneTexture.addEventListener('dispose', () => boneTextures++);
    const mesh = new THREE.SkinnedMesh(asset.geometry, asset.material);
    mesh.add(bone); mesh.bind(skeleton);
    asset.scene.clear(); asset.scene.add(mesh);
    const count = asset.geometry.attributes.position.count;
    asset.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
    asset.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const preview = new DeliveryModelPreview(() => false, async () => asset);
    assert.equal(await preview.select(model.key), true);
    assert.equal(preview.snapshot().evidence.skeletons, 1);
    asset.geometry.dispose(); asset.texture.dispose();
    assert.equal(bitmap.closes, 1);
    assert.equal(boneTextures, 1);
    preview.clear();
    assert.equal(bitmap.closes, 1);
    assert.equal(boneTextures, 1);
  } finally { globalThis.ImageBitmap = OriginalImageBitmap; }
});
