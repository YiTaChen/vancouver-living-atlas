import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { makeCitizen } = await import(cityModule('citizen'));
const { makeWalker } = await import(cityModule('assets/walker'));
const bytes = await readFile(
  new URL('../public/models/citizen/vancouver-citizen.glb', import.meta.url),
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function asset() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'CPU_CHARACTER_TEST',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}

test('female switching preserves the live actor, gait and skin colors and restores the original male surface', async () => {
  const gltf = await asset();
  let requests = 0;
  const actor = makeCitizen({
    load: async () => {
      requests++;
      return gltf;
    },
  });
  actor.update(0, false, 0, 0);
  await settle();
  const root = actor.group;
  root.position.set(7, 3, -9);
  root.rotation.y = 0.7;
  const contact = new THREE.Group();
  root.add(contact);
  const mesh = root.getObjectByProperty('type', 'SkinnedMesh');
  const originalPositions = mesh.geometry.attributes.position.array.slice();
  const originalNormals = mesh.geometry.attributes.normal.array.slice();
  const originalVertexColors = mesh.material.vertexColors;
  for (let i = 0; i < 30; i++) actor.update(0.27, true, 0.02, 1.8);
  const knee = root.getObjectByName('shinL').quaternion.toArray();
  actor.setCharacter('female');
  assert.equal(actor.group, root);
  assert.equal(root.userData.character, 'female');
  assert.equal(requests, 1);
  assert.ok(root.children.includes(contact));
  assert.deepEqual(root.position.toArray(), [7, 3, -9]);
  assert.deepEqual(root.getObjectByName('shinL').quaternion.toArray(), knee);
  assert.notDeepEqual(
    mesh.geometry.attributes.position.array,
    originalPositions,
  );
  const colors = mesh.geometry.attributes.color;
  const p = mesh.geometry.attributes.position;
  let recolored = 0,
    protectedVertices = 0;
  for (let i = 0; i < p.count; i++) {
    if (colors.getX(i) !== 1) recolored++;
    if (p.getY(i) > 1.55 || (p.getY(i) < 0.82 && Math.abs(p.getX(i)) > 0.23)) {
      assert.deepEqual(
        [colors.getX(i), colors.getY(i), colors.getZ(i)],
        [1, 1, 1],
      );
      protectedVertices++;
    }
  }
  assert.ok(recolored > 1000, 'the rain shell receives a distinct color');
  assert.ok(
    protectedVertices > 1000,
    'face and hands retain baked skin colors',
  );
  const hair = root.getObjectByName('Female citizen — tied hair');
  assert.equal(hair.parent.name, 'head');
  assert.equal(hair.visible, true);
  actor.setCharacter('male');
  assert.equal(hair.visible, false);
  assert.deepEqual(mesh.geometry.attributes.position.array, originalPositions);
  assert.deepEqual(mesh.geometry.attributes.normal.array, originalNormals);
  assert.equal(mesh.geometry.attributes.color, undefined);
  assert.equal(mesh.material.vertexColors, originalVertexColors);
  assert.deepEqual(root.getObjectByName('shinL').quaternion.toArray(), knee);
  actor.setCharacter('female');
  assert.equal(
    mesh.geometry.attributes.color,
    colors,
    'repeated switches reuse one GPU color buffer',
  );
  actor.setCharacter('male');
  let releasedColor;
  mesh.geometry.addEventListener('dispose', () => {
    releasedColor = mesh.geometry.attributes.color;
  });
  actor.dispose();
  assert.equal(
    releasedColor,
    colors,
    'the alternate color buffer remains owned through final disposal',
  );
});

