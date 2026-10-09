import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { installUpgradeQA } = await import(cityModule('upgrade-qa'));
const { installVisualQA } = await import(cityModule('visual-qa'));

class Element extends EventTarget {
  constructor(tag = 'section') {
    super();
    this.tagName = tag.toUpperCase();
  }
  children = [];
  style = {};
  textContent = '';
  disabled = false;
  _value;
  get options() {
    return this.children.filter((child) => child.tagName === 'OPTION');
  }
  get value() {
    return (
      this._value ??
      (this.tagName === 'SELECT' ? (this.options[0]?.value ?? '') : '')
    );
  }
  set value(value) {
    this._value = String(value);
  }
  setAttribute() {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  querySelectorAll(selector) {
    assert.equal(selector, 'button');
    return this.children.flatMap((child) => [
      ...(child.tagName === 'BUTTON' ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}
async function withDOM(action) {
  const original = new Map();
  const replace = (name, value) => {
    if (!original.has(name))
      original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const document = Object.assign(new EventTarget(), {
    body: new Element('body'),
    hidden: false,
    createElement: (tag) => new Element(tag),
  });
  replace('document', document);
  replace('innerWidth', 800);
  replace('innerHeight', 600);
  replace('navigator', { userAgent: 'test' });
  replace('fetch', async () => ({ ok: true }));
  try {
    await action({ document, replace });
  } finally {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
const click = (parent, name) => {
  const button = parent
    .querySelectorAll('button')
    .find((value) => value.textContent === name);
  assert(button, `Missing QA action: ${name}`);
  return button.onclick();
};
const actions = [
  'Upgrade matched high',
  'Upgrade matched ultra',
  'Upgrade citizen motion 8s',
  'Upgrade lighting sweep',
];

test('all four upgrade capture actions reject an occupied shared lease without touching the engine or releasing another run', async () => {
  await withDOM(async () => {
    const parent = new Element();
    let starts = 0,
      ends = 0;
    const e = new Proxy(
      {},
      {
        get() {
          throw new Error('busy run touched the engine');
        },
      },
    );
    installUpgradeQA(e, parent, {
      isRunning: () => true,
      begin: () => {
        starts++;
        return false;
      },
      end: () => ends++,
    });
    for (const action of actions) await click(parent, action);
    for (const action of [
      'Upgrade preview citizen',
      'Inspect upgrade assets',
      'Restore normal render size',
    ])
      click(parent, action);
    assert.equal(starts, 4);
    assert.equal(ends, 0);
  });
});

test('each upgrade capture releases an acquired lease when setup fails, including motion and lighting cleanup', async () => {
  await withDOM(async () => {
    const parent = new Element();
    let active = false,
      starts = 0,
      ends = 0;
    const e = {
      settings: { quality: 'high' },
      controls: { enabled: true },
      navigation: { keys: new Set(), setMode() {} },
      applySettings() {
        throw new Error('intentional setup failure');
      },
    };
    installUpgradeQA(e, parent, {
      isRunning: () => active,
      begin: () => {
        if (active) return false;
        active = true;
        starts++;
        return true;
      },
      end: () => {
        assert(active);
        active = false;
        ends++;
      },
    });
    for (const action of actions) {
      await click(parent, action);
      assert.equal(active, false);
      assert.equal(e.navigation.keys.size, 0);
    }
    assert.equal(starts, 4);
    assert.equal(ends, 4);
  });
});

test('the integrated panel shares its legacy lease with upgrade and endurance actions and blocks conflicting clock changes until release', async () => {
  await withDOM(async ({ document, replace }) => {
    let releaseSave,
      clockChanges = 0,
      setupCalls = 0;
    replace('fetch', (_url, options) => {
      if (JSON.parse(options.body).name === 'capabilities')
        return Promise.resolve({ ok: true });
      return new Promise((resolve) => {
        releaseSave = resolve;
      });
    });
    const e = {
      settings: { quality: 'high' },
      clock: { hour: 14 },
      data: {},
      skyEffects: { settings: {}, qaTime: null },
      camera: new THREE.PerspectiveCamera(),
      controls: { target: new THREE.Vector3() },
      navigation: { mode: 'orbit', position: new THREE.Vector3() },
      renderer: {
        domElement: { width: 800, height: 600 },
        getContext: () => ({
          getExtension: () => null,
          getParameter: () => 'test-renderer',
          RENDERER: 0,
        }),
      },
      screenshot: () => 'data:image/png;base64,',
      renderScene() {}, // Auto QA observes rendering but must share this lease.
      setClock: () => clockChanges++,
      applySettings: () => setupCalls++,
    };
    installVisualQA(e);
    const panel = document.body.children[0];
    click(panel, 'Save current view');
    assert.equal(typeof releaseSave, 'function');
    for (const action of [
      ...actions,
      'Upgrade route endurance 10m',
      'Upgrade Robson corridor 8 blocks',
      'Auto: use automatic quality',
      'Auto: force ultra',
      'Auto: walk Robson',
      'Auto: drive Robson',
      'Auto: helicopter cruise',
      'Auto: stop travel',
      'Auto: save checkpoint',
      'Save integrated bus checkpoint',
      '14:00',
    ])
      await click(panel, action);
    assert.equal(setupCalls, 0);
    assert.equal(clockChanges, 0);
    releaseSave({ ok: true });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    click(panel, '14:00');
    assert.equal(clockChanges, 1);
  });
});

test('integrated bus checkpoint saves live runtime/render data with a unique name and releases its shared lease on failure', async () => {
  await withDOM(async ({ document, replace }) => {
    const uploads = [];
    let finishSave, clockChanges = 0, shotCount = 0;
    const snapshot = { phase: 'aboard', viewAnchor: 'seat-09', passengerAnchor: 'main-aisle', aboard: true };
    const busStats = { boardableOwners: 1, loadedTemplates: 3, nearActors: 2 };
    const e = {
      settings: { quality: 'balanced', qualityMode: 'auto', mode: 'walk' },
      clock: { hour: 23 }, stats: { fps: 42 }, data: {}, uniforms: { night: { value: 1 } },
      skyEffects: { settings: {}, qaTime: null },
      camera: new THREE.PerspectiveCamera(65, 1.6, 0.05),
      controls: { target: new THREE.Vector3(1, 2, 3) },
      navigation: { mode: 'walk', position: new THREE.Vector3(10, 7, 20), speed: 0, surface: 'ground', surfaceId: 'ground', surfaceLayer: 0 },
      busVisit: { snapshot: () => ({ ...snapshot }) },
      traffic: { busAssets: { stats: () => ({ ...busStats }) } },
      renderer: {
        domElement: { width: 800, height: 600 }, getPixelRatio: () => 1,
        info: { render: { calls: 50, triangles: 2000, points: 0, lines: 0 }, memory: { geometries: 10, textures: 4 } },
        getContext: () => ({ getExtension: () => null, getParameter: () => 'test-renderer', RENDERER: 0 }),
      },
      screenshot() { shotCount++; this.renderer.info.render.calls = 99; return 'data:image/png;base64,live'; },
      renderScene() {}, setClock: () => clockChanges++,
    };
    replace('fetch', (_url, options) => {
      const payload = JSON.parse(options.body);
      if (payload.name === 'capabilities') return Promise.resolve({ ok: true });
      uploads.push(payload);
      return new Promise((resolve) => { finishSave = resolve; });
    });
    installVisualQA(e);
    const panel = document.body.children[0];
    click(panel, 'Save integrated bus checkpoint');
    assert.equal(uploads.length, 1);
    assert.match(uploads[0].name, /^bus-visit-aboard-seat-09-23p00h-[a-z0-9]+-001$/);
    assert.deepEqual(uploads[0].row.snapshot, snapshot);
    assert.deepEqual(uploads[0].row.busAssets, busStats);
    assert.equal(uploads[0].row.renderer.calls, 99, 'info is read after screenshot submits current render');
    assert.equal(uploads[0].row.fps, 42);
    assert.equal(uploads[0].row.hour, 23);
    assert.equal(uploads[0].row.settings.qualityMode, 'auto');
    assert.equal(uploads[0].row.navigation.surfaceId, 'ground');
    assert.equal(uploads[0].screenshot, 'data:image/png;base64,live');
    click(panel, '14:00');
    click(panel, 'Save integrated bus checkpoint');
    assert.equal(clockChanges, 0); assert.equal(uploads.length, 1);
    finishSave({ ok: false, status: 503 });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    click(panel, '14:00');
    assert.equal(clockChanges, 1);
    e.screenshot = () => { throw new Error('lost framebuffer'); };
    click(panel, 'Save integrated bus checkpoint');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    click(panel, '14:00');
    assert.equal(clockChanges, 2, 'synchronous screenshot failure also releases the lease');
    e.screenshot = () => 'data:image/png;base64,next';
    click(panel, 'Save integrated bus checkpoint');
    assert.equal(uploads.length, 2);
    assert.match(uploads[1].name, /-002$/);
    assert.notEqual(uploads[0].name, uploads[1].name);
    assert.equal(shotCount, 1);
    finishSave({ ok: true });
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
});
