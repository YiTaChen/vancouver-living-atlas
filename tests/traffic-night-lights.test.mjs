import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { TrafficNightLights } = await import(cityModule('traffic-night-lights'));
const { TrafficVehicleAssets, TRAFFIC_VEHICLE_ASSETS, trafficVehicleUrl } =
  await import(cityModule('traffic-vehicles'));

const identity = () => new THREE.Matrix4();
const camera = new THREE.Vector3(0, 3, 0);
const frame = (extra = {}) => ({
  nightAmount: 1,
  quality: 'balanced',
  downtownAt: () => 1,
  roadHeight: () => 0,
  ...extra,
});
const meshes = (lights) => lights.group.children;
const positionAt = (mesh, slot) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(slot, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
};
const load = async (url) => {
  const bytes = readFileSync(
    new URL(`../public${url.split('?')[0]}`, import.meta.url),
  );
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
};
const near = (actual, expected, tolerance = 1e-5) => {
  assert(
    actual.distanceTo(expected) < tolerance,
    `${actual.toArray()} does not match ${expected.toArray()}`,
  );
};

test('night lamps overlay the actual accepted head and rear lenses in all six car GLBs', async () => {
  for (const asset of TRAFFIC_VEHICLE_ASSETS) {
    const gltf = await load(trafficVehicleUrl(asset));
    const surfaces = {
      head: [new THREE.Box3(), new THREE.Box3()],
      tail: [new THREE.Box3(), new THREE.Box3()],
    };
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || node.material.name !== 'glass')
        return;
      const positions = node.geometry.getAttribute('position');
      const colors = node.geometry.getAttribute('color');
      for (let i = 0; i < positions.count; i++) {
        const color = new THREE.Vector3(
          colors.getX(i),
          colors.getY(i),
          colors.getZ(i),
        );
        const head = color.distanceTo(new THREE.Vector3(0.85, 0.93, 1)) < 1e-5;
        const tail =
          color.distanceTo(new THREE.Vector3(0.65, 0.025, 0.013)) < 1e-5;
        if (!head && !tail) continue;
        const p = new THREE.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(node.matrixWorld);
        surfaces[head ? 'head' : 'tail'][p.x < 0 ? 0 : 1].expandByPoint(p);
      }
    });
    const lights = new TrafficNightLights(new THREE.Group());
    lights.beginFrame(camera, frame());
    lights.addVehicle(asset.model, identity());
    lights.endFrame();
    const [heads, tails] = meshes(lights);
    for (const [mesh, role, direction] of [
      [heads, 'head', 1],
      [tails, 'tail', -1],
    ]) {
      for (let side = 0; side < 2; side++) {
        assert(!surfaces[role][side].isEmpty());
        const sourceCenter = surfaces[role][side].getCenter(
          new THREE.Vector3(),
        );
        sourceCenter.z += direction * 0.005;
        near(positionAt(mesh, side), sourceCenter);
        const actualMatrix = new THREE.Matrix4();
        mesh.getMatrixAt(side, actualMatrix);
        const size = new THREE.Vector3().setFromMatrixScale(actualMatrix);
        const sourceSize = surfaces[role][side].getSize(new THREE.Vector3());
        assert(Math.abs(size.x - sourceSize.x) < 1e-5);
        assert(Math.abs(size.y - sourceSize.y) < 1e-5);
        const facing = new THREE.Vector3(0, 0, 1).transformDirection(
          actualMatrix,
        );
        assert(Math.abs(facing.z - direction) < 1e-5);
      }
    }
    lights.dispose();
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      node.material.dispose();
    });
  }
});

test('lamps use the submitted road-grade rotation, copy mutable renderer matrices, and stay still with a stopped actor', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  const root = new THREE.Object3D();
  root.position.set(8, 7, -3);
  root.rotation.set(-0.12, Math.PI / 2, 0.045, 'YXZ');
  root.updateMatrix();
  const accepted = root.matrix.clone();
  lights.beginFrame(camera, frame());
  assert(lights.addVehicle('suv', root.matrix));
  root.position.set(900, 100, 900);
  root.updateMatrix();
  lights.endFrame();
  const [heads, tails] = meshes(lights);
  const expected = new THREE.Vector3(-0.6138, 0.895, 2.382).applyMatrix4(
    accepted,
  );
  near(positionAt(heads, 0), expected);
  const first = heads.instanceMatrix.array.slice(0, heads.count * 16);
  for (let n = 0; n < 3; n++) {
    lights.beginFrame(camera, frame());
    lights.addVehicle('suv', accepted);
    lights.endFrame();
    assert.deepEqual(
      heads.instanceMatrix.array.slice(0, heads.count * 16),
      first,
    );
  }
  const headPosition = positionAt(heads, 0);
  const tailPosition = positionAt(tails, 0);
  assert(
    headPosition.x > tailPosition.x,
    '+Z forward correctly rotates to world +X',
  );
  lights.dispose();
});

