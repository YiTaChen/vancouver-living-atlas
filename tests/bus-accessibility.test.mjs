import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { BusAccessibility, rampContainsPoint } = await import(
  cityModule('bus-accessibility')
);
const { BusCabinVisit, findBusVisitPlacement } = await import(
  cityModule('bus-visit')
);
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const accessibility = {
  schemaVersion: 1,
  kneelDropM: 0.0762,
  representative: true,
  notFleetCertification: true,
  ramp: {
    nodeId: 'boarding-ramp',
    lengthM: 1.12,
    widthM: 0.86,
    hingeM: [-1.25, 0.36, 4.6],
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
};
const near = (actual, expected, epsilon = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const matricesEqual = (actual, expected) =>
  actual.elements.forEach((value, i) => near(value, expected.elements[i]));

function measuredGround(
  matrix,
  curbX = -2.1,
  patches = [],
  heightAtZ = () => 0,
) {
  const vertices = [];
  const quad = (a, b, c, d) =>
    vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
  const zs = [-200, -20, -15, 15, 20, 200];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i],
      z1 = zs[i + 1],
      y0 = heightAtZ(z0),
      y1 = heightAtZ(z1);
    quad([curbX, y0, z0], [20, y0, z0], [20, y1, z1], [curbX, y1, z1]);
    quad(
      [-20, y0 + 0.15, z0],
      [curbX, y0 + 0.15, z0],
      [curbX, y1 + 0.15, z1],
      [-20, y1 + 0.15, z1],
    );
    quad(
      [curbX, y0, z0],
      [curbX, y0 + 0.15, z0],
      [curbX, y1 + 0.15, z1],
      [curbX, y1, z1],
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  const mesh = new THREE.Mesh(geometry),
    group = new THREE.Group();
  group.add(mesh, ...patches);
  group.applyMatrix4(matrix);
  group.updateWorldMatrix(true, true);
  return new GroundSurfaceIndex([mesh, ...patches]);
}

function rigFixture({
  nested = false,
  clearApproach = () => true,
  groundOverride,
  groundTriangles,
  groundPatches = [],
} = {}) {
  const world = new THREE.Group(),
    parent = new THREE.Group(),
    root = new THREE.Group();
  world.add(parent);
  parent.add(root);
  if (nested) {
    parent.position.set(20, 0, -11);
    parent.rotation.y = 0.73;
  }
  root.position.set(5, 7, 10);
  root.rotation.y = -0.41;
  const ramp = new THREE.Group();
  ramp.name = 'boarding-ramp';
  ramp.position.fromArray(accessibility.ramp.hingeM);
  root.add(ramp);
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.86),
    new THREE.MeshBasicMaterial(),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0.56, 0, -0.15);
  ramp.add(deck);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.1, 11.8),
    new THREE.MeshBasicMaterial(),
  );
  floor.position.set(0, 0.31, 0);
  root.add(floor);
  const wheels = [];
  for (const [i, name] of accessibility.wheelNodeIds.entries()) {
    const wheelParent = new THREE.Group();
    root.add(wheelParent);
    if (nested) {
      wheelParent.rotation.set(0.15, -0.24, 0.06);
      wheelParent.scale.set(1.1, 0.9, 1.05);
    }
    const wheel = new THREE.Group();
    wheel.name = name;
    wheel.position.set(i % 2 ? 1.1 : -1.1, 0.5, i < 2 ? 3.1 : -3.1);
    wheelParent.add(wheel);
    wheels.push(wheel);
  }
  world.updateWorldMatrix(true, true);
  const rootWorld = root.matrixWorld.clone();
  const groundIndex = measuredGround(rootWorld, -2, groundPatches);
  const ground = (x, z) => {
    const y = groundIndex.sample(x, z, 7);
    return y === undefined ? null : { y, surfaceId: 'ground', layer: 0 };
  };
  const controller = BusAccessibility.create(
    root,
    accessibility,
    groundOverride ?? ground,
    clearApproach,
    groundTriangles ?? ((bounds) => groundIndex.trianglesInBounds(bounds)),
  );
  return {
    world,
    parent,
    root,
    ramp,
    floor,
    wheels,
    controller,
    ground,
    rootWorld,
    groundIndex,
  };
}
function runUntil(controller, phase, each = () => {}) {
  for (let i = 0; i < 200 && controller.snapshot().phase !== phase; i++) {
    controller.update(0.05);
    each();
  }
  assert.equal(controller.snapshot().phase, phase);
}

