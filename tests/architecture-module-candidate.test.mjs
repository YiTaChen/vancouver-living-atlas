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
} from './helpers/region-rule-audit.mjs';
const { ArchitecturalDetails, ARCHITECTURE_BUDGET } = await import(
  cityModule('architecture-details')
);
const {
  ArchitectureModuleCandidate,
  ARCHITECTURE_MODULE_CANDIDATE,
  selectArchitectureCandidateSills,
  extractArchitectureCandidate,
} = await import(cityModule('architecture-module-candidate'));
const root = new URL(
  '../tools/assets/architecture-details/runtime-candidate/',
  import.meta.url,
);
const manifest = JSON.parse(
  readFileSync(new URL('manifest.json', root), 'utf8'),
);
process.env.VANCOUVER_VISUAL_QA = '1';
const structures = summarizeStructures(prepareParts(data.buildings.features));
const profiles = new Map(
  [...structures].map(([key, value]) => [key, createProfile(value)]),
);
const keys = [...structures.keys()];
const features = data.buildings.features;

function model(lod, hooks = {}) {
  const bytes = readFileSync(new URL(manifest.lods[lod].file, root));
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
async function active() {
  const h = host();
  pump(h.details);
  const before = count(h.details);
  const candidate = new ArchitectureModuleCandidate(h, async (lod) =>
    model(lod),
  );
  assert(h.details.setQAModuleAdapter(candidate));
  await candidate.start();
  pump(h.details);
  return { ...h, candidate, before };
}

test('candidate uses actual Blender exports with bounded physical scale and source hashes', () => {
  assert.equal(manifest.fittedHeightMetres, 0.16);
  assert.equal(manifest.runtimeScale, 'X span only; Y=Z=1');
  assert.deepEqual(
    manifest.lods.map((item) => item.triangles),
    [32, 16],
  );
  for (const lod of manifest.lods) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(lod.file, root)))
        .digest('hex'),
      lod.sha256,
    );
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(lod.source, root)))
        .digest('hex'),
      lod.sourceSha256,
    );
    const geometry = extractArchitectureCandidate(model(lod.level), lod.level);
    assert(Math.abs(geometry.boundingBox.max.y - 0.16) < 1e-6);
    geometry.dispose();
  }
});

test('source planner selects all56 existing upper sills on two exact Robson edges, independent of source order', () => {
  const h = host();
  const parts = h.details.cells.flatMap((cell) => cell.parts);
  const selected = selectArchitectureCandidateSills(parts);
  assert.equal(selected.size, 56);
  const bySource = {};
  for (const item of selected.values()) {
    bySource[item.sourceKey] = (bySource[item.sourceKey] ?? 0) + 1;
    const part = parts.find((p) => p.key === item.sourceKey);
    assert(item.box.y - part.ground > part.profile.groundStoreyM + 0.5);
    assert.equal(item.box.kind, 'sill');
    assert(
      ARCHITECTURE_MODULE_CANDIDATE.sources.some(
        (s) => s.edgeKey === item.edgeKey,
      ),
    );
  }
  assert.deepEqual(bySource, { 153090: 32, 153102: 24 });
  assert.deepEqual(
    [...selected],
    [...selectArchitectureCandidateSills([...parts].reverse())],
  );
  assert.equal(
    selectArchitectureCandidateSills(parts.filter((p) => p.key === '153175'))
      .size,
    0,
  );
  h.details.dispose();
});

