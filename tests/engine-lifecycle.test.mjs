import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cityModule } from './helpers/city-modules.mjs';

// Run the production constructor and lifecycle methods. Only browser/GPU
// acquisition is substituted so failure paths can be deterministic in Node.
const source = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'engine.ts',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const engine = ast.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
);
const names = new Set([
  'visibilityChange',
  'pageSuspended',
  'suspendedAt',
  'renderReady',
  'loadAbort',
  'pageHide',
  'pageShow',
  'graphicsContextLost',
  'failInitialization',
  'clearHeldInput',
  'suspendPage',
  'resumePage',
  'destroy',
]);
const members = engine.members
  .filter((node) => node.name && names.has(node.name.getText(ast)))
  .map((node) => node.getText(ast));
assert.equal(members.length, names.size);
const loadCode = engine.members
  .find(
    (node) => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'load',
  )
  .getText(ast);
const constructor = engine.members.find(ts.isConstructorDeclaration);
const constructorCode = constructor
  .getText(ast)
  .replace(/\) \{/, ') {\n super();');
const moduleURL = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const threeURL = import.meta.resolve('three');
const fakeThreeURL = moduleURL(`
  export * from ${JSON.stringify(threeURL)};
  export class WebGLRenderer {
    constructor() {
      const f = globalThis.__engineLifecycle;
      if (f.fail === 'renderer') throw new Error('WebGL unavailable');
      this.domElement = f.canvas;
      this.shadowMap = {};
      this.info = {};
      f.renderer = this;
    }
    setPixelRatio() {}
    setSize() {}
    dispose() { globalThis.__engineLifecycle.rendererDisposals++; }
  }
`);
const code = ts.transpileModule(
  `
  import * as THREE from ${JSON.stringify(fakeThreeURL)};
  import { clearOrbitGesture } from ${JSON.stringify(cityModule('orbit-lifecycle'))};
  import { CityClock } from ${JSON.stringify(cityModule('clock'))};
  const isMobileGraphics = () => true;
  const supportsHDRTarget = () => false;
  const translate = () => 'City';
  const SHADOW_DEPTH = { near: 1, far: 10000 };
  const paintStartupProgress = async (_percent, _report, cancelled) => !cancelled();
  class OrbitControls {
    constructor() { this.target = new THREE.Vector3(); this._pointers = []; this._controlActive = false; }
    addEventListener() {}
    dispose() { globalThis.__engineLifecycle.controlDisposals++; }
  }
  class TravelReturn { attach() {} destroy() {} clearGesture() {} }
  class SkyEffects {}
  class Fixture {
    constructor() {
      Object.assign(this, globalThis.__engineLifecycle.base);
      this.clock = new CityClock({ running: true, hour: 10, rate: 300 });
    }
    pixelRatio() { return 1; }
    flyTo() {}
    resizeQuality() {}
    load() { return globalThis.__engineLifecycle.load(this); }
    animate() { globalThis.__engineLifecycle.frames++; }
  }
  export class EngineHarness extends Fixture { ${constructorCode}\n${members.join('\n')} }
  export class DataLoadHarness { ${loadCode} }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { EngineHarness, DataLoadHarness } = await import(moduleURL(code));
class TrackedTarget extends EventTarget {
  active = new Map();
  addEventListener(type, callback, options) {
    if (!this.active.has(type)) this.active.set(type, new Set());
    this.active.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.active.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  count(type) {
    return this.active.get(type)?.size || 0;
  }
}
function setup({ fail, load = () => new Promise(() => {}) } = {}) {
  const document = new TrackedTarget(),
    window = new TrackedTarget(),
    canvas = new TrackedTarget();
  document.hidden = false;
  Object.assign(canvas, {
    dataset: {},
    setAttribute() {},
    remove() {
      f.canvasRemovals++;
    },
  });
  const base = {
    scene: new THREE.Scene(),
    sky: new Sky(),
    sun: new THREE.DirectionalLight(),
    ambient: new THREE.HemisphereLight(),
    settings: { quality: 'high' },
    camera: null,
    locale: 'en',
    disposed: false,
    contextLost: false,
    raf: 99,
    roadMaterials: new Map(),
    extraTextures: new Set(),
    labelElements: [],
    landmarkDetails: [],
    sceneryPreparation: { dispose() {} },
  };
  for (const name of [
    'buildings',
    'vegetation',
    'roads',
    'terrain',
    'landmarks',
    'trafficGroup',
  ])
    base[name] = new THREE.Group();
  const f = {
    base,
    canvas,
    document,
    window,
    fail,
    load,
    rendererDisposals: 0,
    controlDisposals: 0,
    canvasRemovals: 0,
    observerDisposals: 0,
    frames: 0,
    scheduled: [],
    cancelled: [],
    errors: [],
    now: 1000,
  };
  const values = {
    document,
    window,
    PointerEvent: class extends Event {
      constructor(type, init = {}) {
        super(type, init);
        for (const [key, value] of Object.entries(init))
          if (!['bubbles', 'cancelable', 'composed'].includes(key))
            Object.defineProperty(this, key, { value });
      }
    },
    ResizeObserver: class {
      constructor() {
        if (fail === 'observer') throw new Error('Observer setup failed');
      }
      observe() {}
      disconnect() {
        f.observerDisposals++;
      }
    },
    requestAnimationFrame: (callback) => {
      f.scheduled.push(callback);
      return f.scheduled.length;
    },
    cancelAnimationFrame: (id) => f.cancelled.push(id),
  };
  const previous = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  globalThis.__engineLifecycle = f;
  const clock = mock.method(performance, 'now', () => f.now);
  const errorLog = mock.method(console, 'error', () => {});
  f.create = () =>
    new EngineHarness(
      { clientWidth: 800, clientHeight: 600, appendChild() {} },
      () => {},
      () => {},
      (message) => f.errors.push(message),
    );
  f.close = () => {
    clock.mock.restore();
    errorLog.mock.restore();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.__engineLifecycle;
  };
  return f;
}
function pageEvent(type, persisted) {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

test('constructor failures cannot retain document listeners, canvases or acquired renderers', () => {
  for (const fail of ['renderer', 'observer']) {
    const f = setup({ fail });
    try {
      assert.throws(
        f.create,
        fail === 'renderer' ? /WebGL unavailable/ : /Observer setup failed/,
      );
      assert.equal(f.document.count('visibilitychange'), 0);
      assert.equal(f.window.count('pagehide'), 0);
      assert.equal(f.window.count('pageshow'), 0);
      assert.equal(f.canvas.count('webglcontextlost'), 0);
      assert.equal(f.rendererDisposals, fail === 'renderer' ? 0 : 1);
      assert.equal(f.canvasRemovals, fail === 'renderer' ? 0 : 1);
    } finally {
      f.close();
    }
  }
});

test('BFCache keeps the canvas, pauses the clock and clears held controls; each restored page schedules one frame', () => {
  const f = setup();
  let e;
  try {
    e = f.create();
    e.renderReady = true;
    let clears = 0;
    e.navigation = { blur: () => clears++, destroy() {} };
    e.flight = { clearInput: () => clears++, destroy() {} };
    e.travelReturn.clearGesture = () => clears++;
    e.placement = { cancel: () => clears++, destroy() {} };
    e.transition = { start: 850 };
    e.clock.resetTimebase(f.now);
    const hour = e.clock.hour;
    f.window.dispatchEvent(pageEvent('pagehide', true));
    assert.equal(e.disposed, false);
    assert.equal(e.pageSuspended, true);
    assert.equal(f.rendererDisposals, 0);
    assert.equal(f.canvasRemovals, 0);
    assert.equal(clears, 4);
    assert(f.cancelled.includes(99));
    f.now += 60_000;
    // A visible notification may arrive before pageshow. It must not unpause
    // the world while it is still a cached page.
    f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(e.clock.hour, hour);
    f.window.dispatchEvent(pageEvent('pageshow', true));
    assert.equal(e.pageSuspended, false);
    assert.equal(e.clock.hour, hour);
    assert.equal(e.lastTime, f.now);
    assert.equal(e.fpsAt, f.now);
    assert.equal(e.frames, 0);
    assert.equal(e.transition.start, 60_850);
    assert.equal(clears, 8);
    assert.equal(f.scheduled.length, 1);
    f.window.dispatchEvent(pageEvent('pageshow', true));
    assert.equal(f.scheduled.length, 1);
    f.window.dispatchEvent(pageEvent('pagehide', true));
    f.now += 1000;
    f.window.dispatchEvent(pageEvent('pageshow', true));
    assert.equal(
      f.scheduled.length,
      2,
      'listener survives more than one BFCache round trip',
    );
  } finally {
    e?.destroy();
    f.close();
  }
});

test('an unfinished cached startup does not start rendering; normal departure disposes and cannot resume', () => {
  const f = setup();
  let e;
  try {
    e = f.create();
    f.window.dispatchEvent(pageEvent('pagehide', true));
    f.window.dispatchEvent(pageEvent('pageshow', true));
    assert.equal(f.scheduled.length, 0);
    f.window.dispatchEvent(pageEvent('pagehide', false));
    assert.equal(e.disposed, true);
    assert.equal(e.loadAbort.signal.aborted, true);
    assert.equal(f.rendererDisposals, 1);
    assert.equal(f.canvasRemovals, 1);
    e.resumePage();
    e.destroy();
    assert.equal(f.scheduled.length, 0);
    assert.equal(f.rendererDisposals, 1);
    assert.equal(f.window.count('pageshow'), 0);
  } finally {
    e?.destroy();
    f.close();
  }
});

test('rejected asynchronous startup releases owners and aborts remaining work before reporting one error', async () => {
  let rejectLoad;
  const f = setup({
    load: () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  });
  let e;
  try {
    e = f.create();
    e.onError = (message) => {
      assert.equal(e.disposed, true);
      assert.equal(e.loadAbort.signal.aborted, true);
      f.errors.push(message);
    };
    rejectLoad(new Error('Missing required terrain'));
    await Promise.resolve();
    assert.deepEqual(f.errors, ['Missing required terrain']);
    assert.equal(f.rendererDisposals, 1);
    assert.equal(f.document.count('visibilitychange'), 0);
    e.failInitialization(new Error('late result'));
    assert.equal(f.errors.length, 1);
  } finally {
    e?.destroy();
    f.close();
  }
});

test('context loss is terminal, releases GPU owners and does not blindly resume restored render targets', async () => {
  let rejectLoad;
  const f = setup({
    load: () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  });
  let e;
  try {
    e = f.create();
    e.renderReady = true;
    const event = new Event('webglcontextlost', { cancelable: true });
    f.canvas.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(e.contextLost, true);
    assert.equal(e.disposed, true);
    assert.equal(e.loadAbort.signal.aborted, true);
    assert.deepEqual(f.errors, ['graphics-context-lost']);
    assert.equal(f.rendererDisposals, 1);
    assert.equal(f.canvas.count('webglcontextlost'), 0);
    f.canvas.dispatchEvent(new Event('webglcontextrestored'));
    e.resumePage();
    rejectLoad(new Error('late compile failure'));
    await Promise.resolve();
    assert.equal(f.scheduled.length, 0);
    assert.deepEqual(f.errors, ['graphics-context-lost']);
  } finally {
    e?.destroy();
    f.close();
  }
});

test('every production city-data request shares the engine abort signal and teardown cancels all seventeen', async () => {
  const requests = [];
  const fetchMock = mock.method(globalThis, 'fetch', (url, { signal }) => {
    requests.push({ url, signal });
    return new Promise((_resolve, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          reject(
            Object.assign(new Error('Cancelled fetch'), { name: 'AbortError' }),
          );
        },
        { once: true },
      ),
    );
  });
  const f = setup({ load: (e) => DataLoadHarness.prototype.load.call(e) });
  let e;
  try {
    e = f.create();
    await Promise.resolve();
    assert.equal(requests.length, 17);
    assert(requests.every((request) => request.signal === e.loadAbort.signal));
    e.destroy();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert(requests.every((request) => request.signal.aborted));
    assert.deepEqual(
      f.errors,
      [],
      'unmount cancellation is not an initialization error',
    );
  } finally {
    e?.destroy();
    f.close();
    fetchMock.mock.restore();
  }
});

test('cached-page suspension ends real OrbitControls pointer gestures without changing the camera pose', () => {
  assert.equal(
    THREE.REVISION,
    '185',
    'Review the orbit-lifecycle adapter when upgrading Three',
  );
  const f = setup();
  const captures = new Set();
  let released = 0;
  let e;
  try {
    Object.assign(f.canvas, {
      style: {},
      ownerDocument: f.document,
      clientWidth: 800,
      clientHeight: 600,
      getRootNode: () => f.document,
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture(id) {
        if (!captures.has(id))
          throw new DOMException('Inactive pointer', 'NotFoundError');
        captures.delete(id);
        released++;
      },
    });
    e = f.create();
    e.controls.dispose();
    e.camera.position.set(0, 20, 30);
    e.controls = new OrbitControls(e.camera, f.canvas);
    e.controls.enableDamping = false;
    e.controls.listenToKeyEvents(f.window);
    const ctrl = new Event('keydown');
    Object.defineProperty(ctrl, 'key', { value: 'Control' });
    f.document.dispatchEvent(ctrl);
    assert.equal(f.document.count('keyup'), 1);
    e.renderReady = true;
    const pointer = (type, x = 100) =>
      new PointerEvent(type, {
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        clientX: x,
        clientY: 100,
        pageX: x,
        pageY: 100,
      });
    const cancelled = [];
    f.canvas.addEventListener('pointercancel', (event) =>
      cancelled.push(event.pointerId),
    );
    f.canvas.dispatchEvent(pointer('pointerdown'));
    assert.equal(f.document.count('pointermove'), 1);
    const pose = e.camera.position.clone(),
      rotation = e.camera.quaternion.clone();
    captures.clear(); // Browser ended capture while caching the document.
    f.window.dispatchEvent(pageEvent('pagehide', true));
    assert.deepEqual(
      cancelled,
      [],
      'no synthetic event can invoke unsafe native release on an ended ID',
    );
    assert.equal(f.document.count('pointermove'), 0);
    assert.equal(f.document.count('pointerup'), 0);
    assert.equal(f.document.count('keyup'), 0);
    assert.equal(
      f.window.count('keydown'),
      1,
      'optional key-event target is preserved',
    );
    assert.equal(released, 0, 'never release an inactive native pointer ID');
    assert(e.camera.position.equals(pose));
    assert(e.camera.quaternion.equals(rotation));
    f.now += 5000;
    f.window.dispatchEvent(pageEvent('pageshow', true));
    f.document.dispatchEvent(pointer('pointermove', 150));
    assert(
      e.camera.position.equals(pose),
      'a stale move cannot continue the pre-cache drag',
    );
    f.canvas.dispatchEvent(pointer('pointerdown'));
    f.document.dispatchEvent(pointer('pointermove', 150));
    assert(
      !e.camera.position.equals(pose),
      'a fresh gesture still operates normally',
    );
    f.document.hidden = true;
    f.document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(cancelled, []);
    assert.equal(
      released,
      1,
      'owned capture is released while suspending a live drag',
    );
    assert.equal(f.document.count('pointermove'), 0);
  } finally {
    e?.destroy();
    f.close();
  }
});
