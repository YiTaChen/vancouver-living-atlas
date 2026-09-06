import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { visibleThroughParents, firstVisibleObstacleHit } = await import(
  cityModule('visible-obstacles')
);
function fixture() {
  const world = new THREE.Group(),
    buildings = new THREE.Group(),
    landmarks = new THREE.Group();
  world.add(buildings, landmarks);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const roof = (z) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), material);
    mesh.position.z = z;
    return mesh;
  };
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 20),
    new THREE.Vector3(0, 0, -1),
    0,
    30,
  );
  const pick = () => {
    world.updateMatrixWorld(true);
    return firstVisibleObstacleHit(ray, [
      ...buildings.children,
      ...landmarks.children,
    ]);
  };
  const close = () => {
    world.traverse((o) => o.geometry?.dispose());
    material.dispose();
  };
  return { world, buildings, landmarks, roof, ray, pick, close };
}
test('visible obstruction search passes hidden nearer hits and finds the visible farther roof', () => {
  const f = fixture(),
    near = f.roof(10),
    far = f.roof(3);
  f.buildings.add(near, far);
  near.visible = false;
  assert.equal(f.pick()?.object, far);
  near.visible = true;
  assert.equal(f.pick()?.object, near);
  near.visible = false;
  far.visible = false;
  assert.equal(f.pick(), undefined);
  f.close();
});
test('hidden parents at any level suppress roof occlusion and restore without changing child flags', () => {
  const f = fixture(),
    holder = new THREE.Group(),
    mesh = f.roof(5);
  holder.add(mesh);
  f.landmarks.add(holder);
  for (const parent of [holder, f.landmarks, f.world]) {
    parent.visible = false;
    assert.equal(mesh.visible, true);
    assert.equal(visibleThroughParents(mesh), false);
    assert.equal(f.pick(), undefined);
    parent.visible = true;
    assert.equal(visibleThroughParents(mesh), true);
    assert.equal(f.pick()?.object, mesh);
  }
  f.close();
});
test('body overview/cell hierarchy keeps only the visible representation and respects the user parent', () => {
  const f = fixture(),
    layer = new THREE.Group(),
    nearGroup = new THREE.Group(),
    far = f.roof(4),
    cell = f.roof(4);
  nearGroup.add(cell);
  layer.add(far, nearGroup);
  f.buildings.add(layer);
  nearGroup.visible = false;
  assert.equal(f.pick()?.object, far);
  far.visible = false;
  nearGroup.visible = true;
  assert.equal(f.pick()?.object, cell);
  for (const parent of [layer, f.buildings]) {
    parent.visible = false;
    assert.equal(cell.visible, true);
    assert.equal(f.pick(), undefined);
    parent.visible = true;
    assert.equal(f.pick()?.object, cell);
  }
  far.visible = true;
  nearGroup.visible = false;
  assert.equal(f.pick()?.object, far);
  assert.equal(cell.visible, true);
  f.close();
});
test('visibility query preserves ray limits, layers, material side and all visibility flags', () => {
  const f = fixture(),
    mesh = f.roof(5);
  f.buildings.add(mesh);
  const flags = [f.world, f.buildings, f.landmarks, mesh].map((o) => o.visible);
  f.ray.far = 14;
  assert.equal(f.pick(), undefined);
  assert.equal(f.ray.far, 14);
  f.ray.far = 30;
  mesh.layers.set(2);
  assert.equal(f.pick(), undefined);
  f.ray.layers.set(2);
  assert.equal(f.pick()?.object, mesh);
  assert.equal(f.ray.layers.mask, 4);
  mesh.material.side = THREE.BackSide;
  assert.equal(f.pick(), undefined);
  assert.deepEqual(
    [f.world, f.buildings, f.landmarks, mesh].map((o) => o.visible),
    flags,
  );
  assert.equal(f.ray.near, 0);
  f.close();
});
