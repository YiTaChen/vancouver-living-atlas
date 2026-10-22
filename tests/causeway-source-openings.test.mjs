import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load } from '../tools/causeway-cpu.mjs';

const { buildCausewayGeometry, createCausewayTriangleLookup } = load(
  'lib/city/causeway-geometry.ts',
);
const road = (sourceId, z) => ({
  a: [0, z],
  b: [20, z],
  h0: 6,
  h1: 7,
  width: 4,
  s0: 0,
  s1: 20,
  routeId: `road:${sourceId}`,
  surfaceId: 'road',
  layer: 1,
  sourceId,
});
const input = [road(21, 0), road(22, 20)];
const options = { shoulderWidthM: 2, rails: false, paint: false };
const opening = {
  outer: [
    [8, 1.5],
    [12, 1.5],
    [12, 4.5],
    [8, 4.5],
  ],
};

test('source-owned asphalt footprint removes raised shoulder and curb only inside the physical motor opening', () => {
  const original = buildCausewayGeometry(input, options);
  const result = buildCausewayGeometry(input, {
    ...options,
    shoulderOpenings: (id) => (id.sourceId === 21 ? [opening] : []),
  });
  for (const kind of ['asphalt', 'slab', 'retaining'])
    assert.deepEqual(result.buffers[kind], original.buffers[kind]);
  const lookup = createCausewayTriangleLookup(result);
  assert.equal(
    lookup.heightAt(10, 3, { surfaceId: 'road', layer: 1 }, 'shoulder'),
    undefined,
  );
  for (const p of [
    [6, 3],
    [14, 3],
    [10, -3],
    [10, 23],
  ])
    assert(lookup.heightAt(...p, { surfaceId: 'road', layer: 1 }, 'shoulder'));
  assert(lookup.heightAt(10, 0, { surfaceId: 'road', layer: 1 }, 'road'));
  const curb = result.buffers.curb;
  assert(curb.length < original.buffers.curb.length + 36);
  let outside = 0;
  for (let i = 0; i < curb.length; i += 9) {
    const x = (curb[i] + curb[i + 3] + curb[i + 6]) / 3;
    const z = (curb[i + 2] + curb[i + 5] + curb[i + 8]) / 3;
    assert(
      !(x > 8 && x < 12 && z > 1.5 && z < 4.5),
      'raised curb must not remain across the opening',
    );
    outside++;
  }
  assert(outside > 4, 'other source and outside curb remain physical');
  const other = (g) =>
    g.topTriangles
      .filter((t) => t.identities.some((id) => id.sourceId === 22))
      .flatMap((t) => g.buffers[t.buffer].slice(t.offset, t.offset + 9));
  assert.deepEqual(other(result), other(original));
});

test('new split bridge caps stay at asphalt height across the lane; original default buffers remain byte-identical', () => {
  const baseline = buildCausewayGeometry([input[0]], {
    ...options,
    bridgeSourceIds: new Set([21]),
  });
  // Captured from the pre-change repository implementation for this exact
  // public geometry input, so the new opt-in cannot change legacy Causeways.
  const hashes = {
    asphalt: 'bfb534e7e54cd594e79623ecf0093ccf0abab4cf4753ac6fe1caccf5c4e31620',
    shoulder:
      '08f335a0ef4854f63c005b830baf26b51d7fc6df8740115ecfbcabb795f7dde0',
    curb: '965869ced47c2da39d4978e619e93254670618f2ceafe8c6ca6007aa2c8815b5',
    slab: '536a1682a7b9ed60702d4d8c500ab91bf4f05add402a82c6aac8eb5e75613184',
  };
  for (const [kind, hash] of Object.entries(hashes))
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify(baseline.buffers[kind]))
        .digest('hex'),
      hash,
    );
  const split = buildCausewayGeometry([input[0]], {
    ...options,
    bridgeSourceIds: new Set([21]),
    splitSlabEndCaps: true,
  });
  for (const kind of ['asphalt', 'shoulder', 'curb'])
    assert.deepEqual(split.buffers[kind], baseline.buffers[kind]);
  let laneCaps = 0;
  for (let i = 0; i < split.buffers.slab.length; i += 9) {
    const v = split.buffers.slab.slice(i, i + 9),
      xs = [v[0], v[3], v[6]],
      zs = [v[2], v[5], v[8]],
      ys = [v[1], v[4], v[7]];
    if (
      (xs.every((x) => Math.abs(x) < 1e-6) ||
        xs.every((x) => Math.abs(x - 20) < 1e-6)) &&
      zs.every((z) => Math.abs(z) <= 2 + 1e-6)
    ) {
      assert(
        Math.max(...ys) <= (xs[0] < 1 ? 6 : 7) + 1e-6,
        'car lane must not inherit raised shoulder cap',
      );
      laneCaps++;
    }
  }
  assert.equal(laneCaps, 4);
});
