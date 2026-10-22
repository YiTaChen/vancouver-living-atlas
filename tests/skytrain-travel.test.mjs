import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getEventListeners } from 'node:events';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainTravel } = await import(cityModule('skytrain-travel'));
const { SkyTrainJourney, SKYTRAIN_STATIONS } = await import(
  cityModule('skytrain-network')
);
const FAST = {
  waitSeconds: 0.1,
  boardingSeconds: 0.1,
  dwellSeconds: 1.6,
  segmentSeconds: () => 0.7,
};
const close = (a, b, tolerance = 1e-6) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const publicRoot = new URL('../public/', import.meta.url);
const sourceFetch = async (url, options = {}) => {
  if (options.signal?.aborted) throw new Error('Aborted request');
  assert.match(
    String(url),
    /^\/models\/(?:skytrain-routes\.json|skytrain-stations\/[a-z-]+\.json)$/,
  );
  const data = fs.readFileSync(
    new URL(String(url).slice(1), publicRoot),
    'utf8',
  );
  return { ok: true, status: 200, json: async () => JSON.parse(data) };
};
class ElementTarget extends EventTarget {
  editable = false;
  dataset = {};
  focusCalls = 0;
  captures = new Set();
  closest() {
    return this.editable ? this : null;
  }
  focus() {
    this.focusCalls++;
  }
  setPointerCapture(id) {
    this.captures.add(id);
  }
}

/** Actual runtime station geometry, floors, route paths, journey and door
 * animation run on the CPU. Only the renderer/city pavement query and the
 * visual cabin GLB acquisition are substituted; no speed or foot pose is set. */
