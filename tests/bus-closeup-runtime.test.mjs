import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
const { CityBusAssets } = await import(cityModule('bus-assets'));
const { BusCabinVisit } = await import(cityModule('bus-visit'));
const { busVisitProfile } = await import(cityModule('bus-visit-policy'));
const budget = JSON.parse(
  await readFile('public/models/blender/bus-v2/manifest.json', 'utf8'),
);
const reference = JSON.parse(
  await readFile('public/models/blender/bus-closeup/manifest.json', 'utf8'),
);
const route = { a: [0, -100], b: [0, 100], length: 200, speed: 0, phase: 0.25 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
globalThis.self = globalThis;
class TestBitmap {
  width = 256;
  height = 256;
  closes = 0;
  close() {
    this.closes++;
  }
}
globalThis.ImageBitmap = TestBitmap;
async function parseActual(url) {
  const bytes = await readFile(`public${url.split('?')[0]}`),
    loader = new GLTFLoader();
  // Substitute bitmap decoding only. GLTFLoader still reads the real GLB
  // geometry, UV, PBR factors, embedded texture association and sampler.
  loader.register((parser) => ({
    name: 'node-bus-texture-decoder',
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
    '/models/blender/bus-closeup/',
  );
}
function fixture(override = {}) {
  const calls = [],
    loaded = [],
    metadata = { budget: 0, reference: 0 };
  const assets = new CityBusAssets([route], new THREE.Group(), {
    interiorVersion: 'v2',
    fetchManifest: async () => {
      metadata.budget++;
      return budget;
    },
    fetchReferenceManifest: async () => {
      metadata.reference++;
      return reference;
    },
    load: async (url, signal) => {
      calls.push({ url, signal });
      const gltf = await parseActual(url);
      loaded.push(gltf);
      return gltf;
    },
    ...override,
  });
  return { assets, calls, loaded, metadata };
}
function cityFixture() {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.Element = class Element {};
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), enabled: true },
    renderer: { domElement: new EventTarget() },
    data: { travelSurfaces: { lookup: () => [] } },
    interiors: { height: () => undefined },
    pageSuspended: false,
    contextLost: false,
    transition: null,
  };
  city.navigation = {
    mode: 'orbit',
    position: new THREE.Vector3(),
    yaw: 0,
    speed: 0,
    surface: 'ground',
    surfaceId: 'ground',
    surfaceLayer: 0,
    walker: { group: new THREE.Group() },
    car: new THREE.Group(),
    clearGround: () => true,
    groundHeight: () => 7,
    blur() {},
    startAt(mode, point) {
      this.mode = mode;
      this.position.set(point.x, point.y, point.z);
      this.yaw = point.yaw;
      this.surface = point.surface;
      this.surfaceId = point.surfaceId;
      this.surfaceLayer = point.layer;
      return true;
    },
  };
  return city;
}
const openDoors = (visit) => {
  for (let i = 0; i < 25; i++) visit.update(0.05);
};

test('visit detail selection follows live quality with an unconditional compatibility budget cap', () => {
  for (const quality of ['balanced', 'high', 'ultra']) {
    assert.equal(
      busVisitProfile({ quality, compatible: false, detail: 'auto' }),
      quality === 'balanced' ? 'reference-lod1' : 'reference-lod0',
    );
    assert.equal(
      busVisitProfile({ quality, compatible: false, detail: 'light' }),
      'budget',
    );
    assert.equal(
      busVisitProfile({ quality, compatible: false, detail: 'detailed' }),
      'reference-lod0',
    );
    for (const detail of ['auto', 'light', 'detailed'])
      assert.equal(
        busVisitProfile({ quality, compatible: true, detail }),
        'budget',
      );
  }
});

