import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createRocket,
  crashRocket,
  launchRocket,
  stepRocket,
  sampleRocketEffects,
  rocketDirection,
  ROCKET_CONFIGS,
} = await import(cityModule('rocket-state'));
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

test('Titan has four independent cardinal strap-ons with real engines, construction, bounded footprints and owned bright plumes', () => {
  const model = createRocketModel('super-heavy'),
    config = ROCKET_CONFIGS['super-heavy'];
  try {
    assert.equal(model.strapOns.length, 4);
    assert.equal(model.strapPlumes.length, 4);
    model.build(0);
    assert(model.strapOns.every((booster) => !booster.visible));
    model.build(0.35);
    assert(
      model.strapOns.every((booster) => booster.visible && booster.scale.y < 1),
    );
    model.build(1);
    model.strapOns.forEach((booster, i) => {
      assert.equal(booster.parent, model.group);
      assert(!model.segments.some((segment) => ancestor(booster, segment)));
      const angle = (i * Math.PI) / 2;
      assert(
        Math.abs(booster.position.x - Math.cos(angle) * config.radius * 1.7) <
          1e-8,
      );
      assert(
        Math.abs(booster.position.z - Math.sin(angle) * config.radius * 1.7) <
          1e-8,
      );
      assert.equal(booster.scale.y, 1);
      for (const name of [
        'Titan external booster tank',
        'Titan external booster nose',
        'Titan external booster engine bell',
        'Titan external booster feed line',
      ])
        assert(booster.getObjectByName(name), name);
      assert.equal(
        meshes(
          booster,
          (mesh) => mesh.name === 'Titan external booster mounting strut',
        ).length,
        2,
      );
      assert.equal(model.strapPlumes[i].parent, booster);
      assert(
        model.strapPlumes[i].getObjectByName(
          'Titan external exhaust bright core',
        ),
      );
      for (const mesh of meshes(booster))
        for (const point of vertices(mesh)) {
          assert(
            Math.hypot(point.x, point.z) <= config.footprintRadius + 1e-5,
            `${mesh.name} outside launch footprint`,
          );
          assert(point.y >= -1e-5 && point.y <= config.height + 1e-5);
        }
    });
    const probes = model.collisionSegments.filter((probe) => probe.strapOn);
    assert.equal(probes.length, 4);
    probes.forEach((probe, i) => {
      assert.equal(
        probe.booster,
        false,
        'strap removal is independent from central-core removal',
      );
      assert.equal(probe.from.x, model.strapOns[i].position.x);
      assert.equal(probe.from.z, model.strapOns[i].position.z);
      assert(
        Math.hypot(probe.from.x, probe.from.z) + probe.radius <
          config.footprintRadius,
      );
    });
    assert.equal(named(model, 'Titan control flap silver rim').length, 4);
    for (const kind of ['small', 'large']) {
      const other = createRocketModel(kind);
      assert.equal(other.strapOns.length, 0);
      assert.equal(other.strapPlumes.length, 0);
      disposeRocketObject(other.group);
    }
  } finally {
    disposeRocketObject(model.group);
  }
});

test('Titan production stages keep all five engines firing initially and central thrust lit throughout external-booster separation', () => {
  const model = createRocketModel('super-heavy');
  let state = createRocket('super-heavy', 0, 0, 0, {
    kind: 'platform',
    seed: 13,
  });
  state.phase = 'ready';
  state.buildProgress = 1;
  state = launchRocket(state);
  model.build(1);
  let combined = 0,
    separating = 0,
    coreOnly = 0,
    upper = false;
  try {
    for (let i = 0; i < 6000 && !upper; i++) {
      state = stepRocket(state, {}, 1 / 60);
      model.stage(state);
      model.fire(sampleRocketEffects(state).engine, state.elapsed);
      if (state.throttle > 0.2 && state.phase !== 'countdown') {
        if (state.stage === 'strap-on') {
          combined++;
          assert(model.flame.visible);
          assert(model.strapPlumes.every((plume) => plume.visible));
        } else if (state.stage === 'strap-separating') {
          separating++;
          assert(state.boosterAttached && !state.strapAttached);
          assert(
            model.flame.visible,
            'central engine never cuts during strap separation',
          );
          assert(model.strapPlumes.every((plume) => !plume.visible));
          const expected =
            state.throttle * (1 + 0.08 * Math.sin(state.elapsed * 53));
          assert(
            Math.abs(model.flame.scale.y - expected) < 1e-8,
            'main engine retains its own power instead of shrinking with total combined thrust',
          );
        } else if (state.stage === 'boost') {
          coreOnly++;
          assert(model.flame.visible);
          assert(model.strapPlumes.every((plume) => !plume.visible));
        } else if (state.stage === 'upper') {
          upper = true;
          assert(model.flame.visible);
          assert(
            model.upper.getObjectByName('Upper-stage vacuum engine').visible,
          );
          assert(!state.boosterAttached && !state.strapAttached);
        }
      }
    }
    assert(combined > 100 && separating > 10 && coreOnly > 100 && upper);
    assert(state.strapSeparation.time < state.separation.time);
    const events = state.events.map((event) => event.type);
    assert(
      events.indexOf('core-ignition') < events.indexOf('strap-on-separation'),
    );
  } finally {
    disposeRocketObject(model.group);
  }
});

