import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { makeWalker } = await import(cityModule('assets/walker'));
const { makeCitizen } = await import(cityModule('citizen'));
const bytes = await readFile(
  new URL('../public/models/citizen/vancouver-citizen.glb', import.meta.url),
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function asset() {
  const loader = new GLTFLoader();
  loader.register(() => ({
    name: 'CPU_SEAT_TEST',
    loadTexture: async () => new THREE.Texture(),
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}
const near = (actual, expected, label, tolerance = 0.002) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label}: ${actual} vs ${expected}`,
  );
function joint(actor, name) {
  return actor.group.worldToLocal(
    actor.group.getObjectByName(name).getWorldPosition(new THREE.Vector3()),
  );
}
function skinBounds(actor, mesh) {
  actor.group.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bounds = new THREE.Box3();
  const soles = [Infinity, Infinity];
  const positions = mesh.geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    mesh.applyBoneTransform(i, point);
    actor.group.worldToLocal(point.applyMatrix4(mesh.matrixWorld));
    bounds.expandByPoint(point);
    if (positions.getY(i) < 0.025) {
      const side = Number(positions.getX(i) > 0);
      soles[side] = Math.min(soles[side], point.y);
    }
  }
  return { bounds, soles };
}
function rootState(group) {
  return [
    group.position.toArray(),
    group.quaternion.toArray(),
    group.scale.toArray(),
  ];
}

test('procedural seat bends both knees, grounds shoes and restores the standing pose', () => {
  const actor = makeWalker();
  actor.group.position.set(7, 2, -9);
  actor.group.rotation.y = 1.1;
  const transform = rootState(actor.group);
  for (const height of [0.46, 0.6]) {
    actor.setSeated(true, height);
    actor.update(10, true);
    near(
      joint(actor, 'Jacket, shoulders and backpack').y,
      height + 0.085,
      'pelvis',
    );
    for (const side of ['Left', 'Right']) {
      const hip = joint(actor, `${side} thigh`);
      const knee = joint(actor, `${side} shin`);
      const ankle = joint(actor, `${side} shoe`);
      assert.ok(knee.z > 0.3 && knee.y < hip.y);
      near(hip.distanceTo(knee), 0.42, 'thigh length');
      near(knee.distanceTo(ankle), 0.405, 'shin length');
      const shoe = actor.group.getObjectByName(`${side} shoe`);
      const bounds = new THREE.Box3().setFromObject(shoe);
      near(bounds.min.y, actor.group.position.y, 'shoe sole', 0.001);
    }
    const thigh = actor.group
      .getObjectByName('Left thigh')
      .quaternion.toArray();
    actor.update(20.7, true);
    assert.deepEqual(
      actor.group.getObjectByName('Left thigh').quaternion.toArray(),
      thigh,
    );
    assert.deepEqual(rootState(actor.group), transform);
  }
  actor.setSeated(false);
  near(
    joint(actor, 'Jacket, shoulders and backpack').y,
    0.91,
    'standing pelvis',
  );
  assert.deepEqual(rootState(actor.group), transform);
});

test('actual citizen skin sits on the cushion with forward thighs and floor-level soles', async () => {
  const gltf = await asset();
  const actor = makeCitizen({ load: async () => gltf });
  actor.group.position.set(7, 2, -9);
  actor.group.rotation.y = 1.1;
  const transform = rootState(actor.group);
  actor.update(0, false, 0, 0);
  await settle();
  const mesh = actor.group.getObjectByProperty('type', 'SkinnedMesh');
  for (const height of [0.46, 0.6]) {
    actor.setSeated(true, height);
    near(joint(actor, 'hips').y, height + 0.09, 'pelvis on cushion');
    for (const side of ['L', 'R']) {
      const hip = joint(actor, `thigh${side}`);
      const knee = joint(actor, `shin${side}`);
      const ankle = joint(actor, `foot${side}`);
      assert.ok(knee.z > 0.3 && knee.y < hip.y);
      near(hip.distanceTo(knee), 0.425118, 'thigh length');
      near(knee.distanceTo(ankle), 0.376044, 'shin length');
      assert.ok(joint(actor, `toe${side}`).z > ankle.z);
      assert.ok(joint(actor, `hand${side}`).z > 0.25);
    }
    const { bounds, soles } = skinBounds(actor, mesh);
    assert.ok(bounds.max.y < 1.7, `seated head height ${bounds.max.y}`);
    for (const sole of soles) near(sole, 0, 'real skinned shoe sole', 0.006);
    const knee = joint(actor, 'shinL');
    actor.update(123, true, 0.1, 10);
    assert.ok(joint(actor, 'shinL').distanceTo(knee) < 1e-8);
    assert.deepEqual(rootState(actor.group), transform);
  }
  actor.setSeated(false);
  assert.ok(joint(actor, 'hips').y > 0.9);
  for (const sole of skinBounds(actor, mesh).soles)
    near(sole, 0, 'restored sole', 0.01);
  const idleKnee = joint(actor, 'shinL');
  for (let i = 0; i < 20; i++) actor.update(123.2, true, 0.1, 1.8);
  assert.ok(joint(actor, 'shinL').distanceTo(idleKnee) > 0.03);
  assert.deepEqual(rootState(actor.group), transform);
  actor.dispose();
});

test('a citizen seated during loading keeps the pose when the real skin arrives', async () => {
  const gltf = await asset();
  let resolve;
  const actor = makeCitizen({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  actor.setSeated(true, 0.51);
  actor.update(0, true, 0.1, 3);
  near(
    joint(actor, 'Jacket, shoulders and backpack').y,
    0.595,
    'fallback pelvis',
  );
  resolve(gltf);
  await settle();
  assert.equal(actor.group.userData.assetState, 'ready');
  assert.equal(actor.group.userData.seated, true);
  near(joint(actor, 'hips').y, 0.6, 'late-loaded pelvis');
  assert.ok(joint(actor, 'shinL').z > 0.3);
  actor.setSeated(false);
  actor.setSeated(true, NaN);
  near(joint(actor, 'hips').y, 0.55, 'invalid seat height defaults safely');
  actor.dispose();
  actor.setSeated(true);
  assert.equal(actor.group.children.length, 0);
});
