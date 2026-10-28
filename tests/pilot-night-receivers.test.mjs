import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { NightStreetLighting } = await import(cityModule('night-street-lighting'));
const { wrapNightStreetMaterials } = await import(cityModule('environment'));
const { RobsonBurrardDetails } = await import(cityModule('robson-burrard-details'));
const { CityPedestrians } = await import(cityModule('city-life/city-pedestrians'));

const makeLight = () => new NightStreetLighting({
  bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
  size: 16, allowed: () => true,
  roads: [{ a: [-30, 0, 0], b: [30, 0, 0], width: 12 }], lamps: [],
});
const compile = (material) => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return shader;
};
const makeShop = () => new RobsonBurrardDetails({
  data: { buildings: { features: [] }, roads: { features: [] } },
  buildings: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
  settings: { quality: 'high', buildings: true },
  renderer: { shadowMap: { needsUpdate: false } }, elevation: () => 0,
}, null);

for (const lightFirst of [true, false]) {
  test(`actual storefront shader hooks remain scoped and restore on ${lightFirst ? 'light' : 'storefront'} disposal`, () => {
    const light = makeLight(), shop = makeShop();
    const materials = [...Object.values(shop.materials), shop.signMaterial];
    const before = materials.map((material) => ({ compile: material.onBeforeCompile, key: material.customProgramCacheKey }));
    try {
      wrapNightStreetMaterials(shop.root, light, { pilotOnly: true });
      assert.equal(light.stats().wrappedMaterials, 6);
      for (const material of materials) {
        const shader = compile(material);
        assert.match(material.customProgramCacheKey(), /pilot-only/);
        assert.match(shader.fragmentShader, /uAtlasNightAmount <= 0\.001 \|\| uAtlasPilotNightView <= 0\.0/);
        assert.match(shader.fragmentShader, /float atlasReceiver = 1\.0 \* uAtlasPilotNightView \* atlasPilotNightStreetShowcaseWeight/);
      }
      assert.match(compile(shop.materials.glass).fragmentShader, /streetWindowGlow/);
      assert.match(compile(shop.materials.canopy).fragmentShader, /float weave=/);
      assert.match(compile(shop.signMaterial).vertexShader, /showcaseSignRect/);
      if (lightFirst) light.dispose(); else shop.dispose();
      assert.equal(light.stats().wrappedMaterials, 0);
      materials.forEach((material, i) => {
        assert.strictEqual(material.onBeforeCompile, before[i].compile);
        assert.strictEqual(material.customProgramCacheKey, before[i].key);
      });
    } finally { shop.dispose(); light.dispose(); }
  });
}

test('real pedestrian constructor enrolls one shared material, preserves deformation across source GLB loading, and releases its wrapper', async () => {
  const light = makeLight();
  let enrolled = 0;
  const engine = {
    compatibleGraphics: false, settings: { quality: 'high' },
    data: { roadGraph: null }, scene: new THREE.Scene(),
    preparePilotNightReceivers(group) {
      enrolled++;
      wrapNightStreetMaterials(group, light, { pilotOnly: true });
    },
  };
  const city = new CityPedestrians(engine);
  try {
    assert.equal(enrolled, 1);
    assert.equal(light.stats().wrappedMaterials, 1);
    const meshes = city.renderer.group.children;
    assert.equal(new Set(meshes.map((mesh) => mesh.material)).size, 1);
    const material = meshes[0].material, depth = meshes[0].customDepthMaterial;
    const beforeLoad = compile(material);
    assert.match(beforeLoad.vertexShader, /pedestrianRigidLimb/);
    assert.match(beforeLoad.vertexShader, /vPedestrianTint/);
    assert.match(beforeLoad.fragmentShader, /atlasSurfaceWeight/);
    assert.match(beforeLoad.fragmentShader, /uAtlasPilotNightView \* atlasPilotNightStreetShowcaseWeight/);
    assert.doesNotMatch(depth.customProgramCacheKey(), /atlas-night-street/);
    city.renderer.loader = async (url) => {
      const bytes = readFileSync(`tools/assets/city-life-pedestrians/exports/${url.split('/').at(-1)}`);
      return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    };
    await city.renderer.load();
    assert.equal(city.renderer.stats().loadedTemplates, 8);
    assert.strictEqual(meshes[0].material, material);
    assert.match(compile(material).vertexShader, /pedestrianRigidLimb/);
    city.dispose();
    assert.equal(light.stats().wrappedMaterials, 0);
  } finally { city.dispose(); light.dispose(); }
});

test('pilot-only policy does not change ordinary field material policy', () => {
  const light = makeLight(), ordinary = new THREE.MeshStandardMaterial();
  try {
    light.wrapMaterial(ordinary);
    const shader = compile(ordinary);
    assert.doesNotMatch(shader.fragmentShader, /float atlasReceiver = 1\.0 \* uAtlasPilotNightView/);
    assert.throws(() => light.wrapMaterial(new THREE.MeshStandardMaterial(), { pilotOnly: true, facade: true }), /cannot combine/);
  } finally { light.dispose(); ordinary.dispose(); }
});
