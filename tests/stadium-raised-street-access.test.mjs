import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { walkFlat } from './helpers/station-walker.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildStadium } from '../tools/station-interiors/southeast.mjs';
const { SkyTrainStationOwner, stationWorldPose } = await import(
  cityModule('skytrain-stations')
);
const { makeStationStreetAccess, SKYTRAIN_STREET_ENTRANCES } = await import(
  cityModule('skytrain-street-access')
);
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const { project } = await import(cityModule('geo'));
const routes = validateSkyTrainRoutes(
  JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
);
const original = JSON.parse(
  fs.readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
).stations.find((s) => s.stationId === 'stadium-chinatown');
const data = adaptSkyTrainStationFrame(
  makeRuntimeStation(rebuildStadium(original), '0'.repeat(64)),
  routes,
);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function follow(o, initial, goals) {
  let foot = initial;
  for (const goal of goals) {
    const start = foot,
      dx = goal[0] - foot.position[0],
      dz = goal[2] - foot.position[2],
      n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.045));
    for (let i = 0; i < n; i++) {
      const next = o.walk(foot, dx / n, dz / n);
      assert(
        Math.abs(next.position[1] - foot.position[1]) <= 0.221,
        'walking cannot teleport between floors',
      );
      assert(o.isClearFoot(next));
      foot = next;
    }
    if (
      distance(foot.position, goal) > 0.16 &&
      Math.abs(goal[1] - start.position[1]) < 0.23
    )
      foot = walkFlat(o, start, goal);
    assert(
      distance(foot.position, goal) < 0.17,
      `blocked from ${start.position} toward ${goal}: ${foot.position}`,
    );
    assert(Math.abs(foot.position[1] - goal[1]) < 0.23);
  }
  return foot;
}
for (const id of ['beatty-upper', 'pacific-lower', 'keefer-place'])
  test(`Stadium ${id}: actual city street -> island -> public street`, () => {
    const o = new SkyTrainStationOwner(data, cityElevation, 'balanced', true);
    try {
      const entry = o.streetEntrances().find((e) => e.id === id),
        route = o.streetRoutes().find((r) => r.entranceId === id);
      assert(
        entry && route,
        'every named entrance needs physical public access',
      );
      assert(
        Math.abs(
          entry.threshold[1] -
            cityElevation(entry.threshold[0], entry.threshold[2]),
        ) < 1e-7,
      );
      let foot = o.tryEnterFromStreet(entry.threshold);
      assert(foot);
      foot = follow(o, foot, route.points.slice(1));
      assert(o.floorAt(foot.position, route.platformSurfaceId));
      foot = follow(o, foot, [...route.points].reverse().slice(1));
      foot = follow(o, foot, [
        o.toLocal(entry.threshold),
        o.toLocal(entry.outward),
      ]);
      assert(
        o.streetExit(foot),
        'return walk must release station ownership on the actual ground',
      );
      for (const platform of data.platforms)
        for (const door of o.boardingDoors(platform.line, platform.direction))
          assert(o.isClearFoot(door.waiting));
    } finally {
      o.dispose();
    }
  });
