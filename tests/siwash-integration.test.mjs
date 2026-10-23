import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { disposeGroup } from './helpers/landmark-test-utils.mjs';

const { createLandmarks } = await import(cityModule('landmarks'));
const { project, rings, inPolygon } = await import(cityModule('geo'));
const { WaterWorld, lakeSurfaces } = await import(cityModule('water-world'));
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);
const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { SIWASH_ROCK_PLACEMENT } = await import(
  cityModule('assets/siwash-rock')
);

// Execute the same production bridge builders separately, so the landmark
// integration must preserve every boat footprint and flight collision volume.
// The reference is the current bridge contract, not a duplicated bridge model.
const source = readFileSync('lib/city/landmarks.ts', 'utf8'),
  ast = ts.createSourceFile(
    'landmarks.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  ),
  builder = ast.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'Builder',
  ),
  bridge = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'bridge',
  );
assert(builder && bridge);
const code = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}';
   import { mergeGeometries } from '${import.meta.resolve('three/addons/utils/BufferGeometryUtils.js')}';
   import { project } from '${cityModule('geo')}';
   export ${builder.getText(ast)}
   export ${bridge.getText(ast)}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const Bridge = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const json = (name) => JSON.parse(readFileSync(`public/data/${name}.geojson`));

function host() {
  const e = {
    landmarks: new THREE.Group(),
    terrain: new THREE.Group(),
    roads: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    settings: { quality: 'balanced', qualityMode: 'auto', buildings: true },
    renderer: { shadowMap: { needsUpdate: false } },
    uniforms: { night: { value: 0 } },
    data: { bridges: JSON.parse(readFileSync('public/data/bridges.json')) },
    landmarkDetails: [],
    elevation: cityElevation,
  };
  // Explicit actual-surface fixtures support the two mandatory entry resolvers.
  // They never enter the source shoreline, boat or flight collision data.
  for (const [lon, lat, height] of [
    [-123.117146, 49.287449, 16],
    [-123.1039114, 49.2733499, 4.2],
  ]) {
    const [x, z] = project([lon, lat]),
      r = 75,
      geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [
            x - r,
            height,
            z - r,
            x - r,
            height,
            z + r,
            x + r,
            height,
            z + r,
            x - r,
            height,
            z - r,
            x + r,
            height,
            z + r,
            x + r,
            height,
            z - r,
          ],
          3,
        ),
      ),
      mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.userData.walkSurface = true;
    e.terrain.add(mesh);
  }
  const [x, z] = project([
    SIWASH_ROCK_PLACEMENT.lon,
    SIWASH_ROCK_PLACEMENT.lat,
  ]);
  e.camera.position.set(x + 42, 18, z + 42);
  return e;
}

