import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { RocketEffects } = await import(cityModule('rocket-effects'));
const { createRocket, stepRocket, launchRocket } = await import(
  cityModule('rocket-state')
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
    assert.equal(effects.damaged, titan ? 96 : 48);
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