test('traffic requests budget assets only; reference visits retain exact real GLB geometry/PBR/texture and a six-template bound', async () => {
  const f = fixture();
  try {
    assert.equal(f.calls.length, 0);
    f.assets.update(0, new THREE.Vector3(), () => 0, {
      quality: 'high',
      compatible: false,
      allowNew: true,
    });
    await f.assets.ready;
    assert.equal(f.metadata.reference, 0);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(({ url }) => !url.includes('bus-closeup')));
    assert.equal(f.assets.stats().allocatedBatches, 15);
    for (const profile of ['reference-lod1', 'reference-lod0', 'budget']) {
      const owner = await f.assets.loadBoardable({ profile });
      assert.equal(owner.profile, profile);
      assert.equal(owner.fallback, false);
      assert.equal(
        owner.group.userData.provenance.packageId,
        owner.manifest.packageId,
      );
      let triangles = 0,
        meshes = 0;
      owner.interiorRoot.traverse((object) => {
        if (!object.isMesh) return;
        triangles +=
          (object.geometry.index?.count ??
            object.geometry.getAttribute('position').count) / 3;
        meshes++;
        assert.equal(object.material.vertexColors, true);
        assert.ok(
          Array.from(object.geometry.getAttribute('color').array).every(
            (value) => value === 1,
          ),
        );
      });
      assert.equal(
        triangles,
        profile === 'reference-lod0'
          ? 277040
          : profile === 'reference-lod1'
            ? 91504
            : 11704,
      );
      assert.equal(meshes, profile === 'budget' ? 11 : 13);
      assert.equal(owner.vehicle.seats.length, 24);
      assert.equal(owner.animations.length, 4);
      for (const seat of owner.vehicle.seats) {
        const node = owner.interiorRoot.getObjectByName(
          seat.cameraAnchorNodeId,
        );
        assert.ok(
          node
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(new THREE.Vector3(...seat.cameraEyePointM)) < 1e-5,
        );
      }
      for (const [x, z, height] of [
        [0, 0, 0.36],
        [0, -1.58, 0.52],
        [0, -1.82, 0.68],
        [0, -3.1, 0.68],
        [-1.2, 4.275, 0.36],
        [-1.2, -0.625, 0.36],
      ])
        assert.ok(
          Math.abs(owner.cabinSurfaces.floorAt(x, z).heightM - height) < 1e-5,
        );
      assert.equal(owner.cabinSurfaces.canStand(0, -3.1), false);
      if (profile !== 'budget') {
        const floor =
          owner.interiorRoot
            .getObjectByProperty('isMesh', true)
            .parent.children.find(
              (object) =>
                object.isMesh &&
                object.material.userData.shared_surface_id === 'bus-v2-floor',
            ) ??
          (() => {
            let found;
            owner.interiorRoot.traverse((object) => {
              if (
                object.isMesh &&
                object.material.userData.shared_surface_id === 'bus-v2-floor'
              )
                found = object;
            });
            return found;
          })();
        assert.ok(floor.geometry.getAttribute('uv'));
        assert.deepEqual(floor.material.color.toArray(), [1, 1, 1]);
        assert.equal(floor.material.map.colorSpace, THREE.SRGBColorSpace);
        assert.equal(floor.material.map.wrapS, THREE.RepeatWrapping);
        assert.equal(
          floor.material.map.minFilter,
          THREE.LinearMipmapLinearFilter,
        );
        assert.equal(floor.material.map.magFilter, THREE.LinearFilter);
        assert.equal(floor.material.map.flipY, false);
        assert.equal(floor.material.map.image.width, 256);
        let rail, seat;
        owner.interiorRoot.traverse((object) => {
          if (
            object.isMesh &&
            object.material.userData.shared_surface_id === 'bus-v2-rail'
          )
            rail = object;
          if (
            object.isMesh &&
            object.material.userData.shared_surface_id === 'bus-v2-seat'
          )
            seat = object;
        });
        assert.ok(Math.abs(rail.material.metalness - 0.78) < 1e-6);
        assert.ok(Math.abs(rail.material.roughness - 0.23) < 1e-6);
        assert.ok(Math.abs(seat.material.color.r - 0.01) < 1e-6);
      }
      owner.dispose();
    }
    const stats = f.assets.stats();
    assert.equal(stats.loadedTemplates, 6);
    assert.equal(stats.materials, 28);
    assert.equal(stats.referenceMaterials, 13);
    assert.equal(stats.textures, 2);
    const disposals = new Map();
    const bitmaps = new Set();
    for (const gltf of f.loaded)
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        for (const resource of [
          object.geometry,
          object.material,
          object.material.map,
        ].filter(Boolean)) {
          if (disposals.has(resource)) continue;
          disposals.set(resource, 0);
          resource.addEventListener('dispose', () =>
            disposals.set(resource, disposals.get(resource) + 1),
          );
        }
        if (object.material.map) bitmaps.add(object.material.map.source.data);
      });
    f.assets.dispose();
    assert.ok([...disposals.values()].every((count) => count === 1));
    assert.equal(bitmaps.size, 2);
    assert.ok([...bitmaps].every((bitmap) => bitmap.closes === 1));
    assert.equal(f.assets.stats().loadedTemplates, 0);
    assert.equal(f.assets.stats().textures, 0);
  } finally {
    f.assets.dispose();
  }
});

