import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);
const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { unproject } = await import(cityModule('geo'));

// Replay the production adapter rather than hand-selecting facade:true. This
// catches a stale GIS program-family selector even if isolated shader tests pass.
const source = readFileSync('lib/city/environment.ts', 'utf8'),
  ast = ts.createSourceFile(
    'environment.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  ),
  adapter = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'wrapNightStreetMaterials',
  );
assert(adapter);
const adapterCode = ts.transpileModule(
  `import * as THREE from '${import.meta.resolve('three')}';\n${adapter.getText(ast)}`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { wrapNightStreetMaterials } = await import(
  'data:text/javascript;base64,' + Buffer.from(adapterCode).toString('base64')
);

function building(t) {
  t.mock.method(
    THREE.TextureLoader.prototype,
    'load',
    () => new THREE.Texture(),
  );
  const feature = {
      type: 'Feature',
      properties: {
        id: 'night-gis-body',
        height: 24,
        minHeight: 0,
        roof: 'Flat',
        source: 'cov-2009',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [24, 0],
            [24, 18],
            [0, 18],
            [0, 0],
          ].map(([x, z]) => unproject(x, z)),
        ],
      },
    },
    e = {
      data: { buildings: { features: [feature] }, roadRelief: () => 6.4 },
      elevation: () => 6.4,
      buildings: new THREE.Group(),
      extraTextures: new Set(),
      uniforms: { night: { value: 1 } },
      renderer: { shadowMap: {} },
      stats: {},
      geometry(positions, normals, colors, uv) {
        const geometry = new THREE.BufferGeometry();
        for (const [name, values, size] of [
          ['position', positions, 3],
          ['normal', normals, 3],
          ['color', colors, 3],
          ['uv', uv, 2],
        ])
          geometry.setAttribute(
            name,
            new THREE.Float32BufferAttribute(values, size),
          );
        return geometry;
      },
    };
  createBuildingBodies(e);
  return e;
}

for (const nightFirst of [true, false])
  test(`actual GIS facade, full-object cutaway and combined city/park fields compose (${nightFirst ? 'night' : 'cutaway'} first)`, (t) => {
    const e = building(t),
      mesh = e.data.rocketBuildingMesh,
      material = mesh.material,
      originalKey = material.customProgramCacheKey(),
      volumes = JSON.stringify(e.data.flightBuildingVolumes),
      position = mesh.geometry.getAttribute('position'),
      positionBytes = Buffer.from(position.array.buffer).slice(),
      lighting = new NightStreetLighting({
        bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
        allowed: () => true,
        lamps: [{ x: 12, y: 13.85, z: 10 }],
        park: {
          bounds: { minX: 500, maxX: 600, minZ: 500, maxZ: 600 },
          allowed: () => true,
          lamps: [{ x: 550, y: 13.85, z: 550 }],
        },
      });
    assert.match(originalKey, /atlas-city-bodies-pbr-v4-/);
    if (nightFirst) wrapNightStreetMaterials(e.buildings, lighting);
    const cutaway = new TravelOcclusion(
      [e.buildings],
      [{ mesh, parts: e.data.rocketBuildingParts }],
    );
    if (!nightFirst) wrapNightStreetMaterials(e.buildings, lighting);
    try {
      const shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      };
      material.onBeforeCompile(shader, {});
      assert.match(
        material.customProgramCacheKey(),
        /atlas-night-street-v2-facade-park-v1/,
      );
      assert.match(
        shader.fragmentShader,
        /facadeLit \*= mix\(1\.0, 0\.65 \+ 0\.35 \* uAtlasNightActivity/,
      );
      assert.match(shader.fragmentShader, /float atlasLowerPane = facadePane/);
      assert.match(shader.fragmentShader, /CitySurface cityFinish=citySurface/);
      assert.match(shader.fragmentShader, /citySurfaceNormal\(cityFinish/);
      assert.match(material.customProgramCacheKey(), /travel-full-occluder/);
      for (const [stage, code] of Object.entries({
        vertex: shader.vertexShader,
        fragment: shader.fragmentShader,
      })) {
        assert.equal(
          (code.match(/varying vec3 vAtlasNightStreetWorld;/g) ?? []).length,
          1,
          stage,
        );
        assert.equal(
          (code.match(/varying\s+\w+\s+vAtlasPark/g) ?? []).length,
          0,
          'park reuses the one world varying',
        );
      }
      for (const name of ['uAtlasNightField', 'uAtlasParkNightField'])
        assert.equal(
          (
            shader.fragmentShader.match(
              new RegExp(`uniform sampler2D ${name};`, 'g'),
            ) ?? []
          ).length,
          1,
        );
      assert.notEqual(
        shader.uniforms.uAtlasNightField.value,
        shader.uniforms.uAtlasParkNightField.value,
      );
      assert.equal(
        shader.uniforms.uAtlasNightAmount,
        lighting.uniforms.uAtlasNightAmount,
      );
      assert.equal(lighting.stats().wrappedMaterials, 1);
      assert.equal(
        lighting.stats().park.wrappedMaterials,
        0,
        'park remains a data-only child owner',
      );

      const key = material.customProgramCacheKey(),
        version = material.version;
      for (let i = 0; i < 1000; i++) lighting.update(i % 24, i % 2);
      assert.equal(material.customProgramCacheKey(), key);
      assert.equal(material.version, version);
      assert.equal(JSON.stringify(e.data.flightBuildingVolumes), volumes);
      assert.equal(mesh.geometry.getAttribute('position'), position);
      assert.deepEqual(Buffer.from(position.array.buffer), positionBytes);
      material.dispose();
      assert.equal(
        lighting.stats().wrappedMaterials,
        0,
        'disposed GIS material releases the night owner reference',
      );
    } finally {
      cutaway?.dispose();
      lighting.dispose();
      e.facadeDetails.dispose();
      mesh.geometry.dispose();
      material.dispose();
      for (const texture of e.extraTextures) texture.dispose();
    }
  });
