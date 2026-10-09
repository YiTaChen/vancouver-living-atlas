import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  copyFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  loadBusCloseupProjection,
  projectBusCloseupRuntimeMetadata,
  auditBusCloseupGLB,
  BUS_CLOSEUP_SOURCE_REVISION,
  BUS_CLOSEUP_SOURCE_MANIFEST_SHA256,
  BUS_CLOSEUP_SOURCE_PATH,
  BUS_CLOSEUP_REVIEWED_LODS,
} from '../tools/project-bus-closeup-runtime.mjs';
import { loadBusV2Projection } from '../tools/project-bus-v2-runtime.mjs';
import { loadMetroProjection } from '../tools/metro-projection.mjs';
import { verifyStage2TransitAdoption } from '../tools/verify-stage2-transit-adoption.mjs';

const projection = await loadBusCloseupProjection();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function sandbox(run, copySources = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bus-closeup-adoption-'));
  const output = path.join(root, 'dist'),
    source = path.join(root, 'source');
  const put = async (base, name, bytes) => {
    const file = path.join(base, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  const bus = await loadBusV2Projection(),
    metro = await loadMetroProjection();
  const entries = structuredClone([
    ...bus.entries,
    ...metro.entries,
    ...projection.entries,
  ]);
  const save = () =>
    put(
      output,
      'models/blender/adopted-manifest.json',
      JSON.stringify({ version: 1, files: entries }),
    );
  try {
    for (const entry of entries)
      await put(
        output,
        `models/blender/${entry.path}`,
        await readFile(`public/models/blender/${entry.path}`),
      );
    await save();
    if (copySources)
      for (const input of projection.metadata.source.inputs) {
        const file = path.join(source, input.file);
        await mkdir(path.dirname(file), { recursive: true });
        await copyFile(input.file, file);
      }
    await run({ root, output, source, entries, put, save });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('closeup adoption adds only three pinned files and preserves all old public adoption entries and payloads', async () => {
  const inventory = JSON.parse(
    await readFile('public/models/blender/adopted-manifest.json', 'utf8'),
  );
  const baseline = JSON.parse(
    execFileSync(
      'git',
      [
        'show',
        `${BUS_CLOSEUP_SOURCE_REVISION}:public/models/blender/adopted-manifest.json`,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(
    inventory.files.filter((entry) => !entry.path.startsWith('bus-closeup/')),
    baseline.files,
  );
  assert.deepEqual(
    inventory.files.filter((entry) => entry.path.startsWith('bus-closeup/')),
    projection.entries,
  );
  assert.equal(inventory.files.length, 38);
  assert.equal(
    inventory.files.filter(
      (entry) => !/^(bus|bus-v2|metro|bus-closeup)\//.test(entry.path),
    ).length,
    19,
  );
  for (const entry of baseline.files) {
    const file = 'public/models/blender/' + entry.path;
    assert(
      (await readFile(file)).equals(
        execFileSync(
          'git',
          ['show', `${BUS_CLOSEUP_SOURCE_REVISION}:${file}`],
          { maxBuffer: 20 * 1024 * 1024 },
        ),
      ),
      file,
    );
  }
  for (const entry of projection.entries) {
    const bytes = await readFile('public/models/blender/' + entry.path);
    assert.equal(hash(bytes), entry.sha256);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(entry.sourceRevision, BUS_CLOSEUP_SOURCE_REVISION);
    assert.equal(
      entry.sourceManifestSha256,
      BUS_CLOSEUP_SOURCE_MANIFEST_SHA256,
    );
  }
});

test('canonical closeup metadata preserves complete vehicle safety and all authored PBR texture bindings', async () => {
  const { manifest, metadata, metadataBytes } = projection;
  assert(
    (await readFile('public/models/blender/bus-closeup/manifest.json')).equals(
      metadataBytes,
    ),
  );
  assert.equal(metadata.contract, 'boardable-bus-closeup-runtime-v1');
  assert.equal(metadata.runtimeScope, 'nearby-bus-visit-only');
  assert.equal(metadata.fleetAllowed, false);
  assert.equal(metadata.source.assetRevision, BUS_CLOSEUP_SOURCE_REVISION);
  assert.equal(metadata.source.inputs.length, 12);
  assert.equal(metadata.audit.anchorCount, 82);
  assert.equal(metadata.audit.anchorNodeNames.length, 82);
  assert.equal(metadata.audit.floorSupportSurfaces, 6);
  assert.equal(metadata.audit.embeddedImageBytes, 98020);
  assert.equal(metadata.textures[0].width, 256);
  assert.equal(metadata.textures[0].height, 256);
  assert.equal(metadata.textures[0].colorSpace, 'sRGB');
  assert.equal(metadata.textures[0].embedded, true);
  assert(!('source' in metadata.textures[0]));
  const sourceVehicle = manifest.vehicles[0],
    vehicle = metadata.vehicles[0];
  for (const key of Object.keys(sourceVehicle).filter(
    (key) => !['assetRefs', 'composition'].includes(key),
  ))
    assert.deepEqual(vehicle[key], sourceVehicle[key], key);
  assert.equal(vehicle.seats.length, 24);
  assert.equal(vehicle.floorSurfaces.length, 6);
  assert.equal(vehicle.nonStandingRegions[0].standingAllowed, false);
  assert.equal(vehicle.portalSupportCorrection.masterGapFixed, true);
  assert.deepEqual(
    vehicle.composition.lodMapping,
    sourceVehicle.composition.lodMapping,
  );
  assert.equal(vehicle.composition.lodMapping[2].boardingAllowed, false);
  assert(
    metadata.assets[0].lods.every(
      (lod) => lod.url === '/models/blender/bus/' + lod.file,
    ),
  );
  assert(
    metadata.assets[1].lods.every(
      (lod) => lod.url === '/models/blender/bus-closeup/' + lod.file,
    ),
  );
  assert.deepEqual(
    metadata.assets[1].materialBindings,
    manifest.assets[0].materialBindings,
  );
  assert(
    metadata.assets.every((asset) =>
      asset.lods.every(
        (lod) => !('componentSidecar' in lod) && !('source' in lod),
      ),
    ),
  );
  assert(
    metadata.textures.every(
      (texture) =>
        texture.embedded && !('url' in texture) && !('source' in texture),
    ),
  );
  const before = JSON.stringify(manifest);
  const exterior = JSON.parse(
    await readFile('tools/assets/boardable-bus/manifest.json', 'utf8'),
  );
  projectBusCloseupRuntimeMetadata(
    manifest,
    exterior,
    metadata.source.inputs,
    metadata.audit,
  );
  assert.equal(
    JSON.stringify(manifest),
    before,
    'Projection must not mutate authoring metadata',
  );
});

test('actual source GLBs and their source/sidecar/image dependencies all bind; original B-CAB budget limits remain unchanged', async () => {
  for (const lod of projection.manifest.assets[0].lods) {
    const source = await readFile(`${BUS_CLOSEUP_SOURCE_PATH}/${lod.file}`),
      publicBytes = await readFile(
        'public/models/blender/bus-closeup/' + path.basename(lod.file),
      );
    assert(source.equals(publicBytes));
    const measured = auditBusCloseupGLB(
      publicBytes,
      lod,
      projection.manifest.vehicles[0],
      projection.manifest.textures[0],
    );
    assert.deepEqual(measured, projection.metadata.audit);
    assert.equal(lod.triangles, BUS_CLOSEUP_REVIEWED_LODS[lod.level].triangles);
    assert.equal(lod.bytes, BUS_CLOSEUP_REVIEWED_LODS[lod.level].bytes);
    assert(lod.triangles > [12000, 3000][lod.level]);
  }
  const budget = await loadBusV2Projection();
  assert.deepEqual(
    budget.manifest.assets[0].lods.map((lod) => lod.triangles),
    [11704, 2824],
  );
  assert.deepEqual(
    budget.manifest.assets[0].lods.map((lod) => lod.bytes),
    [736884, 202492],
  );
});

test('a complete minimum checkout contains all twelve exact closeup source inputs and reproduces canonical output', () =>
  sandbox(async ({ source }) => {
    const isolated = await loadBusCloseupProjection(source);
    assert(isolated.metadataBytes.equals(projection.metadataBytes));
    assert.deepEqual(isolated.entries, projection.entries);
  }, true));

for (const [name, file] of [
  ['editable source', 'source/city-bus-12m-interior-v2-closeup.lod0.blend'],
  [
    'component sidecar',
    'exports/city-bus-12m-interior-v2-closeup.lod1.components.json',
  ],
  ['embedded texture source', 'source/floor-speckle.png'],
  ['reviewed source manifest', 'manifest.json'],
])
  test(`closeup projection refuses changed ${name}`, () =>
    sandbox(async ({ source, put }) => {
      const relative = `${BUS_CLOSEUP_SOURCE_PATH}/${file}`;
      const bytes = await readFile(path.join(source, relative));
      const modified = Buffer.from(bytes);
      modified[modified.length - 1] ^= 1;
      await put(source, relative, modified);
      await assert.rejects(
        loadBusCloseupProjection(source),
        /Closeup pinned source changed/,
      );
    }, true));

test('closeup projection refuses missing or symlinked inputs and changed exterior dependencies', () =>
  sandbox(async ({ source, put }) => {
    const relative = `${BUS_CLOSEUP_SOURCE_PATH}/source/floor-speckle.png`,
      file = path.join(source, relative);
    const bytes = await readFile(file);
    await rm(file);
    await assert.rejects(loadBusCloseupProjection(source), /ENOENT/);
    await symlink(path.resolve(relative), file);
    await assert.rejects(loadBusCloseupProjection(source), /regular file/);
    await rm(file);
    await put(source, relative, bytes);
    await put(
      source,
      'tools/assets/boardable-bus/exports/city-bus-12m-exterior.lod1.glb',
      'changed exterior',
    );
    await assert.rejects(
      loadBusCloseupProjection(source),
      /Closeup pinned source changed/,
    );
  }, true));

test('mandatory Stage 2 gate includes closeup payloads and rejects altered GLB/metadata/provenance and missing adoption', () =>
  sandbox(async ({ output, put, entries, save }) => {
    assert.equal((await verifyStage2TransitAdoption(output)).adoptedFiles, 13);
    const entry = entries.find((entry) =>
      entry.path.startsWith('bus-closeup/'),
    );
    const file = 'models/blender/' + entry.path,
      original = await readFile(path.join(output, file)),
      changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    await put(output, file, changed);
    await assert.rejects(
      verifyStage2TransitAdoption(output),
      /payload changed/,
    );
    await put(output, file, original);
    const metadataFile = 'models/blender/bus-closeup/manifest.json',
      metadata = await readFile(path.join(output, metadataFile));
    await put(
      output,
      metadataFile,
      Buffer.concat([metadata, Buffer.from(' ')]),
    );
    await assert.rejects(
      verifyStage2TransitAdoption(output),
      /payload size changed/,
    );
    await put(output, metadataFile, metadata);
    entry.sourceRevision = 'invented';
    await save();
    await assert.rejects(
      verifyStage2TransitAdoption(output),
      /inventory and provenance/,
    );
    entry.sourceRevision = BUS_CLOSEUP_SOURCE_REVISION;
    await save();
    await rm(path.join(output, file));
    await assert.rejects(verifyStage2TransitAdoption(output), /ENOENT/);
  }));

test('recomputed inventory hashes cannot enable fleet use, remove floor support or change closeup texture semantics', () =>
  sandbox(async ({ output, put, entries, save }) => {
    const entry = entries.find(
      (entry) => entry.path === 'bus-closeup/manifest.json',
    );
    for (const change of [
      (metadata) => {
        metadata.fleetAllowed = true;
      },
      (metadata) => {
        metadata.vehicles[0].floorSurfaces.pop();
      },
      (metadata) => {
        metadata.textures[0].colorSpace = 'linear';
      },
    ]) {
      const metadata = structuredClone(projection.metadata);
      change(metadata);
      const bytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
      await put(output, 'models/blender/bus-closeup/manifest.json', bytes);
      entry.sha256 = hash(bytes);
      entry.bytes = bytes.length;
      await save();
      await assert.rejects(
        verifyStage2TransitAdoption(output),
        /inventory and provenance/,
      );
    }
  }));

test('approved closeup GLBs cannot be renamed or duplicated outside exact adopted paths, and symlinks fail closed', () =>
  sandbox(async ({ output, put }) => {
    const glb =
        'models/blender/bus-closeup/city-bus-12m-interior-v2-closeup.lod1.glb',
      bytes = await readFile(path.join(output, glb));
    await put(output, 'assets/renamed-closeup.bin', bytes);
    await assert.rejects(
      verifyStage2TransitAdoption(output),
      /Unapproved Stage 2/,
    );
    await rm(path.join(output, 'assets/renamed-closeup.bin'));
    await rm(path.join(output, glb));
    await symlink(path.resolve('public', glb), path.join(output, glb));
    await assert.rejects(verifyStage2TransitAdoption(output), /symlinks/);
  }));

test('component sidecars, source textures, editable sources and previews remain protected under renamed paths', () =>
  sandbox(async ({ output, put }) => {
    for (const file of [
      'exports/city-bus-12m-interior-v2-closeup.lod0.components.json',
      'source/floor-speckle.png',
      'source/city-bus-12m-interior-v2-closeup.lod1.blend',
      'qa/previews/seat-quality-lod0.png',
    ]) {
      await put(
        output,
        'assets/leaked.dat',
        await readFile(`${BUS_CLOSEUP_SOURCE_PATH}/${file}`),
      );
      await assert.rejects(
        verifyStage2TransitAdoption(output),
        /Unapproved Stage 2/,
      );
      await rm(path.join(output, 'assets/leaked.dat'));
    }
    await put(output, 'models/blender/bus-closeup/extra.json', '{}');
    await assert.rejects(
      verifyStage2TransitAdoption(output),
      /Unlisted Stage 2/,
    );
  }));
