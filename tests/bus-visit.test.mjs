import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
import {
  walkBusTo,
  walkBusToSeat,
  walkBusToRearDoor,
} from './helpers/bus-passenger-controls.mjs';
const { BusCabinVisit, findBusVisitPlacement } = await import(
  cityModule('bus-visit')
);
const { CityInteractions, projectInteractionAnchor } = await import(
  cityModule('city-interactions')
);
const manifest = JSON.parse(
  await readFile(
    new URL('../public/models/blender/bus/manifest.json', import.meta.url),
    'utf8',
  ),
);
const doorPoint = (group) =>
  manifest.vehicles[0].doors.find((door) => door.doorGroupId === group)
    .boardingPointM;
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
  const calls = {
    placements: [],
    exclusions: [],
    loads: 0,
    disposals: 0,
    poses: [],
  };
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
    walker: {
      group: new THREE.Group(),
      setSeated: (value, height) => calls.poses.push({ value, height }),
      update() {},
    },
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
    'new rear body edge at -6.3 must fit',
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

test('parking follows the actual asymmetric bounds and rotates both corrected door exits', () => {
  const { city } = cityFixture();
  const route = [
    { a: [-100, 0], b: [100, 0], length: 200, speed: 8, phase: 0.25 },
  ];
  const placement = findBusVisitPlacement(city, route);
  assert.ok(placement);
  assert.ok(Math.abs(placement.frontFloor.x - 4.6) < 1e-7);
  assert.ok(Math.abs(placement.frontFloor.z - 1.7) < 1e-7);
  assert.ok(Math.abs(placement.rearFloor.x + 1.85) < 1e-7);
  assert.ok(Math.abs(placement.rearFloor.z - 1.7) < 1e-7);
  assert.ok(
    Math.abs(placement.frontFloor.x - placement.rearFloor.x - 6.45) < 1e-7,
  );

  city.navigation.clearGround = (_x, z) => z >= -6.05 && z <= 6.4;
  const shorter = { min: [-1.52, 0, -6], max: [1.52, 3.2, 6.1] };
  const longer = { min: [-1.52, 0, -6.3], max: [1.52, 3.2, 6.1] };
  const front = [-1.7, 0.36, 4.6],
    rear = [-1.7, 0.36, -1.85];
  assert.ok(findBusVisitPlacement(city, routes, front, rear, shorter));
  assert.equal(
    findBusVisitPlacement(city, routes, front, rear, longer),
    null,
    'supported old tail cannot hide unsupported newly extended rear bumper',
  );
});

test('prepare checks metadata full bounds before placing a visitor and blocks the extended body', async () => {
  const f = await fixture();
  try {
    f.owner.vehicle = structuredClone(f.owner.vehicle);
    f.owner.vehicle.fullBoundsM.min[2] = -6.35;
    f.city.navigation.clearGround = (_x, z) => z >= -6.05 && z <= 6.5;
    assert.equal(await f.visit.prepare(), false);
    assert.match(f.visit.snapshot().error, /No safe flat bus parking/);
    assert.equal(f.calls.placements.length, 0);
    assert.equal(f.calls.disposals, 1);
  } finally {
    f.visit.dispose();
  }

  const placed = await fixture();
  try {
    placed.owner.vehicle = structuredClone(placed.owner.vehicle);
    placed.owner.vehicle.bodyBoundsM.min[2] = -6.3;
    assert.equal(await placed.visit.prepare(), true);
    assert.equal(placed.visit.blocksGround(0, -6.2), true);
    assert.equal(placed.visit.blocksGround(0, -6.4), false);
  } finally {
    placed.visit.dispose();
  }
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
    assert.equal(
      f.visit.blocksGround(doorPoint('front')[0], doorPoint('front')[2]),
      false,
    );
  } finally {
    f.visit.dispose();
  }
});

