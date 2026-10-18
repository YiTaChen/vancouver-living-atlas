import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { installOrbitTransitionQA, installStandaloneOrbitTransitionQA } =
  await import(cityModule('orbit-transition-qa'));

class Element {
  constructor(tag = 'section') {
    this.tag = tag;
  }
  children = [];
  style = {};
  attributes = {};
  textContent = '';
  listeners = [];
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
  }
  addEventListener(type, listener, capture = false) {
    this.listeners.push({ type, listener, capture: capture === true });
  }
  removeEventListener(type, listener, capture = false) {
    this.listeners = this.listeners.filter(
      (row) =>
        row.type !== type ||
        row.listener !== listener ||
        row.capture !== (capture === true),
    );
  }
  dispatchEvent(event) {
    // A real DOM target invokes capture listeners before target bubble listeners,
    // even when the Engine registered its destructive bubble listener first.
    for (const row of [...this.listeners].sort(
      (a, b) => Number(b.capture) - Number(a.capture),
    ))
      if (row.type === event.type && this.listeners.includes(row))
        row.listener(event);
    return !event.defaultPrevented;
  }
}
async function dom(action) {
  const prior = new Map(),
    env = process.env.VANCOUVER_VISUAL_QA,
    orbitEnv = process.env.VANCOUVER_ORBIT_QA,
    uploads = [],
    lifecycle = new Element(),
    body = new Element('body');
  let now = 0;
  const replace = (name, value) => {
    if (!prior.has(name))
      prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };
  replace('document', { body, createElement: (tag) => new Element(tag) });
  replace('location', { hostname: '127.0.0.1' });
  replace('performance', { now: () => now });
  replace('devicePixelRatio', 1.25);
  replace('fetch', async (_url, options) => {
    uploads.push(JSON.parse(options.body));
    return { ok: true };
  });
  replace('addEventListener', (...args) => lifecycle.addEventListener(...args));
  replace('removeEventListener', (...args) =>
    lifecycle.removeEventListener(...args),
  );
  process.env.VANCOUVER_VISUAL_QA = '1';
  process.env.VANCOUVER_ORBIT_QA = '0';
  try {
    await action({
      uploads,
      lifecycle,
      body,
      replace,
      advance: (ms) => {
        now += ms;
      },
    });
  } finally {
    if (env === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = env;
    if (orbitEnv === undefined) delete process.env.VANCOUVER_ORBIT_QA;
    else process.env.VANCOUVER_ORBIT_QA = orbitEnv;
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
function fixture(advance) {
  const events = [],
    canvas = new Element('canvas'),
    camera = new THREE.PerspectiveCamera(42, 16 / 9, 2, 100_000);
  canvas.width = 1280;
  canvas.height = 720;
  camera.position.set(3, 6400, 5);
  let renders = 0;
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw Error('QA touched vehicle or navigation ownership');
      },
    },
  );
  const e = {
    camera,
    controls: { target: new THREE.Vector3(1, 2, 3) },
    container: { clientWidth: 1280, clientHeight: 720 },
    settings: {
      mode: 'orbit',
      quality: 'balanced',
      qualityMode: 'auto',
      trees: true,
    },
    compatibleGraphics: false,
    transition: null,
    clock: { hour: 10 },
    tesla: forbidden,
    navigation: forbidden,
    renderer: {
      domElement: canvas,
      getPixelRatio: () => 1,
      info: {
        render: { calls: 0, triangles: 0 },
        memory: { geometries: 7, textures: 3 },
      },
    },
    fly(view, animate = true) {
      events.push(['fly', view.id, animate, this === e]);
      this.transition = animate ? {} : null;
    },
    flyTo(id) {
      events.push(['public-flyTo', id]);
      this.fly({ id }, true);
    },
    applySettings() {
      events.push(['public-settings-effect']);
    },
    renderScene() {
      advance(2);
      renders++;
      this.camera.position.x++;
      this.renderer.info.render.calls = renders;
      this.renderer.info.render.triangles = renders * 100;
    },
    destroy() {
      events.push(['destroy']);
      this.disposed = true;
      this.renderer.info.render.calls = -1;
      this.renderer.info.memory.geometries = 0;
    },
  };
  const publicGo = (id) => {
    events.push(['react-setView', id], ['react-setSettings-orbit']);
    e.flyTo(id);
    e.applySettings();
  };
  return { e, canvas, events, publicGo };
}
const button = (panel, label) => {
  const b = panel.children[0].children.find(
    (child) => child.textContent === label,
  );
  assert(b, label);
  return b;
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('orbit diagnostics require explicit instrumentation and loopback before touching the engine', async () => {
  await dom(async ({ replace }) => {
    const engine = new Proxy(
        {},
        {
          get() {
            throw Error('guard touched engine');
          },
        },
      ),
      panel = new Element();
    process.env.VANCOUVER_VISUAL_QA = '0';
    assert.equal(installOrbitTransitionQA(engine, panel), undefined);
    process.env.VANCOUVER_VISUAL_QA = '1';
    replace('location', { hostname: 'vancouver.example' });
    assert.equal(installOrbitTransitionQA(engine, panel), undefined);
    assert.equal(panel.children.length, 0);
  });
});

test('Normal is default and Instant changes only animate while preserving the native public Go chain', async () => {
  await dom(async ({ advance }) => {
    const { e, events, publicGo } = fixture(advance),
      panel = new Element(),
      dispose = installOrbitTransitionQA(e, panel);
    const normal = button(panel, 'Orbit QA: Normal'),
      instant = button(panel, 'Orbit QA: Instant');
    assert.equal(normal.attributes['aria-pressed'], 'true');
    assert.equal(instant.attributes['aria-pressed'], 'false');
    publicGo('stanley');
    assert.deepEqual(events, [
      ['react-setView', 'stanley'],
      ['react-setSettings-orbit'],
      ['public-flyTo', 'stanley'],
      ['fly', 'stanley', true, true],
      ['public-settings-effect'],
    ]);
    instant.onclick();
    events.length = 0;
    publicGo('stanley');
    assert.deepEqual(events, [
      ['react-setView', 'stanley'],
      ['react-setSettings-orbit'],
      ['public-flyTo', 'stanley'],
      ['fly', 'stanley', false, true],
      ['public-settings-effect'],
    ]);
    assert.equal(instant.attributes['aria-pressed'], 'true');
    normal.onclick();
    e.fly({ id: 'explicit-cut' }, false);
    assert.deepEqual(
      events.at(-1),
      ['fly', 'explicit-cut', false, true],
      'Normal preserves the caller explicit false',
    );
    dispose();
  });
});

test('exact render samples retain only the last 480 frames, physical resolution and separate latest preframe', async () => {
  await dom(async ({ advance, uploads }) => {
    const { e, publicGo } = fixture(advance),
      panel = new Element(),
      dispose = installOrbitTransitionQA(e, panel);
    publicGo('stanley');
    for (let i = 0; i < 500; i++) e.renderScene();
    button(panel, 'Orbit QA: Save trace').onclick();
    await flush();
    const { row } = uploads[0];
    assert.equal(row.kind, 'city-orbit-transition-trace-v1');
    assert.equal(row.frameCount, 500);
    assert.equal(row.droppedFrames, 20);
    assert.equal(row.frames.length, 480);
    assert.equal(row.frames[0].index, 20);
    assert.equal(row.frames.at(-1).index, 499);
    assert.equal(row.frames.at(-1).calls, 500);
    assert.equal(row.frames.at(-1).triangles, 50_000);
    assert.deepEqual(row.frames.at(-1).camera, [503, 6400, 5]);
    assert.deepEqual(row.latestPreframe.camera, [502, 6400, 5]);
    assert.deepEqual(row.frames.at(-1).target, [1, 2, 3]);
    assert.equal(row.frames.at(-1).renderSceneCpuMs, 2);
    assert.equal(row.frames.at(-1).resolutionScale, 1);
    assert.equal(row.frames.at(-1).transition, true);
    assert.equal(row.frames.at(-1).near, 2);
    assert.equal(row.frames.at(-1).far, 100_000);
    assert.equal(row.frames.at(-1).trees, true);
    assert.equal(row.frames.at(-1).hour, 10);
    assert.equal(uploads[0].screenshot, undefined);
    const saved = structuredClone(row);
    e.camera.position.x = -999;
    e.renderer.info.render.calls = 0;
    assert.deepEqual(
      row,
      saved,
      'submitted evidence does not retain mutable engine vectors',
    );
    dispose();
  });
});

// oxlint-disable typescript/unbound-method -- Lifecycle tests compare exact owner references and invoke retained wrappers with .call/.apply.
test('capture-phase loss persists immutable preframe and trace before the Engine destroys GL metrics and wrappers', async () => {
  await dom(async ({ advance, uploads }) => {
    const { e, canvas } = fixture(advance),
      panel = new Element();
    canvas.addEventListener('webglcontextlost', () => e.destroy());
    const originals = { fly: e.fly, render: e.renderScene, destroy: e.destroy };
    installOrbitTransitionQA(e, panel);
    e.renderScene();
    e.renderer.info.render.calls = 999;
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    await flush();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].row.reason, 'context-lost');
    assert.equal(uploads[0].row.frames[0].calls, 1);
    assert.equal(uploads[0].row.latestPreframe.calls, 0);
    assert.equal(e.renderer.info.render.calls, -1);
    assert.equal(e.disposed, true);
    assert.equal(
      event.defaultPrevented,
      false,
      'observer leaves context policy to the real Engine',
    );
    assert.equal(e.fly, originals.fly);
    assert.equal(e.renderScene, originals.render);
    assert.equal(e.destroy, originals.destroy);
    assert.equal(panel.children.length, 0);
  });
});

