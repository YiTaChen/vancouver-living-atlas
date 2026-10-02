import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  data,
  prepareParts,
  summarizeStructures,
  createProfile,
  rings,
  project,
} from './helpers/region-rule-audit.mjs';
const { ArchitecturalDetails, ARCHITECTURE_BUDGET } = await import(
  cityModule('architecture-details')
);
const {
  ArchitectureModuleCandidate,
  ARCHITECTURE_EXPANSION_CANDIDATES,
  extractArchitectureCandidate,
  selectArchitectureCandidateSills,
} = await import(cityModule('architecture-module-candidate'));
const { planPitchedRoof } = await import(cityModule('building-roof'));
const { CITY_MATERIAL_MANIFEST, CITY_MATERIAL_SLOT } = await import(
  cityModule('material-library')
);
const root = new URL(
  '../tools/assets/architecture-expansion/',
  import.meta.url,
);
const manifest = JSON.parse(
  readFileSync(new URL('manifest.json', root), 'utf8'),
);
process.env.VANCOUVER_VISUAL_QA = '1';
const prepared = prepareParts(data.buildings.features);
const structures = summarizeStructures(prepared);
const profiles = new Map(
  [...structures].map(([key, value]) => [key, createProfile(value)]),
);
const keys = [...structures.keys()],
  features = data.buildings.features,
  buildingRoofs = new Map();
const grouped = new Map();
for (const part of prepared) {
  if (!grouped.has(part.key)) grouped.set(part.key, []);
  grouped.get(part.key).push(part);
}
for (const [key, parts] of grouped) {
  if (parts.length !== 1) continue;
  const part = parts[0],
    p = part.feature.properties;
  for (const polygon of rings(part.feature)) {
    const roof = planPitchedRoof(
      polygon.map((r) => r.slice(0, -1).map(project)),
      p.height,
      p.minHeight || 0,
      p.roof,
      p.source,
      parts.length,
    );
    if (roof) buildingRoofs.set(key, roof);
  }
}
function model(variant, lod, hooks = {}) {
  const asset = manifest.assets.find(
    (item) => item.id === ARCHITECTURE_EXPANSION_CANDIDATES[variant].asset,
  );
  const bytes = readFileSync(new URL(asset.lods[lod].file, root));
  const jsonSize = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const binary = bytes.subarray(28 + jsonSize);
  function attribute(index) {
    const a = doc.accessors[index],
      view = doc.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[
      a.componentType
    ];
    const values = new Type(a.count * width);
    const stride = view.byteStride ?? Type.BYTES_PER_ELEMENT * width;
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < a.count; i++)
      for (let j = 0; j < width; j++) {
        const at = offset + i * stride + j * Type.BYTES_PER_ELEMENT;
        values[i * width + j] =
          a.componentType === 5126
            ? binary.readFloatLE(at)
            : a.componentType === 5123
              ? binary.readUInt16LE(at)
              : binary.readUInt32LE(at);
      }
    return new THREE.BufferAttribute(values, width);
  }
  const primitive = doc.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  for (const [source, target] of Object.entries({
    POSITION: 'position',
    NORMAL: 'normal',
    TEXCOORD_0: 'uv',
    TANGENT: 'tangent',
  }))
    geometry.setAttribute(target, attribute(primitive.attributes[source]));
  geometry.setIndex(attribute(primitive.indices));
  const texture = new THREE.Texture({ close: () => hooks.image?.() });
  texture.addEventListener('dispose', () => hooks.texture?.());
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    normalMap: texture,
    roughnessMap: texture,
  });
  material.addEventListener('dispose', () => hooks.material?.());
  geometry.addEventListener('dispose', () => hooks.geometry?.());
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return group;
}
function host(options = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(-540, 37, -715);
  const e = {
    data: {
      buildings: { features },
      buildingProfiles: profiles,
      buildingFoundations: new Map(keys.map((key) => [key, 20])),
      buildingRoofs,
    },
    buildings: new THREE.Group(),
    camera,
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
  };
  const details = new ArchitecturalDetails(e);
  const library = {
    color: new THREE.Texture(),
    normal: new THREE.Texture(),
    orm: new THREE.Texture(),
    ready: { value: 1 },
  };
  return {
    e,
    details,
    library,
    camera,
    settings: () => e.settings,
    compatibleGraphics: options.compatible ?? false,
  };
}
function pump(details) {
  for (let frame = 0; frame < 2000; frame++) {
    details.update(frame === 0);
    if (frame > 2 && details.stats.pendingCells === 0) return;
  }
  assert.fail('Architecture cells failed to settle');
}
function count(details) {
  let instances = 0,
    boxes = 0,
    modules = 0,
    draws = 0,
    triangles = 0;
  details.root.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    instances += o.count;
    if (o.userData.architectureCandidate) modules += o.count;
    else boxes += o.count;
    draws++;
    triangles +=
      ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3) *
      o.count;
  });
  return { instances, boxes, modules, draws, triangles };
}