async function harness(action, options = {}) {
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
  const canvas = new ElementTarget(),
    calls = [],
    instances = [];
  replace('window', win);
  replace('document', doc);
  replace('Element', ElementTarget);
  replace('fetch', options.fetch ?? sourceFetch);
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { enabled: true, target: new THREE.Vector3() },
    renderer: { domElement: canvas },
    settings: { mode: 'walk', quality: 'balanced', autoRotate: false },
    compatibleGraphics: false,
    pageSuspended: false,
    transition: null,
    elevation: () => 42,
    closeBusVisit: () => true,
    tesla: { deactivate: () => calls.push(['tesla-deactivate']) },
    flight: { clear: () => calls.push(['flight-clear']) },
    placement: { cancel: () => calls.push(['placement-cancel']) },
    onTravelResume: (mode) => calls.push(['resume', mode]),
    onLocalOrbit: () => calls.push(['orbit']),
    data: { travelSurfaces: { lookup: () => [] } },
    interiors: { height: () => undefined },
    navigation: {
      mode: 'walk',
      position: new THREE.Vector3(),
      walker: { group: new THREE.Group() },
      setMode(mode) {
        this.mode = mode;
      },
      blur: () => calls.push(['nav-clear']),
      clearGround: (x, z, mode, exact) => {
        calls.push(['ground', x, z, mode, exact]);
        return true;
      },
      groundHeight: () => 42,
      startAt(mode, point) {
        this.mode = mode;
        this.position.set(point.x, point.y, point.z);
        this.walker.group.visible = true;
        calls.push(['startAt', mode, { ...point }]);
      },
    },
  };
  const create = () => {
    const travel = new SkyTrainTravel(city);
    instances.push(travel);
    // Keep the real setDoors()/doorsClear/doorsClosed implementation. GLB
    // texture/renderer acquisition is separate from these runtime tests.
    travel.train.load = async (line) => {
      travel.train.line = line;
      travel.train.owner = { group: new THREE.Group() };
      travel.train.doorAmount = 0;
      travel.train.eye.set(
        0,
        line === 'expo' ? 2.6 : 2.75,
        line === 'expo' ? 26.85 : 10.5,
      );
      return true;
    };
    return travel;
  };
  try {
    await action({ city, win, doc, canvas, calls, create });
  } finally {
    instances.forEach((travel) => travel.dispose());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
const tick = async (travel, steps = 1) => {
  for (let i = 0; i < steps; i++) {
    travel.update(0.1);
    await Promise.resolve();
  }
};
const until = async (travel, predicate, limit = 2000) => {
  for (let i = 0; i < limit; i++) {
    if (predicate(travel.snapshot())) return travel.snapshot();
    await tick(travel);
  }
  assert.fail(
    `Runtime did not reach target: ${JSON.stringify(travel.snapshot())}`,
  );
};
function fastJourney(travel) {
  travel.journey = new SkyTrainJourney(
    travel.snapshot().stationId,
    travel.snapshot().destinationId,
    FAST,
  );
}
function key(code, extra = {}) {
  const event = new Event('keydown', { cancelable: true });
  for (const [name, value] of Object.entries({
    code,
    repeat: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  }))
    Object.defineProperty(event, name, { value });
  return event;
}

// A small path search only asks the real station's swept pedestrian resolver.
// It supplies public joystick input to follow the returned walkable route.
function floorPath(owner, from, target, step = 0.75) {
  const queue = [{ point: from, previous: -1 }],
    seen = new Set(['0,0']);
  const origin = from.position,
    limit = 12000 * Math.max(1, (0.75 / step) ** 2);
  for (let index = 0; index < queue.length && index < limit; index++) {
    const item = queue[index],
      p = item.point.position;
    if (
      Math.hypot(p[0] - target[0], p[2] - target[2]) <
        Math.min(0.95, step * 1.2) &&
      Math.abs(p[1] - target[1]) < 0.3
    ) {
      const result = [];
      let n = index;
      while (n >= 0) {
        result.unshift(queue[n].point.position);
        n = queue[n].previous;
      }
      return result;
    }
    for (const [x, z] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const next = owner.walk(item.point, x * step, z * step),
        v = next.position;
      if (Math.hypot(v[0] - p[0] - x * step, v[2] - p[2] - z * step) > 0.02)
        continue;
      const id = `${Math.round((v[0] - origin[0]) / step)},${Math.round((v[2] - origin[2]) / step)},${next.layer}`;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push({ point: next, previous: index });
    }
  }
  assert.fail(
    `No real walkable station route ${owner.data.id}: ${from.position} → ${target}; searched ${queue.length}, surfaces ${[...new Set(queue.map((entry) => entry.point.surfaceId))].join(',')}`,
  );
}
async function walkTo(travel, point, step = 0.75) {
  const targets = floorPath(travel.owner, travel.foot, point, step);
  for (const target of targets.slice(1)) {
    let reached = false;
    for (let i = 0; i < 80; i++) {
      const p = travel.foot.position,
        dx = target[0] - p[0],
        dz = target[2] - p[2];
      if (Math.hypot(dx, dz) < Math.min(0.26, step * 0.45)) {
        reached = true;
        break;
      }
      const heading = Math.atan2(dx, dz);
      const error = Math.atan2(
        Math.sin(heading - travel.yaw),
        Math.cos(heading - travel.yaw),
      );
      const turn = THREE.MathUtils.clamp(-error / 0.165, -1, 1);
      travel.setTouchAxes(
        turn,
        Math.abs(error) < 0.04 ? Math.min(1, Math.hypot(dx, dz) / 0.25) : 0,
      );
      await tick(travel);
    }
    assert(
      reached,
      `Public walking input stalled at ${travel.owner.data.id}: ${travel.foot.position} → ${target}`,
    );
  }
  travel.setTouchAxes(0, 0);
}
async function toBoardingDoor(travel) {
  if (travel.snapshot().level === 'concourse')
    assert.equal(await travel.goPlatform(), true);
  await walkTo(
    travel,
    travel.owner.boardingPoint(travel.line, travel.direction).position,
  );
  return until(travel, (snapshot) => snapshot.canBoard);
}

test('all seven actual station interiors enter, walk on owned floors and return to freshly checked street ground', async () => {
  await harness(async ({ create, city, calls }) => {
    const travel = create();
    for (const station of SKYTRAIN_STATIONS) {
      assert.equal(await travel.enter(station.id), true, station.id);
      const s = travel.snapshot();
      assert.equal(s.phase, 'station');
      assert.equal(s.level, 'concourse');
      assert.equal(s.stationId, station.id);
      assert(travel.owner.floorAt(travel.foot.position, travel.foot.surfaceId));
      const before = [...travel.foot.position];
      travel.setTouchAxes(0, 1);
      await tick(travel);
      travel.setTouchAxes(0, 0);
      assert(travel.owner.floorAt(travel.foot.position, travel.foot.surfaceId));
      assert(
        Math.hypot(
          travel.foot.position[0] - before[0],
          travel.foot.position[2] - before[2],
        ) <= 0.251,
      );
      assert.equal(travel.snapshot().canExit, true);
      assert.equal(travel.leave(), true);
      const returned = calls.filter((call) => call[0] === 'startAt').at(-1);
      assert.equal(returned[1], 'walk');
      assert.equal(returned[2].surfaceId, 'ground');
      assert.equal(returned[2].layer, 0);
      close(returned[2].y, 42);
      assert.equal(city.navigation.walker.group.visible, true);
      assert.equal(travel.train.group.visible, false);
      assert.equal(travel.snapshot().phase, 'idle');
    }
    assert(
      calls
        .filter((call) => call[0] === 'ground')
        .every((call) => call[3] === 'walk' && call[4] === true),
    );
  });
});

test('real platform walking reaches a stopped doorway; concourse, distance and closed doors reject boarding', async () => {
  await harness(async ({ create }) => {
    for (const id of [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
      'vancouver-city-centre',
      'yaletown-roundhouse',
    ]) {
      const travel = create();
      assert.equal(await travel.enter(id), true);
      fastJourney(travel);
      await tick(travel, 12);
      assert.equal(travel.board(), false, `${id}: concourse cannot board`);
      assert.equal(await travel.goPlatform(), true);
      const access = travel.foot.position,
        door = travel.owner.boardingPoint(
          travel.line,
          travel.direction,
        ).position;
      if (Math.hypot(access[0] - door[0], access[2] - door[2]) > 2)
        assert.equal(
          travel.board(),
          false,
          `${id}: distant platform cannot board`,
        );
      await walkTo(travel, door);
      await until(travel, (s) => s.canBoard);
      travel.train.setDoors(
        false,
        travel.owner.trainStop(travel.line, travel.direction).doorSide,
        0.1,
      );
      assert.equal(
        travel.board(),
        false,
        `${id}: physically closing door rejects board`,
      );
      await until(travel, (s) => s.canBoard);
      assert.equal(travel.board(), true, id);
      assert.equal(travel.snapshot().phase, 'riding');
      assert.equal(travel.leave(), false);
      travel.dispose();
    }
  });
});

test('physical boarding and alighting require the loaded train on the selected station stop and body frame', async () => {
  await harness(async ({ create }) => {
    const travel = create();
    assert.equal(await travel.enter('waterfront'), true);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.snapshot().canBoard, true);
    const position = travel.train.group.position.clone(),
      quaternion = travel.train.group.quaternion.clone(),
      line = travel.train.line;

    travel.train.group.position.x += 30;
    travel.train.group.updateMatrixWorld(true);
    assert.equal(
      travel.snapshot().canBoard,
      false,
      'a distant train cannot board',
    );
    assert.equal(travel.board(), false);
    travel.train.group.position.copy(position);

    travel.train.group.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4),
    );
    travel.train.group.updateMatrixWorld(true);
    assert.equal(
      travel.snapshot().canBoard,
      false,
      'the wrong body frame cannot board',
    );
    assert.equal(travel.board(), false);
    travel.train.group.quaternion.copy(quaternion);
    travel.train.group.updateMatrixWorld(true);

    travel.train.line = 'canada';
    assert.equal(
      travel.snapshot().canBoard,
      false,
      'another loaded line cannot board',
    );
    assert.equal(travel.board(), false);
    travel.train.line = line;
    assert.equal(travel.snapshot().canBoard, true);
    assert.equal(travel.board(), true);

    await until(
      travel,
      (s) => s.canAlight && s.stationId === 'main-street-science-world',
    );
    const destinationPosition = travel.train.group.position.clone(),
      destinationQuaternion = travel.train.group.quaternion.clone();
    travel.train.group.position.x += 30;
    travel.train.group.updateMatrixWorld(true);
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'a distant train cannot alight',
    );
    assert.equal(travel.alight(), false);
    travel.train.group.position.copy(destinationPosition);

    travel.train.group.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4),
    );
    travel.train.group.updateMatrixWorld(true);
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'the wrong body frame cannot alight',
    );
    assert.equal(travel.alight(), false);
    travel.train.group.quaternion.copy(destinationQuaternion);
    travel.train.group.updateMatrixWorld(true);

    travel.train.line = 'canada';
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'another loaded line cannot alight',
    );
    assert.equal(travel.alight(), false);
    travel.train.line = line;
    assert.equal(travel.snapshot().canAlight, true);
    assert.equal(travel.alight(), true);
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', travel.line, travel.direction)
        .position,
    );
    assert.equal(travel.goConcourse(), true);
    assert.equal(travel.leave(), true);
  });
});

