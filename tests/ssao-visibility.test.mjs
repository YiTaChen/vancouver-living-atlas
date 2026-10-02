import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { cityModule } from './helpers/city-modules.mjs';
const { SSAOExclusions } = await import(cityModule('ssao-exclusions'));
const { installSSAOVisibility, supportsSSAOVisibilityContract } = await import(
  cityModule('ssao-visibility')
);
const { trackSSAOResources } = await import(cityModule('ssao-resources'));

function fixture() {
  const scene = new THREE.Scene();
  const opaque = new THREE.Mesh(),
    glass = new THREE.Mesh(),
    foliage = new THREE.Mesh();
  glass.material.transparent = true;
  glass.material.depthWrite = false;
  foliage.userData.alphaFoliage = true;
  const line = new THREE.Line(),
    points = new THREE.Points();
  const line2 = new THREE.Object3D();
  line2.isLine2 = true;
  const hidden = new THREE.Line();
  hidden.visible = false;
  const group = new THREE.Group();
  group.add(opaque, glass, foliage, line, points, line2, hidden);
  scene.add(group);
  const pass = new SSAOPass(scene, new THREE.PerspectiveCamera(), 64, 48, 8);
  const owner = new SSAOExclusions(scene);
  let traversals = 0;
  // Preserve method identity while calling it with the original receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const traverse = scene.traverse;
  scene.traverse = function (visit) {
    traversals++;
    return traverse.call(this, visit);
  };
  const draws = [];
  let fail = false;
  const renderer = {
    autoClear: true,
    getClearColor(value) {
      return value.set(0);
    },
    getClearAlpha() {
      return 1;
    },
    setRenderTarget(target) {
      this.target = target;
    },
    setClearColor() {},
    setClearAlpha() {},
    clear() {},
    render(object) {
      if (object === scene) {
        const visible = [];
        object.traverseVisible((child) => visible.push(child));
        draws.push({
          target: this.target,
          material: scene.overrideMaterial,
          visible,
        });
        if (fail) throw new Error('normal draw failed');
      } else draws.push({ target: this.target, material: object.material });
    },
  };
  const draw = () => {
    draws.length = 0;
    pass.render(renderer, null, null);
    return draws.slice();
  };
  const cleanup = () => {
    owner.dispose();
    trackSSAOResources(pass);
    pass.dispose();
    group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  };
  return {
    scene,
    group,
    opaque,
    glass,
    foliage,
    line,
    points,
    line2,
    hidden,
    pass,
    owner,
    renderer,
    draw,
    cleanup,
    scans: () => traversals,
    fail: (value) => {
      fail = value;
    },
  };
}

test('r185 behavioral probe leaves the live scene untouched and rejects changed revisions, hooks and caches', () => {
  const f = fixture(),
    p = f.pass;
  assert(supportsSSAOVisibilityContract(p));
  assert.equal(f.scans(), 0);
  assert(f.line.visible && f.points.visible && !f.hidden.visible);
  assert.equal(supportsSSAOVisibilityContract(p, '186'), false);
  const original = p._overrideVisibility;
  p._overrideVisibility = () => {};
  assert.equal(supportsSSAOVisibilityContract(p), false);
  p._overrideVisibility = () => {
    throw new Error('unexpected future contract');
  };
  assert.equal(supportsSSAOVisibilityContract(p), false);
  p._overrideVisibility = original;
  const restore = p._restoreVisibility;
  p._restoreVisibility = () => {};
  assert.equal(supportsSSAOVisibilityContract(p), false);
  p._restoreVisibility = restore;
  p._visibilityCache.push(f.line);
  assert.equal(supportsSSAOVisibilityContract(p), false);
  p._visibilityCache.length = 0;
  const prototype = Object.getPrototypeOf(p),
    stockOverride = prototype._overrideVisibility;
  delete p._overrideVisibility;
  try {
    prototype._overrideVisibility = () => {};
    assert.equal(
      supportsSSAOVisibilityContract(p),
      false,
      'behavior probe rejects a changed stock hook',
    );
  } finally {
    prototype._overrideVisibility = stockOverride;
  }
  f.cleanup();
});

test('normal/depth visibility and all full-screen submissions match exactly while redundant traversal is removed', () => {
  const f = fixture(),
    p = f.pass;
  // Compare exact method identity after restoring the adapter.
  // oxlint-disable-next-line typescript/unbound-method
  const originalRender = p.render,
    override = p._overrideVisibility,
    restore = p._restoreVisibility;
  let baseline;
  f.owner.render(() => {
    baseline = f.draw();
  });
  assert.equal(f.scans(), 1);
  const shaders = [
    p.normalMaterial,
    p.ssaoMaterial,
    p.blurMaterial,
    p.copyMaterial,
  ];
  const installation = installSSAOVisibility(p, f.owner);
  assert(installation.optimized);
  const candidate = f.draw();
  assert.deepEqual(candidate, baseline);
  assert.equal(
    candidate.length,
    4,
    'normal/depth, AO, blur and blend draws remain',
  );
  assert.equal(f.scans(), 1, 'optimized render does not scan scene again');
  assert.deepEqual(
    [p.normalMaterial, p.ssaoMaterial, p.blurMaterial, p.copyMaterial],
    shaders,
  );
  assert.strictEqual(p._overrideVisibility, override);
  assert.strictEqual(p._restoreVisibility, restore);
  assert(
    f.line.visible &&
      f.points.visible &&
      f.line2.visible &&
      f.glass.visible &&
      f.foliage.visible,
  );
  assert.equal(f.hidden.visible, false);
  installation.restore();
  installation.restore();
  assert(p.render === originalRender);
  f.owner.render(() => f.draw());
  assert.equal(f.scans(), 2);
  f.cleanup();
});

