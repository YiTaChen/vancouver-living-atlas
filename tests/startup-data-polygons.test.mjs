import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { projectStartupPolygons } = await import(
  cityModule('startup-data-polygons')
);
const { project, rings } = await import(cityModule('geo'));
const { makeContext } = await import(cityModule('context'));
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
  const region = data('context-land.geojson');
  let captured;
  const scene = new THREE.Scene();
  makeContext({
    data: {
      contextTerrain: data('context-terrain.json'),
      'context-land': region,
    },
    onLand: (x, z) => x + z > 0,
    elevation: (x, z) => 3 + x * 0.001 + z * 0.002,
    geometry: (pos, _normals, col) => {
      captured = { pos, col };
      return new THREE.BufferGeometry();
    },
    scene,
  });
  assert.equal(captured.pos.length / 3, 249678);
  // Captured from the unmodified makeContext with these same source data and
  // explicit seam callbacks. This catches numerical, topology, or order drift.
  assert.equal(
    createHash('sha256').update(JSON.stringify(captured)).digest('hex'),
    '2c04c1cc578ac3f55e52e3c7d95589c60bf168743959eef5b6cccb1c356dd99b',
  );
  for (const mesh of scene.children) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
