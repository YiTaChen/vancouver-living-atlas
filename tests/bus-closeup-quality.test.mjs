import '../tools/assets/boardable-bus-v2/closeup-quality/adapter.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../tools/assets/boardable-bus-v2/closeup-quality/', import.meta.url);
test('close-up bus actual GLBs preserve anchors, clearances, round tubes and black-inner / blue-outer frames', { timeout: 240000 }, () => {
  const result = spawnSync('python3', ['tools/assets/boardable-bus-v2/closeup-quality/validate.py', '--check-only'], { encoding: 'utf8', timeout: 230000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.features.map(x => x.railSidesAtEachEnd), [[32,32],[16,16]]);
  assert.ok(report.costs.every(x => x.budget.pass === false));
});
test('quality profile stays separate from integrated budget assets and truthful measured costs', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.json', root)));
  assert.equal(m.scope.runtimeIntegration, 'pending');
  assert.equal(m.scope.WebGL, 'not_run');
  for (const lod of m.assets[0].lods) {
    const bytes = readFileSync(new URL(lod.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), lod.sha256);
    assert.equal(bytes.length, lod.bytes);
    assert.ok(lod.embeddedImageBytes > 0);
  }
  const runtime = JSON.parse(readFileSync(new URL('../public/models/blender/bus-v2/manifest.json', import.meta.url)));
  assert.notEqual(runtime.assets[0].id, m.assets[0].id);
});
