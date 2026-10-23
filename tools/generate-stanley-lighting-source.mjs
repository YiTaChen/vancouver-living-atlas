import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Offline derivation from the exact municipal response retained beside its
// retrieval receipt. Refresh source bytes/receipt deliberately before running.
const directory = new URL('./sources/stanley-lighting/', import.meta.url);
const receipt = JSON.parse(readFileSync(new URL('receipt.json', directory)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const [name, expected] of Object.entries(receipt.files)) {
  const bytes = readFileSync(new URL(name, directory));
  if (bytes.byteLength !== expected.bytes || hash(bytes) !== expected.sha256)
    throw new Error(`Source receipt mismatch: ${name}`);
}
const parkBytes = readFileSync(
  new URL('../public/data/parks.geojson', import.meta.url),
);
if (hash(parkBytes) !== receipt.selection.polygonSha256)
  throw new Error('Park boundary changed: review the source selection receipt');
const parks = JSON.parse(parkBytes).features.filter(
  (feature) => feature.properties.name === receipt.selection.parkName,
);
function inside(point, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
const polygons = parks.flatMap((feature) =>
  feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates
    : [feature.geometry.coordinates],
);
const regional = JSON.parse(
  readFileSync(new URL('regional-poles.geojson', directory)),
);
const records = regional.features
  .filter((feature) =>
    polygons.some(
      (polygon) =>
        inside(feature.geometry.coordinates, polygon[0]) &&
        !polygon
          .slice(1)
          .some((ring) => inside(feature.geometry.coordinates, ring)),
    ),
  )
  .map((feature) => ({
    id: `${feature.properties.block_number}:${feature.properties.node_number}`,
    block: feature.properties.block_number,
    node: feature.properties.node_number,
    coordinates: feature.geometry.coordinates,
  }))
  .sort((a, b) => a.id.localeCompare(b.id, 'en'));
if (
  records.length !== 103 ||
  new Set(records.map((record) => record.id)).size !== 103
)
  throw new Error(
    'Expected 103 unique current in-park inventory records; review changes',
  );
const output =
  JSON.stringify(
    {
      schema: 1,
      publisher: receipt.publisher,
      dataset: receipt.dataset,
      sourceUrl: receipt.datasetPage,
      retrievedAt: receipt.retrievedAt,
      sourceSha256: receipt.files['regional-poles.geojson'].sha256,
      parkSha256: receipt.selection.polygonSha256,
      license: receipt.license,
      licenseUrl: receipt.licenseUrl,
      regionalRecordCount: regional.features.length,
      records,
    },
    null,
    2,
  ) + '\n';
const destination = new URL(
  '../lib/city/stanley-lighting-source.json',
  import.meta.url,
);
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== output)
    throw new Error('Generated Stanley lighting source is stale');
} else writeFileSync(destination, output);
console.log(
  `${records.length} in-park records from ${regional.features.length} regional records; verified source SHA-256 ${receipt.files['regional-poles.geojson'].sha256}`,
);
