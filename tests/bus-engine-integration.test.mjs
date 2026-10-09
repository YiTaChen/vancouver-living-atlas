import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

function ast(name) {
  const source = readFileSync(
    new URL(`../lib/city/${name}.ts`, import.meta.url),
    'utf8',
  );
  return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
}
async function module(source) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
}
const source = ast('engine');
const cls = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
);
const names = [
  'visitBusInterior',
  'publishBusVisit',
  'closeBusVisit',
  'setBusVisitDetail',
  'flyTo',
  'leaveTravelAtLocation',
  'zoom',
  'focusTrain',
  'focusHarbour',
  'applySettings',
];
const methods = cls.members.filter(
  (node) =>
    ts.isMethodDeclaration(node) && names.includes(node.name.getText(source)),
);
assert.equal(methods.length, names.length);
const { Harness } = await module(
  `export class Harness {${methods.map((node) => node.getText(source)).join('\n')}}`,
);
function fixture() {
  const calls = {
    settings: 0,
    nav: [],
    stats: [],
    prepare: 0,
    close: 0,
    placement: 0,
    flight: 0,
    resume: [],
  };
  const visit = {
    aboard: false,
    routeIndex: null,
    close() {
      calls.close++;
      return true;
    },
    snapshot() {
      return { aboard: this.aboard };
    },
    async prepare(policy) {
      calls.prepare++;
      calls.policy = policy;
      return true;
    },
  };
  const e = Object.assign(new Harness(), {
    disposed: false,
    busVisit: visit,
    busVisitDetail: 'auto',
    compatibleGraphics: false,
    settings: {
      mode: 'orbit',
      traffic: true,
      quality: 'balanced',
      qualityMode: 'manual',
      autoRotate: true,
    },
    stats: {},
    onStats: (snapshot) => calls.stats.push(snapshot),
    onTravelResume: (mode) => calls.resume.push(mode),
    navigation: { setMode: (mode) => calls.nav.push(mode) },
    placement: { cancel: () => calls.placement++ },
    flight: { clear: () => calls.flight++ },
    controls: { target: new THREE.Vector3(), autoRotate: true },
    camera: new THREE.PerspectiveCamera(),
    renderer: { shadowMap: { enabled: false } },
    buildings: new THREE.Group(),
    vegetation: new THREE.Group(),
    trafficGroup: new THREE.Group(),
    landmarks: new THREE.Group(),
    resizeQuality() {},
    updateLighting() {},
    fly() {
      calls.settings++;
    },
  });
  return { e, visit, calls };
}
test('public visit preparation changes to walking only after successful model and placement preparation', async () => {
  const { e, calls, visit } = fixture();
  visit.prepare = async () => false;
  assert.equal(await e.visitBusInterior(), false);
  assert.equal(e.settings.mode, 'orbit');
  assert.deepEqual(calls.resume, []);
  visit.prepare = async () => true;
  assert.equal(await e.visitBusInterior(), true);
  assert.equal(e.settings.mode, 'walk');
  assert.equal(e.settings.traffic, true);
  assert.equal(e.settings.autoRotate, false);
  assert.equal(e.trafficGroup.visible, true);
  assert.deepEqual(calls.resume, ['walk']);
});

