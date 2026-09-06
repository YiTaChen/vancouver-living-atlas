import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createBuses, updateBuses } = await import(cityModule('city-buses'));
test('buses share one bounded model and pack only nearby vehicles', () => {
  const mesh = createBuses(2);
  assert(mesh.geometry.boundingBox.max.z < 6.1);
  assert(mesh.geometry.boundingBox.max.y < 3.7);
  const routes = [0, 3000].map((x) => ({
    a: [x, 0],
    b: [x, 200],
    length: 200,
    speed: 8,
    phase: 0.2,
  }));
  updateBuses(mesh, routes, 0, () => 0, new THREE.Vector3(0, 10, 40));
  assert.equal(mesh.count, 1);
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  assert.equal(m.elements[14], 40);
  updateBuses(mesh, routes, 1, () => 0, new THREE.Vector3(0, 10, 40));
  mesh.getMatrixAt(0, m);
  assert.equal(m.elements[14], 48);
  updateBuses(mesh, routes, 1, () => 0, new THREE.Vector3(0, 2000, 40));
  assert.equal(mesh.count, 0);
  assert.equal(mesh.visible, false);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
test('bus pitch follows road grade without changing its heading', () => {
  const mesh = createBuses(1),
    r = { a: [0, 0], b: [0, 200], length: 200, speed: 8, phase: 0.2 };
  updateBuses(mesh, [r], 0, (_x, z) => z * 0.06, new THREE.Vector3(0, 10, 40));
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(0, m);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(m);
  assert(forward.y > 0);
  assert(Math.abs(forward.y / forward.z - 0.06) < 1e-6);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
