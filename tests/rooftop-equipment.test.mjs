import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
const {
  RooftopEquipment,
  ROOFTOP_TEMPLATES,
  extractRooftopGeometry,
  selectRooftopGroups,
} = await import(cityModule('rooftop-equipment'));
const { architectureWork, roofBoxFits } = await import(
  cityModule('architecture-plan')
);
const { roofCellWork } = await import(cityModule('architecture-roof-budget'));
const { createProfile } = await import(cityModule('facade-profile'));
const source = JSON.parse(
  readFileSync(
    new URL('../tools/assets/rooftop-equipment/manifest.json', import.meta.url),
  ),
);
function bytes(asset, lod) {
  return readFileSync(
    new URL(
      `../public/models/blender/rooftop-equipment/${asset.lods[lod].file}`,
      import.meta.url,
    ),
  );
}
async function model(asset, lod) {
  const data = bytes(asset, lod);
  return (
    await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      '',
    )
  ).scene;
}
function part(key, height = 18, x = 0) {
  const profile = createProfile({
    key,
    heightM: height,
    footprintAreaM2: 1500,
    center: [x, 0],
  });
  return {
    key,
    polygon: [
      [
        [x, 0],
        [x + 50, 0],
        [x + 50, 30],
        [x, 30],
      ],
    ],
    ground: 12,
    height,
    minHeight: 0,
    profile,
    roof: true,
  };
}
const library = () => ({
  color: new THREE.Texture(),
  normal: new THREE.Texture(),
  orm: new THREE.Texture(),
  ready: { value: 0 },
});
const flush = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setImmediate(resolve));
};

test('all six promoted GLBs retain delivered hashes, metre datum, triangles and two semantic roles', async () => {
  for (const asset of ROOFTOP_TEMPLATES)
    for (const lod of [0, 1]) {
      const original = source.assets.find((a) => a.id === asset.id).lods[lod];
      assert.equal(
        createHash('sha256').update(bytes(asset, lod)).digest('hex'),
        original.sha256,
      );
      assert.equal(bytes(asset, lod).length, original.bytes);
      const pieces = extractRooftopGeometry(
        await model(asset, lod),
        asset,
        lod,
      );
      assert.equal(pieces.length, 2);
      assert.deepEqual(
        new Set(pieces.map((p) => p.role)),
        new Set(['shared-metal-housing', 'shared-metal-detail']),
      );
      assert(
        pieces.every(
          (p) =>
            p.geometry.getAttribute('uv') &&
            p.geometry.getAttribute('aReliefSurface'),
        ),
      );
      pieces.forEach((p) => p.geometry.dispose());
    }
});

test('source assemblies replace completely, never enlarge checked footprints or stretch tall plant', () => {
  const parts = Array.from({ length: 14 }, (_, i) =>
    part(`roof-${i}`, i === 0 ? 75 : 18, i * 60),
  );
  const boxes = parts.flatMap((p) =>
    [...architectureWork([p], 'roof')].filter(Boolean),
  );
  const groups = selectRooftopGroups(boxes);
  assert(groups.length > 8);
  assert(groups.some((g) => g.asset.id === 'hvac-compact-single'));
  for (const { unit, indices, asset } of groups) {
    assert.equal(indices.length, unit.boxCount);
    assert(unit.height <= 1.4);
    assert(
      asset.size[0] <= unit.width + 1e-6 && asset.size[2] <= unit.depth + 1e-6,
    );
    const p = parts.find((p) => p.key === unit.sourceKey);
    assert.equal(unit.y, p.ground + p.height);
    assert(
      roofBoxFits(
        p.polygon,
        unit.x,
        unit.z,
        asset.size[0] + 2,
        asset.size[2] + 2,
        unit.yaw,
        p.roofExclusions,
      ),
    );
    assert.equal(
      selectRooftopGroups(indices.slice(1).map((i) => boxes[i])).length,
      0,
    );
  }
  const truncated = [...roofCellWork(parts, 26, [290, 50, 0])].filter(Boolean);
  assert.equal(
    selectRooftopGroups(truncated).length,
    0,
    'fair budget primary pairs must keep fallback',
  );
  assert.equal(
    selectRooftopGroups(
      [
        ...architectureWork(
          [{ ...part('pitched'), roofEaveHeight: 15 }],
          'roof',
        ),
      ].filter(Boolean),
    ).length,
    0,
  );
});

test('loading is lazy, admission stays within two cells and paired meshes retain unit scale and source Y', async () => {
  let loads = 0;
  const system = new RooftopEquipment(library, async (asset, lod) => {
    loads++;
    return model(asset, lod);
  });
  system.configure([{ id: 'far', distance: 8700 }], 'high');
  system.configure([{ id: 'near', distance: 10 }], 'balanced');
  assert.equal(loads, 0);
  system.configure(
    [
      { id: 'a', distance: 10 },
      { id: 'b', distance: 20 },
      { id: 'c', distance: 30 },
    ],
    'high',
  );
  await flush();
  assert.equal(loads, 3);
  assert.equal(system.stats.readyTemplates, 3);
  assert.equal(system.stats.selectedCells, 2);
  const boxes = Array.from({ length: 20 }, (_, i) =>
    part(`roof-${i}`, 18, i * 60),
  ).flatMap((p) => [...architectureWork([p], 'roof')].filter(Boolean));
  const a = system.assemble(boxes, 'a', new THREE.Vector3()),
    b = system.assemble(boxes, 'b', new THREE.Vector3());
  assert.equal(a.units, 12);
  assert.equal(b.units, 12);
  assert.equal(system.assemble(boxes, 'c', new THREE.Vector3()), null);
  assert(a.meshes.length <= 6);
  assert.equal(
    a.meshes.reduce((n, m) => n + m.count, 0),
    a.units * 2,
  );
  for (const mesh of a.meshes)
    for (let i = 0; i < mesh.count; i++) {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3(),
        rotation = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      matrix.decompose(position, rotation, scale);
      assert(
        Math.abs(scale.x - 1) < 1e-6 &&
          Math.abs(scale.y - 1) < 1e-6 &&
          Math.abs(scale.z - 1) < 1e-6,
      );
      assert.equal(position.y, 30);
    }
  system.configure(
    [
      { id: 'a', distance: 90 },
      { id: 'b', distance: 90 },
    ],
    'high',
  );
  await flush();
  assert.equal(loads, 3, 'near LOD hysteresis avoids jitter');
  system.configure(
    [
      { id: 'a', distance: 100 },
      { id: 'b', distance: 100 },
    ],
    'ultra',
  );
  await flush();
  assert.equal(loads, 6);
  assert.equal(system.assemble(boxes, 'a', new THREE.Vector3()).units, 24);
  system.configure([], 'off');
  assert.equal(system.assemble(boxes, 'a', new THREE.Vector3()), null);
  assert.equal(
    system.stats.readyTemplates,
    6,
    'bounded templates retained across travel',
  );
  a.meshes.concat(b.meshes).forEach((m) => m.dispose());
  system.dispose();
  assert.equal(system.stats.readyTemplates, 0);
});

