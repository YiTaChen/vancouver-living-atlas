import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';

const {
  SKYTRAIN_STATIONS,
  SKYTRAIN_LINES,
  skyTrainStation,
  planSkyTrainJourney,
  skyTrainStationDistance,
  skyTrainSegmentLength,
  SkyTrainJourney,
} = await import(cityModule('skytrain-network'));

const FAST = {
  waitSeconds: 0.1,
  boardingSeconds: 0.1,
  dwellSeconds: 0.2,
  segmentSeconds: () => 0.6,
};
const until = (journey, predicate, limit = 10000, dt = 0.025) => {
  for (let i = 0; i < limit; i++) {
    const s = journey.snapshot();
    if (predicate(s)) return s;
    journey.update(dt);
  }
  assert.fail(
    `Journey failed to reach expected state: ${JSON.stringify(journey.snapshot())}`,
  );
};
const arrive = (journey) => until(journey, (s) => s.phase === 'arrived');
const board = (journey) => {
  until(journey, (s) => s.canBoard);
  assert.equal(journey.board(), true);
  return until(journey, (s) => s.phase === 'riding');
};
const near = (a, b, tolerance = 1e-8) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('regional catalog has the seven source-backed station anchors and distinct station signatures', () => {
  const source = JSON.parse(
    readFileSync(
      new URL(
        '../tools/assets/skytrain-stations-stage2/station-layout.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(SKYTRAIN_STATIONS.length, 7);
  assert.equal(new Set(SKYTRAIN_STATIONS.map((s) => s.id)).size, 7);
  assert.equal(new Set(SKYTRAIN_STATIONS.map((s) => s.signature)).size, 7);
  for (const s of SKYTRAIN_STATIONS) {
    const original = source.stations.find((value) => value.stationId === s.id);
    assert(original, s.id);
    assert.deepEqual(s.lonLat, original.geographicAnchor.coordinatesLonLat);
    assert(s.lines.length > 0);
    assert(s.name.length && s.description.length);
    assert.equal(skyTrainStation(s.id), s);
    for (const lineId of s.lines)
      assert(SKYTRAIN_LINES[lineId].stations.includes(s.id));
  }
  assert.equal(skyTrainStation('waterfront').lines.length, 2);
  assert.deepEqual(skyTrainStation('vancouver-city-centre').lines, ['canada']);
});

test('Expo and Canada stop order is correct and the Canada middle station is never skipped', () => {
  assert.deepEqual(SKYTRAIN_LINES.expo.stations, [
    'waterfront',
    'burrard',
    'granville',
    'stadium-chinatown',
    'main-street-science-world',
  ]);
  assert.deepEqual(SKYTRAIN_LINES.canada.stations, [
    'waterfront',
    'vancouver-city-centre',
    'yaletown-roundhouse',
  ]);
  assert.deepEqual(
    planSkyTrainJourney('waterfront', 'yaletown-roundhouse').stops,
    ['waterfront', 'vancouver-city-centre', 'yaletown-roundhouse'],
  );
  assert.deepEqual(
    planSkyTrainJourney('waterfront', 'main-street-science-world').stops,
    SKYTRAIN_LINES.expo.stations,
  );
});

test('all 42 ordered distinct origin/destination pairs use only actual adjacent stations on each leg', () => {
  for (const from of SKYTRAIN_STATIONS)
    for (const to of SKYTRAIN_STATIONS) {
      if (from.id === to.id) continue;
      const route = planSkyTrainJourney(from.id, to.id);
      assert.equal(route.from, from.id);
      assert.equal(route.to, to.id);
      assert.equal(route.stops[0], from.id);
      assert.equal(route.stops.at(-1), to.id);
      assert(route.legs.length >= 1 && route.legs.length <= 2);
      for (const leg of route.legs) {
        const full = SKYTRAIN_LINES[leg.lineId].stations;
        assert.equal(leg.from, leg.stops[0]);
        assert.equal(leg.to, leg.stops.at(-1));
        for (let i = 1; i < leg.stops.length; i++)
          assert.equal(
            full.indexOf(leg.stops[i]) - full.indexOf(leg.stops[i - 1]),
            leg.direction,
          );
      }
      const common = from.lines.some((line) => to.lines.includes(line));
      assert.equal(route.legs.length, common ? 1 : 2);
      assert.equal(route.transferStation, common ? null : 'waterfront');
      if (!common) {
        assert.equal(route.legs[0].to, 'waterfront');
        assert.equal(route.legs[1].from, 'waterfront');
        assert.notEqual(route.legs[0].lineId, route.legs[1].lineId);
      }
    }
});

test('reverse services have reverse stop order, correct direction and real Waterfront headsign', () => {
  const expo = planSkyTrainJourney('main-street-science-world', 'waterfront')
    .legs[0];
  assert.deepEqual(expo.stops, [...SKYTRAIN_LINES.expo.stations].reverse());
  assert.equal(expo.direction, -1);
  assert.equal(expo.directionName, 'westbound');
  assert.equal(expo.headsign, 'Waterfront');
  const canada = planSkyTrainJourney('yaletown-roundhouse', 'waterfront')
    .legs[0];
  assert.equal(canada.directionName, 'northbound');
  assert.equal(canada.headsign, 'Waterfront');
  assert.equal(
    planSkyTrainJourney('waterfront', 'yaletown-roundhouse').legs[0]
      .directionName,
    'southbound',
  );
  assert.equal(
    planSkyTrainJourney('waterfront', 'burrard').legs[0].directionName,
    'eastbound',
  );
});

test('frozen catalogs and nested itineraries cannot be changed by consumers or snapshots', () => {
  assert.throws(() => {
    SKYTRAIN_STATIONS.push({});
  }, TypeError);
  assert.throws(() => {
    SKYTRAIN_STATIONS[0].lonLat[0] = 0;
  }, TypeError);
  assert.throws(() => {
    SKYTRAIN_LINES.expo.stations.reverse();
  }, TypeError);
  const j = new SkyTrainJourney('burrard', 'yaletown-roundhouse', FAST);
  const s = j.snapshot();
  assert.throws(() => {
    s.itinerary.legs[0].stops[0] = 'granville';
  }, TypeError);
  assert.throws(() => {
    s.itinerary.legs[0].headsign = 'wrong';
  }, TypeError);
  s.phase = 'cancelled';
  assert.equal(j.snapshot().phase, 'waiting');
});

test('boarding requires waiting for an open-door service and explicit passenger action', () => {
  const j = new SkyTrainJourney('waterfront', 'burrard', FAST);
  assert.equal(j.board(), false);
  assert.equal(j.alight(), false);
  let s = until(j, (s) => s.canBoard);
  assert.equal(s.phase, 'boarding');
  assert.equal(s.doorsOpen, true);
  assert.equal(s.aboard, false);
  for (let i = 0; i < 200; i++) j.update(0.2);
  assert.deepEqual(
    j.snapshot(),
    s,
    'a passenger cannot be boarded or moved by a timer',
  );
  assert.equal(j.board(), true);
  s = j.snapshot();
  assert.equal(s.aboard, true);
  assert.equal(s.doorsOpen, false);
  assert.equal(s.canAlight, false);
  assert.equal(j.board(), false);
  until(j, (s) => s.phase === 'riding');
});

test('riding accepts a continuous eased segment with stable endpoints and closed doors', () => {
  const j = new SkyTrainJourney('waterfront', 'burrard', {
    ...FAST,
    segmentSeconds: () => 2,
  });
  const first = board(j);
  assert.equal(first.segmentFromStation, 'waterfront');
  assert.equal(first.segmentToStation, 'burrard');
  assert.equal(first.currentStation, 'waterfront');
  let previous = first.progress;
  const speeds = [];
  while (j.snapshot().phase === 'riding') {
    const s = j.update(0.025);
    assert(s.progress >= previous && s.progress <= 1);
    assert(
      s.progress - previous < 0.04,
      'accepted movement cannot jump across the route',
    );
    assert(Number.isFinite(s.speedMps) && s.speedMps >= 0);
    if (s.phase === 'riding') {
      assert.equal(s.currentStation, 'waterfront');
      assert.equal(s.nextStation, 'burrard');
      assert.equal(s.doorsOpen, false);
      speeds.push(s.speedMps);
    }
    previous = s.progress;
  }
  const end = j.snapshot();
  assert.equal(end.currentStation, 'burrard');
  assert.equal(end.segmentFromStation, 'waterfront');
  assert.equal(end.segmentToStation, 'burrard');
  assert.equal(end.progress, 1);
  assert.equal(end.speedMps, 0);
  assert.equal(end.doorsOpen, true);
  assert(Math.max(...speeds) > speeds[0] * 10);
});

test('alighting, cancelling and boarding cannot move a passenger out of a moving train', () => {
  const j = new SkyTrainJourney('waterfront', 'burrard', FAST);
  board(j);
  const before = j.snapshot();
  assert.equal(j.alight(), false);
  assert.equal(j.cancel(), false);
  assert.equal(j.board(), false);
  assert.deepEqual(j.snapshot(), before);
});

test('a remaining passenger stops at every intermediate station and continues after each dwell', () => {
  const j = new SkyTrainJourney(
    'waterfront',
    'main-street-science-world',
    FAST,
  );
  board(j);
  const reached = [];
  for (const expected of [
    'burrard',
    'granville',
    'stadium-chinatown',
    'main-street-science-world',
  ]) {
    const s = arrive(j);
    reached.push(s.currentStation);
    assert.equal(s.currentStation, expected);
    assert.equal(s.aboard, true);
    assert.equal(s.canAlight, true);
    assert.equal(s.doorsOpen, true);
    assert.equal(s.transferRequired, false);
    if (expected !== 'main-street-science-world') {
      assert(s.dwellRemainingSeconds > 0);
      until(j, (s) => s.phase === 'riding');
    }
  }
  assert.deepEqual(reached, SKYTRAIN_LINES.expo.stations.slice(1));
});

test('the regional destination holds indefinitely until explicit alighting and then completes', () => {
  const j = new SkyTrainJourney('waterfront', 'burrard', FAST);
  board(j);
  const s = arrive(j);
  for (let i = 0; i < 1000; i++) j.update(0.2);
  assert.deepEqual(j.snapshot(), s);
  assert.equal(j.cancel(), false);
  assert.equal(j.alight(), true);
  const end = j.snapshot();
  assert.equal(end.phase, 'complete');
  assert.equal(end.currentStation, 'burrard');
  assert.equal(end.aboard, false);
  assert.equal(end.progress, 1);
  assert.equal(end.canBoard, false);
  assert.equal(end.canAlight, false);
  assert.equal(j.alight(), false);
  assert.equal(j.board(), false);
  assert.deepEqual(j.update(100), end);
});

test('an intermediate departure closes doors while stationary before resuming travel', () => {
  const j = new SkyTrainJourney('waterfront', 'granville', FAST);
  board(j);
  arrive(j);
  const closing = until(j, (s) => s.phase === 'boarding');
  assert.equal(closing.currentStation, 'burrard');
  assert.equal(closing.segmentFromStation, 'burrard');
  assert.equal(closing.segmentToStation, 'granville');
  assert.equal(closing.aboard, true);
  assert.equal(closing.doorsOpen, false);
  assert.equal(closing.speedMps, 0);
  assert.equal(closing.progress, 0);
  assert.equal(closing.canBoard, false);
  assert.equal(closing.canAlight, false);
  const still = j.update(0.05);
  assert.equal(still.phase, 'boarding');
  assert.equal(still.speedMps, 0);
  assert.equal(still.progress, 0);
  until(j, (s) => s.phase === 'riding');
  assert.equal(arrive(j).currentStation, 'granville');
});

test('Waterfront transfer holds the old service, requires alighting and a separate new boarding', () => {
  const j = new SkyTrainJourney('granville', 'yaletown-roundhouse', FAST);
  board(j);
  arrive(j);
  assert.equal(j.snapshot().currentStation, 'burrard');
  until(j, (s) => s.phase === 'riding');
  const waterfront = arrive(j);
  assert.equal(waterfront.currentStation, 'waterfront');
  assert.equal(waterfront.transferRequired, true);
  assert.equal(waterfront.lineId, 'expo');
  assert.equal(waterfront.nextStation, null);
  for (let i = 0; i < 500; i++) j.update(0.2);
  assert.deepEqual(
    j.snapshot(),
    waterfront,
    'no automatic train or platform transfer',
  );
  assert.equal(j.alight(), true);
  const off = j.snapshot();
  assert.equal(off.aboard, false);
  assert.equal(off.phase, 'waiting');
  assert.equal(off.currentStation, 'waterfront');
  assert.equal(off.lineId, 'canada');
  assert.equal(off.nextStation, 'vancouver-city-centre');
  assert.equal(off.legIndex, 1);
  assert.equal(j.board(), false);
  until(j, (s) => s.canBoard);
  assert.equal(j.snapshot().aboard, false);
  assert.equal(j.snapshot().currentStation, 'waterfront');
  board(j);
  const cityCentre = arrive(j);
  assert.equal(cityCentre.currentStation, 'vancouver-city-centre');
  until(j, (s) => s.phase === 'riding');
  const end = arrive(j);
  assert.equal(end.currentStation, 'yaletown-roundhouse');
  assert.equal(j.alight(), true);
  assert.equal(j.snapshot().phase, 'complete');
});

test('an intermediate alighting preserves station and route and requires an explicit reboarding', () => {
  const j = new SkyTrainJourney('waterfront', 'granville', FAST);
  board(j);
  arrive(j);
  assert.equal(j.alight(), true);
  const off = j.snapshot();
  assert.equal(off.phase, 'waiting');
  assert.equal(off.currentStation, 'burrard');
  assert.equal(off.destination, 'granville');
  assert.equal(off.nextStation, 'granville');
  assert.equal(off.aboard, false);
  until(j, (s) => s.canBoard);
  for (let i = 0; i < 100; i++) j.update(0.2);
  assert.equal(j.snapshot().currentStation, 'burrard');
  assert.equal(j.snapshot().canBoard, true);
  board(j);
  assert.equal(arrive(j).currentStation, 'granville');
});

test('cancellation works only off the train and remains terminal for later updates', () => {
  const j = new SkyTrainJourney('waterfront', 'granville', FAST);
  until(j, (s) => s.canBoard);
  assert.equal(j.cancel(), true);
  assert.equal(j.snapshot().phase, 'cancelled');
  assert.equal(j.snapshot().canBoard, false);
  assert.equal(j.board(), false);
  const cancelled = j.snapshot();
  assert.deepEqual(j.update(100), cancelled);
  assert.equal(j.cancel(), false);
});

test('large or invalid dt cannot fast-forward a journey, lose a stop or corrupt a finite pose fraction', () => {
  const j = new SkyTrainJourney('waterfront', 'granville');
  const initial = j.snapshot();
  for (const dt of [NaN, Infinity, -Infinity, -1, 0])
    assert.deepEqual(j.update(dt), initial);
  const s = j.update(10000);
  near(s.waitSeconds, 3.8);
  assert.equal(s.currentStation, 'waterfront');
  assert.equal(s.aboard, false);
  const fast = new SkyTrainJourney('waterfront', 'granville', {
    ...FAST,
    segmentSeconds: () => 1,
  });
  board(fast);
  const moved = fast.update(10000);
  assert.equal(moved.phase, 'riding');
  assert.equal(moved.currentStation, 'waterfront');
  assert(moved.linearProgress <= 0.225 + 1e-8);
  assert(moved.progress < 0.1);
});

test('steady motion is independent of ordinary frame partitioning away from phase boundaries', () => {
  const a = new SkyTrainJourney('waterfront', 'burrard', {
    ...FAST,
    segmentSeconds: () => 4,
  });
  const b = new SkyTrainJourney('waterfront', 'burrard', {
    ...FAST,
    segmentSeconds: () => 4,
  });
  board(a);
  board(b);
  for (let i = 0; i < 60; i++) a.update(1 / 60);
  for (let i = 0; i < 10; i++) b.update(0.1);
  near(a.snapshot().progress, b.snapshot().progress);
  near(a.snapshot().speedMps, b.snapshot().speedMps);
});

test('default segments use curved source-route distance and near-real maximum train speed', () => {
  for (const line of Object.values(SKYTRAIN_LINES))
    for (let i = 1; i < line.stations.length; i++) {
      const from = line.stations[i - 1],
        to = line.stations[i];
      const forward = new SkyTrainJourney(from, to).snapshot();
      const reverse = new SkyTrainJourney(to, from).snapshot();
      assert(forward.segmentSeconds >= 30 && forward.segmentSeconds <= 150);
      near(forward.segmentSeconds, reverse.segmentSeconds);
      near(
        skyTrainStationDistance(from, to),
        skyTrainStationDistance(to, from),
      );
      assert(skyTrainStationDistance(from, to) > 250);
      const sourceLength = skyTrainSegmentLength(from, to, line.id);
      near(
        forward.segmentSeconds,
        Math.max(30, Math.min(150, sourceLength / 11.8)),
      );
      assert((sourceLength / forward.segmentSeconds) * 1.875 * 3.6 <= 80);
    }
  near(skyTrainSegmentLength('waterfront', 'burrard', 'expo'), 958.39849);
  assert(
    skyTrainSegmentLength('waterfront', 'burrard', 'expo') >
      skyTrainStationDistance('waterfront', 'burrard') * 1.5,
  );
  assert.throws(
    () => skyTrainSegmentLength('waterfront', 'granville', 'expo'),
    RangeError,
  );
  assert.throws(
    () => skyTrainSegmentLength('waterfront', 'granville', 'canada'),
    RangeError,
  );
  assert.throws(
    () => skyTrainSegmentLength('waterfront', 'burrard', 'unknown'),
    RangeError,
  );
});

test('bad station/timing inputs are rejected before a ride, including a bad later transfer segment', () => {
  for (const [from, to] of [
    ['unknown', 'waterfront'],
    ['waterfront', 'unknown'],
  ]) {
    assert.throws(() => planSkyTrainJourney(from, to), RangeError);
    assert.throws(() => new SkyTrainJourney(from, to), RangeError);
  }
  for (const value of [0, -1, NaN, Infinity, 301])
    for (const field of ['waitSeconds', 'boardingSeconds', 'dwellSeconds'])
      assert.throws(
        () => new SkyTrainJourney('waterfront', 'burrard', { [field]: value }),
        RangeError,
      );
  for (const value of [0, -1, NaN, Infinity, 3601])
    assert.throws(
      () =>
        new SkyTrainJourney('burrard', 'yaletown-roundhouse', {
          segmentSeconds: (_from, _to, line) =>
            line === 'canada' ? value : 20,
        }),
      RangeError,
    );
});

test('segment duration policy is evaluated once per route segment and is not changed by reboarding', () => {
  let calls = 0;
  const j = new SkyTrainJourney('waterfront', 'granville', {
    ...FAST,
    segmentSeconds: () => {
      calls++;
      return 0.6;
    },
  });
  assert.equal(calls, 2);
  board(j);
  arrive(j);
  j.alight();
  board(j);
  arrive(j);
  j.alight();
  assert.equal(calls, 2);
  assert.equal(j.snapshot().phase, 'complete');
});

test('same-station journeys are complete with no train movement or invented line transfer', () => {
  for (const station of SKYTRAIN_STATIONS) {
    const j = new SkyTrainJourney(station.id, station.id);
    const s = j.snapshot();
    assert.equal(s.phase, 'complete');
    assert.equal(s.currentStation, station.id);
    assert.equal(s.segmentFromStation, station.id);
    assert.equal(s.segmentToStation, station.id);
    assert.equal(s.aboard, false);
    assert.equal(s.speedMps, 0);
    assert.equal(s.itinerary.legs.length, 0);
    assert.equal(j.board(), false);
    assert.deepEqual(j.update(100), s);
  }
});
