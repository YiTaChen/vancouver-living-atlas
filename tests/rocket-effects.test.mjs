import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { RocketEffects } = await import(cityModule('rocket-effects'));
const { createRocket, stepRocket, launchRocket, sampleRocketContact } =
  await import(cityModule('rocket-state'));
const { collisionTriangles, hitTriangles } = await import(
  cityModule('flight-collision')
);
function fixture(count = 2, kind = 'large', distances = null) {
  const vertices = [],
    colors = [],
    parts = [];
  for (let i = 0; i < count; i++) {
    const x =
      distances?.[i] ?? (i === count - 1 && count === 2 ? 300 : 5 + i * 2);
    parts.push({
      key: String(i),
      polygon: [
        [
          [x - 2, 0],
          [x + 2, 0],
          [x + 2, 2],
          [x - 2, 2],
        ],
      ],
      bounds: { minX: x - 2, maxX: x + 2, minZ: 0, maxZ: 2 },
      center: [x, 0],
      minY: 0,
      maxY: 10,
      start: i * 6,
      count: 6,
    });
    vertices.push(
      x - 2,
      0,
      0,
      x + 2,
      0,
      0,
      x,
      10,
      0,
      x - 2,
      0,
      2,
      x + 2,
      0,
      2,
      x,
      10,
      2,
    );
    colors.push(...Array(18).fill(0.8));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  const scene = new THREE.Scene();
  scene.add(mesh);
  const trafficGroup = new THREE.Group();
  scene.add(trafficGroup);
  const treeGroup = new THREE.Group();
  scene.add(treeGroup);
  const engine = {
    scene,
    data: { rocketBuildingMesh: mesh, rocketBuildingParts: parts },
    compatibleGraphics: false,
    settings: { quality: 'balanced' },
    container: { clientHeight: 800 },
    renderer: { shadowMap: { needsUpdate: false } },
    traffic: { vehicleAssets: { group: trafficGroup } },
    detailedTrees: { group: treeGroup, trees: [] },
  };
  const state = createRocket(kind, 0, 0, 0);
  state.phase = 'ignition';
  state.throttle = 1;
  return { engine, state, mesh, trafficGroup, treeGroup };
}
function districtFixture(kind, buildings, trees, actors) {
  const result = fixture(buildings.length, kind, buildings),
    { engine, treeGroup, trafficGroup } = result;
  const treeMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 12, 6),
    new THREE.MeshBasicMaterial({ color: 0x367243 }),
    trees.length,
  );
  const actorMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 2, 4),
    new THREE.MeshBasicMaterial(),
    actors.length,
  );
  treeGroup.add(treeMesh);
  trafficGroup.add(actorMesh);
  trees.forEach((x, i) => {
    const matrix = new THREE.Matrix4().makeTranslation(x, 6, 0);
    treeMesh.setMatrixAt(i, matrix);
    engine.detailedTrees.trees.push({
      x,
      y: 0,
      z: 0,
      h: 12,
      conifer: true,
      seed: i,
      slots: [{ mesh: treeMesh, index: i, matrix }],
    });
  });
  actors.forEach((x, i) =>
    actorMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 1, 0)),
  );
  return { ...result, treeMesh, actorMesh };
}
function heat(effects, state, seconds = 3) {
  for (let i = 0; i < seconds * 10; i++) effects.update(0.1, state);
}
function visibleParticles(effects) {
  const points = effects.group.children.find(
      (object) => object instanceof THREE.Points,
    ),
    position = points.geometry.getAttribute('position'),
    life = points.geometry.getAttribute('aLife'),
    active = [];
  for (let i = 0; i < life.count; i++)
    if (life.getX(i) !== 0)
      active.push({
        x: position.getX(i),
        y: position.getY(i),
        z: position.getZ(i),
        hot: life.getX(i) > 1,
      });
  return active;
}
test('local building damage uploads only changed vertex ranges, preserves distant buildings and resets exactly', () => {
  const { engine, state, mesh } = fixture();
  const pos = mesh.geometry.getAttribute('position'),
    color = mesh.geometry.getAttribute('color');
  const originalPosition = Array.from(pos.array),
    originalColor = Array.from(color.array);
  const effects = new RocketEffects(engine, state);
  heat(effects, state);
  effects.beforeRender();
  effects.afterRender();
  assert.notDeepEqual(
    Array.from(pos.array).slice(0, 18),
    originalPosition.slice(0, 18),
  );
  assert.deepEqual(Array.from(pos.array).slice(18), originalPosition.slice(18));
  assert.deepEqual(Array.from(color.array).slice(18), originalColor.slice(18));
  assert(
    pos.updateRanges.every((range) => range.start === 0 && range.count === 18),
  );
  assert(
    color.updateRanges.every(
      (range) => range.start === 0 && range.count === 18,
    ),
  );
  const version = pos.version,
    colorVersion = color.version;
  effects.beforeRender();
  effects.afterRender();
  assert.equal(
    pos.version,
    version,
    'an unchanged draw does not upload the city position buffer',
  );
  assert.equal(
    color.version,
    colorVersion,
    'an unchanged draw does not upload the city color buffer',
  );
  effects.reset();
  assert.deepEqual(Array.from(pos.array), originalPosition);
  assert.deepEqual(Array.from(color.array), originalColor);
  assert.equal(effects.damaged, 0);
  effects.dispose();
  assert(!engine.scene.children.includes(effects.group));
});
test('flying object matrices and culling restore the newest upstream owner state after each draw', () => {
  const { engine, state, trafficGroup } = fixture();
  trafficGroup.position.set(3, 0, 2);
  trafficGroup.rotation.y = Math.PI / 3;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2, 2, 4),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const matrix = new THREE.Matrix4().makeTranslation(5, 1, 0);
  mesh.setMatrixAt(0, matrix);
  trafficGroup.add(mesh);
  const effects = new RocketEffects(engine, state);
  effects.update(0.5, state);
  effects.beforeRender();
  effects.afterRender();
  const currentOwner = new THREE.Matrix4().makeTranslation(7, 1, 0);
  mesh.setMatrixAt(0, currentOwner);
  effects.update(0.5, state);
  effects.beforeRender();
  const during = new THREE.Matrix4();
  mesh.getMatrixAt(0, during);
  assert.notDeepEqual(during.elements, currentOwner.elements);
  assert.equal(mesh.frustumCulled, false);
  assert(mesh.instanceMatrix.updateRanges.every((range) => range.count === 16));
  effects.afterRender();
  const after = new THREE.Matrix4();
  mesh.getMatrixAt(0, after);
  assert.deepEqual(after.elements, currentOwner.elements);
  assert.equal(mesh.frustumCulled, true);
  effects.dispose();
});
test('scorched tree proxies fall while source and recycled detailed tree slots are restored', () => {
  const { engine, state, treeGroup } = fixture();
  const source = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 12, 6),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const detailed = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2, 12, 6),
    new THREE.MeshBasicMaterial(),
    1,
  );
  const matrix = new THREE.Matrix4().makeTranslation(12, 0, 0),
    detailedMatrix = new THREE.Matrix4().makeTranslation(12, 5, 0);
  source.setMatrixAt(0, matrix);
  detailed.setMatrixAt(0, detailedMatrix);
  engine.scene.add(source);
  treeGroup.add(detailed);
  engine.detailedTrees.trees.push({
    x: 12,
    y: 0,
    z: 0,
    h: 12,
    conifer: true,
    seed: 1,
    variant: 0,
    slots: [{ mesh: source, index: 0, matrix }],
  });
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 3);
  effects.beforeRender();
  const hidden = new THREE.Matrix4();
  source.getMatrixAt(0, hidden);
  assert.equal(hidden.determinant(), 0);
  detailed.getMatrixAt(0, hidden);
  assert.equal(hidden.determinant(), 0);
  assert.equal(effects.burning, 1);
  assert(
    effects.group.children.some(
      (object) =>
        object instanceof THREE.Group &&
        object.visible &&
        Math.hypot(object.rotation.x, object.rotation.z) > 0.1,
    ),
  );
  effects.afterRender();
  const restored = new THREE.Matrix4();
  source.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, matrix.elements);
  detailed.getMatrixAt(0, restored);
  assert.deepEqual(restored.elements, detailedMatrix.elements);
  assert.equal(source.frustumCulled, true);
  effects.dispose();
});
test('building fragments use a fixed 64-slot pool and settle without unbounded allocation', () => {
  const { engine, state } = fixture(24);
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 8);
  const rubble = effects.group.getObjectByName(
    'Rocket building debris (64 slot limit)',
  );
  assert(rubble instanceof THREE.InstancedMesh);
  assert.equal(rubble.count, 64);
  assert.equal(rubble.instanceMatrix.count, 64);
  heat(effects, state, 15);
  assert.equal(rubble.count, 64);
  assert.equal(effects.debris, 64);
  effects.reset();
  assert.equal(rubble.count, 0);
  effects.dispose();
});

test('a dense forest prioritizes nearby hot trees before applying the visual budget', () => {
  const { engine, state } = fixture();
  const trees = Array.from({ length: 40 }, (_, i) => ({
    x: 90,
    y: 0,
    z: i * 0.01,
    h: 10,
    conifer: true,
    seed: i,
    slots: [],
  }));
  trees.push({ x: 2, y: 0, z: 0, h: 10, conifer: true, seed: 99, slots: [] });
  engine.detailedTrees.trees = trees;
  const effects = new RocketEffects(engine, state);
  heat(effects, state, 3);
  assert(
    effects.burning >= 1,
    'the tree next to the nozzle burns even if distant source records occur first',
  );
  effects.dispose();
});

