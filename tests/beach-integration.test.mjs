import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const app = (f) => new URL('../' + f, import.meta.url);
const read = (f) => readFileSync(app(f), 'utf8'),
  json = (f) => JSON.parse(read(f));
const { BeachGround } = await import(cityModule('beach-ground')),
  { WaterWorld } = await import(cityModule('water-world')),
  { project, rings, inPolygon } = await import(cityModule('geo'));
const data = json('public/data/beach-coast.json'),
  field = new BeachGround(data),
  checks = json('tests/fixtures/beach-independent-checks.json');
const core = data.land.features.flatMap((f) =>
    rings(f).map((p) => p.map((r) => r.map(project))),
  ),
  context = JSON.parse(
    readFileSync(app('public/data/context-land.geojson'), 'utf8'),
  );
const empty = { type: 'FeatureCollection', features: [] },
  world = new WaterWorld(core, context, [], empty, empty, field);
for (const p of data.groundObstacleFootprints) world.addObstacle(p);
const old = JSON.parse(
  readFileSync(app('public/data/land.geojson'), 'utf8'),
).features.flatMap((f) => rings(f).map((p) => p.map((r) => r.map(project))));
let metrics = { ...data.statistics };
test('source hashes pin the replacement triangle keys to the exact canonical geography', () => {
  for (const [p, h] of Object.entries(data.sourceHashes))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(app(p)))
        .digest('hex'),
      h,
      p,
    );
});
test('independent GEOS points agree with rendered dry/wet triangles and shared land mask', () => {
  let n = 0;
  for (const [x, z, isLand] of checks) {
    const h = field.height(x, z);
    assert.ok(Number.isFinite(h), `${x},${z}`);
    assert.equal(h > 0.100001, isLand, `${x},${z} height ${h}`);
    assert.equal(
      core.some((p) => inPolygon([x, z], p)),
      isLand,
    );
    assert.equal(Boolean(world.at(x, z)), !isLand);
    n++;
  }
  metrics.landWaterPoints = n;
});
test('all emitted terrain/path vertices are finite; no reversed or zero-area profile triangles', () => {
  for (const positions of [
    data.outsidePositions,
    data.profilePositions,
    data.pathPositions,
  ])
    assert.ok(positions.every(Number.isFinite));
  for (let i = 0; i < data.profilePositions.length; i += 9) {
    const p = data.profilePositions.slice(i, i + 9),
      area = (p[3] - p[0]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[6] - p[0]);
    assert.ok(area < 0);
  }
});
test('actual Three triangle raycasts equal the shared height field', () => {
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(data.profilePositions, 3),
  );
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let n = 0,
    maxError = 0;
  for (const [x, z] of checks.filter((_, i) => i % 37 === 0)) {
    ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    const h = ray.intersectObject(mesh)[0]?.point.y;
    assert.ok(Number.isFinite(h));
    const d = Math.abs(field.height(x, z) - h);
    assert.ok(d < 1e-6);
    maxError = Math.max(maxError, d);
    n++;
  }
  geometry.dispose();
  material.dispose();
  metrics.raycasts = n;
  metrics.raycastMaxError = maxError;
});
test('full hull rejects every dry sample, while removed City phantom shore admits deep water', () => {
  let dry = 0,
    formerlyBlocked = 0,
    deepCentreShallowHull = 0;
  for (const [x, z, land] of checks.filter((_, i) => i % 3 === 0)) {
    const h = field.height(x, z);
    if (land) {
      assert.equal(world.canOccupy(x, z, 0, 'sea'), false);
      dry++;
    } else if (
      h < -0.9 &&
      old.some((p) => inPolygon([x, z], p)) &&
      world.canOccupy(x, z, 0, 'sea')
    )
      formerlyBlocked++;
    if (!land && h < -0.7 && !field.allowsHull(x, z, 0, 3.5, 1.35))
      deepCentreShallowHull++;
  }
  assert.ok(dry > 100);
  assert.ok(formerlyBlocked > 100);
  assert.ok(deepCentreShallowHull > 5);
  metrics.dryHullChecks = dry;
  metrics.formerlyBlockedWaterNowNavigable = formerlyBlocked;
  metrics.centreOnlyWouldMiss = deepCentreShallowHull;
});
test('depth index checks the entire capsule rather than just bow/stern/centre samples', () => {
  const fixture = data.fixtures,
    synthetic = {
      ...data,
      fixtures: {
        ...fixture,
        beaches: [
          {
            ...fixture.beaches[0],
            profilePolygons: [
              [
                [
                  [-10, -10],
                  [10, -10],
                  [10, 10],
                  [-10, 10],
                  [-10, -10],
                ],
              ],
            ],
          },
        ],
      },
      profilePositions: [0.6, -0.1, -0.2, 1, -0.1, -0.2, 0.8, -0.1, 0.2],
    };
  const s = new BeachGround(synthetic);
  assert.equal(s.height(0, 0), undefined);
  assert.equal(s.allowsHull(0, 0, 0, 3.5, 1.35), false);
  assert.equal(s.allowsHull(0, 0, 0, 3.5, 0.3), true);
  assert.equal(s.allowsHull(NaN, 0, 0, 3.5, 1.35), false);
});
test('non-beach terrain and distant boat checks have constant cheap rejection', () => {
  assert.equal(field.height(0, 0), undefined);
  assert.equal(field.allowsHull(0, 0, 0, 3.5, 1.35), true);
});
test('replacement path triangles remain above the exact terrain and on the dry beach', () => {
  let n = 0,
    minGap = Infinity;
  const p = data.pathPositions;
  for (let i = 0; i < p.length; i += 9) {
    const x = (p[i] + p[i + 3] + p[i + 6]) / 3,
      z = (p[i + 2] + p[i + 5] + p[i + 8]) / 3,
      y = (p[i + 1] + p[i + 4] + p[i + 7]) / 3,
      h = field.height(x, z);
    if (h === undefined) continue;
    assert.ok(h > 0.099999);
    assert.ok(y - h > 0.024, `path clipping ${x},${z}: ${y - h}`);
    minGap = Math.min(minGap, y - h);
    n++;
  }
  assert.ok(n > 2000);
  metrics.pathTriangleChecks = n;
  metrics.minimumPathClearance = minGap;
});
test('retained physical ground pavement remains a boat obstacle over the reconciled coast', () => {
  let count = 0;
  for (const polygon of data.groundObstacleFootprints) {
    const p = polygon[0],
      x = p.reduce((s, q) => s + q[0], 0) / p.length,
      z = p.reduce((s, q) => s + q[1], 0) / p.length;
    if (world.at(x, z) && world.solidAt(x, z)) {
      assert.equal(world.canOccupy(x, z, 0, 'sea'), false);
      count++;
    }
  }
  assert.ok(count > 0);
  metrics.retainedPavementObstacleChecks = count;
});

const { advanceBoat, initialBoatState } = await import(
  cityModule('boat-physics')
);
test('actual boat physics approaches each beach and stops before shallow sand', () => {
  for (const [x, z] of [
    [-1598, -938],
    [-2069, -2043],
  ]) {
    const state = { ...initialBoatState(), x: x - 90, z, yaw: Math.PI / 2 };
    assert.ok(world.canOccupy(state.x, state.z, state.yaw, 'sea'));
    let collided = false;
    for (let i = 0; i < 2400; i++) {
      advanceBoat(state, { thrust: 1, turn: 0, neutral: false }, 1 / 60, world);
      assert.ok(world.canOccupy(state.x, state.z, state.yaw, 'sea'));
      if (state.collided) {
        collided = true;
        break;
      }
    }
    assert.ok(collided);
    assert.ok(state.x > x - 70 && state.x < x - 20);
    assert.equal(state.vx, 0);
    assert.equal(state.vz, 0);
    assert.equal(
      core.some((p) => inPolygon([state.x, state.z], p)),
      false,
    );
  }
});
