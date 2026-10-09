import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
const { BusCabinVisit, findBusVisitPlacement } = await import(
  cityModule('bus-visit')
);
const manifest = JSON.parse(
  await readFile(
    new URL('../public/models/blender/bus/manifest.json', import.meta.url),
    'utf8',
  ),
);
const loader = new GLTFLoader();
const routes = [
  { a: [0, -100], b: [0, 100], length: 200, speed: 8, phase: 0.25 },
];

class ListenerTarget extends EventTarget {
  listeners = new Map();
  addEventListener(name, fn, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    super.addEventListener(name, fn, options);
  }
  removeEventListener(name, fn, options) {
    this.listeners.get(name)?.delete(fn);
    super.removeEventListener(name, fn, options);
  }
  count() {
    return [...this.listeners.values()].reduce(
      (n, entries) => n + entries.size,
      0,
    );
  }
}
function cityFixture() {
  const win = new ListenerTarget(),
    doc = new ListenerTarget(),
    canvas = new ListenerTarget();
  doc.hidden = false;
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.Element = class Element {};
  canvas.setPointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  const calls = { placements: [], exclusions: [], loads: 0, disposals: 0 };
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(58, 1.6, 0.08, 10000),
    controls: { target: new THREE.Vector3(), enabled: true },
    renderer: { domElement: canvas },
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
    keys: new Set(),
    walker: { group: new THREE.Group() },
    car: new THREE.Group(),
    clearGround: () => true,
    groundHeight: () => 7,
    blur() {
      this.keys.clear();
      this.speed = 0;
    },
    startAt(mode, point) {
      calls.placements.push({ mode, ...point });
      this.mode = mode;
      this.position.set(point.x, point.y, point.z);
      this.yaw = point.yaw;
      this.surface = point.surface;
      this.surfaceId = point.surfaceId;
      this.surfaceLayer = point.layer;
      this.blur();
      city.camera.near = 0.08;
      city.camera.fov = 58;
      return true;
    },
  };
  return { city, calls, win, doc, canvas };
}
async function actualOwner(calls) {
  const parse = async (name) => {
    const bytes = await readFile(
      new URL(`../public/models/blender/bus/${name}`, import.meta.url),
    );
    return loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
  };
  const [exterior, interior] = await Promise.all([
    parse('city-bus-12m-exterior.lod0.glb'),
    parse('city-bus-12m-interior.lod0.glb'),
  ]);
  const group = new THREE.Group();
  group.add(exterior.scene, interior.scene);
  const mixer = new THREE.AnimationMixer(group);
  let disposed = false;
  return {
    group,
    exteriorRoot: exterior.scene,
    interiorRoot: interior.scene,
    animations: exterior.animations,
    mixer,
    manifest,
    vehicle: manifest.vehicles[0],
    dispose() {
      if (disposed) return;
      disposed = true;
      calls.disposals++;
      mixer.stopAllAction();
      mixer.uncacheRoot(group);
      group.removeFromParent();
      const geometries = new Set(),
        materials = new Set();
      group.traverse((o) => {
        if (o.isMesh) {
          geometries.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
async function fixture() {
  const f = cityFixture();
  f.owner = await actualOwner(f.calls);
  f.assets = {
    async loadBoardable() {
      f.calls.loads++;
      return f.owner;
    },
    setExcludedRoutes(ids) {
      f.calls.exclusions.push([...ids]);
    },
  };
  f.visit = new BusCabinVisit(f.city, f.assets, routes);
  return f;
}
const open = (visit) => {
  for (let i = 0; i < 25; i++) visit.update(0.05);
};

test('parking checks front/rear clearance, entire footprint and exact ground identity', () => {
  const { city } = cityFixture();
  const placement = findBusVisitPlacement(city, routes);
  assert.ok(placement);
  assert.equal(
    placement.position.y,
    7,
    'new GLB root is tyre contact, never legacy +1.08',
  );
  assert.equal(placement.frontFloor.surfaceId, 'ground');
  assert.equal(placement.frontFloor.layer, 0);
  city.navigation.clearGround = (x, z) => Math.abs(z) <= 6.2;
  assert.equal(
    findBusVisitPlacement(city, routes),
    null,
    'front full body edge at 6.3 must fit',
  );
  city.navigation.clearGround = () => true;
  city.data.travelSurfaces.lookup = () => [
    {
      surfaceId: 'upper-deck',
      layer: 2,
      y: 7,
      allowedModes: ['walk', 'drive'],
    },
  ];
  assert.equal(
    findBusVisitPlacement(city, routes),
    null,
    'protected floor cannot be relabelled ground',
  );
  city.data.travelSurfaces.lookup = () => [];
  city.navigation.groundHeight = (x, z) => z * 0.03;
  assert.equal(
    findBusVisitPlacement(city, routes),
    null,
    'non-flat parking rejected',
  );
  city.navigation.groundHeight = () => 7;
  city.interiors.height = () => 7;
  assert.equal(
    findBusVisitPlacement(city, routes),
    null,
    'building interior rejected',
  );
});

test('prepare coalesces actual LOD0 loading, parks at contact height, opens actual clips and faces the bus', async () => {
  const f = await fixture();
  try {
    const a = f.visit.prepare(),
      b = f.visit.prepare();
    assert.equal(a, b);
    assert.equal(f.visit.snapshot().loading, true);
    assert.equal(await a, true);
    assert.equal(f.calls.loads, 1);
    assert.equal(f.owner.group.parent, f.city.scene);
    assert.equal(f.owner.group.position.y, 7);
    assert.equal(f.city.navigation.yaw, Math.PI / 2);
    assert.deepEqual(f.calls.exclusions.at(-1), [0]);
    assert.equal(f.visit.snapshot().anchors.length, 12);
    assert.equal(f.visit.snapshot().canBoard, false);
    assert.equal(f.visit.board('seat-09'), false);
    f.visit.update(0.05);
    assert.equal(f.visit.snapshot().doorsOpen, false);
    open(f.visit);
    assert.equal(f.visit.snapshot().doorsOpen, true);
    assert.equal(f.visit.snapshot().canBoard, true);
    assert.equal(
      f.visit.snapshot().error,
      'Bus entrance is not ready or clear',
    );
    const lights = f.owner.group.children.filter((o) => o.isPointLight);
    assert.equal(lights.length, 1);
    assert.equal(lights[0].castShadow, false);
    assert.equal(f.visit.blocksGround(0, 0), true);
    assert.equal(f.visit.blocksGround(-1.7, 4.275), false);
  } finally {
    f.visit.dispose();
  }
});

test('seat and standing camera eyes follow metadata; preview and pointer look preserve occupancy', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    assert.equal(f.visit.board('seat-09'), true);
    assert.equal(f.visit.aboard, true);
    const localEye = f.owner.group.worldToLocal(f.city.camera.position.clone());
    assert.ok(
      localEye.distanceTo(new THREE.Vector3(-0.83, 1.47, 2.125)) < 1e-7,
    );
    assert.equal(f.city.camera.near, 0.05);
    assert.equal(f.city.navigation.walker.group.visible, false);
    assert.equal(f.visit.preview('main-aisle'), true);
    const state = f.visit.snapshot();
    assert.equal(state.passengerAnchor, 'seat-09');
    assert.equal(state.previewAnchor, 'main-aisle');
    assert.equal(state.viewAnchor, 'main-aisle');
    const standing = manifest.vehicles[0].standingRegions.find(
      (r) => r.regionId === 'main-aisle',
    );
    const standingEye = f.owner.group.worldToLocal(
      f.city.camera.position.clone(),
    );
    assert.ok(
      standingEye.distanceTo(
        new THREE.Vector3(
          standing.feetPointM[0],
          standing.feetPointM[1] + 1.62,
          standing.feetPointM[2],
        ),
      ) < 1e-7,
    );
    const before = f.city.camera.quaternion.clone();
    const event = (type, values) => {
      const e = new Event(type, { cancelable: true });
      for (const [key, value] of Object.entries({
        target: f.canvas,
        ...values,
      }))
        Object.defineProperty(e, key, { value });
      f.win.dispatchEvent(e);
    };
    event('pointerdown', { button: 0, pointerId: 4, clientX: 20, clientY: 20 });
    event('pointermove', { pointerId: 4, clientX: 80, clientY: 50 });
    assert.ok(before.angleTo(f.city.camera.quaternion) > 0.1);
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    event('pointerup', { pointerId: 4 });
    assert.equal(f.visit.preview('seat-09'), true);
    assert.equal(f.visit.snapshot().previewAnchor, null);
    assert.equal(f.visit.preview('missing'), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
  } finally {
    f.visit.dispose();
  }
});

test('boarding rejects remote, boat, protected floors and actual doorway blockers', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    f.city.navigation.position.x = 80;
    assert.equal(f.visit.board('seat-09'), false);
    f.city.navigation.position.x = -1.7;
    f.city.navigation.mode = 'boat';
    assert.equal(f.visit.board('seat-09'), false);
    f.city.navigation.mode = 'walk';
    f.city.navigation.surfaceId = 'upper-deck';
    assert.equal(f.visit.board('seat-09'), false);
    f.city.navigation.surfaceId = 'ground';
    const blocker = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2, 1.2),
      new THREE.MeshBasicMaterial(),
    );
    blocker.position.set(-0.9, 1.5, 4.275);
    f.owner.group.add(blocker);
    assert.equal(f.visit.snapshot().canBoard, false);
    assert.equal(f.visit.board('seat-09'), false);
    blocker.removeFromParent();
    blocker.geometry.dispose();
    blocker.material.dispose();
    assert.equal(f.visit.board('seat-09'), true);
  } finally {
    f.visit.dispose();
  }
});

test('fresh commit proof failure retains the walking source instead of boarding', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    const source = f.city.navigation.position.clone();
    let calls = 0;
    f.visit.apertureClear = () => ++calls === 1;
    assert.equal(f.visit.board('seat-09'), false);
    assert.equal(f.visit.aboard, false);
    assert.equal(f.visit.snapshot().passengerAnchor, null);
    assert.ok(f.city.navigation.position.equals(source));
    assert.equal(f.visit.transfers.pendingFor('parked-city-bus'), 0);
  } finally {
    f.visit.dispose();
  }
});

