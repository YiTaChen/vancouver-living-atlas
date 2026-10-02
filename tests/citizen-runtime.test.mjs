import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { makeCitizen, selectCitizenAssetForQA } = await import(
  cityModule('citizen')
);
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

async function withCitizenQA(run) {
  const previous = process.env.VANCOUVER_VISUAL_QA;
  process.env.VANCOUVER_VISUAL_QA = '1';
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = previous;
  }
}

test('candidate switching is gated and normal loading uses the accepted 1024 asset', async () => {
  const previous = process.env.VANCOUVER_VISUAL_QA;
  process.env.VANCOUVER_VISUAL_QA = '0';
  const urls = [];
  const citizen = makeCitizen({
    load: async (url) => {
      urls.push(url);
      return asset();
    },
  });
  try {
    await assert.rejects(
      selectCitizenAssetForQA(citizen.group, 'baseline-2048'),
      /local visual QA/,
    );
    citizen.update(0, false, 0, 0);
    await settle();
    assert.deepEqual(urls, [
      '/models/citizen/vancouver-citizen.glb?v=14d66fabe097',
    ]);
    assert.equal(citizen.group.userData.assetVariant, 'candidate-1024');
  } finally {
    citizen.dispose();
    if (previous === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = previous;
  }
});

test('QA swaps preserve root, contact shadow and current gait while disposing the old model', () =>
  withCitizenQA(async () => {
    const original = asset(),
      candidate = asset();
    const urls = [];
    let disposed = 0;
    original.mesh.geometry.addEventListener('dispose', () => disposed++);
    const citizen = makeCitizen({
      load: async (url) => {
        urls.push(url);
        return urls.length === 1 ? original : candidate;
      },
    });
    const root = citizen.group,
      shadow = new THREE.Group();
    root.add(shadow);
    root.position.set(4, 5, 6);
    citizen.update(0, false, 0, 0);
    await settle();
    for (let i = 0; i < 100; i++) citizen.update(0.25, true, 0.016, 1.8);
    const x = original.mesh.position.x;
    assert.equal(
      await selectCitizenAssetForQA(root, 'baseline-2048'),
      'baseline-2048',
    );
    assert.equal(citizen.group, root);
    assert.deepEqual(root.position.toArray(), [4, 5, 6]);
    assert.ok(root.children.includes(shadow));
    assert.ok(root.children.includes(candidate.scene));
    assert.ok(!root.children.includes(original.scene));
    assert.equal(disposed, 1);
    assert.ok(Math.abs(candidate.mesh.position.x - x) < 1e-6);
    assert.equal(candidate.mesh.castShadow, false);
    assert.equal(candidate.mesh.receiveShadow, true);
    assert.equal(root.userData.assetState, 'ready');
    assert.deepEqual(urls, [
      '/models/citizen/vancouver-citizen.glb?v=14d66fabe097',
      '/__offline-assets/citizen/runtime-reference/vancouver-citizen-2048.glb',
    ]);
    await selectCitizenAssetForQA(root, 'baseline-2048');
    assert.equal(urls.length, 2);
    citizen.dispose();
  }));

test('failed QA swaps retain the last validated citizen and do not retry per frame', () =>
  withCitizenQA(async () => {
    const original = asset();
    let calls = 0;
    const citizen = makeCitizen({
      load: async () => {
        if (++calls === 1) return original;
        throw new Error('comparison unavailable');
      },
    });
    citizen.update(0, false, 0, 0);
    await settle();
    await assert.rejects(
      selectCitizenAssetForQA(citizen.group, 'baseline-2048'),
      /failed/,
    );
    citizen.update(0.4, true, 0.02, 4);
    assert.equal(calls, 2);
    assert.ok(citizen.group.children.includes(original.scene));
    assert.equal(citizen.group.userData.assetVariant, 'candidate-1024');
    assert.equal(citizen.group.userData.assetState, 'ready');
    assert.match(citizen.group.userData.assetError, /comparison unavailable/);
    citizen.dispose();
  }));

for (const destroy of [false, true])
  test(`late QA asset is disposed after ${destroy ? 'navigator destruction' : 'a newer selection'}`, () =>
    withCitizenQA(async () => {
      const original = asset(),
        late = asset(),
        replacement = asset();
      let resolve,
        calls = 0,
        released = 0;
      late.mesh.geometry.addEventListener('dispose', () => released++);
      const citizen = makeCitizen({
        load: () => {
          calls++;
          return calls === 1
            ? Promise.resolve(original)
            : calls === 2
              ? new Promise((done) => (resolve = done))
              : Promise.resolve(replacement);
        },
      });
      citizen.update(0, false, 0, 0);
      await settle();
      const pending = selectCitizenAssetForQA(citizen.group, 'baseline-2048');
      const rejected = assert.rejects(pending, /superseded/);
      assert.ok(citizen.group.children.includes(original.scene));
      if (destroy) citizen.dispose();
      else await selectCitizenAssetForQA(citizen.group, 'candidate-1024');
      resolve(late);
      await rejected;
      assert.equal(released, 1);
      assert.ok(!citizen.group.children.includes(late.scene));
      if (!destroy) {
        assert.ok(citizen.group.children.includes(replacement.scene));
        assert.equal(citizen.group.userData.assetVariant, 'candidate-1024');
        citizen.dispose();
      }
      assert.equal(citizen.group.children.length, 0);
    }));

test('a rejected first comparison pose leaves the previous mixer usable', () =>
  withCitizenQA(async () => {
    const original = asset(),
      broken = asset();
    let calls = 0,
      released = 0;
    broken.mesh.geometry.addEventListener('dispose', () => released++);
    const citizen = makeCitizen({
      load: async () => (++calls === 1 ? original : broken),
    });
    citizen.update(0, false, 0, 0);
    await settle();
    const update = THREE.AnimationMixer.prototype.update;
    THREE.AnimationMixer.prototype.update = function (delta) {
      if (this.getRoot() === broken.scene)
        throw new Error('unusable comparison pose');
      return update.call(this, delta);
    };
    try {
      await assert.rejects(
        selectCitizenAssetForQA(citizen.group, 'baseline-2048'),
        /failed/,
      );
      for (let i = 0; i < 100; i++) citizen.update(0.25, true, 0.016, 1.8);
      assert.ok(Math.abs(original.mesh.position.x - 0.5) < 1e-4);
      assert.equal(citizen.group.userData.assetVariant, 'candidate-1024');
      assert.ok(citizen.group.children.includes(original.scene));
      assert.equal(released, 1);
    } finally {
      THREE.AnimationMixer.prototype.update = update;
      citizen.dispose();
    }
  }));
