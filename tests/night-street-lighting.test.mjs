import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  NightStreetLighting,
  NIGHT_STREET_FIELD_SIZE,
  NIGHT_STREET_FIELD_MAX_BYTES,
  nightStreetActivity,
} = await import(cityModule('night-street-lighting'));
const { inPolygon } = await import(cityModule('geo'));
const { makeRoadster } = await import(cityModule('assets/roadster'));
const { PilotNightRoadster } = await import(cityModule('pilot-night-roadster'));
const { STREET_SHOWCASE_SEGMENTS } = await import(cityModule('street-quality-profile'));
const bounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };
const base = {
  bounds,
  size: 128,
  allowed: () => true,
  lamps: [{ x: 30, y: 13.85, z: 50 }],
  roads: [{ a: [0, 5, 50], b: [100, 5, 50], width: 10 }],
};
const shaderFor = (material) => {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  return shader;
};

void test('pilot-only roadster receiver composes with the existing paint and restores it on disposal', () => {
  const lighting = new NightStreetLighting(base);
  const car = makeRoadster();
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  parent.add(car.group);
  const paint = car.group.getObjectByName('roadster/paint').material;
  const beforeKey = paint.customProgramCacheKey();
  const receiver = new PilotNightRoadster(parent, car.group, lighting);
  const pilotWeight = receiver.weight;
  try {
    assert.equal(lighting.wrapMaterial(paint, { pilotWeight }), false);
    const shader = shaderFor(paint);
    assert.equal(shader.uniforms.uAtlasPilotReceiverWeight, pilotWeight);
    assert.equal(shader.uniforms.uAtlasNightAmount, lighting.uniforms.uAtlasNightAmount);
    assert(shader.fragmentShader.includes('atlasSurfaceWeight'));
    assert(shader.fragmentShader.includes('uAtlasPilotReceiverWeight <= 0.0'));
    assert(shader.fragmentShader.includes('float atlasReceiver = 1.0 * uAtlasPilotReceiverWeight'));
    assert.match(paint.customProgramCacheKey(), /pilot-receiver/);
    lighting.update(23, 1);
    const [x, z] = STREET_SHOWCASE_SEGMENTS[0].a;
    parent.position.set(x, 2, z);
    receiver.update();
    assert.equal(shader.uniforms.uAtlasPilotReceiverWeight.value, 1);
    car.group.visible = false;
    receiver.update();
    assert.equal(shader.uniforms.uAtlasPilotReceiverWeight.value, 0);
    car.group.visible = true;
    parent.position.set(x, 301, z);
    receiver.update();
    assert.equal(pilotWeight.value, 0);
    parent.position.set(100000, 2, 100000);
    receiver.update();
    assert.equal(pilotWeight.value, 0);
    parent.position.set(x, 2, z);
    receiver.update();
    assert.equal(pilotWeight.value, 1);
    parent.visible = false;
    receiver.update();
    assert.equal(pilotWeight.value, 0);
    lighting.update(14, 0);
    assert.equal(shader.uniforms.uAtlasNightAmount.value, 0);
  } finally {
    receiver.dispose();
    lighting.dispose();
    assert.equal(paint.customProgramCacheKey(), beforeKey);
    car.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
  }
});

test('continuous road fill and stronger local lamp pools are spatial, not a global night lift', () => {
  const lighting = new NightStreetLighting(base);
  try {
    const near = lighting.sample(30, 50),
      between = lighting.sample(65, 50),
      sidewalk = lighting.sample(65, 57),
      unlit = lighting.sample(65, 95);
    assert.equal(near.street, 1);
    assert.equal(between.street, 1, 'road remains legible between lamp pools');
    assert(near.warm > 0.9);
    assert.equal(between.warm, 0);
    assert(sidewalk.street > 0.98, 'connected sidewalk receives street bounce');
    assert.deepEqual(unlit, { street: 0, warm: 0, groundY: null, coverage: 0 });
    assert.deepEqual(lighting.sample(-1, 50), unlit);
    assert.deepEqual(lighting.sample(101, 50), unlit);
    assert.deepEqual(lighting.sample(NaN, 50), unlit);
  } finally {
    lighting.dispose();
  }
});

