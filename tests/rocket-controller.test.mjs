import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

// Execute the actual controller. Only the two lazy resource imports are
// substituted so lifecycle failures and delayed completions are reproducible
// without a browser, WebGL context, AudioContext or canvas texture factory.
const source = readFileSync(
  new URL('../lib/city/rocket-controller.ts', import.meta.url),
  'utf8',
);
let code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
code = code.replace(
  /from ['"]([^'"]+)['"]/g,
  (_, id) =>
    `from '${id === 'three' ? import.meta.resolve(id) : cityModule(posix.normalize(id))}'`,
);
code = code.replace(
  /import\(['"]\.\/rocket-effects['"]\)/g,
  'globalThis.__rocketEffectsLoad()',
);
code = code.replace(
  /import\(['"]\.\/rocket-space['"]\)/g,
  'globalThis.__rocketSpaceLoad()',
);
const { RocketController } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const { createRocket, crashRocket, ROCKET_CONFIGS } = await import(
  cityModule('rocket-state')
);

class TrackedTarget extends EventTarget {
  callbacks = new Map();
  addEventListener(type, callback, options) {
    const records = this.callbacks.get(type) ?? new Set();
    records.add(callback);
    this.callbacks.set(type, records);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.callbacks.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  get listenerCount() {
    return [...this.callbacks.values()].reduce(
      (sum, callbacks) => sum + callbacks.size,
      0,
    );
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
    };
  }
}
const pointer = (id, x, y) => ({
  pointerId: id,
  clientX: x,
  clientY: y,
  button: 0,
  stopImmediatePropagation() {},
  preventDefault() {},
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(t) {
  const names = [
    'window',
    'document',
    'HTMLElement',
    '__rocketEffectsLoad',
    '__rocketSpaceLoad',
  ];
  const saved = names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const window = new TrackedTarget(),
    document = new TrackedTarget(),
    canvas = new TrackedTarget();
  document.hidden = false;
  Object.assign(globalThis, { window, document, HTMLElement: class {} });
  const resources = { effects: [], audio: [], space: [] };
  class Effects {
    damaged = 3;
    burning = 2;
    debris = 4;
    disposed = 0;
    before = 0;
    after = 0;
    heatExposure = 0;
    heatSamples = [];
    heightSamples = [];
    collisionHeight = () => null;
    constructor(engine) {
      this.engine = engine;
      this.group = new THREE.Group();
      engine.scene.add(this.group);
      resources.effects.push(this);
    }
    update() {}
    sampleVehicleHeat(state) {
      this.heatSamples.push({
        elapsed: state.elapsed,
        heat: state.heat,
        phase: state.phase,
      });
      return this.heatExposure;
    }
    supportCollisionHeight(x, z, state) {
      this.heightSamples.push({ x, z, elapsed: state.supportCollapseElapsed });
      return this.collisionHeight(x, z, state);
    }
    beforeRender() {
      this.before++;
    }
    afterRender() {
      this.after++;
    }
    dispose() {
      this.disposed++;
      this.group.removeFromParent();
    }
  }
  class Audio {
    disposed = 0;
    start() {}
    update() {}
    dispose() {
      this.disposed++;
    }
    constructor() {
      resources.audio.push(this);
    }
  }
  class Space {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, 1, 1e-7, 2000);
    disposed = 0;
    constructor() {
      resources.space.push(this);
    }
    update() {}
    getCelestialFocus(body) {
      return {
        target: new THREE.Vector3(body === 'sun' ? 400 : -400, 100, -500),
        fovDegrees: body === 'sun' ? 18 : 12,
      };
    }
    getHorizonTarget() {
      return new THREE.Vector3(0, -0.2, -1);
    }
    dispose() {
      this.disposed++;
    }
  }
  const effectsModule = { RocketEffects: Effects, RocketAudio: Audio },
    spaceModule = { RocketSpace: Space };
  globalThis.__rocketEffectsLoad = async () => effectsModule;
  globalThis.__rocketSpaceLoad = async () => spaceModule;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 20000);
  camera.position.set(100, 90, 120);
  scene.add(camera);
  const engine = {
    scene,
    camera,
    data: {},
    settings: { mode: 'orbit', autoRotate: false },
    compatibleGraphics: false,
    controls: {
      enabled: true,
      autoRotate: false,
      target: new THREE.Vector3(10, 0, 10),
      update() {},
    },
    renderer: {
      domElement: canvas,
      shadowMap: { needsUpdate: false },
      render() {},
    },
    navigation: {
      mode: 'orbit',
      setMode(mode) {
        this.mode = mode;
      },
    },
    elevation: () => 0,
    rawElevation: () => 0,
    landmarkDetails: [],
    buildings: new THREE.Group(),
    landmarks: new THREE.Group(),
    travelReturn: { invalidate() {} },
    closeBusVisit: () => true,
    completeLocalMapTransition() {},
    onRocketMode() {},
    leaveTravelAtLocation() {},
  };
  scene.add(engine.buildings, engine.landmarks);
  const controller = new RocketController(engine);
  t.after(() => {
    controller.destroy();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    controller,
    engine,
    resources,
    effectsModule,
    spaceModule,
    window,
    document,
    canvas,
  };
}
function readyFlight(
  controller,
  altitude = 100,
  support = { kind: 'ground' },
  kind = 'small',
) {
  const s = createRocket(kind, 0, 0, 0, support);
  s.phase = 'flight';
  s.buildProgress = 1;
  s.position.y = altitude;
  s.altitude = altitude;
  s.maxAltitude = altitude;
  s.flightElapsed = 5;
  s.throttle = 1;
  controller.state = s;
}
test('return restores camera and retires mission-owned effects, audio, space and render overrides', async (t) => {
  const { controller: c, engine: e, resources } = setup(t);
  const position = e.camera.position.clone(),
    target = e.controls.target.clone(),
    quaternion = e.camera.quaternion.clone();
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 20000);
  c.setView('first');
  c.update(1 / 60);
  const space = resources.space[0],
    cabin = space.camera.getObjectByName(
      'Rocket first-person observation capsule',
    );
  assert(cabin);
  assert(
    space.scene.children.some(
      (object) => object.name === 'small Atlas research rocket',
    ),
  );
  const effects = resources.effects[0],
    audio = resources.audio[0];
  c.returnToCity();
  assert.equal(c.snapshot.active, false);
  assert.equal(c.snapshot.exists, true);
  assert.equal(c.snapshot.damaged, 0);
  assert.equal(c.snapshot.loaded, false);
  assert.equal(effects.disposed, 1);
  assert.equal(audio.disposed, 1);
  assert.equal(space.disposed, 1);
  assert.equal(c.renderSpace(), false);
  c.beforeRender();
  assert.equal(effects.before, 0);
  assert.deepEqual(e.camera.position, position);
  assert.deepEqual(e.camera.quaternion.toArray(), quaternion.toArray());
  assert.deepEqual(e.controls.target, target);
  assert.equal(e.camera.near, 0.1);
  assert.equal(e.camera.far, 20000);
  assert.equal(e.camera.fov, 50);
  assert.equal(cabin.parent, e.camera);
  assert.equal(cabin.visible, false);
  assert.equal(cabin.scale.x, 1);
  assert.equal(
    e.scene.getObjectByName('small Atlas research rocket').visible,
    false,
  );
  assert.equal(e.controls.enabled, true);
  assert.equal(e.settings.mode, 'orbit');
});
test('pending resources cannot attach after return or replace a newer mission', async (t) => {
  const { controller: c, resources, effectsModule, spaceModule } = setup(t);
  const effects = deferred(),
    space = deferred();
  globalThis.__rocketEffectsLoad = () => effects.promise;
  globalThis.__rocketSpaceLoad = () => space.promise;
  c.start('small', 0, 0, 0, { kind: 'ground' });
  c.returnToCity();
  effects.resolve(effectsModule);
  space.resolve(spaceModule);
  await tick();
  assert.equal(resources.effects.length, 0);
  assert.equal(resources.space.length, 0);
  await c.retryLoad();
  assert.equal(resources.effects.length, 0);
  globalThis.__rocketEffectsLoad = async () => effectsModule;
  globalThis.__rocketSpaceLoad = async () => spaceModule;
  c.start('large', 10, 0, 0, { kind: 'platform' });
  await tick();
  assert.equal(resources.effects.length, 1);
  assert.equal(c.snapshot.kind, 'large');
  assert(c.snapshot.loaded);
});
test('failed resource loads hold construction below Ready and retry unlocks a normal launch', async (t) => {
  const { controller: c, effectsModule } = setup(t);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });
  for (const kind of ['small', 'large', 'super-heavy']) {
    const config = ROCKET_CONFIGS[kind];
    assert.equal(
      config.buildDuration,
      { small: 6, large: 10, 'super-heavy': 16 }[kind],
    );
    assert.equal(config.countdownDuration, 5);
    globalThis.__rocketEffectsLoad = async () => {
      throw new Error('simulated offline chunk');
    };
    c.start(kind, 0, 0, 0, { kind: 'ground' });
    await tick();
    advance(c, config.buildDuration / 2);
    assert.equal(c.snapshot.phase, 'building');
    assert(c.snapshot.buildProgress > 0.49 && c.snapshot.buildProgress < 0.51);
    advance(c, config.buildDuration);
    assert.equal(c.snapshot.phase, 'building');
    assert(c.snapshot.buildProgress >= 0.98 && c.snapshot.buildProgress < 1);
    assert.equal(c.snapshot.loadError, true);
    c.launch();
    assert.equal(c.snapshot.phase, 'building');
    globalThis.__rocketEffectsLoad = async () => effectsModule;
    await c.retryLoad();
    advance(c, config.buildDuration * 0.03 + 0.05);
    assert.equal(c.snapshot.phase, 'ready');
    c.launch();
    assert.equal(c.snapshot.phase, 'countdown');
    assert.equal(c.snapshot.countdown, 5);
    advance(c, config.countdownDuration - 0.1);
    assert.equal(c.snapshot.phase, 'countdown');
    advance(c, 0.2);
    assert.equal(c.snapshot.phase, 'ignition');
  }
});
test('a multi-touch placement gesture and an out-and-back drag never place a rocket', (t) => {
  const { controller: c } = setup(t);
  c.beginPlacement('small');
  const picks = [];
  c.pick = (x, y, commit = false) => picks.push({ x, y, commit });
  c.down(pointer(1, 100, 100));
  c.down(pointer(2, 150, 100));
  c.up(pointer(1, 100, 100));
  c.up(pointer(2, 150, 100));
  assert.equal(picks.filter((pick) => pick.commit).length, 0);
  c.down(pointer(3, 100, 100));
  c.move(pointer(3, 125, 100));
  c.move(pointer(3, 100, 100));
  c.up(pointer(3, 100, 100));
  assert.equal(picks.filter((pick) => pick.commit).length, 0);
  c.down(pointer(4, 100, 100));
  c.up(pointer(4, 101, 100));
  assert.equal(picks.filter((pick) => pick.commit).length, 1);
  c.down(pointer(5, 100, 100));
  c.down(pointer(6, 150, 100));
  c.cancelPointer(pointer(6, 150, 100));
  c.up(pointer(5, 100, 100));
  assert.equal(picks.filter((pick) => pick.commit).length, 1);
});
test('manual mobile pinch zooms without steering the camera; disabled input does neither', async (t) => {
  const { controller: c } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  const yaw = c.lookYaw,
    pitch = c.lookPitch,
    distance = c.zoomScale;
  c.down(pointer(1, 100, 100));
  c.down(pointer(2, 150, 100));
  c.move(pointer(2, 200, 100));
  assert(c.zoomScale < distance);
  assert.equal(c.lookYaw, yaw);
  assert.equal(c.lookPitch, pitch);
  c.setInputEnabled(false);
  const zoom = c.zoomScale;
  c.down(pointer(3, 200, 100));
  c.move(pointer(3, 250, 140));
  c.wheel({ deltaY: 120, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(c.zoomScale, zoom);
  assert.equal(c.lookYaw, yaw);
  assert.equal(c.lookPitch, pitch);
});
test('whole-body probes detect a thin deck and an inverted nose hitting terrain', async (t) => {
  const { controller: c } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 100);
  c.world = {
    hit(a, b) {
      return a.y < 105 && b.y > 105;
    },
    surface: () => ({ height: 0 }),
  };
  c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'crashed');
  readyFlight(c, 10);
  c.state.attitude.pitch = Math.PI;
  c.state.mode = 'manual';
  c.setAuto(false);
  c.world = { hit: () => false, surface: () => ({ height: 0 }) };
  c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'crashed');
});
test('leaving placement does not restore a stale mission camera, and destroy removes all listeners', async (t) => {
  const { controller: c, engine: e, window, document, canvas } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  c.returnToCity();
  e.camera.position.set(300, 90, 400);
  const view = e.camera.position.clone();
  c.beginPlacement('large');
  c.returnToCity();
  assert.deepEqual(e.camera.position, view);
  c.destroy();
  assert.equal(window.listenerCount, 0);
  assert.equal(document.listenerCount, 0);
  assert.equal(canvas.listenerCount, 0);
  const children = e.scene.children.length;
  c.start('small', 0, 0, 0);
  assert.equal(e.scene.children.length, children);
});

test('manual keys keep working after a HUD button while native button activation and form editing stay usable', async (t) => {
  const { controller: c } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  c.setAuto(false);
  const button = new globalThis.HTMLElement();
  button.closest = (selector) => (selector.includes('button') ? button : null);
  let prevented = false;
  c.keyDown({
    code: 'KeyW',
    target: button,
    preventDefault() {
      prevented = true;
    },
  });
  assert(c.keys.has('KeyW'));
  assert(prevented);
  c.clearInput();
  prevented = false;
  c.keyDown({
    code: 'Space',
    target: button,
    preventDefault() {
      prevented = true;
    },
  });
  assert(!c.keys.has('Space'));
  assert(!prevented);
  const input = new globalThis.HTMLElement();
  input.closest = (selector) => (selector.includes('input') ? input : null);
  c.keyDown({
    code: 'KeyW',
    target: input,
    preventDefault() {
      throw new Error('input typing was intercepted');
    },
  });
  assert(!c.keys.has('KeyW'));
});

test('chase framing stays fixed relative to a fast rocket across uneven render frames', async (t) => {
  const { controller: c, engine: e } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 2000);
  c.state.velocity.y = 1500;
  c.world = null;
  const distances = [];
  for (const dt of Array.from({ length: 20 }, () => [
    1 / 144,
    1 / 30,
    1 / 60,
    1 / 90,
  ]).flat()) {
    c.update(dt);
    const anchor = new THREE.Vector3(0, c.chaseAnchorHeight, 0)
      .applyQuaternion(c.model.group.quaternion)
      .add(
        new THREE.Vector3(
          c.state.position.x,
          c.state.position.y,
          c.state.position.z,
        ),
      );
    distances.push(e.camera.position.distanceTo(anchor));
    e.camera.updateMatrixWorld();
    const screen = anchor.clone().project(e.camera);
    assert(
      Math.abs(screen.x) < 1e-8 && Math.abs(screen.y) < 1e-8,
      'vehicle anchor stays centered',
    );
  }
  assert(
    Math.max(...distances) - Math.min(...distances) < 1e-8,
    'speed and frame delta cannot change chase distance',
  );
  assert(
    c.state.position.y > 3500,
    'the framing test actually follows a moving vehicle',
  );
});

