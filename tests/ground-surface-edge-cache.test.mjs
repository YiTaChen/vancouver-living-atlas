import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { groundSurfaceRoadFixture } from './helpers/ground-surface-road-fixture.mjs';
import {
  sampleBeforeEdgeCache,
  coversSegmentBeforeEdgeCache,
} from './helpers/ground-surface-before-edge-cache.mjs';

const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));

test('cached edge thresholds retain exact source-road Float32 heights and local segment coverage', () => {
  const fixture = groundSurfaceRoadFixture();
  const { index, defaultIndex, queries } = fixture;
  try {
    assert(fixture.names.length >= 4);
    assert.equal(defaultIndex.edgeCacheBytes, 0);
    assert.equal(
      defaultIndex.edgeTolerances,
      null,
      'default indices allocate no triangle threshold array',
    );
    let hits = 0,
      misses = 0;
    for (const [x, z, y] of queries) {
      const actual = index.sample(x, z, y);
      assert.equal(actual, sampleBeforeEdgeCache.call(index, x, z, y));
      assert.equal(actual, defaultIndex.sample(x, z, y));
      if (actual === undefined) misses++;
      else hits++;
    }
    assert(
      hits > 100 && misses > 100,
      'source roads exercise accepted paving, gaps and wrong heights',
    );
    for (const [x, z, y] of queries.slice(0, 500)) {
      const from = [x - 0.5, z + 0.3],
        to = [x + 0.8, z - 0.4];
      assert.equal(
        index.coversSegment(from, to, y),
        coversSegmentBeforeEdgeCache.call(index, from, to, y),
      );
      assert.equal(
        index.coversSegment(from, to, y),
        defaultIndex.coversSegment(from, to, y),
      );
    }
    assert.equal(index.edgeCacheBytes, index.inverseAreas.length * 24);
  } finally {
    fixture.dispose();
  }
});

test('cached half-millimetre tolerances preserve all three triangle edges and adjacent cell caps', () => {
  const geometry = new THREE.BufferGeometry();
  // The triangle touches two index-cell boundaries and uses rounded source floats.
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [64, 1.18, -64, 76.234567, 1.4, -64, 64, 1.7, -51.76543],
      3,
    ),
  );
  const mesh = new THREE.Mesh(geometry),
    index = new GroundSurfaceIndex([mesh], [], { cacheEdgeTolerances: true }),
    defaultIndex = new GroundSurfaceIndex([mesh]);
  const p = geometry.attributes.position;
  const vertices = Array.from({ length: 3 }, (_, i) => [p.getX(i), p.getZ(i)]);
  try {
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge],
        b = vertices[(edge + 1) % 3];
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      for (const t of [0.001, 0.25, 0.5, 0.75, 0.999])
        for (const distance of [
          -0.000501, -0.0005, -0.000499, 0, 0.000499, 0.0005, 0.000501,
        ]) {
          const x = a[0] + dx * t + (dz / length) * distance;
          const z = a[1] + dz * t - (dx / length) * distance;
          assert.equal(
            index.sample(x, z, 1.4),
            sampleBeforeEdgeCache.call(index, x, z, 1.4),
          );
          assert.equal(index.sample(x, z, 1.4), defaultIndex.sample(x, z, 1.4));
          assert.equal(
            index.coversSegment([x - 0.01, z], [x + 0.01, z], 1.4),
            coversSegmentBeforeEdgeCache.call(
              index,
              [x - 0.01, z],
              [x + 0.01, z],
              1.4,
            ),
          );
        }
    }
    assert.notEqual(index.sample(64 - 0.000499, -60, 1.4), undefined);
    assert.equal(index.sample(64 - 0.000501, -60, 1.4), undefined);
  } finally {
    geometry.dispose();
    mesh.material.dispose();
  }
});
