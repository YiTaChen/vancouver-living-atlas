import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUS_HYBRID_SOURCE = 'tools/assets/boardable-bus-hybrid';
export const BUS_HYBRID_PREFIX = 'models/blender/bus-hybrid/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hybridMetadataBytes = (value) =>
  Buffer.from(JSON.stringify(value, null, 2) + '\n');
const filename = (level) => `city-bus-12m-exterior.lod${level}.glb`;
const doors = ['front-a', 'front-b', 'rear-a', 'rear-b'].map(
  (id) => `door-right-${id}`,
);
const wheels = ['front-left', 'front-right', 'rear-left', 'rear-right'].map(
  (id) => `wheel-${id}`,
);

async function regular(file) {
  const stat = await lstat(file);
  assert(
    stat.isFile() && !stat.isSymbolicLink(),
    `Hybrid payload must be a regular file: ${file}`,
  );
  return readFile(file);
}
function glb(bytes) {
  assert(
    bytes.length >= 28 && bytes.readUInt32LE(0) === 0x46546c67,
    'Hybrid GLB signature',
  );
  assert.equal(bytes.readUInt32LE(4), 2, 'Hybrid GLB version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'Hybrid GLB length');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'Hybrid GLB JSON');
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942, 'Hybrid GLB BIN');
  return {
    doc: JSON.parse(bytes.subarray(20, 20 + length).toString()),
    binary: bytes.subarray(28 + length),
  };
}
function values(doc, binary, index) {
  const item = doc.accessors[index];
  assert(item && !item.sparse, 'Hybrid accessor must be explicit');
  const view = doc.bufferViews[item.bufferView];
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[item.type];
  const [size, method] =
    {
      5121: [1, 'readUInt8'],
      5123: [2, 'readUInt16LE'],
      5125: [4, 'readUInt32LE'],
      5126: [4, 'readFloatLE'],
    }[item.componentType] ?? [];
  assert(dimensions && size && view, 'Unsupported hybrid accessor');
  const offset = (view.byteOffset ?? 0) + (item.byteOffset ?? 0);
  const stride = view.byteStride ?? dimensions * size;
  return Array.from({ length: item.count }, (_, i) =>
    Array.from({ length: dimensions }, (_, a) =>
      binary[method](offset + i * stride + a * size),
    ),
  );
}
export function auditHybridGLB(bytes, lod) {
  const { doc, binary } = glb(bytes);
  assert(
    (doc.buffers ?? []).every((b) => b.uri === undefined),
    'Hybrid GLB must be self-contained',
  );
  assert.equal(
    (doc.images ?? []).length,
    0,
    'Hybrid livery uses vertex colors, not private image maps',
  );
  assert.equal(
    (doc.textures ?? []).length,
    0,
    'Hybrid exterior has no texture downloads',
  );
  assert.equal((doc.cameras ?? []).length, 0, 'Film cameras must not ship');
  assert(!doc.extensions?.KHR_lights_punctual, 'Film lights must not ship');
  const names = doc.nodes.map((n) => n.name);
  assert.equal(
    new Set(names).size,
    names.length,
    'Hybrid node names must be unique',
  );
  const root = doc.nodes.find((n) => n.name === 'vehicle');
  assert(
    root && !root.matrix && !root.translation && !root.rotation && !root.scale,
    'Hybrid identity metre vehicle root',
  );
  for (const id of [
    ...doors,
    ...wheels,
    'boarding-front',
    'boarding-rear',
    'axle-front',
    'axle-rear',
  ])
    assert(names.includes(id), `Hybrid canonical anchor missing: ${id}`);
  assert(
    !names.some((name) => /thruster|gas stream|ground vapor/i.test(name)),
    'Stunt objects must not ship',
  );
  const roles = new Set();
  for (const material of doc.materials ?? []) {
    const role = material.extras?.semantic_role ?? material.name;
    assert(
      ['paint', 'rubber', 'glass', 'lights'].includes(role),
      'Hybrid semantic material role',
    );
    roles.add(role);
    assert(!material.extensions?.KHR_materials_unlit, 'Hybrid remains lit PBR');
    if (role === 'paint')
      assert(
        (material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1])
          .slice(0, 3)
          .every((v) => Math.abs(v - 1) < 1e-6),
        'White paint multiplier required for multicolor livery',
      );
  }
  assert.equal(roles.size, 4, 'Four exterior material surfaces');
  assert.equal(doc.materials.length, 4, 'No private extra exterior materials');
  let triangles = 0,
    primitives = 0;
  for (const mesh of doc.meshes ?? [])
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, 'Hybrid triangles only');
      const position = doc.accessors[primitive.attributes.POSITION];
      const normal = doc.accessors[primitive.attributes.NORMAL];
      assert(
        position && normal && normal.count === position.count,
        'Hybrid normals/positions',
      );
      const positions = values(doc, binary, primitive.attributes.POSITION);
      const normals = values(doc, binary, primitive.attributes.NORMAL);
      assert(
        positions.flat().every(Number.isFinite) &&
          normals.flat().every(Number.isFinite),
        'Finite hybrid geometry',
      );
      const indices =
        primitive.indices === undefined
          ? positions.map((_, i) => i)
          : values(doc, binary, primitive.indices).flat();
      assert(
        indices.every(
          (i) => Number.isInteger(i) && i >= 0 && i < positions.length,
        ),
        'Hybrid triangle indices',
      );
      assert.equal(indices.length % 3, 0, 'Complete hybrid triangles');
      triangles += indices.length / 3;
      primitives++;
      const material = doc.materials[primitive.material];
      if ((material.extras?.semantic_role ?? material.name) === 'paint')
        assert(
          primitive.attributes.COLOR_0 !== undefined,
          'Paint requires authored COLOR_0',
        );
    }
  assert.equal(triangles, lod.triangles, 'Actual hybrid triangle count');
  assert.equal(primitives, lod.primitives, 'Actual hybrid primitive count');
  assert(
    triangles > 0 && triangles <= 10000,
    'Hybrid exterior triangle budget',
  );
  assert(bytes.length <= 1000000, 'Hybrid exterior byte budget');
  if (lod.level < 2) {
    const ramp = doc.nodes.find((n) => n.name === 'boarding-ramp');
    assert(ramp, 'Hybrid front ramp pivot');
    assert(
      (ramp.translation ?? [0, 0, 0]).every(
        (v, i) => Math.abs(v - [-1.25, 0.36, 4.6][i]) < 2e-5,
      ),
      'Canonical front ramp hinge',
    );
    for (const id of doors) {
      const animation = doc.animations?.find((a) => a.name === `${id}-open`);
      assert(animation, `Hybrid door clip missing: ${id}`);
      const channel = animation.channels.find(
        (c) =>
          doc.nodes[c.target.node]?.name === id &&
          c.target.path === 'translation',
      );
      assert(channel, `Hybrid door translation track: ${id}`);
      const sampler = animation.samplers[channel.sampler];
      assert.equal(
        sampler.interpolation ?? 'LINEAR',
        'LINEAR',
        'No door animation overshoot',
      );
      const points = values(doc, binary, sampler.output);
      assert(
        points.length >= 3 && points.flat().every(Number.isFinite),
        'Hybrid door animation samples',
      );
    }
  }
  return {
    triangles,
    primitives,
    bytes: bytes.length,
    materials: doc.materials.length,
  };
}