test('boarding enters the physical aisle; nearby sitting uses metadata and look preserves the occupied seat', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    assert.equal(
      f.visit.board('seat-09'),
      true,
      'legacy seat selection still enters the aisle',
    );
    assert.equal(f.visit.aboard, true);
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    const spawn = f.visit.space.spawn();
    const standingEye = f.owner.interiorRoot.worldToLocal(
      f.city.camera.position.clone(),
    );
    assert.ok(
      standingEye.distanceTo(
        new THREE.Vector3(
          spawn[0],
          spawn[1] + f.visit.space.standingEyeHeight(spawn),
          spawn[2],
        ),
      ) < 1e-7,
    );
    assert.equal(f.city.camera.near, 0.05);
    assert.equal(f.city.navigation.walker.group.visible, false);
    assert.equal(
      f.visit.preview('seat-09'),
      false,
      'distant seat selection cannot teleport',
    );
    walkBusToSeat(f.visit, 'seat-09');
    const candidate = f.visit
      .interactionCandidates()
      .find((row) => row.id === 'bus:seat:seat-09');
    assert.ok(candidate && candidate.canInteract());
    const approachHeading = f.city.camera.getWorldDirection(new THREE.Vector3());
    assert.equal(candidate.execute(), true);
    assert.ok(
      approachHeading.dot(f.city.camera.getWorldDirection(new THREE.Vector3())) > 0.999999,
      'sitting changes the seated body pose without turning the chosen view',
    );
    const seat = f.visit.space.seats.find((row) => row.id === 'seat-09');
    const localEye = f.owner.interiorRoot.worldToLocal(
      f.city.camera.position.clone(),
    );
    assert.ok(
      localEye.distanceTo(
        new THREE.Vector3(
          seat.position[0] + seat.eyeOffsetXZ[0],
          seat.position[1] + seat.eyeHeight,
          seat.position[2] + seat.eyeOffsetXZ[1],
        ),
      ) < 1e-7,
    );
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    assert.equal(f.visit.snapshot().previewAnchor, null);
    assert.equal(f.visit.snapshot().viewAnchor, 'seat-09');
    assert.deepEqual(f.calls.poses.at(-1), {
      value: true,
      height: seat.seatHeight,
    });
    assert.equal(f.visit.snapshot().seated, true);
    assert.equal(
      f.visit.alight(),
      false,
      'a seated passenger must first stand and reach the rear door',
    );
    assert.equal(f.visit.close(), false);
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
    const viewedHeading = f.city.camera.getWorldDirection(new THREE.Vector3());
    assert.equal(f.visit.preview('seat-09'), true);
    assert.equal(f.visit.preview('seat-01'), false);
    assert.equal(f.visit.preview('missing'), false);
    const stand = f.visit.interactionCandidates()[0];
    assert.equal(stand.action, 'stand');
    assert.equal(stand.execute(), true);
    assert.ok(
      viewedHeading.dot(f.city.camera.getWorldDirection(new THREE.Vector3())) > 0.999999,
      'standing keeps the heading the passenger chose through free look',
    );
    const walk = f.visit.space.walk.bind(f.visit.space);
    let requested;
    f.visit.space.walk = (point, x, z) => {
      requested = new THREE.Vector3(x, 0, z);
      return walk(point, x, z);
    };
    f.visit.setTouchAxes(0, 1);
    f.visit.update(0.02);
    f.visit.clearInput();
    const worldStep = requested.transformDirection(
      f.owner.interiorRoot.matrixWorld,
    );
    assert.ok(
      worldStep.dot(viewedHeading.clone().setY(0).normalize()) > 0.999999,
      'mobile forward follows the visible heading instead of the old body facing',
    );
    f.visit.space.walk = walk;
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    assert.equal(f.visit.snapshot().seated, false);
    assert.equal(f.calls.poses.at(-1).value, false);
    assert.equal(
      stand.canInteract(),
      false,
      'a stale stand prompt cannot repeat',
    );
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
    blocker.position.set(-0.9, 1.5, doorPoint('front')[2]);
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

test('a prepared bus cannot board a world-seated visitor or release a blocked seat; boarding resumes after a valid stand', async () => {
  const source = await readFile(
      new URL('../lib/city/navigation.ts', import.meta.url),
      'utf8',
    ),
    ast = ts.createSourceFile(
      'navigation.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
    ),
    navigation = ast.statements.find(
      (node) =>
        ts.isClassDeclaration(node) && node.name.text === 'StreetNavigation',
    ),
    leave = navigation.members.find(
      (node) =>
        ts.isMethodDeclaration(node) &&
        node.name.getText(ast) === 'leaveWalkSeat',
    );
  assert(leave, 'exercise the real navigation stand-up interlock');
  const { SeatNavigation } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        `export class SeatNavigation { ${leave.getText(ast)} }`,
      ).toString('base64')
  );
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    assert.equal(f.visit.snapshot().canBoard, true);
    const nav = f.city.navigation,
      origin = nav.position.clone(),
      eye = f.city.camera.position.clone(),
      rotation = f.city.camera.quaternion.clone(),
      visible = nav.walker.group.visible,
      placements = f.calls.placements.length;
    let exitClear = false,
      standChecks = 0;
    const seat = {
      id: 'world-bench-by-prepared-bus',
      floor: origin.toArray(),
      yaw: nav.yaw,
      height: 0.46,
      stand() {
        standChecks++;
        return exitClear ? origin.clone() : null;
      },
    };
    nav.walkSeat = seat;
    nav.walker.group.userData.seated = true;
    nav.walker.setSeated = (seated) => {
      nav.walker.group.userData.seated = seated;
    };
    nav.update = () => {};
    nav.leaveWalkSeat = SeatNavigation.prototype.leaveWalkSeat;
    assert.equal(
      nav.leaveWalkSeat(),
      false,
      'a blocked bench exit retains the seat',
    );
    assert.equal(f.visit.snapshot().canBoard, false);
    assert.equal(f.visit.board('seat-09'), false);
    f.visit.update(0.05);
    assert.equal(f.visit.aboard, false);
    assert.equal(f.visit.snapshot().passengerAnchor, null);
    assert.equal(nav.walkSeat, seat);
    assert.equal(nav.walker.group.userData.seated, true);
    assert.equal(
      standChecks,
      1,
      'boarding cannot bypass or implicitly retry the stand-up action',
    );
    assert.equal(nav.walker.group.visible, visible);
    assert.deepEqual(nav.position, origin);
    assert.deepEqual(f.city.camera.position, eye);
    assert.ok(f.city.camera.quaternion.equals(rotation));
    assert.equal(f.calls.placements.length, placements);
    exitClear = true;
    assert.equal(nav.leaveWalkSeat(), true);
    assert.equal(nav.walkSeat, null);
    assert.equal(nav.walker.group.userData.seated, false);
    assert.equal(f.visit.snapshot().canBoard, true);
    assert.equal(f.visit.board('seat-09'), true);
    walkBusToRearDoor(f.visit);
    assert.equal(f.visit.alight(), true);
    assert.equal(nav.walkSeat, null);
    assert.equal(f.visit.aboard, false);
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
    f.visit.board();
    walkBusToRearDoor(f.visit);
    const camera = f.city.camera.position.clone();
    f.city.navigation.clearGround = (x, z) =>
      Math.abs(z - doorPoint('rear')[2]) > 0.4;
    assert.equal(f.visit.snapshot().canAlight, false);
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.close(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    assert.ok(f.city.camera.position.equals(camera));
    assert.equal(f.owner.group.parent, f.city.scene);
    f.city.navigation.clearGround = () => true;
    assert.equal(f.visit.alight(), true);
    assert.equal(f.city.navigation.mode, 'walk');
    assert.equal(f.city.navigation.position.x, -1.7);
    assert.equal(f.city.navigation.position.z, doorPoint('rear')[2]);
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
    f.visit.board();
    walkBusToRearDoor(f.visit);
    const source = f.city.navigation.position.clone(),
      eye = f.city.camera.position.clone();
    const originalStart = f.city.navigation.startAt;
    f.city.navigation.startAt = function () {
      this.position.set(100, 100, 100);
      return false;
    };
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    assert.ok(f.city.navigation.position.equals(source));
    assert.ok(f.city.camera.position.equals(eye));
    f.city.navigation.startAt = originalStart;
    let proofCalls = 0;
    const originalAperture = f.visit.apertureClear;
    f.visit.apertureClear = () => ++proofCalls <= 2;
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    assert.ok(f.city.navigation.position.equals(source));
    assert.ok(f.city.camera.position.equals(eye));
    assert.ok(
      proofCalls >= 3,
      'reject the final commit after navigation already moved',
    );
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

test('a real bounded street ride keeps seated and standing passengers attached, freezes hidden intervals and alights only at its current rear door', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    assert.equal(f.visit.board(), true);
    walkBusToSeat(f.visit, 'seat-09');
    const sit = f.visit
      .interactionCandidates()
      .find((row) => row.id === 'bus:seat:seat-09');
    assert.equal(sit.execute(), true);
    const localEye = f.owner.interiorRoot.worldToLocal(
      f.city.camera.position.clone(),
    );
    const localFoot = f.owner.interiorRoot.worldToLocal(
      f.city.navigation.position.clone(),
    );
    const parked = f.owner.group.position.clone();
    assert.equal(f.visit.snapshot().canRide, true);
    assert.equal(f.visit.startRide(), true);
    assert.equal(f.visit.startRide(), false, 'departure is single-flight');
    assert.equal(f.visit.snapshot().ridePhase, 'closing');
    assert.equal(f.visit.close(), false);
    assert.equal(f.visit.alight(), false);
    for (let i = 0; i < 65; i++) f.visit.update(0.05);
    assert.equal(f.visit.snapshot().ridePhase, 'moving');
    assert.ok(f.visit.speedMps > 0);
    assert.ok(f.owner.group.position.z > parked.z + 1);
    assert.equal(f.owner.group.position.x, parked.x);
    assert.ok(
      f.owner.interiorRoot
        .worldToLocal(f.city.camera.position.clone())
        .distanceTo(localEye) < 1e-7,
    );
    assert.ok(
      f.owner.interiorRoot
        .worldToLocal(f.city.navigation.position.clone())
        .distanceTo(localFoot) < 1e-7,
    );
    assert.ok(
      f.city.navigation.walker.group.position.equals(
        f.city.navigation.position,
      ),
    );
    assert.equal(f.visit.snapshot().passengerAnchor, 'seat-09');
    assert.equal(f.visit.snapshot().canAlight, false);
    const moving = f.owner.group.position.clone(),
      progress = f.visit.snapshot().rideProgress;
    f.doc.hidden = true;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    f.visit.update(120);
    assert.ok(f.owner.group.position.equals(moving));
    assert.equal(f.visit.snapshot().rideProgress, progress);
    f.doc.hidden = false;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    f.visit.update(120);
    assert.ok(
      f.owner.group.position.equals(moving),
      'resume never fast-forwards the ride',
    );
    f.visit.update(0.05);
    assert.ok(f.owner.group.position.z > moving.z);
    assert.equal(
      f.visit.stand(),
      true,
      'standing is supported during real motion',
    );
    assert.equal(f.visit.snapshot().canWalkCabin, true);
    const standLocal = f.owner.interiorRoot.worldToLocal(
      f.city.navigation.position.clone(),
    );
    f.visit.setTouchAxes(0, 1);
    f.visit.update(0.05);
    f.visit.clearInput();
    assert.ok(
      f.owner.interiorRoot
        .worldToLocal(f.city.navigation.position.clone())
        .distanceTo(standLocal) > 0.04,
    );
    const nearby = f.visit
      .interactionCandidates()
      .find((row) => row.action === 'sit');
    assert.ok(nearby);
    assert.equal(nearby.execute(), true, 'a moving rider can sit again');
    let maxZ = f.owner.group.position.z;
    for (let i = 0; i < 450; i++) {
      f.visit.update(0.05);
      assert.ok(
        f.owner.group.position.z >= maxZ - 1e-8,
        'ride never reverses or loops',
      );
      assert.ok(f.owner.group.position.z <= parked.z + 60 + 1e-8);
      maxZ = f.owner.group.position.z;
    }
    assert.equal(f.visit.snapshot().ridePhase, 'complete');
    assert.equal(f.visit.snapshot().rideProgress, 1);
    assert.equal(f.visit.speedMps, 0);
    assert.equal(f.visit.snapshot().doorsOpen, true);
    assert.equal(
      f.visit.startRide(),
      false,
      'no invented looping transit service',
    );
    assert.equal(f.visit.stand(), true);
    assert.equal(
      f.visit.alight(),
      false,
      'arrival does not teleport an aisle rider to the rear exit',
    );
    walkBusToRearDoor(f.visit);
    const rear = f.visit.freshOutside('rear');
    assert.ok(
      rear.z > parked.z + 50,
      'exit proof uses the actual new bus pose',
    );
    assert.equal(f.visit.alight(), true);
    assert.ok(
      f.city.navigation.position.distanceTo(
        new THREE.Vector3(rear.x, rear.y, rear.z),
      ) < 1e-7,
    );
    assert.equal(f.visit.close(), true);
  } finally {
    f.visit.dispose();
  }
});