test('accessibility is opt-in and rejects incomplete metadata, missing wheels and noncanonical hinge', () => {
  const f = rigFixture();
  assert.ok(f.controller);
  assert.equal(BusAccessibility.create(f.root, undefined, f.ground), null);
  assert.equal(
    BusAccessibility.create(
      f.root,
      { ...accessibility, kneelDropM: NaN },
      f.ground,
    ),
    null,
  );
  assert.equal(
    BusAccessibility.create(
      f.root,
      { ...accessibility, wheelNodeIds: ['one'] },
      f.ground,
    ),
    null,
  );
  const wheel = f.wheels[0];
  wheel.removeFromParent();
  assert.equal(BusAccessibility.create(f.root, accessibility, f.ground), null);
  f.controller.dispose();
  const g = rigFixture();
  g.ramp.position.y += 0.01;
  assert.equal(BusAccessibility.create(g.root, accessibility, g.ground), null);
});

test('kneel first, connect the real offset ramp to a measured curb, stow fully before raising; transformed tyres stay fixed', () => {
  const f = rigFixture({ nested: true }),
    c = f.controller;
  assert.ok(c);
  const wheels = f.wheels.map((wheel) => wheel.matrixWorld.clone());
  const tyreCheck = () => {
    f.world.updateWorldMatrix(true, true);
    f.wheels.forEach((wheel, i) => matricesEqual(wheel.matrixWorld, wheels[i]));
    assert.equal(c.aligned, true);
  };
  assert.equal(c.deploy(true), true);
  runUntil(c, 'deploying', () => {
    tyreCheck();
    near(c.snapshot().rampAngleRad, 0);
  });
  near(c.snapshot().bodyDropM, 0.0762);
  runUntil(c, 'deployed', () => {
    tyreCheck();
    near(c.snapshot().bodyDropM, 0.0762);
  });
  const surface = c.snapshot().surface;
  assert.ok(surface);
  assert.equal(surface.walkingEnabled, false);
  assert.ok(surface.normal[1] > 0.98);
  const corners = [
    [0, 0, -0.58],
    [0, 0, 0.28],
    [1.12, 0, 0.28],
    [1.12, 0, -0.58],
  ];
  corners.forEach((p, i) => {
    const actual = f.ramp.localToWorld(new THREE.Vector3(...p));
    near(actual.distanceTo(new THREE.Vector3(...surface.verticesM[i])), 0);
    if (i >= 2) near(actual.y, f.ground(actual.x, actual.z).y, 0.003);
  });
  assert.equal(c.stow(true), true);
  runUntil(c, 'raising', () => {
    tyreCheck();
    near(c.snapshot().bodyDropM, 0.0762);
  });
  near(c.snapshot().rampAngleRad, 0);
  runUntil(c, 'stowed', () => {
    tyreCheck();
    near(c.snapshot().rampAngleRad, 0);
  });
  matricesEqual(f.root.matrixWorld, f.rootWorld);
  assert.equal(c.snapshot().surface, null);
  assert.equal(
    c.blocksGround(surface.verticesM[2][0], surface.verticesM[2][2]),
    false,
  );
});

test('missing, steep, uneven and penetrating landing areas fail without lowering the bus', () => {
  const cases = [
    [() => null, 'landing-unavailable'],
    [() => ({ y: 5, surfaceId: 'ground', layer: 0 }), 'landing-too-steep'],
    [
      (x, z) => ({
        y: 7.15 + 0.03 * Math.sin(z),
        surfaceId: 'ground',
        layer: 0,
      }),
      'landing-uneven',
    ],
  ];
  for (const [sample, error] of cases) {
    const f = rigFixture({ groundOverride: sample });
    assert.equal(f.controller.deploy(true), false);
    assert.equal(f.controller.snapshot().error, error);
    near(f.controller.snapshot().bodyDropM, 0);
    matricesEqual(f.root.matrixWorld, f.rootWorld);
  }
  const f = rigFixture();
  const blocked = (x, z) => {
    const floor = f.ground(x, z);
    const p = new THREE.Vector3(x, 7, z).applyMatrix4(
      f.rootWorld.clone().invert(),
    );
    return { ...floor, y: floor.y + (p.x < -1.5 && p.x > -1.9 ? 0.4 : 0) };
  };
  const c = BusAccessibility.create(f.root, accessibility, blocked);
  assert.equal(c.deploy(true), false);
  assert.equal(c.snapshot().error, 'ramp-obstructed');
  const unindexed = rigFixture({ groundTriangles: () => null });
  assert.equal(unindexed.controller.deploy(true), false);
  assert.equal(unindexed.controller.snapshot().error, 'landing-unavailable');
  matricesEqual(unindexed.root.matrixWorld, unindexed.rootWorld);
});

