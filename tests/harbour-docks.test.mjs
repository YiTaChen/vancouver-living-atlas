import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityModule } from './helpers/city-modules.mjs';

const {
  addDocks,
  planMarinaDockDetails,
  marinaDockSegmentGeometry,
  HARBOUR_DOCK_LIMITS,
  HARBOUR_DOCK_REFERENCES,
} = await import(cityModule('harbour-docks'));
const { project, rings, lines } = await import(cityModule('geo'));
const json = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../public/data/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const piers = json('harbour-piers'),
  sites = json('harbour-sites');
const makeHost = (features = piers, moorings = sites) => {
  const obstacles = [];
  return {
    obstacles,
    scene: new THREE.Scene(),
    data: { 'harbour-piers': features, 'harbour-sites': moorings },
    waterWorld: { addObstacle: (polygon) => obstacles.push(polygon) },
  };
};
const triangles = (geometry) =>
  (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
function legacy() {
  const obstacles = [],
    geometries = [];
  for (const f of piers.features) {
    for (const poly of f.geometry.type.endsWith('Polygon') ? rings(f) : []) {
      const p = poly.map((r) => r.map(project));
      obstacles.push(p);
      const shape = new THREE.Shape(p[0].map((v) => new THREE.Vector2(...v)));
      shape.holes = p
        .slice(1)
        .map((r) => new THREE.Path(r.map((v) => new THREE.Vector2(...v))));
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: 1.4,
        bevelEnabled: false,
      });
      g.rotateX(Math.PI / 2);
      g.translate(0, 1.6, 0);
      g.deleteAttribute('uv');
      geometries.push(g);
    }
    for (const line of f.geometry.type.endsWith('LineString') ? lines(f) : []) {
      const p = line.map(project);
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1],
          b = p[i],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.1) continue;
        const x = (a[0] + b[0]) / 2,
          z = (a[1] + b[1]) / 2,
          yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const fx = Math.sin(yaw),
          fz = Math.cos(yaw),
          rx = Math.cos(yaw),
          rz = -Math.sin(yaw);
        obstacles.push([
          [
            [-1, -1],
            [-1, 1],
            [1, 1],
            [1, -1],
            [-1, -1],
          ].map(([a, b]) => [
            x + (fx * a * length) / 2 + (rx * b * 1.4) / 2,
            z + (fz * a * length) / 2 + (rz * b * 1.4) / 2,
          ]),
        ]);
        const g = new THREE.BoxGeometry(1.4, 1.4, length).toNonIndexed();
        g.rotateY(yaw);
        g.translate(x, 0.9, z);
        g.deleteAttribute('uv');
        geometries.push(g);
      }
    }
  }
  const geometry = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return { obstacles, geometry };
}
function dispose(host) {
  const geometries = new Set(),
    materials = new Set();
  host.scene.traverse((o) => {
    if (o.isMesh) {
      geometries.add(o.geometry);
      materials.add(o.material);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

test('committed marina associations select cement-float piers without decorating terminals or public wharves', () => {
  const plan = planMarinaDockDetails(piers, sites);
  assert.deepEqual(
    [...new Set(plan.segments.map((s) => s.sourceId))].sort((a, b) => a - b),
    [105690047, 105690052, 105690059, 105690060, 105690064],
  );
  assert.equal(plan.segments.length, 45);
  assert(
    plan.cleats.length > 0 &&
      plan.cleats.length <= HARBOUR_DOCK_LIMITS.maxCleats,
  );
  assert(
    HARBOUR_DOCK_REFERENCES.includes(
      'https://coalharbourmarina.com/annual-moorage/',
    ),
  );
  const first = piers.features.find((f) => f.properties.sourceId === 105690047);
  for (const properties of [
    { mooring: 'no' },
    { mooring: 'commercial' },
    { aeroway: 'aerodrome' },
    { waterway: 'fuel' },
    { highway: 'footway' },
    { man_made: 'breakwater' },
  ]) {
    const feature = {
      ...first,
      properties: { ...first.properties, ...properties },
    };
    assert.equal(
      planMarinaDockDetails({ features: [feature] }, sites).segments.length,
      0,
    );
  }
  assert.equal(
    planMarinaDockDetails(piers, { illustrativeMoorings: [] }).segments.length,
    0,
  );
  const polygon = {
    ...first,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [...first.geometry.coordinates, first.geometry.coordinates[0]],
      ],
    },
  };
  assert.equal(
    planMarinaDockDetails({ features: [polygon] }, sites).segments.length,
    0,
  );
  const far = {
    ...first,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-123.111, 49.29],
        [-123.11, 49.29],
      ],
    },
  };
  assert.equal(
    planMarinaDockDetails({ features: [far] }, sites).segments.length,
    0,
  );
});

test('all 390 source collision polygons and line boxes remain numerically identical', () => {
  const host = makeHost(),
    original = legacy();
  addDocks(host);
  assert.equal(host.obstacles.length, 390);
  assert.deepEqual(host.obstacles, original.obstacles);
  assert(host.data.harbourDockMesh.isMesh);
  assert(host.data.harbourDockMesh.material.vertexColors);
  original.geometry.dispose();
  dispose(host);
});

