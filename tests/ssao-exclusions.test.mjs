import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { SSAOExclusions } = await import(cityModule('ssao-exclusions'));
const mesh = (transparent = false) =>
  new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ transparent, depthWrite: !transparent }),
  );
const clear = (scene) =>
  scene.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });

test('late nested glass and foliage are excluded while opaque PBR materials keep AO and prior visibility', () => {
  const scene = new THREE.Scene(),
    owner = new SSAOExclusions(scene);
  const asset = new THREE.Group(),
    opaque = mesh(),
    glass = mesh(true),
    hidden = mesh(true),
    foliage = mesh();
  hidden.visible = false;
  foliage.userData.alphaFoliage = true;
  asset.add(opaque, glass, hidden);
  scene.add(asset);
  asset.add(foliage);
  assert.equal(owner.stats.candidates, 3);
  assert.equal(owner.stats.watchedObjects, 6);
  owner.render(() => {
    assert(opaque.visible);
    assert(!glass.visible && !hidden.visible && !foliage.visible);
  });
  assert(opaque.visible && glass.visible && foliage.visible);
  assert.equal(hidden.visible, false);
  assert.equal(owner.stats.hiddenLastPass, 2);
  owner.dispose();
  clear(scene);
});

test('vehicle fading and explicit post-attachment material refresh follow the current exclusion policy', () => {
  const scene = new THREE.Scene(),
    vehicle = mesh(),
    ordinary = mesh();
  vehicle.userData.railVehicle = true;
  scene.add(vehicle, ordinary);
  const owner = new SSAOExclusions(scene);
  owner.render(() => assert(vehicle.visible));
  vehicle.material.transparent = true;
  vehicle.material.depthWrite = false;
  ordinary.material.transparent = true;
  ordinary.material.depthWrite = false;
  owner.refresh(ordinary);
  owner.render(() => assert(!vehicle.visible && !ordinary.visible));
  vehicle.material.transparent = false;
  vehicle.material.depthWrite = true;
  owner.render(() => assert(vehicle.visible && !ordinary.visible));
  owner.dispose();
  clear(scene);
});

test('AO failures restore exact visibility/scene override and removed assets release listeners and references', () => {
  const scene = new THREE.Scene(),
    group = new THREE.Group(),
    glass = mesh(true);
  group.add(glass);
  scene.add(group);
  const owner = new SSAOExclusions(scene),
    override = new THREE.MeshBasicMaterial();
  scene.overrideMaterial = override;
  assert.throws(
    () =>
      owner.render(() => {
        assert.equal(glass.visible, false);
        scene.overrideMaterial = new THREE.MeshNormalMaterial();
        scene.overrideMaterial.dispose();
        throw new Error('simulated draw failure');
      }),
    /simulated draw failure/,
  );
  assert.equal(glass.visible, true);
  assert.strictEqual(scene.overrideMaterial, override);
  group.removeFromParent();
  assert.equal(owner.stats.candidates, 0);
  assert.equal(owner.stats.watchedObjects, 1);
  const late = mesh(true);
  group.add(late);
  assert.equal(owner.stats.candidates, 0);
  scene.add(group);
  assert.equal(owner.stats.candidates, 2);
  owner.dispose();
  owner.dispose();
  const after = mesh(true);
  scene.add(after);
  assert.deepEqual(owner.stats, {
    watchedObjects: 0,
    candidates: 0,
    hiddenLastPass: 0,
  });
  clear(scene);
  override.dispose();
});

test('failed normal passes restore line and point visibility owned by SSAOPass as well', () => {
  const scene = new THREE.Scene(),
    line = new THREE.Line(),
    points = new THREE.Points(),
    line2 = new THREE.Object3D(),
    hidden = new THREE.Line();
  line2.isLine2 = true;
  hidden.visible = false;
  scene.add(line, points, line2, hidden);
  const owner = new SSAOExclusions(scene);
  assert.throws(
    () =>
      owner.render(() => {
        assert(
          !line.visible && !points.visible && !line2.visible && !hidden.visible,
        );
        throw new Error('failed normal pass');
      }),
    /failed normal pass/,
  );
  assert(line.visible && points.visible && line2.visible);
  assert.equal(hidden.visible, false);
  owner.dispose();
  clear(scene);
});