test('actual cabin obstacles and an occupied deployment corridor block the ramp, while old controls cannot interrupt motion', () => {
  const f = rigFixture();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.7, 0.2),
    new THREE.MeshBasicMaterial(),
  );
  box.position.set(-0.65, 0.72, 4.45);
  f.root.add(box);
  assert.equal(f.controller.deploy(true), false);
  assert.equal(f.controller.snapshot().error, 'ramp-obstructed');
  const g = rigFixture({ clearApproach: () => false });
  assert.equal(g.controller.deploy(true), false);
  assert.equal(g.controller.snapshot().error, 'clear-ramp-area');
  box.removeFromParent();
  assert.equal(f.controller.deploy(false), false);
  assert.equal(f.controller.snapshot().error, 'front-door-closed');
  assert.equal(f.controller.deploy(true), true);
  assert.equal(f.controller.deploy(true), false);
  assert.equal(f.controller.stow(true), false);
  const before = f.controller.snapshot().bodyDropM;
  assert.equal(
    f.controller.update(0.05, false),
    true,
    'report a new paused error',
  );
  near(f.controller.snapshot().bodyDropM, before);
  assert.equal(f.controller.update(0.05, false), false, 'unchanged pause');
  assert.equal(f.controller.update(0.05, true), true, 'report resumed motion');
  assert.equal(f.controller.snapshot().error, null);
});

test('only the authored thin stow finish can touch the initial fold; a 3 cm rubber obstacle remains solid', () => {
  for (const [thickness, accepted] of [
    [0.008, true],
    [0.0105, true],
    [0.03, false],
  ]) {
    const f = rigFixture();
    const material = new THREE.MeshBasicMaterial();
    material.userData.shared_surface_id =
      thickness === 0.0105 ? 'bus-v2-marking' : 'bus-v2-rubber';
    const finish = new THREE.Mesh(
      thickness === 0.0105
        ? new THREE.BoxGeometry(0.6, 0.003, 0.018)
        : new THREE.BoxGeometry(0.62, thickness, 0.95),
      material,
    );
    finish.position.set(
      -0.77,
      thickness === 0.0105 ? 0.369 : 0.36 + thickness / 2,
      thickness === 0.0105 ? 4.135 : 4.6,
    );
    f.root.add(finish);
    assert.equal(
      f.controller.deploy(true),
      accepted,
      `finish thickness ${thickness}`,
    );
    if (accepted) {
      runUntil(f.controller, 'deployed');
      assert.equal(f.controller.snapshot().error, null);
      f.controller.stow(true);
      runUntil(f.controller, 'stowed');
    } else assert.equal(f.controller.snapshot().error, 'ramp-obstructed');
  }
});

test('the complete sweep rejects thin off-centre cabin obstacles and measured curb patches between the old sample tracks', () => {
  const cabin = rigFixture();
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.08));
  obstacle.position.set(-0.65, 0.7, 4.65);
  cabin.root.add(obstacle);
  assert.equal(cabin.controller.deploy(true), false);
  assert.equal(cabin.controller.snapshot().error, 'ramp-obstructed');
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.08));
  patch.position.set(-1.85, 0.2, 4.65);
  const terrain = rigFixture({ groundPatches: [patch] });
  const top = new THREE.Vector3(-1.85, 0.4, 4.65).applyMatrix4(
    terrain.rootWorld,
  );
  near(terrain.ground(top.x, top.z).y, top.y);
  assert.equal(terrain.controller.deploy(true), false);
  assert.equal(terrain.controller.snapshot().error, 'ramp-obstructed');
  matricesEqual(terrain.root.matrixWorld, terrain.rootWorld);
});

