// Hook identity comparisons intentionally retain unbound methods; calls always
// use their original material as the receiver.
/* oxlint-disable typescript/unbound-method */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { applySkyTrainWorldOpenings } = await import(
  cityModule('skytrain-world-openings')
);
const { NightStreetLighting } = await import(
  cityModule('night-street-lighting')
);
const { installPedestrianOverrideMaterial } = await import(
  cityModule('city-life/pedestrian-renderer')
);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const mesh = (material = new THREE.MeshStandardMaterial()) =>
  new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), material);
function compile(material, library = THREE.ShaderLib.standard) {
  const shader = {
    uniforms: {},
    vertexShader: library.vertexShader,
    fragmentShader: library.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  return shader;
}
function dispose(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    for (const material of object.material ? [].concat(object.material) : [])
      material.dispose();
  });
}

test('a local cutaway reveals only foreground walls/roofs and retains the floor, adjacent city and background', () => {
  const wall = mesh(),
    cutaway = new TravelOcclusion([wall]);
  const geometry = wall.geometry,
    material = wall.material;
  const flags = [
    material.opacity,
    material.transparent,
    material.depthWrite,
    material.side,
  ];
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  assert(cutaway.coverageAt(v(0, 2.05, -4)) > 0.9);
  assert.equal(
    cutaway.coverageAt(v(4, 2.05, -4)),
    0,
    'adjacent facade is opaque',
  );
  assert.equal(
    cutaway.coverageAt(v(0, 1.1, 2)),
    0,
    'behind player remains opaque',
  );
  assert.equal(
    cutaway.coverageAt(v(0, 0.08, -4)),
    0,
    'physical walking floor is retained',
  );
  assert.equal(
    cutaway.coverageAt(v(0, -4, -4)),
    0,
    'stacked floor below stays opaque',
  );
  const inner = cutaway.coverageAt(v(0.45, 2.05, -4));
  const edge = cutaway.coverageAt(v(0.6, 2.05, -4));
  assert(inner > edge && edge > 0, 'soft local border precedes ordered dither');
  assert.strictEqual(wall.geometry, geometry);
  assert.strictEqual(wall.material, material);
  assert.deepEqual(
    [
      material.opacity,
      material.transparent,
      material.depthWrite,
      material.side,
    ],
    flags,
  );
  const shader = compile(material);
  assert.match(
    shader.fragmentShader,
    /travelCutawayThreshold < travelCutawayCoverage/,
  );
  assert.match(shader.fragmentShader, /gl_FragCoord/);
  assert.equal(shader.fragmentShader.includes('diffuseColor.a ='), false);
  cutaway.dispose();
  dispose(wall);
});

test('real InstancedMesh keeps each world transform and cuts no adjacent batch instances', () => {
  const batch = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 3, 0.2),
    new THREE.MeshStandardMaterial(),
    3,
  );
  const matrix = new THREE.Matrix4();
  batch.position.set(500, 8, 900);
  batch.rotation.y = Math.PI / 2;
  batch.setMatrixAt(0, matrix.makeTranslation(0, 1.5, -4));
  batch.setMatrixAt(1, matrix.makeTranslation(30, 1.5, -4));
  batch.setMatrixAt(2, matrix.makeTranslation(0, 1.5, 5));
  batch.updateMatrixWorld(true);
  const cutaway = new TravelOcclusion([batch]);
  const point = (index) => {
    batch.getMatrixAt(index, matrix);
    return v(0, 0, 0).applyMatrix4(matrix).applyMatrix4(batch.matrixWorld);
  };
  const camera = batch.localToWorld(v(0, 1.9, -8));
  const feet = batch.localToWorld(v(0, 0, 0));
  cutaway.update(camera, feet);
  assert(cutaway.coverageAt(point(0)) > 0.9);
  assert.equal(cutaway.coverageAt(point(1)), 0);
  assert.equal(cutaway.coverageAt(point(2)), 0);
  const shader = compile(batch.material);
  const vertex = shader.vertexShader;
  assert(
    vertex.indexOf('#include <skinning_vertex>') <
      vertex.indexOf('vec4 travelCutawayPosition'),
  );
  assert(
    vertex.indexOf('batchingMatrix * travelCutawayPosition') <
      vertex.indexOf('instanceMatrix * travelCutawayPosition'),
  );
  assert(
    vertex.indexOf('instanceMatrix * travelCutawayPosition') <
      vertex.indexOf('modelMatrix * travelCutawayPosition'),
  );
  assert(
    vertex.indexOf('modelMatrix * travelCutawayPosition') <
      vertex.indexOf('#include <project_vertex>'),
  );
  assert.equal(batch.count, 3);
  assert.equal(cutaway.snapshot().materialCount, 1);
  cutaway.dispose();
  dispose(batch);
});