test('staging reframes the surviving upper vehicle smoothly rather than jumping the camera', async (t) => {
  const { controller: c, engine: e } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 5000);
  c.world = null;
  c.update(1 / 60);
  const before = c.chaseAnchorHeight;
  c.state.boosterAttached = false;
  c.state.stage = 'separating';
  c.update(1 / 60);
  assert(c.chaseAnchorHeight > before && c.chaseAnchorHeight - before < 0.6);
  assert(Number.isFinite(e.camera.position.y));
});

test('space focus finds the Moon smoothly and a drag releases the guided view without restarting the mission', async (t) => {
  const { controller: c, resources } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 100000);
  c.state.phase = 'space';
  c.state.stage = 'coast';
  c.state.boosterAttached = false;
  c.update(1 / 60);
  c.setSpaceFocus('moon');
  const first = resources.space[0].camera.quaternion.clone();
  c.update(1 / 60);
  const camera = resources.space[0].camera;
  assert(first.angleTo(camera.quaternion) < 0.2, 'focus does not snap');
  for (let i = 0; i < 180; i++) c.update(1 / 60);
  const expected = resources.space[0]
    .getCelestialFocus('moon')
    .target.sub(camera.position)
    .normalize();
  assert(camera.getWorldDirection(new THREE.Vector3()).dot(expected) > 0.99999);
  assert(
    Math.abs(camera.fov - 12) < 0.01,
    'camera zoom reveals a physically small lunar disc',
  );
  assert.equal(c.snapshot.spaceFocus, 'moon');
  assert.equal(
    c.model.group.visible,
    false,
    'the nearby vehicle cannot block the telescopic Moon view',
  );
  const mission = c.snapshot.missionId;
  c.down(pointer(1, 200, 100));
  c.move(pointer(1, 240, 120));
  c.up(pointer(1, 240, 120));
  assert.equal(c.snapshot.spaceFocus, 'rocket');
  assert.equal(c.snapshot.phase, 'space');
  assert.equal(c.snapshot.missionId, mission);
  c.update(1 / 60);
  assert.equal(
    c.model.group.visible,
    true,
    'free chase restores the same vehicle',
  );
});

