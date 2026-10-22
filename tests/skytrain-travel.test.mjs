import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getEventListeners } from 'node:events';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { actualTrain } from './helpers/skytrain-geometry.mjs';

const { SkyTrainTravel } = await import(cityModule('skytrain-travel'));
const { CityInteractions, projectInteractionAnchor } = await import(
  cityModule('city-interactions')
);
const { createSkyTrainGuidewayUniforms } = await import(
  cityModule('skytrain-guideway-clearance')
);
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
    elevation: cityElevation,
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
      groundHeight: cityElevation,
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
      close(returned[2].y, cityElevation(returned[2].x, returned[2].z));
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

test('the controller camera follows the occupied articulated car and reports physical curve speed before restoring the exact stopped consist', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    travel.chooseDestination('burrard');
    assert.equal(await travel.enter('waterfront'), true);
    close(travel.speedMps, 0);
    travel.journey = new SkyTrainJourney('waterfront', 'burrard', {
      ...FAST,
      segmentSeconds: () => 4,
    });
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, () => travel.journey.snapshot().phase === 'riding');
    close(travel.journey.snapshot().linearProgress, 0);
    await tick(travel, 20);
    const j = travel.journey.snapshot(),
      path = travel.paths.get('expo:waterfront:burrard');
    close(j.linearProgress, 0.5);
    close(travel.speedMps, (path.length / j.segmentSeconds) * 1.875);
    close(travel.snapshot().speedMps, travel.speedMps);
    assert.equal(travel.train.stationAligned, false);
    const eye = new THREE.Vector3(),
      orientation = new THREE.Quaternion();
    travel.train.passengerWorldPose(eye, orientation);
    assert(city.camera.position.distanceTo(eye) < 1e-6);
    const yaw =
      new THREE.Euler().setFromQuaternion(orientation, 'YXZ').y +
      travel.train.facingYaw;
    const facing = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(-0.03),
      Math.sin(-0.03),
      Math.cos(yaw) * Math.cos(-0.03),
    );
    assert(
      city.camera.getWorldDirection(new THREE.Vector3()).distanceTo(facing) <
        1e-6,
    );
    assert.equal(travel.alight(), false);
    await until(travel, (s) => s.canAlight && s.stationId === 'burrard');
    close(travel.speedMps, 0);
    assert.equal(travel.train.stationAligned, true);
    for (let i = 0; i < travel.train.carFrames.length; i++) {
      assert(
        travel.train.carFrames[i].position.distanceTo(
          new THREE.Vector3(0, 0, [26.85, 8.95, -8.95, -26.85][i]),
        ) < 1e-9,
      );
      assert(
        travel.train.carFrames[i].quaternion.angleTo(new THREE.Quaternion()) <
          1e-9,
      );
    }
    assert.equal(travel.alight(), true);
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

test('the actual Canada Line travel tube overlaps both station buffers without entering the platform envelope', async () => {
  await harness(async ({ create }) => {
    const travel = create();
    travel.chooseDestination('vancouver-city-centre');
    assert.equal(await travel.enter('waterfront'), true);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(
      travel,
      () =>
        travel.journey.snapshot().phase === 'riding' && Boolean(travel.tube),
    );
    const path = travel.paths.get('canada:waterfront:vancouver-city-centre');
    const tubes = travel.tube.children.filter(
      (mesh) => mesh.geometry instanceof THREE.TubeGeometry,
    );
    assert.equal(
      tubes.length,
      1,
      'the actual terrain-constrained underground route has a continuous travel tube',
    );
    const tube = tubes[0].geometry.parameters.path;
    const start = tube.getPoint(0).sub(new THREE.Vector3(0, 1.4, 0));
    const end = tube.getPoint(1).sub(new THREE.Vector3(0, 1.4, 0));
    const sourceAxis = new THREE.Vector3(
      0,
      0,
      path.start.motionSign,
    ).applyQuaternion(path.start.quaternion);
    const destinationAxis = new THREE.Vector3(
      0,
      0,
      path.end.motionSign,
    ).applyQuaternion(path.end.quaternion);
    const sourceDistance = start
      .clone()
      .sub(path.start.position)
      .dot(sourceAxis);
    const destinationDistance = path.end.position
      .clone()
      .sub(end)
      .dot(destinationAxis);
    for (const [name, distance] of [
      ['source', sourceDistance],
      ['destination', destinationDistance],
    ]) {
      assert(
        distance >= 32 && distance <= 40.1,
        `${name} first tube centre is ${distance}m along the actual station axis`,
      );
      assert(
        distance > 22,
        `${name} travel tube starts outside the Canada platform half-length`,
      );
      assert(
        distance < 47,
        `${name} travel tube overlaps the authored47m station buffer`,
      );
    }
    assert(
      [...tubes[0].geometry.attributes.position.array].every(Number.isFinite),
    );
  });
});