test('fresh ride preflight fails closed on an unsafe corridor without moving the owner or occupant', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    assert.equal(f.visit.board(), true);
    const source = f.owner.group.position.clone(),
      passenger = f.city.navigation.position.clone();
    f.city.navigation.clearGround = (_x, z, mode) => mode !== 'drive' || z < 9;
    assert.equal(
      f.visit.startRide(),
      false,
      'less than 6m of whole-footprint corridor is unavailable',
    );
    assert.equal(f.visit.snapshot().canRide, false);
    assert.equal(f.visit.snapshot().ridePhase, 'parked');
    assert.ok(f.owner.group.position.equals(source));
    assert.ok(f.city.navigation.position.equals(passenger));
    assert.equal(f.visit.snapshot().passengerAnchor, 'main-aisle');
    f.city.navigation.clearGround = () => true;
    f.city.data.travelSurfaces.lookup = (_x, z) =>
      z > 9
        ? [
            {
              surfaceId: 'protected-deck',
              layer: 1,
              y: 7,
              allowedModes: ['drive'],
            },
          ]
        : [];
    assert.equal(
      f.visit.startRide(),
      false,
      'future protected floors cannot be silently relabelled ground',
    );
    f.city.data.travelSurfaces.lookup = () => [];
    assert.equal(
      f.visit.startRide(),
      true,
      'a fresh successful preflight can recover without a reload',
    );
  } finally {
    f.visit.dispose();
  }
});

