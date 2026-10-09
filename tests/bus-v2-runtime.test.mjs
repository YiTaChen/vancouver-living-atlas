import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
import { loadBusV2Projection } from '../tools/project-bus-v2-runtime.mjs';
const { CityBusAssets } = await import(cityModule('bus-assets'));
const { BusCabinVisit } = await import(cityModule('bus-visit'));
const { busVisitSelectedAnchor } = await import(
  cityModule('bus-visit-selection')
);
const {
  metadata: manifest,
  metadataBytes,
  entries,
} = await loadBusV2Projection();
const route = (x = 0) => ({
  a: [x, -100],
  b: [x, 100],
  length: 200,
  speed: 0,
  phase: 0.25,
});
const policy = { quality: 'high', compatible: false, allowNew: true };
const parse = async (url) => {
  const bytes = await readFile(`public${url.split('?')[0]}`);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
};
function fixture(routes = [route()], mutate) {
  const calls = [],
    originals = new Map();
  const assets = new CityBusAssets(routes, new THREE.Group(), {
    interiorVersion: 'v2',
    fetchManifest: async () => manifest,
    load: async (url) => {
      calls.push(url);
      const gltf = await parse(url);
      if (mutate) mutate(gltf, url);
      gltf.scene.traverse((object) => {
        if (object.isMesh)
          originals.set(object.geometry, {
            position: Array.from(
              object.geometry.getAttribute('position').array,
            ),
            normal: Array.from(object.geometry.getAttribute('normal').array),
            color: object.material.color.clone(),
            roughness: object.material.roughness,
            metalness: object.material.metalness,
            opacity: object.material.opacity,
            emissive: object.material.emissive.clone(),
          });
      });
      return gltf;
    },
  });
  return { assets, calls, originals };
}

test('production bus v2 projection deploys exactly the budget candidate and reuses the pinned original exterior', async () => {
  assert.equal(manifest.contract, 'boardable-bus-runtime-v2');
  assert.deepEqual(
    entries.map((entry) => entry.path),
    [
      'bus-v2/city-bus-12m-interior-v2-runtime.lod0.glb',
      'bus-v2/city-bus-12m-interior-v2-runtime.lod1.glb',
      'bus-v2/manifest.json',
    ],
  );
  assert.ok(
    (await readFile('public/models/blender/bus-v2/manifest.json')).equals(
      metadataBytes,
    ),
  );
  assert.deepEqual(
    manifest.assets[1].lods.map((lod) => lod.triangles),
    [11704, 2824],
  );
  assert.deepEqual(
    manifest.assets[1].lods.map((lod) => lod.bytes),
    [736884, 202492],
  );
  assert.ok(
    manifest.assets[0].lods.every((lod) =>
      lod.url.startsWith('/models/blender/bus/'),
    ),
  );
  assert.ok(
    manifest.assets[1].lods.every(
      (lod) =>
        lod.url.startsWith('/models/blender/bus-v2/') &&
        !('componentSidecar' in lod),
    ),
  );
  assert.equal(manifest.vehicles[0].interiorLayout.activeSeats, 24);
});

