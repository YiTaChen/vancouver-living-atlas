import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function load(path) {
  const bytes = await readFile(new URL(path, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = bytes.subarray(28 + jsonLength);
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'CPU_CITIZEN_CANDIDATE',
    loadTexture: async () => new THREE.Texture(),
  }));
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  return {
    bytes,
    json,
    binary,
    gltf,
    mesh: gltf.scene.getObjectByProperty('type', 'SkinnedMesh'),
  };
}
const baseline = await load(
  '../tools/assets/citizen/runtime-reference/vancouver-citizen-2048.glb',
);
const candidate = await load('../public/models/citizen/vancouver-citizen.glb');
const metadata = JSON.parse(
  await readFile(
    new URL('../public/models/citizen/metadata.json', import.meta.url),
    'utf8',
  ),
);
const manifest = JSON.parse(
  await readFile(
    new URL(
      '../tools/assets/citizen/optimization/manifest.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('production citizen is the accepted LOD0 and reduces texture/download cost without extra material draws', () => {
  assert.equal(sha(baseline.bytes), manifest.sourceSha256);
  assert.equal(
    sha(candidate.bytes),
    '14d66fabe097abf82ef36800561c06ee7263c0acfd6b5ea1265a40ed35841ff8',
  );
  assert.equal(
    metadata.vertices,
    candidate.mesh.geometry.attributes.position.count,
  );
  assert.equal(metadata.vertices, 29063);
  assert.equal(metadata.textureSize, 1024);
  assert.equal(metadata.exportedBytes, candidate.bytes.length);
  assert.equal(metadata.exportedBytes, 3498312);
  assert.equal(metadata.gpuTextureEstimateMiB, 16);
  assert.equal(metadata.provenance.originalSha256, sha(baseline.bytes));
  assert.equal(metadata.provenance.acceptedSha256, sha(candidate.bytes));
  assert.equal(
    sha(candidate.bytes),
    manifest.assets.find((a) => a.id === 'lod0').glbSha256,
  );
  for (const [asset, size] of [
    [baseline, 2048],
    [candidate, 1024],
  ]) {
    assert.equal(asset.json.materials.length, 1);
    assert.equal(asset.json.meshes.flatMap((m) => m.primitives).length, 1);
    assert.equal(asset.json.skins[0].joints.length, 22);
    assert.equal(asset.json.images.length, 3);
    for (const image of asset.json.images) {
      assert.equal(image.mimeType, 'image/png');
      const view = asset.json.bufferViews[image.bufferView];
      const png = asset.binary.subarray(
        view.byteOffset,
        view.byteOffset + view.byteLength,
      );
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  }
  assert.ok(candidate.bytes.length < baseline.bytes.length * 0.53);
  assert.equal(candidate.mesh.geometry.index.count / 3, 37799);
  assert.equal(
    candidate.mesh.geometry.index.count,
    baseline.mesh.geometry.index.count,
  );
});

test('LOD0 preserves source triangles and UV despite harmless export vertex splits', (t) => {
  const buckets = new Map(),
    referenceVertices = [];
  const epsilon = 1e-6,
    cell = 0.001;
  const read = (mesh, index) => {
    const p = mesh.geometry.attributes.position,
      uv = mesh.geometry.attributes.uv;
    return [
      p.getX(index),
      p.getY(index),
      p.getZ(index),
      uv.getX(index),
      uv.getY(index),
    ];
  };
  const bucketKey = (v) => v.slice(0, 3).map((n) => Math.floor(n / cell));
  function find(v) {
    const [x, y, z] = bucketKey(v);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const id of buckets.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
            const reference = referenceVertices[id];
            if (v.every((n, i) => Math.abs(n - reference[i]) < epsilon))
              return id;
          }
    return -1;
  }
  const baselineIds = [];
  for (let i = 0; i < baseline.mesh.geometry.attributes.position.count; i++) {
    const v = read(baseline.mesh, i);
    let id = find(v);
    if (id < 0) {
      id = referenceVertices.length;
      referenceVertices.push(v);
      const key = bucketKey(v).join(',');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(id);
    }
    baselineIds.push(id);
  }
  const candidateIds = [];
  let maximumDifference = 0;
  for (let i = 0; i < candidate.mesh.geometry.attributes.position.count; i++) {
    const v = read(candidate.mesh, i),
      id = find(v);
    assert.ok(
      id >= 0,
      `candidate vertex ${i} has no corresponding source position/UV`,
    );
    maximumDifference = Math.max(
      maximumDifference,
      ...v.map((n, j) => Math.abs(n - referenceVertices[id][j])),
    );
    candidateIds.push(id);
  }
  const signatures = (mesh, ids) => {
    const index = mesh.geometry.index,
      result = [];
    for (let i = 0; i < index.count; i += 3)
      result.push(
        [0, 1, 2]
          .map((j) => ids[index.getX(i + j)])
          .sort((a, b) => a - b)
          .join(','),
      );
    return result.sort();
  };
  const a = signatures(baseline.mesh, baselineIds),
    b = signatures(candidate.mesh, candidateIds);
  assert.equal(a.length, b.length);
  assert.equal(
    a.filter((key, i) => key !== b[i]).length,
    0,
    'every source triangle remains connected to the same positions/UVs',
  );
  t.diagnostic(
    `maximum matched position/UV scalar difference ${maximumDifference}`,
  );
});

test('LOD0 preserves clip duration, bone order and all sampled world transforms', (t) => {
  const a = baseline.mesh,
    b = candidate.mesh;
  assert.deepEqual(
    a.skeleton.bones.map((b) => b.name),
    b.skeleton.bones.map((b) => b.name),
  );
  let maximumDifference = 0;
  for (const name of ['idle', 'walk', 'run']) {
    const ac = baseline.gltf.animations.find((c) => c.name === name),
      bc = candidate.gltf.animations.find((c) => c.name === name);
    assert.ok(ac && bc);
    assert.ok(Math.abs(ac.duration - bc.duration) < 1e-6);
    const am = new THREE.AnimationMixer(baseline.gltf.scene),
      bm = new THREE.AnimationMixer(candidate.gltf.scene);
    am.clipAction(ac).play();
    bm.clipAction(bc).play();
    for (let sample = 0; sample < 40; sample++) {
      am.setTime((ac.duration * sample) / 40);
      bm.setTime((bc.duration * sample) / 40);
      baseline.gltf.scene.updateMatrixWorld(true);
      candidate.gltf.scene.updateMatrixWorld(true);
      for (let bone = 0; bone < a.skeleton.bones.length; bone++)
        for (let element = 0; element < 16; element++)
          maximumDifference = Math.max(
            maximumDifference,
            Math.abs(
              a.skeleton.bones[bone].matrixWorld.elements[element] -
                b.skeleton.bones[bone].matrixWorld.elements[element],
            ),
          );
    }
    am.stopAllAction();
    am.uncacheRoot(baseline.gltf.scene);
    bm.stopAllAction();
    bm.uncacheRoot(candidate.gltf.scene);
  }
  assert.ok(maximumDifference < 1e-5);
  t.diagnostic(
    `120 poses ×22 bones; maximum matrix difference ${maximumDifference}`,
  );
});
