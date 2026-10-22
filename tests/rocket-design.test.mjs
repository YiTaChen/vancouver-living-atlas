import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createRocket, crashRocket, rocketDirection, ROCKET_CONFIGS } =
  await import(cityModule('rocket-state'));
const { createRocketModel, disposeRocketObject } = await import(
  cityModule('assets/rocket')
);
const kinds = Object.keys(ROCKET_CONFIGS);
function meshes(root, predicate = () => true) {
  const result = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.castShadow && predicate(object))
      result.push(object);
  });
  return result;
}
function named(model, name) {
  return meshes(model.group, (mesh) => mesh.name === name);
}
function vertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3()
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld),
  );
}
function assertSameVertices(before, after, label) {
  assert.equal(after.length, before.length);
  for (let i = 0; i < after.length; i++)
    assert(after[i].distanceTo(before[i]) < 1e-8, `${label} vertex ${i} moved`);
}
function structural(model) {
  return model.segments.flatMap((segment) => meshes(segment));
}
function pointModel(model, state) {
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
}
function ancestor(object, parent) {
  for (let current = object; current; current = current.parent)
    if (current === parent) return true;
  return false;
}

test('Scout, Atlas and Titan contain different structural designs rather than resized copies', () => {
  const models = Object.fromEntries(
    kinds.map((kind) => {
      const model = createRocketModel(kind);
      model.build(1);
      return [kind, model];
    }),
  );
  try {
    assert.equal(named(models.small, 'Scout swept stabilizer').length, 4);
    assert.equal(named(models.small, 'Scout main engine 1').length, 1);
    assert.equal(
      structural(models.small).filter((mesh) =>
        mesh.name.includes('main engine'),
      ).length,
      1,
    );
    assert.equal(named(models.large, 'Atlas side booster').length, 2);
    assert.equal(named(models.large, 'Atlas booster nose').length, 2);
    assert.equal(named(models.large, 'Atlas booster nozzle').length, 2);
    assert.equal(
      structural(models.large).filter((mesh) =>
        mesh.name.startsWith('Atlas main engine '),
      ).length,
      7,
    );
    const atlasRadius = ROCKET_CONFIGS.large.radius;
    for (const segment of models.large.segments.slice(0, 3)) {
      const core = meshes(segment).find(
        (mesh) =>
          mesh.geometry.type === 'CylinderGeometry' &&
          mesh.geometry.parameters.radiusTop === atlasRadius,
      );
      assert(
        core && core.material.color.getHex() === 0xe98236,
        'Atlas has an actual orange core',
      );
    }
    assert(
      meshes(models.large.segments[5]).some(
        (mesh) =>
          mesh.geometry.type === 'CylinderGeometry' &&
          mesh.geometry.parameters.radiusTop > atlasRadius * 1.15,
      ),
      'Atlas has a physically flared fairing',
    );
    assert.equal(named(models['super-heavy'], 'Titan ogive nose').length, 1);
    assert.equal(
      named(models['super-heavy'], 'Titan nose heat shield').length,
      1,
    );
    assert.equal(named(models['super-heavy'], 'Titan heat shield').length, 2);
    assert.equal(
      named(models['super-heavy'], 'Titan aft control flap').length,
      2,
    );
    assert.equal(
      named(models['super-heavy'], 'Titan forward control flap').length,
      2,
    );
    const grid = named(models['super-heavy'], 'Titan lattice grid fins');
    assert.equal(grid.length, 1);
    assert(
      grid[0].geometry.getAttribute('position').count >= 4 * 8 * 36,
      'the merged fins contain real lattice ribs',
    );
    assert.equal(
      structural(models['super-heavy']).filter((mesh) =>
        mesh.name.startsWith('Titan main engine '),
      ).length,
      19,
    );

    // Normalize both height and core width so changing those two dimensions
    // alone cannot make otherwise identical geometry pass this silhouette test.
    const profiles = kinds.map((kind) => {
      const config = ROCKET_CONFIGS[kind],
        profile = Array(24).fill(0);
      for (const mesh of structural(models[kind]))
        for (const point of vertices(mesh)) {
          const bin = Math.max(
            0,
            Math.min(11, Math.floor((point.y / config.height) * 12)),
          );
          profile[bin * 2] = Math.max(
            profile[bin * 2],
            Math.abs(point.x) / config.radius,
          );
          profile[bin * 2 + 1] = Math.max(
            profile[bin * 2 + 1],
            Math.abs(point.z) / config.radius,
          );
        }
      return profile;
    });
    for (let a = 0; a < kinds.length; a++)
      for (let b = a + 1; b < kinds.length; b++)
        assert(
          Math.hypot(...profiles[a].map((value, i) => value - profiles[b][i])) >
            0.5,
          `${kinds[a]} and ${kinds[b]} must differ in normalized shape`,
        );
  } finally {
    Object.values(models).forEach((model) => disposeRocketObject(model.group));
  }
});

