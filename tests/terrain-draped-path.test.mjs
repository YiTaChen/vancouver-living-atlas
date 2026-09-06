import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { TerrainPathDraper } = await import(cityModule('terrain-draped-path'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const geometry = (p) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
};
const land = geometry([
  0, 0, 0, 0, 0, 10, 10, 2, 0, 10, 2, 0, 0, 0, 10, 10, 5, 10,
]);
const path = geometry([2, 8, 2, 2, 8, 8, 8, 8, 8, 2, 8, 2, 8, 8, 8, 8, 8, 2]);
const area = (g) => {
  const p = g.getAttribute('position');
  let sum = 0;
  for (let i = 0; i < p.count; i += 3)
    sum +=
      Math.abs(
        (p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i)) -
          (p.getZ(i + 1) - p.getZ(i)) * (p.getX(i + 2) - p.getX(i)),
      ) / 2;
  return sum;
};
test('split path at real terrain creases, preserving footprint and 45 mm clearance throughout each triangle', () => {
  const before = Array.from(land.getAttribute('position').array),
    out = new TerrainPathDraper(land).drape(path),
    p = out.getAttribute('position');
  const ground = new GroundSurfaceIndex([new THREE.Mesh(land)]);
  assert(Math.abs(area(out) - area(path)) < 1e-5);
  for (let i = 0; i < p.count; i += 3)
    for (const weights of [
      [1 / 3, 1 / 3, 1 / 3],
      [0.1, 0.2, 0.7],
      [0.8, 0.1, 0.1],
    ]) {
      let x = 0,
        y = 0,
        z = 0;
      weights.forEach((w, j) => {
        x += p.getX(i + j) * w;
        y += p.getY(i + j) * w;
        z += p.getZ(i + j) * w;
      });
      assert(Math.abs(y - ground.sample(x, z, y) - 0.045) < 1e-5);
    }
  assert.deepEqual(Array.from(land.getAttribute('position').array), before);
});
test('preserve known connector elevations and unsupported paths instead of lowering bridge approaches into empty space', () => {
  const out = new TerrainPathDraper(land, [[5, 5]]).drape(path),
    p = out.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (Math.hypot(p.getX(i) - 5, p.getZ(i) - 5) <= 4)
      assert.equal(p.getY(i), 8);
  const away = path.clone().translate(100, 0, 100),
    keep = new TerrainPathDraper(land).drape(away);
  assert.deepEqual(
    Array.from(keep.getAttribute('position').array),
    Array.from(away.getAttribute('position').array),
  );
});
