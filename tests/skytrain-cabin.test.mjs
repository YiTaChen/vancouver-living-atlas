import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
import {
  loadMetroProjection,
  readMetroGLB,
  METRO_LAYOUT_SHA256,
  METRO_SOURCES,
} from '../tools/metro-projection.mjs';

const { SkyTrainCabinAssets, disposeCabinScene, validateCabinManifest } =
  await import(cityModule('skytrain-cabin-assets'));
const { CabinDisplayFrames } = await import(cityModule('skytrain-cabin-frame'));
const { cabinLOD, cabinPixelRatio } = await import(
  cityModule('skytrain-cabin-policy')
);
const { SkyTrainCabinRenderer } = await import(
  cityModule('skytrain-cabin-renderer')
);
const projection = await loadMetroProjection();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const policy = {
  quality: 'high',
  compatible: false,
  pixelRatio: 1.25,
  displayQuality: 'city',
};

async function parseActual(file) {
  const bytes = await readFile(`public/models/blender/metro/${file}`);
  const loader = new GLTFLoader();
  // Node has no bitmap decoder. Substitute decoding only: all binary geometry,
  // PBR parameters, texture associations and anchors use the real GLTFLoader.
  const originalSelf = globalThis.self;
  globalThis.self = globalThis;
  loader.register((parser) => ({
    name: 'node-texture-decoder',
    beforeRoot() {
      parser.textureLoader = {
        load(_url, ok) {
          queueMicrotask(() => ok(new THREE.Texture()));
        },
      };
    },
  }));
  try {
    return await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '/models/blender/metro/',
    );
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
}
function observeDisposals(scene) {
  const resources = new Set();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      resources.add(material);
      Object.values(material)
        .filter((value) => value instanceof THREE.Texture)
        .forEach((value) => resources.add(value));
    }
  });
  const counts = new Map([...resources].map((resource) => [resource, 0]));
  resources.forEach((resource) =>
    resource.addEventListener('dispose', () =>
      counts.set(resource, counts.get(resource) + 1),
    ),
  );
  return {
    resources,
    counts,
    assertReleased() {
      assert(resources.size > 0);
      assert([...counts.values()].every((n) => n === 1));
    },
  };
}

test('production cabin projection is canonical, small and exact to six reviewed exported GLBs', async () => {
  const deployed = await readFile('public/models/blender/metro/manifest.json');
  assert(deployed.equals(projection.metadataBytes));
  assert.equal(projection.entries.length, 7);
  assert.equal(projection.metadata.cabins[0].seatCount, 22);
  assert.equal(projection.metadata.cabins[1].seatCount, 20);
  assert.equal(
    projection.metadata.provenance.layoutSha256,
    METRO_LAYOUT_SHA256,
  );
  assert.equal(projection.metadata.boardingEnabled, false);
  assert.equal(projection.metadata.serviceEnabled, false);
  assert.equal(projection.metadata.intercarTraversalEnabled, false);
  for (const entry of projection.entries.filter((entry) =>
    entry.path.endsWith('.glb'),
  )) {
    const bytes = await readFile(`public/models/blender/${entry.path}`),
      source = await readFile(entry.sourcePath);
    assert(bytes.equals(source), entry.path);
    assert.equal(hash(bytes), entry.sha256);
    const doc = readMetroGLB(bytes);
    assert(
      !doc.materials.some(
        (material) => material.extensions?.KHR_materials_unlit,
      ),
    );
    assert(
      doc.meshes.every((mesh) =>
        mesh.primitives.every(
          (primitive) => primitive.attributes.NORMAL !== undefined,
        ),
      ),
    );
  }
  assert(!JSON.stringify(projection.metadata).includes('study.glb'));
  assert(!JSON.stringify(projection.metadata).includes('lod2.glb'));
});

