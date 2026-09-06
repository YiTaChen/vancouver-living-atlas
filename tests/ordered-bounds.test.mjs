import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { orderedBounds } = await import(cityModule('ordered-bounds'));
const eps = 1e-8,
  hit = (a, b) =>
    a[0] <= b[2] + eps &&
    a[2] >= b[0] - eps &&
    a[1] <= b[3] + eps &&
    a[3] >= b[1] - eps;
let state = 48271;
const random = () =>
  ((state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
const items = Array.from({ length: 300 }, (_, id) => {
  const x = (random() - 0.5) * 2000,
    z = (random() - 0.5) * 2000;
  return { id, b: [x, z, x + random() * 80, z + random() * 80] };
});
items.push(
  { id: 300, b: [-24, -24, 0, 0] },
  { id: 301, b: [24, 0, 48, 24] },
  { id: 302, b: [-100000, -100000, 100000, 100000] },
);
const index = orderedBounds(items, (x) => x.b, 24, eps);
for (const b of [
  [0, 0, 0, 0],
  [24, 0, 24, 0],
  [24 - eps * 0.5, 0, 24 - eps * 0.5, 0],
  [-24 - eps * 0.5, -24, -24 - eps * 0.5, -24],
  [-200000, -200000, 200000, 200000],
])
  assert.deepStrictEqual(
    index.query(b),
    items.filter((x) => hit(b, x.b)),
  );
for (let k = 0; k < 1200; k++) {
  const x = (random() - 0.5) * 2000,
    z = (random() - 0.5) * 2000,
    b = [x, z, x + random() * 200, z + random() * 200];
  assert.deepStrictEqual(
    index.query(b),
    items.filter((i) => hit(b, i.b)),
  );
}
assert.throws(() => orderedBounds([{ b: [NaN, 0, 1, 1] }], (x) => x.b));
assert.throws(() => index.query([3, 4, 1, 2]));
console.log(
  'PASS: ordered AABB equality for 1200 deterministic queries, negative/epsilon boundaries, point queries, duplicate cells and large-box fallback.',
);
