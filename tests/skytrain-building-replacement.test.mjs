import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { data, prepareParts } from './helpers/region-rule-audit.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import {
  actualTrain,
  ridePath,
  routes,
  stationOwner,
} from './helpers/skytrain-geometry.mjs';

const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { createSkyTrainGuidewayUniforms, setMainSkyTrainGuideway } =
  await import(cityModule('skytrain-guideway-clearance'));
const { createProfile, summarizeStructures } = await import(
  cityModule('facade-profile')
);
const { project, rings, inPolygon } = await import(cityModule('geo'));
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
      profiles.get(part.key).seed === 967 ||
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
    elevation: cityElevation,
    buildings: new THREE.Group(),
    extraTextures: new Set(),
    stats: {},
    uniforms: {
      night: { value: 0 },
      skyTrainReplacement: { value: new THREE.Vector4(-1, 0, 0, 0) },
      ...createSkyTrainGuidewayUniforms(),
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

function guidewayPredicate(shader) {
  const condition =
    /if\s*\((uSkyTrainGuidewayHeight[\s\S]*?)\)\s*discard\s*;/.exec(
      shader.fragmentShader,
    )?.[1];
  assert(condition, 'the actual material hook has a finite guideway predicate');
  const expression = condition
    .replaceAll('uSkyTrainGuidewayHeight', 'h')
    .replaceAll('uSkyTrainGuidewayFrame', 'f')
    .replaceAll('uSkyTrainGuidewayBounds', 'b')
    .replaceAll('vFacade.w', 'seed')
    .replaceAll('vArchitectureWorld', 'world');
  return vm.runInNewContext(`(f,b,h,seed,world) => (${expression})`, {
    abs: Math.abs,
  });
}

test('the actual body shader opens only a finite source133436 guideway and retains its street, upper tower, source303 and distant seed collision', () => {
  const f = fixture(),
    owner = stationOwner('main-street-science-world');
  try {
    for (const name of ['Frame', 'Bounds', 'Height'])
      assert.equal(
        f.shader.uniforms[`uSkyTrainGuideway${name}`],
        f.e.uniforms[`skyTrainGuideway${name}`],
      );
    assert.match(f.mesh.material.customProgramCacheKey(), /guideway/);
    const cut = guidewayPredicate(f.shader),
      uniforms = f.e.uniforms;
    const evaluate = (seed, world) =>
      cut(
        uniforms.skyTrainGuidewayFrame.value,
        uniforms.skyTrainGuidewayBounds.value,
        uniforms.skyTrainGuidewayHeight.value,
        seed,
        world,
      );
    const inside = new THREE.Vector3(...owner.toWorld([0, 9, -65]));
    assert.equal(evaluate(967, inside), false, 'neutral state cannot carve');
    const seed = f.e.data.buildingProfiles.get('133436').seed;
    assert.equal(seed, 967);
    const frame = {
      origin: owner.origin,
      yaw: owner.yaw,
      railY: owner.toWorld(owner.trainStop('expo', 'westbound').position)[1],
    };
    setMainSkyTrainGuideway(uniforms, frame, seed);
    assert.equal(evaluate(seed, inside), true);
    for (const height of [
      frame.railY - 0.4,
      frame.railY + 4,
      5,
      16.775484956,
      62,
    ])
      assert.equal(
        evaluate(seed, inside.clone().setY(height)),
        false,
        `street / upper source geometry at worldY${height} stays present`,
      );
    assert.equal(
      evaluate(783, inside),
      false,
      'source303 replacement is independent',
    );
    assert.equal(evaluate(966, inside), false);
    assert.equal(evaluate(968, inside), false);
    for (const p of [
      [-7, 9, -65],
      [7, 9, -65],
      [0, 9, -84],
      [0, 9, -45],
    ])
      assert.equal(
        evaluate(seed, new THREE.Vector3(...owner.toWorld(p))),
        false,
      );
    const far = parts.filter(
      (part) => part.key !== '133436' && profiles.get(part.key).seed === seed,
    );
    assert.deepEqual(
      [...new Set(far.map((part) => part.key))],
      ['osm-structure-163'],
    );
    for (const part of far)
      assert.equal(
        evaluate(
          seed,
          new THREE.Vector3(part.center[0], inside.y, part.center[1]),
        ),
        false,
        'the actual distant seed collision is retained',
      );
    f.e.uniforms.skyTrainReplacement.value.set(783, origin[0], origin[1], 170);
    assert.equal(
      discardPredicate(f.shader)(
        f.e.uniforms.skyTrainReplacement.value,
        783,
        origin,
      ),
      true,
    );
    setMainSkyTrainGuideway(uniforms, null);
    assert.equal(evaluate(seed, inside), false);
    assert.equal(
      discardPredicate(f.shader)(
        f.e.uniforms.skyTrainReplacement.value,
        783,
        origin,
      ),
      true,
    );
    for (const invalid of [undefined, NaN, Infinity]) {
      setMainSkyTrainGuideway(uniforms, frame, invalid);
      assert.equal(evaluate(seed, inside), false);
    }
    f.assertImmutable();
  } finally {
    owner.dispose();
    f.dispose();
  }
});

test('every sampled actual articulated cabin point inside the two blocking City bodies is covered by the bounded shader opening in both Main approaches', async () => {
  const f = fixture(),
    owner = stationOwner('main-street-science-world'),
    train = await actualTrain('expo');
  try {
    const seed = f.e.data.buildingProfiles.get('133436').seed,
      uniforms = f.e.uniforms;
    setMainSkyTrainGuideway(
      uniforms,
      {
        origin: owner.origin,
        yaw: owner.yaw,
        railY: owner.toWorld(owner.trainStop('expo', 'westbound').position)[1],
      },
      seed,
    );
    const predicate = guidewayPredicate(f.shader);
    const targetParts = parts
      .filter((part) => part.key === '133436')
      .map((part) => ({
        id: String(part.feature.properties.id),
        min: f.e.data.buildingFoundations.get(part.key) + part.minHeightM,
        max: f.e.data.buildingFoundations.get(part.key) + part.heightM,
        polygons: rings(part.feature).map((polygon) =>
          polygon.map((ring) => ring.map(project)),
        ),
      }));
    const hits = new Set(),
      world = new THREE.Vector3();
    let conflicts = 0;
    for (const segment of routes.segments.filter((segment) =>
      [segment.from, segment.to].includes('main-street-science-world'),
    )) {
      const path = ridePath(segment);
      let directionConflicts = 0;
      for (let distance = 0; distance <= 250; distance += 0.5) {
        const along =
          segment.from === 'main-street-science-world'
            ? distance
            : path.length - distance;
        train.setPathPose(path, along / path.length);
        for (const car of train.carFrames)
          for (const x of [-1.35, 0, 1.35])
            for (let i = 0; i <= 17; i++)
              for (const y of [1.1, 2.6, 3.6]) {
                world.set(x, y, -8.5 + i).applyMatrix4(car.matrixWorld);
                for (const part of targetParts) {
                  if (
                    !(world.y > part.min && world.y < part.max) ||
                    !part.polygons.some((polygon) =>
                      inPolygon([world.x, world.z], polygon),
                    )
                  )
                    continue;
                  assert.equal(
                    predicate(
                      uniforms.skyTrainGuidewayFrame.value,
                      uniforms.skyTrainGuidewayBounds.value,
                      uniforms.skyTrainGuidewayHeight.value,
                      seed,
                      world,
                    ),
                    true,
                    `${segment.from}→${segment.to}, ${part.id}, car${car.name}, world${world.toArray().join(',')}`,
                  );
                  hits.add(part.id);
                  directionConflicts++;
                  conflicts++;
                }
              }
      }
      assert(
        directionConflicts > 0,
        'each direction encounters the actual coarse GIS overlap',
      );
    }
    assert(conflicts > 1000, 'the correction covers a dense real cabin sweep');
    assert.deepEqual(
      [...hits].sort((a, b) => a.localeCompare(b)),
      ['163974', '166039-cut1'],
    );
    f.assertImmutable();
  } finally {
    train.dispose();
    owner.dispose();
    f.dispose();
  }
});
