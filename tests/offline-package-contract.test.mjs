import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const contract = 'tools/assets/package-contract';
function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
const python = (args) => command('python3', args);

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
  // Source/reference audits are distinct schemas, not empty GLB asset bundles.
  if (manifest.schema === 'vancouver-city-scale-source-audit/1') {
    test('city-scale source audit remains reproducible without pretending to export models', () => {
      command(process.execPath, [`${packageRoot}/audit.mjs`, '--check']);
      command(process.execPath, ['--test', `${packageRoot}/audit.test.mjs`]);
    });
    continue;
  }
  if (manifest.schemaVersion === 'vancouver-facade-fit-reference/v1') {
    test('facade reference contracts preserve source hashes and fail-closed fitting', () => {
      python([`${packageRoot}/validate.py`]);
      command(process.execPath, ['--test', `${packageRoot}/fit.test.mjs`]);
    });
    continue;
  }
  // New common contract only; legacy packages retain their own schemas/audits.
  if (manifest.schemaVersion !== 1 || !manifest.coordinateSystem || !manifest.packageId || !manifest.assets) continue;
  test(`offline package ${manifest.packageId}: source hashes and actual exported geometry`, () => {
    python([`${contract}/validate.py`, packageRoot]);
  });
}
