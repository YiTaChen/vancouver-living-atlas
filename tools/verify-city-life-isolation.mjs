import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(
      !entry.isSymbolicLink(),
      `Symlinks cannot bypass asset isolation: ${path}`,
    );
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedNames = ['commuter', 'raincoat', 'runner', 'tote']
  .flatMap((name) => [0, 1].map((lod) => `pedestrian-${name}.lod${lod}.glb`))
  .sort();

/** Only eight exact source GLBs are adopted. No directory exemption for
 * editable sources, previews, GTFS, or the research-only transit scene. */
export async function verifyCityLifeIsolation(
  output = resolve(root, 'dist/client'),
  source = resolve(root, 'tools/assets/city-life-pedestrians'),
) {
  assert(
    (await stat(output)).isDirectory(),
    'Build production Firebase output first',
  );
  const prefix = 'models/city-life-pedestrians/';
  const inventoryPath = prefix + 'adopted-manifest.json';
  const manifest = JSON.parse(
    await readFile(resolve(output, inventoryPath), 'utf8'),
  );
  assert.equal(manifest.version, 1);
  assert.equal(manifest.contract, 'rigid-limb-v1');
  assert(
    Array.isArray(manifest.files),
    'Adoption inventory must list exact files',
  );
  assert.deepEqual(
    manifest.files.map((f) => f.path).sort(),
    expectedNames,
    'Exact eight-model adoption required',
  );
  const packageManifest = JSON.parse(
    await readFile(resolve(source, 'manifest.json'), 'utf8'),
  );
  assert.equal(
    packageManifest.packageId,
    'city-life-pedestrians',
    'Wrong source package',
  );
  const sourceExports = new Map();
  for (const asset of packageManifest.assets)
    for (const lod of asset.lods) {
      assert.equal(
        asset.animation.contract,
        'rigid-limb-v1',
        'Wrong source animation contract',
      );
      const name = lod.file.replace(/^exports\//, '');
      assert.equal(
        lod.file,
        `exports/${name}`,
        'Source export path must stay in exports',
      );
      assert(!sourceExports.has(name), 'Duplicate source export');
      sourceExports.set(name, lod);
    }
  assert.deepEqual(
    [...sourceExports.keys()].sort((a, b) => String(a).localeCompare(String(b))),
    expectedNames,
    'Exact source package exports required',
  );
  const approved = new Map();
  for (const item of manifest.files) {
    assert(
      /^[a-f0-9]{64}$/.test(item.sha256),
      'Adoption requires complete SHA-256',
    );
    assert.equal(
      item.source,
      `tools/assets/city-life-pedestrians/exports/${item.path}`,
    );
    const original = await readFile(resolve(source, 'exports', item.path));
    const declared = sourceExports.get(item.path);
    assert.equal(
      hash(original),
      declared.sha256,
      'Source export changed from package manifest',
    );
    assert.equal(
      original.length,
      declared.bytes,
      'Source export size changed from package manifest',
    );
    assert.equal(item.bytes, original.length);
    assert.equal(
      item.sha256,
      hash(original),
      'Adopted hash must match source export',
    );
    assert.equal(
      hash(await readFile(resolve(output, prefix, item.path))),
      item.sha256,
    );
    approved.set(prefix + item.path, item.sha256);
  }
  const protectedHashes = new Map();
  for (const file of await files(source)) {
    // Protect authoring code, metadata and previews too, including renamed files.
    protectedHashes.set(hash(await readFile(file)), relative(source, file));
  }
  const emitted = await files(output);
  for (const path of emitted) {
    const name = relative(output, path).replaceAll('\\', '/'),
      bytes = await readFile(path);
    assert(
      !/\.blend(?:\d+)?$/i.test(name),
      'Editable Blender sources must not ship',
    );
    if (name.startsWith(prefix))
      assert(
        name === inventoryPath || approved.has(name),
        `Unlisted city-life payload: ${name}`,
      );
    const digest = hash(bytes),
      hit = protectedHashes.get(digest);
    if (hit)
      assert.equal(
        approved.get(name),
        digest,
        `Unapproved duplicate/source payload: ${hit} -> ${name}`,
      );
    if (/\.(js|mjs|json|html|css|map)$/i.test(path)) {
      const text = bytes.toString('utf8');
      for (const token of [
        'city-life-sources/',
        'Representative research layout; not a geographic bus route',
        '公共運輸研究驗證場景',
        '/__offline-assets/boardable-bus',
      ])
        assert(
          !text.includes(token),
          `Source-only transit/QA reference leaked: ${token}`,
        );
    }
  }
  return {
    status: 'pass',
    adoptedFiles: approved.size,
    protectedSourceHashes: protectedHashes.size,
    emittedFiles: emitted.length,
    browserNetwork: 'separate WebGL acceptance required',
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await verifyCityLifeIsolation(), null, 2));
