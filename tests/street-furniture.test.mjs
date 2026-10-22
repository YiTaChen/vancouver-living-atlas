import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { StreetFurniture, flattenStreetFurniture, streetFurnitureUrl } =
  await import(cityModule('street-furniture'));
const { DetailWorkBudget } = await import(cityModule('scenery-motion'));
const { SSAOExclusions } = await import(cityModule('ssao-exclusions'));
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);
const manifest = JSON.parse(
  readFileSync(
    new URL(
      '../public/models/blender/street-furniture/manifest.json',
      import.meta.url,
    ),
  ),
);
const loader = async (url) => {
  const bytes = readFileSync(
    new URL(`../public${url.split('?')[0]}`, import.meta.url),
  );
  return (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
  ).scene;
};
const placement = (id, kind = 'cedar-bench', x = 0, z = 5) => ({
  id: String(id),
  kind,
  x,
  y: 7.25,
  z,
  yaw: Math.PI / 3,
  sourceIds: [`way:${id}`],
  streetNames: ['Robson Street'],
});
const host = (quality = 'high') => ({
  camera: new THREE.PerspectiveCamera(),
  landmarks: new THREE.Group(),
  settings: { quality, buildings: true },
  disposed: false,
  sceneryMotion: {
    nowMs: 10000,
    allowNewDetails: true,
    selectionIntervalMs: 120,
  },
});
const tick = async (furniture, e, milliseconds = 20) => {
  e.sceneryMotion.nowMs += milliseconds;
  e.detailWorkBudget?.reset(1.25, 2);
  furniture.update(true);
  await new Promise((resolve) => setImmediate(resolve));
};
const settle = async (furniture, e) => {
  for (let i = 0; i < 40 && !furniture.ready; i++) await tick(furniture, e);
  assert.equal(furniture.stats().status, 'ready');
};

test('all adopted source triangles, transforms, indexed attributes and authored PBR values survive role batching', async () => {
  for (const asset of manifest.assets)
    for (const lod of asset.lods) {
      const url = streetFurnitureUrl(asset, lod);
      assert(url.endsWith(`?v=${lod.sha256.slice(0, 12)}`));
      const scene = await loader(url),
        sourceBounds = new THREE.Box3().setFromObject(scene, true);
      const sourceMaterials = new Map(),
        attributeCounts = new Map();
      scene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        sourceMaterials.set(node.material.name, {
          color: node.material.color.toArray(),
          metalness: node.material.metalness,
          roughness: node.material.roughness,
        });
        for (const [name, attribute] of Object.entries(
          node.geometry.attributes,
        ))
          attributeCounts.set(
            name,
            (attributeCounts.get(name) ?? 0) + attribute.count,
          );
      });
      const parts = flattenStreetFurniture(scene, asset.id),
        bounds = new THREE.Box3();
      let triangles = 0;
      const retained = new Map();
      for (const part of parts) {
        assert(part.geometry.index, 'indexed source topology remains indexed');
        assert.equal(part.geometry.groups.length, 0);
        triangles += part.geometry.index.count / 3;
        bounds.union(part.geometry.boundingBox);
        for (const [name, attribute] of Object.entries(
          part.geometry.attributes,
        ))
          retained.set(name, (retained.get(name) ?? 0) + attribute.count);
        assert.deepEqual(
          part.material.color.toArray(),
          sourceMaterials.get(part.role).color,
        );
        assert.equal(
          part.material.metalness,
          sourceMaterials.get(part.role).metalness,
        );
        assert.equal(
          part.material.roughness,
          sourceMaterials.get(part.role).roughness,
        );
        assert.equal(part.material.transparent, false);
        assert.equal(
          Object.values(part.material).filter((v) => v instanceof THREE.Texture)
            .length,
          0,
        );
        part.geometry.dispose();
        part.material.dispose();
      }
      assert.equal(triangles, lod.triangles);
      assert.deepEqual(retained, attributeCounts);
      for (const attribute of ['position', 'normal', 'uv', 'tangent'])
        assert(retained.has(attribute));
      assert(bounds.min.distanceTo(sourceBounds.min) < 1e-6);
      assert(bounds.max.distanceTo(sourceBounds.max) < 1e-6);
      assert(
        Math.abs(bounds.min.y) < 1e-6,
        'ground-contact source datum is unchanged',
      );
    }
});

