import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { DISCOVERY_ROUTES, discoveryLegStart, discoveryRouteLength } =
  await import(cityModule('discovery-routes'));
const {
  emptyDiscoverySave,
  readDiscoverySave,
  DiscoveryLeg,
  startDiscovery,
  collectDiscovery,
} = await import(cityModule('discovery'));
const { canStartDiscovery, placeDiscoveryStart } = await import(
  cityModule('discovery-runtime')
);
const route = DISCOVERY_ROUTES[0];
const sample = (position, now = 0, patch = {}) => ({
  x: position[0],
  z: position[1],
  now,
  mode: 'walk',
  visible: true,
  grounded: true,
  ...patch,
});
function walk(leg, from, to, start = 0, speed = 4) {
  let result = leg.sample(sample(from, start));
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.ceil(length / (speed / 4));
  let at;
  for (let i = 1; i <= steps; i++) {
    at = sample(
      [
        from[0] + ((to[0] - from[0]) * i) / steps,
        from[1] + ((to[1] - from[1]) * i) / steps,
      ],
      start + i * 250,
    );
    result = leg.sample(at);
  }
  return { at, result };
}

test('passport parsing rejects corruption and future schemas; bounds each known route independently', () => {
  for (const raw of [
    null,
    '',
    '{',
    'null',
    '[]',
    '{"version":2}',
    '{"version":1,"routes":null}',
  ])
    assert.deepEqual(readDiscoverySave(raw), emptyDiscoverySave());
  const clean = readDiscoverySave(
    JSON.stringify({
      version: 1,
      selected: '__proto__',
      routes: {
        gastown: { next: 700, best: -2, stamped: false },
        robson: { next: 1.5, best: '3', stamped: true },
        'west-end': { next: 1, best: 2, stamped: true },
        alien: { next: 99 },
      },
    }),
  );
  assert.deepEqual(
    Object.keys(clean.routes),
    DISCOVERY_ROUTES.map((item) => item.id),
  );
  assert.equal(clean.selected, 'gastown');
  assert.deepEqual(clean.routes.gastown, { next: 3, best: 3, stamped: true });
  assert.deepEqual(clean.routes.robson, { next: 0, best: 0, stamped: false });
  assert.deepEqual(clean.routes['west-end'], {
    next: 1,
    best: 2,
    stamped: false,
  });
});

test('nine unique observations span three short ordered walks on the audited corridor axes', () => {
  assert.equal(DISCOVERY_ROUTES.length, 3);
  assert.deepEqual(
    DISCOVERY_ROUTES.map((item) => Math.round(discoveryRouteLength(item))),
    [250, 360, 275],
  );
  for (const item of DISCOVERY_ROUTES) {
    assert.equal(item.stops.length, 3);
    assert.equal(new Set(item.stops.map((stop) => stop.id)).size, 3);
    const a = item.start,
      b = item.stops.at(-1).position;
    let previous = 0;
    for (const stop of item.stops) {
      const x = stop.position[0] - a[0],
        z = stop.position[1] - a[1];
      assert(Math.abs(x * (b[1] - a[1]) - z * (b[0] - a[0])) < 1e-7);
      const distance = Math.hypot(x, z);
      assert(distance > previous + 40);
      previous = distance;
      for (const locale of ['en', 'zh-Hant', 'zh-Hans'])
        assert(stop.note[locale].length > 30);
    }
  }
});

test('only visible ground-level walking near the stop unlocks a field note; simply being there does not', () => {
  const leg = new DiscoveryLeg(route, 0);
  let status = leg.sample(sample(route.stops[0].position));
  assert.equal(status.eligible, false);
  const journey = walk(leg, route.start, route.stops[0].position, 1000);
  assert.equal(journey.result.eligible, true);
  assert(journey.result.walked >= 65 - 1e-8);
  for (const patch of [
    { mode: 'orbit' },
    { mode: 'drive' },
    { mode: 'flight' },
    { grounded: false },
    { visible: false },
  ]) {
    const current = new DiscoveryLeg(route, 0);
    const walked = walk(current, route.start, route.stops[0].position);
    assert.equal(
      current.sample({ ...walked.at, now: walked.at.now + 250, ...patch })
        .eligible,
      false,
    );
  }
});

test('actual navigation running speed is accepted, but instantaneous placements reset leg credit', () => {
  for (const speed of [4, 12]) {
    const leg = new DiscoveryLeg(route, 0);
    const result = walk(leg, route.start, route.stops[0].position, 0, speed);
    assert.equal(result.result.eligible, true);
  }
  const leg = new DiscoveryLeg(route, 0);
  walk(leg, route.start, route.stops[0].position);
  const teleported = leg.sample(sample(route.stops[1].position, 16501));
  assert.equal(teleported.walked, 0);
  assert.equal(teleported.discontinuity, true);
  assert.equal(teleported.eligible, false);
});

test('mode switching and elevated surfaces discard walking credit until a ground leg is walked again', () => {
  for (const patch of [
    { mode: 'orbit' },
    { mode: 'boat' },
    { grounded: false },
  ]) {
    const leg = new DiscoveryLeg(route, 0);
    const { at } = walk(leg, route.start, route.stops[0].position);
    leg.sample({ ...at, now: at.now + 250, ...patch });
    const returned = leg.sample({ ...at, now: at.now + 500 });
    assert.equal(returned.walked, 0);
    assert.equal(returned.eligible, false);
  }
});

