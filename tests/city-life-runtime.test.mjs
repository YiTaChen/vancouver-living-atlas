import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
import * as THREE from 'three';
const { SimulationClock } = await import(
  cityModule('city-life/simulation-clock')
);
const { populationProfile, PopulationSelector, ActorEventGrid } = await import(
  cityModule('city-life/population')
);
const { TransitService } = await import(
  cityModule('city-life/transit-service')
);
const { PassengerTransfers, boardingProofValid } = await import(
  cityModule('city-life/passenger-transfers')
);
const { SharedResourceCache } = await import(
  cityModule('city-life/resource-cache')
);
const { ContinuousPath, riderWorldTransform } = await import(
  cityModule('city-life/continuous-path')
);
const { RepresentationTransaction } = await import(
  cityModule('city-life/representation')
);
const floor = { x: 0, y: 0, z: 0, surfaceId: 'curb-a', layer: 0 };
const proof = (overrides = {}) => ({
  vehicleId: 'bus-1',
  serviceId: 'bus-5-east',
  carId: 'car-1',
  stopId: 'stop-a',
  platformId: 'bay-a',
  doorId: 'front-right',
  doorSide: 'right',
  surfaceId: 'curb-a',
  layer: 0,
  floorPointM: [0, 0, 0],
  speedMps: 0,
  stoppedSeconds: 0.5,
  distanceM: 1,
  doorOpen: true,
  correctDoorSide: true,
  alignmentValid: true,
  zoneClear: true,
  lineOfSight: true,
  passengerCapable: true,
  floorValid: true,
  ...overrides,
});
const anchor = (overrides = {}) => ({
  vehicleId: 'bus-1',
  carId: 'car-1',
  anchorId: 'seat-01',
  kind: 'seat',
  frameId: 'car-1',
  translationM: [0.7, 0.81, 0],
  rotationQuaternionXYZW: [0, 0, 0, 1],
  ...overrides,
});
const board = (transfers, id = 'player', now = 0, a = anchor()) => {
  assert.equal(transfers.register(id, floor), true);
  const token = transfers.beginBoard(id, a, proof(), now);
  assert.ok(token);
  assert.equal(transfers.markPreloaded(token, now), true);
  assert.equal(transfers.commit(token, proof(), now), true);
  return token;
};
const center = (overrides = {}) => ({
  position: [0, 0, 0],
  surfaceId: 'street',
  layer: 0,
  streetVisible: true,
  kind: 'player',
  ...overrides,
});
const actor = (i, overrides = {}) => ({
  actorId: `actor-${i}`,
  position: [i, 0, 0],
  surfaceId: 'street',
  layer: 0,
  interactive: false,
  necessary: false,
  spawnSafe: true,
  skeletonEligible: true,
  ...overrides,
});