test('cleanup respects later wrapper owners and makes any retained diagnostic wrapper inert', async () => {
  await dom(async ({ advance, uploads, lifecycle }) => {
    const { e, events } = fixture(advance),
      panel = new Element(),
      dispose = installOrbitTransitionQA(e, panel);
    button(panel, 'Orbit QA: Instant').onclick();
    const diagnosticFly = e.fly,
      diagnosticRender = e.renderScene;
    const outerFly = function (...args) {
      return diagnosticFly.apply(this, args);
    };
    const outerRender = function () {
      return diagnosticRender.call(this);
    };
    e.fly = outerFly;
    e.renderScene = outerRender;
    dispose();
    dispose();
    assert.equal(e.fly, outerFly);
    assert.equal(e.renderScene, outerRender);
    e.fly({ id: 'after-cleanup' }, true);
    e.renderScene();
    assert.deepEqual(events.at(-1), ['fly', 'after-cleanup', true, true]);
    assert.equal(uploads.length, 0);
    assert.equal(lifecycle.listeners.length, 0);
    assert.equal(panel.children.length, 0);
  });
});

test('reinstallation and pagehide release original methods without stacking traces', async () => {
  await dom(async ({ advance, uploads, lifecycle }) => {
    const { e } = fixture(advance),
      panel = new Element(),
      original = e.renderScene;
    installOrbitTransitionQA(e, panel);
    installOrbitTransitionQA(e, panel);
    assert.equal(panel.children.length, 1);
    e.renderScene();
    button(panel, 'Orbit QA: Save trace').onclick();
    await flush();
    assert.equal(uploads[0].row.frames.length, 1);
    lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(e.renderScene, original);
    assert.equal(panel.children.length, 0);
  });
});

