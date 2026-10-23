import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { walkFlat } from './helpers/station-walker.mjs';
const { SkyTrainStationOwner, SkyTrainStations } = await import(
  cityModule('skytrain-stations')
);
const { SKYTRAIN_STREET_ENTRANCES } = await import(
  cityModule('skytrain-street-access')
);
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const { applySkyTrainWorldOpenings, stationCityOpenings } = await import(
  cityModule('skytrain-world-openings')
);
const { SKYTRAIN_WORLD_STOCK } = await import(
  cityModule('skytrain-world-exterior')
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
const owner = (data) =>
  new SkyTrainStationOwner(data, cityElevation, 'balanced', true);
function follow(o, foot, goals, checkFoot = () => {}) {
  let maxRise = 0;
  for (const goal of goals) {
    const origin = foot;
    const dx = goal[0] - foot.position[0],
      dz = goal[2] - foot.position[2],
      steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
    for (let i = 0; i < steps; i++) {
      const next = o.walk(foot, dx / steps, dz / steps);
      maxRise = Math.max(
        maxRise,
        Math.abs(next.position[1] - foot.position[1]),
      );
      assert(o.isClearFoot(next));
      checkFoot(next);
      foot = next;
    }
    if (
      o.data.authoredInterior &&
      (Math.hypot(goal[0] - foot.position[0], goal[2] - foot.position[2]) >=
        0.16 ||
        Math.abs(goal[1] - foot.position[1]) >= 0.23) &&
      Math.abs(goal[1] - origin.position[1]) < 0.23
    )
      foot = walkFlat(o, origin, goal, checkFoot);
    assert(
      Math.hypot(goal[0] - foot.position[0], goal[2] - foot.position[2]) < 0.16,
      `${o.data.id}: failed physical waypoint ${goal} at ${foot.position}`,
    );
    assert(
      Math.abs(goal[1] - foot.position[1]) < 0.23,
      `${o.data.id}: wrong level at waypoint ${goal}; actual ${foot.position} from ${origin.position}`,
    );
  }
  assert(
    maxRise <= 0.221,
    'bounded foot movement cannot become a level teleport',
  );
  return foot;
}
test('all map-interpreted street entrances preserve raw platform provenance and hand off at the actual terrain foot height', () => {
  let entries = 0;
  for (const data of catalog) {
    const before = structuredClone(data),
      o = owner(data);
    assert.deepEqual(o.data, before);
    assert.deepEqual(o.geometryData.platforms, before.platforms);
    for (const e of o.streetEntrances()) {
      entries++;
      assert(e.source.startsWith('https://infomaps.translink.ca/'));
      assert(e.accuracy.includes('not a survey'));
      assert(
        Math.abs(
          e.threshold[1] - cityElevation(e.threshold[0], e.threshold[2]),
        ) < 1e-7,
      );
      const foot = o.tryEnterFromStreet(e.threshold);
      assert(foot);
      const inner = o.floorAt(o.toLocal(e.inward), e.surfaceId);
      assert(
        inner && o.isClearFoot(inner),
        `${data.id}/${e.id}: supported inner handoff`,
      );
      assert(
        new THREE.Vector3(...o.toWorld(foot)).distanceTo(
          new THREE.Vector3(...e.threshold),
        ) < 1e-4,
      );
      assert.equal(
        o.tryEnterFromStreet([
          e.threshold[0],
          e.threshold[1] + 2,
          e.threshold[2],
        ]),
        null,
      );
      assert.equal(
        o.tryEnterFromStreet([
          e.threshold[0] + 8,
          e.threshold[1],
          e.threshold[2] + 8,
        ]),
        null,
      );
    }
    assert(o.stats().drawCalls <= (data.authoredInterior ? 38 : 24));
    // Match the existing authored-owner budget: the three actual Granville
    // access banks contain nine detailed escalators plus the stair nosings.
    assert(o.stats().triangles < (data.authoredInterior ? 50_000 : 40_000));
    assert(o.stats().instances < (data.authoredInterior ? 4_000 : 3_100));
    o.dispose();
  }
  assert.equal(entries, Object.values(SKYTRAIN_STREET_ENTRANCES).flat().length);
});
test('all street-to-platform routes and their reverse exits are continuous supported walking paths', () => {
  let total = 0;
  for (const data of catalog) {
    const o = owner(data);
    for (const route of o.streetRoutes()) {
      total++;
      const e = o.streetEntrances().find((e) => e.id === route.entranceId);
      let foot = o.tryEnterFromStreet(e.threshold);
      assert(foot);
      const retainOwnership = (point) =>
        assert.equal(
          o.streetExit(point),
          null,
          `${data.id}/${route.entranceId}: interior route crosses the street exit at ${point.position}`,
        );
      foot = follow(o, foot, route.points.slice(1), retainOwnership);
      const endpoint = o.floorAt(foot.position, route.platformSurfaceId);
      assert(endpoint, 'physical path reaches the selected platform surface');
      assert.equal(
        foot.surfaceId,
        route.platformSurfaceId,
        'coplanar passage hands off to its actual platform identity',
      );
      foot = follow(
        o,
        foot,
        [...route.points].reverse().slice(1),
        retainOwnership,
      );
      const outside = o.toLocal(e.outward);
      foot = follow(o, foot, [outside]);
      const exit = o.streetExit(foot);
      assert(
        exit,
        'return ownership to the city through the same physical doorway',
      );
      assert(
        Math.abs(exit[1] - cityElevation(exit[0], exit[2])) < 0.08,
        `${data.id}/${route.entranceId}: exit ${exit} must match actual ground ${cityElevation(exit[0], exit[2])}`,
      );
    }
    o.dispose();
  }
  const expected = catalog.reduce((n, d) => {
    const station = owner(d),
      count = station.streetRoutes().length;
    station.dispose();
    return n + count;
  }, 0);
  assert.equal(total, expected);
});
test('Waterfront line transfer uses the shared public concourse and two separate platform descents', () => {
  const o = owner(catalog.find((d) => d.id === 'waterfront')),
    a = o
      .streetRoutes()
      .find(
        (r) =>
          r.entranceId === 'cordova-lobby' &&
          r.platformSurfaceId === 'waterfront-expo',
      ),
    b = o
      .streetRoutes()
      .find(
        (r) =>
          r.entranceId === 'cordova-lobby' &&
          r.platformSurfaceId === 'waterfront-canada',
      ),
    hub = a.points.findIndex((p) => Math.abs(p[1] + 3.5) < 1e-6);
  // Reverse to the actual common concourse, then follow the other line branch.
  let split = 0;
  while (
    split < Math.min(a.points.length, b.points.length) &&
    a.points[split].every((v, i) => Math.abs(v - b.points[split][i]) < 1e-6)
  )
    split++;
  assert(split > hub);
  assert(split < a.points.length);
  let foot = follow(
    o,
    o.tryEnterFromStreet(o.streetEntrances()[0].threshold),
    a.points.slice(1),
  );
  foot = follow(
    o,
    foot,
    a.points
      .slice(split - 1)
      .reverse()
      .slice(1),
  );
  foot = follow(o, foot, b.points.slice(split));
  assert(o.floorAt(foot.position, 'waterfront-canada'));
  o.dispose();
});
test('proximity loads only geographically nearby owners, retains all seven across ride selection, and releases once', async () => {
  const scene = new THREE.Scene(),
    calls = [],
    stations = new SkyTrainStations({
      scene,
      heightAt: cityElevation,
      fetchStation: async (id) => {
        calls.push(id);
        return structuredClone(catalog.find((d) => d.id === id));
      },
    }),
    firstData = catalog.find((d) => d.id === 'yaletown-roundhouse'),
    first = owner(firstData),
    threshold = first.streetEntrances()[0].threshold;
  first.dispose();
  await stations.updateProximity(threshold, 1);
  assert.deepEqual(calls, ['yaletown-roundhouse']);
  assert.equal(stations.owners.length, 1);
  await Promise.all(catalog.map((d) => stations.ensure(d.id)));
  assert.equal(stations.owners.length, 7);
  assert.equal(scene.children.length, 7);
  const original = stations.get('yaletown-roundhouse');
  await stations.load('waterfront', 'expo');
  stations.hide();
  await stations.load('burrard', 'expo');
  assert.equal(stations.get('yaletown-roundhouse'), original);
  assert(stations.owners.every((o) => o.group.visible && !o.stats().disposed));
  assert.equal(calls.length, 7);
  stations.dispose();
  stations.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(stations.owners.length, 0);
  await assert.rejects(stations.ensure('waterfront'));
});
test('portal material apertures retain previous hooks and use seven coarse rejects before exact bounded station rectangles', () => {
  const material = new THREE.MeshStandardMaterial(),
    root = new THREE.Group(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  root.add(mesh);
  const previous = (shader) => {
    shader.fragmentShader += '\n// retained architecture finish';
  };
  const previousKey = () => 'existing-atlas-key';
  material.onBeforeCompile = previous;
  material.customProgramCacheKey = previousKey;
  const openings = applySkyTrainWorldOpenings([root]),
    owners = catalog.map(owner);
  openings.update(owners);
  const shader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <clipping_planes_fragment>',
  };
  material.onBeforeCompile(shader, {});
  assert(shader.fragmentShader.includes('retained architecture finish'));
  assert(shader.fragmentShader.includes('stationRegionIndex<7'));
  assert(shader.fragmentShader.includes('stationDelta.x>stationBounds.z'));
  assert(shader.fragmentShader.includes('stationLocalIndex<48'));
  assert(shader.fragmentShader.includes('vStationOpeningWorld.y>=p.z'));
  assert.equal(shader.uniforms.uStationRegionCount.value, 7);
  assert.equal(
    shader.uniforms.uStationOpeningCount.value,
    owners.reduce((sum, o) => sum + stationCityOpenings(o).length, 0),
  );
  assert(
    shader.uniforms.uStationOpeningCount.value <=
      shader.uniforms.uStationOpeningData.value.image.height,
  );
  assert(material.customProgramCacheKey().startsWith('existing-atlas-key|'));
  for (const o of owners)
    for (const cut of stationCityOpenings(o)) {
      assert.equal(cut.polygon.length, 4);
      assert(cut.maxY > cut.minY);
      assert(cut.polygon.flat().every(Number.isFinite));
    }
  openings.dispose();
  openings.dispose();
  assert.equal(Reflect.get(material, 'onBeforeCompile'), previous);
  assert.equal(Reflect.get(material, 'customProgramCacheKey'), previousKey);
  for (const o of owners) o.dispose();
  mesh.geometry.dispose();
  material.dispose();
});

test('street support can use a rendered public lobby floor while train frames retain the terrain datum', () => {
  // Use the retained station whose external lobby attachment supports a
  // distinct rendered-ground datum. Exact photo-mapped doorways keep their
  // authored stairhead height and cannot be lifted independently of its shaft.
  const data = catalog.find((d) => d.id === 'vancouver-city-centre'),
    plain = owner(data),
    raised = new SkyTrainStationOwner(
      data,
      cityElevation,
      'balanced',
      true,
      (x, z) => cityElevation(x, z) + 1.9,
    );
  assert.deepEqual(raised.origin, plain.origin);
  assert.deepEqual(raised.trainStop('canada'), plain.trainStop('canada'));
  for (const e of raised.streetEntrances()) {
    assert(
      Math.abs(
        e.threshold[1] - cityElevation(e.threshold[0], e.threshold[2]) - 1.9,
      ) < 1e-8,
    );
    const foot = raised.tryEnterFromStreet(e.threshold);
    assert(foot);
    assert(
      new THREE.Vector3(...raised.toWorld(foot)).distanceTo(
        new THREE.Vector3(...e.threshold),
      ) < 1e-4,
    );
    assert.equal(
      raised.tryEnterFromStreet([
        e.threshold[0],
        e.threshold[1] - 1.9,
        e.threshold[2],
      ]),
      null,
    );
  }
  plain.dispose();
  raised.dispose();
});

test('every mapped street approach hands off before building collision and continuously reaches its actual doorway', async () => {
  const { StreetNavigation } = await import(cityModule('navigation')),
    { PublicInteriors } = await import(cityModule('interiors')),
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
    scene: new THREE.Scene(),
    renderer: {},
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    camera: new THREE.PerspectiveCamera(),
    settings: { buildings: true, mode: 'walk' },
    elevation: cityElevation,
    onLand: (x, z) => land.some((p) => inPolygon([x, z], p)),
    data: { waterPolys: [] },
  };
  nav.e.scene.add(nav.e.landmarks);
  nav.e.interiors = new PublicInteriors(nav.e);
  // Replay the exact production constructor's collision registration, including
  // minHeight and the reserved procedural landmark footprints.
  for (const f of [...buildings, ...landmarks]) {
    if ((f.properties.minHeight || 0) > 4) continue;
    for (const r of rings(f)) {
      const p = r.map((q) => q.map(project)),
        xs = p[0].map((q) => q[0]),
        zs = p[0].map((q) => q[1]);
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
          const key = x + ',' + z;
          if (!nav.collisions.has(key)) nav.collisions.set(key, []);
          nav.collisions.get(key).push(p);
        }
    }
  }
  for (const [dataId, entries] of Object.entries(SKYTRAIN_STREET_ENTRANCES)) {
    const station = new SkyTrainStationOwner(
      catalog.find((data) => data.id === dataId),
      cityElevation,
      'balanced',
      true,
      (x, z) => nav.groundHeight(x, z),
    );
    try {
      for (const e of entries) {
        // Raised deck entrances hand ownership over at their real outside
        // stairhead. The mapped station doorway remains independently checked.
        const entry = station
            .streetEntrances()
            .find((entry) => entry.id === e.id),
          [x, , z] = entry.threshold,
          direction = new THREE.Vector3(
            ...entry.localDirection,
          ).applyQuaternion(station.group.quaternion),
          dx = direction.x,
          dz = direction.z;
        let foot = null;
        for (let distance = -3.7; distance <= 0.001; distance += 0.05) {
          const px = x + dx * distance,
            pz = z + dz * distance;
          if (foot) {
            const previous = foot;
            foot = station.worldWalk(foot, dx * 0.05, dz * 0.05);
            const world = station.toWorld(foot);
            assert(
              Math.hypot(world[0] - px, world[2] - pz) < 0.02,
              `${dataId}/${e.id}: station capsule cannot reach the actual doorway`,
            );
            assert(
              Math.abs(foot.position[1] - previous.position[1]) <= 0.221,
              'street handoff must retain physical step limits',
            );
            assert(station.isClearFoot(foot));
          } else {
            foot = station.tryEnterFromStreet([px, nav.groundHeight(px, pz), pz]);
            if (!foot)
              assert(
                nav.clearGround(px, pz, 'walk'),
                `${dataId}/${e.id}: city ground blocks ${distance}m before a supported station handoff`,
              );
          }
        }
        assert(
          foot,
          `${dataId}/${e.id}: mapped doorway must have a supported native ownership handoff`,
        );
      }
    } finally {
      station.dispose();
    }
  }
});

