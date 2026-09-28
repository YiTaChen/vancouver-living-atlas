import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { makeCitizen } = await import(cityModule('citizen'));
const settle = () => new Promise((resolve) => setImmediate(resolve));

function asset() {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  material.map = new THREE.Texture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.name = 'Actor';
  scene.add(mesh);
  const animations = ['idle', 'walk', 'run'].map(
    (name) =>
      new THREE.AnimationClip(name, 1, [
        new THREE.NumberKeyframeTrack(
          'Actor.position[x]',
          [0, 0.5, 1],
          [0, 1, 0],
        ),
      ]),
  );
  return { scene, animations, mesh };
}

test('citizen keeps its public root and shadows when a single lazy load succeeds', async () => {
  const gltf = asset();
  let count = 0;
  const citizen = makeCitizen({
    load: async () => {
      count++;
      return gltf;
    },
  });
  const root = citizen.group;
  const contact = new THREE.Group();
  root.add(contact);
  root.position.set(4, 5, 6);
  root.visible = false;
  assert.equal(count, 0);
  citizen.update(0, false, 1 / 60, 0);
  citizen.update(0, false, 1 / 60, 0);
  await settle();
  assert.equal(count, 1);
  assert.equal(citizen.group, root);
  assert.equal(root.visible, false);
  assert.deepEqual(root.position.toArray(), [4, 5, 6]);
  assert.ok(root.children.includes(contact));
  assert.equal(root.userData.assetState, 'ready');
  assert.equal(gltf.mesh.castShadow, false);
  assert.equal(gltf.mesh.receiveShadow, true);
  assert.equal(root.children.length, 2);
  citizen.dispose();
});

test('locomotion uses distance even when frame time differs', async () => {
  const a = asset(),
    b = asset();
  const one = makeCitizen({ load: async () => a });
  const two = makeCitizen({ load: async () => b });
  one.update(0, false, 0, 0);
  two.update(0, false, 0, 0);
  await settle();
  for (let i = 0; i < 100; i++) {
    one.update(0.25, true, 0.016, 1.8);
    two.update(0.25, true, 0.032, 1.8);
  }
  assert.ok(Math.abs(a.mesh.position.x - 0.5) < 0.0001);
  assert.ok(Math.abs(a.mesh.position.x - b.mesh.position.x) < 0.0001);
  assert.deepEqual(one.group.position.toArray(), [0, 0, 0]);
  one.dispose();
  two.dispose();
});

test('failed loading retains the usable procedural citizen and never retries each frame', async () => {
  let requests = 0;
  const citizen = makeCitizen({
    load: async () => {
      requests++;
      throw new Error('offline');
    },
  });
  const fallback = citizen.group.children[0];
  citizen.update(0.2, true, 0.02, 1.8);
  await settle();
  citizen.update(0.4, true, 0.02, 1.8);
  assert.equal(requests, 1);
  assert.equal(citizen.group.userData.assetState, 'fallback-error');
  assert.ok(citizen.group.children.includes(fallback));
  citizen.dispose();
});

test('an asset resolving after disposal releases private GPU resources and never attaches', async () => {
  let resolve;
  const gltf = asset();
  const disposed = { geometry: 0, material: 0, texture: 0 };
  gltf.mesh.geometry.addEventListener('dispose', () => disposed.geometry++);
  gltf.mesh.material.addEventListener('dispose', () => disposed.material++);
  gltf.mesh.material.map.addEventListener('dispose', () => disposed.texture++);
  const citizen = makeCitizen({
    load: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  citizen.update(0, false);
  citizen.dispose();
  citizen.dispose();
  resolve(gltf);
  await settle();
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(citizen.group.children.length, 0);
  assert.equal(citizen.group.userData.assetState, 'disposed');
});

test('invalid animation packages keep fallback and dispose the rejected model', async () => {
  const gltf = asset();
  gltf.animations = [];
  let released = false;
  gltf.mesh.geometry.addEventListener('dispose', () => {
    released = true;
  });
  const citizen = makeCitizen({ load: async () => gltf });
  citizen.update(0, false);
  await settle();
  assert.equal(released, true);
  assert.equal(citizen.group.userData.assetState, 'fallback-error');
  assert.equal(citizen.group.children.length, 1);
  citizen.dispose();
});

for (const late of [false, true]) {
  test(`private ImageBitmaps close once on ${late ? 'late load completion' : 'regular disposal'}`, async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'ImageBitmap');
    class TestBitmap {
      closes = 0;
      close() {
        this.closes++;
      }
    }
    Object.defineProperty(globalThis, 'ImageBitmap', {
      configurable: true,
      writable: true,
      value: TestBitmap,
    });
    try {
      const gltf = asset();
      const sharedImage = new TestBitmap();
      const normalImage = new TestBitmap();
      gltf.mesh.material.map.image = sharedImage;
      gltf.mesh.material.roughnessMap = new THREE.Texture(sharedImage);
      gltf.mesh.material.metalnessMap = gltf.mesh.material.roughnessMap;
      gltf.mesh.material.normalMap = new THREE.Texture(normalImage);
      let resolve;
      const citizen = makeCitizen({
        load: () =>
          new Promise((done) => {
            resolve = done;
          }),
      });
      citizen.update(0, false);
      if (late) citizen.dispose();
      resolve(gltf);
      await settle();
      if (!late) {
        assert.equal(sharedImage.closes, 0);
        assert.equal(normalImage.closes, 0);
        citizen.dispose();
      }
      citizen.dispose();
      assert.equal(sharedImage.closes, 1);
      assert.equal(normalImage.closes, 1);
      assert.equal(citizen.group.children.length, 0);
    } finally {
      if (original) Object.defineProperty(globalThis, 'ImageBitmap', original);
      else delete globalThis.ImageBitmap;
    }
  });
}