test('standalone installer requires its own opt-in and loopback before touching engine or DOM', async () => {
  await dom(async ({ body, replace }) => {
    const engine = new Proxy(
      {},
      {
        get() {
          throw Error('standalone guard touched engine');
        },
      },
    );
    assert.equal(
      installStandaloneOrbitTransitionQA(engine),
      undefined,
      'VISUAL_QA does not enable standalone installation',
    );
    assert.equal(body.children.length, 0);
    process.env.VANCOUVER_ORBIT_QA = '1';
    replace('location', { hostname: 'vancouver.example' });
    assert.equal(installStandaloneOrbitTransitionQA(engine), undefined);
    assert.equal(body.children.length, 0);
  });
});

test('standalone-only Normal and Instant preserve public Go with reversible Hide/Show and trace saving', async () => {
  await dom(async ({ body, advance, uploads, lifecycle }) => {
    process.env.VANCOUVER_VISUAL_QA = '0';
    process.env.VANCOUVER_ORBIT_QA = '1';
    const { e, events, publicGo } = fixture(advance),
      originals = { fly: e.fly, render: e.renderScene, destroy: e.destroy },
      dispose = installStandaloneOrbitTransitionQA(e);
    assert.equal(body.children.length, 2);
    const [panel, show] = body.children,
      hide = panel.children.find(
        (child) => child.textContent === 'Orbit QA: Hide',
      );
    assert(hide);
    assert.equal(panel.id, 'standalone-orbit-transition-qa');
    assert.equal(show.textContent, 'Orbit QA: Show');
    assert.equal(show.style.display, 'none');
    assert.equal(
      button(panel, 'Orbit QA: Normal').attributes['aria-pressed'],
      'true',
    );
    hide.onclick();
    assert.equal(panel.style.display, 'none');
    assert.equal(show.style.display, 'block');
    show.onclick();
    assert.equal(panel.style.display, 'block');
    assert.equal(show.style.display, 'none');
    publicGo('stanley');
    assert.deepEqual(events, [
      ['react-setView', 'stanley'],
      ['react-setSettings-orbit'],
      ['public-flyTo', 'stanley'],
      ['fly', 'stanley', true, true],
      ['public-settings-effect'],
    ]);
    button(panel, 'Orbit QA: Instant').onclick();
    publicGo('stanley');
    assert.deepEqual(events.at(-2), ['fly', 'stanley', false, true]);
    e.renderScene();
    button(panel, 'Orbit QA: Save trace').onclick();
    await flush();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].row.lastFly.effectiveAnimate, false);
    assert.equal(uploads[0].row.frames.length, 1);
    dispose();
    assert.equal(body.children.length, 0);
    assert.equal(show.onclick, null);
    assert.equal(hide.onclick, null);
    assert.equal(e.fly, originals.fly);
    assert.equal(e.renderScene, originals.render);
    assert.equal(e.destroy, originals.destroy);
    assert.equal(lifecycle.listeners.length, 0);
  });
});

