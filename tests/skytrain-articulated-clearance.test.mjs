import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { stationSolidIndex } from './helpers/station-solid-index.mjs';
import {
  routes,
  ridePath,
  stationOwner,
  actualTrain,
  actualTunnel,
  tunnelIndex,
  resourceDisposals,
} from './helpers/skytrain-geometry.mjs';

function label(segment, progress, car) {
  return `${segment.lineId}:${segment.from}→${segment.to} u=${progress.toFixed(6)} car=${car}`;
}
function cabinBox(train, line) {
  const half = line === 'expo' ? 8.5 : 10;
  return new THREE.Box3(
    new THREE.Vector3(-1.3, train.floorAboveRail + 0.15, -half),
    new THREE.Vector3(1.3, 3.5, half),
  );
}

test('all actual articulated cars and the occupied eye remain inside the emitted tunnel on every underground direction', async () => {
  let segments = 0,
    samples = 0;
  for (const line of ['expo', 'canada']) {
    const train = await actualTrain(line),
      assertTrainDisposed = resourceDisposals(train.group);
    try {
      const box = cabinBox(train, line),
        eye = new THREE.Vector3(),
        quaternion = new THREE.Quaternion();
      for (const segment of routes.segments.filter(
        (s) =>
          s.lineId === line &&
          s.from !== 'main-street-science-world' &&
          s.to !== 'main-street-science-world',
      )) {
        const path = ridePath(segment),
          tube = actualTunnel(path),
          assertTubeDisposed = resourceDisposals(tube.group),
          index = tunnelIndex(tube.group),
          steps = Math.ceil(path.length / 2);
        try {
          for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            train.setPathPose(path, u);
            train.passengerWorldPose(eye, quaternion);
            assert(eye.toArray().every(Number.isFinite), label(segment, u, 0));
            assert(
              quaternion.toArray().every(Number.isFinite),
              label(segment, u, 0),
            );
            assert(
              Math.abs(quaternion.length() - 1) < 1e-5,
              label(segment, u, 0),
            );
            assert(
              index.eyeInside(eye),
              `${label(segment, u, 0)} occupied eye escaped tube`,
            );
            for (let car = 0; car < train.carFrames.length; car++) {
              const matrix = train.carFrames[car].matrixWorld;
              assert(
                matrix.elements.every(Number.isFinite),
                label(segment, u, car),
              );
              assert(
                Math.abs(matrix.determinant() - 1) < 1e-5,
                label(segment, u, car),
              );
              assert(
                !index.intersects(box, matrix),
                `${label(segment, u, car)} actual tunnel triangle enters upper cabin`,
              );
            }
            samples++;
          }
          segments++;
        } finally {
          tube.dispose();
          tube.dispose();
          assertTubeDisposed();
        }
      }
    } finally {
      train.dispose();
      train.dispose();
      assertTrainDisposed();
    }
  }
  assert.equal(segments, 10);
  assert(samples > 3000);
});

