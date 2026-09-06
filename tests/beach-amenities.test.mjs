import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createBeachAmenities } = await import(cityModule('beach-amenities'));
const coast = JSON.parse(
  fs.readFileSync(new URL('../public/data/beach-coast.json', import.meta.url)),
);
test('beach props stay finite, bounded and batched; court surfaces follow the rendered floor instead of the DEM', () => {
  const terrain = new THREE.Group(),
    scene = new THREE.Scene();
  // Rendered ground differs from DEM by 1.6m, like the existing sand overlay.
  const g = new THREE.PlaneGeometry(10000, 10000)
    .rotateX(-Math.PI / 2)
    .translate(0, 1.6, 0);
  terrain.add(new THREE.Mesh(g));
  const before = Array.from(g.getAttribute('position').array);
  const e = { terrain, scene, elevation: () => 0, data: { beachCoast: coast } };
  createBeachAmenities(e);
  const r = e.data.beachAmenities;
  assert.equal(r.courts, 2);
  assert.equal(r.volleyball, 8);
  assert(r.logs >= 12 && r.logs <= 24);
  assert.equal(r.batches, 2);
  assert(r.triangles < 150000);
  for (const lod of scene.children) {
    assert(lod instanceof THREE.LOD);
    assert.equal(lod.levels[1].distance, 1400);
    const mesh = lod.levels[0].object,
      pos = mesh.geometry.getAttribute('position');
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      assert(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)));
      min = Math.min(min, pos.getY(i) + lod.position.y);
      max = Math.max(max, pos.getY(i) + lod.position.y);
    }
    assert(min > 1.3 && max < 5.7, `floor placement ${min}..${max}`);
    assert.equal(mesh.material.transparent, false);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  assert.deepEqual(Array.from(g.getAttribute('position').array), before);
  g.dispose();
});
