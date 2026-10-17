import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { prepareCityFurniture, CityStreetFurniture } = await import(
  cityModule('street-furniture-world')
);
const { buildRoadGraph } = await import(cityModule('road-graph'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { planStreetFurniture } = await import(
  cityModule('street-furniture-placement')
);

function fixture() {
  const roads = new THREE.Group(),
    landmarks = new THREE.Group();
  for (const side of [-1, 1]) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 7).rotateX(-Math.PI / 2),
    );
    ground.position.set(120, 1.18, side * 7.5);
    ground.name = `Clipped sidewalks fixture-${side}`;
    ground.userData.walkSurface = true;
    ground.userData.layer = 0;
    roads.add(ground);
  }
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(24, 4, -6);
  const e = {
    roads,
    landmarks,
    camera,
    settings: { quality: 'balanced', buildings: true },
    disposed: false,
    traffic: { downtownAt: () => true },
    waterWorld: { solidAt: () => false },
    detailedTrees: { trees: [] },
    elevation: () => 0,
    prepareNightReceivers() {},
    data: {
      roadRelief: () => 0,
      streetLampPoints: [],
      streetFrontageApproaches: [],
      roadGraph: buildRoadGraph([
        {
          id: 'actual-source',
          name: 'ROBSON ST',
          roadClass: 'local',
          width: 8,
          corridorWidth: 22,
          points: [
            [0, 0],
            [240, 0],
          ],
          level: 'ground',
        },
      ]),
    },
  };
  return {
    e,
    dispose: () =>
      roads.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      }),
  };
}

test('scene adapter authorizes only actual visible ground footways, with real height samples and no terrain fallback', () => {
  const { e, dispose } = fixture();
  try {
    const plan = prepareCityFurniture(e);
    assert(plan.placements.length >= 6);
    assert.deepEqual(
      new Set(plan.placements.map((p) => p.kind)),
      new Set(['cedar-bench', 'garbage-bin', 'bicycle-rack']),
    );
    assert(plan.placements.every((p) => Math.abs(p.y - 1.188) < 1e-6));
    assert.equal(plan.proof.sidewalkMeshes, 2);
    assert.equal(plan.proof.obstacleSources, 0);
    for (const mesh of e.roads.children) mesh.userData.protectedSurface = true;
    assert.equal(prepareCityFurniture(e).placements.length, 0);
    for (const mesh of e.roads.children) {
      mesh.userData.protectedSurface = false;
      mesh.visible = false;
    }
    assert.equal(prepareCityFurniture(e).placements.length, 0);
    for (const mesh of e.roads.children) {
      mesh.visible = true;
      mesh.userData.layer = 1;
    }
    assert.equal(prepareCityFurniture(e).placements.length, 0);
  } finally {
    dispose();
  }
});

test('real scene tree, lamp, building and accepted-door approach exclusions remove their source slots', () => {
  const { e, dispose } = fixture();
  try {
    const base = prepareCityFurniture(e),
      target = base.placements[0];
    const rejected = () =>
      assert(
        !prepareCityFurniture(e).placements.some((p) => p.id === target.id),
      );
    e.detailedTrees.trees = [{ x: target.x, z: target.z, h: 14 }];
    rejected();
    e.detailedTrees.trees = [];
    e.data.streetLampPoints = [[target.x, target.z, 0]];
    rejected();
    e.data.streetLampPoints = [];
    e.waterWorld.solidAt = (x, z) =>
      Math.hypot(x - target.x, z - target.z) < 0.4;
    rejected();
    e.waterWorld.solidAt = () => false;
    // A measured shop door on the outer side of this sidewalk faces the road.
    const nx = Math.sin(target.yaw),
      nz = Math.cos(target.yaw);
    e.data.streetFrontageApproaches = [
      { x: target.x + nx * 4, z: target.z + nz * 4, yaw: target.yaw + Math.PI },
    ];
    rejected();
    e.data.streetFrontageApproaches = [];
    e.traffic.downtownAt = () => false;
    assert.equal(prepareCityFurniture(e).placements.length, 0);
  } finally {
    dispose();
  }
});

test('floor preparation excludes remote dense sidewalks before copying vertices and preserves unfiltered planner results', () => {
  const { e, dispose } = fixture();
  try {
    const remote = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 7, 200, 20).rotateX(-Math.PI / 2),
    );
    remote.position.set(5000, 3, 5000);
    remote.name = 'Clipped sidewalks remote-dense';
    remote.userData.walkSurface = true;
    remote.geometry.computeBoundingBox();
    e.roads.add(remote);
    const allGround = new GroundSurfaceIndex(e.roads.children);
    const expected = planStreetFurniture({
      graph: e.data.roadGraph,
      sidewalkAt: (x, z) => allGround.sample(x, z, 1.18),
      allowed: () => true,
      blocked: () => false,
    });
    // Its cached AABB is sufficient for culling; indexing this far-away dense
    // geometry would reach getAttribute and fail before a hidden full copy.
    remote.geometry.getAttribute = () => {
      throw new Error(
        'Remote vertices must not enter the furniture floor index',
      );
    };
    const actual = prepareCityFurniture(e);
    assert.deepEqual(actual.placements, expected.placements);
    assert.equal(actual.proof.prefilterMeshes, 3);
    assert.equal(actual.proof.sidewalkMeshes, 2);
  } finally {
    dispose();
  }
});

