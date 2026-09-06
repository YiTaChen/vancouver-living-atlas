import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { TreeSelection, TreeAssetBarrier } = await import(
  cityModule('tree-selection')
);
const baseline = (trees, x, y, z, r, k) =>
  trees
    .map((t, ordinal) => ({
      t,
      ordinal,
      d: (t.x - x) ** 2 + (t.y + t.h * 0.55 - y) ** 2 + (t.z - z) ** 2,
    }))
    .filter((p) => p.d < r * r)
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
let state = 57113;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
};
const trees = Array.from({ length: 36000 }, (_, id) => ({
  id,
  x: (random() - 0.5) * 4400,
  z: (random() - 0.5) * 4500,
  y: random() * 80,
  h: 5 + random() * 25,
}));
test('36k-tree exact spatial top-K matches the previous full sort, including negative grid coordinates', () => {
  const grid = new TreeSelection(trees);
  for (const [x, y, z, r, k] of [
    [-1700, 20, -900, 170, 450],
    [-900, 60, -700, 450, 1080],
    [0, 500, 0, 170, 450],
    [-96, 20, 96, 170, 450],
    [96, 40, -96, 450, 1080],
    [0, 20, 0, 450, 5],
  ])
    assert.deepEqual(
      grid.nearest(x, y, z, r, k),
      baseline(trees, x, y, z, r, k),
    );
  grid.nearest(0, 20, 0, 170, 450);
  assert.ok(grid.stats.tested < 2000);
  assert.ok(grid.stats.tested < trees.length / 10);
});
test('coincident positions and exactly equal distances preserve source-order tie breaking', () => {
  const t = Array.from({ length: 100 }, (_, id) => ({
    id,
    x: id % 2 ? -10 : 10,
    z: 0,
    y: 0,
    h: 0,
  }));
  assert.deepEqual(
    new TreeSelection(t, 6).nearest(0, 0, 0, 11, 7).map((p) => p.t.id),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.equal(new TreeSelection(t).nearest(0, 0, 0, 10, 100).length, 0);
});
test('height uses the same canopy-centre distance and results retain original object references', () => {
  const t = [
      { x: 0, y: 100, z: 0, h: 20 },
      { x: 0, y: 0, z: 0, h: 20 },
    ],
    g = new TreeSelection(t),
    before = JSON.stringify(t),
    a = g.nearest(0, 112, 0, 5, 2);
  assert.equal(a.length, 1);
  assert.equal(a[0].t, t[0]);
  assert.equal(JSON.stringify(t), before);
  assert.equal(g.nearest(0, 500, 0, 170, 2).length, 0);
});
test('invalid and huge-radius queries terminate safely; no texture barrier reveals a partial load', () => {
  const g = new TreeSelection(trees);
  for (const args of [
    [NaN, 0, 0, 100, 10],
    [0, 0, 0, -1, 10],
    [0, 0, 0, 100, 0],
  ])
    assert.deepEqual(g.nearest(...args), []);
  assert.equal(g.nearest(0, 0, 0, 1e10, 2).length, 2);
  assert.throws(() => new TreeSelection([], 0));
  const a = new TreeAssetBarrier();
  assert.equal(a.ready, false);
  a.settle('leaf', true);
  assert.equal(a.ready, false);
  a.settle('bark', true);
  assert.equal(a.ready, true);
  const b = new TreeAssetBarrier();
  b.settle('bark', false);
  b.settle('leaf', true);
  assert.equal(b.ready, false);
  b.settle('bark', true);
  assert.equal(b.ready, false);
});
