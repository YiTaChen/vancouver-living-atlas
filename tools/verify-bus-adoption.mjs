import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUS_SOURCE_REVISION =
  'c9d184a4a176aefecf2aaf2b8341ba4f406f4ee9';
export const BUS_SOURCE_MANIFEST_SHA256 =
  '32a35e7fdaa0f82600f8d161212b952177fae8515ca8095b2d55be118503076e';
export const BUS_RUNTIME_CONTRACT = 'boardable-bus-runtime-v1';
export const BUS_PUBLIC_PREFIX = 'models/blender/bus/';
export const BUS_RUNTIME_METADATA = 'manifest.json';
const sourcePackage = 'boardable-bus';
const sourcePath = `tools/assets/${sourcePackage}`;
const expectedExports = [
  'city-bus-12m-exterior.lod0.glb',
  'city-bus-12m-exterior.lod1.glb',
  'city-bus-12m-exterior.lod2.glb',
  'city-bus-12m-interior.lod0.glb',
  'city-bus-12m-interior.lod1.glb',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const select = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object[key]]));
const clone = (value) => JSON.parse(JSON.stringify(value));
export const busMetadataBytes = (metadata) =>
  Buffer.from(JSON.stringify(metadata, null, 2) + '\n');

/** A deterministic projection of the pinned artist manifest. Keep the complete
 * vehicle safety contract; omit geometry batching ranges, authoring commands and
 * QA reports. File references resolve only within the adopted public directory.
 * This metadata alone does not implement geographic stops or safe boarding. */
export function projectBusRuntimeMetadata(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageId, sourcePackage);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.units, 'm');
  const assets = manifest.assets.map((asset) => ({
    ...clone(
      select(asset, [
        'id',
        'kind',
        'boundsM',
        'pivot',
        'attachmentDatum',
        'frontAxis',
        'materialBindings',
        'lodPolicy',
      ]),
    ),
    lods: asset.lods.map((lod) => ({
      ...clone(
        select(lod, [
          'level',
          'sha256',
          'sourceSha256',
          'bytes',
          'triangles',
          'primitives',
          'boundsM',
          'capabilities',
        ]),
      ),
      file: path.basename(lod.file),
      url: `/${BUS_PUBLIC_PREFIX}${path.basename(lod.file)}`,
    })),
  }));
  const vehicles = clone(manifest.vehicles);
  for (const vehicle of vehicles) {
    for (const field of ['exteriorFiles', 'interiorFiles', 'collisionFiles'])
      vehicle.composition[field] = vehicle.composition[field].map((file) =>
        path.basename(file),
      );
  }
  return {
    schemaVersion: 1,
    contract: BUS_RUNTIME_CONTRACT,
    packageId: sourcePackage,
    version: manifest.version,
    units: manifest.units,
    coordinateSystem: { runtime: manifest.coordinateSystem.runtime },
    provenance: clone(
      select(manifest.provenance, ['authoring', 'project', 'source', 'license']),
    ),
    source: {
      packagePath: sourcePath,
      manifestPath: `${sourcePath}/manifest.json`,
      manifestSha256: BUS_SOURCE_MANIFEST_SHA256,
      assetRevision: BUS_SOURCE_REVISION,
    },
    assets,
    vehicles,
  };
}

