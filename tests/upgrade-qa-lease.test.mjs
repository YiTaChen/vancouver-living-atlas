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
    return this._value ?? (this.tagName === 'SELECT' ? this.options[0]?.value ?? '' : '');
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
