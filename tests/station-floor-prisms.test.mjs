import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildWaterfront } from '../tools/station-interiors/waterfront.mjs';
const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);

function fixture() {
  const data = JSON.parse(
    readFileSync('public/models/skytrain-stations/burrard.json'),
  );
  data.authoredInterior = {
    revision: 'exact-prism-fixture',
    dimensions: 'representative',
    references: [
      {
        url: 'https://www.translink.ca/',
        note: 'Geometry regression fixture.',
      },
    ],
  };
  data.floors.push({
    id: 'fixture-miter',
    level: 'fixture-miter',
    kind: 'corridor',
    vertices: [
      [-2, 1, -3],
      [-3, 2, 3],
      [3, 2, 4],
      [2, 1, -2],
    ],
    indices: [0, 1, 2, 0, 2, 3],
  });
  data.parts = [
    {
      id: 'fixture-prism',
      position: [0, 1.35, 0],
      size: [6, 0.3, 8],
      yaw: 13,
      material: 'floor',
      role: 'floor',
      renderFloorSurfaceId: 'fixture-miter',
    },
    {
      id: 'fixture-ordinary-box',
      position: [8, 0, 0],
      size: [2, 0.3, 3],
      yaw: 31,
      material: 'floor',
      role: 'floor',
    },
  ];
  data.obstacles = [];
  data.exclusions = [];
  data.signs = [];
  return data;
}
const vertex = (p) => new THREE.Vector3(...p);
const mergedFloor = (owner) =>
  owner.group.children.find((m) => m.userData.stationPartRanges);
function hits(owner, mesh, point, direction, far = 2) {
  owner.group.updateMatrixWorld(true);
  return new THREE.Raycaster(
    vertex(owner.toWorld(point.toArray())),
    direction.clone().transformDirection(owner.group.matrixWorld),
    0,
    far,
  ).intersectObject(mesh);
}
const close = (a, b, epsilon = 2e-5) =>
  assert(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('explicit floor prisms match nonplanar walking triangles, close sides and undersides, and share the ordinary box draw batch', () => {
  const data = fixture(),
    owner = new SkyTrainStationOwner(data, () => 0),
    ordinary = structuredClone(data);
  delete ordinary.parts[0].renderFloorSurfaceId;
  const before = new SkyTrainStationOwner(ordinary, () => 0);
  try {
    const mesh = mergedFloor(owner),
      floor = data.floors.find((f) => f.id === 'fixture-miter');
    assert(
      mesh instanceof THREE.Mesh && !(mesh instanceof THREE.InstancedMesh),
    );
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.geometry.index, null);
    assert.equal(mesh.userData.stationPartRanges.length, 2);
    assert.equal(
      mesh.userData.stationTrianglePartIds.length,
      mesh.geometry.attributes.position.count / 3,
    );
    assert.equal(
      owner.stats().drawCalls,
      before.stats().drawCalls,
      'exact floor geometry does not add a material draw',
    );
    const range = mesh.userData.stationPartRanges.find(
      (p) => p.id === 'fixture-prism',
    );
    assert.equal(
      range.vertexCount / 3,
      12,
      'two top triangles + two bottom triangles + eight outer side triangles; no internal diagonal wall',
    );
    for (let i = 0; i < floor.indices.length; i += 3) {
      const [a, b, c] = floor.indices
        .slice(i, i + 3)
        .map((n) => vertex(floor.vertices[n]));
      for (let u = 0.15; u < 0.85; u += 0.1)
        for (let v = 0.15; v < 0.95 - u; v += 0.1) {
          const p = a
              .clone()
              .multiplyScalar(u)
              .addScaledVector(b, v)
              .addScaledVector(c, 1 - u - v),
            top = hits(
              owner,
              mesh,
              p.clone().add(new THREE.Vector3(0, 0.6, 0)),
              new THREE.Vector3(0, -1, 0),
            )[0],
            bottom = hits(
              owner,
              mesh,
              p.clone().add(new THREE.Vector3(0, -0.6, 0)),
              new THREE.Vector3(0, 1, 0),
            )[0];
          assert(top && bottom);
          close(top.distance, 0.6);
          close(bottom.distance, 0.3);
          assert(top.face.normal.y > 0.5 && bottom.face.normal.y < -0.5);
          assert.equal(
            mesh.userData.stationTrianglePartIds[top.faceIndex],
            'fixture-prism',
          );
        }
    }
    for (let i = 0; i < floor.vertices.length; i++) {
      const a = vertex(floor.vertices[i]),
        b = vertex(floor.vertices[(i + 1) % floor.vertices.length]),
        edge = b.clone().sub(a),
        normal = new THREE.Vector3(-edge.z, 0, edge.x).normalize(),
        midpoint = a
          .add(b)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, -0.15, 0)),
        side = hits(
          owner,
          mesh,
          midpoint.clone().addScaledVector(normal, 0.6),
          normal.clone().negate(),
        )[0];
      assert(side, 'every physical boundary has an opaque slab side');
      close(side.distance, 0.6);
      assert(Math.abs(side.face.normal.y) < 1e-5);
    }
    const boxTop = hits(
      owner,
      mesh,
      new THREE.Vector3(8, 1, 0),
      new THREE.Vector3(0, -1, 0),
    )[0];
    close(boxTop.distance, 0.85);
    assert.equal(
      mesh.userData.stationTrianglePartIds[boxTop.faceIndex],
      'fixture-ordinary-box',
    );
    for (const normal of mesh.geometry.attributes.normal.array)
      assert(Number.isFinite(normal));
    let geometryDisposals = 0,
      materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
    owner.dispose();
    owner.dispose();
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
  } finally {
    owner.dispose();
    before.dispose();
  }
});