test('constructor is idle; distant, hidden and admission-blocked views request nothing', async () => {
  const e = host(),
    calls = [],
    furniture = new StreetFurniture(e, [placement('a')], async (url) => {
      calls.push(url);
      return loader(url);
    });
  assert.equal(furniture.stats().status, 'idle');
  assert.equal(calls.length, 0);
  e.camera.position.set(0, 500, 0);
  await tick(furniture, e);
  assert.equal(calls.length, 0, 'high flight does not request ground props');
  e.camera.position.set(0, 9, 0);
  e.settings.buildings = false;
  await tick(furniture, e);
  e.settings.buildings = true;
  e.sceneryMotion.allowNewDetails = false;
  await tick(furniture, e);
  assert.equal(calls.length, 0);
  furniture.dispose();
});

test('preparation obeys the shared budget, defers asynchronous payloads while flying and wraps before publication', async () => {
  const e = host(),
    calls = [],
    wraps = [];
  e.camera.position.set(0, 9, 0);
  e.detailWorkBudget = new DetailWorkBudget(() => 0);
  e.prepareNightReceivers = (group) => {
    assert.equal(
      group.parent,
      null,
      'new receivers are wrapped before any live scene publication',
    );
    wraps.push(group.children.length);
  };
  const furniture = new StreetFurniture(e, [placement('a')], async (url) => {
    calls.push(url);
    return loader(url);
  });
  e.detailWorkBudget.reset(0, 0);
  furniture.update();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  await tick(furniture, e);
  assert.equal(calls.length, 1);
  assert.equal(furniture.stats().pendingPreparation, 1);
  e.sceneryMotion.allowNewDetails = false;
  await tick(furniture, e);
  assert.equal(furniture.stats().loadedAssets, 0);
  assert.equal(wraps.length, 0);
  e.sceneryMotion.allowNewDetails = true;
  await settle(furniture, e);
  assert.equal(calls.length, 6);
  assert.deepEqual(
    wraps.sort((a, b) => a - b),
    [1, 1, 1, 1, 2, 2],
  );
  assert.equal(furniture.stats().batches, 8);
  assert.equal(
    furniture.stats().materials,
    2,
    'two authored opaque roles are shared across all kinds and LODs',
  );
  assert.equal(furniture.stats().assetBytes, 202880);
  assert.equal(furniture.stats().textures, 0);
  furniture.dispose();
});

test('fixed instance pools retain exact unit scale and ground heights, and blend LODs without repeated uploads', async () => {
  const e = host(),
    p = placement('bench', 'cedar-bench', 0, 29);
  e.camera.position.set(0, 7.25, 0);
  const furniture = new StreetFurniture(e, [p], loader);
  await settle(furniture, e);
  assert.deepEqual(furniture.stats().submittedByLod, [1, 1]);
  assert.equal(furniture.stats().visible, 1);
  assert.equal(furniture.stats().drawCalls, 4);
  assert.equal(furniture.stats().submittedTriangles, 956);
  const matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  for (const mesh of furniture.group.children.filter((mesh) => mesh.visible)) {
    mesh.getMatrixAt(0, matrix);
    matrix.decompose(position, rotation, scale);
    assert(position.distanceTo(new THREE.Vector3(p.x, p.y, p.z)) < 1e-5);
    assert(scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.depthWrite, true);
    assert.equal(mesh.instanceMatrix.count, 64);
  }
  const versions = furniture.group.children.map(
      (mesh) => mesh.instanceMatrix.version,
    ),
    uploads = furniture.stats().uploads;
  for (let i = 0; i < 100; i++) await tick(furniture, e);
  assert.equal(furniture.stats().uploads, uploads);
  assert.deepEqual(
    furniture.group.children.map((mesh) => mesh.instanceMatrix.version),
    versions,
  );
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <clipping_planes_fragment>',
  };
  furniture.group.children[0].material.onBeforeCompile(shader);
  assert(shader.vertexShader.includes('instanceMatrix * furnitureWorld'));
  assert(shader.fragmentShader.includes('smoothstep(24.0, 34.0'));
  assert(shader.fragmentShader.includes('discard'));
  assert(shader.uniforms.furnitureNow);
  assert(shader.uniforms.furnitureRange);
  furniture.dispose();
});