test('seat prompts recheck physical proximity and input clearing prevents stale movement after sitting or a modal', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    f.visit.board();
    walkBusToSeat(f.visit, 'seat-09');
    const stale = f.visit
      .interactionCandidates()
      .find((row) => row.id === 'bus:seat:seat-09');
    assert.ok(stale.canInteract());
    walkBusTo(f.visit, (point) => point[2] < -0.7);
    assert.equal(stale.canInteract(), false);
    assert.equal(stale.execute(), false);
    walkBusToSeat(f.visit, 'seat-09');
    const current = f.visit
      .interactionCandidates()
      .find((row) => row.id === 'bus:seat:seat-09');
    const foot = f.city.navigation.position.clone();
    f.visit.setTouchAxes(0, 1);
    f.visit.setInputEnabled(false);
    f.visit.update(0.05);
    assert.ok(f.city.navigation.position.equals(foot));
    assert.deepEqual(f.visit.interactionCandidates(), []);
    assert.equal(current.execute(), false);
    f.visit.setInputEnabled(true);
    f.visit.update(0.05);
    assert.ok(
      f.city.navigation.position.equals(foot),
      'cleared touch axis cannot relatch',
    );
    assert.equal(current.execute(), true);
    const seated = f.city.navigation.position.clone();
    f.visit.setTouchAxes(1, 1);
    f.visit.update(0.05);
    assert.ok(f.city.navigation.position.equals(seated));
    assert.equal(f.visit.stand(), true);
    const standing = f.city.navigation.position.clone();
    f.visit.update(0.05);
    assert.ok(
      f.city.navigation.position.equals(standing),
      'standing cannot inherit touch input pressed while seated',
    );
    const key = new Event('keydown', { cancelable: true });
    Object.defineProperty(key, 'key', { value: 'f' });
    f.win.dispatchEvent(key);
    assert.equal(
      key.defaultPrevented,
      false,
      'global localized F interaction retains ownership of F',
    );
  } finally {
    f.visit.dispose();
  }
});

