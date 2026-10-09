import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const METRO_PUBLIC_PREFIX = 'models/blender/metro/';
export const METRO_CONTRACT = 'skytrain-cabin-display-v1';
export const METRO_LAYOUT_SHA256 =
  '72273c99052fb68be38c436b76ab4663795dad452c07608826e39927b11b4538';
export const METRO_SOURCES = [
  {
    packageId: 'skytrain-mark-v-interior',
    revision: '28a23c86821a7502faa7425da6e430d625d97ac1',
    manifestSha256:
      'cce42ba145cd6b8385eb2e3aeb8cd6fe39fa8b7a56cf0a53c096b478d42c9cb5',
    assets: ['mark-v-a-car-interior'],
  },
  {
    packageId: 'canada-line-stage2',
    revision: 'b18c6b591adce8f5114daab5e19e60090b80bc23',
    manifestSha256:
      '7522ab7691beb92c1066f4684c86d1298a06f9f39cb1cd17a7d1fd33cb6f36aa',
    assets: ['canada-line-shared-interior', 'canada-line-endcar-exterior'],
  },
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const metroMetadataBytes = (metadata) =>
  Buffer.from(JSON.stringify(metadata, null, 2) + '\n');

export function readMetroGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}

/** Display cameras are anchored to exact exported nodes, never a vehicle or
 * boarding contract. Canada Line seated eyes use an explicit 0.59 m offset
 * above its authored pelvis nodes; Mark V uses the authored eye nodes. */
function viewpoint(doc, id, nodeId, kind, facingXZ, offsetM = [0, 0, 0]) {
  const node = doc.nodes.find((node) => node.name === nodeId);
  assert(
    node && node.mesh === undefined && node.translation?.length === 3,
    `Missing camera anchor ${nodeId}`,
  );
  return {
    id,
    kind,
    nodeId,
    offsetM,
    positionM: node.translation.map((value, i) => value + offsetM[i]),
    facingXZ,
  };
}

/** Reconstruct the small reviewed projection from pinned source manifests and
 * binary anchors. Production guards can compare metadata and the complete
 * inventory without trusting an edited public manifest. */
