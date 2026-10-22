import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const rectangle = (x0, x1, z0, z1, y) => [
  x0,
  y,
  z0,
  x0,
  y,
  z1,
  x1,
  y,
  z1,
  x0,
  y,
  z0,
  x1,
  y,
  z1,
  x1,
  y,
  z0,
];
function index(positions, transform) {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  transform?.(mesh);
  return {
    road: new GroundSurfaceIndex([mesh]),
    dispose() {
      geometry.dispose();
      mesh.material.dispose();
    },
  };
}

test('local segment coverage joins real adjacent triangles across 64m cells in either direction', () => {
  const f = index(rectangle(62, 66, -2, 2, 1.05));
  try {
    for (const [from, to] of [
      [
        [62.5, 0],
        [65.5, 0],
      ],
      [
        [65.5, 0],
        [62.5, 0],
      ],
    ])
      assert.equal(f.road.coversSegment(from, to, 1.05, 0.01), true);
    assert.equal(f.road.coversSegment([64, 0], [64, 0], 1.05, 0.01), true);
    assert.equal(f.road.coversSegment([60, 0], [60, 0], 1.05, 0.01), false);
  } finally {
    f.dispose();
  }
});

test('2cm and 10cm gaps cannot be hidden between otherwise supported endpoints', () => {
  for (const gap of [0.02, 0.1]) {
    const f = index([
      ...rectangle(-3, 3, -3, 0.08, 1.05),
      ...rectangle(-3, 3, 0.08 + gap, 3, 1.05),
    ]);
    try {
      assert(f.road.sample(0, -0.5, 1.05) !== undefined);
      assert(f.road.sample(0, 0.5, 1.05) !== undefined);
      assert.equal(f.road.sample(0, 0.08 + gap / 2, 1.05), undefined);
      assert.equal(
        f.road.coversSegment([0, -0.5], [0, 0.5], 1.05, 0.01),
        false,
      );
      assert.equal(
        f.road.coversSegment([0, 0.5], [0, -0.5], 1.05, 0.01),
        false,
      );
    } finally {
      f.dispose();
    }
  }
});

test('coverage retains Float32 seam tolerance but requires both finite road endpoints', () => {
  const f = index([
    ...rectangle(-2, 2, -2, 0, 0),
    ...rectangle(-2, 2, 0.0004, 2, 0),
  ]);
  try {
    assert.equal(f.road.coversSegment([0, -1], [0, 1], 0, 0.01), true);
    assert.equal(f.road.coversSegment([0, -1], [0, 2.1], 0, 0.01), false);
    assert.equal(f.road.coversSegment([0, -2.1], [0, 1], 0, 0.01), false);
  } finally {
    f.dispose();
  }
});

test('height-window clipping cannot substitute an upper road layer for a missing lower segment', () => {
  const f = index([
    ...rectangle(-2, 2, -2, 0, 0),
    ...rectangle(-2, 2, 0, 2, 2),
  ]);
  try {
    assert.equal(
      f.road.sample(0, 1, 0),
      2,
      'legacy sample height semantics remain unchanged',
    );
    assert.equal(f.road.coversSegment([0, -1], [0, 1], 0, 0.2), false);
    assert.equal(f.road.coversSegment([0, 0.2], [0, 1], 2, 0.2), true);
    assert.equal(f.road.coversSegment([0, 0.2], [0, 1], 7, 4), false);
  } finally {
    f.dispose();
  }
});

test('curb collision faces cannot supply segment coverage or fill a missing walking floor', () => {
  const meshes = [];
  const source = (positions) => {
    const geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    meshes.push(mesh);
    return mesh;
  };
  try {
    const cap = source(rectangle(0, 0.1, 0, 0.1, 0.2));
    const obstructionOnly = new GroundSurfaceIndex([], [cap]);
    assert.equal(obstructionOnly.sample(1, 1, 0.2), undefined);
    assert.equal(
      obstructionOnly.coversSegment([1, 1], [2, 1], 0.2, 0.01),
      false,
      'a cap elsewhere in the same grid cell cannot cover an unrelated segment',
    );
    assert.equal(
      obstructionOnly.trianglesInBounds(
        new THREE.Box3(
          new THREE.Vector3(-0.01, 0.19, -0.01),
          new THREE.Vector3(0.11, 0.21, 0.11),
        ),
      ).length,
      2,
      'the cap remains available for exact ramp collision tests',
    );

    const riser = source([0, 0.2, 0, 0, 0.4, 0, 0, 0.2, 0.1]);
    assert.equal(
      new GroundSurfaceIndex([riser]).coversSegment([1, 1], [2, 1], 0.2),
      false,
      'a vertical face remains collision-only even in the explicit floor set',
    );

    const floor = source([
      ...rectangle(-2, 2, -2, -0.05, 0.2),
      ...rectangle(-2, 2, 0.05, 2, 0.2),
    ]);
    const gapCap = source(rectangle(-2, 2, -0.05, 0.05, 0.2));
    const mixed = new GroundSurfaceIndex([floor], [gapCap]);
    assert.equal(mixed.coversSegment([0, -1], [0, 1], 0.2, 0.01), false);
    assert.equal(mixed.coversSegment([0, -1], [0, -0.2], 0.2, 0.01), true);
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test('coverage uses transformed world triangles and clips a continuous sloping road', () => {
  const positions = rectangle(-4, 4, -4, 4, 0).map((v, i, a) =>
    i % 3 === 1 ? a[i - 1] * 0.1 : v,
  );
  const f = index(positions, (m) => m.position.set(20, 3, 30));
  try {
    assert.equal(f.road.coversSegment([19, 30], [21, 30], 3, 0.11), true);
    assert.equal(f.road.coversSegment([19, 30], [21, 30], 3, 0.05), false);
  } finally {
    f.dispose();
  }
});

test('invalid, distant, excessive-height and malformed-source queries fail closed', () => {
  const f = index(rectangle(-20, 20, -20, 20, 0)),
    bad = index([NaN, 0, 0, 1, 0, 0, 0, 0, 1]);
  try {
    for (const [from, to, anchor, window] of [
      [[NaN, 0], [1, 0], 0, 4],
      [[0, 0], [Infinity, 0], 0, 4],
      [[0, 0], [17, 0], 0, 4],
      [[1e20, 1e20], [1e20, 1e20], 0, 4],
      [[0, 0], [1, 0], NaN, 4],
      [[0, 0], [1, 0], 0, -1],
      [[0, 0], [1, 0], 0, 5],
    ])
      assert.equal(f.road.coversSegment(from, to, anchor, window), false);
    assert.equal(bad.road.coversSegment([0, 0], [0.1, 0], 0), false);
    assert.equal(
      new GroundSurfaceIndex([]).coversSegment([0, 0], [1, 0], 0),
      false,
    );
  } finally {
    f.dispose();
    bad.dispose();
  }
});

test('overloaded source cells refuse a local proof instead of creating unbounded gate work', () => {
  const triangle = rectangle(-2, 2, -2, 2, 0).slice(0, 9),
    positions = [];
  for (let i = 0; i < 16385; i++) positions.push(...triangle);
  const f = index(positions);
  try {
    assert.equal(f.road.coversSegment([0, 0], [0.1, 0], 0), false);
  } finally {
    f.dispose();
  }
});
