import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));

void test('lazy edge cache matches uncached and eager height and segment proofs at difficult boundaries', () => {
  const geometry = new THREE.BufferGeometry(),
    points = [];
  let seed = 0x19e8b75a;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 180; i++) {
    const x = (random() - 0.5) * 320,
      z = (random() - 0.5) * 320,
      y = (random() - 0.5) * 40;
    const dx = (random() - 0.5) * 35,
      dz = (random() - 0.5) * 35;
    const slope = i % 7 === 0 ? 1e-10 : i % 11 === 0 ? 0 : random() * 5 + 0.001;
    points.push(
      x,
      y,
      z,
      x + dx,
      y + (random() - 0.5) * 3,
      z + dz,
      x + dx * 0.5 - dz * slope,
      y + (random() - 0.5) * 3,
      z + dz * 0.5 + dx * slope,
    );
  }
  // Shared caps, degenerate geometry, and non-finite source vertices exercise
  // construction and lazy-read paths; invalid faces never become floor hits.
  points.push(
    0,
    0,
    0,
    64,
    0,
    0,
    0,
    0,
    64,
    64,
    0,
    0,
    64,
    0,
    64,
    0,
    0,
    64,
    NaN,
    0,
    0,
    1,
    0,
    1,
    2,
    0,
    2,
    0,
    Infinity,
    0,
    1,
    0,
    1,
    2,
    0,
    2,
  );
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float64Array(points), 3),
  );
  const mesh = new THREE.Mesh(geometry),
    original = new GroundSurfaceIndex([mesh]),
    eager = new GroundSurfaceIndex([mesh], [], { cacheEdgeTolerances: true }),
    lazy = new GroundSurfaceIndex([mesh], [], { cacheEdgeTolerances: 'lazy' });
  try {
    assert.equal(original.edgeCacheBytes, 0);
    assert.equal(eager.edgeCacheBytes, eager.inverseAreas.length * 24);
    assert.equal(lazy.edgeCacheBytes, lazy.inverseAreas.length * 25);
    assert(lazy.edgeToleranceReady.every((n) => n === 0));
    const compare = (x, z, y) => {
      const expected = original.sample(x, z, y);
      assert(Object.is(lazy.sample(x, z, y), expected));
      assert(Object.is(eager.sample(x, z, y), expected));
    };
    for (let i = 0; i < 6000; i++) {
      const t = Math.floor(random() * 180) * 9,
        u = random(),
        v = random() * (1 - u);
      const x =
        points[t] +
        u * (points[t + 3] - points[t]) +
        v * (points[t + 6] - points[t]);
      const z =
        points[t + 2] +
        u * (points[t + 5] - points[t + 2]) +
        v * (points[t + 8] - points[t + 2]);
      const y =
        points[t + 1] +
        u * (points[t + 4] - points[t + 1]) +
        v * (points[t + 7] - points[t + 1]);
      compare(x, z, y + (i % 13 === 0 ? 4.0000001 : i % 11 === 0 ? 4 : 0));
      if (i % 7 === 0) {
        const delta = [
          -0.000501, -0.0005, -0.000499, 0, 0.000499, 0.0005, 0.000501,
        ][i % 7];
        compare(
          points[t] + (points[t + 3] - points[t]) * u + delta,
          points[t + 2] + (points[t + 5] - points[t + 2]) * u - delta,
          y,
        );
      }
    }
    for (const x of [
      -Infinity,
      Infinity,
      NaN,
      -0,
      0,
      63.999999999,
      64,
      64.000000001,
      Number.MAX_VALUE,
    ])
      for (const z of [-Infinity, Infinity, NaN, -0, 0, 64])
        for (const y of [-Infinity, Infinity, NaN, -0, 0, 4, 4.00000001])
          compare(x, z, y);
    for (let i = 0; i < 500; i++) {
      const t = Math.floor(random() * 180) * 9,
        x = points[t],
        z = points[t + 2],
        y = points[t + 1];
      const to = [x + (random() - 0.5) * 3, z + (random() - 0.5) * 3];
      const expected = original.coversSegment([x, z], to, y);
      assert.equal(lazy.coversSegment([x, z], to, y), expected);
      assert.equal(eager.coversSegment([x, z], to, y), expected);
    }
    assert(lazy.edgeToleranceReady.some((n) => n === 1));
    const reloaded = new GroundSurfaceIndex([mesh], [], {
      cacheEdgeTolerances: 'lazy',
    });
    assert(
      reloaded.edgeToleranceReady.every((n) => n === 0),
      'rebuilt floor starts with fresh metadata',
    );
    assert.equal(
      reloaded.coversSegment([1, 1], [2, 2], 0),
      original.coversSegment([1, 1], [2, 2], 0),
      'segment proofs can populate a fresh cache before any point sample',
    );
    assert(Object.is(reloaded.sample(1, 1, 0), original.sample(1, 1, 0)));
  } finally {
    geometry.dispose();
    mesh.material.dispose();
  }
});
