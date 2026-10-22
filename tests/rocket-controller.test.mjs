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
const { createRocket } = await import(cityModule('rocket-state'));

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
    constructor(engine) {
      this.engine = engine;
      this.group = new THREE.Group();
      engine.scene.add(this.group);
      resources.effects.push(this);
    }
    update() {}
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
function readyFlight(controller, altitude = 100) {
  const s = createRocket('small', 0, 0, 0, { kind: 'ground' });
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
  globalThis.__rocketEffectsLoad = async () => {
    throw new Error('simulated offline chunk');
  };
  c.start('small', 0, 0, 0, { kind: 'ground' });
  await tick();
  for (let i = 0; i < 600; i++) c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'building');
  assert(c.snapshot.buildProgress >= 0.98 && c.snapshot.buildProgress < 1);
  assert.equal(c.snapshot.loadError, true);
  c.launch();
  assert.equal(c.snapshot.phase, 'building');
  globalThis.__rocketEffectsLoad = async () => effectsModule;
  await c.retryLoad();
  for (let i = 0; i < 60; i++) c.update(1 / 60);
  assert.equal(c.snapshot.phase, 'ready');
  c.launch();
  assert.equal(c.snapshot.phase, 'countdown');
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