test('passenger travels through all actual Expo stops, cannot leave while moving, and alights on the destination floor', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    assert.equal(await travel.enter('waterfront'), true);
    travel.chooseDestination('main-street-science-world');
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    const stops = [],
      positions = [];
    for (let i = 0; i < 1000; i++) {
      await tick(travel);
      const j = travel.journey.snapshot(),
        s = travel.snapshot();
      if (j.phase === 'riding') {
        positions.push(travel.train.group.position.clone());
        assert.equal(travel.alight(), false);
        assert.equal(travel.leave(), false);
        assert.equal(travel.chooseDestination('burrard'), false);
        assert.equal(s.canExit, false);
      }
      if (s.canAlight && stops.at(-1) !== s.stationId) stops.push(s.stationId);
      if (s.canAlight && s.stationId === 'main-street-science-world') break;
    }
    assert.deepEqual(stops, [
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
    ]);
    assert(positions.length > 12);
    assert(
      positions.some((p) => p.distanceTo(positions[0]) > 50),
      'the real train frame traverses geographic distance',
    );
    assert.equal(travel.alight(), true);
    assert.equal(travel.snapshot().level, 'platform');
    assert.equal(travel.owner.data.id, 'main-street-science-world');
    assert(travel.owner.floorAt(travel.foot.position, travel.foot.surfaceId));
    assert.equal(
      travel.leave(),
      false,
      'platform cannot exit directly to street',
    );
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', travel.line, travel.direction)
        .position,
    );
    assert.equal(travel.goConcourse(), true);
    assert.equal(travel.leave(), true);
    assert.equal(city.navigation.mode, 'walk');
  });
});