test('the single destination station is visible and compiled before the untubed approach and is reused only after arrival', async () => {
  for (const [from, destination] of [
    ['waterfront', 'burrard'],
    ['stadium-chinatown', 'main-street-science-world'],
  ])
    await harness(async ({ create, city }) => {
      city.uniforms = {
        skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
        ...createSkyTrainGuidewayUniforms(),
      };
      city.data.buildingProfiles = new Map([
        ['osm-structure-303', { seed: 783 }],
        ['133436', { seed: 967 }],
      ]);
      const travel = create();
      travel.chooseDestination(destination);
      assert.equal(await travel.enter(from), true);
      const source = travel.owner;
      const load = travel.stations.load.bind(travel.stations),
        loads = [];
      travel.stations.load = (...args) => {
        loads.push(args[0]);
        return load(...args);
      };
      const compiled = [];
      city.renderer.compileAsync = async (scene, camera, target) => {
        compiled.push(scene);
        assert.equal(camera, city.camera);
        assert.equal(scene, city.scene);
        assert.equal(target, undefined);
        assert.equal(travel.owner.group.visible, true);
      };
      travel.journey = new SkyTrainJourney(from, destination, {
        ...FAST,
        segmentSeconds: () => 6,
      });
      await toBoardingDoor(travel);
      assert.equal(travel.board(), true);
      await until(
        travel,
        () =>
          travel.owner.data.id === destination &&
          travel.journey.snapshot().phase === 'riding',
      );
      const prepared = travel.owner;
      const path = travel.paths.get(`expo:${from}:${destination}`);
      assert.equal(prepared.group.visible, true);
      assert.equal(travel.stations.active, prepared);
      assert.equal(
        source.group.parent,
        null,
        'the departed owner was released',
      );
      assert.equal(
        city.scene.children.filter((o) =>
          o.name.startsWith('skytrain-station-'),
        ).length,
        1,
      );
      assert(
        travel.train.group.position.distanceTo(path.end.position) >
          45 + travel.train.carOffset,
      );
      assert.equal(travel.snapshot().stationId, from);
      assert.equal(travel.snapshot().busy, false);
      assert.equal(travel.alight(), false);
      assert.equal(travel.leave(), false);
      if (destination === 'main-street-science-world') {
        assert.equal(city.uniforms.skyTrainReplacement.value.w, 170);
        assert.equal(city.uniforms.skyTrainGuidewayHeight.value.w, 1);
        assert.equal(city.uniforms.skyTrainGuidewayHeight.value.x, 967);
      }
      await until(
        travel,
        () =>
          travel.journey.snapshot().phase === 'riding' &&
          travel.journey.snapshot().progress > 0.98,
      );
      assert.equal(
        prepared.group.visible,
        true,
        'the destination remains visible inside the untubed final approach',
      );
      assert.equal(
        travel.snapshot().stationId,
        from,
        'visible station geometry is not an early passenger arrival',
      );
      assert.equal(travel.alight(), false);
      await until(travel, (s) => s.canAlight && s.stationId === destination);
      assert.equal(travel.owner, prepared);
      assert.deepEqual(loads, [destination]);
      assert.deepEqual(compiled, [city.scene]);
      assert(travel.train.group.position.distanceTo(path.end.position) < 1e-6);
    });
});