async function active(variant) {
  const h = host();
  const candidate = new ArchitectureModuleCandidate(
    h,
    (lod) => Promise.resolve(model(variant, lod)),
    variant,
  );
  const focus = new THREE.Vector3();
  for (const { box } of candidate.selected.values())
    focus.add(new THREE.Vector3(box.x, box.y, box.z));
  focus.multiplyScalar(1 / candidate.selected.size);
  h.camera.position.copy(focus).add(new THREE.Vector3(0, 2, 25));
  pump(h.details);
  const before = count(h.details);
  assert(h.details.setQAModuleAdapter(candidate));
  await candidate.start();
  pump(h.details);
  return { ...h, candidate, before };
}

test('all16 expansion exports retain audited byte hashes, source hashes, single materials and exact644/320 triangle costs', () => {
  const totals = [0, 0];
  let bytes = 0;
  for (const asset of manifest.assets)
    for (const lod of asset.lods) {
      const file = readFileSync(new URL(lod.file, root));
      assert.equal(createHash('sha256').update(file).digest('hex'), lod.sha256);
      assert.equal(
        createHash('sha256')
          .update(readFileSync(new URL(lod.source, root)))
          .digest('hex'),
        lod.sourceSha256,
      );
      const doc = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)));
      assert.equal(doc.meshes.length, 1);
      assert.equal(doc.meshes[0].primitives.length, 1);
      assert.equal(doc.materials.length, 1);
      const primitive = doc.meshes[0].primitives[0],
        triangles = doc.accessors[primitive.indices].count / 3;
      assert.equal(triangles, lod.triangles);
      assert(triangles <= lod.triangleCap);
      assert.equal(doc.materials[0].alphaMode ?? 'OPAQUE', 'OPAQUE');
      assert.deepEqual(
        doc.accessors[primitive.attributes.POSITION].min.map(
          (v) => +v.toFixed(5),
        ),
        lod.bounds.min,
      );
      assert.deepEqual(
        doc.accessors[primitive.attributes.POSITION].max.map(
          (v) => +v.toFixed(5),
        ),
        lod.bounds.max,
      );
      totals[lod.level] += triangles;
      bytes += file.length;
    }
  assert.deepEqual(totals, [644, 320]);
  assert.equal(bytes, 3335724);
});

