import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { CityBusAssets } = await import(cityModule('bus-assets'));
const baseline = JSON.parse(
  await readFile('public/models/blender/bus-v2/manifest.json', 'utf8'),
);
const reference = JSON.parse(
  await readFile('public/models/blender/bus-closeup/manifest.json', 'utf8'),
);
const route = (x = 0) => ({
  a: [x, -100],
  b: [x, 100],
  length: 200,
  speed: 0,
  phase: 0.25,
});
const policy = { quality: 'high', compatible: false, allowNew: true };
const tick = () => new Promise((resolve) => setImmediate(resolve));
globalThis.self = globalThis;
class TestBitmap {
  width = 256;
  height = 256;
  close() {}
}
globalThis.ImageBitmap = TestBitmap;

function hybridMetadata() {
  const exterior = structuredClone(baseline.assets[0]);
  for (const lod of exterior.lods) {
    lod.url = `/models/blender/bus-hybrid/${lod.file}`;
    lod.sha256 = 'd'.repeat(63) + lod.level;
  }
  return {
    schemaVersion: 1,
    contract: 'boardable-bus-hybrid-exterior-v1',
    packageId: 'boardable-bus-hybrid',
    version: '1.0.0',
    units: 'm',
    assets: [exterior],
    accessibility: {
      schemaVersion: 1,
      kneelDropM: 0.0762,
      ramp: {
        nodeId: 'boarding-ramp',
        lengthM: 1.12,
        widthM: 0.86,
        hingeM: [-1.22, 0.36, 4.6],
        centerOffsetM: [0, 0, -0.15],
        rotationAxis: '+Z',
        stowedAngleRad: 0,
      },
      wheelNodeIds: [
        'wheel-front-left',
        'wheel-front-right',
        'wheel-rear-left',
        'wheel-rear-right',
      ],
      representative: true,
      notFleetCertification: true,
    },
  };
}

async function parsePayload(url) {
  const path = url.split('?')[0];
  const bytes = await readFile(`public${path}`);
  const loader = new GLTFLoader();
  loader.register((parser) => ({
    name: 'hybrid-test-bitmap-decoder',
    beforeRoot() {
      parser.textureLoader = {
        load(_url, ok) {
          queueMicrotask(() => ok(new THREE.Texture(new TestBitmap())));
        },
      };
    },
  }));
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}

async function parseFixture(url) {
  const hybrid = url.includes('/bus-hybrid/');
  const gltf = await parsePayload(url.replace('/bus-hybrid/', '/bus/'));
  if (hybrid) {
    // Exercise the actual canonical exterior rig with a deliberately different
    // generation of paint. No files or pinned source fixtures are rewritten.
    const ramp = new THREE.Group();
    ramp.name = 'boarding-ramp';
    ramp.position.set(-1.22, 0.36, 4.6);
    gltf.scene.getObjectByName('vehicle').add(ramp);
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.material.userData.semantic_role === 'paint') {
        o.material.color.setRGB(1, 1, 1);
        o.material.roughness = 0.37;
        if (!o.geometry.getAttribute('color'))
          o.geometry.setAttribute(
            'color',
            new THREE.BufferAttribute(
              new Float32Array(
                o.geometry.getAttribute('position').count * 4,
              ).fill(1),
              4,
            ),
          );
        o.geometry.getAttribute('color').setXYZ(0, 0.012, 0.067, 0.21);
      }
    });
  }
  return gltf;
}

function fixture({
  metadata = hybridMetadata(),
  mutate,
  load,
  ...options
} = {}) {
  const calls = [],
    loaded = [],
    counts = { base: 0, hybrid: 0, reference: 0 };
  const assets = new CityBusAssets(
    Array.from({ length: 6 }, (_, i) => route(i)),
    new THREE.Group(),
    {
      interiorVersion: 'v2',
      exteriorVersion: 'hybrid',
      fetchManifest: async () => {
        counts.base++;
        return baseline;
      },
      fetchHybridManifest: async () => {
        counts.hybrid++;
        return metadata;
      },
      fetchReferenceManifest: async () => {
        counts.reference++;
        return reference;
      },
      load: async (url, signal) => {
        calls.push(url);
        const gltf = load ? await load(url, signal) : await parseFixture(url);
        if (mutate) mutate(gltf, url);
        loaded.push({ url, gltf });
        return gltf;
      },
      ...options,
    },
  );
  return { assets, calls, loaded, counts, metadata };
}
async function near(f) {
  f.assets.update(0, new THREE.Vector3(), () => 0, policy);
  await f.assets.ready;
}
function disposalCounts(gltf) {
  const counts = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const resource of [
      o.geometry,
      ...(Array.isArray(o.material) ? o.material : [o.material]),
    ])
      if (!counts.has(resource)) {
        counts.set(resource, 0);
        resource.addEventListener('dispose', () =>
          counts.set(resource, counts.get(resource) + 1),
        );
      }
  });
  return counts;
}

