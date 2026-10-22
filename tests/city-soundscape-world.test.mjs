import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { CitySoundscapeWorld, SoundscapeShoreIndex } = await import(
  cityModule('city-soundscape-world')
);
const { FootstepTracker } = await import(cityModule('soundscape-policy'));
const { SkyTrainTravel } = await import(cityModule('skytrain-travel'));
const { project, unproject } = await import(cityModule('geo'));

const coast = (segments) => ({
  type: 'FeatureCollection',
  features: segments.map((line) => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: line.map(([x, z]) => unproject(x, z)),
    },
  })),
});
const rectangle = (xmin, zmin, xmax, zmax) => [
  [
    [xmin, zmin],
    [xmax, zmin],
    [xmax, zmax],
    [xmin, zmax],
    [xmin, zmin],
  ],
];

test('shore spatial buckets match exact segment projection across negative cells, corners, long edges and the180m cutoff', () => {
  const segments = [
    [
      [-850, -750],
      [850, 750],
    ],
    [
      [-400, 205],
      [-400, 205],
    ],
    [
      [199, -750],
      [201, 750],
    ],
    [
      [-600, 400],
      [600, 400],
    ],
  ];
  const data = coast(segments),
    index = new SoundscapeShoreIndex(data);
  const projected = data.features.map((feature) =>
    feature.geometry.coordinates.map(project),
  );
  const brute = (x, z) => {
    let nearest = Infinity;
    for (const [a, b] of projected) {
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      const length = dx * dx + dz * dz;
      const t = length
        ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length))
        : 0;
      nearest = Math.min(
        nearest,
        Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t),
      );
    }
    return nearest < 180 ? nearest : Infinity;
  };
  for (let x = -1000; x <= 1000; x += 37)
    for (let z = -1000; z <= 1000; z += 41) {
      const actual = index.distance(x, z),
        expected = brute(x, z);
      if (!Number.isFinite(expected))
        assert.equal(actual, Infinity, `${x},${z}`);
      else
        assert(
          Math.abs(actual - expected) < 1e-8,
          `${x},${z}: ${actual} vs ${expected}`,
        );
    }
  assert.equal(index.distance(NaN, 0), Infinity);
  assert.equal(index.distance(0, Infinity), Infinity);
});

function fixture() {
  const counts = { shoreline: 0, parks: 0, interior: 0 };
  const frames = [];
  const data = { beachCoast: {}, beachPolys: [] };
  Object.defineProperty(data.beachCoast, 'shoreline', {
    get() {
      counts.shoreline++;
      return coast([
        [
          [-500, 0],
          [500, 0],
        ],
      ]);
    },
  });
  const city = {
    soundscape: { enabled: false, update: (frame) => frames.push(frame) },
    camera: new THREE.PerspectiveCamera(),
    elevation: () => 0,
    data,
    clock: { hour: 10 },
    settings: { harbour: true, trains: true },
    interiors: {
      height: () => {
        counts.interior++;
        return undefined;
      },
    },
    navigation: {
      mode: 'walk',
      position: new THREE.Vector3(0, 0, 0),
      surface: 'ground',
      surfaceId: 'ground',
      walkSeat: null,
    },
    busVisit: { aboard: false },
    skyTrainTravel: null,
    railway: { group: { visible: true }, trains: [] },
  };
  let parks = [];
  Object.defineProperty(city, 'parkPolys', {
    get() {
      counts.parks++;
      return parks;
    },
  });
  city.camera.position.set(0, 1.7, 10);
  city.camera.updateMatrixWorld(true);
  const world = new CitySoundscapeWorld(city);
  return {
    city,
    world,
    counts,
    frames,
    setParks: (value) => {
      parks = value;
    },
  };
}

test('disabled audio never reads geography/camera or constructs an index, enable is lazy and environment is sampled at5Hz', () => {
  const noWork = new CitySoundscapeWorld({
    soundscape: { enabled: false },
    get camera() {
      throw Error('disabled camera access');
    },
    get data() {
      throw Error('disabled geography access');
    },
  });
  noWork.update(0);
  noWork.update(10000);
  const f = fixture();
  f.world.update(0);
  f.world.update(1000);
  assert.deepEqual(f.counts, { shoreline: 0, parks: 0, interior: 0 });
  assert.equal(f.frames.length, 0);
  f.city.soundscape.enabled = true;
  for (const now of [0, 16, 100, 199, 200, 201, 400]) {
    f.city.navigation.position.x = now / 1000;
    f.world.update(now);
  }
  assert.equal(f.frames.length, 7, 'foot positions update every active frame');
  assert.equal(f.frames.at(-1).footsteps.position[0], 0.4);
  assert.equal(f.counts.shoreline, 1, 'the built index is retained');
  assert.equal(
    f.counts.interior,
    3,
    'environment reads use milliseconds and a200ms cadence',
  );
  const before = { ...f.counts };
  f.city.soundscape.enabled = false;
  f.world.update(401);
  assert.deepEqual(f.counts, before);
  f.city.soundscape.enabled = true;
  f.world.update(402);
  assert.equal(
    f.counts.interior,
    4,
    're-enable refreshes a stale environment immediately',
  );
  assert.equal(f.counts.shoreline, 1);
});

