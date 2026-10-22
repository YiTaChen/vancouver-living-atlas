import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));

function mesh(positions, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (indices) geometry.setIndex(indices);
  return new THREE.Mesh(geometry);
}
const box = (min, max) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

test('triangle query honors world transforms and draw range, without exposing cached vectors', () => {
  const surface = mesh(
    [0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 2],
    [0, 1, 2, 0, 2, 3],
  );
  surface.geometry.setDrawRange(3, 3);
  surface.position.set(64, 0.15, -64);
  surface.scale.set(2, 1, 0.5);
  const group = new THREE.Group();
  group.position.y = 7;
  group.add(surface);
  const index = new GroundSurfaceIndex([surface, surface]);
  const query = box([63, 7, -65], [69, 8, -62]);
  const [triangle] = index.trianglesInBounds(query);
  assert.deepEqual(
    triangle.map((point) => point.toArray()),
    [
      [64, 7.15, -64],
      [68, 7.15, -63],
      [64, 7.15, -63],
    ],
  );
  assert.equal(index.trianglesInBounds(query).length, 1);
  assert.notEqual(triangle[0], triangle[1]);
  triangle[0].set(-999, -999, -999);
  assert.deepEqual(
    index.trianglesInBounds(query)[0][0].toArray(),
    [64, 7.15, -64],
  );
  assert.equal(index.sample(65, -63.5, 7), 7.15);
});

test('candidate query deduplicates faces across grid cells and filters all three axes', () => {
  const large = mesh([-70, 0.2, -70, 70, 0.2, -70, 0, 0.2, 70]);
  const high = mesh([-70, 5, -70, 70, 5, -70, 0, 5, 70]);
  const remote = mesh([120, 0.2, 120, 121, 0.2, 120, 120, 0.2, 121]);
  const index = new GroundSurfaceIndex([large, high, remote]);
  const candidates = index.trianglesInBounds(box([-66, 0, -66], [66, 1, 66]));
  assert.equal(candidates.length, 1);
  assert(candidates[0].every((point) => Math.abs(point.y - 0.2) < 1e-7));
  assert.equal(
    index.trianglesInBounds(box([65, 0, 65], [66, 1, 66])).length,
    1,
  );
  assert.equal(
    index.trianglesInBounds(box([71, 0, 71], [72, 1, 72])).length,
    0,
  );
  assert.equal(index.trianglesInBounds(box([-1, 1, -1], [1, 4, 1])).length, 0);
});

test('vertical thin curb risers remain queryable between height samples', () => {
  const pavement = mesh([-2, 0, -2, 2, 0, -2, 0, 0, 2]);
  const curb = mesh(
    [0.47, 0, -0.5, 0.47, 0.2, -0.5, 0.47, 0.2, 0.5, 0.47, 0, 0.5],
    [0, 1, 2, 0, 2, 3],
  );
  const index = new GroundSurfaceIndex([pavement, curb]);
  assert.equal(index.sample(0.4, 0, 0), 0);
  assert.equal(index.sample(0.5, 0, 0), 0);
  assert.equal(index.sample(0.47, 0, 0), 0);
  const risers = index.trianglesInBounds(
    box([0.46, 0.05, -0.1], [0.48, 0.15, 0.1]),
  );
  assert.equal(risers.length, 2);
  assert(risers.flat().every((point) => Math.abs(point.x - 0.47) < 1e-7));
  assert.equal(new GroundSurfaceIndex([curb]).sample(0.47, 0, 0), undefined);
});

test('explicit obstruction-only curb caps are queryable without becoming walking floors', () => {
  const pavement = mesh([-2, 0, -2, 2, 0, -2, 0, 0, 2]);
  const curbCap = mesh([0.4, 0.2, -0.5, 0.6, 0.2, -0.5, 0.5, 0.25, 0.5]);
  const index = new GroundSurfaceIndex([pavement], [curbCap, curbCap]);
  assert.equal(index.sample(0.5, 0, 0), 0);
  assert.equal(
    index.trianglesInBounds(box([0.4, 0.15, -0.1], [0.6, 0.3, 0.1])).length,
    1,
  );
  // A face deliberately supplied as a walking floor still has height priority,
  // even if it is also in a source's obstruction list.
  const shared = new GroundSurfaceIndex([pavement, curbCap], [curbCap]);
  assert(Math.abs(shared.sample(0.5, 0, 0) - 0.225) < 1e-7);
});

test('degenerate and nonfinite faces are omitted, while invalid or empty queries are safe', () => {
  const degenerate = mesh([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  const invalid = mesh([0, 0, 0, NaN, 0, 0, 0, 0, 1]);
  const valid = mesh([0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const index = new GroundSurfaceIndex([degenerate, invalid, valid]);
  assert.equal(index.trianglesInBounds(box([-1, -1, -1], [2, 2, 2])).length, 1);
  for (const query of [
    new THREE.Box3(),
    box([2, 2, 2], [1, 1, 1]),
    box([NaN, 0, 0], [1, 1, 1]),
    box([-Infinity, 0, 0], [1, 1, 1]),
    box([1e30, 0, 0], [1e30, 1, 1]),
  ])
    assert.deepEqual(index.trianglesInBounds(query), []);
});
