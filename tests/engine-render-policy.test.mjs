import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

// Execute the integrated engine methods, not a second implementation of the
// wiring. Three's real lights and SSAOPass run without a browser/WebGL context.
const source = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'engine.ts',
  source,
  ts.ScriptTarget.Latest,
  true,
);
const engine = ast.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
);
const names = [
  'updateShadowFrustum',
  'ensureSSAO',
  'applySettings',
  'updateLighting',
];
const methods = engine.members
  .filter(
    (node) =>
      ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast)),
  )
  .map((node) => node.getText(ast));
assert.equal(methods.length, names.length);
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  import {SSAOPass} from '${import.meta.resolve('three/addons/postprocessing/SSAOPass.js')}';
  import {shadowCoverage, SHADOW_DEPTH} from '${cityModule('shadow-policy')}';
  import {SSAOExclusions} from '${cityModule('ssao-exclusions')}';
  import {trackSSAOResources} from '${cityModule('ssao-resources')}';
  import {installSSAOBlur4} from '${cityModule('ssao-blur4')}';
  import {sunAngle} from '${cityModule('clock')}';
  export class EngineMethods {${methods.join('\n')}}
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { EngineMethods } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

function fixture() {
  const e = Object.assign(new EngineMethods(), {
    settings: {
      mode: 'orbit',
      quality: 'high',
      buildings: true,
      trees: true,
      traffic: true,
      autoRotate: false,
    },
    compatibleGraphics: false,
    shadowCoverageState: null,
    ssao: null,
    aoExclusions: null,
    clock: { hour: 14 },
    lastLightHour: -1,
    lastLightUpdate: 0,
    lastShadowHour: -1,
    lastSolarShadowUpdate: 0,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(1428, 28, 135) },
    sun: new THREE.DirectionalLight(),
    ambient: new THREE.HemisphereLight(),
    sky: {
      material: { uniforms: { sunPosition: { value: new THREE.Vector3() } } },
    },
    uniforms: { night: { value: 0 } },
    data: {},
    buildings: new THREE.Group(),
    vegetation: new THREE.Group(),
    landmarks: new THREE.Group(),
    trafficGroup: new THREE.Group(),
    renderer: { shadowMap: { needsUpdate: false, enabled: true } },
    container: { clientWidth: 800, clientHeight: 600 },
    composer: {
      passes: [],
      insertPass(pass, index) {
        this.passes.splice(index, 0, pass);
      },
    },
    pixelRatio: () => 1,
    resizeQuality() {
      this.sun.shadow.mapSize.setScalar(
        this.settings.quality === 'ultra' ? 4096 : 2048,
      );
    },
    navigation: { setMode() {} },
  });
  e.camera.position.copy(e.controls.target).add(new THREE.Vector3(0, 100, 100));
  e.sun.shadow.mapSize.setScalar(2048);
  e.scene.add(e.sun, e.sun.target);
  return e;
}
const direction = (e) => e.sun.position.clone().sub(e.sun.target.position);
const sameVector = (a, b) =>
  assert(a.distanceTo(b) < 1e-8, `${a.toArray()} != ${b.toArray()}`);

