import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readStreetFurnitureSource,
  streetFurnitureAdoptionEntries,
  STREET_FURNITURE_PUBLIC_PREFIX,
  STREET_FURNITURE_SOURCE_PATH,
  verifyStreetFurnitureAdoption,
} from '../verify-street-furniture-adoption.mjs';

/** Reproducible promotion of exact reviewed source bytes. Other adopted entries
 * remain byte-for-byte JSON values; authoring files and previews never copy. */
export async function adoptStreetFurniture(
  output = path.resolve('public'),
  source = path.resolve(STREET_FURNITURE_SOURCE_PATH),
) {
  const { manifest, metadata, metadataBytes } =
    await readStreetFurnitureSource(source);
  const inventoryPath = path.join(
    output,
    'models/blender/adopted-manifest.json',
  );
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  assert.equal(inventory.version, 1);
  assert(Array.isArray(inventory.files));
  const destination = path.join(output, STREET_FURNITURE_PUBLIC_PREFIX);
  await mkdir(destination, { recursive: true });
  for (const asset of metadata.assets)
    for (const lod of asset.lods)
      await copyFile(
        path.join(source, 'exports', lod.file),
        path.join(destination, lod.file),
      );
  await writeFile(path.join(destination, 'manifest.json'), metadataBytes);
  inventory.files = [
    ...inventory.files.filter(
      (entry) => !entry.path?.startsWith('street-furniture/'),
    ),
    ...streetFurnitureAdoptionEntries(manifest, metadataBytes),
  ];
  await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  return verifyStreetFurnitureAdoption(output, source);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(JSON.stringify(await adoptStreetFurniture(), null, 2));