test('hybrid preflight stays cold until admission, then shares white COLOR_0 paint with a four-bus bounded pool', async () => {
  const f = fixture();
  try {
    f.assets.update(0, new THREE.Vector3(0, 900, 0), () => 0, policy);
    f.assets.update(0, new THREE.Vector3(), () => 0, {
      ...policy,
      allowNew: false,
    });
    f.assets.update(0, new THREE.Vector3(), () => 0, {
      ...policy,
      quality: 'low',
      allowNew: false,
    });
    await tick();
    assert.deepEqual(f.counts, { base: 0, hybrid: 0, reference: 0 });
    assert.deepEqual(f.calls, []);
    await near(f);
    assert.equal(f.assets.stats().status, 'ready');
    assert.equal(f.assets.stats().exteriorVersion, 'hybrid');
    assert.equal(f.assets.stats().allocatedBatches, 15);
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      4,
    );
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, {
        ...policy,
        compatible: true,
      }).size,
      2,
    );
    const pairBytes = baseline.assets[0].lods
      .slice(0, 2)
      .reduce((sum, lod) => sum + lod.bytes, 0);
    assert.equal(f.assets.stats().hybridPreflightBytes, pairBytes);
    assert.equal(
      f.assets.stats().assetBytes,
      pairBytes + baseline.assets[1].lods[1].bytes,
    );
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
    );
    assert.ok(
      f.calls.every((url) => !url.includes('/bus/city-bus-12m-exterior')),
    );
    const paint = f.assets.group.children.find(
      (o) => o.material.userData.shared_surface_id === 'automotive-paint',
    );
    assert.ok(paint.material.color.equals(new THREE.Color(1, 1, 1)));
    assert.equal(paint.material.roughness, 0.37);
    assert.equal(paint.material.vertexColors, true);
    const colors = paint.geometry.getAttribute('color');
    assert.ok(
      Array.from({ length: colors.count }, (_, i) => i).some(
        (i) =>
          Math.abs(colors.getX(i) - 0.012) < 1e-6 &&
          Math.abs(colors.getY(i) - 0.067) < 1e-6,
      ),
    );
    const owner = await f.assets.loadBoardable();
    assert.deepEqual(owner.manifest.vehicles, baseline.vehicles);
    assert.equal(owner.manifest.accessibility, f.metadata.accessibility);
    assert.ok(owner.exteriorRoot.getObjectByName('boarding-ramp'));
    assert.equal(owner.animations.length, 4);
    for (const door of baseline.vehicles[0].doors) {
      assert.ok(owner.exteriorRoot.getObjectByName(door.nodeId));
      assert.ok(
        owner.animations
          .find((clip) => clip.name === door.animationClip)
          .tracks.some((track) => track.name === `${door.nodeId}.position`),
      );
    }
    for (const wheel of f.metadata.accessibility.wheelNodeIds)
      assert.ok(owner.exteriorRoot.getObjectByName(wheel));
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
      'same-basename near/parked templates use the selected generation',
    );
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
});

test('concurrent traffic and reference demand share one preflight and one exterior material generation', async () => {
  const f = fixture();
  try {
    const pending = f.assets.loadBoardable({ profile: 'reference-lod1' });
    await near(f);
    const owner = await pending;
    assert.equal(f.counts.hybrid, 1);
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
    );
    assert.equal(f.assets.stats().exteriorVersion, 'hybrid');
    assert.equal(f.assets.stats().allocatedBatches, 15);
    assert.equal(f.assets.stats().referenceMaterials, 13);
    const trafficPaint = f.assets.group.children.find(
      (o) => o.material.userData.shared_surface_id === 'automotive-paint',
    ).material;
    let parkedPaint;
    owner.exteriorRoot.traverse((o) => {
      if (o.isMesh && o.material.userData.semantic_role === 'paint')
        parkedPaint = o.material;
    });
    assert.equal(parkedPaint, trafficPaint);
    assert.equal(owner.manifest.accessibility, f.metadata.accessibility);
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
});