test('all 24 actual station approaches retain clear articulated cabins, occupied eyes and overlapping rail buffers', async () => {
  let approaches = 0;
  for (const line of ['expo', 'canada']) {
    const train = await actualTrain(line),
      assertTrainDisposed = resourceDisposals(train.group);
    try {
      const localBox = cabinBox(train, line),
        centre = localBox.getCenter(new THREE.Vector3()),
        half = localBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      for (const segment of routes.segments.filter((s) => s.lineId === line)) {
        const path = ridePath(segment),
          firstTubeSample = (5 * path.length) / Math.ceil(path.length / 8);
        for (const side of ['start', 'end']) {
          const owner = stationOwner(
              side === 'start' ? segment.from : segment.to,
            ),
            assertOwnerDisposed = resourceDisposals(owner.group);
          try {
            owner.group.updateMatrixWorld(true);
            const inverseOwner = owner.group.matrixWorld.clone().invert(),
              solids = stationSolidIndex(owner.group),
              platform = owner.platform(line, segment.direction);
            assert(
              firstTubeSample < platform.length / 2 + 25,
              `${segment.from}/${segment.to}/${side} uncovered portal gap`,
            );
            for (const part of owner.geometryData.parts.filter(
              (part) => part.renderFloorSurfaceId,
            ))
              assert(
                solids.triangleParts.some(
                  (rendered) => rendered.id === part.id,
                ),
                `${owner.data.id}: exact rendered floor ${part.id} is included in actual train clearance`,
              );
            const distance = Math.min(180, path.length * 0.45),
              steps = Math.ceil(distance / 2);
            for (let i = 0; i <= steps; i++) {
              const metres = (distance * i) / steps,
                u =
                  side === 'start'
                    ? metres / path.length
                    : 1 - metres / path.length;
              train.setPathPose(path, u);
              // The source interior is retired at8%; the arriving interior is
              // already preloaded before this final180m envelope.
              if (side === 'start' && u >= 0.08) continue;
              const eye = new THREE.Vector3(),
                eyeQ = new THREE.Quaternion();
              train.passengerWorldPose(eye, eyeQ);
              const eyeBox = new OBB(
                new THREE.Vector3(...owner.toLocal(eye.toArray())),
                new THREE.Vector3(0.08, 0.08, 0.08),
              );
              const eyeHit = solids.firstIntersection(eyeBox);
              assert.equal(
                eyeHit,
                null,
                `${label(segment, u, 0)} eye hit ${side}:${eyeHit}`,
              );
              for (let car = 0; car < train.carFrames.length; car++) {
                const matrix = new THREE.Matrix4().multiplyMatrices(
                    inverseOwner,
                    train.carFrames[car].matrixWorld,
                  ),
                  cabin = new OBB(centre.clone(), half.clone()).applyMatrix4(
                    matrix,
                  );
                const cabinHit = solids.firstIntersection(cabin);
                assert.equal(
                  cabinHit,
                  null,
                  `${label(segment, u, car)} cabin hit ${side}:${cabinHit}`,
                );
              }
            }
            approaches++;
          } finally {
            owner.dispose();
            owner.dispose();
            assertOwnerDisposed();
          }
        }
      }
    } finally {
      train.dispose();
      train.dispose();
      assertTrainDisposed();
    }
  }
  assert.equal(approaches, 24);
});

test('merged authored floor triangles remain physical clearance obstacles with their real holes and transforms', () => {
  const group = new THREE.Group(),
    geometry = new THREE.BufferGeometry();
  // Two separated slabs leave a real central opening. A single bounds box
  // would seal that hole; skipping non-instanced geometry misses both slabs.
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        -4, 1, -2, -2, 1, -2, -2, 1, 2, -4, 1, -2, -2, 1, 2, -4, 1, 2, 2, 1, -2,
        4, 1, -2, 4, 1, 2, 2, 1, -2, 4, 1, 2, 2, 1, 2,
      ],
      3,
    ),
  );
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material);
  mesh.userData.stationTrianglePartIds = [
    'floor-left',
    'floor-left',
    'floor-right',
    'floor-right',
  ];
  mesh.rotation.y = 0.43;
  mesh.position.set(7, 2, -3);
  group.position.set(-9, 11, 4);
  group.rotation.y = -0.6;
  group.add(mesh);
  group.updateMatrixWorld(true);
  const index = stationSolidIndex(group),
    boxAt = (x) =>
      new OBB(
        new THREE.Vector3(x, 1, 0),
        new THREE.Vector3(0.2, 0.2, 0.2),
      ).applyMatrix4(mesh.matrix);
  assert.equal(index.triangleParts.length, 2);
  assert.equal(index.firstIntersection(boxAt(-3)), 'floor-left');
  assert.equal(index.firstIntersection(boxAt(3)), 'floor-right');
  assert.equal(
    index.firstIntersection(boxAt(0)),
    null,
    'actual opening stays clear',
  );
  const eye = boxAt(-3);
  eye.halfSize.set(0.08, 0.08, 0.08);
  assert.equal(index.firstIntersection(eye), 'floor-left');
  const solidGeometry = new THREE.BoxGeometry(2, 0.6, 2).toNonIndexed(),
    solid = new THREE.Mesh(solidGeometry, material);
  solid.position.set(-3, 1, 0);
  solid.userData.stationTrianglePartIds = Array(
    solidGeometry.getAttribute('position').count / 3,
  ).fill('closed-floor');
  const closedGroup = new THREE.Group();
  closedGroup.add(solid);
  assert.equal(
    stationSolidIndex(closedGroup).firstIntersection(
      new OBB(new THREE.Vector3(-3, 1, 0), new THREE.Vector3(0.08, 0.08, 0.08)),
    ),
    'closed-floor',
    'an occupied eye wholly inside a closed slab must not disappear between its faces',
  );
  solidGeometry.dispose();
  mesh.userData.stationTrianglePartIds.pop();
  assert.throws(() => stationSolidIndex(group), /provenance/);
  geometry.dispose();
  material.dispose();
});
