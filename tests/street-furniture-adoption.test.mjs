import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  projectStreetFurnitureMetadata,
  streetFurnitureAdoptionEntries,
  streetFurnitureMetadataBytes,
  verifyStreetFurnitureAdoption,
  STREET_FURNITURE_IDS,
  STREET_FURNITURE_PUBLIC_PREFIX,
  STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
  STREET_FURNITURE_SOURCE_PATH,
  STREET_FURNITURE_SOURCE_REVISION,
} from '../tools/verify-street-furniture-adoption.mjs';
import { adoptStreetFurniture } from '../tools/assets/adopt-street-furniture.mjs';

const source = path.resolve(STREET_FURNITURE_SOURCE_PATH);
const originalBytes = await readFile(path.join(source, 'manifest.json'));
const originalManifest = JSON.parse(originalBytes);
const metadata = projectStreetFurnitureMetadata(originalManifest);
const sourceLods = originalManifest.assets
  .filter((asset) => STREET_FURNITURE_IDS.includes(asset.id))
  .flatMap((asset) => asset.lods);
const publicNames = [
  ...metadata.assets.flatMap((asset) => asset.lods.map((lod) => lod.file)),
  'manifest.json',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function usingFixture(run, { copySource = false } = {}) {
  const base = await mkdtemp(
    path.join(os.tmpdir(), 'street-furniture-adoption-'),
  );
  const output = path.join(base, 'dist');
  const sourcePath = copySource ? path.join(base, 'source') : source;
  const put = async (root, name, bytes) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  try {
    for (const name of publicNames)
      await put(
        output,
        STREET_FURNITURE_PUBLIC_PREFIX + name,
        await readFile(
          path.join('public', STREET_FURNITURE_PUBLIC_PREFIX, name),
        ),
      );
    const inventory = JSON.parse(
      await readFile('public/models/blender/adopted-manifest.json', 'utf8'),
    );
    const saveInventory = () =>
      put(
        output,
        'models/blender/adopted-manifest.json',
        JSON.stringify(inventory, null, 2) + '\n',
      );
    await saveInventory();
    if (copySource) {
      await put(sourcePath, 'manifest.json', originalBytes);
      for (const lod of sourceLods)
        for (const file of [lod.file, lod.source]) {
          await mkdir(path.dirname(path.join(sourcePath, file)), {
            recursive: true,
          });
          await copyFile(path.join(source, file), path.join(sourcePath, file));
        }
    }
    await run({
      base,
      output,
      source: sourcePath,
      inventory,
      put,
      saveInventory,
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test('only three source types and six unchanged LODs are promoted with exact byte costs', async () => {
  assert.equal(hash(originalBytes), STREET_FURNITURE_SOURCE_MANIFEST_SHA256);
  assert.deepEqual(
    metadata.assets.map((asset) => asset.id),
    STREET_FURNITURE_IDS,
  );
  const result = await verifyStreetFurnitureAdoption(path.resolve('public'));
  assert.equal(result.status, 'pass');
  assert.equal(result.adoptedFiles, 7);
  assert.equal(result.geometryBytes, 202880);
  assert.equal(result.metadataBytes, 10747);
  assert.match(result.browserAcceptance, /separate city WebGL/);
  const inventory = JSON.parse(
    await readFile('public/models/blender/adopted-manifest.json', 'utf8'),
  );
  const adopted = inventory.files.filter((entry) =>
    entry.path.startsWith('street-furniture/'),
  );
  assert.equal(adopted.length, 7);
  assert(
    adopted.every(
      (entry) => entry.sourceRevision === STREET_FURNITURE_SOURCE_REVISION,
    ),
  );
  assert(
    adopted.every(
      (entry) =>
        entry.sourceManifestSha256 === STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
    ),
  );
});

test('canonical metadata retains metre datum, source bounds, role identity and LOD data without authoring/QA payload', () => {
  const before = JSON.stringify(originalManifest);
  const projected = projectStreetFurnitureMetadata(originalManifest);
  assert.equal(JSON.stringify(originalManifest), before);
  assert.equal(projected.contract, 'street-furniture-runtime-v1');
  assert.equal(projected.units, 'metres');
  assert.deepEqual(projected.coordinateSystem, {
    upAxis: '+Y',
    frontAxis: '+Z',
  });
  assert.equal(
    projected.source.manifestSha256,
    STREET_FURNITURE_SOURCE_MANIFEST_SHA256,
  );
  for (const asset of projected.assets) {
    const artist = originalManifest.assets.find(
      (candidate) => candidate.id === asset.id,
    );
    for (const key of ['boundsM', 'pivot', 'attachmentDatum', 'frontAxis'])
      assert.deepEqual(asset[key], artist[key]);
    assert.deepEqual(
      asset.materialBindings.map((binding) => binding.role),
      asset.id === 'cedar-bench' ? ['metal', 'wood'] : ['metal'],
    );
    for (const binding of asset.materialBindings) {
      assert.equal(binding.material, binding.role);
      assert.equal(binding.node, binding.role);
      assert.equal(binding.pointLight, false);
      assert.equal(binding.alphaMode, 'OPAQUE');
      assert.equal(
        binding.surfaceId,
        binding.role === 'wood' ? 'cedar' : 'painted-metal',
      );
    }
    assert.deepEqual(
      asset.lods.map((lod) => lod.level),
      [0, 1],
    );
    for (const lod of asset.lods) {
      const original = artist.lods.find(
        (candidate) => candidate.level === lod.level,
      );
      for (const key of [
        'sha256',
        'sourceSha256',
        'triangles',
        'primitives',
        'bytes',
        'boundsM',
      ])
        assert.deepEqual(lod[key], original[key]);
      assert.equal(lod.file, `${asset.id}.lod${lod.level}.glb`);
      assert.equal(lod.url, `/${STREET_FURNITURE_PUBLIC_PREFIX}${lod.file}`);
    }
  }
  assert(!JSON.stringify(projected).includes('qa/'));
  assert(!JSON.stringify(projected).includes('.blend'));
});

test('promotion is deterministic, keeps unrelated adoption entries and does not rewrite source bytes', async () =>
  usingFixture(
    async (f) => {
      const unrelated = f.inventory.files.filter(
        (entry) => !entry.path.startsWith('street-furniture/'),
      );
      const originalSources = await Promise.all(
        sourceLods.map((lod) => readFile(path.join(f.source, lod.source))),
      );
      await rm(path.join(f.output, STREET_FURNITURE_PUBLIC_PREFIX), {
        recursive: true,
      });
      f.inventory.files = unrelated;
      await f.saveInventory();
      const first = await adoptStreetFurniture(f.output, f.source);
      const once = await readFile(
        path.join(f.output, 'models/blender/adopted-manifest.json'),
      );
      await adoptStreetFurniture(f.output, f.source);
      assert.equal(first.adoptedFiles, 7);
      assert(
        (
          await readFile(
            path.join(f.output, 'models/blender/adopted-manifest.json'),
          )
        ).equals(once),
      );
      assert.deepEqual(
        JSON.parse(once).files.filter(
          (entry) => !entry.path.startsWith('street-furniture/'),
        ),
        unrelated,
      );
      for (let i = 0; i < sourceLods.length; i++)
        assert(
          (await readFile(path.join(f.source, sourceLods[i].source))).equals(
            originalSources[i],
          ),
        );
      assert(
        (await readFile(path.join(f.source, 'manifest.json'))).equals(
          originalBytes,
        ),
      );
    },
    { copySource: true },
  ));

for (const [name, change, expected] of [
  [
    'unlisted type',
    (f) =>
      f.put(
        f.output,
        STREET_FURNITURE_PUBLIC_PREFIX + 'fire-hydrant.lod0.glb',
        'unapproved',
      ),
    /Unlisted street furniture payload/,
  ],
  [
    'nested source file',
    (f) =>
      f.put(
        f.output,
        STREET_FURNITURE_PUBLIC_PREFIX + 'source/hidden.bin',
        'unapproved',
      ),
    /Unlisted street furniture payload/,
  ],
  [
    'missing LOD',
    (f) =>
      rm(path.join(f.output, STREET_FURNITURE_PUBLIC_PREFIX, publicNames[0])),
    /ENOENT/,
  ],
  [
    'deployed GLB changed',
    (f) =>
      f.put(
        f.output,
        STREET_FURNITURE_PUBLIC_PREFIX + publicNames[0],
        'changed',
      ),
    /Street furniture deployed payload/,
  ],
  [
    'missing inventory item',
    async (f) => {
      f.inventory.files = f.inventory.files.filter(
        (entry) => entry.path !== `street-furniture/${publicNames[0]}`,
      );
      await f.saveInventory();
    },
    /Exact street furniture adoption/,
  ],
  [
    'duplicate inventory item',
    async (f) => {
      f.inventory.files.push({
        ...f.inventory.files.find((entry) =>
          entry.path.startsWith('street-furniture/'),
        ),
      });
      await f.saveInventory();
    },
    /Exact street furniture adoption/,
  ],
  [
    'forged inventory hash',
    async (f) => {
      f.inventory.files.find((entry) =>
        entry.path.startsWith('street-furniture/'),
      ).sha256 = '0'.repeat(64);
      await f.saveInventory();
    },
    /Exact street furniture adoption/,
  ],
  [
    'forged source identity',
    async (f) => {
      f.inventory.files.find((entry) =>
        entry.path.startsWith('street-furniture/'),
      ).sourceRevision = '0'.repeat(40);
      await f.saveInventory();
    },
    /Exact street furniture adoption/,
  ],
  [
    'path traversal',
    async (f) => {
      f.inventory.files.find((entry) =>
        entry.path.startsWith('street-furniture/'),
      ).path = `street-furniture/../street-furniture/${publicNames[0]}`;
      await f.saveInventory();
    },
    /Exact street furniture adoption/,
  ],
  [
    'renamed source GLB',
    async (f) =>
      f.put(
        f.output,
        'assets/hidden.bin',
        await readFile(path.join(source, sourceLods[0].file)),
      ),
    /Unapproved furniture source\/duplicate/,
  ],
  [
    'unselected source GLB renamed outside adopted prefix',
    async (f) =>
      f.put(
        f.output,
        'assets/unselected.bin',
        await readFile(path.join(source, 'exports/fire-hydrant.lod0.glb')),
      ),
    /Unapproved furniture source\/duplicate/,
  ],
  [
    'renamed authoring source',
    async (f) =>
      f.put(
        f.output,
        'assets/hidden.bin',
        await readFile(path.join(source, sourceLods[0].source)),
      ),
    /Unapproved furniture source\/duplicate/,
  ],
  [
    'renamed artist manifest',
    (f) => f.put(f.output, 'assets/manifest.bin', originalBytes),
    /Unapproved furniture source\/duplicate/,
  ],
  [
    'research-only loader',
    (f) =>
      f.put(
        f.output,
        'assets/research.js',
        'fetch("/__offline-assets/street-furniture-expansion/manifest.json")',
      ),
    /Research-only street furniture loader/,
  ],
  [
    'output symlink',
    (f) =>
      symlink(
        path.join(source, sourceLods[0].file),
        path.join(f.output, 'linked.bin'),
      ),
    /Symlinks cannot bypass furniture isolation/,
  ],
])
  test(`furniture adoption rejects ${String(name)}`, async () =>
    usingFixture(async (f) => {
      await change(f);
      await assert.rejects(
        verifyStreetFurnitureAdoption(f.output, f.source),
        expected,
      );
    }));

for (const [name, mutate] of [
  [
    'ground datum',
    (value) => {
      value.assets[0].attachmentDatum.planeY = 1;
    },
  ],
  [
    'material role',
    (value) => {
      value.assets[0].materialBindings[0].role = 'glass';
    },
  ],
  [
    'LOD cost',
    (value) => {
      value.assets[0].lods[0].triangles = 0;
    },
  ],
  [
    'external URL',
    (value) => {
      value.assets[0].lods[0].url = '/other.glb';
    },
  ],
  [
    'source identity',
    (value) => {
      value.source.manifestSha256 = '0'.repeat(64);
    },
  ],
  [
    'extra type',
    (value) => {
      value.assets.push({ ...value.assets[0], id: 'fire-hydrant' });
    },
  ],
  [
    'authoring details',
    (value) => {
      value.assets[0].source = 'artist.blend';
    },
  ],
])
  test(`canonical furniture projection rejects ${String(name)} even with recomputed inventory digest`, async () =>
    usingFixture(async (f) => {
      const value = structuredClone(metadata);
      mutate(value);
      const changed = streetFurnitureMetadataBytes(value);
      await f.put(
        f.output,
        STREET_FURNITURE_PUBLIC_PREFIX + 'manifest.json',
        changed,
      );
      const entry = f.inventory.files.find(
        (item) => item.path === 'street-furniture/manifest.json',
      );
      entry.sha256 = hash(changed);
      entry.bytes = changed.length;
      await f.saveInventory();
      await assert.rejects(
        verifyStreetFurnitureAdoption(f.output, f.source),
        /canonical source projection/,
      );
    }));

for (const [name, mutate, expected] of [
  [
    'source and deployment changed together',
    async (f) => {
      const changed = Buffer.from('modified source and delivery');
      await f.put(f.source, sourceLods[0].file, changed);
      await f.put(
        f.output,
        STREET_FURNITURE_PUBLIC_PREFIX + publicNames[0],
        changed,
      );
      const entry = f.inventory.files.find(
        (item) => item.path === `street-furniture/${publicNames[0]}`,
      );
      entry.sha256 = hash(changed);
      entry.bytes = changed.length;
      await f.saveInventory();
    },
    /Street furniture export changed from source manifest/,
  ],
  [
    'authoring source changed',
    (f) => f.put(f.source, sourceLods[0].source, 'edited artist file'),
    /Street furniture authoring source changed/,
  ],
  [
    'artist manifest changed',
    (f) =>
      f.put(
        f.source,
        'manifest.json',
        JSON.stringify({ ...originalManifest, version: '2' }),
      ),
    /Street furniture source manifest differs/,
  ],
  [
    'source symlink',
    (f) =>
      symlink(
        path.join(source, sourceLods[0].file),
        path.join(f.source, 'linked.bin'),
      ),
    /Symlinks cannot bypass furniture isolation/,
  ],
])
  test(`pinned furniture source rejects ${String(name)}`, async () =>
    usingFixture(
      async (f) => {
        await mutate(f);
        await assert.rejects(
          verifyStreetFurnitureAdoption(f.output, f.source),
          expected,
        );
      },
      { copySource: true },
    ));

test('inventory projection includes exactly six GLBs and one canonical metadata entry', () => {
  const bytes = streetFurnitureMetadataBytes(metadata);
  const entries = streetFurnitureAdoptionEntries(originalManifest, bytes);
  assert.equal(entries.length, 7);
  assert.equal(
    entries.filter((entry) => entry.path.endsWith('.glb')).length,
    6,
  );
  assert.equal(entries.at(-1).sha256, hash(bytes));
  assert.equal(entries.at(-1).bytes, bytes.length);
});
