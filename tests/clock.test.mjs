import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(
  new URL('../lib/city/clock.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { CityClock, DEFAULT_CLOCK, CLOCK_RATES, formatClock, sunAngle } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);

test('clock starts running at the slow default rate and advances independently of frame rate', () => {
  assert.equal(DEFAULT_CLOCK.running, true);
  assert.equal(DEFAULT_CLOCK.rate, 30);
  for (const frames of [1, 30, 60, 120]) {
    const clock = new CityClock();
    clock.tick(0);
    for (let n = 1; n <= frames; n++) clock.tick((60_000 * n) / frames);
    near(clock.hour, 16.5);
  }
});
test('all offered speeds work and midnight wraps into the following day', () => {
  for (const rate of CLOCK_RATES) {
    const clock = new CityClock({ hour: 23.9, rate });
    clock.tick(0);
    clock.tick(60_000);
    near(clock.hour, (23.9 + rate / 60) % 24);
  }
  const clock = new CityClock({ hour: 23.9, rate: 30 });
  clock.tick(0);
  clock.tick(48 * 60_000);
  near(clock.hour, 23.9);
});
test('fixing time stops only the clock and resuming does not catch up paused time', () => {
  const clock = new CityClock();
  clock.tick(0);
  clock.configure({ running: false }, 60_000);
  near(clock.hour, 16.5);
  clock.tick(600_000);
  near(clock.hour, 16.5);
  clock.configure({ running: true }, 900_000);
  near(clock.hour, 16.5);
  clock.tick(960_000);
  near(clock.hour, 17);
});
test('rate changes and manual seeks preserve unrelated clock settings without resetting to 16:00', () => {
  const clock = new CityClock();
  clock.tick(0);
  clock.configure({ rate: 60 }, 60_000);
  near(clock.hour, 16.5);
  clock.tick(120_000);
  near(clock.hour, 17.5);
  clock.configure({ hour: 8.25 }, 120_000);
  clock.tick(180_000);
  near(clock.hour, 9.25);
  clock.configure({ running: false }, 180_000);
  clock.configure({ hour: 23 + 59 / 60, rate: 120 }, 180_000);
  clock.tick(900_000);
  near(clock.hour, 23 + 59 / 60);
  assert.equal(clock.snapshot().running, false);
  clock.configure({ hour: 24 }, 900_000);
  near(clock.hour, 0);
});
test('hidden tabs suspend scene time and return without a time jump', () => {
  const clock = new CityClock();
  clock.tick(0);
  clock.setVisible(false, 30_000);
  near(clock.hour, 16.25);
  clock.tick(3_000_000);
  clock.setVisible(true, 3_600_000);
  near(clock.hour, 16.25);
  clock.tick(3_630_000);
  near(clock.hour, 16.5);
});
test('invalid controls cannot poison the clock or mutate its state via a snapshot', () => {
  const clock = new CityClock();
  clock.tick(0);
  clock.configure({ hour: NaN, rate: Infinity }, 0);
  assert.deepEqual(clock.snapshot(), DEFAULT_CLOCK);
  clock.tick(NaN);
  assert(Number.isFinite(clock.hour));
  const snapshot = clock.snapshot();
  snapshot.hour = 1;
  near(clock.hour, 16);
  clock.configure({ rate: 0 }, 0);
  assert.equal(clock.snapshot().rate, 1);
  clock.configure({ rate: 999 }, 0);
  assert.equal(clock.snapshot().rate, 300);
});
test('clock readouts use actual minutes and solar lighting is continuous across midnight', () => {
  assert.equal(formatClock(16 + 7 / 60), '16:07');
  assert.equal(formatClock(23 + 59 / 60), '23:59');
  assert.equal(formatClock(24), '00:00');
  assert.equal(formatClock(8.5), '08:30');
  const epsilon = 1e-9;
  near(Math.sin(sunAngle(24 - epsilon)), Math.sin(sunAngle(epsilon)));
  near(Math.cos(sunAngle(24 - epsilon)), Math.cos(sunAngle(epsilon)));
  near(sunAngle(6), 0);
  near(sunAngle(13.25), Math.PI / 2);
  near(sunAngle(20.5), Math.PI);
});

test('out-of-order frame timestamps cannot double-count elapsed time', () => {
  const clock = new CityClock();
  clock.tick(1000);
  clock.tick(500);
  clock.tick(2000);
  near(clock.hour, 16 + 30 / 3600);
});

// Execute the real engine methods with Three.js lights and no WebGL renderer.
const engineSource = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'engine.ts',
  engineSource,
  ts.ScriptTarget.Latest,
  true,
);
const engineClass = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CityEngine',
);
const selected = ['applySettings', 'setClock', 'tickClock', 'updateLighting'];
const methods = engineClass.members
  .filter(
    (n) => ts.isMethodDeclaration(n) && selected.includes(n.name.getText(ast)),
  )
  .map((n) => n.getText(ast));