test('crossing all LOD admission and blend distances keeps both source pools without any instance upload', async () => {
  const e = host(),
    p = placement('same-bench', 'cedar-bench', 0, 0);
  e.camera.position.set(0, p.y, 12);
  const furniture = new StreetFurniture(e, [p], loader);
  await settle(furniture, e);
  const uploads = furniture.stats().uploads,
    versions = furniture.group.children.map(
      (mesh) => mesh.instanceMatrix.version,
    );
  for (const distance of [17, 18, 20, 24, 29, 34, 38, 44, 90, 35, 28, 23, 12]) {
    e.camera.position.z = distance;
    await tick(furniture, e, 750);
    assert.equal(
      furniture.stats().uploads,
      uploads,
      `no instance upload at ${distance} m`,
    );
    assert.deepEqual(furniture.stats().submittedByLod, [1, 1]);
    assert.equal(furniture.stats().submittedTriangles, 956);
    assert.deepEqual(
      furniture.group.children.map((mesh) => mesh.instanceMatrix.version),
      versions,
    );
  }
  furniture.dispose();
});

test('live SSAO exclusions enroll every asynchronous furniture pool and restore exact visibility through every fade transition', async () => {
  const e = host(),
    scene = new THREE.Scene();
  scene.add(e.landmarks);
  const exclusions = new SSAOExclusions(scene),
    furniture = new StreetFurniture(
      e,
      [
        placement('bench'),
        placement('bin', 'garbage-bin', 2),
        placement('rack', 'bicycle-rack', 4),
      ],
      loader,
    );
  e.camera.position.set(0, 7.25, 0);
  await settle(furniture, e);
  assert.equal(
    exclusions.stats.candidates,
    8,
    'all late asset pools are enrolled before drawing',
  );
  for (const distance of [0, 18, 24, 29, 34, 38, 125, 145, 0]) {
    e.camera.position.z = distance;
    await tick(furniture, e, 750);
    const visibility = furniture.group.children.map((mesh) => mesh.visible);
    exclusions.render(() => {
      assert(furniture.group.children.every((mesh) => mesh.visible === false));
    });
    assert.deepEqual(
      furniture.group.children.map((mesh) => mesh.visible),
      visibility,
    );
    assert.equal(
      exclusions.stats.hiddenLastPass,
      visibility.filter(Boolean).length,
    );
  }
  furniture.dispose();
  assert.equal(exclusions.stats.candidates, 0);
  exclusions.dispose();
});

test('leaving and re-entering the same selected IDs uploads a fresh admission timestamp', async () => {
  const e = host(),
    furniture = new StreetFurniture(e, [placement('same')], loader);
  e.camera.position.set(0, 7.25, 12);
  await settle(furniture, e);
  const initialUploads = furniture.stats().uploads;
  const nearMesh = furniture.group.children.find((mesh) => mesh.visible);
  const initialAdmitted = nearMesh.geometry
    .getAttribute('furnitureAdmission')
    .getX(0);
  e.camera.position.z = 400;
  await tick(furniture, e, 750);
  assert.deepEqual(furniture.stats().visibleIds, []);
  e.camera.position.z = 12;
  await tick(furniture, e, 750);
  assert.deepEqual(furniture.stats().visibleIds, ['same']);
  assert.equal(furniture.stats().uploads, initialUploads + 2);
  const admitted = nearMesh.geometry.getAttribute('furnitureAdmission').getX(0);
  assert(admitted > initialAdmitted);
  assert(Math.abs(admitted - e.sceneryMotion.nowMs / 1000) < 1e-5);
  furniture.dispose();
});