test('a failed roof visibly sags before a 2.6-second floor collapse and its collider follows the rendered roof', () => {
  const { engine, mesh } = fixture();
  const state = createRocket('large', 5, 10, 0, {
    kind: 'roof-small',
    groundY: 0,
  });
  state.phase = 'falling';
  state.supportCollapsed = true;
  const effects = new RocketEffects(engine, state),
    position = mesh.geometry.getAttribute('position'),
    original = Array.from(position.array),
    rubble = effects.group.getObjectByName(
      'Rocket building debris (64 slot limit)',
    ),
    heights = [],
    counts = [];
  for (const elapsed of [0, 1.3, 2.6]) {
    state.supportCollapseElapsed = elapsed;
    // Physics may ask before the next visual tick and must get this frame's top.
    const collision = effects.supportCollisionHeight(5, 0, state);
    effects.update(1 / 60, state);
    effects.beforeRender();
    effects.afterRender();
    heights.push(position.getY(2));
    counts.push(rubble.count);
    assert(Math.abs(position.getY(2) - collision) < 1e-6);
  }
  assert(
    heights[0] > 9 && heights[0] < 10,
    'first failure frame sags without flattening the house',
  );
  assert(
    heights[1] > 4 && heights[1] < 6,
    'floors are visibly settling midway through the collapse',
  );
  assert(Math.abs(heights[2] - 0.75) < 1e-6);
  assert.deepEqual(
    counts,
    [2, 4, 7],
    'rubble falls in a chain instead of appearing all at once',
  );
  assert.equal(effects.supportCollisionHeight(200, 0, state), null);
  assert.deepEqual(Array.from(position.array).slice(18), original.slice(18));
  effects.reset();
  assert.deepEqual(Array.from(position.array), original);
  effects.dispose();
});

test('a low house finishes its real state-driven collapse after the falling rocket has already impacted', () => {
  const { engine, mesh } = fixture(),
    position = mesh.geometry.getAttribute('position');
  engine.data.rocketBuildingParts[0].maxY = 2;
  position.setY(2, 2);
  position.setY(5, 2);
  const original = Array.from(position.array);
  let state = createRocket('large', 5, 2.45, 0, {
    kind: 'roof-small',
    groundY: 0,
    seed: 13,
  });
  while (state.phase === 'building') state = stepRocket(state, {}, 1 / 60);
  const effects = new RocketEffects(engine, state);
  state = launchRocket(state, 'auto');
  while (state.phase !== 'crashed' && state.elapsed < 60) {
    state = stepRocket(state, {}, 1 / 60);
    effects.update(1 / 60, state);
  }
  assert.equal(state.phase, 'crashed');
  assert(
    state.supportCollapsed && state.supportCollapseElapsed < 2.6,
    'this real low-roof impact must precede completion of the collapse',
  );
  effects.beforeRender();
  effects.afterRender();
  assert(position.getY(2) > 0.15);
  for (let i = 0; i < 300; i++) {
    state = stepRocket(state, {}, 1 / 60);
    effects.update(1 / 60, state);
  }
  effects.beforeRender();
  effects.afterRender();
  assert(state.supportCollapseElapsed >= 2.6);
  assert(
    Math.abs(position.getY(2) - 0.15) < 1e-6,
    'impact must not freeze a partially collapsed house',
  );
  assert(
    Math.abs(effects.supportCollisionHeight(5, 0, state) - position.getY(2)) <
      1e-6,
  );
  effects.reset();
  assert.deepEqual(Array.from(position.array), original);
  effects.dispose();
});

test('forest heat follows the nearby vehicle body in three dimensions and cannot ignite a distant or high vehicle', () => {
  const { engine, state } = fixture();
  engine.detailedTrees.trees.push({
    x: 3,
    y: 0,
    z: 0,
    h: 12,
    conifer: true,
    seed: 1,
    slots: [],
  });
  const effects = new RocketEffects(engine, state);
  assert.equal(effects.sampleVehicleHeat(state), 0);
  heat(effects, state, 3);
  const burning = effects.burning;
  assert(effects.sampleVehicleHeat(state) > 0.8);
  const far = structuredClone(state);
  far.position.x = 200;
  assert.equal(effects.sampleVehicleHeat(far), 0);
  const high = structuredClone(state);
  high.position.y = 200;
  assert.equal(effects.sampleVehicleHeat(high), 0);
  const tilted = structuredClone(state);
  tilted.position = { x: 35, y: 6, z: 0 };
  tilted.attitude.roll = -Math.PI / 2;
  assert(
    effects.sampleVehicleHeat(tilted) > 0.95,
    'a horizontal fuel tank beside the tree is exposed even when its nozzle is far away',
  );
  assert.equal(
    effects.burning,
    burning,
    'sampling does not mutate the fire simulation',
  );
  effects.reset();
  assert.equal(effects.sampleVehicleHeat(state), 0);
  effects.dispose();
});

test('impact effects scale with speed and never substitute a fuel explosion for a crash', () => {
  function sample(speed, withEvent = true) {
    const { engine, state } = fixture();
    state.phase = 'crashed';
    state.throttle = 0;
    const effects = new RocketEffects(engine, state);
    if (withEvent)
      state.events = [
        {
          id: 1,
          type: 'impact',
          time: 0,
          position: { x: 80, y: 120, z: 40 },
          magnitude: speed,
        },
      ];
    effects.update(0, state);
    const particles = visibleParticles(effects);
    effects.dispose();
    return particles;
  }
  assert.equal(
    sample(100, false).length,
    0,
    'a crashed phase alone does not create an explosion',
  );
  const gentle = sample(8),
    hard = sample(90);
  assert(gentle.length < hard.length);
  assert.equal(gentle.filter((p) => p.hot).length, 0);
  assert(
    hard.filter((p) => p.hot).length <= 6,
    'hard impact emits a few sparks, not a fireball',
  );
  assert(hard.every((p) => p.x === 80 && p.y === 120.5 && p.z === 40));
});

test('an explicit delayed explosion uses the moving wreckage anchor once, including an airborne burnup', () => {
  const { engine, state } = fixture();
  state.phase = 'crashed';
  state.throttle = 0;
  state.elapsed = 2;
  state.wreckage = {
    time: 0,
    position: { x: 100, y: 1200, z: 300 },
    velocity: { x: 10, y: 20, z: 0 },
    attitude: { pitch: 0, roll: 0 },
    angularVelocity: { pitch: 0, roll: 0 },
    cause: 'fire',
    exploded: true,
    explosionDelay: 0.8,
    explosionTime: 2,
  };
  const effects = new RocketEffects(engine, state),
    anchor = new THREE.Vector3(140, 1170, 310);
  state.events = [
    {
      id: 1,
      type: 'exploded',
      time: 2,
      position: { x: 100, y: 1200, z: 300 },
      magnitude: 1,
    },
  ];
  effects.update(0, state, anchor);
  const first = visibleParticles(effects);
  assert(first.filter((p) => p.hot).length > 50);
  assert(first.every((p) => p.x === 140 && p.y === 1170 && p.z === 310));
  effects.update(0, state, anchor);
  assert.deepEqual(
    visibleParticles(effects),
    first,
    'a persistent event log must not replay the burst',
  );
  effects.dispose();
  const fallback = new RocketEffects(engine, { ...state, events: [] });
  fallback.update(0, state);
  assert(
    visibleParticles(fallback).every(
      (p) => p.x === 120 && Math.abs(p.y - 1220.38) < 0.001,
    ),
  );
  fallback.dispose();
});

test('a recreated effects consumer skips historical impact and explosion bursts while preserving sustained onboard fire', () => {
  const { engine, state } = fixture();
  state.phase = 'crashed';
  state.throttle = 0;
  state.elapsed = 12;
  state.wreckage = {
    time: 1,
    position: { x: 20, y: 0, z: 30 },
    velocity: { x: 0, y: 0, z: 0 },
    attitude: { pitch: 0, roll: 0 },
    angularVelocity: { pitch: 0, roll: 0 },
    cause: 'impact',
    exploded: true,
    explosionDelay: 0.8,
    explosionTime: 2,
  };
  state.events = [
    {
      id: 1,
      type: 'impact',
      time: 1,
      position: { x: 20, y: 0, z: 30 },
      magnitude: 80,
    },
    {
      id: 2,
      type: 'exploded',
      time: 2,
      position: { x: 20, y: 0, z: 30 },
      magnitude: 1,
    },
  ];
  const effects = new RocketEffects(engine, state);
  effects.update(0, state);
  assert.equal(
    visibleParticles(effects).length,
    0,
    'repair/reload must not replay a ten-second-old fireball or impact smoke',
  );
  state.fireIntensity = 0.6;
  effects.update(0.2, state, new THREE.Vector3(20, 2, 30));
  const fire = visibleParticles(effects);
  assert(
    fire.length >= 8 && fire.length < 20,
    'current onboard fire continues without the historical explosion burst',
  );
  assert(
    fire.some((particle) => particle.hot) &&
      fire.some((particle) => !particle.hot),
  );
  effects.dispose();
});

test('repairing the city after a real roof impact preserves the repaired mesh instead of collapsing it again', () => {
  const { engine, mesh } = fixture(),
    position = mesh.geometry.getAttribute('position'),
    color = mesh.geometry.getAttribute('color');
  engine.data.rocketBuildingParts[0].maxY = 2;
  position.setY(2, 2);
  position.setY(5, 2);
  const original = Array.from(position.array),
    originalColor = Array.from(color.array);
  let state = createRocket('large', 5, 2.45, 0, {
    kind: 'roof-small',
    groundY: 0,
    seed: 13,
  });
  while (state.phase === 'building') state = stepRocket(state, {}, 1 / 60);
  const effects = new RocketEffects(engine, state);
  state = launchRocket(state, 'auto');
  while (state.phase !== 'crashed' && state.elapsed < 60) {
    state = stepRocket(state, {}, 1 / 60);
    effects.update(1 / 60, state);
  }
  assert(state.wreckage && state.supportCollapsed);
  effects.beforeRender();
  effects.afterRender();
  assert.notDeepEqual(Array.from(position.array), original);
  effects.dispose();
  const repaired = new RocketEffects(engine, state);
  state.fireIntensity = 0.7;
  repaired.update(0.2, state, new THREE.Vector3(5, 2, 0));
  repaired.beforeRender();
  repaired.afterRender();
  assert.deepEqual(Array.from(position.array), original);
  assert.deepEqual(Array.from(color.array), originalColor);
  assert.equal(repaired.damaged, 0);
  assert.equal(repaired.debris, 0);
  assert.equal(
    repaired.supportCollisionHeight(5, 0, state),
    null,
    'a repaired city has no stale collapsed-roof collider override',
  );
  assert(
    visibleParticles(repaired).length > 0,
    'repair does not suppress the still-burning wreckage',
  );
  assert(
    state.supportCollapsed,
    'repair must preserve the historical failure snapshot',
  );
  repaired.dispose();
});