export function busAdoptionEntries(manifest, metadataBytes) {
  const exports = manifest.assets.flatMap((asset) => asset.lods);
  return [
    ...exports.map((lod) => ({
      path: `bus/${path.basename(lod.file)}`,
      sha256: lod.sha256,
      bytes: lod.bytes,
      sourcePackage,
      sourcePath: `${sourcePath}/${lod.file}`,
      sourceRevision: BUS_SOURCE_REVISION,
      sourceManifestSha256: BUS_SOURCE_MANIFEST_SHA256,
    })),
    {
      path: `bus/${BUS_RUNTIME_METADATA}`,
      sha256: hash(metadataBytes),
      bytes: metadataBytes.length,
      sourcePackage,
      sourcePath: `canonical projection of ${sourcePath}/manifest.json`,
      sourceRevision: BUS_SOURCE_REVISION,
      sourceManifestSha256: BUS_SOURCE_MANIFEST_SHA256,
    },
  ];
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Symlinks cannot bypass bus isolation: ${file}`);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

/** Mandatory production gate: exactly five unmodified exports and the canonical
 * metadata projection. The artist package remains protected even if copied with
 * a different extension outside the adopted directory. */
export async function verifyBusAdoption(
  output = path.resolve('dist/client'),
  source = path.resolve(sourcePath),
) {
  const originalManifest = await readFile(path.join(source, 'manifest.json'));
  assert.equal(
    hash(originalManifest),
    BUS_SOURCE_MANIFEST_SHA256,
    'Bus source manifest differs from the reviewed revision',
  );
  const manifest = JSON.parse(originalManifest);
  const exports = manifest.assets.flatMap((asset) => asset.lods);
  assert.deepEqual(
    exports.map((lod) => lod.file),
    expectedExports.map((name) => `exports/${name}`),
    'Exact five source bus exports required',
  );
  for (const lod of exports) {
    const original = await readFile(path.join(source, lod.file));
    assert.equal(hash(original), lod.sha256, 'Bus export changed from source manifest');
    assert.equal(original.length, lod.bytes, 'Bus export size changed from source manifest');
    const authoring = await readFile(path.join(source, lod.source));
    assert.equal(hash(authoring), lod.sourceSha256, 'Bus authoring source changed');
    assert.equal(authoring.length, lod.sourceBytes, 'Bus authoring source size changed');
  }
  const metadata = projectBusRuntimeMetadata(manifest),
    metadataBytes = busMetadataBytes(metadata);
  const deployedMetadata = await readFile(
    path.join(output, BUS_PUBLIC_PREFIX, BUS_RUNTIME_METADATA),
  );
  assert(
    deployedMetadata.equals(metadataBytes),
    'Bus runtime metadata must equal the canonical source projection',
  );
  const inventory = JSON.parse(
    await readFile(path.join(output, 'models/blender/adopted-manifest.json'), 'utf8'),
  );
  assert.equal(inventory.version, 1, 'Unsupported bus adoption inventory version');
  assert(Array.isArray(inventory.files), 'Bus adoption requires exact inventory');
  const expectedEntries = busAdoptionEntries(manifest, metadataBytes);
  assert.deepEqual(
    inventory.files.filter((entry) => entry.path?.startsWith('bus/')),
    expectedEntries,
    'Exact bus adoption paths, hashes, sizes and provenance required',
  );
  const approved = new Map();
  for (const entry of expectedEntries) {
    const name = `models/blender/${entry.path}`;
    const bytes = await readFile(path.join(output, name));
    assert.equal(bytes.length, entry.bytes, `Bus deployed payload size changed: ${name}`);
    assert.equal(hash(bytes), entry.sha256, `Bus deployed payload changed: ${name}`);
    approved.set(name, entry.sha256);
  }
  const protectedHashes = new Map();
  for (const file of await files(source))
    protectedHashes.set(hash(await readFile(file)), path.relative(source, file));
  const emitted = await files(output);
  for (const file of emitted) {
    const name = path.relative(output, file).replaceAll('\\', '/'),
      bytes = await readFile(file);
    assert(!/\.blend(?:\d+)?$/i.test(name), 'Bus Blender authoring files must not ship');
    if (name.startsWith(BUS_PUBLIC_PREFIX))
      assert(approved.has(name), `Unlisted bus payload: ${name}`);
    const digest = hash(bytes),
      hit = protectedHashes.get(digest);
    if (hit)
      assert.equal(
        approved.get(name),
        digest,
        `Unapproved bus source/duplicate payload: ${hit} -> ${name}`,
      );
    if (/\.(?:js|mjs|json|html|css|map)$/i.test(name)) {
      const text = bytes.toString('utf8');
      assert(
        !text.includes('/__offline-assets/boardable-bus'),
        'Research-only bus loader must not ship',
      );
    }
  }
  return {
    status: 'pass',
    adoptedFiles: approved.size,
    geometryBytes: exports.reduce((sum, lod) => sum + lod.bytes, 0),
    metadataBytes: metadataBytes.length,
    protectedSourceHashes: protectedHashes.size,
    sourceManifestSha256: BUS_SOURCE_MANIFEST_SHA256,
    browserNetwork: 'separate WebGL acceptance required',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await verifyBusAdoption(), null, 2));