test('Waterfront transfer requires alighting, walking through access and changing platforms before Canada Line boarding', async () => {
  await harness(async ({ create }) => {
    const travel = create();
    assert.equal(await travel.enter('burrard'), true);
    assert.equal(travel.chooseDestination('yaletown-roundhouse'), true);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, (s) => s.canAlight && s.stationId === 'waterfront');
    assert.equal(travel.journey.snapshot().transferRequired, true);
    assert.equal(travel.alight(), true);
    assert.equal(travel.snapshot().plannedLineId, 'canada');
    assert.equal(travel.snapshot().lineId, 'expo');
    await tick(travel, 20);
    assert.equal(travel.board(), false);
    assert.equal(
      await travel.goPlatform(),
      false,
      'cannot switch lines directly from an Expo platform',
    );
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', 'expo', travel.direction).position,
    );
    assert.equal(travel.goConcourse(), true);
    assert.equal(await travel.goPlatform(), true);
    assert.equal(travel.snapshot().lineId, 'canada');
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    const stops = [];
    for (let i = 0; i < 400; i++) {
      await tick(travel);
      const s = travel.snapshot();
      if (s.canAlight && stops.at(-1) !== s.stationId) stops.push(s.stationId);
      if (s.canAlight && s.stationId === 'yaletown-roundhouse') break;
    }
    assert.deepEqual(stops, ['vancouver-city-centre', 'yaletown-roundhouse']);
    assert.equal(travel.alight(), true);
    assert.equal(travel.owner.data.id, 'yaletown-roundhouse');
  });
});

