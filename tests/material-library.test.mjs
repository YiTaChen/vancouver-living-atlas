import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  getCityMaterialLibrary,
  installCityMaterialLibrary,
  cityMaterialRect,
  CITY_MATERIAL_MANIFEST,
  CITY_MATERIAL_SLOT,
  CITY_MATERIAL_DETAIL_FADE,
  CITY_MATERIAL_COURSE_FADE,
  CITY_MATERIAL_COURSE_CONTRAST,
} = await import(cityModule('material-library'));
const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { unproject } = await import(cityModule('geo'));

function withLoader(run) {
  const old = THREE.TextureLoader.prototype.load;
  const pending = [];
  THREE.TextureLoader.prototype.load = function (
    url,
    onLoad,
    _progress,
    onError,
  ) {
    const texture = new THREE.Texture();
    pending.push({ url, onLoad, onError, texture });
    return texture;
  };
  try {
    return run(pending);
  } finally {
    THREE.TextureLoader.prototype.load = old;
  }
}

test('one engine shares three authored textures and only enables complete, correctly colored PBR', () =>
  withLoader((pending) => {
    const host = { extraTextures: new Set(), disposed: false };
    const library = getCityMaterialLibrary(host);
    assert.equal(getCityMaterialLibrary(host), library);
    assert.equal(pending.length, 3);
    assert.deepEqual(
      pending.map(({ url }) => url),
      ['color', 'normal', 'orm'].map(
        (name) =>
          `/materials/city/${name}.png?v=${CITY_MATERIAL_MANIFEST.files[name].sha256.slice(0, 12)}`,
      ),
      'each atlas cache key follows its own authored manifest hash',
    );
    assert.deepEqual(
      [...host.extraTextures],
      [library.color, library.normal, library.orm],
    );
    assert.equal(library.color.colorSpace, THREE.SRGBColorSpace);
    assert.equal(library.normal.colorSpace, THREE.NoColorSpace);
    assert.equal(library.orm.colorSpace, THREE.NoColorSpace);
    assert.equal(library.ready.value, 0);
    pending[0].onLoad();
    pending[1].onLoad();
    assert.equal(
      library.ready.value,
      0,
      'normal/color alone must not use incomplete ORM',
    );
    pending[2].onLoad();
    assert.equal(library.ready.value, 1);
    const another = getCityMaterialLibrary({ extraTextures: new Set() });
    assert.notEqual(
      another.color,
      library.color,
      'different engines own their resources',
    );
    for (const { texture } of pending) texture.dispose();
  }));

test('failed maps and completion after engine disposal keep the neutral catalogue fallback', () =>
  withLoader((pending) => {
    const host = { extraTextures: new Set(), disposed: false };
    const library = getCityMaterialLibrary(host);
    pending[0].onLoad();
    pending[1].onError(new Error('missing normal'));
    pending[2].onLoad();
    assert.equal(library.ready.value, 0);
    const disposed = { extraTextures: new Set(), disposed: false };
    const late = getCityMaterialLibrary(disposed);
    disposed.disposed = true;
    for (const request of pending.slice(3)) request.onLoad();
    assert.equal(late.ready.value, 0);
    assert.equal(
      host.extraTextures.size,
      3,
      'failed loads still have engine-owned disposal',
    );
    for (const { texture } of pending) texture.dispose();
  }));

test('all periodic slots remain inside padding, follow Blender lower-row convention and fade before mip bleed', () => {
  const { atlas, materials } = CITY_MATERIAL_MANIFEST;
  assert.equal(materials.length, atlas.rows * atlas.columns);
  const [start, end] = CITY_MATERIAL_DETAIL_FADE;
  assert.ok(start > 0 && end > start && end < atlas.padding);
  for (let i = 0; i < materials.length; i++) {
    const rect = cityMaterialRect(i);
    const origin = [
      (i % atlas.columns) * atlas.slotSize,
      Math.floor(i / atlas.columns) * atlas.slotSize,
    ];
    for (const [offset, scale] of [
      [0, atlas.width],
      [1, atlas.height],
    ]) {
      assert.equal(rect[offset] * scale, origin[offset] + atlas.padding + 0.5);
      assert.equal(
        (rect[offset] + rect[offset + 2]) * scale,
        origin[offset] + atlas.slotSize - atlas.padding - 0.5,
      );
    }
    assert.ok(
      materials[i].tileMeters.every((n) => n > 0 && Number.isFinite(n)),
    );
    assert.equal(CITY_MATERIAL_SLOT[materials[i].id], i);
  }
  // RGBA plus all mip levels: the complete eight-surface library fits 8 MiB.
  assert.equal(((atlas.width * atlas.height * 4 * 4) / 3) * 3, 8 * 1024 * 1024);
});

