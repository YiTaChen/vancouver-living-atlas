import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

// Execute the merged production methods. Only the browser/GPU and independent
// world systems are recording boundaries; no second copy of engine flow runs.
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
const engine = ast.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
);
const names = ['renderScene', 'animate', 'clearHeldInput', 'destroy'];
const members = engine.members.filter(
  (node) => node.name && names.includes(node.name.getText(ast)),
);
assert.equal(members.length, names.length);
const code = ts.transpileModule(
  `
  import * as THREE from ${JSON.stringify(import.meta.resolve('three'))};
  import { clearOrbitGesture } from ${JSON.stringify(cityModule('orbit-lifecycle'))};
  import { minimapPose } from ${JSON.stringify(cityModule('minimap'))};
  import { unproject } from ${JSON.stringify(cityModule('geo'))};
  export class EngineHarness { ${members.map((node) => node.getText(ast)).join('\n')} }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { EngineHarness } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

const browserContexts = new WeakSet();
function fixture(t) {
  const events = [];
  if (!browserContexts.has(t)) {
    browserContexts.add(t);
    const saved = [
      'document',
      'window',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    Object.assign(globalThis, {
      document: Object.assign(new EventTarget(), { hidden: false }),
      window: new EventTarget(),
      requestAnimationFrame: () => 23,
      cancelAnimationFrame: () => {},
    });
    t.after(() => {
      for (const [name, descriptor] of saved)
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    });
  }
  const call =
    (label) =>
    (...args) =>
      events.push([label, ...args]);
  const camera = new THREE.PerspectiveCamera(),
    scene = new THREE.Scene(),
    water = new THREE.Object3D(),
    replacedCar = new THREE.Object3D();
  camera.position.set(0, 20, 100);
  const e = Object.assign(new EngineHarness(), {
    settings: {
      mode: 'rocket',
      quality: 'balanced',
      qualityMode: 'manual',
      traffic: false,
      trains: false,
    },
    disposed: false,
    pageSuspended: false,
    contextLost: false,
    cabinDisplayActive: false,
    compatibleGraphics: true,
    lastTime: 1000,
    fpsAt: 1000,
    frames: 0,
    camera,
    scene,
    water,
    occlusionSubject: new THREE.Vector3(),
    controls: {
      target: new THREE.Vector3(),
      _pointers: [],
      _controlActive: false,
      getAzimuthalAngle: () => 0,
      dispose: call('controls-dispose'),
    },
    uniforms: { time: { value: 0 } },
    tickClock: call('clock-tick'),
    updateShadowFrustum: call('shadow-update'),
    updateAutoQuality: call('quality-update'),
    updateLabels: call('labels-update'),
    sceneryPreparation: {
      pump: call('prepare'),
      dispose: call('prepare-dispose'),
    },
    landmarkDetails: [],
    lastShadowCamera: camera.position.clone(),
    stats: {},
    clock: { hour: 10, calendarDay: 1, snapshot: () => ({ hour: 10 }) },
    skyEffects: { update: call('sky-update') },
    onStats: call('stats'),
    renderer: {
      domElement: Object.assign(new EventTarget(), {
        dataset: {},
        remove: call('canvas-remove'),
      }),
      info: {
        reset: call('render-reset'),
        render: { triangles: 0, calls: 0 },
        memory: { geometries: 0 },
      },
      shadowMap: { enabled: false },
      render: call('draw'),
      dispose: call('renderer-dispose'),
      forceContextLoss: call('context-release'),
    },
    runtimePerformance: {
      setRenderContext: call('render-context'),
      beginFrame: call('frame-begin'),
      endFrame: call('frame-end'),
      beginGpu: call('gpu-begin'),
      endGpu: call('gpu-end'),
      measure: (_name, run) => run(),
      dispose: call('performance-dispose'),
    },
    rocket: {
      active: true,
      state: { speed: 42, position: { x: 0, y: 321, z: 0 } },
      snapshot: { active: true, phase: 'flight' },
      update: call('rocket-update'),
      renderSpace: () => false,
      beforeRender: call('rocket-before'),
      afterRender: call('rocket-after'),
      clearInput: call('rocket-input'),
      destroy: call('rocket-destroy'),
    },
    busWorldService: {
      update: call('bus-world-update'),
      snapshot: () => ({ active: true }),
      dispose: call('bus-world-dispose'),
    },
    busVisit: {
      aboard: false,
      update: call('bus-visit-update'),
      snapshot: () => ({ aboard: false }),
      clearInput: call('bus-input'),
      dispose: call('bus-dispose'),
    },
    skyTrainTravel: {
      active: false,
      ready: true,
      underground: true,
      update: call('world-skytrain-update'),
      snapshot: () => ({ active: false }),
      clearInput: call('skytrain-input'),
      dispose: call('skytrain-dispose'),
    },
    railway: { trains: [{ kind: 'skytrain', cars: [{ group: replacedCar }] }] },
    soundscape: { dispose: call('sound-dispose') },
    soundscapeWorld: { update: call('sound-update') },
    navigation: {
      mode: 'orbit',
      walker: { group: new THREE.Group() },
      speed: 0,
      position: new THREE.Vector3(),
      blur: call('navigation-input'),
      update: call('navigation-update'),
      destroy: call('navigation-destroy'),
    },
    interactions: {
      update: call('interactions-update'),
      clear: call('interactions-input'),
      dispose: call('interactions-dispose'),
    },
    loadAbort: { abort: call('abort') },
    labelElements: [],
    extraTextures: [],
    roadMaterials: new Map(),
    sun: { shadow: { dispose: call('sun-dispose') } },
  });
  return { e, events, water, replacedCar };
}

test('the merged RAF advances the rocket alongside main transit and sound systems and publishes rocket telemetry without walk navigation', (t) => {
  const { e, events, replacedCar } = fixture(t);
  e.animate(2016);
  const count = (label) => events.filter(([name]) => name === label).length;
  for (const label of [
    'rocket-update',
    'bus-world-update',
    'bus-visit-update',
    'world-skytrain-update',
    'sound-update',
    'interactions-update',
    'rocket-before',
    'draw',
    'rocket-after',
    'frame-begin',
    'frame-end',
    'gpu-begin',
    'gpu-end',
  ])
    assert.equal(count(label), 1, label);
  assert.equal(
    count('navigation-update'),
    0,
    'walking cannot move the rocket camera',
  );
  assert.equal(
    replacedCar.visible,
    false,
    'main world SkyTrain still replaces old train cars',
  );
  assert.equal(e.stats.speed, 151);
  assert.equal(e.stats.elevation, 321);
  assert.deepEqual(
    JSON.parse(e.renderer.domElement.dataset.rocket),
    e.rocket.snapshot,
  );
  assert.deepEqual(JSON.parse(e.renderer.domElement.dataset.busWorldService), {
    active: true,
  });
  assert.equal(events.at(-1)[0], 'frame-end');
  assert.equal(e.raf, 23);
});

test('draw and rocket preparation failures restore city effect ownership, underground water and main GPU/frame diagnostics', (t) => {
  for (const failurePoint of ['renderer', 'composer', 'rocket-before']) {
    const { e, events, water } = fixture(t);
    let effectApplied = false;
    const failure = new Error(failurePoint);
    e.rocket.beforeRender = () => {
      events.push(['rocket-before']);
      effectApplied = true;
      if (failurePoint === 'rocket-before') throw failure;
    };
    e.rocket.afterRender = () => {
      events.push(['rocket-after']);
      effectApplied = false;
    };
    const draw = () => {
      assert(effectApplied, 'the real draw sees mission-owned damage');
      assert.equal(
        water.visible,
        false,
        'the ocean cannot flood the underground view',
      );
      throw failure;
    };
    if (failurePoint === 'composer') e.composer = { render: draw };
    else e.renderer.render = draw;
    assert.throws(
      () => e.animate(1016),
      (error) => error === failure,
    );
    assert.equal(effectApplied, false);
    assert.equal(water.visible, true);
    assert.deepEqual(
      events.slice(-3).map(([name]) => name),
      ['rocket-after', 'gpu-end', 'frame-end'],
    );
  }
});

test('the compact space render skips city LOD and city-effect draws while main frame and world updates still complete', (t) => {
  const { e, events } = fixture(t);
  e.detailedTrees = {
    update() {
      assert.fail('space does not admit city LOD work');
    },
  };
  e.rocket.renderSpace = () => {
    events.push(['space-draw']);
    return true;
  };
  e.animate(1016);
  assert.equal(events.filter(([name]) => name === 'space-draw').length, 1);
  for (const label of [
    'rocket-before',
    'rocket-after',
    'gpu-begin',
    'gpu-end',
    'draw',
  ])
    assert.equal(events.filter(([name]) => name === label).length, 0, label);
  for (const label of [
    'rocket-update',
    'bus-world-update',
    'world-skytrain-update',
    'sound-update',
    'frame-begin',
    'frame-end',
  ])
    assert.equal(events.filter(([name]) => name === label).length, 1, label);
  assert.equal(events.at(-1)[0], 'frame-end');
});

test('input clearing and idempotent destruction retain both rocket and new main service ownership', (t) => {
  const { e, events } = fixture(t);
  e.clearHeldInput();
  for (const label of [
    'rocket-input',
    'bus-input',
    'skytrain-input',
    'navigation-input',
    'interactions-input',
  ])
    assert.equal(events.filter(([name]) => name === label).length, 1, label);
  e.destroy();
  e.destroy();
  for (const label of [
    'rocket-destroy',
    'bus-world-dispose',
    'bus-dispose',
    'skytrain-dispose',
    'sound-dispose',
    'performance-dispose',
    'renderer-dispose',
    'context-release',
  ])
    assert.equal(events.filter(([name]) => name === label).length, 1, label);
  assert.equal(e.busWorldService, null);
  assert.equal(e.skyTrainTravel, null);
  assert.equal(e.busVisit, null);
  assert.equal(e.soundscapeWorld, null);
  const order = events.map(([name]) => name);
  assert(order.indexOf('bus-world-dispose') < order.indexOf('bus-dispose'));
  assert(order.indexOf('rocket-destroy') < order.indexOf('renderer-dispose'));
});