test('dispose restores neutral rig and repeated cycles recapture current parked wheel poses', () => {
  const f = rigFixture({ nested: true });
  const initialWheels = f.wheels.map((wheel) => wheel.matrixWorld.clone());
  f.controller.deploy(true);
  f.controller.update(0.05);
  f.controller.dispose();
  f.world.updateWorldMatrix(true, true);
  matricesEqual(f.root.matrixWorld, f.rootWorld);
  f.wheels.forEach((wheel, i) =>
    matricesEqual(wheel.matrixWorld, initialWheels[i]),
  );
  near(f.ramp.quaternion.angleTo(new THREE.Quaternion()), 0);
  assert.equal(f.controller.deploy(true), false);
  const g = rigFixture();
  g.wheels[0].rotation.z = 0.31;
  g.world.updateWorldMatrix(true, true);
  const changed = g.wheels[0].matrixWorld.clone();
  g.controller.deploy(true);
  runUntil(g.controller, 'deployed');
  matricesEqual(g.wheels[0].matrixWorld, changed);
  g.controller.stow(true);
  runUntil(g.controller, 'stowed');
  assert.equal(g.wheels[0].matrixAutoUpdate, true);
  g.wheels[0].rotation.z = 0.47;
  g.world.updateWorldMatrix(true, true);
  const changedBetweenCycles = g.wheels[0].matrixWorld.clone();
  assert.notDeepEqual(changedBetweenCycles.elements, changed.elements);
  g.controller.deploy(true);
  runUntil(g.controller, 'deployed');
  matricesEqual(g.wheels[0].matrixWorld, changedBetweenCycles);
});

test('parking landing probes reuse support validation without moving the rig or checking a closed cabin sweep', () => {
  const f = rigFixture({
    groundTriangles: () => {
      throw new Error('a parking probe must not run the deployment sweep');
    },
  });
  const wheels = f.wheels.map((wheel) => wheel.matrixWorld.clone());
  assert.equal(f.controller.landingFits(), true);
  matricesEqual(f.root.matrixWorld, f.rootWorld);
  f.wheels.forEach((wheel, i) => matricesEqual(wheel.matrixWorld, wheels[i]));
  assert.equal(f.controller.snapshot().phase, 'stowed');
  assert.equal(f.controller.snapshot().error, null);
});

async function visitFixture({ accessible = true, graded = false } = {}) {
  const manifest = JSON.parse(
    await readFile('public/models/blender/bus-v2/manifest.json', 'utf8'),
  );
  if (accessible) manifest.accessibility = structuredClone(accessibility);
  const root = new THREE.Group(),
    ramp = new THREE.Group();
  ramp.name = 'boarding-ramp';
  ramp.position.fromArray(accessibility.ramp.hingeM);
  root.add(ramp);
  const animations = [];
  for (const d of manifest.vehicles[0].doors) {
    const node = new THREE.Group();
    node.name = d.nodeId;
    node.position.fromArray(d.closedTransform.translationM);
    root.add(node);
    animations.push(
      new THREE.AnimationClip(d.animationClip, d.motion.durationS, [
        new THREE.VectorKeyframeTrack(
          `${d.nodeId}.position`,
          d.motion.keyframes.map((k) => k.timeS),
          d.motion.keyframes.flatMap((k) => k.transform.translationM),
        ),
      ]),
    );
  }
  for (const name of accessibility.wheelNodeIds) {
    const node = new THREE.Group();
    node.name = name;
    root.add(node);
  }
  const interiorRoot = new THREE.Group();
  root.add(interiorRoot);
  let disposed = false;
  const owner = {
    group: root,
    exteriorRoot: root,
    interiorRoot,
    manifest,
    vehicle: manifest.vehicles[0],
    animations,
    mixer: new THREE.AnimationMixer(root),
    dispose() {
      disposed = true;
      root.removeFromParent();
    },
  };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.Element = class Element {};
  const groundIndex = measuredGround(
    new THREE.Matrix4().makeTranslation(0, 7, 0),
    -2.1,
    [],
    graded ? (z) => (Math.abs(z) <= 15 ? z * 0.01 : 0) : undefined,
  );
  const sample = (x, z) => groundIndex.sample(x, z, 7);
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { enabled: true, target: new THREE.Vector3() },
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
    surface: 'ground',
    surfaceId: 'ground',
    surfaceLayer: 0,
    walker: { group: new THREE.Group() },
    car: new THREE.Group(),
    clearGround: () => true,
    groundHeight: sample,
    groundSurface: groundIndex,
    blur() {},
    startAt(mode, p) {
      this.mode = mode;
      this.position.set(p.x, p.y, p.z);
      this.surface = p.surface;
      this.surfaceId = p.surfaceId;
      this.surfaceLayer = p.layer;
      return true;
    },
  };
  const assets = { loadBoardable: async () => owner, setExcludedRoutes() {} };
  const visit = new BusCabinVisit(city, assets, [
    { a: [0, -100], b: [0, 100], length: 200, speed: 0, phase: 0 },
  ]);
  assert.equal(await visit.prepare(), true, visit.snapshot().error);
  for (let i = 0; i < 25; i++) visit.update(0.05);
  return {
    visit,
    owner,
    city,
    get disposed() {
      return disposed;
    },
  };
}

