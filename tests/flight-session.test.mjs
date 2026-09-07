import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { FlightController } = await import(cityModule('flight-controller'));
const { createFlight } = await import(cityModule('flight-state'));
class InputElement {
  constructor(kind) {
    this.kind = kind;
  }
  closest(selector) {
    if (selector === '[data-flight-power]')
      return this.kind === 'power' ? this : null;
    if (this.kind === 'dialog')
      return selector.includes('[role="dialog"]') ? this : null;
    if (this.kind === 'text' || this.kind === 'power')
      return selector.includes('input') ? this : null;
    return null;
  }
}
function setup() {
  globalThis.Element = InputElement;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  const canvas = new EventTarget();
  canvas.focus = () => {};
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 500,
    width: 800,
    height: 500,
  });
  const e = {
    renderer: { domElement: canvas },
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(48, 1.6, 2, 50000),
    settings: { mode: 'flight' },
    controls: { target: new THREE.Vector3(), enabled: false, update() {} },
    navigation: {
      mode: 'orbit',
      setMode(mode) {
        this.mode = mode;
      },
    },
    placement: { cancel() {} },
    travelReturn: { invalidate() {} },
    completeLocalMapTransition() {},
    onLocalOrbit() {
      this.orbits++;
    },
    onFlightMode() {},
    orbits: 0,
  };
  const c = new FlightController(e);
  c.world = {
    surface: () => ({ kind: 'water', height: 0 }),
    hit: () => false,
    supported: () => true,
    climbHeading: () => 0,
  };
  c.state = createFlight('helicopter', 0, 1, 0);
  c.state.phase = 'airborne';
  c.state.vy = -4;
  c.model = {
    group: new THREE.Group(),
    cockpit: new THREE.Group(),
    propellers: [],
    stick: new THREE.Group(),
    instruments: Object.fromEntries(
      [
        'airspeedNeedle',
        'altimeterNeedle',
        'verticalSpeedNeedle',
        'headingCard',
        'attitudeRoll',
        'attitudePitch',
        'powerNeedle',
      ].map((k) => [k, new THREE.Group()]),
    ),
  };
  e.scene.add(c.model.group);
  e.camera.add(c.model.cockpit);
  return { c, e };
}
const run = (c, seconds) => {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60);
};
test('water crash returns after eight seconds, effects last twenty, then clean up', () => {
  const { c, e } = setup();
  run(c, 0.4);
  assert.equal(c.state.phase, 'crashed');
  assert.equal(c.effects.length, 1);
  assert(c.attached);
  run(c, 7);
  assert(c.attached);
  run(c, 1);
  assert(!c.attached);
  assert.equal(e.orbits, 1);
  assert.equal(c.effects.length, 1);
  run(c, 13);
  assert.equal(c.effects.length, 0);
  assert.equal(c.state, null);
  c.destroy();
});