export async function loadMetroProjection(root = path.resolve('.')) {
  const assets = [],
    entries = [],
    sources = [],
    documents = new Map();
  for (const source of METRO_SOURCES) {
    const packagePath = `tools/assets/${source.packageId}`;
    const manifestBytes = await readFile(
      path.join(root, packagePath, 'manifest.json'),
    );
    assert.equal(
      hash(manifestBytes),
      source.manifestSha256,
      `Unreviewed metro manifest ${source.packageId}`,
    );
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.packageId, source.packageId);
    assert.equal(manifest.units, 'm');
    sources.push({
      packageId: source.packageId,
      packagePath,
      revision: source.revision,
      manifestSha256: source.manifestSha256,
    });
    for (const id of source.assets) {
      const asset = manifest.assets.find((asset) => asset.id === id);
      assert(asset, `Missing metro asset ${id}`);
      const lods = [];
      for (const level of [0, 1]) {
        const lod = asset.lods.find((lod) => lod.level === level);
        assert(lod, `Missing metro LOD ${id}/${level}`);
        const bytes = await readFile(path.join(root, packagePath, lod.file));
        assert.equal(hash(bytes), lod.sha256, `Changed metro GLB ${lod.file}`);
        assert.equal(bytes.length, lod.bytes);
        const sourceBytes = await readFile(
          path.join(root, packagePath, lod.source),
        );
        assert.equal(
          hash(sourceBytes),
          lod.sourceSha256,
          `Changed metro source ${lod.source}`,
        );
        const doc = readMetroGLB(bytes);
        const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
        assert.equal(primitives.length, lod.primitives);
        assert.equal(
          primitives.reduce(
            (n, p) => n + doc.accessors[p.indices].count / 3,
            0,
          ),
          lod.triangles,
        );
        assert(
          (doc.images || []).every(
            (image) => image.bufferView !== undefined && !image.uri,
          ),
          'Only embedded textures are allowed',
        );
        assert(
          !(doc.buffers || []).some((buffer) => buffer.uri),
          'Only self-contained GLBs are allowed',
        );
        documents.set(`${id}/${level}`, doc);
        const file = path.basename(lod.file);
        const materialNames = doc.materials.map((material) => material.name);
        lods.push({
          level,
          file,
          url: `/${METRO_PUBLIC_PREFIX}${file}`,
          sha256: lod.sha256,
          sourceSha256: lod.sourceSha256,
          bytes: lod.bytes,
          triangles: lod.triangles,
          primitives: lod.primitives,
          materialNames,
        });
        entries.push({
          path: `metro/${file}`,
          sha256: lod.sha256,
          bytes: lod.bytes,
          sourcePackage: source.packageId,
          sourcePath: `${packagePath}/${lod.file}`,
          sourceRevision: source.revision,
          sourceManifestSha256: source.manifestSha256,
        });
      }
      assets.push({ id, lods });
    }
  }
  const markDoc = documents.get('mark-v-a-car-interior/0');
  const layoutBytes = await readFile(
    path.join(
      root,
      'tools/assets/skytrain-mark-v-interior/layout-assumptions.json',
    ),
  );
  assert.equal(
    hash(layoutBytes),
    METRO_LAYOUT_SHA256,
    'Unreviewed Mark V seat facing layout',
  );
  const layout = JSON.parse(layoutBytes);
  const markViews = [
    viewpoint(markDoc, 'standing', 'camera-aisle', 'standing', [0, -1]),
    ...layout.seats.map((seat) =>
      viewpoint(markDoc, seat.id, `${seat.id}-camera`, 'seat', seat.facingXZ),
    ),
  ];
  const canadaDoc = documents.get('canada-line-shared-interior/0');
  const canadaSeats = canadaDoc.nodes.filter((node) =>
    /^seat-(left|right)-\d+-pelvis$/.test(node.name),
  );
  const canadaViews = [
    viewpoint(canadaDoc, 'standing', 'aisle-eye', 'standing', [0, 1]),
    ...canadaSeats.map((node) =>
      viewpoint(
        canadaDoc,
        node.name.replace('-pelvis', ''),
        node.name,
        'seat',
        node.name.includes('-left-') ? [-1, 0] : [1, 0],
        [0, 0.59, 0],
      ),
    ),
  ];
  assert.equal(markViews.filter((view) => view.kind === 'seat').length, 22);
  assert.equal(canadaViews.filter((view) => view.kind === 'seat').length, 20);
  for (const [asset, views] of [
    ['mark-v-a-car-interior', markViews],
    ['canada-line-shared-interior', canadaViews],
  ]) {
    for (const view of views) {
      const atLOD1 = viewpoint(
        documents.get(`${String(asset)}/1`),
        view.id,
        view.nodeId,
        view.kind,
        view.facingXZ,
        view.offsetM,
      );
      assert.deepEqual(atLOD1, view, `Camera changed across LODs ${view.id}`);
    }
  }
  const metadata = {
    schemaVersion: 1,
    contract: METRO_CONTRACT,
    units: 'm',
    scope: 'single-cabin-display',
    boardingEnabled: false,
    serviceEnabled: false,
    intercarTraversalEnabled: false,
    coordinateSystem: {
      upAxis: '+Y',
      frontAxis: '+Z',
      cameras:
        'Exported metre anchors; no scene scaling or floor datum conversion',
    },
    provenance: {
      project: 'Vancouver Living Atlas by YiTaChen',
      source: 'https://github.com/YiTaChen/vancouver-living-atlas',
      license:
        'Vancouver Living Atlas Noncommercial Research and Attribution 1.0',
      referencePixelsDistributed: false,
      layoutSha256: hash(layoutBytes),
    },
    sources,
    assets,
    cabins: [
      {
        id: 'mark-v',
        interiorId: 'mark-v-a-car-interior',
        exteriorId: null,
        seatCount: 22,
        defaultViewpoint: 'standing',
        viewpoints: markViews,
      },
      {
        id: 'canada-line',
        interiorId: 'canada-line-shared-interior',
        exteriorId: 'canada-line-endcar-exterior',
        seatCount: 20,
        defaultViewpoint: 'standing',
        viewpoints: canadaViews,
      },
    ],
  };
  const metadataBytes = metroMetadataBytes(metadata);
  entries.push({
    path: 'metro/manifest.json',
    sha256: hash(metadataBytes),
    bytes: metadataBytes.length,
    sourcePackage: 'skytrain-cabin-display',
    sourcePath:
      'canonical projection of tools/assets/skytrain-mark-v-interior/manifest.json + tools/assets/canada-line-stage2/manifest.json',
    sourceRevision: METRO_SOURCES[0].revision,
    sourceManifestSha256: hash(
      Buffer.from(
        METRO_SOURCES.map((source) => source.manifestSha256).join('\n'),
      ),
    ),
    sourceManifests: sources.map(({ packageId, revision, manifestSha256 }) => ({
      packageId,
      revision,
      manifestSha256,
    })),
  });
  return { metadata, metadataBytes, entries };
}

export async function writeMetroProjection(root = path.resolve('.')) {
  const projection = await loadMetroProjection(root),
    destination = path.join(root, 'public', METRO_PUBLIC_PREFIX);
  await mkdir(destination, { recursive: true });
  for (const entry of projection.entries.filter((entry) =>
    entry.path.endsWith('.glb'),
  ))
    await copyFile(
      path.join(root, entry.sourcePath),
      path.join(destination, path.basename(entry.path)),
    );
  await writeFile(
    path.join(destination, 'manifest.json'),
    projection.metadataBytes,
  );
  return projection;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const projection = await writeMetroProjection();
  console.log(
    JSON.stringify({
      status: 'pass',
      files: projection.entries.length,
      geometryBytes: projection.entries
        .filter((entry) => entry.path.endsWith('.glb'))
        .reduce((n, entry) => n + entry.bytes, 0),
      metadataBytes: projection.metadataBytes.length,
    }),
  );
}