test('walking continuously to the other Waterfront line cannot bypass loading its actual train before boarding', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    assert.equal(await travel.enter('waterfront'), true);
    assert.equal(travel.train.serviceLine, 'expo');
    await walkTo(travel, travel.owner.entry('canada', 'southbound').position);
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', 'canada', 'southbound').position,
      0.25,
    );
    assert.equal(
      travel.snapshot().lineId,
      'canada',
      'public floor walking updates the passenger platform',
    );
    assert.equal(travel.snapshot().level, 'platform');
    assert.equal(
      travel.train.serviceLine,
      'expo',
      'walking alone does not swap the loaded service',
    );
    assert.equal(travel.chooseDestination('yaletown-roundhouse'), true);
    fastJourney(travel);
    assert.equal(travel.board(), false);
    assert.equal(
      await travel.goPlatform(),
      false,
      'a train change still requires returning to the concourse',
    );
    assert.equal(travel.train.serviceLine, 'expo');
    assert.equal(travel.goConcourse(), true);
    let compiled = 0;
    city.renderer.compileAsync = async (group, camera, scene) => {
      assert.equal(group, travel.train.group);
      assert.equal(camera, city.camera);
      assert.equal(scene, city.scene);
      assert.equal(travel.snapshot().busy, true);
      compiled++;
    };
    assert.equal(await travel.goPlatform(), true);
    assert.equal(travel.train.serviceLine, 'canada');
    assert.equal(travel.train.ready, true);
    assert.equal(
      compiled,
      1,
      'the newly loaded service is prepared before input resumes',
    );
    await toBoardingDoor(travel);
    assert.equal(travel.snapshot().canBoard, true);
    assert.equal(travel.board(), true);
    assert.equal(travel.snapshot().phase, 'riding');
  });
});

test('reverse Expo service serves the real stacked-platform sequence and opens the current platform side', async () => {
  await harness(async ({ create }) => {
    const travel = create();
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.equal(travel.chooseDestination('waterfront'), true);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    const stops = [];
    for (let i = 0; i < 1000; i++) {
      await tick(travel);
      const s = travel.snapshot();
      if (!s.canAlight) continue;
      const stop = travel.owner.trainStop(travel.line, travel.direction);
      assert.equal(travel.train.side, stop.doorSide);
      const expected = travel.owner.toWorld(stop.position);
      travel.train.group.position
        .toArray()
        .forEach((v, i) => close(v, expected[i]));
      if (stops.at(-1) !== s.stationId) stops.push(s.stationId);
      if (s.stationId === 'waterfront') break;
    }
    assert.deepEqual(stops, [
      'stadium-chinatown',
      'granville',
      'burrard',
      'waterfront',
    ]);
    assert.equal(travel.alight(), true);
    assert.equal(
      travel.foot.surfaceId,
      travel.owner.platform('expo', 'westbound').surfaceId,
    );
  });
});

test('street exit fails closed when city pavement is obstructed, under a protected deck or lacks finite ground height', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    assert.equal(await travel.enter('granville'), true);
    const clear = city.navigation.clearGround;
    city.navigation.clearGround = () => false;
    assert.equal(travel.snapshot().canExit, false);
    assert.equal(travel.leave(), false);
    city.navigation.clearGround = clear;
    city.data.travelSurfaces.lookup = () => [
      { surfaceId: 'bridge-road', layer: 2 },
    ];
    assert.equal(travel.leave(), false);
    city.data.travelSurfaces.lookup = () => [];
    city.interiors.height = () => 50;
    assert.equal(travel.leave(), false);
    city.interiors.height = () => undefined;
    city.navigation.groundHeight = () => NaN;
    assert.equal(travel.leave(), false);
    city.navigation.groundHeight = () => 42;
    assert.equal(travel.leave(), true);
  });
});