test('invalid fresh rear ground retains rider/camera; successful alighting returns to legal walking ground', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    f.visit.board('seat-09');
    const camera = f.city.camera.position.clone();
    f.city.navigation.clearGround = (x, z) => Math.abs(z + 0.625) > 0.4;
    assert.equal(f.visit.snapshot().canAlight, false);
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.close(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    assert.ok(f.city.camera.position.equals(camera));
    assert.equal(f.owner.group.parent, f.city.scene);
    f.city.navigation.clearGround = () => true;
    assert.equal(f.visit.alight(), true);
    assert.equal(f.city.navigation.mode, 'walk');
    assert.equal(f.city.navigation.position.x, -1.7);
    assert.equal(f.city.navigation.position.z, -0.625);
    assert.equal(f.city.navigation.position.y, 7);
    assert.equal(f.visit.snapshot().passengerAnchor, null);
    assert.equal(f.visit.snapshot().previewAnchor, null);
    assert.equal(f.visit.close(), true);
    assert.equal(f.owner.group.parent, null);
    assert.deepEqual(f.calls.exclusions.at(-1), []);
  } finally {
    f.visit.dispose();
  }
});

test('hidden intervals freeze doors and actions; resume drops the old interval', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    f.visit.update(0.05);
    const before = f.visit.doorProgress;
    f.doc.hidden = true;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    f.visit.update(120);
    assert.equal(f.visit.doorProgress, before);
    assert.equal(f.visit.board('seat-09'), false);
    f.doc.hidden = false;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    f.visit.update(120);
    assert.equal(f.visit.doorProgress, before);
    f.visit.update(0.05);
    assert.equal(f.visit.doorProgress, before + 0.05);
    open(f.visit);
    f.visit.board('seat-09');
    const camera = f.city.camera.quaternion.clone();
    f.doc.hidden = true;
    assert.equal(f.visit.preview('seat-01'), false);
    assert.equal(f.visit.alight(), false);
    assert.ok(f.city.camera.quaternion.equals(camera));
  } finally {
    f.visit.dispose();
  }
});