test('four discarded Titan boosters preserve pose and momentum independently through core staging, space scale and later breakup', () => {
  const model = createRocketModel('super-heavy'),
    h = ROCKET_CONFIGS['super-heavy'].height;
  let state = createRocket('super-heavy', 100, 3500, -200);
  state.elapsed = 50;
  state.attitude = { pitch: 0.2, roll: -0.18 };
  state.velocity = { x: 80, y: 900, z: -30 };
  model.build(1);
  pointModel(model, state);
  model.stage(state);
  const structure = model.strapOns.flatMap((booster) => meshes(booster)),
    before = structure.map(vertices),
    centers = model.strapOns.map((booster) =>
      booster.localToWorld(new THREE.Vector3(0, h * 0.3, 0)),
    ),
    initialRotation = model.group.quaternion.clone();
  state.strapAttached = false;
  state.stage = 'strap-separating';
  state.strapSeparation = {
    time: state.elapsed,
    flightTime: 12,
    position: { ...state.position },
    velocity: { ...state.velocity },
    attitude: { ...state.attitude },
  };
  try {
    model.stage(state);
    structure.forEach((mesh, i) =>
      assertSameVertices(before[i], vertices(mesh), 'strap separation'),
    );
    function expectedCenter(index, time) {
      const outward = new THREE.Vector3(
        Math.cos((index * Math.PI) / 2),
        0,
        Math.sin((index * Math.PI) / 2),
      ).applyQuaternion(initialRotation);
      return centers[index]
        .clone()
        .addScaledVector(new THREE.Vector3(80, 900, -30), time)
        .addScaledVector(outward, 7 * time)
        .add(new THREE.Vector3(0, -4.905 * time * time, 0));
    }
    state.elapsed += 2;
    state.position = { x: 400, y: 6500, z: -500 };
    state.attitude = { pitch: -0.1, roll: 0.3 };
    pointModel(model, state);
    model.stage(state);
    model.strapOns.forEach((booster, i) => {
      assert.equal(booster.parent, model.group);
      assert(
        booster
          .localToWorld(new THREE.Vector3(0, h * 0.3, 0))
          .distanceTo(expectedCenter(i, 2)) < 1e-7,
      );
      assert(booster.quaternion.angleTo(new THREE.Quaternion()) > 0.1);
    });
    assert(
      model.booster.position.length() < 1e-8,
      'external separation does not release the central core',
    );
    model.group.position.set(0, 0, 0);
    model.group.scale.setScalar(1e-5);
    model.stage(state);
    model.strapOns.forEach((booster, i) => {
      const expected = expectedCenter(i, 2)
        .sub(
          new THREE.Vector3(
            state.position.x,
            state.position.y,
            state.position.z,
          ),
        )
        .multiplyScalar(1e-5);
      assert(
        booster
          .localToWorld(new THREE.Vector3(0, h * 0.3, 0))
          .distanceTo(expected) < 1e-10,
      );
    });
    model.group.scale.setScalar(1);
    pointModel(model, state);
    state.elapsed += 2;
    state.boosterAttached = false;
    state.stage = 'separating';
    state.separation = {
      time: state.elapsed,
      flightTime: 25,
      position: { ...state.position },
      velocity: { ...state.velocity },
      attitude: { ...state.attitude },
    };
    model.stage(state);
    model.strapOns.forEach((booster, i) =>
      assert(
        booster
          .localToWorld(new THREE.Vector3(0, h * 0.3, 0))
          .distanceTo(expectedCenter(i, 4)) < 1e-7,
      ),
    );
    state = crashRocket(state);
    model.damage(state, () => 0);
    assert.equal(
      model.group.children.filter((object) =>
        object.name.startsWith('Ruptured rocket section '),
      ).length,
      3,
    );
    assert.equal(
      model.group.children.filter((object) =>
        object.name.startsWith('Ruptured Titan external booster '),
      ).length,
      0,
    );
    assert(model.strapOns.every((booster) => booster.parent === model.group));
    state.elapsed = state.strapSeparation.time + 28.1;
    model.stage(state);
    assert(model.strapOns.every((booster) => !booster.visible));
  } finally {
    disposeRocketObject(model.group);
  }
});

test('attached Titan strap-ons rupture as four real pieces without teleportation, settle above terrain and dispose shared resources exactly once', () => {
  const model = createRocketModel('super-heavy');
  let state = createRocket('super-heavy', 100, 5, -30, { kind: 'platform' });
  state.attitude = { pitch: 0.13, roll: -0.09 };
  state.velocity = { x: 20, y: -10, z: 8 };
  state.elapsed = 50;
  state = crashRocket(state);
  model.build(1);
  pointModel(model, state);
  const structure = model.strapOns.flatMap((booster) => meshes(booster)),
    before = structure.map(vertices);
  model.damage(state, () => 0);
  structure.forEach((mesh, i) =>
    assertSameVertices(before[i], vertices(mesh), 'attached strap rupture'),
  );
  const pivots = model.group.children.filter((object) =>
    object.name.startsWith('Ruptured Titan external booster '),
  );
  assert.equal(pivots.length, 4);
  model.strapOns.forEach((booster, i) =>
    assert.equal(booster.parent, pivots[i]),
  );
  for (let frame = 0; frame < 600; frame++) {
    state.elapsed += 1 / 60;
    model.stage(state);
    model.damage(state, () => 0);
  }
  for (const mesh of structure)
    for (const point of vertices(mesh))
      assert(point.y >= -1e-5, `${mesh.name} penetrates terrain`);
  const resources = new Map();
  model.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points))
      return;
    resources.set(object.geometry, 0);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      resources.set(material, 0);
  });
  for (const resource of resources.keys())
    resource.addEventListener('dispose', () =>
      resources.set(resource, resources.get(resource) + 1),
    );
  disposeRocketObject(model.group);
  assert([...resources.values()].every((count) => count === 1));
});
