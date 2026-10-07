import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { SceneryMotionTracker, DetailWorkBudget } = await import(
  cityModule('scenery-motion')
);
const { StreetscapeKit } = await import(cityModule('streetscape-kit'));
const { ArchitecturalDetails } = await import(
  cityModule('architecture-details')
);
const { FacadeDetails } = await import(cityModule('facade-details'));
const { IncrementalFacadeQueue } = await import(cityModule('facade-queue'));
const { createProfile, facadeTemplates } = await import(
  cityModule('facade-profile')
);
const { unproject } = await import(cityModule('geo'));

const dataURL = (s) =>
  'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const threeURL = import.meta.resolve('three');
const fakeThree = dataURL(
  `export * from '${threeURL}'; import {Texture} from '${threeURL}'; export class TextureLoader {load(_path,ok,_progress,error){const texture=new Texture();globalThis.__sceneryTreeLoads.push({ok,error,texture});return texture;}}`,
);
const fakeFactory = dataURL(
  `import {BoxGeometry} from '${threeURL}'; export function createTreeGeometry(_conifer,_variant,detail){globalThis.__sceneryTreeFactories.push(detail);return {trunk:new BoxGeometry(),foliage:new BoxGeometry()};}`,
);
const fakeMature = dataURL(
  `import {Group} from '${threeURL}';export class MatureTrees {group=new Group();status='idle';count=0; constructor(e){e.vegetation.add(this.group);}load(){this.status='loading';return Promise.resolve(false);}reset(){this.count=0;}add(t){if(this.status!=='ready'||t.conifer)return false;this.count++;return true;}finish(){this.group.visible=this.count>0;}state(){return {status:this.status,count:this.count};}dispose(){this.status='disposed';this.group.removeFromParent();}}`,
);
const treeSource = ts.transpileModule(
  readFileSync(
    new URL('../lib/city/detailed-trees.ts', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const treeImports = {
  three: fakeThree,
  './tree-selection': cityModule('tree-selection'),
  './assets/tree-geometry': fakeFactory,
  './assets/mature-trees': fakeMature,
  './geo': cityModule('geo'),
  './quality': cityModule('quality'),
};
const { DetailedTrees } = await import(
  dataURL(
    treeSource.replace(
      /from ['"]([^'"]+)['"]/g,
      (_, id) => `from '${treeImports[id] || id}'`,
    ),
  )
);

function observer(e) {
  const tracker = new SceneryMotionTracker();
  e.detailWorkBudget = new DetailWorkBudget();
  return (time, mode = 'drive', speed = 0, auto = false, allowance) => {
    e.sceneryMotion = tracker.update(
      time,
      e.camera.position.toArray(),
      mode,
      e.camera.position.y,
      speed,
      auto,
    );
    e.detailWorkBudget.reset(
      allowance ?? e.sceneryMotion.preparationBudgetMs,
      e.sceneryMotion.admissionsPerFrame,
    );
  };
}
function treeFixture(count = 30, conifer = true) {
  globalThis.__sceneryTreeLoads = [];
  globalThis.__sceneryTreeFactories = [];
  const e = {
    settings: { quality: 'high', trees: true },
    disposed: false,
    data: {},
    camera: { position: new THREE.Vector3(0, 8.25, 0) },
    vegetation: new THREE.Group(),
    extraTextures: new Set(),
    elevation: () => 0,
    renderer: { shadowMap: {}, capabilities: { getMaxAnisotropy: () => 1 } },
  };
  const base = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    count,
  );
  const trees = Array.from({ length: count }, (_, seed) => {
    const x = (seed % 25) * 0.25,
      z = Math.floor(seed / 25) * 0.25,
      matrix = new THREE.Matrix4().makeTranslation(x, 0, z);
    base.setMatrixAt(seed, matrix);
    return {
      x,
      z,
      h: 15,
      conifer,
      seed,
      slots: [{ mesh: base, index: seed, matrix }],
    };
  });
  return {
    e,
    base,
    trees,
    d: new DetailedTrees(e, trees),
    observe: observer(e),
  };
}
function covered(f) {
  const matrix = new THREE.Matrix4();
  for (const t of f.trees) {
    f.base.getMatrixAt(t.seed, matrix);
    if (f.d.hidden.has(t)) assert.equal(matrix.elements[0], 0);
    else assert.deepEqual(matrix.elements, t.slots[0].matrix.elements);
  }
  assert.equal(
    f.d.hidden.size,
    f.d.pools.reduce((n, p) => n + p.count, 0) +
      f.d.getGeometryCandidateState().count,
  );
}
function settleTrees() {
  globalThis.__sceneryTreeLoads.forEach(({ ok, texture }) => ok(texture));
}

test('Auto fast flight starts no tree work; medium retention and bounded rebuilds never create gaps in original far slots', () => {
  const f = treeFixture();
  f.observe(0, 'flight', 30, true);
  f.d.update();
  assert.equal(globalThis.__sceneryTreeLoads.length, 0);
  covered(f);
  f.observe(500, 'drive', 0, false);
  f.d.update();
  settleTrees();
  for (let i = 1; i <= 16; i++) {
    f.observe(500 + i * 20);
    f.d.update();
    covered(f);
  }
  assert.equal(f.d.hidden.size, 30);
  const factories = globalThis.__sceneryTreeFactories.length;
  f.e.settings.quality = 'balanced';
  f.observe(1000, 'flight', 30, true);
  f.d.update();
  assert.equal(
    f.d.hidden.size,
    30,
    'ready medium representation remains during flight entry',
  );
  assert.equal(globalThis.__sceneryTreeFactories.length, factories);
  covered(f);
  f.e.camera.position.x = 1000;
  f.observe(1500, 'flight', 30, true);
  f.d.update();
  assert.equal(f.d.hidden.size, 0);
  covered(f);
  f.d.dispose();
});

test('manual Ultra keeps its tier during motion; Auto flight caps retained trees at High450 and removes Ultra/mature cost', () => {
  const f = treeFixture(530);
  f.e.settings.quality = 'ultra';
  f.observe(0);
  f.d.update();
  settleTrees();
  for (let i = 1; i <= 24; i++) {
    f.observe(i * 20);
    f.d.update();
    covered(f);
  }
  assert.equal(f.d.hidden.size, 530);
  assert.equal(f.d.pools.length, 12);
  f.observe(600, 'flight', 30, false, 1.25);
  f.d.update(true);
  assert.equal(f.d.quality, 'ultra');
  assert.ok(f.d.pools.slice(6).some((p) => p.count > 0));
  f.e.settings.quality = 'balanced';
  f.observe(1000, 'flight', 30, true, 1.25);
  f.d.update();
  assert.ok(f.d.hidden.size <= 450);
  assert.ok(f.d.pools.slice(6).every((p) => p.count === 0));
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  covered(f);
  f.d.dispose();
});

test('mature-tree distance hysteresis retains the same close source until the exit band', () => {
  const f = treeFixture(1, false);
  f.e.settings.quality = 'ultra';
  f.e.camera.position.x = 35;
  f.d.matureTrees.status = 'ready';
  f.observe(0);
  f.d.update(true);
  assert.equal(f.d.getGeometryCandidateState().count, 1);
  f.e.camera.position.x = 47;
  f.observe(200);
  f.d.update(true);
  assert.equal(f.d.getGeometryCandidateState().count, 1);
  f.e.camera.position.x = 59;
  f.observe(400);
  f.d.update(true);
  assert.equal(f.d.getGeometryCandidateState().count, 0);
  covered(f);
  f.d.dispose();
});

const settle = () => new Promise((resolve) => setImmediate(resolve));
function sceneHost() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 4, 5);
  return {
    camera,
    landmarks: new THREE.Group(),
    buildings: new THREE.Group(),
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
  };
}
function bays() {
  return Array.from({ length: 3 }, (_, id) => ({
    id,
    detailed: false,
    placement: { asset: 'heritage-shop-bay', x: id * 10, y: 0, z: 0, yaw: 0 },
    setDetailed(value) {
      this.detailed = value;
    },
  }));
}
function bayModel() {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.3),
      new THREE.MeshStandardMaterial(),
    ),
  );
  return g;
}

