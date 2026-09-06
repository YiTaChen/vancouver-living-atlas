import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {
  prepareRoadLowering: prepare,
  lowerRoadSurface: lower,
  roadLoweringAt: at,
} = await import(cityModule('road-lowering'));
const { compareGroundHeights: compare, visibilityGeometry: G } = await import(
  cityModule('ground-visibility')
);
const flat = (p, y) =>
  p.flatMap(([x, z]) => [x, typeof y === 'function' ? y(x, z) : y, z]);
const rect = (x0, z0, x1, z1, y) =>
  flat(
    [
      [x0, z0],
      [x0, z1],
      [x1, z1],
      [x0, z0],
      [x1, z1],
      [x1, z0],
    ],
    y,
  );
const source = (positions, kind = 'asphalt', extra = {}) => ({
  positions,
  id: kind,
  kind,
  level: 'ground',
  ...extra,
});
const scope = [-30, -30, 30, 30],
  road = rect(-12, -12, 12, 12, 5.5),
  path = rect(-1.5, -3, 1.5, 3, 5);
const plan = prepare([source(road)], [source(path, 'path')], { bounds: scope });
const output = lower(
  {
    positions: road,
    attributes: {
      uv: {
        itemSize: 2,
        array: road.flatMap((_, i) =>
          i % 3 === 0 ? [road[i] / 3, road[i + 2] / 3] : [],
        ),
      },
    },
  },
  plan,
);
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
test('only asphalt is lowered; exact source path footprint is at least 2cm above every output triangle', () => {
  const c = compare(output.positions, path, scope);
  assert.ok(c.maximumDeltaM <= -0.02 + 1e-8);
  near(c.areaM2, 18);
  assert.equal(output.statistics.maximumUpwardChangeM, 0);
  near(output.statistics.maximumLoweringM, 0.52);
});
test('no holes, deleted road polygons or changed source XY envelope', () => {
  near(output.statistics.inputPlanAreaM2, 576);
  near(output.statistics.outputPlanAreaM2, 576, 1e-6);
  const xs = output.positions.filter((_, i) => i % 3 === 0),
    zs = output.positions.filter((_, i) => i % 3 === 2);
  near(Math.min(...xs), -12);
  near(Math.max(...xs), 12);
  near(Math.min(...zs), -12);
  near(Math.max(...zs), 12);
});
test('the finite blend returns exactly to the original road with zero perimeter derivative', () => {
  near(at(plan, [7.5, 0], 5.5), 5.5);
  near(at(plan, [7.5 + 1e-6, 0], 5.5), 5.5);
  assert.ok(5.5 - at(plan, [7.5 - 0.001, 0], 5.5) < 1e-7);
  for (let i = 0; i < output.positions.length; i += 3)
    if (
      Math.abs(output.positions[i]) > 7.5 ||
      Math.abs(output.positions[i + 2]) > 9
    )
      near(output.positions[i + 1], 5.5);
});
test('UV coordinates retain their exact source affine mapping', () => {
  for (let i = 0; i < output.positions.length; i += 3) {
    near(output.attributes.uv.array[(i / 3) * 2], output.positions[i] / 3);
    near(
      output.attributes.uv.array[(i / 3) * 2 + 1],
      output.positions[i + 2] / 3,
    );
  }
});
test('upper paths/upper asphalt are rejected as correction sources and geometries are untouched', () => {
  const r = source(road),
    p = source(path, 'path', { protectedSurface: true }),
    before = JSON.stringify([r, p]);
  const pl = prepare([r, source(road, 'asphalt', { level: 'upper' })], [p], {
    bounds: scope,
  });
  assert.equal(pl.constraints.length, 0);
  assert.equal(pl.protectedSkipped, 2);
  assert.deepEqual(lower({ positions: road }, pl).positions, road);
  assert.equal(JSON.stringify([r, p]), before);
});
test('an actual clipping of a live blend perimeter fails explicitly', () => {
  assert.throws(
    () =>
      prepare([source(road)], [source(path, 'path')], {
        bounds: [-3, -4, 3, 4],
      }),
    /truncate/,
  );
});
test('a shared original City triangle edge has no conflicting output vertex height', () => {
  const vertices = new Map();
  let duplicates = 0;
  for (let i = 0; i < output.positions.length; i += 3) {
    const k = `${output.positions[i].toFixed(7)},${output.positions[i + 2].toFixed(7)}`;
    if (vertices.has(k)) {
      duplicates++;
      near(vertices.get(k), output.positions[i + 1], 1e-8);
    } else vertices.set(k, output.positions[i + 1]);
  }
  assert.ok(duplicates > 100);
  assert.ok(output.statistics.maximumSharedVertexYDifferenceM < 1e-8);
});
test('every geometrically shared edge is conforming and boundary height interpolation agrees', () => {
  const p = output.positions,
    vs = new Map();
  for (let i = 0; i < p.length; i += 3)
    vs.set(`${p[i].toFixed(7)},${p[i + 2].toFixed(7)}`, [
      p[i],
      p[i + 1],
      p[i + 2],
    ]);
  const points = [...vs.values()];
  let mismatch = 0;
  for (let i = 0; i < p.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const a = i + j * 3,
        b = i + ((j + 1) % 3) * 3,
        dx = p[b] - p[a],
        dz = p[b + 2] - p[a + 2],
        n = dx * dx + dz * dz;
      if (n < 1e-12) continue;
      for (const q of points) {
        const u = ((q[0] - p[a]) * dx + (q[2] - p[a + 2]) * dz) / n;
        if (
          u <= 1e-7 ||
          u >= 1 - 1e-7 ||
          Math.abs(dx * (q[2] - p[a + 2]) - dz * (q[0] - p[a])) / Math.sqrt(n) >
            1e-7
        )
          continue;
        mismatch = Math.max(
          mismatch,
          Math.abs(q[1] - (p[a + 1] + u * (p[b + 1] - p[a + 1]))),
        );
      }
    }
  assert.ok(mismatch < 1e-7, `nonconforming height step ${mismatch}`);
});

test('overlapping shoreline sheets with different original heights are not welded into an upward step', () => {
  const second = rect(-12, -12, 12, 12, (x, z) => 5.5 + x * 0.002 + z * 0.001),
    stacked = [...road, ...second],
    p = prepare([source(stacked)], [source(path, 'path')], { bounds: scope }),
    r = lower({ positions: stacked }, p);
  assert.equal(r.statistics.maximumUpwardChangeM, 0);
  assert.ok(r.statistics.maximumSharedVertexYDifferenceM < 1e-6);
  near(r.statistics.outputPlanAreaM2, 1152, 1e-6);
});
