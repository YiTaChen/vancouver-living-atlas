import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve('dist/client');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.match(html, /<html[^>]*lang="en"/, 'First visit must use English');
assert.match(
  html,
  /Explore Vancouver/,
  'Static page must contain the application',
);
for (const name of [
  'buildings.geojson',
  'terrain.json',
  'bridges.json',
  'trees.json',
])
  JSON.parse(await readFile(path.join(root, 'data', name), 'utf8'));
const files = await readdir(root, { recursive: true });
const scripts = (
  await Promise.all(
    files
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFile(path.join(root, name), 'utf8')),
  )
).join('\n');
for (const language of ['Français', 'Español', 'zh-Hant', 'zh-Hans'])
  assert(
    scripts.includes(language),
    `Missing language in client bundle: ${language}`,
  );
assert(
  !files.some((name) =>
    /(^|\/)(server|node_modules|\.env|\.git|\.openai)(\/|$)/.test(name),
  ),
  'Only public assets may be hosted',
);
console.log(
  'Firebase static build verified: English HTML, five-language UI and geographic assets.',
);
