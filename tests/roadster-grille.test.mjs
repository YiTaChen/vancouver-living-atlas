import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { makeRoadster } = await import(cityModule('assets/roadster'));
const { PilotNightRoadster } = await import(cityModule('pilot-night-roadster'));
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);
const { roadsterGrilleEligible, installPilotRoadsterGrille } = await import(
  cityModule('assets/roadster-grille')
);
const { STREET_SHOWCASE_SEGMENTS } = await import(
  cityModule('street-quality-profile')
);

const base = {
  bounds: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 },
  size: 128,
  allowed: () => true,
  lamps: [{ x: 30, y: 13.85, z: 50 }],
  roads: [{ a: [0, 5, 50], b: [100, 5, 50], width: 10 }],
};
function shaderFor(material) {
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  };
  material.onBeforeCompile(shader, {});
  return shader;
}
function meshCounts(root) {
  let meshes = 0,
    triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    triangles +=
      (object.geometry.index?.count ??
        object.geometry.getAttribute('position').count) / 3;
  });
  return { meshes, triangles };
}
function disposeCar(root) {
  const geometry = new Set(),
    material = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometry.add(object.geometry);
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material])
      material.add(m);
  });
  for (const g of geometry) g.dispose();
  for (const m of material) m.dispose();
}

void test('the local gate is limited to the forward intake and excludes wheel, cabin and tail', () => {
  assert(roadsterGrilleEligible([0, 0.365, 2.2925], [0, 0, 1]));
  for (const [position, normal] of [
    [
      [0.6, 0.365, 2.2925],
      [0, 0, 1],
    ],
    [
      [0, 0.5, 2.2925],
      [0, 0, 1],
    ],
    [
      [0, 0.365, -2.225],
      [0, 0, -1],
    ],
    [
      [0, 0.365, 2.2925],
      [0, 1, 0],
    ],
    [
      [0, 0, 0.35],
      [0, 0, 1],
    ],
    [
      [NaN, 0.36, 2.29],
      [0, 0, 1],
    ],
  ])
    assert.equal(roadsterGrilleEligible(position, normal), false);
  const car = makeRoadster();
  try {
    const body = car.group.getObjectByName('roadster/dark');
    const p = body.geometry.getAttribute('position'),
      n = body.geometry.getAttribute('normal');
    let hit = 0;
    // The fragment mask is evaluated inside triangles: authored box corner
    // vertices can round just outside the open interior of its exact metre box.
    for (let i = 0; i + 2 < p.count; i += 3) {
      const center = [0, 1, 2].map(
        (k) =>
          (p.getComponent(i, k) +
            p.getComponent(i + 1, k) +
            p.getComponent(i + 2, k)) /
          3,
      );
      const normal = [0, 1, 2].map(
        (k) =>
          (n.getComponent(i, k) +
            n.getComponent(i + 1, k) +
            n.getComponent(i + 2, k)) /
          3,
      );
      if (roadsterGrilleEligible(center, normal)) hit++;
    }
    assert(hit > 0, 'the authored intake contains eligible triangle interiors');
    for (const wheel of car.group.children.filter((o) => o.type === 'Group'))
      wheel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const pos = object.geometry.getAttribute('position'),
          normal = object.geometry.getAttribute('normal');
        if (!normal) return;
        for (let i = 0; i < pos.count; i++)
          assert.equal(
            roadsterGrilleEligible(
              [pos.getX(i), pos.getY(i), pos.getZ(i)],
              [normal.getX(i), normal.getY(i), normal.getZ(i)],
            ),
            false,
          );
      });
  } finally {
    disposeCar(car.group);
  }
});

