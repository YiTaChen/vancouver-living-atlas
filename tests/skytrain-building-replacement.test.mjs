import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { data, prepareParts } from './helpers/region-rule-audit.mjs';

const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { createProfile, summarizeStructures } = await import(
  cityModule('facade-profile')
);
const { project } = await import(cityModule('geo'));
const station = JSON.parse(
  readFileSync(
    new URL(
      '../public/models/skytrain-stations/main-street-science-world.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const origin = project(station.lonlat);
const parts = prepareParts(data.buildings.features);
const structures = summarizeStructures(parts);
const profiles = new Map(
  [...structures].map(([key, structure]) => [key, createProfile(structure)]),
);
const target = 'osm-structure-303';

function fixture() {
  const selected = parts.filter(
    (part) =>
      part.key === target ||
      Math.hypot(part.center[0] - origin[0], part.center[1] - origin[1]) < 90,
  );
  const features = [...new Set(selected.map((part) => part.feature))];
  assert(
    features.length > 1,
    'the shader fixture includes the source station and neighboring buildings',
  );
  const sourceBefore = JSON.stringify(features);
  const e = {
    data: { buildings: { features }, roadRelief: () => 5.4 },
    elevation: () => 5.4,
    buildings: new THREE.Group(),
    extraTextures: new Set(),
    stats: {},
    uniforms: {
      night: { value: 0 },
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
    },
    renderer: { shadowMap: {} },
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
  const load = Object.getOwnPropertyDescriptor(
    THREE.TextureLoader.prototype,
    'load',
  );
  assert(load);
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    createBuildingBodies(e);
  } finally {
    Object.defineProperty(THREE.TextureLoader.prototype, 'load', load);
  }
  const mesh = e.buildings.children.find((object) => object.isMesh);
  assert(mesh);
  const before = {
    geometry: mesh.geometry,
    attributes: Object.fromEntries(
      Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [
        name,
        [...attribute.array],
      ]),
    ),
    volumes: JSON.stringify(e.data.flightBuildingVolumes),
    profiles: [...e.data.buildingProfiles],
  };
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  mesh.material.onBeforeCompile(shader, {});
  const assertImmutable = () => {
    assert.equal(JSON.stringify(features), sourceBefore);
    assert.equal(mesh.geometry, before.geometry);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes))
      assert.deepEqual([...attribute.array], before.attributes[name]);
    assert.equal(JSON.stringify(e.data.flightBuildingVolumes), before.volumes);
    assert.deepEqual([...e.data.buildingProfiles], before.profiles);
    assert.equal(mesh.visible, true, 'merged city geometry remains present');
  };
  return {
    e,
    mesh,
    shader,
    assertImmutable,
    dispose() {
      e.facadeDetails.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
      e.extraTextures.forEach((texture) => texture.dispose());
    },
  };
}

/** Evaluate only the injected shader's scalar discard condition, translated
 * literally from the actual compiled-hook text. This does not run GLSL/WebGL. */
function discardPredicate(shader) {
  const condition =
    /if\s*\((uSkyTrainReplacement[\s\S]*?)\)\s*discard\s*;/.exec(
      shader.fragmentShader,
    )?.[1];
  assert(
    condition,
    'the actual building shader contains one bounded replacement condition',
  );
  const expression = condition
    .replaceAll('uSkyTrainReplacement', 'u')
    .replaceAll('vFacade.w', 'seed')
    .replaceAll('vArchitectureWorld.xz', 'world')
    .replaceAll('u.yz', '[u.y,u.z]');
  return vm.runInNewContext(`(u,seed,world) => (${expression})`, {
    abs: Math.abs,
    distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  });
}

test('the actual city body shader binds the shared replacement uniform and discards only the matching seed inside its finite world radius', () => {
  const f = fixture();
  try {
    assert.equal(
      f.shader.uniforms.uSkyTrainReplacement,
      f.e.uniforms.skyTrainReplacement,
    );
    assert.match(
      f.shader.vertexShader,
      /vFacade\s*=\s*vec4\(uv,aStyle,aSeed\)/,
    );
    assert.match(f.shader.fragmentShader, /uniform vec4 uSkyTrainReplacement/);
    assert.match(f.shader.fragmentShader, /varying vec3 vArchitectureWorld/);
    assert.match(
      f.mesh.material.customProgramCacheKey(),
      /station-replacement/,
    );
    const discards = discardPredicate(f.shader),
      u = f.e.uniforms.skyTrainReplacement.value;
    assert.equal(discards(u, 783, origin), false, 'default replacement is off');
    u.set(783, origin[0], origin[1], 170);
    assert.equal(discards(u, 783, origin), true);
    assert.equal(
      discards(u, 782, origin),
      false,
      'adjacent identity is retained',
    );
    assert.equal(discards(u, 784, origin), false);
    assert.equal(
      discards(u, 783.11, origin),
      false,
      'seed tolerance stays bounded',
    );
    assert.equal(discards(u, 783, [origin[0] + 169.99, origin[1]]), true);
    // Use an exactly representable origin for the strict boundary assertion;
    // adding 170 to geographic projection floats can round slightly inward.
    u.set(783, 0, 0, 170);
    assert.equal(discards(u, 783, [170, 0]), false, 'world boundary is strict');
    u.set(783, origin[0], origin[1], 170);
    assert.equal(
      discards(u, 783, [origin[0] + 171, origin[1]]),
      false,
      'the same seed elsewhere is retained',
    );
    for (const radius of [0, -1]) {
      u.w = radius;
      assert.equal(discards(u, 783, origin), false);
    }
    u.set(-1, 0, 0, 0);
    f.assertImmutable();
  } finally {
    f.dispose();
  }
});

test('the real city source contains only the intended seed-matched station shell within the bounded replacement area, retaining neighboring towers', () => {
  assert.equal(profiles.get(target).seed, 783);
  const candidates = parts.filter((part) => {
    if (profiles.get(part.key).seed !== 783) return false;
    const footprint = part.feature.geometry.coordinates;
    const coordinates = footprint.flat(Infinity);
    const vertices = [];
    for (let i = 0; i < coordinates.length; i += 2)
      vertices.push(project([coordinates[i], coordinates[i + 1]]));
    const extent = Math.max(
      ...vertices.map(([x, z]) =>
        Math.hypot(x - part.center[0], z - part.center[1]),
      ),
    );
    return (
      Math.hypot(part.center[0] - origin[0], part.center[1] - origin[1]) -
        extent <
      170
    );
  });
  assert.deepEqual([...new Set(candidates.map((part) => part.key))], [target]);
  const nearby = parts.filter(
    (part) =>
      part.key !== target &&
      Math.hypot(part.center[0] - origin[0], part.center[1] - origin[1]) < 170,
  );
  assert(nearby.length > 1);
  const towers = nearby.filter((part) => part.heightM > 35);
  assert(
    towers.length > 0,
    'nearby higher buildings are part of the actual source proof',
  );
  const f = fixture();
  try {
    const discards = discardPredicate(f.shader),
      u = f.e.uniforms.skyTrainReplacement.value;
    u.set(783, origin[0], origin[1], 170);
    for (const part of nearby)
      assert.equal(
        discards(u, profiles.get(part.key).seed, part.center),
        false,
        part.key,
      );
    f.assertImmutable();
  } finally {
    f.dispose();
  }
});
