import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { CityBusAssets } = await import(cityModule('bus-assets'));
const base = '/models/blender/';
const manifests = ['bus-v2', 'bus-closeup', 'bus-hybrid'].map((name) =>
  JSON.parse(readFileSync(`public${base}${name}/manifest.json`, 'utf8')),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const makeAssets = () =>
  new CityBusAssets([], new THREE.Group(), {
    interiorVersion: 'v2',
    exteriorVersion: 'hybrid',
  });

/** Exercise the actual default loader and published GLBs. Only browser image
 * decoding and same-origin HTTP are substituted; object-URL fetch is forbidden. */
async function imageHarness(
  action,
  { failImage = false, holdImage = false } = {},
) {
  const saved = [],
    urls = new Map(),
    images = [],
    fetches = [],
    errors = [],
    disposes = new Map(),
    pendingImages = [];
  let created = 0,
    revoked = 0,
    bitmapCalls = 0,
    resolveImage;
  const imageReady = new Promise((resolve) => {
    resolveImage = resolve;
  });
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
        assert.equal(this.width, 256);
        assert.equal(this.height, 256);
        const complete = () =>
          this.listeners
            .get(reject ? 'error' : 'load')
            ?.call(
              this,
              reject ? new Error('recorded bus PNG decode failure') : undefined,
            );
        if (holdImage) pendingImages.push(complete);
        else complete();
        resolveImage();
      });
    }
  }
  const NativeRequest = globalThis.Request;
  replace(
    globalThis,
    'Request',
    class extends NativeRequest {
      constructor(input, options) {
        super(
          typeof input === 'string'
            ? new URL(input, 'https://atlas.invalid')
            : input,
          options,
        );
      }
    },
  );
  replace(globalThis, 'self', globalThis);
  replace(globalThis, 'createImageBitmap', () => {
    bitmapCalls++;
    throw new Error('Bus embedded PNGs must not use ImageBitmap/fetch');
  });
  replace(globalThis, 'document', {
    createElementNS(_namespace, tag) {
      assert.equal(tag, 'img');
      return new ImageFixture();
    },
  });
  replace(URL, 'createObjectURL', (blob) => {
    const url = `blob:https://atlas.invalid/bus-${++created}`;
    urls.set(url, blob);
    return url;
  });
  replace(URL, 'revokeObjectURL', (url) => {
    assert(urls.delete(url), 'each owned image object URL is revoked once');
    revoked++;
  });
  replace(globalThis, 'fetch', async (input, options) => {
    const url = new URL(
      typeof input === 'string' ? input : input.url,
      'https://atlas.invalid',
    );
    assert.equal(url.origin, 'https://atlas.invalid');
    assert.equal(
      url.protocol,
      'https:',
      'connect-src never receives a blob URL',
    );
    assert(url.pathname.startsWith(base));
    const signal = options?.signal ?? input.signal;
    if (signal) assert.equal(signal.aborted, false);
    fetches.push({
      path: url.pathname,
      request: input instanceof NativeRequest,
    });
    const bytes = readFileSync(`public${url.pathname}`);
    if (url.pathname.endsWith('.glb')) {
      const lod = manifests
        .flatMap((manifest) => manifest.assets.flatMap((asset) => asset.lods))
        .find((lod) => lod.url === url.pathname);
      assert(lod, 'default loader requests only published bus payloads');
      assert.equal(hash(bytes), lod.sha256);
      assert.equal(url.searchParams.get('v'), lod.sha256.slice(0, 12));
    }
    return {
      ok: true,
      status: 200,
      // FileLoader may consume a streaming Response in browsers; an unstreamed
      // response keeps this CPU fixture focused on the actual parser/image path.
      body: undefined,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      json: async () => JSON.parse(bytes.toString()),
    };
  });
  replace(console, 'error', (...args) =>
    errors.push(args.map(String).join(' ')),
  );
  for (const type of [THREE.BufferGeometry, THREE.Material, THREE.Texture]) {
    const dispose = type.prototype.dispose;
    replace(type.prototype, 'dispose', function () {
      disposes.set(this, (disposes.get(this) ?? 0) + 1);
      return dispose.call(this);
    });
  }
  try {
    await action({
      images,
      fetches,
      urls,
      errors,
      disposes,
      imageReady,
      releaseImages() {
        holdImage = false;
        for (const complete of pendingImages.splice(0)) complete();
      },
      stats: () => ({ created, revoked, bitmapCalls }),
    });
  } finally {
    for (const [target, name, descriptor] of saved.reverse()) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  }
}

function embeddedPngHash(level) {
  const bytes = readFileSync(
    `public${base}bus-closeup/city-bus-12m-interior-v2-closeup.lod${level}.glb`,
  );
  const jsonLength = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()),
    binaryStart = 20 + jsonLength + 8;
  assert.equal(json.images.length, 1);
  const view = json.bufferViews[json.images[0].bufferView];
  return hash(
    bytes.subarray(
      binaryStart + (view.byteOffset ?? 0),
      binaryStart + (view.byteOffset ?? 0) + view.byteLength,
    ),
  );
}

