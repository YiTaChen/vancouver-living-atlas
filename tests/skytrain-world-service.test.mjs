import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cityModule } from './helpers/city-modules.mjs';
const {
  WorldSkyTrainRun,
  WORLD_SKYTRAIN_SERVICE,
  worldSkyTrainSegmentDuration,
} = await import(cityModule('skytrain-world-service'));
const data = JSON.parse(
  readFileSync('public/data/transit/skytrain-world-routes.json', 'utf8'),
);
const bare = (name) => name.split(' @ ')[0];
const pair = (line) => data.routes.filter((route) => route.lineId === line);

test('full source trips preserve both real terminal branches, all seven downtown identities and every adjacent leg', () => {
  assert.equal(data.schema, 1);
  assert.equal(data.source.feedVersion, '26SEP_20261016');
  assert.equal(
    data.source.url,
    'https://gtfs-static.translink.ca/gtfs/google_transit.zip',
  );
  assert.equal(
    data.source.zipSha256,
    '0d73f848750b2a48f227916568764f51124fd9314d59eb1e2acb3dd342aed8f8',
  );
  assert(data.source.legend.includes('provided by permission of TransLink'));
  assert.equal(data.routes.length, 4);
  const core = new Set();
  for (const route of data.routes) {
    assert.equal(route.stops.length, route.lineId === 'expo' ? 20 : 14);
    assert.equal(route.segments.length, route.stops.length - 1);
    assert(/^[a-f0-9]{64}$/.test(route.sourceShapeRowsSha256));
    assert(/^[a-f0-9]{64}$/.test(route.sourceStopTimesRowsSha256));
    assert(route.retainedSourceShapeVertexCount > 200);
    for (const [index, segment] of route.segments.entries()) {
      assert.equal(segment.fromStopId, route.stops[index].id);
      assert.equal(segment.toStopId, route.stops[index + 1].id);
      assert(segment.lengthM > 100 && segment.lengthM < 10000);
      assert(segment.coordinates.length >= 2);
      if (index)
        assert.deepEqual(
          segment.coordinates[0],
          route.segments[index - 1].coordinates.at(-1),
        );
    }
    for (const stop of route.stops) {
      assert.equal(stop.id, stop.sourceStopId);
      assert(stop.shapeProjection.offsetM < 160);
      if (stop.stationId) core.add(stop.stationId);
    }
  }
  assert.deepEqual([...core].sort((a, b) => a.localeCompare(b)), [
    'burrard',
    'granville',
    'main-street-science-world',
    'stadium-chinatown',
    'vancouver-city-centre',
    'waterfront',
    'yaletown-roundhouse',
  ]);
  for (const line of ['expo', 'canada']) {
    const [outward, returning] = pair(line);
    assert.deepEqual(
      outward.stops.map((stop) => bare(stop.name)),
      returning.stops.map((stop) => bare(stop.name)).reverse(),
    );
    assert.equal(bare(outward.stops[0].name), 'Waterfront Station');
    assert.equal(
      bare(outward.stops.at(-1).name),
      line === 'expo' ? 'King George Station' : 'Richmond-Brighouse Station',
    );
    const downtownEdge = outward.stops.findIndex(
      (stop) =>
        stop.stationId ===
        (line === 'expo' ? 'main-street-science-world' : 'yaletown-roundhouse'),
    );
    assert(downtownEdge > 0 && downtownEdge < outward.stops.length - 5);
  }
});

test(
  'generator exactly reproduces the committed export from the supplied official archive',
  {
    skip: !existsSync('work/open-world-transit/google_transit.zip'),
  },
  () => {
    const result = spawnSync(
      'python3',
      [
        'tools/transit/import_skytrain_world.py',
        '--feed',
        'work/open-world-transit/google_transit.zip',
        '--check',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
  },
);

for (const line of ['expo', 'canada']) {
  test(`${line} autonomous full-cycle clock visits all source stops and reverses only at real terminals`, () => {
    const [outward, returning] = pair(line),
      run = new WorldSkyTrainRun(outward, returning);
    const visited = [new Set(), new Set()],
      terminalNames = [];
    for (
      let phases = 0;
      run.snapshot().elapsed < run.cycleDurationSeconds - 1e-6;
      phases++
    ) {
      assert(phases < 200);
      const snapshot = run.snapshot(),
        { route, phase } = snapshot;
      assert(snapshot.speedMps <= 22);
      if (phase === 'dwell') {
        assert(snapshot.doorsOpen);
        assert.equal(snapshot.doorProgress, 1);
        visited[snapshot.routeIndex].add(snapshot.stopIndex);
      }
      if (phase === 'turnback') {
        assert.equal(snapshot.stopIndex, route.stops.length - 1);
        assert.equal(snapshot.terminalFromRoute, route);
        assert.equal(
          snapshot.terminalToRoute,
          run.routes[snapshot.routeIndex === 0 ? 1 : 0],
        );
        assert(!snapshot.doorsOpen);
        terminalNames.push(bare(route.stops.at(-1).name));
      }
      run.advance(snapshot.phaseDuration - snapshot.phaseElapsed + 1e-8);
    }
    assert.equal(visited[0].size, outward.stops.length);
    assert.equal(visited[1].size, returning.stops.length);
    assert.deepEqual(terminalNames, [
      bare(outward.stops.at(-1).name),
      'Waterfront Station',
    ]);
    assert.equal(run.snapshot().routeIndex, 0);
    assert.equal(run.snapshot().stopIndex, 0);
  });
  test(`${line} frame subdivision, off-map time and large analytic advances preserve the same service state`, () => {
    const [outward, returning] = pair(line),
      fine = new WorldSkyTrainRun(outward, returning, 180),
      coarse = new WorldSkyTrainRun(outward, returning, 180);
    for (let i = 0; i < 2000; i++) fine.advance(0.025);
    coarse.advance(50);
    const a = fine.snapshot(),
      b = coarse.snapshot();
    assert.equal(a.phase, b.phase);
    assert.equal(a.routeIndex, b.routeIndex);
    assert.equal(a.segmentIndex, b.segmentIndex);
    assert(Math.abs(a.progress - b.progress) < 1e-10);
    const periodic = new WorldSkyTrainRun(
      outward,
      returning,
      230 + coarse.cycleDurationSeconds * 10000,
    ).snapshot();
    assert.equal(periodic.phase, b.phase);
    assert(Math.abs(periodic.progress - b.progress) < 1e-7);
    for (const bad of [NaN, Infinity, -1])
      assert.throws(() => coarse.advance(bad));
  });
}

test('quintic distance and analytic velocity respect physical speed/acceleration limits on every source leg', () => {
  for (const route of data.routes)
    for (const segment of route.segments) {
      const duration = worldSkyTrainSegmentDuration(segment.lengthM);
      assert(duration >= segment.lengthM / 11.5);
      for (let i = 0; i <= 100; i++) {
        const t = i / 100,
          speed = (segment.lengthM * 30 * t * t * (1 - t) * (1 - t)) / duration,
          acceleration =
            (segment.lengthM * Math.abs(60 * t * (1 - t) * (1 - 2 * t))) /
            duration ** 2;
        assert(speed <= WORLD_SKYTRAIN_SERVICE.maxSpeedMps + 1e-8);
        assert(
          acceleration <= WORLD_SKYTRAIN_SERVICE.maxAccelerationMps2 + 1e-8,
        );
      }
    }
});
