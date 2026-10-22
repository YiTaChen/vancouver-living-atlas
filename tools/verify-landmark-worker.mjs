import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { pathToFileURL } from 'node:url';

/** Execute the actual final Vite worker bundle with no Window or DOM globals.
 * Source-module tests alone missed a client-environment define folded by vinext.
 * This is a bundle startup/protocol check; actual WebGL arrivals use browser QA.
 */
export async function verifyLandmarkWorker(root = path.resolve('dist/client')) {
  const files = await readdir(root, { recursive: true });
  const workers = [];
  for (const name of files) {
    const named = /\/landmark\.worker-[^/]+\.js$/.test(name);
    // vinext 1.3/Vite 8.3 place workers in a dedicated directory with opaque
    // names. Identify our protocol in that directory, then verify real wiring.
    const opaque = /^_next\/static\/workers\/[^/]+\.js$/.test(name);
    if (!named && !opaque) continue;
    const code = await readFile(path.join(root, name), 'utf8');
    if (named || code.includes('vancouver-landmarks-2026-09-06-v1')) workers.push(name);
  }
  assert.equal(
    workers.length,
    1,
    'Expected exactly one emitted landmark worker',
  );
  let wired = false;
  for (const name of files) {
    if (!name.endsWith('.js') || workers.includes(name)) continue;
    const source = await readFile(path.join(root, name), 'utf8');
    for (const match of source.matchAll(
      /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*(["'`])([^"'`]+)\1/g,
    )) {
      if (match[2] === `/${workers[0]}`) wired = true;
    }
  }
  assert(wired, 'Emitted landmark worker must be referenced by the client Worker constructor');
  const replies = [];
  const context = createContext({
    performance,
    console,
    postMessage: (reply) => replies.push(reply),
  });
  runInContext(await readFile(path.join(root, workers[0]), 'utf8'), context, {
    timeout: 5000,
    filename: workers[0],
  });
  assert.equal(
    typeof context.onmessage,
    'function',
    'Worker entry did not initialize',
  );
  runInContext(
    `onmessage({data:{version:'bundle-smoke-invalid',session:'bundle-smoke',job:1}})`,
    context,
    { timeout: 5000 },
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, false);
  assert.equal(replies[0].session, 'bundle-smoke');
  assert.match(replies[0].error, /version mismatch/);
  console.log(
    'Emitted landmark worker verified: initializes without Window/DOM and handles protocol messages.',
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await verifyLandmarkWorker();