test('late nested add/remove/reparent and live vehicle fading keep exact exclusion ownership', () => {
  const f = fixture();
  const installation = installSSAOVisibility(f.pass, f.owner);
  const asset = new THREE.Group(),
    late = new THREE.Points(),
    vehicle = new THREE.Mesh();
  vehicle.userData.railVehicle = true;
  asset.add(late, vehicle);
  f.scene.add(asset);
  const normal = () => f.draw()[0].visible;
  assert(!normal().includes(late));
  assert(normal().includes(vehicle));
  vehicle.material.transparent = true;
  vehicle.material.depthWrite = false;
  assert(!normal().includes(vehicle));
  vehicle.material.transparent = false;
  vehicle.material.depthWrite = true;
  assert(normal().includes(vehicle));
  const before = f.owner.stats.watchedObjects;
  asset.removeFromParent();
  assert.equal(f.owner.stats.watchedObjects, before - 3);
  f.draw();
  assert(
    late.visible && vehicle.visible,
    'detached objects retain their visibility',
  );
  f.group.add(asset);
  assert.equal(f.owner.stats.watchedObjects, before);
  assert(!normal().includes(late));
  assert(normal().includes(vehicle));
  const ordinary = new THREE.Mesh();
  asset.add(ordinary);
  ordinary.material.transparent = true;
  ordinary.material.depthWrite = false;
  f.owner.refresh(ordinary);
  assert(!normal().includes(ordinary));
  installation.restore();
  f.cleanup();
});

test('failed draws restore hooks, exact visibility and override; disposal restores rendering and clears listeners', () => {
  const f = fixture(),
    p = f.pass;
  // Compare exact method identity after restoring the adapter.
  // oxlint-disable-next-line typescript/unbound-method
  const originalRender = p.render,
    override = p._overrideVisibility,
    restore = p._restoreVisibility;
  const priorMaterial = new THREE.MeshBasicMaterial();
  f.scene.overrideMaterial = priorMaterial;
  const installation = installSSAOVisibility(p, f.owner);
  trackSSAOResources(p).restores.add(() => {
    installation.restore();
    f.owner.dispose();
  });
  f.fail(true);
  assert.throws(f.draw, /normal draw failed/);
  assert.strictEqual(p._overrideVisibility, override);
  assert.strictEqual(p._restoreVisibility, restore);
  assert.strictEqual(f.scene.overrideMaterial, priorMaterial);
  assert(
    f.line.visible && f.points.visible && f.glass.visible && !f.hidden.visible,
  );
  assert.equal(p._visibilityCache.length, 0);
  f.fail(false);
  f.draw();
  p.dispose();
  p.dispose();
  assert(p.render === originalRender);
  assert.equal(f.owner.stats.watchedObjects, 0);
  f.scene.add(new THREE.Object3D());
  assert.equal(f.owner.stats.watchedObjects, 0);
  priorMaterial.dispose();
  f.cleanup();
});

test('incompatible hooks gracefully retain upstream work, and later hook changes bypass suppression', () => {
  for (const changedAfterInstall of [false, true]) {
    const f = fixture(),
      p = f.pass,
      original = p._overrideVisibility;
    const changed = function () {
      original.call(this);
      this.extraHookWork = true;
    };
    // The probe detects additional required state via a deliberately unsupported restore contract.
    const originalRestore = p._restoreVisibility;
    const unsupported = function () {
      originalRestore.call(this);
      if (!this.camera) throw new Error('new required state');
    };
    if (!changedAfterInstall) p._restoreVisibility = unsupported;
    const installation = installSSAOVisibility(p, f.owner);
    assert.equal(installation.optimized, changedAfterInstall);
    if (changedAfterInstall) p._overrideVisibility = changed;
    f.draw();
    assert.equal(
      f.scans(),
      1,
      'fallback still invokes real upstream traversal',
    );
    assert(f.line.visible && f.glass.visible && !f.hidden.visible);
    if (changedAfterInstall) {
      assert(p.extraHookWork);
      assert.strictEqual(p._overrideVisibility, changed);
    }
    installation.restore();
    f.cleanup();
  }
});

test('restoring beneath a later wrapper preserves that wrapper and bypasses the disposed owner', () => {
  const f = fixture(),
    p = f.pass;
  const installation = installSSAOVisibility(p, f.owner);
  const installed = p.render.bind(p);
  const later = (...args) => installed(...args);
  p.render = later;
  installation.restore();
  f.owner.dispose();
  assert(p.render === later);
  f.draw();
  assert.equal(
    f.scans(),
    1,
    'retained callback returns to upstream visibility ownership',
  );
  assert(f.line.visible && f.points.visible && !f.hidden.visible);
  f.cleanup();
});
