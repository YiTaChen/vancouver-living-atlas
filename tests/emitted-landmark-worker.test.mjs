import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyLandmarkWorker } from '../tools/verify-landmark-worker.mjs';

const protocol = 'vancouver-landmarks-2026-09-06-v1';
const worker = `const version=${JSON.stringify(protocol)};
globalThis.onmessage=({data})=>postMessage({ok:false,session:data.session,error:'Worker/factory bundle version mismatch'});`;

async function fixture(action) {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-worker-'));
  const directory = '_next/static/workers';
  const name = `${directory}/21195e96-BIskRCz1.js`;
  const consumer = path.join(root, 'client.js');
  try {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, name), worker);
    await writeFile(consumer, `new Worker(new URL(\`/${name}\`, import.meta.url),{type:'module'});`);
    await action({ root, name, consumer, directory });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('opaque emitted worker is executed without DOM and remains wired to the client', async () => {
  await fixture(async ({ root }) => verifyLandmarkWorker(root));
});

test('worker validation rejects missing wiring, duplicate protocol workers and DOM-dependent output', async () => {
  await fixture(async ({ root, name, consumer }) => {
    await writeFile(consumer, '// no Worker constructor');
    await assert.rejects(verifyLandmarkWorker(root), /must be referenced/);
    await writeFile(consumer, `new Worker(new URL('/${name}',import.meta.url));`);
    const duplicate = path.join(root, '_next/static/workers/duplicate.js');
    await writeFile(duplicate, worker);
    await assert.rejects(verifyLandmarkWorker(root), /exactly one/);
    await rm(duplicate);
    await writeFile(path.join(root, name), `window.document;${worker}`);
    await assert.rejects(verifyLandmarkWorker(root), /window is not defined/);
  });
});
