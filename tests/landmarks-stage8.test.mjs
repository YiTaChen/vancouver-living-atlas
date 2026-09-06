import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  close,
  assertPlacement,
  assertFiniteGroup,
  geometryDigest,
  disposeGroup,
  assertLOD,
} from './helpers/landmark-test-utils.mjs';
const { createWorkerLandmark } = await import(
  cityModule('landmark-worker-factories')
);
const { resolveExtraLandmarkPlan, bcPlaceRecessRejection } = await import(
  cityModule('resolve-extra-landmark-plan')
);
const bc = await import(cityModule('assets/bc-place-envelope'));
const harbour = await import(cityModule('assets/harbour-podium'));
const convention = await import(cityModule('assets/convention-centre'));
const interfaces = await import(cityModule('assets/convention-entry'));
const house = await import(cityModule('assets/vancouver-house'));
const { createConventionPlatformSampler } = await import(
  cityModule('convention-platform')
);
const { landmarkLocalXZ } = await import(cityModule('landmark-ground'));
const { project } = await import(cityModule('geo'));
const { LandmarkDetail } = await import(cityModule('landmark-detail'));
const placements = {
  'bc-place': { lon: -123.1120067, lat: 49.2766985, yaw: 0.677, baseY: 5 },
  harbour: {
    lon: -123.1120903,
    lat: 49.2847656,
    yaw: -0.8,
    baseY: 17.96477617737215,
  },
  convention: { lon: -123.1159678, lat: 49.2890752, yaw: -0.403, baseY: 4 },
  'vancouver-house': {
    lon: -123.131029,
    lat: 49.2749256,
    yaw: -0.78,
    baseY: 14.140882560018866,
  },
};
const harbourRing = [
  [-24.5, -41.8],
  [54.4, -43],
  [55, 35],
  [21.3, 36.5],
  [18.8, 36.5],
  [18.8, 38],
  [-16.8, 38.4],
  [-24, 31],
  [-21, 27],
  [-21, 22.5],
  [-24.5, 22.5],
];
const conventionOutline = [
  [65.5, 70.29],
  [69.75, 36.51],
  [86.4, -19.4],
  [93.4, -40.8],
  [102.5, -94.5],
  [74.4, -87.6],
  [35.8, -82.9],
  [34.51, -67.3],
  [11.95, -67.09],
  [13.5, -80.2],
  [-54.1, -72],
  [-104.78, 47.5],
  [-61.06, 64.02],
  [-44.21, 70.38],
].map(([x, z]) => [x * 1.044, z * 1.044]);
const platform = createConventionPlatformSampler(),
  origin = project([placements.convention.lon, placements.convention.lat]);