test('continuous public walking up real stairs updates the passenger level and permits a street exit', async () => {
  await harness(async ({ create }) => {
    const travel = create();
    assert.equal(await travel.enter('burrard'), true);
    assert.equal(await travel.goPlatform(), true);
    await walkTo(
      travel,
      travel.owner.entry(travel.line, travel.direction).position,
    );
    assert.equal(travel.snapshot().level, 'concourse');
    assert.equal(travel.snapshot().canExit, true);
    assert.equal(travel.leave(), true);
  });
});

test('keyboard, mobile axes, blur and visibility operate on the same floor and resumed tabs cannot skip movement', async () => {
  await harness(async ({ create, win, doc }) => {
    const travel = create();
    assert.equal(await travel.enter('burrard'), true);
    const before = [...travel.foot.position];
    win.dispatchEvent(key('KeyW'));
    await tick(travel);
    assert(
      Math.hypot(
        travel.foot.position[0] - before[0],
        travel.foot.position[2] - before[2],
      ) <= 0.251,
    );
    win.dispatchEvent(new Event('blur'));
    const afterBlur = [...travel.foot.position];
    await tick(travel, 5);
    assert.deepEqual(travel.foot.position, afterBlur);
    travel.setTouchAxes(1, 1);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    const paused = travel.journey.snapshot();
    await tick(travel, 10);
    assert.deepEqual(travel.journey.snapshot(), paused);
    doc.hidden = false;
    await tick(travel);
    assert.deepEqual(travel.foot.position, afterBlur);
    const y = travel.yaw;
    travel.setTouchAxes(NaN, Infinity);
    await tick(travel);
    close(travel.yaw, y);
    travel.setInputEnabled(false);
    travel.setTouchAxes(0, 1);
    await tick(travel);
    assert.deepEqual(travel.foot.position, afterBlur);
    travel.setInputEnabled(true);
    const input = new ElementTarget();
    input.editable = true;
    travel.keyDown(key('KeyW', { target: input }));
    await tick(travel);
    assert.deepEqual(
      travel.foot.position,
      afterBlur,
      'typing cannot walk the passenger',
    );
    travel.setTouchAxes(0, 1);
    const start = [...travel.foot.position];
    travel.update(50);
    assert(
      Math.hypot(
        travel.foot.position[0] - start[0],
        travel.foot.position[2] - start[2],
      ) <= 0.251,
    );
  });
});

test('canvas look restores keyboard focus after a destination dropdown without stealing focus while controls are disabled', async () => {
  await harness(async ({ create, win, canvas }) => {
    const travel = create();
    assert.equal(await travel.enter('burrard'), true);
    const input = new ElementTarget();
    input.editable = true;
    const before = [...travel.foot.position];
    win.dispatchEvent(key('KeyW', { target: input }));
    win.dispatchEvent(key('KeyE', { target: input }));
    await tick(travel);
    assert.deepEqual(travel.foot.position, before);
    assert.equal(travel.snapshot().level, 'concourse');
    const pointer = (type, pointerId) => {
      const event = new Event(type, { cancelable: true });
      for (const [name, value] of Object.entries({
        pointerId,
        button: 0,
        clientX: 100,
        clientY: 100,
      }))
        Object.defineProperty(event, name, { value });
      return event;
    };
    const focused = canvas.focusCalls;
    canvas.dispatchEvent(pointer('pointerdown', 1));
    assert.equal(canvas.focusCalls, focused + 1);
    assert.equal(canvas.captures.has(1), true);
    canvas.dispatchEvent(pointer('pointerup', 1));
    win.dispatchEvent(key('KeyW', { target: canvas }));
    await tick(travel);
    assert(
      Math.hypot(...travel.foot.position.map((v, i) => v - before[i])) > 0.01,
      'walking resumes after the scene has recovered focus',
    );
    travel.clearInput();
    travel.setInputEnabled(false);
    canvas.dispatchEvent(pointer('pointerdown', 2));
    assert.equal(canvas.focusCalls, focused + 1);
    assert.equal(canvas.captures.has(2), false);
    win.dispatchEvent(key('KeyW', { target: canvas }));
    const disabledPosition = [...travel.foot.position];
    await tick(travel);
    assert.deepEqual(travel.foot.position, disabledPosition);
  });
});

