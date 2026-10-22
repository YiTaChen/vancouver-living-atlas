import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  buildSkyTrainRoutes,
  serializeSkyTrainRoutes,
} from '../tools/build-skytrain-routes.mjs';

const { loadSkyTrainRoutes, SkyTrainRidePath, adaptSkyTrainStationFrame } =
  await import(cityModule('skytrain-ride-path'));
const { project } = await import(cityModule('geo'));
const { trainStopFor, stationWorldPose, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);
const { SKYTRAIN_STATIONS, SKYTRAIN_LINES, planSkyTrainJourney } = await import(
  cityModule('skytrain-network')
);
const sourceBytes = readFileSync(
  'tools/transit/city-life-sources/transit-source-snapshot.json',
);
const source = JSON.parse(sourceBytes),
  routeBytes = readFileSync('public/models/skytrain-routes.json');
const routes = JSON.parse(routeBytes);
const label = (s) => `${s.lineId}:${s.from}:${s.to}`;
const near = (a, b, epsilon = 1e-6) =>
  assert(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const pose = (segment, stationId) => {
  const raw = validateRuntimeStation(
    JSON.parse(
      readFileSync(`public/models/skytrain-stations/${stationId}.json`),
    ),
    stationId,
  );
  const data = adaptSkyTrainStationFrame(raw, routes);
  const stop = trainStopFor(data, segment.lineId, segment.direction);
  const world = stationWorldPose(
    data,
    () => 32,
    stop.position,
    stop.quaternion,
  );
  return {
    position: new THREE.Vector3(...world.position),
    quaternion: new THREE.Quaternion(...world.quaternion),
    motionSign: stop.motionSign,
  };
};
const actualPath = (segment) =>
  new SkyTrainRidePath(
    routes,
    segment.lineId,
    segment.from,
    segment.to,
    pose(segment, segment.from),
    pose(segment, segment.to),
  );
const finitePose = (p) =>
  [...p.position.toArray(), ...p.quaternion.toArray()].every(Number.isFinite);

test('public route JSON exactly reproduces the retained GTFS snapshot and its declared provenance', () => {
  assert.equal(routes.schema, 1);
  assert.equal(
    routes.source,
    'translink-gtfs-26SEP_20261002-regional-skytrain',
  );
  assert(!routeBytes.toString().includes('city-life-sources/'));
  assert.equal(
    routes.sourceSha256,
    createHash('sha256').update(sourceBytes).digest('hex'),
  );
  assert.equal(
    serializeSkyTrainRoutes(buildSkyTrainRoutes(sourceBytes.toString())),
    routeBytes.toString(),
  );
  assert(routes.scope.includes('not surveyed'));
  assert.equal(routes.segments.length, 12);
});

test('all twelve directed adjacent edges use the correct source shape, platform stops and interval distances', () => {
  const actual = new Set();
  for (const s of routes.segments) {
    assert(!actual.has(label(s)), label(s));
    actual.add(label(s));
    const line = SKYTRAIN_LINES[s.lineId],
      a = line.stations.indexOf(s.from),
      b = line.stations.indexOf(s.to);
    assert.equal(Math.abs(a - b), 1, label(s));
    const service = source.services.find(
      (v) => v.lineId === s.lineId && v.directionId === s.direction,
    );
    assert(service, label(s));
    assert.equal(s.sourceShapeId, service.sourceShapeId);
    const index = service.orderedStops.findIndex((v) => v.stationId === s.from);
    const first = service.orderedStops[index],
      last = service.orderedStops[index + 1];
    assert.equal(last.stationId, s.to);
    assert.deepEqual(s.sourceStopIds, [first.sourceStopId, last.sourceStopId]);
    near(s.planarLengthM, last.pathStationM - first.pathStationM);
  }
  for (const line of Object.values(SKYTRAIN_LINES))
    for (let i = 1; i < line.stations.length; i++) {
      assert(
        actual.has(`${line.id}:${line.stations[i - 1]}:${line.stations[i]}`),
      );
      assert(
        actual.has(`${line.id}:${line.stations[i]}:${line.stations[i - 1]}`),
      );
    }
  for (const from of SKYTRAIN_STATIONS)
    for (const to of SKYTRAIN_STATIONS) {
      const itinerary = planSkyTrainJourney(from.id, to.id);
      for (const leg of itinerary.legs)
        for (let i = 1; i < leg.stops.length; i++)
          assert(
            actual.has(`${leg.lineId}:${leg.stops[i - 1]}:${leg.stops[i]}`),
            `${from.id} to ${to.id}`,
          );
    }
});

test('GTFS curved alignments retain substantial geographic bends rather than direct station chords', () => {
  for (const key of [
    'expo:waterfront:burrard',
    'canada:vancouver-city-centre:yaletown-roundhouse',
  ]) {
    const s = routes.segments.find((v) => label(v) === key);
    const vertices = s.coordinates.map((c) => {
      const [x, z] = project(c);
      return new THREE.Vector3(x, 0, z);
    });
    const chord = new THREE.Line3(vertices[0], vertices.at(-1));
    const deviations = vertices.map((v) =>
      v.distanceTo(chord.closestPointToPoint(v, true, new THREE.Vector3())),
    );
    assert(Math.max(...deviations) > 140, key);
    assert(s.coordinates.length > 20, key);
    const path = actualPath(s);
    assert(
      path.length >
        pose(s, s.from).position.distanceTo(pose(s, s.to).position) * 1.1,
      key,
    );
  }
});

test('runtime station headings follow the real track while preserving authored pedestrian and door identities', () => {
  for (const station of SKYTRAIN_STATIONS) {
    const raw = JSON.parse(
      readFileSync(`public/models/skytrain-stations/${station.id}.json`),
    );
    const before = JSON.stringify(raw),
      adapted = adaptSkyTrainStationFrame(raw, routes);
    assert.notEqual(adapted, raw);
    assert.equal(
      JSON.stringify(raw),
      before,
      'protected authored source stays unchanged',
    );
    assert.deepEqual(adapted.floors, raw.floors);
    assert.deepEqual(adapted.entrances, raw.entrances);
    assert.deepEqual(adapted.connections, raw.connections);
    assert.deepEqual(adapted.parts, raw.parts);
    assert.deepEqual(adapted.exclusions, raw.exclusions);
    for (const platform of adapted.platforms) {
      const original = raw.platforms.find((p) => p.id === platform.id);
      assert.deepEqual(platform.position, original.position);
      assert.deepEqual(platform.quaternion, original.quaternion);
      assert.deepEqual(platform.doors, original.doors);
      assert.equal(platform.surfaceId, original.surfaceId);
      assert.equal(
        platform.motionSign,
        ['eastbound', 'southbound'].includes(platform.direction) ? 1 : -1,
      );
    }
    near(Math.hypot(...adapted.quaternion), 1);
  }
  for (const s of routes.segments) {
    const points = s.coordinates.map(project);
    const firstTangent = new THREE.Vector3(
      points[1][0] - points[0][0],
      0,
      points[1][1] - points[0][1],
    ).normalize();
    const lastTangent = new THREE.Vector3(
      points.at(-1)[0] - points.at(-2)[0],
      0,
      points.at(-1)[1] - points.at(-2)[1],
    ).normalize();
    for (const [id, tangent] of [
      [s.from, firstTangent],
      [s.to, lastTangent],
    ]) {
      const p = pose(s, id),
        forward = new THREE.Vector3(0, 0, p.motionSign).applyQuaternion(
          p.quaternion,
        );
      assert(
        forward.dot(tangent) > 0.94,
        `${label(s)}: ${id} signed body frame points away from track`,
      );
    }
  }
});

test('only the elevated Main Street runtime origin derives from both directional GTFS platform anchors', () => {
  const id = 'main-street-science-world',
    raw = JSON.parse(
      readFileSync(`public/models/skytrain-stations/${id}.json`),
    ),
    before = JSON.stringify(raw),
    routeBefore = JSON.stringify(routes);
  const endpoint = (network, direction) => {
    const s = network.segments.find(
      (v) =>
        v.lineId === 'expo' &&
        v.direction === direction &&
        (direction === 'eastbound' ? v.to === id : v.from === id),
    );
    return direction === 'eastbound' ? s.coordinates.at(-1) : s.coordinates[0];
  };
  const expected = (network) => {
    const east = endpoint(network, 'eastbound'),
      west = endpoint(network, 'westbound');
    return [(east[0] + west[0]) / 2, (east[1] + west[1]) / 2];
  };
  const adapted = adaptSkyTrainStationFrame(raw, routes);
  assert.deepEqual(adapted.lonlat, expected(routes));
  assert.notDeepEqual(adapted.lonlat, raw.lonlat);
  assert.deepEqual(adapted.source, raw.source);
  assert.deepEqual(adapted.floors, raw.floors);
  assert.deepEqual(
    adapted.platforms.map((p) => p.position),
    raw.platforms.map((p) => p.position),
  );
  assert.equal(JSON.stringify(raw), before);
  assert.equal(JSON.stringify(routes), routeBefore);

  // Changed source anchors must move the runtime origin; a fixed replacement
  // coordinate would incorrectly pass an ordinary snapshot-only assertion.
  const changed = structuredClone(routes);
  endpoint(changed, 'eastbound')[0] += 0.00002;
  endpoint(changed, 'westbound')[1] += 0.00002;
  assert.deepEqual(
    adaptSkyTrainStationFrame(raw, changed).lonlat,
    expected(changed),
  );
  assert.notDeepEqual(expected(changed), adapted.lonlat);
  for (const station of SKYTRAIN_STATIONS.filter((s) => s.id !== id)) {
    const data = JSON.parse(
      readFileSync(`public/models/skytrain-stations/${station.id}.json`),
    );
    assert.deepEqual(
      adaptSkyTrainStationFrame(data, routes).lonlat,
      data.lonlat,
    );
  }
  const missingReverse = structuredClone(routes);
  missingReverse.segments = missingReverse.segments.filter(
    (s) => s.from !== id,
  );
  assert.throws(
    () => adaptSkyTrainStationFrame(raw, missingReverse),
    /platform anchors/,
  );
});

test('actual authored platform endpoints remain exact and all sampled poses are finite, normalized and bounded', () => {
  const sourceBefore = JSON.stringify(routes);
  for (const s of routes.segments) {
    const a = pose(s, s.from),
      b = pose(s, s.to);
    const before = [
      a.position.clone(),
      a.quaternion.clone(),
      b.position.clone(),
      b.quaternion.clone(),
    ];
    const path = new SkyTrainRidePath(routes, s.lineId, s.from, s.to, a, b);
    assert(
      Number.isFinite(path.length) &&
        path.length > 100 &&
        path.length < s.planarLengthM * 4 + 500,
      label(s),
    );
    assert(path.sample(0).position.distanceTo(a.position) < 1e-6, label(s));
    assert(path.sample(1).position.distanceTo(b.position) < 1e-6, label(s));
    assert(path.sample(0).quaternion.angleTo(a.quaternion) < 1e-6, label(s));
    assert(path.sample(1).quaternion.angleTo(b.quaternion) < 1e-6, label(s));
    let last = path.sample(0);
    for (let i = 1; i <= 2000; i++) {
      const p = path.sample(i / 2000);
      assert(finitePose(p), label(s));
      near(p.quaternion.length(), 1);
      assert(
        p.position.distanceTo(last.position) <= (path.length / 2000) * 2 + 0.02,
        `discontinuous displacement ${label(s)} at ${i}`,
      );
      const travel = p.position.clone().sub(last.position);
      if (travel.length() > 1e-8) {
        const bodyForward = new THREE.Vector3(
          0,
          0,
          a.motionSign,
        ).applyQuaternion(p.quaternion);
        assert(
          bodyForward.dot(travel.normalize()) > 0.8,
          `body frame reverses against movement ${label(s)} at ${i}`,
        );
      }
      last = p;
    }
    assert.deepEqual(
      [a.position, a.quaternion, b.position, b.quaternion],
      before,
    );
  }
  assert.equal(JSON.stringify(routes), sourceBefore);
});

test('actual station-to-GTFS joins cannot snap the train orientation over a fraction of a metre', () => {
  for (const s of routes.segments) {
    const path = actualPath(s);
    let last = path.sample(0);
    for (let i = 1; i <= 2000; i++) {
      const p = path.sample(i / 2000),
        distance = p.position.distanceTo(last.position);
      const degrees = (p.quaternion.angleTo(last.quaternion) * 180) / Math.PI;
      assert(
        degrees <= Math.max(3, distance * 12),
        `${label(s)}: ${degrees.toFixed(2)}° over ${distance.toFixed(3)}m at u=${i / 2000}`,
      );
      last = p;
    }
  }
});

test('pose progress clamps invalid values to a stable finite endpoint and never mutates returned poses', () => {
  const s = routes.segments[0],
    p = actualPath(s),
    start = p.sample(0),
    end = p.sample(1);
  for (const fraction of [NaN, Infinity, -Infinity, -100]) {
    const value = p.sample(fraction);
    assert(finitePose(value));
    assert(value.position.distanceTo(start.position) < 1e-6);
    assert(value.quaternion.angleTo(start.quaternion) < 1e-6);
  }
  assert(p.sample(100).position.distanceTo(end.position) < 1e-6);
  const independent = p.sample(0.5),
    copy = independent.position.clone();
  p.sample(0.7);
  assert.deepEqual(independent.position, copy);
});

test('the route loader forwards cancellation and loads the exact same-origin authored route resource', async (t) => {
  const controller = new AbortController();
  const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/models/skytrain-routes.json');
    assert.equal(options.signal, controller.signal);
    return new Response(routeBytes, { status: 200 });
  });
  assert.deepEqual(await loadSkyTrainRoutes(controller.signal), routes);
  assert.equal(mock.mock.callCount(), 1);
});