test('vehicle fire persists while flying and emits around the actual tilted body rather than the launch point', () => {
  const { engine, state } = fixture();
  state.phase = 'aborted';
  state.throttle = 0;
  state.fireIntensity = 0.8;
  state.position = { x: 100, y: 200, z: 300 };
  state.attitude.roll = Math.PI / 2;
  const effects = new RocketEffects(engine, state);
  effects.update(0.2, state);
  const particles = visibleParticles(effects);
  assert(particles.length >= 10);
  assert(particles.some((p) => p.hot) && particles.some((p) => !p.hot));
  assert(
    particles.every(
      (p) => p.x > 100 && Math.abs(p.y - 200) < 8 && Math.abs(p.z - 300) < 5,
    ),
  );
  effects.dispose();
});

test('the three rockets at one site produce distinct local damage extents and Titan pressure reaches real actors and healthy trees at 150–195 metres', () => {
  const buildings = [8, 70, 150, 195, 290],
    trees = [8, 35, 85, 100, 150, 195, 290],
    results = [];
  for (const kind of ['small', 'large', 'super-heavy']) {
    const { engine, state, mesh, treeMesh, actorMesh } = districtFixture(
        kind,
        buildings,
        trees,
        buildings,
      ),
      position = mesh.geometry.getAttribute('position'),
      color = mesh.geometry.getAttribute('color'),
      original = Array.from(position.array),
      originalColor = Array.from(color.array),
      actorOriginal = Array.from(actorMesh.instanceMatrix.array),
      treeOriginal = Array.from(treeMesh.instanceMatrix.array),
      effects = new RocketEffects(engine, state);
    heat(effects, state, 3);
    effects.beforeRender();
    effects.afterRender();
    effects.update(0.25, state);
    effects.beforeRender();
    const moved = [],
      rotations = [],
      current = new THREE.Matrix4();
    for (let i = 0; i < buildings.length; i++) {
      actorMesh.getMatrixAt(i, current);
      if (Math.abs(current.elements[12] - buildings[i]) > 0.01) moved.push(i);
    }
    for (const i of [4, 5, 6]) {
      treeMesh.getMatrixAt(i, current);
      const q = new THREE.Quaternion();
      current.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      rotations.push(q.angleTo(new THREE.Quaternion()));
    }
    const changedBuildings = buildings.map((_, i) =>
      Array.from(position.array)
        .slice(i * 18, (i + 1) * 18)
        .some((value, j) => value !== original[i * 18 + j]),
    );
    results.push({
      kind,
      damaged: effects.damaged,
      burning: effects.burning,
      moved,
      changedBuildings,
      rotations,
      scorch: effects.group.getObjectByName('Rocket ground scorch footprint')
        .scale.x,
      nearActorX: actorMesh.instanceMatrix.array[12],
    });
    assert.deepEqual(
      Array.from(position.array).slice(4 * 18),
      original.slice(4 * 18),
      'the 290-metre building stays untouched',
    );
    effects.afterRender();
    assert.deepEqual(Array.from(actorMesh.instanceMatrix.array), actorOriginal);
    assert.deepEqual(Array.from(treeMesh.instanceMatrix.array), treeOriginal);
    effects.reset();
    assert.deepEqual(Array.from(position.array), original);
    assert.deepEqual(Array.from(color.array), originalColor);
    effects.dispose();
  }
  assert.deepEqual(
    results.map((r) => r.damaged),
    [1, 2, 4],
  );
  assert.deepEqual(
    results.map((r) => r.burning),
    [1, 2, 4],
  );
  assert.deepEqual(
    results.map((r) => r.moved),
    [[0], [0, 1], [0, 1, 2, 3]],
  );
  assert.deepEqual(results[2].changedBuildings, [
    true,
    true,
    true,
    true,
    false,
  ]);
  assert(
    results[2].nearActorX > results[1].nearActorX &&
      results[1].nearActorX > results[0].nearActorX,
    'Titan applies a stronger actual displacement, not only a wider particle effect',
  );
  assert(
    results[2].scorch > results[1].scorch * 2 &&
      results[1].scorch > results[0].scorch * 2,
  );
  assert(
    results[0].rotations.every((angle) => angle === 0) &&
      results[1].rotations.every((angle) => angle === 0),
  );
  assert(
    results[2].rotations[0] > 0.3 &&
      results[2].rotations[1] > 0.1 &&
      results[2].rotations[2] === 0,
    'healthy distant trees bend within the pressure footprint while the far forest is unchanged',
  );
  assert(
    results[2].rotations.every((angle) => angle <= 1.351),
    'a tree shared by source and detailed LOD lists bends once per draw',
  );
});

test('Titan uses bounded larger effect pools while Scout and Atlas retain their existing budgets and all source resources restore exactly', () => {
  for (const kind of ['small', 'large', 'super-heavy']) {
    const titan = kind === 'super-heavy',
      buildings = Array.from({ length: 120 }, (_, i) => 5 + i * 0.05),
      trees = Array.from({ length: 80 }, (_, i) => 2 + i * 0.06),
      actors = Array.from({ length: 140 }, (_, i) => 3 + i * 0.04),
      { engine, state, mesh, treeMesh, actorMesh } = districtFixture(
        kind,
        buildings,
        trees,
        actors,
      ),
      original = Array.from(mesh.geometry.getAttribute('position').array),
      originalColor = Array.from(mesh.geometry.getAttribute('color').array),
      actorOriginal = Array.from(actorMesh.instanceMatrix.array),
      treeOriginal = Array.from(treeMesh.instanceMatrix.array),
      effects = new RocketEffects(engine, state),
      fragmentLimit = titan ? 96 : 64,
      rubble = effects.group.getObjectByName(
        `Rocket building debris (${fragmentLimit} slot limit)`,
      ),
      points = effects.group.children.find(
        (object) => object instanceof THREE.Points,
      );
    heat(effects, state, 12);
    effects.beforeRender();
    effects.afterRender();
    effects.update(0.1, state);
    assert.equal(effects.damaged, titan ? 88 : 48);
    if (titan) {
      const pressureParts = [...effects.parts];
      for (let i = 112; i < 120; i++) {
        const part = engine.data.rocketBuildingParts[i],
          b = part.bounds;
        effects.receiveCollision(
          {
            ...buildingContact(),
            polygon: part.polygon,
            bounds: { ...b, minY: part.minY, maxY: part.maxY },
            point: { x: b.minX, y: 5, z: 1 },
          },
          state,
          1 / 60,
        );
      }
      assert.equal(
        effects.parts.length,
        96,
        'the eight reserved contacts fit inside the original body-part budget',
      );
      assert.equal(effects.damaged, 96);
      assert(
        pressureParts.every((part) => effects.parts.includes(part)),
        'admitting real contacts never discards already damaged pressure spans',
      );
    }
    assert.equal(effects.burning, titan ? 56 : 28);
    assert.equal(effects.debris, fragmentLimit + (titan ? 96 : 48));
    assert.equal(rubble.count, fragmentLimit);
    assert.equal(rubble.instanceMatrix.count, fragmentLimit);
    assert.equal(
      points.geometry.getAttribute('position').count,
      titan ? 360 : 160,
    );
    heat(effects, state, 20);
    effects.beforeRender();
    effects.afterRender();
    assert(effects.debris <= (titan ? 192 : 112));
    assert.equal(rubble.count, fragmentLimit);
    assert.deepEqual(Array.from(actorMesh.instanceMatrix.array), actorOriginal);
    assert.deepEqual(Array.from(treeMesh.instanceMatrix.array), treeOriginal);
    assert.equal(actorMesh.frustumCulled, true);
    assert.equal(treeMesh.frustumCulled, true);
    let sourceDisposals = 0;
    for (const resource of [
      mesh.geometry,
      mesh.material,
      actorMesh.geometry,
      actorMesh.material,
      treeMesh.geometry,
      treeMesh.material,
    ])
      resource.addEventListener('dispose', () => sourceDisposals++);
    effects.dispose();
    assert.equal(sourceDisposals, 0);
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('position').array),
      original,
    );
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('color').array),
      originalColor,
    );
  }
});

test('Titan impact, explosion and launch dust are stronger while every graphics mode stays within its fixed particle budget', () => {
  const impacts = [],
    explosions = [],
    dust = [];
  for (const kind of ['small', 'large', 'super-heavy']) {
    const { engine, state } = fixture(0, kind);
    state.phase = 'crashed';
    state.throttle = 0;
    const effects = new RocketEffects(engine, state);
    state.events = [
      {
        id: 1,
        type: 'impact',
        time: 0,
        position: { x: 0, y: 30, z: 0 },
        magnitude: 45,
      },
    ];
    effects.update(0.1, state);
    impacts.push(visibleParticles(effects).length);
    effects.reset();
    state.events.push({
      id: 2,
      type: 'exploded',
      time: 0,
      position: { x: 0, y: 30, z: 0 },
      magnitude: 1,
    });
    effects.update(0.1, state);
    const burst = visibleParticles(effects);
    explosions.push({
      count: burst.length,
      spread: Math.max(...burst.map((p) => Math.hypot(p.x, p.z))),
    });
    effects.dispose();
    const launch = fixture(0, kind),
      plume = new RocketEffects(launch.engine, launch.state);
    heat(plume, launch.state, 1);
    dust.push(visibleParticles(plume).length);
    plume.dispose();
    for (const [quality, compatible, expected] of [
      ['balanced', false, kind === 'super-heavy' ? 360 : 160],
      ['high', false, kind === 'super-heavy' ? 600 : 420],
      ['high', true, kind === 'super-heavy' ? 240 : 160],
    ]) {
      const graphics = fixture(0, kind);
      graphics.engine.settings.quality = quality;
      graphics.engine.compatibleGraphics = compatible;
      const limited = new RocketEffects(graphics.engine, graphics.state),
        points = limited.group.children.find(
          (object) => object instanceof THREE.Points,
        );
      assert.equal(points.geometry.getAttribute('position').count, expected);
      limited.dispose();
    }
  }
  assert(impacts[2] > impacts[0] && impacts[2] > impacts[1]);
  assert(
    explosions[0].count < explosions[1].count &&
      explosions[1].count < explosions[2].count,
  );
  assert(explosions[2].spread > explosions[1].spread * 1.5);
  assert(dust[0] < dust[1] && dust[1] < dust[2]);
});

