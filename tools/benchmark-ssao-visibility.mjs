#!/usr/bin/env node
/** CPU-only synthetic benchmark. No browser, WebGL, shader or GPU timing. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { cityModule } from '../tests/helpers/city-modules.mjs';
const { SSAOExclusions } = await import(cityModule('ssao-exclusions'));
const { installSSAOVisibility } = await import(cityModule('ssao-visibility'));
const { trackSSAOResources } = await import(cityModule('ssao-resources'));
const option = (name, fallback) => {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  const value = arg ? Number(arg.split('=')[1]) : fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid ${name}`);
  return value;
};
const iterations = option('iterations', 2000),
  rounds = option('rounds', 12);
const sourcePath = 'docs/visual-quality/material-pipeline/measurements.json';
const measurements = JSON.parse(
  readFileSync(new URL(`../${sourcePath}`, import.meta.url), 'utf8'),
);
const scale = measurements.finalCaptures['high-citizen'].ssaoExclusions;
const scene = new THREE.Scene();
const geometry = new THREE.BufferGeometry();
const opaque = new THREE.MeshBasicMaterial();
const transparent = new THREE.MeshBasicMaterial({
  transparent: true,
  depthWrite: false,
});
const parents = Array.from({ length: 27 }, () => new THREE.Group());
scene.add(...parents);
for (let i = 0; i < scale.watchedObjects - parents.length - 1; i++) {
  let object;
  if (i < scale.candidates) {
    switch (i % 5) {
      case 0:
        object = new THREE.Points(geometry, opaque);
        break;
      case 1:
        object = new THREE.Line(geometry, opaque);
        break;
      case 2:
        object = new THREE.Mesh(geometry, transparent);
        break;
      case 3:
        object = new THREE.Mesh(geometry, opaque);
        object.userData.alphaFoliage = true;
        break;
      default:
        object = new THREE.Object3D();
        object.isLine2 = true;
    }
    object.visible = i < scale.hiddenLastPass;
  } else object = new THREE.Mesh(geometry, opaque);
  parents[i % parents.length].add(object);
}
const pass = new SSAOPass(scene, new THREE.PerspectiveCamera(), 64, 48, 8);
const exclusions = new SSAOExclusions(scene);
assert.equal(exclusions.stats.watchedObjects, scale.watchedObjects);
assert.equal(exclusions.stats.candidates, scale.candidates);
let draws = 0;
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
  render() {
    draws++;
  },
};
// Preserve the original method and always call it with pass as its receiver.
// oxlint-disable-next-line typescript/unbound-method
const originalRender = pass.render;
const baseline = () =>
  exclusions.render(() => originalRender.call(pass, renderer, null, null));
const install = installSSAOVisibility(pass, exclusions);
assert(
  install.optimized,
  'Benchmark requires the supported r185 private-hook contract',
);
const candidate = () => pass.render(renderer, null, null);
// Count algorithmic work separately so per-visit instrumentation cannot inflate timings.
// Preserve exact traversal for restoration; invocation below supplies the receiver.
// oxlint-disable-next-line typescript/unbound-method
const traverse = scene.traverse;
let visits = 0;
scene.traverse = function (visit) {
  return traverse.call(this, (object) => {
    visits++;
    visit(object);
  });
};
baseline();
const baselineVisits = visits,
  baselineDraws = draws;
visits = draws = 0;
candidate();
const candidateVisits = visits,
  candidateDraws = draws;
scene.traverse = traverse;
assert.equal(baselineVisits, scale.watchedObjects);
assert.equal(candidateVisits, 0);
assert.equal(baselineDraws, candidateDraws);
assert.equal(exclusions.stats.hiddenLastPass, scale.hiddenLastPass);
for (let i = 0; i < 1000; i++) {
  baseline();
  candidate();
}
const timed = (draw) => {
  const started = performance.now();
  for (let i = 0; i < iterations; i++) draw();
  return (performance.now() - started) / iterations;
};
const samples = [];
for (let round = 0; round < rounds; round++) {
  let baselineMs, candidateMs;
  if (round % 2) {
    candidateMs = timed(candidate);
    baselineMs = timed(baseline);
  } else {
    baselineMs = timed(baseline);
    candidateMs = timed(candidate);
  }
  samples.push({
    round,
    order: round % 2 ? 'candidate-baseline' : 'baseline-candidate',
    baselineMs,
    candidateMs,
  });
}
const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b),
    center = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[center]
    : (sorted[center - 1] + sorted[center]) / 2;
};
const baselineMs = median(samples.map((value) => value.baselineMs));
const candidateMs = median(samples.map((value) => value.candidateMs));
console.log(
  JSON.stringify(
    {
      kind: 'ssao-visibility-synthetic-cpu-v1',
      recordedAt: new Date().toISOString(),
      node: process.version,
      three: THREE.REVISION,
      cpu: cpus()[0]?.model,
      scaleSource: {
        path: sourcePath,
        capture: 'finalCaptures.high-citizen.ssaoExclusions',
        ...scale,
      },
      protocol: {
        warmupPairs: 1000,
        iterationsPerRound: iterations,
        rounds,
        alternatedOrder: true,
      },
      algorithmicWork: {
        baselineSceneVisits: baselineVisits,
        candidateSceneVisits: candidateVisits,
        baselineDraws,
        candidateDraws,
      },
      medianMsPerMockFrame: {
        baseline: baselineMs,
        candidate: candidateMs,
        saved: baselineMs - candidateMs,
      },
      samples,
      limitations: [
        'Synthetic 27-group scene matches archived object/candidate/hidden counts, not actual app topology or geometry.',
        'Three SSAOPass render executes with a no-op renderer: CPU visibility/wrapper overhead only, no WebGL or GPU work.',
        'Do not interpret this as app FPS, frame-time-tail, or browser performance improvement.',
        'One process and one machine; browser paired captures are required for end-user performance claims.',
      ],
    },
    null,
    2,
  ),
);
install.restore();
exclusions.dispose();
trackSSAOResources(pass);
pass.dispose();
geometry.dispose();
opaque.dispose();
transparent.dispose();