assert.equal(methods.length, selected.length);
const clockUrl =
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const compiled = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}'; import {sunAngle} from '${clockUrl}'; export class EngineMethods {${methods.join('\n')}}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { EngineMethods } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const THREE = await import('three');
function engineFixture() {
  const calls = { resize: 0, mode: 0, stats: [] };
  const e = Object.assign(new EngineMethods(), {
    clock: new CityClock(),
    settings: {
      mode: 'orbit',
      trees: true,
      buildings: true,
      traffic: true,
      autoRotate: false,
      quality: 'high',
    },
    buildings: new THREE.Group(),
    vegetation: new THREE.Group(),
    landmarks: new THREE.Group(),
    trafficGroup: new THREE.Group(),
    controls: { target: new THREE.Vector3(200, 10, 300) },
    camera: new THREE.PerspectiveCamera(),
    renderer: { shadowMap: { enabled: true, needsUpdate: false } },
    sun: new THREE.DirectionalLight(),
    ambient: new THREE.HemisphereLight(),
    sky: {
      material: { uniforms: { sunPosition: { value: new THREE.Vector3() } } },
    },
    uniforms: { night: { value: 0 }, time: { value: 123 } },
    data: {},
    scene: new THREE.Scene(),
    stats: {},
    onStats: (value) => calls.stats.push(value),
    resizeQuality: () => calls.resize++,
    navigation: { setMode: () => calls.mode++ },
    lastLightUpdate: 0,
    lastLightHour: -1,
    lastShadowHour: -1,
    lastSolarShadowUpdate: 0,
  });
  e.clock.tick(0);
  return { e, calls };
}
test('clock ticks update lighting without resizing render targets or resetting navigation', () => {
  const { e, calls } = engineFixture();
  e.updateLighting(true, 0);
  e.tickClock(60_000);
  near(e.clock.hour, 16.5);
  assert.equal(calls.resize, 0);
  assert.equal(calls.mode, 0);
  assert.equal(e.uniforms.time.value, 123);
});
test('layer and mode changes do not reset the independent clock', () => {
  const { e, calls } = engineFixture();
  e.clock.configure({ hour: 22.75, rate: 120, running: false }, 0);
  e.applySettings({ ...e.settings, mode: 'walk', trees: false });
  assert.deepEqual(e.clock.snapshot(), {
    hour: 22.75,
    rate: 120,
    running: false,
  });
  assert.equal(calls.mode, 1);
  e.applySettings({ ...e.settings, quality: 'balanced' });
  assert.deepEqual(e.clock.snapshot(), {
    hour: 22.75,
    rate: 120,
    running: false,
  });
});
test('lighting refresh preserves the street shadow anchor and throttles solar shadow redraws', () => {
  const { e } = engineFixture();
  e.sun.target.position.set(1000, 20, 2000);
  e.updateLighting(true, 0);
  const expected = e.sky.material.uniforms.sunPosition.value
    .clone()
    .add(e.sun.target.position);
  assert(e.sun.position.distanceTo(expected) < 1e-8);
  e.renderer.shadowMap.needsUpdate = false;
  e.tickClock(100);
  assert.equal(e.renderer.shadowMap.needsUpdate, false);
  e.tickClock(5000);
  assert.equal(e.renderer.shadowMap.needsUpdate, true);
  e.renderer.shadowMap.needsUpdate = false;
  e.tickClock(5100);
  assert.equal(e.renderer.shadowMap.needsUpdate, false);
});
test('fix and manual seek commands publish immediately and do not affect traffic visibility', () => {
  const { e, calls } = engineFixture();
  e.trafficGroup.visible = true;
  e.setClock({ hour: 8.25, running: false });
  assert.equal(calls.stats.length, 1);
  assert.equal(calls.stats[0].clock.hour, 8.25);
  assert.equal(e.trafficGroup.visible, true);
  assert.equal(calls.mode, 0);
  assert.equal(calls.resize, 0);
  e.tickClock(performance.now() + 60_000);
  near(e.clock.hour, 8.25);
});