test('entry waits for the loaded train subtree precompile before exposing station input or boarding', async () => {
  await harness(async ({ create, city, canvas, win }) => {
    const travel = create();
    let completeCompile, compileReached;
    const compilation = new Promise((resolve) => {
      completeCompile = resolve;
    });
    const reached = new Promise((resolve) => {
      compileReached = resolve;
    });
    let compiled;
    city.renderer.compileAsync = (...args) => {
      compiled = args;
      compileReached();
      return compilation;
    };
    const pending = travel.enter('waterfront');
    await reached;
    assert.equal(
      compiled[0],
      travel.train.group,
      'only the loaded consist is prepared',
    );
    assert.equal(compiled[1], city.camera);
    assert.equal(
      compiled[2],
      city.scene,
      'the city lighting is the compile target',
    );
    assert.equal(travel.snapshot().phase, 'loading');
    assert.equal(travel.snapshot().busy, true);
    assert.equal(travel.snapshot().canBoard, false);
    assert.equal(travel.board(), false);
    assert.equal(travel.alight(), false);
    assert.equal(travel.leave(), false);
    assert.equal(canvas.focusCalls, 0);
    const position = [...travel.foot.position];
    const journey = travel.journey.snapshot();
    win.dispatchEvent(key('KeyW', { target: canvas }));
    await tick(travel, 5);
    assert.deepEqual(travel.foot.position, position);
    assert.deepEqual(travel.journey.snapshot(), journey);
    completeCompile();
    assert.equal(await pending, true);
    assert.equal(travel.snapshot().phase, 'station');
    assert.equal(travel.snapshot().busy, false);
    assert.equal(canvas.focusCalls, 1);
  });
});

test('a deferred line-change precompile keeps the passenger in the concourse until the new train is ready', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    assert.equal(await travel.enter('waterfront'), true);
    assert.equal(travel.chooseDestination('yaletown-roundhouse'), true);
    let completeCompile, compileReached;
    const compilation = new Promise((resolve) => {
      completeCompile = resolve;
    });
    const reached = new Promise((resolve) => {
      compileReached = resolve;
    });
    city.renderer.compileAsync = () => {
      compileReached();
      return compilation;
    };
    const pending = travel.goPlatform();
    await reached;
    assert.equal(travel.snapshot().phase, 'station');
    assert.equal(travel.snapshot().level, 'concourse');
    assert.equal(travel.snapshot().busy, true);
    assert.equal(travel.snapshot().canBoard, false);
    assert.equal(travel.board(), false);
    assert.equal(travel.leave(), false);
    completeCompile();
    assert.equal(await pending, true);
    assert.equal(travel.snapshot().busy, false);
    assert.equal(travel.snapshot().level, 'platform');
    assert.equal(travel.snapshot().lineId, 'canada');
  });
});

test('disposing a pending entry precompile cannot restore the passenger or publish a ready station', async () => {
  await harness(async ({ create, city, canvas, win, doc }) => {
    const travel = create();
    let changes = 0;
    travel.onChange = () => changes++;
    let completeCompile, compileReached;
    const compilation = new Promise((resolve) => {
      completeCompile = resolve;
    });
    const reached = new Promise((resolve) => {
      compileReached = resolve;
    });
    city.renderer.compileAsync = () => {
      compileReached();
      return compilation;
    };
    const pending = travel.enter('waterfront');
    await reached;
    const beforeDispose = changes;
    travel.dispose();
    completeCompile();
    assert.equal(await pending, false);
    assert.equal(changes, beforeDispose);
    assert.notEqual(travel.snapshot().phase, 'station');
    assert.equal(canvas.focusCalls, 0);
    assert.equal(travel.stations.active, null);
    assert.equal(travel.train.ready, false);
    assert.equal(travel.train.group.parent, null);
    assert.equal(getEventListeners(win, 'keydown').length, 0);
    assert.equal(getEventListeners(doc, 'visibilitychange').length, 0);
    assert.equal(getEventListeners(canvas, 'pointerdown').length, 0);
  });
});

