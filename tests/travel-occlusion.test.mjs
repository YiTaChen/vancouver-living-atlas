// Hook identity comparisons intentionally retain unbound methods; calls always
// use their original material as the receiver.
/* oxlint-disable typescript/unbound-method */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

test('whole occluding walls and roofs disappear with no local opening, while floors, neighboring objects and background remain', async () => {
  const root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    wall = new THREE.Mesh(new THREE.BoxGeometry(12, 3, 0.2), material),
    adjacent = new THREE.Mesh(wall.geometry, material),
    background = new THREE.Mesh(wall.geometry, material);
  wall.position.set(0, 1.5, -4);
  adjacent.position.set(20, 1.5, -4);
  background.position.set(0, 1.5, 4);
  root.add(wall, adjacent, background);
  const cutaway = new TravelOcclusion([root]),
    geometry = wall.geometry,
    flags = [
      material.opacity,
      material.transparent,
      material.depthWrite,
      material.side,
    ];
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  for (const x of [-5.9, 0, 5.9])
    for (const normalPass of [false, true])
      assert.equal(
        cutaway.coverageAt(v(x, 2, -4), { object: wall, normalPass }),
        1,
        'the whole selected wall disappears, including both far edges',
      );
  assert.equal(cutaway.coverageAt(v(20, 2, -4), { object: adjacent }), 0);
  assert.equal(cutaway.coverageAt(v(0, 2, 4), { object: background }), 0);
  assert.equal(
    cutaway.coverageAt(v(0, 0.08, -4), { object: wall }),
    0,
    'walking floor is retained',
  );
  assert.equal(cutaway.coverageAt(v(0, -4, -4), { object: wall }), 0);
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
  assert.match(shader.fragmentShader, /vTravelOccluderSelected > 0\.5/);
  assert.match(shader.fragmentShader, /\) discard;/);
  assert.equal(shader.fragmentShader.includes('gl_FragCoord'), false);
  assert.equal(shader.fragmentShader.includes('travelCutawayCoverage'), false);
  assert.equal(shader.fragmentShader.includes('diffuseColor.a ='), false);
  assert.equal(cutaway.snapshot().mode, 'full-occluder');
  assert.equal(
    cutaway.snapshot().pieceCount,
    1,
    'shared box geometry is registered only once',
  );
  cutaway.dispose();
  geometry.dispose();
  await Promise.resolve();
  assert.equal(geometry.hasAttribute('aTravelOccluderMin'), false);
  assert.equal(geometry.hasAttribute('aTravelOccluderMax'), false);
  dispose(root);
});

