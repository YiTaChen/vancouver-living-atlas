import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const {
  zoomTravel,
  firstPerson,
  TRAVEL_MAP_THRESHOLD,
  LOCAL_MAP_DISTANCE,
  localMapOffset,
} = await import(cityModule('travel-camera'));

test('zoom can leave the eye, return to it, and exit only beyond the local-map threshold', () => {
  let d = 0;
  for (let i = 0; i < 4; i++) d = zoomTravel(d, 1.33).distance;
  assert(d > 4);
  assert(!firstPerson('walk', d));
  for (let i = 0; i < 16; i++) d = zoomTravel(d, 0.75).distance;
  assert.equal(d, 0);
  assert(zoomTravel(d, 1.33).distance > 0);
  assert.equal(zoomTravel(TRAVEL_MAP_THRESHOLD, 1).exit, false);
  assert.equal(zoomTravel(TRAVEL_MAP_THRESHOLD, 1.01).exit, true);
  for (const factor of [NaN, Infinity, -1, 0]) {
    assert.deepEqual(zoomTravel(14, factor), { distance: 14, exit: false });
  }
});

test('local map offset stays 200m from the player for all headings', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 7.1]) {
    const { x, y, z } = localMapOffset(yaw);
    assert(Math.abs(Math.hypot(x, y, z) - LOCAL_MAP_DISTANCE) < 1e-8);
    assert(y > 100 && y < 160);
  }
});

const THREE = await import('three');
const { GroundSurfaceIndex, walkableGroundMeshes } = await import(
  cityModule('ground-surface')
);

test('placement can pick pavement over a clipped terrain opening without claiming an upper floor', () => {
  const scene = new THREE.Scene();
  const face = (y, protectedSurface = false) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-3, y, -3, 0, y, 3, 3, y, -3], 3),
    );
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.userData.walkSurface = true;
    mesh.userData.protectedSurface = protectedSurface;
    return mesh;
  };
  // The original terrain has no face at the picked point after clipping.
  const pavement = face(1.25),
    upper = face(5, true),
    decoration = face(9);
  delete decoration.userData.walkSurface;
  const group = new THREE.Group();
  group.add(pavement, upper, decoration);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const ground = walkableGroundMeshes(scene);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 12, 0),
    new THREE.Vector3(0, -1, 0),
  );
  const picked = ray.intersectObjects(ground, false)[0];
  assert.equal(picked.object, pavement);
  assert.equal(picked.point.y, 1.25);
  assert.equal(
    new GroundSurfaceIndex(ground).sample(0, 0, 1.25),
    picked.point.y,
  );
});
test('Float32 path caps remain queryable within 0.5mm, including adjacent spatial cells', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [60, 8, 0, 63.9998, 8, 0, 63.9998, 8, 10],
      3,
    ),
  );
  const index = new GroundSurfaceIndex([new THREE.Mesh(g)]);
  assert.equal(index.sample(64, 2, 8), 8);
  assert.equal(index.sample(64.001, 2, 8), undefined);
  assert.equal(index.sample(64, 2, 13), undefined);
});
test('walking feet follow actual sloping road triangles and ignore an elevated deck outside the ground layer', () => {
  const triangle = (y) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-10, y, -10, 10, y + 2, -10, 0, y + 1, 10],
        3,
      ),
    );
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  };
  const index = new GroundSurfaceIndex([
    triangle(0),
    triangle(1.18),
    triangle(20),
  ]);
  assert(Math.abs(index.sample(0, 0, 2.25) - 2.18) < 1e-6);
  assert.equal(index.sample(0, 0, 21), 21);
  assert.equal(index.sample(100, 0, 0), undefined);
  assert.equal(index.sample(0, 0, NaN), undefined);
});