test('the route loader rejects unavailable, malformed or incomplete directed networks', async (t) => {
  const mock = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 503 }),
  );
  await assert.rejects(loadSkyTrainRoutes());
  const bad = [
    (d) => {
      d.schema = 2;
    },
    (d) => {
      d.segments.pop();
    },
    (d) => {
      d.segments[0].lineId = 'bus';
    },
    (d) => {
      d.segments[0].coordinates = [[0, 0]];
    },
    (d) => {
      d.segments[0].coordinates[0] = [NaN, 49.2];
    },
    (d) => {
      d.segments[0].from = 'unknown';
    },
    (d) => {
      d.segments[0].to = 'granville';
    },
    (d) => {
      d.segments[0].direction = 'westbound';
    },
    (d) => {
      d.segments[0] = structuredClone(d.segments[1]);
    },
    (d) => {
      d.segments[0].planarLengthM = -1;
    },
    (d) => {
      d.segments[0].coordinates[0] = [180, 90];
    },
    (d) => {
      d.sourceSha256 = 'not-a-sha';
    },
    (d) => {
      d.source = 'https://foreign.example/route';
    },
    (d) => {
      d.source = 'tools/transit/city-life-sources/transit-source-snapshot.json';
    },
  ];
  for (let index = 0; index < bad.length; index++) {
    const data = structuredClone(routes);
    bad[index](data);
    mock.mock.mockImplementation(
      async () => new Response(JSON.stringify(data), { status: 200 }),
    );
    await assert.rejects(loadSkyTrainRoutes(), `invalid network case ${index}`);
  }
  controllerAbort(mock);
  await assert.rejects(loadSkyTrainRoutes());
});
function controllerAbort(mock) {
  mock.mock.mockImplementation(async () => {
    throw new DOMException('aborted', 'AbortError');
  });
}

