import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { stationConstructionPortals } = await import(
  cityModule('skytrain-construction-access')
);
const { SKYTRAIN_STREET_ENTRANCES } = await import(
  cityModule('skytrain-street-access')
);
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const routes = validateSkyTrainRoutes(
  JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
);
const catalog = Object.keys(SKYTRAIN_STREET_ENTRANCES).map((id) =>
  adaptSkyTrainStationFrame(
    JSON.parse(fs.readFileSync(`public/models/skytrain-stations/${id}.json`)),
    routes,
  ),
);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const makeOwner = (data, streetHeightAt = cityElevation) =>
  new SkyTrainStationOwner(
    data,
    cityElevation,
    'balanced',
    true,
    streetHeightAt,
  );
const legacyCatalog = catalog.filter((data) => !data.authoredInterior),
  expectedLegacyPairs = legacyCatalog.reduce((sum, data) => {
    const owner = makeOwner(data),
      count = owner.streetRoutes().length;
    owner.dispose();
    return sum + count;
  }, 0),
  expectedLegacyEntrances = legacyCatalog.reduce((sum, data) => {
    const owner = makeOwner(data),
      count = owner.streetEntrances().length;
    owner.dispose();
    return sum + count;
  }, 0);

function walk(owner, foot, goals) {
  for (const goal of goals) {
    const dx = goal[0] - foot.position[0],
      dz = goal[2] - foot.position[2],
      steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let i = 0; i < steps; i++) {
      const next = owner.walk(foot, dx / steps, dz / steps);
      assert(owner.isClearFoot(next));
      assert.equal(owner.streetExit(next), null);
      assert(Math.abs(next.position[1] - foot.position[1]) < 0.221);
      foot = next;
    }
    assert(
      distance(foot.position, goal) < 0.23,
      `${owner.data.id}: portal approach blocked at ${foot.position}, wanted ${goal}`,
    );
  }
  return foot;
}

