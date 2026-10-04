import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const hash = (data) => createHash('sha256').update(data).digest('hex');
function selectedStatements(file, names) {
  const source = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter((node) => ts.isFunctionDeclaration(node) ? names.includes(node.name?.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => names.includes(decl.name.getText(ast))))
    .map((node) => node.getText(ast).replace(/^export /, '')).join('\n');
}
const verify = new Function('readFile', 'readdir', 'path', 'createHash', 'assert', `${selectedStatements('tools/verify-firebase-build.mjs', ['verifyBlenderDeliveryIsolation'])}; return verifyBlenderDeliveryIsolation;`)(readFile, readdir, path, createHash, assert);
const allowedPath = new Function(`${selectedStatements('tools/serve-visual-qa.mjs', ['deliveryPackages', 'isOfflineAssetPath'])}; return isOfflineAssetPath;`)();
async function sandbox(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'blender-isolation-'));
  const dist = path.join(root, 'dist'), assets = path.join(root, 'assets');
  await mkdir(dist); await mkdir(assets);
  const write = async (name, data) => { await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, data); };
  const inventory = async (entries) => write(path.join(dist, 'models/blender/adopted-manifest.json'), JSON.stringify({ version: 1, files: entries }));
  try { await fn({ dist, assets, write, inventory }); } finally { await rm(root, { recursive: true, force: true }); }
}
test('local delivery routes include exact GLB/texture paths and reject authoring/source traversal', () => {
  for (const file of ['mature-tree-templates/exports/mature-maple.lod0.glb', 'mature-tree-templates/exports/textures/leaf_atlas_rgba.png', 'boardable-bus/exports/bus-exterior.lod0.glb', 'citizen-character-variants/exports/vancouver-police.lod0.glb']) assert.equal(allowedPath(file), true, file);
  for (const file of ['mature-tree-templates/../manifest.json', 'mature-tree-templates/exports/../../secret.glb', 'mature-tree-templates/source/tree.blend', 'unknown-package/exports/model.glb', 'mature-tree-templates/exports/manifest.json', 'roadster-driver-fit/exports/driver.glb']) assert.equal(allowedPath(file), false, file);
});
test('production inventory permits only exact adopted payloads, including explicit roof metadata', () => sandbox(async ({ dist, assets, write, inventory }) => {
  const payloads = [['mature-trees/tree.glb', 'geometry'], ['mature-trees/textures/bark.png', 'texture'], ['rooftop-equipment/runtime.json', '{"source":"roof"}']];
  await inventory(payloads.map(([name, data]) => ({ path: name, sha256: hash(data) })));
  for (const [name, data] of payloads) await write(path.join(dist, 'models/blender', name), data);
  await write(path.join(assets, 'mature-tree-templates/exports/tree.glb'), 'geometry');
  assert.deepEqual(await verify(dist, assets), { adoptedFiles: 3, protectedCandidateHashes: 1 });
  await write(path.join(dist, 'models/blender/mature-trees/tree.glb'), 'changed');
  await assert.rejects(verify(dist, assets), /payload changed/);
}));
test('unlisted assets and renamed offline copies cannot bypass deployment isolation', () => sandbox(async ({ dist, assets, write, inventory }) => {
  await inventory([]);
  await write(path.join(dist, 'models/blender/traffic-cars/unapproved.glb'), 'car');
  await assert.rejects(verify(dist, assets), /Unapproved Blender payload/);
  await rm(path.join(dist, 'models/blender/traffic-cars/unapproved.glb'));
  await write(path.join(assets, 'landmark-entrance-details/exports/door.glb'), 'offline');
  await write(path.join(dist, 'assets/renamed-model.glb'), 'offline');
  await assert.rejects(verify(dist, assets), /outside adopted inventory/);
}));
test('invalid inventory paths, duplicate files and authoring sources fail closed', () => sandbox(async ({ dist, assets, write, inventory }) => {
  for (const name of ['../outside.glb', 'mature-trees/../../outside.glb', 'landmark-entrance-details/door.glb', 'mature-trees/source.blend']) {
    await inventory([{ path: name, sha256: hash('x') }]);
    await assert.rejects(verify(dist, assets), /Invalid adopted Blender payload path/);
  }
  const entry = { path: 'traffic-cars/car.glb', sha256: hash('x') };
  await write(path.join(dist, 'models/blender', entry.path), 'x');
  await inventory([entry, entry]);
  await assert.rejects(verify(dist, assets), /Duplicate/);
  await inventory([entry]);
  await write(path.join(dist, 'assets/tree.blend'), 'source');
  await assert.rejects(verify(dist, assets), /authoring source leaked/);
}));
