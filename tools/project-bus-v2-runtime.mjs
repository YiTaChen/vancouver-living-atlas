import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { composeRuntimeCandidate } from './assets/boardable-bus-v2/runtime-candidate/compose.mjs';

export const BUS_V2_SOURCE_REVISION =
  '28a23c86821a7502faa7425da6e430d625d97ac1';
export const BUS_V2_SOURCE_MANIFEST_SHA256 =
  '84c358c33e2a76dd2274bb41cb9443c3c4e0f3d923f59b0038595ae6d6a1a413';
export const BUS_V2_SOURCE_PATH =
  'tools/assets/boardable-bus-v2/runtime-candidate';
export const BUS_V2_PUBLIC_PREFIX = 'models/blender/bus-v2/';
export const BUS_V2_RUNTIME_CONTRACT = 'boardable-bus-runtime-v2';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const select = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object[key]]));

/** The deployed cabin uses exactly the reviewed budget candidate. Exterior URLs
 * resolve to the independently protected v1 adoption; no duplicate exterior,
 * original interior, component sidecar or Blender authoring file is deployed. */
export function projectBusV2RuntimeMetadata(composed) {
  assert.equal(composed.packageId, 'boardable-bus-v2-runtime-candidate');
  assert.equal(composed.schemaVersion, 1);
  assert.equal(composed.version, '1.0.0');
  assert.equal(composed.units, 'm');
  const assets = composed.assets.map((asset) => ({
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
          'bytes',
          'triangles',
          'primitives',
          'boundsM',
          'capabilities',
        ]),
      ),
      file: path.basename(lod.file),
      url: `/models/blender/${asset.id === 'city-bus-12m-exterior' ? 'bus' : 'bus-v2'}/${path.basename(lod.file)}`,
    })),
  }));
  const vehicles = clone(composed.vehicles);
  for (const vehicle of vehicles)
    for (const field of ['exteriorFiles', 'interiorFiles', 'collisionFiles'])
      vehicle.composition[field] = vehicle.composition[field].map((file) =>
        path.basename(file),
      );
  return {
    schemaVersion: 1,
    contract: BUS_V2_RUNTIME_CONTRACT,
    packageId: composed.packageId,
    version: composed.version,
    units: composed.units,
    coordinateSystem: { runtime: clone(composed.coordinateSystem.runtime) },
    provenance: clone(
      select(composed.provenance, [
        'authoring',
        'project',
        'source',
        'license',
      ]),
    ),
    source: {
      packagePath: BUS_V2_SOURCE_PATH,
      manifestPath: `${BUS_V2_SOURCE_PATH}/manifest.json`,
      manifestSha256: BUS_V2_SOURCE_MANIFEST_SHA256,
      assetRevision: BUS_V2_SOURCE_REVISION,
    },
    assets,
    vehicles,
  };
}

export const busV2MetadataBytes = (metadata) =>
  Buffer.from(JSON.stringify(metadata, null, 2) + '\n');

export function busV2AdoptionEntries(manifest, metadataBytes) {
  const common = {
    sourcePackage: 'boardable-bus-v2-runtime-candidate',
    sourceRevision: BUS_V2_SOURCE_REVISION,
    sourceManifestSha256: BUS_V2_SOURCE_MANIFEST_SHA256,
  };
  return [
    ...manifest.assets[0].lods.map((lod) => ({
      path: `bus-v2/${path.basename(lod.file)}`,
      sha256: lod.sha256,
      bytes: lod.bytes,
      ...common,
      sourcePath: `${BUS_V2_SOURCE_PATH}/${lod.file}`,
    })),
    {
      path: 'bus-v2/manifest.json',
      sha256: hash(metadataBytes),
      bytes: metadataBytes.length,
      ...common,
      sourcePath: `canonical projection of ${BUS_V2_SOURCE_PATH}/manifest.json`,
    },
  ];
}

/** Check source payloads before building the canonical projection. Its external
 * dependency and sidecar bindings are additionally checked by the composer. */
export async function loadBusV2Projection() {
  const bytes = await readFile(`${BUS_V2_SOURCE_PATH}/manifest.json`);
  assert.equal(
    hash(bytes),
    BUS_V2_SOURCE_MANIFEST_SHA256,
    'Bus v2 source manifest differs from the reviewed revision',
  );
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].id, 'city-bus-12m-interior-v2-runtime');
  assert.deepEqual(
    manifest.assets[0].lods.map((lod) => lod.level),
    [0, 1],
  );
  for (const lod of manifest.assets[0].lods) {
    assert.equal(
      lod.file,
      `exports/city-bus-12m-interior-v2-runtime.lod${lod.level}.glb`,
    );
    const exported = await readFile(`${BUS_V2_SOURCE_PATH}/${lod.file}`),
      source = await readFile(`${BUS_V2_SOURCE_PATH}/${lod.source}`);
    assert.equal(hash(exported), lod.sha256, 'Bus v2 export changed');
    assert.equal(exported.length, lod.bytes, 'Bus v2 export size changed');
    assert.equal(
      hash(source),
      lod.sourceSha256,
      'Bus v2 editable source changed',
    );
    assert.equal(
      source.length,
      lod.sourceBytes,
      'Bus v2 editable source size changed',
    );
    assert(
      lod.bytes <= [1_572_864, 393_216][lod.level],
      'Bus v2 byte budget exceeded',
    );
    assert(
      lod.triangles <= [12_000, 3_000][lod.level],
      'Bus v2 triangle budget exceeded',
    );
    assert.equal(lod.primitives, 11);
  }
  const metadata = projectBusV2RuntimeMetadata(composeRuntimeCandidate()),
    metadataBytes = busV2MetadataBytes(metadata),
    entries = busV2AdoptionEntries(manifest, metadataBytes);
  return { manifest, metadata, metadataBytes, entries };
}

export async function writeBusV2Projection(output = path.resolve('public')) {
  const projection = await loadBusV2Projection(),
    directory = path.join(output, BUS_V2_PUBLIC_PREFIX);
  await mkdir(directory, { recursive: true });
  for (const lod of projection.manifest.assets[0].lods)
    await copyFile(
      `${BUS_V2_SOURCE_PATH}/${lod.file}`,
      path.join(directory, path.basename(lod.file)),
    );
  await writeFile(
    path.join(directory, 'manifest.json'),
    projection.metadataBytes,
  );
  return projection;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const projection = await writeBusV2Projection(
    process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  );
  process.stdout.write(
    `Projected ${projection.entries.length} reviewed bus v2 runtime files.\n`,
  );
}
