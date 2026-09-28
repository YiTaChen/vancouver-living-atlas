import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { streetBayThreshold, STREET_BAY_HEIGHT_M } = await import(
  cityModule('streetscape-placement')
);
const { StreetscapeKit, flattenStreetBay } = await import(
  cityModule('streetscape-kit')
);

const profile = {
  kind: 'heritage-brick',
  groundStoreyM: 4.35,
  pane: [0.15, 0.85, 0.2, 0.84],
  storeyM: 3.25,
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
function model() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.3), material));
  return group;
}
function host() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 4, 5);
  return {
    camera,
    landmarks: new THREE.Group(),
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
  };
}
function sources(count, spacing = 1) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    detailed: false,
    placement: {
      asset: 'heritage-shop-bay',
      x: id * spacing,
      y: 0,
      z: 0,
      yaw: 0,
    },
    setDetailed(active) {
      this.detailed = active;
    },
  }));
}
function pump(kit, frames = 8) {
  for (let i = 0; i < frames; i++) kit.update();
}

test('shipping glTF manifest stays inside the shared runtime height and forward-relief bounds', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../public/models/streetscape/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  for (const asset of manifest.assets)
    for (const lod of asset.lods) {
      assert.ok(
        lod.bounds.min[2] > 0,
        'back of relief is outside opaque GIS wall',
      );
      assert.ok(lod.bounds.max[1] <= STREET_BAY_HEIGHT_M + 1e-5);
      assert.ok(lod.bounds.max[1] >= STREET_BAY_HEIGHT_M - 0.01);
    }
});

test('bay clearance uses the real first upper pane, keeps level pavement and never stretches a door', () => {
  // Production datum: foundation is terrain - 0.4, pavement terrain + 1.18.
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [1.58, 1.58, 1.58]), 1.6);
  // The preserved sill starts at 4.83 m, so leave at least 0.02 m below it.
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [1.62, 1.62, 1.62]), null);
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [1.6, 1.6, 1.6]), null);
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [0.02, 0.04, 0.03]), 0.06);
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [1.65, 1.66, 1.65]), null);
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [0, 0.15, 0]), null);
  assert.equal(streetBayThreshold(profile, 12, 0, 0, [0, null, 0]), null);
  assert.equal(streetBayThreshold(profile, 12, 2, 0, [0, 0, 0]), null);
  assert.equal(streetBayThreshold(profile, 3.4, 0, 0, [0, 0, 0]), null);
});

test('glTF flattening preserves UV attributes, groups and transformed normals exactly once', () => {
  const scene = model(),
    mesh = scene.children[0];
  scene.position.set(10, 2, 3);
  scene.rotation.y = Math.PI / 2;
  mesh.position.x = 2;
  mesh.geometry.setAttribute('uv1', mesh.geometry.getAttribute('uv').clone());
  mesh.material.transparent = true;
  let originalReleased = false;
  mesh.geometry.addEventListener('dispose', () => {
    originalReleased = true;
  });
  scene.updateMatrixWorld(true);
  const expected = new THREE.Vector3()
    .fromBufferAttribute(mesh.geometry.getAttribute('position'), 0)
    .applyMatrix4(mesh.matrixWorld);
  const [part] = flattenStreetBay(scene);
  const actual = new THREE.Vector3().fromBufferAttribute(
    part.geometry.getAttribute('position'),
    0,
  );
  assert.ok(actual.distanceTo(expected) < 1e-5);
  assert.equal(
    part.geometry.getAttribute('uv1').count,
    part.geometry.getAttribute('uv').count,
  );
  assert.equal(part.geometry.groups.length, mesh.geometry.groups.length);
  assert.equal(part.material.depthWrite, false);
  assert.ok(originalReleased);
  part.geometry.dispose();
  part.material.map.dispose();
  part.material.dispose();
});

test('malformed glTF releases already-cloned buffers and every source texture/material', () => {
  const scene = model();
  const original = scene.children[0].geometry;
  let cloneDisposed = 0,
    sourceDisposed = 0,
    materialDisposed = 0,
    textureDisposed = 0;
  const clone = original.clone.bind(original);
  original.clone = () => {
    const result = clone();
    result.addEventListener('dispose', () => cloneDisposed++);
    return result;
  };
  original.addEventListener('dispose', () => sourceDisposed++);
  const material = scene.children[0].material;
  material.addEventListener('dispose', () => materialDisposed++);
  material.map.addEventListener('dispose', () => textureDisposed++);
  scene.add(new THREE.SkinnedMesh(new THREE.BoxGeometry(), material));
  assert.throws(() => flattenStreetBay(scene), /must be static/);
  assert.equal(cloneDisposed, 1);
  assert.equal(sourceDisposed, 1);
  assert.equal(materialDisposed, 1);
  assert.equal(textureDisposed, 1);
});

