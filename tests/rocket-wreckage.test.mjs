import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createRocket, rocketDirection } = await import(
  cityModule('rocket-state')
);
const { createRocketModel, disposeRocketObject } = await import(
  cityModule('assets/rocket')
);

function fixture(kind = 'large', cause = 'impact') {
  const state = createRocket(kind, 120, 60, -80);
  state.phase = 'crashed';
  state.elapsed = 10;
  state.attitude = { pitch: 0.37, roll: -0.29 };
  state.wreckage = {
    time: 10,
    position: { ...state.position },
    velocity: { x: 18, y: -25, z: -8 },
    attitude: { ...state.attitude },
    angularVelocity: { pitch: 0.2, roll: -0.3 },
    cause,
    exploded: false,
    explosionDelay: null,
    explosionTime: null,
  };
  const model = createRocketModel(kind);
  model.build(1);
  const direction = rocketDirection(state.attitude);
  model.group.position.set(
    state.position.x,
    state.position.y,
    state.position.z,
  );
  model.group.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(direction.x, direction.y, direction.z),
  );
  model.group.updateMatrixWorld(true);
  return { model, state };
}
function pieces(model) {
  return model.group.children.filter((object) =>
    object.name.startsWith('Ruptured rocket section '),
  );
}
function structuralMeshes(model) {
  const meshes = [];
  for (const segment of model.segments)
    segment.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow)
        meshes.push(object);
    });
  return meshes;
}
function vertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position'),
    result = [];
  for (let i = 0; i < position.count; i++)
    result.push(
      new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld),
    );
  return result;
}
function step(model, state, seconds, surface = () => 0) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    state.elapsed += 1 / 60;
    model.damage(state, surface);
  }
  model.group.updateMatrixWorld(true);
}
function worldPosition(piece) {
  return piece.getWorldPosition(new THREE.Vector3());
}

test('rupture preserves every original section vertex world pose on its first frame for both vehicle sizes', () => {
  for (const kind of ['small', 'large']) {
    const { model, state } = fixture(kind),
      meshes = structuralMeshes(model),
      before = meshes.map(vertices);
    const center = model.damage(state, () => 0);
    assert(center?.toArray().every(Number.isFinite));
    assert.equal(pieces(model).length, 6);
    for (let i = 0; i < meshes.length; i++) {
      const after = vertices(meshes[i]);
      assert.equal(after.length, before[i].length);
      for (let j = 0; j < after.length; j++)
        assert(
          after[j].distanceTo(before[i][j]) < 1e-8,
          `${kind} mesh ${i} vertex ${j} teleported`,
        );
    }
    model.segments.forEach((segment, i) =>
      assert.equal(
        segment.parent,
        pieces(model)[i],
        'actual section mesh must be reused',
      ),
    );
    disposeRocketObject(model.group);
  }
});

test('six real shell sections separate, fall under gravity and settle above the terrain surface', () => {
  for (const kind of ['small', 'large'])
    for (const slope of [0, 0.035]) {
      const { model, state } = fixture(kind),
        meshes = structuralMeshes(model),
        terrain = (x, z) => 5 + (x - 120) * slope + (z + 80) * slope * 0.6;
      model.damage(state, terrain);
      const initial = pieces(model).map(worldPosition);
      step(model, state, 1, terrain);
      const falling = pieces(model).map(worldPosition);
      assert(
        falling.every((position, i) => position.y < initial[i].y),
        'each section falls rather than remaining a floating replacement model',
      );
      const initialGap = initial[0].distanceTo(initial[5]),
        newGap = falling[0].distanceTo(falling[5]);
      assert(
        Math.abs(newGap - initialGap) > 0.1,
        'sections acquire independent trajectories',
      );
      step(model, state, 16, terrain);
      for (const mesh of meshes)
        for (const point of vertices(mesh))
          assert(
            point.y >= terrain(point.x, point.z) - 0.05,
            `${kind} structural shell penetrated terrain at y=${point.y}, surface=${terrain(point.x, point.z)}`,
          );
      const settled = pieces(model).map(worldPosition);
      step(model, state, 2, terrain);
      assert(
        pieces(model).every(
          (piece, i) => worldPosition(piece).distanceTo(settled[i]) < 0.1,
        ),
        'debris settles without endless bouncing',
      );
      disposeRocketObject(model.group);
    }
});

