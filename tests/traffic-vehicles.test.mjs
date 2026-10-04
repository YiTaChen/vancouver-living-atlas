import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const {
  TrafficVehicleAssets,
  TRAFFIC_VEHICLE_ASSETS,
  trafficRoleGeometry,
  trafficVehicleUrl,
} = await import(cityModule('traffic-vehicles'));
const directory = new URL(
  '../public/models/blender/traffic-cars/',
  import.meta.url,
);
const sourceDirectory = new URL(
  '../tools/assets/traffic-car-templates/exports/',
  import.meta.url,
);
const bytesFor = (url) =>
  readFileSync(new URL(url.split('/').at(-1).split('?')[0], directory));
const load = async (url) => {
  const bytes = bytesFor(url);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
};
const route = (x = 0) => ({
  a: [x, 0],
  b: [x, 200],
  length: 200,
  speed: 8,
  phase: 0.2,
});

test('production traffic exports match the six original Blender payloads and versioned URLs', () => {
  for (const asset of TRAFFIC_VEHICLE_ASSETS) {
    const url = trafficVehicleUrl(asset),
      bytes = bytesFor(url);
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.hash);
    assert(url.endsWith(`?v=${asset.hash.slice(0, 12)}`));
    assert.deepEqual(
      bytes,
      readFileSync(
        new URL(url.split('/').at(-1).split('?')[0], sourceDirectory),
      ),
    );
    const jsonLength = bytes.readUInt32LE(12),
      gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
    assert.equal(gltf.images?.length ?? 0, 0);
    assert.equal(gltf.textures?.length ?? 0, 0);
  }
});

test('role batching retains exact triangles, bounds, RGBA lenses and original wheel pivots for every LOD', async () => {
  for (const asset of TRAFFIC_VEHICLE_ASSETS) {
    const gltf = await load(trafficVehicleUrl(asset)),
      sourceBounds = new THREE.Box3().setFromObject(gltf.scene);
    const geometry = trafficRoleGeometry(gltf.scene),
      bounds = new THREE.Box3();
    let triangles = 0,
      wheelVertices = 0;
    for (const [role, geo] of Object.entries(geometry)) {
      assert(geo.getAttribute('normal'));
      assert.equal(geo.groups.length, 0);
      bounds.union(geo.boundingBox);
      triangles += geo.getAttribute('position').count / 3;
      const anchors = geo.getAttribute('trafficWheel');
      const pivots = new Set();
      for (let i = 0; i < anchors.count; i++) {
        if (anchors.getW(i) === 0) continue;
        wheelVertices++;
        const radius = asset.model === 'sedan' ? 0.32 : 0.35;
        assert(Math.abs(anchors.getW(i) - radius) < 1e-6);
        assert(Math.abs(anchors.getY(i) - radius) < 1e-6);
        pivots.add(
          [anchors.getX(i).toFixed(3), anchors.getZ(i).toFixed(3)].join(','),
        );
      }
      if (pivots.size) assert.equal(pivots.size, 4);
      const color = geo.getAttribute('color');
      assert.equal(color.itemSize, 4);
      if (role === 'glass') {
        const distinct = new Set(
          Array.from({ length: color.count }, (_, i) =>
            [color.getX(i), color.getY(i), color.getZ(i)].join(','),
          ),
        );
        assert(
          distinct.size >= 3,
          'white headlights, red tail lenses and dark windows remain distinct',
        );
      }
      geo.dispose();
    }
    assert.equal(triangles, [1252, 564, 116][asset.lod]);
    assert.equal(wheelVertices > 0, asset.lod < 2);
    assert(bounds.min.distanceTo(sourceBounds.min) < 1e-6);
    assert(bounds.max.distanceTo(sourceBounds.max) < 1e-6);
    assert(
      Math.abs(bounds.min.y) < 1e-6,
      'vehicle root is the tire contact plane',
    );
  }
});