void test('the grille composes with local surface and night light while preserving ownership and pilot fade', () => {
  const car = makeRoadster(),
    parent = new THREE.Group(),
    lighting = new NightStreetLighting(base);
  parent.add(car.group);
  const dark = car.group.getObjectByName('roadster/dark').material;
  const paint = car.group.getObjectByName('roadster/paint').material;
  const oldKey = dark.customProgramCacheKey(),
    oldPaintKey = paint.customProgramCacheKey();
  const sourceValues = [
    dark.color.getHex(),
    dark.roughness,
    dark.metalness,
    dark.transparent,
    dark.depthWrite,
  ];
  const oldCount = meshCounts(car.group);
  const receiver = new PilotNightRoadster(parent, car.group, lighting);
  try {
    const s = shaderFor(dark);
    assert.match(s.vertexShader, /vPilotGrillePosition=position/);
    assert.match(s.fragmentShader, /atlasNightFieldSample/);
    assert.match(s.fragmentShader, /float atlasSurfaceWeight=/);
    assert.match(s.fragmentShader, /if\(atlasSurfaceWeight>0\.\)/);
    assert.match(s.fragmentShader, /pilotGrilleMask\*atlasSurfaceWeight/);
    assert(
      s.fragmentShader.indexOf('fwidth(vPilotGrillePosition.y)') <
        s.fragmentShader.indexOf(
          'if(atlasSurfaceWeight>0.) {\n  float pilotGrilleFinish',
        ),
    );
    assert.match(
      dark.customProgramCacheKey(),
      /pilot-receiver\/pilot-roadster-grille-v1/,
    );
    assert.doesNotMatch(paint.customProgramCacheKey(), /pilot-roadster-grille/);
    assert.deepEqual(meshCounts(car.group), oldCount);
    assert.deepEqual(
      [
        dark.color.getHex(),
        dark.roughness,
        dark.metalness,
        dark.transparent,
        dark.depthWrite,
      ],
      sourceValues,
    );
    const [x, z] = STREET_SHOWCASE_SEGMENTS[0].a;
    parent.position.set(x, 3, z);
    receiver.update();
    assert.equal(receiver.weight.value, 1);
    parent.position.set(100000, 3, 100000);
    receiver.update();
    assert.equal(receiver.weight.value, 0);
    parent.position.set(x, 300, z);
    receiver.update();
    assert.equal(receiver.weight.value, 0);
  } finally {
    receiver.dispose();
    lighting.dispose();
    assert.equal(dark.customProgramCacheKey(), oldKey);
    assert.equal(paint.customProgramCacheKey(), oldPaintKey);
    disposeCar(car.group);
  }
});

void test('material disposal and later independent hooks unwind without restoring stale wrappers', () => {
  const car = makeRoadster(),
    parent = new THREE.Group(),
    lighting = new NightStreetLighting(base);
  parent.add(car.group);
  const dark = car.group.getObjectByName('roadster/dark').material;
  const originalCompile = dark.onBeforeCompile,
    originalKey = dark.customProgramCacheKey;
  const receiver = new PilotNightRoadster(parent, car.group, lighting);
  dark.dispose();
  assert.strictEqual(dark.onBeforeCompile, originalCompile);
  assert.strictEqual(dark.customProgramCacheKey, originalKey);
  receiver.dispose();
  lighting.dispose();
  disposeCar(car.group);

  const other = new THREE.MeshStandardMaterial();
  other.userData.streetSurface = { role: 'leather' };
  const source = Reflect.get(other, 'onBeforeCompile');
  const release = installPilotRoadsterGrille(other);
  const grille = Reflect.get(other, 'onBeforeCompile');
  const later = function (shader, renderer) {
    grille.call(other, shader, renderer);
    shader.fragmentShader += '\n// later wrapper';
  };
  other.onBeforeCompile = later;
  release();
  assert.strictEqual(
    Reflect.get(other, 'onBeforeCompile'),
    later,
    'a later owner remains installed',
  );
  const s = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  };
  later.call(other, s, {});
  assert.doesNotMatch(s.fragmentShader, /pilotGrilleFinish/);
  assert.match(s.fragmentShader, /later wrapper/);
  other.onBeforeCompile = source;
  other.dispose();
});
