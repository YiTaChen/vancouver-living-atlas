import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUS_CLOSEUP_SOURCE_REVISION =
  '78790023c4cf6e5f12aaf2666ea74dd47336dbd8';
export const BUS_CLOSEUP_SOURCE_MANIFEST_SHA256 =
  '2d3a1abbbc35ddc161a154c0a262b42493fe2601c368dde05cd6b3a81b699726';
export const BUS_CLOSEUP_SOURCE_PATH =
  'tools/assets/boardable-bus-v2/closeup-quality';
export const BUS_CLOSEUP_PUBLIC_PREFIX = 'models/blender/bus-closeup/';
export const BUS_CLOSEUP_RUNTIME_CONTRACT = 'boardable-bus-closeup-runtime-v1';
export const BUS_CLOSEUP_REVIEWED_LODS = [
  {
    level: 0,
    triangles: 277040,
    bytes: 8508968,
    primitives: 13,
    sha256: '8174cf56646eec303ad1891222cbd056d8ddea1e593c9a1e7ce70bc77a524a6d',
  },
  {
    level: 1,
    triangles: 91504,
    bytes: 2955124,
    primitives: 13,
    sha256: '7ab9103a047a7acd48f78433e3b982a475592e2f6a747e1c7533685b4053de45',
  },
];
const EXTERIOR_MANIFEST_SHA256 =
  '32a35e7fdaa0f82600f8d161212b952177fae8515ca8095b2d55be118503076e';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const select = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object[key]]));
export const busCloseupMetadataBytes = (metadata) =>
  Buffer.from(JSON.stringify(metadata, null, 2) + '\n');

export function readBusCloseupGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Closeup GLB signature');
  assert.equal(bytes.readUInt32LE(4), 2, 'Closeup GLB version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'Closeup GLB byte count');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'Closeup GLB JSON chunk');
  const length = bytes.readUInt32LE(12);
  assert.equal(
    bytes.readUInt32LE(24 + length),
    0x004e4942,
    'Closeup GLB binary chunk',
  );
  return {
    doc: JSON.parse(bytes.subarray(20, 20 + length).toString()),
    binary: bytes.subarray(28 + length),
  };
}
function accessor(doc, binary, index) {
  const item = doc.accessors[index],
    view = doc.bufferViews[item.bufferView];
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[item.type];
  const [size, method] = {
    5121: [1, 'readUInt8'],
    5123: [2, 'readUInt16LE'],
    5125: [4, 'readUInt32LE'],
    5126: [4, 'readFloatLE'],
  }[item.componentType];
  const offset = (view.byteOffset || 0) + (item.byteOffset || 0),
    stride = view.byteStride || dimensions * size;
  return Array.from({ length: item.count }, (_, i) =>
    Array.from({ length: dimensions }, (_, axis) =>
      binary[method](offset + i * stride + axis * size),
    ),
  );
}
function insideXZ(point, a, b, c) {
  const cross = (p, q, r) =>
    (q[0] - p[0]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[0] - p[0]);
  const area = cross(a, b, c);
  if (Math.abs(area) < 1e-10) return false;
  const values = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
  return values.every((value) => (area > 0 ? value >= -1e-7 : value <= 1e-7));
}

/** Audit the actual exported binary, including all semantic nodes and supported
 * floor patches. These are static support samples, not moving boarding tests. */