test('floor AABB filtering retains transformed higher overlapping ground and the same highest surface datum', () => {
  const { e, dispose } = fixture();
  try {
    const originals = [...e.roads.children];
    const parent = new THREE.Group();
    parent.position.set(-1024, 1, 512);
    for (const original of originals) {
      const higher = new THREE.Mesh(
        original.geometry.clone().translate(1024, 0, -512),
      );
      higher.position.copy(original.position);
      higher.name = 'Clipped sidewalks transformed-higher';
      higher.userData.walkSurface = true;
      higher.userData.layer = 0;
      parent.add(higher);
    }
    e.roads.add(parent);
    const meshes = [...originals, ...parent.children];
    const allGround = new GroundSurfaceIndex(meshes);
    const expected = planStreetFurniture({
      graph: e.data.roadGraph,
      sidewalkAt: (x, z) => allGround.sample(x, z, 1.18),
      allowed: () => true,
      blocked: () => false,
    });
    const actual = prepareCityFurniture(e);
    assert(actual.placements.length > 0);
    assert.deepEqual(actual.placements, expected.placements);
    assert(actual.placements.every((p) => Math.abs(p.y - 2.188) < 1e-6));
    assert.equal(actual.proof.prefilterMeshes, 4);
    assert.equal(actual.proof.sidewalkMeshes, 4);
  } finally {
    dispose();
  }
});

test('pending furniture protects future routes but unloaded or failed models never create player ghost obstacles', () => {
  const { e, dispose } = fixture();
  const world = new CityStreetFurniture(e);
  const p = world.placements[0];
  try {
    assert.equal(world.ready, false);
    assert.equal(world.blocked(p.x, p.z, 0.35), false);
    assert.equal(world.blocked(p.x, p.z, 0.35, true), true);
    assert.equal(
      world.renderer.stats().attempts,
      0,
      'constructor does not download',
    );
    assert.equal(world.blocked(p.x + 10, p.z + 10, 0.35, true), false);
    world.dispose();
    assert.equal(world.blocked(p.x, p.z, 0.35), false);
    assert.equal(e.landmarks.children.length, 0);
  } finally {
    world.dispose();
    dispose();
  }
});

test('buildings visibility disables ready player collision while retaining future route reservations', () => {
  const { e, dispose } = fixture();
  const world = new CityStreetFurniture(e);
  const target = world.placements[0];
  try {
    Object.defineProperty(world.renderer, 'ready', {
      configurable: true,
      get() {
        return !this.disposed;
      },
    });
    assert.equal(world.blocked(target.x, target.z), true);
    assert.equal(world.blocked(target.x, target.z, 0.35, true), true);
    e.settings.buildings = false;
    assert.equal(world.blocked(target.x, target.z), false);
    assert.equal(world.blocked(target.x, target.z, 0.35, true), true);
    e.settings.buildings = true;
    assert.equal(world.blocked(target.x, target.z), true);
    assert.equal(
      world.renderer.stats().attempts,
      0,
      'visibility policy needs no model download',
    );
    world.dispose();
    assert.equal(world.blocked(target.x, target.z), false);
  } finally {
    delete world.renderer.ready;
    world.dispose();
    dispose();
  }
});

const source = readFileSync(
  new URL('../lib/city/navigation.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'navigation',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const cls = ast.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'StreetNavigation',
);
const method = cls.members.find(
  (n) => ts.isMethodDeclaration(n) && n.name.getText(ast) === 'clearGround',
);
const code = ts.transpileModule(
  `export class Harness {${method.getText(ast)}}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { Harness } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(`const inPolygon=()=>false;${code}`).toString('base64')
);

test('real navigation ground dispatch uses furniture radii and future-proof flag while preserving interior floor priority', () => {
  const nav = new Harness(),
    calls = [];
  nav.mode = 'walk';
  nav.collisions = new Map();
  nav.e = {
    onLand: () => true,
    data: { waterPolys: [] },
    streetFurniture: {
      blocked: (...args) => {
        calls.push(args);
        return args[3];
      },
    },
  };
  assert.equal(nav.clearGround(8, 4), true);
  assert.deepEqual(calls.at(-1), [8, 4, 0.35, false]);
  assert.equal(nav.clearGround(8, 4, 'walk', true), false);
  assert.equal(nav.clearGround(8, 4, 'drive', true), false);
  assert.deepEqual(calls.at(-1), [8, 4, 1.1, true]);
  const prior = calls.length;
  nav.e.interiors = { clear: () => true };
  assert.equal(nav.clearGround(8, 4, 'walk', true), true);
  assert.equal(
    calls.length,
    prior,
    'indoor floors retain their original dispatch',
  );
});
