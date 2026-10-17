import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const STREET_FURNITURE_SOURCE_REVISION =
  '6d9e05c0e0eafca6e1a2405f32da4570fdb37efd';
export const STREET_FURNITURE_SOURCE_MANIFEST_SHA256 =
  'a047b465f83a6d2604485895a1dfb66ec4d50c192838afed0d92fc2c82cdcacb';
export const STREET_FURNITURE_CONTRACT = 'street-furniture-runtime-v1';
export const STREET_FURNITURE_PUBLIC_PREFIX =
  'models/blender/street-furniture/';
export const STREET_FURNITURE_IDS = [
  'cedar-bench',
  'garbage-bin',
  'bicycle-rack',
];
export const STREET_FURNITURE_SOURCE_PATH =
  'tools/assets/street-furniture-expansion';
const sourcePackage = 'street-furniture-expansion';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const select = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object[key]]));
const names = STREET_FURNITURE_IDS.flatMap((id) =>
  [0, 1].map((level) => `${id}.lod${level}.glb`),
);
export const streetFurnitureMetadataBytes = (metadata) =>
  Buffer.from(JSON.stringify(metadata, null, 2) + '\n');

/** Only the reviewed three types and two LODs become runtime metadata. This
 * projection does not claim surveyed placement, GPU acceptance or navigability. */
export function projectStreetFurnitureMetadata(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packageId, sourcePackage);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.units, 'metres');
  assert.equal(manifest.coordinateSystem.gltfUp, '+Y');
  assert.equal(manifest.coordinateSystem.frontAxis, '+Z');
  const assets = STREET_FURNITURE_IDS.map((id) => {
    const asset = manifest.assets.find((candidate) => candidate.id === id);
    assert(asset, `Missing street furniture source: ${id}`);
    assert.deepEqual(
      asset.lods.map((lod) => lod.level),
      [0, 1],
    );
    assert.equal(asset.frontAxis, '+Z');
    assert.deepEqual(asset.attachmentDatum.scale, [1, 1, 1]);
    assert.equal(asset.attachmentDatum.planeY, 0);
    return {
      ...clone(
        select(asset, [
          'id',
          'kind',
          'boundsM',
          'pivot',
          'attachmentDatum',
          'frontAxis',
        ]),
      ),
      materialBindings: asset.materialBindings.map((binding) =>
        clone(
          select(binding, [
            'material',
            'node',
            'role',
            'surfaceId',
            'uvUnits',
            'alphaMode',
            'doubleSided',
            'pointLight',
          ]),
        ),
      ),
      lodPolicy: clone(
        select(asset.lodPolicy, ['levels', 'suggestedDistanceM', 'keepScale']),
      ),
      lods: asset.lods.map((lod) => {
        const file = `${id}.lod${lod.level}.glb`;
        assert.equal(lod.file, `exports/${file}`);
        return {
          ...clone(
            select(lod, [
              'level',
              'sha256',
              'sourceSha256',
              'bytes',
              'triangles',
              'primitives',
              'boundsM',
            ]),
          ),
          file,
          url: `/${STREET_FURNITURE_PUBLIC_PREFIX}${file}`,
        };
      }),
    };
  });
  return {
    schemaVersion: 1,
    contract: STREET_FURNITURE_CONTRACT,
    packageId: sourcePackage,
    version: manifest.version,
    units: manifest.units,
    coordinateSystem: { upAxis: '+Y', frontAxis: '+Z' },
    provenance: clone(
      select(manifest.provenance, ['credit', 'source', 'license']),
    ),
    source: {
      packagePath: STREET_FURNITURE_SOURCE_PATH,
      manifestPath: `${STREET_FURNITURE_SOURCE_PATH}/manifest.json`,
      manifestSha256: STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
      assetRevision: STREET_FURNITURE_SOURCE_REVISION,
    },
    assets,
  };
}

