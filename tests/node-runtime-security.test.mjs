import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isSupportedNodeVersion } from '../tools/verify-node-runtime.mjs';

test('only stable patched releases of the supported Node majors are accepted', () => {
  for (const version of ['22.23.4', '22.23.5', '22.24.0', '24.22.1', '24.22.2', '24.23.0']) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
  for (const version of [
    '22.23.3', '22.22.99', '24.22.0', '24.21.99',
    '16.20.2', '18.20.8', '20.99.0', '23.99.0', '25.0.0', '26.0.0', '26.12.1',
    '24.22.1-rc.1', '24.22.1+custom', 'v24.22.1', '24.22.1\n',
    '24.99999999999999999999.1', '', null,
  ]) assert.equal(isSupportedNodeVersion(version), false, String(version));
  assert.equal(isSupportedNodeVersion('24.22.1', '>=22'), false);
  assert.equal(isSupportedNodeVersion('24.22.1', '^22.23.4 || *'), false);
});

test('guard uses the executing binary rather than an environment version claim', () => {
  const guard = fileURLToPath(new URL('../tools/verify-node-runtime.mjs', import.meta.url));
  const supported = isSupportedNodeVersion(process.versions.node);
  const claimedVersion = supported ? '26.0.0' : '24.22.1';
  const result = spawnSync(process.execPath, [guard], {
    encoding: 'utf8',
    env: { ...process.env, NODE_VERSION: claimedVersion, npm_config_node_version: claimedVersion },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, supported ? 0 : 1);
  if (!supported) assert.match(result.stderr, /Unsupported Node.js runtime/);
});

test('HTTP/build commands keep runtime gates even without lifecycle hooks', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const command of ['dev', 'build', 'build:firebase', 'start', 'check', 'test']) {
    assert(pkg.scripts[command].startsWith('node tools/verify-node-runtime.mjs && '), command);
  }
  assert.equal(pkg.scripts.preinstall, 'node tools/verify-node-runtime.mjs');
  assert.match(readFileSync(new URL('../.npmrc', import.meta.url), 'utf8'), /^engine-strict=true$/m);
});

test('npm ignore-scripts and a false version claim cannot start HTTP tooling on an unsupported binary', (t) => {
  const candidates = [
    process.env.NODE_RUNTIME_TEST_BINARY,
    '/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node',
  ].filter(Boolean);
  const unsupported = candidates.find((binary) => {
    if (!existsSync(binary)) return false;
    const probe = spawnSync(binary, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    const version = probe.stdout.trim();
    const [major, minor] = version.split('.').map(Number);
    // The installed npm itself needs a recent Node. Older EOL versions belong
    // in the boundary test, rather than failing inside npm before our guard.
    return probe.status === 0 && (major > 22 || (major === 22 && minor >= 9)) &&
      !isSupportedNodeVersion(version);
  });
  if (!unsupported) return t.skip('No unsupported Node 22.9+ binary is installed for the npm regression');
  const npmCli = process.env.npm_execpath ?? path.resolve(
    path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js',
  );
  assert(existsSync(npmCli), 'An npm CLI is required for the lifecycle bypass regression');
  const cache = mkdtempSync(path.join(tmpdir(), 'atlas-runtime-npm-'));
  try {
    for (const command of ['dev', 'start']) {
      // --help keeps a regression harmless: without the guard it exits via CLI
      // help rather than opening a listener. Test both npm config entry points.
      const result = spawnSync(unsupported, [npmCli, '--ignore-scripts', 'run', command, '--', '--help'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        encoding: 'utf8',
        timeout: 15_000,
        env: {
          ...process.env,
          PATH: `${path.dirname(unsupported)}${path.delimiter}${process.env.PATH ?? ''}`,
          NODE_VERSION: '24.22.1',
          npm_config_node_version: '24.22.1',
          npm_config_ignore_scripts: 'true',
          npm_config_update_notifier: 'false',
          npm_config_audit: 'false',
          npm_config_cache: cache,
        },
      });
      assert.equal(result.error, undefined, command);
      assert.equal(result.status, 1, `${command}: ${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /Unsupported Node.js runtime/);
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});
