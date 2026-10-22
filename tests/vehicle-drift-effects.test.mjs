import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { VehicleDriftEffects, DRIFT_EFFECT_CAPACITY } = await import(
  cityModule('vehicle-drift-effects')
);
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
function road(rectangles = [[-10, -20, 10, 120]]) {
  return new GroundSurfaceIndex(
    rectangles.map(([x0, z0, x1, z1]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [x0, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z0, x1, 0, z1, x0, 0, z1],
          3,
        ),
      );
      return new THREE.Mesh(geometry);
    }),
  );
}
function fixture() {
  const nav = {
    mode: 'drive',
    carModel: 'roadster',
    driftIntensity: 0.8,
    speed: 20,
    position: new THREE.Vector3(0, 0.2, 0),
    car: new THREE.Group(),
    surfaceId: 'ground',
    surfaceLayer: 0,
  };
  const e = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    settings: { mode: 'drive', quality: 'ultra' },
    compatibleGraphics: false,
    navigation: nav,
    clock: { hour: 14 },
    data: { roadSurface: road(), travelSurfaces: { lookup: () => [] } },
  };
  return { e, nav, fx: new VehicleDriftEffects(e) };
}
const advance = (f, frames = 60) => {
  for (let i = 0; i < frames; i++) {
    f.nav.position.z = (f.nav.position.z + 0.4) % 80;
    f.fx.update(1 / 60);
  }
};
const gpuFinite = (f) => {
  for (const object of [f.fx.marks, f.fx.smoke])
    for (const attribute of Object.values(object.geometry.attributes))
      assert([...attribute.array].every(Number.isFinite));
};

test('all qualities share fixed buffers and at most two draw calls under continuous drifting', () => {
  const f = fixture(),
    marks = f.fx.marks.geometry,
    smoke = f.fx.smoke.geometry;
  const arrays = [marks, smoke].flatMap((g) => Object.values(g.attributes));
  const bytes = f.fx.stats().bufferBytes;
  try {
    advance(f, 3600);
    assert.equal(f.e.scene.children.length, 2);
    assert(
      f.fx.stats().marks > 0 &&
        f.fx.stats().marks <= DRIFT_EFFECT_CAPACITY.marks,
    );
    assert(
      f.fx.stats().smoke > 0 &&
        f.fx.stats().smoke <= DRIFT_EFFECT_CAPACITY.smoke,
    );
    assert.equal(f.fx.stats().drawCalls, 2);
    for (const [quality, markBudget, smokeBudget] of [
      ['high', 192, 48],
      ['balanced', 96, 24],
      ['ultra', 384, 96],
    ]) {
      f.e.settings.quality = quality;
      advance(f, 30);
      assert.equal(f.fx.stats().markBudget, markBudget);
      assert.equal(f.fx.stats().smokeBudget, smokeBudget);
      assert(
        f.fx.stats().marks <= markBudget && f.fx.stats().smoke <= smokeBudget,
      );
      assert(marks.drawRange.count <= markBudget * 6);
    }
    f.e.compatibleGraphics = true;
    f.fx.update(1 / 60);
    assert.equal(f.fx.stats().markBudget, 48);
    assert.equal(f.fx.stats().smokeBudget, 12);
    assert.equal(f.fx.stats().bufferBytes, bytes);
    assert.deepEqual(
      [marks, smoke].flatMap((g) => Object.values(g.attributes)),
      arrays,
    );
    gpuFinite(f);
  } finally {
    f.fx.dispose();
  }
});

test('ribbons follow actual rear wheels, leave simulation untouched and never paint an unpaved gap', () => {
  const f = fixture();
  try {
    f.e.settings.quality = 'balanced';
    // Rear tyre Z begins at0, then moves2m across a real40cm asphalt gap.
    f.e.data.roadSurface = road([
      [-5, -10, 5, 0.8],
      [-5, 1.2, 5, 10],
    ]);
    f.nav.position.z = 1.4;
    f.fx.update(0.1);
    f.nav.position.z = 3.4;
    const pose = f.nav.position.toArray(),
      quaternion = f.nav.car.quaternion.toArray();
    f.fx.update(0.1);
    assert.deepEqual(f.nav.position.toArray(), pose);
    assert.deepEqual(f.nav.car.quaternion.toArray(), quaternion);
    assert.equal(
      f.fx.stats().marks,
      0,
      'exact ground interval proof must reject disconnected tyre endpoints',
    );
    assert(
      f.fx.stats().smoke > 0,
      'smoke can originate at the currently supported tyres',
    );
    f.nav.position.z = 3.9;
    f.fx.update(0.1);
    assert.equal(f.fx.stats().marks, 2);
    assert.equal(f.nav.speed, 20);
    assert.equal(f.nav.driftIntensity, 0.8);
    const p = f.fx.marks.geometry.getAttribute('position');
    for (let i = 0; i < 12; i++) assert(Math.abs(p.getY(i) - 0.018) < 1e-6);
    const xs = Array.from({ length: 12 }, (_, i) => p.getX(i));
    assert(xs.some((x) => x < -0.8) && xs.some((x) => x > 0.8));
  } finally {
    f.fx.dispose();
  }
});