test('closing during a late cabin preload cancels the owner without changing navigation or leaking listeners', async () => {
  const f = await fixture();
  try {
    const source = f.city.navigation.position.clone(),
      eye = f.city.camera.position.clone();
    let resolve;
    f.assets.loadBoardable = () =>
      new Promise((done) => {
        resolve = done;
      });
    const loading = f.visit.prepare();
    assert.equal(f.visit.close(), true);
    assert.equal(f.visit.snapshot().phase, 'idle');
    resolve(f.owner);
    assert.equal(await loading, false);
    assert.equal(f.calls.disposals, 1);
    assert.equal(f.calls.placements.length, 0);
    assert.ok(f.city.navigation.position.equals(source));
    assert.ok(f.city.camera.position.equals(eye));
    assert.equal(f.city.scene.children.length, 0);
    assert.equal(f.visit.aboard, false);
  } finally {
    f.visit.dispose();
  }
  assert.equal(f.win.count(), 0);
  assert.equal(f.doc.count(), 0);
});

test('releasing a prepared visit does not reset the pose of an unrelated world bench seat', async () => {
  const f = await fixture();
  try {
    await f.visit.prepare();
    open(f.visit);
    const bench = {
      id: 'world-bench',
      floor: [-5, 7, 4],
      yaw: 0,
      height: 0.46,
    };
    f.city.navigation.walkSeat = bench;
    f.city.navigation.walker.setSeated(true, 0.46);
    const poses = f.calls.poses.length;
    assert.equal(f.visit.close(), true);
    assert.equal(f.city.navigation.walkSeat, bench);
    assert.equal(
      f.calls.poses.length,
      poses,
      'a visit can reset only the body pose it owns',
    );
  } finally {
    f.visit.dispose();
  }
});

