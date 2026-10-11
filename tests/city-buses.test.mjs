import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { busGeometry, createBuses, updateBuses } = await import(
  cityModule('city-buses')
);
test('buses share one bounded model and pack only nearby vehicles', () => {
  const mesh = createBuses(2);
  assert(mesh.geometry.boundingBox.max.z < 6.2);
  assert(mesh.geometry.boundingBox.min.z > -6.4);
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
test('cheap traffic bus mesh preserves Nova door spacing, unequal widths and axle overhangs', () => {
  const geometry = busGeometry();
  try {
    const positions = geometry.getAttribute('position'),
      colors = geometry.getAttribute('color');
    const vertices = (colour, predicate) => {
      const expected = new THREE.Color(colour);
      const matching = [];
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i);
        if (
          Math.abs(colors.getX(i) - expected.r) < 1e-6 &&
          Math.abs(colors.getY(i) - expected.g) < 1e-6 &&
          Math.abs(colors.getZ(i) - expected.b) < 1e-6 &&
          predicate(point)
        )
          matching.push(point);
      }
      assert.ok(matching.length);
      return new THREE.Box3().setFromPoints(matching);
    };
    const frontDoor = vertices(0x243b47, (p) => p.x < -1.29 && p.z > 0),
      rearDoor = vertices(0x243b47, (p) => p.x < -1.29 && p.z < 0);
    assert.ok(Math.abs(frontDoor.min.z - 4) < 1e-6);
    assert.ok(Math.abs(frontDoor.max.z - 5.2) < 1e-6);
    assert.ok(Math.abs(rearDoor.min.z + 2.3) < 1e-6);
    assert.ok(Math.abs(rearDoor.max.z + 1.4) < 1e-6);
    assert.ok(
      Math.abs(
        frontDoor.getCenter(new THREE.Vector3()).z -
          rearDoor.getCenter(new THREE.Vector3()).z -
          6.45,
      ) < 1e-6,
    );

    const frontWheels = vertices(0x182125, (p) => p.z > 0),
      rearWheels = vertices(0x182125, (p) => p.z < 0);
    assert.ok(
      Math.abs(frontWheels.getCenter(new THREE.Vector3()).z - 3.1) < 1e-6,
    );
    assert.ok(
      Math.abs(rearWheels.getCenter(new THREE.Vector3()).z + 3.1) < 1e-6,
    );
    const body = vertices(0x173e65, (p) => Math.abs(p.y - 0.625) < 1e-6);
    assert.ok(Math.abs(body.max.z - 6.1) < 1e-6);
    assert.ok(Math.abs(body.min.z + 6.3) < 1e-6);
    assert.ok(frontDoor.min.z > frontWheels.getCenter(new THREE.Vector3()).z);
    assert.ok(rearDoor.min.z > rearWheels.getCenter(new THREE.Vector3()).z);
    assert.ok(
      geometry.index.count / 3 < 2500,
      'fallback remains one cheap merged model',
    );
  } finally {
    geometry.dispose();
  }
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
