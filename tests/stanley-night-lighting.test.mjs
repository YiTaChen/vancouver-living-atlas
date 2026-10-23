import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  STANLEY_LIGHTING_SOURCE,
  stanleySourcePoles,
  reconcileStanleyStreetLamps,
  createStanleyNightPolicy,
  stanleyNightBounds,
} = await import(cityModule('stanley-night-lighting'));
const { NightStreetLighting, NIGHT_STREET_FIELD_MAX_BYTES } = await import(
  cityModule('night-street-lighting')
);
const { createStreetLampDamage } = await import(cityModule('environment'));
const { project, rings } = await import(cityModule('geo'));
const { streetLampHead } = await import(cityModule('downtown-night-policy'));
const { BeachGround } = await import(cityModule('beach-ground'));
const features = (name) =>
  JSON.parse(readFileSync(`public/data/${name}.geojson`)).features;
const polygons = (source) =>
  source.flatMap((feature) =>
    rings(feature).map((polygon) => polygon.map((ring) => ring.map(project))),
  );
const park = polygons(
  features('parks').filter(
    (feature) => feature.properties.name === 'Stanley Park',
  ),
);
const water = polygons(
  features('context').filter((feature) => feature.properties.class === 'water'),
);
// Replay the trusted runtime geographic methods, including the beach-surface
// land convention. The original land.geojson is not the current runtime coast.
const coast = JSON.parse(readFileSync('public/data/beach-coast.json')),
  engineText = readFileSync('lib/city/engine.ts', 'utf8'),
  engineAst = ts.createSourceFile(
    'engine.ts',
    engineText,
    ts.ScriptTarget.Latest,
    true,
  ),
  engineClass = engineAst.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CityEngine',
  );