test('candidate keeps instance/cell caps and confines every actual GLB vertex to the old sill volume', async () => {
  const { details, candidate, before } = await active();
  const after = count(details);
  assert.equal(after.instances, before.instances);
  assert.equal(after.modules, 56);
  assert.equal(before.triangles + 56 * (32 - 12), after.triangles);
  assert(after.draws <= before.draws + 2);
  assert(details.records.size <= ARCHITECTURE_BUDGET.cachedCells);
  assert(
    candidate.snapshot().visibleTriangleDelta <=
      ARCHITECTURE_MODULE_CANDIDATE.maximumExtraTriangles,
  );
  for (const record of details.records.values())
    assert(
      record.count <=
        (record.tier === 'street'
          ? ARCHITECTURE_BUDGET.streetInstancesPerCell
          : ARCHITECTURE_BUDGET.roofInstancesPerCell),
    );
  const transform = new THREE.Matrix4(),
    inverse = new THREE.Matrix4();
  const point = new THREE.Vector3(),
    scale = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  details.root.traverse((mesh) => {
    if (
      !(mesh instanceof THREE.InstancedMesh) ||
      !mesh.userData.architectureCandidate
    )
      return;
    const positions = mesh.geometry.getAttribute('position');
    mesh.userData.architectureCandidate.replacedBoxes.forEach((box, i) => {
      mesh.getMatrixAt(i, transform);
      transform.decompose(new THREE.Vector3(), rotation, scale);
      assert(Math.abs(scale.y - 1) < 1e-6 && Math.abs(scale.z - 1) < 1e-6);
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
      for (let j = 0; j < positions.count; j++) {
        point
          .fromBufferAttribute(positions, j)
          .applyMatrix4(transform)
          .applyMatrix4(inverse);
        assert(Math.abs(point.x) <= box.width / 2 + 1e-4);
        assert(Math.abs(point.y) <= box.height / 2 + 1e-4);
        assert(Math.abs(point.z) <= box.depth / 2 + 1e-4);
      }
    });
  });
  details.dispose();
});

test('LOD transitions, quality changes and distance fallback preserve population and bound batch memory', async () => {
  const h = await active();
  for (let iteration = 0; iteration < 3; iteration++) {
    for (const lod of [1, 0]) {
      h.candidate.setLOD(lod);
      pump(h.details);
      assert.equal(count(h.details).instances, h.before.instances);
      assert.equal(count(h.details).modules, 56);
      assert.equal(
        count(h.details).triangles - h.before.triangles,
        56 * ((lod ? 16 : 32) - 12),
      );
      assert(h.candidate.ownedBatchGeometry.size <= 2);
    }
  }
  h.e.settings = { buildings: true, quality: 'balanced' };
  pump(h.details);
  assert.equal(count(h.details).modules, 0);
  h.e.settings = { buildings: true, quality: 'high' };
  pump(h.details);
  assert.equal(count(h.details).modules, 56);
  h.camera.position.set(-325, 37, -715);
  pump(h.details);
  assert.equal(count(h.details).modules, 0);
  h.details.dispose();
  assert.equal(h.candidate.templates.size, 0);
  assert.equal(h.candidate.ownedBatchGeometry.size, 0);
});

test('disable restores original instance and triangle counts without disposing shared atlas textures', async () => {
  const h = await active();
  let sharedDisposals = 0;
  for (const key of ['color', 'normal', 'orm'])
    h.library[key].addEventListener('dispose', () => sharedDisposals++);
  h.details.setQAModuleAdapter(null);
  pump(h.details);
  assert.deepEqual(count(h.details), h.before);
  assert.equal(h.candidate.status, 'disposed');
  assert.equal(sharedDisposals, 0);
  h.details.dispose();
  assert.equal(sharedDisposals, 0);
});

test('shared material binds the existing atlas and metre instance dimensions, without private texture maps', async () => {
  const h = await active();
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  h.candidate.material.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uCityColor.value, h.library.color);
  assert.equal(shader.uniforms.uCityNormal.value, h.library.normal);
  assert.equal(shader.uniforms.uCityORM.value, h.library.orm);
  assert.match(shader.vertexShader, /metricPosition=position\*aReliefSize/);
  assert.equal(h.candidate.material.map, null);
  assert.equal(h.candidate.material.normalMap, null);
  assert.equal(h.candidate.snapshot().retainedPrivateTextureObjects, 0);
  h.details.dispose();
});

test('one failed LOD retains complete original fallback and releases successfully loaded templates', async () => {
  const h = host();
  pump(h.details);
  const baseline = count(h.details);
  const candidate = new ArchitectureModuleCandidate(h, async (lod) => {
    if (lod === 1) throw new Error('Deliberate missing LOD');
    return model(0);
  });
  h.details.setQAModuleAdapter(candidate);
  await candidate.start();
  pump(h.details);
  assert.equal(candidate.status, 'failed');
  assert.equal(candidate.templates.size, 0);
  assert.deepEqual(count(h.details), baseline);
  assert.match(candidate.error, /Deliberate missing LOD/);
  h.details.dispose();
});