test('real InstancedMesh isolates whole transformed instances despite shared geometry and material', () => {
  const batch = new THREE.InstancedMesh(
    new THREE.BoxGeometry(12, 3, 0.2),
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
  const point = (index, x = 0) => {
    batch.getMatrixAt(index, matrix);
    return v(x, 0, 0).applyMatrix4(matrix).applyMatrix4(batch.matrixWorld);
  };
  cutaway.update(
    batch.localToWorld(v(0, 1.9, -8)),
    batch.localToWorld(v(0, 0, 0)),
  );
  for (const x of [-5.9, 0, 5.9])
    assert.equal(
      cutaway.coverageAt(point(0, x), { object: batch, instanceId: 0 }),
      1,
    );
  assert.equal(
    cutaway.coverageAt(point(1), { object: batch, instanceId: 1 }),
    0,
  );
  assert.equal(
    cutaway.coverageAt(point(2), { object: batch, instanceId: 2 }),
    0,
  );
  const vertex = compile(batch.material).vertexShader;
  assert(
    vertex.indexOf('#include <skinning_vertex>') <
      vertex.indexOf('mat4 travelOccluderTransform'),
  );
  assert(
    vertex.indexOf('batchingMatrix * travelOccluderTransform') <
      vertex.indexOf('instanceMatrix * travelOccluderTransform'),
  );
  assert(
    vertex.indexOf('instanceMatrix * travelOccluderTransform') <
      vertex.indexOf('modelMatrix * travelOccluderTransform'),
  );
  assert(
    vertex.indexOf('modelMatrix * travelOccluderTransform') <
      vertex.indexOf('#include <project_vertex>'),
  );
  assert.match(
    vertex,
    /cross\(travelOccluderLinear\[1\], travelOccluderLinear\[2\]\)/,
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
    sourceKey + '|travel-full-occluder-v2',
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
    key + '|travel-full-occluder-v2',
  );
  cutaway.dispose();
  assert.strictEqual(material.onBeforeCompile, originalCompile);
  assert.strictEqual(material.customProgramCacheKey, originalKey);
  let variant = 1;
  material.customProgramCacheKey = () => `source-${variant}`;
  const second = new TravelOcclusion([root]);
  assert.equal(
    material.customProgramCacheKey(),
    'source-1|travel-full-occluder-v2',
  );
  variant = 2;
  assert.equal(
    material.customProgramCacheKey(),
    'source-2|travel-full-occluder-v2',
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

test('range, margin and invalid input stay bounded; a coincident query remains finite and clear restores rendering', () => {
  const wall = mesh();
  wall.position.set(0, 1.5, 0);
  const cutaway = new TravelOcclusion([wall]);
  cutaway.update(v(0, 2, -500), v(0, 0, 0), { radius: 100, strength: 10 });
  assert.equal(cutaway.snapshot().length, 32);
  assert.equal(cutaway.snapshot().radius, 1.8);
  assert.equal(cutaway.snapshot().strength, 1);
  const remote = mesh();
  remote.position.set(0, 1.5, -500);
  cutaway.refresh([remote]);
  assert.equal(cutaway.coverageAt(v(0, 2, -500), { object: remote }), 0);
  cutaway.update(v(0, 1.1, 0), v(0, 0, 0));
  assert.equal(cutaway.snapshot().active, false);
  cutaway.update(v(0, 1.1, 0), v(0, 0, 0), { firstPerson: true });
  assert.equal(cutaway.coverageAt(v(0.1, 1.1, 0), { object: wall }), 1);
  cutaway.update(v(NaN, 1, 0), v(0, 0, 0));
  assert.equal(cutaway.snapshot().active, false);
  cutaway.update(v(0, 2, -5), v(0, 0, 0), {
    radius: NaN,
    subjectHeight: Infinity,
  });
  assert(cutaway.snapshot().end.every(Number.isFinite));
  cutaway.update(v(0, 2, -5), v(0, 0, 0), { strength: 0 });
  assert.equal(cutaway.snapshot().active, false);
  cutaway.update(v(0, 2, -5), v(0, 0, 0), { enabled: false });
  assert.equal(cutaway.snapshot().active, false);
  cutaway.dispose();
  dispose(wall);
  dispose(remote);
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

test('cancelled never-attached staged landmark groups release all node listeners without taking resource ownership', async () => {
  const { disposeDetachedLandmark } = await import(
    cityModule('landmark-worker-service')
  );
  const cityRoot = new THREE.Group(),
    cutaway = new TravelOcclusion([cityRoot]);
  const cancelled = [];
  let geometryDisposals = 0,
    materialDisposals = 0;
  for (let i = 0; i < 3; i++) {
    const staged = new THREE.Group(),
      wall = mesh();
    staged.add(wall);
    cancelled.push(staged);
    wall.geometry.addEventListener('dispose', () => geometryDisposals++);
    wall.material.addEventListener('dispose', () => materialDisposals++);
    cutaway.refresh([staged]);
  }
  assert.equal(cutaway.snapshot().watchedObjects, 7);
  assert.equal(cutaway.snapshot().meshCount, 3);
  for (const staged of cancelled) {
    const wall = staged.children[0],
      patched = wall.material.onBeforeCompile;
    cutaway.releaseSubtree(staged);
    cutaway.releaseSubtree(staged);
    assert.strictEqual(
      wall.material.onBeforeCompile,
      patched,
      'release does not restore shared material hooks',
    );
    assert.equal(
      staged.children.length,
      1,
      'release preserves the source hierarchy',
    );
    for (const object of [staged, wall])
      for (const event of ['childadded', 'childremoved', 'removed'])
        assert.equal(object._listeners?.[event]?.length ?? 0, 0);
  }
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(cutaway.snapshot().watchedObjects, 1);
  assert.equal(cutaway.snapshot().meshCount, 0);
  assert.equal(
    cutaway.snapshot().materialCount,
    3,
    'materials remain borrowed until their owner disposes',
  );
  for (const staged of cancelled) disposeDetachedLandmark(staged);
  assert.equal(geometryDisposals, 3);
  assert.equal(materialDisposals, 3);
  assert.equal(cutaway.snapshot().materialCount, 0);
  assert.equal(
    cutaway.snapshot().watchedObjects,
    1,
    'resource disposal does not require clearing source children',
  );
  assert(cancelled.every((group) => group.children.length === 1));
  cutaway.dispose();
});

test('successful staged warmup releases node tracking then re-enrolls on watched-parent commit, preserving shared hooks', () => {
  const cityRoot = new THREE.Group(),
    shared = new THREE.MeshStandardMaterial();
  const live = mesh(shared);
  cityRoot.add(live);
  const cutaway = new TravelOcclusion([cityRoot]);
  const staged = new THREE.Group(),
    nested = new THREE.Group(),
    wall = mesh(shared);
  nested.add(wall);
  staged.add(nested);
  cutaway.refresh([staged]);
  const before = shared.onBeforeCompile;
  assert.equal(cutaway.snapshot().watchedObjects, 5);
  cutaway.releaseSubtree(staged);
  assert.equal(cutaway.snapshot().watchedObjects, 2);
  assert.equal(cutaway.snapshot().materialCount, 1);
  assert.strictEqual(shared.onBeforeCompile, before);
  const late = mesh();
  nested.add(late);
  assert.equal(
    cutaway.snapshot().materialCount,
    1,
    'released staging nodes do not retain add listeners',
  );
  cityRoot.add(staged);
  assert.equal(cutaway.snapshot().watchedObjects, 6);
  assert.equal(cutaway.snapshot().meshCount, 3);
  assert.equal(cutaway.snapshot().materialCount, 2);
  const afterCommit = mesh();
  nested.add(afterCommit);
  assert.equal(cutaway.snapshot().watchedObjects, 7);
  assert.match(
    compile(afterCommit.material).fragmentShader,
    /uTravelCutawayEnabled/,
  );
  cutaway.dispose();
  dispose(cityRoot);
});

test('explicit dynamic roots under an unwatched scene release themselves on removal, without double-decrementing watched-parent children', () => {
  const cityRoot = new THREE.Group(),
    scene = new THREE.Scene();
  scene.add(cityRoot);
  const cutaway = new TravelOcclusion([cityRoot]);
  const train = new THREE.Group(),
    car = new THREE.Group(),
    door = mesh();
  train.add(car);
  car.add(door);
  scene.add(train);
  cutaway.refresh([train]);
  assert.equal(cutaway.snapshot().watchedObjects, 4);
  train.removeFromParent();
  assert.equal(cutaway.snapshot().watchedObjects, 1);
  assert.equal(cutaway.snapshot().meshCount, 0);
  for (const object of [train, car, door])
    for (const event of ['childadded', 'childremoved', 'removed'])
      assert.equal(object._listeners?.[event]?.length ?? 0, 0);
  dispose(train);
  assert.equal(cutaway.snapshot().materialCount, 0);
  const watchedChild = new THREE.Group(),
    wall = mesh();
  watchedChild.add(wall);
  cityRoot.add(watchedChild);
  assert.equal(cutaway.snapshot().watchedObjects, 3);
  watchedChild.removeFromParent();
  assert.equal(cutaway.snapshot().watchedObjects, 1);
  assert.equal(
    cutaway.snapshot().meshCount,
    0,
    'self removed and parent childremoved are idempotent',
  );
  cityRoot.add(watchedChild);
  assert.equal(cutaway.snapshot().meshCount, 1);
  cutaway.dispose();
  dispose(scene);
});

test('production landmark preparation releases staged roots on successful, rejected, synchronous and unavailable warmups before commit', async () => {
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
  let assignment;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === 'this.prepareLandmark'
    )
      assignment = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert(assignment);
  const code = ts.transpileModule(
    `export class LandmarkPreparation { install() { ${assignment.getText(ast)}; } }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const { LandmarkPreparation } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  for (const outcome of ['success', 'rejected', 'synchronous', 'unavailable']) {
    const holder = new THREE.Group(),
      staged = new THREE.Group(),
      wall = mesh();
    staged.add(wall);
    const cutaway = new TravelOcclusion([holder]);
    let finish;
    const result = new Promise((resolve, reject) => {
      finish = () =>
        outcome === 'rejected' ? reject(Error('cancelled')) : resolve();
    });
    const engine = Object.assign(Object.create(LandmarkPreparation.prototype), {
      travelOcclusion: cutaway,
      prepareTravelOccluders(group) {
        cutaway.refresh([group]);
      },
      landmarkWarmup:
        outcome === 'unavailable'
          ? null
          : {
              prepare() {
                if (outcome === 'synchronous')
                  throw Error('synchronous preparation failure');
                return result;
              },
            },
    });
    engine.install();
    const prepared = engine.prepareLandmark(
      staged,
      new AbortController().signal,
      holder,
    );
    if (outcome === 'success' || outcome === 'rejected') {
      assert.equal(cutaway.snapshot().watchedObjects, 3);
      finish();
    }
    if (outcome === 'success') await prepared;
    else await assert.rejects(prepared);
    assert.equal(
      cutaway.snapshot().watchedObjects,
      1,
      `${outcome} releases staged nodes`,
    );
    assert.equal(cutaway.snapshot().meshCount, 0);
    if (outcome === 'success') {
      holder.add(staged);
      assert.equal(
        cutaway.snapshot().watchedObjects,
        3,
        'actual commit re-enrolls after prepare finally',
      );
      staged.removeFromParent();
    }
    cutaway.dispose();
    dispose(staged);
  }
});

test('SSAO override uses identical full-piece removal and explicit zero defaults protect unregistered avatar geometry', () => {
  const normal = new THREE.MeshNormalMaterial(),
    wall = mesh(),
    avatar = mesh(),
    originalCompile = normal.onBeforeCompile,
    originalKey = normal.customProgramCacheKey;
  normal.defaultAttributeValues = { existing: [1] };
  const originalDefaults = normal.defaultAttributeValues;
  const restorePedestrian = installPedestrianOverrideMaterial(normal),
    pedestrianCompile = normal.onBeforeCompile,
    pedestrianKey = normal.customProgramCacheKey,
    pedestrianDefaults = normal.defaultAttributeValues,
    cutaway = new TravelOcclusion([wall]),
    release = cutaway.prepareMaterial(normal, { normalPass: true }),
    shader = compile(normal, THREE.ShaderLib.normal);
  assert.match(shader.vertexShader, /pedestrianRigidLimb/);
  assert.match(
    shader.vertexShader,
    /instanceMatrix \* travelOccluderTransform/,
  );
  assert.match(
    shader.vertexShader,
    /dot\(travelOccluderSize, travelOccluderSize\) > 0\.00000001/,
  );
  assert.match(shader.fragmentShader, /vTravelOccluderSelected > 0\.5/);
  assert.equal(shader.fragmentShader.includes('gl_FragCoord'), false);
  assert.deepEqual(normal.defaultAttributeValues.aTravelOccluderMin, [0, 0, 0]);
  assert.deepEqual(normal.defaultAttributeValues.aTravelOccluderMax, [0, 0, 0]);
  assert.match(
    normal.customProgramCacheKey(),
    /travel-full-occluder-v2-normal$/,
  );
  for (const floor of [0, 4.2, -7.5]) {
    wall.position.set(0, floor + 1.5, -4);
    cutaway.update(v(0, floor + 2.8, -8), v(0, floor, 0));
    for (const y of [0.2, 0.5, 0.9, 1.3, 1.8])
      assert.equal(
        cutaway.coverageAt(v(0.15, floor + y, -0.2), {
          object: avatar,
          normalPass: true,
        }),
        0,
      );
    assert.equal(
      cutaway.coverageAt(v(0.9, floor + 1.95, -4), {
        object: wall,
        normalPass: true,
      }),
      1,
    );
    assert.equal(
      cutaway.coverageAt(v(0.9, floor, -4), { object: wall, normalPass: true }),
      0,
    );
  }
  release();
  release();
  assert.strictEqual(normal.onBeforeCompile, pedestrianCompile);
  assert.strictEqual(normal.customProgramCacheKey, pedestrianKey);
  assert.strictEqual(normal.defaultAttributeValues, pedestrianDefaults);
  restorePedestrian();
  assert.strictEqual(normal.defaultAttributeValues, originalDefaults);
  assert.strictEqual(normal.onBeforeCompile, originalCompile);
  assert.strictEqual(normal.customProgramCacheKey, originalKey);
  cutaway.dispose();
  normal.dispose();
  dispose(wall);
  dispose(avatar);
});

test('absent occluder metadata protects actual standing/seated male/female walker geometry at any chase yaw', async () => {
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
              cutaway.coverageAt(point, { object, normalPass: true }),
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

test('merged disconnected boxes retain complete components instead of hiding an entire material batch', () => {
  const a = new THREE.BoxGeometry(10, 3, 0.2).translate(0, 1.5, -4),
    b = new THREE.BoxGeometry(10, 3, 0.2).translate(30, 1.5, -4),
    geometry = mergeGeometries([a, b]),
    root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()),
    cutaway = new TravelOcclusion([root]);
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  assert.equal(cutaway.snapshot().pieceCount, 2);
  assert.equal(
    cutaway.coverageAt(v(4.9, 2, -4), { object: root, vertexIndex: 0 }),
    1,
  );
  assert.equal(
    cutaway.coverageAt(v(30, 2, -4), {
      object: root,
      vertexIndex: a.getAttribute('position').count,
    }),
    0,
  );
  cutaway.dispose();
  a.dispose();
  b.dispose();
  dispose(root);
});

test('local OBB selection leaves a rotated thin nonblocking wall opaque, including with nonuniform scale and shear', () => {
  const root = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 3, 12),
    new THREE.MeshStandardMaterial(),
  );
  root.rotation.y = Math.PI / 4;
  root.position.set(0, 1.5, -4);
  root.scale.set(0.8, 1.2, 1.5);
  const cutaway = new TravelOcclusion([root]);
  // A ray along the wall's world AABB corner misses its actual rotated panel.
  cutaway.update(v(5, 3, -8), v(5, 0, 0), { radius: 0.05 });
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: root }), 0);
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: root }), 1);
  root.matrixAutoUpdate = false;
  root.matrix.makeShear(0.15, 0.2, 0, 0, 0, 0).setPosition(0, 1.5, -4);
  root.matrixWorldNeedsUpdate = true;
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: root }), 1);
  root.scale.set(0, 0, 0);
  root.matrix.makeScale(0, 0, 0);
  root.matrixWorldNeedsUpdate = true;
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: root }), 0);
  cutaway.dispose();
  dispose(root);
});

test('explicit walk surfaces never become whole-city terrain occluders, and their physical children still enroll', () => {
  const terrain = new THREE.Mesh(
    new THREE.BoxGeometry(10000, 200, 10000),
    new THREE.MeshStandardMaterial(),
  );
  terrain.userData.walkSurface = true;
  const wall = mesh();
  wall.position.set(0, 1.5, -4);
  terrain.add(wall);
  const original = terrain.material.onBeforeCompile,
    cutaway = new TravelOcclusion([terrain]);
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  assert.strictEqual(terrain.material.onBeforeCompile, original);
  assert.equal(terrain.geometry.hasAttribute('aTravelOccluderMin'), false);
  assert.equal(cutaway.coverageAt(v(0, 100, -4), { object: terrain }), 0);
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: wall }), 1);
  cutaway.dispose();
  dispose(terrain);
});

test('late explicit source spans replace generic metadata and owner disposal restores exact original attribute identity', async () => {
  const root = mesh(),
    geometry = root.geometry,
    originalMin = new THREE.Float32BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count * 3).fill(-2),
      3,
    ),
    originalMax = new THREE.Float32BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count * 3).fill(2),
      3,
    );
  geometry.setAttribute('aTravelOccluderMin', originalMin);
  geometry.setAttribute('aTravelOccluderMax', originalMax);
  const cutaway = new TravelOcclusion([root]);
  cutaway.registerParts(root, [
    {
      start: 0,
      count: geometry.getAttribute('position').count,
      bounds: { minX: -1, maxX: 1, minZ: -0.1, maxZ: 0.1 },
      minY: -1.5,
      maxY: 1.5,
    },
  ]);
  assert.equal(cutaway.snapshot().pieceCount, 1);
  cutaway.dispose();
  geometry.dispose();
  await Promise.resolve();
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), originalMin);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), originalMax);
  dispose(root);
});

test('geometry metadata survives renderer disposal enumeration, releases controller tracking immediately, and restores afterward', async () => {
  for (const controllerFirst of [false, true]) {
    const root = mesh(),
      geometry = root.geometry,
      cutaway = new TravelOcclusion([root]),
      min = geometry.getAttribute('aTravelOccluderMin'),
      max = geometry.getAttribute('aTravelOccluderMax');
    let rendererDisposals = 0;
    geometry.addEventListener('dispose', () => {
      if (rendererDisposals++) return;
      assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
      assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
      assert(Object.values(geometry.attributes).includes(min));
      assert(Object.values(geometry.attributes).includes(max));
    });
    if (controllerFirst) {
      cutaway.dispose();
      assert.equal(
        rendererDisposals,
        0,
        'the camera never disposes borrowed source geometry',
      );
      assert.equal(cutaway.snapshot().geometryCount, 0);
      assert.strictEqual(
        geometry.getAttribute('aTravelOccluderMin'),
        min,
        'retain uploaded buffer metadata until source owner disposal',
      );
    }
    geometry.dispose();
    assert.equal(rendererDisposals, 1);
    assert.equal(cutaway.snapshot().geometryCount, 0);
    assert.strictEqual(
      geometry.getAttribute('aTravelOccluderMin'),
      min,
      'all synchronous disposal listeners see the GPU-owned attributes',
    );
    await Promise.resolve();
    assert.equal(geometry.hasAttribute('aTravelOccluderMin'), false);
    assert.equal(geometry.hasAttribute('aTravelOccluderMax'), false);
    cutaway.dispose();
    dispose(root);
  }
});

test('late source-span refinement reuses uploaded attributes instead of orphaning their GPU buffers', () => {
  const root = mesh(),
    geometry = root.geometry,
    cutaway = new TravelOcclusion([root]),
    min = geometry.getAttribute('aTravelOccluderMin'),
    max = geometry.getAttribute('aTravelOccluderMax');
  cutaway.registerParts(root, [
    {
      start: 0,
      count: geometry.getAttribute('position').count,
      bounds: { minX: -1, maxX: 1, minZ: -0.1, maxZ: 0.1 },
      minY: -1.5,
      maxY: 1.5,
    },
  ]);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
  assert.equal(min.version, 1);
  assert.equal(max.version, 1);
  assert(
    cutaway.geometryPatches instanceof WeakMap,
    'detached source geometry is not retained by the controller registry',
  );
  cutaway.releaseSubtree(root);
  assert.equal(cutaway.snapshot().meshCount, 0);
  cutaway.dispose();
  dispose(root);
});

test('ground obstacles and authored road paint are excluded while other elevated road structures stay eligible', () => {
  for (const kind of [
    'groundObstruction',
    'Road paint 0',
    'South motor ramp white edges 0',
    'Northbound exit white edges 0',
  ]) {
    const root = mesh();
    if (kind === 'groundObstruction') root.userData.groundObstruction = true;
    else root.name = kind;
    const original = root.material.onBeforeCompile,
      cutaway = new TravelOcclusion([root]);
    cutaway.update(v(0, 3, -8), v(0, 0, 0));
    assert.strictEqual(root.material.onBeforeCompile, original);
    assert.equal(root.geometry.hasAttribute('aTravelOccluderMin'), false);
    cutaway.dispose();
    dispose(root);
  }
  const roof = mesh();
  roof.position.set(0, 1.5, -4);
  roof.name = 'elevated-road-beam';
  const cutaway = new TravelOcclusion([roof]);
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  assert.equal(cutaway.coverageAt(v(0, 2, -4), { object: roof }), 1);
  cutaway.dispose();
  dispose(roof);
});

test('actual garbage collection releases detached geometry and disposed controllers even when the other side remains alive', () => {
  const script = `
    import * as THREE from 'three';
    import assert from 'node:assert/strict';
    import {setImmediate} from 'node:timers/promises';
    const {TravelOcclusion}=await import(${JSON.stringify(cityModule('travel-occlusion'))});
    let root=new THREE.Mesh(new THREE.BoxGeometry(2,3,.2),new THREE.MeshStandardMaterial());
    const retainedGeometry=root.geometry;
    let controller=new TravelOcclusion([root]);
    const weakController=new WeakRef(controller);
    controller.dispose(); controller=null; root=null;
    for(let i=0;i<8;i++){await setImmediate();global.gc();await setImmediate();}
    assert.equal(weakController.deref(),undefined,'retained geometry must not retain disposed controller/city');
    assert(retainedGeometry.hasAttribute('aTravelOccluderMin'));
    retainedGeometry.dispose();await Promise.resolve();
    assert.equal(retainedGeometry.hasAttribute('aTravelOccluderMin'),false);
    let city=new THREE.Group();controller=new TravelOcclusion([city]);
    let detached=new THREE.Mesh(new THREE.BoxGeometry(2,3,.2),new THREE.MeshStandardMaterial());
    city.add(detached);
    const weakGeometry=new WeakRef(detached.geometry);
    detached.removeFromParent();detached=null;
    for(let i=0;i<8;i++){await setImmediate();global.gc();await setImmediate();}
    assert.equal(weakGeometry.deref(),undefined,'live controller must not retain detached undisposed geometry');
    controller.dispose();
  `;
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', '--input-type=module'],
    {
      input: script,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  assert.equal(child.status, 0, child.stderr || String(child.error));
});

test('successive camera controllers reuse uploaded module-owned geometry attributes until source disposal', async () => {
  const root = mesh(),
    geometry = root.geometry,
    first = new TravelOcclusion([root]),
    min = geometry.getAttribute('aTravelOccluderMin'),
    max = geometry.getAttribute('aTravelOccluderMax'),
    uploaded = new Set([min, max]);
  first.dispose();
  const second = new TravelOcclusion([root]);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
  second.registerParts(root, [
    {
      start: 0,
      count: geometry.getAttribute('position').count,
      bounds: { minX: -1, maxX: 1, minZ: -0.1, maxZ: 0.1 },
      minY: -1.5,
      maxY: 1.5,
    },
  ]);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
  geometry.addEventListener('dispose', () => {
    for (const attribute of Object.values(geometry.attributes))
      uploaded.delete(attribute);
  });
  second.dispose();
  geometry.dispose();
  assert.equal(
    uploaded.size,
    0,
    'source renderer can delete every previously uploaded metadata buffer',
  );
  await Promise.resolve();
  assert.equal(geometry.hasAttribute('aTravelOccluderMin'), false);
  assert.equal(geometry.hasAttribute('aTravelOccluderMax'), false);
  root.material.dispose();
});

test('a new controller taking ownership during deferred source cleanup cancels stale restoration and rearms final cleanup', async () => {
  const root = mesh(),
    geometry = root.geometry,
    first = new TravelOcclusion([root]),
    min = geometry.getAttribute('aTravelOccluderMin'),
    max = geometry.getAttribute('aTravelOccluderMax');
  let enumerations = 0;
  geometry.addEventListener('dispose', () => {
    enumerations++;
    assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
    assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
  });
  geometry.dispose();
  const second = new TravelOcclusion([root]);
  await Promise.resolve();
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMin'), min);
  assert.strictEqual(geometry.getAttribute('aTravelOccluderMax'), max);
  assert.equal(second.snapshot().geometryCount, 1);
  first.dispose();
  second.dispose();
  geometry.dispose();
  assert.equal(enumerations, 2);
  await Promise.resolve();
  assert.equal(geometry.hasAttribute('aTravelOccluderMin'), false);
  assert.equal(geometry.hasAttribute('aTravelOccluderMax'), false);
  root.material.dispose();
});