test('first selecting female while seated uses the head bind transform and retains floor-level soles', async () => {
  const gltf = await asset();
  const actor = makeCitizen({ load: async () => gltf });
  actor.update(0, false, 0, 0);
  await settle();
  actor.setSeated(true, 0.51);
  actor.setCharacter('female');
  const mesh = actor.group.getObjectByProperty('type', 'SkinnedMesh');
  const hair = actor.group.getObjectByName('Female citizen — tied hair');
  const headIndex = mesh.skeleton.bones.findIndex(
    (bone) => bone.name === 'head',
  );
  const expected = mesh.skeleton.boneInverses[headIndex]
    .clone()
    .multiply(mesh.bindMatrix);
  hair.updateMatrix();
  for (let i = 0; i < 16; i++)
    assert.ok(Math.abs(hair.matrix.elements[i] - expected.elements[i]) < 1e-7);
  actor.group.updateMatrixWorld(true);
  mesh.skeleton.update();
  const positions = mesh.geometry.attributes.position;
  const point = new THREE.Vector3();
  let sole = Infinity;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) > 0.025) continue;
    point.fromBufferAttribute(positions, i);
    mesh.applyBoneTransform(i, point);
    sole = Math.min(sole, point.y);
  }
  assert.ok(Math.abs(sole) < 0.006, `seated female sole ${sole}`);
  assert.equal(actor.group.userData.seated, true);
  actor.setSeated(false);
  assert.ok(actor.group.getObjectByName('hips').position.length() > 0);
  actor.dispose();
});

test('female selection during a pending load is applied when the validated skin arrives', async () => {
  let resolve;
  const gltf = await asset();
  const actor = makeCitizen({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  actor.update(0, false);
  actor.setCharacter('female');
  assert.equal(actor.group.children[0].userData.character, 'female');
  resolve(gltf);
  await settle();
  assert.equal(actor.group.userData.assetState, 'ready');
  assert.equal(actor.group.userData.character, 'female');
  assert.equal(
    actor.group.getObjectByName('Female citizen — tied hair').visible,
    true,
  );
  const resources = new Set();
  actor.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      resources.add(material);
  });
  let disposed = 0;
  for (const resource of resources)
    resource.addEventListener('dispose', () => disposed++);
  actor.dispose();
  actor.dispose();
  assert.equal(disposed, resources.size);
});

test('compatible walker switching retains its root, contact shadow, seat and grounded shoes', () => {
  const actor = makeWalker();
  const root = actor.group;
  root.position.set(7, 2, -9);
  root.rotation.y = 0.7;
  const contact = new THREE.Group();
  root.add(contact);
  actor.setSeated(true, 0.51);
  let disposed = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh)
      object.geometry.addEventListener('dispose', () => disposed++);
  });
  actor.setCharacter('female');
  assert.equal(actor.group, root);
  assert.ok(root.children.includes(contact));
  assert.deepEqual(root.position.toArray(), [7, 2, -9]);
  assert.equal(root.userData.character, 'female');
  assert.equal(root.userData.seated, true);
  assert.ok(disposed > 0);
  for (const side of ['Left', 'Right']) {
    const shoe = root.getObjectByName(`${side} shoe`);
    assert.ok(Math.abs(new THREE.Box3().setFromObject(shoe).min.y - 2) < 0.001);
  }
  actor.setCharacter('male');
  assert.equal(root.userData.character, 'male');
  assert.equal(root.userData.seated, true);
  assert.ok(root.children.includes(contact));
});

test('compatible character switching preserves the current movement blend and stride pose', () => {
  const actor = makeWalker();
  for (let i = 0; i < 100; i++) actor.update(0.27, true);
  const thigh = actor.group.getObjectByName('Left thigh').quaternion.toArray();
  const shin = actor.group.getObjectByName('Left shin').quaternion.toArray();
  actor.setCharacter('female');
  assert.deepEqual(
    actor.group.getObjectByName('Left thigh').quaternion.toArray(),
    thigh,
  );
  assert.deepEqual(
    actor.group.getObjectByName('Left shin').quaternion.toArray(),
    shin,
  );
  actor.setCharacter('male');
  assert.deepEqual(
    actor.group.getObjectByName('Left thigh').quaternion.toArray(),
    thigh,
  );
  assert.deepEqual(
    actor.group.getObjectByName('Left shin').quaternion.toArray(),
    shin,
  );
});
