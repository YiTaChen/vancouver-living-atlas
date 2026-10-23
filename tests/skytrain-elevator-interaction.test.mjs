import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import {
  SOURCE,
  makeRuntimeStation,
} from '../tools/build-skytrain-runtime-stations.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../tools/station-interiors/dunsmuir.mjs';
import {
  rebuildStadium,
  rebuildYaletown,
} from '../tools/station-interiors/southeast.mjs';
import { planFlat } from './helpers/station-walker.mjs';

const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { CityInteractions } = await import(cityModule('city-interactions'));
const { createSkyTrainGuidewayUniforms } = await import(
  cityModule('skytrain-guideway-clearance')
);
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const sources = JSON.parse(readFileSync(SOURCE)).stations;
const routes = validateSkyTrainRoutes(
  JSON.parse(readFileSync('public/models/skytrain-routes.json')),
);
class Canvas extends EventTarget {
  setAttribute() {}
  focus() {}
  closest() {
    return null;
  }
}

async function harness(
  run,
  { stationId = 'burrard', rebuild = rebuildBurrard } = {},
) {
  const saved = new Map(
    ['window', 'document', 'Element'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: () => ({ getContext: () => null }),
  });
  globalThis.Element = Canvas;
  const city = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(65, 1.5, 0.05, 2000),
    controls: { target: new THREE.Vector3(), enabled: true, update() {} },
    renderer: { domElement: new Canvas() },
    settings: {
      mode: 'walk',
      quality: 'balanced',
      trains: true,
      buildings: true,
    },
    elevation: cityElevation,
    contextLost: false,
    pageSuspended: false,
    uniforms: {
      ...createSkyTrainGuidewayUniforms(),
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
    },
    data: {},
    navigation: {
      mode: 'walk',
      position: new THREE.Vector3(),
      yaw: 0,
      pitch: 0.04,
      cameraDistance: 4,
      walker: { group: new THREE.Group(), setSeated() {}, update() {} },
      groundHeight: cityElevation,
      walkingHeight() {
        return this.position.y;
      },
      keys: new Set(),
      setTouchAxes() {},
      blur() {},
    },
  };
  const runtime = adaptSkyTrainStationFrame(
      makeRuntimeStation(
        rebuild(sources.find((s) => s.stationId === stationId)),
        'a'.repeat(64),
      ),
      routes,
    ),
    owner = new SkyTrainStationOwner(runtime, cityElevation, 'balanced', true),
    travel = new SkyTrainWorldTravel(city);
  city.scene.add(owner.group);
  city.skyTrainTravel = travel;
  const host = new CityInteractions(city);
  city.interactions = host;
  let view;
  host.onChange = (value) => {
    view = value;
  };
  host.setInputEnabled(true);
  travel.owner = owner;
  travel.station = stationId;
  travel.phase = 'station';
  travel.distanceView = 0;
  const connections = owner.geometryData.connections.filter(
    (c) => c.type === 'elevator',
  );
  assert(
    connections.length > 0,
    'the real accessible shaft serves authored landings',
  );
  travel.foot = owner.floorAt(connections[0].start, connections[0].from);
  assert(owner.isClearFoot(travel.foot));
  try {
    await run({ city, owner, travel, host, connections, view: () => view });
  } catch (error) {
    error.stack = `${error.name}: ${error.message}`;
    throw error;
  } finally {
    host.dispose();
    travel.dispose();
    owner.dispose();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const elevatorCandidates = (travel) =>
  travel
    .interactionCandidates()
    .filter((c) => c.id.startsWith('skytrain:elevator:'));
function walkTo(travel, goal) {
  for (let i = 0; i < 1000; i++) {
    const dx = goal[0] - travel.foot.position[0],
      dz = goal[2] - travel.foot.position[2],
      distance = Math.hypot(dx, dz);
    if (distance < 0.025) {
      travel.setTouchAxes(0, 0);
      return;
    }
    travel.yaw = Math.atan2(dx, dz);
    travel.lookYaw = 0;
    travel.setTouchAxes(0, 1);
    const previousY = travel.foot.position[1];
    travel.update(Math.min(0.05, distance / 2.5));
    assert(travel.active && travel.owner.isClearFoot(travel.foot));
    assert(Math.abs(travel.foot.position[1] - previousY) <= 0.221);
  }
  assert.fail(`native input could not reach ${goal}: ${travel.foot.position}`);
}
function aimAt(travel, owner, candidate) {
  const local = owner.toLocal(candidate.anchor),
    foot = travel.foot.position;
  travel.yaw = Math.atan2(local[0] - foot[0], local[2] - foot[2]);
  travel.lookYaw = 0;
  travel.pitch = 0;
  travel.updateCamera();
}

for (const { stationId, rebuild } of [
  { stationId: 'burrard', rebuild: rebuildBurrard },
  { stationId: 'granville', rebuild: rebuildGranville },
  { stationId: 'stadium-chinatown', rebuild: rebuildStadium },
  { stationId: 'yaletown-roundhouse', rebuild: rebuildYaletown },
])
  test(`${stationId}: actual accessible lift uses F and touch through all real landings in both directions`, async () => {
    await harness(
      ({ travel, owner, connections, host, view }) => {
        const originalZoom = travel.distanceView,
          originalDistance = travel.walkDistance;
        const streetEntry =
          stationId === 'yaletown-roundhouse'
            ? owner.streetEntrances().find((e) => e.id === 'davie-elevator')
            : null;
        if (streetEntry) {
          // Initial setup is on the real exterior apron. Every subsequent move
          // into/out of the mapped portal and between cores uses native input.
          const outside = new THREE.Vector3(
            ...streetEntry.threshold,
          ).addScaledVector(
            new THREE.Vector3(...streetEntry.localDirection).applyQuaternion(
              owner.group.quaternion,
            ),
            -2.2,
          );
          outside.y = cityElevation(outside.x, outside.z);
          travel.foot = owner.tryEnterFromStreet(outside.toArray());
          assert(travel.foot && owner.isClearFoot(travel.foot));
          assert(
            new THREE.Vector3(...owner.toWorld(travel.foot)).distanceTo(
              new THREE.Vector3(...streetEntry.threshold),
            ) > 2.1,
          );
          walkTo(travel, owner.toLocal(streetEntry.threshold));
          walkTo(travel, connections[0].start);
        }
        assert.equal(
          travel.snapshot().canChangeLevel,
          false,
          'no remote platform shortcut is enabled',
        );
        // Runtime entrance rebasing changes the source coordinates. Interaction must
        // use the transformed graph rather than untranslated survey metadata.
        assert.notDeepEqual(
          connections[0].start,
          owner.data.authoredInterior.elevatorLandings[0].pointM,
        );
        const sequence = [
          ...connections.map((connection) => ({ connection, reverse: false })),
          ...connections
            .toReversed()
            .map((connection) => ({ connection, reverse: true })),
        ];
        const cores = new Set(
          connections.map(
            (c) => `${c.start[0].toFixed(3)},${c.start[2].toFixed(3)}`,
          ),
        );
        if (stationId === 'yaletown-roundhouse')
          assert.equal(
            cores.size,
            2,
            'the street and platform lifts remain physically separate',
          );
        for (const [index, { connection, reverse }] of sequence.entries()) {
          const source = reverse ? connection.end : connection.start,
            destination = reverse ? connection.start : connection.end,
            action =
              destination[1] > travel.foot.position[1]
                ? 'elevatorUp'
                : 'elevatorDown';
          if (
            Math.hypot(
              source[0] - travel.foot.position[0],
              source[2] - travel.foot.position[2],
            ) > 0.2
          ) {
            const remote = elevatorCandidates(travel).find(
              (candidate) =>
                candidate.id.includes(`:${connection.id}:`) &&
                candidate.action === action,
            );
            assert(
              !remote || !remote.canInteract(),
              'a separate lift core cannot be called remotely from the other shaft',
            );
            assert(
              Math.abs(source[1] - travel.foot.position[1]) < 0.02,
              'separate real cores connect through the same actual concourse',
            );
            for (const waypoint of planFlat(owner, travel.foot, source))
              walkTo(travel, waypoint);
            assert(owner.isClearFoot(travel.foot));
          }
          let candidate = elevatorCandidates(travel).find(
            (c) => c.id.includes(`:${connection.id}:`) && c.action === action,
          );
          assert(candidate, `${connection.id}: real landing offers ${action}`);
          // Distinct call buttons allow the middle landings' up and down destinations
          // to be selected by physically approaching that side of the cabin.
          walkTo(travel, owner.toLocal(candidate.proximityPoint));
          candidate = elevatorCandidates(travel).find(
            (c) => c.id === candidate.id,
          );
          assert(candidate);
          aimAt(travel, owner, candidate);
          host.clear();
          host.update(performance.now(), true);
          assert.equal(view().snapshot?.id, candidate.id);
          const before = travel.walkDistance,
            previousDirection = travel.direction;
          travel.keys.add('KeyW');
          travel.setTouchAxes(0.2, 0.3);
          if (index % 2 === 0) {
            const key = new Event('keydown', { cancelable: true });
            Object.assign(key, { key: 'f', code: 'KeyF', repeat: false });
            window.dispatchEvent(key);
            assert.equal(
              key.defaultPrevented,
              true,
              'the common native F handler dispatches the lift',
            );
          } else
            assert.equal(
              host.interact(view().snapshot),
              true,
              'the same visible prompt accepts touch',
            );
          assert(
            new THREE.Vector3(...travel.foot.position).distanceTo(
              new THREE.Vector3(...destination),
            ) < 1e-9,
            'the real target cabin differs only by triangle interpolation precision',
          );
          assert.equal(
            travel.foot.surfaceId,
            reverse ? connection.from : connection.to,
          );
          assert(owner.isClearFoot(travel.foot));
          const servedPlatforms = owner.geometryData.platforms.filter(
            (p) =>
              Math.abs(
                owner.geometryData.floors.find((f) => f.id === p.surfaceId)
                  .vertices[0][1] - travel.foot.position[1],
              ) < 0.1,
          );
          if (servedPlatforms.length) {
            assert.equal(travel.level, 'platform');
            assert(
              servedPlatforms.some(
                (p) =>
                  p.line === travel.line && p.direction === travel.direction,
              ),
            );
            if (servedPlatforms.some((p) => p.direction === previousDirection))
              assert.equal(
                travel.direction,
                previousDirection,
                'a shared island preserves its already selected served direction',
              );
          } else assert.equal(travel.level, 'concourse');
          assert.equal(
            travel.walkDistance,
            before,
            'the lift ride does not synthesize walking footsteps',
          );
          assert.equal(travel.keys.size, 0);
          assert.deepEqual(travel.axes, { x: 0, y: 0 });
          assert.equal(travel.distanceView, originalZoom);
          assert.equal(travel.owner, owner);
          assert.equal(travel.aboard, false);
          assert.equal(
            candidate.execute(),
            false,
            'the departed landing cannot be replayed',
          );
        }
        assert.equal(travel.foot.surfaceId, connections[0].from);
        assert(
          travel.walkDistance > originalDistance,
          'approaches used actual native walking input',
        );
        if (streetEntry) {
          // Return through the same real tower portal to the city. The update
          // loop must perform the ownership handoff, rather than replacing foot.
          walkTo(travel, owner.toLocal(streetEntry.threshold));
          travel.yaw = Math.atan2(
            -streetEntry.localDirection[0],
            -streetEntry.localDirection[2],
          );
          travel.lookYaw = 0;
          travel.setTouchAxes(0, 1);
          let previous = travel.foot;
          for (let i = 0; i < 100 && travel.active; i++) {
            travel.update(0.025);
            if (!travel.active) break;
            assert(owner.isClearFoot(travel.foot));
            assert(
              Math.abs(travel.foot.position[1] - previous.position[1]) <= 0.221,
            );
            assert(
              new THREE.Vector3(...travel.foot.position).distanceTo(
                new THREE.Vector3(...previous.position),
              ) > 0.04,
            );
            previous = travel.foot;
          }
          assert.equal(
            travel.active,
            false,
            'native outward input releases ownership to the city',
          );
          assert.equal(travel.owner, null);
          assert.equal(travel.foot, null);
        }
      },
      { stationId, rebuild },
    );
  });

test('lift actions reject distance, wrong-floor, blocked destination and suspended or stale player state', async () => {
  await harness(({ travel, owner, city, connections }) => {
    const candidate = elevatorCandidates(travel)[0],
      initial = structuredClone(travel.foot),
      destination = owner.floorAt(connections[0].end, connections[0].to),
      outward = new THREE.Vector3(...owner.toLocal(candidate.anchor))
        .sub(new THREE.Vector3(...owner.toLocal(candidate.proximityPoint)))
        .setY(0)
        .normalize(),
      far = owner.walk(initial, outward.x * 2, outward.z * 2),
      approach = owner.walk(initial, outward.x, outward.z);
    assert(candidate);
    assert(owner.isClearFoot(far));
    assert(
      new THREE.Vector3(...far.position).distanceTo(
        new THREE.Vector3(...initial.position),
      ) > 1.55,
    );
    assert(owner.isClearFoot(approach));
    const rejects = (description, mutate, restore) => {
      mutate();
      const before = structuredClone(travel.foot);
      assert.equal(candidate.canInteract(), false, description);
      assert.equal(candidate.execute(), false, description);
      assert.deepEqual(travel.foot, before, `${description}: no movement`);
      restore();
      assert(
        candidate.canInteract(),
        `${description}: recovery restores the actual landing`,
      );
    };
    rejects(
      'remote same-floor point',
      () => {
        travel.foot = far;
      },
      () => {
        travel.foot = structuredClone(initial);
      },
    );
    const closedDoor = {
      id: 'test-closed-lift-door',
      position: new THREE.Vector3(...initial.position)
        .addScaledVector(outward, 0.5)
        .add(new THREE.Vector3(0, 1, 0))
        .toArray(),
      size: Math.abs(outward.x) > 0.5 ? [0.08, 2, 2] : [2, 2, 0.08],
      yaw: 0,
    };
    rejects(
      'a closed door interrupts the supported approach',
      () => {
        travel.foot = approach;
        owner.collisionObstacles.push(closedDoor);
        assert(
          owner.isClearFoot(approach) && owner.isClearFoot(initial),
          'the door is between two independently clear feet positions',
        );
      },
      () => {
        owner.collisionObstacles.splice(
          owner.collisionObstacles.indexOf(closedDoor),
          1,
        );
        travel.foot = structuredClone(initial);
      },
    );
    rejects(
      'stacked floor underneath the same shaft',
      () => {
        travel.foot = destination;
      },
      () => {
        travel.foot = structuredClone(initial);
      },
    );
    rejects(
      'wrong surface layer',
      () => {
        travel.foot = { ...initial, layer: initial.layer + 1 };
      },
      () => {
        travel.foot = structuredClone(initial);
      },
    );
    const blocker = {
      id: 'test-closed-lift-cabin',
      position: [
        destination.position[0],
        destination.position[1] + 1,
        destination.position[2],
      ],
      size: [1.5, 2, 1.5],
      yaw: 0,
    };
    rejects(
      'occupied destination cabin',
      () => owner.collisionObstacles.push(blocker),
      () => {
        owner.collisionObstacles.splice(
          owner.collisionObstacles.indexOf(blocker),
          1,
        );
      },
    );
    const destinationFloor = owner.floorMap.get(connections[0].to),
      indices = destinationFloor.indices;
    rejects(
      'destination has no supporting floor',
      () => {
        destinationFloor.indices = [];
      },
      () => {
        destinationFloor.indices = indices;
      },
    );
    for (const [object, field, value] of [
      [travel, 'inputEnabled', false],
      [travel, 'busy', true],
      [city, 'contextLost', true],
      [city, 'pageSuspended', true],
      [document, 'hidden', true],
      [owner.group, 'visible', false],
      [city.settings, 'mode', 'orbit'],
    ]) {
      const previous = object[field];
      rejects(
        field,
        () => {
          object[field] = value;
        },
        () => {
          object[field] = previous;
        },
      );
    }
    rejects(
      'passenger is already sitting',
      () => {
        travel.stationSeat = { id: 'test-seat' };
      },
      () => {
        travel.stationSeat = null;
      },
    );
    rejects(
      'different station owner',
      () => {
        travel.owner = null;
      },
      () => {
        travel.owner = owner;
      },
    );
    rejects(
      'unconnected/non-vertical shaft',
      () => {
        connections[0].end[0] += 1;
      },
      () => {
        connections[0].end[0] -= 1;
      },
    );
  });
});

test('legacy authored display lifts expose no action before their cabin geometry is completed', async () => {
  await harness(
    ({ travel, owner }) => {
      assert.equal(
        owner.geometryData.authoredInterior.elevatorLandings,
        undefined,
      );
      assert(
        owner.isClearFoot(travel.foot),
        'legacy start remains a supported public floor',
      );
      assert.deepEqual(elevatorCandidates(travel), []);
    },
    {
      stationId: 'waterfront',
      rebuild: (source) => {
        const legacy = structuredClone(source);
        delete legacy.authoredInterior.elevatorLandings;
        legacy.geometryParts = legacy.geometryParts.filter(
          (p) => p.role !== 'lift-door',
        );
        return legacy;
      },
    },
  );
});

test('both completed source landing records and both real door-leaf pairs are required after runtime rebasing', async () => {
  await harness(({ travel, owner, connections }) => {
    const connection = connections[0],
      candidate = elevatorCandidates(travel).find((c) =>
        c.id.includes(`:${connection.id}:`),
      ),
      interior = owner.geometryData.authoredInterior,
      complete = structuredClone(interior.elevatorLandings),
      parts = owner.geometryData.parts,
      initial = structuredClone(travel.foot);
    assert(candidate);
    assert.notDeepEqual(
      complete.find((l) => l.floorId === connection.from).pointM,
      connection.start,
      'raw source positions deliberately differ from runtime rebased points',
    );
    const rejects = (label, change) => {
      change();
      assert(
        !elevatorCandidates(travel).some((c) => c.id === candidate.id),
        label,
      );
      assert.equal(candidate.canInteract(), false, label);
      assert.equal(candidate.execute(), false, label);
      assert.deepEqual(
        travel.foot,
        initial,
        `${label}: rejected action keeps the passenger in place`,
      );
      interior.elevatorLandings = structuredClone(complete);
      owner.geometryData.parts = parts;
      assert(
        candidate.canInteract(),
        `${label}: complete geometry restores access`,
      );
    };
    rejects('no completed landing metadata', () => {
      delete interior.elevatorLandings;
    });
    rejects('malformed completed landing metadata', () => {
      interior.elevatorLandings = {};
    });
    for (const [floor, position] of [
      [connection.from, connection.start],
      [connection.to, connection.end],
    ]) {
      rejects(`${floor}: missing landing record`, () => {
        interior.elevatorLandings = complete.filter((l) => l.floorId !== floor);
      });
      rejects(`${floor}: foreign landing floor`, () => {
        interior.elevatorLandings.find((l) => l.floorId === floor).floorId =
          'unrelated-floor';
      });
      rejects(`${floor}: wrong landing level`, () => {
        interior.elevatorLandings.find((l) => l.floorId === floor).pointM[1] +=
          1;
      });
      rejects(`${floor}: landing belongs to a different shaft`, () => {
        interior.elevatorLandings.find((l) => l.floorId === floor).pointM[0] +=
          1;
      });
      rejects(`${floor}: declared door faces the shaft back wall`, () => {
        const landing = interior.elevatorLandings.find(
          (l) => l.floorId === floor,
        );
        landing.outwardDirectionM = landing.outwardDirectionM.map((v) => -v);
      });
      const leaves = parts.filter(
        (p) =>
          p.role === 'lift-door' &&
          Math.abs(p.position[1] - position[1] - 1.1) < 0.2 &&
          Math.hypot(p.position[0] - position[0], p.position[2] - position[2]) <
            1.8,
      );
      assert.equal(leaves.length, 2);
      rejects(`${floor}: one real door leaf is missing`, () => {
        owner.geometryData.parts = parts.filter((p) => p !== leaves[0]);
      });
      rejects(`${floor}: no real door leaves`, () => {
        owner.geometryData.parts = parts.filter((p) => !leaves.includes(p));
      });
    }
  });
});