test('Tesla physical face IDs resolve canonical road identity and exact layer rather than a nearby pedestrian or upper floor', () => {
  const f = fixture();
  const p = {
    intensity: 0.9,
    speedMps: 20,
    surfaceId: 'protected:40:face:2',
    identity: { surfaceId: 'lions:road', layer: 1 },
    position: [0, 5.68, 0],
    quaternion: [0, 0, 0, 1],
    wheelContacts: [
      [-0.896, -0.68, 1.39],
      [0.896, -0.68, 1.39],
      [-0.896, -0.68, -1.39],
      [0.896, -0.68, -1.39],
    ],
  };
  try {
    f.e.settings.mode = 'tesla';
    f.e.tesla = { driftContact: p };
    f.e.data.travelSurfaces.lookup = () => [
      { surfaceId: 'lions:road', layer: 1, y: 5, allowedModes: ['walk'] },
      { surfaceId: 'lions:road', layer: 2, y: 5.1, allowedModes: ['drive'] },
      { surfaceId: 'lions:road', layer: 1, y: 5, allowedModes: ['drive'] },
    ];
    f.fx.update(0.05);
    p.position[2] += 1;
    f.fx.update(0.05);
    assert.equal(f.fx.stats().marks, 2);
    const positions = f.fx.marks.geometry.getAttribute('position');
    for (let i = 0; i < 12; i++)
      assert(Math.abs(positions.getY(i) - 5.018) < 1e-5);
    f.e.tesla.driftContact = null;
    f.fx.update(0.05);
    p.position[2] += 30;
    f.e.tesla.driftContact = p;
    f.fx.update(0.05);
    assert.equal(
      f.fx.stats().marks,
      2,
      'a parked/airborne interval cannot connect a remote tyre ribbon',
    );
    f.e.data.travelSurfaces.lookup = () => [
      { surfaceId: 'lions:road', layer: 1, y: 5, allowedModes: ['walk'] },
    ];
    p.position[2] += 1;
    f.fx.update(0.05);
    assert.equal(f.fx.stats().marks, 2);
  } finally {
    f.fx.dispose();
  }
});

test('inactive modes, reverse, invalid poses and invalid dt do not emit or contaminate GPU data; tracks settle and dispose once', () => {
  const f = fixture();
  try {
    for (const mode of ['walk', 'boat', 'flight', 'orbit']) {
      f.e.settings.mode = mode;
      advance(f, 3);
    }
    assert.equal(f.fx.stats().drawCalls, 0);
    f.e.settings.mode = 'drive';
    f.nav.speed = -10;
    advance(f, 3);
    assert.equal(f.fx.stats().marks, 0);
    f.nav.speed = 20;
    advance(f, 30);
    const count = f.fx.stats().marks;
    for (const dt of [0, -1, NaN, Infinity]) f.fx.update(dt);
    assert.equal(f.fx.stats().marks, count);
    f.nav.position.x = NaN;
    f.fx.update(0.05);
    gpuFinite(f);
    f.nav.position.x = 0;
    f.nav.car.quaternion.set(0, 0, 0, 0);
    f.fx.update(0.05);
    gpuFinite(f);
    f.fx.update(100);
    assert.equal(f.fx.stats().drawCalls, 0);
    let geometries = 0,
      materials = 0;
    for (const o of [f.fx.marks, f.fx.smoke]) {
      o.geometry.addEventListener('dispose', () => geometries++);
      o.material.addEventListener('dispose', () => materials++);
    }
    f.fx.dispose();
    f.fx.dispose();
    assert.equal(geometries, 2);
    assert.equal(materials, 2);
    assert.equal(f.e.scene.children.length, 0);
    assert(f.fx.stats().disposed);
    f.fx.update(0.1);
    assert.equal(f.fx.stats().drawCalls, 0);
  } finally {
    f.fx.dispose();
  }
});

test('reduced-motion suppresses tyre particles while retaining the readable ground trail', () => {
  const before = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  const f = fixture();
  try {
    advance(f, 60);
    assert(f.fx.stats().marks > 0);
    assert.equal(f.fx.stats().smoke, 0);
    assert.equal(f.fx.stats().drawCalls, 1);
  } finally {
    f.fx.dispose();
    globalThis.window = before;
  }
});
