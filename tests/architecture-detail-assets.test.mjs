import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../tools/assets/architecture-details/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));

test('Phase C offline kit has every planned detail role and independently editable LODs', () => {
  assert.equal(manifest.status, 'offline-candidate; no runtime integration');
  assert.deepEqual([...new Set(manifest.assets.map((asset) => asset.role))].sort((a, b) => a.localeCompare(b)),
    ['awning', 'base', 'corner', 'cornice', 'entrance', 'sill', 'window-frame']);
  for (const asset of manifest.assets) {
    assert.deepEqual(asset.lods.map((lod) => lod.level), [0, 1]);
    assert.notEqual(asset.lods[0].source, asset.lods[1].source);
    assert.ok(asset.lods[1].triangles <= asset.lods[0].triangles);
    for (const lod of asset.lods) {
      assert.equal(lod.materials, 1);
      assert.equal(lod.primitives, 1);
      assert.ok(lod.triangles <= lod.triangleCap);
      const header = readFileSync(new URL(lod.source, root)).subarray(0, 2);
      // Compressed Blender projects use zstd or gzip, uncompressed use BLENDER.
      assert.ok((header[0] === 0x28 && header[1] === 0xb5) ||
        (header[0] === 0x1f && header[1] === 0x8b) || header.toString() === 'BL');
    }
  }
});

test('Phase C GLB audit and negative corruption tests pass without claiming Blender inspection', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover',
    '-s', new URL('../tools/assets/architecture-details/', import.meta.url).pathname,
    '-p', 'test_validate_architecture_details.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 10 tests/);
});
