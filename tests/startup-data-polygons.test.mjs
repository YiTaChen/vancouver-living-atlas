import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { projectStartupPolygons } = await import(
  cityModule('startup-data-polygons')
);
const { project, rings } = await import(cityModule('geo'));
const { makeContext } = await import(cityModule('context'));
// Byte-for-byte context.ts from bb26294067dade837738be62a6cc0faa8a4d9712.
// Keep the historical source as text so typechecking/formatting cannot rewrite
// it. Evaluate both implementations with the same runtime, Three and geo code:
// transcendental math can differ between platforms before float32 upload.
const originalSource = readFileSync(
  new URL('./fixtures/context-before-optimization.ts.txt', import.meta.url),
  'utf8',
);
assert.equal(
  createHash('sha256').update(originalSource).digest('hex'),
  'c1c130745a078a4d3f90302ef960c1d864c7c57057fc9ce2c93fe342cb043941',
  'the original terrain implementation remains unchanged',
);
const originalCode = ts
  .transpileModule(originalSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(/from ['"]([^'"]+)['"]/g, (_match, id) => {
    assert.ok(id === 'three' || id === './geo', `unexpected import: ${id}`);
    return `from '${id === 'three' ? import.meta.resolve('three') : cityModule('geo')}'`;
  });
const { makeContext: makeOriginalContext } = await import(
  'data:text/javascript;base64,' + Buffer.from(originalCode).toString('base64')
);
const data = (name) =>
  JSON.parse(
    readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'),
  );

test('regional terrain masks preserve every projected source ring and coordinate', () => {
  const source = data('context-land.geojson');
  const before = JSON.stringify(source);
  const legacy = source.features.flatMap((f) =>
    rings(f).map((p) => p.map((r) => r.map(project))),
  );
  const projected = projectStartupPolygons(source);
  assert.deepEqual(projected, legacy);
  assert.equal(JSON.stringify(source), before, 'source GeoJSON is not mutated');
  assert.equal(projected.length, 7);
  assert.equal(projected.flat(2).length, 846);
});

test('regional terrain retains the original positions, colours, and vertex order', () => {
  const capture = (build) => {
    const source = {
      contextTerrain: data('context-terrain.json'),
      'context-land': data('context-land.geojson'),
    };
    const before = JSON.stringify(source);
    let captured;
    const scene = new THREE.Scene();
    try {
      build({
        data: source,
        onLand: (x, z) => x + z > 0,
        elevation: (x, z) => 3 + x * 0.001 + z * 0.002,
        geometry: (pos, _normals, col) => {
          captured = { pos, col };
          return new THREE.BufferGeometry();
        },
        scene,
      });
      assert.equal(
        JSON.stringify(source),
        before,
        'source data is not mutated',
      );
      assert.equal(captured.pos.length / 3, 249678);
      assert.equal(captured.col.length, captured.pos.length);
      return captured;
    } finally {
      for (const mesh of scene.children) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
  };
  const original = capture(makeOriginalContext);
  const candidate = capture(makeContext);
  // Compare every unrounded number and its array position, preserving strict
  // numerical/topology/order protection without a platform-specific JSON hash.
  assert.deepEqual(
    candidate.pos,
    original.pos,
    'original vertex positions/order',
  );
  assert.deepEqual(
    candidate.col,
    original.col,
    'original vertex colours/order',
  );
});