test('actual city integration aligns Siwash with its existing source island and preserves coast, bridge collisions and navigable water', () => {
  const e = host(),
    bridgeHost = {
      data: {},
      landmarks: new THREE.Group(),
      elevation: cityElevation,
    },
    b = new Bridge.Builder(bridgeHost),
    bridgeBytes = JSON.stringify(e.data.bridges),
    coast = JSON.parse(readFileSync('public/data/beach-coast.json')),
    land = coast.land,
    context = json('context'),
    regional = json('context-land'),
    sourceBytes = JSON.stringify({ coast, context, regional }),
    core = land.features.flatMap((f) =>
      rings(f).map((poly) => poly.map((r) => r.map(project))),
    ),
    water = new WaterWorld(
      core,
      regional,
      lakeSurfaces(context, cityElevation),
      { features: [] },
      { features: [] },
    );
  b.collisionScope = true;
  for (const spine of e.data.bridges.mainSpines)
    Bridge.bridge(
      b,
      bridgeHost,
      spine.start,
      spine.end,
      spine.estimatedDeckM,
      spine.kind,
    );
  b.finish();
  try {
    createLandmarks(e);
    const detail = e.siwashRock;
    assert(detail, 'production createLandmarks attaches the owner');
    assert.equal(detail.holder.parent, e.landmarks);
    assert.equal(
      detail.activeLevel,
      'medium',
      'default Auto/balanced sees the improved nearby silhouette',
    );
    const [x, z] = project([
      SIWASH_ROCK_PLACEMENT.lon,
      SIWASH_ROCK_PLACEMENT.lat,
    ]);
    assert.equal(detail.holder.position.x, x);
    assert.equal(detail.holder.position.z, z);
    const sourceIsland = rings(land.features[0])[1].map((ring) =>
      ring.map(project),
    );
    assert.equal(inPolygon([x, z], sourceIsland), true);
    assert.equal(
      water.at(x, z),
      null,
      'the actual engine already treats the mapped rock as land',
    );
    assert.equal(
      water.canOccupy(...project([-123.1563153459, 49.3087458578]), 0),
      true,
      'open water west of the existing island stays navigable',
    );
    // Model overhang may cover its intertidal edge, while the original physical
    // land footprint remains authoritative and the narrow offshore gap stays.
    for (const group of Object.values(detail.levels)) {
      group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(group);
      assert(bounds.max.x - bounds.min.x < 12);
      assert(bounds.max.z - bounds.min.z < 12);
      assert(bounds.min.x < x && bounds.max.x > x);
      assert(bounds.min.z < z && bounds.max.z > z);
    }
    const viewpoint = project([-123.1557885, 49.3084431]);
    assert.equal(
      water.at(...viewpoint),
      null,
      'source lookout endpoint remains connected mainland',
    );
    const official = project([
      -(123 + 9 / 60 + 21 / 3600),
      49 + 18 / 60 + 31 / 3600,
    ]);
    assert(
      Math.hypot(x - official[0], z - official[1]) < 39,
      'bounded rendering offset from approximate primary marker',
    );
    assert.deepEqual(
      e.data.flightBridgeVolumes,
      bridgeHost.data.flightBridgeVolumes,
    );
    const bridgeFootprints = bridgeHost.data.solidWaterFootprints;
    assert.deepEqual(
      e.data.solidWaterFootprints.slice(-bridgeFootprints.length),
      bridgeFootprints,
    );
    for (const footprint of e.data.solidWaterFootprints)
      assert.equal(
        inPolygon([x, z], footprint),
        false,
        'Siwash adds no new invisible boat obstruction',
      );
    assert.equal(JSON.stringify(e.data.bridges), bridgeBytes);
    assert.equal(JSON.stringify({ coast, context, regional }), sourceBytes);
  } finally {
    e.siwashRock?.dispose();
    for (const detail of e.landmarkDetails) detail.disposePending();
    disposeGroup(e.landmarks);
    disposeGroup(e.terrain);
    disposeGroup(bridgeHost.landmarks);
  }
});

test('all Siwash levels share existing night/cutaway enrollment and release owner references on disposal', () => {
  const e = host();
  createLandmarks(e);
  const detail = e.siwashRock,
    meshes = Object.values(detail.levels).map((group) => group.children[0]),
    lighting = new NightStreetLighting({
      bounds: { minX: -2100, maxX: -2000, minZ: -2600, maxZ: -2500 },
      lamps: [],
      allowed: () => false,
    });
  for (const mesh of meshes) lighting.wrapMaterial(mesh.material);
  const cutaway = new TravelOcclusion([e.landmarks]),
    before = cutaway.snapshot(),
    nodes = [];
  detail.holder.traverse((object) => nodes.push(object));
  const disposed = { geometry: 0, material: 0 };
  for (const mesh of meshes) {
    mesh.geometry.addEventListener('dispose', () => disposed.geometry++);
    mesh.material.addEventListener('dispose', () => disposed.material++);
  }
  try {
    assert.equal(lighting.stats().wrappedMaterials, 3);
    const identities = meshes.map((mesh) => [mesh.geometry, mesh.material]);
    for (const quality of ['balanced', 'high', 'ultra', 'balanced']) {
      e.settings.quality = quality;
      detail.update();
      assert.equal(
        Object.values(detail.levels).filter((group) => group.visible).length,
        1,
      );
      assert.deepEqual(
        meshes.map((mesh) => [mesh.geometry, mesh.material]),
        identities,
      );
      assert.equal(cutaway.snapshot().meshCount, before.meshCount);
    }
    detail.dispose();
    detail.dispose();
    assert.deepEqual(disposed, { geometry: 3, material: 3 });
    assert.equal(detail.holder.parent, null);
    assert.equal(lighting.stats().wrappedMaterials, 0);
    assert.equal(cutaway.snapshot().meshCount, before.meshCount - 3);
    assert.equal(
      cutaway.snapshot().watchedObjects,
      before.watchedObjects - nodes.length,
    );
    for (const object of nodes)
      for (const type of ['childadded', 'childremoved', 'removed'])
        assert.equal(object._listeners?.[type]?.length ?? 0, 0);
  } finally {
    cutaway.dispose();
    lighting.dispose();
    detail.dispose();
    for (const landmark of e.landmarkDetails) landmark.disposePending();
    disposeGroup(e.landmarks);
    disposeGroup(e.terrain);
  }
});
