/** Focused CPU-side wall-time benchmark; no browser, renderer, or GPU.
 * Pass an unmodified context.ts with --baseline-context=path to compare.
 * Run with node --expose-gc tools/benchmark-startup-data.mjs ... for GC between
 * samples. Source data and explicit seam fixtures are identical in both runs.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from '../tests/helpers/city-modules.mjs';

const args = process.argv.slice(2);
const baselinePath = args
  .find((arg) => arg.startsWith('--baseline-context='))
  ?.split('=')
  .slice(1)
  .join('=');
const requested = Number(
  args.find((arg) => arg.startsWith('--iterations='))?.split('=')[1] ?? 5,
);
if (!Number.isInteger(requested) || requested < 1 || requested > 20)
  throw new Error('--iterations must be an integer from 1 to 20');
const { WaterWorld } = await import(cityModule('water-world'));
const { makeContext: currentContext } = await import(cityModule('context'));
let baselineContext;
if (baselinePath) {
  const source = readFileSync(resolve(baselinePath), 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, name) => {
      if (name === 'three') return `from '${import.meta.resolve('three')}'`;
      if (name.startsWith('./')) return `from '${cityModule(name.slice(2))}'`;
      throw new Error(`Unexpected context module import: ${name}`);
    });
  ({ makeContext: baselineContext } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  ));
}
const readData = (name) =>
  JSON.parse(
    readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'),
  );
const region = readData('context-land.geojson');
const terrain = readData('context-terrain.json');
const empty = { features: [] };
const rows = [];
function sample(label, makeContext) {
  globalThis.gc?.();
  let captured;
  const scene = new THREE.Scene();
  const e = {
    data: { contextTerrain: terrain, 'context-land': region },
    onLand: (x, z) => x + z > 0,
    elevation: (x, z) => 3 + x * 0.001 + z * 0.002,
    geometry: (pos, _normal, col) => {
      captured = { pos, col };
      return new THREE.BufferGeometry();
    },
    scene,
  };
  const started = performance.now();
  makeContext(e);
  // This isolates regional mask preparation/indexing. Full city building,
  // landmark and beach collision inputs are deliberately outside this scope.
  const world = new WaterWorld([], region, [], empty, empty);
  const wallMs = performance.now() - started;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(captured))
    .digest('hex');
  const vertices = captured.pos.length / 3;
  for (const mesh of scene.children) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return {
    label,
    wallMs,
    fingerprint,
    vertices,
    polygons: world.regional.length,
  };
}

// Warm module/JIT paths; omit these from reported samples.
if (baselineContext) sample('baseline-warmup', baselineContext);
sample('current-warmup', currentContext);
for (let i = 0; i < requested; i++) {
  // Alternate order to reduce a consistent warm-up/order advantage.
  if (baselineContext && i % 2 === 0)
    rows.push(sample('baseline', baselineContext));
  rows.push(sample('current', currentContext));
  if (baselineContext && i % 2 !== 0)
    rows.push(sample('baseline', baselineContext));
}
if (new Set(rows.map((row) => row.fingerprint)).size !== 1)
  throw new Error('Before/after positions or colours differ');
const summarize = (label) => {
  const wallMs = rows
    .filter((row) => row.label === label)
    .map((row) => row.wallMs)
    .sort((a, b) => a - b);
  if (!wallMs.length) return null;
  const middle = Math.floor(wallMs.length / 2);
  return {
    samples: wallMs.length,
    medianWallMs:
      wallMs.length % 2
        ? wallMs[middle]
        : (wallMs[middle - 1] + wallMs[middle]) / 2,
    minWallMs: wallMs[0],
    maxWallMs: wallMs.at(-1),
    samplesWallMs: wallMs,
  };
};
const baseline = summarize('baseline');
const current = summarize('current');
console.log(
  JSON.stringify(
    {
      schema: 'startup-regional-data-cpu-wall-v1',
      scope:
        'regional terrain arrays, regional polygon projection and WaterWorld regional indexing, with deterministic seam callbacks',
      runtime: process.version,
      platform: `${process.platform}/${process.arch}`,
      warmupSamplesPerVariant: 1,
      explicitGcBetweenSamples: typeof globalThis.gc === 'function',
      vertices: rows[0].vertices,
      positionColorSha256: rows[0].fingerprint,
      baseline,
      current,
      medianReductionPercent: baseline
        ? (100 * (baseline.medianWallMs - current.medianWallMs)) /
          baseline.medianWallMs
        : null,
      interpretation:
        'Elapsed CPU-side wall time only, including allocation/GC during each sample. Not full startup, network, browser responsiveness, GPU, or visual render timing. No geographic simplification.',
    },
    null,
    2,
  ),
);