test('quality caps stay bounded while the camera crosses many districts; compatibility and hidden buildings retain pools', async () => {
  const e = host('balanced'),
    placements = Array.from({ length: 200 }, (_, i) =>
      placement(
        i,
        manifest.assets[i % 3].id,
        (i % 20) * 3,
        Math.floor(i / 20) * 3,
      ),
    );
  e.camera.position.set(25, 9, 15);
  const furniture = new StreetFurniture(e, placements, loader);
  await settle(furniture, e);
  assert.equal(furniture.stats().visible, 24);
  e.settings.quality = 'high';
  await tick(furniture, e);
  assert.equal(furniture.stats().visible, 40);
  e.settings.quality = 'ultra';
  await tick(furniture, e);
  assert.equal(furniture.stats().visible, 64);
  const geometries = furniture.group.children.map((mesh) => mesh.geometry),
    materials = furniture.group.children.map((mesh) => mesh.material);
  e.compatibleGraphics = true;
  await tick(furniture, e);
  assert.equal(furniture.stats().visible, 16);
  for (let i = 0; i < 30; i++) {
    e.camera.position.set(i * 300, 9, 0);
    await tick(furniture, e, 300);
    assert(furniture.stats().drawCalls <= 8);
    assert.equal(furniture.stats().batches, 8);
  }
  assert.deepEqual(
    furniture.group.children.map((mesh) => mesh.geometry),
    geometries,
  );
  assert.deepEqual(
    furniture.group.children.map((mesh) => mesh.material),
    materials,
  );
  e.settings.buildings = false;
  await tick(furniture, e);
  assert.equal(furniture.stats().visible, 0);
  assert.equal(furniture.stats().drawCalls, 0);
  furniture.dispose();
});

test('fast movement admits nearby IDs from prepared pools without additional requests, geometry or materials', async () => {
  const e = host(),
    furniture = new StreetFurniture(
      e,
      [
        placement('old', 'garbage-bin', 0, 10),
        placement('new', 'bicycle-rack', 0, 180),
      ],
      loader,
    );
  e.camera.position.set(0, 9, 0);
  await settle(furniture, e);
  assert.deepEqual(furniture.stats().visibleIds, ['old']);
  const meshes = [...furniture.group.children],
    geometries = meshes.map((mesh) => mesh.geometry),
    materials = meshes.map((mesh) => mesh.material),
    initial = furniture.stats();
  e.sceneryMotion.allowNewDetails = false;
  e.sceneryMotion.fast = true;
  e.camera.position.z = 65;
  await tick(furniture, e, 300);
  assert.deepEqual(
    new Set(furniture.stats().visibleIds),
    new Set(['old', 'new']),
  );
  assert.deepEqual(furniture.group.children, meshes);
  assert.deepEqual(
    furniture.group.children.map((mesh) => mesh.geometry),
    geometries,
  );
  assert.deepEqual(
    furniture.group.children.map((mesh) => mesh.material),
    materials,
  );
  const current = furniture.stats();
  for (const metric of [
    'attempts',
    'loadedAssets',
    'batches',
    'geometries',
    'materials',
    'assetBytes',
  ])
    assert.equal(
      current[metric],
      initial[metric],
      `${metric} remains unchanged`,
    );
  const newMesh = meshes.find(
    (mesh) => mesh.visible && mesh.name.includes('bicycle-rack'),
  );
  const admitted = newMesh.geometry.getAttribute('furnitureAdmission').getX(0);
  assert(
    Math.abs(admitted - e.sceneryMotion.nowMs / 1000) < 1e-5,
    'newly selected prepared actor starts the normal 0.3 s shader fade',
  );
  furniture.dispose();
});