test('failed and post-disposal loads leave every original box available and free imported geometry', async () => {
  const failure = new RooftopEquipment(library, async () => {
    throw new Error('offline');
  });
  failure.configure([{ id: 'a', distance: 10 }], 'high');
  await flush();
  assert.equal(failure.stats.failedLoads, 3);
  const boxes = [...architectureWork([part('roof-2')], 'roof')].filter(Boolean);
  assert.equal(
    failure.assemble(boxes, 'a', new THREE.Vector3()).consumed.size,
    0,
  );
  failure.dispose();
  const resolvers = [];
  let disposed = 0;
  const delayed = new RooftopEquipment(
    library,
    () => new Promise((resolve) => resolvers.push(resolve)),
  );
  delayed.configure([{ id: 'a', distance: 10 }], 'high');
  delayed.dispose();
  for (let i = 0; i < resolvers.length; i++) {
    const scene = await model(ROOFTOP_TEMPLATES[i], 0);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh)
        o.geometry.addEventListener('dispose', () => disposed++);
    });
    resolvers[i](scene);
  }
  await flush();
  assert.equal(disposed, 6);
  assert.equal(delayed.stats.readyTemplates, 0);
});

test('malformed role or transform rejects rather than attaching an incorrectly scaled export', async () => {
  for (const mutate of [
    (scene) => {
      scene.children[0].scale.setScalar(10);
    },
    (scene) => {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material.name = 'unknown';
      });
    },
  ]) {
    const scene = await model(ROOFTOP_TEMPLATES[0], 0);
    mutate(scene);
    assert.throws(() => extractRooftopGeometry(scene, ROOFTOP_TEMPLATES[0], 0));
  }
});

test('architecture streaming restores original boxes on disable and releases every replaced batch across travel', async () => {
  const { ArchitecturalDetails } = await import(
    cityModule('architecture-details')
  );
  const { unproject } = await import(cityModule('geo'));
  const parts = Array.from({ length: 12 }, (_, i) =>
    part(`roof-${i}`, 18, i * 240),
  );
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(25, 45, 15);
  const host = {
    data: {
      buildings: {
        features: parts.map((p) => ({
          properties: { id: p.key, height: p.height, minHeight: 0 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [...p.polygon[0], p.polygon[0][0]].map(([x, z]) =>
                unproject(x, z),
              ),
            ],
          },
        })),
      },
      buildingProfiles: new Map(parts.map((p) => [p.key, p.profile])),
      buildingFoundations: new Map(parts.map((p) => [p.key, p.ground])),
    },
    camera,
    settings: { quality: 'high', buildings: true },
    buildings: new THREE.Group(),
    renderer: { shadowMap: { needsUpdate: false } },
  };
  const kit = new RooftopEquipment(library, model);
  const details = new ArchitecturalDetails(host, kit);
  for (let i = 0; i < 300; i++) details.update();
  await flush();
  for (let i = 0; i < 300; i++) details.update();
  assert(details.stats.rooftopUnits > 0);
  assert(details.stats.rooftopUnits <= 24);
  assert.equal(details.stats.pendingCells, 0);
  const initialCount = details.stats.allocatedInstances;
  let released = 0;
  for (const record of details.records.values())
    for (const mesh of record.group.children)
      if (mesh.userData.rooftopEquipment)
        mesh.addEventListener('dispose', () => released++);
  details.setRooftopEnabled(false);
  for (let i = 0; i < 300; i++) details.update();
  assert.equal(details.stats.rooftopUnits, 0);
  assert.equal(details.stats.allocatedInstances, initialCount);
  assert(released > 0);
  for (const record of details.records.values())
    assert(
      record.group.children.every((mesh) => !mesh.userData.rooftopEquipment),
    );
  details.setRooftopEnabled(true);
  for (let step = 0; step < 6; step++) {
    camera.position.x = step * 500;
    for (let i = 0; i < 300; i++) details.update();
    await flush();
    for (let i = 0; i < 300; i++) details.update();
    assert(details.stats.rooftopUnits <= 24);
    assert(
      [...details.records.values()].filter((r) => r.rooftopUnits > 0).length <=
        2,
    );
    assert(details.records.size <= 38);
  }
  host.compatibleGraphics = true;
  details.update(true);
  for (let i = 0; i < 300; i++) details.update();
  assert.equal(details.stats.rooftopUnits, 0);
  details.dispose();
  assert.equal(kit.stats.readyTemplates, 0);
});