test('fleet keeps route speed, palette and tire datum, follows road pitch, and owns three shared materials', async () => {
  const parent = new THREE.Group(),
    fleet = new TrafficVehicleAssets([route()], parent, load);
  assert.equal(
    fleet.update(0, new THREE.Vector3(0, 10, 40), () => 7),
    false,
  );
  await fleet.ready;
  assert.equal(fleet.stats.status, 'ready');
  const camera = new THREE.Vector3(0, 10, 40);
  assert.equal(
    fleet.update(0, camera, (_x, z) => 7 + 0.06 * z),
    true,
  );
  assert.equal(fleet.stats.actors, 1);
  assert.deepEqual(fleet.stats.lodCounts, [1, 0, 0]);
  assert.equal(fleet.stats.triangles, 1252);
  assert.equal(fleet.stats.drawCalls, 3);
  assert.equal(fleet.stats.assetBytes, 453244);
  assert.equal(
    new Set(fleet.group.children.map((mesh) => mesh.material)).size,
    3,
  );
  const meshes = fleet.group.children.filter((mesh) => mesh.visible);
  const matrix = new THREE.Matrix4();
  meshes[0].getMatrixAt(0, matrix);
  assert(Math.abs(matrix.elements[13] - 9.4) < 1e-6);
  assert.equal(matrix.elements[14], 40);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  assert(Math.abs(forward.y / forward.z - 0.06) < 1e-6);
  assert(meshes[0].instanceColor, 'paint uses the previous instance palette');
  assert(
    !meshes[1].instanceColor,
    'windows and lenses are not tinted with car paint',
  );
  assert(!meshes[2].instanceColor, 'rubber is not tinted with car paint');
  fleet.update(1, camera, (_x, z) => 7 + 0.06 * z);
  meshes[0].getMatrixAt(0, matrix);
  assert.equal(matrix.elements[14], 48, 'movement uses elapsed seconds');
  const travel = meshes[0].geometry.getAttribute('trafficTravel').getX(0);
  const anchors = meshes[2].geometry.getAttribute('trafficWheel');
  let radius;
  for (let i = 0; i < anchors.count; i++)
    if (anchors.getW(i)) {
      radius = anchors.getW(i);
      break;
    }
  assert(Math.abs(travel - (8 % (2 * Math.PI * radius))) < 1e-5);
  // Check the actual material hook supplied to Three for position AND normals.
  const shader = {
    vertexShader:
      '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
  };
  meshes[0].material.onBeforeCompile(shader);
  assert(
    shader.vertexShader.includes(
      'objectNormal = rotateTrafficWheel(objectNormal)',
    ),
  );
  assert(shader.vertexShader.includes('transformed - trafficWheel.xyz'));
  let disposedGeometry = 0,
    disposedMaterial = 0,
    disposedInstances = 0;
  for (const mesh of fleet.group.children) {
    mesh.geometry.addEventListener('dispose', () => disposedGeometry++);
    mesh.addEventListener('dispose', () => disposedInstances++);
  }
  for (const material of new Set(
    fleet.group.children.map((mesh) => mesh.material),
  ))
    material.addEventListener('dispose', () => disposedMaterial++);
  fleet.dispose();
  fleet.dispose();
  assert.equal(disposedGeometry, 18);
  assert.equal(disposedMaterial, 3);
  assert.equal(disposedInstances, 18);
  assert.equal(parent.children.length, 0);
  assert.equal(
    fleet.update(2, camera, () => 0),
    false,
  );
});

test('all four wheel contact anchors lie on an oblique asphalt plane without changing route heading', async () => {
  const r = { a: [0, 0], b: [120, 160], length: 200, speed: 8, phase: 0.2 };
  const fleet = new TrafficVehicleAssets([r], new THREE.Group(), load);
  await fleet.ready;
  const height = (x, z) => 7 + x * 0.08 + z * 0.06;
  fleet.update(0, new THREE.Vector3(24, 13, 32), height);
  const mesh = fleet.group.children.find(
    (node) => node.visible && node.name.endsWith('rubber'),
  );
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  assert(Math.abs(forward.x / forward.z - 120 / 160) < 1e-6);
  const anchors = mesh.geometry.getAttribute('trafficWheel'),
    contact = new THREE.Vector3(),
    pivots = new Set();
  for (let i = 0; i < anchors.count; i++) {
    const radius = anchors.getW(i);
    if (!radius) continue;
    // Local wheel-center minus local +Y radius is the plane contact datum.
    contact
      .set(anchors.getX(i), anchors.getY(i) - radius, anchors.getZ(i))
      .applyMatrix4(matrix);
    assert(Math.abs(contact.y - height(contact.x, contact.z)) < 1e-6);
    pivots.add(`${anchors.getX(i)},${anchors.getZ(i)}`);
  }
  assert.equal(pivots.size, 4);
  fleet.dispose();
});