export function streetFurnitureAdoptionEntries(manifest, metadataBytes) {
  return [
    ...projectStreetFurnitureMetadata(manifest).assets.flatMap((asset) =>
      asset.lods.map((lod) => ({
        path: `street-furniture/${lod.file}`,
        sha256: lod.sha256,
        bytes: lod.bytes,
        sourcePackage,
        sourcePath: `${STREET_FURNITURE_SOURCE_PATH}/exports/${lod.file}`,
        sourceRevision: STREET_FURNITURE_SOURCE_REVISION,
        sourceManifestSha256: STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
      })),
    ),
    {
      path: 'street-furniture/manifest.json',
      sha256: hash(metadataBytes),
      bytes: metadataBytes.length,
      sourcePackage,
      sourcePath: `canonical projection of ${STREET_FURNITURE_SOURCE_PATH}/manifest.json`,
      sourceRevision: STREET_FURNITURE_SOURCE_REVISION,
      sourceManifestSha256: STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
    },
  ];
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    assert(
      !entry.isSymbolicLink(),
      `Symlinks cannot bypass furniture isolation: ${file}`,
    );
    if (entry.isDirectory()) result.push(...(await files(file)));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

/** Pin the artist metadata before trusting any export/source paths or digests. */
export async function readStreetFurnitureSource(
  source = path.resolve(STREET_FURNITURE_SOURCE_PATH),
) {
  // Reject source symlinks as well as emitted symlinks before reading assets.
  await files(source);
  const original = await readFile(path.join(source, 'manifest.json'));
  assert.equal(
    hash(original),
    STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
    'Street furniture source manifest differs from reviewed revision',
  );
  const manifest = JSON.parse(original);
  const metadata = projectStreetFurnitureMetadata(manifest);
  for (const asset of metadata.assets) {
    const artist = manifest.assets.find(
      (candidate) => candidate.id === asset.id,
    );
    for (const lod of artist.lods) {
      const exported = await readFile(path.join(source, lod.file));
      assert.equal(
        hash(exported),
        lod.sha256,
        'Street furniture export changed from source manifest',
      );
      assert.equal(
        exported.length,
        lod.bytes,
        'Street furniture export size changed from source manifest',
      );
      const authoring = await readFile(path.join(source, lod.source));
      assert.equal(
        hash(authoring),
        lod.sourceSha256,
        'Street furniture authoring source changed',
      );
    }
  }
  return {
    manifest,
    metadata,
    metadataBytes: streetFurnitureMetadataBytes(metadata),
  };
}

/** Mandatory exact-file gate, including renamed source bytes outside the public
 * prefix. Six unmodified GLBs and the canonical projection are the only adoption. */
export async function verifyStreetFurnitureAdoption(
  output = path.resolve('dist/client'),
  source = path.resolve(STREET_FURNITURE_SOURCE_PATH),
) {
  const { manifest, metadata, metadataBytes } =
    await readStreetFurnitureSource(source);
  const deployedMetadata = await readFile(
    path.join(output, STREET_FURNITURE_PUBLIC_PREFIX, 'manifest.json'),
  );
  assert(
    deployedMetadata.equals(metadataBytes),
    'Street furniture metadata must equal canonical source projection',
  );
  const inventory = JSON.parse(
    await readFile(
      path.join(output, 'models/blender/adopted-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(
    inventory.version,
    1,
    'Unsupported furniture adoption inventory version',
  );
  assert(
    Array.isArray(inventory.files),
    'Furniture adoption requires exact inventory',
  );
  const expected = streetFurnitureAdoptionEntries(manifest, metadataBytes);
  assert.deepEqual(
    inventory.files.filter((entry) =>
      entry.path?.startsWith('street-furniture/'),
    ),
    expected,
    'Exact street furniture adoption paths, hashes, bytes and provenance required',
  );
  const approved = new Map();
  for (const entry of expected) {
    const name = `models/blender/${entry.path}`;
    const bytes = await readFile(path.join(output, name));
    assert.equal(
      bytes.length,
      entry.bytes,
      `Street furniture deployed payload size changed: ${name}`,
    );
    assert.equal(
      hash(bytes),
      entry.sha256,
      `Street furniture deployed payload changed: ${name}`,
    );
    approved.set(name, entry.sha256);
  }
  const protectedHashes = new Map();
  for (const file of await files(source))
    protectedHashes.set(
      hash(await readFile(file)),
      path.relative(source, file),
    );
  for (const file of await files(output)) {
    const name = path.relative(output, file).replaceAll('\\', '/');
    const bytes = await readFile(file);
    assert(
      !/\.blend(?:\d+)?$/i.test(name),
      'Furniture authoring files must not ship',
    );
    if (name.startsWith(STREET_FURNITURE_PUBLIC_PREFIX))
      assert(approved.has(name), `Unlisted street furniture payload: ${name}`);
    const digest = hash(bytes);
    const hit = protectedHashes.get(digest);
    if (hit)
      assert.equal(
        approved.get(name),
        digest,
        `Unapproved furniture source/duplicate payload: ${hit} -> ${name}`,
      );
    if (/\.(?:js|mjs|json|html|css|map)$/i.test(name))
      assert(
        !bytes
          .toString('utf8')
          .includes('/__offline-assets/street-furniture-expansion'),
        'Research-only street furniture loader must not ship',
      );
  }
  const geometry = metadata.assets.flatMap((asset) => asset.lods);
  assert.deepEqual(
    geometry.map((lod) => lod.file),
    names,
  );
  return {
    status: 'pass',
    adoptedFiles: approved.size,
    geometryBytes: geometry.reduce((sum, lod) => sum + lod.bytes, 0),
    metadataBytes: metadataBytes.length,
    sourceManifestSha256: STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
    protectedSourceHashes: protectedHashes.size,
    browserAcceptance:
      'separate city WebGL placement and performance checks required',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await verifyStreetFurnitureAdoption(), null, 2));
