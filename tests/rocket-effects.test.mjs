import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { RocketEffects } = await import(cityModule('rocket-effects'));
const { createRocket } = await import(cityModule('rocket-state'));
function fixture(count = 2) {
  const vertices = [],
    colors = [],
    parts = [];
  for (let i = 0; i < count; i++) {
    const x = i === count - 1 && count === 2 ? 300 : 5 + i * 2;
    parts.push({
      key: String(i),
      center: [x, 0],
      minY: 0,
      maxY: 10,
      start: i * 6,
      count: 6,
    });
    vertices.push(
      x - 2,
      0,
      0,
      x + 2,
      0,
      0,
      x,
      10,
      0,
      x - 2,
      0,
      2,
      x + 2,
      0,
      2,
      x,
      10,
      2,
    );
    colors.push(...Array(18).fill(0.8));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  const scene = new THREE.Scene();
  scene.add(mesh);
  const trafficGroup = new THREE.Group();
  scene.add(trafficGroup);
  const treeGroup = new THREE.Group();
  scene.add(treeGroup);
  const engine = {
    scene,
    data: { rocketBuildingMesh: mesh, rocketBuildingParts: parts },
    compatibleGraphics: false,
    settings: { quality: 'balanced' },
    container: { clientHeight: 800 },
    renderer: { shadowMap: { needsUpdate: false } },
    traffic: { vehicleAssets: { group: trafficGroup } },
    detailedTrees: { group: treeGroup, trees: [] },
  };
  const state = createRocket('large', 0, 0, 0);
  state.phase = 'ignition';
  state.throttle = 1;
  return { engine, state, mesh, trafficGroup, treeGroup };
}
function heat(effects, state, seconds = 3) {
  for (let i = 0; i < seconds * 10; i++) effects.update(0.1, state);
}
test('local building damage uploads only changed vertex ranges, preserves distant buildings and resets exactly', () => {
  const { engine, state, mesh } = fixture();
  const pos = mesh.geometry.getAttribute('position'),
    color = mesh.geometry.getAttribute('color');
  const originalPosition = Array.from(pos.array),
    originalColor = Array.from(color.array);
  const effects = new RocketEffects(engine, state);
  heat(effects, state);
  effects.beforeRender();
  effects.afterRender();
  assert.notDeepEqual(
    Array.from(pos.array).slice(0, 18),
    originalPosition.slice(0, 18),
  );
  assert.deepEqual(Array.from(pos.array).slice(18), originalPosition.slice(18));
  assert.deepEqual(Array.from(color.array).slice(18), originalColor.slice(18));
  assert(
    pos.updateRanges.every((range) => range.start === 0 && range.count === 18),
  );
  assert(
    color.updateRanges.every(
      (range) => range.start === 0 && range.count === 18,
    ),
  );
  const version = pos.version,
    colorVersion = color.version;
  effects.beforeRender();
  effects.afterRender();
  assert.equal(
    pos.version,
    version,
    'an unchanged draw does not upload the city position buffer',
  );
  assert.equal(
    color.version,
    colorVersion,
    'an unchanged draw does not upload the city color buffer',
  );
  effects.reset();
  assert.deepEqual(Array.from(pos.array), originalPosition);
  assert.deepEqual(Array.from(color.array), originalColor);
  assert.equal(effects.damaged, 0);
  effects.dispose();
  assert(!engine.scene.children.includes(effects.group));
});
test('flying object matrices and culling restore the newest upstream owner state after each draw', () => {
  const { engine, state, trafficGroup } = fixture();
  trafficGroup.position.set(3, 0, 2);
  trafficGroup.rotation.y = Math.PI / 3;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 2, 4),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const matrix = new THREE.Matrix4().makeTranslation(5, 1, 0);
  mesh.setMatrixAt(0, matrix);
  trafficGroup.add(mesh);
  const effects = new RocketEffects(engine, state);
  effects.update(0.5, state);
  effects.beforeRender();
  effects.afterRender();
  const currentOwner = new THREE.Matrix4().makeTranslation(7, 1, 0);
  mesh.setMatrixAt(0, currentOwner);
  effects.update(0.5, state);
  effects.beforeRender();
  const during = new THREE.Matrix4();
  mesh.getMatrixAt(0, during);
  assert.notDeepEqual(during.elements, currentOwner.elements);
  assert.equal(mesh.frustumCulled, false);
  assert(mesh.instanceMatrix.updateRanges.every((range) => range.count === 16));
  effects.afterRender();
  const after = new THREE.Matrix4();
  mesh.getMatrixAt(0, after);
  assert.deepEqual(after.elements, currentOwner.elements);
  assert.equal(mesh.frustumCulled, true);
  effects.dispose();
});
test('scorched tree proxies fall while source and recycled detailed tree slots are restored', () => {
  const { engine, state, treeGroup } = fixture();
  const source = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 12, 6),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const detailed = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 12, 6),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const matrix = new THREE.Matrix4().makeTranslation(12, 0, 0),
    detailedMatrix = new THREE.Matrix4().makeTranslation(12, 5, 0);
  source.setMatrixAt(0, matrix);
  detailed.setMatrixAt(0, detailedMatrix);
  engine.scene.add(source);
  treeGroup.add(detailed);
  engine.detailedTrees.trees.push({
    x: 12,
    y: 0,
    z: 0,
    h: 12,
    conifer: true,
    seed: 1,
    variant: 0,
    slots: [{ mesh: source, index: 0, matrix }],
  });
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 3);
  effects.beforeRender();
  const hidden = new THREE.Matrix4();
  source.getMatrixAt(0, hidden);
  assert.equal(hidden.determinant(), 0);
  detailed.getMatrixAt(0, hidden);
  assert.equal(hidden.determinant(), 0);
  assert.equal(effects.burning, 1);
  assert(
    effects.group.children.some(
      (object) =>
        object instanceof THREE.Group &&
        object.visible &&
        Math.hypot(object.rotation.x, object.rotation.z) > 0.1,
    ),
  );
  effects.afterRender();
  const restored = new THREE.Matrix4();
  source.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, matrix.elements);
  detailed.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, detailedMatrix.elements);
  assert.equal(source.frustumCulled, true);
  effects.dispose();
});
test('building fragments use a fixed 64-slot pool and settle without unbounded allocation', () => {
  const { engine, state } = fixture(24);
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 8);
  const rubble = effects.group.getObjectByName(
    'Rocket building debris (64 slot limit)',
  );
  assert(rubble instanceof THREE.InstancedMesh);
  assert.equal(rubble.count, 64);
  assert.equal(rubble.instanceMatrix.count, 64);
  heat(effects, state, 15);
  assert.equal(rubble.count, 64);
  assert.equal(effects.debris, 64);
  effects.reset();
  assert.equal(rubble.count, 0);
  effects.dispose();
});

test('a dense forest prioritizes nearby hot trees before applying the visual budget', () => {
  const { engine, state } = fixture();
  const trees = Array.from({ length: 40 }, (_, i) => ({
    x: 90,
    y: 0,
    z: i * 0.01,
    h: 10,
    conifer: true,
    seed: i,
    slots: [],
  }));
  trees.push({ x: 2, y: 0, z: 0, h: 10, conifer: true, seed: 99, slots: [] });
  engine.detailedTrees.trees = trees;
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 3);
  assert(
    effects.burning >= 1,
    'the tree next to the nozzle burns even if distant source records occur first',
  );
  effects.dispose();
});