test('Titan redirects five near-ground jets into bounded outward flame ribbons and fast surface dust', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  const effects = new RocketEffects(engine, state);
  const outwash = effects.group.getObjectByName(
    'Titan five-jet ground flame outwash',
  );
  try {
    effects.update(0.1, state);
    assert(outwash instanceof THREE.InstancedMesh);
    assert.equal(
      outwash.count,
      40,
      'eight surface directions for each of five firing nozzles',
    );
    outwash.computeBoundingBox();
    const size = outwash.boundingBox.getSize(new THREE.Vector3());
    assert(
      size.x > 65 && size.z > 65,
      'the plume spreads across the ground beyond the vehicle footprint',
    );
    assert(
      size.y < 0.1,
      'ground flame spread cannot turn into a floating fireball',
    );
    assert(
      effects.particles.some(
        (p) => p.age < p.life && p.p.y < 2 && Math.hypot(p.v.x, p.v.z) > 25,
      ),
    );
    assert.equal(
      effects.particles.length,
      360,
      'spread reuses the existing balanced particle budget',
    );
    state.strapAttached = false;
    state.strapFuel = 0;
    state.stage = 'boost';
    effects.update(0.1, state);
    assert.equal(
      outwash.count,
      8,
      'the central nozzle alone remains after the four are released',
    );
    state.phase = 'aborted';
    effects.update(0.1, state);
    assert.equal(
      outwash.count,
      0,
      'shutdown ends the impingement flames immediately',
    );
    effects.reset();
    assert.equal(outwash.count, 0);
    assert.equal(outwash.material.uniforms.uPower.value, 0);
  } finally {
    effects.dispose();
  }
});

test('Titan ground impingement follows the actual local surface height and vanishes once the plume is aloft', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.elevation = () => 8;
  state.position.y = 8.45;
  const effects = new RocketEffects(engine, state);
  effects.supportCollisionHeight = () => 50;
  const outwash = effects.group.getObjectByName(
    'Titan five-jet ground flame outwash',
  );
  try {
    effects.update(0.1, state);
    const matrix = new THREE.Matrix4();
    outwash.getMatrixAt(0, matrix);
    assert(
      Math.abs(new THREE.Vector3().setFromMatrixPosition(matrix).y - 8.45) <
        1e-6,
    );
    state.support.kind = 'roof-small';
    state.position.y = 50.45;
    effects.update(0.1, state);
    outwash.getMatrixAt(0, matrix);
    assert(
      Math.abs(new THREE.Vector3().setFromMatrixPosition(matrix).y - 50.45) <
        1e-6,
      'a real rooftop launch still follows its supporting roof',
    );
    state.phase = 'flight';
    state.position.y = state.altitude = 500;
    effects.update(0.1, state);
    assert.equal(
      outwash.count,
      0,
      'direct ground flames stop beyond the nozzle plume even while pressure decays gradually',
    );
  } finally {
    effects.dispose();
  }
  for (const kind of ['small', 'large']) {
    const fixtureValue = fixture(0, kind);
    const other = new RocketEffects(fixtureValue.engine, fixtureValue.state);
    assert.equal(
      other.group.getObjectByName('Titan five-jet ground flame outwash'),
      undefined,
    );
    other.dispose();
  }
});

test('tilted Titan exhaust anchors to the surface at its displaced ground contact', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.elevation = (_x, z) => 30 + 0.4 * z;
  state.position.y = 50;
  state.attitude.pitch = Math.PI / 6;
  const effects = new RocketEffects(engine, state);
  try {
    effects.update(0.1, state);
    const contact = effects.groundContacts[0];
    assert(
      contact.z < state.position.z - 10,
      'a 30-degree tilted jet hits away from the nozzle x/z',
    );
    assert(
      Math.abs(contact.y - engine.elevation(contact.x, contact.z) - 0.45) <
        1e-6,
      'the final contact uses the surface height at the displaced landing point',
    );
    const outwash = effects.group.getObjectByName(
        'Titan five-jet ground flame outwash',
      ),
      matrix = new THREE.Matrix4();
    assert.equal(outwash.count, 40);
    outwash.getMatrixAt(0, matrix);
    assert(
      Math.abs(
        new THREE.Vector3().setFromMatrixPosition(matrix).y - contact.y,
      ) < 1e-5,
      'the rendered central ribbon is anchored to that surface contact',
    );
  } finally {
    effects.dispose();
  }
});

function buildingContact(source = 'building') {
  return {
    source,
    point: { x: 3, y: 5, z: 1 },
    from: { x: 0, y: 5, z: 1 },
    to: { x: 4, y: 5, z: 1 },
    radius: 2,
    speed: 0,
    mass: 1886000,
    initialOverlap: true,
    bounds: { minX: 3, maxX: 7, minY: 0, maxY: 10, minZ: 0, maxZ: 2 },
    polygon: [
      [
        [3, 0],
        [7, 0],
        [7, 2],
        [3, 2],
      ],
    ],
  };
}

test('an unspooled city contact deforms its actual building by over 20cm and emits bounded contact fragments', () => {
  const { engine, state, mesh } = fixture(2, 'super-heavy');
  state.throttle = 0;
  const position = mesh.geometry.getAttribute('position'),
    original = Array.from(position.array),
    effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact(), state, 1 / 60);
    effects.update(1 / 60, state);
    effects.beforeRender();
    effects.afterRender();
    assert.equal(
      effects.damaged,
      1,
      'the contacted span is damaged even before exhaust spool-up',
    );
    assert(
      original[7] - position.getY(2) > 0.2,
      'the visible roof has a measurable first-contact response',
    );
    assert.deepEqual(
      Array.from(position.array).slice(18),
      original.slice(18),
      'the distant building is untouched',
    );
    assert(effects.fragments.length >= 4);
    assert(
      effects.fragments.some(
        (fragment) => fragment.p.distanceTo(new THREE.Vector3(3, 5, 1)) < 6,
      ),
      'fragments start at the contact, not a distant roof centre',
    );
    for (let i = 0; i < 180; i++) {
      effects.receiveCollision(buildingContact(), state, 1 / 60);
      effects.update(1 / 60, state);
    }
    assert(effects.fragments.length <= 96);
    assert(
      effects.supportCollisionHeight(5, 1, state) < 5,
      'the mission collider can follow the real settling building',
    );
    effects.reset();
    assert.deepEqual(Array.from(position.array), original);
    assert.equal(effects.contacts.size, 0);
  } finally {
    effects.dispose();
  }
});

test('visible facade pages follow building damage and char glass only through reversible mission materials', () => {
  const { engine, state, mesh } = fixture(1, 'super-heavy');
  engine.buildings = new THREE.Group();
  engine.scene.add(engine.buildings);
  engine.buildings.add(mesh);
  state.throttle = 0;
  let compilations = 0,
    sourceDisposals = 0;
  const geometry = new THREE.BoxGeometry(1, 8, 0.5).translate(4, 5, 1),
    source = Array.from(geometry.getAttribute('position').array),
    material = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveIntensity: 1,
    }),
    page = new THREE.Mesh(geometry, material);
  material.onBeforeCompile = (shader) => {
    compilations++;
    shader.fragmentShader += '\n// original facade glass and night shader';
  };
  geometry.addEventListener('dispose', () => sourceDisposals++);
  engine.buildings.add(page);
  const effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact(), state, 1 / 60);
    effects.update(1 / 60, state);
    effects.beforeRender();
    const ownedGeometry = page.geometry,
      ownedMaterial = page.material;
    assert.notEqual(ownedGeometry, geometry);
    assert.notEqual(ownedMaterial, material);
    assert(
      ownedGeometry.getAttribute('aRocketDamage').array.some((n) => n > 0.3),
    );
    assert.notDeepEqual(
      Array.from(ownedGeometry.getAttribute('position').array),
      source,
    );
    assert.deepEqual(
      Array.from(geometry.getAttribute('position').array),
      source,
      'the facade queue retains its exact source vertices',
    );
    const shader = {
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <opaque_fragment>',
    };
    ownedMaterial.onBeforeCompile(shader, {});
    assert.equal(compilations, 1);
    assert(shader.fragmentShader.includes('vRocketDamage'));
    assert(
      shader.fragmentShader.indexOf('gl_FragColor.rgb*=') >
        shader.fragmentShader.indexOf('#include <opaque_fragment>'),
      'scorch applies after glass and night-light output',
    );
    assert.equal(
      material.emissiveIntensity,
      1,
      'the ordinary city material is unchanged',
    );
    effects.afterRender();
    assert.equal(page.geometry, geometry);
    assert.equal(page.material, material);
    effects.beforeRender();
    assert.equal(
      page.geometry,
      ownedGeometry,
      'the detail geometry is cached instead of cloned each frame',
    );
    effects.afterRender();
    let ownedDisposed = 0;
    ownedGeometry.addEventListener('dispose', () => ownedDisposed++);
    engine.buildings.remove(page);
    effects.beforeRender();
    effects.afterRender();
    assert.equal(
      ownedDisposed,
      1,
      'a retired LOD page releases only the mission copy',
    );
    effects.reset();
    assert.equal(sourceDisposals, 0);
    assert.deepEqual(
      Array.from(geometry.getAttribute('position').array),
      source,
    );
    assert.equal(mesh.material.vertexColors, true);
    assert.equal(mesh.geometry.getAttribute('aRocketDamage'), undefined);
  } finally {
    effects.dispose();
  }
});