test('the supplied geographic mask excludes park interiors while preserving polygon holes', () => {
  const park = [
    [
      [40, 35],
      [85, 35],
      [85, 85],
      [40, 85],
      [40, 35],
    ],
    [
      [49, 43],
      [65, 43],
      [65, 61],
      [49, 61],
      [49, 43],
    ],
  ];
  const lighting = new NightStreetLighting({
    ...base,
    lamps: [{ x: 75, y: 13.85, z: 50 }],
    allowed: (x, z) => !inPolygon([x, z], park),
  });
  try {
    assert.equal(
      lighting.sample(75, 50).street,
      0,
      'a source cannot illuminate its excluded park',
    );
    assert.equal(lighting.sample(75, 50).warm, 0);
    assert.equal(
      lighting.sample(57, 50).street,
      1,
      'a true polygon hole is not park land',
    );
    assert.equal(lighting.sample(30, 50).street, 1);
    assert.equal(
      lighting.sample(40.1, 50).coverage,
      0,
      'conservative edge cells stay inside the allowed land',
    );
  } finally {
    lighting.dispose();
  }
});

test('world height follows a sloping street and stays stable at partially covered field borders', () => {
  const lighting = new NightStreetLighting({
    ...base,
    lamps: [],
    roads: [{ a: [0, 5, 50], b: [100, 15, 50], width: 10 }],
    allowed: (x) => x < 65,
  });
  try {
    for (const x of [10, 25, 50]) {
      const sample = lighting.sample(x, 50);
      assert(
        Math.abs(sample.groundY - (5 + x * 0.1)) < 0.05,
        `slope datum at ${x}`,
      );
    }
    const edge = lighting.sample(63.9, 50);
    assert(edge.coverage > 0 && edge.coverage < 1);
    assert(
      Math.abs(edge.groundY - 11.39) < 0.15,
      'height is normalized by coverage instead of fading to sea level',
    );
    assert.equal(lighting.sample(66, 50).groundY, null);
  } finally {
    lighting.dispose();
  }
});

test('road intersections have bounded fill rather than accumulating several full-strength street lights', () => {
  const lighting = new NightStreetLighting({
    ...base,
    roads: [...base.roads, { a: [30, 5, 0], b: [30, 5, 100], width: 10 }],
    lamps: Array.from({ length: 20 }, () => ({ x: 30, y: 13.85, z: 50 })),
  });
  try {
    assert.equal(lighting.sample(30, 50).street, 1);
    assert.equal(lighting.sample(30, 50).warm, 1);
    for (const channel of lighting.texture.image.data) assert(channel <= 255);
  } finally {
    lighting.dispose();
  }
});

test('overlapping sources reuse geographic mask probes instead of repeating polygon work per lamp', () => {
  const points = new Set();
  let calls = 0;
  const lighting = new NightStreetLighting({
    ...base,
    lamps: Array.from({ length: 100 }, () => base.lamps[0]),
    allowed: (x, z) => {
      calls++;
      points.add(`${x},${z}`);
      return true;
    },
  });
  try {
    assert.equal(
      calls,
      points.size,
      'each geographic grid point is classified once',
    );
    assert(
      calls < (base.size + 2) ** 2,
      'work is bounded by the supported field, not the source population',
    );
    assert.equal(lighting.sample(30, 50).street, 1);
  } finally {
    lighting.dispose();
  }
});