test('projection refuses changed seat facing layout even when the public projection is unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metro-layout-'));
  try {
    for (const source of METRO_SOURCES) {
      const sourceRoot = `tools/assets/${source.packageId}`,
        manifest = JSON.parse(
          await readFile(`${sourceRoot}/manifest.json`, 'utf8'),
        );
      const files = [
        'manifest.json',
        ...manifest.assets
          .filter((asset) => source.assets.includes(asset.id))
          .flatMap((asset) =>
            asset.lods
              .filter((lod) => lod.level < 2)
              .flatMap((lod) => [lod.file, lod.source]),
          ),
      ];
      for (const file of files) {
        const to = path.join(root, sourceRoot, file);
        await mkdir(path.dirname(to), { recursive: true });
        await copyFile(`${sourceRoot}/${file}`, to);
      }
    }
    const layoutPath =
      'tools/assets/skytrain-mark-v-interior/layout-assumptions.json';
    const layout = JSON.parse(await readFile(layoutPath, 'utf8'));
    layout.seats[0].facingXZ = [0, 1];
    await writeFile(path.join(root, layoutPath), JSON.stringify(layout));
    await assert.rejects(
      loadMetroProjection(root),
      /Unreviewed Mark V seat facing layout/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real GLBs preserve authored PBR maps/colours and exact 22/20 seated cameras at both LODs', async () => {
  for (const cabin of projection.metadata.cabins)
    for (const level of [0, 1]) {
      const loaded = [];
      const assets = new SkyTrainCabinAssets({
        fetchManifest: async () => projection.metadata,
        load: async (url) => {
          const gltf = await parseActual(path.basename(url));
          loaded.push(gltf);
          return gltf;
        },
      });
      const owner = await assets.open(cabin.id, level);
      assert(owner);
      assert.equal(
        owner.descriptor.viewpoints.filter((view) => view.kind === 'seat')
          .length,
        cabin.seatCount,
      );
      assert.equal(owner.level, level);
      const interior = loaded.find((gltf) =>
        gltf.scene.getObjectByName(cabin.viewpoints[0].nodeId),
      );
      for (const view of cabin.viewpoints) {
        const node = interior.scene.getObjectByName(view.nodeId);
        assert(node);
        const eye = node
          .getWorldPosition(new THREE.Vector3())
          .add(new THREE.Vector3(...view.offsetM));
        assert(eye.distanceTo(new THREE.Vector3(...view.positionM)) < 1e-6);
      }
      const disposal = observeDisposals(owner.group);
      const materials = [...disposal.resources].filter(
        (resource) => resource instanceof THREE.MeshStandardMaterial,
      );
      assert(materials.length >= (cabin.id === 'mark-v' ? 10 : 6));
      if (cabin.id === 'mark-v') {
        for (const name of ['information', 'seat', 'floor']) {
          const material = materials.find((material) => material.name === name);
          assert(material.map instanceof THREE.Texture, name);
          assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
          assert.equal(material.color.getHexString(), 'ffffff');
        }
        assert.equal(
          materials.find((material) => material.name === 'glass').transparent,
          true,
        );
      } else {
        const material = materials.find(
          (material) => material.name === 'canada-seat',
        );
        const doc = readMetroGLB(
          await readFile(
            `public/models/blender/metro/canada-line-shared-interior.lod${level}.glb`,
          ),
        );
        const authored = doc.materials.find(
          (material) => material.name === 'canada-seat',
        ).pbrMetallicRoughness;
        assert(Math.abs(material.color.r - authored.baseColorFactor[0]) < 1e-7);
        assert(Math.abs(material.roughness - authored.roughnessFactor) < 1e-7);
      }
      let stopped = 0,
        uncached = 0;
      const stop = owner.mixer.stopAllAction.bind(owner.mixer),
        uncache = owner.mixer.uncacheRoot.bind(owner.mixer);
      owner.mixer.stopAllAction = () => {
        stopped++;
        return stop();
      };
      owner.mixer.uncacheRoot = (root) => {
        uncached++;
        return uncache(root);
      };
      assets.dispose();
      owner.dispose();
      disposal.assertReleased();
      assert.equal(stopped, 1);
      assert.equal(uncached, 1);
    }
});

test('late model completion after selection change releases its actual GLB resources and never replaces the new owner', async () => {
  const mark = await parseActual('mark-v-a-car-interior.lod0.glb'),
    lateDisposal = observeDisposals(mark.scene),
    delayed = deferred();
  const signals = [],
    assets = new SkyTrainCabinAssets({
      fetchManifest: async () => projection.metadata,
      load: (url, signal) => {
        signals.push(signal);
        return url.includes('mark-v')
          ? delayed.promise
          : parseActual(path.basename(url));
      },
    });
  const old = assets.open('mark-v', 0);
  await tick();
  const current = assets.open('canada-line', 1);
  const owner = await current;
  assert(owner);
  assert.equal(owner.descriptor.id, 'canada-line');
  assert.equal(signals[0].aborted, true);
  delayed.resolve(mark);
  assert.equal(await old, null);
  lateDisposal.assertReleased();
  assert(owner.group.children.length > 0);
  const disposal = observeDisposals(owner.group);
  assets.dispose();
  disposal.assertReleased();
  assert.equal(await assets.open('mark-v', 0), null);
});

