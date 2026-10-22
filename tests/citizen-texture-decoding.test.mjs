import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { makeCitizen } = await import(cityModule('citizen'));
const path = '/models/citizen/vancouver-citizen.glb';
const bytes = readFileSync('public' + path);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const expectedAssetHash =
  '14d66fabe097abf82ef36800561c06ee7263c0acfd6b5ea1265a40ed35841ff8';
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryStart = 28 + jsonLength;
const pngHashes = json.images.map((image) => {
  const view = json.bufferViews[image.bufferView];
  return hash(
    bytes.subarray(
      binaryStart + (view.byteOffset ?? 0),
      binaryStart + (view.byteOffset ?? 0) + view.byteLength,
    ),
  );
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function settled(citizen) {
  for (let i = 0; i < 100; i++) {
    if (citizen.group.userData.assetState !== 'loading') return;
    await settle();
  }
  assert.fail('Citizen default loader did not settle');
}

/** Exercise the real shipping GLB and production decoder. Only browser PNG
 * decoding is substituted; img.src receives each exact embedded PNG, while
 * the real GLTF parser retains its original material/skin/animation behavior. */
async function imageHarness(action, { failImage = false, defer = false } = {}) {
  const saved = [],
    urls = new Map(),
    images = [],
    pending = [],
    fetches = [];
  let created = 0,
    revoked = 0,
    bitmapCalls = 0;
  const replace = (target, name, value) => {
    saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value,
    });
  };
  class ImageFixture {
    listeners = new Map();
    width = 0;
    height = 0;
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    removeEventListener(type) {
      this.listeners.delete(type);
    }
    set src(url) {
      const blob = urls.get(url);
      assert(blob, 'the image element receives an owned embedded object URL');
      const reject = failImage && images.length === 0;
      images.push(this);
      const decode = async () => {
        const array = await blob.arrayBuffer();
        const imageBytes = Buffer.from(array);
        assert.equal(blob.type, 'image/png');
        assert.equal(
          imageBytes.subarray(0, 8).toString('hex'),
          '89504e470d0a1a0a',
        );
        this.width = imageBytes.readUInt32BE(16);
        this.height = imageBytes.readUInt32BE(20);
        this.pngSha256 = hash(imageBytes);
        assert.equal(this.width, 1024);
        assert.equal(this.height, 1024);
        this.listeners
          .get(reject ? 'error' : 'load')
          ?.call(
            this,
            reject
              ? new Error('recorded citizen PNG decode failure')
              : undefined,
          );
      };
      if (defer) pending.push(decode);
      else void decode();
    }
  }
  replace(globalThis, 'self', globalThis);
  replace(globalThis, 'createImageBitmap', () => {
    bitmapCalls++;
    throw new Error(
      'Citizen object URLs must use img-src, not bitmap/blob fetch',
    );
  });
  replace(globalThis, 'document', {
    createElementNS(_namespace, tag) {
      assert.equal(tag, 'img');
      return new ImageFixture();
    },
  });
  replace(URL, 'createObjectURL', (blob) => {
    const url = `blob:https://atlas.invalid/citizen-${++created}`;
    urls.set(url, blob);
    return url;
  });
  replace(URL, 'revokeObjectURL', (url) => {
    assert(urls.delete(url), 'every owned embedded image URL is revoked once');
    revoked++;
  });
  replace(globalThis, 'fetch', async (url) => {
    const requested = String(url);
    fetches.push(requested);
    assert.equal(
      requested.split('?')[0],
      path,
      'connect-src fetches only the same-origin GLB',
    );
    assert.equal(
      hash(bytes),
      expectedAssetHash,
      'shipping asset bytes are unchanged',
    );
    return new Response(bytes);
  });
  try {
    await action({
      images,
      pending,
      fetches,
      urls,
      stats: () => ({ created, revoked, bitmapCalls }),
    });
  } finally {
    for (const [target, name, descriptor] of saved.reverse()) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  }
}
function recordDisposals() {
  const originals = [],
    counts = new Map();
  for (const type of [
    THREE.BufferGeometry,
    THREE.Material,
    THREE.Texture,
    THREE.Skeleton,
  ]) {
    const original = type.prototype.dispose;
    originals.push([type, original]);
    type.prototype.dispose = function () {
      counts.set(this, (counts.get(this) ?? 0) + 1);
      return original.call(this);
    };
  }
  return {
    counts,
    restore() {
      for (const [type, original] of originals)
        type.prototype.dispose = original;
    },
  };
}

