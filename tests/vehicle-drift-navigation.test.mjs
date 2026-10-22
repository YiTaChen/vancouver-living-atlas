import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { StreetNavigation } = await import(cityModule('navigation'));
const { VehicleImpactWorld } = await import(cityModule('vehicle-impact-world'));
const { createVehicleDrift } = await import(cityModule('vehicle-drift'));
const { unproject } = await import(cityModule('geo'));

class Events {
  listeners = new Map();
  style = {};
  dataset = {};
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  setAttribute() {}
  focus() {}
}
class InputTarget {
  constructor(kind = 'plain') {
    this.kind = kind;
  }
  closest(selector) {
    const match = {
      plain: false,
      select: selector.includes('select'),
      input: selector.includes('input'),
      button: selector.includes('button'),
      dialog: selector.includes('[role="dialog"]'),
      editable: selector.includes('[contenteditable="true"]'),
      combobox: selector.includes('[role="combobox"]'),
    }[this.kind];
    return match ? this : null;
  }
}

globalThis.Element = InputTarget;
globalThis.HTMLInputElement = class extends InputTarget {};
globalThis.HTMLTextAreaElement = class extends InputTarget {};
globalThis.window = new Events();
globalThis.document = Object.assign(new Events(), { hidden: false });

const angle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
const near = (a, b, tolerance = 1e-8) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function event(changes = {}) {
  return {
    key: 'x',
    code: 'KeyX',
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    target: new InputTarget(),
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...changes,
  };
}
function fixture({ model = 'roadster', heading = 0, railX, trees = [] } = {}) {
  const scene = new THREE.Scene(),
    roads = new THREE.Group(),
    camera = new THREE.PerspectiveCamera();
  scene.add(roads, camera);
  if (railX !== undefined) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 4, 200),
      new THREE.MeshStandardMaterial(),
    );
    rail.name = 'Separated Causeway paths rails';
    rail.position.set(railX, 2, 0);
    roads.add(rail);
  }
  const engine = {
    scene,
    roads,
    camera,
    controls: { enabled: true, target: new THREE.Vector3() },
    renderer: { domElement: new Events() },
    settings: { trees: true, quality: 'balanced', mode: 'drive' },
    compatibleGraphics: true,
    disposed: false,
    data: {
      buildings: { features: [] },
      roads: { features: [] },
      waterPolys: [],
      bridgeSurfaces: [],
      streetLampPoints: [],
    },
    elevation: () => 0,
    onLand: () => true,
    detailedTrees: { trees, syncBroken() {} },
  };
  const nav = new StreetNavigation(engine);
  engine.navigation = nav;
  const world = new VehicleImpactWorld(engine);
  engine.vehicleImpacts = world;
  nav.setCarModel(model);
  assert(
    nav.startAt('drive', {
      x: 0,
      y: 1.25,
      z: 0,
      yaw: heading,
      surface: 'ground',
      name: 'Flat road controls fixture',
      snappedDistance: 0,
    }),
  );
  const dispose = () => {
    nav.destroy();
    world.dispose();
    const geometries = new Set(),
      materials = new Set();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };
  return { nav, engine, world, dispose };
}
function keyboard(nav, { drift = true, turn = 'a', throttle = 'w' } = {}) {
  for (const key of [throttle, turn, ...(drift ? ['x'] : [])].filter(Boolean))
    nav.keyDown(event({ key, code: `Key${key.toUpperCase()}` }));
}
function advance(nav, frames = 60, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) nav.update(dt);
}