test('street LOD hysteresis and zero preparation retain the live page until a complete atomic replacement', async () => {
  const e = sceneHost(),
    rows = bays(),
    observe = observer(e),
    kit = new StreetscapeKit(e, rows, async () => bayModel());
  observe(0);
  kit.update();
  await settle();
  for (let i = 1; i <= 8; i++) {
    observe(i * 20);
    kit.update();
  }
  assert.equal(kit.snapshot().lod0Bays, 3);
  e.camera.position.z = 43;
  observe(500);
  kit.update();
  assert.equal(
    kit.snapshot().lod0Bays,
    3,
    '38m boundary does not flip ready LOD0',
  );
  e.camera.position.z = 56;
  observe(800, 'drive', 0, false, 0);
  kit.update();
  assert.equal(kit.snapshot().lod0Bays, 3);
  assert.ok(rows.every((r) => r.detailed));
  observe(820);
  kit.update();
  assert.equal(kit.snapshot().visibleBays, 3);
  assert.equal(kit.snapshot().lod0Bays, 0);
  assert.ok(rows.every((r) => r.detailed));
  assert.equal(kit.snapshot().swaps, 1);
  kit.dispose();
});

test('a street prebuild failure keeps the old page and fallback identity, avoids retry thrash and recovers after cooldown', async () => {
  const e = sceneHost(),
    rows = bays(),
    observe = observer(e),
    kit = new StreetscapeKit(e, rows, async () => bayModel());
  observe(0);
  kit.update();
  await settle();
  for (let i = 1; i <= 8; i++) {
    observe(i * 20);
    kit.update();
  }
  const originalBuild = kit.build;
  kit.build = () => {
    throw new Error('prebuild allocation rejected');
  };
  e.camera.position.z = 55;
  observe(500);
  kit.update();
  assert.equal(kit.snapshot().buildFailures, 1);
  assert.equal(kit.snapshot().visibleBays, 3);
  assert.equal(kit.snapshot().lod0Bays, 3);
  assert.ok(rows.every((r) => r.detailed));
  observe(520);
  kit.update();
  assert.equal(kit.snapshot().buildFailures, 1);
  kit.build = originalBuild;
  observe(2600);
  kit.update();
  assert.equal(kit.snapshot().lod0Bays, 0);
  assert.equal(kit.snapshot().visibleBays, 3);
  kit.dispose();
});

