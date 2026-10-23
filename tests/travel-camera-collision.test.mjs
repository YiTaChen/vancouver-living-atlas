import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { TravelCameraCollision, travelLookDirection, TRAVEL_PITCH_LIMIT } =
  await import(cityModule('travel-camera-collision'));
const { StreetNavigation } = await import(cityModule('navigation'));
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const collision = new TravelCameraCollision();
function box(size, position) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.set(...position);
  return mesh;
}
function dispose(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    for (const material of object.material ? [].concat(object.material) : [])
      material.dispose();
  });
}

test('two-sided continuous camera sphere contracts all three axes before actual roof and wall faces', () => {
  const roof = box([12, 0.2, 12], [0, 2.4, 0]),
    wall = box([12, 8, 0.2], [0, 0, -2]);
  const pivot = v(0, 1.1, 0),
    desired = v(0, 4.2, -7);
  const roofSafe = collision.resolve(pivot, desired, [roof]);
  assert(roofSafe.y < 2.12 && roofSafe.y > 2.05, roofSafe.toArray().join(','));
  assert(
    Math.abs(
      (roofSafe.y - pivot.y) / (desired.y - pivot.y) - roofSafe.z / desired.z,
    ) < 1e-8,
    'ceiling contraction also shortens the horizontal boom',
  );
  const wallSafe = collision.resolve(pivot, v(0, 1.1, -7), [wall]);
  assert(wallSafe.z > -1.72 && wallSafe.z < -1.69);
  assert.equal(wallSafe.y, pivot.y);
  const closest = new THREE.Vector3();
  const roofBox = new THREE.Box3().setFromObject(roof);
  roofBox.clampPoint(roofSafe, closest);
  assert(closest.distanceTo(roofSafe) >= 0.18);
  assert.equal(
    roof.material.side,
    THREE.FrontSide,
    'interior collisions do not mutate materials',
  );
  dispose(roof);
  dispose(wall);
});

test('sphere clearance catches a thin edge missed by the centre ray, respects visibility and follows moving local frames', () => {
  const frame = new THREE.Group(),
    edge = box([0.08, 2, 0.08], [0.16, 1, -2]);
  frame.add(edge);
  const pivot = v(0, 1, 0),
    desired = v(0, 1, -5);
  const ray = new THREE.Raycaster(pivot, v(0, 0, -1));
  frame.updateMatrixWorld(true);
  assert.equal(ray.intersectObject(edge).length, 0);
  assert(collision.resolve(pivot, desired, [frame]).z > -2);
  frame.position.x = 10;
  assert(collision.resolve(pivot, desired, [frame]).equals(desired));
  const moved = collision.resolve(v(10, 1, 0), v(10, 1, -5), [frame]);
  assert(moved.z > -2);
  frame.visible = false;
  assert(
    collision.resolve(v(10, 1, 0), v(10, 1, -5), [frame]).equals(v(10, 1, -5)),
  );
  frame.visible = true;
  edge.userData.cameraCollision = false;
  assert(
    collision.resolve(v(10, 1, 0), v(10, 1, -5), [frame]).equals(v(10, 1, -5)),
  );
  dispose(frame);
});

test('Waterfront actual station roof prevents a raised chase camera from crossing to the other side', async () => {
  const { stationOwner } = await import('./helpers/skytrain-geometry.mjs');
  const owner = stationOwner('waterfront');
  try {
    const roof = owner.data.parts.find(
      (part) => part.id === 'waterfront-expo-roof',
    );
    assert(roof);
    const [x, y, z] = roof.position,
      pivot = new THREE.Vector3(...owner.toWorld([x, y - 1.3, z])),
      desired = new THREE.Vector3(...owner.toWorld([x, y + 2, z - 6])),
      safe = collision.resolve(pivot, desired, [owner.group]);
    owner.group.updateMatrixWorld(true);
    const local = owner.group.worldToLocal(safe.clone());
    assert(local.y < y - roof.size[1] / 2 - 0.18);
    assert(
      safe.distanceTo(pivot) > 1 &&
        safe.distanceTo(pivot) < desired.distanceTo(pivot) * 0.7,
    );
  } finally {
    owner.dispose();
  }
});

test('spherical look reaches aurora elevation and the ground without a vertical pole flip', () => {
  for (const yaw of [0, 0.7, Math.PI, 6])
    for (const sign of [-1, 1]) {
      const direction = travelLookDirection(yaw, sign * 100);
      assert(Math.abs(direction.length() - 1) < 1e-12);
      assert(
        Math.abs(Math.asin(direction.y) - sign * TRAVEL_PITCH_LIMIT) < 1e-12,
      );
      assert(Math.abs(direction.y) > 0.999);
      assert(
        direction.x * Math.sin(yaw) + direction.z * Math.cos(yaw) > 0,
        'near-vertical looking retains the same heading',
      );
      const camera = new THREE.PerspectiveCamera();
      camera.lookAt(direction);
      camera.updateMatrixWorld(true);
      assert(camera.getWorldDirection(v(0, 0, 0)).dot(direction) > 0.999999);
      assert(v(0, 1, 0).applyQuaternion(camera.quaternion).y > 0);
    }
});

