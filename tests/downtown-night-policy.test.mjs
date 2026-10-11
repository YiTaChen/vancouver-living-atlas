import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { createDowntownNightPolicy, streetLampHead } = await import(
  cityModule('downtown-night-policy')
);
const { project } = await import(cityModule('geo'));

test('downtown night policy includes major districts and leaves outer districts and Stanley Park dark', () => {
  const policy = createDowntownNightPolicy([], () => true);
  for (const coord of [
    [-123.128, 49.285],
    [-123.135, 49.29],
    [-123.105, 49.284],
    [-123.119, 49.277],
  ])
    assert(
      policy(...project(coord)),
      `Missing downtown receiver ${coord.join(',')}`,
    );
  for (const coord of [
    [-123.1513, 49.3087],
    [-123.131, 49.266],
    [-123.119, 49.307],
    [-123.166, 49.303],
  ])
    assert.equal(
      policy(...project(coord)),
      false,
      `Unexpected outer receiver ${coord.join(',')}`,
    );
  assert.equal(policy(NaN, 0), false);
});

test('night policy preserves park polygon holes, water and non-land exclusions', () => {
  const policy = createDowntownNightPolicy(
    [
      [
        [
          [-40, -40],
          [40, -40],
          [40, 40],
          [-40, 40],
        ],
        [
          [-10, -10],
          [10, -10],
          [10, 10],
          [-10, 10],
        ],
      ],
    ],
    (x) => x < 100,
  );
  assert.equal(policy(25, 25), false);
  assert.equal(policy(0, 0), true);
  assert.equal(policy(120, 0), false);
});

test('lamp head is at the actual inward arm tip for all road headings', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -0.75]) {
    const dx = Math.sin(yaw),
      dz = Math.cos(yaw);
    const pole = { x: dz * 7, z: -dx * 7 };
    const head = streetLampHead(pole.x, pole.z, yaw, 11);
    assert(Math.abs(head.y - 18.85) < 1e-9);
    assert(Math.abs(Math.hypot(head.x, head.z) - 5.45) < 1e-9);
    assert(Math.abs((head.x - pole.x) * dx + (head.z - pole.z) * dz) < 1e-9);
  }
});