function buildingHost(positions = [0], height = 18) {
  const e = sceneHost(),
    profiles = new Map(),
    foundations = new Map();
  const features = positions.map((x, i) => {
    const id = `building-${i}`;
    profiles.set(
      id,
      createProfile({
        key: id,
        heightM: height,
        footprintAreaM2: 600,
        center: [x + 15, 10],
      }),
    );
    foundations.set(id, 0);
    return {
      properties: { id, height, minHeight: 0 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [x, 0],
            [x + 30, 0],
            [x + 30, 20],
            [x, 20],
            [x, 0],
          ].map(([xx, z]) => unproject(xx, z)),
        ],
      },
    };
  });
  e.data = {
    buildings: { features },
    buildingProfiles: profiles,
    buildingFoundations: foundations,
  };
  const coarse = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  e.buildings.add(coarse);
  return { e, coarse, observe: observer(e), foundations };
}

test('architectural consumers block fast Auto admissions, keep manual Ultra ranges and gradually complete after stopping', () => {
  const { e, coarse, observe } = buildingHost([0, 2000]);
  const roof = {
    configureCalls: 0,
    configure() {
      this.configureCalls++;
    },
    takeInvalidated: () => new Set(),
    assemble: () => null,
    dispose() {},
  };
  const system = new ArchitecturalDetails(e, roof);
  observe(0, 'flight', 30, true);
  system.update();
  assert.equal(system.records.size, 0);
  assert.equal(
    roof.configureCalls,
    0,
    'fast Auto cannot start rooftop GLBs through configure',
  );
  e.settings.quality = 'ultra';
  observe(500, 'flight', 30, false);
  system.update();
  assert.equal(system.quality, 'ultra');
  assert.ok(
    [...system.records.values()].some(
      (r) => r.tier === 'roof' && r.cell.bounds.min.x > 1900,
    ),
  );
  assert.ok(system.stats.buildingCells <= 1);
  for (let i = 1; i <= 150; i++) {
    observe(500 + i * 20, 'drive', 0);
    system.update();
  }
  assert.ok(system.stats.readyCells > 0);
  assert.equal(system.stats.pendingCells, 0);
  assert.ok(system.records.size <= 38);
  assert.ok(e.buildings.children.includes(coarse));
  system.dispose();
});