test('replacement concrete surfaces close the original box once with correct normals and flat 1.6m deck', () => {
  for (const length of [4, 17.1, 160]) {
    const geometry = marinaDockSegmentGeometry(length);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    for (const [actual, expected] of [
      [min.x, -0.7],
      [max.x, 0.7],
      [min.y, 0.2],
      [max.y, 1.6],
      [min.z, -length / 2],
      [max.z, length / 2],
    ])
      assert(Math.abs(actual - expected) < 1e-5);
    const p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    let volume = 0,
      topArea = 0;
    const colours = new Set();
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i),
        b = new THREE.Vector3().fromBufferAttribute(p, i + 1),
        c = new THREE.Vector3().fromBufferAttribute(p, i + 2),
        cross = b.clone().sub(a).cross(c.clone().sub(a)),
        normal = new THREE.Vector3().fromBufferAttribute(n, i);
      assert(
        cross.dot(normal) > 0,
        'outward winding agrees with the authored normal',
      );
      volume += a.dot(b.clone().cross(c)) / 6;
      if (normal.y === 1) {
        assert(
          Math.abs(a.y - 1.6) < 1e-6 &&
            Math.abs(b.y - 1.6) < 1e-6 &&
            Math.abs(c.y - 1.6) < 1e-6,
        );
        topArea += cross.length() / 2;
        colours.add(geometry.getAttribute('color').getX(i));
      }
    }
    assert(Math.abs(volume - length * 1.4 * 1.4) < 1e-3);
    assert(
      Math.abs(topArea - length * 1.4) < 1e-3,
      'no offset overlay, duplicate top or gap',
    );
    assert(
      colours.size >= 3,
      'concrete panels, joints and edge cap have distinct colours',
    );
    assert(
      triangles(geometry) <= 4 * HARBOUR_DOCK_LIMITS.maxPanelsPerSegment + 28,
    );
    geometry.dispose();
  }
});

test('edge fittings stay within source rectangles, retain a clear centre and avoid pier junctions', () => {
  const { segments, cleats } = planMarinaDockDetails(piers, sites);
  for (const c of cleats) {
    const s = segments.find(
      (s) =>
        s.sourceId === c.sourceId &&
        s.segmentIndex === c.segmentIndex &&
        s.lineIndex === c.lineIndex,
    );
    assert(s);
    const dx = c.x - s.x,
      dz = c.z - s.z,
      lateral = Math.cos(s.yaw) * dx - Math.sin(s.yaw) * dz,
      along = Math.sin(s.yaw) * dx + Math.cos(s.yaw) * dz;
    assert(Math.abs(Math.abs(lateral) - 0.6) < 1e-8);
    assert(Math.abs(lateral) + 0.055 < 0.7);
    assert(Math.abs(lateral) - 0.055 > 0.54, 'fittings leave the centre free');
    assert(Math.abs(along) + 0.15 <= s.length / 2 - 1.8);
  }
  const host = makeHost();
  addDocks(host);
  const hardware = host.data.harbourDockMesh.children.find(
    (o) => o.userData.edgeCleats,
  );
  assert.equal(triangles(hardware.geometry), cleats.length * 36);
  hardware.geometry.computeBoundingBox();
  assert(hardware.geometry.boundingBox.min.y >= 1.6 - 1e-6);
  assert(hardware.geometry.boundingBox.max.y <= 1.725 + 1e-6);
  dispose(host);
});

test('full harbour uses two draws with bounded triangle growth, and baseline toggle restores the former geometry', () => {
  const host = makeHost(),
    original = legacy();
  addDocks(host);
  const mesh = host.data.harbourDockMesh,
    control = host.data.harbourDockDetailControl,
    detailGeometry = mesh.geometry,
    detailMaterial = mesh.material;
  assert.equal(
    mesh.children.length,
    1,
    'baseline is not allocated before QA asks for it',
  );
  let count = 0,
    total = 0;
  host.scene.traverseVisible((o) => {
    if (o.isMesh) {
      count++;
      total += triangles(o.geometry);
    }
  });
  assert.equal(count, 2);
  assert(total < 10_000, `current source costs ${total} triangles`);
  assert(
    total - triangles(original.geometry) <
      HARBOUR_DOCK_LIMITS.maxAddedTriangles,
  );
  assert(
    (4 * HARBOUR_DOCK_LIMITS.maxPanelsPerSegment + 16) *
      HARBOUR_DOCK_LIMITS.maxSegments +
      HARBOUR_DOCK_LIMITS.maxCleats * 36 <=
      HARBOUR_DOCK_LIMITS.maxAddedTriangles,
  );
  const collisions = structuredClone(host.obstacles);
  for (let i = 0; i < 3; i++) {
    control.setEnabled(false);
    assert.equal(control.enabled, false);
    assert.deepEqual(
      mesh.geometry.getAttribute('position').array,
      original.geometry.getAttribute('position').array,
    );
    assert.deepEqual(
      mesh.geometry.getAttribute('normal').array,
      original.geometry.getAttribute('normal').array,
    );
    assert.equal(mesh.material.color.getHex(), 0x87948c);
    assert(!mesh.material.vertexColors);
    let visible = 0;
    host.scene.traverseVisible((o) => {
      if (o.isMesh) visible++;
    });
    assert.equal(visible, 1);
    control.setEnabled(true);
    assert.equal(mesh.geometry, detailGeometry);
    assert.equal(mesh.material, detailMaterial);
    assert.equal(
      mesh.children.length,
      2,
      'toggle reuses its scene-owned inactive resource',
    );
  }
  assert.deepEqual(
    host.obstacles,
    collisions,
    'QA never mutates collision geometry',
  );
  original.geometry.dispose();
  dispose(host);
  const empty = makeHost({ features: [] }, {});
  addDocks(empty);
  assert.equal(empty.scene.children.length, 0);
});
