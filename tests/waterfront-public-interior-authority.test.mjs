import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
const { PublicInteriors } = await import(cityModule('interiors'));
const { SkyTrainStations } = await import(cityModule('skytrain-stations'));
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { StreetNavigation } = await import(cityModule('navigation'));
const { GroundSurfaceIndex, walkableGroundMeshes } = await import(
  cityModule('ground-surface')
);
const packet = JSON.parse(
    fs.readFileSync('public/models/skytrain-stations/waterfront.json'),
  ),
  routes = JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
  adapted = () => adaptSkyTrainStationFrame(structuredClone(packet), routes);
function fixture(failConstruction = false, complete = true) {
  const scene = new THREE.Scene(),
    landmarks = new THREE.Group(),
    e = {
      scene,
      landmarks,
      renderer: {},
      landmarkDetails: [],
      data: {},
      elevation: cityElevation,
      camera: new THREE.PerspectiveCamera(),
      settings: { buildings: true, mode: 'walk' },
    },
    interiors = new PublicInteriors(e),
    nav = {
      e,
      groundSurface: null,
      groundHeight: StreetNavigation.prototype.groundHeight,
    };
  scene.add(landmarks);
  e.interiors = interiors;
  e.navigation = nav;
  scene.updateMatrixWorld(true);
  nav.groundSurface = new GroundSurfaceIndex(walkableGroundMeshes(scene));
  const data = adapted();
  if (!complete) delete data.authoredInterior.heritageHallOrientation;
  const stations = new SkyTrainStations({
    scene,
    heightAt: failConstruction ? () => NaN : cityElevation,
    streetHeightAt: (x, z) => nav.groundHeight(x, z),
    fetchStation: async () => data,
    prepareOwner: (data) => interiors.prepareWaterfrontStationAuthority(data),
  });
  e.skyTrainTravel = { stations };
  const site = interiors.sites.find((s) => s.id === 'waterfront');
  e.camera.position.copy(site.origin).add(new THREE.Vector3(0, 2, 20));
  return { e, interiors, nav, stations, site, data };
}
const visible = (object) => {
  for (let item = object; item; item = item.parent)
    if (!item.visible) return false;
  return true;
};
const casts = (root, origin, direction, far = 12) =>
  new THREE.Raycaster(origin, direction, 0, far)
    .intersectObject(root, true)
    .filter((hit) => visible(hit.object) && !hit.object.material.transparent);
const sourceFloor = (owner, id) =>
  owner.geometryData.floors.find((f) => f.id === id);