test('facade selection resumes on a stationary policy change and completion still pumps outside camera movement', async () => {
  const { e, coarse, observe, foundations } = buildingHost([0], 60);
  e.landmarkWarmup = { prepare: async () => {} };
  const details = new FacadeDetails(e, foundations);
  observe(0, 'flight', 30, true);
  details.update();
  assert.equal(details.queue.records.size, 0);
  observe(500, 'flight', 0, true);
  details.update();
  assert.equal(details.queue.records.size, 0);
  for (let i = 1; i <= 200; i++) {
    observe(500 + i * 20, 'flight', 0, true);
    details.update();
    await settle();
  }
  assert.ok(details.queue.metrics.completed > 0);
  assert.ok(details.queue.metrics.steps > 0);
  assert.ok(
    [...details.queue.records.values()].some((r) => r.ready?.group.visible),
  );
  assert.ok(details.queue.cacheBytes <= 96 * 1024 * 1024);
  assert.ok(details.queue.pendingBytes <= 8 * 1024 * 1024);
  assert.ok(e.buildings.children.includes(coarse));
  details.dispose();
});

const facadeProfile = {
  ...facadeTemplates.find((p) => p.kind === 'balcony-slab'),
  wallColor: 0x9faba7,
  seed: 0.35,
};
const request = {
  id: 'cell',
  version: 'v1',
  priority: 0,
  items: [
    {
      r: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      x: 5,
      z: 5,
      ground: 0,
      h: 3,
      min: 0,
      profile: facadeProfile,
    },
  ],
};

test('facade pump can pause publication after GPU ack, resume it without new admission and clean a cancelled paused page once', () => {
  const host = new THREE.Group(),
    material = new THREE.MeshBasicMaterial(),
    tickets = [];
  const queue = new IncrementalFacadeQueue(host, material, {
    preparePage: (ticket) => tickets.push(ticket),
    pageBoxes: 1024,
    now: () => 0,
  });
  queue.select([request]);
  queue.pump({ budgetMs: 1.25, allowNewJob: false });
  assert.equal(queue.pendingToken, undefined);
  queue.pump({ budgetMs: 1.25, allowNewJob: true });
  assert.equal(tickets.length, 1);
  tickets[0].ack();
  queue.pump({ budgetMs: 0, allowNewJob: false });
  assert.equal(host.children.length, 0);
  queue.pump({ budgetMs: 1.25, allowNewJob: false });
  assert.equal(host.children.length, 1);
  queue.select([{ ...request, version: 'v2' }]);
  queue.pump({ budgetMs: 1.25 });
  assert.equal(tickets.length, 2);
  let disposals = 0;
  tickets[1].mesh.geometry.addEventListener('dispose', () => disposals++);
  queue.select([]);
  queue.pump({ budgetMs: 0 });
  assert.equal(disposals, 0, 'renderer still borrows cancelled geometry');
  tickets[1].ack();
  tickets[1].ack();
  assert.equal(disposals, 1);
  queue.dispose();
  material.dispose();
});
