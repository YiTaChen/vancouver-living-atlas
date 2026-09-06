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
  const workers = files.filter((name) =>
    /\/landmark\.worker-[^/]+\.js$/.test(name),
  );
  assert.equal(
    workers.length,
    1,
    'Expected exactly one emitted landmark worker',
  );
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