test('upper-stage collision probes exclude the discarded booster volume', async (t) => {
  const { controller: c } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  readyFlight(c, 100);
  c.state.stage = 'upper';
  c.state.stageElapsed = 2;
  c.state.boosterAttached = false;
  c.state.boosterFuel = 0;
  c.world = {
    hit(a, b) {
      return Math.min(a.y, b.y) < 105 && Math.max(a.y, b.y) > 105;
    },
    surface: () => ({ height: 0 }),
  };
  c.update(1 / 60);
  assert.equal(
    c.snapshot.phase,
    'flight',
    'a deck below the actual upper-stage nozzle cannot hit a ghost booster',
  );
});

const buildingVolume = (minX, maxX, minZ, maxZ, maxY) => ({
  polygon: [
    [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
      [minX, minZ],
    ],
  ],
  minY: 0,
  maxY,
});
function advance(controller, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) controller.update(1 / 60);
}
function advanceUntil(controller, predicate, limitSeconds = 20) {
  for (let i = 0; i < limitSeconds * 60 && !predicate(); i++)
    controller.update(1 / 60);
  assert(
    predicate(),
    `controller condition timed out in ${controller.snapshot.phase}`,
  );
}
async function roofLaunch(t, extraVolumes = []) {
  const fixture = setup(t),
    { controller: c, engine: e, resources } = fixture;
  e.data.flightBuildingVolumes = [
    buildingVolume(-4, 4, -4, 4, 8),
    ...extraVolumes,
  ];
  c.start('large', 0, 8.45, 0, {
    kind: 'roof-small',
    groundY: 0,
    seed: 13,
  });
  await tick();
  resources.effects[0].collisionHeight = (x, z, state) =>
    Math.abs(x) <= 4 && Math.abs(z) <= 4
      ? Math.max(0.2, 8 - state.supportCollapseElapsed * 3.2)
      : null;
  advanceUntil(c, () => c.snapshot.phase === 'ready');
  c.launch();
  return fixture;
}

