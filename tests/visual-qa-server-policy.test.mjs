import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseVisualQaPort,
  allowsVisualQaOrigin,
} from '../tools/visual-qa-server-policy.mjs';

test('QA port defaults to 3100 and accepts only decimal ports from 1 through 65535', () => {
  assert.equal(parseVisualQaPort(undefined), 3100);
  for (const [value, port] of [
    ['1', 1],
    ['3196', 3196],
    ['65535', 65535],
  ])
    assert.equal(parseVisualQaPort(value), port);
  for (const value of [
    '',
    '0',
    '65536',
    '-1',
    '1.5',
    ' 3196',
    '3196 ',
    '3196\n',
    '3196\r',
    '+3196',
    '3e3',
    'Infinity',
    'foo',
    3196,
    null,
  ])
    assert.throws(() => parseVisualQaPort(value), /VISUAL_QA_PORT/);
});

test('report origins are exact loopback hosts on the configured port; missing Origin stays allowed', () => {
  for (const origin of [
    undefined,
    'http://localhost:3196',
    'http://127.0.0.1:3196',
  ])
    assert.equal(allowsVisualQaOrigin(origin, 3196), true);
  for (const origin of [
    '',
    'null',
    'http://localhost:3100',
    'http://localhost:3196/',
    'http://localhost:3196.evil.test',
    'http://user@localhost:3196',
    'https://localhost:3196',
    'http://[::1]:3196',
    'http://LOCALHOST:3196',
    'http://192.168.1.2:3196',
  ])
    assert.equal(allowsVisualQaOrigin(origin, 3196), false, origin);
});

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function ready(child, port) {
  return new Promise((resolve, reject) => {
    let stdout = '',
      stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`QA server did not start: ${stderr}`)),
      10_000,
    );
    child.stdout.on('data', (data) => {
      stdout += data;
      if (stdout.includes(`http://localhost:${port}/`)) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`QA server exited ${code}: ${stderr}`));
    });
  });
}

test('QA server child serves and saves on its selected port while rejecting another task origin', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-qa-port-'));
  const state = { child: null };
  t.after(async () => {
    const child = state.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(root, { recursive: true, force: true });
  });
  // Minimal Git metadata provides a deterministic fixture revision, without a
  // commit, network access or changes to the user's checkout/global Git config.
  await mkdir(join(root, '.git/objects'), { recursive: true });
  await mkdir(join(root, '.git/refs/heads'), { recursive: true });
  await writeFile(join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  await writeFile(join(root, '.git/refs/heads/main'), '1'.repeat(40) + '\n');
  await mkdir(join(root, 'dist/client'), { recursive: true });
  await mkdir(join(root, 'lib'), { recursive: true });
  await writeFile(
    join(root, 'dist/client/index.html'),
    '<p>QA port fixture</p>',
  );
  await writeFile(
    join(root, 'lib/fixture.ts'),
    'export const fixture = true;\n',
  );
  let port;
  try {
    port = await unusedPort();
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(
        'This executor denies loopback listeners; run in a local-server-capable environment.',
      );
      return;
    }
    throw error;
  }
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../tools/serve-visual-qa.mjs', import.meta.url)),
      'port-policy-test',
    ],
    {
      cwd: root,
      env: { ...process.env, VISUAL_QA_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  state.child = child;
  await ready(child, port);
  const base = `http://127.0.0.1:${port}`;
  assert.equal(await (await fetch(base)).text(), '<p>QA port fixture</p>');
  const post = (origin) =>
    fetch(base + '/__visual-qa', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin === undefined ? {} : { Origin: origin }),
      },
      body: JSON.stringify({
        name: 'port-check',
        row: { marker: 'same-payload' },
      }),
    });
  for (const origin of [
    undefined,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ])
    assert.equal((await post(origin)).status, 200);
  assert.equal(
    (await post(`http://localhost:${port === 65535 ? port - 1 : port + 1}`))
      .status,
    403,
  );
  const saved = JSON.parse(
    await readFile(
      join(root, 'work/visual-qa/port-policy-test/port-check.json'),
      'utf8',
    ),
  );
  assert.equal(saved.marker, 'same-payload');
  assert.equal(saved.revision, '1'.repeat(40));
  assert.match(saved.sourceFingerprint, /^[a-f0-9]{64}$/);
});
