/** Offline reference audit. Reviewed packages are read-only; output belongs here. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as T from 'three';
import { readGlb, sha } from '../roadster-driver-fit/adapters/cockpit-candidate.mjs';
import { meshTriangles } from '../roadster-driver-fit/contact-kernel.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(own, '../../..');
const character = 'tools/assets/citizen-character-variants';
const cockpit = 'tools/assets/roadster-driver-fit';
const baseline = 'aef5e31d4eb8d5d3f832d0931373bf6583227033';
const read = async relative => fs.readFile(path.join(root, relative));
const json = async relative => JSON.parse(await read(relative));
const hash = async relative => sha(await read(relative));
const inputs = new Set();
const runtimePaths = [
  'lib/city/assets/roadster.ts', 'lib/city/navigation.ts',
  'lib/city/driver-camera.ts', 'lib/city/assets/cockpits.ts',
  'lib/city/citizen.ts', 'public/models/citizen/vancouver-citizen.glb',
];
async function collect(relative) {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await collect(next);
    else if (/\.(?:blend|glb|json|mjs|py|png|md)$/.test(entry.name)) inputs.add(next);
  }
}
async function snapshot() {
  return Object.fromEntries(await Promise.all([...inputs].sort((a, b) => a.localeCompare(b)).map(async file => [file, {
    sha256: await hash(file), bytes: (await fs.stat(path.join(root, file))).size,
  }])));
}
await collect(character);
await collect(cockpit);
await collect('tools/assets/material-consumer-candidates/adapters');
for (const p of runtimePaths.concat(['package.json', 'package-lock.json', 'tools/assets/driver-independent-review/audit.mjs'])) inputs.add(p);
const before = await snapshot();
try {
  execFileSync('git', ['cat-file', '-e', `${baseline}^{commit}`], { cwd: root, stdio: 'pipe' });
} catch {
  throw new Error(`Required local baseline ${baseline} is unavailable. Use a full-history checkout; this audit does not fetch or bypass history.`);
}
const checks = [];
const passed = (name, details) => { checks.push({ name, status: 'pass', details }); };

// Exact original source preservation; full tracked runtime trees are compared too.
for (const file of runtimePaths) {
  assert.deepEqual(await read(file), execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 }), file);
}
const changedRuntime = execFileSync('git', ['diff', '--name-only', baseline, '--', 'public', 'lib/city', 'tools/assets/citizen/optimization'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(changedRuntime, '', 'Original public/runtime/optimization files changed');
passed('original runtime source bytes', { baseline, files: runtimePaths, unchangedTrackedTrees: ['public', 'lib/city', 'tools/assets/citizen/optimization'] });

// All twelve current sources must yield the sanitized canonical outputs.
const combined = await json(`${character}/qa/source-preserving-export.json`);
const firstNine = await json(`${character}/qa/source-preserving-export-baseline.json`);
const natural = await json(`${character}/qa/source-preserving-export-natural-driver.json`);
assert.equal(combined.length, 12); assert.equal(firstNine.length, 9); assert.equal(natural.length, 3);
const sorted = rows => [...rows].sort((a, b) => a.source.localeCompare(b.source));
assert.deepEqual(sorted([...firstNine, ...natural]), sorted(combined), 'Split source proofs are historical or stale');
const cleanup = [];
for (const row of combined) {
  assert.equal(row.sourceSha256Before, row.sourceSha256After, row.source);
  assert.equal(row.sourceSha256After, await hash(`${character}/source/${row.source}`), row.source);
  assert.equal(row.outputSha256, await hash(`${character}/exports/${row.output}`), row.output);
  const bytes = await read(`${character}/exports/${row.output}`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.asset.extras.sourceIndexCleanup.removedTriangles, 64);
  const loaded = await readGlb(path.join(root, character, 'exports', row.output));
  let triangles = 0, zeroAreaTriangles = 0;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  loaded.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1)).sub(a);
      c.fromBufferAttribute(position, index.getX(i + 2)).sub(a);
      if (b.cross(c).lengthSq() <= 1e-18) zeroAreaTriangles++;
      triangles++;
    }
  });
  assert.equal(zeroAreaTriangles, 0, row.output);
  cleanup.push({ file: row.output, declaredRemovedTriangles: 64, currentTriangles: triangles, zeroAreaTriangles });
}
passed('current source-preserving export chain', { sourceCount: 12, baselineCount: 9, naturalCount: 3, currentCanonicalOutputs: true, cleanup });

for (const pkg of [character, cockpit]) {
  const manifest = await json(`${pkg}/manifest.json`);
  for (const asset of manifest.assets) {
    assert.equal(asset.runtimeChecks.status, 'not_run');
    assert.equal(asset.runtimeChecks.integrationStatus || asset.runtimeChecks.state, 'runtime_pending_webgl');
    for (const lod of asset.lods) {
    assert.equal(lod.sha256, await hash(`${pkg}/${lod.glb || lod.file}`));
    assert.equal(lod.sourceSha256, await hash(`${pkg}/${lod.source}`));
    }
  }
  passed(`${path.basename(pkg)} manifest source/output hashes`, { assets: manifest.assets.length });
}

// Independently compare the contact kernel to Three's own morph/skin evaluation.
const posed = [];
for (const lod of [0, 1, 2]) {
  const file = `${character}/exports/driver-roadster-fit.lod${lod}.glb`;
  const g = await readGlb(path.join(root, file)), meshes = [];
  g.scene.traverse(m => { if (m.isSkinnedMesh) meshes.push(m); });
  const hands = meshes.find(m => m.morphTargetDictionary?.DriverGrip !== undefined);
  assert(hands); const grip = hands.morphTargetDictionary.DriverGrip;
  assert.equal(hands.morphTargetInfluences[grip], 0);
  const mixer = new T.AnimationMixer(g.scene);
  const clip = g.animations.find(c => c.name === 'driver-seated');
  assert(clip); assert.equal(clip.duration, 1);
  const action = mixer.clipAction(clip).play(); mixer.setTime(.5);
  assert.equal(hands.morphTargetInfluences[grip], 1);
  g.scene.position.set(.44, 0, -.06); g.scene.updateMatrixWorld(true);
  let maxVertexDifferenceM = 0, triangleCornersCompared = 0;
  const vertex = new T.Vector3();
  for (const mesh of meshes) {
    const triangles = meshTriangles(mesh, true); mesh.skeleton.update();
    for (const triangle of triangles) for (let corner = 0; corner < 3; corner++) {
      mesh.getVertexPosition(triangle.ids[corner], vertex).applyMatrix4(mesh.matrixWorld);
      maxVertexDifferenceM = Math.max(maxVertexDifferenceM, vertex.distanceTo([triangle.t.a, triangle.t.b, triangle.t.c][corner]));
      triangleCornersCompared++;
    }
  }
  assert(maxVertexDifferenceM < 1e-12);
  const transitions = [];
  for (const name of ['idle', 'walk', 'run']) {
    action.reset().play(); mixer.update(.1); assert.equal(hands.morphTargetInfluences[grip], 1);
    action.stop(); const next = mixer.clipAction(g.animations.find(c => c.name === name));
    next.reset().play(); mixer.update(.1); assert.equal(hands.morphTargetInfluences[grip], 0);
    transitions.push({ to: name, mode: 'stop seated then play', grip: 0 }); next.stop();
    action.reset().play(); mixer.update(.1); assert.equal(hands.morphTargetInfluences[grip], 1);
    next.reset().play().crossFadeFrom(action, .2, false);
    mixer.update(.1); const midpointGrip = hands.morphTargetInfluences[grip];
    assert(midpointGrip > 0 && midpointGrip < 1);
    mixer.update(.11); assert.equal(hands.morphTargetInfluences[grip], 0);
    transitions.push({ to: name, mode: '0.2 second crossfade', midpointGrip, endGrip: 0 });
    next.stop(); action.stop();
  }
  posed.push({ lod, file, sha256: await hash(file), triangleCornersCompared, maxVertexDifferenceM, transitions });
}
passed('actual morph then skin then world and gait reset', posed);

// Execute the existing package checks in a temporary directory with ONLY their
// output writes redirected. Inputs/imports still resolve to reviewed originals.
// This is reproduction of their algorithms, not a second collision algorithm.
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'driver-independent-'));
const reproduced = [];
try {
  await fs.symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  async function replay(relative, args, files) {
    const original = path.join(root, relative);
    let source = await fs.readFile(original, 'utf8');
    source = source.replace(/(from\s*)['"](\.[^'"]+)['"]/g, (_, lead, spec) => lead + JSON.stringify(pathToFileURL(path.resolve(path.dirname(original), spec)).href));
    source = source.replace(/new URL\('\.\/',\s*import\.meta\.url\)/g, `new URL(${JSON.stringify(pathToFileURL(path.dirname(original) + '/').href)})`);
    source = source.replace(/path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/g, JSON.stringify(path.dirname(original)));
    const writeCount = (source.match(/await fs\.writeFile\(/g) || []).length;
    assert(writeCount > 0, `Expected report writes: ${relative}`);
    source = source.replaceAll('await fs.writeFile(', 'await writeReviewFile(');
    source = `async function writeReviewFile(dest, data) { return fs.writeFile(${JSON.stringify(tmp + '/')} + String(dest).split('/').at(-1), data); }\n` + source;
    const copy = path.join(tmp, path.basename(relative)); await fs.writeFile(copy, source);
    execFileSync(process.execPath, [copy, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
    for (const file of files) {
      const rerun = JSON.parse(await fs.readFile(path.join(tmp, path.basename(file)), 'utf8'));
      const canonical = await json(file);
      if (file.endsWith('cpu-tests.json')) {
        assert.equal(rerun.status, 'pass'); assert.equal(canonical.status, 'pass');
        assert.deepEqual(rerun.assets, canonical.assets, 'CPU records differ from actual rerun');
      } else assert.deepEqual(rerun, canonical, `Published report differs from current rerun: ${file}`);
      reproduced.push({ file, sha256: await hash(file), status: rerun.status || 'pass' });
    }
  }
  await replay(`${character}/validate_cpu.mjs`, [], [`${character}/qa/cpu-tests.json`]);
  await replay(`${cockpit}/test-contact.mjs`, [], [`${cockpit}/qa/contact-kernel-tests.json`]);
  // Prepare the redirected material audit before the adapter dynamically imports it.
  await replay(`${cockpit}/audit-materials.mjs`, [], [`${cockpit}/qa/material-composition.json`]);
  await replay(`${cockpit}/audit-adapter.mjs`, [], [`${cockpit}/qa/adapter-preservation.json`]);
  await replay(`${cockpit}/audit-human-contract.mjs`, [], [`${cockpit}/qa/human-proportions.json`]);
  await replay(`${cockpit}/audit-envelope.mjs`, [], [`${cockpit}/qa/cabin-envelope.json`]);
  await replay(`${cockpit}/check-fit.mjs`, ['--all'], [0, 1, 2].map(l => `${cockpit}/qa/driver-fit-lod${l}.json`).concat(`${cockpit}/qa/driver-fit-summary.json`));
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
passed('current CPU/contact/preservation reports independently reproduced', reproduced);

const contact = [];
for (const lod of [0, 1, 2]) {
  const report = await json(`${cockpit}/qa/driver-fit-lod${lod}.json`);
  assert.equal(report.sourceHumanSha256, await hash(`${character}/exports/driver-roadster-fit.lod${lod}.glb`));
  assert.equal(report.cockpitGlbSha256, await hash(`${cockpit}/exports/roadster-cockpit-local.lod${lod}.glb`));
  assert.equal(report.cockpitSpecSha256, await hash(`${cockpit}/specs.json`));
  assert.equal(report.geometryContactStatus, 'pass'); assert.equal(report.handGripStatus, 'pass');
  assert.equal(report.nonHandGeometryContactStatus, 'pass');
  assert(report.candidate.every(c => c.handPenetration.maximumSampledPenetrationM <= .003));
  const rim = report.candidate.find(c => c.collider === 'steering-rim');
  assert(['handL', 'handR'].every(b => rim.handContactsByBone[b].minimumSeparationM <= .003));
  contact.push({ lod, humanSha256: report.sourceHumanSha256, cockpitSha256: report.cockpitGlbSha256,
    maximumSampledHandPenetrationM: Math.max(...report.candidate.map(c => c.handPenetration.maximumSampledPenetrationM)),
    leftRimSeparationM: rim.handContactsByBone.handL.minimumSeparationM,
    rightRimSeparationM: rim.handContactsByBone.handR.minimumSeparationM,
    nonHandGeometry: report.nonHandGeometryContactStatus, overall: report.geometryContactStatus,
    camera: report.camera });
}
passed('all LODs include active hands in overall acceptance', contact);

const renderChecks = [];
for (const pkg of [character, cockpit]) {
  const evidence = await json(`${pkg}/qa/render-evidence.json`);
  for (const frame of evidence) {
    assert.equal(frame.renderer, 'Cycles'); assert.equal(frame.device, 'CPU'); assert.equal(frame.threads, 2);
    await fs.access(path.join(root, pkg, frame.file));
    for (const input of frame.inputs) assert.equal(input.sha256, await hash(input.file), `Stale render input: ${input.file}`);
  }
  renderChecks.push({ package: pkg, frames: evidence.length, allInputHashesCurrent: true });
}
passed('render evidence input hashes', renderChecks);

const blender = await json(`${character}/qa/blender-reimport.json`);
assert.equal(blender.status, 'pass'); assert.equal(blender.assets.length, 12);
for (const a of blender.assets) assert.equal(a.sha256, await hash(`${character}/exports/${a.file}`), `Blender reimport not bound to current GLB: ${a.file}`);
const cockpitBlender = await json(`${cockpit}/qa/blender-audit.json`);
assert.equal(cockpitBlender.status, 'pass');
for (const a of cockpitBlender.results) assert.equal(a.sourceSha256, await hash(`${cockpit}/source/roadster-cockpit-local.lod${a.lod}.blend`));
passed('Blender evidence hash bindings', { characterGlbs: 12, cockpitSources: cockpitBlender.results.length, reranBlender: false });

const after = await snapshot(); assert.deepEqual(after, before, 'Inputs changed during audit');
const report = {
  schemaVersion: 1, status: 'pass', command: 'node tools/assets/driver-independent-review/audit.mjs',
  checkedAt: new Date().toISOString(), environment: { node: process.version, three: T.REVISION, webgl: false },
  scope: 'Offline final character and optional Roadster cockpit static fit; read-only source/evidence review',
  checks, inputs: before,
  limitations: [
    'The posed-vertex/transition test independently compares with Three.js. Contact and source-adapter regressions are reproduced using their reviewed package algorithms, not an independently implemented collision solver.',
    'Hand depth is finite vertex/edge-midpoint/centroid sampling, not a continuous penetration maximum; allowed approximation is 3 mm.',
    'The original open shell is checked as surfaces. Eight inherited seat/door-shoulder source-triangle joins remain; no new joins in the LOD0 moved-part envelope audit.',
    'Seat support remains rigid visual approximation: cushion gap about 4.95 mm; sampled coat/backrest normal gap minimum about 22.5 mm and median about 42.9 mm. No soft cushion contact or comfort certification.',
    'Standing rest pose requires driver-seated activation for fit. Exit consumers must stop or fade that action to restore DriverGrip 0.',
    'No runtime/camera migration, dynamic steering, pedals, belts, entry/exit, gameplay, WebGL, GPU performance or ergonomic acceptance.',
    'Blender source edit and reimport evidence is hash-verified; this command does not rerun Blender.',
  ],
};
const output = path.join(own, 'report.json');
await fs.writeFile(output + '.tmp', JSON.stringify(report, null, 2) + '\n');
await fs.rename(output + '.tmp', output);
console.log(JSON.stringify({ status: report.status, checks: checks.length, inputs: Object.keys(before).length, contact }, null, 2));