test('landmark instance contacts deform the visible instance while restoring shared geometry and the newest owner matrices', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.landmarks = new THREE.Group();
  engine.scene.add(engine.landmarks);
  const geometry = new THREE.BoxGeometry(4, 10, 2),
    material = new THREE.MeshStandardMaterial(),
    mesh = new THREE.InstancedMesh(geometry, material, 2),
    first = new THREE.Matrix4().makeTranslation(5, 5, 1),
    second = new THREE.Matrix4().makeTranslation(100, 5, 1);
  mesh.setMatrixAt(0, first);
  mesh.setMatrixAt(1, second);
  engine.landmarks.add(mesh);
  state.throttle = 0;
  const effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact('landmark'), state, 1 / 60);
    effects.update(1 / 60, state);
    const newest = new THREE.Matrix4().makeTranslation(5, 5.1, 1);
    mesh.setMatrixAt(0, newest);
    mesh.getMatrixAt(0, newest);
    effects.beforeRender();
    const actual = new THREE.Matrix4();
    mesh.getMatrixAt(0, actual);
    assert.notDeepEqual(actual.elements, newest.elements);
    assert(
      mesh.geometry.getAttribute('aRocketDamage') instanceof
        THREE.InstancedBufferAttribute,
    );
    assert(mesh.geometry.getAttribute('aRocketDamage').getX(0) > 0.3);
    assert.equal(mesh.geometry.getAttribute('aRocketDamage').getX(1), 0);
    mesh.getMatrixAt(1, actual);
    assert.deepEqual(actual.elements, second.elements);
    effects.afterRender();
    mesh.getMatrixAt(0, actual);
    assert.deepEqual(actual.elements, newest.elements);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    effects.reset();
    assert.equal(geometry.getAttribute('aRocketDamage'), undefined);
  } finally {
    effects.dispose();
  }
});

test('building detail damage has fixed mesh and vertex budgets without disposing source-owned pages', () => {
  const { engine, state, mesh } = fixture(1, 'super-heavy');
  engine.buildings = new THREE.Group();
  engine.scene.add(engine.buildings);
  engine.buildings.add(mesh);
  let sourceDisposals = 0;
  const pages = [];
  for (let i = 0; i < 40; i++) {
    const geometry = new THREE.BoxGeometry(0.1, 8, 0.1).translate(
        4 + i * 0.02,
        5,
        1,
      ),
      material = new THREE.MeshBasicMaterial(),
      page = new THREE.Mesh(geometry, material);
    geometry.addEventListener('dispose', () => sourceDisposals++);
    pages.push({ page, geometry, material });
    engine.buildings.add(page);
  }
  const effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact(), state, 1 / 60);
    effects.update(1 / 60, state);
    effects.beforeRender();
    assert(effects.buildingSurfaces.size <= 32);
    assert(effects.surfaceVertices <= 240000);
    effects.afterRender();
    effects.reset();
    assert.equal(effects.buildingSurfaces.size, 0);
    assert.equal(effects.buildingMaterials.size, 0);
    assert.equal(sourceDisposals, 0);
    for (const source of pages) {
      assert.equal(source.page.geometry, source.geometry);
      assert.equal(source.page.material, source.material);
    }
  } finally {
    effects.dispose();
  }
});

test('near-ground Titan exhaust creates rolling dust in the existing pool instead of white hot sparkles', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  const effects = new RocketEffects(engine, state);
  try {
    heat(effects, state, 1);
    const dust = effects.particles.filter(
      (particle) => particle.age < particle.life && particle.dust,
    );
    assert(dust.length > 10);
    assert(dust.every((particle) => !particle.hot && particle.life >= 3.5));
    assert(
      dust.some((particle) => Math.hypot(particle.v.x, particle.v.z) > 25),
    );
    assert(
      effects.alphas.some((alpha) => alpha < -2),
      'the existing draw receives the separate large dust-puff category',
    );
    assert.equal(effects.particles.length, 360);
    const outwash = effects.group.getObjectByName(
      'Titan five-jet ground flame outwash',
    );
    assert.equal(outwash.count, 40);
    assert.equal(outwash.material.forceSinglePass, true);
    effects.reset();
    assert(effects.alphas.every((alpha) => alpha === 0));
    assert.equal(outwash.count, 0);
  } finally {
    effects.dispose();
  }
});

test('ground impingement rests above the rendered road surface rather than below the asphalt', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.elevation = () => 40.28;
  engine.data.roadSurface = { sample: () => 41.748 };
  state.position.y = 42.198;
  state.support.groundY = 41.748;
  const effects = new RocketEffects(engine, state);
  try {
    effects.update(0.1, state);
    assert(Math.abs(effects.groundContacts[0].y - 42.198) < 1e-6);
    assert(effects.groundContacts.every((contact) => contact.y > 41.748));
  } finally {
    effects.dispose();
  }
});

test('a real contacted span outside the pressure selection uses a reserved contact slot', () => {
  const { engine, state, mesh } = fixture(100, 'super-heavy');
  state.throttle = 0;
  const original = Array.from(mesh.geometry.getAttribute('position').array),
    effects = new RocketEffects(engine, state),
    contact = buildingContact();
  contact.point.x = 201;
  contact.bounds.minX = 201;
  contact.bounds.maxX = 205;
  contact.polygon = [
    [
      [201, 0],
      [205, 0],
      [205, 2],
      [201, 2],
    ],
  ];
  try {
    assert.equal(effects.parts.length, 88);
    assert(!effects.parts.some((part) => part.part.key === '99'));
    effects.receiveCollision(contact, state, 1 / 60);
    effects.update(1 / 60, state);
    effects.beforeRender();
    effects.afterRender();
    assert.equal(effects.parts.length, 89);
    assert(
      effects.parts.some((part) => part.part.key === '99' && part.contact),
    );
    assert.notDeepEqual(
      Array.from(mesh.geometry.getAttribute('position').array).slice(99 * 18),
      original.slice(99 * 18),
    );
    effects.reset();
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('position').array),
      original,
    );
  } finally {
    effects.dispose();
  }
});

test('world-space contact priority evicts an unselected facade cache instead of skipping the newly hit page', () => {
  const { engine, state, mesh } = fixture(2, 'super-heavy', [5, 180]);
  engine.buildings = new THREE.Group();
  engine.scene.add(engine.buildings);
  engine.buildings.add(mesh);
  const pages = [];
  for (let i = 0; i < 31; i++) {
    const page = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 8, 0.1).translate(179 + i * 0.02, 5, 1),
      new THREE.MeshBasicMaterial(),
    );
    pages.push(page);
    engine.buildings.add(page);
  }
  const effects = new RocketEffects(engine, state);
  try {
    effects.parts[1].exposure = 0.6;
    effects.parts[1].collapse = 0.2;
    effects.beforeRender();
    effects.afterRender();
    assert.equal(effects.buildingSurfaces.size, 32);
    const priorCopies = [...effects.buildingSurfaces.values()].filter(
      (surface) => surface.mesh !== mesh,
    );
    let retiredCopies = 0;
    for (const surface of priorCopies)
      surface.geometry.addEventListener('dispose', () => retiredCopies++);
    const geometry = new THREE.BoxGeometry(1, 8, 0.5).translate(4, 5, 1),
      page = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    engine.buildings.add(page);
    effects.receiveCollision(buildingContact(), state, 1 / 60);
    effects.beforeRender();
    assert.notEqual(
      page.geometry,
      geometry,
      'world-coordinate page vertices take priority even though every page.position is zero',
    );
    assert(
      page.geometry.getAttribute('aRocketDamage').array.some((n) => n > 0),
    );
    assert.equal(effects.buildingSurfaces.size, 32);
    assert.equal(
      retiredCopies,
      1,
      'one less relevant cached page is retired to admit the real contact',
    );
    effects.afterRender();
    effects.reset();
    assert.equal(page.geometry, geometry);
  } finally {
    effects.dispose();
  }
});

test('instanced damage bounds both individual capacity and aggregate attribute allocation to 4096', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.landmarks = new THREE.Group();
  engine.scene.add(engine.landmarks);
  const meshes = [4097, 2500, 2500].map((capacity) => {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 8, 1),
      new THREE.MeshStandardMaterial(),
      capacity,
    );
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(5, 5, 1));
    engine.landmarks.add(mesh);
    return mesh;
  });
  const effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact('landmark'), state, 1 / 60);
    effects.beforeRender();
    assert.equal(
      meshes[0].geometry.getAttribute('aRocketDamage'),
      undefined,
      'oversized source groups retain their ordinary renderer',
    );
    assert.equal(effects.surfaceInstances, 2500);
    assert(
      [...effects.buildingSurfaces.values()].reduce(
        (sum, surface) =>
          sum +
          (surface.mesh instanceof THREE.InstancedMesh
            ? surface.damage.count
            : 0),
        0,
      ) <= 4096,
    );
    effects.afterRender();
    effects.reset();
    assert.equal(effects.surfaceInstances, 0);
    assert(
      meshes.every(
        (mesh) => mesh.geometry.getAttribute('aRocketDamage') === undefined,
      ),
    );
  } finally {
    effects.dispose();
  }
});

test('geometry and material restore independently when a detail owner replaces either during the draw', () => {
  const { engine, state, mesh } = fixture(1, 'super-heavy');
  engine.buildings = new THREE.Group();
  engine.scene.add(engine.buildings);
  engine.buildings.add(mesh);
  const geometry = new THREE.BoxGeometry(1, 8, 0.5).translate(4, 5, 1),
    material = new THREE.MeshStandardMaterial(),
    page = new THREE.Mesh(geometry, material);
  engine.buildings.add(page);
  const effects = new RocketEffects(engine, state);
  try {
    effects.receiveCollision(buildingContact(), state, 1 / 60);
    effects.beforeRender();
    const replacement = new THREE.BoxGeometry(1, 8, 0.5).translate(4, 5, 1);
    page.geometry = replacement;
    effects.afterRender();
    assert.equal(page.geometry, replacement, 'the owner geometry wins');
    assert.equal(
      page.material,
      material,
      'the surviving mission material is removed despite the geometry swap',
    );
    effects.beforeRender();
    const nextMaterial = new THREE.MeshStandardMaterial({ color: 0x334455 });
    page.material = nextMaterial;
    effects.afterRender();
    assert.equal(
      page.geometry,
      replacement,
      'the mission geometry is removed independently',
    );
    assert.equal(page.material, nextMaterial, 'the owner material wins');
    effects.reset();
    assert.equal(page.geometry, replacement);
    assert.equal(page.material, nextMaterial);
  } finally {
    effects.dispose();
  }
});