test('failed navigation placement or fresh alight commit keeps the seat and restores the source camera', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    f.visit.board('seat-09');
    const source = f.city.navigation.position.clone(),
      eye = f.city.camera.position.clone();
    const originalStart = f.city.navigation.startAt;
    f.city.navigation.startAt = function () {
      this.position.set(100, 100, 100);
      return false;
    };
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    assert.ok(f.city.navigation.position.equals(source));
    assert.ok(f.city.camera.position.equals(eye));
    f.city.navigation.startAt = originalStart;
    let proofCalls = 0;
    const originalAperture = f.visit.apertureClear;
    f.visit.apertureClear = () => ++proofCalls === 1;
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    assert.ok(f.city.navigation.position.equals(source));
    assert.ok(f.city.camera.position.equals(eye));
    assert.equal(f.visit.transfers.pendingFor('parked-city-bus'), 0);
    f.visit.apertureClear = originalAperture;
    assert.equal(f.visit.alight(), true);
  } finally {
    f.visit.dispose();
  }
});

test('dispose cancels late owners and releases all listeners without late scene/navigation changes', async () => {
  const f = await fixture();
  let resolve;
  f.assets.loadBoardable = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = f.visit.prepare();
  assert.ok(f.win.count() > 0 && f.doc.count() > 0);
  f.visit.dispose();
  assert.equal(f.win.count(), 0);
  assert.equal(f.doc.count(), 0);
  resolve(f.owner);
  assert.equal(await pending, false);
  assert.equal(f.calls.disposals, 1);
  assert.equal(f.calls.placements.length, 0);
  assert.equal(f.city.scene.children.length, 0);
  assert.equal(f.visit.prepare() instanceof Promise, true);
  assert.equal(await f.visit.prepare(), false);
});

test('invalid GLTF door contract fails closed and releases the owner before moving the player', async () => {
  const f = await fixture();
  try {
    f.owner.group.getObjectByName('door-right-front-a').name = 'missing-door';
    assert.equal(await f.visit.prepare(), false);
    assert.equal(f.visit.snapshot().phase, 'error');
    assert.equal(f.visit.snapshot().canBoard, false);
    assert.equal(f.calls.disposals, 1);
    assert.equal(f.calls.placements.length, 0);
    assert.equal(f.city.scene.children.length, 0);
  } finally {
    f.visit.dispose();
  }
});
