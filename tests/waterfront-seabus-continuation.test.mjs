import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { disposeGroup } from './helpers/landmark-test-utils.mjs';

const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);
const { PublicInteriors } = await import(cityModule('interiors'));
const { StreetNavigation } = await import(cityModule('navigation'));
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const { createSkyTrainGuidewayUniforms } = await import(
  cityModule('skytrain-guideway-clearance')
);
const packet = JSON.parse(
  readFileSync('public/models/skytrain-stations/waterfront.json'),
);
const routes = validateSkyTrainRoutes(
  JSON.parse(readFileSync('public/models/skytrain-routes.json')),
);
const adapted = () =>
  adaptSkyTrainStationFrame(structuredClone(packet), routes);

// Independently derive the portal from the published floor, not a runtime
// private helper or an untranslated authoring coordinate.
function portal(owner) {
  const link = owner.geometryData.authoredInterior.publicInteriorLinks[0],
    floor = owner.geometryData.floors.find((f) => f.id === link.surfaceId),
    end = new THREE.Vector3(...floor.vertices[link.endEdge[0]])
      .add(new THREE.Vector3(...floor.vertices[link.endEdge[1]]))
      .multiplyScalar(0.5),
    other = floor.vertices.filter((_, i) => !link.endEdge.includes(i)),
    start = new THREE.Vector3(...other[0])
      .add(new THREE.Vector3(...other[1]))
      .multiplyScalar(0.5),
    inward = start.sub(end).setY(0).normalize();
  return { link, inward, local: end.addScaledVector(inward, link.insetM) };
}

test('the public continuation derives from the rendered flat floor and keeps four mapped street doors', () => {
  const owner = new SkyTrainStationOwner(
    adapted(),
    cityElevation,
    'balanced',
    true,
  );
  try {
    assert.equal(owner.streetEntrances().length, 4);
    assert(!owner.streetEntrances().some((e) => e.id.includes('seabus')));
    const p = portal(owner),
      at = (along) =>
        owner.toWorld(
          p.local.clone().addScaledVector(p.inward, along).toArray(),
        );
    for (const along of [-0.1, 0, 0.5, 1.7]) {
      const world = at(along);
      // Graded support must be read from the actual floor triangles.
      const local = owner.toLocal(world),
        floor = owner.floorAt(local);
      assert(floor, `actual continuation support ${along}`);
      const foot = owner.tryEnterFromStreet(owner.toWorld(floor));
      assert(foot && owner.isClearFoot(foot), `clear entry ${along}`);
    }
    for (const offset of [0.221, -0.221, 2]) {
      const world = at(0);
      world[1] += offset;
      assert.equal(
        owner.tryEnterFromStreet(world),
        null,
        'no vertical snap or wrong-level acquisition',
      );
    }
    for (const along of [-0.55, -0.35, -0.16, 1.81])
      assert.equal(
        owner.tryEnterFromStreet(at(along)),
        null,
        `outside entry interval ${along}`,
      );
    const releaseLocal = p.local
        .clone()
        .addScaledVector(p.inward, -0.4)
        .toArray(),
      release = owner.floorAt(releaseLocal, p.link.surfaceId);
    assert(release && owner.isClearFoot(release));
    assert.deepEqual(
      owner.streetExit(release),
      owner.toWorld(release),
      'release returns the exact foot height',
    );
    assert.equal(
      owner.tryEnterFromStreet(owner.toWorld(release)),
      null,
      'release cannot reacquire without walking inward',
    );
    const wrongFloor = {
      ...release,
      position: [
        release.position[0],
        release.position[1] + 3,
        release.position[2],
      ],
    };
    assert.equal(owner.streetExit(wrongFloor), null);
    const side = p.local
      .clone()
      .add(new THREE.Vector3(p.inward.z, 0, -p.inward.x).multiplyScalar(2.05));
    assert.equal(
      owner.tryEnterFromStreet(owner.toWorld(side.toArray())),
      null,
      'body cannot enter through side walls',
    );
    assert.equal(owner.isClearBody([NaN, 0, 0]), false);
  } finally {
    owner.dispose();
  }
});

test('invalid continuation metadata fails closed and an unrendered overlap grants no portal', () => {
  for (const mutate of [
    (d) => {
      d.authoredInterior.publicInteriorLinks[0].surfaceId = 'missing';
    },
    (d) => {
      d.authoredInterior.publicInteriorLinks[0].endEdge = [1, 9];
    },
    (d) => {
      d.authoredInterior.publicInteriorLinks[0].insetM = 0.2;
    },
    (d) => {
      d.authoredInterior.publicInteriorLinks[0].widthM = 20;
    },
    (d) => {
      d.floors.find(
        (f) => f.id === d.authoredInterior.publicInteriorLinks[0].surfaceId,
      ).vertices[1][1] += 0.1;
    },
  ]) {
    const data = adapted();
    mutate(data);
    assert.throws(() => validateRuntimeStation(data), /Invalid runtime/);
  }
  const data = adapted(),
    id = data.authoredInterior.publicInteriorLinks[0].surfaceId;
  data.parts = data.parts.filter((p) => p.id !== `floor-${id}`);
  const owner = new SkyTrainStationOwner(data, cityElevation, 'balanced', true);
  try {
    const p = portal(owner);
    assert.equal(
      owner.tryEnterFromStreet(owner.toWorld(p.local.toArray())),
      null,
    );
  } finally {
    owner.dispose();
  }
});

