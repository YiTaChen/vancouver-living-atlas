import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const { residentialPerennial } = await import(
  cityModule('assets/residential-perennial')
);
const { RESIDENTIAL_PERENNIAL: source } = await import(
  cityModule('assets/residential-perennial-data')
);

test('Blender perennial retains the seven-face budget, connected interior edges, bounded UVs and one shared material', () => {
  assert.equal(source.triangles.length, 7);
  assert.equal(source.vertices.length, 8);
  const edges = new Map();
  for (const face of source.triangles) {
    assert.equal(new Set(face).size, 3);
    for (let k = 0; k < 3; k++) {
      const key = [face[k], face[(k + 1) % 3]].sort((a, b) => a - b).join(',');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.equal(
    [...edges.values()].filter((v) => v === 2).length,
    7,
    'seven welded interior edges',
  );
  assert.equal(
    [...edges.values()].filter((v) => v === 1).length,
    7,
    'intentional open underside perimeter',
  );
  assert.ok(
    source.uvs.flat(2).every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
  );
  assert.ok(source.colors.flat(2).every((v) => v >= 0.93 && v <= 1));
  const glb = readFileSync(
    new URL(
      '../tools/assets/residential-perennial/source/perennial.glb',
      import.meta.url,
    ),
  );
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  const doc = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.equal(doc.materials.length, 1);
  assert.equal(doc.meshes.length, 1);
  assert.equal(doc.meshes[0].primitives.length, 1);
  const primitive = doc.meshes[0].primitives[0];
  assert.equal(doc.accessors[primitive.indices].count / 3, 7);
  assert.ok('TEXCOORD_0' in primitive.attributes);
  assert.ok('COLOR_0' in primitive.attributes);
  assert.equal(doc.textures?.length ?? 0, 0);
  assert.equal(doc.materials[0].pbrMetallicRoughness.metallicFactor, 0);
});

test('perennial source is used deterministically within previous radius/height for every seed phase', () => {
  for (let seed = 0; seed < 84; seed++) {
    const plant = residentialPerennial(10, -20, 5, seed, () => 5);
    assert.deepEqual(
      plant,
      residentialPerennial(10, -20, 5, seed, () => 5),
    );
    assert.equal(plant.positions.length, 63);
    assert.equal(plant.colors.length, 63);
    const height = 0.19 + (seed % 4) * 0.022;
    for (let i = 0; i < 63; i += 3) {
      const [x, y, z] = plant.positions.slice(i, i + 3);
      assert.ok(Math.hypot(x - 10, z + 20) <= 0.286001);
      assert.ok(y >= 5.02499 && y <= 5 + height + 1e-6);
    }
    for (let i = 0; i < 63; i += 9) {
      const [ax, , az, bx, , bz, cx, , cz] = plant.positions.slice(
        i,
        i + 9,
      );
      const upward = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      assert.ok(upward > 1e-5, 'upward nondegenerate face winding');
    }
  }
});

test('shared ring vertices stay joined on slopes, and failed samples retain existing fallback behavior', () => {
  for (const sample of [(x, z) => 0.05 * x + 0.1 * z, () => undefined]) {
    const plant = residentialPerennial(0, 0, 0, 7, sample);
    const points = new Map();
    source.triangles.flat().forEach((vertex, i) => {
      const position = plant.positions.slice(i * 3, i * 3 + 3);
      if (points.has(vertex)) assert.deepEqual(position, points.get(vertex));
      points.set(vertex, position);
    });
    assert.ok(plant.positions.every(Number.isFinite));
  }
});
