import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  contentSecurityPolicy,
  inlineScriptHashes,
  prepareFirebaseHosting,
} from '../tools/prepare-firebase-hosting.mjs';

test('CSP permits exact hydration payloads and rejects injected or remote scripts', () => {
  const payload = 'self.__rsc.push({"data":"<escaped>"});';
  const hash = `'sha256-${createHash('sha256').update(payload).digest('base64')}'`;
  const html = `<script src="/_next/static/app.js"></script><script>${payload}</script>`;
  assert.deepEqual(inlineScriptHashes(html), [hash]);
  assert.notDeepEqual(inlineScriptHashes(html.replace(payload, 'alert(1)')), [hash]);
  assert.throws(() => inlineScriptHashes('<script src="https://example.org/a.js"></script>'));
  assert.throws(() => inlineScriptHashes('<script src="//example.org/a.js"></script>'));
  const policy = contentSecurityPolicy([hash]);
  assert(policy.includes(`script-src 'self' ${hash};`));
  assert(policy.includes("script-src-attr 'none'"));
  assert(policy.includes("frame-ancestors 'none'"));
  assert(!policy.split(';').find((part) => part.trim().startsWith('script-src ')).includes('unsafe-'));
  assert.throws(() => contentSecurityPolicy(["'unsafe-inline'"]));
});

test('generated Hosting config covers every static page and keeps the public directory bounded', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'atlas-csp-'));
  try {
    const root = path.join(temporary, 'client');
    await mkdir(root);
    await writeFile(path.join(root, 'index.html'), '<script>self.home=1</script>');
    await writeFile(path.join(root, '404.html'), '<script>self.error=1</script>');
    const configPath = path.join(temporary, 'firebase.json');
    const outputPath = path.join(temporary, 'firebase.generated.json');
    await writeFile(configPath, JSON.stringify({ hosting: { public: 'dist/client', headers: [] } }));
    const summary = await prepareFirebaseHosting({ root, configPath, outputPath });
    assert.equal(summary.pages, 2);
    assert.equal(summary.scriptHashes, 2);
    const generated = JSON.parse(await readFile(outputPath, 'utf8'));
    const policy = generated.hosting.headers.at(-1).headers[0].value;
    for (const payload of ['self.home=1', 'self.error=1']) {
      assert(policy.includes(inlineScriptHashes(`<script>${payload}</script>`)[0]));
    }
    await writeFile(configPath, JSON.stringify({ hosting: { public: '.', headers: [] } }));
    await assert.rejects(prepareFirebaseHosting({ root, configPath, outputPath }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('production deploy uses the generated CSP and a patched Node release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/firebase-hosting.yml', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(workflow, /node-version: '24\.22\.1'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /--config firebase\.generated\.json/);
  assert.match(pkg.scripts['build:firebase'], /tools\/prepare-firebase-hosting\.mjs/);
  assert.match(pkg.scripts['deploy:firebase'], /--config firebase\.generated\.json/);
});