test('parked visit preserves 24 seats, normal boarding and rear exit; camera follows kneeling without changing reservations', async () => {
  const f = await visitFixture();
  try {
    assert.equal(f.visit.snapshot().anchors.length, 25);
    assert.equal(f.visit.snapshot().canBoard, true);
    assert.equal(
      f.visit.deployRamp(),
      false,
      'outside walker occupies the sweep',
    );
    assert.equal(f.visit.snapshot().accessibility.error, 'clear-ramp-area');
    assert.equal(
      f.visit.board('low-floor-aisle'),
      true,
      'ramp is optional for the existing transfer',
    );
    const eye = f.city.camera.position.clone(),
      anchor = f.visit.snapshot().passengerAnchor;
    assert.equal(
      f.visit.deployRamp(),
      true,
      'parked rider can operate the ramp',
    );
    assert.equal(f.visit.board('seat-01'), false);
    assert.equal(f.visit.alight(), false);
    assert.equal(f.visit.close(), false);
    for (let i = 0; i < 70; i++) f.visit.update(0.05);
    assert.equal(f.visit.snapshot().accessibility.phase, 'deployed');
    near(f.city.camera.position.y, eye.y - 0.0762);
    assert.equal(f.visit.snapshot().passengerAnchor, anchor);
    assert.equal(
      await f.visit.prepare({ detail: 'light' }),
      false,
      'profile cannot change while deployed',
    );
    assert.equal(
      f.visit.close(),
      false,
      'stow before releasing a deployed rig',
    );
    assert.equal(
      f.visit.alight(),
      true,
      'ordinary rear exit remains valid while parked and deployed',
    );
    assert.equal(f.city.navigation.surfaceId, 'ground');
    assert.equal(f.visit.stowRamp(), true);
    for (let i = 0; i < 70; i++) f.visit.update(0.05);
    assert.equal(f.visit.close(), true);
    assert.equal(f.disposed, true);
  } finally {
    f.visit.dispose();
  }
});

test('an outside walker can step aside and deploy; no-rig visits keep their original controls', async () => {
  const f = await visitFixture();
  try {
    f.city.navigation.position.z += 1.3;
    assert.equal(f.visit.deployRamp(), true);
    for (let i = 0; i < 70; i++) f.visit.update(0.05);
    const surface = f.visit.snapshot().accessibility.surface;
    assert.equal(rampContainsPoint(surface, -1.7, 4.6), true);
    assert.equal(
      f.visit.blocksGround(-1.7, 4.6),
      true,
      'ground walking cannot pass through the deployed deck',
    );
  } finally {
    f.visit.dispose();
  }
  const legacy = await visitFixture({ accessible: false });
  try {
    assert.equal(legacy.visit.snapshot().accessibility, null);
    assert.equal(legacy.visit.deployRamp(), false);
    assert.equal(legacy.visit.board('low-floor-aisle'), true);
    assert.equal(legacy.visit.close(), true);
  } finally {
    legacy.visit.dispose();
  }
  const unmeasured = await visitFixture();
  try {
    unmeasured.city.navigation.position.z += 1.3;
    unmeasured.city.navigation.groundSurface.sample = () => undefined;
    assert.equal(unmeasured.visit.deployRamp(), false);
    assert.equal(
      unmeasured.visit.snapshot().accessibility.error,
      'landing-unavailable',
    );
    near(unmeasured.owner.group.position.y, 7, 1e-7);
  } finally {
    unmeasured.visit.dispose();
  }
});

