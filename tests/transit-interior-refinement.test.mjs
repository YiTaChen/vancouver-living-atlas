import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const validate = (path, call) =>
  execFileSync('python3', ['-c', `import importlib.util,json
s=importlib.util.spec_from_file_location('offline_gate',${JSON.stringify(path)})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
${call}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });

test('Mark V interior: actual binary, complete provenance, anchors and cabin budgets pass', () => {
  const output = validate('tools/assets/skytrain-mark-v-interior/validate.py', 'm.write=lambda *args: None; m.main()');
  assert.match(output, /"status":\s*"pass"/);
  assert.match(output, /"runtime":\s*"not_run"/);
});

test('reduced bus interior: actual support, preserved passenger contract and cabin budgets pass', () => {
  const output = validate('tools/assets/boardable-bus-v2/runtime-candidate/validate.py', "print(json.dumps(m.validate(json.loads((m.HERE/'manifest.json').read_text()))[0]))");
  assert.match(output, /"status":\s*"pass"/);
});
