import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cityModule } from './helpers/city-modules.mjs';
const { BusRouteRuntime, worldBusRoutePose, validateWorldBusPacket } =
  await import(cityModule('bus-route-runtime'));
const packet = validateWorldBusPacket(
  JSON.parse(
    await readFile(
      new URL('../public/data/transit/bus-world-routes.json', import.meta.url),
      'utf8',
    ),
  ),
);
const tick = (bus, seconds, ...args) => {
  for (let i = 0; i < seconds * 20; i++) bus.update(0.05, ...args);
  return bus.frame();
};

test('world packet preserves source provenance, actual stop identities and GTFS turns', async () => {
  const bytes = await readFile(
    new URL(
      '../tools/transit/city-life-sources/transit-source-snapshot.json',
      import.meta.url,
    ),
  );
  assert.equal(
    packet.sourcePacketSha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  const source = JSON.parse(bytes);
  const sourceStops = new Set(
    source.services.flatMap((s) =>
      s.orderedStops.map((stop) => stop.serviceStopId),
    ),
  );
  assert.equal(packet.routes.length, 2);
  for (const route of packet.routes) {
    assert.ok(route.lengthM > 6000);
    assert.ok(
      route.points.length > 100,
      'retained GTFS bends, rather than a single road edge',
    );
    assert.ok(route.stops.length > 20);
    assert.ok(route.stops.every((s) => sourceStops.has(s.id)));
    assert.ok(
      route.legs.every((leg) =>
        source.paths.some(
          (p) =>
            p.sourceShapeId === leg.sourceShapeId &&
            p.fullSourceShapeRowsSha256 === leg.sourceShapeRowsSha256,
        ),
      ),
    );
    assert.equal(route.joins.length, 2);
    assert.ok(
      route.joins.every(
        (j) =>
          j.planarJoinAtScheduledStop.projectionGapM === 0 &&
          j.planarJoinAtScheduledStop.headingDifferenceDegrees === 0,
      ),
    );
    const a = worldBusRoutePose(route, 0.001),
      b = worldBusRoutePose(route, route.lengthM - 0.001);
    assert.ok(
      Math.hypot(a.x - b.x, a.z - b.z) < 0.02,
      'continuous physical endpoint, no visible wrap',
    );
  }
});

test('a real bus opens, waits, closes and departs without any passenger or click', () => {
  const bus = new BusRouteRuntime(packet.routes[0], 'unoccupied', 3);
  const start = bus.frame();
  assert.ok(start.stop && !start.stop.id.includes('demo'));
  assert.equal(tick(bus, 1.1).phase, 'dwell');
  assert.equal(bus.frame().doorProgress, 1);
  assert.equal(tick(bus, 10).phase, 'closing');
  assert.equal(tick(bus, 1.1).phase, 'moving');
  assert.equal(bus.frame().doorProgress, 0);
  const next = tick(bus, 5);
  assert.ok(next.speedMps > 0);
  assert.ok(Math.hypot(next.x - start.x, next.z - start.z) > 5);
});

test('service reaches future real stops and repeatedly departs with the same vehicle identity', () => {
  const bus = new BusRouteRuntime(packet.routes[0], 'persistent', 5);
  const first = bus.frame();
  let arrivals = 0,
    lastVisit = first.stopVisit,
    last = first;
  for (let i = 0; i < 8000 && arrivals < 3; i++) {
    const frame = bus.update(0.05);
    assert.equal(frame.vehicleId, 'persistent');
    assert.ok(
      Math.hypot(frame.x - last.x, frame.z - last.z) < 1,
      'no moving-bus teleport',
    );
    if (frame.stopVisit !== lastVisit) {
      arrivals++;
      lastVisit = frame.stopVisit;
      assert.ok(frame.stop?.sourceStopId);
    }
    last = frame;
  }
  assert.equal(arrivals, 3);
  assert.notEqual(last.stop.id, first.stop.id);
});

test('obstruction and access-ramp interlocks hold a bus in place without rerouting or wrapping', () => {
  const bus = new BusRouteRuntime(packet.routes[0], 'held');
  const start = bus.frame();
  assert.equal(tick(bus, 30, () => true, false).phase, 'dwell');
  assert.equal(bus.frame().stationM, start.stationM);
  tick(bus, 2, () => true, true);
  assert.equal(bus.frame().phase, 'moving');
  const station = bus.frame().stationM;
  tick(bus, 30, () => false, true);
  assert.equal(bus.frame().stationM, station);
  assert.equal(bus.frame().speedMps, 0);
  assert.ok(tick(bus, 3).speedMps > 0);
});

test('invalid disconnected route endpoints are rejected, simulation never treats them as a wrap', () => {
  const broken = structuredClone(packet);
  broken.routes[0].points.at(-1)[0] += 50;
  assert.throws(() => validateWorldBusPacket(broken), /wrap across a gap/);
});

test('the full source route envelope stays on map land and outside every rendered building footprint', async () => {
  const { project, rings, inPolygon } = await import(cityModule('geo'));
  const files = await Promise.all(
    [
      '../public/data/buildings.geojson',
      '../lib/city/landmark-footprints.json',
      '../public/data/land.geojson',
    ].map((file) =>
      readFile(new URL(file, import.meta.url), 'utf8').then(JSON.parse),
    ),
  );
  const grid = new Map();
  for (const feature of [...files[0].features, ...files[1].features]) {
    if ((feature.properties.minHeight || 0) > 4) continue;
    for (const ring of rings(feature)) {
      const polygon = ring.map((points) => points.map(project));
      const xs = polygon[0].map((p) => p[0]),
        zs = polygon[0].map((p) => p[1]);
      for (
        let x = Math.floor(Math.min(...xs) / 80);
        x <= Math.floor(Math.max(...xs) / 80);
        x++
      ) {
        for (
          let z = Math.floor(Math.min(...zs) / 80);
          z <= Math.floor(Math.max(...zs) / 80);
          z++
        ) {
          const key = x + ',' + z;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(polygon);
        }
      }
    }
  }
  const land = files[2].features.flatMap((f) =>
    rings(f).map((r) => r.map((q) => q.map(project))),
  );
  for (const route of packet.routes) {
    for (let station = 0; station < route.lengthM; station += 1) {
      const pose = worldBusRoutePose(route, station),
        c = Math.cos(pose.yaw),
        s = Math.sin(pose.yaw);
      assert.ok(
        land.some((polygon) => inPolygon([pose.x, pose.z], polygon)),
        `${route.id} has actual land support at ${station}m`,
      );
      for (const along of [-6.3, -4.8, -3.3, -1.8, -0.3, 1.2, 2.7, 4.2, 6.1])
        for (const side of [-1.5, 0, 1.5]) {
          const x = pose.x + c * side + s * along,
            z = pose.z - s * side + c * along;
          assert.equal(
            (
              grid.get(Math.floor(x / 80) + ',' + Math.floor(z / 80)) ?? []
            ).some((polygon) => inPolygon([x, z], polygon)),
            false,
            `${route.id} complete body outside buildings at ${station}m`,
          );
        }
    }
  }
});

test('scene service advances in orbit, preserves proxy/detail identity, freezes hidden tabs and disposes its scene allocation', async () => {
  const THREE = await import('three');
  const { BusWorldService } = await import(cityModule('bus-world-service'));
  const oldFetch = globalThis.fetch,
    oldDocument = globalThis.document;
  globalThis.document = { hidden: false };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => structuredClone(packet),
  });
  const calls = { prepares: 0, applied: [] };
  const first = worldBusRoutePose(
    packet.routes[0],
    packet.routes[0].stops[1].stationM - 4.6,
  );
  const city = {
    scene: new THREE.Scene(),
    controls: { target: new THREE.Vector3(first.x, 0, first.z) },
    navigation: {
      mode: 'orbit',
      position: new THREE.Vector3(),
      clearGround: () => true,
      groundHeight: () => 7,
    },
    data: {},
    settings: { quality: 'balanced', traffic: true },
    compatibleGraphics: false,
    busVisitDetail: 'auto',
  };
  const cabin = {
    aboard: false,
    serviceVehicleId: null,
    serviceDetailReady: false,
    releaseService() {
      this.serviceVehicleId = null;
      this.serviceDetailReady = false;
      return true;
    },
    async prepareService(frame) {
      calls.prepares++;
      this.serviceVehicleId = frame.vehicleId;
      return true;
    },
    applyServiceFrame(frame) {
      calls.applied.push(frame);
    },
    serviceDepartureReady: () => true,
  };
  const service = new BusWorldService(city, {}, cabin);
  try {
    assert.equal(await service.load(), true);
    const proxies = city.scene.children.find((o) => o.isInstancedMesh);
    assert.equal(proxies.count, 4, 'orbit sees every service bus');
    service.update(0.05);
    await Promise.resolve();
    assert.equal(
      calls.prepares,
      0,
      'orbit keeps moving proxies without allocating a passenger cabin',
    );
    city.navigation.mode = 'walk';
    city.navigation.position.set(first.x, 7, first.z);
    service.update(0.05);
    await Promise.resolve();
    assert.equal(
      calls.prepares,
      1,
      'walking near service prewarms automatically',
    );
    cabin.serviceDetailReady = true;
    service.update(0.05);
    assert.equal(
      proxies.count,
      3,
      'the exact same bus proxy yields to its loaded cabin',
    );
    assert.equal(calls.applied.at(-1).vehicleId, cabin.serviceVehicleId);
    for (let i = 0; i < 400; i++) service.update(0.05);
    assert.ok(
      service.frames.some((f) => f.speedMps > 0),
      'orbit is independent of passenger clicks',
    );
    const visibleStations = service.frames.map((f) => f.stationM);
    const loadsBeforeHiding = calls.prepares;
    city.settings.traffic = false;
    for (let i = 0; i < 40; i++) service.update(0.05);
    assert.equal(
      proxies.visible,
      false,
      'ambient bus bodies follow city traffic visibility',
    );
    assert.equal(
      cabin.serviceVehicleId,
      null,
      'hiding unoccupied traffic releases the nearby cabin',
    );
    assert.equal(
      calls.prepares,
      loadsBeforeHiding,
      'hidden unoccupied buses never allocate a fresh cabin',
    );
    assert.ok(
      service.frames.some((f, i) => f.stationM !== visibleStations[i]),
      'hidden buses keep their autonomous route clocks',
    );
    city.settings.traffic = true;
    service.update(0.05);
    await Promise.resolve();
    assert.equal(proxies.visible, true);
    assert.ok(cabin.serviceVehicleId);
    cabin.aboard = true;
    cabin.serviceDetailReady = true;
    const occupiedId = cabin.serviceVehicleId;
    const appliedBeforeHiding = calls.applied.length;
    city.settings.traffic = false;
    service.update(0.05);
    assert.equal(proxies.visible, false);
    assert.equal(
      cabin.serviceVehicleId,
      occupiedId,
      'an occupied owner survives ambient traffic hiding',
    );
    assert.equal(cabin.serviceDetailReady, true);
    assert.equal(
      calls.applied.length,
      appliedBeforeHiding + 1,
      'the occupied cabin keeps its current service pose and doors',
    );
    cabin.aboard = false;
    city.settings.traffic = true;
    const frozen = service.frames.map((f) => f.stationM);
    globalThis.document.hidden = true;
    service.update(400);
    assert.deepEqual(
      service.frames.map((f) => f.stationM),
      frozen,
    );
    globalThis.document.hidden = false;
    const before = service.frames;
    service.update(400);
    service.frames.forEach((frame, i) =>
      assert.ok(
        Math.hypot(frame.x - before[i].x, frame.z - before[i].z) < 1,
        'resume discards hidden time',
      ),
    );
    assert.equal(
      service.snapshot().source.feedVersion,
      packet.source.feedVersion,
    );
    assert.ok(service.snapshot().legend.includes('permission of TransLink'));
  } finally {
    service.dispose();
    globalThis.fetch = oldFetch;
    globalThis.document = oldDocument;
  }
  assert.equal(city.scene.children.length, 0);
  assert.equal(service.ready, false);
});
