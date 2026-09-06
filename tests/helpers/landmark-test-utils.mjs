import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
export const close = (a, b, epsilon = 1e-5) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
export function assertPlacement(group, expected) {
  const p = group.userData.placement;
  for (const [key, value] of Object.entries(expected))
    assert.equal(p[key], value, key);
}
export function assertFiniteGroup(group) {
  let count = 0;
  group.traverse((object) => {
    if (!object.isMesh) return;
    count++;
    const geometry = object.geometry,
      position = geometry.getAttribute('position');
    assert.ok(position?.count > 0);
    for (const attr of Object.values(geometry.attributes)) {
      assert.equal(attr.count, position.count);
      assert.ok(
        attr.array.every(Number.isFinite),
        `${object.name}: non-finite attribute`,
      );
    }
    if (geometry.index)
      assert.ok(
        geometry.index.array.every((i) => i >= 0 && i < position.count),
      );
  });
  assert.ok(count > 0);
  const box = new THREE.Box3().setFromObject(group);
  assert.ok(
    [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite),
  );
  return box;
}
export function geometryDigest(group) {
  const digest = createHash('sha256');
  group.traverse((object) => {
    if (!object.isMesh) return;
    digest.update(object.name);
    for (const [key, attr] of Object.entries(object.geometry.attributes)) {
      digest.update(JSON.stringify([key, attr.itemSize, attr.normalized]));
      digest.update(
        new Uint8Array(
          attr.array.buffer,
          attr.array.byteOffset,
          attr.array.byteLength,
        ),
      );
    }
    const index = object.geometry.index?.array;
    if (index)
      digest.update(
        new Uint8Array(index.buffer, index.byteOffset, index.byteLength),
      );
  });
  return digest.digest('hex');
}
export function disposeGroup(group) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [])
      materials.add(material);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value?.isTexture) textures.add(value);
  textures.forEach((t) => t.dispose());
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
export async function assertLOD(
  LandmarkDetail,
  create,
  plan,
  expectedWalkSurfaces = 0,
) {
  let creates = 0;
  const engine = {
    landmarks: new THREE.Group(),
    data: {},
    uniforms: { night: { value: 0.7 } },
    settings: { quality: 'high', buildings: true },
    camera: new THREE.PerspectiveCamera(),
    renderer: { shadowMap: { needsUpdate: false } },
    landmarkWorker: {
      request(_kind, captured) {
        assert.deepEqual(captured, plan);
        return {
          promise: Promise.resolve().then(() => {
            creates++;
            return create(true, captured);
          }),
          cancel() {},
        };
      },
      admitGroup: () => true,
    },
    elevation: () => {
      throw new Error('Must use captured model base');
    },
  };
  const lod = new LandmarkDetail(
    engine,
    (detail) => {
      creates++;
      return create(detail, plan);
    },
    plan,
  );
  const footprintCount = engine.data.solidWaterFootprints?.length ?? 0;
  const medium = lod.medium;
  for (const n of engine.data.nightMaterials)
    close(n.material.emissiveIntensity, n.intensity * 0.7, 1e-12);
  engine.settings.quality = 'ultra';
  engine.camera.position.copy(lod.bounds.getCenter(new THREE.Vector3()));
  lod.update();
  assert.equal(creates, 1);
  assert.equal(lod.medium.visible, true);
  assert.equal(lod.ultra, null);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  lod.update();
  assert.equal(creates, 2);
  assert.equal(lod.medium.visible, false);
  assert.equal(lod.ultra.visible, true);
  assert.equal(engine.data.solidWaterFootprints?.length ?? 0, footprintCount);
  assert.equal(
    new Set(engine.data.nightMaterials.map((n) => n.material)).size,
    engine.data.nightMaterials.length,
  );
  for (const n of engine.data.nightMaterials)
    close(n.material.emissiveIntensity, n.intensity * 0.7, 1e-12);
  const ultra = lod.ultra;
  engine.settings.quality = 'high';
  lod.update();
  assert.equal(lod.medium.visible, true);
  assert.equal(lod.ultra.visible, false);
  engine.settings.quality = 'ultra';
  lod.update();
  assert.equal(creates, 2);
  assert.equal(lod.medium, medium);
  assert.equal(lod.ultra, ultra);
  const walk = [];
  lod.holder.traverse((o) => {
    if (o.userData.walkSurface) walk.push(o);
  });
  assert.equal(walk.length, expectedWalkSurfaces);
  if (expectedWalkSurfaces === 2)
    assert.deepEqual(
      walk[0].geometry.getAttribute('position').array,
      walk[1].geometry.getAttribute('position').array,
    );
  lod.disposePending();
  disposeGroup(lod.holder);
}