class Canvas extends EventTarget {
  setAttribute() {}
  focus() {}
  closest() {
    return null;
  }
}
async function nativeFixture(run) {
  const saved = new Map(
    ['window', 'document', 'Element', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ getContext: () => null }),
  });
  globalThis.Element = Canvas;
  globalThis.fetch = async (url) => {
    if (typeof url !== 'string') throw new Error('Expected local string URL');
    return {
      ok: true,
      json: async () => JSON.parse(readFileSync('public' + url)),
    };
  };
  const city = {
    scene: new THREE.Scene(),
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3(), enabled: true, update() {} },
    renderer: { domElement: new Canvas() },
    settings: {
      mode: 'walk',
      quality: 'balanced',
      trains: false,
      buildings: true,
    },
    elevation: cityElevation,
    data: {},
    onLand: () => true,
    uniforms: {
      ...createSkyTrainGuidewayUniforms(),
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
    },
    busVisit: { aboard: false, blocksGround: () => false },
    contextLost: false,
    pageSuspended: false,
  };
  const nav = {
    e: city,
    mode: 'walk',
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    cameraDistance: 0,
    renderedDistance: 0,
    cameraDistances: { walk: 0 },
    keys: new Set(),
    touchX: 0,
    touchY: 0,
    speed: 0,
    surface: 'ground',
    walkingDistance: 0,
    walker: { group: new THREE.Group(), setSeated() {}, update() {} },
    car: new THREE.Group(),
    collisions: new Map(),
    groundSurface: null,
    blur() {
      this.keys.clear();
      this.setTouchAxes(0, 0);
      this.speed = 0;
    },
    setTouchAxes: StreetNavigation.prototype.setTouchAxes,
    update: StreetNavigation.prototype.update,
    move: StreetNavigation.prototype.move,
    moveGround: StreetNavigation.prototype.moveGround,
    blocked: StreetNavigation.prototype.blocked,
    clearGround: StreetNavigation.prototype.clearGround,
    groundHeight: StreetNavigation.prototype.groundHeight,
    walkingHeight: StreetNavigation.prototype.walkingHeight,
    roadHeight(x, z) {
      return this.groundHeight(x, z);
    },
    reachableDeck() {
      return undefined;
    },
    impactBuilding() {},
    finishReturnBlend() {},
    updateCockpit() {},
    notifyCamera() {},
  };
  city.navigation = nav;
  city.scene.add(city.landmarks);
  const doc = globalThis.document;
  delete globalThis.document;
  try {
    city.interiors = new PublicInteriors(city);
  } finally {
    globalThis.document = doc;
  }
  const travel = new SkyTrainWorldTravel(city);
  city.skyTrainTravel = travel;
  travel.routeData = routes;
  try {
    const owner = await travel.stations.ensure('waterfront');
    travel.ready = true;
    city.interiors.update();
    city.scene.updateMatrixWorld(true);
    const site = city.interiors.sites.find((s) => s.id === 'waterfront');
    await run({ city, nav, travel, owner, site });
  } catch (error) {
    error.stack = `${error.name}: ${error.message}`;
    throw error;
  } finally {
    travel.dispose();
    disposeGroup(city.landmarks);
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('native city frame offsets can enter directly onto the adjacent real grade without skipping the short flat overlap', async () => {
  for (const initialAlong of [-0.29, -0.11, 0.05, 0.22])
    await nativeFixture(({ city, nav, travel, owner }) => {
      const p = portal(owner),
        start = new THREE.Vector3(
          ...owner.toWorld(
            p.local.clone().addScaledVector(p.inward, initialAlong).toArray(),
          ),
        ),
        worldInward = p.inward.clone().applyQuaternion(owner.group.quaternion);
      start.y = city.interiors.height(start.x, start.z);
      assert(Number.isFinite(start.y));
      nav.position.copy(start);
      nav.yaw = Math.atan2(worldInward.x, worldInward.z);
      nav.keys.add('w');
      nav.update(0.05);
      const eligible = owner.tryEnterFromStreet([
        nav.position.x,
        nav.walkingHeight(),
        nav.position.z,
      ]);
      assert(eligible);
      assert.equal(
        eligible.surfaceId,
        initialAlong < -0.2
          ? p.link.surfaceId
          : 'waterfront-seabus-heritage-connector-0',
      );
      travel.update(0.05);
      assert(travel.active, `supported native frame offset ${initialAlong}`);
      assert(owner.isClearFoot(travel.foot));
      assert.equal(
        travel.foot.surfaceId,
        'waterfront-seabus-heritage-connector-0',
      );
      assert(travel.keys.has('KeyW'));
      const before = new THREE.Vector3(...travel.interactionOrigin);
      travel.update(0.05);
      assert(
        new THREE.Vector3(...travel.interactionOrigin).distanceTo(before) >
          0.12,
        'no second input or yaw assignment is needed after native handoff',
      );
    });
});

for (const input of ['keyboard', 'touch'])
  test(`SeaBus ${input}: native walking crosses the real graded connector both ways without a Y warp or ownership pingpong`, async () => {
    await nativeFixture(({ city, nav, travel, owner, site }) => {
      const p = portal(owner),
        worldPortal = new THREE.Vector3(...owner.toWorld(p.local.toArray())),
        worldInward = p.inward.clone().applyQuaternion(owner.group.quaternion),
        legacyWaypoints = [
          [-6, -43],
          [9, -140],
          [10, -146],
          [19, -172],
          [27, -192],
          [29, -197],
          [35, -220],
        ],
        point = ([x, z]) => {
          const [wx, wz] = city.interiors.world(site, x, z);
          return new THREE.Vector3(wx, city.interiors.height(wx, wz), wz);
        },
        trace = [];
      nav.position.copy(point(legacyWaypoints.at(-1)));
      if (input === 'keyboard') nav.keys.add('w');
      else nav.setTouchAxes(0, 1);
      assert.equal(
        city.interiors.clear(nav.position.x, nav.position.z, 'walk'),
        true,
      );
      let transitions = 0,
        lastActive = false;
      const position = () =>
        travel.active
          ? new THREE.Vector3(...travel.interactionOrigin)
          : new THREE.Vector3(
              nav.position.x,
              nav.walkingHeight(),
              nav.position.z,
            );
      const moveTo = (goal) => {
        const heading = goal.clone().sub(position()),
          yaw = Math.atan2(heading.x, heading.z);
        // Change heading only at a physical route corner. Neither yaw nor
        // held input is rewritten after either automatic ownership handoff.
        if (travel.active) {
          travel.yaw = yaw - owner.yaw;
          travel.lookYaw = 0;
        } else nav.yaw = yaw;
        for (let frame = 0; frame < 4000; frame++) {
          const before = position(),
            delta = goal.clone().sub(before).setY(0),
            distance = delta.length();
          if (distance < 0.025) return;
          const dt = Math.min(0.05, distance / (travel.active ? 2.5 : 4));
          if (!travel.active) nav.update(dt);
          travel.update(dt);
          const after = position();
          assert(
            Math.abs(after.y - before.y) <= 0.221,
            `actual floor continuity ${before.y}→${after.y}`,
          );
          assert(
            Math.hypot(after.x - before.x, after.z - before.z) > 0.001,
            `native body stalled at ${JSON.stringify(after.toArray())} toward ${JSON.stringify(goal.toArray())}`,
          );
          if (travel.active)
            assert(
              owner.isClearFoot(travel.foot),
              'all owned frames retain the full capsule',
            );
          else
            assert.equal(
              city.interiors.clear(after.x, after.z, 'walk'),
              true,
              'retained public floor/collision supports every city frame',
            );
          if (travel.active !== lastActive) {
            transitions++;
            trace.push({ active: travel.active, position: after.toArray() });
            lastActive = travel.active;
          }
        }
        assert.fail(
          `native route failed to reach ${JSON.stringify(goal.toArray())}`,
        );
      };
      // One initial terminal placement; every subsequent coordinate is reached
      // using production movement, automatic ownership and retained input.
      for (const waypoint of legacyWaypoints.slice(0, -1).reverse())
        moveTo(point(waypoint));
      moveTo(worldPortal.clone().addScaledVector(worldInward, -1.2));
      moveTo(worldPortal.clone().addScaledVector(worldInward, 10.1));
      assert(
        travel.active,
        'SeaBus pedestrian reaches the authored heritage hall',
      );
      assert.equal(travel.foot.surfaceId, 'waterfront-heritage-hall');
      assert.equal(
        transitions,
        1,
        'exactly one entry from the retained bridge',
      );
      assert(
        input === 'keyboard' ? travel.keys.has('KeyW') : travel.axes.y === 1,
        'held input survives transfer',
      );
      moveTo(worldPortal.clone().addScaledVector(worldInward, -1.2));
      assert(
        !travel.active,
        'walking outward returns to the real public SkyWalk',
      );
      assert.equal(
        transitions,
        2,
        'one physical exit, without reacquiring the station',
      );
      assert(
        input === 'keyboard' ? nav.keys.has('w') : nav.touchY === 1,
        'held input continues in StreetNavigation',
      );
      for (const waypoint of legacyWaypoints) moveTo(point(waypoint));
      assert.equal(
        transitions,
        2,
        'entire SeaBus return remains outside the station owner',
      );
      assert(
        Math.abs(nav.walkingHeight() - 4.52) < 1e-6,
        'original SeaBus lounge datum is preserved',
      );
      assert.equal(owner.streetEntrances().length, 4);
      assert.equal(trace.length, 2);
    });
  });
