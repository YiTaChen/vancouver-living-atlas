import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cityModule } from './helpers/city-modules.mjs';
const threeURL = import.meta.resolve('three');
const { enterLocalMap } = await import(cityModule('local-map-camera'));

// Extract this one current production method, so the regression also covers
// update ordering, the terrain clamp, and completion handoff. Do not duplicate
// its implementation in a synthetic frame function: that would miss the bug.
const source = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const start = source.indexOf('  animate = (time: number) => {');
const end = source.indexOf('\n  setLocale(', start);
assert(
  start >= 0 && end > start,
  'Update the method boundaries if engine.ts is reorganized',
);
const code = ts.transpileModule(
  `import * as THREE from ${JSON.stringify(threeURL)};\nexport class FrameHarness {\n${source.slice(start, end)}\n}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { FrameHarness } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

function fixture({ mode = 'walk', ground = false, yaw = 0, lookYaw = 0 } = {}) {
  const camera = new THREE.PerspectiveCamera(58, 1.6, 0.08, 45000);
  // A null element is supported. Programmatic update and all camera constraints
  // are real; only DOM listener installation is skipped.
  const controls = new OrbitControls(camera, null);
  controls.minDistance = 28;
  controls.maxDistance = 18000;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enabled = false;
  const anchor = new THREE.Vector3(30, 20, 40);
  const dir = new THREE.Vector3(
    Math.sin(yaw + lookYaw),
    0,
    Math.cos(yaw + lookYaw),
  );
  camera.position
    .copy(anchor)
    .add(new THREE.Vector3(0, mode === 'boat' ? 2.05 : 1.68, 0));
  controls.target.copy(anchor).addScaledVector(dir, 25);
  camera.lookAt(camera.position.clone().addScaledVector(dir, 25));
  const nav = {
    mode,
    position: anchor.clone(),
    yaw,
    boat: { lookYaw },
    setMode(value) {
      this.mode = value;
      controls.enabled = value === 'orbit';
      camera.fov = 42;
      camera.near = 2;
      camera.up.set(0, 1, 0);
      camera.updateProjectionMatrix();
    },
  };
  const e = Object.assign(new FrameHarness(), {
    camera,
    controls,
    navigation: nav,
    settings: { mode, autoRotate: false },
    renderer: { shadowMap: { needsUpdate: false } },
    elevation: () => 20,
    onLand: () => ground,
    transition: null,
    disposed: false,
    contextLost: false,
    uniforms: { time: { value: 0 } },
    tickClock() {},
    clock: { hour: 16, calendarDay: 0 },
    skyEffects: { update() {} },
    updateLabels() {},
    renderScene() {},
    traffic: null,
    railway: null,
    harbour: null,
    sailingWaves: null,
    minimap: null,
    lastShadowCamera: camera.position.clone(),
    lastTime: 0,
    frames: 0,
    fpsAt: performance.now(),
  });
  const initial = camera.position.clone();
  const oldRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  return {
    e,
    initial,
    anchor,
    frame(elapsed) {
      assert(e.transition, 'An active transition is required');
      const now = performance.now();
      e.transition.start = now - elapsed;
      // Prevent the unrelated 800ms stats callback path from running.
      e.fpsAt = now;
      e.animate(now);
    },
    // Null-element controls installed no listeners; dispose() assumes a DOM
    // element in this Three version, so there is nothing to disconnect here.
    close() {
      globalThis.requestAnimationFrame = oldRAF;
    },
  };
}

test('local-map entry saves the exact source eye and complete ground/deck/water target', () => {
  for (const mode of ['walk', 'drive', 'boat']) {
    const f = fixture({
      mode,
      yaw: Math.PI / 2,
      lookYaw: mode === 'boat' ? Math.PI / 2 : 0,
    });
    try {
      assert.equal(enterLocalMap(f.e), true);
      assert(f.e.camera.position.distanceTo(f.initial) < 1e-9);
      assert(f.e.transition.from.distanceTo(f.initial) < 1e-9);
      assert(f.e.controls.target.distanceTo(f.anchor) < 1e-9);
      assert(f.e.navigation.position.distanceTo(f.anchor) < 1e-9);
      assert.equal(f.e.navigation.mode, 'orbit');
      assert.equal(f.e.settings.mode, 'orbit');
      assert.equal(f.e.settings.autoRotate, false);
      assert(Math.abs(f.e.transition.to.distanceTo(f.anchor) - 200) < 1e-8);
      assert.equal(
        enterLocalMap(f.e),
        false,
        'Repeated exits do not restart the transition',
      );
    } finally {
      f.close();
    }
  }
});

test('first transition frame does not apply the real OrbitControls 28m minimum', () => {
  const f = fixture();
  try {
    enterLocalMap(f.e);
    f.frame(0);
    assert(
      f.e.camera.position.distanceTo(f.initial) < 0.01,
      `Unexpected first-frame jump: ${f.e.camera.position.distanceTo(f.initial)}m`,
    );
  } finally {
    f.close();
  }
});

test('ground-level first frame is not raised to the normal orbit terrain clearance', () => {
  const f = fixture({ ground: true });
  try {
    enterLocalMap(f.e);
    f.frame(0);
    assert(
      f.e.camera.position.distanceTo(f.initial) < 0.01,
      `Orbit terrain clamp caused a ${f.e.camera.position.distanceTo(f.initial)}m jump`,
    );
  } finally {
    f.close();
  }
});

test('DOM Orbit handlers cannot update an unfinished first-person exit', () => {
  const f = fixture();
  try {
    enterLocalMap(f.e);
    assert.equal(
      f.e.controls.enabled,
      false,
      'Skipping animate.update alone is insufficient: Orbit pointer handlers call update directly',
    );
  } finally {
    f.close();
  }
});

test('completed exit restores orbit at the exact 200m pose without moving its target', () => {
  const f = fixture();
  try {
    enterLocalMap(f.e);
    const expected = f.e.transition.to.clone();
    f.frame(600);
    assert.equal(f.e.transition, null);
    assert.equal(f.e.controls.enabled, true);
    assert(f.e.camera.position.distanceTo(expected) < 1e-8);
    assert(f.e.controls.target.distanceTo(f.anchor) < 1e-8);
    assert.equal(f.e.controls.minDistance, 28);
  } finally {
    f.close();
  }
});

test('first-person exit eases orientation instead of looking straight down on its first frame', () => {
  const f = fixture();
  try {
    const orientation = f.e.camera.quaternion.clone();
    enterLocalMap(f.e);
    f.frame(0);
    assert(f.e.camera.quaternion.angleTo(orientation) < 0.001);
    f.frame(275);
    const mid = f.e.camera.quaternion.clone();
    assert(mid.angleTo(orientation) > 0.1);
    f.frame(600);
    assert(f.e.camera.quaternion.angleTo(mid) > 0.1);
  } finally {
    f.close();
  }
});