test('existing real station aperture and night lighting hooks, uniforms and cache identity survive chaining', () => {
  const root = mesh();
  const lighting = new NightStreetLighting({
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    size: 32,
    allowed: () => true,
    lamps: [],
    roads: [],
  });
  const sourceVariant = 'warm';
  root.material.customProgramCacheKey = function () {
    assert.strictEqual(this, root.material);
    return `source-pbr-${sourceVariant}`;
  };
  lighting.wrapMaterial(root.material);
  const openings = applySkyTrainWorldOpenings([root]);
  const before = root.material.onBeforeCompile;
  const beforeKey = root.material.customProgramCacheKey;
  const sourceKey = beforeKey.call(root.material);
  const cutaway = new TravelOcclusion([root]);
  const shader = compile(root.material);
  assert.match(shader.vertexShader, /vStationOpeningWorld/);
  assert.match(shader.vertexShader, /vTravelCutawayWorld/);
  assert.match(shader.fragmentShader, /uAtlasNight/);
  assert.match(shader.fragmentShader, /uStationOpeningCount/);
  assert.strictEqual(shader.uniforms.uTravelCutawayEnabled.value, 0);
  assert.equal(
    root.material.customProgramCacheKey(),
    sourceKey + '|travel-local-cutaway-v1',
  );
  root.material.color.set(0x123456);
  root.material.emissiveIntensity = 0.42;
  cutaway.update(v(0, 2, -5), v(0, 0, 0));
  assert.equal(root.material.color.getHex(), 0x123456);
  assert.equal(root.material.emissiveIntensity, 0.42);
  cutaway.dispose();
  assert.strictEqual(root.material.onBeforeCompile, before);
  assert.strictEqual(root.material.customProgramCacheKey, beforeKey);
  assert.equal(shader.uniforms.uTravelCutawayEnabled.value, 0);
  assert.match(compile(root.material).fragmentShader, /uStationOpeningCount/);
  openings.dispose();
  lighting.dispose();
  dispose(root);
});

test('dynamic source cache keys and default compile fingerprints remain valid and restore exactly', () => {
  const root = mesh(),
    material = root.material;
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey;
  const key = material.customProgramCacheKey();
  const cutaway = new TravelOcclusion([root]);
  assert.equal(
    material.customProgramCacheKey(),
    key + '|travel-local-cutaway-v1',
  );
  cutaway.dispose();
  assert.strictEqual(material.onBeforeCompile, originalCompile);
  assert.strictEqual(material.customProgramCacheKey, originalKey);
  let variant = 1;
  material.customProgramCacheKey = () => `source-${variant}`;
  const second = new TravelOcclusion([root]);
  assert.equal(
    material.customProgramCacheKey(),
    'source-1|travel-local-cutaway-v1',
  );
  variant = 2;
  assert.equal(
    material.customProgramCacheKey(),
    'source-2|travel-local-cutaway-v1',
  );
  second.dispose();
  dispose(root);
});