test('Keefer street ownership follows the mapped external stairhead while its station door stays on the raised deck', () => {
  const o = new SkyTrainStationOwner(data, cityElevation, 'balanced', true);
  try {
    const approach =
        data.authoredInterior.raisedStreetApproaches['keefer-place'],
      entry = o.streetEntrances().find((e) => e.id === 'keefer-place');
    const [x, z] = project(approach.topLonLat);
    assert(distance(entry.threshold, [x, 0, z]) < 1e-6);
    const ref = SKYTRAIN_STREET_ENTRANCES[data.id].find(
        (e) => e.id === 'keefer-place',
      ),
      [doorX, doorZ] = project(ref.lonlat),
      ground = cityElevation(doorX, doorZ);
    const floor = o.geometryData.floors.find(
        (f) => f.id === 'stadium-keefer-entry',
      ),
      [ox, oz] = project(data.lonlat),
      deckY = cityElevation(ox, oz) + floor.vertices[0][1];
    assert(
      deckY - ground > 4.8 && deckY - ground < 5.2,
      'terrain underneath cannot determine the station deck height',
    );
    assert.equal(
      o.tryEnterFromStreet([doorX, ground, doorZ]),
      null,
      'being below the bridge cannot warp a passenger onto its deck',
    );
    const stair = o.geometryData.connections.find((c) =>
      c.id.endsWith('keefer-place-mapped-approach-stair'),
    );
    assert.equal(
      stair.treads.length,
      20,
      'mapped external flight has 20 real tread surfaces',
    );
    const outsideParts = o.geometryData.parts.filter((p) =>
      /keefer-place-(mapped|deck-guard)/.test(p.id),
    );
    assert(outsideParts.some((p) => p.role === 'handrail'));
    assert(outsideParts.some((p) => p.role === 'wall'));
    assert(outsideParts.some((p) => p.role === 'floor'));
    assert(
      !outsideParts.some((p) => p.role === 'ceiling' || p.role === 'soffit'),
      'outdoor pedestrian approaches remain open to the sky',
    );
  } finally {
    o.dispose();
  }
});
test('authored threshold height samples actual floor triangles and does not fill a hole on an unmapped approach', () => {
  const access = makeStationStreetAccess(data, cityElevation),
    throat = access.geometry.floors.find(
      (f) => f.id === 'stadium-chinatown-beatty-upper-authored-threshold',
    );
  assert.equal(
    throat.vertices[0][1],
    0,
    'inside the entrance hall the slab overrides sloping outdoor terrain',
  );
  // A mapped doorway's short outside throat deliberately meets its own door
  // height. Exercise the separate interpreted approach case, whose start is
  // two metres inward and must query actual hall triangles rather than bounds.
  const interpreted = structuredClone(data);
  interpreted.entrances.find((e) => e.id === 'stadium-beatty-entry').point[2] +=
    1.8;
  const [originX, originZ] = project(interpreted.lonlat),
    base = cityElevation(originX, originZ),
    inward = stationWorldPose(interpreted, cityElevation, [0, 0, 1]).position,
    // An explicit hillside makes this floor-query unit case discriminating.
    // The three-door native round trips above keep the real City DEM.
    slopingTerrain = (x, z) =>
      base -
      ((x - originX) * (inward[0] - originX) +
        (z - originZ) * (inward[2] - originZ)) *
        0.5;
  const uncut = makeStationStreetAccess(
    interpreted,
    slopingTerrain,
  ).geometry.floors.find((f) => f.id === throat.id);
  assert.equal(uncut.vertices[0][1], 0);
  const hole = structuredClone(interpreted),
    floor = hole.floors.find((f) => f.id === 'stadium-beatty-street');
  const xs = floor.vertices.map((p) => p[0]),
    zs = floor.vertices.map((p) => p[2]),
    xmin = Math.min(...xs),
    xmax = Math.max(...xs);
  floor.vertices = [];
  floor.indices = [];
  for (const [zmin, zmax] of [
    [Math.min(...zs), 1.5],
    [2.5, Math.max(...zs)],
  ]) {
    const i = floor.vertices.length;
    floor.vertices.push(
      [xmin, 0, zmin],
      [xmin, 0, zmax],
      [xmax, 0, zmax],
      [xmax, 0, zmin],
    );
    floor.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const cut = makeStationStreetAccess(
    hole,
    slopingTerrain,
  ).geometry.floors.find((f) => f.id === throat.id);
  const rampPoint = uncut.vertices[0].map(
      (v, axis) => (v + uncut.vertices[3][axis]) / 2,
    ),
    world = stationWorldPose(interpreted, slopingTerrain, rampPoint).position,
    [ox, oz] = project(interpreted.lonlat),
    terrainY = slopingTerrain(world[0], world[2]) - slopingTerrain(ox, oz);
  assert(
    Math.abs(terrainY) > 0.3,
    'the sloping city terrain differs materially from the hall slab',
  );
  assert(
    Math.abs(cut.vertices[0][1] - terrainY) < 1e-7,
    'a hole inside the floor bounding box retains actual terrain instead of receiving a fabricated hall height',
  );
});
