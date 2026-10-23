import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { planRobsonBurrardDetails, RobsonBurrardDetails } = await import(
  cityModule('robson-burrard-details')
);
const {
  streetShowcaseWeight,
  streetSegmentDistance,
  STREET_SHOWCASE_SEGMENTS,
  STREET_SHOWCASE_BOUNDS,
  STREET_SHOWCASE_GLSL,
  STREET_SHOWCASE_DETAIL_BUDGET,
} = await import(cityModule('street-quality-profile'));
const { createProfile } = await import(cityModule('facade-profile'));
const { project, unproject } = await import(cityModule('geo'));
const { firstVisibleObstacleHit } = await import(
  cityModule('visible-obstacles')
);
const { TravelCameraCollision } = await import(
  cityModule('travel-camera-collision')
);

const sourceIntersection = project([-123.1228089, 49.2832957]);
const segment = STREET_SHOWCASE_SEGMENTS[0];
const len = Math.hypot(
  segment.b[0] - segment.a[0],
  segment.b[1] - segment.a[1],
);
const t = [
  (segment.b[0] - segment.a[0]) / len,
  (segment.b[1] - segment.a[1]) / len,
];
const n = [-t[1], t[0]];
function building(
  key = 'pilot-shop',
  { offset = 25, along = 0, height = 24, minHeight = 0, name = null } = {},
) {
  const center = [
    sourceIntersection[0] + n[0] * offset + t[0] * along,
    sourceIntersection[1] + n[1] * offset + t[1] * along,
  ];
  const corners = [
    [-16, -10],
    [16, -10],
    [16, 10],
    [-16, 10],
  ].map(([u, v]) =>
    unproject(center[0] + t[0] * u + n[0] * v, center[1] + t[1] * u + n[1] * v),
  );
  const ring = [...corners, [...corners[0]]];
  return {
    type: 'Feature',
    properties: { buildingId: key, id: key, height, minHeight, name },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
function planHost(features = [building()], roadClass = 'Arterial') {
  const foundations = new Map(),
    profiles = new Map();
  for (const f of features) {
    const key = String(f.properties.buildingId);
    foundations.set(key, 29.6);
    profiles.set(
      key,
      createProfile({
        key,
        heightM: f.properties.height,
        footprintAreaM2: 640,
        center: sourceIntersection,
      }),
    );
  }
  const roads = {
    features: [
      {
        type: 'Feature',
        properties: { name: 'ROBSON ST', class: roadClass, width: 18 },
        geometry: {
          type: 'LineString',
          coordinates: [unproject(...segment.a), unproject(...segment.b)],
        },
      },
    ],
  };
  return {
    buildings: { features },
    roads,
    foundations,
    profiles,
    pavementY: () => 30,
  };
}

test('pilot envelope follows both unchanged source corridors, has smooth end caps and is zero outside', () => {
  assert.equal(streetShowcaseWeight(...sourceIntersection), 1);
  for (const s of STREET_SHOWCASE_SEGMENTS) {
    assert.equal(streetShowcaseWeight(...s.a), 1);
    assert.equal(streetShowcaseWeight(...s.b), 1);
  }
  const core = [segment.a[0] + t[0] * 40, segment.a[1] + t[1] * 40];
  const near = streetShowcaseWeight(core[0] + n[0] * 55, core[1] + n[1] * 55);
  assert(near > 0 && near < 1);
  assert.equal(
    streetShowcaseWeight(
      STREET_SHOWCASE_BOUNDS.maxX + 1,
      STREET_SHOWCASE_BOUNDS.maxZ + 1,
    ),
    0,
  );
  assert.equal(streetShowcaseWeight(NaN, 0), 0);
  assert.equal(streetShowcaseWeight(Infinity, 0), 0);
  assert(STREET_SHOWCASE_GLSL.includes('atlasStreetShowcaseWeight'));
  for (const s of STREET_SHOWCASE_SEGMENTS)
    for (const p of [s.a, s.b])
      for (const v of p) assert(STREET_SHOWCASE_GLSL.includes(v.toFixed(6)));
  const sourceRoads = JSON.parse(
    readFileSync('public/data/roads.geojson', 'utf8'),
  );
  const points = new Set(
    sourceRoads.features
      .filter((f) => f.properties.class === 'Arterial')
      .flatMap((f) =>
        f.geometry.type === 'LineString'
          ? f.geometry.coordinates.map((p) => p.slice(0, 2).join(','))
          : [],
      ),
  );
  for (const s of STREET_SHOWCASE_SEGMENTS)
    for (const p of [s.a, s.b]) {
      const q = unproject(...p);
      assert(
        points.has(q.join(',')),
        'pilot uses existing arterial source vertices',
      );
    }
});

test('finish is deterministic source-owned relief, road-facing, above pavement and never mutates GIS', () => {
  const h = planHost();
  const before = structuredClone({ buildings: h.buildings, roads: h.roads });
  const first = planRobsonBurrardDetails(h);
  assert(first.length >= 3 && first.length < 20);
  assert.deepEqual(first, planRobsonBurrardDetails(h));
  assert.deepEqual({ buildings: h.buildings, roads: h.roads }, before);
  assert(
    first.every(
      (b) => b.sourceKey === 'pilot-shop' && b.roadName === 'ROBSON ST',
    ),
  );
  for (const bay of first) {
    assert(streetShowcaseWeight(...bay.center) >= 0.6);
    assert(
      bay.normal[0] * n[0] + bay.normal[1] * n[1] < -0.7,
      'appearance faces the actual road',
    );
    assert(streetSegmentDistance(...bay.center, segment.a, segment.b) >= 9.5);
    assert(
      bay.canopyBottomY - bay.pavementY >= 2.8,
      'including valance and support clearance',
    );
    assert(bay.sign.width <= 2.3 && bay.sign.index >= 0 && bay.sign.index < 4);
    for (const b of bay.boxes) {
      for (const key of [
        'x',
        'y',
        'z',
        'width',
        'height',
        'depth',
        'yaw',
        'color',
      ])
        assert(Number.isFinite(b[key]), key);
      assert(b.width > 0 && b.height > 0 && b.depth > 0);
      assert(
        b.y - b.height / 2 >= bay.pavementY - 1e-7,
        'no floating floor, stairs or ground-level obstructions',
      );
      if (b.depth > 0.3)
        assert(
          b.y - b.height / 2 >= bay.pavementY + 2.8,
          'projecting canopy stays above walking clearance',
        );
    }
  }
});

test('party walls, elevated parts, unrelated roads, public landmarks and unsafe slopes receive no storefront skin', () => {
  assert.equal(
    planRobsonBurrardDetails(planHost([building('above', { minHeight: 3 })]))
      .length,
    0,
  );
  assert.equal(
    planRobsonBurrardDetails(
      planHost([building('museum', { name: 'Example Public Museum' })]),
    ).length,
    0,
  );
  assert.equal(planRobsonBurrardDetails(planHost(undefined, 'Lane')).length, 0);
  assert.equal(
    planRobsonBurrardDetails(planHost([building('far-away', { offset: 300 })]))
      .length,
    0,
  );
  const steep = planHost();
  steep.pavementY = (x) => 30 + x * 2;
  assert.equal(planRobsonBurrardDetails(steep).length, 0);
  const h = planHost([building(), building('adjoining-source', { offset: 5 })]);
  assert.equal(
    planRobsonBurrardDetails(h).filter((b) => b.sourceKey === 'pilot-shop')
      .length,
    0,
    'neighbour footprint blocks the original facade',
  );
});

test('real source frontages remain bounded, stable under source reordering, and limited to the named pilot streets', () => {
  const buildings = JSON.parse(
    readFileSync('public/data/buildings.geojson', 'utf8'),
  );
  const roads = JSON.parse(readFileSync('public/data/roads.geojson', 'utf8'));
  const foundations = new Map(),
    profiles = new Map();
  for (const f of buildings.features) {
    const p = f.properties,
      key = String(p.structureId ?? p.buildingId ?? p.id);
    const ring = (
      f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates[0][0]
        : f.geometry.coordinates[0]
    ).map(project);
    const center = [
      ring.reduce((s, v) => s + v[0], 0) / ring.length,
      ring.reduce((s, v) => s + v[1], 0) / ring.length,
    ];
    foundations.set(key, 29.6);
    profiles.set(
      key,
      createProfile({
        key,
        heightM: p.height,
        footprintAreaM2: p.area ?? 600,
        center,
      }),
    );
  }
  // Constant grade exercises source frontage/party-wall selection only. Runtime
  // uses actual foundations and pavement; this is not a pavement-fidelity claim.
  const h = { buildings, roads, foundations, profiles, pavementY: () => 30 };
  const a = planRobsonBurrardDetails(h);
  assert(
    a.length > 50 && a.length <= STREET_SHOWCASE_DETAIL_BUDGET.maxPlannedBays,
  );
  assert(
    a.some((b) => b.roadName === 'ROBSON ST') &&
      a.some((b) => b.roadName === 'BURRARD ST'),
  );
  assert.deepEqual(
    a,
    planRobsonBurrardDetails({
      ...h,
      buildings: { features: [...buildings.features].reverse() },
      roads: { features: [...roads.features].reverse() },
    }),
  );
  assert(
    a.every(
      (b) =>
        foundations.has(b.sourceKey) &&
        streetShowcaseWeight(...b.center) >= 0.6,
    ),
  );
});

test('renderer keeps six reusable pools, clears outside/high above pilot, and preserves pre-existing city resources', () => {
  const h = planHost();
  const prior = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3, 4),
    new THREE.MeshStandardMaterial(),
  );
  const city = new THREE.Group();
  city.add(prior);
  const host = {
    data: {
      buildings: h.buildings,
      roads: h.roads,
      buildingFoundations: h.foundations,
      buildingProfiles: h.profiles,
      roadRelief: () => 28.82,
    },
    buildings: city,
    camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'high', buildings: true },
    renderer: { shadowMap: { needsUpdate: false } },
    elevation: () => 30,
  };
  host.camera.position.set(sourceIntersection[0], 34, sourceIntersection[1]);
  const r = new RobsonBurrardDetails(host, null);
  const geometries = [...r.meshes.values()].map((m) => m.geometry);
  const matrices = [...r.meshes.values()].map((m) => m.instanceMatrix.array);
  r.update(true);
  assert(r.stats.visibleBays > 0);
  assert(r.stats.visibleBoxes <= STREET_SHOWCASE_DETAIL_BUDGET.maxVisibleBoxes);
  assert(r.stats.drawBatches <= 6);
  assert.equal(r.root.userData.collision, false);
  assert.equal(r.root.userData.appearanceOnly, true);
  // The pointer ray really crosses a visible canopy. Bypassing the override
  // proves this is a geometric obstruction fixture, rather than an empty ray.
  const canopy = r.bays
    .flatMap((b) => b.boxes)
    .find((b) => b.kind === 'canopy' && b.depth > 1);
  assert(canopy);
  const origin = new THREE.Vector3(canopy.x, canopy.y + 15, canopy.z);
  const desired = new THREE.Vector3(canopy.x, canopy.y - 8, canopy.z);
  const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
  city.updateMatrixWorld(true);
  const rawHits = [];
  THREE.InstancedMesh.prototype.raycast.call(
    r.meshes.get('canopy'),
    ray,
    rawHits,
  );
  assert(rawHits.length > 0);
  assert.equal(
    firstVisibleObstacleHit(ray, [r.root]),
    undefined,
    'decorative finishes cannot become a placement/rocket roof or aircraft obstacle',
  );
  assert(
    new TravelCameraCollision()
      .resolve(origin, desired, [r.root])
      .equals(desired),
    'decorative canopy and frames cannot shorten the travel camera boom',
  );
  for (const mesh of [...r.meshes.values(), r.signMesh]) {
    assert.equal(mesh.userData.cameraCollision, false);
    assert.equal(mesh.userData.travelOcclusion, false);
  }
  prior.position.set(canopy.x, canopy.y - 5, canopy.z);
  city.updateMatrixWorld(true);
  assert.equal(
    firstVisibleObstacleHit(ray, [city])?.object,
    prior,
    'the original city obstacle behind the finish remains pickable',
  );
  for (let i = 0; i < 10; i++) {
    host.camera.position.x += 1;
    r.update(true);
  }
  assert.deepEqual(
    [...r.meshes.values()].map((m) => m.geometry),
    geometries,
  );
  for (const [i, m] of [...r.meshes.values()].entries()) {
    assert.equal(m.instanceMatrix.array, matrices[i]);
    assert(m.count <= m.instanceMatrix.count);
    if (m.count)
      assert(m.boundingSphere && Number.isFinite(m.boundingSphere.radius));
  }
  host.camera.position.y = 200;
  r.update(true);
  assert.equal(r.stats.visibleBays, 0);
  host.camera.position.set(3000, 34, 3000);
  r.update(true);
  assert.equal(r.stats.visibleBoxes, 0);
  host.camera.position.set(sourceIntersection[0], 34, sourceIntersection[1]);
  host.settings.buildings = false;
  r.update(true);
  assert.equal(r.stats.signs, 0);
  r.dispose();
  r.dispose();
  assert.equal(r.stats.disposed, true);
  assert.equal(r.root.parent, null);
  assert(city.children.includes(prior));
  assert(prior.geometry.getAttribute('position'));
  prior.geometry.dispose();
  prior.material.dispose();
});
