import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {
  installTeslaVortexVaultQA,
  teslaQAVaultRoadCandidates,
  teslaQAVaultGroundAt,
  createTeslaQAVaultCars,
  nearestTeslaQAVaultHit,
  TESLA_QA_VAULT_DISTANCES,
} = await import(cityModule('tesla-vortex-vault-qa'));
const { CityTeslaWorld } = await import(cityModule('tesla-city-world'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const { createTesla } = await import(cityModule('tesla-state'));
const { createTeslaVortex } = await import(cityModule('tesla-vortex'));
const { project } = await import(cityModule('geo'));
const ROBSON = project([-123.12416073213134, 49.2841737758357]);
const shape = createTeslaRoadsterShape();
function graph({ width = 10, level = 'ground', bend = 0, count = 9 } = {}) {
  const nodes = Array.from({ length: count }, (_, id) => ({
    id,
    point: [ROBSON[0] + (id > 4 ? bend : 0), ROBSON[1] - 20 + id * 12],
    level,
    edgeIds: [],
  }));
  const edges = nodes.slice(1).map((_, id) => ({
    id,
    a: id,
    b: id + 1,
    width,
    classes: ['residential'],
  }));
  return { nodes, edges };
}
const cars = () =>
  TESLA_QA_VAULT_DISTANCES.map((distanceM) => ({
    position: [0, 0, distanceM],
    heading: 0,
    distanceM,
  }));
const pose = (z, y = 0.8) => ({
  position: [0, y, z],
  quaternion: [0, 0, 0, 1],
});

test('vault road selection follows only bounded actual connected wide ground edges and rejects short, narrow, protected and bending corridors', () => {
  const candidates = teslaQAVaultRoadCandidates(graph());
  assert(candidates.length > 0 && candidates.length <= 32);
  assert(
    candidates.every(
      (candidate) =>
        candidate.length >= 60 &&
        candidate.width >= 8 &&
        candidate.edgeIds.length <= 24,
    ),
  );
  for (const invalid of [
    { width: 7.99 },
    { level: 'bridge' },
    { count: 5 },
    { bend: 3, count: 8 },
  ])
    assert.equal(teslaQAVaultRoadCandidates(graph(invalid)).length, 0);
  const disconnected = graph();
  disconnected.edges = disconnected.edges.filter((edge) => edge.id % 2 === 0);
  assert.equal(teslaQAVaultRoadCandidates(disconnected).length, 0);
});

test('nearest overlay keeps initial overlap, original ties and all existing base obstacles without any zero/source filter', () => {
  const base = { fraction: 0, surfaceId: 'real-ceiling' },
    extra = { fraction: 0.1, surfaceId: 'qa-vault-car:0:body' };
  assert.equal(nearestTeslaQAVaultHit(base, extra), base);
  assert.equal(
    nearestTeslaQAVaultHit({ ...base, fraction: 0.3 }, extra),
    extra,
  );
  assert.equal(nearestTeslaQAVaultHit(base, { ...extra, fraction: 0 }), base);
  assert.equal(nearestTeslaQAVaultHit(null, extra), extra);
  assert.equal(nearestTeslaQAVaultHit(base, null), base);
  assert.throws(() =>
    nearestTeslaQAVaultHit(base, { ...extra, fraction: Number.NaN }),
  );
});

test('the five displayed original cars have matching solid collision triangles, reject ground drive-through and release every shared resource once', () => {
  const fixture = createTeslaQAVaultCars(cars()),
    disposed = new Map();
  try {
    assert.equal(fixture.group.children.length, 5);
    assert.equal(fixture.metadata.triangles, 120);
    assert.match(fixture.metadata.label, /not live traffic/);
    fixture.group.traverse((object) => {
      if (!object.isMesh) return;
      for (const resource of [object.geometry, object.material])
        if (!disposed.has(resource)) {
          disposed.set(resource, 0);
          resource.addEventListener('dispose', () =>
            disposed.set(resource, disposed.get(resource) + 1),
          );
        }
    });
    const query = {
        from: pose(0),
        to: pose(15),
        shape: { halfExtents: [0.8, 0.5, 1.8], clearance: 0.06 },
      },
      hit = fixture.world.sweep(query);
    assert(hit?.surfaceId.startsWith('qa-vault-car:0:'));
    assert.equal(hit.kind, 'obstacle');
    assert.equal(hit.adherable, false);
    assert(hit.fraction > 0 && hit.fraction < 1);
    const ignored = fixture.world.sweep({
      ...query,
      ignoreSurfaceId: hit.surfaceId,
    });
    assert(ignored, 'an obstacle cannot be granted ground permission');
    const inside = fixture.world.sweep({
      from: pose(8),
      to: pose(8),
      shape: { halfExtents: [0.01, 0.01, 0.01], clearance: 0 },
    });
    assert.equal(inside?.fraction, 0);
    assert.equal(
      fixture.world.sweep({ ...query, from: pose(0, 5), to: pose(40, 5) }),
      null,
    );
    fixture.dispose();
    fixture.dispose();
    assert([...disposed.values()].every((count) => count === 1));
  } finally {
    fixture.dispose();
  }
  assert.throws(() => createTeslaQAVaultCars(cars().slice(1)));
});

class Element extends EventTarget {
  children = [];
  style = {};
  textContent = '';
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute() {}
  remove() {}
}
function setup(t, { hostname = '127.0.0.1', enabled = true } = {}) {
  const saved = new Map(),
    env = process.env.VANCOUVER_VISUAL_QA,
    frames = new Map();
  let next = 0,
    autoFrames = true;
  const set = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const document = { hidden: false, createElement: () => new Element() };
  set('document', document);
  set('location', { hostname });
  set('requestAnimationFrame', (callback) => {
    const id = ++next;
    if (autoFrames) queueMicrotask(() => callback(0));
    else frames.set(id, callback);
    return id;
  });
  set('cancelAnimationFrame', (id) => frames.delete(id));
  if (enabled) process.env.VANCOUVER_VISUAL_QA = '1';
  else delete process.env.VANCOUVER_VISUAL_QA;
  t.after(() => {
    if (env === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = env;
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  return {
    document,
    holdFrames: () => {
      autoFrames = false;
    },
    flushFrame: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    panel: new Element(),
    lease: {
      active: false,
      isRunning() {
        return this.active;
      },
      begin() {
        if (this.active) return false;
        this.active = true;
        return true;
      },
      end() {
        this.active = false;
      },
    },
  };
}
function controlledEngine(t, roadGraph = graph(), { grade = 0 } = {}) {
  const geometry = new THREE.PlaneGeometry(30, 180).rotateX(-Math.PI / 2),
    material = new THREE.MeshBasicMaterial(),
    roads = new THREE.Group(),
    terrain = new THREE.Group(),
    mesh = new THREE.Mesh(geometry, material),
    events = [];
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++)
    vertices.setY(i, grade * vertices.getZ(i));
  mesh.position.set(ROBSON[0], 0, ROBSON[1] + 30);
  mesh.userData.asphaltSurface = true;
  mesh.userData.walkSurface = true;
  roads.add(mesh);
  const e = {
    roads,
    terrain,
    scene: new THREE.Scene(),
    data: { roadGraph, flightBuildingVolumes: [], buildingRoofs: new Map() },
    settings: { buildings: true },
    elevation: () => 0,
    waterWorld: { at: () => null },
    landmarkDetails: [],
    detailedTrees: { trees: [] },
    applySettings(settings) {
      this.settings = settings;
    },
    navigation: {
      position: [ROBSON[0], 1.05, ROBSON[1]],
      yaw: 0,
      startAt(mode, point) {
        events.push(['start', mode, point]);
        this.position = [point.x, point.y, point.z];
        this.yaw = point.yaw;
        return true;
      },
    },
  };
  const world = new CityTeslaWorld(e);
  e.tesla = {
    active: true,
    world,
    shape,
    state: null,
    deactivate() {
      this.active = false;
      events.push(['deactivate']);
    },
    enter() {
      const spawn = world.groundPoseNear(
        e.navigation.position,
        shape,
        e.navigation.yaw,
        0,
      );
      if (!spawn) return false;
      this.state = createTesla(
        spawn.pose.position,
        e.navigation.yaw,
        spawn.contact,
      );
      this.state.quaternion = [...spawn.pose.quaternion];
      this.active = true;
      events.push(['enter']);
      return true;
    },
    setView(view) {
      events.push(['view', view]);
    },
    clearInput() {
      events.push(['clear']);
    },
    setInputEnabled(value) {
      events.push(['input', value]);
    },
  };
  e.tesla.enter();
  t.after(() => {
    world.dispose();
    geometry.dispose();
    material.dispose();
  });
  return { e, world, events };
}
const button = (panel, label) => {
  const section = panel.children[0],
    found = section.children.find((child) => child.textContent === label);
  assert(found, label);
  return found.onclick();
};

test('installation is local opt-in only and reads no engine state before a deliberate fixture action', (t) => {
  const dom = setup(t),
    engine = new Proxy(
      {},
      {
        get() {
          throw new Error('eager engine read');
        },
      },
    );
  const helper = installTeslaVortexVaultQA(engine, dom.panel, dom.lease);
  assert(helper);
  assert.equal(helper.metadata(), null);
  helper.dispose();
  globalThis.location.hostname = 'example.com';
  assert.equal(
    installTeslaVortexVaultQA(engine, dom.panel, dom.lease),
    undefined,
  );
  globalThis.location.hostname = '127.0.0.1';
  delete process.env.VANCOUVER_VISUAL_QA;
  assert.equal(
    installTeslaVortexVaultQA(engine, dom.panel, dom.lease),
    undefined,
  );
});

test('actual ground proof and cloned real simulation prepare five cars without commanding player V; midpoint pause waits for real progress and disposal restores exact collision methods', async (t) => {
  const dom = setup(t),
    { e, world, events } = controlledEngine(t),
    original = world.sweep,
    departure = world.sweepGroundDeparture,
    helper = installTeslaVortexVaultQA(e, dom.panel, dom.lease);
  // Preflight yields are automatic; stop before the continuous observer starts.
  const add = e.scene.add.bind(e.scene);
  e.scene.add = (...objects) => {
    dom.holdFrames();
    return add(...objects);
  };
  await button(dom.panel, 'Controlled QA: prepare five-car vault');
  const metadata = helper.metadata();
  assert(!metadata.error, JSON.stringify(metadata));
  assert.equal(metadata.cars.length, 5);
  assert.deepEqual(
    metadata.cars.map((car) => car.distanceM),
    [...TESLA_QA_VAULT_DISTANCES],
  );
  assert.equal(metadata.preflight.appliedToPlayer, false);
  assert.equal(metadata.preflight.collisions, 0);
  assert.equal(e.tesla.state.mode, 'ground');
  assert.equal(e.tesla.state.vortex, null);
  assert(events.some(([kind]) => kind === 'start'));
  assert.notEqual(world.sweep, original);
  assert.notEqual(world.sweepGroundDeparture, departure);
  assert.equal(e.scene.children.length, 1);
  await button(dom.panel, 'Controlled QA: arm actual midpoint pause');
  const before = events.length;
  e.tesla.state.vortex = createTeslaVortex(0);
  dom.flushFrame();
  assert.equal(events.length, before, 'no pause at preparation/zero progress');
  e.tesla.state.vortex.elapsedS = 0.6;
  dom.flushFrame();
  assert.deepEqual(events.at(-1), ['input', false]);
  assert.equal(helper.metadata().pausedByQA, true);
  await button(dom.panel, 'Controlled QA: resume actual maneuver');
  assert.deepEqual(events.at(-1), ['input', true]);
  helper.dispose();
  helper.dispose();
  assert.equal(world.sweep, original);
  assert.equal(world.sweepGroundDeparture, departure);
  assert.equal(e.scene.children.length, 0);
});

test('unsupported/short-road preparation fails closed and never creates a car or collision override', async (t) => {
  const dom = setup(t),
    { e, world, events } = controlledEngine(t, graph({ count: 4 })),
    original = world.sweep,
    helper = installTeslaVortexVaultQA(e, dom.panel, dom.lease);
  await button(dom.panel, 'Controlled QA: prepare five-car vault');
  assert.match(helper.metadata().error, /No bounded/);
  assert.equal(helper.metadata().collisionOverlayActive, false);
  assert.equal(world.sweep, original);
  assert.equal(e.scene.children.length, 0);
  assert(!events.some(([kind]) => kind === 'start'));
  helper.dispose();
});

test('hidden cleanup releases a QA-owned midpoint suspension and restores the base world before any later foreground frame', async (t) => {
  const dom = setup(t),
    { e, world, events } = controlledEngine(t),
    original = world.sweep,
    helper = installTeslaVortexVaultQA(e, dom.panel, dom.lease),
    add = e.scene.add.bind(e.scene);
  e.scene.add = (...objects) => {
    dom.holdFrames();
    return add(...objects);
  };
  await button(dom.panel, 'Controlled QA: prepare five-car vault');
  assert.equal(helper.metadata().cars.length, 5);
  await button(dom.panel, 'Controlled QA: arm actual midpoint pause');
  e.tesla.state.vortex = createTeslaVortex(0);
  e.tesla.state.vortex.elapsedS = 0.6;
  dom.flushFrame();
  assert.deepEqual(events.at(-1), ['input', false]);
  dom.document.hidden = true;
  dom.flushFrame();
  assert.deepEqual(events.at(-1), ['input', true]);
  assert.equal(helper.metadata().pausedByQA, false);
  assert.equal(helper.metadata().collisionOverlayActive, false);
  assert.equal(world.sweep, original);
  assert.equal(e.scene.children.length, 0);
  helper.dispose();
});

test('public deactivation removes the fixture on its next observer frame, and a later prepare retains only five new cars', async (t) => {
  const dom = setup(t),
    { e, world } = controlledEngine(t),
    original = world.sweep,
    helper = installTeslaVortexVaultQA(e, dom.panel, dom.lease),
    add = e.scene.add.bind(e.scene);
  e.scene.add = (...objects) => {
    dom.holdFrames();
    return add(...objects);
  };
  await button(dom.panel, 'Controlled QA: prepare five-car vault');
  const first = e.scene.children[0];
  e.tesla.deactivate();
  e.tesla.enter(); // A same-frame re-entry still owns a new state/session.
  dom.flushFrame();
  assert.equal(world.sweep, original);
  assert.equal(e.scene.children.length, 0);
  // Drive deterministic requestAnimationFrame yields while a second preparation
  // is pending; continuous observation remains explicitly controlled by this test.
  const pending = button(dom.panel, 'Controlled QA: prepare five-car vault');
  for (let frame = 0; frame < 32; frame++) {
    dom.flushFrame();
    await Promise.resolve();
  }
  await pending;
  assert(!helper.metadata().error, JSON.stringify(helper.metadata()));
  assert.equal(e.scene.children.length, 1);
  assert.notEqual(e.scene.children[0], first);
  assert.equal(e.scene.children[0].children.length, 5);
  await button(dom.panel, 'Controlled QA: clear five-car fixture');
  assert.equal(world.sweep, original);
  assert.equal(e.scene.children.length, 0);
  assert.equal(helper.metadata(), null);
  helper.dispose();
});

test('wrong physical floor, failed launch proof and an existing real collision all fail closed before a fixture is admitted', async (t) => {
  const dom = setup(t),
    { e, world, events } = controlledEngine(t),
    original = world.sweep,
    helper = installTeslaVortexVaultQA(e, dom.panel, dom.lease),
    originalGround = world.groundPoseNear.bind(world),
    originalLaunch = world.hasLaunchClearance.bind(world);
  for (const fail of ['floor', 'launch', 'body']) {
    world.groundPoseNear = (...args) => {
      const spawn = originalGround(...args);
      return spawn && fail === 'floor'
        ? { ...spawn, identity: { ...spawn.identity, layer: 1 } }
        : spawn;
    };
    world.hasLaunchClearance = (...args) =>
      fail === 'launch' ? false : originalLaunch(...args);
    world.sweep =
      fail === 'body'
        ? () => ({
            fraction: 0,
            surfaceId: 'existing-obstacle',
            kind: 'obstacle',
            point: [0, 0, 0],
            normal: [0, 1, 0],
            adherable: false,
          })
        : original;
    await button(dom.panel, 'Controlled QA: prepare five-car vault');
    assert.match(helper.metadata().error, /No bounded/);
    assert.equal(helper.metadata().collisionOverlayActive, false);
    assert.equal(e.scene.children.length, 0);
  }
  assert(!events.some(([kind]) => kind === 'start'));
  world.sweep = original;
  helper.dispose();
});

test('sloped real-road discovery corrects only bounded probe requests and keeps the exact returned full-body ground proof', (t) => {
  setup(t);
  const { world } = controlledEngine(t, graph(), { grade: 0.02 }),
    target = [ROBSON[0], 1.05, ROBSON[1]],
    direct = world.groundPoseNear(target, shape, 0, 0),
    exact = teslaQAVaultGroundAt(world, target, shape, 0);
  assert(direct && exact);
  assert(
    Math.hypot(
      direct.pose.position[0] - target[0],
      direct.pose.position[2] - target[2],
    ) > 0.02,
    'the original single elevated probe legitimately shifts its centre on a slope',
  );
  assert(
    Math.hypot(
      exact.spawn.pose.position[0] - target[0],
      exact.spawn.pose.position[2] - target[2],
    ) <= 0.02,
  );
  assert(
    Math.hypot(exact.request[0] - target[0], exact.request[2] - target[2]) <=
      0.5,
  );
  assert.equal(exact.spawn.identity.surfaceId, 'ground');
  assert.equal(exact.spawn.identity.layer, 0);
  assert.equal(
    world.sweep({
      from: exact.spawn.pose,
      to: exact.spawn.pose,
      shape,
      ignoreSurfaceId: exact.spawn.contact.surfaceId,
    }),
    null,
  );
  assert(
    world.support({
      pose: exact.spawn.pose,
      shape,
      maxDistance: 0.8,
      adhesion: false,
      preferredSurfaceId: exact.spawn.contact.surfaceId,
    }),
  );
  const displaced = {
    groundPoseNear: () => ({
      ...exact.spawn,
      pose: {
        ...exact.spawn.pose,
        position: [target[0] + 2, exact.spawn.pose.position[1], target[2]],
      },
    }),
  };
  assert.equal(
    teslaQAVaultGroundAt(displaced, target, shape, 0),
    null,
    'never change a returned pose or chase an unbounded displaced seed',
  );
});
