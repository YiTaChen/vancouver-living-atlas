import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {
  LIGHT_LAB_PATH,
  LightLabVisit,
  emptyLightLabSave,
  readLightLabSave,
  startLightLab,
  submitLightLab,
  lightMixtureCSS,
  LIGHT_LAB_RECIPES,
} = await import(cityModule('light-lab'));
const { PublicInteriors } = await import(cityModule('interiors'));
const {
  canStartLightLab,
  placeLightLabStart,
  lightLabSample,
  lightLabTarget,
  faceLightLabExhibit,
} = await import(cityModule('light-lab-runtime'));
const sample = (position, now = 0, patch = {}) => ({
  x: position[0],
  z: position[1],
  now,
  mode: 'walk',
  visible: true,
  onFloor: true,
  ...patch,
});
function visitLab() {
  const visit = new LightLabVisit();
  let at = sample(LIGHT_LAB_PATH[0]),
    status = visit.sample(at);
  for (let index = 1; index < LIGHT_LAB_PATH.length; index++) {
    const a = LIGHT_LAB_PATH[index - 1],
      b = LIGHT_LAB_PATH[index];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    const started = at.now;
    for (let step = 1; step <= steps; step++) {
      at = sample(
        [
          a[0] + ((b[0] - a[0]) * step) / steps,
          a[1] + ((b[1] - a[1]) * step) / steps,
        ],
        started + step * 250,
      );
      status = visit.sample(at);
    }
  }
  return { visit, at, status };
}
const fixture = () => {
  const city = {
    renderer: {},
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    data: {},
    elevation: () => 3,
    camera: new THREE.PerspectiveCamera(),
    settings: { buildings: true, mode: 'walk' },
  };
  city.interiors = new PublicInteriors(city);
  city.navigation = {
    mode: 'walk',
    position: new THREE.Vector3(),
    surface: 'ground',
    clearGround: (x, z, mode) => city.interiors.clear(x, z, mode),
    startAt: (_, point) => {
      city.navigation.position.set(point.x, point.y, point.z);
      return true;
    },
  };
  city.applySettings = (value) => {
    city.settings = value;
  };
  return city;
};
test('lab save rejects malformed state, retains permanent stamp and resumes only the experiment stage', () => {
  for (const raw of [null, '{', 'null', '[]', '{"version":2}'])
    assert.deepEqual(readLightLabSave(raw), emptyLightLabSave());
  assert.deepEqual(
    readLightLabSave('{"version":1,"next":1.2,"best":"3","stamped":true}'),
    emptyLightLabSave(),
  );
  const completed = readLightLabSave(
    '{"version":1,"next":999,"stamped":false}',
  );
  assert.deepEqual(completed, { version: 1, next: 3, best: 3, stamped: true });
  assert.deepEqual(startLightLab(completed), {
    version: 1,
    next: 0,
    best: 3,
    stamped: true,
  });
});
test('lab corridor has continuous physical floor, avoids furniture with walking clearance and starts only after preflight', () => {
  const city = fixture();
  assert.equal(canStartLightLab(city), true);
  assert.equal(placeLightLabStart(city), true);
  const site = city.interiors.sites.find((s) => s.id === 'science');
  assert.deepEqual(lightLabTarget(city, 4), {
    x: city.interiors.world(site, 13, -16)[0],
    z: city.interiors.world(site, 13, -16)[1],
  });
  let changed = false;
  city.applySettings = () => {
    changed = true;
  };
  city.navigation.clearGround = () => false;
  assert.equal(placeLightLabStart(city), false);
  assert.equal(changed, false);
});
test('walking the ordered interior corridor admits a visitor; starting at the exhibit or skipping a corner does not', () => {
  const walked = visitLab();
  assert.equal(walked.status.eligible, true);
  assert.equal(walked.status.next, LIGHT_LAB_PATH.length);
  const placed = new LightLabVisit();
  assert.equal(placed.sample(sample(LIGHT_LAB_PATH.at(-1))).eligible, false);
  const skipped = new LightLabVisit();
  skipped.sample(sample(LIGHT_LAB_PATH[0]));
  for (let i = 0; i < 100; i++)
    skipped.sample(sample(LIGHT_LAB_PATH.at(-1), (i + 1) * 250));
  assert.equal(
    skipped.sample(sample(LIGHT_LAB_PATH.at(-1), 26000)).eligible,
    false,
  );
});
test('elevated, nonwalking, hidden and stale moved samples cannot award an experiment', () => {
  for (const patch of [
    { mode: 'orbit' },
    { mode: 'flight' },
    { mode: 'drive' },
    { onFloor: false },
    { visible: false },
    { x: NaN },
    { x: 40, z: -59, now: 100000 },
  ]) {
    const { visit, at } = visitLab(),
      save = emptyLightLabSave();
    assert.equal(
      submitLightLab(save, 0, LIGHT_LAB_RECIPES[0], visit, {
        ...at,
        now: at.now + 50,
        ...patch,
      }),
      save,
    );
  }
});
test('hidden same-position visit resumes; unseen displacement and mode switching require a new entrance walk', () => {
  const { visit, at } = visitLab();
  visit.sample({ ...at, now: at.now + 250, visible: false });
  assert.equal(visit.sample({ ...at, now: at.now + 60000 }).eligible, true);
  visit.sample({ ...at, now: at.now + 60250, visible: false });
  assert.equal(
    visit.sample({ ...at, x: at.x + 1, now: at.now + 120000 }).eligible,
    false,
  );
  const other = visitLab();
  other.visit.sample({ ...other.at, now: other.at.now + 20, mode: 'orbit' });
  assert.equal(
    other.visit.sample({ ...other.at, now: other.at.now + 50 }).eligible,
    false,
  );
});
test('each live experiment requires the expected stage and correct channels; rewards are idempotent and a reload needs a new visit', () => {
  const { visit, at } = visitLab();
  let save = emptyLightLabSave();
  assert.equal(
    submitLightLab(save, 0, [100, 0, 0], visit, { ...at, now: at.now + 1 }),
    save,
  );
  assert.equal(
    submitLightLab(save, 0, [100, Infinity, 0], visit, {
      ...at,
      now: at.now + 2,
    }),
    save,
  );
  for (let index = 0; index < 3; index++) {
    const next = submitLightLab(save, index, LIGHT_LAB_RECIPES[index], visit, {
      ...at,
      now: at.now + 3 + index,
    });
    assert.equal(next.next, index + 1);
    assert.notEqual(next, save);
    assert.equal(
      submitLightLab(next, index, LIGHT_LAB_RECIPES[index], visit, {
        ...at,
        now: at.now + 3 + index,
      }),
      next,
    );
    save = next;
  }
  assert.deepEqual(readLightLabSave(JSON.stringify(save)), save);
  assert.equal(save.stamped, true);
  const replay = startLightLab(save);
  assert.equal(
    submitLightLab(replay, 0, LIGHT_LAB_RECIPES[0], new LightLabVisit(), at),
    replay,
  );
});
test('lab zone enforces distance even after arrival, preserving a visit only while walking on the interior floor', () => {
  const { visit, at } = visitLab();
  for (let i = 1; i <= 5; i++)
    visit.sample({ ...at, x: at.x + i, now: at.now + i * 250 });
  assert.equal(
    visit.sample({ ...at, x: at.x + 5, now: at.now + 1300 }).eligible,
    false,
  );
  for (let i = 4; i >= 0; i--)
    visit.sample({ ...at, x: at.x + i, now: at.now + 1500 + (4 - i) * 250 });
  assert.equal(visit.sample({ ...at, now: at.now + 2600 }).eligible, true);
});
test('runtime sample requires Science World identity, true walkable floor and correct navigation elevation', () => {
  const city = fixture();
  globalThis.document = { hidden: false };
  try {
    assert.equal(placeLightLabStart(city), true);
    assert.equal(lightLabSample(city, 0).onFloor, true);
    for (const flag of ['disposed', 'contextLost']) {
      city[flag] = true;
      assert.equal(lightLabSample(city, 0).onFloor, false);
      assert.equal(canStartLightLab(city), false);
      city[flag] = false;
    }
    city.navigation.position.y += 1;
    assert.equal(lightLabSample(city, 1).onFloor, false);
    const entry = city.interiors.entry('canada');
    city.navigation.position.set(entry.x, entry.y, entry.z);
    assert.equal(lightLabSample(city, 2).onFloor, false);
  } finally {
    delete globalThis.document;
  }
});
test('display uses additive linear-light channels and safely bounds invalid preview values', () => {
  assert.equal(lightMixtureCSS([100, 100, 0]), 'rgb(255 255 0)');
  assert.equal(lightMixtureCSS([0, 100, 100]), 'rgb(0 255 255)');
  assert.equal(lightMixtureCSS([50, 50, 50]), 'rgb(188 188 188)');
  assert.equal(lightMixtureCSS([NaN, -1, 200]), 'rgb(0 0 255)');
});