const serviceFrame = (overrides = {}) => ({
  vehicleId: 'world-bus-0-0',
  routeId: 'real-circuit',
  sourceServiceId: 'bus-5:eastbound:regional',
  headsign: '5 Robson/To Downtown',
  x: 0,
  z: 0,
  yaw: 0,
  stationM: 400,
  speedMps: 0,
  phase: 'dwell',
  doorProgress: 1,
  stoppedSeconds: 3,
  stop: {
    id: 'bus-5:eastbound:actual-stop',
    sourceStopId: '613',
    name: 'Actual GTFS stop',
  },
  stopVisit: 2,
  progress: 0.1,
  ...overrides,
});

test('bus service doorway prompts remain visible and actionable while looking horizontally at the actual door', async (t) => {
  for (const action of ['board', 'alight'])
    await t.test(action, async () => {
      const f = await fixture();
      let host;
      try {
        f.city.settings = { mode: 'walk' };
        f.city.busVisit = f.visit;
        f.city.navigation.walkingHeight = function () {
          return this.position.y;
        };
        f.city.renderer.domElement.focus = () => {};
        assert.equal(await f.visit.prepareService(serviceFrame()), true);
        f.city.navigation.mode = 'walk';
        const front = doorPoint('front');
        f.city.navigation.position.set(front[0], 7, front[2]);
        f.visit.update(0.05);
        if (action === 'alight') {
          assert.equal(f.visit.board(), true);
          const rear = doorPoint('rear');
          walkBusTo(
            f.visit,
            (p) => Math.hypot(p[0] + 0.7, p[2] - rear[2]) < 0.08,
          );
          f.visit.yaw = -Math.PI / 2;
          f.visit.lookYaw = f.visit.pitch = 0;
          f.visit.updateCamera();
        } else {
          f.city.camera.position
            .copy(f.city.navigation.position)
            .add(new THREE.Vector3(0, 1.65, 0));
          f.city.camera.lookAt(
            f.city.camera.position.clone().add(new THREE.Vector3(1, 0, 0)),
          );
        }
        const prompt = f.visit
          .interactionCandidates()
          .find((p) => p.action === action);
        assert.ok(prompt && prompt.canInteract());
        assert.ok(
          projectInteractionAnchor(f.city.camera, prompt.anchor),
          `${action}: a normal horizontal view toward the actual door must project the prompt`,
        );
        host = new CityInteractions(f.city);
        let view;
        host.onChange = (next) => (view = next);
        host.setInputEnabled(true);
        host.update(performance.now(), true);
        assert.equal(view.snapshot?.id, prompt.id);
        if (action === 'board') {
          const key = new Event('keydown', { cancelable: true });
          Object.assign(key, { key: 'f', code: 'KeyF', repeat: false });
          window.dispatchEvent(key);
          assert.equal(key.defaultPrevented, true);
          assert.equal(f.visit.aboard, true);
        } else {
          assert.equal(host.interact(view.snapshot), true);
          assert.equal(f.visit.aboard, false);
        }
      } finally {
        host?.dispose();
        f.visit.dispose();
      }
    });
});