test('close aborts late parse and failed paired load releases the successful sibling', async () => {
  const mark = await parseActual('mark-v-a-car-interior.lod1.glb'),
    disposal = observeDisposals(mark.scene),
    pending = deferred();
  let signal;
  const assets = new SkyTrainCabinAssets({
    fetchManifest: async () => projection.metadata,
    load: (_url, value) => {
      signal = value;
      return pending.promise;
    },
  });
  const result = assets.open('mark-v', 1);
  await tick();
  assets.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve(mark);
  assert.equal(await result, null);
  disposal.assertReleased();
  const interior = await parseActual('canada-line-shared-interior.lod0.glb'),
    sibling = observeDisposals(interior.scene);
  const failing = new SkyTrainCabinAssets({
    fetchManifest: async () => projection.metadata,
    load: (url) =>
      url.includes('exterior')
        ? Promise.reject(new Error('network'))
        : Promise.resolve(interior),
  });
  await assert.rejects(failing.open('canada-line', 0), /network/);
  sibling.assertReleased();
  failing.dispose();
});

test('shared textures/bitmap and neutral white COLOR_0 are preserved, then disposed exactly once', () => {
  const originalBitmap = globalThis.ImageBitmap;
  globalThis.ImageBitmap = class {
    close() {
      this.closed = (this.closed || 0) + 1;
    }
  };
  try {
    const image = new ImageBitmap(),
      texture = new THREE.Texture(image),
      material = new THREE.MeshStandardMaterial({
        color: '#b8c5d1',
        roughness: 0.63,
        metalness: 0.21,
        map: texture,
        vertexColors: true,
      });
    const geometry = new THREE.BoxGeometry();
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        new Float32Array(geometry.attributes.position.count * 3).fill(1),
        3,
      ),
    );
    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(geometry, material),
      new THREE.Mesh(geometry, material),
    );
    const disposal = observeDisposals(group),
      authored = material.color.clone();
    assert(material.color.equals(authored));
    assert.equal(material.vertexColors, true);
    assert.equal(material.roughness, 0.63);
    assert.equal(material.metalness, 0.21);
    disposeCabinScene(group);
    disposal.assertReleased();
    assert.equal(image.closed, 1);
  } finally {
    if (originalBitmap === undefined) delete globalThis.ImageBitmap;
    else globalThis.ImageBitmap = originalBitmap;
  }
});

test('static display schedules one frame per change, cancels while hidden and never loops', () => {
  const queue = new Map();
  let next = 0,
    draws = 0;
  const frames = new CabinDisplayFrames(
    () => {
      draws++;
    },
    (callback) => {
      queue.set(++next, callback);
      return next;
    },
    (id) => queue.delete(id),
  );
  frames.invalidate();
  frames.invalidate();
  assert.equal(queue.size, 1);
  frames.setVisible(false);
  assert.equal(queue.size, 0);
  frames.invalidate();
  assert.equal(queue.size, 0);
  frames.setVisible(true);
  assert.equal(queue.size, 1);
  const [id, draw] = [...queue][0];
  queue.delete(id);
  draw(0);
  assert.equal(draws, 1);
  assert.equal(queue.size, 0);
  frames.invalidate();
  frames.dispose();
  assert.equal(queue.size, 0);
  frames.invalidate();
  frames.setVisible(true);
  assert.equal(queue.size, 0);
});

test('default resolution inherits city Auto/manual values and compatible/balanced policy uses lower LOD', () => {
  assert.equal(cabinLOD(policy), 0);
  assert.equal(cabinLOD({ ...policy, quality: 'balanced' }), 1);
  assert.equal(
    cabinLOD({ ...policy, compatible: true, displayQuality: 'detailed' }),
    1,
  );
  assert.equal(cabinLOD({ ...policy, displayQuality: 'light' }), 1);
  assert.equal(
    cabinPixelRatio({ ...policy, pixelRatio: 0.72 }, 800, 500),
    0.72,
  );
  assert.equal(
    cabinPixelRatio({ ...policy, pixelRatio: 1.11 }, 800, 500),
    1.11,
  );
  assert(
    cabinPixelRatio({ ...policy, pixelRatio: 10 }, 4000, 2000) <=
      Math.sqrt(1_800_000 / 8_000_000),
  );
  const invalid = structuredClone(projection.metadata);
  invalid.assets[0].lods[0].url =
    '/tools/assets/skytrain-mark-v-interior/exports/mark-v-a-car-study.glb';
  assert.throws(() => validateCabinManifest(invalid), /Invalid cabin LOD/);
});