for (const model of ['classic', 'roadster']) {
  test(`${model}: real Drive update separates body heading and travel velocity while X is held`, () => {
    const f = fixture({ model });
    try {
      f.nav.speed = model === 'classic' ? 16 : 28;
      keyboard(f.nav);
      advance(f.nav, 60);
      const before = f.nav.position.clone();
      f.nav.update(1 / 60);
      const delta = f.nav.position.clone().sub(before);
      const velocityYaw = Math.atan2(delta.x, delta.z);
      assert(f.nav.driftIntensity > 0.3);
      assert(f.nav.drift.slipAngle < -0.15);
      near(angle(velocityYaw - f.nav.yaw), f.nav.drift.slipAngle);
      near(f.nav.car.rotation.y, f.nav.yaw);
      assert(Math.abs(angle(velocityYaw - f.nav.car.rotation.y)) > 0.15);
      assert.equal(f.nav.condition.damage.overall, 0);
    } finally {
      f.dispose();
    }
  });

  test(`${model}: keyboard X and independent mobile steering/held drift have the same actual trajectory`, () => {
    const desktop = fixture({ model }),
      mobile = fixture({ model });
    try {
      desktop.nav.speed = mobile.nav.speed = 16;
      keyboard(desktop.nav);
      mobile.nav.setTouchAxes(-1, 1);
      mobile.nav.setDriftHeld(true);
      for (let i = 0; i < 90; i++) {
        desktop.nav.update(1 / 60);
        mobile.nav.update(1 / 60);
        near(desktop.nav.position.distanceTo(mobile.nav.position), 0);
        near(desktop.nav.yaw, mobile.nav.yaw);
        near(desktop.nav.speed, mobile.nav.speed);
      }
      assert(mobile.nav.driftIntensity > 0);
      mobile.nav.setDriftHeld(false);
      desktop.nav.keyUp(event());
      advance(desktop.nav, 150);
      advance(mobile.nav, 150);
      assert.deepEqual(mobile.nav.drift, createVehicleDrift());
      assert.deepEqual(desktop.nav.drift, createVehicleDrift());
      near(desktop.nav.position.distanceTo(mobile.nav.position), 0);
    } finally {
      desktop.dispose();
      mobile.dispose();
    }
  });
}

test('ordinary forward/reverse WASD movement remains aligned with body heading without X', () => {
  for (const model of ['classic', 'roadster'])
    for (const heading of [0, 1.7, -2.1])
      for (const reverse of [false, true]) {
        const f = fixture({ model, heading });
        try {
          f.nav.speed = reverse ? -4 : 14;
          keyboard(f.nav, { drift: false, throttle: reverse ? 's' : 'w' });
          for (let i = 0; i < 12; i++) {
            const before = f.nav.position.clone();
            f.nav.update(1 / 60);
            const delta = f.nav.position.clone().sub(before);
            const travelYaw = Math.atan2(delta.x, delta.z);
            near(angle(travelYaw - f.nav.yaw - (reverse ? Math.PI : 0)), 0);
            assert.deepEqual(f.nav.drift, createVehicleDrift());
          }
        } finally {
          f.dispose();
        }
      }
});

test('holding X below entry speed or in reverse cannot create lateral drift or smoke', () => {
  for (const speed of [0, 4, -4]) {
    const f = fixture();
    try {
      f.nav.speed = speed;
      keyboard(f.nav, { throttle: speed < 0 ? 's' : null });
      advance(f.nav, 30);
      assert.deepEqual(f.nav.drift, createVehicleDrift());
      assert.equal(f.nav.driftIntensity, 0);
    } finally {
      f.dispose();
    }
  }
});

test('Space brake cancels an actual drift immediately and retains normal speed braking', () => {
  const f = fixture();
  try {
    f.nav.speed = 24;
    keyboard(f.nav);
    advance(f.nav, 45);
    assert(f.nav.driftIntensity > 0.3);
    const speed = f.nav.speed;
    f.nav.keyDown(event({ key: ' ', code: 'Space' }));
    advance(f.nav, 20);
    assert(f.nav.speed < speed * 0.5);
    assert.deepEqual(f.nav.drift, createVehicleDrift());
    assert.equal(f.nav.driftIntensity, 0);
  } finally {
    f.dispose();
  }
});

test('a lateral drift keeps full body CCD, uses actual incoming velocity and damages the struck body side', () => {
  const f = fixture({ railX: 1.8 });
  const calls = [];
  const impact = f.nav.condition.impact.bind(f.nav.condition);
  f.nav.condition.impact = (query) => {
    calls.push(query);
    return impact(query);
  };
  try {
    f.nav.speed = 50;
    Object.assign(f.nav.drift, {
      slipAngle: Math.atan2(1, 2),
      engagement: 1,
      active: true,
    });
    f.nav.move(1, 2);
    assert(calls.length > 0, 'actual production impact hook must run');
    assert.match(calls[0].hit.surfaceId, /^guardrail:/);
    assert(
      calls[0].velocity[0] > 20,
      'sideways momentum must not be discarded',
    );
    near(calls[0].velocity[0] / calls[0].velocity[2], 0.5);
    near(Math.hypot(...calls[0].velocity), 50);
    assert(f.nav.condition.damage.zones.left > 0);
    assert.equal(f.nav.condition.damage.zones.right, 0);
    assert.equal(f.nav.condition.damage.zones.front, 0);
    assert(f.nav.position.x < 1.8 - 0.05 - 1);
    assert.deepEqual(f.nav.drift, createVehicleDrift());
    assert.equal(
      f.world.sweep({
        from: {
          position: [
            f.nav.position.x,
            f.nav.position.y + 0.7,
            f.nav.position.z,
          ],
          quaternion: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.nav.yaw)
            .toArray(),
        },
        to: {
          position: [
            f.nav.position.x,
            f.nav.position.y + 0.7,
            f.nav.position.z,
          ],
          quaternion: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.nav.yaw)
            .toArray(),
        },
        shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
      }),
      null,
      'the accepted body pose cannot penetrate the retained rail',
    );
  } finally {
    f.dispose();
  }
});