test('a bounded ground-dust reservation survives competing fire smoke and returns the full pool for accidents', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  engine.compatibleGraphics = true;
  const effects = new RocketEffects(engine, state);
  try {
    for (let i = 0; i < 90; i++) effects.update(1 / 60, state);
    const dust = effects.particles.filter(
        (particle) => particle.dust && particle.age < particle.life,
      ),
      ages = dust.map((particle) => particle.age);
    assert(dust.length >= 40 && dust.length <= 96);
    assert(
      dust.some((particle) => particle.age > 0.8),
      'puffs survive long enough to form a rolling outward front',
    );
    for (let i = 0; i < 2000; i++) effects.emit(0, 2, 0, 0.4, false, true);
    assert.deepEqual(
      dust.map((particle) => particle.age),
      ages,
    );
    assert(
      dust.every((particle) => particle.dust),
      'tree and vehicle smoke cannot immediately overwrite the reserved puffs',
    );
    state.phase = 'flight';
    state.position.y = state.altitude = 200;
    effects.update(1 / 60, state);
    assert.equal(effects.groundContactCount, 0);
    assert.equal(
      effects.dustSpawn,
      0,
      'new dust stops when jets no longer reach the surface',
    );
    const trailAges = dust.map((particle) => particle.age);
    for (let i = 0; i < 2000; i++) effects.emit(0, 2, 0, 0.4, false, true);
    assert.deepEqual(
      dust.map((particle) => particle.age),
      trailAges,
    );
    assert(
      dust.every((particle) => particle.dust),
      'the already airborne dust front keeps its remaining lifetime after liftoff',
    );
    state.fireIntensity = 1;
    for (let i = 0; i < 240; i++) effects.emit(0, 2, 0, 0.5, false, true);
    assert(
      effects.particles.every((particle) => !particle.dust),
      'onboard fire takes priority over the ground-dust reservation',
    );
    state.phase = 'crashed';
    for (let i = 0; i < 240; i++) effects.emit(0, 2, 0, 1, true, true);
    assert(
      effects.particles.every((particle) => !particle.dust),
      'an accident can reuse every slot immediately',
    );
    assert.equal(effects.particles.length, 240);
    effects.reset();
    assert.equal(effects.dustSpawn, 0);
    assert.equal(effects.dustNext, 0);
    assert.equal(effects.dustAlive, 0);
  } finally {
    effects.dispose();
  }
});

test('exact source polygons and original height identify compound spans instead of the first overlapping bounding box', () => {
  const { engine, state, mesh } = fixture(3, 'super-heavy', [5, 5, 5]);
  state.throttle = 0;
  const parts = engine.data.rocketBuildingParts;
  parts[1].maxY = 60;
  parts[2].maxY = 60;
  parts[2].polygon = [
    [
      [3, 0],
      [7, 0],
      [7, 2],
      [3, 0],
    ],
  ];
  const original = Array.from(mesh.geometry.getAttribute('position').array),
    effects = new RocketEffects(engine, state),
    contact = {
      ...buildingContact(),
      polygon: parts[2].polygon,
      point: { x: 3, y: 45, z: 1 },
      bounds: { ...parts[2].bounds, minY: 0, maxY: 60 },
    };
  try {
    effects.receiveCollision(contact, state, 1 / 60);
    effects.beforeRender();
    effects.afterRender();
    assert.deepEqual(
      effects.parts.filter((d) => d.contact).map((d) => d.part.key),
      ['2'],
    );
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('position').array).slice(0, 36),
      original.slice(0, 36),
    );
    assert.notDeepEqual(
      Array.from(mesh.geometry.getAttribute('position').array).slice(36),
      original.slice(36),
    );
    effects.reset();
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('position').array),
      original,
    );
  } finally {
    effects.dispose();
  }
});

test('legacy contact matching uses captured original bounds even after current source positions move', () => {
  const { engine, state, mesh } = fixture(100, 'super-heavy');
  state.throttle = 0;
  for (const part of engine.data.rocketBuildingParts) {
    delete part.polygon;
    delete part.bounds;
  }
  const effects = new RocketEffects(engine, state),
    position = mesh.geometry.getAttribute('position'),
    target = engine.data.rocketBuildingParts[99],
    contact = buildingContact();
  for (let i = target.start; i < target.start + target.count; i++)
    position.setX(i, position.getX(i) + 0.75);
  const ownerPositions = Array.from(position.array);
  Object.assign(contact, {
    point: { x: 201, y: 5, z: 1 },
    bounds: { minX: 201, maxX: 205, minY: 0, maxY: 10, minZ: 0, maxZ: 2 },
  });
  try {
    effects.receiveCollision(contact, state, 1 / 60);
    assert(effects.parts.some((d) => d.part === target && d.contact));
    effects.beforeRender();
    effects.afterRender();
    effects.reset();
    assert.deepEqual(
      Array.from(position.array),
      ownerPositions,
      'restore retains the owner state captured when the new span was admitted',
    );
  } finally {
    effects.dispose();
  }
});

test('saturated pressure damage admits eight actual contacts without evicting damaged spans or exceeding 96', () => {
  const { engine, state, mesh } = fixture(110, 'super-heavy');
  state.throttle = 0;
  const original = Array.from(mesh.geometry.getAttribute('position').array),
    effects = new RocketEffects(engine, state),
    pressure = [...effects.parts];
  for (const d of pressure) {
    d.exposure = 0.15;
    d.dirtyColor = true;
  }
  try {
    for (let i = 100; i < 108; i++) {
      const part = engine.data.rocketBuildingParts[i];
      effects.receiveCollision(
        {
          ...buildingContact(),
          polygon: part.polygon,
          bounds: { ...part.bounds, minY: 0, maxY: 10 },
          point: { x: part.bounds.minX, y: 5, z: 1 },
        },
        state,
        1 / 60,
      );
    }
    assert.equal(effects.parts.length, 96);
    assert(pressure.every((d) => effects.parts.includes(d)));
    assert.equal(effects.parts.filter((d) => d.contact).length, 8);
    effects.beforeRender();
    effects.afterRender();
    const position = mesh.geometry.getAttribute('position');
    for (let i = 100; i < 108; i++)
      assert.notDeepEqual(
        Array.from(position.array).slice(i * 18, (i + 1) * 18),
        original.slice(i * 18, (i + 1) * 18),
      );
    assert(effects.fragments.length <= 96);
    effects.reset();
    assert.deepEqual(Array.from(position.array), original);
    assert.equal(effects.contactMarks.length, 0);
  } finally {
    effects.dispose();
  }
});

test('a tall struck facade dents and chars locally, marks its real normal and restores source resources exactly', () => {
  const { engine, state, mesh } = fixture(1, 'super-heavy');
  state.throttle = 0;
  const part = engine.data.rocketBuildingParts[0],
    bodyPosition = mesh.geometry.getAttribute('position');
  part.maxY = 100;
  for (let i = 0; i < bodyPosition.count; i++)
    if (bodyPosition.getY(i) === 10) bodyPosition.setY(i, 100);
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 90, 4, 18)
      .rotateY(Math.PI / 2)
      .translate(3, 50, 1),
    new THREE.MeshStandardMaterial({ color: 0x88aacc }),
  );
  engine.buildings = new THREE.Group();
  engine.scene.add(engine.buildings);
  engine.buildings.add(mesh, wall);
  const source = wall.geometry,
    material = wall.material,
    original = Array.from(source.getAttribute('position').array),
    bodyOriginal = Array.from(bodyPosition.array),
    effects = new RocketEffects(engine, state),
    contact = {
      ...buildingContact(),
      polygon: part.polygon,
      bounds: { ...part.bounds, minY: 0, maxY: 100 },
      point: { x: 3, y: 50, z: 1 },
      normal: { x: -1, y: 0, z: 0 },
      normalSpeed: 0,
      force: 30000000,
      impactEnergy: 0,
      penetration: 0.7,
    };
  try {
    effects.receiveCollision(contact, state, 1 / 60);
    effects.update(1 / 60, state);
    effects.beforeRender();
    const position = wall.geometry.getAttribute('position'),
      damage = wall.geometry.getAttribute('aRocketDamage');
    let nearDent = 0,
      farDent = 0,
      nearChar = 0,
      farChar = 0;
    for (let i = 0; i < position.count; i++) {
      const distance = Math.abs(original[i * 3 + 1] - 50),
        dent = position.getX(i) - original[i * 3];
      if (distance < 6) {
        nearDent = Math.max(nearDent, dent);
        nearChar = Math.max(nearChar, damage.getX(i));
      }
      if (distance > 38) {
        farDent = Math.max(farDent, dent);
        farChar = Math.max(farChar, damage.getX(i));
      }
    }
    assert(
      nearDent > 0.45 && nearDent > farDent * 1.8,
      'the struck wall dents inward near the real contact rather than translating the entire tower',
    );
    assert(
      nearChar > farChar + 0.15,
      'the actual impact region receives stronger local char/cracks',
    );
    assert.equal(effects.contactMesh.count, 1);
    const mark = new THREE.Matrix4();
    effects.contactMesh.getMatrixAt(0, mark);
    const marked = new THREE.Vector3().setFromMatrixPosition(mark);
    assert(marked.distanceTo(new THREE.Vector3(2.85, 50, 1)) < 1e-5);
    assert(
      effects.particles.some(
        (p) =>
          p.age < p.life &&
          p.hot &&
          p.p.distanceTo(new THREE.Vector3(3, 50, 1)) < 2,
      ),
    );
    assert.equal(
      state.fireIntensity,
      0,
      'an impact flash does not manufacture onboard fire',
    );
    effects.afterRender();
    assert.equal(wall.geometry, source);
    assert.equal(wall.material, material);
    assert.deepEqual(
      Array.from(source.getAttribute('position').array),
      original,
    );
    effects.update(1.7, state);
    assert.equal(effects.contactMesh.count, 0);
    effects.reset();
    assert.deepEqual(Array.from(bodyPosition.array), bodyOriginal);
    assert.equal(effects.parts[0].contactDent, undefined);
  } finally {
    effects.dispose();
  }
});