test('parking prefers a ramp-compatible measured road segment and preserves the original safe fallback', async () => {
  const f = await visitFixture({ graded: true });
  const routes = [
    { a: [0, -100], b: [0, 100], length: 200, speed: 0, phase: 0 },
  ];
  try {
    const original = findBusVisitPlacement(f.city, routes);
    assert.equal(
      original.position.z,
      0,
      'the nearest safe bus footprint is on a 1% road grade',
    );
    near(f.owner.group.position.z, -30, 1e-7);
    let probes = 0;
    const fallback = findBusVisitPlacement(
      f.city,
      routes,
      undefined,
      undefined,
      undefined,
      () => {
        probes++;
        return false;
      },
    );
    assert.ok(probes > 1);
    assert.ok(fallback.position.equals(original.position));
    assert.equal(f.visit.board('low-floor-aisle'), true);
    assert.equal(
      f.visit.deployRamp(),
      true,
      'full deployment remains separately checked after doors open',
    );
    for (let i = 0; i < 70; i++) f.visit.update(0.05);
    assert.equal(f.visit.snapshot().accessibility.phase, 'deployed');
  } finally {
    f.visit.dispose();
  }
});

test('actual hybrid rig clears each retained cabin and completes a measured curb connection without changing seat anchors', async () => {
  globalThis.self = globalThis;
  const loader = new GLTFLoader();
  loader.register((parser) => ({
    name: 'cpu-ramp-texture-decoder',
    beforeRoot() {
      // Only bitmap decoding is replaced; actual GLB triangles/rigs are parsed.
      parser.textureLoader = {
        load(_url, ok) {
          queueMicrotask(() =>
            ok(new THREE.Texture({ width: 256, height: 256 })),
          );
        },
      };
    },
  }));
  const parse = async (path) => {
    const bytes = await readFile(path);
    return loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
  };
  const exterior = await parse(
    'public/models/blender/bus-hybrid/city-bus-12m-exterior.lod0.glb',
  );
  const manifest = JSON.parse(
    await readFile('public/models/blender/bus-closeup/manifest.json', 'utf8'),
  );
  const hybridManifest = JSON.parse(
    await readFile('public/models/blender/bus-hybrid/manifest.json', 'utf8'),
  );
  const actualRig = hybridManifest.accessibility;
  const groundIndex = measuredGround(
    new THREE.Matrix4().makeTranslation(0, 7, 0),
  );
  for (const path of [
    'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod0.glb',
    'public/models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod1.glb',
    'public/models/blender/bus-v2/city-bus-12m-interior-v2-runtime.lod0.glb',
  ]) {
    const interior = await parse(path),
      root = new THREE.Group();
    root.add(exterior.scene.clone(true), interior.scene);
    root.position.y = 7;
    const mixer = new THREE.AnimationMixer(root);
    for (const clip of exterior.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    mixer.update(2);
    root.updateWorldMatrix(true, true);
    const seats = manifest.vehicles[0].seats.map((seat) => ({
      node: interior.scene.getObjectByName(seat.cameraAnchorNodeId),
      eye: seat.cameraEyePointM,
    }));
    assert.equal(seats.length, 24);
    seats.forEach(({ node }) => assert.ok(node, path));
    const wheels = actualRig.wheelNodeIds.map((name) =>
      root.getObjectByName(name),
    );
    const tyrePoses = wheels.map((wheel) => wheel.matrixWorld.clone());
    const controller = BusAccessibility.create(
      root,
      actualRig,
      (x, z) => ({
        y: groundIndex.sample(x, z, 7),
        surfaceId: 'ground',
        layer: 0,
      }),
      () => true,
      (bounds) => groundIndex.trianglesInBounds(bounds),
    );
    assert.ok(controller, path);
    assert.equal(
      controller.deploy(true),
      true,
      `${path}: ${controller.snapshot().error}`,
    );
    runUntil(controller, 'deployed');
    wheels.forEach((wheel, i) =>
      matricesEqual(wheel.matrixWorld, tyrePoses[i]),
    );
    seats.forEach(({ node, eye }) => {
      const p = node.getWorldPosition(new THREE.Vector3());
      near(p.y, 7 + eye[1] - 0.0762, 1e-5);
    });
    for (const p of controller.snapshot().surface.verticesM.slice(2))
      near(p[1], 7.15, 0.003);
    assert.equal(controller.stow(true), true);
    runUntil(controller, 'stowed');
    controller.dispose();
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
  }
});