test('path construction rejects nonfinite, non-unit or impossible stop poses before producing a moving train', () => {
  const s = routes.segments[0];
  for (const mutate of [
    (p) => {
      p.position.x = NaN;
    },
    (p) => {
      p.quaternion.set(0, 0, 0, 0);
    },
    (p) => {
      p.motionSign = 0;
    },
    (p) => {
      p.motionSign = Infinity;
    },
  ]) {
    const a = pose(s, s.from),
      b = pose(s, s.to);
    mutate(a);
    assert.throws(
      () => new SkyTrainRidePath(routes, s.lineId, s.from, s.to, a, b),
    );
  }
  assert.throws(
    () =>
      new SkyTrainRidePath(
        routes,
        'expo',
        'waterfront',
        'granville',
        pose(s, s.from),
        pose(s, s.to),
      ),
  );
  const a = pose(s, s.from),
    b = pose(s, s.to);
  b.motionSign = -a.motionSign;
  assert.throws(
    () => new SkyTrainRidePath(routes, s.lineId, s.from, s.to, a, b),
  );
});

test('the deterministic source generator rejects missing paths, duplicated services and nonadjacent replacements', () => {
  for (const mutate of [
    (d) => {
      d.paths = d.paths.filter((p) => p.pathId !== 'expo:eastbound:path');
    },
    (d) => {
      d.services.push(
        structuredClone(d.services.find((s) => s.lineId === 'expo')),
      );
    },
    (d) => {
      d.services.find((s) => s.lineId === 'expo').orderedStops[1].stationId =
        'granville';
    },
  ]) {
    const d = structuredClone(source);
    mutate(d);
    assert.throws(() => buildSkyTrainRoutes(JSON.stringify(d)));
  }
});
