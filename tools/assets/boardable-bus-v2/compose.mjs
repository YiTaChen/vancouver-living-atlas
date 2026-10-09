/** Offline composition for the existing schema-v1 passenger adapter.
 * No runtime imports this module. Dependency bytes are checked before composing.
 * Returned asset file/source paths are repository-relative, never local absolute paths.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const rewriteAsset = (asset, prefix) => {
  const a = structuredClone(asset);
  a.source = prefix + a.source;
  a.lods = a.lods.map((l) => ({
    ...l,
    file: prefix + l.file,
    source: prefix + l.source,
  }));
  return a;
};
export function composeBusV2() {
  const supplement = JSON.parse(
    readFileSync(new URL('manifest.json', root), 'utf8'),
  );
  const dependency = supplement.dependencies[0];
  if (
    dependency.packageId !== 'boardable-bus' ||
    dependency.manifest !== '../boardable-bus/manifest.json'
  )
    throw new Error('Unexpected bus exterior dependency');
  const bytes = readFileSync(new URL(dependency.manifest, root));
  if (digest(bytes) !== dependency.manifestSha256)
    throw new Error('Exterior manifest hash mismatch');
  const original = JSON.parse(bytes.toString('utf8'));
  for (const file of dependency.files) {
    if (!file.file.startsWith('../boardable-bus/exports/'))
      throw new Error('Unexpected exterior path');
    if (digest(readFileSync(new URL(file.file, root))) !== file.sha256)
      throw new Error('Exterior GLB hash mismatch');
  }
  const exterior = original.assets.find((a) => a.id === dependency.assetId);
  if (!exterior) throw new Error('Exterior asset missing');
  const composed = structuredClone(supplement);
  composed.assets = [
    rewriteAsset(exterior, 'tools/assets/boardable-bus/'),
    ...supplement.assets.map((a) =>
      rewriteAsset(a, 'tools/assets/boardable-bus-v2/'),
    ),
  ];
  const vehicle = composed.vehicles[0];
  vehicle.assetRefs.exterior = exterior.id;
  vehicle.composition.exteriorFiles = composed.assets[0].lods.map(
    (l) => l.file,
  );
  vehicle.composition.interiorFiles = composed.assets[1].lods.map(
    (l) => l.file,
  );
  composed.pathBase = 'repository-root';
  composed.compositionScope =
    'Offline adapter view only; not a deployed runtime manifest';
  return composed;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(JSON.stringify(composeBusV2(), null, 2) + '\n');