test('public detail preferences pass the live effective Auto/manual quality into the next prepared visit', async () => {
  const { e, calls } = fixture();
  e.settings.qualityMode = 'auto';
  e.settings.quality = 'high';
  e.stats.effectiveQuality = 'balanced'; // Previous reporting sample may lag the renderer.
  e.setBusVisitDetail('detailed');
  assert.equal(await e.visitBusInterior(), true);
  assert.deepEqual(calls.policy, {
    quality: 'high',
    compatible: false,
    detail: 'detailed',
  });
  e.settings.qualityMode = 'manual';
  e.settings.quality = 'ultra';
  e.compatibleGraphics = true;
  e.setBusVisitDetail('light');
  await e.visitBusInterior();
  assert.deepEqual(calls.policy, {
    quality: 'ultra',
    compatible: true,
    detail: 'light',
  });
  e.setBusVisitDetail('unknown');
  assert.equal(e.busVisitDetail, 'light');
});
test('failed alighting blocks mode changes, traffic hiding and distant focus before changing the scene', async () => {
  const { e, visit, calls } = fixture();
  e.settings.mode = 'walk';
  visit.aboard = true;
  visit.close = () => false;
  const before = { ...e.settings };
  e.applySettings({ ...before, mode: 'drive' });
  e.applySettings({ ...before, traffic: false });
  e.flyTo('overview');
  e.leaveTravelAtLocation();
  e.focusTrain('skytrain');
  e.focusHarbour('cruise');
  assert.equal(await e.visitBusInterior(), false);
  assert.deepEqual(e.settings, before);
  assert.deepEqual(calls.nav, []);
  assert.equal(calls.settings, 0);
  assert.equal(calls.prepare, 0);
  assert.equal(calls.placement, 0);
});
test('quality overrides remain available aboard while ordinary zoom cannot move the rider eye outside the cabin', () => {
  const { e, visit, calls } = fixture();
  visit.aboard = true;
  e.settings.mode = 'walk';
  visit.close = () => {
    throw new Error('quality change must not alight');
  };
  const before = e.camera.position.clone();
  e.zoom(5);
  assert.deepEqual(e.camera.position, before);
  e.applySettings({ ...e.settings, quality: 'ultra' });
  assert.equal(e.settings.quality, 'ultra');
  assert.deepEqual(calls.nav, []);
});
test('hiding traffic also closes a prepared unoccupied parked cabin', () => {
  const { e, visit, calls } = fixture();
  e.settings.mode = 'walk';
  visit.routeIndex = 3;
  e.applySettings({ ...e.settings, traffic: false });
  assert.equal(calls.close, 1);
  assert.equal(e.settings.traffic, false);
  assert.equal(e.trafficGroup.visible, false);
});
test('a disposed scene cannot complete an asynchronous bus preparation or publish late UI state', async () => {
  const { e, visit, calls } = fixture();
  let resolve;
  visit.prepare = () =>
    new Promise((done) => {
      resolve = done;
    });
  const operation = e.visitBusInterior();
  const published = calls.stats.length;
  e.disposed = true;
  resolve(true);
  assert.equal(await operation, false);
  e.publishBusVisit();
  assert.equal(calls.stats.length, published);
  assert.deepEqual(calls.resume, []);
});

const environment = ast('environment');
const update = environment.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name.text === 'updateTraffic',
);
const { updateTraffic, recorded } = await module(`
  export const recorded=[];
  const updateBuses=(...args)=>recorded.push(args);
  ${update.getText(environment)}
`);
test('main scene excludes parked and replaced buses from fallback and forwards Auto admission and actual tyre-contact road height', () => {
  let policy, exclusions;
  const e = {
    camera: new THREE.Vector3(0, 2, 0),
    busVisit: { routeIndex: 1 },
    settings: { quality: 'balanced' },
    compatibleGraphics: true,
    sceneryMotion: { allowNewDetails: false },
    data: { roadSurface: { sample: () => 2.75 } },
    elevation: () => 0,
  };
  e.camera = { position: e.camera };
  const traffic = {
    buses: {},
    busRoutes: [{}, {}, {}],
    busAssets: {
      setExcludedRoutes: (value) => {
        exclusions = value;
      },
      update: (_time, _camera, ground, value) => {
        policy = value;
        assert.equal(ground(0, 0), 2.75);
        return new Set([2]);
      },
    },
    vehicleAssets: { update: () => true },
    mesh: {},
    cabins: {},
  };
  updateTraffic(e, traffic, 10);
  assert.deepEqual([...exclusions], [1]);
  assert.deepEqual(policy, {
    quality: 'balanced',
    compatible: true,
    allowNew: false,
  });
  assert.deepEqual(
    [...recorded.at(-1)[5]].sort((a, b) => a - b),
    [1, 2],
  );
});