test('the bounded source station replacement enables only at Main Street and clears on another station, street exit and disposal', async () => {
  await harness(async ({ create, city }) => {
    const uniform = { value: new THREE.Vector4(-1, 0, 0, 0) };
    city.uniforms = { skyTrainReplacement: uniform };
    const profile = Object.freeze({ seed: 783 });
    city.data.buildingProfiles = new Map([['osm-structure-303', profile]]);
    const travel = create();
    assert.equal(travel.chooseDestination('stadium-chinatown'), true);
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.deepEqual(uniform.value.toArray(), [
      783,
      travel.owner.origin[0],
      travel.owner.origin[2],
      170,
    ]);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(
      travel,
      (s) => s.stationId === 'stadium-chinatown' && s.canAlight,
    );
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assert.equal(travel.alight(), true);
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', travel.line, travel.direction)
        .position,
    );
    assert.equal(travel.goConcourse(), true);
    assert.equal(travel.leave(), true);
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    for (const station of SKYTRAIN_STATIONS.filter(
      (s) => s.id !== 'main-street-science-world',
    )) {
      assert.equal(await travel.enter(station.id), true);
      assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
      assert.equal(travel.leave(), true);
    }
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.equal(uniform.value.w, 170);
    assert.equal(travel.leave(), true);
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.equal(uniform.value.w, 170);
    travel.dispose();
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assert.equal(city.data.buildingProfiles.get('osm-structure-303'), profile);
    assert.deepEqual(profile, { seed: 783 });
  });
});

test('failed Main Street entry clears the replacement uniform after it was enabled during train preparation', async () => {
  await harness(async ({ create, city }) => {
    const uniform = { value: new THREE.Vector4(-1, 0, 0, 0) };
    city.uniforms = { skyTrainReplacement: uniform };
    city.data.buildingProfiles = new Map([
      ['osm-structure-303', { seed: 783 }],
    ]);
    city.renderer.compileAsync = async () => {
      assert.equal(uniform.value.w, 170);
      throw new Error('recorded train preparation failure');
    };
    const travel = create();
    assert.equal(await travel.enter('main-street-science-world'), false);
    assert.equal(travel.snapshot().phase, 'error');
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
  });
});

test('disposed or superseded asynchronous entry never republishes a station, restores input or retains listeners', async () => {
  let release;
  await harness(
    async ({ create, win, doc, canvas }) => {
      const travel = create();
      let changes = 0;
      travel.onChange = () => changes++;
      const pending = travel.enter('waterfront');
      await Promise.resolve();
      const initialChanges = changes;
      travel.dispose();
      release();
      assert.equal(await pending, false);
      assert.equal(changes, initialChanges);
      assert.equal(travel.train.group.parent, null);
      assert.equal(travel.stations.active, null);
      assert.equal(getEventListeners(win, 'keydown').length, 0);
      assert.equal(getEventListeners(win, 'keyup').length, 0);
      assert.equal(getEventListeners(win, 'blur').length, 0);
      assert.equal(getEventListeners(doc, 'visibilitychange').length, 0);
      for (const name of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ])
        assert.equal(getEventListeners(canvas, name).length, 0);
      assert.equal(await travel.enter('granville'), false);
    },
    {
      fetch: async (url, options) => {
        if (String(url) === '/models/skytrain-routes.json')
          await new Promise((resolve) => {
            release = resolve;
          });
        return sourceFetch(url, { ...options, signal: undefined });
      },
    },
  );
});

test('an incomplete duplicate geographic route inventory is rejected before a passenger can enter', async () => {
  await harness(
    async ({ create }) => {
      const travel = create();
      assert.equal(await travel.enter('waterfront'), false);
      assert.equal(travel.snapshot().phase, 'error');
      assert.equal(travel.train.group.visible, false);
    },
    {
      fetch: async (url, options) => {
        const response = await sourceFetch(url, options);
        if (String(url) !== '/models/skytrain-routes.json') return response;
        const routes = await response.json();
        return {
          ...response,
          json: async () => ({
            ...routes,
            segments: routes.segments.map(() =>
              structuredClone(routes.segments[0]),
            ),
          }),
        };
      },
    },
  );
});