test('late material refresh preserves distinct default shader keys and restores every previous hook', () => {
  const root = new THREE.Group(),
    a = new THREE.MeshStandardMaterial(),
    b = new THREE.MeshStandardMaterial(),
    late = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  const beforeA = (shader) => {
      shader.fragmentShader += '// A';
    },
    beforeB = (shader) => {
      shader.fragmentShader += '// B';
    };
  a.onBeforeCompile = beforeA;
  b.onBeforeCompile = beforeB;
  root.add(new THREE.Mesh(geometry, a), new THREE.Mesh(geometry, b));
  const patch = applySkyTrainWorldOpenings([root]);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
  const previousLate = Reflect.get(late, 'onBeforeCompile');
  root.add(new THREE.Mesh(geometry, late));
  patch.refresh();
  assert.notEqual(Reflect.get(late, 'onBeforeCompile'), previousLate);
  const detached = new THREE.Group(),
    detachedMaterial = new THREE.MeshStandardMaterial(),
    previousDetached = Reflect.get(detachedMaterial, 'onBeforeCompile');
  detached.add(new THREE.Mesh(geometry, detachedMaterial));
  patch.refresh([detached]);
  assert.equal(detached.parent, null);
  assert.notEqual(
    Reflect.get(detachedMaterial, 'onBeforeCompile'),
    previousDetached,
  );
  patch.dispose();
  assert.equal(Reflect.get(a, 'onBeforeCompile'), beforeA);
  assert.equal(Reflect.get(b, 'onBeforeCompile'), beforeB);
  assert.equal(Reflect.get(late, 'onBeforeCompile'), previousLate);
  assert.equal(
    Reflect.get(detachedMaterial, 'onBeforeCompile'),
    previousDetached,
  );
  geometry.dispose();
  a.dispose();
  b.dispose();
  late.dispose();
  detachedMaterial.dispose();
});