test('a pending destination compile permits path movement but holds the arrived train with closed doors until its owner is ready', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    travel.chooseDestination('burrard');
    assert.equal(await travel.enter('waterfront'), true);
    let finish, reached;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const compiling = new Promise((resolve) => {
      reached = resolve;
    });
    city.renderer.compileAsync = () => {
      reached();
      return pending;
    };
    travel.journey = new SkyTrainJourney('waterfront', 'burrard', {
      ...FAST,
      segmentSeconds: () => 3,
    });
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, () => travel.owner.data.id === 'burrard');
    await compiling;
    const prepared = travel.owner,
      before = travel.train.group.position.clone();
    assert.equal(prepared.group.visible, false);
    assert.equal(travel.snapshot().busy, false);
    await tick(travel, 3);
    assert(travel.train.group.position.distanceTo(before) > 1);
    assert.equal(prepared.group.visible, false);
    assert.equal(travel.alight(), false);
    await until(
      travel,
      (s) => s.busy && travel.journey.snapshot().phase === 'arrived',
    );
    const held = travel.train.group.position.clone(),
      journey = travel.journey.snapshot();
    await tick(travel, 5);
    assert(travel.train.group.position.distanceTo(held) < 1e-9);
    assert.deepEqual(travel.journey.snapshot(), journey);
    assert.equal(travel.snapshot().stationId, 'waterfront');
    assert.equal(travel.snapshot().doorsOpen, false);
    assert.equal(prepared.group.visible, false);
    assert.equal(travel.alight(), false);
    assert.equal(travel.leave(), false);
    finish();
    await until(travel, (s) => s.canAlight && s.stationId === 'burrard');
    assert.equal(travel.owner, prepared);
    assert.equal(prepared.group.visible, true);
  });
});

test('disposing an approaching station during its pending compile cannot republish or reactivate the late owner', async () => {
  await harness(async ({ create, city, win, doc, canvas }) => {
    city.uniforms = {
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
      ...createSkyTrainGuidewayUniforms(),
    };
    city.data.buildingProfiles = new Map([
      ['osm-structure-303', { seed: 783 }],
      ['133436', { seed: 967 }],
    ]);
    const travel = create();
    travel.chooseDestination('main-street-science-world');
    assert.equal(await travel.enter('stadium-chinatown'), true);
    let finish;
    city.renderer.compileAsync = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, () => Boolean(finish));
    const prepared = travel.owner;
    assert.equal(prepared.data.id, 'main-street-science-world');
    assert.equal(city.uniforms.skyTrainGuidewayHeight.value.w, 1);
    let changes = 0;
    travel.onChange = () => changes++;
    travel.dispose();
    const before = changes;
    finish();
    await Promise.resolve();
    await Promise.resolve();
    await tick(travel, 5);
    assert.equal(changes, before);
    assert.equal(travel.snapshot().phase, 'idle');
    assert.equal(travel.snapshot().canAlight, false);
    assert.deepEqual(
      city.uniforms.skyTrainGuidewayHeight.value.toArray(),
      [-1, 0, 0, 0],
    );
    assert.deepEqual(
      city.uniforms.skyTrainReplacement.value.toArray(),
      [-1, 0, 0, 0],
    );
    assert.equal(travel.stations.active, null);
    assert.equal(prepared.group.parent, null);
    assert.equal(travel.train.group.parent, null);
    assert.equal(
      city.scene.children.filter((o) => o.name.startsWith('skytrain-station-'))
        .length,
      0,
    );
    assert.equal(getEventListeners(win, 'keydown').length, 0);
    assert.equal(getEventListeners(doc, 'visibilitychange').length, 0);
    assert.equal(getEventListeners(canvas, 'pointerdown').length, 0);
  });
});