test('all legacy construction pairs retain real entrance/platform provenance and clear separate displays', () => {
  let pairCount = 0;
  for (const data of legacyCatalog) {
    const owner = makeOwner(data),
      before = JSON.stringify({ data, geometry: owner.geometryData }),
      portals = stationConstructionPortals(owner, cityElevation),
      sources = portals.filter((p) => p.kind === 'platform'),
      returns = portals.filter((p) => p.kind === 'exit');
    assert.deepEqual(portals, stationConstructionPortals(owner, cityElevation));
    assert.equal(sources.length, owner.streetRoutes().length);
    assert.equal(portals.length, new Set(portals.map((p) => p.id)).size);
    for (const source of sources) {
      pairCount++;
      const back = returns.find((p) => p.pairId === source.pairId),
        entrance = owner
          .streetEntrances()
          .find((e) => e.id === source.entranceId),
        route = owner
          .streetRoutes()
          .find(
            (r) =>
              r.entranceId === source.entranceId &&
              r.platformSurfaceId === source.platformSurfaceId,
          ),
        platforms = data.platforms.filter(
          (p) => p.surfaceId === source.platformSurfaceId,
        );
      assert(back);
      assert.equal(source.target.kind, 'platform');
      assert.equal(back.target.kind, 'street');
      assert.equal(source.stationId, data.id);
      assert.equal(source.entranceLabel, entrance.label);
      assert.equal(source.lineId, platforms[0].line);
      assert.deepEqual(source.directions, [
        ...new Set(platforms.map((p) => p.direction)),
      ]);
      for (const direction of source.directions)
        assert(source.label.toLowerCase().includes(direction));
      assert(back.label.includes(entrance.label));
      assert.deepEqual(source.target.point.position, route.points.at(-1));
      assert.equal(source.target.point.surfaceId, source.platformSurfaceId);
      assert(owner.isClearFoot(source.target.point));
      assert.equal(back.point.surfaceId, source.platformSurfaceId);
      assert(
        distance(back.point.position, source.target.point.position) >= 2.8,
      );
      for (const platform of platforms)
        for (const door of owner.boardingDoors(
          platform.line,
          platform.direction,
        ))
          assert(distance(back.point.position, door.waiting.position) >= 2.2);
      for (const portal of [source, back]) {
        assert(owner.isClearFoot(portal.point));
        assert.equal(owner.streetExit(portal.point), null);
        assert(Number.isFinite(portal.point.yaw));
        for (const x of [-0.4, 0, 0.4])
          for (const z of [-0.34, 0, 0.34]) {
            const p = portal.signPosition,
              yaw = portal.point.yaw,
              foot = owner.floorAt([
                p[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
                p[1],
                p[2] - x * Math.sin(yaw) + z * Math.cos(yaw),
              ]);
            assert(foot && owner.isClearFoot(foot));
          }
      }
      const entered = owner.tryEnterFromStreet(entrance.threshold);
      assert(entered);
      walk(owner, entered, [source.point.position]);
    }
    for (let i = 0; i < portals.length; i++)
      for (let j = i + 1; j < portals.length; j++)
        if (portals[i].point.surfaceId === portals[j].point.surfaceId)
          assert(
            distance(portals[i].point.position, portals[j].point.position) >=
              2.29,
          );
    assert.equal(
      JSON.stringify({ data, geometry: owner.geometryData }),
      before,
    );
    const fresh = stationConstructionPortals(owner, cityElevation);
    portals[0].point.position[0] += 100;
    portals[0].target.point.position[0] += 100;
    portals[0].directions[0] = 'invalid';
    assert.deepEqual(stationConstructionPortals(owner, cityElevation), fresh);
    owner.dispose();
    assert.deepEqual(stationConstructionPortals(owner, cityElevation), []);
  }
  assert.equal(pairCount, expectedLegacyPairs);
});

test('authored interiors retain their walking routes without construction teleport pairs', () => {
  const authored = catalog.filter((data) => data.authoredInterior);
  assert(authored.length > 0);
  for (const data of authored) {
    const owner = makeOwner(data),
      before = JSON.stringify(owner.geometryData);
    assert(owner.streetRoutes().length > 0);
    assert.deepEqual(stationConstructionPortals(owner, cityElevation), []);
    assert.equal(JSON.stringify(owner.geometryData), before);
    owner.dispose();
  }
});

/** Find an ordinary floor route around the retained benches/columns, then
 * replay its segments with the production swept walker. No floor reassignment. */
function platformPath(owner, start, goal) {
  const floor = owner.geometryData.floors.find((f) => f.id === start.surfaceId),
    box = new THREE.Box3().setFromPoints(
      floor.vertices.map((p) => new THREE.Vector3(...p)),
    ),
    step = 0.5,
    nx = Math.floor((box.max.x - box.min.x - 0.7) / step),
    nz = Math.floor((box.max.z - box.min.z - 0.7) / step),
    nodes = new Map(),
    segmentClear = (a, b) => {
      const count = Math.max(1, Math.ceil(distance(a, b) / 0.12));
      for (let i = 0; i <= count; i++) {
        const p = a.map((v, j) => v + ((b[j] - v) * i) / count),
          foot = owner.floorAt(p, floor.id);
        if (!foot || !owner.isClearFoot(foot)) return false;
      }
      return true;
    };
  for (let x = 0; x <= nx; x++)
    for (let z = 0; z <= nz; z++) {
      const p = [
          box.min.x + 0.35 + x * step,
          start.position[1],
          box.min.z + 0.35 + z * step,
        ],
        foot = owner.floorAt(p, floor.id);
      if (foot && owner.isClearFoot(foot)) nodes.set(`${x},${z}`, p);
    }
  const queue = [],
    previous = new Map();
  for (const [key, p] of nodes)
    if (distance(p, start.position) < 0.9 && segmentClear(start.position, p)) {
      queue.push(key);
      previous.set(key, null);
    }
  for (let n = 0; n < queue.length; n++) {
    const key = queue[n],
      p = nodes.get(key);
    if (distance(p, goal) < 0.9 && segmentClear(p, goal)) {
      const path = [goal];
      for (let k = key; k !== null; k = previous.get(k))
        path.push(nodes.get(k));
      return path.reverse();
    }
    const [x, z] = key.split(',').map(Number);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = `${x + dx},${z + dz}`;
      if (
        previous.has(next) ||
        !nodes.has(next) ||
        !segmentClear(p, nodes.get(next))
      )
        continue;
      previous.set(next, key);
      queue.push(next);
    }
  }
  assert.fail(`${owner.data.id}: disconnected platform portal ${goal}`);
}

test('all platform arrivals can physically walk to their return portals around actual benches and columns', () => {
  let count = 0;
  for (const data of legacyCatalog) {
    const owner = makeOwner(data),
      portals = stationConstructionPortals(owner, cityElevation);
    for (const source of portals.filter((p) => p.kind === 'platform')) {
      const back = portals.find(
          (p) => p.kind === 'exit' && p.pairId === source.pairId,
        ),
        start = source.target.point,
        path = platformPath(owner, start, back.point.position),
        end = walk(owner, start, path);
      assert.equal(end.surfaceId, source.platformSurfaceId);
      count++;
    }
    owner.dispose();
  }
  assert.equal(count, expectedLegacyPairs);
});