test('a collapsing support collider follows the rendered roof without shortening the readable fall or changing city metadata', async (t) => {
  const { controller: c, engine: e, resources } = await roofLaunch(t);
  const metadata = structuredClone(e.data.flightBuildingVolumes);
  advanceUntil(c, () => c.snapshot.phase === 'falling');
  const collapseAt = c.state.elapsed;
  assert.equal(c.snapshot.failureStage, 'support-collapse');
  assert.equal(c.snapshot.failureAge, 0);
  advance(c, 1.4);
  assert.equal(c.snapshot.phase, 'falling');
  assert.equal(c.snapshot.failureStage, 'support-collapse');
  const support = c.supportVolumes[0];
  assert(support);
  const displayedTop = resources.effects[0].collisionHeight(0, 0, c.state);
  assert(Math.abs(support.bounds.max.y - displayedTop) < 1e-8);
  assert(support.bounds.max.y < 4);
  assert(
    resources.effects[0].heightSamples.some((sample) => sample.elapsed > 1),
  );
  advance(c, 0.25);
  assert.equal(c.snapshot.phase, 'falling');
  assert.equal(c.snapshot.failureStage, 'freefall');
  advanceUntil(c, () => c.snapshot.phase === 'crashed');
  assert(c.state.elapsed - collapseAt > 2.4);
  assert(c.state.wreckage.velocity.y < -8);
  assert.equal(c.snapshot.failureCause, 'impact');
  assert.deepEqual(e.data.flightBuildingVolumes, metadata);
});