test('standalone replacement, pagehide and loss remove both UI owners and preserve loss evidence', async () => {
  await dom(async ({ body, advance, uploads, lifecycle }) => {
    process.env.VANCOUVER_VISUAL_QA = '0';
    process.env.VANCOUVER_ORBIT_QA = '1';
    const { e, canvas } = fixture(advance),
      originalRender = e.renderScene;
    canvas.addEventListener('webglcontextlost', () => e.destroy());
    installStandaloneOrbitTransitionQA(e);
    const firstPanel = body.children[0],
      firstShow = body.children[1];
    installStandaloneOrbitTransitionQA(e);
    assert.equal(body.children.length, 2);
    assert(!body.children.includes(firstPanel));
    assert.equal(firstShow.onclick, null);
    lifecycle.dispatchEvent(new Event('pagehide'));
    assert.equal(body.children.length, 0);
    assert.equal(e.renderScene, originalRender);
    assert.equal(lifecycle.listeners.length, 0);
    installStandaloneOrbitTransitionQA(e);
    e.renderScene();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await flush();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].row.reason, 'context-lost');
    assert.equal(uploads[0].row.frames[0].calls, 1);
    assert.equal(body.children.length, 0);
    assert.equal(e.renderScene, originalRender);
    assert.equal(e.disposed, true);
    assert.equal(lifecycle.listeners.length, 0);
  });
});
// oxlint-enable typescript/unbound-method
