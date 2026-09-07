import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityModule } from './helpers/city-modules.mjs';
const { FlightWorld } = await import(cityModule('flight-world'));
const building = {
  polygon: [
    [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ],
  ],
  minY: 10,
  maxY: 40,
};
function world(volumes = [], bridges = []) {
  return new FlightWorld({
    data: { flightBuildingVolumes: volumes, flightBridgeVolumes: bridges },
    landmarkDetails: [],
    elevation: () => 0,
    rawElevation: () => 0,
  });
}
const v = (x, y, z) => new THREE.Vector3(x, y, z);
test('swept building collision catches high speed wall and roof while allowing overhead and elevated gap', () => {
  const w = world([building]);
  assert(w.hit(v(-80, 20, 0), v(80, 20, 0)));
  assert(w.hit(v(0, 80, 0), v(0, 20, 0)));
  assert(!w.hit(v(-80, 45, 0), v(80, 45, 0)));
  assert(!w.hit(v(-80, 4, 0), v(80, 4, 0)));
});
test('bridge collision uses oriented narrow volumes without closing the entire underpass', () => {
  const matrix = new THREE.Matrix4().makeRotationY(0.7);
  matrix.setPosition(0, 30, 0);
  const w = world(
    [],
    [{ matrix: matrix.toArray(), min: [-10, -1, -100], max: [10, 1, 100] }],
  );
  assert(w.hit(v(0, 40, 0), v(0, 20, 0)));
  assert(!w.hit(v(-80, 20, 0), v(80, 20, 0)));
  const cable = new THREE.Matrix4();
  cable.setPosition(0, 50, 0);
  const c = world(
    [],
    [{ matrix: cable.toArray(), min: [-0.2, -20, -0.2], max: [0.2, 20, 0.2] }],
  );
  assert(c.hit(v(-40, 50, 0), v(40, 50, 0), 0.85));
});
test('holes in building footprint stay empty and off-map launch is rejected', () => {
  const w = world([
    {
      ...building,
      polygon: [
        ...building.polygon,
        [
          [-2, -2],
          [-2, 2],
          [2, 2],
          [2, -2],
        ],
      ],
    },
  ]);
  assert(!w.hit(v(0, 20, 0), v(0, 21, 0), 0.1));
  assert.equal(w.launch(90000, 90000), null);
});
test('landmark clearance includes stationary interiors and parallel wingtip contact', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 20),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.y = 10;
  const holder = new THREE.Group();
  holder.add(mesh);
  const w = new FlightWorld({
    data: {},
    landmarkDetails: [{ holder, medium: mesh }],
    elevation: () => 0,
    rawElevation: () => 0,
  });
  assert(w.hit(v(0, 10, 0), v(0, 10, 0), 5.5));
  assert(w.hit(v(10.5, 10, -2), v(10.5, 10, 2), 0.85));
  assert(!w.hit(v(12, 10, -2), v(12, 10, 2), 0.85));
  assert(!w.hit(v(-20, 10, 0), v(-15, 10, 0), 0.85));
  assert(w.hit(v(-80, 10, 0), v(80, 10, 0), 0.85));
  mesh.geometry.dispose();
  mesh.material.dispose();
});
test('landmark collision preserves an open courtyard between separate walls', () => {
  const holder = new THREE.Group();
  for (const [x, z, w, d] of [
    [-15, 0, 2, 32],
    [15, 0, 2, 32],
    [0, -15, 28, 2],
    [0, 15, 28, 2],
  ]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 20, d),
      new THREE.MeshBasicMaterial(),
    );
    m.position.set(x, 10, z);
    holder.add(m);
  }
  const w = new FlightWorld({
    data: {},
    landmarkDetails: [{ holder, medium: holder }],
    elevation: () => 0,
    rawElevation: () => 0,
  });
  assert(!w.hit(v(0, 10, 0), v(0, 10, 0), 5.5));
  assert(w.hit(v(0, 10, 0), v(20, 10, 0), 0.85));
  holder.children.forEach((m) => {
    m.geometry.dispose();
    m.material.dispose();
  });
});

test('duplicate open landmark facades do not fill the space between them', () => {
  const planes = [];
  for (const x of [0, 0, 10, 10]) {
    const p = new THREE.PlaneGeometry(20, 20);
    p.rotateY(Math.PI / 2);
    p.translate(x, 10, 0);
    planes.push(p);
  }
  const mesh = new THREE.Mesh(
    mergeGeometries(planes),
    new THREE.MeshBasicMaterial(),
  );
  planes.forEach((p) => p.dispose());
  const holder = new THREE.Group();
  holder.add(mesh);
  const w = new FlightWorld({
    data: {},
    landmarkDetails: [{ holder, medium: mesh }],
    elevation: () => 0,
    rawElevation: () => 0,
  });
  // Bounding-box candidate overlaps a large launch clearance, but the finite
  // vertical facade must not create an "inside" half-space behind it.
  assert(!w.hit(v(5, 10, 0), v(5, 10, 0), 0.85));
  assert(w.hit(v(-0.5, 10, 0), v(-0.5, 10, 0), 0.85));
  assert(w.hit(v(-10, 10, 0), v(10, 10, 0), 0.85));
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('placement includes the helicopter tail outside the central rotor clearance', () => {
  const w = world([
    {
      polygon: [
        [
          [-1, 6],
          [1, 6],
          [1, 8],
          [-1, 8],
        ],
      ],
      minY: 0,
      maxY: 5,
    },
  ]);
  assert(!w.clearAirframe('helicopter', 0, 0, 0, 0));
  assert(w.clearAirframe('helicopter', 0, 0, -10, 0));
});