test('contact dent responds to normal load and energy instead of high tangential speed or render yield feedback', () => {
  const dents = [];
  for (const extra of [
    { speed: 0, normalSpeed: 0, force: 0, impactEnergy: 0, yieldProgress: 0 },
    { speed: 200, normalSpeed: 0, force: 0, impactEnergy: 0, yieldProgress: 1 },
    {
      speed: 200,
      normalSpeed: 35,
      force: 30000000,
      impactEnergy: 30000000,
      yieldProgress: 0,
    },
  ]) {
    const { engine, state } = fixture(1, 'super-heavy');
    state.throttle = 0;
    const effects = new RocketEffects(engine, state);
    try {
      effects.receiveCollision(
        { ...buildingContact(), normal: { x: -1, y: 0, z: 0 }, ...extra },
        state,
        1 / 60,
      );
      dents.push(effects.parts[0].contactDent);
    } finally {
      effects.dispose();
    }
  }
  assert.equal(dents[0], dents[1]);
  assert(dents[2] > dents[0] + 0.4);
});

test('real contact marks remain an eight-slot fading pool even when no additional geometry can be admitted', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  state.throttle = 0;
  const effects = new RocketEffects(engine, state);
  try {
    for (let i = 0; i < 40; i++)
      effects.receiveCollision(
        {
          ...buildingContact(),
          point: { x: i * 10, y: 30, z: 0 },
          bounds: {
            minX: i * 10,
            maxX: i * 10 + 2,
            minY: 0,
            maxY: 60,
            minZ: 0,
            maxZ: 2,
          },
          normal: { x: -1, y: 0, z: 0 },
        },
        state,
        1 / 60,
      );
    effects.update(1 / 60, state);
    assert.equal(effects.contactMarks.length, 8);
    assert.equal(effects.contactMesh.count, 8);
    assert.equal(effects.contactMesh.instanceMatrix.count, 8);
    assert.equal(
      effects.contactMesh.geometry.getAttribute('aContactOpacity').count,
      8,
    );
    assert.equal(effects.parts.length, 0);
    assert.equal(effects.particles.length, 360);
    effects.update(2, state);
    assert.equal(effects.contactMesh.count, 0);
    effects.reset();
    assert.equal(effects.contactMarks.length, 0);
  } finally {
    effects.dispose();
  }
});

test('a continuing static contact keeps its mark visible until contact ends, then fades without growing the pool', () => {
  const { engine, state } = fixture(1, 'super-heavy');
  state.throttle = 0;
  const effects = new RocketEffects(engine, state),
    contact = buildingContact();
  try {
    for (let i = 0; i < 150; i++) {
      effects.receiveCollision(contact, state, 1 / 60);
      effects.update(1 / 60, state);
    }
    assert.equal(
      effects.contactMesh.count,
      1,
      'a 2.5-second continuous scrape does not lose its actual-contact cue',
    );
    assert.equal(effects.contactMarks.length, 1);
    assert(
      effects.contactMesh.geometry.getAttribute('aContactOpacity').getX(0) >
        0.95,
    );
    effects.update(1.8, state);
    assert.equal(
      effects.contactMesh.count,
      0,
      'fade begins only after actual contact stops',
    );
    effects.reset();
    assert.equal(effects.contactMarks.length, 0);
  } finally {
    effects.dispose();
  }
});

test('real contact chips start wholly outside walls, roofs and undersides and fly outward while retaining tangent variation', () => {
  for (const direction of [
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
  ]) {
    const { engine, state } = fixture(1, 'super-heavy');
    state.throttle = 0;
    const effects = new RocketEffects(engine, state),
      normal = new THREE.Vector3(direction.x, direction.y, direction.z),
      point = new THREE.Vector3(
        3,
        direction.y > 0 ? 10 : direction.y < 0 ? 0 : 5,
        1,
      ),
      contact = {
        ...buildingContact(),
        point: { x: point.x, y: point.y, z: point.z },
        normal: direction,
        normalSpeed: 0.6,
        force: 1000000,
        impactEnergy: 0,
      };
    try {
      // Capture exactly the pressure emitter's velocities to verify only the
      // normal component changes in the actual contact burst.
      const emitted = [],
        emit = effects.emitBuildingFragments.bind(effects);
      effects.emitBuildingFragments = (...args) => {
        const first = effects.fragments.length;
        emit(...args);
        emitted.push(
          ...effects.fragments
            .slice(first)
            .map((fragment) => fragment.v.clone()),
        );
      };
      effects.receiveCollision(contact, state, 1 / 60);
      assert.equal(effects.fragments.length, 8);
      assert.equal(effects.rubble.instanceMatrix.count, 96);
      for (let i = 0; i < effects.fragments.length; i++) {
        const fragment = effects.fragments[i],
          outwardPosition = fragment.p.clone().sub(point).dot(normal),
          normalSpeed = fragment.v.dot(normal),
          originalTangent = emitted[i]
            .clone()
            .addScaledVector(normal, -emitted[i].dot(normal)),
          actualTangent = fragment.v
            .clone()
            .addScaledVector(normal, -normalSpeed);
        assert(
          outwardPosition >= fragment.size.length() * 0.5 + 0.099,
          'the complete rotating chip begins outside the actual contact plane',
        );
        assert(
          normalSpeed >= 4 - 1e-9,
          'even a west-side collision emits chips westward instead of into the building centre',
        );
        assert(
          actualTangent.distanceTo(originalTangent) < 1e-9,
          'existing tangent speed and variation are preserved',
        );
      }
      assert(
        new Set(
          effects.fragments.map((fragment) => fragment.v.toArray().join(',')),
        ).size > 1,
      );
      assert.equal(state.fireIntensity, 0);
    } finally {
      effects.dispose();
    }
  }
});

function collisionSurfaceFixture() {
  const result = fixture(0, 'super-heavy'),
    { engine, state } = result;
  state.throttle = 0;
  state.elapsed = 1;
  engine.landmarks = new THREE.Group();
  engine.scene.add(engine.landmarks);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 10, 2).translate(5, 5, 1),
    new THREE.MeshStandardMaterial(),
  );
  engine.landmarks.add(mesh);
  const source = collisionTriangles(mesh),
    effects = new RocketEffects(engine, state);
  effects.receiveCollision(
    { ...buildingContact('landmark'), normal: { x: -1, y: 0, z: 0 } },
    state,
    1 / 60,
  );
  effects.update(1 / 60, state);
  effects.beforeRender();
  effects.afterRender();
  return { ...result, mesh, source, effects };
}

test('mission collision surfaces share actual landmark render deformation and preserve immutable source triangles', () => {
  const { mesh, source, effects, state } = collisionSurfaceFixture(),
    sourceCopy = new Float32Array(source),
    geometry = mesh.geometry,
    material = mesh.material;
  try {
    const surface = effects.collisionSurface(mesh, source);
    assert(surface);
    assert.notEqual(surface.triangles, source);
    assert.equal(
      effects.collisionSurfaces.get(mesh).source,
      source,
      'the immutable input is referenced, never copied',
    );
    effects.beforeRender();
    const rendered = collisionTriangles(mesh);
    assert.equal(rendered.length, surface.triangles.length);
    for (let i = 0; i < rendered.length; i++)
      assert(Math.abs(rendered[i] - surface.triangles[i]) < 1e-5);
    effects.afterRender();
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.deepEqual(source, sourceCopy);
    const proxy = { localBox: true },
      obb = effects.collisionSurface(proxy, source);
    assert(
      obb,
      'a mission-only OBB owner can reuse the same rendered world field without a GPU proxy',
    );
    assert.deepEqual(obb.triangles, surface.triangles);
    assert(
      hitTriangles(
        obb.triangles,
        new THREE.Vector3(5, 5, 1),
        new THREE.Vector3(5, 5, 1),
        4,
        true,
      ),
    );
    effects.reset();
    assert.deepEqual(effects.collisionCacheStats, {
      meshes: 0,
      vertices: 0,
      outputBytes: 0,
      areaReferences: 0,
    });
    assert.equal(effects.collisionSurface(mesh, source), null);
    assert.deepEqual(source, sourceCopy);
    assert.equal(state.fireIntensity, 0);
  } finally {
    effects.dispose();
  }
});

