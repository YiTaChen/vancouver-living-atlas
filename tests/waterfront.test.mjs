import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const {
  createWaterfront,
  resolveCauldronFoundation,
  CAULDRON_COORDINATE,
  CAULDRON_POOL,
} = await import(cityModule('waterfront'));
const { project, inPolygon, rings } = await import(cityModule('geo'));
const { StreetNavigation } = await import(cityModule('navigation'));
const { FlightWorld } = await import(cityModule('flight-world'));

function fixture(protectedSurface = false) {
  const [x, z] = project(CAULDRON_COORDINATE);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshBasicMaterial(),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(x, 4.8, z);
  ground.userData.walkSurface = true;
  ground.userData.protectedSurface = protectedSurface;
  const e = {
    data: {},
    settings: { buildings: true },
    terrain: new THREE.Group(),
    roads: new THREE.Group(),
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    elevation: () => 3.6,
  };
  e.terrain.add(ground);
  const mappedPool = JSON.parse(
    readFileSync('public/data/context.geojson', 'utf8'),
  ).features.find((f) => f.properties.id === '1070091596');
  e.data.waterPolys = rings(mappedPool).map((poly) =>
    poly.map((r) => r.map(project)),
  );
  return e;
}

test('foundation requires every mapped corner, rejects podium mixes and never guesses a floor', () => {
  assert.equal(
    resolveCauldronFoundation(() => undefined),
    null,
  );
  assert.equal(
    resolveCauldronFoundation(() => NaN),
    null,
  );
  let i = 0;
  assert.equal(
    resolveCauldronFoundation(() => (++i === 3 ? 8 : 4.8)),
    null,
  );
  const foundation = resolveCauldronFoundation(() => 4.8);
  assert.equal(foundation.samples.length, 9);
  assert.ok(Math.abs(foundation.top - 4.835) < 1e-9);
});

test('mapped pool and sculpture sit on rendered ground, own their resources, and register exact flight meshes', () => {
  const e = fixture();
  createWaterfront(e);
  assert.equal(e.data.waterfrontProof.status, 'ready');
  const ordered = (ring) => ring.slice(0, -1).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(ordered(e.data.waterPolys[0][0]), ordered(CAULDRON_POOL));
  assert.ok(inPolygon(project(CAULDRON_COORDINATE), e.data.waterPolys[0]));
  const root = e.landmarks.children[0];
  assert.ok(Math.abs(root.position.y - 4.835) < 1e-6);
  assert.equal(root.userData.waterfrontDetail, true);
  assert.equal(
    root.children.some((o) => o.userData.walkSurface),
    false,
    'pool must not become a walk deck',
  );
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  assert.deepEqual(e.data.flightLandmarkMeshes, meshes);
  assert.ok(meshes.length <= 6);
  assert.ok(meshes.every((m) => !m.material.transparent && !m.material.map));
  const world = new FlightWorld(e);
  const [x, z] = project(CAULDRON_COORDINATE);
  assert.equal(
    world.hit(new THREE.Vector3(x, 4.8, z), new THREE.Vector3(x, 15, z), 0.2),
    true,
  );
  assert.equal(
    world.hit(
      new THREE.Vector3(x + 40, 5, z),
      new THREE.Vector3(x + 40, 15, z),
      0.2,
    ),
    false,
  );
});

test('unsupported protected decks create neither floating visuals nor phantom pool collisions', () => {
  const e = fixture(true);
  createWaterfront(e);
  assert.equal(e.data.waterfrontProof.status, 'unavailable-ground');
  assert.equal(e.landmarks.children.length, 0);
  assert.equal(e.data.waterfrontPool, undefined);
});

test('one source pool is replaced without overlapping water, and the registry shares its visible level', () => {
  const e = fixture();
  const oldWater = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial(),
  );
  oldWater.userData.waterId = 'lake-1070091596-0';
  const otherWater = new THREE.Mesh();
  otherWater.userData.waterId = 'lake-other';
  e.terrain.add(oldWater);
  const otherSurface = { id: 'lake-other', level: 14, navigable: true };
  e.data.waterMeshes = [oldWater, otherWater];
  e.data.waterSurfaces = [
    {
      id: oldWater.userData.waterId,
      level: 5.5,
      polygon: [CAULDRON_POOL],
      navigable: false,
    },
    otherSurface,
  ];
  createWaterfront(e);
  const replacement = e.data.waterMeshes.find(
    (m) => m.userData.waterId === oldWater.userData.waterId,
  );
  assert.notEqual(replacement, oldWater);
  assert.equal(oldWater.visible, false);
  assert.equal(
    oldWater.parent,
    e.terrain,
    'old resources remain scene-owned until teardown',
  );
  assert.equal(
    replacement.parent,
    e.terrain,
    'water keeps the existing terrain layer',
  );
  assert.equal(
    e.data.waterSurfaces[0].level,
    e.data.waterfrontProof.foundation.top + 0.045,
  );
  assert.equal(e.data.waterSurfaces[0].navigable, false);
  assert.equal(e.data.waterSurfaces[1], otherSurface);
  assert.ok(e.data.waterMeshes.includes(otherWater));
  e.data.waterfrontDetailControl.setEnabled(false);
  assert.equal(oldWater.visible, true);
  assert.equal(replacement.visible, false);
  e.data.waterfrontDetailControl.setEnabled(true);
  assert.equal(oldWater.visible, false);
  assert.equal(replacement.visible, true);
});

test('existing mapped pool exclusion still rejects walking and placement, including with Buildings hidden', () => {
  const e = fixture();
  createWaterfront(e);
  e.onLand = () => true;
  const nav = {
    e,
    mode: 'walk',
    collisions: new Map(),
    reachableDeck: () => undefined,
  };
  nav.clearGround = (x, z) =>
    StreetNavigation.prototype.clearGround.call(nav, x, z);
  const [x, z] = project(CAULDRON_COORDINATE);
  assert.equal(StreetNavigation.prototype.blocked.call(nav, x, z), true);
  assert.equal(StreetNavigation.prototype.clearGround.call(nav, x, z), false);
  assert.equal(
    StreetNavigation.prototype.clearGround.call(nav, x + 25, z),
    true,
  );
  e.settings.buildings = false;
  assert.equal(StreetNavigation.prototype.blocked.call(nav, x, z), true);
  assert.equal(StreetNavigation.prototype.clearGround.call(nav, x, z), false);
});