test('a support-collapse exception never removes collision with a different nearby building', async (t) => {
  const { controller: c } = await roofLaunch(t, [
    buildingVolume(13, 17, -4, 4, 45),
  ]);
  advanceUntil(
    c,
    () => c.snapshot.phase === 'falling' || c.snapshot.phase === 'crashed',
  );
  assert.equal(c.snapshot.phase, 'falling');
  const cells = [...new Set([...c.world.cells.values()].flat())];
  const adjacent = cells.find((volume) => volume.bounds.min.x === 13);
  assert(adjacent);
  assert.equal(adjacent.bounds.max.y, 45);
  // The nose now crosses the separate building while its own roof is sagging.
  c.state.attitude.roll = 0.26;
  c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'crashed');
  assert.equal(c.snapshot.failureCause, 'impact');
  assert(c.state.supportCollapseElapsed < 1.5);
  assert.equal(
    adjacent.bounds.max.y,
    45,
    'only the supporting roof is deformed',
  );
});

test('falling automatically leaves the cabin for chase view while preserving the current mission', async (t) => {
  const { controller: c } = await roofLaunch(t);
  c.setView('first');
  const mission = c.snapshot.missionId;
  advanceUntil(c, () => c.snapshot.phase === 'falling');
  assert.equal(c.snapshot.view, 'chase');
  assert.equal(c.cabin.visible, false);
  assert.equal(c.model.group.visible, true);
  assert.equal(c.snapshot.active, true);
  assert.equal(c.snapshot.missionId, mission);
  assert.equal(c.snapshot.failureStage, 'support-collapse');
  assert.equal(c.state.wreckage, null);
});

