import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyLandmarkWorker } from './verify-landmark-worker.mjs';
import { verifyCityLifeIsolation } from './verify-city-life-isolation.mjs';

/** Adopted payloads are an explicit path/hash inventory, not a directory exemption. */
export async function verifyBlenderDeliveryIsolation(
  distRoot,
  assetRoot = path.resolve('tools/assets'),
) {
  const files = await readdir(distRoot, { recursive: true });
  const prefix = 'models/blender/';
  const manifestPath = prefix + 'adopted-manifest.json';
  const deployed = files.filter(
    (file) =>
      file.startsWith(prefix) &&
      file !== manifestPath &&
      /\.(?:glb|png|json)$/.test(file),
  );
  const allowed = new Map();
  if (files.includes(manifestPath)) {
    const manifest = JSON.parse(
      await readFile(path.join(distRoot, manifestPath), 'utf8'),
    );
    assert.equal(
      manifest.version,
      1,
      'Unknown Blender adopted inventory version',
    );
    assert(
      Array.isArray(manifest.files),
      'Blender adopted inventory requires exact files',
    );
    for (const item of manifest.files) {
      assert(
        typeof item.path === 'string' &&
          /^(?:mature-trees|rooftop-equipment|traffic-cars|bus|metro)\/(?:textures\/)?[a-z0-9][a-z0-9_.-]*\.(?:glb|png|json)$/.test(
            item.path,
          ),
        'Invalid adopted Blender payload path',
      );
      assert(
        /^[a-f0-9]{64}$/.test(item.sha256),
        'Adopted Blender payload requires complete SHA-256',
      );
      const name = prefix + item.path;
      assert(!allowed.has(name), 'Duplicate adopted Blender payload');
      allowed.set(name, item.sha256);
      const data = await readFile(path.join(distRoot, name));
      assert.equal(
        createHash('sha256').update(data).digest('hex'),
        item.sha256,
        `Adopted Blender payload changed: ${name}`,
      );
    }
  }
  for (const name of deployed)
    assert(allowed.has(name), `Unapproved Blender payload: ${name}`);
  for (const name of files) {
    assert(
      !/\.blend(?:\d+)?$/i.test(name),
      `Blender authoring source leaked: ${name}`,
    );
    if (name.startsWith(prefix) && !allowed.has(name) && name !== manifestPath)
      assert(!path.extname(name), `Unlisted Blender delivery file: ${name}`);
  }
  const candidateHashes = new Set();
  const packages = [
    'mature-tree-templates',
    'rooftop-equipment',
    'traffic-car-templates',
    'boardable-bus',
    'boardable-metro',
    'transit-station-spaces',
    'landmark-entrance-details',
    'roof-surface-studies',
    'street-furniture-expansion',
    'ground-planting-details',
    'source-fitted-window-variants',
    'citizen-character-variants',
    'roadster-driver-fit',
  ];
  for (const name of packages) {
    let exports;
    try {
      exports = await readdir(path.join(assetRoot, name, 'exports'), {
        recursive: true,
      });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of exports) {
      if (!/\.(?:glb|png)$/.test(file)) continue;
      candidateHashes.add(
        createHash('sha256')
          .update(await readFile(path.join(assetRoot, name, 'exports', file)))
          .digest('hex'),
      );
    }
  }
  for (const name of files) {
    if (!/\.(?:glb|png)$/.test(name)) continue;
    const hash = createHash('sha256')
      .update(await readFile(path.join(distRoot, name)))
      .digest('hex');
    if (candidateHashes.has(hash))
      assert(
        allowed.get(name) === hash,
        `Offline delivery payload leaked outside adopted inventory: ${name}`,
      );
  }
  return {
    adoptedFiles: allowed.size,
    protectedCandidateHashes: candidateHashes.size,
  };
}

/** Importable for fixture checks; CLI invocation still validates the full build.
 * The pedestrian check is mandatory, never a prefix/directory exemption.
 */
export async function verifyFirebaseBuild(
  root = path.resolve('dist/client'),
  options = {},
) {
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
    !scripts.includes('Auto: use automatic quality') &&
      !scripts.includes('Auto travel QA ready') &&
      !scripts.includes('auto-quality-travel'),
    'Auto quality diagnostics must not ship in the public build',
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
      !scripts.includes('Render offline role materials') &&
      !scripts.includes('blender-delivery-webgl-v1') &&
      !scripts.includes('Load delivered model'),
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
  await verifyLandmarkWorker(root);
  const blenderDelivery = await verifyBlenderDeliveryIsolation(
    root,
    options.assetRoot,
  );
  const cityLife = await verifyCityLifeIsolation(root, options.cityLifeSource);
  return { status: 'pass', blenderDelivery, cityLife };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const result = await verifyFirebaseBuild();
  console.log(
    'Firebase static build verified: English HTML, ten-language UI and geographic assets.',
  );
  console.log('Blender delivery isolation verified:', result.blenderDelivery);
  console.log('City-life runtime adoption verified:', result.cityLife);
}
