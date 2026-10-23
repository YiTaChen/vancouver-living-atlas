/* oxlint-disable typescript/unbound-method -- Check restoration of borrowed shader hooks by identity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { addStreetMeshes } = await import(cityModule('street-meshes'));
const v = (x, y, z) => new THREE.Vector3(x, y, z);
function ground(height = 0) {
  const geometry = new THREE.PlaneGeometry(100, 100, 10, 10).rotateX(
      -Math.PI / 2,
    ),
    p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++)
    p.setY(
      i,
      typeof height === 'function' ? height(p.getX(i), p.getZ(i)) : height,
    );
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
  );
  mesh.userData.walkSurface = true;
  return mesh;
}
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
  root.traverse((o) => {
    o.geometry?.dispose();
    for (const m of o.material ? [].concat(o.material) : []) m.dispose();
  });
}

test('actual terrain roots receive a bounded full-body sight corridor while ordinary walking floors remain excluded', () => {
  const terrain = new THREE.Group(),
    surface = ground(0),
    ordinaryFloor = ground(1),
    wall = new THREE.Mesh(
      new THREE.BoxGeometry(12, 4, 0.2),
      new THREE.MeshStandardMaterial(),
    );
  terrain.add(surface);
  wall.position.set(0, 1, -3);
  ordinaryFloor.position.x = 30;
  const scene = new THREE.Group();
  scene.add(terrain, ordinaryFloor, wall);
  const positions = surface.geometry.attributes.position,
    sourcePositions = Array.from(positions.array),
    index = new GroundSurfaceIndex([surface]),
    before = index.sample(0, -3, 0),
    cutaway = new TravelOcclusion([scene], [], [terrain]);
  cutaway.update(v(0, 5, -8), v(0, -3, 0));
  assert.equal(
    cutaway.coverageAt(v(0, 0, -2.2), { object: surface }),
    1,
    'opaque ground between lens and body is removed',
  );
  assert.equal(
    cutaway.coverageAt(v(0.35, 0, -2.2), { object: surface }),
    1,
    'shoulder pixels have clearance, not just the torso centre ray',
  );
  for (const point of [
    v(4, 0, -2.2),
    v(-4, 0, -2.2),
    v(0, 0, -30),
    v(30, 0, 30),
  ])
    assert.equal(
      cutaway.coverageAt(point, { object: surface }),
      0,
      'ground outside the real chase corridor remains opaque',
    );
  assert.equal(
    ordinaryFloor.geometry.hasAttribute('aTravelOccluderMin'),
    false,
  );
  for (const x of [-5.8, 0, 5.8])
    assert.equal(
      cutaway.coverageAt(v(x, 1, -3), { object: wall }),
      1,
      'PR37/38 entire-wall removal remains unchanged',
    );
  assert.strictEqual(surface.geometry.attributes.position, positions);
  assert.deepEqual(Array.from(positions.array), sourcePositions);
  assert.equal(
    index.sample(0, -3, 0),
    before,
    'render cutaway does not alter collision/walking support',
  );
  cutaway.dispose();
  dispose(scene);
});

test('ascending and descending underground chase rays remove intervening terrain without changing the requested camera', () => {
  for (const slope of [-0.18, 0.18]) {
    const terrain = new THREE.Group(),
      surface = ground((_x, z) => slope * z);
    terrain.add(surface);
    const cutaway = new TravelOcclusion([terrain], [], [terrain]),
      camera = v(0, 5, -8),
      feet = v(0, -4, 0),
      originalCamera = camera.clone(),
      originalFeet = feet.clone();
    cutaway.update(camera, feet);
    const target = feet.clone().add(v(0, 1.1, 0)),
      direction = target.clone().sub(camera),
      hits = new THREE.Raycaster(
        camera,
        direction.clone().normalize(),
        0,
        direction.length(),
      ).intersectObject(surface);
    assert(hits.length, 'the actual sloped triangles initially hide the body');
    for (const hit of hits)
      assert.equal(cutaway.coverageAt(hit.point, { object: surface }), 1);
    assert.deepEqual(camera, originalCamera);
    assert.deepEqual(feet, originalFeet);
    assert.equal(
      cutaway.coverageAt(v(10, slope * -4, -4), { object: surface }),
      0,
    );
    cutaway.dispose();
    dispose(terrain);
  }
});

test('flat outdoor ground and every floor below the occupied foot remain physically and visually intact', () => {
  const terrain = new THREE.Group(),
    surface = ground(0);
  terrain.add(surface);
  const cutaway = new TravelOcclusion([terrain], [], [terrain]);
  cutaway.update(v(0, 3, -8), v(0, 0, 0));
  for (let x = -2; x <= 2; x += 0.5)
    for (let z = -10; z <= 2; z += 0.5)
      assert.equal(cutaway.coverageAt(v(x, 0, z), { object: surface }), 0);
  cutaway.update(v(0, 3, -8), v(0, -2, 0), { enabled: false });
  assert.equal(cutaway.coverageAt(v(0, 0, -3), { object: surface }), 0);
  cutaway.clear();
  assert.equal(cutaway.coverageAt(v(0, 0, -3), { object: surface }), 0);
  cutaway.dispose();
  dispose(terrain);
});

test('terrain visibility composes identically with normal pass shaders and never enrolls the avatar', () => {
  const terrain = new THREE.Group(),
    surface = ground(0);
  terrain.add(surface);
  const cutaway = new TravelOcclusion([terrain], [], [terrain]),
    normal = new THREE.MeshNormalMaterial(),
    restore = cutaway.prepareMaterial(normal, { normalPass: true }),
    colorShader = compile(surface.material),
    normalShader = compile(normal, THREE.ShaderLib.normal),
    avatar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.4), normal);
  cutaway.update(v(0, 5, -8), v(0, -3, 0));
  for (const shader of [colorShader, normalShader]) {
    assert.match(shader.vertexShader, /vTravelTerrainSurface = float/);
    assert.match(shader.fragmentShader, /travelTerrainSelected = step/);
    assert.match(
      shader.fragmentShader,
      /vTravelCutawayWorld.y > uTravelOccluderShape.y/,
    );
    assert.strictEqual(
      shader.uniforms.uTravelCutawayStart,
      colorShader.uniforms.uTravelCutawayStart,
    );
    assert.strictEqual(
      shader.uniforms.uTravelCutawayEnd,
      colorShader.uniforms.uTravelCutawayEnd,
    );
  }
  assert.deepEqual(normal.defaultAttributeValues.aTravelOccluderMin, [0, 0, 0]);
  assert.deepEqual(normal.defaultAttributeValues.aTravelOccluderMax, [0, 0, 0]);
  assert.equal(
    cutaway.coverageAt(v(0, -1, 0), { object: avatar, normalPass: true }),
    0,
  );
  assert.equal(
    cutaway.coverageAt(v(0, 0, -2.2), { object: surface, normalPass: true }),
    1,
  );
  restore();
  cutaway.dispose();
  dispose(terrain);
  dispose(avatar);
});

test('late terrain additions enroll on the actual declared root, with the original material restored on dispose', () => {
  const root = new THREE.Group(),
    cutaway = new TravelOcclusion([root], [], [root]),
    surface = ground(),
    before = surface.material.onBeforeCompile;
  root.add(surface);
  cutaway.update(v(0, 5, -8), v(0, -3, 0));
  assert.notStrictEqual(surface.material.onBeforeCompile, before);
  assert.equal(cutaway.coverageAt(v(0, 0, -2.2), { object: surface }), 1);
  cutaway.dispose();
  assert.strictEqual(surface.material.onBeforeCompile, before);
  dispose(root);
});

test('actual road and sidewalk walking batches clear the same corridor while keeping collision triangles and whole elevated objects', () => {
  const e = {
      roads: new THREE.Group(),
      geometry(positions) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.computeVertexNormals();
        return geometry;
      },
    },
    positions = [
      -10, 0, -10, 10, 0, 10, 10, 0, -10, -10, 0, -10, -10, 0, 10, 10, 0, 10,
    ],
    pavement = addStreetMeshes(
      e,
      positions,
      new THREE.MeshStandardMaterial(),
      'Connected road pavement',
      undefined,
      true,
      true,
    ),
    sidewalks = addStreetMeshes(
      e,
      positions,
      new THREE.MeshStandardMaterial(),
      'Clipped sidewalks',
      undefined,
      true,
    ),
    meshes = [...pavement, ...sidewalks],
    before = meshes.map((mesh) =>
      Array.from(mesh.geometry.attributes.position.array),
    ),
    index = new GroundSurfaceIndex(meshes),
    raisedWall = new THREE.Mesh(
      new THREE.BoxGeometry(12, 4, 0.2),
      new THREE.MeshStandardMaterial(),
    );
  raisedWall.position.set(0, 1, -3);
  e.roads.add(raisedWall);
  const cutaway = new TravelOcclusion([e.roads], [], [e.roads]);
  cutaway.update(v(0, 5, -8), v(0, -3, 0));
  for (const [i, mesh] of meshes.entries()) {
    assert.equal(mesh.userData.walkSurface, true);
    assert.equal(cutaway.coverageAt(v(0, 0, -2.2), { object: mesh }), 1);
    assert.equal(cutaway.coverageAt(v(8, 0, -2.2), { object: mesh }), 0);
    assert.deepEqual(
      Array.from(mesh.geometry.attributes.position.array),
      before[i],
    );
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.depthWrite, true);
  }
  assert.equal(
    index.sample(0, -2.2, 0),
    0,
    'original native walking support is unchanged',
  );
  for (const x of [-5.8, 5.8])
    assert.equal(
      cutaway.coverageAt(v(x, 1, -3), { object: raisedWall }),
      1,
      'non-ground road structures retain complete-object removal',
    );
  cutaway.dispose();
  dispose(e.roads);
});

test('the real engine opts in terrain and roads, and archived opaque chase poses clear actual DEM intersections', () => {
  const source = readFileSync('lib/city/engine.ts', 'utf8'),
    ast = ts.createSourceFile(
      'engine.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
    ),
    constructors = [];
  function visit(node) {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(ast) === 'TravelOcclusion'
    )
      constructors.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(constructors.length, 1);
  const roots = constructors[0].arguments[2];
  assert(ts.isArrayLiteralExpression(roots));
  assert.deepEqual(
    roots.elements.map((root) => root.getText(ast)),
    ['this.terrain', 'this.roads'],
  );
  // Actual failed606 poses, retained here as a deterministic regression. Sample
  // the real city DEM around the lens/body; no invented station volume is used.
  for (const { camera, feet } of [
    {
      camera: [1050.2283137702511, 16.66711428729549, -77.50151772400436],
      feet: [1046.0297692246575, 10.905608777147176, -80.65134000599619],
    },
    {
      camera: [1055.0025858894865, 19.515737441223948, 48.409235109226536],
      feet: [1052.305539830536, 11.356608777147175, 51.11428460595559],
    },
  ]) {
    const surface = ground((x, z) => cityElevation(x + feet[0], z + feet[2]));
    surface.position.set(feet[0], 0, feet[2]);
    const terrain = new THREE.Group();
    terrain.add(surface);
    terrain.updateMatrixWorld(true);
    const cutaway = new TravelOcclusion([terrain], [], [terrain]),
      start = new THREE.Vector3(...camera),
      foot = new THREE.Vector3(...feet),
      end = foot.clone().add(v(0, 1.1, 0)),
      ray = end.clone().sub(start),
      hits = new THREE.Raycaster(
        start,
        ray.clone().normalize(),
        0,
        ray.length(),
      ).intersectObject(surface);
    assert(
      hits.length,
      'recorded chase ray intersects the actual city terrain',
    );
    cutaway.update(start, foot);
    assert(
      hits.every(
        (hit) => cutaway.coverageAt(hit.point, { object: surface }) === 1,
      ),
    );
    cutaway.dispose();
    dispose(terrain);
  }
});