test('late GLBs after disposal release each owned geometry/material/texture/image once and never attach', async () => {
  const h = host();
  const resolves = [];
  const counters = { geometry: 0, material: 0, texture: 0, image: 0 };
  const hooks = Object.fromEntries(
    Object.keys(counters).map((key) => [key, () => counters[key]++]),
  );
  const candidate = new ArchitectureModuleCandidate(
    h,
    () => new Promise((resolve) => resolves.push(resolve)),
  );
  h.details.setQAModuleAdapter(candidate);
  const loading = candidate.start();
  h.details.dispose();
  resolves.forEach((resolve, lod) => resolve(model(lod, hooks)));
  await loading;
  assert.equal(candidate.status, 'disposed');
  assert.equal(candidate.templates.size, 0);
  assert.equal(h.details.root.children.length, 0);
  assert.deepEqual(counters, {
    geometry: 2,
    material: 2,
    texture: 2,
    image: 2,
  });
});

test('malformed loaded geometry is rejected and its owned originals are still released', () => {
  const counters = { geometry: 0, material: 0, texture: 0, image: 0 };
  const hooks = Object.fromEntries(
    Object.keys(counters).map((key) => [key, () => counters[key]++]),
  );
  const scene = model(0, hooks);
  scene.children[0].geometry.getAttribute('position').setX(0, 99);
  assert.throws(
    () => extractArchitectureCandidate(scene, 0),
    /physical bounds/,
  );
  assert.deepEqual(counters, {
    geometry: 1,
    material: 1,
    texture: 1,
    image: 1,
  });
});

test('compatible graphics never loads candidate GLBs or replaces existing sills', async () => {
  const h = host({ compatible: true });
  pump(h.details);
  const baseline = count(h.details);
  let loads = 0;
  const candidate = new ArchitectureModuleCandidate(h, async (lod) => {
    loads++;
    return model(lod);
  });
  h.details.setQAModuleAdapter(candidate);
  await candidate.start();
  pump(h.details);
  assert.equal(loads, 0);
  assert.equal(candidate.status, 'compatible-fallback');
  assert.deepEqual(count(h.details), baseline);
  h.details.dispose();
});

test('normal production guard cannot install even an explicitly supplied candidate adapter', () => {
  const h = host();
  let disposed = 0;
  process.env.VANCOUVER_VISUAL_QA = '0';
  try {
    assert.equal(
      h.details.setQAModuleAdapter({
        dispose: () => disposed++,
        assemble: () => assert.fail('Production adapter must not run'),
        update: () => false,
      }),
      false,
    );
    assert.equal(disposed, 1);
    pump(h.details);
    assert.equal(count(h.details).modules, 0);
  } finally {
    process.env.VANCOUVER_VISUAL_QA = '1';
    h.details.dispose();
  }
});

test('full-city capped planner actually emits every selected sill before index1800 without reordering or raising limits', async () => {
  const h = await active();
  const { architectureWork } = await import(cityModule('architecture-plan'));
  const { architectureBoxKey } = await import(
    cityModule('architecture-module-candidate')
  );
  assert.deepEqual([...h.candidate.affectedCells], ['-3,-4']);
  const cell = h.details.cells.find((item) => item.id === '-3,-4');
  assert(
    cell.parts.length > 10,
    'This fixture must include the complete real city cell',
  );
  const found = [];
  let index = 0;
  capped: for (const part of cell.parts)
    for (const box of architectureWork([part], 'street')) {
      if (!box) continue;
      if (++index > ARCHITECTURE_BUDGET.streetInstancesPerCell) break capped;
      const selected = h.candidate.selected.get(architectureBoxKey(box));
      if (selected?.part === part) found.push({ source: part.key, index });
    }
  assert.equal(found.length, 56);
  assert.deepEqual(
    Object.fromEntries(
      ['153090', '153102'].map((source) => {
        const indices = found
          .filter((item) => item.source === source)
          .map((item) => item.index);
        return [
          source,
          {
            count: indices.length,
            first: Math.min(...indices),
            last: Math.max(...indices),
          },
        ];
      }),
    ),
    {
      153090: { count: 32, first: 142, last: 266 },
      153102: { count: 24, first: 1108, last: 1200 },
    },
  );
  assert.equal(count(h.details).modules, found.length);
  const state = h.candidate.snapshot();
  assert.equal(state.visibleReplacements, 56);
  assert.equal(state.visibleTriangleDelta, 1120);
  h.details.dispose();
});