test('a fixed single 512-square data texture stays within one MiB, without mipmaps or color conversion', () => {
  const lighting = new NightStreetLighting({ ...base, size: undefined });
  try {
    assert.equal(lighting.texture.image.width, NIGHT_STREET_FIELD_SIZE);
    assert.equal(lighting.texture.image.height, NIGHT_STREET_FIELD_SIZE);
    assert.equal(lighting.stats().textureBytes, NIGHT_STREET_FIELD_MAX_BYTES);
    assert.equal(lighting.stats().textures, 1);
    assert(lighting.stats().activeTexels > 0);
    assert.equal(lighting.texture.type, THREE.UnsignedByteType);
    assert.equal(lighting.texture.format, THREE.RGBAFormat);
    assert.equal(lighting.texture.colorSpace, THREE.NoColorSpace);
    assert.equal(lighting.texture.generateMipmaps, false);
    assert.equal(lighting.texture.minFilter, THREE.LinearFilter);
    assert.equal(lighting.texture.flipY, false);
  } finally {
    lighting.dispose();
  }
});

test('road lighting persists at midnight while frontage activity dims with a continuous daily cycle', () => {
  assert.equal(nightStreetActivity(0), nightStreetActivity(24));
  assert.equal(nightStreetActivity(-4), nightStreetActivity(20));
  assert(nightStreetActivity(20) > nightStreetActivity(0));
  assert(nightStreetActivity(0) > nightStreetActivity(3));
  assert(
    Math.abs(nightStreetActivity(24 - 1e-6) - nightStreetActivity(1e-6)) < 1e-6,
  );
  assert.equal(nightStreetActivity(NaN), nightStreetActivity(23));
  const lighting = new NightStreetLighting(base);
  try {
    lighting.update(20, 1);
    const evening = lighting.uniforms.uAtlasNightActivity.value;
    lighting.update(0, 1);
    assert.equal(lighting.uniforms.uAtlasNightAmount.value, 1);
    assert(lighting.uniforms.uAtlasNightActivity.value < evening);
    lighting.update(13, 0);
    assert.equal(
      lighting.uniforms.uAtlasNightAmount.value,
      0,
      'daytime adds no diffuse or emissive light',
    );
    lighting.update(0, -1);
    assert.equal(lighting.uniforms.uAtlasNightAmount.value, 0);
    lighting.update(0, Infinity);
    assert.equal(lighting.uniforms.uAtlasNightAmount.value, 0);
    lighting.update(0, 3);
    assert.equal(lighting.uniforms.uAtlasNightAmount.value, 1);
  } finally {
    lighting.dispose();
  }
});

test('time updates retain texture content, object identities and shader versions', () => {
  const lighting = new NightStreetLighting(base),
    material = new THREE.MeshStandardMaterial();
  lighting.wrapMaterial(material);
  try {
    const texture = lighting.texture,
      bytes = texture.image.data.slice(),
      textureVersion = texture.version,
      materialVersion = material.version,
      uniform = lighting.uniforms.uAtlasNightAmount,
      programKey = material.customProgramCacheKey();
    for (let i = 0; i < 5_000; i++) lighting.update((i / 100) % 24, i % 2);
    assert.equal(lighting.texture, texture);
    assert.equal(lighting.texture.version, textureVersion);
    assert.equal(material.version, materialVersion);
    assert.equal(material.customProgramCacheKey(), programKey);
    assert.equal(lighting.uniforms.uAtlasNightAmount, uniform);
    assert.deepEqual(texture.image.data, bytes);
    assert.equal(lighting.stats().textures, 1);
    assert.equal(lighting.stats().wrappedMaterials, 1);
  } finally {
    lighting.dispose();
    material.dispose();
  }
});

