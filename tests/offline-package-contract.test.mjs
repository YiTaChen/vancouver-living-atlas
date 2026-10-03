import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const contract = 'tools/assets/package-contract';
function python(args) {
  const result = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}

test('offline package common verifier rejects corrupt geometry and production leaks', () => {
  python([`${contract}/test_validate.py`]);
  python([`${contract}/test_isolation.py`]);
});

for (const dir of readdirSync('tools/assets', { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const packageRoot = path.join('tools/assets', dir.name);
  const file = path.join(packageRoot, 'manifest.json');
  if (!existsSync(file)) continue;
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  // New common contract only; legacy packages retain their own schemas/audits.
  if (manifest.schemaVersion !== 1 || !manifest.coordinateSystem || !manifest.packageId || !manifest.assets) continue;
  test(`offline package ${manifest.packageId}: source hashes and actual exported geometry`, () => {
    python([`${contract}/validate.py`, packageRoot]);
  });
}
