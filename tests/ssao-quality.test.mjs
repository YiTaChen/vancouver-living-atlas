import { cityModule } from './helpers/city-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
const { installSSAOBlur4 } = await import(cityModule('ssao-blur4'));
const { trackSSAOResources } = await import(cityModule('ssao-resources'));
const create = () =>
  new SSAOPass(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(50, 1, 2, 45000),
    64,
    48,
    8,
  );

test('blur candidate changes only centered tap range/divisor, restores and rejects changed source', () => {
  const pass = create(),
    original = pass.blurMaterial.fragmentShader,
    restore = installSSAOBlur4(pass);
  const shader = pass.blurMaterial.fragmentShader;
  assert.match(shader, /i < 2/);
  assert.match(shader, /j < 2/);
  assert.match(shader, /vec2\( 0\.5 \)/);
  assert.match(shader, /4\.0 \* 4\.0/);
  assert.throws(() => installSSAOBlur4(pass), /shader changed/);
  restore();
  restore();
  assert.equal(pass.blurMaterial.fragmentShader, original);
  pass.dispose();
});

test('centered 4x4 bilinear blur cancels every phase of a 4x4 field; existing 5x5 does not', () => {
  const field = [
    1, 0, 0.3, 0.1, 0.2, 0.8, 0.4, 0.7, 0.5, 0.2, 1, 0.1, 0.7, 0.3, 0.8, 0.6,
  ];
  const at = (x, y) => field[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)];
  function sample(x, y) {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      u = x - ix,
      v = y - iy;
    return (
      at(ix, iy) * (1 - u) * (1 - v) +
      at(ix + 1, iy) * u * (1 - v) +
      at(ix, iy + 1) * (1 - u) * v +
      at(ix + 1, iy + 1) * u * v
    );
  }
  const mean = field.reduce((a, b) => a + b, 0) / 16,
    previous = [],
    candidate = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      let a = 0,
        b = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) a += sample(x + i, y + j) / 25;
      for (let j = -2; j < 2; j++)
        for (let i = -2; i < 2; i++) b += sample(x + i + 0.5, y + j + 0.5) / 16;
      previous.push(a);
      candidate.push(b);
      assert.ok(Math.abs(b - mean) < 1e-12);
    }
  assert.ok(Math.max(...previous) - Math.min(...previous) > 0.01);
  console.log(
    JSON.stringify({
      idealPeriodicField: {
        sourceMean: mean,
        original5x5Range: Math.max(...previous) - Math.min(...previous),
        centered4x4Range: Math.max(...candidate) - Math.min(...candidate),
        originalFetches: 25,
        candidateFetches: 16,
      },
    }),
  );
});

test('independent resource fix leaves all shaders and textures unchanged, works alone or with the selected blur candidate', () => {
  for (const blur of [false, true]) {
    const pass = create(),
      shader = pass.ssaoMaterial.fragmentShader,
      blur = pass.blurMaterial.fragmentShader,
      noise = pass.noiseTexture;
    let noises = 0,
      materials = 0,
      targets = 0;
    noise.addEventListener('dispose', () => noises++);
    pass.ssaoMaterial.addEventListener('dispose', () => materials++);
    pass.normalRenderTarget.addEventListener('dispose', () => targets++);
    const owner = trackSSAOResources(pass);
    assert.equal(trackSSAOResources(pass), owner);
    assert.equal(pass.ssaoMaterial.fragmentShader, shader);
    assert.equal(pass.blurMaterial.fragmentShader, blur);
    assert.equal(pass.noiseTexture, noise);
    assert.equal(pass.ssaoMaterial.uniforms.tNoise.value, noise);
    if (blur) installSSAOBlur4(pass);
    pass.dispose();
    pass.dispose();
    assert.deepEqual([noises, materials, targets], [1, 1, 1]);
  }
});
