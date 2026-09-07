import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { FlightController } = await import(cityModule('flight-controller'));
const { createFlight } = await import(cityModule('flight-state'));
function setup() {
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  const canvas = new EventTarget();
  canvas.focus = () => {};
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