test('collision surface history preserves moving roof velocity across repeated queries and reports zero motion on static rubble', () => {
  const { mesh, source, effects, state } = collisionSurfaceFixture();
  try {
    const first = effects.collisionSurface(mesh, source),
      firstBuffer = first.triangles,
      firstValues = new Float32Array(firstBuffer);
    assert.equal(first.previousTriangles, first.triangles);
    assert.equal(first.deltaTime, 0);
    const firstRevision = first.revision;
    assert.equal(
      effects.collisionSurface(mesh, source).revision,
      firstRevision,
    );
    for (let i = 0; i < 8; i++) {
      state.elapsed += 0.1;
      effects.update(0.1, state);
    }
    const moving = effects.collisionSurface(mesh, source),
      movingBuffer = moving.triangles;
    assert.notEqual(movingBuffer, firstBuffer);
    assert.equal(moving.previousTriangles, firstBuffer);
    assert.deepEqual(moving.previousTriangles, firstValues);
    assert(Math.abs(moving.deltaTime - 0.8) < 1e-9);
    const revision = moving.revision,
      previous = moving.previousTriangles;
    for (let i = 0; i < 5; i++) {
      const repeat = effects.collisionSurface(mesh, source);
      assert.equal(repeat.triangles, movingBuffer);
      assert.equal(repeat.previousTriangles, previous);
      assert.equal(repeat.revision, revision);
      assert(Math.abs(repeat.deltaTime - 0.8) < 1e-9);
    }
    let roofVertex = 1;
    for (let i = 1; i < source.length; i += 3)
      if (source[i] > source[roofVertex]) roofVertex = i;
    assert(
      (moving.triangles[roofVertex] - moving.previousTriangles[roofVertex]) /
        moving.deltaTime <
        -0.01,
      'a real settling roof has downward surface velocity against a stationary rocket',
    );
    // Physics queries advancing the rocket clock are not new visible FX samples.
    state.elapsed += 0.1;
    const sameField = effects.collisionSurface(mesh, source);
    assert.equal(sameField.previousTriangles, previous);
    assert(Math.abs(sameField.deltaTime - 0.8) < 1e-9);
    assert.equal(sameField.revision, revision);
    state.elapsed += 0.1;
    effects.update(0.1, state);
    const next = effects.collisionSurface(mesh, source);
    assert.equal(
      next.triangles,
      firstBuffer,
      'the two existing output buffers alternate instead of allocating each tick',
    );
    assert.equal(next.previousTriangles, movingBuffer);
    // A settled structure sampled by the actual FX clock has zero surface speed.
    const damage = effects.contactParts[0];
    damage.exposure = 1;
    damage.collapseElapsed = 3;
    state.elapsed += 0.1;
    effects.update(0.1, state);
    effects.collisionSurface(mesh, source);
    state.elapsed += 0.1;
    effects.update(0.1, state);
    const stationary = effects.collisionSurface(mesh, source);
    assert.equal(stationary.previousTriangles, stationary.triangles);
    assert.equal(stationary.deltaTime, 0);
  } finally {
    effects.dispose();
  }
});

test('whole-frame roof velocity and relative impact energy are independent of fixed-step query and sliding-contact cadence', () => {
  const results = [];
  for (const queries of [1, 6]) {
    const { mesh, source, effects, state } = collisionSurfaceFixture();
    try {
      const damage = effects.contactParts[0];
      damage.exposure = 1;
      damage.collapseElapsed = 1;
      effects.update(0, state);
      effects.beforeRender();
      effects.afterRender();
      const initial = effects.collisionSurface(mesh, source);
      assert.equal(initial.deltaTime, 0);
      let sample = state;
      for (let i = 0; i < queries; i++) {
        sample = {
          ...state,
          elapsed: state.elapsed + ((i + 1) * 0.1) / queries,
        };
        effects.receiveCollision(
          {
            ...buildingContact('landmark'),
            normal: { x: -1, y: 0, z: 0 },
            point: { x: 3, y: 5, z: 1 + ((i + 1) * 0.15) / queries },
          },
          sample,
          0,
        );
        const between = effects.collisionSurface(mesh, source);
        assert.equal(
          between.deltaTime,
          0,
          'local edits cannot invent a new render-sample interval or kick the vehicle',
        );
      }
      effects.update(0.1, sample);
      const current = effects.collisionSurface(mesh, source);
      assert(Math.abs(current.deltaTime - 0.1) < 1e-9);
      let roof = 1;
      for (let i = 1; i < source.length; i += 3)
        if (source[i] > source[roof]) roof = i;
      const displacement =
          current.triangles[roof] - current.previousTriangles[roof],
        velocity = displacement / current.deltaTime,
        metrics = sampleRocketContact(
          { ...sample, velocity: { x: 0, y: 0, z: 0 } },
          {
            point: { x: 5, y: 10, z: 1 },
            normal: { x: 0, y: -1, z: 0 },
            penetration: 0.1,
            obstacleMass: 1000000000,
            yieldProgress: 0,
            surfaceVelocity: { x: 0, y: velocity, z: 0 },
          },
        );
      assert(
        velocity < -0.1 && metrics.impactEnergy > 0,
        'a genuinely falling roof still carries normal impact energy',
      );
      results.push({ displacement, velocity, energy: metrics.impactEnergy });
      const revision = current.revision,
        previous = current.previousTriangles;
      effects.collisionSurface(mesh, source);
      assert.equal(current.revision, revision);
      assert.equal(current.previousTriangles, previous);
    } finally {
      effects.dispose();
    }
  }
  assert(Math.abs(results[0].displacement - results[1].displacement) < 1e-6);
  assert(Math.abs(results[0].velocity - results[1].velocity) < 1e-6);
  assert(
    Math.abs(results[0].energy - results[1].energy) < 1e-3,
    'six fixed-step contacts cannot multiply roof impact energy by 36',
  );
});

test('collision caches strictly bound 32 owners, 240000 triangle vertices and 5.76 MB of two-buffer output', () => {
  const first = collisionSurfaceFixture();
  try {
    for (let i = 0; i < 32; i++)
      assert(first.effects.collisionSurface({ slot: i }, first.source));
    assert.equal(
      first.effects.collisionSurface({ slot: 32 }, first.source),
      null,
    );
    assert.deepEqual(first.effects.collisionCacheStats, {
      meshes: 32,
      vertices: 32 * 36,
      outputBytes: 32 * 36 * 24,
      areaReferences: 32 * 36,
    });
  } finally {
    first.effects.dispose();
  }
  const second = collisionSurfaceFixture(),
    large = new Float32Array(120000 * 3);
  for (let i = 0; i < large.length; i += second.source.length)
    large.set(
      second.source.subarray(
        0,
        Math.min(second.source.length, large.length - i),
      ),
      i,
    );
  try {
    assert(second.effects.collisionSurface({ slot: 0 }, large));
    assert(second.effects.collisionSurface({ slot: 1 }, large));
    assert.equal(
      second.effects.collisionSurface({ slot: 2 }, second.source),
      null,
    );
    assert.deepEqual(second.effects.collisionCacheStats, {
      meshes: 2,
      vertices: 240000,
      outputBytes: 5760000,
      areaReferences: 240000,
    });
    second.effects.reset();
    assert.equal(second.effects.collisionCacheStats.outputBytes, 0);
  } finally {
    second.effects.dispose();
  }
});

test('all twelve small visible material pages receive real collision deformation without exhausting the unchanged vertex budget', () => {
  const { engine, mesh, effects } = collisionSurfaceFixture(),
    pages = [mesh];
  for (let i = 1; i < 12; i++) {
    const page = new THREE.Mesh(
      mesh.geometry.clone(),
      new THREE.MeshStandardMaterial({ color: 0x667788 + i }),
    );
    page.name = `Landmark material page ${i}`;
    engine.landmarks.add(page);
    pages.push(page);
  }
  try {
    effects.beforeRender();
    effects.afterRender();
    for (const page of pages) {
      const source = collisionTriangles(page),
        surface = effects.collisionSurface(page, source);
      assert(
        surface,
        `${page.name || 'first material page'} must not fall back to an old surface when memory remains available`,
      );
      assert.notDeepEqual(surface.triangles, source);
      effects.beforeRender();
      const rendered = collisionTriangles(page);
      effects.afterRender();
      for (let i = 0; i < rendered.length; i++)
        assert(Math.abs(surface.triangles[i] - rendered[i]) < 1e-5);
    }
    assert.deepEqual(effects.collisionCacheStats, {
      meshes: 12,
      vertices: 12 * 36,
      outputBytes: 12 * 36 * 24,
      areaReferences: 12 * 36,
    });
    assert(effects.collisionCacheStats.vertices < 240000);
    assert(effects.collisionCacheStats.outputBytes < 5760000);
    effects.reset();
    assert.equal(effects.collisionCacheStats.meshes, 0);
  } finally {
    effects.dispose();
  }
});

test('unmanaged, unchanged or distant surfaces retain conservative source collisions without consuming the deformation cache', () => {
  const { engine, state } = fixture(0, 'super-heavy');
  state.throttle = 0;
  engine.landmarks = new THREE.Group();
  engine.scene.add(engine.landmarks);
  const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 10, 2).translate(5, 5, 1),
      new THREE.MeshStandardMaterial(),
    ),
    source = collisionTriangles(mesh),
    effects = new RocketEffects(engine, state);
  try {
    assert.equal(effects.collisionSurface(mesh, source), null);
    effects.receiveCollision(
      { ...buildingContact('landmark'), normal: { x: -1, y: 0, z: 0 } },
      state,
      1 / 60,
    );
    assert.equal(
      effects.collisionSurface(mesh, source),
      null,
      'a synthetic counter alone cannot shorten an unmanaged actual mesh',
    );
    assert.equal(effects.collisionCacheStats.meshes, 0);
    engine.landmarks.add(mesh);
    effects.beforeRender();
    effects.afterRender();
    assert(effects.collisionSurface(mesh, source));
    const far = source.map((v, i) => (i % 3 === 0 ? v + 1000 : v));
    assert.equal(effects.collisionSurface({}, far), null);
    const saved = effects.collisionCacheStats;
    const replacement = source.slice();
    assert(effects.collisionSurface(mesh, replacement));
    assert.deepEqual(
      effects.collisionCacheStats,
      saved,
      'replacing a caller source releases its old two-buffer reservation',
    );
    mesh.removeFromParent();
    effects.beforeRender();
    effects.afterRender();
    assert.equal(effects.collisionSurface(mesh, replacement), null);
    assert.equal(effects.collisionCacheStats.meshes, 0);
  } finally {
    effects.dispose();
  }
});

test('a changed contact normal invalidates both render and collision fields even after exposure is saturated', () => {
  const { mesh, source, effects, state } = collisionSurfaceFixture();
  try {
    const damage = effects.contactParts[0];
    damage.exposure = 1;
    damage.collapse = 0.8;
    effects.beforeRender();
    effects.afterRender();
    effects.collisionSurface(mesh, source);
    state.elapsed += 0.1;
    effects.receiveCollision(
      { ...buildingContact('landmark'), normal: { x: 0, y: 0, z: -1 } },
      state,
      0,
    );
    const current = effects.collisionSurface(mesh, source);
    effects.beforeRender();
    const rendered = collisionTriangles(mesh);
    effects.afterRender();
    for (let i = 0; i < rendered.length; i++)
      assert(Math.abs(rendered[i] - current.triangles[i]) < 1e-5);
  } finally {
    effects.dispose();
  }
});