test('every outside return uses real GIS-clear ground beyond automatic entry and preserves exact rendered height', async () => {
  const { StreetNavigation } = await import(cityModule('navigation')),
    { project, rings, inPolygon } = await import(cityModule('geo')),
    buildings = JSON.parse(
      fs.readFileSync('public/data/buildings.geojson'),
    ).features,
    landmarks = JSON.parse(
      fs.readFileSync('lib/city/landmark-footprints.json'),
    ).features,
    land = JSON.parse(
      fs.readFileSync('public/data/land.geojson'),
    ).features.flatMap((f) =>
      rings(f).map((p) => p.map((r) => r.map(project))),
    ),
    nav = Object.create(StreetNavigation.prototype);
  nav.mode = 'walk';
  nav.collisions = new Map();
  nav.e = {
    onLand: (x, z) => land.some((p) => inPolygon([x, z], p)),
    data: { waterPolys: [] },
  };
  for (const feature of [...buildings, ...landmarks]) {
    if ((feature.properties.minHeight || 0) > 4) continue;
    for (const ring of rings(feature)) {
      const polygon = ring.map((r) => r.map(project)),
        xs = polygon[0].map((p) => p[0]),
        zs = polygon[0].map((p) => p[1]);
      for (
        let x = Math.floor(Math.min(...xs) / 80);
        x <= Math.floor(Math.max(...xs) / 80);
        x++
      )
        for (
          let z = Math.floor(Math.min(...zs) / 80);
          z <= Math.floor(Math.max(...zs) / 80);
          z++
        ) {
          const key = `${x},${z}`;
          if (!nav.collisions.has(key)) nav.collisions.set(key, []);
          nav.collisions.get(key).push(polygon);
        }
    }
  }
  const seen = new Set(),
    renderedGround = (x, z) => cityElevation(x, z) + 1.9;
  for (const data of legacyCatalog) {
    const owner = makeOwner(data, renderedGround),
      portals = stationConstructionPortals(owner, renderedGround);
    for (const portal of portals.filter((p) => p.kind === 'exit')) {
      const point = portal.target.position,
        entrance = owner
          .streetEntrances()
          .find((e) => e.id === portal.entranceId),
        local = owner.toLocal(point),
        threshold = owner.toLocal(entrance.threshold),
        inward = entrance.localDirection,
        along =
          (local[0] - threshold[0]) * inward[0] +
          (local[2] - threshold[2]) * inward[2];
      seen.add(`${data.id}:${portal.entranceId}`);
      assert(
        nav.clearGround(point[0], point[2], 'walk'),
        `${portal.id}: blocked city ground`,
      );
      assert.equal(point[1], renderedGround(point[0], point[2]));
      assert(Math.abs(along + 3.7) < 1e-7);
      assert.equal(owner.tryEnterFromStreet(point), null);
      const outsideYaw = owner.yaw + Math.atan2(-inward[0], -inward[2]);
      assert(Math.abs(portal.target.yaw - outsideYaw) < 1e-12);
    }
    owner.dispose();
  }
  assert.equal(seen.size, expectedLegacyEntrances);
});

test('legacy station displays have no construction portals', () => {
  const owner = new SkyTrainStationOwner(catalog[0], cityElevation);
  assert.deepEqual(stationConstructionPortals(owner), []);
  owner.dispose();
});

test('nonuniform rendered street heights resolve the actual vestibule floor instead of assuming threshold height on an apron', () => {
  const renderedGround = (x, z) =>
    cityElevation(x, z) + 1.9 + Math.sin(x * 1.3 + z * 0.7) * 0.75;
  let count = 0;
  for (const data of legacyCatalog) {
    const owner = makeOwner(data, renderedGround),
      portals = stationConstructionPortals(owner, renderedGround);
    for (const portal of portals.filter((p) => p.kind === 'platform')) {
      count++;
      assert(owner.isClearFoot(portal.point));
      const entrance = owner
          .streetEntrances()
          .find((e) => e.id === portal.entranceId),
        threshold = owner.toLocal(entrance.threshold),
        vestibule = owner.floorAt(threshold);
      assert(vestibule);
      walk(owner, vestibule, [portal.point.position]);
    }
    owner.dispose();
  }
  assert.equal(count, expectedLegacyPairs);
});
