import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { WorldSeats } = await import(cityModule('world-seats'));
const { StreetNavigation } = await import(cityModule('navigation'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { TravelCameraCollision } = await import(cityModule('travel-camera-collision'));
const { ProximityInteractionController } = await import(
  cityModule('proximity-interactions')
);

function fixture() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.y = 5;
  const floor = new GroundSurfaceIndex([mesh]);
  let visible = true;
  let blocked = () => false;
  let surfacePresent = true;
  const poses = [];
  const occupied = [];
  const e = {
    data: {},
    settings: { mode: 'walk' },
    controls: { enabled: false, target: new THREE.Vector3() },
    camera: new THREE.PerspectiveCamera(),
    buildings: new THREE.Group(),
    landmarks: new THREE.Group(),
    roads: new THREE.Group(),
    terrain: new THREE.Group(),
    renderer: { domElement: { focus() {} } },
    elevation: () => 0,
    streetFurniture: {
      placements: [
        { id: 'real-bench', kind: 'cedar-bench', x: 0, y: 5, z: 0, yaw: 0 },
        { id: 'not-a-chair', kind: 'garbage-bin', x: 0, y: 5, z: 1, yaw: 0 },
      ],
      renderer: {
        hasVisiblePlacement: () => visible,
        setOccupied: (id) => occupied.push(id),
      },
    },
  };
  const nav = Object.assign(Object.create(StreetNavigation.prototype), {
    e,
    mode: 'walk',
    surface: 'ground',
    position: new THREE.Vector3(0, 5, 1.3),
    yaw: 0.4,
    pitch: 0,
    speed: 4,
    walkSeat: null,
    keys: new Set(['w']),
    touchX: 1,
    touchY: 1,
    touchBrake: false,
    cameraDistances: { walk: 0 },
    renderedDistance: 0,
    cameraCollision: new TravelCameraCollision(),
    snapCamera: true,
    walkingDistance: 0,
    walker: {
      group: new THREE.Group(),
      setSeated: (...args) => poses.push(args),
      update() {},
    },
    car: new THREE.Group(),
    driverMotion: { reset() {} },
    rehomeStreetSurface: () => true,
    clearGround: (x, z) => !blocked(x, z),
    // A DEM fallback is deliberately different from the actual rendered floor.
    groundHeight: () => 300,
    groundSurface: {
      sample: (x, z, anchor) =>
        surfacePresent ? floor.sample(x, z, anchor) : undefined,
    },
    update() {},
    finishReturnBlend() {},
    updateCockpit() {},
    notifyCamera() {},
    blur() {
      this.keys.clear();
      this.touchX = this.touchY = this.speed = 0;
    },
  });
  // Source floor lookup is exercised by WorldSeats; this reports player feet.
  nav.walkingHeight = () => nav.position.y;
  e.navigation = nav;
  const world = new WorldSeats(e);
  const controller = new ProximityInteractionController();
  controller.registerProvider('world', () => world.interactionCandidates());
  const selected = () => controller.update(nav.position.toArray());
  return {
    e,
    nav,
    poses,
    occupied,
    world,
    controller,
    selected,
    setVisible: (value) => (visible = value),
    setBlocked: (fn) => (blocked = fn),
    setSurfacePresent: (value) => (surfacePresent = value),
    dispose() {
      controller.dispose();
      world.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

function authoredWoodVertices(lod) {
  const bytes = readFileSync(
    new URL(
      `../public/models/blender/street-furniture/cedar-bench.${lod}.glb`,
      import.meta.url,
    ),
  );
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const bin = 20 + length + 8;
  const points = [];
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const matrix = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
        );
    for (const primitive of json.meshes[node.mesh].primitives) {
      if (json.materials[primitive.material].name !== 'wood') continue;
      const a = json.accessors[primitive.attributes.POSITION];
      assert.equal(a.componentType, 5126);
      const view = json.bufferViews[a.bufferView];
      for (let i = 0; i < a.count; i++) {
        const offset =
          bin +
          (view.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (view.byteStride ?? 12);
        points.push(
          new THREE.Vector3(
            bytes.readFloatLE(offset),
            bytes.readFloatLE(offset + 4),
            bytes.readFloatLE(offset + 8),
          ).applyMatrix4(matrix),
        );
      }
    }
  }
  return points;
}

test('visible shipping cedar bench seats use the authored seat top in both GLB LODs, not the taller backrest', () => {
  const f = fixture();
  try {
    assert.equal(f.selected().id, 'street-seat:real-bench');
    const approachYaw = f.nav.yaw;
    assert.equal(f.controller.execute(), true);
    assert.equal(f.nav.yaw, approachYaw, 'sitting preserves the approach camera direction');
    for (const lod of ['lod0', 'lod1']) {
      const vertices = authoredWoodVertices(lod);
      const seatVertices = vertices.filter(
        (v) => Math.abs(v.z) < 0.29 && v.y > 0.35 && v.y < 0.6,
      );
      assert(seatVertices.length > 0);
      const top = Math.max(...seatVertices.map((v) => v.y));
      assert(
        Math.abs(f.nav.walkSeat.height - top) < 1e-6,
        `${lod} seat-top alignment`,
      );
      assert(Math.max(...vertices.map((v) => v.y)) > top + 0.4);
    }
    assert.deepEqual(f.poses, [[true, 0.509]]);
    assert.deepEqual(f.nav.position.toArray(), [0, 5, 0]);
    assert.equal(f.selected().action, 'stand');
    f.world.update();
    assert.equal(f.occupied.at(-1), 'real-bench');
  } finally {
    f.dispose();
  }
});

test('street seat queries reject hidden furniture, back approaches, other floors, walls, absent rendered floor and transit contexts', () => {
  const f = fixture();
  try {
    assert(f.selected());
    f.setVisible(false);
    assert.equal(f.selected(), null);
    f.setVisible(true);
    f.nav.position.z = -1;
    assert.equal(f.selected(), null, 'bench back cannot be reached through');
    f.nav.position.z = 1.3;
    f.nav.position.y = 6;
    assert.equal(
      f.selected(),
      null,
      'overlapping floors do not authorize a seat',
    );
    f.nav.position.y = 5;
    f.setBlocked((_x, z) => z > 1.02 && z < 1.16);
    assert.equal(f.selected(), null, 'intervening wall blocks the approach');
    f.setBlocked(() => false);
    f.setSurfacePresent(false);
    assert.equal(
      f.selected(),
      null,
      'DEM fallback cannot authorize an unseen floor',
    );
    f.setSurfacePresent(true);
    for (const [owner, value] of [
      ['skyTrainTravel', { active: true }],
      ['busVisit', { aboard: true }],
    ]) {
      f.e[owner] = value;
      assert.equal(f.selected(), null, owner);
      delete f.e[owner];
    }
    f.nav.surface = 'bridge';
    assert.equal(f.selected(), null);
    f.nav.surface = 'ground';
    f.e.settings.mode = 'drive';
    assert.equal(f.selected(), null);
    f.e.settings.mode = 'walk';
    assert(f.selected());
  } finally {
    f.dispose();
  }
});

test('blocked stand-up preserves seating and movement lock until a safe rendered-floor exit exists', () => {
  const f = fixture();
  try {
    f.selected();
    assert.equal(f.controller.execute(), true);
    f.setBlocked(() => true);
    assert.equal(f.selected().action, 'stand');
    assert.equal(f.controller.execute(), false);
    assert(f.nav.walkSeat);
    const before = f.nav.position.clone();
    f.nav.move(10, 10);
    f.nav.step('forward');
    assert(f.nav.position.equals(before));
    f.nav.keys.add('w');
    f.nav.keys.add('a');
    f.nav.touchX = f.nav.touchY = 1;
    const yaw = f.nav.yaw;
    StreetNavigation.prototype.update.call(f.nav, 0.05);
    assert(
      f.nav.position.equals(before),
      'held desktop/touch input cannot slide a seated player',
    );
    assert.equal(
      f.nav.yaw,
      yaw,
      'steering input cannot rotate the seated pose',
    );
    assert(
      Math.abs(f.e.camera.position.y - (5 + 0.509 + 0.78)) < 1e-6,
      'interior camera follows the seated eye height',
    );
    f.setBlocked(() => false);
    f.selected();
    assert.equal(f.controller.execute(), true);
    assert.equal(f.nav.walkSeat, null);
    assert(Math.abs(f.nav.position.y - 5.02) < 1e-6);
    assert(Math.abs(f.nav.position.z - 0.95) < 1e-6);
    assert.deepEqual(f.poses, [[true, 0.509], [false]]);
    assert.equal(f.nav.keys.size, 0);
    assert.equal(f.nav.touchX, 0);
    assert.equal(f.nav.touchY, 0);
  } finally {
    f.dispose();
  }
});

test('mode changes and new placements retain a blocked seated player, then clear pose before a valid mode switch', () => {
  const f = fixture();
  try {
    f.selected();
    f.controller.execute();
    f.setBlocked(() => true);
    assert.equal(f.nav.switchStreetMode('drive'), false);
    assert.equal(f.nav.startAt('walk', { x: 20, y: 0, z: 20 }), false);
    f.nav.setMode('orbit');
    assert.equal(f.nav.mode, 'walk');
    assert(f.nav.walkSeat);
    f.setBlocked(() => false);
    assert.equal(f.nav.switchStreetMode('drive'), true);
    assert.equal(f.nav.walkSeat, null);
    assert.equal(f.nav.mode, 'drive');
    assert.deepEqual(f.poses, [[true, 0.509], [false]]);
  } finally {
    f.dispose();
  }
});

test('explicit authored seats are queried locally without probing faraway city objects, and disposal releases furniture pins', () => {
  const f = fixture();
  try {
    f.e.streetFurniture.placements = [];
    let nearQueries = 0;
    f.e.data.walkSeats = [
      {
        id: 'authored-chair',
        floor: [0, 5, 0],
        yaw: 0,
        height: 0.46,
        visible: () => {
          nearQueries++;
          return true;
        },
      },
      ...Array.from({ length: 1500 }, (_, i) => ({
        id: `far-chair-${i}`,
        floor: [500 + i, 5, 500],
        yaw: 0,
        height: 0.46,
        visible() {
          throw new Error('faraway visibility must not be queried');
        },
      })),
    ];
    assert.equal(f.selected().id, 'authored-chair');
    assert.equal(nearQueries, 1);
    assert.equal(f.world.interactionCandidates().length, 1);
    assert.equal(f.controller.execute(), true);
    assert.equal(f.nav.walkSeat.height, 0.46);
    f.world.dispose();
    assert.equal(f.occupied.at(-1), null);
  } finally {
    f.dispose();
  }
});

test('bridge quick travel cannot drag a blocked seated pose away from its bench', () => {
  const f = fixture();
  try {
    f.e.data.bridges = {
      mainSpines: [
        {
          kind: 'fixture',
          start: [-123.14, 49.29],
          end: [-123.15, 49.3],
          estimatedDeckM: 20,
        },
      ],
    };
    f.nav.clearDrift = () => {};
    f.selected();
    f.controller.execute();
    const before = f.nav.position.clone();
    f.setBlocked(() => true);
    f.nav.startBridge('fixture');
    assert(f.nav.walkSeat);
    assert(f.nav.position.equals(before));
    f.setBlocked(() => false);
    f.nav.startBridge('fixture');
    assert.equal(f.nav.walkSeat, null);
    assert(!f.nav.position.equals(before));
    assert.equal(f.nav.surface, 'bridge');
    assert.deepEqual(f.poses, [[true, 0.509], [false]]);
  } finally {
    f.dispose();
  }
});