export function auditBusCloseupGLB(bytes, lod, vehicle, texture) {
  const { doc, binary } = readBusCloseupGLB(bytes);
  const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
  assert.equal(primitives.length, 13, 'Closeup material primitive inventory');
  assert.equal(
    primitives.reduce(
      (count, primitive) => count + doc.accessors[primitive.indices].count / 3,
      0,
    ),
    lod.triangles,
    'Closeup actual triangle count',
  );
  assert.equal(doc.materials.length, 13, 'Closeup material count');
  assert(
    !doc.materials.some((material) => material.extensions?.KHR_materials_unlit),
    'Closeup PBR materials must remain lit',
  );
  assert(
    (doc.buffers || []).every((buffer) => buffer.uri === undefined),
    'Closeup GLB must be self-contained',
  );
  const names = doc.nodes.map((node) => node.name);
  assert.equal(
    new Set(names).size,
    names.length,
    'Closeup unique node identities',
  );
  const anchors = doc.nodes.filter((node) => node.mesh === undefined);
  assert.equal(anchors.length, 82, 'Closeup exact exported anchor inventory');
  const root = anchors.find((node) => node.name === 'vehicle');
  assert(
    root && !root.matrix && !root.translation && !root.rotation && !root.scale,
    'Closeup identity metre vehicle frame',
  );
  const anchor = (id, point) => {
    const node = anchors.find((node) => node.name === id);
    assert(
      node?.translation &&
        node.translation.every(
          (value, index) => Math.abs(value - point[index]) < 0.00002,
        ),
      `Closeup actual anchor ${id}`,
    );
  };
  assert.equal(vehicle.seats.length, 24, 'Closeup active seat inventory');
  for (const seat of vehicle.seats) {
    anchor(seat.pelvisAnchorNodeId, seat.pelvisPointM);
    anchor(seat.cameraAnchorNodeId, seat.cameraEyePointM);
    assert(
      anchors.some((node) => node.name === seat.nodeId),
      'Closeup seat geometry anchor',
    );
  }
  for (const camera of vehicle.cameraAnchors)
    anchor(camera.nodeId, camera.eyePointM);
  anchor('driver-pelvis', vehicle.driver.pelvisPointM);
  anchor('standing-center', vehicle.standingRegions[0].feetPointM);
  anchor(
    'wheelchair-reference',
    vehicle.reservedAccessibilityRegions[0].feetPointM,
  );
  for (const item of vehicle.anchors.filter((item) =>
    /^(boarding|doorway)-/.test(item.nodeId),
  ))
    anchor(item.nodeId, item.pointM);
  assert.equal(
    vehicle.standingRegions.length,
    1,
    'Closeup raised rear remains seated only',
  );
  assert(
    vehicle.nonStandingRegions.every(
      (region) => region.standingAllowed === false,
    ),
    'Closeup non-standing regions',
  );
  assert.equal(
    vehicle.floorSurfaces.length,
    6,
    'Closeup all floor, step and threshold support surfaces',
  );
  const floorIndex = doc.materials.findIndex(
    (material) => material.name === 'floor',
  );
  const floor = primitives.find(
    (primitive) => primitive.material === floorIndex,
  );
  assert(
    floor?.attributes.TEXCOORD_0 !== undefined,
    'Closeup floor has authored UVs',
  );
  const positions = accessor(doc, binary, floor.attributes.POSITION),
    indices = accessor(doc, binary, floor.indices).flat();
  for (const surface of vehicle.floorSurfaces) {
    const center = surface.verticesM.reduce(
      (result, point) =>
        result.map(
          (value, axis) => value + point[axis] / surface.verticesM.length,
        ),
      [0, 0, 0],
    );
    const probes = [
      center,
      ...surface.verticesM.map((point) =>
        point.map((value, axis) => value * 0.999 + center[axis] * 0.001),
      ),
    ];
    for (const probe of probes) {
      let supported = false;
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices
          .slice(i, i + 3)
          .map((index) => positions[index]);
        if (
          triangle.every((point) => Math.abs(point[1] - probe[1]) < 0.00002) &&
          insideXZ(probe, ...triangle)
        ) {
          supported = true;
          break;
        }
      }
      assert(supported, `Closeup floor support ${surface.surfaceId}`);
    }
  }
  assert.equal(doc.images.length, 1, 'Closeup exact embedded image count');
  assert.equal(doc.textures.length, 1, 'Closeup exact texture count');
  const image = doc.images[0];
  assert.equal(image.mimeType, 'image/png');
  assert(
    image.bufferView !== undefined && image.uri === undefined,
    'Closeup floor texture must be embedded',
  );
  const view = doc.bufferViews[image.bufferView],
    png = binary.subarray(
      view.byteOffset || 0,
      (view.byteOffset || 0) + view.byteLength,
    );
  assert.equal(
    hash(png),
    texture.sourceSha256,
    'Closeup embedded floor PNG differs from source',
  );
  assert.equal(
    png.length,
    98020,
    'Closeup embedded floor texture measured bytes',
  );
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
  assert.equal(
    doc.materials[floorIndex].pbrMetallicRoughness.baseColorTexture.index,
    0,
  );
  assert.equal(
    doc.materials[floorIndex].pbrMetallicRoughness.baseColorFactor,
    undefined,
    'Closeup floor keeps neutral base colour for sRGB texture',
  );
  return {
    anchorCount: anchors.length,
    anchorNodeNames: anchors.map((node) => node.name).sort(),
    floorSupportSurfaces: vehicle.floorSurfaces.length,
    floorTextureSha256: hash(png),
    embeddedImageBytes: png.length,
  };
}

/** Full source vehicle safety metadata is preserved. Only runtime file paths
 * and the separately named visit-only profile are projected into public URLs. */
