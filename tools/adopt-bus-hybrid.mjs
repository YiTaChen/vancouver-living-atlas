/** Publish only optimized GLBs and metadata; editable .blend sources stay in tools/. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUS_HYBRID_SOURCE,
  BUS_HYBRID_PREFIX,
  hybridAdoptionEntries,
  verifyBusHybridAdoption,
} from './verify-bus-hybrid-adoption.mjs';
const source = path.resolve(BUS_HYBRID_SOURCE),
  output = path.resolve('public');
const bytes = await readFile(path.join(source, 'manifest.json')),
  manifest = JSON.parse(bytes);
await mkdir(path.join(output, BUS_HYBRID_PREFIX), { recursive: true });
for (const lod of manifest.assets[0].lods)
  await copyFile(
    path.join(source, 'exports', lod.file),
    path.join(output, BUS_HYBRID_PREFIX, lod.file),
  );
await writeFile(path.join(output, BUS_HYBRID_PREFIX, 'manifest.json'), bytes);
const file = path.join(output, 'models/blender/adopted-manifest.json');
const inventory = JSON.parse(await readFile(file, 'utf8'));
inventory.files = inventory.files.filter(
  (item) => !item.path.startsWith('bus-hybrid/'),
);
inventory.files.push(...hybridAdoptionEntries(manifest, bytes));
await writeFile(file, JSON.stringify(inventory, null, 2) + '\n');
console.log(await verifyBusHybridAdoption(output, source));