test('the ground footprint follows sampled oblique asphalt, stays ahead of the bumper, and uses city-only strength', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  const ground = (x, z) => 2 + x * 0.08 + z * 0.05;
  const root = new THREE.Object3D();
  root.position.set(10, ground(10, 20), 20);
  root.rotation.y = Math.PI / 3;
  root.updateMatrix();
  lights.beginFrame(
    new THREE.Vector3(10, 5, 20),
    frame({ roadHeight: ground, downtownAt: () => 0.4 }),
  );
  lights.addVehicle('sedan', root.matrix);
  lights.endFrame();
  const spill = meshes(lights)[2];
  assert.equal(spill.count, 1);
  const transform = new THREE.Matrix4();
  spill.getMatrixAt(0, transform);
  const vertices = spill.geometry.getAttribute('position');
  const heading = new THREE.Vector3(
    Math.sin(Math.PI / 3),
    0,
    Math.cos(Math.PI / 3),
  );
  for (let i = 0; i < vertices.count; i++) {
    const p = new THREE.Vector3()
      .fromBufferAttribute(vertices, i)
      .applyMatrix4(transform);
    assert(Math.abs(p.y - ground(p.x, p.z) - 0.035) < 1e-5);
    assert(p.clone().sub(root.position).dot(heading) > 2.3);
  }
  assert(
    Math.abs(spill.geometry.getAttribute('spillStrength').getX(0) - 0.4) < 1e-6,
  );
  lights.beginFrame(camera, frame({ downtownAt: () => 0 }));
  lights.addVehicle('sedan', identity());
  lights.endFrame();
  assert.equal(
    spill.count,
    0,
    'car lamps remain visible in a dark park, but no street spill is added',
  );
  assert.equal(lights.stats.headLamps, 2);
  lights.dispose();
});

test('no road spill appears beyond 120 m, over missing asphalt, or across a steep discontinuity', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  const spill = meshes(lights)[2];
  for (const roadHeight of [
    () => undefined,
    (_x, z) => (z > 8 ? 12 : 0),
    (_x, z) => (z > 8 ? NaN : 0),
  ]) {
    lights.beginFrame(camera, frame({ roadHeight }));
    lights.addVehicle('bus', identity());
    lights.endFrame();
    assert.equal(spill.count, 0);
    assert.equal(lights.stats.headLamps, 2);
  }
  lights.beginFrame(camera, frame());
  lights.addVehicle('sedan', new THREE.Matrix4().makeTranslation(121, 0, 0));
  lights.endFrame();
  assert.equal(spill.count, 0);
  assert.equal(lights.stats.headLamps, 2);
  lights.beginFrame(camera, frame());
  lights.addVehicle('sedan', new THREE.Matrix4().makeTranslation(105, 0, 0));
  lights.endFrame();
  const strength = spill.geometry.getAttribute('spillStrength').getX(0);
  assert(
    strength > 0.4 && strength < 0.6,
    '120 m admission fades rather than popping at its edge',
  );
  lights.dispose();
});

test('the nearest pool is bounded per quality and has only three draws with no real lights, textures or shadow passes', () => {
  const parent = new THREE.Group();
  const lights = new TrafficNightLights(parent);
  for (const [quality, compatible, expected] of [
    ['balanced', false, 64],
    ['high', false, 96],
    ['ultra', false, 128],
    ['ultra', true, 40],
  ]) {
    lights.beginFrame(camera, frame({ quality, compatible }));
    for (let i = 180; i > 0; i--)
      lights.addVehicle('sedan', new THREE.Matrix4().makeTranslation(i, 0, 0));
    lights.endFrame();
    assert.equal(lights.stats.vehicles, expected);
    assert.equal(lights.stats.headLamps, expected * 2);
    assert.equal(lights.stats.tailLamps, expected * 2);
    assert.equal(lights.stats.drawCalls, 3);
    assert(lights.stats.triangles <= expected * 10);
    for (let i = 0; i < lights.stats.headLamps; i++)
      assert(positionAt(meshes(lights)[0], i).x < expected + 1);
  }
  parent.traverse((node) => {
    assert(!(node instanceof THREE.Light));
    assert(!node.castShadow);
    if (!(node instanceof THREE.Mesh)) return;
    assert(!node.receiveShadow);
    assert(!node.material.depthWrite);
    assert(
      !Object.values(node.material).some((v) => v instanceof THREE.Texture),
    );
    assert(node.count <= node.instanceMatrix.count);
  });
  assert.equal(lights.stats.textures, 0);
  assert.equal(
    meshes(lights)[2].material.forceSinglePass,
    true,
    'transparent double-sided spill still uses one draw rather than separate back/front passes',
  );
  lights.dispose();
});