test('each physics step samples nearby fire and exposes body heat and fire independently from burning-tree counts', async (t) => {
  const { controller: c, resources } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'platform', seed: 1 });
  await tick();
  readyFlight(c, 100, { kind: 'platform', seed: 1 });
  c.world = null;
  const effects = resources.effects[0];
  effects.heatExposure = 1;
  c.update(0.1);
  assert(
    effects.heatSamples.length >= 5,
    'large render deltas still sample each fixed step',
  );
  assert(effects.heatSamples.at(-1).heat > effects.heatSamples[0].heat);
  assert(c.snapshot.vehicleHeat > 0);
  assert.equal(c.snapshot.vehicleHeat, c.state.heat);
  assert.equal(c.snapshot.vehicleFire, 0);
  assert.equal(c.snapshot.burning, 2, 'city fire count is a separate readout');
  advanceUntil(c, () => c.state.fireIntensity > 0);
  assert.equal(c.snapshot.vehicleFire, c.state.fireIntensity);
  assert(c.snapshot.vehicleFire > 0);
  assert.equal(c.snapshot.phase, 'flight');
  assert.equal(c.snapshot.failureStage, 'none');
  effects.heatExposure = 0;
  advance(c, 12);
  assert.equal(c.snapshot.phase, 'flight');
  assert.equal(c.snapshot.vehicleFire, 0);
  assert.equal(c.snapshot.vehicleHeat, 0);
  assert.equal(c.snapshot.burning, 2);
});

test('the snapshot recovery clock starts at impact and restarts at the actual delayed explosion', async (t) => {
  const { controller: c } = setup(t);
  c.start('small', 0, 0, 0, { kind: 'platform', seed: 13 });
  await tick();
  readyFlight(c, 100, { kind: 'platform', seed: 13 });
  c.state.velocity = { x: 0, y: -20, z: 0 };
  c.state = crashRocket(c.state, 'Struck a building.');
  const impactAt = c.state.wreckage.time;
  assert.equal(c.snapshot.failureAge, 0);
  assert.equal(c.snapshot.failureStage, 'wreckage');
  assert.equal(c.snapshot.failureCause, 'impact');
  advance(c, 0.5);
  assert(c.snapshot.failureAge > 0.45);
  assert.equal(c.state.wreckage.explosionTime, null);
  advanceUntil(c, () => c.state.wreckage.explosionTime !== null);
  assert(c.state.wreckage.explosionTime > impactAt + 0.6);
  assert(
    c.snapshot.failureAge < 0.02,
    'five-second recovery starts from the final explosion',
  );
  advance(c, 1);
  assert(c.snapshot.failureAge > 0.95 && c.snapshot.failureAge < 1.05);
  assert.equal(c.snapshot.active, true);
  assert.equal(
    c.model.group.visible,
    true,
    'accident pieces continue to render',
  );
});

test('the accident chase camera smoothly finds a clear view past an actual neighbouring building', async (t) => {
  const { controller: c, engine: e } = await roofLaunch(t, [
    buildingVolume(20, 70, 25, 60, 80),
  ]);
  const originalFocus = new THREE.Vector3(0, 8.45 + 48 * 0.45, 0);
  assert(
    c.world.hit(originalFocus, e.camera.position, 0.5),
    'the authored neighbour really blocks the ordinary launch view',
  );
  const mission = c.snapshot.missionId;
  const previous = e.camera.position.clone();
  while (c.snapshot.phase !== 'falling' && c.state.elapsed < 20) {
    previous.copy(e.camera.position);
    c.update(1 / 60);
  }
  assert.equal(c.snapshot.phase, 'falling');
  assert(
    e.camera.position.distanceTo(previous) < 30,
    'choosing an unobstructed angle still damps the camera transition',
  );
  advance(c, 1.2);
  const focus =
    c.damageFocus?.clone() ??
    new THREE.Vector3(0, c.chaseAnchorHeight, 0)
      .applyQuaternion(c.model.group.quaternion)
      .add(
        new THREE.Vector3(
          c.state.position.x,
          c.state.position.y,
          c.state.position.z,
        ),
      );
  assert.equal(c.world.hit(focus, e.camera.position, 0.5), false);
  assert(
    e.camera
      .getWorldDirection(new THREE.Vector3())
      .dot(focus.clone().sub(e.camera.position).normalize()) > 0.99999,
    'the clear camera continues looking at the accident',
  );
  assert.equal(c.snapshot.view, 'chase');
  assert.equal(c.snapshot.missionId, mission);
  assert.equal(c.snapshot.active, true);
});