test('transparent glass and opted-out/portal subtrees are untouched, including late root refresh', () => {
  const root = new THREE.Group();
  const glass = mesh(
    new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.3 }),
  );
  const fractional = mesh(new THREE.MeshBasicMaterial({ opacity: 0.8 }));
  const portal = new THREE.Group();
  portal.userData.portalId = 'station-door';
  const ring = mesh();
  portal.add(ring);
  const nonPhysical = mesh();
  nonPhysical.userData.cameraCollision = false;
  const optedOut = mesh();
  optedOut.userData.travelOcclusion = false;
  const materialOptOut = mesh();
  materialOptOut.material.userData.travelOcclusion = false;
  const shaderMaterial = mesh(new THREE.ShaderMaterial());
  root.add(
    glass,
    fractional,
    portal,
    nonPhysical,
    optedOut,
    materialOptOut,
    shaderMaterial,
  );
  const untouched = [
    glass,
    fractional,
    ring,
    nonPhysical,
    optedOut,
    materialOptOut,
    shaderMaterial,
  ].map((object) => [object.material, object.material.onBeforeCompile]);
  const cutaway = new TravelOcclusion([root]);
  assert.equal(cutaway.snapshot().materialCount, 0);
  assert.equal(cutaway.snapshot().unsupportedMaterialCount, 1);
  for (const [material, before] of untouched)
    assert.strictEqual(material.onBeforeCompile, before);
  const wall = mesh();
  root.add(wall);
  cutaway.refresh();
  cutaway.refresh([root]);
  assert.equal(
    cutaway.snapshot().materialCount,
    1,
    'repeated admission patches once',
  );
  const replacement = new THREE.MeshStandardMaterial();
  const previous = wall.material;
  wall.material = replacement;
  cutaway.refresh([wall]);
  assert.equal(
    cutaway.snapshot().materialCount,
    2,
    'same mesh can gain late materials',
  );
  previous.dispose();
  assert.equal(
    cutaway.snapshot().materialCount,
    1,
    'disposed material releases retained patch',
  );
  cutaway.dispose();
  dispose(root);
});

test('update uses only stable shared uniforms and does not traverse, raycast or recompile each frame', () => {
  const root = mesh(),
    cutaway = new TravelOcclusion([root]);
  const shader = compile(root.material);
  const uniforms = Object.entries(shader.uniforms);
  const refs = uniforms.map(([, uniform]) => uniform.value);
  const version = root.material.version;
  root.traverse = () => {
    throw Error('per-frame traversal');
  };
  root.raycast = () => {
    throw Error('per-frame raycast');
  };
  const camera = v(0, 3, -8),
    feet = v(0, 0, 0);
  for (let i = 0; i < 1000; i++) {
    camera.x = Math.sin(i / 50);
    cutaway.update(camera, feet);
  }
  assert.equal(root.material.version, version);
  for (let i = 0; i < uniforms.length; i++)
    if (typeof refs[i] === 'object')
      assert.strictEqual(uniforms[i][1].value, refs[i]);
  assert.equal(cutaway.snapshot().updates, 1000);
  assert.equal(shader.uniforms.uTravelCutawayEnabled.value, 1);
  cutaway.clear();
  assert.equal(shader.uniforms.uTravelCutawayEnabled.value, 0);
  cutaway.dispose();
  root.geometry.dispose();
  root.material.dispose();
});

test('range, radius and invalid input are bounded; first-person coincident torso is finite and clear restores rendering', () => {
  const cutaway = new TravelOcclusion();
  cutaway.update(v(0, 2, -500), v(0, 0, 0), { radius: 100, strength: 10 });
  assert.equal(cutaway.snapshot().length, 32);
  assert.equal(cutaway.snapshot().radius, 1.8);
  assert.equal(cutaway.snapshot().strength, 1);
  assert.equal(
    cutaway.coverageAt(v(0, 2, -500)),
    0,
    'cutaway never spans the city',
  );
  cutaway.update(v(0, 1.1, 0), v(0, 0, 0));
  assert.equal(cutaway.snapshot().active, false);
  cutaway.update(v(0, 1.1, 0), v(0, 0, 0), { firstPerson: true });
  assert(cutaway.coverageAt(v(0.1, 1.1, 0)) > 0.9);
  cutaway.update(v(NaN, 1, 0), v(0, 0, 0));
  assert.equal(cutaway.snapshot().active, false);
  cutaway.update(v(0, 2, -5), v(0, 0, 0), {
    radius: NaN,
    subjectHeight: Infinity,
  });
  assert(cutaway.snapshot().end.every(Number.isFinite));
  cutaway.update(v(0, 2, -5), v(0, 0, 0), { enabled: false });
  assert.equal(cutaway.snapshot().active, false);
  cutaway.dispose();
});

