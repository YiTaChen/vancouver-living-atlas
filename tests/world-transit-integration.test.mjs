import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { actualTrain } from './helpers/skytrain-geometry.mjs';
import { planFlat } from './helpers/station-walker.mjs';
const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const { WorldSkyTrainRun } = await import(cityModule('skytrain-world-service'));
const { StreetNavigation } = await import(cityModule('navigation'));
const { TravelCameraCollision } = await import(
  cityModule('travel-camera-collision')
);
const { CityInteractions, projectInteractionAnchor } = await import(
  cityModule('city-interactions')
);
const { createSkyTrainGuidewayUniforms } = await import(
  cityModule('skytrain-guideway-clearance')
);
const worldData = JSON.parse(
  readFileSync('public/data/transit/skytrain-world-routes.json', 'utf8'),
);

class CanvasTarget extends EventTarget {
  dataset = {};
  setAttribute(key, value) {
    if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
  }
  closest() {
    return null;
  }
  focus() {}
  setPointerCapture() {}
}
async function harness(run, { groundHeight = cityElevation } = {}) {
  const previous = new Map(
    ['window', 'document', 'Element', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const canvas = new CanvasTarget(),
    doc = Object.assign(new EventTarget(), {
      hidden: false,
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
  globalThis.window = new EventTarget();
  globalThis.document = doc;
  globalThis.Element = CanvasTarget;
  globalThis.fetch = async (url, options = {}) => {
    if (options.signal?.aborted) throw Error('Aborted');
    if (typeof url !== 'string') throw Error('Expected local string URL');
    assert.match(
      url,
      /^\/(?:data\/transit\/skytrain-world-routes\.json|models\/(?:skytrain-routes\.json|skytrain-stations\/[a-z-]+\.json))$/,
    );
    return {
      ok: true,
      json: async () => JSON.parse(readFileSync('public' + url, 'utf8')),
    };
  };
  const calls = { poses: [], animations: [] };
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), enabled: true, update() {} },
    renderer: { domElement: canvas },
    settings: {
      mode: 'orbit',
      quality: 'balanced',
      autoRotate: false,
      trains: true,
      buildings: true,
      traffic: true,
    },
    compatibleGraphics: true,
    pageSuspended: false,
    contextLost: false,
    elevation: cityElevation,
    uniforms: {
      ...createSkyTrainGuidewayUniforms(),
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
    },
    terrain: new THREE.Group(),
    roads: new THREE.Group(),
    buildings: new THREE.Group(),
    landmarks: new THREE.Group(),
    onLocalOrbit() {},
    onTravelResume() {},
    busVisit: { aboard: false },
    data: { travelSurfaces: { surfaceIds: new Set(), lookup: () => [] } },
    interiors: { height: () => undefined },
    navigation: {
      mode: 'orbit',
      yaw: 0,
      pitch: 0.04,
      keys: new Set(),
      touchX: 0,
      touchY: 0,
      speed: 0,
      surface: 'ground',
      renderedDistance: 4,
      walkingDistance: 0,
      cameraCollision: new TravelCameraCollision(),
      car: new THREE.Group(),
      cameraDistance: 4,
      cameraDistances: { walk: 4, drive: 22, boat: 16 },
      position: new THREE.Vector3(),
      walker: {
        group: new THREE.Group(),
        update(distance, walking, dt, speed) {
          calls.animations.push({ distance, walking, dt, speed });
        },
        setSeated(seated, height) {
          calls.poses.push({ seated, height });
        },
      },
      blur() {
        this.keys.clear();
        this.setTouchAxes(0, 0);
        this.speed = 0;
      },
      setTouchAxes: StreetNavigation.prototype.setTouchAxes,
      update: StreetNavigation.prototype.update,
      move: StreetNavigation.prototype.move,
      moveGround: StreetNavigation.prototype.moveGround,
      roadHeight: groundHeight,
      blocked() {
        return false;
      },
      reachableDeck() {
        return undefined;
      },
      impactBuilding() {},
      updateCockpit() {},
      notifyCamera() {},
      finishReturnBlend() {},
      clearGround: () => true,
      groundHeight,
      walkingHeight() {
        return this.position.y;
      },
    },
  };
  city.navigation.e = city;
  const travel = new SkyTrainWorldTravel(city);
  city.skyTrainTravel = travel;
  const interactionHost = new CityInteractions(city);
  city.interactions = interactionHost;
  let interactionView;
  interactionHost.onChange = (view) => (interactionView = view);
  interactionHost.setInputEnabled(true);
  // Only near-train network acquisition is replaced. Paths, station models,
  // service clocks and the occupied real GLB's doors/seats remain production.
  travel.detail = async () => {};
  try {
    await travel.load();
    const mismatches = [];
    if (!travel.ready && travel.metadata.size)
      for (const route of worldData.routes)
        for (let i = 0; i < route.stops.length - 1; i++) {
          const a = travel.stopPose(route, i),
            b = travel.stopPose(route, i + 1);
          if (a.motionSign !== b.motionSign)
            mismatches.push({
              line: route.lineId,
              direction: route.direction,
              from: route.stops[i].name,
              to: route.stops[i + 1].name,
              startSign: a.motionSign,
              endSign: b.motionSign,
            });
        }
    assert.equal(
      travel.ready,
      true,
      `${travel.snapshot().error ?? 'world service failed'} ${JSON.stringify(mismatches)}`,
    );
    assert.equal(travel.snapshot().error, null);
    assert.equal(travel.stations.owners.length, 7);
    await run({
      travel,
      city,
      doc,
      calls,
      canvas,
      interactionHost,
      currentInteraction: () => interactionView,
    });
  } catch (error) {
    error.stack = `${error.name}: ${error.message}`;
    throw error;
  } finally {
    interactionHost.dispose();
    travel.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
const metric = (samples) => {
  const values = [...samples].sort((a, b) => a - b);
  return {
    frames: values.length,
    p50Ms: values[Math.floor(values.length * 0.5)],
    p95Ms: values[Math.floor(values.length * 0.95)],
    maxMs: values.at(-1),
  };
};
const tick = (travel, steps = 1) => {
  for (let i = 0; i < steps; i++) travel.update(0.1);
};

/** Keep production acquisition/precompile sequencing; replace network bytes
 * with the published GLB reader and hold only the renderer's GPU promise. */
async function deferredWorldDetail(travel, city, vehicle, whileCompiling) {
  const source = await actualTrain(vehicle.state.route.lineId),
    Train = source.constructor,
    Assets = source.assets.constructor,
    originalLoad = Train.prototype.load,
    originalCompile = city.renderer.compileAsync;
  let finishCompile, enteredCompile;
  const gate = new Promise((resolve) => (finishCompile = resolve)),
    entered = new Promise((resolve) => (enteredCompile = resolve));
  let pending;
  Train.prototype.load = function (...args) {
    this.assets.dispose();
    this.assets = new Assets({
      load: source.assets.load,
      fetchManifest: source.assets.fetchManifest,
    });
    return originalLoad.apply(this, args);
  };
  city.renderer.compileAsync = (scene, camera) => {
    assert.equal(scene, city.scene, 'GPU preparation includes the entire city');
    assert.equal(camera, city.camera);
    enteredCompile();
    return gate;
  };
  try {
    pending = SkyTrainWorldTravel.prototype.detail.call(travel, vehicle);
    await Promise.race([
      entered,
      pending.then(() => {
        throw Error('The real GLB never reached GPU preparation');
      }),
    ]);
    await whileCompiling(vehicle.detail);
    finishCompile();
    await pending;
    assert.equal(vehicle.prepared, true);
    return vehicle.detail;
  } finally {
    finishCompile();
    await pending;
    Train.prototype.load = originalLoad;
    city.renderer.compileAsync = originalCompile;
    source.dispose();
  }
}

/** Drive the production capsule through real local floor points using the
 * controller's public touch axes. Positions are read to plan, never injected. */
function walkStationRoute(travel, goals, onStep) {
  for (const goal of goals) {
    const targets =
      Math.abs(goal[1] - travel.foot.position[1]) < 0.025
        ? planFlat(travel.owner, travel.foot, goal)
        : [goal];
    for (const target of targets) {
      const before = travel.foot.position;
      const dx = target[0] - before[0],
        dz = target[2] - before[2],
        desired = Math.atan2(dx, dz);
      let turn = Math.atan2(
        Math.sin(desired - travel.yaw),
        Math.cos(desired - travel.yaw),
      );
      while (Math.abs(turn) > 1e-6) {
        travel.setTouchAxes(-Math.sign(turn), 0);
        travel.update(Math.min(0.1, Math.abs(turn) / 1.65));
        onStep?.();
        turn = Math.atan2(
          Math.sin(desired - travel.yaw),
          Math.cos(desired - travel.yaw),
        );
      }
      let distance = Math.hypot(dx, dz);
      while (distance > 1e-6) {
        const dt = Math.min(0.1, distance / 2.5);
        travel.setTouchAxes(0, 1);
        travel.update(dt);
        onStep?.();
        distance -= dt * 2.5;
      }
      travel.clearInput();
      assert.ok(
        Math.hypot(
          target[0] - travel.foot.position[0],
          target[2] - travel.foot.position[2],
        ) < 0.18,
        `world controller follows station floor route: target ${target}, actual ${travel.foot.position}, surface ${travel.foot.surfaceId}, yaw ${travel.yaw}, mode ${travel.city.settings.mode}`,
      );
    }
  }
}
function walkCabinTo(travel, matches) {
  const space = travel.train.passengerSpace,
    start = [...travel.cabinFoot],
    step = 0.12;
  const key = (p) => `${Math.round(p[0] / step)}:${Math.round(p[2] / step)}`;
  const queue = [{ p: start, parent: -1 }],
    seen = new Set([key(start)]);
  let found = -1,
    seat;
  for (let i = 0; i < queue.length && i < 12000; i++) {
    seat = matches(queue[i].p, space);
    if (seat) {
      found = i;
      break;
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
      const p = space.walk(queue[i].p, x * step, z * step),
        id = key(p);
      if (
        seen.has(id) ||
        Math.hypot(p[0] - queue[i].p[0], p[2] - queue[i].p[2]) < 0.06
      )
        continue;
      seen.add(id);
      queue.push({ p, parent: i });
    }
  }
  assert.ok(
    found >= 0,
    'an actual authored seat is physically reachable from the door',
  );
  const path = [];
  for (let i = found; queue[i].parent >= 0; i = queue[i].parent)
    path.unshift(queue[i].p);
  for (const target of path) {
    const dx = target[0] - travel.cabinFoot[0],
      dz = target[2] - travel.cabinFoot[2],
      desired = Math.atan2(dx, dz);
    let turn = Math.atan2(
      Math.sin(desired - travel.yaw),
      Math.cos(desired - travel.yaw),
    );
    while (Math.abs(turn) > 1e-6) {
      travel.setTouchAxes(-Math.sign(turn), 0);
      travel.update(Math.min(0.1, Math.abs(turn) / 1.65));
      turn = Math.atan2(
        Math.sin(desired - travel.yaw),
        Math.cos(desired - travel.yaw),
      );
    }
    let distance = Math.hypot(dx, dz);
    while (distance > 1e-6) {
      const dt = Math.min(0.1, distance / 1.8);
      travel.setTouchAxes(0, 1);
      travel.update(dt);
      distance -= dt * 1.8;
    }
    travel.clearInput();
  }
  return seat;
}

test('world transit integration uses independent clocks, physical entrances, real doors, persistent seats and localized F actions', async (t) => {
  await harness(async ({ travel, city, doc, calls }) => {
    await t.test(
      'orbit has independently advancing real route trains before any station entry',
      () => {
        const before = travel.serviceSnapshot();
        assert.ok(before.vehicles.length >= 4);
        const samples = [];
        for (let i = 0; i < 220; i++) {
          const start = performance.now();
          travel.update(0.1);
          if (i >= 20) samples.push(performance.now() - start);
        }
        t.diagnostic(
          `Idle orbit world train update: ${JSON.stringify(metric(samples))}`,
        );
        const after = travel.serviceSnapshot();
        assert.equal(travel.active, false);
        assert.equal(travel.aboard, false);
        assert.ok(
          after.vehicles.some(
            (v, i) =>
              Math.hypot(
                ...v.position.map((x, k) => x - before.vehicles[i].position[k]),
              ) > 5,
          ),
        );
        assert.ok(after.vehicles.some((v) => v.speedMps > 0));
        assert.ok(after.vehicles.every((v) => v.headsign && v.nextStop));
        assert.ok(travel.fleet.some((v) => v.proxy.visible));
        const elapsed = travel.fleet[0].state.elapsed;
        city.settings.trains = false;
        tick(travel);
        assert.ok(
          travel.fleet.every((v) => !v.proxy.visible),
          'the city train visibility preference is respected',
        );
        assert.ok(
          travel.fleet[0].state.elapsed > elapsed,
          'visibility never pauses the route clock',
        );
        city.settings.trains = true;
        tick(travel);
        const savedPosition = city.navigation.position.clone();
        const threshold = travel.stations
          .get('waterfront')
          .streetEntrances()[0].threshold;
        city.settings.buildings = false;
        city.settings.mode = 'walk';
        city.navigation.mode = 'walk';
        city.navigation.position.fromArray(threshold);
        tick(travel);
        assert.equal(
          travel.active,
          false,
          'hidden architecture does not automatically capture a street walker',
        );
        assert.ok(
          travel.stations.owners.every((owner) => !owner.group.visible),
          'unoccupied station architecture follows building visibility',
        );
        city.settings.buildings = true;
        city.settings.mode = 'orbit';
        city.navigation.mode = 'orbit';
        city.navigation.position.copy(savedPosition);
        tick(travel);
        assert.ok(travel.stations.owners.every((owner) => owner.group.visible));
      },
    );
    await t.test(
      'hidden and context-lost scenes freeze autonomous simulation without resume catch-up',
      () => {
        const before = travel.serviceSnapshot().vehicles;
        doc.hidden = true;
        travel.update(10000);
        doc.hidden = false;
        assert.deepEqual(travel.serviceSnapshot().vehicles, before);
        city.contextLost = true;
        travel.update(1);
        city.contextLost = false;
        assert.deepEqual(travel.serviceSnapshot().vehicles, before);
        travel.update(10000);
        travel
          .serviceSnapshot()
          .vehicles.forEach((v, i) =>
            assert.ok(
              Math.hypot(
                ...v.position.map((x, k) => x - before[i].position[k]),
              ) < 4,
            ),
          );
      },
    );
    await t.test(
      'a remote enter and wrong-height street threshold cannot place a player inside a station',
      async () => {
        city.settings.mode = 'walk';
        city.navigation.mode = 'walk';
        city.navigation.position.set(10000, 100, 10000);
        assert.equal(await travel.enter('waterfront'), false);
        const owner = travel.stations.get('waterfront'),
          threshold = owner.streetEntrances()[0].threshold;
        city.navigation.position
          .fromArray(threshold)
          .add(new THREE.Vector3(0, 3, 0));
        assert.equal(await travel.enter('waterfront'), false);
        city.navigation.position.fromArray(threshold);
        assert.equal(await travel.enter('waterfront'), true);
        assert.ok(
          new THREE.Vector3(...travel.interactionOrigin).distanceTo(
            new THREE.Vector3(...threshold),
          ) < 0.001,
        );
        assert.equal(
          travel.board(),
          false,
          'entry/concourse cannot directly board a train',
        );
      },
    );
    await t.test(
      'walking reaches a real platform and only the actual stopped open train admits F boarding',
      async () => {
        const owner = travel.owner;
        const route = owner
          .streetRoutes()
          .find((r) =>
            owner.geometryData.platforms.find(
              (p) =>
                p.surfaceId === r.platformSurfaceId &&
                p.line === 'expo' &&
                p.direction === 'eastbound',
            ),
          );
        assert.ok(route);
        // The first advertised entrance may differ; choose the matching public
        // threshold before entry rather than replacing the station floor pose.
        const entrance = owner
          .streetEntrances()
          .find((e) => e.id === route.entranceId);
        if (
          new THREE.Vector3(...owner.toWorld(travel.foot)).distanceTo(
            new THREE.Vector3(...entrance.threshold),
          ) > 0.2
        ) {
          assert.fail(
            'fixture must enter the physical entrance associated with the selected route',
          );
        }
        walkStationRoute(travel, route.points.slice(1));
        const point = owner.boardingPoint('expo', 'eastbound');
        walkStationRoute(travel, [point.position]);
        const vehicle = travel.fleet.find(
          (v) => v.state.route.lineId === 'expo',
        );
        const routes = worldData.routes.filter((r) => r.lineId === 'expo');
        vehicle.run = new WorldSkyTrainRun(routes[0], routes[1]);
        vehicle.state = vehicle.run.snapshot();
        const train = await deferredWorldDetail(
          travel,
          city,
          vehicle,
          async (loadingTrain) => {
            assert.equal(loadingTrain.ready, true);
            assert.equal(vehicle.prepared, false);
            assert.equal(vehicle.loading, true);
            const elapsed = vehicle.state.elapsed;
            tick(travel, 12);
            assert.equal(vehicle.state.phase, 'dwell');
            assert.equal(loadingTrain.doorsClear, true);
            assert.equal(travel.board(), false);
            assert.equal(
              travel.interactionCandidates().some((p) => p.action === 'board'),
              false,
              'F boarding waits for the actual GPU preparation promise',
            );
            assert.equal(vehicle.proxy.visible, true);
            assert.equal(loadingTrain.group.visible, false);
            tick(travel, 240);
            assert.ok(vehicle.state.elapsed > elapsed);
            assert.equal(vehicle.state.phase, 'moving');
            assert.equal(vehicle.proxy.visible, true);
            assert.equal(loadingTrain.group.visible, false);
            assert.ok(
              loadingTrain.group.position.distanceTo(vehicle.proxy.position) <
                0.001,
              'hidden detail follows the current service pose throughout preparation',
            );
          },
        );
        tick(travel);
        assert.equal(vehicle.proxy.visible, false);
        assert.equal(train.group.visible, true);
        vehicle.run = new WorldSkyTrainRun(routes[0], routes[1]);
        vehicle.state = vehicle.run.snapshot();
        travel.applyPose(vehicle, 1);
        assert.equal(
          travel.board(),
          false,
          'closed actual GLB doors reject boarding',
        );
        tick(travel, 12);
        assert.equal(vehicle.state.phase, 'dwell');
        assert.equal(train.stationAligned, true);
        assert.equal(train.doorsClear, true);
        const physicalPose = train.group.position.clone();
        train.group.position.x += 25;
        train.group.updateMatrixWorld(true);
        assert.equal(
          travel.board(),
          false,
          'a train displaced from the actual platform cannot admit a remote transfer',
        );
        train.group.position.copy(physicalPose);
        train.group.updateMatrixWorld(true);
        const prompt = travel
          .interactionCandidates()
          .find((p) => p.action === 'board');
        assert.ok(prompt);
        vehicle.run.advance(30);
        vehicle.state = vehicle.run.snapshot();
        travel.applyPose(vehicle, 0.1);
        assert.equal(prompt.canInteract(), false);
        const other = travel.fleet.find(
          (v) => v !== vehicle && v.state.route.lineId === 'expo',
        );
        const otherTrain = await actualTrain('expo');
        other.run = new WorldSkyTrainRun(routes[0], routes[1], 1);
        other.state = other.run.snapshot();
        other.detail = otherTrain;
        other.prepared = true;
        city.scene.add(otherTrain.group);
        travel.captureLights(otherTrain.group);
        travel.applyPose(other);
        for (let i = 0; i < 8; i++)
          otherTrain.setDoors(
            true,
            owner.trainStop('expo', 'eastbound').doorSide,
            0.1,
          );
        assert.equal(
          travel.nearestBoardingTrain(),
          other,
          'another actual stopped open train may now own this doorway',
        );
        assert.equal(
          prompt.execute(),
          false,
          'a stale prompt cannot board a different currently-nearest vehicle',
        );
        other.detail = null;
        other.prepared = false;
        otherTrain.dispose();

        vehicle.run = new WorldSkyTrainRun(routes[0], routes[1]);
        vehicle.state = vehicle.run.snapshot();
        tick(travel, 12);
        assert.equal(
          travel
            .interactionCandidates()
            .find((p) => p.action === 'board')
            .execute(),
          true,
        );
        assert.equal(travel.train, train);
        assert.equal(travel.occupied, vehicle);
      },
    );
    await t.test(
      'retained stations and loaded train interiors share one stable four-light rendering budget',
      () => {
        const visible = () => {
          const lights = [];
          city.scene.traverseVisible((node) => {
            if (node instanceof THREE.PointLight) lights.push(node);
          });
          return lights;
        };
        const pool = visible();
        assert.equal(pool.length, 4);
        assert.ok(
          pool.every((light) => light.name === 'Bounded transit lighting'),
        );
        const all = [];
        city.scene.traverse((node) => {
          if (node instanceof THREE.PointLight) all.push(node);
        });
        assert.ok(
          all.length > 4,
          'actual station and GLB lamps exist behind the constant render pool',
        );
        assert.ok(
          all
            .filter((light) => !pool.includes(light))
            .every((light) => !light.visible),
        );
        const verify = () =>
          assert.deepEqual(
            new Set(visible()),
            new Set(pool),
            'movement and view changes retain exactly the same four renderer lights',
          );
        tick(travel);
        verify();
        travel.setOverview(true);
        tick(travel);
        verify();
        assert.ok(
          pool.every((light) => light.intensity === 0),
          'orbit disables local lamp output without changing shader light count',
        );
        travel.setOverview(false);
        tick(travel);
        verify();
        const occupied = travel.occupied;
        city.settings.trains = false;
        city.settings.buildings = false;
        tick(travel);
        verify();
        assert.equal(travel.occupied, occupied);
        assert.equal(
          occupied.detail.group.visible,
          true,
          'hiding ambient trains retains an occupied cabin',
        );
        assert.equal(
          travel.owner.group.visible,
          true,
          'the current physical station floor remains visible while occupied',
        );
        city.settings.trains = true;
        city.settings.buildings = true;
        tick(travel);
        verify();
      },
    );
    await t.test(
      'avatar animation advances once per update from carriage-local walking rather than rail motion or camera changes',
      () => {
        travel.clearInput();
        let before = calls.animations.length;
        travel.zoom(0.99);
        travel.zoom(1.01);
        assert.equal(
          calls.animations.length,
          before,
          'camera-only updates never advance avatar animation',
        );
        const distance = travel.walkDistance,
          worldBefore = city.navigation.position.clone();
        tick(travel, 260);
        const idle = calls.animations.slice(before);
        assert.equal(
          idle.length,
          260,
          'exactly one animation update is emitted per active walking-mode simulation tick',
        );
        assert.ok(
          idle.every(
            (row) =>
              !row.walking && row.speed === 0 && row.distance === distance,
          ),
        );
        assert.ok(
          city.navigation.position.distanceTo(worldBefore) > 2,
          'the train moved while the passenger remained locally still',
        );
        const foot = travel.cabinFoot,
          space = travel.train.passengerSpace;
        const direction = Array.from(
          { length: 8 },
          (_, i) => (i * Math.PI) / 4,
        ).find((angle) => {
          const next = space.walk(
            foot,
            Math.sin(angle) * 0.18,
            Math.cos(angle) * 0.18,
          );
          return Math.hypot(next[0] - foot[0], next[2] - foot[2]) > 0.1;
        });
        assert.notEqual(direction, undefined);
        let delta = Math.atan2(
          Math.sin(direction - travel.yaw),
          Math.cos(direction - travel.yaw),
        );
        while (Math.abs(delta) > 1e-7) {
          travel.setTouchAxes(-Math.sign(delta), 0);
          travel.update(Math.min(0.1, Math.abs(delta) / 1.65));
          delta = Math.atan2(
            Math.sin(direction - travel.yaw),
            Math.cos(direction - travel.yaw),
          );
        }
        travel.clearInput();
        before = calls.animations.length;
        travel.setTouchAxes(0, 1);
        travel.update(0.1);
        travel.clearInput();
        assert.equal(calls.animations.length, before + 1);
        const walked = calls.animations.at(-1);
        assert.equal(walked.walking, true);
        assert.ok(walked.speed > 0 && walked.distance > distance);
        assert.equal(walked.dt, 0.1);
      },
    );
    await t.test(
      'the same physical seat and vehicle persist through later real stations while the camera moves with the train',
      () => {
        const seat = walkCabinTo(travel, (point, space) =>
            space.seats.find((s) => space.canSit(s, point)),
          ),
          train = travel.train,
          vehicle = travel.occupied;
        const prompt = travel
          .interactionCandidates()
          .find((p) => p.id.endsWith(seat.id));
        const animationsBeforeSit = calls.animations.length;
        assert.ok(prompt && prompt.execute());
        assert.equal(
          calls.animations.length,
          animationsBeforeSit,
          'sitting updates pose without an extra animation tick',
        );
        const before = city.camera.position.clone(),
          firstStation = travel.snapshot().stationId;
        let arrival = false;
        const samples = [];
        for (let i = 0; i < 5000; i++) {
          const start = performance.now();
          travel.update(0.1);
          if (i >= 20 && vehicle.state.phase === 'moving')
            samples.push(performance.now() - start);
          assert.equal(travel.train, train);
          assert.equal(travel.occupied, vehicle);
          assert.equal(travel.cabinSeat, seat);
          if (
            travel.snapshot().stationId !== firstStation &&
            vehicle.state.phase === 'dwell'
          ) {
            arrival = true;
            break;
          }
        }
        assert.ok(
          arrival,
          'autonomous train reaches a future actual downtown station',
        );
        t.diagnostic(
          `Occupied moving world train update: ${JSON.stringify(metric(samples))}`,
        );
        assert.ok(city.camera.position.distanceTo(before) > 50);
        assert.equal(
          travel.snapshot().canAlight,
          false,
          'seated riders cannot exit remotely',
        );
        const seatedAt = travel.cabinSeat;
        assert.equal(travel.setOverview(true), true);
        const elapsed = vehicle.state.elapsed,
          animationsBeforeOverview = calls.animations.length;
        tick(travel, 220);
        assert.equal(
          calls.animations.length,
          animationsBeforeOverview,
          'a hidden overview avatar does not animate from train motion',
        );
        assert.equal(travel.cabinSeat, seatedAt);
        assert.equal(travel.occupied, vehicle);
        assert.ok(
          !city.navigation.walker.group.visible ||
            city.navigation.walker.group.position.distanceTo(
              new THREE.Vector3(...travel.interactionOrigin),
            ) < 0.01,
          'overview cannot leave a visible passenger avatar behind the moving train',
        );
        assert.ok(
          vehicle.state.elapsed > elapsed + 20,
          'orbit view keeps the occupied autonomous train clock alive',
        );
        assert.equal(travel.setOverview(false), true);
        assert.equal(city.settings.mode, 'walk');
        assert.equal(
          travel
            .interactionCandidates()
            .find((p) => p.action === 'stand')
            .execute(),
          true,
        );
        assert.equal(travel.occupied, vehicle);
      },
    );
    await t.test(
      'F alighting waits for a future real stop and an actual reachable open cabin doorway',
      () => {
        let stopped = false;
        for (let i = 0; i < 5000; i++) {
          travel.update(0.1);
          if (
            travel.occupied.state.phase === 'dwell' &&
            travel.owner &&
            travel.occupied.state.phaseElapsed < 2 &&
            travel.train.doorsClear
          ) {
            stopped = true;
            break;
          }
        }
        assert.ok(stopped);
        const vehicle = travel.occupied,
          station = travel.owner.data.id;
        walkCabinTo(
          travel,
          (point) =>
            Math.hypot(
              ...point.map(
                (v, i) =>
                  v -
                  travel.owner.passengerDoor(travel.line, travel.direction)[i],
              ),
            ) < 1.2,
        );
        const exit = travel
          .interactionCandidates()
          .find((p) => p.action === 'alight');
        assert.ok(exit, 'F exit appears at the actual open carriage doorway');
        city.settings.trains = false;
        city.settings.buildings = false;
        travel.update(0.1);
        assert.equal(vehicle.detail.group.visible, true);
        assert.equal(travel.owner.group.visible, true);
        assert.equal(
          exit.canInteract(),
          true,
          'an occupied train retains a valid physical exit while ambient trains are hidden',
        );
        assert.equal(exit.execute(), true);
        assert.equal(travel.aboard, false);
        assert.equal(travel.owner.data.id, station);
        assert.ok(travel.owner.isClearFoot(travel.foot));
        assert.equal(travel.snapshot().level, 'platform');
        assert.ok(
          vehicle.detail.ready,
          'alighting leaves the same service vehicle alive',
        );
        tick(travel);
        assert.equal(
          vehicle.detail,
          null,
          'hidden unoccupied detail releases once the passenger has alighted',
        );
        assert.equal(travel.owner.group.visible, true);
        city.settings.trains = true;
        city.settings.buildings = true;
      },
    );
    await t.test(
      'public F actions are localized and public panels are restricted to QA mode',
      () => {
        const messages = JSON.parse(
          readFileSync('lib/i18n/interactions.json', 'utf8'),
        );
        for (const [locale, strings] of Object.entries(messages)) {
          assert.equal(typeof strings.board, 'string', locale);
          assert.equal(typeof strings.alight, 'string', locale);
          assert.ok(strings.board.length > 0 && strings.alight.length > 0);
        }
        const page = readFileSync('app/page.tsx', 'utf8');
        assert.match(
          page,
          /VANCOUVER_VISUAL_QA === '1'[^<]*<SkyTrainTravelPanel/,
        );
        assert.match(page, /VANCOUVER_VISUAL_QA === '1'[^<]*<BusVisitPanel/);
      },
    );
  });
});

test('authorized construction portals use common F and touch transfers for every platform while preserving service and fresh physical guards', async (t) => {
  await harness(
    async ({ travel, city, interactionHost, currentInteraction }) => {
      const sources = [...travel.constructionAccess.entries()].flatMap(
        ([owner, portals]) =>
          portals
            .filter((p) => p.kind === 'platform')
            .map((portal) => ({ owner, portal })),
      );
      assert.equal(
        sources.length,
        travel.stations.owners
          .filter((owner) => !owner.geometryData.authoredInterior)
          .reduce((count, owner) => count + owner.streetRoutes().length, 0),
      );
      assert.equal(
        new Set(sources.map(({ owner }) => owner.data.id)).size,
        travel.stations.owners.filter(
          (owner) =>
            !owner.geometryData.authoredInterior && owner.streetRoutes().length,
        ).length,
      );
      const fleet = [...travel.fleet],
        runs = fleet.map((v) => v.run),
        elapsed = () => fleet.map((v) => v.run.snapshot().elapsed),
        portalId = (p) => `skytrain:portal:${p.stationId}:${p.id}`;
      let coplanarSources = 0;
      city.settings.mode = 'walk';
      city.navigation.cameraDistances.walk = 1.3;
      Object.defineProperty(
        city.navigation,
        'cameraDistance',
        Object.getOwnPropertyDescriptor(
          StreetNavigation.prototype,
          'cameraDistance',
        ),
      );

      const approach = (owner, portal) => {
        interactionHost.clear();
        const id = portalId(portal);
        if (portal.kind === 'platform') {
          const entrance = owner
              .streetEntrances()
              .find((e) => e.id === portal.entranceId),
            retained = () => {
              assert.equal(travel.owner, owner);
              assert.equal(travel.active, true);
              assert.ok(owner.isClearFoot(travel.foot));
            };
          // Use the same update/axes path as a person arriving from the public
          // entrance. Never coerce its naturally chosen overlapping floor ID.
          walkStationRoute(travel, [portal.point.position], retained);
          const inside = [...portal.point.position];
          inside[0] += entrance.localDirection[0] * 1.4;
          inside[2] += entrance.localDirection[2] * 1.4;
          walkStationRoute(travel, [inside, portal.point.position], retained);
          const apron = owner.floorAt(
            travel.foot.position,
            portal.point.surfaceId,
          );
          assert.ok(
            apron &&
              Math.abs(apron.position[1] - travel.foot.position[1]) <= 0.22,
          );
          if (travel.foot.surfaceId !== portal.point.surfaceId)
            coplanarSources++;
          assert.equal(
            travel
              .interactionCandidates()
              .find((p) => p.id === id)
              ?.canInteract(),
            true,
            'the physically walked apron/vestibule overlap permits portal use before a floor identity is changed',
          );
          const nearby = [...portal.point.position];
          nearby[0] -= entrance.localDirection[0] * 0.9;
          nearby[2] -= entrance.localDirection[2] * 0.9;
          walkStationRoute(travel, [nearby], retained);
          if (travel.foot.surfaceId !== portal.point.surfaceId)
            coplanarSources++;
          const yaw = Math.atan2(
            portal.point.position[0] - travel.foot.position[0],
            portal.point.position[2] - travel.foot.position[2],
          );
          let turn = Math.atan2(
            Math.sin(yaw - travel.yaw),
            Math.cos(yaw - travel.yaw),
          );
          while (Math.abs(turn) > 1e-6) {
            travel.setTouchAxes(-Math.sign(turn), 0);
            travel.update(Math.min(0.1, Math.abs(turn) / 1.65));
            retained();
            turn = Math.atan2(
              Math.sin(yaw - travel.yaw),
              Math.cos(yaw - travel.yaw),
            );
          }
          travel.clearInput();
          travel.lookYaw = travel.pitch = 0;
          travel.updateCamera();
          const candidate = travel
            .interactionCandidates()
            .find((p) => p.id === id);
          assert.ok(
            candidate &&
              projectInteractionAnchor(city.camera, candidate.anchor),
            'a normal horizontal view from the physically walked 0.9m approach projects the portal',
          );
          interactionHost.update(performance.now(), true);
          assert.equal(currentInteraction().snapshot?.id, id);
          return candidate;
        }
        for (const radius of [1.1, 1.4, 0.9, 1.8])
          for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI) / 4,
              foot = owner.walk(
                portal.point,
                Math.sin(angle) * radius,
                Math.cos(angle) * radius,
              );
            if (
              !foot ||
              !owner.isClearFoot(foot) ||
              owner.streetExit(foot) ||
              new THREE.Vector3(...foot.position).distanceTo(
                new THREE.Vector3(...portal.point.position),
              ) < 0.85
            )
              continue;
            travel.foot = foot;
            travel.yaw = Math.atan2(
              portal.point.position[0] - foot.position[0],
              portal.point.position[2] - foot.position[2],
            );
            travel.lookYaw = travel.pitch = 0;
            travel.clearInput();
            travel.updateCamera();
            const candidate = travel
              .interactionCandidates()
              .find((p) => p.id === id);
            if (
              !candidate ||
              !projectInteractionAnchor(city.camera, candidate.anchor)
            )
              continue;
            interactionHost.update(performance.now(), true);
            if (currentInteraction().snapshot?.id === id) return candidate;
          }
        assert.fail(
          `${id}: a supported nearby horizontal view must select this construction marker`,
        );
      };
      const assertFleet = (before) => {
        assert.deepEqual(travel.fleet, fleet);
        assert.deepEqual(
          fleet.map((v) => v.run),
          runs,
        );
        assert.deepEqual(
          elapsed(),
          before,
          'portal transfer never advances, resets or rebuilds a train service',
        );
      };
      for (const [index, { owner, portal }] of sources.entries()) {
        const entrance = owner
            .streetEntrances()
            .find((e) => e.id === portal.entranceId),
          exitPortal = travel.constructionAccess
            .get(owner)
            .find((p) => p.pairId === portal.pairId && p.kind === 'exit');
        assert.ok(exitPortal);
        city.navigation.mode = 'walk';
        city.navigation.position.fromArray(entrance.threshold);
        assert.equal(await travel.enter(owner.data.id), true);
        const candidate = approach(owner, portal);
        assert.equal(candidate.action, 'portalPlatform');
        const visible = currentInteraction().snapshot;
        if (index === 0) {
          const savedFoot = travel.foot,
            savedPoints = travel.constructionAccess.get(owner),
            unchanged = () => {
              assert.equal(travel.owner, owner);
              assert.equal(travel.phase, 'station');
              assert.deepEqual(travel.foot, savedFoot);
            },
            reject = (label) => {
              assert.equal(candidate.canInteract(), false, label);
              assert.equal(candidate.execute(), false, label);
              unchanged();
            };
          travel.setInputEnabled(false);
          reject('disabled input');
          travel.setInputEnabled(true);
          travel.stationSeat = owner.benchSeats()[0];
          assert.ok(travel.passengerSeated);
          reject('a seated station passenger cannot use a portal');
          travel.stationSeat = null;
          travel.occupied = fleet[0];
          reject('an occupied vehicle cannot use a portal');
          travel.occupied = null;
          assert.equal(travel.setOverview(true), true);
          reject('Overview cannot transfer the physical passenger');
          assert.equal(interactionHost.interact(visible), false);
          travel.setOverview(false);
          travel.constructionAccess.set(
            owner,
            savedPoints.map((p) => structuredClone(p)),
          );
          reject('a replaced portal inventory invalidates captured callbacks');
          travel.constructionAccess.set(owner, savedPoints);
          const supported = owner.isClearFoot;
          owner.isClearFoot = function (point) {
            return point !== portal.target.point && supported.call(this, point);
          };
          reject('fresh platform target support is mandatory');
          owner.isClearFoot = function (point) {
            return point !== savedFoot && supported.call(this, point);
          };
          reject('fresh source support is mandatory');
          owner.isClearFoot = supported;
          // Check the overlap guard independently of which equally supported
          // floor the placement adapter selected. Keep the real walked foot.
          const apronPoint = owner.floorAt(
              portal.point.position,
              entrance.surfaceId,
            ),
            overlapPortal = { ...portal, point: apronPoint };
          assert.ok(apronPoint && owner.isClearFoot(apronPoint));
          assert.notEqual(savedFoot.surfaceId, apronPoint.surfaceId);
          travel.constructionAccess.set(
            owner,
            savedPoints.map((p) => (p === portal ? overlapPortal : p)),
          );
          const overlapCandidate = travel
            .interactionCandidates()
            .find((p) => p.id === candidate.id);
          assert.equal(
            overlapCandidate?.canInteract(),
            true,
            'a naturally walked vestibule accepts an equally supported coplanar apron marker',
          );
          const stacked = {
            ...savedFoot,
            surfaceId: `supported-stacked:${savedFoot.surfaceId}`,
            layer: savedFoot.layer + 1,
            position: [...savedFoot.position],
          };
          stacked.position[1] += 0.6;
          // Model an independently supported second level over the doorway;
          // the actual apron sample remains at its original lower height.
          owner.isClearFoot = function (point) {
            return point === stacked || supported.call(this, point);
          };
          travel.foot = stacked;
          assert.equal(
            overlapCandidate.canInteract(),
            false,
            'a supported stacked surface within interaction range is not the coplanar doorway',
          );
          assert.equal(overlapCandidate.execute(), false);
          assert.deepEqual(travel.foot, stacked);
          travel.foot = savedFoot;
          owner.isClearFoot = supported;
          travel.constructionAccess.set(owner, savedPoints);
          const far = owner.walk(
            portal.point,
            -entrance.localDirection[0] * 2.6,
            -entrance.localDirection[2] * 2.6,
          );
          assert.ok(owner.isClearFoot(far));
          assert.ok(
            new THREE.Vector3(...far.position).distanceTo(
              new THREE.Vector3(...portal.point.position),
            ) > 2.2,
          );
          travel.foot = far;
          assert.equal(
            candidate.canInteract(),
            false,
            'range is freshly checked',
          );
          assert.equal(candidate.execute(), false);
          assert.deepEqual(travel.foot, far);
          travel.foot = savedFoot;
          travel.owner = travel.stations.owners.find((o) => o !== owner);
          assert.equal(
            candidate.execute(),
            false,
            'a captured portal cannot transfer a different station owner',
          );
          travel.owner = owner;
          approach(owner, portal);
        }
        const before = elapsed(),
          zoom = travel.distanceView;
        interactionHost.update(performance.now(), true);
        assert.equal(currentInteraction().snapshot?.id, candidate.id);
        const key = new Event('keydown', { cancelable: true });
        Object.assign(key, { key: 'f', code: 'KeyF', repeat: false });
        window.dispatchEvent(key);
        assert.equal(key.defaultPrevented, true);
        assert.equal(travel.owner, owner);
        assert.equal(travel.active, true);
        assert.equal(travel.aboard, false);
        assert.equal(travel.level, 'platform');
        assert.deepEqual(travel.foot, portal.target.point);
        assert.ok(owner.isClearFoot(travel.foot));
        assert.equal(travel.distanceView, zoom);
        assert.equal(travel.keys.size, 0);
        assert.deepEqual(travel.axes, { x: 0, y: 0 });
        assertFleet(before);
        const arrived = structuredClone(travel.foot);
        assert.equal(
          candidate.execute(),
          false,
          'the captured entry portal cannot be repeated from its destination',
        );
        assert.deepEqual(travel.foot, arrived);
        assert.equal(
          interactionHost.interact(visible),
          false,
          'stale mobile entry cannot transfer again',
        );

        const exit = approach(owner, exitPortal),
          exitView = currentInteraction().snapshot;
        assert.equal(exit.action, 'portalExit');
        if (index === 0) {
          const oldHeight = city.navigation.groundHeight,
            oldClear = city.navigation.clearGround,
            foot = structuredClone(travel.foot),
            position = city.navigation.position.clone();
          city.navigation.groundHeight = () => NaN;
          assert.equal(
            exit.execute(),
            false,
            'nonfinite freshly sampled street height rejects exit',
          );
          city.navigation.groundHeight = oldHeight;
          city.navigation.clearGround = () => false;
          assert.equal(
            exit.execute(),
            false,
            'unsupported street rejects exit',
          );
          city.navigation.clearGround = oldClear;
          assert.deepEqual(travel.foot, foot);
          assert.ok(city.navigation.position.equals(position));
          assert.equal(travel.owner, owner);
        }
        const beforeExit = elapsed();
        interactionHost.update(performance.now(), true);
        assert.equal(
          interactionHost.interact(exitView),
          true,
          'the common mobile prompt returns to this station outside',
        );
        assert.equal(travel.active, false);
        assert.equal(travel.owner, null);
        assert.equal(city.navigation.mode, 'walk');
        assert.ok(
          city.navigation.position.distanceTo(
            new THREE.Vector3(...exitPortal.target.position),
          ) < 0.001,
        );
        assert.equal(city.navigation.cameraDistance, zoom);
        assert.equal(
          owner.tryEnterFromStreet(city.navigation.position.toArray()),
          null,
        );
        assert.equal(city.navigation.keys.size, 0);
        assert.equal(city.navigation.touchX, 0);
        assert.equal(city.navigation.touchY, 0);
        assertFleet(beforeExit);
        assert.equal(
          exit.execute(),
          false,
          'captured return cannot execute after leaving the station',
        );
        city.navigation.update(0.1);
        tick(travel, 30);
        assert.equal(
          travel.active,
          false,
          'return remains beyond automatic re-entry after the proximity clock resumes',
        );
        assert.ok(elapsed().every((value, i) => value > beforeExit[i] + 2.9));
        assert.deepEqual(
          fleet.map((v) => v.run),
          runs,
        );
      }
      const interactions = JSON.parse(
        readFileSync('lib/i18n/interactions.json', 'utf8'),
      );
      for (const [locale, strings] of Object.entries(interactions)) {
        assert.ok(strings.portalPlatform?.length, locale);
        assert.ok(strings.portalExit?.length, locale);
      }
      t.diagnostic(
        `Naturally walked coplanar portal approaches: ${coplanarSources}`,
      );
    },
    {
      // A bounded rendered-street height fixture reproduces small curb/road
      // differences from the DEM while keeping the real owner/controller.
      groundHeight: (x, z) =>
        cityElevation(x, z) + 1.9 + Math.sin(x * 1.3 + z * 0.7) * 0.055,
    },
  );
});

test('all street routes retain WorldTravel ownership through native walking updates and reverse only through the outside doorway', async (t) => {
  await harness(async ({ travel, city }) => {
    city.settings.mode = 'walk';
    city.navigation.mode = 'walk';
    city.navigation.cameraDistance = 0;
    const cases = travel.stations.owners
      .flatMap((owner) =>
        owner.streetRoutes().map((route) => ({ owner, route })),
      )
      .sort(
        (a, b) =>
          Number(b.owner.data.id === 'main-street-science-world') -
          Number(a.owner.data.id === 'main-street-science-world'),
      );
    assert.equal(
      cases.length,
      travel.stations.owners.reduce(
        (count, owner) => count + owner.streetRoutes().length,
        0,
      ),
    );
    for (const { owner, route } of cases)
      await t.test(
        `${owner.data.id}: ${route.entranceId} to ${route.platformSurfaceId}`,
        async () => {
          const entrance = owner
              .streetEntrances()
              .find((e) => e.id === route.entranceId),
            label = `${owner.data.id}/${route.entranceId}/${route.platformSurfaceId}`;
          city.navigation.blur();
          city.navigation.mode = 'walk';
          city.navigation.position.fromArray(entrance.threshold);
          assert.equal(await travel.enter(owner.data.id), true, label);
          let walkingFrames = 0;
          const retained = () => {
            walkingFrames++;
            assert.equal(
              travel.active,
              true,
              `${label}: no automatic early street exit during the route`,
            );
            assert.equal(
              travel.owner,
              owner,
              `${label}: the same physical station owns the walker`,
            );
            assert.ok(
              travel.foot && owner.isClearFoot(travel.foot),
              `${label}: every real update retains a supported station foot`,
            );
            assert.equal(
              owner.streetExit(travel.foot),
              null,
              `${label}: only the deliberate final outward crossing may authorize leaving`,
            );
          };
          walkStationRoute(travel, route.points.slice(1), retained);
          assert.ok(walkingFrames > 20);
          assert.equal(travel.foot.surfaceId, route.platformSurfaceId);
          assert.equal(travel.snapshot().level, 'platform');
          walkStationRoute(
            travel,
            [...route.points].reverse().slice(1),
            retained,
          );
          assert.ok(
            new THREE.Vector3(...travel.interactionOrigin).distanceTo(
              new THREE.Vector3(...entrance.threshold),
            ) < 0.18,
          );

          const outwardYaw = Math.atan2(
            -entrance.localDirection[0],
            -entrance.localDirection[2],
          );
          let turn = Math.atan2(
            Math.sin(outwardYaw - travel.yaw),
            Math.cos(outwardYaw - travel.yaw),
          );
          while (Math.abs(turn) > 1e-6) {
            travel.setTouchAxes(-Math.sign(turn), 0);
            travel.update(Math.min(0.1, Math.abs(turn) / 1.65));
            retained();
            turn = Math.atan2(
              Math.sin(outwardYaw - travel.yaw),
              Math.cos(outwardYaw - travel.yaw),
            );
          }
          travel.setTouchAxes(0, 1);
          for (let i = 0; i < 20 && travel.active; i++) {
            travel.update(0.1);
            if (travel.active) retained();
          }
          assert.equal(
            travel.active,
            false,
            `${label}: native forward controls release ownership at the actual outside doorway`,
          );
          assert.equal(travel.owner, null);
          assert.equal(city.navigation.mode, 'walk');
          const local = owner.toLocal(city.navigation.position.toArray()),
            threshold = owner.toLocal(entrance.threshold),
            delta = local.map((v, i) => v - threshold[i]),
            along =
              delta[0] * entrance.localDirection[0] +
              delta[2] * entrance.localDirection[2],
            across =
              delta[0] * entrance.localDirection[2] -
              delta[2] * entrance.localDirection[0];
          assert.ok(
            along <= -2.45 && along > -2.75,
            `${label}: exit happens on the first normal walking step beyond the public boundary`,
          );
          assert.ok(Math.abs(across) < 0.2);
          assert.ok(
            Math.abs(
              city.navigation.position.y -
                city.navigation.groundHeight(
                  city.navigation.position.x,
                  city.navigation.position.z,
                ),
            ) < 0.08,
          );
          city.navigation.blur();
        },
      );
  });
});

test('Waterfront shared Expo island selects the physically nearest boarding side without moving the passenger', async () => {
  await harness(async ({ travel, city }) => {
    const owner = travel.stations.get('waterfront'),
      route = owner
        .streetRoutes()
        .find((r) =>
          owner.geometryData.platforms.some(
            (p) => p.line === 'expo' && p.surfaceId === r.platformSurfaceId,
          ),
        );
    assert.ok(route);
    const entrance = owner
      .streetEntrances()
      .find((e) => e.id === route.entranceId);
    city.settings.mode = 'walk';
    city.navigation.mode = 'walk';
    city.navigation.position.fromArray(entrance.threshold);
    assert.equal(await travel.enter('waterfront'), true);
    walkStationRoute(travel, route.points.slice(1));

    const east = owner.boardingPoint('expo', 'eastbound'),
      west = owner.boardingPoint('expo', 'westbound');
    assert.equal(
      east.surfaceId,
      west.surfaceId,
      'both sides share one island floor',
    );
    assert.ok(
      new THREE.Vector3(...east.position).distanceTo(
        new THREE.Vector3(...west.position),
      ) > 3,
    );

    for (const direction of ['eastbound', 'westbound', 'eastbound']) {
      const point = owner.boardingPoint('expo', direction);
      walkStationRoute(travel, [point.position]);
      assert.equal(travel.line, 'expo');
      assert.equal(
        travel.direction,
        direction,
        `walking to the ${direction} edge selects its service`,
      );
      assert.equal(travel.foot.surfaceId, point.surfaceId);
      assert.equal(travel.snapshot().level, 'platform');
      assert.ok(owner.isClearFoot(travel.foot));

      const before = [...travel.foot.position];
      // An earlier selection on this shared floor must not override physical
      // proximity, and correcting selection must never snap a local foot pose.
      travel.direction = direction === 'eastbound' ? 'westbound' : 'eastbound';
      tick(travel);
      assert.equal(travel.line, 'expo');
      assert.equal(travel.direction, direction);
      assert.deepEqual(
        travel.foot.position,
        before,
        'side selection preserves foot XYZ exactly',
      );
    }
  });
});

test('every authored SkyTrain door boards its actual carriage and retained seats alight from that carriage at the next station', async (t) => {
  for (const [line, outbound, carCount] of [
    ['expo', 'eastbound', 4],
    ['canada', 'southbound', 2],
  ])
    await t.test(
      `${line}: all source doors and ${carCount} moving passenger cars`,
      async () => {
        await harness(
          async ({ travel, city, interactionHost, currentInteraction }) => {
            const owner = travel.stations.get('waterfront'),
              routes = worldData.routes.filter((r) => r.lineId === line),
              vehicle = travel.fleet.find((v) => v.state.route.lineId === line),
              train = await actualTrain(line),
              offsets = new Map();
            vehicle.detail = train;
            vehicle.prepared = true;
            city.scene.add(train.group);
            travel.captureLights(train.group);
            city.settings.mode = 'walk';
            city.navigation.mode = 'walk';
            travel.distanceView = 0;

            const stopAtWaterfront = (direction) => {
              if (!offsets.has(direction)) {
                const probe = new WorldSkyTrainRun(routes[0], routes[1]);
                let found = false;
                for (
                  let elapsed = 0;
                  elapsed < probe.cycleDurationSeconds;
                  elapsed += 0.25
                ) {
                  const state = probe.snapshot();
                  if (
                    state.route.direction === direction &&
                    state.route.stops[state.stopIndex].stationId ===
                      'waterfront' &&
                    state.phase === 'dwell'
                  ) {
                    offsets.set(direction, state.elapsed);
                    found = true;
                    break;
                  }
                  probe.advance(0.25);
                }
                assert.ok(
                  found,
                  `real ${line} ${direction} service calls at Waterfront`,
                );
              }
              vehicle.run = new WorldSkyTrainRun(
                routes[0],
                routes[1],
                offsets.get(direction),
              );
              vehicle.state = vehicle.run.snapshot();
              for (let i = 0; i < 8; i++) travel.applyPose(vehicle, 0.1);
            };
            const placeSupportedDoorFixture = (direction, door) => {
              // The separate public-walking cases exercise street and platform
              // reachability. Each transfer case starts at an independently proven
              // authored waiting floor, so every outer door gets the same scrutiny.
              assert.ok(owner.isClearFoot(door.waiting));
              travel.owner = owner;
              travel.station = 'waterfront';
              travel.phase = 'station';
              travel.level = 'platform';
              travel.line = line;
              travel.direction = direction;
              travel.foot = structuredClone(door.waiting);
              travel.yaw = door.waiting.yaw;
              travel.lookYaw = travel.pitch = 0;
              travel.clearInput();
              stopAtWaterfront(direction);
              travel.updateCamera();
            };
            const boardDoor = (direction, door) => {
              placeSupportedDoorFixture(direction, door);
              const before = new THREE.Vector3(...travel.interactionOrigin),
                prompt = travel
                  .interactionCandidates()
                  .find((p) => p.action === 'board');
              assert.ok(
                prompt,
                `${line} car ${door.carIndex} door ${door.carDoor[2]} exposes F`,
              );
              assert.ok(
                projectInteractionAnchor(city.camera, prompt.anchor),
                'normal horizontal door view keeps the board anchor onscreen',
              );
              interactionHost.update(performance.now(), true);
              assert.equal(currentInteraction().snapshot?.id, prompt.id);
              const key = new Event('keydown', { cancelable: true });
              Object.assign(key, { key: 'f', code: 'KeyF', repeat: false });
              window.dispatchEvent(key);
              assert.equal(
                key.defaultPrevented,
                true,
                'the actual CityInteractions F listener dispatches boarding',
              );
              assert.equal(train.passengerCarIndex, door.carIndex);
              assert.equal(travel.cabinFoot[2], door.carDoor[2]);
              assert.ok(train.passengerSpace.clear(travel.cabinFoot));
              train.group.updateMatrixWorld(true);
              const frame = train.passengerFrame,
                outward = new THREE.Vector3(
                  Math.sign(door.carDoor[0]),
                  0,
                  0,
                ).transformDirection(frame.matrixWorld);
              for (const height of [0.35, 1, 1.7])
                for (const radiusOffset of [-0.19, 0, 0.19]) {
                  const origin = new THREE.Vector3(
                      0,
                      train.floorAboveRail + height,
                      door.carDoor[2] + radiusOffset,
                    ).applyMatrix4(frame.matrixWorld),
                    hits = new THREE.Raycaster(
                      origin,
                      outward,
                      0.5,
                      1.8,
                    ).intersectObject(train.group, true);
                  assert.equal(
                    hits.length,
                    0,
                    `${line} car ${door.carIndex} actual open door ${door.carDoor[2]} clears the rider body at ${height}m/${radiusOffset}m: ${hits.map((h) => h.object.name).join(', ')}`,
                  );
                }
              assert.ok(
                before.distanceTo(
                  new THREE.Vector3(...travel.interactionOrigin),
                ) < 2.1,
                `boarding ${line} car ${door.carIndex} door ${door.carDoor[2]} crosses only its physical threshold; distance ${before.distanceTo(new THREE.Vector3(...travel.interactionOrigin))}`,
              );
              assert.ok(
                new THREE.Vector3(...travel.interactionOrigin).distanceTo(
                  new THREE.Vector3(...travel.cabinFoot).applyMatrix4(
                    train.passengerFrame.matrixWorld,
                  ),
                ) < 0.001,
              );
            };

            let doorCount = 0;
            for (const route of routes) {
              const doors = owner.boardingDoors(line, route.direction);
              assert.equal(doors.length, carCount * 3);
              assert.deepEqual(
                new Set(doors.map((d) => d.carIndex)),
                new Set(Array.from({ length: carCount }, (_, i) => i)),
              );
              for (const door of doors) {
                boardDoor(route.direction, door);
                const before = new THREE.Vector3(...travel.interactionOrigin),
                  exit = travel
                    .interactionCandidates()
                    .find((p) => p.action === 'alight');
                assert.ok(exit);
                travel.yaw = Math.atan2(
                  door.carDoor[0] - travel.cabinFoot[0],
                  door.carDoor[2] - travel.cabinFoot[2],
                );
                travel.lookYaw = travel.pitch = 0;
                travel.updateCamera();
                assert.ok(
                  projectInteractionAnchor(city.camera, exit.anchor),
                  'normal horizontal view from the door spawn keeps alighting onscreen',
                );
                interactionHost.update(performance.now(), true);
                assert.equal(currentInteraction().snapshot?.id, exit.id);
                assert.equal(
                  interactionHost.interact(currentInteraction().snapshot),
                  true,
                  'the actual touch dispatcher exits through this door',
                );
                assert.deepEqual(travel.foot.position, door.waiting.position);
                assert.ok(
                  before.distanceTo(
                    new THREE.Vector3(...travel.interactionOrigin),
                  ) < 2.1,
                );
                doorCount++;
              }
            }
            assert.equal(doorCount, carCount * 6);

            for (let carIndex = 0; carIndex < carCount; carIndex++) {
              const door = owner
                .boardingDoors(line, outbound)
                .find(
                  (d) => d.carIndex === carIndex && Math.abs(d.carDoor[2]) > 4,
                );
              assert.ok(door);
              boardDoor(outbound, door);
              const frame = train.passengerFrame,
                seat = walkCabinTo(travel, (point, space) =>
                  space.seats.find((s) => space.canSit(s, point)),
                ),
                sit = travel
                  .interactionCandidates()
                  .find((p) => p.id.endsWith(seat.id));
              assert.ok(sit && sit.execute());
              const before = city.navigation.position.clone();
              let arrived = false,
                movingFrames = 0;
              for (let i = 0; i < 5000; i++) {
                travel.update(0.1);
                assert.equal(travel.occupied, vehicle);
                assert.equal(travel.train, train);
                assert.equal(train.passengerCarIndex, carIndex);
                assert.equal(train.passengerFrame, frame);
                assert.equal(travel.cabinSeat, seat);
                assert.ok(
                  city.navigation.position.distanceTo(
                    new THREE.Vector3(
                      ...train.passengerPointToWorld(seat.position),
                    ),
                  ) < 0.001,
                );
                assert.ok(
                  city.navigation.walker.group.position.distanceTo(
                    city.navigation.position,
                  ) < 0.001,
                );
                const seatEye = new THREE.Vector3(),
                  seatFrame = new THREE.Quaternion();
                train.passengerWorldPose(seatEye, seatFrame);
                assert.ok(city.camera.position.distanceTo(seatEye) < 0.001);
                assert.ok(
                  seatFrame.angleTo(
                    frame.getWorldQuaternion(new THREE.Quaternion()),
                  ) < 0.00001,
                );
                if (vehicle.state.phase === 'moving') movingFrames++;
                if (
                  travel.station !== 'waterfront' &&
                  travel.owner &&
                  vehicle.state.phase === 'dwell' &&
                  train.doorsClear
                ) {
                  arrived = true;
                  break;
                }
              }
              assert.ok(arrived && movingFrames > 20);
              assert.ok(city.navigation.position.distanceTo(before) > 50);
              assert.equal(travel.stand(), true);
              const destination = travel.owner,
                matchingDoor = destination
                  .boardingDoors(line, travel.direction)
                  .find(
                    (d) =>
                      d.carIndex === carIndex &&
                      d.carDoor.every(
                        (v, i) => Math.abs(v - door.carDoor[i]) < 0.001,
                      ),
                  );
              assert.ok(matchingDoor);
              walkCabinTo(
                travel,
                (point) =>
                  new THREE.Vector3(...point).distanceTo(
                    new THREE.Vector3(...matchingDoor.carDoor),
                  ) < 1.2,
              );
              const beforeExit = new THREE.Vector3(...travel.interactionOrigin),
                exit = travel
                  .interactionCandidates()
                  .find((p) => p.action === 'alight');
              assert.ok(
                exit,
                `${line} car ${carIndex} has its own reachable future-station exit`,
              );
              assert.equal(exit.execute(), true);
              assert.equal(travel.owner, destination);
              assert.deepEqual(
                travel.foot.position,
                matchingDoor.waiting.position,
              );
              assert.ok(
                beforeExit.distanceTo(
                  new THREE.Vector3(...travel.interactionOrigin),
                ) < 2.1,
              );
            }
          },
        );
      },
    );
});

/** Keep the production key and touch state on both input authorities. Entry
 * clears the old authority, so these checks must move without a second press. */
test('held keyboard and touch input cross the street/station boundaries without stopping or relatching', async (t) => {
  await harness(async ({ travel, city, canvas }) => {
    const nav = city.navigation,
      owner = travel.stations.get('waterfront');
    const entrance = owner.streetEntrances()[0],
      inward = entrance.localDirection;
    const inwardYaw = Math.atan2(inward[0], inward[2]);
    const rotateOutward = () => {
      const desired = inwardYaw + Math.PI;
      let delta = Math.atan2(
        Math.sin(desired - travel.yaw),
        Math.cos(desired - travel.yaw),
      );
      while (Math.abs(delta) > 1e-7) {
        travel.setTouchAxes(-Math.sign(delta), 0);
        travel.update(Math.min(0.1, Math.abs(delta) / 1.65));
        delta = Math.atan2(
          Math.sin(desired - travel.yaw),
          Math.cos(desired - travel.yaw),
        );
      }
      travel.setTouchAxes(0, 0);
    };
    const prepareStreetApproach = () => {
      city.settings.mode = 'walk';
      nav.mode = 'walk';
      nav.blur();
      nav.position.fromArray(entrance.threshold);
      nav.yaw = owner.yaw + inwardYaw;
      nav.pitch = 0.17;
      travel.clearInput();
    };
    await t.test(
      'held W moves immediately after automatic entry and resumes actual street navigation after exit',
      () => {
        prepareStreetApproach();
        nav.keys.add('w');
        const outside = nav.position.clone();
        travel.update(0.1);
        assert.equal(travel.active, true);
        assert.equal(nav.mode, 'orbit');
        assert.equal(
          nav.keys.size,
          0,
          'the old navigation authority is cleared',
        );
        assert.equal(
          travel.keys.has('KeyW'),
          true,
          'the active owner retains held W',
        );
        assert.equal(
          travel.pitch,
          -0.17,
          'look pitch uses the station convention without snapping',
        );
        const entered = new THREE.Vector3(...travel.interactionOrigin);
        assert.ok(
          entered.distanceTo(outside) > 0.2,
          'the entry frame consumes the held W input',
        );
        travel.update(0.1);
        assert.ok(
          new THREE.Vector3(...travel.interactionOrigin).distanceTo(entered) >
            0.2,
          'W continues without another keydown',
        );
        const release = new Event('keyup');
        Object.defineProperty(release, 'code', { value: 'KeyW' });
        window.dispatchEvent(release);
        rotateOutward();
        for (const [type, values] of [
          ['pointerdown', { button: 0, pointerId: 4, clientX: 0, clientY: 0 }],
          ['pointermove', { pointerId: 4, clientX: 31, clientY: 17 }],
          ['pointerup', { pointerId: 4 }],
        ]) {
          const event = new Event(type, { cancelable: true });
          for (const [key, value] of Object.entries(values))
            Object.defineProperty(event, key, { value });
          canvas.dispatchEvent(event);
        }
        assert.ok(
          Math.abs(travel.lookYaw) > 0.1,
          'the passenger can look aside before crossing the exit',
        );
        assert.ok(
          Math.abs(travel.pitch + 0.17) > 0.04,
          'current look pitch differs from the original street pose',
        );
        const press = new Event('keydown', { cancelable: true });
        Object.defineProperty(press, 'code', { value: 'KeyW' });
        window.dispatchEvent(press);
        assert.equal(travel.keys.has('KeyW'), true);
        const expectedPitch = -travel.pitch,
          expectedYaw = owner.yaw + travel.yaw + travel.lookYaw;
        for (let i = 0; i < 80 && travel.active; i++) travel.update(0.1);
        assert.equal(
          travel.active,
          false,
          'held W physically walks back through the same street opening',
        );
        assert.equal(nav.mode, 'walk');
        assert.equal(nav.keys.has('w'), true);
        assert.equal(
          travel.keys.size,
          0,
          'the station authority releases transferred input',
        );
        assert.ok(Math.abs(nav.pitch - expectedPitch) < 1e-6);
        assert.ok(Math.abs(nav.yaw - expectedYaw) < 1e-6);
        const resumed = nav.position.clone();
        nav.update(0.05);
        assert.ok(
          Math.hypot(nav.position.x - resumed.x, nav.position.z - resumed.z) >
            0.19,
          'production StreetNavigation keeps walking on the first resumed frame',
        );
        nav.blur();
      },
    );
    await t.test(
      'a still-held mobile axis survives entry, continuous joystick steering, and exit',
      () => {
        prepareStreetApproach();
        nav.setTouchAxes(0.18, 0.8);
        const outside = nav.position.clone();
        travel.update(0.1);
        assert.equal(travel.active, true);
        assert.equal(nav.touchX, 0);
        assert.equal(nav.touchY, 0);
        assert.deepEqual(travel.axes, { x: 0.18, y: 0.8 });
        assert.ok(
          new THREE.Vector3(...travel.interactionOrigin).distanceTo(outside) >
            0.15,
        );
        const entered = new THREE.Vector3(...travel.interactionOrigin);
        travel.update(0.1);
        assert.ok(
          new THREE.Vector3(...travel.interactionOrigin).distanceTo(entered) >
            0.15,
          'the finger need not move again after entry',
        );
        rotateOutward();
        travel.setTouchAxes(0.06, 0.8);
        const heldAxes = { ...travel.axes },
          expectedPitch = -travel.pitch;
        for (let i = 0; i < 80 && travel.active; i++) travel.update(0.1);
        assert.equal(
          travel.active,
          false,
          'the same joystick owner walks through the physical exit',
        );
        assert.equal(nav.mode, 'walk');
        assert.equal(nav.touchX, heldAxes.x);
        assert.equal(nav.touchY, heldAxes.y);
        assert.deepEqual(travel.axes, { x: 0, y: 0 });
        assert.equal(nav.pitch, expectedPitch);
        const resumed = nav.position.clone();
        nav.update(0.05);
        assert.ok(
          Math.hypot(nav.position.x - resumed.x, nav.position.z - resumed.z) >
            0.15,
          'production street movement continues from the transferred mobile axes',
        );
        nav.setTouchAxes(0, 0);
        const released = nav.position.clone();
        nav.update(0.05);
        assert.ok(
          Math.hypot(nav.position.x - released.x, nav.position.z - released.z) <
            1e-7,
          'releasing the persistent joystick clears the active authority',
        );
      },
    );
  });
});

test('one persistent public joystick callback routes held and release input to the current world, bus or street owner', async () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  const source = ts.createSourceFile(
    'page.tsx',
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback = null,
    joysticks = 0;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'touchMove' &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0];
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(source) === 'TravelJoystick'
    )
      joysticks++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback);
  assert.equal(
    joysticks,
    1,
    'station/bus ownership changes retain a single mounted public joystick',
  );
  assert.equal(
    readFileSync('components/transit-world-status.tsx', 'utf8').includes(
      '<TravelJoystick',
    ),
    false,
    'the HUD does not mount a competing joystick during handoff',
  );
  const code = ts.transpileModule(
    `export const createRouter = engine => (${callback.getText(source)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const { createRouter } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  const calls = [];
  const city = {
    navigation: {
      setTouchAxes(x, y) {
        calls.push(['street', x, y]);
      },
    },
    skyTrainTravel: {
      active: false,
      setTouchAxes(x, y) {
        calls.push(['station', x, y]);
      },
    },
    busVisit: {
      aboard: false,
      setTouchAxes(x, y) {
        calls.push(['bus', x, y]);
      },
    },
  };
  const router = createRouter({ current: city });
  router(0.2, 0.8);
  city.skyTrainTravel.active = true;
  router(0.2, 0.8);
  router(0, 0);
  city.skyTrainTravel.active = false;
  city.busVisit.aboard = true;
  router(-0.2, 0.9);
  router(0, 0);
  city.busVisit.aboard = false;
  router(0.1, 0.7);
  router(0, 0);
  assert.deepEqual(calls, [
    ['street', 0.2, 0.8],
    ['station', 0.2, 0.8],
    ['station', 0, 0],
    ['bus', -0.2, 0.9],
    ['bus', 0, 0],
    ['street', 0.1, 0.7],
    ['street', 0, 0],
  ]);
});
