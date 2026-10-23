import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { LandmarkLoadState } = await import(cityModule('landmark-load-state'));
const { LandmarkGpuWarmup } = await import(cityModule('gpu-landmark-warmup'));

function sourceFile(name) {
  return ts.createSourceFile(
    `${name}.ts`,
    readFileSync(`lib/city/${name}.ts`, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}
const engineAst = sourceFile('engine'),
  engineClass = engineAst.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CityEngine',
  ),
  methodNames = ['prepareNightReceivers', 'prepareTravelOccluders'],
  methods = engineClass.members.filter(
    (node) =>
      ts.isMethodDeclaration(node) &&
      methodNames.includes(node.name.getText(engineAst)),
  ),
  assignments = [];
function findPreparation(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    node.left.getText(engineAst) === 'this.prepareLandmark' &&
    ts.isArrowFunction(node.right)
  )
    assignments.push(node.getText(engineAst));
  ts.forEachChild(node, findPreparation);
}
findPreparation(engineClass);
assert.equal(methods.length, methodNames.length);
assert.equal(assignments.length, 1);
function functionSource(file, name) {
  const ast = sourceFile(file),
    declaration = ast.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
  assert.ok(declaration, `Missing production function ${name}`);
  return declaration.getText(ast);
}
// Execute the production startup assignment, enrollment methods and detached
// resource disposal. GPU submission is unnecessary for these ownership paths.
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  ${functionSource('environment', 'wrapNightStreetMaterials')}
  ${functionSource('landmark-worker-service', 'disposeDetachedLandmark')}
  export class LandmarkPreparationPolicy {
    installPreparation() { ${assignments[0]}; }
    ${methods.map((node) => node.getText(engineAst)).join('\n')}
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { LandmarkPreparationPolicy, disposeDetachedLandmark } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function landmark() {
  const group = new THREE.Group(),
    section = new THREE.Group();
  group.add(section);
  for (let i = 0; i < 2; i++)
    section.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(2, 3, 4),
        new THREE.MeshStandardMaterial(),
      ),
    );
  return group;
}
function setup() {
  const scene = new THREE.Scene(),
    landmarks = new THREE.Group(),
    holder = new THREE.Group(),
    wrapped = [],
    preparedCityGeometry = [];
  scene.add(landmarks);
  landmarks.add(holder);
  const cutaway = new TravelOcclusion([landmarks]),
    engine = Object.assign(new LandmarkPreparationPolicy(), {
      scene,
      travelOcclusion: cutaway,
      disposed: false,
      traffic: {
        streetLighting: {
          wrapMaterial: (material) => wrapped.push(material),
        },
      },
      skyTrainTravel: {
        prepareCityGeometry: (group) => preparedCityGeometry.push(group),
      },
      landmarkWarmup: null,
    });
  engine.installPreparation();
  return {
    scene,
    holder,
    cutaway,
    engine,
    wrapped,
    preparedCityGeometry,
    baseline: cutaway.snapshot(),
  };
}
function nodes(root) {
  const result = [];
  root.traverse((object) => result.push(object));
  return result;
}
function assertUnwatched(root) {
  for (const object of nodes(root))
    for (const type of ['childadded', 'childremoved', 'removed'])
      assert.equal(object._listeners?.[type]?.length ?? 0, 0, type);
}
function assertBaseline(fixture) {
  const current = fixture.cutaway.snapshot();
  assert.equal(current.watchedObjects, fixture.baseline.watchedObjects);
  assert.equal(current.meshCount, fixture.baseline.meshCount);
}

test('night preparation wraps detached materials without retaining canceled loader results', () => {
  const f = setup(),
    group = landmark(),
    originalNodes = nodes(group);
  try {
    f.engine.prepareNightReceivers(group);
    assert.equal(f.wrapped.length, 2, 'detached night preparation still runs');
    assertBaseline(f);
    assert.equal(f.cutaway.snapshot().materialCount, 0);
    assertUnwatched(group);
    disposeDetachedLandmark(group);
    assert.deepEqual(nodes(group), originalNodes, 'disposal retains the tree');
    assertBaseline(f);
  } finally {
    f.cutaway.dispose();
  }
});

for (const cancellation of ['cancel', 'dispose'])
  test(`pending landmark ${cancellation} releases cutaway nodes after real warmup abort`, async () => {
    const f = setup(),
      warmer = new LandmarkGpuWarmup({
        renderer: {},
        scene: f.scene,
        camera: new THREE.PerspectiveCamera(),
        colorTarget: () => null,
        unavailable: () => false,
      });
    f.engine.landmarkWarmup = warmer;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const group = landmark(),
          originalNodes = nodes(group),
          resources = originalNodes.filter((node) => node.isMesh),
          disposed = { geometries: 0, materials: 0 };
        for (const mesh of resources) {
          mesh.geometry.addEventListener(
            'dispose',
            () => disposed.geometries++,
          );
          mesh.material.addEventListener('dispose', () => disposed.materials++);
        }
        const state = new LandmarkLoadState({
          load: () => ({ promise: Promise.resolve(group), cancel() {} }),
          prepare: (value, signal) => {
            f.engine.prepareNightReceivers(value);
            return f.engine.prepareLandmark(value, signal, f.holder);
          },
          attach: (value) => f.holder.add(value),
          release: disposeDetachedLandmark,
        });
        state.start();
        await flush();
        assert.equal(state.status, 'preparing');
        assert.equal(
          f.cutaway.snapshot().watchedObjects,
          f.baseline.watchedObjects + originalNodes.length,
        );
        assert.equal(f.cutaway.snapshot().meshCount, 2);
        state[cancellation]();
        assert.deepEqual(disposed, { geometries: 2, materials: 2 });
        await flush();
        assert.equal(
          state.status,
          cancellation === 'cancel' ? 'idle' : 'disposed',
        );
        assert.equal(group.parent, null);
        assert.deepEqual(
          nodes(group),
          originalNodes,
          'no child-clearing workaround',
        );
        assertBaseline(f);
        assert.equal(f.cutaway.snapshot().materialCount, 0);
        assertUnwatched(group);
      }
      assert.equal(f.preparedCityGeometry.length, 3);
    } finally {
      warmer.dispose();
      f.cutaway.dispose();
    }
  });

test('night enrollment recognizes this engine scene and releases dynamic roots under its unwatched scene parent', () => {
  const f = setup(),
    group = landmark(),
    otherScene = new THREE.Scene();
  try {
    otherScene.add(group);
    f.engine.prepareNightReceivers(group);
    assertBaseline(f);
    assertUnwatched(group);
    f.scene.add(group);
    f.engine.prepareNightReceivers(group);
    assert.equal(
      f.cutaway.snapshot().watchedObjects,
      f.baseline.watchedObjects + 4,
    );
    assert.equal(f.cutaway.snapshot().meshCount, 2);
    group.removeFromParent();
    assertBaseline(f);
    assertUnwatched(group);
    disposeDetachedLandmark(group);
    assert.equal(f.cutaway.snapshot().materialCount, 0);
  } finally {
    f.cutaway.dispose();
  }
});