test('a broken lamp extinguishes its warm pool in place without changing road fill, height, coverage or material hooks', () => {
  const lighting = new NightStreetLighting(base), material = new THREE.MeshStandardMaterial();
  lighting.wrapMaterial(material);
  try {
    const texture = lighting.texture, before = texture.image.data.slice(),
      version = texture.version, materialVersion = material.version;
    assert(lighting.sample(30, 50).warm > .9);
    assert.equal(lighting.disableLamp(0), true);
    assert.equal(lighting.sample(30, 50).warm, 0);
    assert.equal(lighting.sample(30, 50).street, 1);
    assert.equal(lighting.texture, texture);
    assert.equal(lighting.uniforms.uAtlasNightField.value, texture);
    assert.equal(texture.version, version + 1);
    assert.equal(material.version, materialVersion);
    for (let index = 0; index < before.length; index++)
      if (index % 4 !== 1) assert.equal(texture.image.data[index], before[index]);
    assert.equal(lighting.disableLamp(0), false);
    assert.equal(texture.version, version + 1);
    assert.equal(lighting.stats().disabledLamps, 1);
    lighting.update(23, 1); lighting.update(12, 0); lighting.update(23, 1);
    assert.equal(lighting.sample(30, 50).warm, 0);
    assert.equal(lighting.stats().warmStateBytes, base.size ** 2 * 4 + 16);
  } finally { lighting.dispose(); material.dispose(); }
});

test('removing overlapping saturated lamp pools preserves all surviving sources', () => {
  const lamps = Array.from({ length: 20 }, () => base.lamps[0]),
    lighting = new NightStreetLighting({ ...base, lamps }),
    single = new NightStreetLighting(base);
  try {
    for (let index = 0; index < 19; index++) {
      assert.equal(lighting.disableLamp(index), true);
      assert(lighting.sample(30, 50).warm > .9);
    }
    assert(Math.abs(lighting.sample(30, 50).warm - single.sample(30, 50).warm) < 1 / 255);
    assert.equal(lighting.disableLamp(19), true);
    assert.equal(lighting.sample(30, 50).warm, 0);
    assert.equal(lighting.sample(30, 50).street, 1);
  } finally { lighting.dispose(); single.dispose(); }
});

test('lamp removal remains local and cannot introduce light across excluded park borders', () => {
  const lighting = new NightStreetLighting({ ...base,
    lamps: [base.lamps[0], { x: 85, y: 13.85, z: 50 }],
    allowed: (x) => x < 40 || x > 70,
  });
  try {
    const distant = lighting.sample(85, 50), excluded = lighting.sample(50, 50);
    assert.equal(lighting.disableLamp(0), true);
    assert.deepEqual(lighting.sample(85, 50), distant);
    assert.deepEqual(lighting.sample(50, 50), excluded);
    assert.equal(lighting.sample(30, 50).warm, 0);
    for (const index of [-1, .5, 2, NaN, Infinity]) assert.equal(lighting.disableLamp(index), false);
  } finally { lighting.dispose(); }
  assert.equal(lighting.disableLamp(1), false);
});

test('material hooks retain the existing surface pipeline and apply full instance/batch transforms after deformation', () => {
  const lighting = new NightStreetLighting(base),
    material = new THREE.MeshPhysicalMaterial();
  let calls = 0;
  material.onBeforeCompile = function (shader) {
    assert.equal(this, material);
    calls++;
    shader.uniforms.existingSurface = { value: 8 };
    shader.fragmentShader =
      '// original physical surface\n' + shader.fragmentShader;
  };
  material.customProgramCacheKey = () => 'existing-wheel-material';
  try {
    assert.equal(lighting.wrapMaterial(material), true);
    assert.equal(
      lighting.wrapMaterial(material),
      false,
      'wrapping a shared material is idempotent',
    );
    const shader = shaderFor(material);
    assert.equal(calls, 1);
    assert.equal(shader.uniforms.existingSurface.value, 8);
    assert.equal(
      shader.uniforms.uAtlasNightAmount,
      lighting.uniforms.uAtlasNightAmount,
    );
    assert.equal(shader.uniforms.uAtlasNightField.value, lighting.texture);
    assert(shader.fragmentShader.includes('// original physical surface'));
    assert(
      material.customProgramCacheKey().startsWith('existing-wheel-material|'),
    );
    const vertex = shader.vertexShader;
    assert(
      vertex.indexOf('vec4 atlasNightWorld') >
        vertex.indexOf('#include <displacementmap_vertex>'),
    );
    assert(
      vertex.indexOf('batchingMatrix * atlasNightWorld') <
        vertex.indexOf('instanceMatrix * atlasNightWorld'),
    );
    assert(vertex.includes('(modelMatrix * atlasNightWorld).xyz'));
    assert(
      shader.fragmentShader.includes(
        'inverseTransformDirection(normal, viewMatrix)',
      ),
      'the normal-mapped view normal is converted into world space',
    );
    assert(
      shader.fragmentShader.includes(
        'reflectedLight.indirectDiffuse += diffuseColor.rgb',
      ),
      'base reflectance remains part of the lighting equation',
    );
    assert(
      shader.fragmentShader.indexOf('atlasHeightFade') <
        shader.fragmentShader.indexOf('#include <aomap_fragment>'),
      'existing indirect ambient occlusion follows the addition',
    );
    assert(
      shader.fragmentShader.includes('smoothstep(3.2, 20.0, atlasHeight)'),
      'illumination stays near the street datum rather than brightening high roofs',
    );
    assert(!shader.fragmentShader.includes('facadePane'));
    assert(
      shader.fragmentShader.indexOf('if (uAtlasNightAmount <= 0.001)') <
        shader.fragmentShader.indexOf('return texture2D(uAtlasNightField'),
      'daytime branches out before sampling the field',
    );
    assert(
      shader.fragmentShader.indexOf('any(lessThan(atlasUv') <
        shader.fragmentShader.indexOf('return texture2D(uAtlasNightField'),
      'outside receivers branch out before sampling the field',
    );
  } finally {
    lighting.dispose();
    material.dispose();
  }
});