test('v2 ambient LOD1 has 15 shared authored surfaces, four bounded buses and the existing compatibility/fallback policy', async () => {
  const f = fixture(Array.from({ length: 8 }, (_, index) => route(index * 3)));
  try {
    assert.equal(f.calls.length, 0);
    f.assets.update(0, new THREE.Vector3(), () => 0, policy);
    await f.assets.ready;
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((url) => url.includes('.lod1.glb')));
    const replaced = f.assets.update(0, new THREE.Vector3(), () => 0, policy);
    assert.equal(replaced.size, 4);
    const stats = f.assets.stats();
    assert.equal(stats.allocatedBatches, 15);
    assert.equal(stats.materials, 15);
    assert.equal(stats.textures, 0);
    assert.equal(
      stats.triangles,
      4 * (manifest.assets[0].lods[1].triangles + 2824),
    );
    const seats = f.assets.group.children.find(
      (mesh) => mesh.material.userData.shared_surface_id === 'bus-v2-seat',
    );
    const shell = f.assets.group.children.find(
      (mesh) =>
        mesh.material.userData.shared_surface_id === 'bus-v2-seat-shell',
    );
    assert.notEqual(seats.material, shell.material);
    assert.ok(Math.abs(seats.material.color.r - 0.01) < 1e-6);
    assert.ok(Math.abs(seats.material.roughness - 0.78) < 1e-6);
    assert.equal(
      f.assets.group.children.filter(
        (mesh) => mesh.material.userData.semantic_role === 'glass',
      ).length,
      2,
    );
    for (const mesh of f.assets.group.children) {
      assert.equal(mesh.count, 4);
      assert.equal(mesh.geometry.getAttribute('color').itemSize, 4);
      assert.ok(
        Array.from(mesh.geometry.getAttribute('color').array).every(
          (value) => value === 1,
        ),
      );
      assert.equal(mesh.material.vertexColors, true);
    }
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, {
        ...policy,
        compatible: true,
      }).size,
      2,
    );
    f.assets.setExcludedRoutes(new Set([0]));
    assert.ok(!f.assets.update(0, new THREE.Vector3(), () => 0, policy).has(0));
    assert.equal(
      f.assets.update(0, new THREE.Vector3(0, 1000, 0), () => 0, {
        ...policy,
        allowNew: false,
      }).size,
      0,
    );
  } finally {
    f.assets.dispose();
  }
});

test('v2 parked LOD0 preserves actual PBR/geometry, neutral COLOR_0, 24 cameras, real stairs and flush doorway support', async () => {
  const f = fixture();
  try {
    const owner = await f.assets.loadBoardable();
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((url) => url.includes('.lod0.glb')));
    assert.equal(owner.vehicle.seats.length, 24);
    assert.equal(owner.vehicle.standingRegions.length, 1);
    assert.equal(owner.animations.length, 4);
    for (const seat of owner.vehicle.seats) {
      const node = owner.interiorRoot.getObjectByName(seat.cameraAnchorNodeId);
      assert.ok(node);
      assert.ok(
        node
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(new THREE.Vector3(...seat.cameraEyePointM)) < 1e-5,
      );
    }
    const support = owner.cabinSurfaces;
    for (const [x, z, height, id] of [
      [0, 0, 0.36, 'low-floor'],
      [0, -1.58, 0.52, 'rear-step-1'],
      [0, -1.82, 0.68, 'rear-step-2'],
      [0, -3.1, 0.68, 'raised-rear'],
      [-1.2, 4.275, 0.36, 'front-door-threshold-extension'],
      [-1.2, -0.625, 0.36, 'rear-door-threshold-extension'],
    ]) {
      const floor = support.floorAt(x, z);
      assert.equal(floor.surfaceId, id);
      assert.ok(Math.abs(floor.heightM - height) < 1e-5);
    }
    assert.equal(support.floorAt(-1.4, 4.275), null);
    assert.equal(support.canStand(0, 0), true);
    assert.equal(
      support.canStand(0, -3.1),
      false,
      'rear headroom is seated-only',
    );
    assert.equal(
      support.canStand(0, -1.58),
      false,
      'steps do not offer standing anchors',
    );
    assert.equal(
      support.canStand(0.8, 5.2),
      false,
      'driver equipment is an obstacle',
    );
    owner.group.traverse((object) => {
      if (!object.isMesh) return;
      const original = f.originals.get(object.geometry);
      assert.deepEqual(
        Array.from(object.geometry.getAttribute('position').array),
        original.position,
      );
      assert.deepEqual(
        Array.from(object.geometry.getAttribute('normal').array),
        original.normal,
      );
      assert.ok(object.material.color.equals(original.color));
      assert.equal(object.material.roughness, original.roughness);
      assert.equal(object.material.metalness, original.metalness);
      assert.equal(object.material.opacity, original.opacity);
      assert.ok(object.material.emissive.equals(original.emissive));
      assert.ok(
        Array.from(object.geometry.getAttribute('color').array).every(
          (value) => value === 1,
        ),
      );
    });
    owner.group.position.set(20, 7, 40);
    owner.group.rotation.y = 0.4;
    assert.ok(
      Math.abs(support.floorAt(0, -1.58).heightM - 0.52) < 1e-5,
      'support remains vehicle-local after world placement',
    );
    owner.dispose();
    const next = await f.assets.loadBoardable();
    assert.equal(
      f.calls.length,
      2,
      'source templates are reused across visits',
    );
    assert.notEqual(next.group, owner.group);
  } finally {
    f.assets.dispose();
  }
});