test('the visible centre-bank handrails stop sideways passage while keeping the tread centre walkable', () => {
  for (const data of catalog) {
    const o = owner(data),
      c = o.geometryData.connections.find((c) => c.type === 'stairs'),
      step = Math.floor(c.treads.length / 2),
      tread = c.treads[step],
      center = tread.vertices.reduce(
        (sum, p) => sum.map((v, i) => v + p[i] / tread.vertices.length),
        [0, 0, 0],
      ),
      length = Math.hypot(c.end[0] - c.start[0], c.end[2] - c.start[2]),
      lateral = [
        (c.end[2] - c.start[2]) / length,
        -(c.end[0] - c.start[0]) / length,
      ];
    let foot = o.floorAt(center, `${c.id}:step:${step}`);
    assert(foot);
    assert(o.isClearFoot(foot));
    for (let i = 0; i < 20; i++)
      foot = o.walk(foot, lateral[0] * 0.07, lateral[1] * 0.07);
    assert(
      Math.hypot(foot.position[0] - center[0], foot.position[2] - center[2]) <
        (data.authoredInterior ? c.width / 2 - 0.22 : 0.4),
      `${data.id}: body cannot pass through the actual handrail`,
    );
    const moved = o.walk(foot, -lateral[0] * 0.2, -lateral[1] * 0.2);
    assert(
      Math.hypot(
        moved.position[0] - foot.position[0],
        moved.position[2] - foot.position[2],
      ) > 0.1,
    );
    o.dispose();
  }
});