test('ambience follows camera distance/daylight/indoor height while footsteps use the actual player surface', () => {
  const f = fixture();
  f.city.soundscape.enabled = true;
  f.setParks([{ poly: rectangle(-10, -10, 10, 10) }]);
  f.city.camera.position.set(0, 1.7, 0);
  f.city.navigation.position.set(30, 0, 30);
  f.world.update(0);
  assert.equal(f.frames.at(-1).greenery, 1);
  assert.equal(
    f.frames.at(-1).footsteps.surface,
    'pavement',
    'a chase camera over grass does not change player foot material',
  );
  f.city.data.beachPolys = [rectangle(20, 20, 40, 40)];
  f.city.clock.hour = 23;
  f.world.update(200);
  assert.equal(f.frames.at(-1).greenery, 0, 'park bird calls stop at night');
  assert.equal(f.frames.at(-1).footsteps.surface, 'sand');
  assert(
    f.frames.at(-1).shoreDistanceM > 1.5,
    'vertical separation is included',
  );
  f.city.interiors.height = () => 4;
  f.city.camera.position.set(0, 150, 0);
  f.world.update(400);
  assert.equal(
    f.frames.at(-1).interior,
    false,
    'being over a floor footprint is not being inside it',
  );
  f.city.camera.position.set(0, 5.7, 0);
  f.world.update(600);
  assert.equal(f.frames.at(-1).interior, true);
  f.city.settings.harbour = false;
  f.world.update(800);
  assert.equal(f.frames.at(-1).harbourDistanceM, Infinity);
});

function passenger() {
  const transit = Object.assign(Object.create(SkyTrainTravel.prototype), {
    phase: 'riding',
    line: 'expo',
    station: 'waterfront',
    level: 'platform',
    inputEnabled: true,
    busy: false,
    cabinSeat: null,
    stationSeat: null,
    cabinFoot: [0.4, 1.1, 2.0],
    foot: null,
    journey: { snapshot: () => ({ aboard: true }) },
    train: { ready: true, group: new THREE.Group() },
  });
  Object.defineProperties(transit, {
    underground: { value: false },
    speedMps: { value: 15 },
  });
  return transit;
}

test('actual passenger getter and adapter keep carriage movement out of footstep cadence; local walking sounds and seats stop it', () => {
  const f = fixture(),
    tracker = new FootstepTracker(),
    transit = passenger();
  f.city.soundscape.enabled = true;
  f.city.skyTrainTravel = transit;
  for (let i = 0; i < 40; i++) {
    transit.train.group.position.set(i * 2, 5, i);
    f.city.camera.position.set(i * 2, 6.7, i);
    f.world.update(i * 100);
    const frame = f.frames.at(-1);
    assert.deepEqual(frame.footsteps.position, [0.4, 1.1, 2.0]);
    assert.equal(frame.trains[0].aboard, true);
    assert.equal(frame.interior, true);
    assert.equal(
      tracker.sample(frame),
      null,
      'riding displacement never produces footsteps',
    );
  }
  let steps = 0;
  for (let i = 40; i < 70; i++) {
    transit.cabinFoot[2] += 0.3;
    f.world.update(i * 100);
    const event = tracker.sample(f.frames.at(-1));
    if (event) {
      steps++;
      assert.equal(event.surface, 'metal');
    }
  }
  assert(steps >= 6);
  transit.cabinSeat = { position: [2, 1, 1] };
  f.world.update(7100);
  assert.equal(f.frames.at(-1).footsteps.active, false);
  assert.equal(tracker.sample(f.frames.at(-1)), null);
  transit.cabinSeat = null;
  transit.inputEnabled = false;
  assert.equal(transit.soundscapeFootsteps.active, false);
  transit.inputEnabled = true;
  transit.cabinFoot = null;
  assert.equal(transit.soundscapeFootsteps, undefined);
});

test('external rail sounds exclude hidden/steam/distant trains and obey the train layer without source motion from parked buses', () => {
  const f = fixture();
  f.city.soundscape.enabled = true;
  const rail = (kind, x, visible = true) => ({
    kind,
    speed: 12,
    cars: [{ group: { visible, position: new THREE.Vector3(x, 1, 0) } }],
  });
  f.city.railway.trains = [
    rail('skytrain', 12),
    rail('steam', 15),
    rail('skytrain', 20, false),
    rail('skytrain', 300),
  ];
  f.world.update(0);
  assert.equal(f.frames.at(-1).trains.length, 1);
  assert.equal(f.frames.at(-1).trains[0].speedMps, 12);
  f.city.busVisit.aboard = true;
  f.world.update(200);
  assert.equal(f.frames.at(-1).interior, true);
  assert.equal(f.frames.at(-1).footsteps.active, false);
  f.city.settings.trains = false;
  f.world.update(400);
  assert.equal(f.frames.at(-1).trains.length, 0);
});