test('an airborne fire breakup carries the incoming flight momentum instead of resetting into an impact bounce', () => {
  const { model, state } = fixture('large', 'fire');
  state.position.y = 1800;
  state.wreckage.position.y = 1800;
  state.wreckage.velocity = { x: 160, y: 310, z: -90 };
  model.group.position.y = 1800;
  const before = model.damage(state, () => 0).clone();
  step(model, state, 0.1);
  const after = model.damage(state, () => 0).clone(),
    velocity = after.sub(before).multiplyScalar(10),
    incoming = new THREE.Vector3(160, 310, -90);
  assert(velocity.dot(incoming.clone().normalize()) > incoming.length() * 0.95);
  assert(velocity.y > 290 && velocity.x > 150 && velocity.z < -80);
  disposeRocketObject(model.group);
});

test('fuel explosion adds one delayed breakup impulse while pre-explosion geometry follows the same trajectory', () => {
  const baseline = fixture('large', 'fire'),
    exploded = fixture('large', 'fire');
  for (const value of [baseline, exploded]) {
    value.state.wreckage.velocity = { x: 15, y: 20, z: -5 };
    value.model.damage(value.state, () => 0);
    step(value.model, value.state, 0.5);
  }
  for (let i = 0; i < 6; i++)
    assert(
      worldPosition(pieces(baseline.model)[i]).distanceTo(
        worldPosition(pieces(exploded.model)[i]),
      ) < 1e-9,
      'no fuel burst before explosionTime',
    );
  exploded.state.wreckage.exploded = true;
  exploded.state.wreckage.explosionTime = exploded.state.elapsed;
  const p0 = worldPosition(pieces(exploded.model)[0]);
  step(exploded.model, exploded.state, 1 / 60);
  const p1 = worldPosition(pieces(exploded.model)[0]);
  step(exploded.model, exploded.state, 1 / 60);
  const p2 = worldPosition(pieces(exploded.model)[0]);
  const v1 = p1.clone().sub(p0).multiplyScalar(60),
    v2 = p2.clone().sub(p1).multiplyScalar(60);
  assert(
    Math.abs(v2.x - v1.x) < 1e-8 && Math.abs(v2.z - v1.z) < 1e-8,
    'persistent explosion state does not replay the horizontal kick',
  );
  assert(
    Math.abs(v2.y - v1.y + 9.81 / 60) < 1e-8,
    'only gravity changes vertical speed after the single kick',
  );
  step(baseline.model, baseline.state, 2 / 60);
  assert(
    worldPosition(pieces(exploded.model)[0]).distanceTo(
      worldPosition(pieces(baseline.model)[0]),
    ) > 0.2,
  );
  disposeRocketObject(baseline.model.group);
  disposeRocketObject(exploded.model.group);
});

test('a previously detached booster keeps its own meshes and only three upper sections become wreckage', () => {
  const { model, state } = fixture('small', 'fire');
  state.boosterAttached = false;
  state.fireIntensity = 0.7;
  state.stage = 'upper';
  state.separation = {
    time: 7,
    flightTime: 5,
    position: { x: 100, y: 20, z: -70 },
    velocity: { x: 5, y: 15, z: -2 },
    attitude: { pitch: 0, roll: 0 },
  };
  model.stage(state);
  const oldBooster = model.segments.slice(0, 3);
  model.group.updateMatrixWorld(true);
  const originalVertices = oldBooster.map((segment) => {
    const all = [];
    segment.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow)
        all.push(...vertices(object));
    });
    return all;
  });
  model.damage(state, () => 0);
  assert.equal(pieces(model).length, 3);
  assert.deepEqual(
    pieces(model).map((piece) => piece.name),
    [
      'Ruptured rocket section 4',
      'Ruptured rocket section 5',
      'Ruptured rocket section 6',
    ],
  );
  oldBooster.forEach((segment, i) => {
    assert.equal(segment.parent, model.booster);
    const after = [];
    segment.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow)
        after.push(...vertices(object));
    });
    assert(
      after.every(
        (point, j) => point.distanceTo(originalVertices[i][j]) < 1e-8,
      ),
      'spent booster is not teleported back into upper-stage wreckage',
    );
  });
  const engine = model.group.getObjectByName('Upper-stage vacuum engine');
  assert.equal(engine.parent, model.segments[3]);
  assert.equal(engine.visible, true);
  oldBooster.forEach((segment) =>
    assert.equal(
      segment.getObjectByName('Attached onboard fire').visible,
      false,
    ),
  );
  disposeRocketObject(model.group);
});