test('repairing a wrecked rooftop restores its collision height and later accident steps cannot collapse it again', async (t) => {
  const { controller: c, resources } = await roofLaunch(t);
  const mission = c.snapshot.missionId;
  const roof = c.supportVolumes[0].bounds;
  advanceUntil(c, () => c.snapshot.phase === 'crashed');
  advance(c, 1.2);
  assert(roof.max.y < 1, 'the failed support was actually collapsed');
  const wreckage = structuredClone(c.state.wreckage);
  const effects = resources.effects[0];
  c.resetDamage();
  assert.equal(
    roof.max.y,
    8,
    'repair restores the mission-owned roof collider',
  );
  assert.equal(
    c.supportVolumes.length,
    0,
    'the old collapse no longer owns a repaired collider',
  );
  await tick();
  assert.equal(effects.disposed, 1);
  assert.equal(resources.effects.length, 2);
  advance(c, 5);
  assert.equal(roof.max.y, 8);
  assert.deepEqual(c.state.wreckage, wreckage);
  assert.equal(c.snapshot.phase, 'crashed');
  assert.equal(c.snapshot.missionId, mission);
  assert.equal(c.snapshot.active, true);
});

test('Atlas side boosters hit a neighbouring building that is clear of the core body', async (t) => {
  const { controller: c, engine: e } = setup(t);
  e.data.flightBuildingVolumes = [buildingVolume(6, 8, -1, 1, 125)];
  c.start('large', 0, 0, 0, { kind: 'platform' });
  await tick();
  readyFlight(c, 100, { kind: 'platform' }, 'large');
  assert.equal(
    c.world.hit(
      new THREE.Vector3(0, 103.5, 0),
      new THREE.Vector3(0, 144.5, 0),
      3.5 * 0.75,
    ),
    false,
    'the core cannot explain the collision',
  );
  const side = c.model.collisionSegments.find(
    (probe) => probe.booster && probe.from.x > 0,
  );
  assert(
    side &&
      c.world.hit(
        side.from.clone().add(new THREE.Vector3(0, 100, 0)),
        side.to.clone().add(new THREE.Vector3(0, 100, 0)),
        side.radius,
      ),
  );
  c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'crashed');
  assert.equal(c.state.wreckage.cause, 'impact');
});

test('a temporal side-booster sweep catches a thin bridge deck between two otherwise clear frames', async (t) => {
  const { controller: c, engine: e } = setup(t);
  e.data.flightBridgeVolumes = [
    {
      matrix: new THREE.Matrix4().toArray(),
      min: [6, 132, -1],
      max: [8, 132.12, 1],
    },
  ];
  c.start('large', 0, 0, 0, { kind: 'platform' });
  await tick();
  readyFlight(c, 100, { kind: 'platform' }, 'large');
  c.state.velocity.y = 2000;
  const side = c.model.collisionSegments.find(
    (probe) => probe.booster && probe.from.x > 0,
  );
  assert(side);
  assert.equal(
    c.world.hit(
      side.from.clone().add(new THREE.Vector3(0, 100, 0)),
      side.to.clone().add(new THREE.Vector3(0, 100, 0)),
      side.radius,
    ),
    false,
  );
  assert.equal(
    c.world.hit(
      new THREE.Vector3(0, 103.5, 0),
      new THREE.Vector3(0, 180, 0),
      3.5 * 0.75,
    ),
    false,
  );
  c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'crashed');
  assert(
    c.state.wreckage.position.y + side.from.y - side.radius > 132.12,
    'the current side booster already cleared the deck; its temporal sweep is necessary',
  );
});

test('separation retires side-booster collision without removing the actual surviving upper body', async (t) => {
  const { controller: c, engine: e } = setup(t);
  e.data.flightBuildingVolumes = [buildingVolume(6, 8, -1, 1, 125)];
  c.start('large', 0, 0, 0, { kind: 'platform' });
  await tick();
  readyFlight(c, 100, { kind: 'platform' }, 'large');
  const side = c.model.collisionSegments.find(
    (probe) => probe.booster && probe.from.x > 0,
  );
  assert(
    c.world.hit(
      side.from.clone().add(new THREE.Vector3(0, 100, 0)),
      side.to.clone().add(new THREE.Vector3(0, 100, 0)),
      side.radius,
    ),
  );
  c.state.boosterAttached = false;
  c.state.boosterFuel = 0;
  c.state.stage = 'upper';
  c.state.stageElapsed = 2;
  c.state.separation = {
    time: c.state.elapsed,
    flightTime: c.state.flightElapsed,
    position: { ...c.state.position },
    velocity: { ...c.state.velocity },
    attitude: { ...c.state.attitude },
  };
  c.update(1 / 60);
  assert.equal(
    c.snapshot.phase,
    'flight',
    'discarded side boosters cannot hit a ghost volume',
  );
  assert.equal(
    c.model.upper.getObjectByName('Upper-stage vacuum engine').visible,
    true,
  );
  c.world = { hit: () => true, surface: () => ({ height: 0 }) };
  c.update(1 / 60);
  assert.equal(
    c.snapshot.phase,
    'crashed',
    'upper-stage collision is still active',
  );
});