test('a coincident box belonging to another source part cannot receive a candidate replacement', async () => {
  const h = await active();
  const selected = [...h.candidate.selected.values()][0];
  const context = {
    id: 'adversarial/street',
    surface: 'masonry',
    tier: 'street',
    sourcePart: () => ({
      ...selected.part,
      key: 'unselected-coincident-source',
    }),
  };
  assert.equal(h.candidate.assemble([{ ...selected.box }], context), null);
  assert.equal(count(h.details).modules, 56);
  h.details.dispose();
});

test('LOD hysteresis resists threshold jitter and only the affected source cell is invalidated', async () => {
  const h = await active();
  const focus = new THREE.Vector3();
  for (const { box } of h.candidate.selected.values())
    focus.add(new THREE.Vector3(box.x, box.y, box.z));
  focus.multiplyScalar(1 / h.candidate.selected.size);
  const original = h.details.records.get('-3,-4/street');
  const other = new Map(
    [...h.details.records].filter(([id]) => id !== '-3,-4/street'),
  );
  for (const distance of [59, 61, 59.5, 60.5, 69]) {
    h.camera.position.copy(focus).add(new THREE.Vector3(distance, 0, 0));
    pump(h.details);
    assert.equal(h.candidate.snapshot().activeLOD, 0);
    assert.equal(h.details.records.get('-3,-4/street'), original);
  }
  h.camera.position.copy(focus).add(new THREE.Vector3(71, 0, 0));
  pump(h.details);
  assert.equal(h.candidate.snapshot().activeLOD, 1);
  assert.notEqual(h.details.records.get('-3,-4/street'), original);
  for (const [id, record] of other)
    if (h.details.records.has(id))
      assert.equal(h.details.records.get(id), record);
  const reduced = h.details.records.get('-3,-4/street');
  for (const distance of [59, 61, 51, 151, 159]) {
    h.camera.position.copy(focus).add(new THREE.Vector3(distance, 0, 0));
    pump(h.details);
    assert.equal(h.candidate.snapshot().activeLOD, 1);
    assert.equal(h.details.records.get('-3,-4/street'), reduced);
  }
  for (const [distance, expected] of [
    [161, null],
    [151, null],
    [139, 1],
    [49, 0],
  ]) {
    h.camera.position.copy(focus).add(new THREE.Vector3(distance, 0, 0));
    pump(h.details);
    assert.equal(h.candidate.snapshot().activeLOD, expected);
  }
  h.details.dispose();
});

test('re-enabling after a pending load isolates old results from the new active candidate', async () => {
  const h = host();
  const resolves = [];
  const old = new ArchitectureModuleCandidate(
    h,
    () => new Promise((resolve) => resolves.push(resolve)),
  );
  h.details.setQAModuleAdapter(old);
  const pending = old.start();
  const current = new ArchitectureModuleCandidate(h, async (lod) => model(lod));
  h.details.setQAModuleAdapter(current);
  await current.start();
  pump(h.details);
  const activeCounts = count(h.details);
  resolves.forEach((resolve, lod) => resolve(model(lod)));
  await pending;
  pump(h.details);
  assert.equal(old.status, 'disposed');
  assert.equal(old.templates.size, 0);
  assert.equal(current.status, 'ready');
  assert.equal(current.templates.size, 2);
  assert.deepEqual(count(h.details), activeCounts);
  h.details.dispose();
});
