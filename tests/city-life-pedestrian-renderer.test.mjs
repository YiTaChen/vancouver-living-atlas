import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
import { deformVertex } from '../tools/assets/city-life-pedestrians/motion.mjs';
const {
  PedestrianRenderer,
  installPedestrianOverrideMaterial,
  PEDESTRIAN_RIGID_LIMB_GLSL,
} = await import(cityModule('city-life/pedestrian-renderer'));
const glb = (name) => {
  const b = readFileSync(`tools/assets/city-life-pedestrians/exports/${name}`);
  return new GLTFLoader().parseAsync(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    '',
  );
};
const assetLoader = async (url) => (await glb(url.split('/').at(-1))).scene;
const pose = (id, overrides = {}) => ({
  actorId: id,
  position: [0, 0, 0],
  yawRadians: 0,
  phaseRadians: 1.3,
  walkWeight: 1,
  variant: 'commuter',
  distanceM: 0,
  ...overrides,
});

test('actual eight source GLBs load into bounded shared opaque batches and retain provenance', async () => {
  const r = new PedestrianRenderer({ capacity: 12, loader: assetLoader });
  await r.load();
  assert.equal(r.stats().loadedTemplates, 8);
  assert.equal(r.stats().failedTemplates, 0);
  r.update(
    Array.from({ length: 40 }, (_, i) =>
      pose(`actor-${i}`, {
        variant: ['commuter', 'raincoat', 'runner', 'tote'][i % 4],
        lod: i % 2,
      }),
    ),
  );
  const stats = r.stats();
  assert.equal(stats.activeActors, 12);
  assert.equal(stats.visibleActors, 12);
  assert.equal(stats.allocatedBatches, 8);
  assert.equal(stats.textures, 0);
  assert.ok(stats.populatedBatches <= 8);
  assert.ok(stats.triangles <= 12 * 452);
  assert.equal(stats.rejectedInputs, 28);
  const materials = new Set(r.group.children.map((m) => m.material));
  assert.equal(materials.size, 1);
  for (const mesh of r.group.children) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.geometry.userData.sourcePackage, 'city-life-pedestrians');
    assert.equal(mesh.geometry.getAttribute('_limb').itemSize, 1);
  }
  assert.match(r.group.userData.provenance.attribution, /YiTaChen/);
  const bytes = stats.geometryBytes;
  for (let n = 0; n < 10; n++) {
    r.update([]);
    r.update([pose('same')]);
  }
  assert.equal(r.stats().geometryBytes, bytes);
  assert.equal(r.stats().activeActors, 1);
  r.dispose();
  assert.equal(r.stats().allocatedBatches, 0);
  assert.equal(r.group.children.length, 0);
});

test('actor identity, phase and pose follow IDs across compaction and LOD hysteresis', async () => {
  const r = new PedestrianRenderer({ loader: assetLoader });
  await r.load();
  r.update([pose('a'), pose('b')]);
  assert.equal(r.actorSlot('b').slot, 1);
  r.update([
    pose('b', {
      phaseRadians: 2.8,
      distanceM: 41,
      lookYawRadians: 100,
      yieldWeight: 2,
    }),
  ]);
  assert.equal(r.actorSlot('b').key, 'commuter:1');
  assert.equal(r.actorSlot('b').slot, 0);
  const mesh = r.group.children.find((m) => m.count);
  const p = mesh.geometry.getAttribute('pedestrianPose');
  assert.ok(Math.abs(p.getX(0) - 2.8) < 1e-6);
  assert.equal(p.getZ(0), 0.75);
  assert.equal(p.getW(0), 1);
  r.update([pose('b', { distanceM: 35 })]);
  assert.equal(r.actorSlot('b').key, 'commuter:1');
  r.update([pose('b', { distanceM: 29 })]);
  assert.equal(r.actorSlot('b').key, 'commuter:0');
  r.update([
    pose('b', { visible: false }),
    pose('bad', { position: [NaN, 0, 0] }),
  ]);
  assert.equal(r.stats().activeActors, 1);
  assert.equal(r.stats().visibleActors, 0);
  r.dispose();
});