test('unsupported source shader fails closed without breaking it and reports a diagnostic', () => {
  const root = mesh();
  root.material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'void main() { gl_Position = vec4(0.0); }';
  };
  const cutaway = new TravelOcclusion([root]);
  const shader = compile(root.material);
  assert.equal(shader.vertexShader, 'void main() { gl_Position = vec4(0.0); }');
  assert.equal(shader.uniforms.uTravelCutawayEnabled, undefined);
  assert.equal(cutaway.snapshot().shaderFailures, 1);
  cutaway.dispose();
  dispose(root);
});

test('disposal restores borrowed hooks/resources and preserves a later installed effect', () => {
  const root = mesh(),
    material = root.material;
  let materialDisposals = 0,
    geometryDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  root.geometry.addEventListener('dispose', () => geometryDisposals++);
  const cutaway = new TravelOcclusion([root]);
  const ourCompile = material.onBeforeCompile,
    ourKey = material.customProgramCacheKey;
  const laterCompile = function (shader, renderer) {
    ourCompile.call(this, shader, renderer);
    shader.fragmentShader += '\n// later effect';
  };
  const laterKey = function () {
    return ourKey.call(this) + '|later';
  };
  material.onBeforeCompile = laterCompile;
  material.customProgramCacheKey = laterKey;
  cutaway.update(v(0, 2, -6), v(0, 0, 0));
  const shader = compile(material);
  cutaway.dispose();
  cutaway.dispose();
  assert.strictEqual(material.onBeforeCompile, laterCompile);
  assert.strictEqual(material.customProgramCacheKey, laterKey);
  assert.equal(shader.uniforms.uTravelCutawayEnabled.value, 0);
  assert.equal(cutaway.snapshot().materialCount, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(geometryDisposals, 0);
  const updates = cutaway.snapshot().updates;
  cutaway.update(v(0, 2, -6), v(0, 0, 0));
  cutaway.refresh([root]);
  assert.equal(cutaway.snapshot().updates, updates);
  assert.equal(cutaway.snapshot().materialCount, 0);
  assert.match(compile(material).fragmentShader, /later effect/);
  dispose(root);
});

test('streamed nested architecture is enrolled by public child events, with opt-outs and exact listener cleanup', () => {
  const root = new THREE.Group(),
    cutaway = new TravelOcclusion([root]);
  assert.equal(cutaway.snapshot().watchedObjects, 1);
  const architecture = new THREE.Group(),
    facade = new THREE.Group(),
    wall = mesh();
  architecture.add(facade);
  facade.add(wall);
  root.add(architecture);
  assert.equal(cutaway.snapshot().watchedObjects, 4);
  assert.equal(cutaway.snapshot().materialCount, 1);
  const lateRoof = mesh();
  facade.add(lateRoof);
  assert.match(
    compile(lateRoof.material).fragmentShader,
    /uTravelCutawayEnabled/,
  );
  assert.equal(cutaway.snapshot().watchedObjects, 5);
  const optedOut = new THREE.Group(),
    decoration = mesh();
  optedOut.userData.cameraCollision = false;
  optedOut.add(decoration);
  root.add(optedOut);
  const original = decoration.material.onBeforeCompile;
  cutaway.refresh([decoration]);
  assert.strictEqual(
    decoration.material.onBeforeCompile,
    original,
    'ancestor opt-out applies to direct refresh too',
  );
  assert.equal(cutaway.snapshot().watchedObjects, 5);
  architecture.removeFromParent();
  assert.equal(cutaway.snapshot().watchedObjects, 1);
  assert.equal(cutaway.snapshot().meshCount, 0);
  assert.equal(
    cutaway.snapshot().materialCount,
    2,
    'shared material patches survive a detached root',
  );
  for (const object of [architecture, facade, wall, lateRoof]) {
    assert.equal(object._listeners?.childadded?.length ?? 0, 0);
    assert.equal(object._listeners?.childremoved?.length ?? 0, 0);
  }
  const detachedAddition = mesh();
  facade.add(detachedAddition);
  assert.equal(cutaway.snapshot().materialCount, 2);
  root.add(architecture);
  assert.equal(cutaway.snapshot().materialCount, 3);
  assert.equal(cutaway.snapshot().watchedObjects, 6);
  cutaway.dispose();
  assert.equal(cutaway.snapshot().watchedObjects, 0);
  for (const object of [
    root,
    architecture,
    facade,
    wall,
    lateRoof,
    detachedAddition,
  ]) {
    assert.equal(object._listeners?.childadded?.length ?? 0, 0);
    assert.equal(object._listeners?.childremoved?.length ?? 0, 0);
  }
  const afterDispose = mesh();
  facade.add(afterDispose);
  assert.equal(cutaway.snapshot().materialCount, 0);
  dispose(root);
});

test('SSAO override removes foreground depth without mismatched dither and retains standing/seated body normals', () => {
  const normal = new THREE.MeshNormalMaterial();
  const originalCompile = normal.onBeforeCompile,
    originalKey = normal.customProgramCacheKey;
  const restorePedestrian = installPedestrianOverrideMaterial(normal);
  const pedestrianCompile = normal.onBeforeCompile,
    pedestrianKey = normal.customProgramCacheKey;
  const cutaway = new TravelOcclusion();
  const release = cutaway.prepareMaterial(normal, { normalPass: true });
  const shader = compile(normal, THREE.ShaderLib.normal);
  assert.match(shader.vertexShader, /pedestrianRigidLimb/);
  assert.match(shader.vertexShader, /instanceMatrix \* travelCutawayPosition/);
  assert.match(shader.fragmentShader, /travelCutawayCoverage > 0\.001/);
  assert.equal(
    shader.fragmentShader.includes('gl_FragCoord'),
    false,
    'AO pixel coordinates need not match full-resolution color',
  );
  assert.match(shader.fragmentShader, /uTravelCutawayEnd.xz\) < 0\.70/);
  assert.match(
    normal.customProgramCacheKey(),
    /travel-local-cutaway-v1-normal$/,
  );
  for (const floor of [0, 4.2, -7.5]) {
    const feet = v(0, floor, 0);
    cutaway.update(v(0, floor + 2.8, -8), feet);
    for (const y of [0.2, 0.5, 0.9, 1.3, 1.8])
      assert.equal(
        cutaway.coverageAt(v(0.15, floor + y, -0.2), { normalPass: true }),
        0,
        `body retained at local height ${y} above standing/seated world floor ${floor}`,
      );
    assert(
      cutaway.coverageAt(v(0, floor + 1.95, -4), { normalPass: true }) > 0.9,
    );
  }
  release();
  release();
  assert.strictEqual(normal.onBeforeCompile, pedestrianCompile);
  assert.strictEqual(normal.customProgramCacheKey, pedestrianKey);
  restorePedestrian();
  assert.strictEqual(normal.onBeforeCompile, originalCompile);
  assert.strictEqual(normal.customProgramCacheKey, originalKey);
  cutaway.dispose();
  normal.dispose();
});