test('every authored structural vertex stays inside its attached and surviving-stage footprint', () => {
  for (const kind of kinds) {
    const model = createRocketModel(kind),
      config = ROCKET_CONFIGS[kind];
    model.build(1);
    try {
      let maximum = 0;
      for (const [i, segment] of model.segments.entries())
        for (const mesh of meshes(segment))
          for (const point of vertices(mesh)) {
            const radius = Math.hypot(point.x, point.z);
            maximum = Math.max(maximum, radius);
            assert(
              radius <= config.footprintRadius + 1e-5,
              `${kind} ${mesh.name || mesh.geometry.type} exceeds launch footprint`,
            );
            if (i >= 3)
              assert(
                radius <= config.upperFootprintRadius + 1e-5,
                `${kind} ${mesh.name || mesh.geometry.type} exceeds upper-stage footprint`,
              );
            assert(
              point.y >= -1e-5 && point.y <= config.height + 1e-5,
              `${kind} structural geometry is outside its authored height`,
            );
          }
      assert(
        maximum > config.radius * 1.5,
        'fins or boosters change the real silhouette',
      );
    } finally {
      disposeRocketObject(model.group);
    }
  }
});

test('real fins, side boosters and Titan appendages stay on their intended stage through separation', () => {
  for (const kind of kinds) {
    const model = createRocketModel(kind),
      state = createRocket(kind, 80, 2000, -30);
    model.build(1);
    state.attitude = { pitch: 0.13, roll: -0.17 };
    pointModel(model, state);
    const structure = structural(model),
      before = structure.map(vertices);
    const lowerNames = {
      small: ['Scout swept stabilizer'],
      large: ['Atlas side booster', 'Atlas booster nose'],
      'super-heavy': ['Titan lattice grid fins'],
    }[kind];
    const lower = structure.filter((mesh) => lowerNames.includes(mesh.name));
    assert(
      lower.length > 0 && lower.every((mesh) => ancestor(mesh, model.booster)),
    );
    const upper = structure.filter((mesh) =>
      /Titan (aft|forward) control flap/.test(mesh.name),
    );
    assert(upper.every((mesh) => ancestor(mesh, model.upper)));
    state.boosterAttached = false;
    state.stage = 'separating';
    state.elapsed = 40;
    state.separation = {
      time: 40,
      flightTime: 24,
      position: { ...state.position },
      velocity: { x: 30, y: 1200, z: -5 },
      attitude: { ...state.attitude },
    };
    model.stage(state);
    structure.forEach((mesh, i) =>
      assertSameVertices(before[i], vertices(mesh), `${kind} separation`),
    );
    const upperBefore = upper.map(vertices),
      origin = state.position.y;
    state.elapsed += 2;
    state.position.y += 2600;
    pointModel(model, state);
    model.stage(state);
    assert(lower.every((mesh) => ancestor(mesh, model.booster)));
    assert(model.booster.position.length() > 100);
    assert(model.booster.quaternion.angleTo(new THREE.Quaternion()) > 0.1);
    upper.forEach((mesh, i) => {
      assert(ancestor(mesh, model.upper));
      assertSameVertices(
        upperBefore[i].map((point) =>
          point.clone().add(new THREE.Vector3(0, state.position.y - origin, 0)),
        ),
        vertices(mesh),
        `${kind} retained flap`,
      );
    });
    assert.equal(
      model.upper.getObjectByName('Upper-stage vacuum engine').visible,
      true,
    );
    assert(model.collisionSegments.some((probe) => probe.booster));
    if (kind === 'super-heavy')
      assert(model.collisionSegments.some((probe) => !probe.booster));
    disposeRocketObject(model.group);
  }
});

test('all three designs reuse six real wreckage sections without first-frame teleportation and dispose only owned resources', () => {
  for (const kind of kinds) {
    const model = createRocketModel(kind),
      scene = new THREE.Scene();
    let state = createRocket(kind, 320, 70, -240);
    state.attitude = { pitch: 0.37, roll: -0.29 };
    state.velocity = { x: 18, y: -25, z: -8 };
    state.elapsed = 50;
    state = crashRocket(state);
    model.build(1);
    pointModel(model, state);
    scene.add(model.group);
    const structure = structural(model),
      before = structure.map(vertices);
    const cityGeometry = new THREE.BoxGeometry(),
      cityMaterial = new THREE.MeshBasicMaterial();
    const city = new THREE.Mesh(cityGeometry, cityMaterial);
    scene.add(city);
    let cityDisposals = 0;
    cityGeometry.addEventListener('dispose', () => cityDisposals++);
    cityMaterial.addEventListener('dispose', () => cityDisposals++);
    model.damage(state, () => 0);
    const pieces = model.group.children.filter((object) =>
      object.name.startsWith('Ruptured rocket section '),
    );
    assert.equal(pieces.length, 6);
    structure.forEach((mesh, i) =>
      assertSameVertices(before[i], vertices(mesh), `${kind} breakup`),
    );
    model.segments.forEach((segment, i) =>
      assert.equal(segment.parent, pieces[i]),
    );
    state.wreckage.exploded = true;
    state.wreckage.explosionTime = state.elapsed;
    model.damage(state, () => 0);
    const counts = new Map();
    model.group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        counts.set(object.geometry, 0);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          counts.set(material, 0);
      }
    });
    for (const resource of counts.keys())
      resource.addEventListener('dispose', () =>
        counts.set(resource, counts.get(resource) + 1),
      );
    disposeRocketObject(model.group);
    assert([...counts.values()].every((count) => count === 1));
    assert.equal(model.group.parent, null);
    assert.equal(city.parent, scene);
    assert.equal(cityDisposals, 0);
    cityGeometry.dispose();
    cityMaterial.dispose();
  }
});
