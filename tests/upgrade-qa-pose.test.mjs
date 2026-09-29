import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cityModule } from './helpers/city-modules.mjs';
const { clearQAOrbitMomentum, captureQAPose, qaPoseError } = await import(
  cityModule('upgrade-qa-pose')
);
test('a fixed capture drains residual orbit damping before a new pose', () => {
  const camera = new PerspectiveCamera();
  camera.position.set(70, 105, 115);
  const controls = new OrbitControls(camera);
  controls.enableDamping = true;
  controls.autoRotate = true;
  for (let i = 0; i < 30; i++) controls.update();
  controls.autoRotate = false;
  const before = captureQAPose(camera, controls);
  controls.update();
  assert(
    qaPoseError(camera, controls, before) > 0.05,
    'fixture must contain real residual momentum',
  );
  clearQAOrbitMomentum(controls);
  camera.position.set(70, 105, 115);
  controls.target.set(0, 16, 0);
  controls.update();
  const pose = captureQAPose(camera, controls);
  for (let i = 0; i < 300; i++) controls.update();
  assert(qaPoseError(camera, controls, pose) < 1e-8);
  assert.equal(controls.enableDamping, true);
  camera.position.x += 0.2;
  assert(qaPoseError(camera, controls, pose) > 0.19);
  camera.position.x -= 0.2;
  controls.target.z += 0.3;
  assert(qaPoseError(camera, controls, pose) > 0.29);
});