test('live night-receiver wrapping preserves the furniture fade and creates one wrapper per shared material', async () => {
  const e = host(),
    lighting = new NightStreetLighting({
      bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
      size: 128,
      allowed: () => true,
      lamps: [{ x: 0, y: 16, z: 10 }],
      roads: [{ a: [-90, 7.25, 10], b: [90, 7.25, 10], width: 10 }],
    });
  e.camera.position.set(0, 9, 0);
  let wrappers = 0;
  e.prepareNightReceivers = (group) =>
    group.traverse((node) => {
      if (node instanceof THREE.Mesh && lighting.wrapMaterial(node.material))
        wrappers++;
    });
  const furniture = new StreetFurniture(e, [placement('a')], loader);
  await settle(furniture, e);
  assert.equal(wrappers, 2);
  lighting.update(23, 1);
  for (const material of new Set(
    furniture.group.children.map((mesh) => mesh.material),
  )) {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader, {});
    assert(shader.vertexShader.includes('vFurnitureWorld'));
    assert(shader.vertexShader.includes('vAtlasNightStreetWorld'));
    assert(shader.fragmentShader.includes('furnitureCoverage'));
    assert(shader.fragmentShader.includes('atlasNightFieldSample'));
    assert.equal(shader.uniforms.uAtlasNightAmount.value, 1);
    assert(
      material.customProgramCacheKey().includes('street-furniture-fade-v1'),
    );
    assert(material.customProgramCacheKey().includes('atlas-night-street-v1'));
  }
  furniture.dispose();
  lighting.dispose();
});

test('a failed preparation releases unpublished resources and successfully retries after cooldown', async () => {
  const e = host();
  e.camera.position.set(0, 9, 0);
  let failed = false,
    disposedGeometry = 0,
    disposedMaterial = 0,
    disposedInstances = 0;
  e.prepareNightReceivers = (group) => {
    if (failed) return;
    failed = true;
    for (const mesh of group.children) {
      mesh.geometry.addEventListener('dispose', () => disposedGeometry++);
      mesh.material.addEventListener('dispose', () => disposedMaterial++);
      mesh.addEventListener('dispose', () => disposedInstances++);
    }
    throw new Error('simulated shader preparation failure');
  };
  const furniture = new StreetFurniture(e, [placement('a')], loader);
  for (let i = 0; i < 20; i++) await tick(furniture, e);
  assert.equal(furniture.stats().failures, 1);
  assert.equal(furniture.stats().visible, 0);
  assert.equal(disposedGeometry, 2);
  assert.equal(disposedMaterial, 2);
  assert.equal(disposedInstances, 2);
  await tick(furniture, e, 2100);
  await settle(furniture, e);
  assert.equal(furniture.stats().attempts, 7);
  assert.equal(furniture.stats().batches, 8);
  assert.equal(furniture.stats().materials, 2);
  furniture.dispose();
});

test('permanent request failure retries once after a cooldown and never publishes partial furniture', async () => {
  const e = host(),
    calls = [];
  e.camera.position.set(0, 9, 0);
  const furniture = new StreetFurniture(e, [placement('a')], async (url) => {
    calls.push(url);
    if (url.includes('cedar-bench.lod0')) throw new Error('offline');
    return loader(url);
  });
  for (let i = 0; i < 20; i++) await tick(furniture, e);
  assert.equal(
    calls.filter((url) => url.includes('cedar-bench.lod0')).length,
    1,
  );
  assert.equal(furniture.ready, false);
  assert.equal(furniture.stats().visible, 0);
  await tick(furniture, e, 2100);
  for (let i = 0; i < 100; i++) await tick(furniture, e);
  assert.equal(
    calls.filter((url) => url.includes('cedar-bench.lod0')).length,
    2,
  );
  assert.equal(furniture.stats().status, 'error');
  assert.equal(furniture.stats().failures, 2);
  assert.equal(furniture.group.visible, false);
  furniture.dispose();
});

