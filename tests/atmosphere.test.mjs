import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { cityModule } from './helpers/city-modules.mjs';

const {
  sampleAtmosphere, normalizeAtmosphere, installAtmosphereSky,
  applyAtmosphereSky, ATMOSPHERE_ENV_SIZE, ATMOSPHERE_ENV_LIMIT,
} = await import(cityModule('atmosphere'));
const { installArchitectureSurface } = await import(cityModule('architecture-material'));
const { SkyEffects } = await import(cityModule('sky-effects'));
const colorKeys = ['horizon', 'zenith', 'hemisphereSky', 'hemisphereGround', 'sunColor'];

function sameColor(a, b, tolerance = 1e-9) {
  assert(a.toArray().every((v, i) => Math.abs(v - b.toArray()[i]) < tolerance));
}

test('coastal palettes remain finite and continuous across dawn, sunset and midnight in either weather', () => {
  assert.equal(normalizeAtmosphere('rain'), 'clear');
  assert.equal(normalizeAtmosphere(undefined), 'clear');
  for (const mode of ['clear', 'overcast']) {
    for (let hour = 0; hour <= 24; hour += 0.05) {
      const state = sampleAtmosphere(hour, mode);
      for (const key of colorKeys) {
        assert(state[key].toArray().every(v => Number.isFinite(v) && v >= 0 && v <= 1));
      }
      for (const value of Object.values(state)) {
        if (typeof value === 'number') assert(Number.isFinite(value));
      }
      assert(state.sunIntensity >= 0 && state.ambientIntensity > 0);
      assert(state.night >= 0 && state.night <= 1);
      assert(state.skyMix >= 0 && state.skyMix <= 1);
    }
    for (const hour of [0, 6, 20.5, 24]) {
      const before = sampleAtmosphere(hour - 1e-7, mode),
        after = sampleAtmosphere(hour + 1e-7, mode);
      for (const key of colorKeys) sameColor(before[key], after[key], 0.001);
      assert(Math.abs(before.sunIntensity - after.sunIntensity) < 0.001);
    }
    assert.deepEqual(sampleAtmosphere(NaN, mode), sampleAtmosphere(16, mode));
    assert.deepEqual(sampleAtmosphere(Infinity, mode), sampleAtmosphere(16, mode));
  }
});

test('overcast trades direct sunlight for diffuse light and haze without turning daytime into night', () => {
  const clear = sampleAtmosphere(13.25), overcast = sampleAtmosphere(13.25, 'overcast');
  assert(overcast.sunIntensity < clear.sunIntensity * 0.3);
  assert(overcast.ambientIntensity > clear.ambientIntensity);
  assert(overcast.fogDensity > clear.fogDensity);
  assert(overcast.cloudCoverage > clear.cloudCoverage);
  assert.equal(overcast.night, clear.night);
  assert.equal(clear.night, 0);
  assert.equal(sampleAtmosphere(23).night, 1);
  assert.equal(sampleAtmosphere(23).environmentPhase, 'night');
  assert.equal(sampleAtmosphere(19.8).environmentPhase, 'twilight');
  assert.equal(clear.environmentPhase, 'day');
});

test('the installed Three sky and facade uniforms share the palette through day, overcast and night', () => {
  const sky = new Sky();
  installAtmosphereSky(sky);
  const source = sky.material.fragmentShader;
  installAtmosphereSky(sky);
  assert.equal(sky.material.fragmentShader, source, 'installation is idempotent');
  assert(source.includes('texColor = mix(texColor, atlasVault, atlasSkyMix)'));
  const atmosphere = {
    skyHorizon: { value: new THREE.Color() },
    skyZenith: { value: new THREE.Color() },
  };
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  installArchitectureSurface(shader, atmosphere);
  assert.equal(shader.uniforms.uAtlasSkyHorizon, atmosphere.skyHorizon);
  assert.equal(shader.uniforms.uAtlasSkyZenith, atmosphere.skyZenith);
  assert(shader.fragmentShader.includes('uniform vec3 uAtlasSkyHorizon, uAtlasSkyZenith;'),
    'palette uniforms must be declared in the shader stage which uses them');
  for (const [hour, mode] of [[14, 'clear'], [14, 'overcast'], [19.8, 'clear'], [23, 'clear']]) {
    const state = sampleAtmosphere(hour, mode);
    atmosphere.skyHorizon.value.copy(state.horizon);
    atmosphere.skyZenith.value.copy(state.zenith);
    applyAtmosphereSky(sky, state);
    sameColor(sky.material.uniforms.atlasHorizon.value, shader.uniforms.uAtlasSkyHorizon.value);
    sameColor(sky.material.uniforms.atlasZenith.value, shader.uniforms.uAtlasSkyZenith.value);
    assert.equal(sky.material.uniforms.cloudCoverage.value, state.cloudCoverage);
    assert.equal(sky.material.uniforms.showSunDisc.value, false, 'existing SkyEffects owns the sun disc');
  }
  sky.geometry.dispose();
  sky.material.dispose();
});