test('floor prisms preserve actual stairwell holes instead of filling their bounding rectangle', () => {
  const data = fixture(),
    floor = data.floors.find((f) => f.id === 'fixture-miter');
  floor.vertices = [
    [-3, 1, -3],
    [-3, 1, 3],
    [3, 1, 3],
    [3, 1, -3],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, 1, 1],
    [1, 1, -1],
  ];
  floor.indices = [
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ];
  const owner = new SkyTrainStationOwner(data, () => 0);
  try {
    const mesh = mergedFloor(owner);
    assert.equal(
      hits(
        owner,
        mesh,
        new THREE.Vector3(0, 2, 0),
        new THREE.Vector3(0, -1, 0),
        3,
      ).length,
      0,
    );
    const lip = hits(
      owner,
      mesh,
      new THREE.Vector3(0, 0.85, 0),
      new THREE.Vector3(1, 0, 0),
    )[0];
    assert(lip);
    close(lip.distance, 1);
    assert.equal(
      mesh.userData.stationTrianglePartIds[lip.faceIndex],
      'fixture-prism',
    );
  } finally {
    owner.dispose();
  }
});

test('explicit render floor metadata is preserved, validates strictly, and does not reinterpret legacy cut ownership', () => {
  const source = JSON.parse(readFileSync(SOURCE)).stations.find(
      (s) => s.stationId === 'waterfront',
    ),
    part = source.geometryParts.find((p) => p.role === 'floor');
  part.renderFloorSurfaceId = source.floorSurfaces[0].surfaceId;
  part.floorSurfaceId = 'legacy-cut-piece-ownership';
  const compiled = makeRuntimeStation(source, '0'.repeat(64)),
    runtimePart = compiled.parts.find((p) => p.id === part.id);
  assert.equal(runtimePart.renderFloorSurfaceId, part.renderFloorSurfaceId);
  assert(!('floorSurfaceId' in runtimePart));
  for (const mutate of [
    (d) => (d.parts[0].renderFloorSurfaceId = 'missing-floor'),
    (d) => (d.parts[0].renderFloorSurfaceId = ''),
    (d) => (d.parts[0].renderFloorSurfaceId = null),
    (d) => (d.parts[0].renderFloorSurfaceId = 42),
    (d) => (d.parts[0].role = 'wall'),
    (d) => (d.floors.find((f) => f.id === 'fixture-miter').indices = [0, 0, 0]),
    (d) => (d.parts[1].renderFloorSurfaceId = d.parts[0].renderFloorSurfaceId),
  ]) {
    const invalid = fixture();
    mutate(invalid);
    assert.throws(() => validateRuntimeStation(invalid));
  }
  const legacy = fixture();
  delete legacy.parts[0].renderFloorSurfaceId;
  legacy.parts[0].floorSurfaceId = 'fixture-miter';
  const owner = new SkyTrainStationOwner(legacy, () => 0);
  try {
    assert(
      !mergedFloor(owner),
      'old cut-piece metadata never duplicates the full floor',
    );
  } finally {
    owner.dispose();
  }
});

test('actual Waterfront graded miter slabs match every sampled walking triangle without a rendered lip or missing wedge', () => {
  const source = JSON.parse(readFileSync(SOURCE)).stations.find(
      (s) => s.stationId === 'waterfront',
    ),
    built = rebuildWaterfront(source),
    data = makeRuntimeStation(built, '0'.repeat(64)),
    owner = new SkyTrainStationOwner(data, () => 0),
    floors = data.floors.filter((f) =>
      f.id.startsWith('waterfront-under-cordova-passage-'),
    );
  try {
    const mesh = owner.group.children.find((m) =>
      m.userData.stationPartRanges?.some(
        (p) => p.renderFloorSurfaceId === floors[0].id,
      ),
    );
    assert(mesh, 'source explicitly declares exact floor-surface rendering');
    assert(owner.stats().drawCalls <= 32);
    assert(floors.length >= 3);
    let sampled = 0;
    for (const floor of floors)
      for (let i = 0; i < floor.indices.length; i += 3) {
        const [a, b, c] = floor.indices
          .slice(i, i + 3)
          .map((n) => vertex(floor.vertices[n]));
        for (let u = 0.1; u < 0.95; u += 0.1)
          for (let v = 0.1; v < 0.95 - u; v += 0.1) {
            const p = a
                .clone()
                .multiplyScalar(u)
                .addScaledVector(b, v)
                .addScaledVector(c, 1 - u - v),
              rendered = hits(
                owner,
                mesh,
                p.clone().add(new THREE.Vector3(0, 0.6, 0)),
                new THREE.Vector3(0, -1, 0),
              ).filter((h) =>
                mesh.userData.stationTrianglePartIds[h.faceIndex]?.startsWith(
                  'floor-waterfront-under-cordova-passage-',
                ),
              )[0];
            assert(
              rendered,
              `${floor.id}: exact visible support at ${p.toArray()}`,
            );
            close(rendered.distance, 0.6);
            sampled++;
          }
      }
    assert(sampled >= 200);
  } finally {
    owner.dispose();
  }
});
