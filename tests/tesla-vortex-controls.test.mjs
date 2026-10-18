import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { TeslaController } = await import(cityModule('tesla-controller'));
const { createTesla } = await import(cityModule('tesla-state'));
const { createTeslaVortex } = await import(cityModule('tesla-vortex'));

class InputElement extends EventTarget {
  dataset = {};
  closest(selector) {
    return this.editing && selector.includes('input') ? this : null;
  }
}
const key = (code, extra = {}) => ({
  code,
  target: null,
  repeat: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
  ...extra,
});

// Run the actual controller, fixed-step simulation and V edge handling in free
// air. Only browser events, renderer-independent model effects and the empty
// environment are substituted; no WebGL context or city-wide fixture is needed.
function setup(t) {
  const globals = Object.fromEntries(
      ['window', 'document', 'Element'].map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      ]),
    ),
    win = new EventTarget(),
    doc = new EventTarget(),
    canvas = new InputElement(),
    updates = [],
    qualities = [];
  doc.hidden = false;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: win },
    document: { configurable: true, writable: true, value: doc },
    Element: { configurable: true, writable: true, value: InputElement },
  });
  const engine = {
    renderer: { domElement: canvas },
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), update() {} },
    settings: { quality: 'high' },
    clock: { hour: 12 },
    compatibleGraphics: false,
    elevation: () => 0,
    prepareNightReceivers() {},
  };
  const c = new TeslaController(engine);
  c.world = {
    support: () => null,
    sweep: () => null,
    cameraSweep: () => null,
    stats: () => ({}),
    dispose() {},
  };
  c.model = {
    group: new THREE.Group(),
    setQuality: (quality) => qualities.push(quality),
    update: (state) => updates.push(state),
    stats: () => ({}),
    dispose() {},
  };
  c.active = true;
  c.state = createTesla([0, 30, 0]);
  t.after(() => {
    c.destroy();
    for (const [name, descriptor] of Object.entries(globals))
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  });
  return { c, win, doc, updates, qualities };
}

test('V starts one real maneuver, repeat cannot restart it, and the snapshot and existing model receive real progress and pulse', (t) => {
  const { c, updates } = setup(t);
  assert.equal(c.snapshot.vortexAvailable, true);
  const down = key('KeyV');
  c.keyDown(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(c.input().vortex, true);
  c.update(1 / 60);
  assert.equal(c.snapshot.vortexActive, true);
  assert.equal(c.snapshot.vortexAvailable, false);
  assert(c.snapshot.vortexProgress > 0 && c.snapshot.vortexProgress < 1);
  assert(updates.at(-1).vortexThrust > 0 && updates.at(-1).vortexThrust <= 1);
  assert.equal(c.input().vortex, false);
  const motion = c.state.vortex;
  c.keyDown(key('KeyV', { repeat: true }));
  c.command('vortex');
  assert.equal(c.input().vortex, false);
  c.update(1 / 60);
  assert.equal(c.state.vortex, motion);
  assert(c.snapshot.vortexProgress > 1 / 84);
  c.setButton('brake', true);
  c.update(1 / 60);
  assert.equal(c.state.vortex, null);
  assert.equal(c.snapshot.vortexActive, false);
  assert.equal(updates.at(-1).vortexThrust, 0);
});

test('touch command and keyboard V share eligibility, while transitions and inactive vehicles reject pending maneuvers', (t) => {
  const { c } = setup(t);
  for (const blocked of ['attachment', 'groundDeparture', 'departureContact']) {
    c.state[blocked] = {};
    assert.equal(c.snapshot.vortexAvailable, false, blocked);
    c.command('vortex');
    assert.equal(c.input().vortex, false, blocked);
    c.state[blocked] = null;
  }
  c.state.detachRemainingS = 0.1;
  assert.equal(c.snapshot.vortexAvailable, false);
  c.command('vortex');
  assert.equal(c.input().vortex, false);
  c.state.detachRemainingS = 0;
  c.command('vortex');
  assert.equal(c.input().vortex, true);
  c.clearInput();
  c.active = false;
  c.command('vortex');
  c.keyDown(key('KeyV'));
  assert.equal(c.input().vortex, false);
  assert.equal(c.snapshot.vortexAvailable, false);
});

test('blur, hidden document and modal suspension discard pending V and require a fresh physical press', (t) => {
  const { c, win, doc } = setup(t);
  for (const clear of [
    () => win.dispatchEvent(new Event('blur')),
    () => {
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      doc.hidden = false;
    },
    () => {
      c.setInputEnabled(false);
      c.setInputEnabled(true);
    },
  ]) {
    c.keyDown(key('KeyV'));
    assert.equal(c.input().vortex, true);
    clear();
    assert.equal(c.input().vortex, false);
    c.keyDown(key('KeyV', { repeat: true }));
    assert.equal(c.input().vortex, false);
    c.keyDown(key('KeyV'));
    assert.equal(c.input().vortex, true);
    c.clearInput();
  }
  c.state.vortex = createTeslaVortex(0);
  c.setInputEnabled(false);
  assert.equal(c.snapshot.vortexAvailable, false);
  c.update(0.1);
  assert.equal(c.state.vortex.elapsedS, 0);
  assert.equal(c.snapshot.vortexActive, true);
  c.command('vortex');
  assert.equal(c.input().vortex, false);
});

test('editable targets and modified shortcuts do not trigger V', (t) => {
  const { c } = setup(t),
    target = new InputElement();
  target.editing = true;
  for (const extra of [
    { target },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ]) {
    c.keyDown(key('KeyV', extra));
    assert.equal(c.input().vortex, false);
  }
});

test('preparation reports active at zero progress, roof holding stays distinct from manual park, and four quality choices remain live', (t) => {
  const { c, qualities } = setup(t);
  c.state.vortex = createTeslaVortex(0);
  c.state.vortexPreparing = true;
  assert.equal(c.snapshot.vortexActive, true);
  assert.equal(c.snapshot.vortexProgress, 0);
  assert.equal(c.snapshot.vortexAvailable, false);
  c.state.vortex = null;
  c.state.vortexPreparing = false;
  c.state.mode = 'ground';
  c.state.contact = {
    surfaceId: 'roof',
    kind: 'roof',
    point: [0, 29.32, 0],
    normal: [0, 1, 0],
    adherable: true,
  };
  c.state.surfaceHolding = true;
  assert.equal(c.snapshot.onRoof, true);
  assert.equal(c.snapshot.surfaceHolding, true);
  assert.equal(c.snapshot.parked, false);
  assert.equal(c.snapshot.wallHolding, false);
  // Quality and camera remain independent of a maneuver's eligibility.
  c.state = createTesla([0, 30, 0]);
  for (const quality of ['auto', 'low', 'medium', 'high']) {
    c.setQuality(quality);
    assert.equal(c.snapshot.quality, quality);
    c.update(0);
    assert(['low', 'medium', 'high'].includes(c.effectiveQuality));
  }
  assert(qualities.includes('low'));
  assert(qualities.includes('medium'));
  assert(qualities.includes('high'));
});
