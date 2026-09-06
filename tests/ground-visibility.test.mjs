import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { reconcileGroundVisibility: run, compareGroundHeights: compare } =
  await import(cityModule('ground-visibility'));
const { applyGroundVisibility: apply } = await import(
  cityModule('ground-visibility-mesh')
);
const bbox = [-20, -20, 20, 20],
  flat = (p, y) =>
    p.flatMap(([x, z]) => [x, typeof y === 'function' ? y(x, z) : y, z]);
const tri = flat(
  [
    [0, 0],
    [0, 10],
    [10, 0],
  ],
  10,
);
const cover = (positions, id = 'ground', extra = {}) => ({
  positions,
  id,
  kind: 'path',
  level: 'ground',
  ...extra,
});
const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 9)
    a +=
      Math.abs(
        (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) -
          (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]),
      ) / 2;
  return a;
};
const near = (a, b, tol = 1e-7) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
test('clip a fully occluded interior footprint; preserve original terrain outside and pavement bytes', () => {
  const paving = new Float32Array(
      flat(
        [
          [2, 2],
          [2, 4],
          [4, 2],
        ],
        8,
      ),
    ),
    before = Array.from(paving);
  const r = run({ positions: tri }, [cover(paving)], { bounds: bbox });
  near(r.statistics.removedPlanAreaM2, 2);
  near(area(r.positions), 48);
  assert.deepEqual(Array.from(paving), before);
  assert.ok(
    r.positions
      .filter((_, i) => i % 3 === 1)
      .every((y) => Math.abs(y - 10) < 1e-10),
  );
  assert.equal(compare(r.positions, paving, bbox).areaM2, 0);
});
test('only the actual affine occlusion is clipped; clear terrain beneath the same road remains', () => {
  const terrain = flat(
      [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      (x) => x,
    ),
    paving = flat(
      [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      5,
    );
  const r = run({ positions: terrain }, [cover(paving)], {
    bounds: bbox,
    clearanceM: 0,
  });
  near(r.statistics.removedPlanAreaM2, 12.5);
  near(area(r.positions), 37.5);
  near(compare(r.positions, paving, bbox).maximumDeltaM, 0);
  for (let i = 0; i < r.positions.length; i += 3)
    near(r.positions[i + 1], r.positions[i]);
});
test('proper height clipping detects interference inside overlap where source corners are outside cover', () => {
  const terrain = flat(
      [
        [-10, -10],
        [-10, 20],
        [20, -10],
      ],
      (x, z) => x + z,
    ),
    paving = flat(
      [
        [1, 1],
        [1, 2],
        [2, 1],
      ],
      1,
    );
  const r = run({ positions: terrain }, [cover(paving)], { bounds: bbox });
  near(r.statistics.removedPlanAreaM2, 0.5);
});
test('protected upper floors and explicit upper floor never cut the terrain', () => {
  const all = flat(
    [
      [0, 0],
      [0, 10],
      [10, 0],
    ],
    0,
  );
  const r = run(
    { positions: tri },
    [
      cover(all, 'protected', { protectedSurface: true }),
      cover(all, 'upper', { level: 'upper' }),
    ],
    { bounds: bbox },
  );
  assert.deepEqual(r.positions, tri);
  assert.equal(r.statistics.protectedCoversSkipped, 2);
});
test('clear terrain keeps every original position and attribute byte', () => {
  const color = tri.map((_, i) => i / 100),
    r = run(
      { positions: tri, attributes: { color: { array: color, itemSize: 3 } } },
      [
        cover(
          flat(
            [
              [0, 0],
              [0, 10],
              [10, 0],
            ],
            12,
          ),
        ),
      ],
      { bounds: bbox },
    );
  assert.deepEqual(r.positions, tri);
  assert.deepEqual(r.attributes.color.array, color);
});
test('attributes interpolate on the original plane and original triangle winding stays upward', () => {
  const colors = tri.flatMap((_, i) =>
      i % 3 === 0 ? [tri[i] / 10, tri[i + 2] / 10, 1] : [],
    ),
    r = run(
      { positions: tri, attributes: { color: { array: colors, itemSize: 3 } } },
      [
        cover(
          flat(
            [
              [2, 2],
              [2, 4],
              [4, 2],
            ],
            8,
          ),
        ),
      ],
      { bounds: bbox },
    );
  for (let i = 0; i < r.positions.length; i += 3) {
    near(r.attributes.color.array[i], r.positions[i] / 10);
    near(r.attributes.color.array[i + 1], r.positions[i + 2] / 10);
    near(r.attributes.color.array[i + 2], 1);
  }
  for (let i = 0; i < r.positions.length; i += 9)
    assert.ok(
      (r.positions[i + 3] - r.positions[i]) *
        (r.positions[i + 8] - r.positions[i + 2]) -
        (r.positions[i + 5] - r.positions[i + 2]) *
          (r.positions[i + 6] - r.positions[i]) <
        0,
    );
});
test('overlapping and repeated ground covers are a union, never double-count removed area', () => {
  const c = cover(
      flat(
        [
          [2, 2],
          [2, 4],
          [4, 2],
        ],
        8,
      ),
    ),
    r = run({ positions: tri }, [c, c, c], { bounds: bbox });
  near(r.statistics.removedPlanAreaM2, 2);
  near(area(r.positions), 48);
  assert.ok(r.statistics.maxOriginalTriangleAreaErrorM2 < 1e-8);
});
test('mandatory bounds clip only their actual intersection with pavement', () => {
  const r = run(
    { positions: tri },
    [
      cover(
        flat(
          [
            [0, 0],
            [0, 10],
            [10, 0],
          ],
          8,
        ),
      ),
    ],
    { bounds: [0, 0, 2, 2] },
  );
  near(r.statistics.removedPlanAreaM2, 4);
  near(area(r.positions), 46);
});
test('unrelated Stage 5 beach triangles preserve vertices and colours exactly', () => {
  const beach = flat(
      [
        [100, 100],
        [100, 102],
        [102, 100],
      ],
      0.15,
    ),
    terrain = [...tri, ...beach],
    colors = terrain.map((_, i) => i * 0.001),
    r = run(
      {
        positions: terrain,
        attributes: { color: { array: colors, itemSize: 3 } },
      },
      [
        cover(
          flat(
            [
              [2, 2],
              [2, 4],
              [4, 2],
            ],
            8,
          ),
        ),
      ],
      { bounds: bbox },
    );
  assert.deepEqual(r.positions.slice(-9), beach);
  assert.deepEqual(r.attributes.color.array.slice(-9), colors.slice(-9));
  assert.deepEqual(r.changedTriangles, [0]);
});
test('protected Stage 5 profile stays exact even if a lower City triangle overlaps inside the task region', () => {
  const colors = tri.map((_, i) => i / 100),
    r = run(
      {
        positions: tri,
        attributes: { color: { array: colors, itemSize: 3 } },
        protectedTriangleRanges: [[0, 1]],
      },
      [
        cover(
          flat(
            [
              [0, 0],
              [0, 10],
              [10, 0],
            ],
            8,
          ),
        ),
      ],
      { bounds: bbox },
    );
  assert.deepEqual(r.positions, tri);
  assert.deepEqual(r.attributes.color.array, colors);
  assert.equal(r.changedTriangles.length, 0);
});
test('disjoint local regions do not modify the terrain gap between photo scopes', () => {
  const original = flat(
      [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      10,
    ),
    r = run(
      { positions: original },
      [
        cover(
          flat(
            [
              [0, 0],
              [0, 10],
              [10, 0],
            ],
            8,
          ),
        ),
      ],
      {
        bounds: bbox,
        regions: [
          [0, 0, 1, 1],
          [3, 0, 4, 1],
        ],
      },
    );
  near(r.statistics.removedPlanAreaM2, 2);
  near(area(r.positions), 48);
});
test('exactly coincident ground triangles remove all occluding terrain without degenerate output', () => {
  const r = run({ positions: tri }, [cover(tri)], { bounds: bbox });
  assert.equal(r.positions.length, 0);
  near(r.statistics.removedPlanAreaM2, 50);
});
test('ground City road/path height disagreements are measured without rewriting either surface', () => {
  const asphalt = flat(
      [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      (x) => 5 + x / 10,
    ),
    path = flat(
      [
        [0, 0],
        [0, 10],
        [10, 0],
      ],
      5.5,
    ),
    a = asphalt.slice(),
    b = path.slice();
  const r = compare(asphalt, path, bbox);
  near(r.areaM2, 50);
  near(r.minimumDeltaM, -0.5);
  near(r.maximumDeltaM, 0.5);
  assert.deepEqual(asphalt, a);
  assert.deepEqual(path, b);
});
test('THREE adapter preserves first mesh/material/shadow state, disposes old geometry, and leaves upper geometry intact', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial()),
    group = new THREE.Group();
  group.add(terrain);
  terrain.userData.walkSurface = true;
  terrain.receiveShadow = true;
  let disposed = 0;
  g.addEventListener('dispose', () => disposed++);
  const paving = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          flat(
            [
              [2, 2],
              [2, 4],
              [4, 2],
            ],
            8,
          ),
          3,
        ),
      ),
    ),
    upper = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(tri, 3),
      ),
    );
  upper.userData.protectedSurface = true;
  const mat = terrain.material,
    ug = upper.geometry,
    pg = paving.geometry;
  const r = apply(
    terrain,
    [
      { mesh: paving, id: 'path', kind: 'path' },
      { mesh: upper, id: 'bridge', kind: 'path' },
    ],
    { bounds: bbox },
  );
  near(r.removedPlanAreaM2, 2);
  assert.equal(r.protectedCoversSkipped, 1);
  assert.equal(disposed, 1);
  assert.equal(group.children[0], terrain);
  assert.equal(terrain.material, mat);
  assert.equal(upper.geometry, ug);
  assert.equal(paving.geometry, pg);
  assert.equal(terrain.userData.walkSurface, true);
  assert.equal(terrain.receiveShadow, true);
  assert.throws(() => apply(terrain, [], { bounds: bbox }), /already applied/);
});