function clearHallFoot(owner) {
  const f = sourceFloor(owner, 'waterfront-heritage-hall');
  for (let i = 0; i < f.indices.length; i += 3) {
    const point = [0, 0, 0];
    for (const index of f.indices.slice(i, i + 3))
      f.vertices[index].forEach((n, axis) => (point[axis] += n / 3));
    const foot = owner.floorAt(point, f.id);
    if (foot && owner.isClearFoot(foot)) return foot;
  }
  assert.fail('real authored hall needs a clear supported viewpoint');
}
test('metadata prefetch and incomplete Waterfront packets leave the legacy public hall intact', async () => {
  for (const complete of [true, false]) {
    const f = fixture(false, complete);
    try {
      const point = f.interiors.world(f.site, 0, 0),
        before = f.interiors.height(...point),
        cached = f.nav.groundSurface;
      await f.stations.describe('waterfront');
      f.interiors.update();
      assert.equal(f.site.legacyHall.visible, true);
      assert.equal(f.interiors.height(...point), before);
      assert.equal(f.nav.groundSurface, cached);
      if (!complete) {
        await f.stations.ensure('waterfront');
        f.interiors.update();
        assert.equal(f.site.legacyHall.visible, true);
        assert.equal(f.interiors.height(...point), before);
      }
    } finally {
      f.stations.dispose();
    }
  }
});
test('completed Waterfront replaces cached legacy floors with actual ground-level hall triangles and collision', async () => {
  const f = fixture();
  try {
    const cached = f.nav.groundSurface,
      owner = await f.stations.ensure('waterfront');
    f.interiors.update();
    f.e.scene.updateMatrixWorld(true);
    assert.equal(f.site.legacyHall.visible, false);
    assert.notEqual(
      f.nav.groundSurface,
      cached,
      'cached old triangles must be invalidated',
    );
    const foot = clearHallFoot(owner),
      world = owner.toWorld(foot);
    assert(Math.abs(f.interiors.height(world[0], world[2]) - world[1]) < 1e-7);
    assert(Math.abs(f.nav.groundHeight(world[0], world[2]) - world[1]) < 1e-7);
    assert.equal(f.interiors.clear(world[0], world[2], 'walk'), true);
    assert.equal(f.interiors.clear(world[0], world[2], 'drive'), false);
    const floorMeshes = walkableGroundMeshes(f.e.scene);
    f.site.legacyHall.traverse((object) => {
      if (object instanceof THREE.Mesh) assert(!floorMeshes.includes(object));
    });
    const primary = owner
      .streetEntrances()
      .find((e) => e.id === 'cordova-lobby');
    assert(
      Math.abs(
        primary.threshold[1] -
          cityElevation(primary.threshold[0], primary.threshold[2]),
      ) < 1e-7,
      'the old +0.519 m public slab cannot redefine the mapped street threshold',
    );
    const bad = owner.geometryData.obstacles.find((o) =>
      /heritage-.*(column|pier)/.test(o.id),
    );
    assert(bad, 'retained physical hall column');
    const column = owner.toWorld([
      bad.position[0],
      foot.position[1],
      bad.position[2],
    ]);
    assert.equal(f.interiors.clear(column[0], column[2], 'walk'), false);
  } finally {
    f.stations.dispose();
  }
});
test('mapped Cordova opening is a genuine physical aperture and neighboring heritage façade remains', async () => {
  const f = fixture();
  try {
    const owner = await f.stations.ensure('waterfront');
    f.interiors.update();
    f.e.scene.updateMatrixWorld(true);
    const entrance = owner.geometryData.entrances.find(
        (e) => e.id === 'cordova-lobby',
      ),
      door = new THREE.Vector3(...owner.toWorld(entrance.point)),
      inward = new THREE.Vector3(
        ...entrance.inwardDirection,
      ).transformDirection(owner.group.matrixWorld),
      left = new THREE.Vector3(inward.z, 0, -inward.x);
    for (const lateral of [-1.4, 0, 1.4])
      for (const height of [0.35, 1.6, 2.7]) {
        const origin = door
          .clone()
          .addScaledVector(inward, -5)
          .addScaledVector(left, lateral);
        origin.y += height;
        assert.equal(
          casts(f.site.envelope, origin, inward).length,
          0,
          `physical mapped portal ${lateral}/${height}`,
        );
      }
    for (const lateral of [-7, 7]) {
      const origin = door
        .clone()
        .addScaledVector(inward, -5)
        .addScaledVector(left, lateral);
      origin.y += 1.6;
      assert(
        casts(f.site.envelope, origin, inward).length,
        'adjacent brick remains solid',
      );
    }
    const top = door.clone().addScaledVector(inward, -5);
    top.y += 5;
    assert(
      casts(f.site.envelope, top, inward).length,
      'the heritage header is retained',
    );
    const eye = door.clone().addScaledVector(inward, 1.4);
    eye.y += 1.65;
    const hits = casts(f.e.landmarks, eye, inward, 10);
    assert.equal(
      hits.length,
      0,
      'old public furniture/walls cannot obstruct the new nave sightline',
    );
  } finally {
    f.stations.dispose();
  }
});
test('retiring the station hall preserves physical SkyWalk, SeaBus lounge and other public interiors', async () => {
  const f = fixture();
  const points = [
      [-6, -43],
      [9, -140],
      [19, -172],
      [35, -220],
    ],
    before = points.map(([x, z]) =>
      f.interiors.height(...f.interiors.world(f.site, x, z)),
    ),
    other = f.interiors.sites
      .filter((s) => s.id !== 'waterfront')
      .map((s) => {
        const entry = f.interiors.entry(s.id);
        return { id: s.id, entry, y: f.interiors.height(entry.x, entry.z) };
      });
  try {
    await f.stations.ensure('waterfront');
    f.interiors.update();
    f.e.scene.updateMatrixWorld(true);
    for (const [i, [x, z]] of points.entries()) {
      const world = f.interiors.world(f.site, x, z),
        y = f.interiors.height(...world);
      assert.equal(y, before[i]);
      assert.equal(f.interiors.clear(...world, 'walk'), true);
      assert.equal(f.interiors.clear(...world, 'boat'), false);
      const ray = casts(
        f.site.group,
        new THREE.Vector3(world[0], y + 1, world[1]),
        new THREE.Vector3(0, -1, 0),
        1.1,
      );
      assert(
        ray.some(
          (h) =>
            h.object.userData.walkSurface && Math.abs(h.point.y - y) < 0.025,
        ),
        `retained physical transport floor ${x},${z}, y${y}; ${ray.map((h) => `${h.object.name}:${h.point.y}`).join(',')}`,
      );
    }
    for (const { entry, y } of other) {
      assert.equal(f.interiors.height(entry.x, entry.z), y);
      assert.equal(f.interiors.clear(entry.x, entry.z, 'walk'), true);
    }
  } finally {
    f.stations.dispose();
  }
});
test('owner-construction failure rolls back authority and successful disposal restores legacy geometry and ground participation', async () => {
  for (const fail of [true, false]) {
    const f = fixture(fail),
      point = f.interiors.world(f.site, 0, 0),
      before = f.interiors.height(...point),
      counts = [];
    f.site.envelope.traverse((o) => {
      if (o instanceof THREE.Mesh)
        counts.push(o.geometry.attributes.position.count);
    });
    if (fail) await assert.rejects(f.stations.ensure('waterfront'));
    else {
      await f.stations.ensure('waterfront');
      f.interiors.update();
    }
    f.stations.dispose();
    f.interiors.update();
    assert.equal(f.site.legacyHall.visible, true);
    assert.equal(f.interiors.height(...point), before);
    const after = [];
    f.site.envelope.traverse((o) => {
      if (o instanceof THREE.Mesh)
        after.push(o.geometry.attributes.position.count);
    });
    assert.deepEqual(after, counts);
    assert(
      walkableGroundMeshes(f.e.scene).some(
        (m) => m.parent === f.site.legacyHall,
      ),
    );
  }
});