test('reference visits use the same hybrid generation while keeping closeup cabin metadata and geometry support', async () => {
  const f = fixture();
  try {
    const owner = await f.assets.loadBoardable({ profile: 'reference-lod1' });
    assert.equal(owner.profile, 'reference-lod1');
    assert.deepEqual(owner.manifest.vehicles, reference.vehicles);
    assert.equal(owner.manifest.accessibility, f.metadata.accessibility);
    assert.ok(owner.cabinSurfaces.canStand(0, 0));
    assert.ok(
      owner.manifest.assets
        .find((a) => a.id === 'city-bus-12m-exterior')
        .lods.every((l) => l.url.includes('/bus-hybrid/')),
    );
    await near(f);
    assert.equal(f.counts.hybrid, 1);
    assert.equal(f.assets.stats().allocatedBatches, 15);
    assert.equal(f.assets.stats().referenceMaterials, 13);
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
    );
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
});

test('invalid optional overlay locks original fallback without relaxing baseline versions, paths or budgets', async () => {
  for (const mutate of [
    (m) => (m.assets[0].lods[0].bytes = 1_000_001),
    (m) => (m.assets[0].lods[1].triangles = 10_001),
    (m) => (m.assets[0].lods[0].url = '/__offline-assets/source.blend'),
    (m) =>
      (m.assets[0].lods[0].url =
        'https://example.com/city-bus-12m-exterior.lod0.glb'),
    (m) => (m.assets[0].lods[2].level = 1),
    (m) => m.assets.push(structuredClone(m.assets[0])),
    (m) => (m.version = '1.1.0'),
  ]) {
    const metadata = hybridMetadata();
    mutate(metadata);
    const f = fixture({ metadata });
    try {
      await near(f);
      assert.equal(f.assets.stats().status, 'ready');
      assert.equal(f.assets.stats().exteriorVersion, 'original');
      assert.match(f.assets.stats().errors[0], /hybrid bus/i);
      const owner = await f.assets.loadBoardable();
      assert.equal(owner.manifest.accessibility, undefined);
      assert.equal(f.counts.hybrid, 1);
      assert.ok(f.calls.every((url) => !url.includes('/bus-hybrid/')));
      owner.dispose();
    } finally {
      f.assets.dispose();
    }
  }
  let optionalRequests = 0;
  const bad = structuredClone(baseline);
  bad.version = '1.0.0';
  const f = fixture({
    fetchManifest: async () => bad,
    fetchHybridManifest: async () => {
      optionalRequests++;
      return hybridMetadata();
    },
  });
  try {
    await near(f);
    assert.equal(f.assets.stats().status, 'error');
    assert.equal(optionalRequests, 0);
    assert.equal(f.calls.length, 0);
  } finally {
    f.assets.dispose();
  }
});

test('preflight GLB failure disposes accepted hybrid buffers and permanently chooses safe original paint', async () => {
  const disposed = [];
  const f = fixture({
    load: async (url) => {
      if (url.includes('/bus-hybrid/') && url.includes('.lod1.'))
        throw Error('hybrid delivery unavailable');
      const gltf = await parseFixture(url);
      if (url.includes('/bus-hybrid/')) disposed.push(disposalCounts(gltf));
      return gltf;
    },
  });
  try {
    await near(f);
    assert.equal(f.assets.stats().exteriorVersion, 'original');
    assert.equal(f.assets.stats().status, 'ready');
    assert.equal(f.assets.stats().loadedTemplates, 2);
    assert.ok(
      disposed.every((resources) =>
        [...resources.values()].every((n) => n === 1),
      ),
    );
    const owner = await f.assets.loadBoardable();
    assert.equal(owner.manifest.accessibility, undefined);
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
    );
    assert.equal(f.counts.hybrid, 1);
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
  assert.ok(
    disposed.every((resources) =>
      [...resources.values()].every((n) => n === 1),
    ),
    'discarded buffers are never disposed twice',
  );
});