test('attached body fire follows true sections at space scale and the local explosion flash appears only during its bounded lifetime', () => {
  const { model, state } = fixture('large', 'fire'),
    snapshot = state.wreckage;
  state.wreckage = null;
  state.fireIntensity = 0.8;
  state.fireDamage = 0.3;
  model.group.position.set(0, 0, 0);
  model.group.scale.setScalar(1e-5);
  model.damage(state, () => 0);
  model.group.updateMatrixWorld(true);
  const flames = model.segments.map((segment) =>
      segment.getObjectByName('Attached onboard fire'),
    ),
    flash = model.group.getObjectByName('Rocket propellant explosion flash'),
    positions = flames.map(worldPosition);
  assert(flames.every((flame) => flame.visible && flame.material.opacity > 0));
  assert.equal(
    new Set(flames.map((flame) => flame.material)).size,
    1,
    'the six flames share one owned material',
  );
  assert.equal(flash.visible, false);
  for (const flame of flames) {
    const size = new THREE.Box3()
      .setFromObject(flame)
      .getSize(new THREE.Vector3())
      .length();
    assert(
      size > 1e-6 && size < 0.001,
      'flame geometry uses the vehicle scale rather than a distant world-space glow',
    );
  }
  state.wreckage = snapshot;
  model.damage(state, () => 0);
  assert(
    flames.every(
      (flame, i) => worldPosition(flame).distanceTo(positions[i]) < 1e-10,
    ),
    'attached fire does not teleport when its real shell ruptures',
  );
  step(model, state, 0.2);
  assert(
    flames.every(
      (flame, i) =>
        flame.parent === model.segments[i] &&
        worldPosition(flame).distanceTo(positions[i]) > 1e-6,
    ),
  );
  assert.equal(
    flash.visible,
    false,
    'rupture alone does not show a propellant explosion',
  );
  state.wreckage.exploded = true;
  state.wreckage.explosionTime = state.elapsed;
  const center = model.damage(state, () => 0).clone();
  model.group.updateMatrixWorld(true);
  assert.equal(flash.visible, true);
  assert(flash.material.opacity > 0);
  const expected = center
    .sub(
      new THREE.Vector3(state.position.x, state.position.y, state.position.z),
    )
    .multiplyScalar(1e-5);
  assert(
    worldPosition(flash).distanceTo(expected) < 1e-10,
    'flash follows the physical fragment centroid through the floating origin',
  );
  const flashSize = new THREE.Box3()
    .setFromObject(flash)
    .getSize(new THREE.Vector3())
    .length();
  assert(flashSize > 1e-5 && flashSize < 0.01);
  step(model, state, 1.2);
  assert.equal(
    flash.visible,
    false,
    'propellant flash expires after 1.15 seconds',
  );
  disposeRocketObject(model.group);
});

test('disposing ruptured and exploded models releases each owned mesh resource once and preserves external city assets', () => {
  const { model, state } = fixture();
  const scene = new THREE.Scene();
  scene.add(model.group);
  const cityGeometry = new THREE.BoxGeometry(),
    cityMaterial = new THREE.MeshBasicMaterial(),
    city = new THREE.Mesh(cityGeometry, cityMaterial);
  scene.add(city);
  let cityDisposals = 0;
  cityGeometry.addEventListener('dispose', () => cityDisposals++);
  cityMaterial.addEventListener('dispose', () => cityDisposals++);
  model.damage(state, () => 0);
  state.wreckage.exploded = true;
  state.wreckage.explosionTime = state.elapsed;
  model.damage(state, () => 0);
  const resources = new Set();
  model.group.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        resources.add(material);
    }
  });
  const counts = new Map([...resources].map((resource) => [resource, 0]));
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      counts.set(resource, counts.get(resource) + 1),
    );
  disposeRocketObject(model.group);
  assert.equal(model.group.parent, null);
  assert.equal(city.parent, scene);
  assert.equal(cityDisposals, 0);
  assert(
    [...counts.values()].every((count) => count === 1),
    'shared section geometry/materials are disposed once even after reparenting',
  );
  cityGeometry.dispose();
  cityMaterial.dispose();
});