export function projectBusCloseupRuntimeMetadata(
  manifest,
  exterior,
  inputs,
  audit,
) {
  const sourceAssets = [
    exterior.assets.find((asset) => asset.id === 'city-bus-12m-exterior'),
    ...manifest.assets,
  ];
  const assets = sourceAssets.map((asset) => ({
    ...clone(
      select(asset, [
        'id',
        'kind',
        'boundsM',
        'pivot',
        'attachmentDatum',
        'frontAxis',
        'materialBindings',
        'lodPolicy',
      ]),
    ),
    ...(asset.id === 'city-bus-12m-interior-v2-closeup'
      ? clone(select(asset, ['appearance', 'textureMode', 'textureCost']))
      : {}),
    lods: asset.lods.map((lod) => ({
      ...clone(
        select(lod, [
          'level',
          'sha256',
          'bytes',
          'triangles',
          'primitives',
          'boundsM',
          'capabilities',
        ]),
      ),
      ...(asset.id === 'city-bus-12m-interior-v2-closeup'
        ? clone(select(lod, ['sourceSha256', 'embeddedImageBytes']))
        : {}),
      file: path.basename(lod.file),
      url: `/models/blender/${asset.id === 'city-bus-12m-exterior' ? 'bus' : 'bus-closeup'}/${path.basename(lod.file)}`,
    })),
  }));
  const vehicles = clone(manifest.vehicles);
  for (const vehicle of vehicles) {
    vehicle.assetRefs.exterior = 'city-bus-12m-exterior';
    for (const field of ['exteriorFiles', 'interiorFiles', 'collisionFiles'])
      vehicle.composition[field] = vehicle.composition[field].map((file) =>
        path.basename(file),
      );
  }
  return {
    schemaVersion: 1,
    contract: BUS_CLOSEUP_RUNTIME_CONTRACT,
    packageId: manifest.packageId,
    version: manifest.version,
    units: manifest.units,
    runtimeScope: 'nearby-bus-visit-only',
    fleetAllowed: false,
    coordinateSystem: { runtime: manifest.coordinateSystem.runtime },
    provenance: clone(
      select(manifest.provenance, [
        'authoring',
        'project',
        'source',
        'license',
        'derivative',
      ]),
    ),
    source: {
      packagePath: BUS_CLOSEUP_SOURCE_PATH,
      manifestPath: `${BUS_CLOSEUP_SOURCE_PATH}/manifest.json`,
      manifestSha256: BUS_CLOSEUP_SOURCE_MANIFEST_SHA256,
      assetRevision: BUS_CLOSEUP_SOURCE_REVISION,
      inputs,
    },
    textures: manifest.textures.map((texture) => ({
      ...clone(
        select(texture, [
          'textureId',
          'sourceSha256',
          'width',
          'height',
          'colorSpace',
          'semantic',
          'scope',
        ]),
      ),
      embedded: true,
    })),
    audit,
    assets,
    vehicles,
  };
}

export function busCloseupAdoptionEntries(manifest, metadataBytes) {
  const common = {
    sourcePackage: 'boardable-bus-v2-closeup-quality',
    sourceRevision: BUS_CLOSEUP_SOURCE_REVISION,
    sourceManifestSha256: BUS_CLOSEUP_SOURCE_MANIFEST_SHA256,
  };
  return [
    ...manifest.assets[0].lods.map((lod) => ({
      path: `bus-closeup/${path.basename(lod.file)}`,
      sha256: lod.sha256,
      bytes: lod.bytes,
      ...common,
      sourcePath: `${BUS_CLOSEUP_SOURCE_PATH}/${lod.file}`,
    })),
    {
      path: 'bus-closeup/manifest.json',
      sha256: hash(metadataBytes),
      bytes: metadataBytes.length,
      ...common,
      sourcePath: `canonical projection of ${BUS_CLOSEUP_SOURCE_PATH}/manifest.json`,
    },
  ];
}