test('facade integration dims existing urban windows and adds lower pane glow without illuminating glass as an opaque wall', () => {
  const lighting = new NightStreetLighting(base),
    facade = new THREE.MeshStandardMaterial(),
    nonFacade = new THREE.MeshStandardMaterial();
  facade.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\nfloat facadePane = 0.0, facadeLit = 0.0;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, .66, .32) * facadeLit * .8;',
    );
  };
  try {
    lighting.wrapMaterial(facade, { facade: true });
    lighting.wrapMaterial(nonFacade, { facade: true });
    const shader = shaderFor(facade),
      fallback = shaderFor(nonFacade);
    assert(
      shader.fragmentShader.includes(
        'float atlasReceiver = (1.0 - facadePane)',
      ),
    );
    assert(shader.fragmentShader.includes('float atlasLowerPane = facadePane'));
    assert(shader.fragmentShader.includes('smoothstep(2.8, 4.5, atlasHeight)'));
    assert(
      shader.fragmentShader.indexOf('facadeLit *=') <
        shader.fragmentShader.indexOf(
          'totalEmissiveRadiance += vec3(1.0, .66, .32) * facadeLit',
        ),
    );
    assert(shader.fragmentShader.includes('atlasLowerPane * atlasField.r'));
    assert(
      shader.fragmentShader.includes(
        '* uAtlasNightAmount * uAtlasNightActivity * 0.13',
      ),
    );
    assert(
      !fallback.fragmentShader.includes('facadePane'),
      'generic material marked facade cannot reference unavailable profile locals',
    );
    assert(!fallback.fragmentShader.includes('facadeLit'));
  } finally {
    lighting.dispose();
    facade.dispose();
    nonFacade.dispose();
  }
});

test('a deferred material receives current shared night uniforms without rebuilding the field', () => {
  const lighting = new NightStreetLighting(base),
    material = new THREE.MeshStandardMaterial();
  try {
    lighting.update(1, 1);
    const version = lighting.texture.version;
    lighting.wrapMaterial(material);
    const shader = shaderFor(material);
    assert.equal(shader.uniforms.uAtlasNightAmount.value, 1);
    assert.equal(
      shader.uniforms.uAtlasNightActivity.value,
      nightStreetActivity(1),
    );
    assert.equal(lighting.texture.version, version);
  } finally {
    lighting.dispose();
    material.dispose();
  }
});