test('drifting never bypasses the existing non-land permission check', () => {
  const f = fixture();
  try {
    f.engine.onLand = (x) => x < 0.1;
    f.nav.speed = 28;
    Object.assign(f.nav.drift, {
      slipAngle: 0.4,
      engagement: 1,
      active: true,
    });
    keyboard(f.nav, { turn: 'd' });
    let stopped = false;
    for (let i = 0; i < 12; i++) {
      f.nav.update(1 / 60);
      assert(f.nav.position.x <= 0.1);
      if (f.nav.speed === 0) {
        assert.deepEqual(f.nav.drift, createVehicleDrift());
        stopped = true;
        break;
      }
    }
    assert(
      stopped,
      'the first forbidden lateral step must stop at the existing boundary',
    );
  } finally {
    f.dispose();
  }
});

test('a slide that breaks a small tree retains its sideways momentum at the next obstacle in the same move', () => {
  const f = fixture({
    railX: 2.1,
    trees: [{ x: 1.5, y: 0, z: 2, h: 4, conifer: false }],
  });
  const calls = [];
  const impact = f.nav.condition.impact.bind(f.nav.condition);
  f.nav.condition.impact = (query) => {
    calls.push(query);
    return impact(query);
  };
  try {
    f.nav.speed = 55;
    Object.assign(f.nav.drift, {
      slipAngle: Math.atan2(1, 2),
      engagement: 1,
      active: true,
    });
    f.nav.move(1.2, 2.4);
    assert(f.world.isBroken('tree:0'));
    assert.match(calls[0].hit.surfaceId, /^tree:/);
    const next = calls.find((query) =>
      query.hit.surfaceId.startsWith('guardrail:'),
    );
    assert(next, 'the next rigid obstacle remains part of the swept route');
    assert(
      next.velocity[0] > 5,
      'collision resets cannot erase sideways impact velocity',
    );
    assert(f.nav.position.x < 2.1 - 0.05 - 1);
    assert.deepEqual(f.nav.drift, createVehicleDrift());
  } finally {
    f.dispose();
  }
});

test('physical KeyX works with a non-Latin key value and keyup releases after focus moves', () => {
  const f = fixture();
  try {
    const down = event({ key: 'ㄅ' });
    window.emit('keydown', down);
    assert(down.defaultPrevented);
    assert(f.nav.keys.has('x'));
    window.emit('keyup', event({ key: 'ㄅ', target: new HTMLInputElement() }));
    assert(!f.nav.keys.has('x'));
  } finally {
    f.dispose();
  }
});

test('editable inputs, dialogs, shortcuts and prevented events do not engage drift', () => {
  const f = fixture();
  try {
    for (const changes of [
      { target: new HTMLInputElement() },
      { target: new HTMLTextAreaElement() },
      ...['select', 'editable', 'dialog', 'combobox'].map((kind) => ({
        target: new InputTarget(kind),
      })),
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { defaultPrevented: true },
      { isComposing: true },
    ]) {
      f.nav.keyDown(event(changes));
      assert(!f.nav.keys.has('x'));
    }
    f.nav.mode = 'walk';
    f.nav.keyDown(event());
    assert(!f.nav.keys.has('x'));
  } finally {
    f.dispose();
  }
});

test('a held keyboard autorepeat cannot re-arm drift after a modal closes, blur or model change', () => {
  const f = fixture();
  const freshDown = () => f.nav.keyDown(event());
  const repeatDown = () => f.nav.keyDown(event({ repeat: true }));
  try {
    freshDown();
    assert(f.nav.keys.has('x'));
    f.nav.setDriftInputEnabled(false);
    repeatDown();
    f.nav.setDriftInputEnabled(true);
    repeatDown();
    assert(!f.nav.keys.has('x'));
    f.nav.keyUp(event());
    freshDown();
    assert(f.nav.keys.has('x'));
    window.emit('blur');
    repeatDown();
    assert(!f.nav.keys.has('x'));
    f.nav.keyUp(event());
    freshDown();
    f.nav.setCarModel('classic');
    repeatDown();
    assert(!f.nav.keys.has('x'));
    f.nav.keyUp(event());
    freshDown();
    assert(f.nav.keys.has('x'));
  } finally {
    f.dispose();
  }
});

