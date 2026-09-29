import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cityModule } from './helpers/city-modules.mjs';
const {
  MODERN_BAY_QA_VIEWS,
  modernBayQAState,
  selectModernBayQA,
  restoreModernBayQA,
} = await import(cityModule('modern-bay-qa'));
test('modern QA only becomes ready for the expected visible instance primitives', () => {
  const view = MODERN_BAY_QA_VIEWS[0],
    group = new THREE.Group(),
    page = new THREE.Group();
  group.add(page);
  const host = {
    streetscapeKit: {
      group,
      snapshot: () => ({ loaded: true, failed: false }),
    },
  };
  assert.equal(
    modernBayQAState(host, view.id).ready,
    false,
    'global kit readiness is insufficient',
  );
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      1,
    );
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(...view.position));
    page.add(mesh);
  }
  page.visible = false;
  assert.equal(
    modernBayQAState(host, view.id).ready,
    false,
    'cached invisible page cannot satisfy readiness',
  );
  page.visible = true;
  assert.equal(modernBayQAState(host, view.id).ready, true);
  assert.equal(
    modernBayQAState(host, MODERN_BAY_QA_VIEWS[1].id).ready,
    false,
    'another bay cannot satisfy this source view',
  );
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      o.material.dispose();
      o.dispose();
    }
  });
});

test('modern close-view selection drains real orbit momentum and retains its fixed pose', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(70, 105, 115);
  const controls = new OrbitControls(camera);
  controls.minDistance = 28;
  controls.enableDamping = true;
  controls.autoRotate = true;
  for (let i = 0; i < 30; i++) controls.update();
  controls.autoRotate = false;
  const before = camera.position.clone();
  controls.update();
  assert.ok(
    camera.position.distanceTo(before) > 0.05,
    'fixture has real damping',
  );
  const host = {
    camera,
    controls,
    settings: { quality: 'high' },
    data: { buildings: { features: [{ properties: { id: '140475' } }] } },
    streetscapeKit: {},
    navigation: { keys: new Set(), setMode() {} },
    applySettings(settings) {
      this.settings = settings;
      controls.autoRotate = settings.autoRotate;
    },
    setClock() {},
    ensureSSAO() {},
    onLand: () => false,
    elevation: () => {
      throw new Error('non-land view must not sample a land minimum');
    },
    renderer: { setPixelRatio() {}, setSize() {}, shadowMap: {} },
  };
  const selected = selectModernBayQA(host, 'west-end-modern-bay');
  const intended = new THREE.Vector3(...MODERN_BAY_QA_VIEWS[0].camera);
  assert.ok(
    camera.position.distanceTo(intended) < 1e-8,
    '28m normal minimum must not silently alter the QA pose',
  );
  for (let i = 0; i < 300; i++) controls.update();
  assert.ok(
    camera.position.distanceTo(
      new THREE.Vector3(...selected.expectedPose.camera),
    ) < 1e-8,
  );
  assert.ok(
    controls.target.distanceTo(
      new THREE.Vector3(...selected.expectedPose.target),
    ) < 1e-8,
  );
  assert.equal(controls.enableDamping, true);
  restoreModernBayQA(host);
  assert.equal(
    controls.minDistance,
    28,
    'normal orbit input limit is restored',
  );
});

test('modern QA freezes a terrain-safe orbit pose without moving its horizontal setback or target', () => {
  for (const view of MODERN_BAY_QA_VIEWS) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(70, 105, 115);
    const controls = new OrbitControls(camera);
    controls.minDistance = 28;
    controls.enableDamping = true;
    const samples = [];
    const host = {
      camera,
      controls,
      settings: { quality: 'high' },
      data: {
        buildings: { features: [{ properties: { id: view.sourceId } }] },
      },
      streetscapeKit: {},
      navigation: { keys: new Set(), setMode() {} },
      applySettings(settings) {
        this.settings = settings;
        controls.autoRotate = settings.autoRotate;
      },
      setClock() {},
      ensureSSAO() {},
      onLand: () => true,
      elevation(x, z) {
        samples.push([x, z]);
        return (
          view.camera[1] +
          2 +
          0.08 * (x - view.camera[0]) -
          0.05 * (z - view.camera[2])
        );
      },
      renderer: { setPixelRatio() {}, setSize() {}, shadowMap: {} },
    };
    const selected = selectModernBayQA(host, view.id);
    assert.deepEqual(
      samples[0],
      [view.camera[0], view.camera[2]],
      'guard uses camera terrain, not facade threshold',
    );
    assert.ok(Math.abs(camera.position.x - view.camera[0]) < 1e-8);
    assert.ok(Math.abs(camera.position.z - view.camera[2]) < 1e-8);
    assert.ok(Math.abs(camera.position.y - (view.camera[1] + 6)) < 1e-8);
    assert.ok(
      controls.target.distanceTo(new THREE.Vector3(...view.target)) < 1e-8,
    );
    assert.equal(selected.groundMinimumY, view.camera[1] + 6);
    for (let i = 0; i < 300; i++) {
      controls.update();
      if (host.onLand(camera.position.x, camera.position.z))
        camera.position.y = Math.max(
          camera.position.y,
          host.elevation(camera.position.x, camera.position.z) + 4,
        );
    }
    assert.ok(
      camera.position.distanceTo(
        new THREE.Vector3(...selected.expectedPose.camera),
      ) < 1e-8,
      'normal engine orbit guard must not introduce capture drift',
    );
    restoreModernBayQA(host);
  }
});