test('shared shader uniforms decode fallback color once and retain derivatives across tile repeats', () =>
  withLoader((pending) => {
    const library = getCityMaterialLibrary({ extraTextures: new Set() });
    const shader = {
      uniforms: {},
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    installCityMaterialLibrary(shader, library);
    const before = shader.fragmentShader;
    installCityMaterialLibrary(shader, library);
    assert.equal(
      shader.fragmentShader,
      before,
      'multiple surface layers reuse one sampler block',
    );
    assert.equal(shader.uniforms.uCityReady, library.ready);
    const expected = new THREE.Color().setRGB(
      ...CITY_MATERIAL_MANIFEST.materials[0].averageColor,
      THREE.SRGBColorSpace,
    );
    assert.deepEqual(shader.uniforms.uCityAverageColor.value[0], expected);
    assert.ok(
      shader.fragmentShader.indexOf('dFdx(tileUV)') <
        shader.fragmentShader.indexOf('fract(tileUV)'),
    );
    assert.match(
      shader.fragmentShader,
      /textureGrad\(uCityColor,atlasUV,dx\*rect.zw,dy\*rect.zw\)/,
    );
    for (const { texture } of pending) texture.dispose();
  }));

test('distant courses retain authored physical sizes beyond the atlas mip limit', () =>
  withLoader((pending) => {
    const library = getCityMaterialLibrary({ extraTextures: new Set() });
    const shader = { uniforms: {}, fragmentShader: '' };
    installCityMaterialLibrary(shader, library);
    const patterns = shader.uniforms.uCityCoursePattern.value;
    const sizes = shader.uniforms.uCityTileMeters.value;
    const expected = {
      'heritage-brick': { pattern: [8, 24, 1], unit: [0.216, 0.072] },
      'street-brick': { pattern: [8, 16, 1], unit: [0.24, 0.12] },
      'roof-shingle': { pattern: [4, 8, 1], unit: [0.45, 0.24] },
      cedar: { pattern: [0, 8, 2], unit: [null, 0.19] },
    };
    assert.deepEqual(CITY_MATERIAL_COURSE_FADE, [1, 2]);
    assert.ok(
      CITY_MATERIAL_COURSE_CONTRAST > 0 &&
        CITY_MATERIAL_COURSE_CONTRAST <= 0.15,
    );
    const { slotSize, padding } = CITY_MATERIAL_MANIFEST.atlas;
    const texels = slotSize - 2 * padding - 1;
    for (const [i, material] of CITY_MATERIAL_MANIFEST.materials.entries()) {
      const definition = expected[material.id];
      assert.deepEqual(
        patterns[i].toArray().slice(0, 3),
        definition?.pattern ?? [0, 0, 0],
        `${material.id}: no fabricated courses on stone, paint or aggregate`,
      );
      if (!definition) continue;
      for (let axis = 0; axis < 2; axis++) {
        if (definition.unit[axis] === null) continue;
        assert.ok(
          Math.abs(
            sizes[i].getComponent(axis) / patterns[i].getComponent(axis) -
              definition.unit[axis],
          ) < 1e-12,
          `${material.id}: course dimensions stay in metres`,
        );
      }
      const courseFootprintAtAtlasLimit =
        (CITY_MATERIAL_DETAIL_FADE[1] / texels) *
        Math.max(patterns[i].x, patterns[i].y);
      assert.ok(
        courseFootprintAtAtlasLimit < CITY_MATERIAL_COURSE_FADE[0],
        `${material.id}: courses must remain before whole units become subpixel`,
      );
    }
    for (const { texture } of pending) texture.dispose();
  }));

test('all atlas fetches are guarded after unwrapped derivatives and preserve neutral distant normals', () =>
  withLoader((pending) => {
    const library = getCityMaterialLibrary({ extraTextures: new Set() });
    const shader = { uniforms: {}, fragmentShader: '' };
    installCityMaterialLibrary(shader, library);
    const surface = shader.fragmentShader
      .split('CitySurface citySurface(')[1]
      .split('vec3 citySurfaceNormal(')[0];
    const branch = surface.indexOf('if(detail>.001)');
    const before = surface.slice(0, branch);
    const after = surface.slice(branch);
    assert.ok(branch > 0, 'the distant path must avoid all three atlas reads');
    assert.match(before, /dFdx\(tileUV\), dy=dFdy\(tileUV\)/);
    assert.doesNotMatch(before, /textureGrad|fract\(tileUV\)/);
    assert.match(before, /surface\.normal=vec3\(0,0,1\)/);
    assert.match(before, /surface\.roughness=uCityRoughMetal\[id\]\.x/);
    assert.match(before, /surface\.metalness=uCityRoughMetal\[id\]\.y/);
    assert.match(before, /cityCourseColor\(id,tileUV,dx,dy\)/);
    assert.equal((after.match(/textureGrad\(/g) ?? []).length, 3);
    assert.doesNotMatch(after, /dFdx\(|dFdy\(/);
    assert.match(after, /mix\(surface\.color,color,detail\)/);
    assert.match(
      shader.fragmentShader,
      /width=abs\(dx\*pattern\.xy\)\+abs\(dy\*pattern\.xy\)/,
      'course filtering uses unwrapped physical coordinates, not atlas texels',
    );
    assert.match(
      shader.fragmentShader,
      /if\(courseDetail<=\.001\) return mean/,
      'fully subpixel courses converge to the authored mean',
    );
    for (const { texture } of pending) texture.dispose();
  }));

test('building PBR keeps source walls, pane attributes and pitched roof envelope with the shared atlas', () =>
  withLoader((pending) => {
    const points = [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
      [0, 0],
    ];
    const feature = {
      properties: {
        id: 'gable-pbr',
        height: 8,
        minHeight: 0,
        roof: 'Pitched',
        source: 'cov-2009',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [points.map(([x, z]) => unproject(x, z))],
      },
    };
    const original = JSON.stringify(feature);
    const host = {
      data: { buildings: { features: [feature] }, roadRelief: () => 10.4 },
      extraTextures: new Set(),
      elevation: () => 10.4,
      buildings: new THREE.Group(),
      uniforms: { night: { value: 0 } },
      stats: {},
      renderer: { shadowMap: { needsUpdate: false } },
      geometry(position, normal, color, uv) {
        const geometry = new THREE.BufferGeometry();
        for (const [name, array, size] of [
          ['position', position, 3],
          ['normal', normal, 3],
          ['color', color, 3],
          ['uv', uv, 2],
        ])
          geometry.setAttribute(
            name,
            new THREE.Float32BufferAttribute(array, size),
          );
        return geometry;
      },
    };
    createBuildingBodies(host);
    assert.equal(JSON.stringify(feature), original);
    assert.equal(host.data.buildingFoundations.get('gable-pbr'), 10);
    const mesh = host.buildings.children[0];
    mesh.geometry.computeBoundingBox();
    assert.equal(mesh.geometry.boundingBox.max.y, 18);
    const uv = mesh.geometry.getAttribute('uv');
    assert.ok(
      Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)]).some(
        ([x, y]) => x === -1 && y === -2,
      ),
    );
    for (const name of ['aStyle', 'aLayout', 'aTop', 'aSeed', 'aBaseWindow'])
      assert.equal(mesh.geometry.getAttribute(name).count, uv.count);
    assert.equal(pending.length, 3, 'no legacy private brick textures remain');
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mesh.material.onBeforeCompile(shader, null);
    assert.match(
      shader.fragmentShader,
      /CitySurface cityFinish=citySurface\(citySlot,cityMetres\)/,
    );
    assert.match(
      shader.fragmentShader,
      /citySurfaceNormal\(cityFinish,-vViewPosition,normal,.72\*\(1.0-facadePane\)\)/,
    );
    assert.match(shader.fragmentShader, /skyTint=mix\(uAtlasSkyHorizon/);
    assert.match(
      shader.fragmentShader,
      /roughnessFactor=mix\(cityFinish.roughness,pattern.w,facadePane\)/,
    );
    assert.doesNotMatch(
      shader.fragmentShader,
      /texture2D\(uBrick|vNormalMapUv/,
    );
    for (const { texture } of pending) texture.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
    host.facadeDetails.dispose();
  }));