test('animated instanced bounds contain source vertex poses after yaw, lift and uniform scale', async () => {
  const r = new PedestrianRenderer({ loader: assetLoader });
  await r.load();
  const input = pose('walking', {
    variant: 'runner',
    position: [100, 14, -30],
    yawRadians: 1.7,
    scale: 1.04,
    lookYawRadians: -0.75,
    yieldWeight: 1,
  });
  r.update([input]);
  const mesh = r.group.children.find((m) => m.count);
  const geometry = mesh.geometry,
    matrix = new THREE.Matrix4();
  mesh.getMatrixAt(0, matrix);
  const a = geometry.attributes;
  for (let phase = 0; phase < Math.PI * 2; phase += 0.25)
    for (let i = 0; i < a.position.count; i++) {
      const v = deformVertex(
        [a.position.getX(i), a.position.getY(i), a.position.getZ(i)],
        [a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i)],
        a._limb.getX(i),
        [a._pivot_x.getX(i), a._pivot_y.getX(i), a._pivot_z.getX(i)],
        { ...input, phaseRadians: phase },
      );
      const world = new THREE.Vector3(...v.position).applyMatrix4(matrix);
      assert.ok(mesh.boundingBox.containsPoint(world));
      assert.ok(mesh.boundingSphere.containsPoint(world));
    }
  r.dispose();
});

test('source shader, beauty, normal/AO and depth share deformation with neutral city defaults', async () => {
  const source = readFileSync(
    'tools/assets/city-life-pedestrians/rigid-limb.glsl',
    'utf8',
  );
  assert.equal(
    PEDESTRIAN_RIGID_LIMB_GLSL.trim(),
    source.slice(source.indexOf('void pedestrianRigidLimb')).trim(),
  );
  const r = new PedestrianRenderer({ loader: assetLoader });
  const normal = new THREE.MeshNormalMaterial();
  // Hook identity only; never invoked without its material.
  // oxlint-disable-next-line typescript/unbound-method
  const before = normal.onBeforeCompile;
  const restore = installPedestrianOverrideMaterial(normal);
  const mesh = r.group.children[0];
  for (const [material, lib] of [
    [mesh.material, THREE.ShaderLib.standard],
    [normal, THREE.ShaderLib.normal],
    [mesh.customDepthMaterial, THREE.ShaderLib.depth],
  ]) {
    const shader = {
      vertexShader: lib.vertexShader,
      fragmentShader: lib.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader, {});
    assert.ok(shader.vertexShader.includes(PEDESTRIAN_RIGID_LIMB_GLSL));
    assert.match(shader.vertexShader, /pedestrianRigidLimb\(transformed,/);
    assert.match(
      shader.vertexShader,
      /pedestrianRigidLimb\(pedestrianNormalDummy, objectNormal,/,
    );
  }
  assert.deepEqual(normal.defaultAttributeValues.pedestrianPose, [0, 0, 0, 0]);
  assert.deepEqual(normal.defaultAttributeValues._limb, [0]);
  restore();
  restore();
  // oxlint-disable-next-line typescript/unbound-method
  assert.equal(normal.onBeforeCompile, before);
  assert.equal(normal.defaultAttributeValues, undefined);
  normal.dispose();
  r.dispose();
});

test('failed loads retain fallback, while a late load after disposal releases source resources', async () => {
  const r = new PedestrianRenderer({
    loader: async () => {
      throw Error('unavailable');
    },
  });
  r.update([pose('fallback')]);
  await r.load();
  assert.equal(r.stats().loadedTemplates, 0);
  assert.equal(r.stats().failedTemplates, 8);
  assert.equal(r.stats().visibleActors, 1);
  r.dispose();
  const pending = [];
  const late = new PedestrianRenderer({
    loader: () => new Promise((resolve) => pending.push(resolve)),
  });
  const load = late.load();
  late.dispose();
  let geometryDisposals = 0,
    materialDisposals = 0;
  for (const resolve of pending) {
    const scene = (await glb('pedestrian-commuter.lod0.glb')).scene;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.addEventListener('dispose', () => geometryDisposals++);
        o.material.addEventListener('dispose', () => materialDisposals++);
      }
    });
    resolve(scene);
  }
  await load;
  assert.equal(geometryDisposals, 8);
  assert.equal(materialDisposals, 8);
  assert.equal(late.stats().allocatedBatches, 0);
});