test('Titan screen placement sizes its ring, slope sampling and assembly scaffold from the physical footprint', async (t) => {
  const { controller: c, engine: e } = setup(t),
    config = ROCKET_CONFIGS['super-heavy'];
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  e.scene.add(ground);
  ground.updateMatrixWorld(true);
  t.after(() => {
    ground.geometry.dispose();
    ground.material.dispose();
  });
  e.placement = { groundMeshes: [ground], cancel() {} };
  const samples = [];
  e.elevation = (x, z) => {
    samples.push([x, z]);
    return 0;
  };
  c.beginPlacement('super-heavy');
  e.camera.position.set(0, 100, 40);
  e.camera.lookAt(0, 0, 0);
  e.camera.updateMatrixWorld(true);
  c.pick(400, 300, false);
  assert.equal(c.ring.visible, true);
  assert.equal(c.snapshot.kind, 'super-heavy');
  assert(
    c.ring.geometry.parameters.outerRadius * c.ring.scale.x >=
      config.footprintRadius,
  );
  const x = c.ring.position.x,
    z = c.ring.position.z,
    span = config.footprintRadius * 1.5;
  assert(
    samples.some(
      ([sx, sz]) => Math.abs(sx - x - span) < 1e-6 && Math.abs(sz - z) < 1e-6,
    ),
  );
  assert(
    samples.some(
      ([sx, sz]) => Math.abs(sx - x) < 1e-6 && Math.abs(sz - z - span) < 1e-6,
    ),
  );
  c.pick(400, 300, true);
  await tick();
  assert.equal(c.snapshot.phase, 'building');
  assert.equal(c.snapshot.support, 'ground');
  assert.equal(c.model.height, 110);
  const box = new THREE.Box3().setFromObject(c.scaffold),
    size = box.getSize(new THREE.Vector3());
  assert(size.y > 110 && size.y < 120);
  assert(
    size.x > config.footprintRadius * 2 && size.x < config.footprintRadius * 3,
  );
  assert(
    size.z > config.footprintRadius * 2 && size.z < config.footprintRadius * 3,
  );
  assert.equal(c.snapshot.loaded, true);
});

test('Titan completes a continuous controller mission from construction through two stages to 100km', async (t) => {
  const { controller: c, engine: e } = setup(t);
  c.start('super-heavy', 0, 0.45, 0, {
    kind: 'platform',
    groundY: 0,
    seed: 13,
  });
  await tick();
  const mission = c.snapshot.missionId;
  advance(c, 8);
  assert.equal(c.snapshot.phase, 'building');
  assert(c.snapshot.buildProgress > 0.49 && c.snapshot.buildProgress < 0.51);
  c.launch();
  assert.equal(c.snapshot.phase, 'building', 'construction cannot be bypassed');
  advanceUntil(c, () => c.snapshot.phase === 'ready');
  c.launch();
  advance(c, 4.9);
  assert.equal(c.snapshot.phase, 'countdown');
  assert(c.snapshot.countdown > 0 && c.snapshot.countdown < 0.2);
  let previous = { ...c.state.position };
  for (
    let frame = 0;
    frame < 100 * 60 && !['space', 'crashed'].includes(c.snapshot.phase);
    frame++
  ) {
    c.update(1 / 60);
    const current = c.state.position;
    assert(
      Math.hypot(
        current.x - previous.x,
        current.y - previous.y,
        current.z - previous.z,
      ) < 60,
      'actual controller ascent cannot teleport',
    );
    previous = { ...current };
  }
  assert.equal(c.snapshot.phase, 'space');
  assert(c.snapshot.altitude >= 100000 && c.snapshot.altitude < 100060);
  assert(c.state.flightElapsed > 65 && c.state.flightElapsed < 80);
  assert.equal(c.state.boosterAttached, false);
  assert(c.state.separation && c.state.upperFuel > 0);
  assert.equal(c.snapshot.stage, 'coast');
  assert.deepEqual(
    c.state.events
      .filter((event) =>
        [
          'countdown',
          'ignition',
          'liftoff',
          'booster-burnout',
          'stage-separation',
          'upper-ignition',
          'mission-complete',
        ].includes(event.type),
      )
      .map((event) => event.type),
    [
      'countdown',
      'ignition',
      'liftoff',
      'booster-burnout',
      'stage-separation',
      'upper-ignition',
      'mission-complete',
    ],
  );
  assert.equal(c.snapshot.missionId, mission);
  c.returnToCity();
  assert.equal(e.controls.enabled, true);
  assert.equal(e.settings.mode, 'orbit');
});