test('disposal releases the sole field once and restores owned hooks without disposing receiver materials', () => {
  const lighting = new NightStreetLighting(base),
    material = new THREE.MeshStandardMaterial();
  // Compare identities only; these saved methods are never invoked unbound.
  // oxlint-disable-next-line typescript/unbound-method
  const originalCompile = material.onBeforeCompile;
  // oxlint-disable-next-line typescript/unbound-method
  const originalKey = material.customProgramCacheKey;
  let textureDisposals = 0,
    materialDisposals = 0;
  lighting.texture.addEventListener('dispose', () => textureDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  lighting.wrapMaterial(material);
  lighting.dispose();
  lighting.dispose();
  assert.equal(textureDisposals, 1);
  assert.equal(materialDisposals, 0);
  assert(material.onBeforeCompile === originalCompile);
  assert(material.customProgramCacheKey === originalKey);
  assert.equal(lighting.stats().textures, 0);
  assert.equal(lighting.stats().wrappedMaterials, 0);
  assert.equal(lighting.uniforms.uAtlasNightAmount.value, 0);
  assert.deepEqual(lighting.sample(30, 50), {
    street: 0,
    warm: 0,
    groundY: null,
    coverage: 0,
  });
  assert.throws(() => lighting.wrapMaterial(material), /disposed/);
  lighting.update(23, 1);
  assert.equal(lighting.uniforms.uAtlasNightAmount.value, 0);
  material.dispose();
});

test('an unrelated later receiver hook remains owned by its caller at field disposal', () => {
  const lighting = new NightStreetLighting(base),
    material = new THREE.MeshStandardMaterial();
  lighting.wrapMaterial(material);
  const laterCompile = () => {},
    laterKey = () => 'later-receiver';
  material.onBeforeCompile = laterCompile;
  material.customProgramCacheKey = laterKey;
  lighting.dispose();
  assert(material.onBeforeCompile === laterCompile);
  assert(material.customProgramCacheKey === laterKey);
  material.dispose();
});

test('cancelled hydrated materials leave no retained wrappers or shared-field resource changes', () => {
  const lighting = new NightStreetLighting(base),
    texture = lighting.texture,
    version = texture.version,
    nightUniform = lighting.uniforms.uAtlasNightAmount;
  let fieldDisposals = 0;
  texture.addEventListener('dispose', () => fieldDisposals++);
  lighting.update(0, 1);
  try {
    for (let i = 0; i < 50; i++) {
      const material = new THREE.MeshStandardMaterial();
      // Capture identities only, without an unbound invocation.
      // oxlint-disable-next-line typescript/unbound-method
      const originalCompile = material.onBeforeCompile;
      // oxlint-disable-next-line typescript/unbound-method
      const originalKey = material.customProgramCacheKey;
      lighting.wrapMaterial(material);
      const shader = shaderFor(material);
      assert.equal(shader.uniforms.uAtlasNightField.value, texture);
      assert.equal(lighting.stats().wrappedMaterials, 1);
      material.dispose();
      assert.equal(lighting.stats().wrappedMaterials, 0);
      assert(material.onBeforeCompile === originalCompile);
      assert(material.customProgramCacheKey === originalKey);
      material.dispose();
      assert.equal(lighting.stats().wrappedMaterials, 0);
    }
    assert.equal(lighting.texture, texture);
    assert.equal(lighting.texture.version, version);
    assert.equal(lighting.uniforms.uAtlasNightAmount, nightUniform);
    assert.equal(lighting.uniforms.uAtlasNightAmount.value, 1);
    assert.equal(
      fieldDisposals,
      0,
      'a cancelled receiver does not own the shared light field',
    );
  } finally {
    lighting.dispose();
  }
  assert.equal(fieldDisposals, 1);
});

test('actual deferred landmarks prepare final night shaders before warmup and release cancelled receivers', async () => {
  const { LandmarkDetail } = await import(cityModule('landmark-detail'));
  const lighting = new NightStreetLighting(base);
  lighting.update(0, 1);
  const create = () => {
    const group = new THREE.Group();
    group.name = 'Deferred night receiver';
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshStandardMaterial(),
      ),
    );
    group.userData.placement = { lon: -123.128, lat: 49.286, baseY: 5 };
    return group;
  };
  let hydrated = create(),
    finishWarmup,
    warmup = new Promise((resolve) => {
      finishWarmup = resolve;
    }),
    warms = 0;
  const engine = {
    landmarks: new THREE.Group(),
    data: {},
    renderer: { shadowMap: {} },
    elevation: () => 5,
    uniforms: { night: { value: 1 } },
    settings: { quality: 'ultra', buildings: true },
    camera: { position: new THREE.Vector3(0, 10, 0) },
    landmarkWorker: {
      request: () => ({ promise: Promise.resolve(hydrated), cancel() {} }),
    },
    prepareNightReceivers(group) {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh)
          lighting.wrapMaterial(object.material);
      });
    },
    prepareLandmark(group) {
      warms++;
      assert(
        group.children[0].material
          .customProgramCacheKey()
          .includes('atlas-night-street-v1'),
      );
      assert.equal(
        shaderFor(group.children[0].material).uniforms.uAtlasNightAmount.value,
        1,
      );
      return warmup;
    },
  };
  const detail = new LandmarkDetail(engine, create, {
    schema: 1,
    kind: 'science',
    sourceRevision: 'test',
    placement: { lon: -123.128, lat: 49.286, baseY: 5 },
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  try {
    engine.prepareNightReceivers(detail.medium);
    assert.equal(lighting.stats().wrappedMaterials, 1);
    detail.loadState.start();
    await flush();
    assert.equal(warms, 1);
    assert.equal(detail.loadState.status, 'preparing');
    assert.equal(lighting.stats().wrappedMaterials, 2);
    detail.loadState.cancel();
    assert.equal(
      lighting.stats().wrappedMaterials,
      1,
      'cancelled prewarmed material is removed immediately',
    );
    assert.equal(hydrated.parent, null);
    finishWarmup();
    await flush();
    assert.equal(detail.loadState.status, 'idle');
    hydrated = create();
    warmup = Promise.resolve();
    detail.loadState.start();
    await flush();
    assert.equal(warms, 2);
    assert.equal(detail.loadState.status, 'prepared');
    const version = hydrated.children[0].material.version;
    assert.equal(detail.loadState.commit(), true);
    assert.equal(detail.ultra, hydrated);
    assert.equal(lighting.stats().wrappedMaterials, 2);
    assert.equal(
      hydrated.children[0].material.version,
      version,
      'attach reuses the prewarmed wrapper without a new shader version',
    );
  } finally {
    detail.disposePending();
    engine.landmarks.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
    lighting.dispose();
  }
});

test('invalid inputs cannot exceed the texture budget or introduce non-finite geographic/height values', () => {
  for (const change of [
    { size: 1 },
    { size: 513 },
    { size: 64.5 },
    { bounds: { ...bounds, maxX: 0 } },
    { bounds: { ...bounds, minZ: NaN } },
    { lamps: [{ x: 30, y: Infinity, z: 50 }] },
    { lamps: [{ x: 30, y: 5, z: 50, groundY: NaN }] },
    { roads: [{ a: [0, 5, 50], b: [100, Infinity, 50], width: 10 }] },
    { roads: [{ a: [0, 5, 50], b: [100, 5, 50], width: 0 }] },
    { roads: [{ a: [0, 5, 50], b: [100, 5, 50], width: 51 }] },
  ])
    assert.throws(
      () => new NightStreetLighting({ ...base, ...change }),
      /Invalid/,
    );
  const empty = new NightStreetLighting({ ...base, lamps: [], roads: [] });
  try {
    assert.equal(empty.stats().activeTexels, 0);
    assert.deepEqual(empty.sample(50, 50), {
      street: 0,
      warm: 0,
      groundY: null,
      coverage: 0,
    });
  } finally {
    empty.dispose();
  }
});