test('optional reference network failure falls back to the working budget visit and reports the chosen profile', async () => {
  let failed = false;
  const f = fixture({
    load: async (url) => {
      if (url.includes('bus-closeup') && !failed) {
        failed = true;
        throw new Error('optional network failure');
      }
      return parseActual(url);
    },
  });
  try {
    const owner = await f.assets.loadBoardable({ profile: 'reference-lod0' });
    assert.equal(owner.profile, 'budget');
    assert.equal(owner.requestedProfile, 'reference-lod0');
    assert.equal(owner.fallback, true);
    assert.match(f.assets.stats().errors[0], /network failure/);
    owner.dispose();
    const retry = await f.assets.loadBoardable({ profile: 'reference-lod0' });
    assert.equal(retry.profile, 'reference-lod0');
    assert.equal(retry.fallback, false);
  } finally {
    f.assets.dispose();
  }
});

test('actual reference visit freezes detail while aboard, preserves reservations/doors, and rejects blocked alighting', async () => {
  const f = fixture(),
    city = cityFixture(),
    visit = new BusCabinVisit(city, f.assets, [route]);
  try {
    assert.equal(
      await visit.prepare({
        quality: 'balanced',
        compatible: false,
        detail: 'auto',
      }),
      true,
    );
    assert.equal(visit.snapshot().profile, 'reference-lod1');
    const prior = city.scene.children.find(
      (object) => object.name === 'Parked city bus cabin visit',
    );
    assert.equal(
      await visit.prepare({
        quality: 'balanced',
        compatible: false,
        detail: 'detailed',
      }),
      true,
    );
    assert.equal(visit.snapshot().profile, 'reference-lod0');
    assert.equal(
      prior.parent,
      null,
      'preboarding detail change releases the old owner',
    );
    openDoors(visit);
    assert.equal(visit.board('low-floor-aisle'), true);
    const calls = f.calls.length;
    assert.equal(
      await visit.prepare({
        quality: 'ultra',
        compatible: false,
        detail: 'detailed',
      }),
      true,
    );
    assert.equal(visit.snapshot().profile, 'reference-lod0');
    assert.equal(f.calls.length, calls);
    assert.equal(visit.preview('seat-24'), true);
    assert.equal(visit.snapshot().passengerAnchor, 'low-floor-aisle');
    city.navigation.clearGround = () => false;
    assert.equal(visit.alight(), false);
    assert.equal(visit.snapshot().aboard, true);
    city.navigation.clearGround = () => true;
    assert.equal(visit.alight(), true);
    assert.equal(visit.exit(), true);
    assert.equal(
      await visit.prepare({
        quality: 'ultra',
        compatible: true,
        detail: 'detailed',
      }),
      true,
    );
    assert.equal(visit.snapshot().profile, 'budget');
  } finally {
    visit.dispose();
    f.assets.dispose();
  }
});

test('cancelled late reference parses dispose their texture/geometry and cannot trigger budget fallback or consume an owner', async () => {
  let pending;
  const f = fixture({
    load: async (url) => {
      const gltf = await parseActual(url);
      if (!url.includes('bus-closeup')) return gltf;
      return new Promise((resolve) => {
        pending = { gltf, resolve };
      });
    },
  });
  const controller = new AbortController();
  const result = f.assets
    .loadBoardable({ profile: 'reference-lod0', signal: controller.signal })
    .then(
      () => null,
      (error) => error,
    );
  try {
    while (!pending) await tick();
    let geometries = 0,
      textures = 0;
    pending.gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.addEventListener('dispose', () => geometries++);
      object.material.map?.addEventListener('dispose', () => textures++);
    });
    controller.abort();
    pending.resolve(pending.gltf);
    assert.ok(await result);
    assert.equal(geometries, 13);
    assert.equal(textures, 1);
    assert.equal(
      f.metadata.budget,
      0,
      'cancellation never downloads the fallback',
    );
    assert.equal(f.assets.stats().boardableOwners, 0);
  } finally {
    f.assets.dispose();
  }
});

test('reference metadata cannot relax budget caps and a broken floor texture fails closed into budget fallback', async () => {
  const invalidBudget = structuredClone(budget);
  invalidBudget.assets[1].lods[0].triangles = 277040;
  const bad = fixture({ fetchManifest: async () => invalidBudget });
  try {
    await assert.rejects(
      bad.assets.loadBoardable(),
      /Invalid bus LOD descriptor/,
    );
  } finally {
    bad.assets.dispose();
  }
  const f = fixture({
    load: async (url) => {
      const gltf = await parseActual(url);
      if (url.includes('bus-closeup'))
        gltf.scene.traverse((object) => {
          if (object.isMesh && object.material.map)
            object.material.map.colorSpace = THREE.NoColorSpace;
        });
      return gltf;
    },
  });
  try {
    const owner = await f.assets.loadBoardable({ profile: 'reference-lod1' });
    assert.equal(owner.profile, 'budget');
    assert.equal(owner.fallback, true);
    assert.match(f.assets.stats().errors[0], /floor texture/);
  } finally {
    f.assets.dispose();
  }
});