test('daylight and invalid matrices clear old lights, and lamp distance fading is wired into the actual Three material shader', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  lights.beginFrame(camera, frame());
  lights.addVehicle('sedan', new THREE.Matrix4().makeTranslation(240, 0, 0));
  lights.endFrame();
  const heads = meshes(lights)[0];
  const fade = heads.geometry.getAttribute('lampStrength').getX(0);
  assert(fade > 0 && fade < 1);
  const shader = {
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <alphatest_fragment>',
  };
  heads.material.onBeforeCompile(shader);
  assert(shader.vertexShader.includes('trafficLampStrength = lampStrength'));
  assert(
    shader.fragmentShader.includes('diffuseColor.a *= trafficLampStrength'),
  );
  lights.beginFrame(camera, frame({ nightAmount: 0 }));
  assert.equal(lights.addVehicle('sedan', identity()), false);
  lights.endFrame();
  assert.equal(lights.stats.drawCalls, 0);
  assert.equal(lights.stats.vehicles, 0);
  assert.equal(lights.group.visible, false);
  assert.equal(heads.material.opacity, 0);
  lights.beginFrame(camera, frame({ nightAmount: NaN }));
  assert.equal(lights.addVehicle('sedan', identity()), false);
  lights.endFrame();
  lights.beginFrame(camera, frame());
  const invalid = identity();
  invalid.elements[12] = NaN;
  assert.equal(lights.addVehicle('sedan', invalid), false);
  assert.equal(
    lights.addVehicle('sedan', new THREE.Matrix4().makeTranslation(1000, 0, 0)),
    false,
  );
  lights.endFrame();
  assert.equal(lights.stats.drawCalls, 0);
  lights.dispose();
});

test('imported and fallback bus lamp anchors match their different accepted silhouettes', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  lights.beginFrame(camera, frame());
  lights.addVehicle('bus', identity());
  lights.addVehicle(
    'bus-fallback',
    new THREE.Matrix4().makeTranslation(10, 0, 0),
  );
  lights.endFrame();
  const [heads, tails] = meshes(lights);
  near(positionAt(heads, 0), new THREE.Vector3(-0.82, 0.77, 6.124));
  near(positionAt(tails, 0), new THREE.Vector3(-1.02, 0.77, -6.323));
  near(positionAt(heads, 2), new THREE.Vector3(10 - 0.87, 0.97, 6.133));
  near(positionAt(tails, 2), new THREE.Vector3(10 - 0.92, 1.05, -6.334));
  lights.dispose();
});

test('fallback car lamps sit directly on the actual 4.3 m box bumpers and remain inside its body face', () => {
  const lights = new TrafficNightLights(new THREE.Group());
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.8, 4.3),
    new THREE.MeshBasicMaterial(),
  );
  // environment.ts draws the old body centre 0.75 m above the accepted tyre
  // datum. Test the actual fallback geometry in that contact-root frame.
  body.position.y = 0.75;
  body.updateMatrixWorld(true);
  lights.beginFrame(camera, frame());
  lights.addVehicle('sedan-fallback', identity());
  lights.endFrame();
  const [heads, tails] = meshes(lights);
  const raycaster = new THREE.Raycaster();
  for (const [mesh, direction] of [
    [heads, -1],
    [tails, 1],
  ]) {
    for (let slot = 0; slot < mesh.count; slot++) {
      const centre = positionAt(mesh, slot);
      raycaster.set(centre, new THREE.Vector3(0, 0, direction));
      const hits = raycaster.intersectObject(body, false);
      assert(
        hits.length > 0,
        'head/tail overlay remains directly over a fallback body face',
      );
      assert(
        Math.abs(hits[0].distance - 0.004) < 1e-6,
        'overlay is only 4 mm off the actual bumper, rather than floating at the GLB nose',
      );
      const transform = new THREE.Matrix4();
      mesh.getMatrixAt(slot, transform);
      const vertices = mesh.geometry.getAttribute('position');
      const bounds = new THREE.Box3().setFromObject(body);
      for (let i = 0; i < vertices.count; i++) {
        const p = new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(transform);
        assert(p.x > bounds.min.x && p.x < bounds.max.x);
        assert(p.y > bounds.min.y && p.y < bounds.max.y);
      }
    }
  }
  lights.dispose();
  body.geometry.dispose();
  body.material.dispose();
});