test('missing hybrid opening clips, rig, COLOR_0 or white paint fail preflight before shared materials are bound', async () => {
  for (const mutate of [
    (gltf) => (gltf.animations = []),
    (gltf) => gltf.scene.getObjectByName('boarding-ramp').removeFromParent(),
    (gltf) =>
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material.userData.semantic_role === 'paint')
          o.geometry.deleteAttribute('color');
      }),
    (gltf) =>
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.material.userData.semantic_role === 'paint')
          o.material.color.setRGB(0.8, 0.8, 0.8);
      }),
  ]) {
    const f = fixture({
      mutate: (gltf, url) => {
        if (url.includes('/bus-hybrid/')) mutate(gltf);
      },
    });
    try {
      await near(f);
      assert.equal(f.assets.stats().status, 'ready');
      assert.equal(f.assets.stats().exteriorVersion, 'original');
      assert.equal(f.assets.stats().loadedTemplates, 2);
      assert.equal(f.assets.stats().materials, 15);
    } finally {
      f.assets.dispose();
    }
  }
});

test('a cross-LOD PBR mismatch falls back before either exterior binds shared materials', async () => {
  const f = fixture({
    mutate: (gltf, url) => {
      if (url.includes('/bus-hybrid/') && url.includes('.lod0.'))
        gltf.scene.traverse((o) => {
          if (o.isMesh && o.material.userData.semantic_role === 'paint')
            o.material.roughness = 0.6;
        });
    },
  });
  try {
    await near(f);
    assert.equal(f.assets.stats().status, 'ready');
    assert.equal(f.assets.stats().exteriorVersion, 'original');
    assert.match(f.assets.stats().errors[0], /material factors differ/);
    assert.equal(f.assets.stats().loadedTemplates, 2);
    const owner = await f.assets.loadBoardable();
    assert.equal(owner.manifest.accessibility, undefined);
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
});

test('dispose during hybrid preflight releases late buffers without starting original fallback requests', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve)),
    disposed = [];
  const f = fixture({
    load: async (url) => {
      await gate;
      const gltf = await parseFixture(url);
      disposed.push(disposalCounts(gltf));
      return gltf;
    },
  });
  const pending = f.assets.loadBoardable();
  await tick();
  assert.equal(f.calls.length, 2);
  f.assets.dispose();
  release();
  await assert.rejects(pending, /disposed|superseded/i);
  assert.ok(f.calls.every((url) => url.includes('/bus-hybrid/')));
  assert.equal(f.assets.stats().loadedTemplates, 0);
  assert.ok(
    disposed.every((resources) =>
      [...resources.values()].every((n) => n === 1),
    ),
  );
});

test('published hybrid GLBs enter traffic and a parked visit without silently falling back', async () => {
  const metadata = JSON.parse(
    await readFile('public/models/blender/bus-hybrid/manifest.json', 'utf8'),
  );
  const f = fixture({ metadata, load: parsePayload });
  try {
    await near(f);
    assert.equal(f.assets.stats().status, 'ready');
    assert.equal(f.assets.stats().exteriorVersion, 'hybrid');
    assert.equal(f.assets.stats().allocatedBatches, 15);
    assert.deepEqual(f.assets.stats().errors, []);
    const owner = await f.assets.loadBoardable();
    assert.equal(owner.manifest.accessibility, metadata.accessibility);
    assert.equal(owner.animations.length, 4);
    const ramp = owner.exteriorRoot.getObjectByName('boarding-ramp');
    assert.ok(ramp);
    let rampPrimitives = 0;
    ramp.traverse((o) => {
      if (o.isMesh) rampPrimitives++;
    });
    assert.ok(
      rampPrimitives > 0,
      'the actual ramp rig retains its deployable geometry',
    );
    const pairBytes = metadata.assets[0].lods
      .slice(0, 2)
      .reduce((sum, lod) => sum + lod.bytes, 0);
    assert.equal(f.assets.stats().hybridPreflightBytes, pairBytes);
    assert.equal(
      f.assets.stats().assetBytes,
      pairBytes +
        baseline.assets[1].lods[0].bytes +
        baseline.assets[1].lods[1].bytes,
    );
    assert.equal(
      f.calls.filter((url) => url.includes('/bus-hybrid/')).length,
      2,
    );
    assert.ok(
      f.calls.every((url) => !url.includes('/bus/city-bus-12m-exterior')),
    );
    owner.dispose();
  } finally {
    f.assets.dispose();
  }
});