test('normal endpoint protection covers the actual standing/seated male/female walker vertices at any chase yaw', async () => {
  const { makeWalker } = await import(cityModule('assets/walker'));
  const cutaway = new TravelOcclusion();
  const point = new THREE.Vector3();
  for (const character of ['male', 'female']) {
    const walker = makeWalker(character);
    walker.group.position.set(40, 12, -20);
    walker.group.rotation.y = 1.1;
    for (const seated of [false, true]) {
      walker.setSeated(seated, 0.46);
      walker.group.updateMatrixWorld(true);
      for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const camera = walker.group.position
          .clone()
          .add(v(Math.sin(yaw) * 8, 2.8, Math.cos(yaw) * 8));
        cutaway.update(camera, walker.group.position);
        let vertices = 0;
        walker.group.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positions = object.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            point
              .fromBufferAttribute(positions, i)
              .applyMatrix4(object.matrixWorld);
            assert.equal(
              cutaway.coverageAt(point, { normalPass: true }),
              0,
              `${character} seated=${seated} yaw=${yaw} vertex ${point.toArray().join(',')}`,
            );
            vertices++;
          }
        });
        assert(vertices > 100);
      }
    }
    dispose(walker.group);
  }
  cutaway.dispose();
});

test('stale override release callback cannot remove a newer patch on the same material', () => {
  const material = new THREE.MeshNormalMaterial(),
    cutaway = new TravelOcclusion();
  const stale = cutaway.prepareMaterial(material, { normalPass: true });
  stale();
  const current = cutaway.prepareMaterial(material, { normalPass: true });
  stale();
  assert.equal(cutaway.snapshot().materialCount, 1);
  assert.match(
    compile(material, THREE.ShaderLib.normal).fragmentShader,
    /uTravelCutawayEnabled/,
  );
  current();
  assert.equal(cutaway.snapshot().materialCount, 0);
  cutaway.dispose();
  material.dispose();
});

