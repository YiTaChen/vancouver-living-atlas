import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { drapeTriangles, gridHeightField, splitGridLine } = await import(
  cityModule('surface-meshing')
);
test('draped triangles preserve area, face up and sample relief within a bounded cell', () => {
  const height = gridHeightField((x, z) => 2 + Math.sin(x / 20) * 3 + z * 0.09);
  const mesh = drapeTriangles(
    [
      [0, 0],
      [100, 0],
      [100, 40],
      [0, 40],
    ],
    [0, 1, 2, 0, 2, 3],
    height,
  );
  let area = 0;
  for (let i = 0; i < mesh.positions.length; i += 9) {
    const t = Array.from({ length: 3 }, (_, j) =>
      mesh.positions.slice(i + j * 3, i + j * 3 + 3),
    );
    const signed =
      (t[1][0] - t[0][0]) * (t[2][2] - t[0][2]) -
      (t[1][2] - t[0][2]) * (t[2][0] - t[0][0]);
    assert(signed < 0);
    area -= signed / 2;
    for (const [x, y, z] of t) {
      assert.equal(y, height(x, z));
      assert(Number.isFinite(y));
    }
    assert(
      Math.max(...t.map((p) => p[0])) - Math.min(...t.map((p) => p[0])) <=
        12 + 1e-8,
    );
    assert(
      Math.max(...t.map((p) => p[2])) - Math.min(...t.map((p) => p[2])) <=
        12 + 1e-8,
    );
  }
  assert(Math.abs(area - 4000) < 1e-6);
  assert.equal(mesh.uv.length, (mesh.positions.length / 3) * 2);
});
test('neighbouring triangles share identical relief samples along their grid-cut boundary', () => {
  const a = drapeTriangles(
    [
      [0, 0],
      [60, 0],
      [60, 60],
    ],
    [0, 1, 2],
    (x, z) => x * z * 0.001,
  );
  const b = drapeTriangles(
    [
      [0, 0],
      [60, 60],
      [0, 60],
    ],
    [0, 1, 2],
    (x, z) => x * z * 0.001,
  );
  const edge = (m) =>
    [
      ...new Set(
        Array.from({ length: m.positions.length / 3 }, (_, i) =>
          m.positions.slice(i * 3, i * 3 + 3),
        )
          .filter(([x, y, z]) => Math.abs(x - z) < 1e-7)
          .map((p) => p.map((n) => n.toFixed(6)).join(',')),
      ),
    ].sort();
  assert.deepEqual(edge(a), edge(b));
});
test('extra T-junction vertices cannot split the shared piecewise-planar height', () => {
  const h = gridHeightField((x, z) => 0.003 * x * z);
  const coarse = drapeTriangles(
    [
      [0, 0],
      [10, 10],
      [0, 10],
    ],
    [0, 1, 2],
    h,
  );
  const fine = drapeTriangles(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 5],
    ],
    [0, 1, 3, 1, 2, 3],
    h,
  );
  const sample = (mesh, x, z) => {
    for (let i = 0; i < mesh.positions.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = mesh.positions.slice(
        i,
        i + 9,
      );
      const den = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const u = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / den,
        v = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / den;
      if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8)
        return ay + u * (by - ay) + v * (cy - ay);
    }
  };
  for (let t = 0; t <= 10; t += 0.25)
    assert(Math.abs(sample(coarse, t, t) - sample(fine, t, t)) < 1e-7);
});
test('curb splits match every height-plane boundary', () => {
  const points = splitGridLine([-4, 1], [29, 17]);
  assert(points.length > 4);
  const h = gridHeightField((x, z) => Math.sin(x / 13) * z);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert(Math.abs(h(...m) - (h(...a) + h(...b)) / 2) < 1e-7);
  }
});