for (const variant of ['modern-sills', 'cedar-sills']) {
  test(`${variant}: actual full-city capped source selection and LOD geometry stay inside replaced volumes`, async (t) => {
    const h = await active(variant),
      { candidate, details, before } = h;
    assert(
      candidate.selected.size > 0 &&
        candidate.selected.size <= candidate.spec.maximumInstances,
    );
    assert.equal(candidate.selected.size, variant === 'modern-sills' ? 24 : 8);
    assert.deepEqual([...candidate.affectedCells], ['-2,1']);
    t.diagnostic(
      JSON.stringify({
        variant,
        selected: candidate.selected.size,
        sourceCounts: Object.fromEntries(
          candidate.spec.sources.map((source) => [
            source.sourceKey,
            [...candidate.selected.values()].filter(
              (item) => item.sourceKey === source.sourceKey,
            ).length,
          ]),
        ),
        triangleDelta: candidate.snapshot().visibleTriangleDelta,
      }),
    );
    const after = count(details);
    assert.equal(after.instances, before.instances);
    assert.equal(after.modules, candidate.selected.size);
    const expectedAsset = manifest.assets.find(
      (a) => a.id === candidate.spec.asset,
    );
    const parts = details.cells.flatMap((c) => c.parts);
    assert.deepEqual(
      [...selectArchitectureCandidateSills(parts, variant)],
      [...selectArchitectureCandidateSills([...parts].reverse(), variant)],
    );
    for (const lod of [0, 1, 0]) {
      candidate.setLOD(lod);
      pump(details);
      const stats = candidate.snapshot();
      assert.equal(count(details).instances, before.instances);
      assert.equal(
        stats.visibleTriangleDelta,
        candidate.selected.size * (expectedAsset.lods[lod].triangles - 12),
      );
      assert(
        stats.visibleTriangleDelta <= candidate.spec.maximumExtraTriangles,
      );
      assert(candidate.ownedBatchGeometry.size <= 1);
      details.root.traverse((mesh) => {
        if (
          !(mesh instanceof THREE.InstancedMesh) ||
          mesh.userData.architectureCandidate?.variant !== variant
        )
          return;
        const matrix = new THREE.Matrix4(),
          inverse = new THREE.Matrix4(),
          point = new THREE.Vector3(),
          scale = new THREE.Vector3();
        mesh.userData.architectureCandidate.replacedBoxes.forEach((box, i) => {
          mesh.getMatrixAt(i, matrix);
          matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
          assert(Math.abs(scale.y - 1) < 1e-6 && Math.abs(scale.z - 1) < 1e-6);
          assert(scale.x >= 0.75 && scale.x <= 1.5);
          inverse
            .compose(
              new THREE.Vector3(box.x, box.y, box.z),
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                box.yaw,
              ),
              new THREE.Vector3(1, 1, 1),
            )
            .invert();
          const position = mesh.geometry.attributes.position;
          for (let v = 0; v < position.count; v++) {
            point
              .fromBufferAttribute(position, v)
              .applyMatrix4(matrix)
              .applyMatrix4(inverse);
            assert(Math.abs(point.x) <= box.width / 2 + 1e-4);
            assert(Math.abs(point.y) <= box.height / 2 + 1e-4);
            assert(Math.abs(point.z) <= box.depth / 2 + 1e-4);
          }
          const slot = CITY_MATERIAL_SLOT[candidate.spec.surface];
          assert.equal(mesh.geometry.attributes.aReliefSurface.getX(i), slot);
          const color = new THREE.Color();
          mesh.getColorAt(i, color);
          const expected = new THREE.Color()
            .fromArray(CITY_MATERIAL_MANIFEST.materials[slot].averageColor)
            .convertSRGBToLinear();
          assert(
            Math.abs(color.r - expected.r) < 1e-6 &&
              Math.abs(color.g - expected.g) < 1e-6 &&
              Math.abs(color.b - expected.b) < 1e-6,
          );
        });
      });
    }
    assert.equal(candidate.material.map, null);
    assert.equal(candidate.snapshot().retainedPrivateTextureObjects, 0);
    details.setQAModuleAdapter(null);
    pump(details);
    assert.deepEqual(count(details), before);
    details.dispose();
  });
  test(`${variant}: incompatible profile, unmatched source edge and incompatible renderer retain baseline`, async () => {
    const h = host({ compatible: true }),
      parts = h.details.cells.flatMap((c) => c.parts);
    assert.equal(
      selectArchitectureCandidateSills(
        parts.map((p) => ({
          ...p,
          profile: { ...p.profile, kind: 'heritage-brick' },
        })),
        variant,
      ).size,
      0,
    );
    assert.equal(
      selectArchitectureCandidateSills(
        parts.map((p) => ({ ...p, key: 'unselected' })),
        variant,
      ).size,
      0,
    );
    let loaded = 0;
    const candidate = new ArchitectureModuleCandidate(
      h,
      async (lod) => {
        loaded++;
        return model(variant, lod);
      },
      variant,
    );
    h.details.setQAModuleAdapter(candidate);
    await candidate.start();
    assert.equal(loaded, 0);
    assert.equal(candidate.status, 'compatible-fallback');
    h.details.dispose();
  });
  test(`${variant}: malformed GLB bounds reject replacement, dispose imports and retain existing fallback`, async () => {
    const h = host();
    pump(h.details);
    const before = count(h.details);
    const candidate = new ArchitectureModuleCandidate(
      h,
      async (lod) => {
        const scene = model(variant, lod);
        scene.children[0].geometry.attributes.position.setY(0, 25);
        return scene;
      },
      variant,
    );
    h.details.setQAModuleAdapter(candidate);
    await candidate.start();
    pump(h.details);
    assert.equal(candidate.status, 'failed');
    assert.equal(candidate.templates.size, 0);
    assert.deepEqual(count(h.details), before);
    h.details.dispose();
  });
}