test('LOD budgets preserve all actors, pack instances, and retain hysteresis at transitions', async () => {
  const fleet = new TrafficVehicleAssets(
    Array.from({ length: 300 }, () => route()),
    new THREE.Group(),
    load,
  );
  await fleet.ready;
  fleet.update(0, new THREE.Vector3(0, 5, 40), () => 0);
  assert.deepEqual(fleet.stats.lodCounts, [64, 192, 44]);
  assert.equal(fleet.stats.actors, 300);
  assert.equal(fleet.stats.triangles, 64 * 1252 + 192 * 564 + 44 * 116);
  assert(fleet.stats.drawCalls <= 18);
  for (const mesh of fleet.group.children)
    assert(mesh.count <= mesh.instanceMatrix.count);
  fleet.update(0, new THREE.Vector3(0, 1000, 40), () => 0);
  assert.deepEqual(fleet.stats.lodCounts, [0, 0, 300]);
  assert.equal(fleet.stats.drawCalls, 6);
  assert.equal(fleet.stats.triangles, 300 * 116);
  fleet.dispose();
  const single = new TrafficVehicleAssets([route()], new THREE.Group(), load);
  await single.ready;
  for (const [distance, lod] of [
    [64, 0],
    [70, 0],
    [76, 1],
    [70, 1],
    [64, 0],
    [250, 2],
    [230, 2],
    [210, 1],
  ]) {
    single.update(0, new THREE.Vector3(distance, 0, 40), () => 0);
    assert.equal(single.stats.lodCounts[lod], 1);
  }
  single.dispose();
});

test('QA comparison restores fallback without releasing templates and cannot disable production traffic', async () => {
  const fleet = new TrafficVehicleAssets([route()], new THREE.Group(), load),
    prior = process.env.VANCOUVER_VISUAL_QA;
  await fleet.ready;
  try {
    delete process.env.VANCOUVER_VISUAL_QA;
    assert.equal(fleet.setEnabled(false), false);
    assert.equal(fleet.stats.enabled, true);
    process.env.VANCOUVER_VISUAL_QA = '1';
    const camera = new THREE.Vector3(0, 5, 40);
    assert.equal(
      fleet.update(0, camera, () => 0),
      true,
    );
    assert.equal(fleet.group.visible, true);
    assert.equal(fleet.setEnabled(false), true);
    assert.equal(fleet.stats.enabled, false);
    assert.equal(fleet.group.visible, false);
    assert.equal(fleet.stats.drawCalls, 0);
    assert.equal(fleet.stats.triangles, 0);
    assert.equal(
      fleet.update(1, camera, () => 0),
      false,
      'environment uses the original boxes',
    );
    assert.equal(
      fleet.group.children.length,
      18,
      'QA switching keeps cached templates',
    );
    assert.equal(fleet.setEnabled(true), true);
    assert.equal(
      fleet.update(2, camera, () => 0),
      true,
    );
    assert.equal(fleet.stats.actors, 1);
    assert.equal(fleet.group.visible, true);
  } finally {
    if (prior === undefined) delete process.env.VANCOUVER_VISUAL_QA;
    else process.env.VANCOUVER_VISUAL_QA = prior;
    fleet.dispose();
  }
});

test('late payloads after disposal release their resources once without attaching instances', async () => {
  const pending = [],
    parent = new THREE.Group();
  const fleet = new TrafficVehicleAssets(
    [route()],
    parent,
    (url) => new Promise((resolve) => pending.push({ url, resolve })),
  );
  fleet.dispose();
  fleet.dispose();
  let geometryDisposals = 0,
    materialDisposals = 0,
    expectedGeometries = 0,
    expectedMaterials = 0;
  for (const { url, resolve } of pending) {
    const gltf = await load(url),
      geometries = new Set(),
      materials = new Set();
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.add(material);
    });
    for (const geometry of geometries)
      geometry.addEventListener('dispose', () => geometryDisposals++);
    for (const material of materials)
      material.addEventListener('dispose', () => materialDisposals++);
    expectedGeometries += geometries.size;
    expectedMaterials += materials.size;
    resolve(gltf);
  }
  await fleet.ready;
  assert.equal(geometryDisposals, expectedGeometries);
  assert.equal(materialDisposals, expectedMaterials);
  assert.equal(parent.children.length, 0);
  assert.equal(fleet.group.children.length, 0);
  assert.equal(fleet.stats.status, 'disposed');
});

test('one failed asset retains the fallback; malformed roles and unexpected maps are rejected', async () => {
  const fleet = new TrafficVehicleAssets([route()], new THREE.Group(), (url) =>
    url.includes('suv.lod1') ? Promise.reject(new Error('offline')) : load(url),
  );
  await fleet.ready;
  assert.equal(fleet.stats.status, 'error');
  assert.equal(
    fleet.update(0, new THREE.Vector3(), () => 0),
    false,
  );
  assert.equal(fleet.group.children.length, 0);
  fleet.dispose();
  const gltf = await load(trafficVehicleUrl(TRAFFIC_VEHICLE_ASSETS[0]));
  const paint = gltf.scene.getObjectByName('body-shell').material;
  paint.name = 'unrecognised';
  assert.throws(() => trafficRoleGeometry(gltf.scene), /unknown material role/);
  paint.name = 'paint';
  paint.map = new THREE.Texture();
  assert.throws(() => trafficRoleGeometry(gltf.scene), /texture-free/);
});