function assertFloorTexture(owner, level) {
  const maps = new Set();
  owner.interiorRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (material.userData.shared_surface_id !== 'bus-v2-floor') continue;
      const map = material.map;
      assert(map instanceof THREE.Texture);
      assert.equal(map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(map.flipY, false);
      assert.equal(map.wrapS, THREE.RepeatWrapping);
      assert.equal(map.wrapT, THREE.RepeatWrapping);
      assert.equal(map.image.pngSha256, embeddedPngHash(level));
      maps.add(map);
    }
  });
  assert.equal(maps.size, 1);
}

test('real default bus loading decodes closeup LOD0/1 PNGs through images, retaining hybrid exterior and exact authored floor maps', async () => {
  await imageHarness(async ({ images, fetches, urls, errors, stats }) => {
    const assets = makeAssets();
    try {
      for (const level of [0, 1]) {
        const owner = await assets.loadBoardable({
          profile: `reference-lod${level}`,
          ...(level === 1 ? { signal: new AbortController().signal } : {}),
        });
        assert.equal(owner.profile, `reference-lod${level}`);
        assert.equal(owner.fallback, false);
        assert.equal(assets.stats().exteriorVersion, 'hybrid');
        assert(owner.exteriorRoot.getObjectByName('boarding-ramp'));
        assertFloorTexture(owner, level);
        owner.dispose();
      }
      for (const level of [0, 1]) {
        const request = fetches.find(({ path }) =>
          path.endsWith(`city-bus-12m-interior-v2-closeup.lod${level}.glb`),
        );
        assert(request);
        assert.equal(
          request.request,
          level === 0,
          'both default load branches run',
        );
      }
      assert.equal(images.length, 2);
      assert.equal(stats().bitmapCalls, 0);
      assert.equal(stats().created, stats().revoked);
      assert.equal(urls.size, 0);
      assert.deepEqual(errors, []);
    } finally {
      assets.dispose();
    }
  });
});

test('failed default-loader PNG decode releases its object URL and partial model, with an honest budget fallback', async () => {
  await imageHarness(
    async ({ urls, errors, disposes, stats }) => {
      const assets = makeAssets();
      try {
        const owner = await assets.loadBoardable({
          profile: 'reference-lod1',
          signal: new AbortController().signal,
        });
        assert.equal(owner.profile, 'budget');
        assert.equal(owner.requestedProfile, 'reference-lod1');
        assert.equal(owner.fallback, true);
        assert.equal(assets.stats().referenceMaterials, 0);
        assert.equal(assets.stats().textures, 0);
        assert(assets.stats().errors.includes('Bus texture decode failed'));
        assert(errors.some((line) => line.includes("Couldn't load texture")));
        for (const type of [THREE.BufferGeometry, THREE.Material])
          assert(
            [...disposes.keys()].some((resource) => resource instanceof type),
          );
        assert.equal(stats().bitmapCalls, 0);
        assert.equal(stats().created, 1);
        assert.equal(stats().created, stats().revoked);
        assert.equal(urls.size, 0);
      } finally {
        assets.dispose();
        assert([...disposes.values()].every((count) => count === 1));
      }
    },
    { failImage: true },
  );
});

test('abort during native image decode disposes the late closeup result, and a fresh request can load the same detailed profile', async () => {
  await imageHarness(
    async ({ imageReady, releaseImages, disposes, urls, stats }) => {
      const assets = makeAssets();
      const controller = new AbortController();
      try {
        const pending = assets.loadBoardable({
          profile: 'reference-lod1',
          signal: controller.signal,
        });
        const rejected = assert.rejects(pending, /cancelled bus visit/);
        await imageReady;
        controller.abort(new DOMException('cancelled bus visit', 'AbortError'));
        releaseImages();
        await rejected;
        assert.equal(assets.stats().boardableOwners, 0);
        assert.equal(assets.stats().referenceMaterials, 0);
        assert.equal(assets.stats().textures, 0);
        assert(
          [...disposes.keys()].some(
            (resource) => resource instanceof THREE.Texture,
          ),
        );
        assert.equal(urls.size, 0);
        const owner = await assets.loadBoardable({
          profile: 'reference-lod1',
          signal: new AbortController().signal,
        });
        assert.equal(owner.profile, 'reference-lod1');
        assert.equal(owner.fallback, false);
        assertFloorTexture(owner, 1);
        assert.equal(stats().bitmapCalls, 0);
        assert.equal(stats().created, 2);
        assert.equal(stats().created, stats().revoked);
        assert.equal(urls.size, 0);
      } finally {
        releaseImages();
        assets.dispose();
        assert([...disposes.values()].every((count) => count === 1));
      }
    },
    { holdImage: true },
  );
});
