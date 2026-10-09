import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  verifyBusAdoption,
  projectBusRuntimeMetadata,
  BUS_SOURCE_MANIFEST_SHA256,
  BUS_SOURCE_REVISION,
  BUS_PUBLIC_PREFIX,
} from '../tools/verify-bus-adoption.mjs';

const originalSource = path.resolve('tools/assets/boardable-bus');
const originalManifestBytes = await readFile(path.join(originalSource, 'manifest.json'));
const originalManifest = JSON.parse(originalManifestBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceExports = originalManifest.assets.flatMap((asset) => asset.lods);
const publicFiles = [...sourceExports.map((lod) => path.basename(lod.file)), 'manifest.json'];

async function fixture({ copySource = false } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'bus-adoption-')),
    output = path.join(base, 'dist'),
    source = copySource ? path.join(base, 'source') : originalSource;
  const put = async (root, name, bytes) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  for (const name of publicFiles)
    await put(output, BUS_PUBLIC_PREFIX + name, await readFile(path.join('public', BUS_PUBLIC_PREFIX, name)));
  const inventory = JSON.parse(await readFile('public/models/blender/adopted-manifest.json', 'utf8'));
  const saveInventory = () => put(output, 'models/blender/adopted-manifest.json', JSON.stringify(inventory, null, 2) + '\n');
  await saveInventory();
  if (copySource) {
    await put(source, 'manifest.json', originalManifestBytes);
    for (const lod of sourceExports)
      for (const name of [lod.file, lod.source]) {
        const file = path.join(source, name);
        await mkdir(path.dirname(file), { recursive: true });
        await copyFile(path.join(originalSource, name), file);
      }
  }
  return {
    base,
    output,
    source,
    inventory,
    put,
    saveInventory,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
async function usingFixture(run, options) {
  const f = await fixture(options);
  try {
    await run(f);
  } finally {
    await f.cleanup();
  }
}

test('reviewed bus exports and canonical full boarding metadata are adopted without replacing the previous inventory', async () => {
  const inventory = JSON.parse(await readFile('public/models/blender/adopted-manifest.json', 'utf8'));
  assert.equal(inventory.sourceRevision, 'dc6e6b5dd14ed83b1909e677d611d8c2eba3b559');
  assert.equal(inventory.files.filter((entry) => !/^(bus|bus-v2|metro|bus-closeup)\//.test(entry.path)).length, 19);
  const bus = inventory.files.filter((entry) => entry.path.startsWith('bus/'));
  assert.equal(bus.length, 6);
  assert(bus.every((entry) => entry.sourceRevision === BUS_SOURCE_REVISION));
  assert(bus.every((entry) => entry.sourceManifestSha256 === BUS_SOURCE_MANIFEST_SHA256));
  const result = await verifyBusAdoption(path.resolve('public'));
  assert.equal(result.adoptedFiles, 6);
  assert.equal(result.geometryBytes, 797812);
  assert.equal(result.metadataBytes, 107555);
});

test('production metadata preserves complete frames, floor, doors, passenger and collision contracts', async () => {
  const metadata = JSON.parse(await readFile('public/models/blender/bus/manifest.json', 'utf8'));
  assert.equal(metadata.contract, 'boardable-bus-runtime-v1');
  assert.equal(metadata.units, 'm');
  assert.equal(metadata.vehicles.length, 1);
  const source = originalManifest.vehicles[0],
    vehicle = metadata.vehicles[0];
  for (const key of [
    'frames', 'contactDatum', 'floorSurfaces', 'floorSegments', 'walkableFloor',
    'ceiling', 'doors', 'seats', 'standingRegions', 'collision', 'wheels',
    'driver', 'cameraAnchors', 'lodCapabilities',
  ]) assert.deepEqual(vehicle[key], source[key], key);
  assert.equal(vehicle.seats.length, 10);
  assert.equal(vehicle.standingRegions.length, 2);
  assert.equal(vehicle.doors.length, 4);
  assert.equal(vehicle.contactDatum.pointM[1], 0);
  assert.equal(vehicle.floorSegments[0].heightM, 0.36);
  assert.deepEqual(vehicle.composition.lodMapping, [
    { exterior: 0, interior: 0, boardingAllowed: true },
    { exterior: 1, interior: 1, boardingAllowed: true },
    { exterior: 2, interior: null, boardingAllowed: false },
  ]);
  assert(metadata.assets.flatMap((asset) => asset.lods).every((lod) =>
    !lod.file.includes('/') && lod.url === `/${BUS_PUBLIC_PREFIX}${lod.file}`));
  assert.deepEqual(metadata.assets[1].lods.map((lod) => lod.level), [0, 1]);
  assert(!JSON.stringify(metadata).includes('batchRanges'));
  const before = JSON.stringify(originalManifest);
  projectBusRuntimeMetadata(originalManifest);
  assert.equal(JSON.stringify(originalManifest), before, 'Projection must not mutate authoring metadata');
});

test('exact adoption also works against a complete minimum checkout of the pinned source files', async () =>
  usingFixture(async (f) => {
    const result = await verifyBusAdoption(f.output, f.source);
    assert.equal(result.status, 'pass');
    assert.equal(result.adoptedFiles, 6);
  }, { copySource: true }));

for (const [name, change, message] of [
  ['unlisted public bus file', (f) => f.put(f.output, BUS_PUBLIC_PREFIX + 'extra.json', '{}'), /Unlisted bus payload/],
  ['nested payload', (f) => f.put(f.output, BUS_PUBLIC_PREFIX + 'extra/previews.bin', 'extra'), /Unlisted bus payload/],
  ['missing deployed LOD', (f) => rm(path.join(f.output, BUS_PUBLIC_PREFIX + publicFiles[0])), /ENOENT/],
  ['changed deployed GLB', (f) => f.put(f.output, BUS_PUBLIC_PREFIX + publicFiles[0], 'tampered'), /Bus deployed payload/],
  ['missing inventory entry', async (f) => {
    f.inventory.files = f.inventory.files.filter((entry) => entry.path !== `bus/${publicFiles[0]}`);
    await f.saveInventory();
  }, /Exact bus adoption/],
  ['duplicate inventory entry', async (f) => {
    f.inventory.files.push({ ...f.inventory.files.find((entry) => entry.path.startsWith('bus/')) });
    await f.saveInventory();
  }, /Exact bus adoption/],
  ['changed declared digest', async (f) => {
    f.inventory.files.find((entry) => entry.path.startsWith('bus/')).sha256 = '0'.repeat(64);
    await f.saveInventory();
  }, /Exact bus adoption/],
  ['wrong source attribution', async (f) => {
    f.inventory.files.find((entry) => entry.path.startsWith('bus/')).sourceRevision = '0'.repeat(40);
    await f.saveInventory();
  }, /Exact bus adoption/],
  ['path traversal', async (f) => {
    f.inventory.files.find((entry) => entry.path.startsWith('bus/')).path = 'bus/../bus/' + publicFiles[0];
    await f.saveInventory();
  }, /Exact bus adoption/],
  ['source GLB duplicated at a renamed binary path', async (f) =>
    f.put(f.output, 'assets/renamed.bin', await readFile(path.join(originalSource, sourceExports[0].file))), /Unapproved bus source\/duplicate/],
  ['authoring source renamed to binary', async (f) =>
    f.put(f.output, 'assets/hidden.bin', await readFile(path.join(originalSource, sourceExports[0].source))), /Unapproved bus source\/duplicate/],
  ['full source manifest renamed to binary', (f) =>
    f.put(f.output, 'assets/source-manifest.bin', originalManifestBytes), /Unapproved bus source\/duplicate/],
  ['research loader in a public script', (f) =>
    f.put(f.output, 'assets/research.js', 'fetch("/__offline-assets/boardable-bus/manifest.json")'), /Research-only bus loader/],
  ['symlink bypass', (f) => symlink(
    path.join(originalSource, sourceExports[0].file), path.join(f.output, 'linked.bin')),
  /Symlinks cannot bypass/],
]) test(`bus adoption rejects ${String(name)}`, async () => usingFixture(async (f) => {
  await change(f);
  await assert.rejects(verifyBusAdoption(f.output, f.source), message);
}));

for (const [name, mutate] of [
  ['door clearance changed', (metadata) => { metadata.vehicles[0].doors[0].sillHeightM = 0; }],
  ['collision removed', (metadata) => { metadata.vehicles[0].collision.primitives = []; }],
  ['LOD2 falsely passenger capable', (metadata) => { metadata.vehicles[0].lodCapabilities[2].passengerCapable = true; }],
  ['source metadata SHA changed', (metadata) => { metadata.source.manifestSha256 = '0'.repeat(64); }],
  ['unknown authoring extras injected', (metadata) => { metadata.assets[0].batchRanges = [{ bypass: true }]; }],
  ['public asset URL outside adopted directory', (metadata) => { metadata.assets[0].lods[0].url = '/unlisted.glb'; }],
]) test(`metadata cannot bypass source projection with a recomputed inventory digest: ${String(name)}`, async () =>
  usingFixture(async (f) => {
    const metadata = JSON.parse(await readFile(path.join(f.output, BUS_PUBLIC_PREFIX, 'manifest.json'), 'utf8'));
    mutate(metadata);
    const bytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
    await f.put(f.output, BUS_PUBLIC_PREFIX + 'manifest.json', bytes);
    const entry = f.inventory.files.find((item) => item.path === 'bus/manifest.json');
    entry.sha256 = hash(bytes);
    entry.bytes = bytes.length;
    await f.saveInventory();
    await assert.rejects(verifyBusAdoption(f.output, f.source), /canonical source projection/);
  }));

for (const [name, change, message] of [
  ['source export and adopted file changed together', async (f) => {
    const bytes = Buffer.from('changed source and deployment together');
    await f.put(f.source, sourceExports[0].file, bytes);
    await f.put(f.output, BUS_PUBLIC_PREFIX + publicFiles[0], bytes);
    const entry = f.inventory.files.find((item) => item.path === `bus/${publicFiles[0]}`);
    entry.sha256 = hash(bytes);
    entry.bytes = bytes.length;
    await f.saveInventory();
  }, /Bus export changed from source manifest/],
  ['artist source modified', (f) => f.put(f.source, sourceExports[0].source, 'modified authoring geometry'), /Bus authoring source changed/],
  ['source manifest modified', (f) => f.put(f.source, 'manifest.json', JSON.stringify({ ...originalManifest, version: '2.0.0' })), /Bus source manifest differs/],
]) test(`bus adoption rejects ${String(name)}`, async () =>
  usingFixture(async (f) => {
    await change(f);
    await assert.rejects(verifyBusAdoption(f.output, f.source), message);
  }, { copySource: true }));