test('one owner disposes all three shared buffers, materials and instance allocations exactly once', () => {
  const parent = new THREE.Group();
  const lights = new TrafficNightLights(parent);
  let geometries = 0,
    materials = 0,
    instances = 0;
  for (const mesh of meshes(lights)) {
    mesh.geometry.addEventListener('dispose', () => geometries++);
    mesh.material.addEventListener('dispose', () => materials++);
    mesh.addEventListener('dispose', () => instances++);
  }
  lights.dispose();
  lights.dispose();
  assert.equal(geometries, 3);
  assert.equal(materials, 3);
  assert.equal(instances, 3);
  assert.equal(parent.children.length, 0);
  assert.equal(lights.group.children.length, 0);
  assert.equal(lights.stats.disposed, true);
  lights.beginFrame(camera, frame());
  assert.equal(lights.addVehicle('sedan', identity()), false);
  lights.endFrame();
  assert.equal(lights.stats.drawCalls, 0);
});

test('real Blender fleet pose visitors drive lamps at the same elapsed time, terrain and LOD pose', async () => {
  const routes = [
    { a: [0, 0], b: [120, 160], length: 200, speed: 8, phase: 0.2 },
    { a: [10, 20], b: [10, 220], length: 200, speed: 6, phase: 0.1 },
  ];
  const parent = new THREE.Group();
  const fleet = new TrafficVehicleAssets(routes, parent, load);
  const lights = new TrafficNightLights(parent);
  const ground = (x, z) => 7 + x * 0.08 + z * 0.06;
  const nearCamera = new THREE.Vector3(24, 13, 32);
  const seen = [];
  const visitor = (model, matrix, index) => {
    seen.push({ model, matrix: matrix.clone(), index });
    lights.addVehicle(model, matrix);
  };
  lights.beginFrame(nearCamera, frame({ roadHeight: ground }));
  assert.equal(fleet.update(0, nearCamera, ground, visitor), false);
  lights.endFrame();
  assert.equal(
    seen.length,
    0,
    'unloaded fleet never submits phantom car lamps',
  );
  await fleet.ready;
  for (const elapsed of [0, 1, 1]) {
    seen.length = 0;
    lights.beginFrame(nearCamera, frame({ roadHeight: ground }));
    assert(fleet.update(elapsed, nearCamera, ground, visitor));
    lights.endFrame();
    assert.deepEqual(
      seen.map((item) => item.index),
      [0, 1],
    );
    assert.equal(lights.stats.vehicles, 2);
    const offset =
      seen[0].model === 'suv'
        ? new THREE.Vector3(-0.6138, 0.895, 2.382)
        : new THREE.Vector3(-0.594, 0.755, 2.307);
    near(positionAt(meshes(lights)[0], 0), offset.applyMatrix4(seen[0].matrix));
    const actualFleetMesh = fleet.group.children.find(
      (mesh) =>
        mesh.visible && mesh.name === `Traffic ${seen[0].model} LOD0 paint`,
    );
    const rendered = new THREE.Matrix4();
    actualFleetMesh.getMatrixAt(0, rendered);
    assert.deepEqual(
      rendered.elements,
      seen[0].matrix.elements.map(Math.fround),
    );
    const root = new THREE.Vector3().setFromMatrixPosition(seen[0].matrix);
    const progress =
      routes[0].phase + (elapsed * routes[0].speed) / routes[0].length;
    assert(Math.abs(root.x - 120 * progress) < 1e-5);
    assert(Math.abs(root.z - 160 * progress) < 1e-5);
    assert(Math.abs(root.y - ground(root.x, root.z)) < 1e-5);
  }
  lights.dispose();
  fleet.dispose();
});