assert(engineClass);
const geographicMethods = ['rawElevation', 'onLand'].map((name) => {
  const method = engineClass.members.find(
    (node) => node.name?.getText(engineAst) === name,
  );
  assert(method);
  return method.getText(engineAst);
});
const geographicCode = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}';
   import { unproject, inPolygon } from '${cityModule('geo')}';
   export class GeographicProbe { ${geographicMethods.join('\n')} }`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { GeographicProbe } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(geographicCode).toString('base64')
);
const geography = new GeographicProbe();
geography.data = {
  elevation: JSON.parse(readFileSync('public/data/terrain.json')),
};
geography.landPolys = polygons(coast.land.features);
geography.beachGround = new BeachGround(coast);
const allowed = createStanleyNightPolicy(park, water, (x, z) =>
  geography.onLand(x, z),
);
const inventoryPoles = stanleySourcePoles();
const sourcePoles = reconcileStanleyStreetLamps(
  [],
  park,
  { nodes: [], edges: [] },
  (x, z) => geography.onLand(x, z),
).sourcePoles;
const parkOptions = {
  lamps: sourcePoles.map((pole) => ({
    ...streetLampHead(...pole.point, 0, 6),
    groundY: 5,
  })),
  bounds: stanleyNightBounds(),
  allowed,
};
const downtown = {
  bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
  size: 64,
  lamps: [{ x: 30, y: 13.85, z: 50 }],
  allowed: () => true,
  roads: [{ a: [0, 5, 50], b: [100, 5, 50], width: 10 }],
};
function shaderFor(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('official source inventory is reproducible from exact licensed response bytes and current polygon', () => {
  const directory = 'tools/sources/stanley-lighting/',
    receipt = JSON.parse(readFileSync(`${directory}receipt.json`));
  for (const [file, expected] of Object.entries(receipt.files)) {
    const bytes = readFileSync(`${directory}${file}`);
    assert.equal(bytes.byteLength, expected.bytes);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expected.sha256,
    );
    assert(expected.url.startsWith('https://opendata.vancouver.ca/api/'));
  }
  assert.equal(STANLEY_LIGHTING_SOURCE.publisher, 'City of Vancouver');
  assert.equal(
    STANLEY_LIGHTING_SOURCE.license,
    'Open Government Licence - Vancouver',
  );
  assert.equal(STANLEY_LIGHTING_SOURCE.regionalRecordCount, 778);
  assert.equal(STANLEY_LIGHTING_SOURCE.records.length, 103);
  assert.equal(
    STANLEY_LIGHTING_SOURCE.sourceSha256,
    receipt.files['regional-poles.geojson'].sha256,
  );
  assert.equal(STANLEY_LIGHTING_SOURCE.retrievedAt, receipt.retrievedAt);
  execFileSync(process.execPath, [
    'tools/generate-stanley-lighting-source.mjs',
    '--check',
  ]);
});

test('103 source IDs retain 102 inventory groups but publish only 101 supported fixtures, replacing procedural in-park lamps', () => {
  const first = sourcePoles[0],
    outside = [900, 900, 1.1],
    procedural = [
      outside,
      [...first.point, 0],
      [...project([-123.15, 49.3]), 1],
    ],
    original = JSON.stringify(procedural),
    graph = { nodes: [], edges: [] },
    reconciled = reconcileStanleyStreetLamps(procedural, park, graph, (x, z) =>
      geography.onLand(x, z),
    );
  assert.equal(JSON.stringify(procedural), original);
  assert.equal(reconciled.removedProcedural, 2);
  assert.equal(reconciled.inventoryRecords, 103);
  assert.equal(reconciled.inventoryFixtures, 102);
  assert.equal(reconciled.inventoryPoles.length, 102);
  assert.equal(reconciled.admittedFixtures, 101);
  assert.equal(reconciled.rejectedCoastMismatch, 1);
  assert.equal(reconciled.sourcePoles.length, 101);
  assert.equal(reconciled.lampPoints.length, 102);
  assert.equal(
    reconciled.lampPoints[0],
    outside,
    'outside pose/order/reference remain unchanged',
  );
  const ids = reconciled.inventoryPoles.flatMap((pole) => pole.sourceIds);
  assert.equal(new Set(ids).size, 103);
  const compare = (a, b) => a.localeCompare(b, 'en');
  assert.deepEqual(
    [...ids].sort(compare),
    STANLEY_LIGHTING_SOURCE.records.map((record) => record.id).sort(compare),
  );
  const duplicate = reconciled.sourcePoles.find(
    (pole) => pole.sourceIds.length === 2,
  );
  assert.deepEqual(duplicate.sourceIds, ['S1:10', 'S1:11']);
  assert.equal(reconciled.rejectedPoles.length, 1);
  const rejected = reconciled.rejectedPoles[0];
  assert.deepEqual(rejected.sourceIds, ['S2:26']);
  assert.equal(rejected.lampIndex, null);
  assert.equal(rejected.reason, 'outside-current-runtime-land');
  assert.equal(
    reconciled.lampPoints.some(
      (point) =>
        point[0] === rejected.point[0] && point[1] === rejected.point[1],
    ),
    false,
    'rejected observation allocates no common visible/impact slot',
  );
  for (const [index, pole] of reconciled.sourcePoles.entries()) {
    assert.equal(
      pole.lampIndex,
      index + 1,
      'admitted indices stay contiguous after rejection',
    );
    assert.equal(geography.onLand(...pole.point), true);
    assert.deepEqual(
      reconciled.lampPoints[pole.lampIndex].slice(0, 2),
      pole.point,
    );
    assert.deepEqual(pole.point, project(pole.coordinates));
  }
});

test('unsupported source observations remain metadata without any render or impact slots', () => {
  const outside = [900, 900, 0],
    reconciled = reconcileStanleyStreetLamps(
      [outside],
      park,
      { nodes: [], edges: [] },
      () => false,
    );
  assert.deepEqual(reconciled.lampPoints, [outside]);
  assert.equal(reconciled.sourcePoles.length, 0);
  assert.equal(reconciled.rejectedPoles.length, 102);
  assert.equal(
    reconciled.inventoryPoles.flatMap((pole) => pole.sourceIds).length,
    103,
  );
  for (const rejected of reconciled.rejectedPoles)
    assert.equal(rejected.lampIndex, null);
});

test('default512 source-local pools light documented corridors while Rawlings, inland trails and water stay dark', () => {
  const lighting = new NightStreetLighting({ ...downtown, park: parkOptions });
  try {
    assert.equal(lighting.stats().park.size, 512);
    assert.equal(
      lighting.stats().park.textureBytes,
      NIGHT_STREET_FIELD_MAX_BYTES,
    );
    assert.equal(lighting.stats().park.roadSources, 0);
    assert.equal(lighting.stats().park.lampSources, 101);
    for (const id of ['S:19', '20:12', 'S1:8', 'S2:24']) {
      const record = STANLEY_LIGHTING_SOURCE.records.find(
          (record) => record.id === id,
        ),
        sample = lighting.samplePark(...project(record.coordinates));
      assert(sample.warm > 0.65, `finite local light at municipal ${id}`);
      assert.equal(sample.street, 0, 'no road-wide park fill');
      assert.equal(sample.groundY, 5);
    }
    for (const coordinate of [
      [-123.1512853, 49.3087402], // Rawlings Trail existing QA viewpoint
      [-123.1523818, 49.300091], // Lovers Walk existing QA viewpoint
      [-123.139, 49.304], // Beaver Lake
      [-123.142, 49.2955], // Lost Lagoon
      [-123.13, 49.31], // Burrard Inlet
      [-123.13399275704072, 49.30645218768322], // S2:26 outside the current reconciled land mask
    ]) {
      const sample = lighting.samplePark(...project(coordinate));
      assert.equal(
        sample.warm,
        0,
        `dark source-excluded location ${coordinate.join(',')}`,
      );
      assert.equal(sample.street, 0);
    }
    assert.equal(allowed(...project([-123.139, 49.304])), false);
    assert.equal(allowed(...project([-123.142, 49.2955])), false);
    assert.equal(
      geography.onLand(...project([-123.13399275704072, 49.30645218768322])),
      false,
      'an inventory position does not override the runtime coastline',
    );
  } finally {
    lighting.dispose();
  }
});

test('a separate field preserves every existing downtown texel and adds one bounded texture only', () => {
  const original = new NightStreetLighting(downtown),
    combined = new NightStreetLighting({ ...downtown, park: parkOptions });
  try {
    assert.deepEqual(combined.texture.image.data, original.texture.image.data);
    for (const point of [
      [30, 50],
      [65, 50],
      [65, 95],
    ])
      assert.deepEqual(combined.sample(...point), original.sample(...point));
    assert.equal(combined.stats().textures, 2);
    assert.equal(
      combined.stats().textureBytes,
      original.stats().textureBytes + NIGHT_STREET_FIELD_MAX_BYTES,
    );
    assert.equal(
      combined.stats().warmStateBytes,
      original.stats().warmStateBytes + combined.stats().park.warmStateBytes,
    );
    assert.equal(
      combined.stats().park.wrappedMaterials,
      0,
      'the child field is data-only',
    );
  } finally {
    original.dispose();
    combined.dispose();
  }
});

test('one shader owner shares a single world varying, namespaced samplers and explicit park-only terrain reception', () => {
  const lighting = new NightStreetLighting({ ...downtown, park: parkOptions }),
    material = new THREE.MeshStandardMaterial(),
    terrain = new THREE.MeshStandardMaterial();
  let calls = 0;
  material.onBeforeCompile = (shader) => {
    calls++;
    shader.uniforms.original = { value: 7 };
  };
  material.customProgramCacheKey = () => 'existing-pbr';
  try {
    assert.equal(lighting.wrapMaterial(material), true);
    assert.equal(lighting.wrapMaterial(material), false);
    lighting.wrapMaterial(terrain, { parkOnly: true });
    const shader = shaderFor(material),
      terrainShader = shaderFor(terrain);
    assert.equal(calls, 1);
    assert.equal(shader.uniforms.original.value, 7);
    for (const code of [shader.vertexShader, shader.fragmentShader])
      assert.equal(
        code.match(/varying vec3 vAtlasNightStreetWorld;/g).length,
        1,
      );
    for (const name of ['uAtlasNightField', 'uAtlasParkNightField'])
      assert.equal(
        shader.fragmentShader.match(
          new RegExp(`uniform sampler2D ${name};`, 'g'),
        ).length,
        1,
      );
    assert(shader.uniforms.uAtlasParkNightField.value !== lighting.texture);
    assert.equal(
      shader.uniforms.uAtlasNightAmount,
      lighting.uniforms.uAtlasNightAmount,
    );
    assert(terrain.customProgramCacheKey().endsWith('-park-only'));
    assert(
      terrainShader.fragmentShader.includes(
        'return vec4(0.0); // Preserve existing downtown terrain reception.',
      ),
    );
    assert(shader.fragmentShader.includes('atlasParkField.g * 0.45'));
    assert(!shader.fragmentShader.includes('atlasParkField.r *'));
  } finally {
    lighting.dispose();
    material.dispose();
    terrain.dispose();
  }
});

test('every source fixture break uses the global render index and disables only its associated park pool', () => {
  const reconciled = reconcileStanleyStreetLamps(
      [[900, 900, 0]],
      park,
      {
        nodes: [],
        edges: [],
      },
      (x, z) => geography.onLand(x, z),
    ),
    lighting = new NightStreetLighting({ ...downtown, park: parkOptions }),
    poles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 8, 1),
      new THREE.MeshStandardMaterial(),
      reconciled.lampPoints.length,
    ),
    caps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
      reconciled.lampPoints.length,
    ),
    sourceIndices = new Int32Array(reconciled.lampPoints.length).fill(-1),
    engine = { disposed: false, renderer: { shadowMap: {} } },
    downtownBytes = lighting.texture.image.data.slice();
  for (const [parkIndex, source] of reconciled.sourcePoles.entries())
    sourceIndices[source.lampIndex] = downtown.lamps.length + parkIndex;
  const breakLamp = createStreetLampDamage(
    engine,
    poles,
    caps,
    sourceIndices,
    lighting,
  );
  try {
    assert.equal(breakLamp(0), true, 'off-field fixture has no light source');
    for (const source of reconciled.sourcePoles) {
      assert.equal(breakLamp(source.lampIndex), true);
      assert.equal(breakLamp(source.lampIndex), false);
      const matrix = new THREE.Matrix4();
      poles.getMatrixAt(source.lampIndex, matrix);
      assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(), 0);
      caps.getMatrixAt(source.lampIndex, matrix);
      assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(), 0);
    }
    for (const source of inventoryPoles) {
      assert.equal(lighting.samplePark(...source.point).warm, 0);
      assert.equal(lighting.samplePark(...source.point).street, 0);
    }
    assert.deepEqual(lighting.texture.image.data, downtownBytes);
    assert.equal(lighting.stats().disabledLamps, 101);
    assert.equal(lighting.stats().park.disabledLamps, 101);
    assert.equal(engine.renderer.shadowMap.needsUpdate, true);
  } finally {
    lighting.dispose();
    for (const mesh of [poles, caps]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
});

test('time changes and deferred receivers retain both textures, then release the fields exactly once', () => {
  const lighting = new NightStreetLighting({ ...downtown, park: parkOptions }),
    material = new THREE.MeshStandardMaterial();
  lighting.wrapMaterial(material);
  const shader = shaderFor(material),
    textures = [lighting.texture, shader.uniforms.uAtlasParkNightField.value],
    bytes = textures.map((texture) => texture.image.data.slice()),
    versions = textures.map((texture) => texture.version),
    materialVersion = material.version;
  let disposals = 0;
  for (const texture of textures)
    texture.addEventListener('dispose', () => disposals++);
  for (let hour = 0; hour < 240; hour += 0.25)
    lighting.update(hour, hour % 24 < 6 || hour % 24 > 19 ? 1 : 0);
  lighting.update(0, 1);
  const deferred = new THREE.MeshStandardMaterial();
  lighting.wrapMaterial(deferred);
  assert.equal(shaderFor(deferred).uniforms.uAtlasNightAmount.value, 1);
  deferred.dispose();
  assert.equal(lighting.stats().wrappedMaterials, 1);
  assert.equal(lighting.stats().park.wrappedMaterials, 0);
  textures.forEach((texture, index) => {
    assert.deepEqual(texture.image.data, bytes[index]);
    assert.equal(texture.version, versions[index]);
  });
  assert.equal(material.version, materialVersion);
  lighting.dispose();
  lighting.dispose();
  assert.equal(disposals, 2);
  assert.equal(lighting.stats().textures, 0);
  assert.equal(lighting.stats().wrappedMaterials, 0);
  assert.equal(lighting.disableLamp(1), false);
  material.dispose();
});
