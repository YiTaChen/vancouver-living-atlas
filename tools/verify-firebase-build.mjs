import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { verifyLandmarkWorker } from './verify-landmark-worker.mjs';

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
  'railways.json',
  'harbour-sites.json',
  'harbour-routes.json',
  'harbour-piers.json',
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
assert(
  !scripts.includes('LOCAL VISUAL QA'),
  'Instrumented QA builds must never be deployed',
);
assert(
  !scripts.includes('cpu-submission-profile-v1') &&
    !scripts.includes('Record CPU method timings (instrumented)'),
  'CPU profiling controls must not ship in the public build',
);
assert(
  !scripts.includes('residential-perennial-qa-v1') &&
    !scripts.includes('qaPerennial') &&
    !scripts.includes('residentialPerennialQA'),
  'Experimental Blender perennial geometry and controls must not ship in production',
);
assert(
  !scripts.includes('Discovery walk to next stop') &&
    !scripts.includes('Cancel discovery walking QA') &&
    !scripts.includes('Lab walk to next marker') &&
    !scripts.includes('Cancel lab walking QA'),
  'Discovery movement diagnostics must not ship in the public build',
);
assert(
  !scripts.includes('robson-sill-blender-candidate-v1') &&
    !scripts.includes('source-modern-sill-drip-v1') &&
    !scripts.includes('source-residential-cedar-sill-v1') &&
    !scripts.includes('Replace existing upper sills (QA only)'),
  'Blender architecture candidate controls and code must not ship',
);
assert(
  !files.some((name) => /sandstone-sill\.lod[01].*\.glb$/.test(name)),
  'Opt-in Blender architecture candidate assets must not ship',
);
assert(
  !scripts.includes('Candidate straight RGBA foliage') &&
    !scripts.includes('uTreeCandidateSolidUV') &&
    !scripts.includes('/__offline-assets/') &&
    !scripts.includes('Save asset checkpoint') &&
    !scripts.includes('Render offline role materials'),
  'Offline asset comparison shaders, loaders and controls must not ship',
);
assert(
  !files.some((name) =>
    /(?:modern-sill-drip|residential-cedar-sill)\.lod[01].*\.glb$/.test(name),
  ) &&
    !files.some((name) => name.startsWith('textures/trees/candidate/')) &&
    !files.some((name) =>
      /(?:candidate-lod0-1024|vancouver-citizen-2048)\.glb$/.test(name),
    ),
  'Unaccepted or reference offline assets must not ship',
);
for (const language of [
  'Français',
  'Español',
  'zh-Hant',
  'zh-Hans',
  'Deutsch',
  '日本語',
  '한국어',
  'Українська',
  'Русский',
])
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
  'Firebase static build verified: English HTML, ten-language UI and geographic assets.',
);
await verifyLandmarkWorker(root);
