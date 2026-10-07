import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyCityLifeIsolation } from '../tools/verify-city-life-isolation.mjs';
import { verifyFirebaseBuild } from '../tools/verify-firebase-build.mjs';
const digest = (data) => createHash('sha256').update(data).digest('hex');
const prefix = 'models/city-life-pedestrians/';

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), 'city-life-isolation-'));
  const output = path.join(base, 'dist'),
    source = path.join(base, 'assets', 'city-life-pedestrians');
  const put = async (root, name, bytes) => {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };
  const manifest = { version: 1, contract: 'rigid-limb-v1', files: [] };
  const original = {
    schemaVersion: 1,
    packageId: 'city-life-pedestrians',
    assets: [],
  };
  for (const variant of ['commuter', 'raincoat', 'runner', 'tote']) {
    const asset = {
      id: `pedestrian-${variant}`,
      animation: { contract: 'rigid-limb-v1' },
      lods: [],
    };
    for (const lod of [0, 1]) {
      const name = `pedestrian-${variant}.lod${lod}.glb`,
        bytes = Buffer.from(`fixture exported ${name}`);
      const item = {
        path: name,
        source: `tools/assets/city-life-pedestrians/exports/${name}`,
        bytes: bytes.length,
        sha256: digest(bytes),
      };
      manifest.files.push(item);
      asset.lods.push({
        level: lod,
        file: `exports/${name}`,
        bytes: bytes.length,
        sha256: item.sha256,
      });
      await put(source, `exports/${name}`, bytes);
      await put(output, prefix + name, bytes);
    }
    original.assets.push(asset);
  }
  const save = () =>
    put(output, prefix + 'adopted-manifest.json', JSON.stringify(manifest));
  await put(source, 'manifest.json', JSON.stringify(original));
  await put(
    source,
    'source/pedestrian.blend',
    'fixture private editable source',
  );
  await save();
  return {
    base,
    source,
    output,
    manifest,
    original,
    save,
    put,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
async function usingFixture(run) {
  const f = await fixture();
  try {
    await run(f);
  } finally {
    await f.cleanup();
  }
}

test('exact eight-model path, source, size and hash inventory passes', async () =>
  usingFixture(async (f) => {
    const result = await verifyCityLifeIsolation(f.output, f.source);
    assert.equal(result.status, 'pass');
    assert.equal(result.adoptedFiles, 8);
    assert.equal(result.emittedFiles, 9);
  }));

for (const [name, change] of [
  [
    'changed adoption hash',
    async (f) => {
      f.manifest.files[0].sha256 = '0'.repeat(64);
      await f.save();
    },
  ],
  [
    'changed deployed bytes',
    async (f) => f.put(f.output, prefix + f.manifest.files[0].path, 'tampered'),
  ],
  [
    'wrong source path',
    async (f) => {
      f.manifest.files[0].source = 'tools/assets/other/exports/model.glb';
      await f.save();
    },
  ],
  [
    'missing model',
    async (f) => rm(path.join(f.output, prefix, f.manifest.files[0].path)),
  ],
  [
    'duplicate inventory entry',
    async (f) => {
      f.manifest.files[1] = { ...f.manifest.files[0] };
      await f.save();
    },
  ],
  [
    'path traversal in inventory',
    async (f) => {
      f.manifest.files[0].path = '../pedestrian-commuter.lod0.glb';
      await f.save();
    },
  ],
  [
    'extra payload inside adopted directory',
    async (f) => f.put(f.output, prefix + 'extra/metadata.json', '{}'),
  ],
  [
    'same source bytes copied elsewhere with a different extension',
    async (f) =>
      f.put(
        f.output,
        'assets/renamed-model.bin',
        await readFile(
          path.join(f.source, 'exports', f.manifest.files[0].path),
        ),
      ),
  ],
  [
    'Blender source at unrelated public path',
    async (f) =>
      f.put(f.output, 'assets/unrelated.BLEND2', 'different editable bytes'),
  ],
  [
    'Blender source renamed as binary',
    async (f) =>
      f.put(
        f.output,
        'assets/hidden.bin',
        await readFile(path.join(f.source, 'source/pedestrian.blend')),
      ),
  ],
  [
    'symlink in public output',
    async (f) =>
      symlink(
        path.join(f.source, 'exports', f.manifest.files[0].path),
        path.join(f.output, 'copied.glb'),
      ),
  ],
  [
    'source bytes and adoption changed together without package validation',
    async (f) => {
      const data = Buffer.from('changed source plus changed deployment');
      const item = f.manifest.files[0];
      item.sha256 = digest(data);
      item.bytes = data.length;
      await f.put(f.source, 'exports/' + item.path, data);
      await f.put(f.output, prefix + item.path, data);
      await f.save();
    },
  ],
])
  test(`rejects ${String(name)}`, async () =>
    usingFixture(async (f) => {
      await change(f);
      await assert.rejects(verifyCityLifeIsolation(f.output, f.source));
    }));

for (const token of [
  'city-life-sources/',
  'Representative research layout; not a geographic bus route',
  '公共運輸研究驗證場景',
  '/__offline-assets/boardable-bus',
])
  test(`rejects source-only QA reference ${token}`, async () =>
    usingFixture(async (f) => {
      await f.put(f.output, 'assets/leaked.MJS', JSON.stringify(token));
      await assert.rejects(
        verifyCityLifeIsolation(f.output, f.source),
        /Source-only transit\/QA reference leaked/,
      );
    }));

test('Firebase verifier invokes mandatory pedestrian isolation on supplied output/source roots', async () =>
  usingFixture(async (f) => {
    await f.put(
      f.output,
      'index.html',
      '<html lang="en"><body>Explore Vancouver</body></html>',
    );
    for (const name of [
      'buildings.geojson',
      'terrain.json',
      'bridges.json',
      'trees.json',
      'railways.json',
      'harbour-sites.json',
      'harbour-routes.json',
      'harbour-piers.json',
    ])
      await f.put(f.output, 'data/' + name, '{}');
    await f.put(
      f.output,
      'assets/client.js',
      [
        'Français',
        'Español',
        'zh-Hant',
        'zh-Hans',
        'Deutsch',
        '日本語',
        '한국어',
        'Українська',
        'Русский',
      ].join('\n'),
    );
    await f.put(
      f.output,
      'assets/landmark.worker-fixture.js',
      'onmessage = ({data}) => postMessage({ok:false,session:data.session,error:"version mismatch"});',
    );
    const options = {
      assetRoot: path.dirname(f.source),
      cityLifeSource: f.source,
    };
    const result = await verifyFirebaseBuild(f.output, options);
    assert.equal(result.status, 'pass');
    assert.equal(result.cityLife.adoptedFiles, 8);
    await f.put(f.output, prefix + 'extra.txt', 'unexpected');
    await assert.rejects(
      verifyFirebaseBuild(f.output, options),
      /Unlisted city-life payload/,
    );
  }));