function navigationHarness() {
  const canvasEvents = new Map(),
    captures = [];
  const canvas = {
    addEventListener: (name, callback) => canvasEvents.set(name, callback),
    removeEventListener() {},
    focus() {},
    setAttribute() {},
    setPointerCapture: (id) => captures.push(id),
  };
  const engine = {
    compatibleGraphics: true,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(58, 1.6, 0.08, 10000),
    renderer: { domElement: canvas },
    controls: { target: v(0, 0, 0) },
    buildings: new THREE.Group(),
    landmarks: new THREE.Group(),
    roads: new THREE.Group(),
    terrain: new THREE.Group(),
    data: { buildings: { features: [] } },
    settings: { mode: 'walk' },
    elevation: () => 0,
    onLand: () => true,
    interiors: { height: () => 0, clear: () => true },
  };
  engine.scene.add(engine.buildings, engine.landmarks, engine.roads);
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  let navigation;
  try {
    navigation = new StreetNavigation(engine);
  } finally {
    globalThis.window = previousWindow;
  }
  navigation.mode = 'walk';
  navigation.snapCamera = true;
  const event = (pointerType, clientY, pointerId = 1) => ({
    pointerType,
    clientX: 0,
    clientY,
    pointerId,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  return {
    navigation,
    engine,
    captures,
    canvasEvents,
    event,
    cleanup() {
      globalThis.window = { removeEventListener() {} };
      try {
        navigation.destroy();
      } finally {
        globalThis.window = previousWindow;
      }
      dispose(engine.scene);
    },
  };
}

test('actual street update uses desktop/touch near-vertical pitch and preserves a seated first-person eye', () => {
  const h = navigationHarness(),
    { navigation: nav, engine } = h;
  try {
    for (const [type, id] of [
      ['mouse', 1],
      ['touch', 2],
    ]) {
      nav.pitch = 0;
      h.canvasEvents.get('pointerdown')(h.event(type, 0, id));
      h.canvasEvents.get('pointermove')(h.event(type, -1000, id));
      nav.cameraDistances.walk = 0;
      nav.update(0);
      assert(engine.camera.getWorldDirection(v(0, 0, 0)).y > 0.999, type);
      assert.equal(nav.walker.group.visible, false);
      assert(Math.abs(engine.camera.position.y - 1.7) < 1e-8);
      nav.pointerUp(h.event(type, -1000, id));
      assert(h.captures.includes(id));
    }
    const seat = {
      id: 'test',
      floor: [0, 0, 0],
      yaw: 1.2,
      height: 0.48,
      stand: () => v(1, 0, 0),
    };
    assert(nav.sitOnSeat(seat));
    nav.update(0);
    assert(Math.abs(engine.camera.position.y - 1.26) < 1e-8);
    assert.equal(nav.walker.group.rotation.y, seat.yaw);
  } finally {
    h.cleanup();
  }
});

test('actual walking third-person camera stays beneath an interior roof and keeps the standing/seated body in frame', () => {
  const h = navigationHarness(),
    { navigation: nav, engine } = h;
  const roof = box([20, 0.25, 20], [0, 2.6, 0]);
  engine.landmarks.add(roof);
  try {
    for (const seated of [false, true]) {
      if (seated)
        assert(
          nav.sitOnSeat({
            id: 'bench',
            floor: [0, 0, 0],
            yaw: 0,
            height: 0.48,
            stand: () => v(1, 0, 0),
          }),
        );
      for (const distance of [2.05, 4, 8, 14]) {
        nav.cameraDistances.walk = distance;
        nav.snapCamera = true;
        nav.pitch = 0.04;
        nav.update(0);
        engine.camera.updateMatrixWorld(true);
        assert(
          engine.camera.position.y < 2.295,
          engine.camera.position.toArray().join(','),
        );
        assert(nav.walker.group.visible);
        for (const height of [seated ? 0.08 : 0.02, seated ? 1.35 : 1.82]) {
          const projected = v(0, height, 0).project(engine.camera);
          assert(
            Math.abs(projected.x) < 1 &&
              Math.abs(projected.y) < 1 &&
              projected.z < 1,
            `body ${height}m visible at ${distance}m zoom, seated=${seated}: ${projected.toArray().join(',')}`,
          );
        }
      }
    }
  } finally {
    h.cleanup();
  }
});