test('failed source validation releases every buffer, material and unexpected texture', () => {
  const scene = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    texture = new THREE.Texture(),
    material = new THREE.MeshStandardMaterial({ map: texture });
  material.name = 'metal';
  scene.add(new THREE.Mesh(geometry, material));
  let geometries = 0,
    materials = 0,
    textures = 0;
  geometry.addEventListener('dispose', () => geometries++);
  material.addEventListener('dispose', () => materials++);
  texture.addEventListener('dispose', () => textures++);
  assert.throws(
    () => flattenStreetFurniture(scene, 'garbage-bin'),
    /texture-free/,
  );
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
  assert.equal(textures, 1);
});

test('disposal is idempotent and late promises release source resources without attaching', async () => {
  const e = host(),
    scene = await loader(
      streetFurnitureUrl(manifest.assets[0], manifest.assets[0].lods[0]),
    );
  e.camera.position.set(0, 9, 0);
  let resolve,
    disposedGeometry = 0,
    disposedMaterial = 0;
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.addEventListener('dispose', () => disposedGeometry++);
    node.material.addEventListener('dispose', () => disposedMaterial++);
  });
  const furniture = new StreetFurniture(
    e,
    [placement('a')],
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await tick(furniture, e);
  furniture.dispose();
  furniture.dispose();
  resolve(scene);
  await new Promise((r) => setImmediate(r));
  assert.equal(disposedGeometry, 2);
  assert.equal(disposedMaterial, 2);
  assert.equal(e.landmarks.children.length, 0);
  assert.equal(furniture.stats().status, 'disposed');
  assert.equal(furniture.stats().batches, 0);
  furniture.update();
});

test('loaded consumer owns exactly eight geometries, eight instance buffers and two shared materials', async () => {
  const e = host();
  e.camera.position.set(0, 9, 0);
  const furniture = new StreetFurniture(e, [placement('a')], loader);
  await settle(furniture, e);
  let geometries = 0,
    materials = 0,
    instances = 0;
  const unique = new Set();
  for (const mesh of furniture.group.children) {
    mesh.geometry.addEventListener('dispose', () => geometries++);
    mesh.addEventListener('dispose', () => instances++);
    unique.add(mesh.material);
  }
  unique.forEach((material) =>
    material.addEventListener('dispose', () => materials++),
  );
  furniture.dispose();
  furniture.dispose();
  assert.equal(geometries, 8);
  assert.equal(instances, 8);
  assert.equal(materials, 2);
  assert.equal(e.landmarks.children.length, 0);
});

test('occupied bench keeps one existing pool slot and range coverage when the seated camera moves far away', async () => {
  const e = host('balanced');
  const entries = Array.from({ length: 80 }, (_, i) =>
    placement(i, 'cedar-bench', i * 0.4, 5),
  );
  const furniture = new StreetFurniture(e, entries, loader);
  try {
    await settle(furniture, e);
    await tick(furniture, e, 500);
    assert.equal(furniture.hasVisiblePlacement('0'), true);
    const before = furniture.stats();
    furniture.setOccupied('0');
    e.camera.position.set(1000, 500, 1000);
    await tick(furniture, e);
    assert.deepEqual(furniture.stats().visibleIds, ['0']);
    assert(furniture.stats().visible <= 24);
    const material = furniture.group.children[0].material;
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <clipping_planes_fragment>',
    };
    material.onBeforeCompile(shader, {});
    assert(
      shader.uniforms.furnitureOccupied.value.equals(
        new THREE.Vector3(0, 7.25, 5),
      ),
    );
    assert(shader.fragmentShader.includes('max(furnitureOccupiedCoverage,'));
    assert.equal(furniture.stats().assetBytes, before.assetBytes);
    assert.equal(furniture.stats().geometries, before.geometries);
    assert.equal(furniture.stats().materials, before.materials);
    furniture.setOccupied(null);
    await tick(furniture, e);
    assert.equal(furniture.stats().visible, 0);
  } finally {
    furniture.dispose();
  }
});