export function hybridAdoptionEntries(manifest, manifestBytes) {
  const digest = hash(manifestBytes);
  const sourceRevision = `sha256:${digest}`;
  const common = {
    sourcePackage: 'boardable-bus-hybrid',
    sourceRevision,
    sourceManifestSha256: digest,
  };
  return [
    ...manifest.assets[0].lods.map((lod) => ({
      path: `bus-hybrid/${lod.file}`,
      sha256: lod.sha256,
      bytes: lod.bytes,
      ...common,
      sourcePath: `${BUS_HYBRID_SOURCE}/exports/${lod.file}`,
    })),
    {
      path: 'bus-hybrid/manifest.json',
      sha256: digest,
      bytes: manifestBytes.length,
      ...common,
      sourcePath: `${BUS_HYBRID_SOURCE}/manifest.json`,
    },
  ];
}

export async function verifyBusHybridAdoption(
  output = path.resolve('dist/client'),
  source = path.resolve(BUS_HYBRID_SOURCE),
) {
  const manifestBytes = await regular(path.join(source, 'manifest.json'));
  const m = JSON.parse(manifestBytes);
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.contract, 'boardable-bus-hybrid-exterior-v1');
  assert.equal(m.packageId, 'boardable-bus-hybrid');
  assert.equal(m.version, '1.0.0');
  assert.equal(m.units, 'm');
  assert.equal(m.assets.length, 1);
  assert.equal(m.assets[0].id, 'city-bus-12m-exterior');
  assert.deepEqual(
    m.assets[0].lods.map((l) => l.level),
    [0, 1, 2],
  );
  const expectedNames = [
    'manifest.json',
    ...m.assets[0].lods.map((l) => l.file),
  ].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    (await readdir(path.join(output, BUS_HYBRID_PREFIX))).sort((a, b) =>
      a.localeCompare(b),
    ),
    expectedNames,
    'Only reviewed hybrid runtime payloads may ship',
  );
  const deployed = await regular(
    path.join(output, BUS_HYBRID_PREFIX, 'manifest.json'),
  );
  assert(
    deployed.equals(manifestBytes),
    'Hybrid runtime metadata must equal its reviewed authoring metadata',
  );
  let total = 0;
  const measured = [];
  for (const lod of m.assets[0].lods) {
    assert.equal(lod.file, filename(lod.level));
    assert.equal(
      lod.export,
      `exports/${lod.file}`,
      'Canonical hybrid authoring export path',
    );
    assert.equal(lod.url, `/${BUS_HYBRID_PREFIX}${lod.file}`);
    assert(/^[a-f0-9]{64}$/.test(lod.sha256), 'Hybrid payload SHA256');
    assert.equal(
      lod.source,
      `source/${filename(lod.level).replace('.glb', '.blend')}`,
    );
    const authoring = await regular(path.join(source, lod.source));
    assert.equal(
      hash(authoring),
      lod.sourceSha256,
      'Hybrid editable source changed',
    );
    assert.equal(
      authoring.length,
      lod.sourceBytes,
      'Hybrid source size changed',
    );
    const bytes = await regular(path.join(source, 'exports', lod.file));
    assert.equal(hash(bytes), lod.sha256, 'Hybrid export changed');
    assert.equal(bytes.length, lod.bytes);
    const publicBytes = await regular(
      path.join(output, BUS_HYBRID_PREFIX, lod.file),
    );
    assert(
      publicBytes.equals(bytes),
      'Hybrid deployed GLB differs from reviewed export',
    );
    measured.push(auditHybridGLB(bytes, lod));
    total += bytes.length;
  }
  const inventory = JSON.parse(
    await readFile(
      path.join(output, 'models/blender/adopted-manifest.json'),
      'utf8',
    ),
  );
  assert.deepEqual(
    inventory.files.filter((item) => item.path?.startsWith('bus-hybrid/')),
    hybridAdoptionEntries(m, manifestBytes),
    'Exact hybrid adoption inventory',
  );
  return {
    status: 'pass',
    adoptedFiles: 4,
    geometryBytes: total,
    lods: measured,
    sourceManifestSha256: hash(manifestBytes),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(
    await verifyBusHybridAdoption(path.resolve(process.argv[2] ?? 'public')),
  );
