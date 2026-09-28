import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const assetPath =
  process.env.CITIZEN_ASSET_PATH ??
  new URL('../public/models/citizen/vancouver-citizen.glb', import.meta.url);
const bytes = await readFile(assetPath);
const loader = new GLTFLoader();
// Decode the actual mesh/skin/animation with Three.js in Node; image rendering
// is separately reviewed in Blender and the browser. CPU tests need no DOM.
loader.register(() => ({
  name: 'CPU_ASSET_TEST',
  loadTexture: async () => new THREE.Texture(),
}));
const gltf = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const mesh = gltf.scene.getObjectByProperty('type', 'SkinnedMesh');

test('original citizen has a bounded single-draw skin and required clips', () => {
  assert.ok(mesh);
  const triangles = mesh.geometry.index.count / 3;
  assert.ok(triangles >= 20000 && triangles <= 40000);
  assert.equal(mesh.geometry.groups.length, 0);
  assert.ok(
    mesh.skeleton.bones.length >= 20 && mesh.skeleton.bones.length <= 64,
  );
  assert.ok(mesh.material.map);
  assert.ok(mesh.material.normalMap);
  assert.ok(mesh.material.roughnessMap);
  assert.deepEqual(gltf.animations.map((clip) => clip.name).sort(), [
    'idle',
    'run',
    'walk',
  ]);
  assert.ok(bytes.length < 7 * 1024 * 1024);
});

test('citizen geometry uses metres, faces +Z and has normalized skin weights', () => {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  assert.ok(box.min.y >= 0 && box.min.y < 0.005);
  assert.ok(box.max.y > 1.75 && box.max.y < 1.85);
  assert.ok(box.max.x - box.min.x < 0.8);
  const weights = mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < weights.count; i++) {
    const sum =
      weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
    assert.ok(Math.abs(sum - 1) < 0.001);
  }
  // The toe bones point forward in the actual exported glTF coordinate system.
  gltf.scene.updateMatrixWorld(true);
  for (const side of ['L', 'R']) {
    const ankle = gltf.scene
      .getObjectByName(`foot${side}`)
      .getWorldPosition(new THREE.Vector3());
    const toe = gltf.scene
      .getObjectByName(`toe${side}`)
      .getWorldPosition(new THREE.Vector3());
    assert.ok(toe.z > ankle.z);
  }
});

test('every sampled gait keeps shoes attached and walking soles grounded', () => {
  const positions = mesh.geometry.attributes.position;
  const soles = [[], []];
  for (let i = 0; i < positions.count; i++)
    if (positions.getY(i) < 0.025) soles[Number(positions.getX(i) > 0)].push(i);
  const shinLength = 0.376044;
  const point = new THREE.Vector3();
  for (const clip of gltf.animations) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    for (let sample = 0; sample < 40; sample++) {
      mixer.setTime((clip.duration * sample) / 40);
      gltf.scene.updateMatrixWorld(true);
      mesh.skeleton.update();
      const soleY = soles.map((ids) =>
        Math.min(
          ...ids.map((index) => {
            point.fromBufferAttribute(positions, index);
            mesh.applyBoneTransform(index, point);
            return point.applyMatrix4(mesh.matrixWorld).y;
          }),
        ),
      );
      assert.ok(
        Math.min(...soleY) > -0.01,
        `${clip.name}: shoes penetrate the floor`,
      );
      if (clip.name !== 'run')
        assert.ok(Math.min(...soleY) < 0.008, `${clip.name}: both feet float`);
      for (const side of ['L', 'R']) {
        const shin = gltf.scene
          .getObjectByName(`shin${side}`)
          .getWorldPosition(new THREE.Vector3());
        const foot = gltf.scene
          .getObjectByName(`foot${side}`)
          .getWorldPosition(new THREE.Vector3());
        assert.ok(
          Math.abs(shin.distanceTo(foot) - shinLength) < 0.006,
          `${clip.name}: ankle exceeds leg reach`,
        );
      }
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
});

test('layered coat and denim share a continuous pelvis deformation', () => {
  // The committed GLB previously used incompatible waist weights on these
  // close surfaces, exposing black denim triangles during a real running pose.
  // Compare actual exported weights at equal anatomical height across layers.
  const positions = mesh.geometry.attributes.position;
  const joints = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  const thighBones = new Set(
    mesh.skeleton.bones.flatMap((bone, index) =>
      /^thigh[LR]$/.test(bone.name) ? [index] : [],
    ),
  );
  const bands = new Map();
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (
      y < 0.84 ||
      y > 0.95 ||
      Math.abs(positions.getX(i)) > 0.17 ||
      Math.abs(positions.getZ(i)) > 0.135
    )
      continue;
    let thigh = 0;
    for (let component = 0; component < 4; component++)
      if (thighBones.has(joints.getComponent(i, component)))
        thigh += weights.getComponent(i, component);
    const band = Math.floor(y / 0.003);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(thigh);
  }
  assert.ok(bands.size > 20);
  for (const [band, values] of bands)
    assert.ok(
      Math.max(...values) - Math.min(...values) < 0.05,
      `pelvis height band ${band}: clothing layers deform differently`,
    );
});