test('same-height platform ownership permits continuous walking to every directional boarding point', () => {
  let count = 0;
  for (const data of catalog) {
    const o = owner(data);
    for (const platform of o.geometryData.platforms) {
      const route = o
          .streetRoutes()
          .find((r) => r.platformSurfaceId === platform.surfaceId),
        end = route.points.at(-1),
        passage = o.geometryData.floors.find(
          (f) => f.kind === 'corridor' && o.floorAt(end, f.id),
        ),
        initial = o.floorAt(end, passage?.id ?? platform.surfaceId);
      assert(initial);
      initial.yaw = 0.73;
      let foot = o.walk(initial, 0, 0);
      assert.equal(foot.surfaceId, platform.surfaceId);
      assert(
        new THREE.Vector3(...foot.position).distanceTo(
          new THREE.Vector3(...initial.position),
        ) < 1e-8,
      );
      assert.equal(foot.yaw, initial.yaw);
      if (data.authoredInterior) {
        const target = o.boardingPoint(platform.line, platform.direction);
        foot = follow(o, foot, [target.position]);
        assert.equal(foot.surfaceId, platform.surfaceId);
        count++;
        continue;
      }
      const target = o.boardingPoint(platform.line, platform.direction),
        floor = o.geometryData.floors.find((f) => f.id === platform.surfaceId),
        bounds = new THREE.Box3().setFromPoints(
          floor.vertices.map((v) => new THREE.Vector3(...v)),
        ),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3()),
        lane =
          size.z > size.x
            ? [center.x + 0.85, target.position[1], target.position[2]]
            : [target.position[0], target.position[1], center.z + 0.85];
      // Change platform sides between retained bench/column rows, then follow
      // the safe edge to the selected door rather than crossing a real bench.
      if (size.z > size.x) lane[2] -= 2.5;
      else lane[0] -= 2.5;
      const edge =
        size.z > size.x
          ? [target.position[0], target.position[1], lane[2]]
          : [lane[0], target.position[1], target.position[2]];
      foot = follow(o, foot, [lane, edge, target.position]);
      assert.equal(foot.surfaceId, platform.surfaceId);
      assert(
        new THREE.Vector3(...foot.position).distanceTo(
          new THREE.Vector3(...target.position),
        ) < 0.16,
      );
      count++;
    }
    o.dispose();
  }
  assert.equal(count, 16);
});

