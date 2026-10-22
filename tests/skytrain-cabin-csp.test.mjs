import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainCabinAssets } = await import(
  cityModule('skytrain-cabin-assets')
);
const base = '/models/blender/metro/';
const manifest = JSON.parse(readFileSync(`public${base}manifest.json`, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Real default loader and GLTF parser. Substitute only the browser's image
 * decode, checking that it receives the exact embedded PNG bytes via img.src.
 * A separate actual HTTP-CSP browser acceptance covers the native decoder. */
async function imageHarness(action, failImage = false) {
  const saved = [],
    urls = new Map(),
    images = [],
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
      assert(blob, 'image decoding receives an owned embedded object URL');
      const reject = failImage && images.length === 0;
      images.push(this);
      void blob.arrayBuffer().then((array) => {
        const bytes = Buffer.from(array);
        assert.equal(blob.type, 'image/png');
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        this.width = bytes.readUInt32BE(16);
        this.height = bytes.readUInt32BE(20);
        this.pngSha256 = hash(bytes);
        assert(this.width > 0 && this.height > 0);
        this.listeners
          .get(reject ? 'error' : 'load')
          ?.call(
            this,
            reject
              ? new Error('recorded embedded PNG decode failure')
              : undefined,
          );
      });
    }
  }
  replace(globalThis, 'self', globalThis);
  replace(globalThis, 'createImageBitmap', () => {
    bitmapCalls++;
    throw new Error('ImageBitmap/fetch path must not decode cabin object URLs');
  });
  replace(globalThis, 'document', {
    createElementNS(_namespace, tag) {
      assert.equal(tag, 'img');
      return new ImageFixture();
    },
  });
  replace(URL, 'createObjectURL', (blob) => {
    const url = `blob:https://atlas.invalid/${++created}`;
    urls.set(url, blob);
    return url;
  });
  replace(URL, 'revokeObjectURL', (url) => {
    assert(urls.delete(url), 'each owned image object URL is revoked once');
    revoked++;
  });
  replace(globalThis, 'fetch', async (url, options) => {
    const path = String(url);
    fetches.push(path);
    assert(
      path.startsWith(base) && !path.startsWith('blob:'),
      'connect-src is used only for same-origin cabin files',
    );
    assert.equal(options.signal.aborted, false);
    const bytes = readFileSync(`public${path}`);
    if (path.endsWith('.glb')) {
      const lod = manifest.assets
        .flatMap((asset) => asset.lods)
        .find((lod) => lod.url === path);
      assert.equal(
        hash(bytes),
        lod.sha256,
        'model bytes match the immutable deployment manifest',
      );
    }
    return new Response(bytes);
  });
  try {
    await action({
      images,
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
function embeddedPngHashes(level) {
  const bytes = readFileSync(
    `public${base}mark-v-a-car-interior.lod${level}.glb`,
  );
  const jsonLength = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()),
    binaryStart = 20 + jsonLength + 8;
  return json.images.map((image) => {
    const view = json.bufferViews[image.bufferView];
    return hash(
      bytes.subarray(
        binaryStart + (view.byteOffset ?? 0),
        binaryStart + (view.byteOffset ?? 0) + view.byteLength,
      ),
    );
  });
}

test('the real default cabin loader decodes both LODs through image elements without blob fetch and preserves exact embedded PNG/PBR maps', async () => {
  await imageHarness(async ({ images, fetches, urls, stats }) => {
    const assets = new SkyTrainCabinAssets();
    try {
      for (const level of [0, 1]) {
        const owner = await assets.open('mark-v', level);
        assert(owner);
        const maps = new Set();
        owner.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (['information', 'seat', 'floor'].includes(material.name)) {
              assert(material.map instanceof THREE.Texture, material.name);
              assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
              assert.equal(material.map.flipY, false);
              assert.equal(material.color.getHexString(), 'ffffff');
              assert(
                material.map.image.width > 0 && material.map.image.height > 0,
              );
              maps.add(material.map.image.pngSha256);
            }
        });
        assert.deepEqual(
          [...maps].sort((a, b) => a.localeCompare(b)),
          embeddedPngHashes(level).sort((a, b) => a.localeCompare(b)),
        );
      }
      assert(await assets.open('canada-line', 0));
      assert(await assets.open('canada-line', 1));
      assert.equal(images.length, 6);
      assert.equal(stats().bitmapCalls, 0);
      assert.equal(stats().created, stats().revoked);
      assert.equal(urls.size, 0);
      assert(fetches.every((url) => url.startsWith(base)));
    } finally {
      assets.dispose();
    }
  });
});

test('a default-loader embedded image error rejects the cabin and releases the partially parsed geometry, materials and successful sibling maps once', async () => {
  await imageHarness(async ({ urls, stats }) => {
    const originalError = console.error,
      originalDisposes = [],
      counts = new Map(),
      errors = [];
    for (const type of [THREE.BufferGeometry, THREE.Material, THREE.Texture]) {
      const original = type.prototype.dispose;
      originalDisposes.push([type, original]);
      type.prototype.dispose = function () {
        counts.set(this, (counts.get(this) ?? 0) + 1);
        return original.call(this);
      };
    }
    console.error = (...args) => errors.push(args.map(String).join(' '));
    const assets = new SkyTrainCabinAssets();
    try {
      await assert.rejects(
        assets.open('mark-v', 1),
        /Cabin texture decode failed/,
      );
      assert.equal(assets.owner, null);
      assert(errors.some((line) => line.includes("Couldn't load texture")));
      assert(
        [...counts.keys()].some(
          (resource) => resource instanceof THREE.BufferGeometry,
        ),
      );
      assert(
        [...counts.keys()].some(
          (resource) => resource instanceof THREE.Material,
        ),
      );
      assert.equal(
        [...counts.keys()].filter(
          (resource) => resource instanceof THREE.Texture,
        ).length,
        2,
      );
      assert.equal(urls.size, 0);
      assert.equal(stats().created, stats().revoked);
      assets.dispose();
      assert([...counts.values()].every((count) => count === 1));
    } finally {
      assets.dispose();
      console.error = originalError;
      for (const [type, original] of originalDisposes)
        type.prototype.dispose = original;
    }
  }, true);
});
