import assert from 'node:assert/strict';
import { groundSurfaceRoadFixture } from '../tests/helpers/ground-surface-road-fixture.mjs';
import { sampleBeforeEdgeCache } from '../tests/helpers/ground-surface-before-edge-cache.mjs';

const fixture = groundSurfaceRoadFixture();
const { index, queries } = fixture;
const queryCount = 20_000;
function run(sample) {
  let sum = 0;
  const start = performance.now();
  for (let i = 0; i < queryCount; i++) {
    const q = queries[i % queries.length];
    sum += sample.call(index, q[0], q[1], q[2]) ?? 0;
  }
  return { ms: performance.now() - start, sum };
}
try {
  for (const q of queries)
    assert.equal(index.sample(...q), sampleBeforeEdgeCache.call(index, ...q));
  run(sampleBeforeEdgeCache);
  run(index.sample);
  const before = [],
    after = [];
  for (let trial = 0; trial < 7; trial++) {
    // Alternate order to reduce CPU warmup/thermal bias.
    const pair =
      trial % 2
        ? [run(index.sample), run(sampleBeforeEdgeCache)]
        : [run(sampleBeforeEdgeCache), run(index.sample)];
    const a = pair[trial % 2 ? 1 : 0],
      b = pair[trial % 2 ? 0 : 1];
    assert.equal(a.sum, b.sum);
    before.push(a.ms);
    after.push(b.ms);
  }
  const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const oldMs = median(before),
    newMs = median(after);
  console.log(
    JSON.stringify(
      {
        queryCount,
        uniqueQueries: queries.length,
        trials: 7,
        sourceRoads: fixture.names,
        triangles: index.inverseAreas.length,
        edgeCacheBytes: index.edgeCacheBytes,
        beforeMedianMs: oldMs,
        afterMedianMs: newMs,
        reductionPercent: (1 - newMs / oldMs) * 100,
        beforeTrialsMs: before,
        afterTrialsMs: after,
        exactResults: true,
      },
      null,
      2,
    ),
  );
} finally {
  fixture.dispose();
}