test('typing X in an input then moving focus to the canvas cannot turn autorepeat into a fresh drift press', () => {
  const f = fixture();
  try {
    // A real prior release leaves the keyboard ready for its next fresh press.
    f.nav.keyUp(event());
    f.nav.keyDown(event({ target: new HTMLInputElement() }));
    assert(!f.nav.keys.has('x'));
    f.nav.keyDown(
      event({ repeat: true, target: f.engine.renderer.domElement }),
    );
    assert(!f.nav.keys.has('x'));
    f.nav.keyUp(event());
    f.nav.keyDown(event({ target: f.engine.renderer.domElement }));
    assert(f.nav.keys.has('x'));
  } finally {
    f.dispose();
  }
});

test('modal disable, hidden page, blur, model change and re-placement clear held and residual drift', () => {
  const f = fixture();
  const engage = () => {
    f.nav.mode = 'drive';
    f.nav.speed = 24;
    f.nav.setDriftInputEnabled(true);
    f.nav.setTouchAxes(-1, 1);
    f.nav.setDriftHeld(true);
    f.nav.keyDown(event());
    advance(f.nav, 30);
    assert(f.nav.driftIntensity > 0.1);
  };
  const cleared = () => {
    assert(!f.nav.touchDrift);
    assert(!f.nav.keys.has('x'));
    assert.deepEqual(f.nav.drift, createVehicleDrift());
  };
  try {
    engage();
    f.nav.setDriftInputEnabled(false);
    cleared();
    f.nav.setDriftHeld(true);
    f.nav.keyDown(event());
    cleared();
    engage();
    document.hidden = true;
    document.emit('visibilitychange');
    cleared();
    document.hidden = false;
    engage();
    window.emit('blur');
    cleared();
    assert.equal(f.nav.speed, 0);
    assert.equal(f.nav.touchX, 0);
    engage();
    f.nav.setCarModel('classic');
    cleared();
    engage();
    f.nav.startAt('walk', {
      x: 0,
      y: 1.25,
      z: 0,
      yaw: 0,
      surface: 'ground',
      name: 'Mode switch',
      snappedDistance: 0,
    });
    cleared();
    assert.equal(f.nav.mode, 'walk');
  } finally {
    document.hidden = false;
    f.dispose();
  }
});

test('destroy releases drift and removes the keyboard, blur and visibility listeners', () => {
  const beforeKeys = window.listeners.get('keydown')?.size ?? 0;
  const beforeVisibility =
    document.listeners.get('visibilitychange')?.size ?? 0;
  const f = fixture();
  f.nav.setDriftHeld(true);
  f.nav.keyDown(event());
  f.dispose();
  assert.equal(window.listeners.get('keydown').size, beforeKeys);
  assert.equal(
    document.listeners.get('visibilitychange').size,
    beforeVisibility,
  );
  assert.equal(f.nav.touchDrift, false);
  assert.deepEqual(f.nav.drift, createVehicleDrift());
});

test('public bridge quick-start clears old keyboard/mobile drift and does not accept a stale repeated X', () => {
  const f = fixture();
  try {
    f.nav.speed = 24;
    keyboard(f.nav);
    f.nav.setDriftHeld(true);
    advance(f.nav, 30);
    assert(f.nav.driftIntensity > 0.1);
    f.engine.data.bridges = {
      mainSpines: [
        {
          kind: 'test-bridge',
          start: unproject(0, 0),
          end: unproject(0, 30),
          estimatedDeckM: 0,
        },
      ],
    };
    f.nav.startBridge('test-bridge');
    assert.equal(f.nav.surface, 'bridge');
    assert.equal(f.nav.touchDrift, false);
    assert(!f.nav.keys.has('x'));
    assert.deepEqual(f.nav.drift, createVehicleDrift());
    f.nav.keyDown(event({ repeat: true }));
    assert(!f.nav.keys.has('x'));
    f.nav.keyUp(event());
    f.nav.keyDown(event());
    assert(f.nav.keys.has('x'));
  } finally {
    f.dispose();
  }
});