test('v2 support rejects a real slab tilt even while source bounds and triangle counts remain unchanged', async () => {
  const f = fixture([route()], (gltf, url) => {
    if (!url.includes('bus-v2/')) return;
    gltf.scene.traverse((object) => {
      if (
        !object.isMesh ||
        object.material.userData.shared_surface_id !== 'bus-v2-floor'
      )
        return;
      const positions = object.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++)
        if (
          positions.getZ(i) > 3.7 &&
          positions.getX(i) < -1.15 &&
          positions.getY(i) > 0.35
        )
          positions.setY(
            i,
            positions.getY(i) + (0.048 * (-positions.getX(i) - 1.15)) / 0.1,
          );
    });
  });
  try {
    await assert.rejects(
      f.assets.loadBoardable(),
      /Actual bus cabin floor does not support front-door-threshold-extension/,
    );
    assert.equal(f.assets.stats().boardableOwners, 0);
  } finally {
    f.assets.dispose();
  }
});

function cityFixture() {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.Element = class Element {};
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(58, 1.6, 0.08, 10000),
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

test('production v2 cabin opens original doors, boards the low floor, previews inward/rear cameras and alights to valid ground', async () => {
  const f = fixture(),
    city = cityFixture(),
    visit = new BusCabinVisit(city, f.assets, [route()]);
  try {
    assert.equal(await visit.prepare(), true);
    for (let i = 0; i < 25; i++) visit.update(0.05);
    const ready = visit.snapshot();
    assert.equal(ready.anchors.length, 25);
    assert.equal(ready.doorsOpen, true);
    assert.equal(ready.canBoard, true);
    // Exercise the panel's initial/saved selection with the actual v2 visit.
    const selected = busVisitSelectedAnchor(ready, 'main-aisle');
    assert.equal(selected, 'low-floor-aisle');
    assert.equal(visit.board(selected), true);
    const aisleCamera = manifest.vehicles[0].cameraAnchors.find(
        (camera) => camera.cameraId === 'camera-aisle',
      ),
      busOwner = city.scene.children.find(
        (object) => object.name === 'Parked city bus cabin visit',
      );
    assert.ok(
      city.camera.position.distanceTo(
        new THREE.Vector3(...aisleCamera.eyePointM).applyMatrix4(
          busOwner.matrixWorld,
        ),
      ) < 1e-5,
    );
    const passenger = visit.snapshot().passengerAnchor;
    for (const seat of manifest.vehicles[0].seats) {
      assert.equal(visit.preview(seat.seatId), true);
      assert.equal(visit.snapshot().passengerAnchor, passenger);
      const owner = city.scene.children.find(
        (object) => object.name === 'Parked city bus cabin visit',
      );
      const expected = new THREE.Vector3(...seat.cameraEyePointM).applyMatrix4(
        owner.matrixWorld,
      );
      assert.ok(city.camera.position.distanceTo(expected) < 1e-5);
      const expectedDirection = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(new THREE.Quaternion(...seat.facingQuaternionXYZW))
        .applyQuaternion(owner.quaternion);
      assert.ok(
        city.camera
          .getWorldDirection(new THREE.Vector3())
          .distanceTo(expectedDirection) < 1e-5,
      );
    }
    assert.equal(visit.alight(), true);
    assert.equal(city.navigation.mode, 'walk');
    assert.equal(city.navigation.surfaceId, 'ground');
    assert.equal(visit.exit(), true);
    assert.equal(f.assets.stats().boardableOwners, 0);
  } finally {
    visit.dispose();
    f.assets.dispose();
  }
});

test('stage 2 manifest paths and bounded material identities fail closed', async () => {
  const bad = structuredClone(manifest);
  bad.assets[1].lods[0].url =
    '/models/blender/bus/city-bus-12m-interior.lod0.glb';
  const assets = new CityBusAssets([], new THREE.Group(), {
    interiorVersion: 'v2',
    fetchManifest: async () => bad,
    load: async () => {
      throw new Error('A malformed projection must never load');
    },
  });
  try {
    await assert.rejects(assets.loadBoardable(), /Invalid bus LOD descriptor/);
  } finally {
    assets.dispose();
  }
});
