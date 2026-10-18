import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createTeslaRoadster, TESLA_ROADSTER_THRUSTERS: ports } = await import(
  cityModule('assets/tesla-roadster')
);

test('Vortex pulses reuse the ten existing jets and strengthen lift/rear ports without changing any model tier budget', () => {
  const model = createTeslaRoadster({ quality: 'low' }),
    jets = model.group.getObjectByName('bounded-cold-gas-jets'),
    geometry = jets.geometry,
    material = jets.material,
    matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  try {
    model.update({ thrust: 0.48, vortexThrust: 0 });
    const normal = Array.from(jets.instanceMatrix.array);
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      model.update({ thrust: 0, vortexThrust: 0 });
      const idle = model.stats();
      model.update({ vortexThrust: 1 });
      assert.equal(model.stats().triangles, idle.triangles + 160);
      assert.equal(model.stats().meshes, idle.meshes + 1);
      assert.equal(jets.count, 10);
      assert.equal(jets.geometry, geometry);
      assert.equal(jets.material, material);
      assert(material.opacity <= 0.230000001);
      for (let i = 0; i < ports.length; i++) {
        jets.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        const expected =
          ports[i].kind === 'lift'
            ? 1.4
            : ports[i].kind === 'rear'
              ? 1.15
              : 0.35;
        assert(Math.abs(scale.y - expected) < 1e-6);
      }
      for (let frame = 0; frame < 120; frame++)
        model.update({ vortexThrust: (frame % 20) / 20 });
      assert(Array.from(jets.instanceMatrix.array).every(Number.isFinite));
    }
    assert.equal(model.group.children.length, 4);
    assert.equal(model.stats().cachedLevels, 3);
    model.update({ thrust: 0.48, vortexThrust: 0 });
    assert.deepEqual(Array.from(jets.instanceMatrix.array), normal);
    model.update({ thrust: 0, vortexThrust: Number.NaN });
    assert.equal(jets.visible, false);
    assert.equal(jets.userData.excludeFromSSAO, true);
    assert.equal(jets.material.depthWrite, false);
  } finally {
    model.dispose();
  }
});