export async function loadBusCloseupProjection(root = path.resolve('.')) {
  const inputs = [];
  const pinned = async (file, sha256, expectedBytes) => {
    const location = path.join(root, file),
      info = await lstat(location);
    assert(
      info.isFile() && !info.isSymbolicLink(),
      `Closeup source must be a regular file: ${file}`,
    );
    const bytes = await readFile(location);
    assert.equal(hash(bytes), sha256, `Closeup pinned source changed: ${file}`);
    if (expectedBytes !== undefined)
      assert.equal(
        bytes.length,
        expectedBytes,
        `Closeup source byte count changed: ${file}`,
      );
    inputs.push({ file, sha256, bytes: bytes.length });
    return bytes;
  };
  const source = await pinned(
      `${BUS_CLOSEUP_SOURCE_PATH}/manifest.json`,
      BUS_CLOSEUP_SOURCE_MANIFEST_SHA256,
    ),
    manifest = JSON.parse(source);
  assert.equal(manifest.packageId, 'boardable-bus-v2-closeup-quality');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.units, 'm');
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].id, 'city-bus-12m-interior-v2-closeup');
  assert.equal(manifest.dependencies.length, 1);
  const dependency = manifest.dependencies[0];
  assert.equal(dependency.manifest, '../../boardable-bus/manifest.json');
  assert.equal(dependency.packageId, 'boardable-bus');
  assert.equal(dependency.manifestSha256, EXTERIOR_MANIFEST_SHA256);
  const exterior = JSON.parse(
    await pinned(
      'tools/assets/boardable-bus/manifest.json',
      EXTERIOR_MANIFEST_SHA256,
    ),
  );
  const exteriorAsset = exterior.assets.find(
    (asset) => asset.id === 'city-bus-12m-exterior',
  );
  assert.equal(dependency.files.length, 3);
  for (const [level, file] of dependency.files.entries()) {
    const lod = exteriorAsset.lods[level];
    assert.equal(file.file, `../../boardable-bus/${lod.file}`);
    assert.equal(file.sha256, lod.sha256);
    await pinned(
      `tools/assets/boardable-bus/${lod.file}`,
      file.sha256,
      lod.bytes,
    );
  }
  assert.equal(manifest.textures.length, 1);
  const texture = manifest.textures[0];
  assert.equal(texture.source, 'source/floor-speckle.png');
  assert.equal(texture.width, 256);
  assert.equal(texture.height, 256);
  assert.equal(texture.colorSpace, 'sRGB');
  assert.equal(texture.semantic, 'baseColor');
  await pinned(
    `${BUS_CLOSEUP_SOURCE_PATH}/${texture.source}`,
    texture.sourceSha256,
    98020,
  );
  assert.deepEqual(
    manifest.assets[0].lods.map((lod) => lod.level),
    [0, 1],
  );
  const audits = [];
  for (const lod of manifest.assets[0].lods) {
    assert.equal(
      lod.file,
      `exports/city-bus-12m-interior-v2-closeup.lod${lod.level}.glb`,
    );
    assert.deepEqual(
      select(lod, ['level', 'triangles', 'bytes', 'primitives', 'sha256']),
      BUS_CLOSEUP_REVIEWED_LODS[lod.level],
      'Only exact reviewed closeup geometry costs are approved; original B-CAB caps remain unchanged',
    );
    const exported = await pinned(
      `${BUS_CLOSEUP_SOURCE_PATH}/${lod.file}`,
      lod.sha256,
      lod.bytes,
    );
    await pinned(
      `${BUS_CLOSEUP_SOURCE_PATH}/${lod.source}`,
      lod.sourceSha256,
      lod.sourceBytes,
    );
    const sidecar = JSON.parse(
      await pinned(
        `${BUS_CLOSEUP_SOURCE_PATH}/${lod.componentSidecar.file}`,
        lod.componentSidecar.sha256,
        lod.componentSidecar.bytes,
      ),
    );
    assert.equal(
      sidecar.glbSha256,
      lod.sha256,
      'Closeup component provenance must match actual GLB',
    );
    audits.push(
      auditBusCloseupGLB(exported, lod, manifest.vehicles[0], texture),
    );
  }
  assert.deepEqual(
    audits[0],
    audits[1],
    'Closeup semantic anchors and floor texture are equal across both LODs',
  );
  const metadata = projectBusCloseupRuntimeMetadata(
      manifest,
      exterior,
      inputs,
      audits[0],
    ),
    metadataBytes = busCloseupMetadataBytes(metadata),
    entries = busCloseupAdoptionEntries(manifest, metadataBytes);
  return { manifest, metadata, metadataBytes, entries };
}

export async function writeBusCloseupProjection(
  output = path.resolve('public'),
) {
  const projection = await loadBusCloseupProjection(),
    directory = path.join(output, BUS_CLOSEUP_PUBLIC_PREFIX);
  await mkdir(directory, { recursive: true });
  for (const lod of projection.manifest.assets[0].lods)
    await copyFile(
      `${BUS_CLOSEUP_SOURCE_PATH}/${lod.file}`,
      path.join(directory, path.basename(lod.file)),
    );
  await writeFile(
    path.join(directory, 'manifest.json'),
    projection.metadataBytes,
  );
  return projection;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const projection = await writeBusCloseupProjection(
    process.argv[2] ? path.resolve(process.argv[2]) : undefined,
  );
  console.log(
    JSON.stringify({
      status: 'pass',
      files: projection.entries.length,
      geometryBytes: projection.entries
        .filter((entry) => entry.path.endsWith('.glb'))
        .reduce((count, entry) => count + entry.bytes, 0),
      metadataBytes: projection.metadataBytes.length,
    }),
  );
}