test('clear night retains moon, stars and aurora; weather attenuates effects while user toggles retain authority', () => {
  const scene = new THREE.Scene(), effects = new SkyEffects(scene), camera = new THREE.PerspectiveCamera();
  effects.configure({ auroraMode: 'always', aurora: true, moon: true, stars: true });
  effects.atmosphereVisibility = sampleAtmosphere(23).celestialVisibility;
  effects.update(23, 0, 1000, camera);
  const dome = effects.group.children.find(o => o.isMesh),
    stars = effects.group.children.find(o => o.isPoints),
    u = dome.material.uniforms;
  assert.equal(u.moonOn.value, 1);
  assert(u.aurora.value > 0 && stars.visible);
  const clearAurora = u.aurora.value, clearStars = stars.material.uniforms.night.value;
  effects.atmosphereVisibility = sampleAtmosphere(23, 'overcast').celestialVisibility;
  effects.update(23, 0, 1000, camera);
  assert(u.moonOn.value > 0 && u.moonOn.value < 1);
  assert(u.aurora.value < clearAurora);
  assert(stars.material.uniforms.night.value < clearStars);
  assert.equal(u.meteors.value, 0);
  effects.configure({ moon: false, stars: false, aurora: false, sun: false });
  effects.update(23, 0, 1000, camera);
  assert.equal(u.moonOn.value, 0);
  assert.equal(u.aurora.value, 0);
  assert.equal(u.sunOn.value, 0);
  assert.equal(stars.visible, false);
  effects.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});

// Exercise the real cache and snapshot preparation. Only the GPU-backed PMREM
// conversion is replaced; Three's actual Sky, uniforms, cloning and render targets run.
const moduleURL = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const fakeThree = moduleURL(`
  export * from ${JSON.stringify(import.meta.resolve('three'))};
  import { WebGLRenderTarget } from ${JSON.stringify(import.meta.resolve('three'))};
  export class PMREMGenerator {
    constructor() { globalThis.__atmosphereCache.created++; }
    fromScene(scene, sigma, near, far, options) {
      const f = globalThis.__atmosphereCache;
      f.snapshots.push({ scene, sigma, near, far, options });
      scene.children[0].material.addEventListener('dispose', () => f.materialDisposals++);
      if (f.fail) throw new Error('GPU snapshot failed');
      const target = new WebGLRenderTarget(3 * options.size, 4 * options.size);
      target.addEventListener('dispose', () => f.disposals.set(target, (f.disposals.get(target) || 0) + 1));
      f.targets.push(target);
      return target;
    }
    dispose() { globalThis.__atmosphereCache.generatorDisposals++; }
  }
`);
const cacheSource = readFileSync(new URL('../lib/city/atmosphere.ts', import.meta.url), 'utf8')
  .replace("from 'three'", `from '${fakeThree}'`)
  .replace("from './clock'", `from '${cityModule('clock')}'`);
const { AtmosphereEnvironment } = await import(moduleURL(ts.transpileModule(cacheSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText));

test('environment snapshots use 128-pixel faces, a three-entry LRU, failure-safe replacement and complete disposal', () => {
  const f = globalThis.__atmosphereCache = {
    created: 0, generatorDisposals: 0, materialDisposals: 0,
    fail: false, targets: [], snapshots: [], disposals: new Map(),
  };
  const sky = new Sky();
  installAtmosphereSky(sky);
  applyAtmosphereSky(sky, sampleAtmosphere(16));
  const original = sky.material.uniforms.atlasHorizon.value.clone();
  const cache = new AtmosphereEnvironment({}, sky);
  try {
    const day = cache.get('clear', 'day'), dusk = cache.get('clear', 'twilight');
    cache.get('clear', 'night');
    assert.equal(f.created, ATMOSPHERE_ENV_LIMIT);
    assert.equal(cache.get('clear', 'day'), day, 'ordinary lighting ticks reuse the target');
    cache.get('overcast', 'day');
    assert.equal(f.disposals.get(dusk), 1, 'least recently used snapshot is released');
    assert.equal(f.disposals.get(day), undefined, 'recently used snapshot is retained');
    sameColor(sky.material.uniforms.atlasHorizon.value, original);
    for (const snapshot of f.snapshots) {
      assert.equal(snapshot.options.size, ATMOSPHERE_ENV_SIZE);
      assert.equal(snapshot.options.size, 128);
      assert.equal(snapshot.scene.children[0].geometry, sky.geometry, 'temporary snapshot shares geometry');
      assert.notEqual(snapshot.scene.children[0].material, sky.material);
    }
    f.fail = true;
    assert.throws(() => cache.get('overcast', 'night'), /GPU snapshot failed/);
    assert.equal(cache.get('clear', 'day'), day, 'failed generation retains the usable environment');
    assert.equal(f.disposals.get(day), undefined);
    assert.equal(f.materialDisposals, f.created);
    assert.equal(f.generatorDisposals, f.created);
    cache.dispose();
    cache.dispose();
    for (const target of f.targets) assert.equal(f.disposals.get(target), 1);
    assert.throws(() => cache.get('clear', 'day'), /disposed/);
  } finally {
    cache.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    delete globalThis.__atmosphereCache;
  }
});
