import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('local HTTP commands use guarded Node previews bound to loopback', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.dev, /^node tools\/verify-node-runtime\.mjs && vinext dev --host 127\.0\.0\.1$/);
  assert.match(pkg.scripts.start, /^node tools\/verify-node-runtime\.mjs && vinext start --hostname 127\.0\.0\.1$/);
  for (const name of ['@cloudflare/vite-plugin', '@cloudflare/workers-types', 'wrangler']) {
    assert(!Object.hasOwn(pkg.devDependencies, name), name);
  }
  assert(!Object.hasOwn(pkg.overrides, 'miniflare'));
  const config = read('vite.config.ts');
  assert.doesNotMatch(config, /@cloudflare|\b(?:wrangler|miniflare|localBindingConfig)\b/i);
});

test('locked preview dependencies exclude the standalone unpatched native decoder stack', () => {
  const lock = JSON.parse(read('package-lock.json'));
  const removed = /(?:^|\/)node_modules\/(?:workerd|miniflare|wrangler|@cloudflare\/(?:vite-plugin|workers-types|workerd-[^/]+))$/;
  for (const name of Object.keys(lock.packages)) {
    assert(!removed.test(name), `Unexpected Worker preview dependency: ${name}`);
  }
});