test('integrated High/Ultra policy preserves lighting direction and cached maps across movement, solar refresh and mode changes', () => {
  const e = fixture();
  e.applySettings(e.settings);
  const first = e.shadowCoverageState;
  assert.equal(first.extent, 160);
  sameVector(direction(e), e.sky.material.uniforms.sunPosition.value);
  assert.equal(e.sun.shadow.mapSize.x, 2048);
  e.renderer.shadowMap.needsUpdate = false;
  e.updateShadowFrustum();
  assert.equal(
    e.renderer.shadowMap.needsUpdate,
    false,
    'stationary view reuses its cached shadow map',
  );
  assert.strictEqual(e.shadowCoverageState.anchor, first.anchor);
  e.controls.target.x += 1;
  e.updateShadowFrustum();
  assert.equal(
    e.renderer.shadowMap.needsUpdate,
    false,
    'small movement stays in the cached coverage margin',
  );
  e.controls.target.x += 100;
  const sun = direction(e);
  e.updateShadowFrustum();
  assert.equal(e.renderer.shadowMap.needsUpdate, true);
  sameVector(direction(e), sun);
  const center = e.shadowCoverageState.center;
  e.clock.hour = 15;
  e.updateLighting(true, 1000);
  e.updateShadowFrustum();
  assert.deepEqual(e.shadowCoverageState.center, center);
  sameVector(direction(e), e.sky.material.uniforms.sunPosition.value);
  e.applySettings({ ...e.settings, mode: 'walk', quality: 'ultra' });
  assert.equal(e.sun.shadow.camera.right, 170);
  assert.equal(e.sun.shadow.mapSize.x, 4096);
  assert(e.sun.shadow.normalBias <= 0.3);
  sameVector(direction(e), e.sky.material.uniforms.sunPosition.value);
  e.applySettings({ ...e.settings, mode: 'orbit' });
  e.camera.position.copy(e.controls.target).add(new THREE.Vector3(3800, 0, 0));
  e.updateShadowFrustum();
  assert.equal(e.sun.shadow.camera.right, 2700);
  sameVector(e.sun.target.position, new THREE.Vector3());
  sameVector(direction(e), e.sky.material.uniforms.sunPosition.value);
});

test('Balanced and compatible rendering do not enter adaptive shadow or AO setup', () => {
  for (const compatible of [false, true]) {
    const e = fixture();
    e.compatibleGraphics = compatible;
    if (!compatible) e.settings.quality = 'balanced';
    e.updateShadowFrustum();
    assert.equal(e.shadowCoverageState, null);
    assert.equal(e.renderer.shadowMap.needsUpdate, false);
    if (compatible) {
      e.ensureSSAO();
      assert.equal(e.ssao, null);
    }
  }
});

test('changing grazing sunlight retains cached slope bias until a scheduled shadow refresh', () => {
  const e = fixture();
  e.clock.hour = 19;
  e.applySettings(e.settings);
  const first = e.shadowCoverageState;
  e.renderer.shadowMap.needsUpdate = false;
  e.clock.hour += 0.0005;
  e.updateLighting(false, 50);
  e.updateShadowFrustum();
  assert.equal(e.renderer.shadowMap.needsUpdate, false);
  assert.equal(e.shadowCoverageState.bias, first.bias);
  assert.equal(e.shadowCoverageState.normalBias, first.normalBias);
  e.updateLighting(true, 1000);
  e.updateShadowFrustum();
  assert.equal(e.renderer.shadowMap.needsUpdate, true);
  assert.notEqual(e.shadowCoverageState.bias, first.bias);
});

test('integrated real SSAOPass wrapper sees late GLB-like glass, restores draw failures and releases its membership listeners on disposal', () => {
  const e = fixture();
  e.ensureSSAO();
  const pass = e.ssao,
    owner = e.aoExclusions;
  e.ensureSSAO();
  assert.strictEqual(e.ssao, pass);
  assert.equal(e.composer.passes.length, 1);
  const asset = new THREE.Group();
  const opaque = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false }),
  );
  const line = new THREE.Line();
  asset.add(opaque, glass, line);
  e.scene.add(asset);
  const override = new THREE.MeshBasicMaterial();
  e.scene.overrideMaterial = override;
  const renderer = {
    autoClear: true,
    getClearColor(value) {
      return value.set(0);
    },
    getClearAlpha() {
      return 1;
    },
    setRenderTarget() {},
    setClearColor() {},
    setClearAlpha() {},
    clear() {},
    render(scene) {
      assert.strictEqual(scene.overrideMaterial, pass.normalMaterial);
      assert(opaque.visible);
      assert(!glass.visible && !line.visible);
      throw new Error('normal draw failed');
    },
  };
  assert.throws(() => pass.render(renderer, null, null), /normal draw failed/);
  assert(glass.visible && line.visible && opaque.visible);
  assert.strictEqual(e.scene.overrideMaterial, override);
  pass.dispose();
  assert.equal(owner.stats.watchedObjects, 0);
  asset.add(new THREE.Object3D());
  assert.equal(owner.stats.watchedObjects, 0);
  owner.dispose();
  asset.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  override.dispose();
});