function browserFixture(failAt) {
  const counts = {
      renderer: 0,
      context: 0,
      lists: 0,
      room: 0,
      pmrem: 0,
      environment: 0,
      observer: 0,
    },
    listeners = new Map(),
    documentListeners = new Map(),
    frames = new Map();
  let frame = 0;
  const fixture = { counts, listeners, documentListeners, frames };
  const canvas = {
    clientWidth: 800,
    clientHeight: 500,
    dataset: {},
    addEventListener(type, listener) {
      if (failAt === 'listener' && type === 'pointermove')
        throw new Error('failure listener');
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    hasPointerCapture: () => false,
  };
  const document = {
    hidden: false,
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (documentListeners.get(type) === listener)
        documentListeners.delete(type);
    },
  };
  const deps = {
    renderer() {
      if (failAt === 'renderer') throw new Error('failure renderer');
      return {
        renderLists: { dispose: () => counts.lists++ },
        dispose: () => counts.renderer++,
        forceContextLoss: () => counts.context++,
        setSize() {
          if (failAt === 'resize') throw new Error('failure resize');
        },
        setPixelRatio() {},
        render() {},
      };
    },
    room() {
      if (failAt === 'room') throw new Error('failure room');
      return { dispose: () => counts.room++ };
    },
    pmrem() {
      if (failAt === 'pmrem') throw new Error('failure pmrem');
      return {
        dispose: () => counts.pmrem++,
        fromScene() {
          if (failAt === 'environment') throw new Error('failure environment');
          return {
            texture: new THREE.Texture(),
            dispose: () => counts.environment++,
          };
        },
      };
    },
    observer() {
      if (failAt === 'observer') throw new Error('failure observer');
      return {
        disconnect: () => counts.observer++,
        observe() {
          if (failAt === 'observe') throw new Error('failure observe');
        },
      };
    },
  };
  return {
    ...fixture,
    canvas,
    document,
    deps,
    request: (callback) => {
      frames.set(++frame, callback);
      return frame;
    },
    cancel: (id) => frames.delete(id),
  };
}
function withBrowserFixture(failAt, run) {
  const fixture = browserFixture(failAt),
    previous = {
      document: globalThis.document,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    };
  globalThis.document = fixture.document;
  globalThis.requestAnimationFrame = fixture.request;
  globalThis.cancelAnimationFrame = fixture.cancel;
  try {
    run(fixture);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

test('actual cabin renderer constructor unwinds all acquired resources for failures at every stage', () => {
  const stages = [
    'renderer',
    'room',
    'pmrem',
    'environment',
    'observer',
    'observe',
    'listener',
    'resize',
  ];
  for (const [index, stage] of stages.entries())
    withBrowserFixture(stage, (f) => {
      assert.throws(
        () => new SkyTrainCabinRenderer(f.canvas, policy, () => {}, f.deps),
        new RegExp(`failure ${stage}`),
      );
      assert.equal(f.counts.renderer, index > 0 ? 1 : 0);
      assert.equal(f.counts.context, index > 0 ? 1 : 0);
      assert.equal(f.counts.lists, index > 0 ? 1 : 0);
      assert.equal(f.counts.room, index > 1 ? 1 : 0);
      assert.equal(f.counts.pmrem, index > 2 ? 1 : 0);
      assert.equal(f.counts.environment, index > 3 ? 1 : 0);
      assert.equal(f.counts.observer, index > 4 ? 1 : 0);
      assert.equal(f.listeners.size, 0);
      assert.equal(f.documentListeners.size, 0);
      assert.equal(f.frames.size, 0);
    });
});

test('context loss terminates display, cancels frame and releases environment/listeners exactly once', () =>
  withBrowserFixture(null, (f) => {
    const statuses = [],
      renderer = new SkyTrainCabinRenderer(
        f.canvas,
        policy,
        (status) => statuses.push(status.phase),
        f.deps,
      );
    assert.equal(f.frames.size, 1);
    let prevented = 0;
    f.listeners.get('webglcontextlost')({
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(prevented, 1);
    assert.deepEqual(statuses, ['error']);
    assert.equal(f.frames.size, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.documentListeners.size, 0);
    renderer.dispose();
    assert(Object.values(f.counts).every((n) => n === 1));
  }));