test('clock pauses hidden tabs, clamps 30-second debt and never uses sky rate', () => {
  const clock = new SimulationClock();
  let steps = 0;
  clock.advance(0.1, () => steps++);
  assert.equal(steps, 2);
  clock.setHidden(true);
  clock.advance(30, () => steps++);
  assert.equal(steps, 2);
  clock.setHidden(false);
  clock.advance(30, () => steps++);
  assert.equal(steps, 6);
  assert.ok(clock.time < 0.31);
  clock.advance(NaN, () => steps++);
  assert.equal(steps, 6);
});
test('population uses one union cap, capability override, skeleton and capsule limits', () => {
  for (const [capability, quality, total] of [
    ['compatible', 'Ultra', 12],
    ['desktop', 'Balanced', 24],
    ['desktop', 'Ultra', 32],
  ]) {
    const profile = populationProfile(capability, quality),
      selector = new PopulationSelector(profile);
    const result = selector.select(
      Array.from({ length: 80 }, (_, i) => actor(i)),
      [center(), center({ kind: 'camera' }), center({ kind: 'service' })],
      0,
    );
    assert.equal(result.length, total);
    assert.ok(result.filter((a) => a.skeleton).length <= profile.skeletons);
    assert.ok(result.filter((a) => a.collision).length <= 12);
    assert.equal(new Set(result.map((a) => a.actorId)).size, total);
  }
});
test('low Orbit selects, high Orbit does not spawn; floors do not leak into underground', () => {
  const actors = [actor(1)];
  assert.equal(
    new PopulationSelector(populationProfile('desktop', 'High')).select(
      actors,
      [center({ kind: 'camera' })],
      0,
    ).length,
    1,
  );
  assert.equal(
    new PopulationSelector(populationProfile('desktop', 'High')).select(
      actors,
      [center({ kind: 'camera', streetVisible: false })],
      0,
    ).length,
    0,
  );
  assert.equal(
    new PopulationSelector(populationProfile('desktop', 'High')).select(
      actors,
      [center({ surfaceId: 'underground', layer: -1 })],
      0,
    ).length,
    0,
  );
});
test('population retains stable identities for three-second exit hysteresis and prevents visible births', () => {
  const selector = new PopulationSelector(populationProfile('desktop', 'High'));
  assert.equal(
    selector.select([actor(1, { spawnSafe: false })], [center()], 0).length,
    0,
  );
  assert.equal(selector.select([actor(1)], [center()], 1).length, 1);
  const far = [center({ position: [500, 0, 0] })];
  assert.equal(selector.select([actor(1)], far, 2).length, 1);
  assert.equal(selector.select([actor(1)], far, 4.99).length, 1);
  assert.equal(selector.select([actor(1)], far, 5).length, 0);
  assert.throws(
    () => selector.select([actor(1), actor(1)], [center()], 6),
    /duplicate/,
  );
});
test('interactive and skeleton limits include every selected actor and honor skeleton hysteresis', () => {
  const selector = new PopulationSelector(
    populationProfile('compatible', 'High'),
  );
  let result = selector.select(
    Array.from({ length: 8 }, (_, i) => actor(i, { interactive: true })),
    [center()],
    0,
  );
  assert.equal(result.length, 2);
  result = selector.select(
    [
      actor(0, { position: [13, 0, 0], interactive: true }),
      actor(1, { position: [15, 0, 0], interactive: true }),
    ],
    [center()],
    1,
  );
  assert.equal(result.find((a) => a.actorId === 'actor-0').skeleton, true);
  assert.equal(result.find((a) => a.actorId === 'actor-1').skeleton, false);
});
test('events only hit same-surface nearby bins, deduplicate and bound cooldown storage', () => {
  const grid = new ActorEventGrid(16, 2);
  grid.rebuild([
    actor(1),
    actor(2, { surfaceId: 'underground', layer: -1 }),
    actor(3, { position: [90, 0, 0] }),
  ]);
  const event = { ...center(), eventId: 'horn-a', radius: 10, now: 0 };
  assert.deepEqual(grid.query(event), ['actor-1']);
  assert.deepEqual(grid.query(event), []);
  assert.deepEqual(grid.query({ ...event, eventId: 'horn-b' }), ['actor-1']);
  assert.deepEqual(grid.query({ ...event, eventId: 'horn-c' }), []);
  assert.deepEqual(grid.query({ ...event, now: 2 }), ['actor-1']);
  assert.deepEqual(grid.query({ ...event, radius: Infinity }), []);
});
test('all boarding guard failures are rejected, including opposite floor/door and NaN', () => {
  for (const overrides of [
    { speedMps: 0.06 },
    { speedMps: NaN },
    { stoppedSeconds: 0.49 },
    { distanceM: 2.01 },
    { distanceM: -1 },
    { doorOpen: false },
    { correctDoorSide: false },
    { alignmentValid: false },
    { zoneClear: false },
    { lineOfSight: false },
    { passengerCapable: false },
    { floorValid: false },
  ])
    assert.equal(boardingProofValid(proof(overrides)), false);
  const p = new PassengerTransfers();
  p.register('player', floor);
  assert.equal(
    p.beginBoard('player', anchor(), proof({ surfaceId: 'other-floor' }), 0),
    null,
  );
  assert.equal(
    p.beginBoard('player', anchor(), proof({ floorPointM: [2, 0, 0] }), 0),
    null,
  );
});
test('twenty click/cancel/load-failure cycles ignore stale callbacks and preserve original floor', () => {
  const p = new PassengerTransfers();
  p.register('player', floor);
  for (let i = 0; i < 20; i++) {
    const token = p.beginBoard('player', anchor(), proof(), i * 2);
    assert.ok(token);
    assert.equal(p.beginBoard('player', anchor(), proof(), i * 2), null);
    assert.equal(p.cancel(token), true);
    assert.equal(p.markPreloaded(token, i * 2), false);
    assert.equal(p.commit(token, proof(), i * 2), false);
    assert.deepEqual(p.state('player'), { mode: 'walking', floor });
    assert.equal(p.pendingFor('bus-1'), 0);
  }
});
test('reservation ownership prevents two passengers choosing one seat; timeout releases it', () => {
  const p = new PassengerTransfers();
  p.register('a', floor);
  p.register('b', floor);
  const token = p.beginBoard('a', anchor(), proof(), 0);
  assert.ok(token);
  assert.equal(p.beginBoard('b', anchor(), proof(), 1), null);
  p.expire(15);
  assert.equal(p.markPreloaded(token, 15), false);
  assert.ok(p.beginBoard('b', anchor(), proof(), 15));
});
test('commit revalidates exact target and fails closed if doors close after preload', () => {
  for (const changed of [
    { doorOpen: false },
    { stopId: 'different-stop' },
    { vehicleId: 'bus-2' },
    { doorId: 'rear-right' },
    { floorPointM: [1, 0, 0] },
  ]) {
    const p = new PassengerTransfers();
    p.register('player', floor);
    const token = p.beginBoard('player', anchor(), proof(), 0);
    p.markPreloaded(token, 1);
    assert.equal(p.commit(token, proof(changed), 2), false);
    assert.equal(p.state('player').mode, 'walking');
    assert.equal(p.occupantsFor('bus-1'), 0);
    assert.equal(p.pendingFor('bus-1'), 0);
  }
});
test('ten repeated board/ride/alight cycles retain seat until a verified safe exit commits', () => {
  const p = new PassengerTransfers();
  p.register('player', floor);
  for (let i = 0; i < 10; i++) {
    const now = i * 20,
      token = p.beginBoard('player', anchor(), proof(), now);
    p.markPreloaded(token, now);
    assert.equal(p.commit(token, proof(), now), true);
    assert.equal(p.unregister('player'), false);
    assert.equal(p.occupantsFor('bus-1'), 1);
    const bad = p.beginAlight('player', floor, proof(), now + 1);
    p.markPreloaded(bad, now + 1);
    assert.equal(p.commit(bad, proof({ floorValid: false }), now + 1), false);
    assert.equal(p.occupantsFor('bus-1'), 1);
    const good = p.beginAlight('player', floor, proof(), now + 2);
    p.markPreloaded(good, now + 2);
    assert.equal(p.commit(good, proof(), now + 2), true);
    assert.equal(p.occupantsFor('bus-1'), 0);
    assert.equal(p.pendingFor('bus-1'), 0);
    assert.deepEqual(p.state('player'), { mode: 'walking', floor });
  }
});
test('adjacent exit reservations cannot overlap and alighting keeps occupants pinned', () => {
  const p = new PassengerTransfers();
  board(p, 'a');
  board(p, 'b', 0, anchor({ anchorId: 'seat-02' }));
  assert.ok(p.beginAlight('a', floor, proof(), 1));
  const near = { ...floor, x: 0.2 };
  assert.equal(
    p.beginAlight('b', near, proof({ floorPointM: [0.2, 0, 0] }), 1),
    null,
  );
  assert.equal(p.occupantsFor('bus-1'), 2);
});
test('bus 5/6 rebind retains vehicle/car/local anchor and refuses moving/in-flight transitions', () => {
  const p = new PassengerTransfers();
  board(p);
  const before = p.state('player');
  assert.equal(
    p.rebindService('bus-1', 'bus-5-east', 'bus-6-west', 'junction', false),
    false,
  );
  assert.equal(
    p.rebindService('bus-1', 'bus-5-east', 'bus-6-west', 'junction', true),
    true,
  );
  assert.deepEqual(p.state('player').anchor, before.anchor);
  assert.equal(p.state('player').serviceId, 'bus-6-west');
});
const plan = () => ({
  serviceId: 'bus-5-east',
  lineId: '5',
  directionId: 'east',
  vehicleProfileId: 'low-floor-bus-12m',
  pathId: 'fixture',
  pathLengthM: 60,
  speedLimitMps: 5,
  accelerationMps2: 2,
  brakingMps2: 2,
  endpoint: 'hold-for-alighting',
  stops: [0, 20, 50].map((x, i) => ({
    stopId: `stop-${i}`,
    stationId: `station-${i}`,
    platformId: `platform-${i}`,
    pathStationM: x,
    surfaceId: `curb-${i}`,
    layer: 0,
    doorSide: 'right',
  })),
});
const input = (overrides = {}) => ({
  clearDistanceM: Infinity,
  doorsClosed: true,
  platformDoorsOpen: true,
  alignmentValid: true,
  pendingTransfers: 0,
  ...overrides,
});
test('service visits every stop, interlocks transfers, honors stop dwell and holds final endpoint', () => {
  const s = new TransitService('bus-1', plan()),
    seen = new Set();
  let blocked = false;
  for (let i = 0; i < 10000; i++) {
    const snap = s.snapshot();
    if (snap.phase === 'dwell') seen.add(snap.stopId);
    const pending =
      snap.phase === 'dwell' && snap.stopIndex === 0 && !blocked ? 1 : 0;
    if (pending) {
      for (let n = 0; n < 250; n++)
        s.update(0.05, input({ pendingTransfers: 1 }));
      assert.equal(s.snapshot().phase, 'dwell');
      blocked = true;
    }
    s.update(0.05, input());
    if (s.snapshot().phase === 'terminal') break;
  }
  assert.deepEqual([...seen], ['stop-0', 'stop-1', 'stop-2']);
  const last = s.snapshot();
  for (let i = 0; i < 12000; i++) s.update(0.05, input());
  assert.deepEqual(s.snapshot(), last);
  assert.equal(s.canRecycle(1, 0, false), false);
  assert.equal(s.canRecycle(0, 1, false), false);
  assert.equal(s.canRecycle(0, 0, true), false);
  assert.equal(s.canRecycle(0, 0, false), true);
});
test('service cannot open before continuous standstill/alignment or move with open doors', () => {
  const s = new TransitService('bus-1', plan());
  s.update(0.05, input());
  for (let i = 0; i < 20; i++) s.update(0.05, input({ alignmentValid: false }));
  assert.equal(s.snapshot().phase, 'stopped');
  s.update(0.05, input());
  assert.equal(s.snapshot().phase, 'opening');
  const movingPlan = plan();
  movingPlan.stops = movingPlan.stops.slice(1);
  const m = new TransitService('bus-2', movingPlan);
  for (let i = 0; i < 10; i++) m.update(0.2, input({ doorsClosed: false }));
  assert.equal(m.snapshot().pathStationM, 0);
  for (let i = 0; i < 100; i++) m.update(0.2, input({ clearDistanceM: 0 }));
  assert.equal(m.snapshot().pathStationM, 0);
  m.update(30, input());
  assert.ok(m.snapshot().pathStationM < 0.1);
});
test('service rejects ambiguous stops and does not mutate caller plans', () => {
  const p = plan();
  p.stops[1].stopId = p.stops[0].stopId;
  assert.throws(() => new TransitService('bus', p), /Invalid/);
  const p2 = plan(),
    s = new TransitService('bus', p2);
  p2.stops[0].stopId = 'mutated';
  assert.equal(s.snapshot().stopId, 'stop-0');
});
test('cache deduplicates loads, pins riders, bounds pending and releases shared owner exactly once', async () => {
  const disposed = [];
  const cache = new SharedResourceCache(2, 1, 3, (v) => disposed.push(v));
  let loads = 0,
    resolve;
  const load = () => {
    loads++;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const a = cache.acquire('interior', load, 0),
    b = cache.acquire('interior', load, 0);
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.throws(() => cache.acquire('station', async () => 2, 0), /capacity/);
  resolve('mesh');
  await a.ready;
  await b.ready;
  a.release(1);
  cache.collect(10);
  assert.deepEqual(disposed, []);
  b.release(10);
  b.release(10);
  cache.collect(12);
  assert.deepEqual(disposed, []);
  cache.collect(13);
  assert.deepEqual(disposed, ['mesh']);
  assert.deepEqual(cache.stats(), { entries: 0, pending: 0, references: 0 });
});
test('cache retries failed loads without poisoning key and reuses entries over ten reentries', async () => {
  const cache = new SharedResourceCache(2, 2, 3, () => {});
  const failed = cache.acquire(
    'x',
    async () => {
      throw Error('load failed');
    },
    0,
  );
  await assert.rejects(failed.ready, /load failed/);
  failed.release(0);
  let loads = 0;
  for (let i = 0; i < 10; i++) {
    const lease = cache.acquire('x', async () => ++loads, i);
    assert.equal(await lease.ready, 1);
    lease.release(i);
  }
  assert.equal(loads, 1);
  cache.collect(20);
  assert.equal(cache.stats().entries, 0);
});
const segments = () => [
  {
    segmentId: 'a',
    sourceId: 'synthetic-only',
    surfaceId: 'road',
    layer: 0,
    points: [
      [0, 0, 0],
      [0, 0, 5],
      [0, 0, 10],
      [0, 0, 15],
    ],
  },
  {
    segmentId: 'b',
    sourceId: 'synthetic-only',
    surfaceId: 'road',
    layer: 0,
    points: [
      [0, 0, 15],
      [0, 0, 20],
      [5, 1, 25],
      [10, 1, 25],
    ],
  },
  {
    segmentId: 'c',
    sourceId: 'synthetic-only',
    surfaceId: 'road',
    layer: 0,
    points: [
      [10, 1, 25],
      [15, 1, 25],
      [20, 2, 20],
      [20, 2, 15],
    ],
  },
];
test('continuous path negotiates two turns with continuous position/heading and independent cars', () => {
  const path = new ContinuousPath(segments(), 128);
  let prev = path.sample(0);
  for (let d = 0.05; d < path.length; d += 0.05) {
    const next = path.sample(d);
    assert.ok(next.position.distanceTo(prev.position) < 0.051);
    assert.ok(next.rotation.angleTo(prev.rotation) < 0.03);
    prev = next;
  }
  const cars = path.cars(40, [0, 10, 20]);
  assert.ok(cars[0].rotation.angleTo(cars[1].rotation) > 0.1);
  assert.throws(() => path.cars(2, [0, 10]), /beyond/);
});
test('path rejects automatic stacked-floor joins, gaps and heading discontinuities', () => {
  const stacked = segments();
  stacked[1].surfaceId = 'bridge';
  assert.throws(() => new ContinuousPath(stacked), /surface connection/);
  stacked[1].connectionFromPrevious = 'verified-ramp';
  stacked[2].connectionFromPrevious = 'verified-ramp-end';
  assert.doesNotThrow(() => new ContinuousPath(stacked));
  const gap = segments();
  gap[1].points[0][0] = 1;
  assert.throws(() => new ContinuousPath(gap), /Disconnected/);
  const kink = segments();
  kink[1].points[1] = [10, 0, 15];
  assert.throws(() => new ContinuousPath(kink), /heading/);
});
test('rider car-local transform follows turn/slope and is independent of observation camera', () => {
  const path = new ContinuousPath(segments()),
    car = path.sample(30),
    local = [0.7, 1.45, 0];
  const before = riderWorldTransform(
    car.position,
    car.rotation,
    local,
    [0, 0, 0, 1],
  );
  const restored = before.position
    .clone()
    .sub(car.position)
    .applyQuaternion(car.rotation.clone().invert());
  assert.ok(restored.distanceTo(new THREE.Vector3(...local)) < 1e-10);
  const camera = new THREE.Vector3(1000, 1000, 1000);
  camera.set(-1000, 500, -1000);
  const after = riderWorldTransform(
    car.position,
    car.rotation,
    local,
    [0, 0, 0, 1],
  );
  assert.deepEqual(before.position, after.position);
});
const authority = (overrides = {}) => ({
  vehicleId: 'bus-1',
  serviceId: 'service',
  simulationAuthority: 'service-controller',
  positionM: [1, 2, 3],
  rotationQuaternionXYZW: [0, 0, 0, 1],
  speedMps: 3,
  pathStationM: 4,
  doorOpen: false,
  passengers: 0,
  pendingTransfers: 0,
  ...overrides,
});
const capable = {
  passengerCapable: true,
  doorsAnimated: true,
  openingsPreserved: true,
};
test('representation holds old handle during preload, ignores stale tokens and preserves exact authority', () => {
  let oldReleased = 0,
    newReleased = 0;
  const swap = new RepresentationTransaction(
    'bus-1',
    'old',
    () => oldReleased++,
  );
  const token = swap.reserve('detail', 0);
  assert.equal(swap.snapshot().handle, 'old');
  swap.preload(token, 'new', capable, () => newReleased++, 1);
  const state = authority({ passengers: 1 }),
    result = swap.commit(token, state, 2);
  assert.equal(result.newHandle, 'new');
  assert.deepEqual(result.authority, state);
  assert.equal(oldReleased, 0);
  result.releaseOld();
  result.releaseOld();
  assert.equal(oldReleased, 1);
  assert.equal(newReleased, 0);
  assert.equal(
    swap.preload(token, 'stale', capable, () => newReleased++, 3),
    false,
  );
  assert.equal(newReleased, 1);
});
test('representation rejects passenger-incapable downgrades, timeout and invalid authority', () => {
  let released = 0;
  const swap = new RepresentationTransaction(
    'bus-1',
    'detail',
    () => {},
    'detail',
  );
  let t = swap.reserve('instance', 0);
  swap.preload(
    t,
    'instance',
    { passengerCapable: false, doorsAnimated: false, openingsPreserved: false },
    () => released++,
    1,
  );
  assert.equal(swap.commit(t, authority({ passengers: 1 }), 2), null);
  assert.equal(swap.snapshot().handle, 'detail');
  assert.equal(released, 1);
  t = swap.reserve('instance', 3);
  swap.preload(t, 'instance', capable, () => released++, 4);
  swap.expire(18);
  assert.equal(released, 2);
  assert.equal(swap.snapshot().pending, false);
  t = swap.reserve('instance', 20);
  swap.preload(t, 'instance', capable, () => released++, 21);
  assert.equal(swap.commit(t, authority({ vehicleId: 'wrong' }), 22), null);
  assert.equal(released, 3);
});
const { TrafficOccupancy } = await import(
  cityModule('city-life/traffic-occupancy')
);
const { PathActor } = await import(cityModule('city-life/actor-state'));
test('cars queue behind dwelling bus on same lane but not a stacked bridge', () => {
  const traffic = new TrafficOccupancy();
  traffic.update({
    vehicleId: 'car',
    pathId: 'lane',
    surfaceId: 'road',
    layer: 0,
    stationM: 10,
    lengthM: 4,
  });
  traffic.update({
    vehicleId: 'bus',
    pathId: 'lane',
    surfaceId: 'road',
    layer: 0,
    stationM: 30,
    lengthM: 12,
  });
  traffic.update({
    vehicleId: 'above',
    pathId: 'lane',
    surfaceId: 'bridge',
    layer: 1,
    stationM: 16,
    lengthM: 4,
  });
  assert.equal(traffic.clearDistance('car'), 10);
  assert.equal(traffic.clearDistance('bus'), Infinity);
  traffic.update({
    vehicleId: 'bus',
    pathId: 'lane',
    surfaceId: 'road',
    layer: 0,
    stationM: 16,
    lengthM: 12,
  });
  assert.equal(traffic.clearDistance('car'), 0);
});
test('junction conflict reservations are atomic and cannot release an occupied intersection', () => {
  const t = new TrafficOccupancy();
  for (const id of ['a', 'b'])
    t.update({
      vehicleId: id,
      pathId: id,
      surfaceId: 'road',
      layer: 0,
      stationM: 0,
      lengthM: 4,
    });
  assert.equal(
    t.reserveJunction('a', ['intersection:a', 'intersection:b']),
    true,
  );
  assert.equal(
    t.reserveJunction('b', ['intersection:c', 'intersection:b']),
    false,
  );
  assert.equal(t.snapshot().blocks.length, 2);
  assert.equal(
    t.releaseJunction('a', ['intersection:a', 'intersection:b'], false),
    false,
  );
  assert.equal(t.remove('a', true, true, 0), false);
  assert.equal(
    t.releaseJunction('a', ['intersection:a', 'intersection:b'], true),
    true,
  );
  assert.equal(
    t.reserveJunction('b', ['intersection:c', 'intersection:b']),
    true,
  );
});
test('actor reaction resumes same station/identity and waits when crossing lacks safe next point', () => {
  const actor = new PathActor(
    'walker',
    {
      routeId: 'validated-sidewalk',
      surfaceId: 'road',
      layer: 0,
      lengthM: 20,
      loop: false,
      validated: true,
    },
    3,
    0.2,
  );
  assert.equal(
    actor.react('horn', 'look', 1, 0, { surfaceId: 'underground', layer: -1 }),
    false,
  );
  assert.equal(
    actor.react('horn', 'look', 1, 0, { surfaceId: 'road', layer: 0 }),
    true,
  );
  assert.equal(
    actor.react('horn', 'look', 1, 0, { surfaceId: 'road', layer: 0 }),
    false,
  );
  actor.update(0.5, 1, 10);
  assert.equal(actor.snapshot().stationM, 3);
  actor.update(0.5, 1, 10);
  assert.equal(actor.snapshot().activity, 'walk');
  actor.update(1, 1, 0);
  assert.equal(actor.snapshot().stationM, 3);
  assert.equal(actor.snapshot().activity, 'wait');
  actor.update(1, 1, 10);
  assert.equal(actor.snapshot().stationM, 4);
  assert.equal(actor.snapshot().actorId, 'walker');
});
test('failed representation installation rolls back and blocks competing swaps until settled', () => {
  let oldReleased = 0,
    newReleased = 0;
  const swap = new RepresentationTransaction(
    'bus-1',
    'old',
    () => oldReleased++,
  );
  const token = swap.reserve('detail', 0);
  swap.preload(token, 'new', capable, () => newReleased++, 1);
  const result = swap.commit(token, authority(), 2);
  assert.equal(swap.reserve('instance', 3), null);
  assert.equal(result.rollback(), true);
  assert.equal(result.rollback(), false);
  result.releaseOld();
  assert.equal(oldReleased, 0);
  assert.equal(newReleased, 1);
  assert.equal(swap.snapshot().handle, 'old');
  assert.ok(swap.reserve('detail', 4));
});
test('transfer rejects time travel and recycled passenger IDs never reuse stale generations', () => {
  const p = new PassengerTransfers();
  p.register('player', floor);
  const first = p.beginBoard('player', anchor(), proof(), 10);
  assert.equal(p.markPreloaded(first, 9), false);
  p.cancel(first);
  assert.equal(p.unregister('player'), true);
  p.register('player', floor);
  const second = p.beginBoard('player', anchor(), proof(), 11);
  assert.notEqual(first.generation, second.generation);
  assert.equal(p.markPreloaded(first, 12), false);
  assert.equal(p.markPreloaded(second, 12), true);
});
const { readFileSync } = await import('node:fs');
const { passengerContractFromManifest } = await import(
  cityModule('city-life/vehicle-profile-adapter')
);
const assetManifest = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../tools/assets/${name}/manifest.json`, import.meta.url),
      'utf8',
    ),
  );
test('existing D02–D05 contracts bind to unique live IDs without copying assets or losing pelvis datum', () => {
  const bus = assetManifest('boardable-bus');
  const b = passengerContractFromManifest(
    bus,
    'city-bus-12m',
    'low-floor-bus-12m',
    'live-bus-5',
    'car-0',
    0,
  );
  assert.ok(b.anchors.length > 2);
  assert.equal(b.anchors[0].anchor.vehicleId, 'live-bus-5');
  assert.equal(b.anchors[0].datum, 'pelvis');
  assert.deepEqual(
    b.anchors[0].anchor.translationM,
    bus.vehicles[0].seats[0].pelvisPointM,
  );
  assert.ok(b.anchors.some((a) => a.datum === 'feet'));
  const metro = assetManifest('boardable-metro');
  const m = passengerContractFromManifest(
    metro,
    'expo-metro-lead',
    'expo-metro-17m',
    'live-expo',
    'car-1',
    1,
  );
  assert.ok(m.anchors.length > 2);
  assert.equal(m.anchors[0].anchor.carId, 'car-1');
});
test('profile adapter rejects non-passenger LOD, Canada/Expo confusion, nested frames and wrong datum units', () => {
  const bus = assetManifest('boardable-bus');
  assert.throws(
    () =>
      passengerContractFromManifest(
        bus,
        'city-bus-12m',
        'low-floor-bus-12m',
        'live',
        'car',
        2,
      ),
    /passenger capable/,
  );
  assert.throws(
    () =>
      passengerContractFromManifest(
        bus,
        'city-bus-12m',
        'canada-line',
        'live',
        'car',
        0,
      ),
    /profile mismatch/,
  );
  const nested = structuredClone(bus);
  nested.vehicles[0].seats[0].frameId = 'unresolved';
  assert.throws(
    () =>
      passengerContractFromManifest(
        nested,
        'city-bus-12m',
        'low-floor-bus-12m',
        'live',
        'car',
        0,
      ),
    /Nested/,
  );
  bus.units = 'cm';
  assert.throws(
    () =>
      passengerContractFromManifest(
        bus,
        'city-bus-12m',
        'low-floor-bus-12m',
        'live',
        'car',
        0,
      ),
    /units/,
  );
});
test('analytic cubic derivative validation rejects an internal cusp missed by regular sampling', () => {
  const cusp = {
    segmentId: 'cusp',
    sourceId: 'synthetic-only',
    surfaceId: 'road',
    layer: 0,
    points: [
      [0, 0, 0],
      [0, 0, 10],
      [0, 0, -10],
      [0, 0, 0],
    ],
  };
  for (const subdivisions of [8, 64, 128])
    assert.throws(() => new ContinuousPath([cusp], subdivisions), /cusp/);
});