test('autonomous prewarming never moves the player; F board follows the current door and rejects stale departure', async () => {
  const f = await fixture();
  try {
    const initial = f.city.navigation.position.clone();
    assert.equal(await f.visit.prepareService(serviceFrame()), true);
    assert.equal(f.calls.placements.length, 0);
    assert.ok(f.city.navigation.position.equals(initial));
    f.city.navigation.mode = 'walk';
    const door = doorPoint('front');
    f.city.navigation.position.set(door[0], 7, door[2]);
    f.visit.update(0.05);
    const prompt = f.visit
      .interactionCandidates()
      .find((p) => p.action === 'board');
    assert.ok(prompt, 'standing at the actual open front door exposes F board');
    f.visit.applyServiceFrame(
      serviceFrame({ phase: 'closing', stoppedSeconds: 12, doorProgress: 0.8 }),
    );
    assert.equal(prompt.canInteract(), false);
    assert.equal(
      prompt.execute(),
      false,
      'stale F cannot board a departing vehicle',
    );
    assert.equal(f.visit.aboard, false);
    f.visit.applyServiceFrame(serviceFrame());
    const fresh = f.visit
      .interactionCandidates()
      .find((p) => p.action === 'board');
    assert.equal(fresh.execute(), true);
    assert.equal(
      f.visit.startRide(),
      false,
      'route service has no passenger-controlled start',
    );
    const before = f.city.camera.position.clone();
    f.visit.applyServiceFrame(
      serviceFrame({
        phase: 'moving',
        doorProgress: 0,
        stoppedSeconds: 0,
        speedMps: 5,
        x: 8,
        z: 4,
        yaw: 0.2,
      }),
    );
    f.visit.update(0.05);
    assert.ok(f.city.camera.position.distanceTo(before) > 5);
    assert.equal(f.visit.aboard, true);
    assert.equal(
      f.visit.releaseService(),
      false,
      'occupied owner identity cannot be released by proximity LOD',
    );
    assert.equal(f.visit.snapshot().canAlight, false);
    f.visit.applyServiceFrame(
      serviceFrame({
        x: 8,
        z: 4,
        yaw: 0.2,
        stopVisit: 3,
        stop: {
          id: 'bus-6:future-source-stop',
          sourceStopId: '81',
          name: 'Future real stop',
        },
      }),
    );
    f.visit.update(0.05);
    walkBusToRearDoor(f.visit);
    const exit = f.visit
      .interactionCandidates()
      .find((p) => p.action === 'alight');
    assert.ok(
      exit,
      'F exit appears only after walking to the open rear door at a later stop',
    );
    f.visit.applyServiceFrame(
      serviceFrame({
        x: 8,
        z: 4,
        yaw: 0.2,
        stopVisit: 3,
        phase: 'closing',
        doorProgress: 0.8,
      }),
    );
    assert.equal(
      exit.execute(),
      false,
      'a stale exit cannot alight after closing begins',
    );
    f.visit.applyServiceFrame(
      serviceFrame({ x: 8, z: 4, yaw: 0.2, stopVisit: 3 }),
    );
    const freshExit = f.visit
      .interactionCandidates()
      .find((p) => p.action === 'alight');
    assert.equal(freshExit.execute(), true);
    assert.equal(f.visit.aboard, false);
    assert.equal(f.city.navigation.mode, 'walk');
    assert.ok(
      f.city.navigation.position.distanceTo(
        new THREE.Vector3(...doorPoint('rear'))
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.2)
          .add(new THREE.Vector3(8, 7 - doorPoint('rear')[1], 4)),
      ) < 0.01,
    );
  } finally {
    f.visit.dispose();
  }
});

test('a late preload adopts the current service pose instead of spawning at its old stop', async () => {
  const f = await fixture();
  try {
    let resolve;
    f.assets.loadBoardable = () =>
      new Promise((done) => {
        resolve = done;
      });
    const loading = f.visit.prepareService(serviceFrame());
    f.visit.applyServiceFrame(
      serviceFrame({
        x: 24,
        z: 14,
        yaw: 0.4,
        phase: 'moving',
        doorProgress: 0,
        stoppedSeconds: 0,
        speedMps: 4,
      }),
    );
    resolve(f.owner);
    assert.equal(await loading, true);
    assert.equal(f.calls.placements.length, 0);
    assert.equal(f.owner.group.position.x, 24);
    assert.equal(f.owner.group.position.z, 14);
    assert.equal(f.visit.snapshot().ridePhase, 'moving');
    assert.equal(f.visit.snapshot().doorsOpen, false);
  } finally {
    f.visit.dispose();
  }
});