test('using the mixer faces the actual exhibit while preserving player position and walking credit', () => {
  const city = fixture();
  const site = city.interiors.sites.find((s) => s.id === 'science');
  const [x, z] = city.interiors.world(site, 14, -17);
  city.navigation.position.set(x, city.interiors.height(x, z) + 1.25, z);
  city.navigation.walkingDistance = 66;
  city.navigation.yaw = -0.86;
  city.navigation.pitch = 0.3;
  const before = city.navigation.position.clone(),
    updates = [];
  city.navigation.update = (dt) => updates.push(dt);
  globalThis.document = { hidden: false };
  try {
    assert.equal(faceLightLabExhibit(city), true);
    const exhibit = city.interiors.world(site, 13, -11);
    assert.equal(
      city.navigation.yaw,
      Math.atan2(exhibit[0] - x, exhibit[1] - z),
    );
    assert.equal(city.navigation.pitch, 0.04);
    assert.equal(city.navigation.snapCamera, true);
    assert.deepEqual(updates, [0]);
    assert(city.navigation.position.equals(before));
    assert.equal(city.navigation.walkingDistance, 66);
    city.navigation.mode = 'orbit';
    assert.equal(faceLightLabExhibit(city), false);
    assert.deepEqual(updates, [0]);
  } finally {
    delete globalThis.document;
  }
});