test('all 156 directional carriage doors match rendered openings, preserve source vectors and keep legacy defaults', () => {
  for (const openWorld of [false, true]) {
    let count = 0;
    for (const data of catalog) {
      const before = JSON.stringify(data),
        o = new SkyTrainStationOwner(
          data,
          cityElevation,
          'balanced',
          openWorld,
        );
      for (const platform of data.platforms) {
        const doors = o.boardingDoors(platform.line, platform.direction);
        assert.equal(doors.length, platform.doors.length);
        for (const [i, door] of doors.entries()) {
          const authored = platform.doors[i];
          count++;
          assert.equal(door.carIndex, authored.carIndex);
          assert.deepEqual(door.sourceCarDoor, authored.carDoor);
          assert.equal(door.carDoor[0], authored.carDoor[0]);
          assert.equal(door.carDoor[1], authored.carDoor[1]);
          const expectedZ =
            platform.line === 'expo' && Math.abs(authored.carDoor[2]) > 1
              ? Math.sign(authored.carDoor[2]) * 4.9
              : authored.carDoor[2];
          assert.equal(door.carDoor[2], expectedZ);
          assert(
            SKYTRAIN_WORLD_STOCK[platform.line].doorCenters.includes(
              door.carDoor[2],
            ),
          );
          assert.equal(
            Math.abs(door.sourceCarDoor[2] - door.carDoor[2]) > 0.0001,
            platform.line === 'expo' && Math.abs(authored.carDoor[2]) > 1,
          );
          assert.equal(
            platform.doors.find(
              (source) =>
                source.carIndex === door.carIndex &&
                source.carDoor.every(
                  (value, index) => value === door.sourceCarDoor[index],
                ),
            )?.side,
            authored.side,
          );
          assert.equal(door.waiting.surfaceId, platform.surfaceId);
          assert(o.isClearFoot(door.waiting));
          const shift = new THREE.Vector3(
            0,
            0,
            door.carDoor[2] - authored.carDoor[2],
          )
            .applyQuaternion(new THREE.Quaternion(...authored.carQuaternion))
            .applyQuaternion(new THREE.Quaternion(...platform.quaternion));
          const expectedWaiting = new THREE.Vector3(...authored.waiting).add(
            shift,
          );
          assert.deepEqual(
            door.threshold,
            new THREE.Vector3(...authored.sill).add(shift).toArray(),
            'prompt threshold preserves the source sill and exact door adapter',
          );
          assert(
            new THREE.Vector3(...door.waiting.position).distanceTo(
              expectedWaiting,
            ) < 1e-7,
          );
          assert(
            Math.abs(
              door.waiting.yaw -
                Math.atan2(
                  authored.edge[0] + shift.x - door.waiting.position[0],
                  authored.edge[2] + shift.z - door.waiting.position[2],
                ),
            ) < 1e-12,
          );
          const stop = o.walk(door.waiting, 0, 0);
          assert.equal(stop.surfaceId, platform.surfaceId);
        }
        const selected = [...doors].sort(
          (a, b) =>
            a.carIndex - b.carIndex ||
            Math.abs(a.carDoor[2]) - Math.abs(b.carDoor[2]),
        )[0];
        assert.deepEqual(
          o.passengerDoor(platform.line, platform.direction),
          selected.carDoor,
        );
        const legacy = o.boardingPoint(platform.line, platform.direction);
        assert(
          new THREE.Vector3(...legacy.position).distanceTo(
            new THREE.Vector3(...selected.waiting.position),
          ) < 1e-7,
        );
        assert(Math.abs(legacy.yaw - selected.waiting.yaw) < 1e-12);
        doors[0].carDoor[0] += 100;
        doors[0].sourceCarDoor[0] += 100;
        const threshold = [...doors[0].threshold];
        doors[0].threshold[0] += 100;
        doors[0].waiting.position[0] += 100;
        const fresh = o.boardingDoors(platform.line, platform.direction)[0];
        assert.deepEqual(fresh.sourceCarDoor, platform.doors[0].carDoor);
        assert.equal(fresh.carDoor[0], platform.doors[0].carDoor[0]);
        assert.equal(fresh.carDoor[2], doors[0].carDoor[2]);
        assert.deepEqual(fresh.threshold, threshold);
        assert(o.isClearFoot(fresh.waiting));
      }
      assert.equal(
        JSON.stringify(data),
        before,
        'door inventory never rewrites the source packet',
      );
      o.dispose();
      assert.deepEqual(o.boardingDoors(data.platforms[0].line), []);
    }
    assert.equal(count, 156);
  }
});