test('the real default citizen loader preserves all three exact embedded PNG/PBR maps without ImageBitmap or blob fetch', async () => {
  await imageHarness(async ({ images, fetches, urls, stats }) => {
    const citizen = makeCitizen();
    try {
      citizen.setSeated(true, 0.509);
      citizen.update(0, false, 0, 0);
      await settled(citizen);
      assert.equal(citizen.group.userData.assetState, 'ready');
      assert.equal(
        citizen.group.userData.seated,
        true,
        'late image decoding retains the seated pose',
      );
      const mesh = citizen.group.getObjectByProperty('type', 'SkinnedMesh');
      assert(mesh);
      const material = mesh.material;
      assert.equal(material.name, 'Citizen PBR atlas');
      assert.equal(material.metalness, 0);
      assert(material.map instanceof THREE.Texture);
      assert(material.normalMap instanceof THREE.Texture);
      assert(material.roughnessMap instanceof THREE.Texture);
      assert.equal(material.map.image.pngSha256, pngHashes[1]);
      assert.equal(material.normalMap.image.pngSha256, pngHashes[0]);
      assert.equal(material.roughnessMap.image.pngSha256, pngHashes[2]);
      assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
      assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
      for (const map of [
        material.map,
        material.normalMap,
        material.roughnessMap,
      ]) {
        assert.equal(map.flipY, false);
        assert.equal(map.wrapS, THREE.RepeatWrapping);
        assert.equal(map.wrapT, THREE.RepeatWrapping);
      }
      assert.equal(images.length, 3);
      assert.equal(fetches.length, 1);
      assert.equal(stats().bitmapCalls, 0);
      assert.equal(stats().created, stats().revoked);
      assert.equal(urls.size, 0);
    } finally {
      citizen.dispose();
    }
  });
});

test('a default citizen image error fails closed, releases partial PBR resources and keeps the usable seated fallback without retrying each frame', async () => {
  await imageHarness(
    async ({ fetches, urls, stats }) => {
      const originalError = console.error,
        errors = [],
        disposed = recordDisposals();
      console.error = (...args) => errors.push(args.map(String).join(' '));
      const citizen = makeCitizen();
      try {
        const fallback = citizen.group.children[0];
        citizen.setSeated(true, 0.509);
        citizen.update(0, false, 0, 0);
        await settled(citizen);
        assert.equal(citizen.group.userData.assetState, 'fallback-error');
        assert.match(
          citizen.group.userData.assetError,
          /Citizen texture decode failed/,
        );
        assert(citizen.group.children.includes(fallback));
        assert.equal(fallback.userData.seated, true);
        assert(errors.some((line) => line.includes("Couldn't load texture")));
        assert(
          [...disposed.counts.keys()].some(
            (value) => value instanceof THREE.BufferGeometry,
          ),
        );
        assert(
          [...disposed.counts.keys()].some(
            (value) => value instanceof THREE.Material,
          ),
        );
        assert(
          [...disposed.counts.keys()].some(
            (value) => value instanceof THREE.Skeleton,
          ),
        );
        assert.equal(
          [...disposed.counts.keys()].filter(
            (value) => value instanceof THREE.Texture,
          ).length,
          2,
        );
        assert.equal(urls.size, 0);
        assert.equal(stats().created, stats().revoked);
        assert.equal(stats().bitmapCalls, 0);
        citizen.update(1, true, 0.016, 4);
        assert.equal(fetches.length, 1);
        citizen.dispose();
        citizen.dispose();
        assert([...disposed.counts.values()].every((count) => count === 1));
      } finally {
        citizen.dispose();
        console.error = originalError;
        disposed.restore();
      }
    },
    { failImage: true },
  );
});

test('a default citizen decode finishing after disposal releases its private maps and never attaches the model', async () => {
  await imageHarness(
    async ({ pending, urls, stats }) => {
      const disposed = recordDisposals();
      const citizen = makeCitizen();
      try {
        citizen.update(0, false, 0, 0);
        for (let i = 0; i < 100 && pending.length < 3; i++) await settle();
        assert.equal(pending.length, 3);
        citizen.dispose();
        await Promise.all(pending.map((decode) => decode()));
        for (let i = 0; i < 100 && urls.size; i++) await settle();
        await settle();
        assert.equal(citizen.group.userData.assetState, 'disposed');
        assert.equal(citizen.group.children.length, 0);
        assert.equal(urls.size, 0);
        assert.equal(stats().created, stats().revoked);
        assert.equal(stats().bitmapCalls, 0);
        assert.equal(
          [...disposed.counts.keys()].filter(
            (value) => value instanceof THREE.Texture,
          ).length,
          3,
        );
        assert([...disposed.counts.values()].every((count) => count === 1));
      } finally {
        citizen.dispose();
        disposed.restore();
      }
    },
    { defer: true },
  );
});
