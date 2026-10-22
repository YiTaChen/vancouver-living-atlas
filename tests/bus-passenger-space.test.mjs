import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { BusPassengerSpace } = await import(cityModule('bus-passenger-space'));
const { CityBusAssets } = await import(cityModule('bus-assets'));
const { BusAccessibility } = await import(cityModule('bus-accessibility'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { passengerContractFromManifest } = await import(
  cityModule('city-life/vehicle-profile-adapter')
);
const manifest = async (folder) =>
  JSON.parse(
    await readFile(`public/models/blender/${folder}/manifest.json`, 'utf8'),
  );
const legacy = await manifest('bus'),
  budget = await manifest('bus-v2'),
  reference = await manifest('bus-closeup'),
  hybrid = await manifest('bus-hybrid');
async function parseActual(url) {
  const bytes = await readFile('public' + url.split('?')[0]),
    loader = new GLTFLoader();
  const oldSelf = globalThis.self;
  globalThis.self = globalThis;
  loader.register((parser) => ({
    name: 'CPU_BUS_SEAT_TEST',
    beforeRoot() {
      parser.textureLoader = {
        load(_url, ok) {
          queueMicrotask(() =>
            ok(new THREE.Texture({ width: 256, height: 256 })),
          );
        },
      };
    },
  }));
  try {
    return await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    );
  } finally {
    if (oldSelf === undefined) delete globalThis.self;
    else globalThis.self = oldSelf;
  }
}
function anchors(manifest) {
  return passengerContractFromManifest(
    manifest,
    'city-bus-12m',
    'low-floor-bus-12m',
    'test-bus',
    'test-car',
    0,
  ).anchors;
}
async function fixture(profile, hybridExterior = false) {
  if (profile === 'legacy') {
    const asset = await parseActual(
      '/models/blender/bus/city-bus-12m-interior.lod0.glb',
    );
    const contract = anchors(legacy);
    return {
      root: asset.scene,
      metadata: legacy.vehicles[0],
      anchors: contract,
      space: new BusPassengerSpace(asset.scene, legacy.vehicles[0], contract),
      dispose() {
        asset.scene.traverse((node) => {
          if (node.isMesh) {
            node.geometry.dispose();
            for (const m of Array.isArray(node.material)
              ? node.material
              : [node.material])
              m.dispose();
          }
        });
      },
    };
  }
  const assets = new CityBusAssets([], new THREE.Group(), {
    interiorVersion: 'v2',
    ...(hybridExterior ? { exteriorVersion: 'hybrid' } : {}),
    fetchManifest: async () => budget,
    fetchReferenceManifest: async () => reference,
    fetchHybridManifest: async () => hybrid,
    load: parseActual,
  });
  const owner = await assets.loadBoardable({ profile });
  assert.equal(
    owner.profile,
    profile,
    'test must exercise the requested actual interior, without fallback',
  );
  const contract = anchors(owner.manifest);
  return {
    owner,
    assets,
    root: owner.interiorRoot,
    metadata: owner.vehicle,
    anchors: contract,
    space: new BusPassengerSpace(
      owner.interiorRoot,
      owner.vehicle,
      contract,
      owner.cabinSurfaces,
    ),
    dispose() {
      assets.dispose();
    },
  };
}
function reachable(space) {
  const origin = space.spawn();
  assert(origin && space.clear(origin));
  const queue = [origin],
    seen = new Set(['0:0']),
    seats = new Map();
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const seat of space.seats)
      if (!seats.has(seat.id) && space.canSit(seat, p)) seats.set(seat.id, p);
    for (const [dx, dz] of [
      [0.09, 0],
      [-0.09, 0],
      [0, 0.09],
      [0, -0.09],
    ]) {
      const next = space.walk(p, dx, dz),
        key = `${Math.round(next[0] / 0.09)}:${Math.round(next[2] / 0.09)}`;
      if (!seen.has(key) && Math.hypot(next[0] - p[0], next[2] - p[2]) > 0.08) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return { points: queue, seats };
}
for (const profile of [
  'legacy',
  'budget',
  'reference-lod1',
  'reference-lod0',
]) {
  test(`${profile}: every authored real bus seat is reachable from the aisle, with the correct floor/cushion/camera datum`, async () => {
    const f = await fixture(profile);
    try {
      assert.equal(f.space.seats.length, profile === 'legacy' ? 10 : 24);
      for (const seat of f.space.seats) {
        const authored = f.metadata.seats.find((row) => row.seatId === seat.id);
        assert(Math.abs(seat.position[1] - authored.localFloorHeightM) < 0.003);
        assert(
          Math.abs(seat.seatHeight - authored.seatAboveFloorM) < 0.012,
          `${seat.id} actual cushion ${seat.seatHeight} vs authored nominal ${authored.seatAboveFloorM}`,
        );
        const actualSeatHit = new THREE.Raycaster(
          new THREE.Vector3(
            seat.position[0],
            seat.position[1] + 0.8,
            seat.position[2],
          ),
          new THREE.Vector3(0, -1, 0),
          0,
          0.6,
        )
          .intersectObject(f.root, true)
          .find(
            (hit) =>
              /seat/.test(hit.object.name) && !/shell/.test(hit.object.name),
          );
        assert(
          actualSeatHit,
          'authored pelvis has an actual rendered cushion below it',
        );
        assert(
          Math.abs(actualSeatHit.point.y - seat.position[1] - seat.seatHeight) <
            1e-5,
          'avatar support equals the actual cushion, including rounded reference upholstery',
        );
        assert(
          Math.abs(
            seat.eyeHeight + seat.position[1] - authored.cameraEyePointM[1],
          ) < 0.003,
        );
        assert(
          seat.approaches.length > 0,
          `${seat.id} has an actual standing approach`,
        );
        assert.equal(
          f.space.canSit({ ...seat }, seat.approaches[0]),
          false,
          'unowned descriptors cannot become live seat targets',
        );
        assert.equal(
          f.space.canSit(seat, [
            seat.position[0],
            seat.position[1] + 2,
            seat.position[2],
          ]),
          false,
          'another floor is not an approach',
        );
      }
      const graph = reachable(f.space);
      assert.equal(
        graph.seats.size,
        f.space.seats.length,
        `unreachable seats: ${f.space.seats.filter((s) => !graph.seats.has(s.id)).map((s) => s.id)}`,
      );
      assert(
        graph.points.length > 500,
        'actual aisle permits continuous physical walking',
      );
      assert(
        graph.points.length < 2500,
        'bounded passenger space does not escape the bus',
      );
      if (profile !== 'legacy') {
        assert(
          graph.points.some((p) => Math.abs(p[1] - 0.52) < 0.003),
          'first real rear step is traversed',
        );
        assert(
          graph.points.some((p) => Math.abs(p[1] - 0.68) < 0.003),
          'raised rear deck is traversed despite stricter fixed-standing metadata',
        );
        for (const id of ['seat-01', 'seat-04', 'seat-13', 'seat-17'])
          assert(
            graph.seats.has(id),
            'window and rear-bench seats are actually reachable',
          );
      }
      const p = graph.seats.get(f.space.seats[0].id);
      assert.deepEqual(f.space.safeStand(p), p);
      assert.equal(f.space.safeStand([0, 40, 0]), null);
    } finally {
      f.dispose();
    }
  });
}

test('real capsule walks the two 16cm rear steps without tunnelling through seats, glass or off the actual floor', async () => {
  const f = await fixture('budget');
  try {
    const spawn = f.space.spawn();
    const end = f.space.walk(spawn, 0, -100);
    assert(end[2] > -5.6 && end[2] < -5.1, 'rear bench stops the body');
    assert(Math.abs(end[1] - 0.68) < 0.003);
    const side = f.space.walk(spawn, 100, 0);
    assert(
      Math.abs(side[0]) < 1.1,
      'side shell and floor boundary retain the passenger',
    );
    assert.equal(
      f.space.clear([0.94, 0.68, -3.225]),
      false,
      'standing inside an actual cushion is blocked',
    );
    assert.equal(
      f.space.clear([0, 0.36, -4]),
      false,
      'a low-floor coordinate cannot teleport beneath the raised deck',
    );
    assert.equal(
      f.space.clear([1.3, 0.36, 0]),
      false,
      'outside the glass is not walkable',
    );
    assert.deepEqual(f.space.walk(spawn, NaN, 1), spawn);
    assert.deepEqual(f.space.walk(spawn, Infinity, 0), spawn);
    const tread = [0, 0.52, -2.6];
    assert(f.space.clear(tread), 'rear step remains traversable');
    assert.equal(
      f.space.safeStand(tread),
      null,
      'a narrow stair tread is not a stand-up destination',
    );
    const seat = f.space.seats.find((s) => s.id === 'seat-18');
    const rear = [0, 0.36, -0.8];
    assert(f.space.clear(rear));
    assert.equal(
      f.space.canSit(seat, rear),
      false,
      'a close clear aisle position behind the seat back cannot sit through it',
    );
  } finally {
    f.dispose();
  }
});

for (const profile of ['budget', 'reference-lod1', 'reference-lod0']) {
  test(`${profile}: actual hybrid exterior retains reachable seats through kneeling and ramp deployment`, async () => {
    const f = await fixture(profile, true);
    let controller;
    const groundGeometry = new THREE.BufferGeometry();
    try {
      assert.equal(f.assets.stats().exteriorVersion, 'hybrid');
      assert.equal(f.owner.fallback, false);
      const graph = reachable(f.space);
      assert.equal(graph.seats.size, 24);
      const group = f.owner.group;
      group.position.y = 7;
      for (const clip of f.owner.animations) {
        const action = f.owner.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      }
      f.owner.mixer.update(2);
      group.updateWorldMatrix(true, true);
      const vertices = [];
      const quad = (a, b, c, d) =>
        vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
      quad([-2.1, 7, -20], [20, 7, -20], [20, 7, 20], [-2.1, 7, 20]);
      quad(
        [-20, 7.15, -20],
        [-2.1, 7.15, -20],
        [-2.1, 7.15, 20],
        [-20, 7.15, 20],
      );
      quad([-2.1, 7, -20], [-2.1, 7.15, -20], [-2.1, 7.15, 20], [-2.1, 7, 20]);
      groundGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      const ground = new THREE.Mesh(groundGeometry),
        surface = new GroundSurfaceIndex([ground]);
      controller = BusAccessibility.create(
        group,
        f.owner.manifest.accessibility,
        (x, z) => ({
          y: surface.sample(x, z, 7),
          surfaceId: 'ground',
          layer: 0,
        }),
        () => true,
        (bounds) => surface.trianglesInBounds(bounds),
      );
      assert(controller);
      const seat = f.space.seats.find((s) => s.id === 'seat-23'),
        approach = graph.seats.get(seat.id),
        pointBefore = f.root.localToWorld(new THREE.Vector3(...seat.position));
      assert.equal(controller.deploy(true), true, controller.snapshot().error);
      for (let i = 0; i < 60; i++) {
        controller.update(0.05);
        assert(f.space.canSit(seat, approach));
        assert.deepEqual(f.space.safeStand(approach), approach);
        assert(f.space.clear(f.space.spawn()));
      }
      assert.equal(controller.snapshot().phase, 'deployed');
      const pointAfter = f.root.localToWorld(
        new THREE.Vector3(...seat.position),
      );
      assert(
        Math.abs(
          pointBefore.y - pointAfter.y - hybrid.accessibility.kneelDropM,
        ) < 1e-5,
      );
      const reconstructed = new BusPassengerSpace(
        f.root,
        f.metadata,
        f.anchors,
      );
      assert.deepEqual(reconstructed.spawn(), f.space.spawn());
      assert(
        Math.abs(reconstructed.seats[22].seatHeight - seat.seatHeight) < 1e-5,
      );
      assert.equal(controller.stow(true), true);
      for (let i = 0; i < 60; i++) controller.update(0.05);
      assert.equal(controller.snapshot().phase, 'stowed');
      const restored = f.root.localToWorld(new THREE.Vector3(...seat.position));
      assert(restored.distanceTo(pointBefore) < 1e-5);
    } finally {
      controller?.dispose();
      groundGeometry.dispose();
      f.dispose();
    }
  });
}

test('a moved and rotated owned cabin keeps the same immutable local floor and seat support', async () => {
  const f = await fixture('reference-lod1');
  try {
    const spawn = f.space.spawn(),
      seat = f.space.seats.find((s) => s.id === 'seat-23');
    const approach = seat.approaches.find((p) => f.space.canSit(seat, p));
    assert(approach);
    f.root.position.set(120, 8, -55);
    f.root.rotation.set(0.02, 1.3, -0.04);
    f.root.updateWorldMatrix(true, true);
    assert(f.space.clear(spawn));
    assert(f.space.canSit(seat, approach));
    assert.deepEqual(f.space.safeStand(approach), approach);
    const reconstructed = new BusPassengerSpace(f.root, f.metadata, f.anchors);
    assert.equal(reconstructed.seats.length, 24);
    assert.deepEqual(reconstructed.spawn(), spawn);
    assert(
      Math.abs(reconstructed.seats[22].seatHeight - seat.seatHeight) < 1e-5,
    );
  } finally {
    f.dispose();
  }
});

test('metadata cannot invent a floor, cushion or pelvis anchor missing from the rendered GLB', async () => {
  const f = await fixture('budget');
  try {
    const missingFloor = f.root.clone(true);
    missingFloor.traverse((node) => {
      if (
        node.isMesh &&
        node.material.userData.shared_surface_id === 'bus-v2-floor'
      )
        node.visible = false;
    });
    const floorNodes = [];
    missingFloor.traverse((node) => {
      if (
        node.isMesh &&
        node.material.userData.shared_surface_id === 'bus-v2-floor'
      )
        floorNodes.push(node);
    });
    floorNodes.forEach((node) => node.removeFromParent());
    assert.throws(
      () => new BusPassengerSpace(missingFloor, f.metadata, f.anchors),
      /actual bus passenger floor/,
    );
    const missingCushion = f.root.clone(true);
    const seatNodes = [];
    missingCushion.traverse((node) => {
      if (node.isMesh && node.name === 'interior-batch-seat')
        seatNodes.push(node);
    });
    seatNodes.forEach((node) => node.removeFromParent());
    assert.throws(
      () => new BusPassengerSpace(missingCushion, f.metadata, f.anchors),
      /actual cushion/,
    );
    const displacedAnchor = f.root.clone(true);
    displacedAnchor.getObjectByName('seat-01-pelvis').position.x += 0.3;
    assert.throws(
      () => new BusPassengerSpace(displacedAnchor, f.metadata, f.anchors),
      /authored anchor/,
    );
  } finally {
    f.dispose();
  }
});

test('real-floor passengers cannot sit through a partition or under an actual low beam, and seat proximity stays bounded', async () => {
  const f = await fixture('budget');
  const partitionGeometry = new THREE.BoxGeometry(0.04, 1.5, 0.7),
    beamGeometry = new THREE.BoxGeometry(0.8, 0.14, 0.5),
    material = new THREE.MeshBasicMaterial();
  try {
    const origin = [0, 0.36, 1.41],
      seat = f.space.seats.find((s) => s.id === 'seat-23');
    assert(f.space.clear(origin));
    assert(
      f.space.canSit(seat, origin),
      'the same actual seat is reachable before a partition intervenes',
    );
    const cabin = f.root.clone(true),
      partition = new THREE.Mesh(partitionGeometry, material);
    partition.name = 'passenger-partition-panel';
    partition.position.set(0.4, 1.11, 1.41);
    cabin.add(partition);
    const blocked = new BusPassengerSpace(cabin, f.metadata, f.anchors);
    assert(
      blocked.clear(origin),
      'the passenger remains on the clear side of the partition',
    );
    assert.equal(
      blocked.canSit(
        blocked.seats.find((s) => s.id === seat.id),
        origin,
      ),
      false,
      'close proximity never bypasses an actual intervening partition',
    );
    const beamCabin = f.root.clone(true),
      beam = new THREE.Mesh(beamGeometry, material);
    beam.name = 'overhead-fixture-panel';
    beam.position.set(0, 2.06, 0);
    beamCabin.add(beam);
    const low = new BusPassengerSpace(beamCabin, f.metadata, f.anchors);
    assert(f.space.clear([0, 0.36, 0]));
    assert.equal(
      low.clear([0, 0.36, 0]),
      false,
      'actual overhead triangles constrain headroom even when global ceiling metadata is higher',
    );
    const priority = f.space.seats.find((s) => s.id === 'seat-22'),
      zAtRange =
        priority.position[2] +
        Math.sqrt(1.451 ** 2 - priority.position[0] ** 2),
      outsideRange = [0, 0.36, zAtRange];
    assert(f.space.clear(outsideRange));
    assert.equal(
      f.space.canSit(priority, outsideRange),
      false,
      'a clear view cannot extend the 1.45m interaction range',
    );
    assert.equal(f.space.canSit(priority, [0, 0.36, Infinity]), false);
  } finally {
    partitionGeometry.dispose();
    beamGeometry.dispose();
    material.dispose();
    f.dispose();
  }
});
