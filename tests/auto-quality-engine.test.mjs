import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

// Execute the actual engine integration with a recording renderer. Pure policy
// tests alone cannot catch stale UI settings or drawing-buffer reallocations.
const source = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'engine.ts',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const cls = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CityEngine',
);
const names = [
  'pixelRatio',
  'resizeQuality',
  'updateAutoQuality',
  'applySettings',
];
const fields = [
  'settings',
  'autoQuality',
  'sceneryMotionTracker',
  'sceneryMotion',
  'detailWorkBudget',
  'lastAppliedPixelRatio',
  'autoTimingNeedsAnchor',
  'visibilityChange',
];
const members = cls.members
  .filter(
    (n) =>
      (ts.isMethodDeclaration(n) && names.includes(n.name.getText(ast))) ||
      (ts.isPropertyDeclaration(n) && fields.includes(n.name.getText(ast))),
  )
  .map((n) => n.getText(ast));
assert.equal(members.length, names.length + fields.length);
const compiled = ts.transpileModule(
  `
import {AutoQualityController} from '${cityModule('auto-quality')}';
import {SceneryMotionTracker, DetailWorkBudget} from '${cityModule('scenery-motion')}';
import {DEFAULT_SETTINGS} from '${cityModule('types')}';
import {QUALITY, qualityPixelRatio} from '${cityModule('quality')}';
export class EngineHarness {${members.join('\n')}}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { EngineHarness } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const { DEFAULT_SETTINGS } = await import(cityModule('types'));
const oldWindow = globalThis.window,
  oldDocument = globalThis.document;
globalThis.window = { devicePixelRatio: 2 };
globalThis.document = { hidden: false };
test.after(() => {
  if (oldWindow === undefined) delete globalThis.window;
  else globalThis.window = oldWindow;
  if (oldDocument === undefined) delete globalThis.document;
  else globalThis.document = oldDocument;
});

function fixture() {
  const calls = { renderer: [], composer: [], details: 0, modes: [] };
  const e = Object.assign(new EngineHarness(), {
    container: { clientWidth: 1280, clientHeight: 720 },
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), autoRotate: false },
    elevation: () => 0,
    clock: { setVisible() {} },
    clearHeldInput() {},
    navigation: { speed: 0, setMode: (mode) => calls.modes.push(mode) },
    flight: null,
    renderer: {
      setPixelRatio: (ratio) => calls.renderer.push(ratio),
      shadowMap: { enabled: false },
    },
    composer: { setPixelRatio: (ratio) => calls.composer.push(ratio) },
    sun: new THREE.DirectionalLight(),
    fxaa: { uniforms: { resolution: { value: new THREE.Vector2() } } },
    buildings: new THREE.Group(),
    vegetation: new THREE.Group(),
    trafficGroup: new THREE.Group(),
    landmarks: new THREE.Group(),
    detailedTrees: { update: () => calls.details++ },
    scheduleScenery() {},
    updateLighting() {},
    updateShadowFrustum() {},
  });
  e.camera.position.set(0, 4, 0);
  let time = 1000;
  const run = (duration, frameMs = 16.6666667) => {
    const end = time + duration;
    while (time < end) {
      time += frameMs;
      e.updateAutoQuality(time, frameMs);
    }
    return e.autoQuality.snapshot();
  };
  return { e, calls, run };
}

test('a fresh city chooses Auto and sustained slow RAF intervals lower the drawing buffer without changing travel state', () => {
  const { e, calls, run } = fixture();
  assert.equal(DEFAULT_SETTINGS.qualityMode, 'auto');
  assert.equal(e.settings.quality, 'balanced');
  e.resizeQuality();
  const camera = e.camera,
    nav = e.navigation,
    position = e.camera.position.clone();
  run(60_000, 80);
  assert.equal(e.autoQuality.snapshot().resolutionScale, 0.65);
  assert.equal(e.pixelRatio(), 0.65);
  assert.deepEqual(calls.renderer, [1, 0.8, 0.65]);
  assert.deepEqual(calls.composer, calls.renderer);
  assert.equal(e.camera, camera);
  assert.equal(e.navigation, nav);
  assert.deepEqual(e.camera.position, position);
});

test('manual High and Ultra remain forced through long slow flights, and omitted qualityMode keeps legacy manual behavior', () => {
  for (const quality of ['high', 'ultra']) {
    const { e, run } = fixture();
    run(60_000, 80);
    const samples = e.autoQuality.snapshot().samples;
    e.applySettings({
      ...e.settings,
      qualityMode: 'manual',
      quality,
      mode: 'flight',
    });
    e.flight = { attached: true, state: { speed: 70 } };
    const ratio = e.pixelRatio();
    run(60_000, 100);
    assert.equal(e.settings.quality, quality);
    assert.equal(e.pixelRatio(), ratio);
    assert(ratio >= 1);
    assert.equal(e.autoQuality.snapshot().samples, samples);
  }
  const { e, run } = fixture();
  const legacy = { ...e.settings, quality: 'ultra' };
  delete legacy.qualityMode;
  e.applySettings(legacy);
  run(60_000, 100);
  assert.equal(e.settings.quality, 'ultra');
  assert(e.pixelRatio() > 1);
});

test('stale UI quality cannot force an Auto tier and flight caps before optional refresh', () => {
  const { e, run } = fixture();
  run(25_000);
  assert.equal(e.settings.quality, 'high');
  e.applySettings({ ...e.settings, quality: 'ultra' });
  assert.equal(e.settings.quality, 'high');
  const observed = [];
  e.detailedTrees.update = () => observed.push(e.settings.quality);
  e.flight = { attached: true, state: { speed: 60 } };
  e.applySettings({ ...e.settings, mode: 'flight', quality: 'ultra' });
  assert.equal(e.settings.quality, 'balanced');
  assert.deepEqual(observed, ['balanced']);
  assert.equal(e.autoQuality.snapshot().capQuality, 'balanced');
});

test('ordinary settings patches preserve Auto history and unchanged resolution avoids buffer reallocation', () => {
  const { e, calls, run } = fixture();
  e.resizeQuality();
  run(10_000);
  const before = e.autoQuality.snapshot();
  e.applySettings({ ...e.settings, labels: false, traffic: false });
  assert.equal(e.autoQuality.snapshot().sampleCount, before.sampleCount);
  assert.equal(e.autoQuality.snapshot().timingResets, before.timingResets);
  assert.deepEqual(calls.renderer, [1]);
  assert.deepEqual(calls.composer, [1]);
  // ResizeObserver handles setSize; quality refresh must still update FXAA when DPR stays the same.
  e.container.clientWidth = 1000;
  e.resizeQuality();
  assert.equal(e.fxaa.uniforms.resolution.value.x, 1 / 1000);
  assert.equal(calls.renderer.length, 1);
});

test('compatible graphics cap Auto to Balanced while retaining adaptive resolution', () => {
  const { e, run } = fixture();
  e.compatibleGraphics = true;
  run(90_000);
  assert.equal(e.settings.quality, 'balanced');
  assert.equal(e.autoQuality.snapshot().capQuality, 'balanced');
  run(60_000, 80);
  assert.equal(e.autoQuality.snapshot().resolutionScale, 0.65);
  assert.equal(e.pixelRatio(), 0.65);
});

test('manual return reanchors timing and hidden or transitioning intervals do not count as render load', () => {
  const { e, run } = fixture();
  run(10_000);
  e.applySettings({ ...e.settings, qualityMode: 'manual', quality: 'high' });
  e.applySettings({ ...e.settings, qualityMode: 'auto' });
  assert.equal(e.autoQuality.snapshot().sampleCount, 0);
  const before = e.autoQuality.snapshot().samples;
  globalThis.document.hidden = true;
  run(60_000, 100);
  globalThis.document.hidden = false;
  assert.equal(e.autoQuality.snapshot().samples, before);
  e.transition = {};
  run(10_000, 100);
  e.transition = null;
  assert.equal(e.autoQuality.snapshot().samples, before);
  run(1000);
  assert.equal(e.settings.quality, 'balanced');
  assert.equal(e.autoQuality.snapshot().resolutionScale, 1);
});

test('the actual visibility handler excludes the first resumed RAF interval even after a short hidden pause', () => {
  const { e, run } = fixture();
  run(10_000);
  globalThis.document.hidden = true;
  e.visibilityChange();
  globalThis.document.hidden = false;
  e.visibilityChange();
  const before = e.autoQuality.snapshot().samples;
  e.updateAutoQuality(13_000, 2000);
  assert.equal(e.autoQuality.snapshot().samples, before);
  assert.equal(e.autoQuality.snapshot().lastFrameMs, null);
  e.updateAutoQuality(13_017, 17);
  assert.equal(e.autoQuality.snapshot().samples, before + 1);
  assert.equal(e.autoQuality.snapshot().hitches, 0);
});

test('a cap-only settings call cannot consume the first real RAF anchor after manual return', () => {
  const { e, run } = fixture();
  run(10_000);
  e.applySettings({ ...e.settings, qualityMode: 'manual', quality: 'high' });
  e.applySettings({ ...e.settings, qualityMode: 'auto' });
  const before = e.autoQuality.snapshot().samples;
  const now = performance.now();
  e.updateAutoQuality(now + 2000, 2000);
  assert.equal(e.autoQuality.snapshot().samples, before);
  assert.equal(e.autoQuality.snapshot().lastFrameMs, null);
  e.updateAutoQuality(now + 2017, 17);
  assert.equal(e.autoQuality.snapshot().samples, before + 1);
  assert.equal(e.autoQuality.snapshot().hitches, 0);
});

test('real walking displacement is moving even though navigation.speed is zero, and vertical takeoff limits new details', () => {
  const { e } = fixture();
  e.applySettings({ ...e.settings, mode: 'walk' });
  let time = 1000;
  for (let i = 0; i < 300; i++) {
    time += 1000 / 60;
    e.camera.position.x += 4 / 60;
    e.updateAutoQuality(time, 1000 / 60);
  }
  assert.equal(e.navigation.speed, 0);
  assert.equal(e.sceneryMotion.moving, true);
  assert(Math.abs(e.sceneryMotion.speedMps - 4) < 0.001);
  assert.equal(e.sceneryMotion.preparationBudgetMs, 0.65);
  e.flight = { attached: true, state: { speed: 0, vy: 7 } };
  e.camera.position.y = 100;
  e.updateAutoQuality(time + 17, 17);
  assert.equal(e.sceneryMotion.mode, 'flight');
  assert.equal(e.sceneryMotion.moving, true);
  assert.equal(e.sceneryMotion.speedMps, 7);
  assert.equal(e.sceneryMotion.allowNewDetails, false);
});
