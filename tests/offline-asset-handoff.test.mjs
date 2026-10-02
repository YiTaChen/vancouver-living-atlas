import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function runPython(args) {
  const result = spawnSync('python3', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test('offline Blender handoff files and embedded GLB data match the published inventory', () => {
  const report = JSON.parse(runPython(['tools/assets/offline-handoff/validate.py']));
  assert.equal(report.status, 'pass');
  assert.ok(report.files > 0);
  assert.ok(report.totalBytes > 0);
});

test('offline handoff audit rejects corrupt data without claiming source/GPU acceptance', () => {
  runPython([
    '-m', 'unittest', 'discover', '-s', 'tools/assets/offline-handoff',
    '-p', 'test_validate.py',
  ]);
});