test('hidden tabs retain same-position credit but do not credit unseen travel or hidden placements', () => {
  const leg = new DiscoveryLeg(route, 0);
  const middle = [
    (route.start[0] + route.stops[0].position[0]) / 2,
    (route.start[1] + route.stops[0].position[1]) / 2,
  ];
  const { at } = walk(leg, route.start, middle);
  const before = leg.walked;
  leg.sample({ ...at, now: at.now + 250, visible: false });
  const returned = leg.sample({ ...at, now: at.now + 60000 });
  assert.equal(returned.walked, before);
  leg.sample({ ...at, now: at.now + 60250, visible: false });
  const jumped = leg.sample(sample(route.stops[0].position, at.now + 70000));
  assert.equal(jumped.walked, 0);
  assert.equal(jumped.eligible, false);
});

test('long sampling gaps, invalid coordinates and camera-like positions cannot earn a note', () => {
  const leg = new DiscoveryLeg(route, 0);
  leg.sample(sample(route.start));
  assert.equal(leg.sample(sample(route.stops[0].position, 60000)).walked, 0);
  assert.equal(leg.sample(sample([NaN, Infinity], 60500)).eligible, false);
  const save = emptyDiscoverySave();
  assert.equal(
    collectDiscovery(save, leg, sample(route.stops[0].position, 60750)),
    save,
  );
});

test('manual collection is ordered and idempotent; completing a trail persists a permanent stamp', () => {
  let save = startDiscovery(emptyDiscoverySave(), route);
  let time = 0;
  for (let next = 0; next < route.stops.length; next++) {
    const leg = new DiscoveryLeg(route, next);
    const walked = walk(
      leg,
      discoveryLegStart(route, next),
      route.stops[next].position,
      time,
    );
    const newer = collectDiscovery(save, leg, {
      ...walked.at,
      now: walked.at.now + 1,
    });
    assert.notEqual(newer, save);
    assert.equal(newer.routes[route.id].next, next + 1);
    assert.equal(
      collectDiscovery(newer, leg, { ...walked.at, now: walked.at.now + 2 }),
      newer,
    );
    save = newer;
    time = walked.at.now + 250;
  }
  assert.deepEqual(save.routes.gastown, { next: 3, best: 3, stamped: true });
  assert.deepEqual(readDiscoverySave(JSON.stringify(save)), save);
  const replay = startDiscovery(save, route);
  assert.deepEqual(replay.routes.gastown, { next: 0, best: 3, stamped: true });
  assert.equal(
    save.routes.gastown.next,
    3,
    'replay must not mutate previously saved state',
  );
});

test('save/reload resumes at previous collected stop and requires walking the remaining leg', () => {
  const leg = new DiscoveryLeg(route, 0);
  const { at } = walk(leg, route.start, route.stops[0].position);
  let save = collectDiscovery(emptyDiscoverySave(), leg, {
    ...at,
    now: at.now + 1,
  });
  save = readDiscoverySave(JSON.stringify(save));
  const resumed = startDiscovery(save, route);
  assert.equal(resumed.routes.gastown.next, 1);
  assert.deepEqual(discoveryLegStart(route, 1), route.stops[0].position);
  const next = new DiscoveryLeg(route, 1);
  assert.equal(
    collectDiscovery(resumed, next, sample(route.stops[1].position)),
    resumed,
  );
});

function cityStub(blocked = () => false, protectedAt = () => false) {
  const starts = [],
    probes = [],
    effects = [];
  return {
    starts,
    probes,
    effects,
    settings: { mode: 'orbit', autoRotate: true },
    data: {
      travelSurfaces: { lookup: (x, z) => (protectedAt(x, z) ? [{}] : []) },
    },
    navigation: {
      clearGround(x, z, mode) {
        probes.push([x, z, mode]);
        return !blocked(x, z);
      },
      roadHeight: () => 22,
      startAt(mode, point) {
        starts.push({ mode, point });
        return true;
      },
    },
    flight: { clear: () => effects.push('flight') },
    placement: { cancel: () => effects.push('placement') },
    applySettings(settings) {
      this.settings = settings;
      effects.push('settings');
    },
  };
}
test('every route probes all remaining segments and only an explicit start places the walker', () => {
  for (const item of DISCOVERY_ROUTES) {
    const city = cityStub();
    assert.equal(canStartDiscovery(city, item, 0), true);
    assert(city.probes.length > 150);
    assert.equal(city.starts.length, 0);
    assert.equal(placeDiscoveryStart(city, item, 1), true);
    assert.equal(city.starts.length, 1);
    assert.deepEqual(
      [city.starts[0].point.x, city.starts[0].point.z],
      item.stops[0].position,
    );
    assert.equal(city.starts[0].point.y, 22);
    assert.equal(city.starts[0].point.surface, 'ground');
    assert.equal(city.settings.mode, 'walk');
    assert.equal(city.settings.autoRotate, false);
  }
});
test('blocked or protected trail segments fail before mutating travel state', () => {
  const target = route.stops[1].position;
  for (const city of [
    cityStub((x, z) => Math.hypot(x - target[0], z - target[1]) < 5),
    cityStub(
      () => false,
      () => true,
    ),
  ]) {
    assert.equal(placeDiscoveryStart(city, route, 0), false);
    assert.deepEqual(city.effects, []);
    assert.deepEqual(city.starts, []);
    assert.equal(city.settings.mode, 'orbit');
  }
});
