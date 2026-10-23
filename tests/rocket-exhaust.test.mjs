import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createRocketModel, disposeRocketObject } = await import(
  cityModule('assets/rocket')
);
const { createRocket, ROCKET_CONFIGS, sampleRocketEffects } = await import(
  cityModule('rocket-state')
);

test('Titan exhaust stays attached to all five nozzles through throttle changes and staging', () => {
  const model = createRocketModel('super-heavy'),
    config = ROCKET_CONFIGS['super-heavy'];
  const s = createRocket('super-heavy', 0, 0, 0);
  s.phase = 'flight';
  model.build(1);
  model.group.position.set(30, 20, 80);
  model.group.quaternion.setFromEuler(new THREE.Euler(0.21, 0.3, -0.12));
  try {
    for (const stage of ['strap-on', 'strap-separating', 'boost', 'upper']) {
      s.stage = stage;
      s.strapAttached = stage === 'strap-on';
      s.boosterAttached = stage !== 'upper';
      for (const throttle of [0.08, 0.35, 1]) {
        s.throttle = throttle;
        model.stage(s);
        model.fire(sampleRocketEffects(s).engine, 0.73);
        model.group.updateMatrixWorld(true);
        const anchor = (mesh) => {
          mesh.geometry.computeBoundingBox();
          return mesh.localToWorld(
            new THREE.Vector3(0, mesh.geometry.boundingBox.min.y, 0),
          );
        };
        const nozzle =
          (s.boosterAttached ? 0 : config.height * config.upperNozzleFraction) +
          config.height * 0.005;
        const expected = model.group.localToWorld(
          new THREE.Vector3(0, nozzle, 0),
        );
        assert(
          anchor(model.flame).distanceTo(expected) < 1e-6,
          `${stage}/${throttle}: main jet cannot float below its nozzle`,
        );
        assert(
          anchor(model.flame.children[0]).distanceTo(expected) < 1e-6,
          'inner shock-cell core shares the physical nozzle',
        );
        if (s.strapAttached)
          model.strapPlumes.forEach((plume, i) => {
            const sideNozzle = model.strapOns[i].localToWorld(
              new THREE.Vector3(0, config.height * 0.005, 0),
            );
            assert(anchor(plume).distanceTo(sideNozzle) < 1e-6);
            assert(anchor(plume.children[0]).distanceTo(sideNozzle) < 1e-6);
          });
        else assert(model.strapPlumes.every((p) => !p.visible));
      }
    }
  } finally {
    disposeRocketObject(model.group);
  }
});

test('Titan uses shared animated exhaust volumes with a fixed geometry budget and no shadow passes', () => {
  const model = createRocketModel('super-heavy');
  try {
    const jets = [model.flame, ...model.strapPlumes];
    const shell = jets[0].material,
      core = jets[0].children[0].material;
    assert(
      shell instanceof THREE.ShaderMaterial &&
        core instanceof THREE.ShaderMaterial,
    );
    assert(
      jets.every(
        (j) => j.material === shell && j.children[0].material === core,
      ),
    );
    model.fire(1, 2.5);
    assert.equal(shell.uniforms.uTime.value, 2.5);
    assert.equal(core.uniforms.uTime.value, 2.5);
    let triangles = 0;
    for (const j of jets)
      for (const mesh of [j, j.children[0]]) {
        const pos = mesh.geometry.getAttribute('position');
        assert(Array.from(pos.array).every(Number.isFinite));
        triangles += mesh.geometry.index.count / 3;
        assert.equal(mesh.castShadow, false);
        assert.equal(mesh.material.forceSinglePass, true);
      }
    assert(triangles <= 13000, 'all five detailed exhausts stay bounded');
    model.fire(0, 3.2);
    assert(jets.every((j) => !j.visible));
  } finally {
    disposeRocketObject(model.group);
  }
  for (const kind of ['small', 'large']) {
    const legacy = createRocketModel(kind);
    assert(legacy.flame.material instanceof THREE.MeshBasicMaterial);
    disposeRocketObject(legacy.group);
  }
});
