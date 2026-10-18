import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { teslaTyreSupportHeight: support } = await import(
  cityModule('tesla-tyre-support')
);
const radius = 0.35;
function rectangle(x0, x1, z0, z1, y = 0, grade = 0) {
  const points = [
    [x0, y + grade * z0, z0],
    [x1, y + grade * z0, z0],
    [x1, y + grade * z1, z1],
    [x0, y + grade * z1, z1],
  ];
  return [
    [points[0], points[1], points[2]],
    [points[0], points[2], points[3]],
  ];
}
const query = (triangles, overrides = {}) => ({
  triangles,
  positionXZ: [0, 0],
  headingXZ: [0, 1],
  radius,
  minY: -10,
  maxY: 10,
  baseHeight: 0,
  ...overrides,
});
const close = (actual, expected, message = '', tolerance = 1e-12) => {
  assert.notEqual(actual, null, message);
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} != ${expected}`,
  );
};
function curb(edge, rise = 0.13) {
  return [...rectangle(-5, 5, -5, edge), ...rectangle(-5, 5, edge, 5, rise)];
}

test('a 13 cm curb raises a 35 cm circle continuously before its axle crosses', () => {
  const onset = Math.sqrt(2 * radius * 0.13 - 0.13 ** 2);
  for (const edge of [0.34, onset, 0.25, 0.2, 0.1, 0]) {
    const expected = Math.max(
      0,
      0.13 + Math.sqrt(radius ** 2 - edge ** 2) - radius,
    );
    close(support(query(curb(edge))), expected, `edge ${edge}`);
  }
  close(support(query(curb(-0.1), { baseHeight: 0.13 })), 0.13);
});

test('finite triangle edges and arbitrarily narrow intervals use their analytic maximum', () => {
  const flat = rectangle(-5, 5, -5, 5);
  const z0 = 0.101234567,
    z1 = z0 + 1e-8;
  close(
    support(query([...flat, ...rectangle(-0.1, 0.1, z0, z1, 0.13)])),
    0.13 + Math.sqrt(radius ** 2 - z0 ** 2) - radius,
    'a tiny strip between any practical probe samples',
  );
  const triangle = [
    [-0.2, 0.13, 0.1],
    [0.2, 0.13, 0.3],
    [0.2, 0.13, 0.1],
  ];
  close(
    support(query([...flat, triangle])),
    0.13 + Math.sqrt(radius ** 2 - 0.1 ** 2) - radius,
    'clipped finite triangle edge',
  );
});

test('the tread has no lateral sphere radius and never extrapolates a triangle plane', () => {
  const flat = rectangle(-5, 5, -5, 5);
  close(support(query([...flat, ...rectangle(0.01, 0.1, -0.1, 0.1, 0.13)])), 0);
  close(
    support(query([...flat, ...rectangle(-0.1, 0.1, radius + 1e-7, 1, 0.13)])),
    0,
  );
  close(
    support(
      query([
        ...flat,
        [
          [0.01, 0.13, 0],
          [0.02, 0.13, 0.01],
          [0.02, 0.13, -0.01],
        ],
      ]),
    ),
    0,
  );
});

test('matching pure pitches retain their exact physical grade with either heading sign', () => {
  for (const grade of [-0.4, -0.16, -0.08, 0, 0.08, 0.16, 0.4]) {
    for (const z of [-4, 0, 4]) {
      for (const sign of [-1, 1]) {
        const baseHeight = 2 + grade * z;
        close(
          support(
            query(rectangle(-5, 5, -10, 10, 2, grade), {
              positionXZ: [0, z],
              headingXZ: [0, 7 * sign],
              baseHeight,
              longitudinalGrade: grade * sign,
            }),
          ),
          baseHeight,
          `${grade} / ${z} / ${sign}`,
        );
      }
    }
  }
});

test('the interior optimum of a finite sloped floor is solved without samples', () => {
  const grade = 0.2,
    points = rectangle(-5, 5, -0.2, 0.2, 0.03, grade),
    expected = 0.03 + radius * Math.hypot(1, grade) - radius;
  close(support(query(points, { baseHeight: 0.03 })), expected);
  close(
    support(
      query(
        points.map((triangle) => [...triangle].reverse()),
        { baseHeight: 0.03 },
      ),
    ),
    expected,
  );
});

test('headings, translation and triangle tessellation preserve the same physical result', () => {
  const angle = 0.713,
    dx = Math.sin(angle),
    dz = Math.cos(angle),
    transform = ([x, y, z]) => [
      100000 + x * dz + z * dx,
      y + 30,
      -200000 - x * dx + z * dz,
    ],
    triangles = curb(0.2),
    expected = support(query(triangles));
  close(
    support(
      query(
        triangles.map((t) => t.map(transform)),
        {
          positionXZ: [100000, -200000],
          headingXZ: [dx * 12, dz * 12],
          minY: 20,
          maxY: 40,
          baseHeight: 30,
        },
      ),
    ),
    30 + expected,
    'rotation/translation',
    1e-10,
  );
  const subdivided = triangles.flatMap(([a, b, c]) => {
    const m = a.map((value, i) => (value + b[i]) / 2);
    return [
      [a, m, c],
      [m, b, c],
    ];
  });
  close(support(query(subdivided)), expected, 'subdivision');
  close(support(query([...triangles].reverse())), expected, 'face order');
});

test('height bounds and the bounded step policy never admit a taller curb or upper floor', () => {
  const flat = rectangle(-5, 5, -5, 5);
  for (const rise of [0.160001, 0.2, 1, 5])
    close(
      support(query([...flat, ...rectangle(-1, 1, 0.01, 3, rise)])),
      0,
      `rise ${rise}`,
    );
  close(support(query(curb(0.1), { maxStepHeight: 0.1 })), 0);
  close(support(query(curb(0.1), { maxY: 0.12 })), 0);
  close(
    support(query(curb(0.1), { minY: 0.01, baseHeight: 0.02 })),
    0.13 + Math.sqrt(radius ** 2 - 0.1 ** 2) - radius,
  );
});

test('empty or irrelevant triangles cannot synthesize a missing floor proof', () => {
  assert.equal(support(query([])), null);
  assert.equal(support(query(rectangle(2, 3, 2, 3))), null);
  assert.equal(
    support(
      query([
        [
          [0, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      ]),
    ),
    null,
  );
});

test('non-finite or invalid query data fail closed and inputs remain immutable', () => {
  const triangles = curb(0.2);
  const original = structuredClone(triangles);
  for (const overrides of [
    { radius: 0 },
    { radius: -1 },
    { radius: NaN },
    { radius: Infinity },
    { headingXZ: [0, 0] },
    { headingXZ: [Infinity, 1] },
    { positionXZ: [NaN, 0] },
    { baseHeight: NaN },
    { minY: 1 },
    { maxY: -1 },
    { longitudinalGrade: Infinity },
    { maxStepHeight: -1 },
    { maxStepHeight: 0.16001 },
  ])
    assert.equal(support(query(triangles, overrides)), null);
  assert.equal(
    support(
      query([
        [
          [0, 0, 0],
          [1, NaN, 0],
          [0, 0, 1],
        ],
      ]),
    ),
    null,
  );
  support(query(triangles));
  assert.deepEqual(triangles, original);
});
