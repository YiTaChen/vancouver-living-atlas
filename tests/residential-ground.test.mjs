import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  ResidentialSpatialIndex,
  residentialOverlap,
  residentialBeds,
  drapeResidentialBed,
  RESIDENTIAL_GROUND_LIMITS: limits,
} = await import(cityModule('residential-ground-plan'));
const { createResidentialGround, residentialSurfaceTriangles } = await import(
  cityModule('residential-ground')
);
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { unproject } = await import(cityModule('geo'));
const { createProfile } = await import(cityModule('facade-profile'));
const { visibilityGeometry: g } = await import(cityModule('ground-visibility'));
const rectangle = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
function surface(x0 = -30, z0 = -30, x1 = 30, z1 = 30) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [x0, 0, z0, x1, 0, z1, x1, 0, z0, x0, 0, z0, x0, 0, z1, x1, 0, z1],
      3,
    ),
  );
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}
function feature(key, polygon, height = 8) {
  return {
    properties: { buildingId: key, height },
    geometry: {
      type: 'Polygon',
      coordinates: [[...polygon, polygon[0]].map(([x, z]) => unproject(x, z))],
    },
  };
}
function fixture(features = [feature('home', rectangle(-8, -5, 8, 5))]) {
  const terrain = new THREE.Group();
  terrain.add(surface());
  return {
    terrain,
    roads: new THREE.Group(),
    buildings: new THREE.Group(),
    elevation: () => 0,
    data: {
      buildings: { features },
      buildingProfiles: new Map([
        [
          'home',
          createProfile({
            key: 'home',
            heightM: 8,
            footprintAreaM2: 160,
            center: [-1700, 1700],
          }),
        ],
      ]),
    },
  };
}
const dispose = (e) => {
  for (const root of [e.terrain, e.roads, e.buildings])
    root.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
};

test('bed planning reserves the actual offset door center, facade ends and existing footprint', () => {
  const a = [0, 0],
    b = [18, 0],
    entry = 10.5,
    beds = residentialBeds(a, b, entry);
  assert.equal(beds.length, 2);
  for (const bed of beds) {
    const bounds = g.boundsOf(bed);
    assert.ok(bounds[0] >= 0.65 && bounds[2] <= 17.35);
    assert.ok(bounds[1] >= -1.061 && bounds[3] <= -0.179);
    assert.ok(
      bounds[2] <= entry - limits.entryHalfGapM + 1e-8 ||
        bounds[0] >= entry + limits.entryHalfGapM - 1e-8,
    );
    assert.equal(residentialOverlap(bed, rectangle(0, 0, 18, 12)), false);
  }
  assert.deepEqual(residentialBeds(a, [4, 0]), []);
  assert.deepEqual(residentialBeds(a, [40, 0]), []);
  assert.deepEqual(residentialBeds(a, b, NaN), []);
});

test('clearance detects crossing-only thin paths, containment and exact edge contact', () => {
  const bed = rectangle(0, 0, 4, 2);
  assert.equal(residentialOverlap(bed, rectangle(1.99, -5, 2.01, 5)), true);
  assert.equal(residentialOverlap(bed, rectangle(1, 0.5, 2, 1.5)), true);
  assert.equal(residentialOverlap(bed, rectangle(4, 0, 7, 2)), true);
  assert.equal(residentialOverlap(bed, rectangle(4.01, 0, 7, 2)), false);
});