test('production engine updates cutaway before render from the current transformed avatar and clears it for hidden/Overview/drive views', async () => {
  const source = readFileSync(
    new URL('../lib/city/engine.ts', import.meta.url),
    'utf8',
  );
  const ast = ts.createSourceFile(
    'engine.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const city = ast.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === 'CityEngine',
  );
  const render = city.members.find(
    (node) => node.name?.getText(ast) === 'renderScene',
  );
  const code = ts.transpileModule(
    `export class EngineRender { ${render.getText(ast)} }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const { EngineRender } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  const frame = new THREE.Group(),
    avatar = new THREE.Group(),
    root = mesh();
  frame.add(avatar);
  frame.position.set(500, 12, 800);
  frame.rotation.y = 0.8;
  avatar.position.set(2, 4, 3);
  const cutaway = new TravelOcclusion([root]);
  let expected = true,
    draws = 0;
  const engine = Object.assign(Object.create(EngineRender.prototype), {
    navigation: { walker: { group: avatar } },
    settings: { mode: 'walk', quality: 'balanced' },
    camera: new THREE.PerspectiveCamera(),
    controls: { target: new THREE.Vector3() },
    occlusionSubject: new THREE.Vector3(),
    travelOcclusion: cutaway,
    landmarkDetails: [],
    updateShadowFrustum() {},
    sceneryPreparation: { pump() {} },
    compatibleGraphics: true,
    scene: new THREE.Scene(),
    renderer: {
      info: { reset() {} },
      shadowMap: { enabled: false },
      render() {
        assert.equal(
          cutaway.snapshot().active,
          expected,
          'cutaway updated before GPU submission',
        );
        draws++;
      },
    },
  });
  engine.camera.position.set(500, 18, 790);
  engine.renderScene();
  assert.deepEqual(
    cutaway.snapshot().end,
    avatar
      .getWorldPosition(v(0, 0, 0))
      .add(v(0, 1.1, 0))
      .toArray(),
  );
  frame.position.x += 4;
  engine.camera.position.x += 4;
  engine.renderScene();
  assert.deepEqual(cutaway.snapshot().start, engine.camera.position.toArray());
  expected = false;
  avatar.visible = false;
  engine.renderScene();
  avatar.visible = true;
  engine.settings.mode = 'orbit';
  engine.renderScene();
  engine.settings.mode = 'drive';
  engine.renderScene();
  expected = true;
  engine.settings.mode = 'walk';
  engine.renderScene();
  assert.equal(draws, 6);
  cutaway.dispose();
  dispose(root);
});

test('actual Waterfront stair enclosure admits its opaque materials without changing support geometry', async () => {
  const { stationOwner } = await import('./helpers/skytrain-geometry.mjs');
  const owner = stationOwner('waterfront');
  const geometry = [],
    materials = [];
  owner.group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometry.push([object, object.geometry]);
      materials.push([object, object.material]);
    }
  });
  const cutaway = new TravelOcclusion([owner.group]);
  assert(cutaway.snapshot().materialCount > 0);
  const unique = new Set();
  for (const [object, source] of materials) {
    assert.strictEqual(object.material, source);
    for (const material of [].concat(source)) {
      if (material.transparent || material.opacity < 1 || unique.has(material))
        continue;
      unique.add(material);
      const shader = compile(material);
      assert.match(shader.fragmentShader, /uTravelCutawayEnabled/);
    }
  }
  assert.equal(cutaway.snapshot().shaderFailures, 0);
  for (const [object, source] of geometry)
    assert.strictEqual(object.geometry, source);
  cutaway.dispose();
  owner.dispose();
});