const keyEvent = (code, target = null) => ({
  code,
  target,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
});
function airborne(c, kind) {
  c.state = createFlight(kind, 0, 420, 0);
  Object.assign(c.state, { phase: 'airborne', vy: 0, speed: 40, power: 0.5 });
}
for (const kind of ['seaplane', 'helicopter']) {
  test(`${kind}: focused power slider permits R/F and WASD without a scenery click`, () => {
    const { c } = setup();
    airborne(c, kind);
    const slider = new InputElement('power');
    const r = keyEvent('KeyR', slider);
    c.keyDown(r);
    run(c, 0.4);
    c.keyUp(r);
    assert(r.defaultPrevented);
    assert(Math.abs(c.state.power - 0.6) < 0.001);
    const f = keyEvent('KeyF', slider);
    c.keyDown(f);
    run(c, 0.4);
    c.keyUp(f);
    assert(Math.abs(c.state.power - 0.5) < 0.001);
    c.keyDown(keyEvent('KeyW', slider));
    c.keyDown(keyEvent('KeyA', slider));
    run(c, 0.5);
    assert(c.state.pitch < 0, 'W lowers the nose');
    assert(c.state.roll < 0, 'A banks left');
    c.clearInput();
    assert.equal(c.keys.size, 0);
    c.destroy();
  });
  test(`${kind}: power buttons clamp, opposite inputs cancel, and sources release independently`, () => {
    const { c } = setup();
    airborne(c, kind);
    c.setPower(0.98);
    c.setButtonKey('r', true);
    run(c, 0.2);
    assert.equal(c.state.power, 1);
    c.keys.add('f');
    run(c, 0.2);
    assert.equal(c.state.power, 1);
    c.setButtonKey('r', false);
    run(c, 0.2);
    assert(c.state.power < 1);
    c.clearInput();
    c.setPower(0.01);
    c.setButtonKey('f', true);
    run(c, 0.2);
    assert.equal(c.state.power, 0);
    c.clearInput();
    c.setPower(0.5);
    c.keys.add('r');
    c.setButtonKey('r', true);
    c.setButtonKey('r', false);
    run(c, 0.2);
    assert(c.state.power > 0.5);
    c.clearInput();
    const p = c.state.power;
    run(c, 0.2);
    assert.equal(c.state.power, p);
    c.destroy();
  });
}
test('focused slider arrows stay native; text, dialogs and blocked panels do not pilot', () => {
  const { c } = setup();
  airborne(c, 'helicopter');
  for (const [code, target] of [
    ['ArrowUp', new InputElement('power')],
    ['KeyW', new InputElement('text')],
    ['KeyR', new InputElement('dialog')],
  ]) {
    const event = keyEvent(code, target);
    c.keyDown(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(c.keys.size, 0);
  }
  c.setButtonKey('r', true);
  c.setStick(1, 1);
  c.keys.add('w');
  c.setInputEnabled(false);
  c.keyDown(keyEvent('KeyR'));
  c.setButtonKey('r', true);
  c.setStick(1, 1);
  run(c, 0.2);
  assert.equal(c.state.power, 0.5);
  assert.equal(c.keys.size, 0);
  assert.deepEqual(c.touch, { x: 0, y: 0, yaw: 0, descend: false });
  c.setInputEnabled(true);
  c.keyDown(keyEvent('KeyR'));
  run(c, 0.2);
  assert(c.state.power > 0.5);
  c.destroy();
});
function placementSetup() {
  const { c, e } = setup();
  e.placement.groundMeshes = [];
  e.buildings = new THREE.Group();
  e.landmarks = new THREE.Group();
  e.waterWorld = {
    sea: { id: 'sea', level: 0 },
    surfaces: [],
    at: () => ({ id: 'sea' }),
  };
  c.world.launch = (x, z) =>
    Math.abs(x) < 10
      ? null
      : { kind: x < 0 ? 'helicopter' : 'seaplane', x, y: 0, z, yaw: 0 };
  c.beginPlacement();
  e.camera.position.set(0, 100, 0);
  e.camera.lookAt(0, 0, 0);
  e.camera.updateMatrixWorld();
  const starts = [];
  c.start = (...args) => starts.push(args);
  const pointer = (id, x, y) => ({
    pointerId: id,
    clientX: x,
    clientY: y,
    button: 0,
    target: e.renderer.domElement,
  });
  return { c, e, starts, pointer };
}
test('aircraft placement previews hover, validity, type and refreshed camera position', () => {
  const { c, e, pointer } = placementSetup();
  c.move(pointer(1, 650, 250));
  assert.equal(c.snapshot.preview.kind, 'seaplane');
  assert.equal(c.snapshot.preview.valid, true);
  c.pick(150, 250);
  assert.equal(c.snapshot.preview.kind, 'helicopter');
  c.pick(400, 250);
  assert.equal(c.snapshot.preview.valid, false);
  // Zoomed/panned camera refreshes the stationary cursor, with no aircraft yet.
  e.camera.position.x = 40;
  c.update(0.1);
  assert.equal(c.snapshot.preview.kind, 'seaplane');
  c.pick(-1, 250);
  assert.equal(c.snapshot.preview, null);
  c.pick(650, 250);
  c.cancelPlacement();
  assert.equal(c.snapshot.preview, null);
  assert.equal(c.ring.visible, false);
  c.destroy();
});
test('placement pans, pinches and cancelled figure drags never launch; deliberate taps do', () => {
  const { c, pointer, starts } = placementSetup();
  c.down(pointer(1, 650, 250));
  c.move(pointer(1, 600, 250));
  c.up(pointer(1, 600, 250));
  assert.equal(starts.length, 0);
  c.down(pointer(1, 650, 250));
  c.down(pointer(2, 600, 250));
  c.up(pointer(2, 600, 250));
  c.up(pointer(1, 650, 250));
  assert.equal(starts.length, 0);
  c.startDrag(pointer(1, 650, 50));
  c.move(pointer(1, 650, 250));
  c.cancelPointer();
  c.up(pointer(1, 650, 250));
  assert.equal(starts.length, 0);
  c.down(pointer(1, 650, 250));
  c.up(pointer(1, 650, 250));
  assert.equal(starts.length, 1);
  assert.equal(starts[0][0], 'seaplane');
  c.destroy();
});
test('replacing crashed aircraft cannot later reclaim camera and preserves smoke expiry', () => {
  const { c, e } = setup();
  run(c, 0.4);
  c.clear();
  assert.equal(c.state, null);
  assert.equal(c.effects.length, 1);
  run(c, 10);
  assert.equal(e.orbits, 0);
  assert.equal(c.effects.length, 1);
  run(c, 11);
  assert.equal(c.effects.length, 0);
  c.destroy();
});
test('zoom exit leaves one cruising aircraft and arbitrary map pan preserves return', () => {
  const { c, e } = setup();
  c.state.phase = 'airborne';
  c.state.y = 420;
  c.state.vy = 0;
  c.state.power = 0.52;
  c.distance = 140;
  c.zoom(1.4);
  assert(!c.attached);
  assert(c.state.cruise);
  const state = c.state;
  e.controls.target.set(2000, 0, -1500);
  e.camera.position.set(4000, 1000, 0);
  run(c, 1);
  assert.equal(c.state, state);
  assert(c.attach());
  assert(c.attached);
  assert(c.distance <= 150);
  run(c, 2);
  assert(e.camera.near < 1);
  c.clear();
  assert.equal(e.camera.near, 2);
  c.destroy();
});
test('boundary recovery resists held input until safely back inside the map', () => {
  const { c } = setup();
  c.state.y = 420;
  c.state.vy = 0;
  c.state.power = 0.52;
  let inside = false;
  c.world.supported = () => inside;
  c.keys.add('w');
  run(c, 3);
  assert(c.state.cruise);
  assert.equal(c.warning, 'boundary');
  c.setPower(0);
  c.cruise();
  c.hover();
  run(c, 1);
  assert(c.state.cruise);
  inside = true;
  run(c, 0.1);
  assert.equal(c.warning, '');
  assert.equal(c.keys.size, 0);
  c.setPower(0.52);
  assert(!c.state.cruise);
  c.destroy();
});
test('new aircraft from a cockpit opens a local overview and cancellation clears placement', () => {
  const { c, e } = setup();
  c.state.y = 420;
  c.state.vy = 0;
  c.distance = 0;
  e.camera.position.set(0, 422, 0);
  c.beginPlacement();
  assert.equal(c.state, null);
  assert(c.placing);
  assert.equal(e.settings.mode, 'orbit');
  assert(e.camera.position.y > 600);
  assert(e.camera.position.distanceTo(e.controls.target) > 200);
  c.cancelPlacement();
  assert(!c.placing);
  assert.equal(c.warning, '');
  c.destroy();
});
test('fixed-step controller gives matching travel at 30 and 60 fps', () => {
  const a = setup(),
    b = setup();
  for (const { c } of [a, b]) {
    c.state.y = 420;
    c.state.vy = 0;
    c.state.power = 0.8;
    c.keys.add('w');
  }
  for (let i = 0; i < 600; i++) a.c.update(1 / 60);
  for (let i = 0; i < 300; i++) b.c.update(1 / 30);
  assert(Math.abs(a.c.state.x - b.c.state.x) < 0.01);
  assert(Math.abs(a.c.state.y - b.c.state.y) < 0.01);
  assert(Math.abs(a.c.state.z - b.c.state.z) < 0.01);
  a.c.destroy();
  b.c.destroy();
});

test('leaving flight controls does not swallow a new aircraft figure drag', () => {
  const { c, e, pointer, starts } = placementSetup();
  c.startDrag(pointer(1, 650, 50));
  e.camera.position.set(0, 100, 0);
  e.camera.lookAt(0, 0, 0);
  c.setInputEnabled(false);
  c.move(pointer(1, 650, 250));
  c.up(pointer(1, 650, 250));
  assert.equal(starts.length, 1);
  assert.equal(starts[0][0], 'seaplane');
  c.destroy();
});