test('terrain draping splits at real interpolation diagonals and rejects missing/steep support', () => {
  const mesh = surface(-10, -10, 10, 10),
    p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++)
    p.setY(i, p.getX(i) === p.getZ(i) ? 0 : 0.3);
  const terrain = new ResidentialSpatialIndex(
      residentialSurfaceTriangles(mesh),
    ),
    floor = new GroundSurfaceIndex([mesh]);
  const bed = rectangle(-3, -2, 4, 3),
    positions = drapeResidentialBed(bed, terrain, 0.1);
  assert.ok(
    positions?.length > 18,
    'terrain diagonal creates additional triangle pieces',
  );
  for (let i = 0; i < positions.length; i += 9) {
    const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3,
      z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3,
      y = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
    assert.ok(
      Math.abs(y - (floor.sample(x, z, 0) + limits.surfaceOffsetM)) < 1e-8,
    );
  }
  assert.equal(drapeResidentialBed(rectangle(9, 9, 12, 12), terrain, 0), null);
  assert.equal(drapeResidentialBed(bed, terrain, 4), null);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('surface indexing respects mesh transforms and drawRange without changing source vertices', () => {
  const mesh = surface(),
    before = mesh.geometry.attributes.position.array.slice();
  mesh.position.set(15, 7, -10);
  mesh.geometry.setDrawRange(3, 3);
  const triangles = residentialSurfaceTriangles(mesh);
  assert.equal(triangles.length, 1);
  assert.deepEqual(triangles[0].y, [7, 7, 7]);
  assert.deepEqual(mesh.geometry.attributes.position.array, before);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('representative gardens use one bounded batch material and never add collision or walking floors', () => {
  const e = fixture(),
    before = JSON.stringify(e.data.buildings);
  createResidentialGround(e);
  assert.equal(e.data.residentialGround.plots, 1);
  assert.equal(e.data.residentialGround.beds, 2);
  assert.equal(e.data.residentialGround.plants, 4);
  assert.equal(JSON.stringify(e.data.buildings), before);
  const materials = new Set();
  let triangles = 0;
  e.buildings.traverse((o) => {
    if (o.isMesh) {
      materials.add(o.material);
      assert.equal(o.castShadow, false);
      assert.equal(o.userData.walkSurface, undefined);
      assert.equal(o.material.map, null);
      triangles += o.geometry.attributes.position.count / 3;
    }
  });
  assert.equal(materials.size, 1);
  assert.ok(triangles < 100);
  assert.equal(triangles, e.data.residentialGround.triangles);
  for (const lod of e.buildings.children) {
    assert.ok(lod.isLOD);
    assert.equal(lod.levels[1].distance, limits.showDistanceM);
  }
  dispose(e);
});

test('actual road surfaces and neighbor footprints conservatively reject covered beds', () => {
  for (const blocker of ['road', 'building']) {
    const e = fixture();
    if (blocker === 'road') {
      const mesh = surface();
      mesh.userData.walkSurface = true;
      e.roads.add(mesh);
    } else
      e.data.buildings.features.push(
        feature('neighbor', rectangle(-25, -25, 25, 25), 20),
      );
    createResidentialGround(e);
    assert.equal(e.data.residentialGround.plots, 0, blocker);
    assert.equal(e.buildings.children.length, 0);
    dispose(e);
  }
});

test('non-domestic and compound structures cannot silently receive residential gardens', () => {
  const e = fixture();
  e.data.buildings.features.push(feature('home', rectangle(9, -5, 13, 5)));
  createResidentialGround(e);
  assert.equal(e.data.residentialGround.plots, 0);
  e.data.buildings.features.pop();
  e.data.buildingProfiles.set('home', { kind: 'heritage-brick' });
  createResidentialGround(e);
  assert.equal(e.data.residentialGround.plots, 0);
  dispose(e);
});

test('source selection is deterministic and capped at 500 plots with local batches', () => {
  const features = Array.from({ length: 510 }, (_, i) =>
    feature(
      `home-${i}`,
      rectangle(
        (i % 30) * 25,
        Math.floor(i / 30) * 20,
        (i % 30) * 25 + 16,
        Math.floor(i / 30) * 20 + 10,
      ),
    ),
  );
  const e = fixture(features),
    old = e.terrain.children[0];
  e.terrain.remove(old);
  old.geometry.dispose();
  old.material.dispose();
  e.terrain.add(surface(-10, -10, 800, 400));
  const profile = createProfile({
    key: 'test-home',
    heightM: 8,
    footprintAreaM2: 160,
    center: [-1700, 1700],
  });
  e.data.buildingProfiles = new Map(
    features.map((f) => [f.properties.buildingId, profile]),
  );
  const before = JSON.stringify(features);
  createResidentialGround(e);
  assert.equal(e.data.residentialGround.plots, 500);
  assert.equal(new Set(e.data.residentialGround.sourceIds).size, 500);
  assert.ok(e.data.residentialGround.beds <= 1000);
  assert.ok(e.data.residentialGround.triangles <= 24000);
  assert.ok(e.data.residentialGround.batches <= 20);
  assert.equal(JSON.stringify(features), before);
  const ids = [...e.data.residentialGround.sourceIds];
  e.data.buildings.features = [...features].reverse();
  e.buildings.traverse((o) => o.geometry?.dispose());
  e.buildings.clear();
  createResidentialGround(e);
  assert.deepEqual(e.data.residentialGround.sourceIds, ids);
  dispose(e);
});
