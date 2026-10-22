import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createStreetLampDamage } = await import(cityModule('environment'));
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);

test('lamp destruction removes matching pole/cap and its filtered light source, leaving off-field and other source identities correct', () => {
  const poles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
      3,
    ),
    caps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
      3,
    ),
    matrices = [0, 1, 2].map((index) =>
      new THREE.Matrix4().makeTranslation(index * 30, 9, 50),
    );
  matrices.forEach((matrix, index) => {
    poles.setMatrixAt(index, matrix);
    caps.setMatrixAt(index, matrix);
  });
  const lighting = new NightStreetLighting({
      bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
      size: 128,
      allowed: () => true,
      lamps: [
        { x: 30, y: 9, z: 50 },
        { x: 85, y: 9, z: 50 },
      ],
    }),
    e = { disposed: false, renderer: { shadowMap: {} } },
    breakLamp = createStreetLampDamage(
      e,
      poles,
      caps,
      new Int32Array([-1, 1, 0]),
      lighting,
    ),
    zero = new THREE.Matrix4().makeScale(0, 0, 0),
    actual = new THREE.Matrix4(),
    near = lighting.sample(30, 50),
    far = lighting.sample(85, 50);
  try {
    assert.equal(
      breakLamp(0),
      true,
      'off-field source still loses its visible pole',
    );
    assert.deepEqual(lighting.sample(30, 50), near);
    assert.deepEqual(lighting.sample(85, 50), far);
    assert.equal(lighting.stats().disabledLamps, 0);
    for (const mesh of [poles, caps]) {
      mesh.getMatrixAt(0, actual);
      assert.deepEqual(actual.elements, zero.elements);
      mesh.getMatrixAt(1, actual);
      assert.deepEqual(actual.elements, matrices[1].elements);
    }
    assert.equal(
      breakLamp(1),
      true,
      'world source one maps to field source one',
    );
    assert.equal(lighting.sample(85, 50).warm, 0);
    assert.deepEqual(lighting.sample(30, 50), near);
    assert.equal(lighting.stats().disabledLamps, 1);
    assert.equal(
      breakLamp(2),
      true,
      'world source two maps to field source zero',
    );
    assert.equal(lighting.sample(30, 50).warm, 0);
    assert.equal(lighting.stats().disabledLamps, 2);
    for (const mesh of [poles, caps])
      for (let index = 0; index < 3; index++) {
        mesh.getMatrixAt(index, actual);
        assert.deepEqual(actual.elements, zero.elements);
      }
    const version = poles.instanceMatrix.version;
    assert.equal(breakLamp(1), false);
    assert.equal(poles.instanceMatrix.version, version);
    for (const index of [-1, 3, 0.5, NaN, Infinity])
      assert.equal(breakLamp(index), false);
    assert.equal(e.renderer.shadowMap.needsUpdate, true);
    e.disposed = true;
    assert.equal(breakLamp(0), false);
  } finally {
    lighting.dispose();
    for (const mesh of [poles, caps]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }
});