test('Waterfront launcher uses the actual mapped outside approach and faces its native Cordova doorway', async () => {
  const f = fixture();
  try {
    const owner = await f.stations.ensure('waterfront');
    f.interiors.update();
    const door = owner.streetEntrances().find((e) => e.id === 'cordova-lobby'),
      entry = f.interiors.entry('waterfront'),
      inward = new THREE.Vector3(...door.localDirection).transformDirection(
        owner.group.matrixWorld,
      );
    assert(
      Math.hypot(entry.x - door.outward[0], entry.z - door.outward[2]) < 1e-8,
    );
    assert(Math.abs(entry.y - door.outward[1] - 1.25) < 1e-8);
    assert(Math.abs(Math.sin(entry.yaw) - inward.x) < 1e-8);
    assert(Math.abs(Math.cos(entry.yaw) - inward.z) < 1e-8);
    assert.equal(entry.surface, 'ground');
  } finally {
    f.stations.dispose();
  }
});

test('the real graded SeaBus connector replaces the old higher deck and crosses to retained flat bridge with full body support', async () => {
  const f = fixture();
  try {
    const owner = await f.stations.ensure('waterfront');
    f.interiors.update();
    f.e.scene.updateMatrixWorld(true);
    const floors = [0, 1].map((i) =>
      sourceFloor(owner, `waterfront-seabus-heritage-connector-${i}`),
    );
    assert(
      floors.every(Boolean),
      'actual published source includes the graded and flat connector',
    );
    const mean = (a, b) => a.map((n, i) => (n + b[i]) / 2),
      start = mean(floors[0].vertices[0], floors[0].vertices[3]),
      end = mean(floors[1].vertices[1], floors[1].vertices[2]),
      outward = new THREE.Vector3(...end)
        .sub(new THREE.Vector3(...start))
        .setY(0)
        .normalize(),
      worldOut = outward.clone().transformDirection(owner.group.matrixWorld),
      final = new THREE.Vector3(...owner.toWorld(end));
    let previous;
    for (let t = 0; t <= 1.000001; t += 0.02) {
      const point = start.map(
          (n, i) =>
            n +
            ((floors[0].vertices[1][i] + floors[0].vertices[2][i] - 2 * n) *
              t) /
              2,
        ),
        world = owner.toWorld(point),
        height = f.interiors.height(world[0], world[2]);
      assert(
        Math.abs(height - world[1]) < 1e-7,
        `height follows the real graded source triangles t${t}: ${height}/${world[1]}`,
      );
      assert.equal(
        f.interiors.clear(world[0], world[2], 'walk'),
        true,
        `graded centre ${t}`,
      );
      if (previous !== undefined) assert(Math.abs(height - previous) < 0.221);
      previous = height;
      const stale = casts(
        f.site.group,
        new THREE.Vector3(world[0], world[1] + 0.8, world[2]),
        new THREE.Vector3(0, -1, 0),
        0.79,
      );
      assert.equal(
        stale.filter(
          (h) => h.object.userData.walkSurface && h.point.y > world[1] + 0.025,
        ).length,
        0,
        'retired flat bridge cannot hover above the new grade',
      );
    }
    for (let along = -0.7; along <= 0.700001; along += 0.025) {
      const point = final.clone().addScaledVector(worldOut, along),
        height = f.interiors.height(point.x, point.z);
      assert(Math.abs(height - final.y) < 0.0001, `flat seam height ${along}`);
      assert.equal(
        f.interiors.clear(point.x, point.z, 'walk'),
        true,
        `full capsule across real source/public seam ${along}`,
      );
    }
    const across = new THREE.Vector3(worldOut.z, 0, -worldOut.x),
      side = final
        .clone()
        .addScaledVector(worldOut, -0.1)
        .addScaledVector(across, 2.1);
    assert.equal(
      f.interiors.clear(side.x, side.z, 'walk'),
      false,
      'source side wall still rejects a full passenger body',
    );
    for (const along of [-0.2, 0.2]) {
      const point = final.clone().addScaledVector(worldOut, along),
        hits = casts(
          f.e.scene,
          point.clone().add(new THREE.Vector3(0, 0.5, 0)),
          new THREE.Vector3(0, -1, 0),
          0.6,
        );
      assert(
        hits.some((h) => Math.abs(h.point.y - final.y) < 0.025),
        'both sides retain actual rendered support',
      );
    }
  } finally {
    f.stations.dispose();
  }
});