test('global bay/LOD0 budgets stay bounded and distant or Balanced views restore originals', async () => {
  const e = host(),
    rows = sources(100);
  let requests = 0;
  const kit = new StreetscapeKit(e, rows, async () => {
    requests++;
    return model();
  });
  kit.update();
  assert.ok(
    rows.every((source) => !source.detailed),
    'fallback persists until complete load',
  );
  await settle();
  pump(kit);
  assert.equal(requests, 4);
  assert.equal(kit.snapshot().visibleBays, 24);
  assert.equal(kit.snapshot().lod0Bays, 6);
  assert.ok(kit.snapshot().visibleCells <= 4);
  assert.equal(rows.filter((source) => source.detailed).length, 24);
  e.settings.quality = 'ultra';
  pump(kit);
  assert.equal(kit.snapshot().visibleBays, 36);
  assert.equal(kit.snapshot().lod0Bays, 10);
  e.settings.quality = 'balanced';
  pump(kit);
  assert.equal(kit.snapshot().visibleBays, 0);
  assert.ok(rows.every((source) => !source.detailed));
  e.settings.quality = 'high';
  e.camera.position.x = 5000;
  pump(kit);
  assert.equal(kit.snapshot().visibleBays, 0);
  kit.dispose();
});

test('long route evicts inactive pages and returning never duplicates scene pages', async () => {
  const e = host(),
    rows = sources(25, 180);
  const kit = new StreetscapeKit(e, rows, async () => model());
  kit.update();
  await settle();
  for (let x = 0; x < 4500; x += 180) {
    e.camera.position.x = x;
    pump(kit);
    assert.ok(kit.snapshot().cacheCells <= 12);
    assert.ok(kit.snapshot().visibleCells <= 4);
    assert.equal(kit.group.children.length, kit.snapshot().cacheCells);
  }
  e.camera.position.x = 0;
  pump(kit);
  assert.ok(rows[0].detailed);
  kit.dispose();
  assert.ok(rows.every((source) => !source.detailed));
  assert.equal(e.landmarks.children.length, 0);
});

test('transparent glazing primitives do not cast opaque canopy shadows', async () => {
  const e = host();
  const kit = new StreetscapeKit(e, sources(1), async () => {
    const scene = model();
    scene.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.02, 1),
        new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.24 }),
      ),
    );
    return scene;
  });
  kit.update();
  await settle();
  pump(kit);
  let glass = 0,
    opaque = 0;
  kit.group.traverse((mesh) => {
    if (!(mesh instanceof THREE.InstancedMesh)) return;
    if (mesh.material.transparent) {
      glass++;
      assert.equal(mesh.castShadow, false);
    } else {
      opaque++;
      assert.equal(mesh.castShadow, true);
    }
  });
  assert.equal(glass, 1);
  assert.equal(opaque, 1);
  kit.dispose();
});

test('failed and late asset loads never hide originals or attach after disposal', async () => {
  const e = host(),
    rows = sources(5),
    pending = [];
  let disposedTextures = 0,
    closedImages = 0;
  const kit = new StreetscapeKit(
    e,
    rows,
    () => new Promise((resolve) => pending.push(resolve)),
  );
  kit.update();
  kit.dispose();
  for (const resolve of pending) {
    const scene = model();
    scene.children[0].material.map.image = {
      close() {
        closedImages++;
      },
    };
    scene.children[0].material.map.addEventListener(
      'dispose',
      () => disposedTextures++,
    );
    resolve(scene);
  }
  await settle();
  pump(kit);
  assert.equal(disposedTextures, 4);
  assert.equal(closedImages, 4);
  assert.ok(rows.every((source) => !source.detailed));
  assert.equal(e.landmarks.children.length, 0);
  let calls = 0;
  const failure = new StreetscapeKit(e, rows, async () => {
    if (++calls === 2) throw new Error('simulated asset unavailable');
    return model();
  });
  failure.update();
  await settle();
  pump(failure);
  assert.equal(failure.snapshot().failed, true);
  assert.ok(rows.every((source) => !source.detailed));
  assert.equal(failure.snapshot().visibleBays, 0);
  assert.equal(calls, 4, 'do not retry on every frame');
  failure.dispose();
});