// Controlled test ground: BC gate 0 and Harbour's west lower bay deliberately
// lack support; other candidates are flat. This is not a live topography claim.
const samples = {
  'bc-place': (x, z) => (x > 100 && Math.abs(z) < 10 ? null : 1),
  harbour: (x, z) => (x < -20 && z > -13 && z < -6 ? null : 1),
  convention: (x, z) => {
    const p = landmarkLocalXZ(origin, -0.403, x, z),
      y = platform.sample(...p);
    return y === undefined ? null : y - 4;
  },
  'vancouver-house': () => {
    throw new Error('House has no new ground entry');
  },
};
const plans = Object.keys(placements).map((kind) =>
  resolveExtraLandmarkPlan(
    kind,
    placements[kind],
    'test-selected-surface',
    samples[kind],
  ),
);
const plan = (kind) => plans.find((p) => p.kind === kind);
test('BC full recess needs actual level support and headroom; absent ground never defaults open', () => {
  const entry = bc.planBCPlaceEntries({ actualSurface: () => 1 }).entries[0];
  assert.equal(
    bcPlaceRecessRejection(entry, () => 1),
    undefined,
  );
  assert.match(
    bcPlaceRecessRejection(entry, () => null),
    /Missing/,
  );
  assert.match(
    bcPlaceRecessRejection(entry, () => entry.thresholdY + 0.04),
    /intrudes/,
  );
  let i = 0;
  assert.match(
    bcPlaceRecessRejection(entry, () => (i++ % 2 ? 1 : 1.4)),
    /relief/,
  );
  assert.match(
    bcPlaceRecessRejection(entry, () => entry.thresholdY - 0.21),
    /support/,
  );
  assert.match(
    bcPlaceRecessRejection({ ...entry, headY: entry.thresholdY + 2 }, () => 1),
    /clearance/,
  );
  assert.match(
    bcPlaceRecessRejection({ ...entry, headY: 7.56 }, () => 1),
    /clearance/,
  );
  const empty = resolveExtraLandmarkPlan(
    'bc-place',
    placements['bc-place'],
    'missing',
    () => null,
  );
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.rejected.length, 24);
  const group = createWorkerLandmark(false, empty);
  assert.equal(group.userData.envelopeRefinement.entries.length, 0);
  disposeGroup(group);
});
test('BC accepted entries are real apertures while unsupported source gate remains closed', () => {
  const p = plan('bc-place');
  assert.equal(p.entries.length, 23);
  assert.deepEqual(
    p.rejected.map((e) => e.index),
    [0],
  );
  const mesh = new THREE.Mesh(
    bc.createBCPlaceOuterWall(144, p.entries),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  for (const entry of bc.planBCPlaceEntries({ actualSurface: () => 1 })
    .entries) {
    const y = entry.thresholdY + 1.5,
      normal = new THREE.Vector3(...entry.normal),
      origin = new THREE.Vector3(
        ...bc.bcPlaceWallPoint(entry.angle, y),
      ).addScaledVector(normal, 3);
    const hits = new THREE.Raycaster(
      origin,
      normal.clone().negate(),
    ).intersectObject(mesh);
    if (entry.index === 0)
      assert.ok(
        hits.length && hits[0].distance < 3.1,
        'rejected gate was opened',
      );
    else
      assert.ok(
        !hits.length || hits[0].distance > 5,
        `accepted gate ${entry.index} blocked`,
      );
  }
  disposeGroup(mesh);
});
test('Harbour unsupported candidate retains actual lower masonry, accepted bays have depth', () => {
  const p = plan('harbour');
  assert.deepEqual(
    p.bays.filter((b) => b.entry).map((b) => [b.edge, b.index]),
    [
      [2, 3],
      [5, 3],
    ],
  );
  assert.equal(p.bays.find((b) => b.edge === 10 && b.index === 6).entry, false);
  const group = createWorkerLandmark(true, p);
  group.updateMatrixWorld(true);
  for (const b of p.bays.filter((b) => b.entry || b.reason)) {
    const u = (b.left + b.right) / 2,
      y = b.entry ? b.threshold + 1.2 : 0.8,
      point = harbour.harbourPoint(b, u, y, -3),
      direction = new THREE.Vector3(-b.normal[0], 0, -b.normal[1]);
    const hits = new THREE.Raycaster(
      new THREE.Vector3(...point),
      direction,
    ).intersectObject(group, true);
    assert.ok(hits.length);
    if (b.entry) assert.ok(hits[0].distance > 3.5);
    else assert.ok(hits[0].distance < 3.1);
  }
  disposeGroup(group);
});
test('Convention selects only original low podium triangles and keeps four supported interfaces', () => {
  assert.equal(platform.triangles, 12);
  assert.equal(plan('convention').entries.length, 4);
  for (const e of plan('convention').entries) {
    close(e.threshold, 0.82, 1e-6);
    assert.ok(e.head - e.threshold >= 2.25);
    assert.ok(e.head <= 4.8);
  }
  const top = convention.conventionPodiumTopTriangles();
  assert.equal(top.length, 108);
  for (let i = 1; i < top.length; i += 3) close(top[i], 0.8, 1e-6);
  for (let i = 0; i < top.length; i += 9) {
    const x = (top[i] + top[i + 3] + top[i + 6]) / 3,
      z = (top[i + 2] + top[i + 5] + top[i + 8]) / 3,
      world = landmarkLocalXZ(origin, -0.403, x, z);
    close(platform.sample(...world), 4.8, 1e-6);
  }
  assert.equal(platform.sample(origin[0] + 500, origin[1] + 500), undefined);
  for (const detail of [false, true]) {
    const group = createWorkerLandmark(detail, plan('convention'));
    assert.equal(group.children.length, 12);
    const p = group.children
        .find((m) => m.name.endsWith('/concrete'))
        .geometry.getAttribute('position'),
      actual = [];
    for (let i = 0; i < p.count; i += 3)
      if ([0, 1, 2].every((j) => Math.abs(p.getY(i + j) - 0.8) < 1e-5))
        for (let j = i; j < i + 3; j++)
          actual.push(p.getX(j), p.getY(j), p.getZ(j));
    assert.deepEqual(actual, top);
    disposeGroup(group);
  }
  const missing = resolveExtraLandmarkPlan(
    'convention',
    placements.convention,
    'missing',
    () => null,
  );
  assert.equal(missing.entries.length, 0);
  const closed = createWorkerLandmark(false, missing);
  assert.equal(closed.userData.facadeEntries.length, 0);
  disposeGroup(closed);
});
test('Convention aperture removes only accepted door-height glazing and mullion sections', () => {
  const e = plan('convention').entries[0],
    midpoint = (e.left + e.right) / 2;
  const pieces = interfaces.conventionGlassPieces(0, 1, 0.8, 8, [e]);
  assert.ok(
    !pieces.some(
      (p) =>
        midpoint > p.left &&
        midpoint < p.right &&
        e.threshold + 1 > p.low &&
        e.threshold + 1 < p.high,
    ),
  );
  assert.deepEqual(interfaces.conventionGlassPieces(0, 1, 0.8, 8, []), [
    { left: 0, right: 1, low: 0.8, high: 8 },
  ]);
  for (const [low, high] of interfaces.conventionMullionPieces(
    midpoint,
    0.8,
    8,
    [e],
  ))
    assert.ok(high <= e.threshold || low >= e.head);
});
test('Stage8 factory heights, footprint constants, model anchors and material counts stay fixed', () => {
  for (const p of plans)
    for (const detail of [false, true]) {
      const group = createWorkerLandmark(detail, structuredClone(p)),
        box = assertFiniteGroup(group);
      assertPlacement(group, placements[p.kind]);
      const footprints = group.userData.solidFootprints;
      if (p.kind === 'bc-place') {
        assert.equal(footprints.length, 1);
        assert.equal(footprints[0].length, 73);
        for (const [x, z] of footprints[0])
          close((x / 112.8) ** 2 + (z / 91.8) ** 2, 1, 1e-10);
        close(box.max.y, detail ? 65.63687896728516 : 65.63809967041016);
      }
      if (p.kind === 'harbour') {
        assert.deepEqual(footprints, [[...harbourRing, harbourRing[0]]]);
        close(box.max.y, 177);
        assert.ok(
          box.min.x >= -24.716 &&
            box.max.x <= 55.182 &&
            box.min.z >= -43.149 &&
            box.max.z <= 38.565,
        );
      }
      if (p.kind === 'convention') {
        assert.deepEqual(footprints, [
          [...conventionOutline, conventionOutline[0]],
        ]);
        close(box.min.y, -4.6);
        close(box.max.y, 30.39387512207031);
        assert.equal(group.children.length, 12);
      }
      if (p.kind === 'vancouver-house') {
        assert.deepEqual(footprints, []);
        close(box.max.y, 156.85);
        group.traverse((o) => {
          if (o.isMesh) {
            const a = o.geometry.getAttribute('position');
            for (let i = 0; i < a.count; i++)
              assert.ok(
                house.inVancouverHouseEnvelope(a.getX(i), a.getY(i), a.getZ(i)),
              );
          }
        });
      }
      assert.equal(
        group.userData.nightMaterials.length,
        p.kind === 'convention' ? 5 : p.kind === 'vancouver-house' ? 1 : 3,
      );
      disposeGroup(group);
    }
});
test('seven-model registry rejects moved, incomplete and non-plain extra DTOs', () => {
  const incomplete = structuredClone(plan('bc-place'));
  incomplete.entries.pop();
  assert.throws(() => createWorkerLandmark(false, incomplete), /Incomplete/);
  const moved = structuredClone(plan('harbour'));
  moved.placement.yaw += 0.1;
  assert.throws(() => createWorkerLandmark(false, moved), /placement/);
  const invalid = structuredClone(plan('convention'));
  invalid.entries[0].threshold = 9;
  assert.throws(() => createWorkerLandmark(false, invalid), /plan changed/);
  const nonplain = structuredClone(plan('vancouver-house'));
  nonplain.callback = () => 1;
  assert.throws(() => createWorkerLandmark(false, nonplain));
});
test('serialized Stage8 plans retain deterministic geometry, night registration and existing LOD lifetime', async () => {
  for (const p of plans) {
    const a = createWorkerLandmark(false, p),
      b = createWorkerLandmark(false, JSON.parse(JSON.stringify(p)));
    assert.equal(geometryDigest(a), geometryDigest(b));
    disposeGroup(a);
    disposeGroup(b);
    await assertLOD(LandmarkDetail, createWorkerLandmark, p);
  }
});
