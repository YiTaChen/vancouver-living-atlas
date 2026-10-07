import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = resolve(root, 'tools/assets/city-life-pedestrians');
const payloads = (await files(source)).filter((path) =>
  /\.(glb|blend|png)$/.test(path),
);
if (payloads.length < 16)
  throw new Error('Expected eight editable sources and eight GLBs');
const forbidden = new Map();
for (const path of payloads)
  forbidden.set(hash(await readFile(path)), relative(root, path));
const output = resolve(root, 'dist/client');
if (!(await stat(output)).isDirectory())
  throw new Error('Run npm run build:firebase first');
const emitted = await files(output);
for (const path of emitted) {
  const bytes = await readFile(path),
    hit = forbidden.get(hash(bytes));
  if (hit)
    throw new Error(
      `Unintegrated city-life asset leaked: ${hit} -> ${relative(root, path)}`,
    );
  if (/\.(js|json|html|css|map)$/.test(path)) {
    const text = bytes.toString('utf8');
    for (const token of [
      'city-life-pedestrians/',
      'city-life-sources/',
      'city-life/population',
      'city-life/transit-service',
    ])
      if (text.includes(token))
        throw new Error(`Unintegrated city-life reference leaked: ${token}`);
  }
}
console.log(
  JSON.stringify(
    {
      status: 'pass',
      candidateFiles: payloads.length,
      uniquePayloadHashes: forbidden.size,
      emittedFiles: emitted.length,
      browserNetwork: 'not_run',
    },
    null,
    2,
  ),
);