test('failed approach preparation is retried at the exact arrived station without opening an early exit', async () => {
  await harness(async ({ create, city }) => {
    const travel = create();
    travel.chooseDestination('burrard');
    assert.equal(await travel.enter('waterfront'), true);
    let attempts = 0;
    city.renderer.compileAsync = async () => {
      attempts++;
      assert.equal(travel.alight(), false);
      if (attempts === 1)
        throw new Error('recorded approach compilation failure');
    };
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, (s) => s.canAlight && s.stationId === 'burrard');
    assert.equal(attempts, 2);
    assert.equal(travel.owner.data.id, 'burrard');
    assert.equal(travel.stations.active, travel.owner);
    assert.equal(
      city.scene.children.filter((o) => o.name.startsWith('skytrain-station-'))
        .length,
      1,
    );
    assert.equal(travel.alight(), true);
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
    city.renderer.compileAsync = async (scene, camera, target) => {
      assert.equal(scene, city.scene);
      assert.equal(camera, city.camera);
      assert.equal(target, undefined);
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
    city.navigation.groundHeight = cityElevation;
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

test('full-scene prewarm uses the actual Three light collector with each world, cabin and real station light exactly once', async () => {
  await harness(async ({ create, city }) => {
    const source = fs.readFileSync(
      'node_modules/three/src/renderers/WebGLRenderer.js',
      'utf8',
    );
    const begin = source.indexOf(
      'this.compile = function ( scene, camera, targetScene = null ) {',
    );
    const last = source.indexOf('currentRenderState.setupLights();', begin);
    assert(begin >= 0 && last > begin);
    const prefix = source.slice(
      begin,
      last + 'currentRenderState.setupLights();'.length,
    );
    const state = {
      lights: [],
      init() {
        this.lights = [];
      },
      pushLight(light) {
        this.lights.push(light);
      },
      pushShadow() {},
      setupLights() {},
    };
    // Run the installed renderer's actual light-gathering branch without a GL
    // context. Geometry, owners, visibility, light objects and camera are real.
    const collect = runInNewContext(
      `let currentRenderState; ${prefix}
       return currentRenderState.lights;
       }; this.compile;`,
      { renderStates: { get: () => state }, renderStateStack: [] },
    );
    const travel = create(),
      worldLight = new THREE.PointLight(),
      cabinLight = new THREE.PointLight();
    city.scene.add(worldLight);
    travel.train.group.add(cabinLight);
    let calls = 0;
    city.renderer.compileAsync = async (...args) => {
      calls++;
      assert.equal(args.length, 2);
      assert.equal(args[0], city.scene);
      assert.equal(args[1], city.camera);
      const lights = collect(...args),
        stationLights = [];
      travel.owner.group.traverseVisible((object) => {
        if (object instanceof THREE.PointLight) stationLights.push(object);
      });
      assert(stationLights.length > 0);
      assert.equal(new Set(lights).size, lights.length);
      assert(lights.includes(worldLight));
      assert(lights.includes(cabinLight));
      assert(stationLights.every((light) => lights.includes(light)));
      assert.equal(lights.length, stationLights.length + 2);
      const duplicated = collect(travel.owner.group, city.camera, city.scene);
      assert(
        duplicated.length > new Set(duplicated).size,
        'the same real collector detects the former attached-subtree duplication',
      );
    };
    assert.equal(await travel.enter('waterfront'), true);
    assert.equal(calls, 1);
    assert.equal(travel.train.group.visible, true);
  });
});

test('entry waits for full-scene precompile with loaded train lights before exposing station input or boarding', async () => {
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
      city.scene,
      'the loaded consist and city materials use one complete lighting context',
    );
    assert.equal(compiled[1], city.camera);
    assert.equal(
      compiled.length,
      2,
      'one scene prevents duplicate light collection',
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

test('the independent bounded station replacement and guideway opening enable only at Main Street and clear on another station, street exit and disposal', async () => {
  await harness(async ({ create, city }) => {
    const uniform = { value: new THREE.Vector4(-1, 0, 0, 0) };
    city.uniforms = {
      skyTrainReplacement: uniform,
      ...createSkyTrainGuidewayUniforms(),
    };
    const profile = Object.freeze({ seed: 783 });
    const guidewayProfile = Object.freeze({ seed: 967 });
    city.data.buildingProfiles = new Map([
      ['osm-structure-303', profile],
      ['133436', guidewayProfile],
    ]);
    const guideway = city.uniforms.skyTrainGuidewayHeight.value;
    const assertNeutral = () => {
      assert.deepEqual(guideway.toArray(), [-1, 0, 0, 0]);
      assert.deepEqual(
        city.uniforms.skyTrainGuidewayFrame.value.toArray(),
        [0, 0, 0, 0],
      );
      assert.deepEqual(
        city.uniforms.skyTrainGuidewayBounds.value.toArray(),
        [0, 0, 0, 0],
      );
    };
    const travel = create();
    assert.equal(travel.chooseDestination('stadium-chinatown'), true);
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.deepEqual(uniform.value.toArray(), [
      783,
      travel.owner.origin[0],
      travel.owner.origin[2],
      170,
    ]);
    assert.equal(guideway.x, 967);
    assert.equal(guideway.w, 1);
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(
      travel,
      (s) => s.stationId === 'stadium-chinatown' && s.canAlight,
    );
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assertNeutral();
    assert.equal(travel.alight(), true);
    await walkTo(
      travel,
      travel.owner.accessPoint('platform', travel.line, travel.direction)
        .position,
    );
    assert.equal(travel.goConcourse(), true);
    assert.equal(travel.leave(), true);
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assertNeutral();
    for (const station of SKYTRAIN_STATIONS.filter(
      (s) => s.id !== 'main-street-science-world',
    )) {
      assert.equal(await travel.enter(station.id), true);
      assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
      assertNeutral();
      assert.equal(travel.leave(), true);
    }
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.equal(uniform.value.w, 170);
    assert.equal(guideway.w, 1);
    assert.equal(travel.leave(), true);
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assertNeutral();
    assert.equal(await travel.enter('main-street-science-world'), true);
    assert.equal(uniform.value.w, 170);
    assert.equal(guideway.w, 1);
    travel.dispose();
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assertNeutral();
    assert.equal(city.data.buildingProfiles.get('osm-structure-303'), profile);
    assert.deepEqual(profile, { seed: 783 });
    assert.equal(city.data.buildingProfiles.get('133436'), guidewayProfile);
    assert.deepEqual(guidewayProfile, { seed: 967 });
  });
});

test('failed Main Street entry clears the replacement uniform after it was enabled during train preparation', async () => {
  await harness(async ({ create, city }) => {
    const uniform = { value: new THREE.Vector4(-1, 0, 0, 0) };
    city.uniforms = {
      skyTrainReplacement: uniform,
      ...createSkyTrainGuidewayUniforms(),
    };
    city.data.buildingProfiles = new Map([
      ['osm-structure-303', { seed: 783 }],
      ['133436', { seed: 967 }],
    ]);
    city.renderer.compileAsync = async () => {
      assert.equal(uniform.value.w, 170);
      assert.equal(city.uniforms.skyTrainGuidewayHeight.value.w, 1);
      throw new Error('recorded train preparation failure');
    };
    const travel = create();
    assert.equal(await travel.enter('main-street-science-world'), false);
    assert.equal(travel.snapshot().phase, 'error');
    assert.deepEqual(uniform.value.toArray(), [-1, 0, 0, 0]);
    assert.deepEqual(
      city.uniforms.skyTrainGuidewayHeight.value.toArray(),
      [-1, 0, 0, 0],
    );
  });
});

test('a failed prepared Main arrival clears both independent visual corrections and keeps the passenger inside closed doors', async () => {
  await harness(async ({ create, city }) => {
    city.uniforms = {
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
      ...createSkyTrainGuidewayUniforms(),
    };
    city.data.buildingProfiles = new Map([
      ['osm-structure-303', { seed: 783 }],
      ['133436', { seed: 967 }],
    ]);
    const travel = create();
    travel.chooseDestination('main-street-science-world');
    assert.equal(await travel.enter('stadium-chinatown'), true);
    let attempts = 0;
    city.renderer.compileAsync = async () => {
      attempts++;
      assert.equal(city.uniforms.skyTrainGuidewayHeight.value.w, 1);
      throw new Error('recorded Main approach shader failure');
    };
    fastJourney(travel);
    await toBoardingDoor(travel);
    assert.equal(travel.board(), true);
    await until(travel, (s) => Boolean(s.error) && !s.busy);
    assert.equal(attempts, 2, 'arrival retries the prepared owner once');
    assert.deepEqual(
      city.uniforms.skyTrainReplacement.value.toArray(),
      [-1, 0, 0, 0],
    );
    assert.deepEqual(
      city.uniforms.skyTrainGuidewayHeight.value.toArray(),
      [-1, 0, 0, 0],
    );
    assert.equal(travel.snapshot().doorsOpen, false);
    assert.equal(travel.alight(), false);
    assert.equal(travel.leave(), false);
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

test('entering from the city orbit projection keeps nearby real cabin geometry and the shared seat prompt in front of the near plane', async () => {
  await harness(async ({ create, city }) => {
    const travel = create(),
      original = travel.train,
      train = await actualTrain('expo');
    original.dispose();
    travel.train = train;
    city.skyTrainTravel = travel;
    city.scene.add(train.group);
    const load = train.load.bind(train);
    train.load = async (line, ...args) =>
      train.ready && train.serviceLine === line ? true : load(line, ...args);
    city.camera.near = 2;
    city.camera.fov = 42;
    city.camera.aspect = 1280 / 720;
    city.camera.updateProjectionMatrix();
    let projections = 0;
    const updateProjection = city.camera.updateProjectionMatrix.bind(
      city.camera,
    );
    city.camera.updateProjectionMatrix = () => {
      projections++;
      updateProjection();
    };
    const interactions = new CityInteractions(city);
    interactions.setInputEnabled(true);
    try {
      assert(await travel.enter('main-street-science-world'));
      assert.equal(city.camera.near, 0.05);
      assert.equal(city.camera.fov, 65);
      assert.equal(projections, 1);
      travel.journey = new SkyTrainJourney(
        'main-street-science-world',
        'waterfront',
        { ...FAST, boardingSeconds: 30 },
      );
      await toBoardingDoor(travel);
      assert(travel.board());
      travel.yaw = Math.PI;
      travel.setTouchAxes(0, 1);
      await tick(travel, 7);
      travel.yaw = -Math.PI / 2;
      await tick(travel, 3);
      travel.yaw = Math.PI;
      await tick(travel, 4);
      travel.setTouchAxes(0, 0);
      const seat = train.passengerSpace.seats.find(
        (candidate) => candidate.id === 'seat-long-left-5',
      );
      assert(train.passengerSpace.canSit(seat, travel.cabinFoot));
      travel.yaw = Math.atan2(
        seat.position[0] - travel.cabinFoot[0],
        seat.position[2] - travel.cabinFoot[2],
      );
      await tick(travel);
      const candidate = travel
        .interactionCandidates()
        .find((row) => row.id.endsWith(':' + seat.id));
      assert(candidate);
      assert(projectInteractionAnchor(city.camera, candidate.anchor));
      const orbitProjection = city.camera.clone();
      orbitProjection.near = 2;
      orbitProjection.updateProjectionMatrix();
      assert.equal(
        projectInteractionAnchor(orbitProjection, candidate.anchor),
        null,
        'the inherited orbit near plane would hide this actually reachable seat',
      );
      const cushion = train.passengerPointToWorld([
        seat.position[0],
        seat.position[1] + seat.seatHeight,
        seat.position[2],
      ]);
      city.camera.updateWorldMatrix(true, false);
      const cameraSpace = new THREE.Vector3(...cushion).applyMatrix4(
        city.camera.matrixWorldInverse,
      );
      assert(
        -cameraSpace.z > city.camera.near && -cameraSpace.z < 2,
        'the actual nearby cushion now remains in front of the near plane',
      );
      interactions.update(performance.now(), true);
      assert.equal(interactions.controller.snapshot()?.id, candidate.id);
      assert(interactions.interact());
      assert(travel.passengerSeated);
      assert.equal(
        projections,
        1,
        'walking and sitting reuse the same projection',
      );
      assert(travel.stand());
    } finally {
      interactions.dispose();
    }
  });
});

test('real cabin walking exposes nearby seats; sit/stand stays attached, ignores held desktop/mobile input and requires walking back to an open door before alighting', async () => {
  await harness(async ({ create, city, win }) => {
    const travel = create(),
      original = travel.train,
      train = await actualTrain('expo');
    original.dispose();
    travel.train = train;
    city.scene.add(train.group);
    const load = train.load.bind(train);
    train.load = async (line, ...args) =>
      train.ready && train.serviceLine === line ? true : load(line, ...args);
    const poses = [];
    city.navigation.walker.setSeated = (seated, height) =>
      poses.push([seated, height]);
    assert(await travel.enter('waterfront'));
    assert(travel.chooseDestination('burrard'));
    travel.journey = new SkyTrainJourney('waterfront', 'burrard', {
      ...FAST,
      boardingSeconds: 4,
      segmentSeconds: () => 4,
      dwellSeconds: 30,
    });
    await toBoardingDoor(travel);
    assert(travel.board());
    assert.equal(travel.snapshot().canWalkCabin, true);
    assert.equal(travel.passengerSeated, false);
    assert.deepEqual(
      travel.interactionCandidates(),
      [],
      'boarding is not a teleporting seat picker',
    );
    const before = [...travel.cabinFoot];
    travel.setTouchAxes(0, 1);
    await tick(travel, 5);
    travel.setTouchAxes(0, 0);
    assert(
      Math.hypot(
        travel.cabinFoot[0] - before[0],
        travel.cabinFoot[2] - before[2],
      ) > 0.6,
    );
    // The active Waterfront side boards at x<0. Cross the clear aisle behind
    // the central pole, then approach a real longitudinal cushion farther in.
    travel.yaw = Math.PI / 2;
    travel.setTouchAxes(0, 1);
    await tick(travel, 5);
    travel.yaw = Math.PI;
    travel.setTouchAxes(0, 1);
    await tick(travel, 8);
    travel.setTouchAxes(0, 0);
    const seat = travel
      .interactionCandidates()
      .find((row) => row.action === 'sit');
    assert(seat);
    const cushion = train.passengerSpace.seats.find((value) =>
      seat.id.endsWith(':' + value.id),
    );
    const raised = train.passengerPointToWorld([
      cushion.position[0],
      cushion.position[1] + cushion.seatHeight + 0.85,
      cushion.position[2],
    ]);
    assert(
      new THREE.Vector3(...seat.anchor).distanceTo(
        new THREE.Vector3(...raised),
      ) < 1e-7,
      'standing first-person prompt is raised above the cushion',
    );
    assert(seat.execute());
    assert.equal(travel.snapshot().seated, true);
    assert.equal(travel.snapshot().canWalkCabin, false);
    assert(poses.at(-1)[0]);
    travel.setInputEnabled(false);
    assert.deepEqual(travel.interactionCandidates(), []);
    assert.equal(travel.stand(), false, 'modal input lock retains the seat');
    travel.setInputEnabled(true);

    const seatedLocal = [...train.passenger.position.toArray()];
    win.dispatchEvent(key('KeyW'));
    travel.setTouchAxes(1, 1);
    await tick(travel, 3);
    assert.deepEqual(train.passenger.position.toArray(), seatedLocal);
    assert.equal(travel.alight(), false);
    assert.equal(travel.leave(), false);
    assert.equal(await travel.goPlatform(), false);
    await until(travel, (s) => s.speedMps > 0);
    for (let i = 0; i < 5; i++) {
      await tick(travel);
      const eye = new THREE.Vector3(),
        q = new THREE.Quaternion();
      train.passengerWorldPose(eye, q);
      assert(city.camera.position.distanceTo(eye) < 1e-7);
      assert.deepEqual(train.passenger.position.toArray(), seatedLocal);
    }
    await until(
      travel,
      (s) => s.stationId === 'burrard' && !s.busy && s.doorsOpen,
    );
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'seated passenger cannot alight through a distant door',
    );
    const stand = travel.interactionCandidates()[0];
    assert.equal(stand.action, 'stand');
    assert(stand.execute());
    assert.equal(travel.snapshot().seated, false);
    assert.equal(poses.at(-1)[0], false);
    const standing = [...travel.cabinFoot];
    await tick(travel, 2);
    assert.deepEqual(
      travel.cabinFoot,
      standing,
      'held controls were cleared during stand',
    );
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'standing farther down the cabin is not a doorway',
    );
    travel.yaw = 0;
    travel.setTouchAxes(0, 1);
    await tick(travel, 8);
    travel.setTouchAxes(0, 0);
    assert.equal(
      travel.snapshot().canAlight,
      false,
      'the opposite cabin side is not the opened door',
    );
    travel.yaw = -Math.PI / 2;
    travel.setTouchAxes(0, 1);
    await tick(travel, 5);
    travel.setTouchAxes(0, 0);
    assert.equal(travel.snapshot().canAlight, true);
    assert(travel.alight());
    assert.equal(travel.passengerSeated, false);
    assert.equal(
      travel.interactionCandidates().some((row) => row.id.includes(':cabin:')),
      false,
    );
    travel.dispose();
    assert.equal(travel.interactionOrigin, null);
    assert.deepEqual(travel.interactionCandidates(), []);
  });
});

test('station bench proximity uses the current station floor and restores a verified aisle stand without moving while seated', async () => {
  await harness(async ({ create, city }) => {
    const travel = create(),
      poses = [];
    city.navigation.walker.setSeated = (...pose) => poses.push(pose);
    assert(await travel.enter('burrard'));
    assert(await travel.goPlatform());
    const target = travel.owner
      .benchSeats()
      .find((seat) => seat.stand.surfaceId === travel.foot.surfaceId);
    assert(target);
    await walkTo(travel, target.stand.position, 0.4);
    const candidate = travel
      .interactionCandidates()
      .find((row) => row.id.endsWith(target.id));
    assert(candidate);
    const raised = travel.owner.toWorld([
      target.position[0],
      target.position[1] + target.seatHeight + 0.85,
      target.position[2],
    ]);
    assert(
      new THREE.Vector3(...candidate.anchor).distanceTo(
        new THREE.Vector3(...raised),
      ) < 1e-7,
    );
    assert(candidate.execute());
    assert.equal(travel.snapshot().seated, true);
    assert.equal(
      city.navigation.walker.group.visible,
      true,
      'station bench camera shows the actual seated avatar',
    );
    const feet = travel.interactionOrigin;
    travel.setTouchAxes(1, 1);
    await tick(travel, 5);
    assert.deepEqual(travel.interactionOrigin, feet);
    assert.equal(travel.goConcourse(), false);
    assert.equal(travel.leave(), false);
    assert(travel.stand());
    assert(travel.owner.isClearFoot(travel.foot));
    assert.equal(travel.foot.surfaceId, target.stand.surfaceId);
    assert.equal(poses.at(-1)[0], false);
    travel.dispose();
    assert.equal(poses.at(-1)[0], false);
  });
});
