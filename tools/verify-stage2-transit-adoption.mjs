import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadBusV2Projection } from './project-bus-v2-runtime.mjs';
import { loadMetroProjection } from './metro-projection.mjs';
import { loadBusCloseupProjection } from './project-bus-closeup-runtime.mjs';

const packages = [
  'boardable-bus-v2',
  'skytrain-mark-v-interior',
  'canada-line-stage2',
  'skytrain-stations-stage2',
  'city-life-interactive',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Stage 2 payloads cannot be symlinks');
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await files(name)));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

/** Exact reviewed runtime projections are the only Stage 2 exceptions. Detailed
 * masters, editable sources, preview PNGs, stations and unmounted characters
 * retain protection even if renamed or copied outside models/blender. */
export async function verifyStage2TransitAdoption(
  output = path.resolve('dist/client'),
) {
  const [bus, metro, closeup] = await Promise.all([
    loadBusV2Projection(),
    loadMetroProjection(),
    loadBusCloseupProjection(),
  ]);
  const expected = [...bus.entries, ...metro.entries, ...closeup.entries];
  const inventory = JSON.parse(
    await readFile(
      path.join(output, 'models/blender/adopted-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(inventory.version, 1);
  assert.deepEqual(
    inventory.files.filter((item) =>
      /^(bus-v2|metro|bus-closeup)\//.test(item.path),
    ),
    expected,
    'Exact Stage 2 runtime inventory and provenance required',
  );
  const approved = new Map();
  for (const entry of expected) {
    const name = 'models/blender/' + entry.path;
    const data = await readFile(path.join(output, name));
    assert.equal(
      data.length,
      entry.bytes,
      `Stage 2 payload size changed: ${name}`,
    );
    assert.equal(hash(data), entry.sha256, `Stage 2 payload changed: ${name}`);
    approved.set(name, entry.sha256);
  }
  assert(
    (
      await readFile(path.join(output, 'models/blender/bus-v2/manifest.json'))
    ).equals(bus.metadataBytes),
    'Bus v2 metadata differs from canonical projection',
  );
  assert(
    (
      await readFile(path.join(output, 'models/blender/metro/manifest.json'))
    ).equals(metro.metadataBytes),
    'Metro metadata differs from canonical projection',
  );
  assert(
    (
      await readFile(
        path.join(output, 'models/blender/bus-closeup/manifest.json'),
      )
    ).equals(closeup.metadataBytes),
    'Bus closeup metadata differs from canonical projection',
  );
  const protectedHashes = new Map();
  for (const name of packages)
    for (const file of await files(path.resolve('tools/assets', name)))
      if (/\.(?:glb|blend|png|jpg|json)$/i.test(file))
        protectedHashes.set(hash(await readFile(file)), file);
  for (const file of await files(output)) {
    const name = path.relative(output, file).replaceAll('\\', '/');
    assert(
      !/\.blend(?:\d+)?$/i.test(name),
      'Stage 2 editable sources must not ship',
    );
    if (/^models\/blender\/(bus-v2|metro|bus-closeup)\//.test(name))
      assert(approved.has(name), `Unlisted Stage 2 runtime payload: ${name}`);
    const data = await readFile(file),
      digest = hash(data);
    if (protectedHashes.has(digest))
      assert.equal(
        approved.get(name),
        digest,
        `Unapproved Stage 2 source/duplicate payload: ${name}`,
      );
    if (/\.(?:js|mjs|html|css|map)$/i.test(name))
      assert(
        !/InteractiveRendererCandidate|interactive-skin-v1|\/__offline-assets\//.test(
          data.toString('utf8'),
        ),
        'Unmounted Stage 2 consumer or research loader leaked',
      );
  }
  return {
    status: 'pass',
    adoptedFiles: expected.length,
    geometryBytes: expected
      .filter((item) => item.path.endsWith('.glb'))
      .reduce((n, item) => n + item.bytes, 0),
    protectedSourceHashes: protectedHashes.size,
    runtimeScope:
      'budget bus cabin and bounded fleet; closeup bus visit only; single SkyTrain cabin display',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await verifyStage2TransitAdoption(), null, 2));
