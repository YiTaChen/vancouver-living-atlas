import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createTeslaRoadster,
  TESLA_ROADSTER_ANCHORS,
  TESLA_ROADSTER_DIMENSIONS,
  TESLA_ROADSTER_GROUND_SUPPORT,
  TESLA_ROADSTER_PROVENANCE,
  TESLA_ROADSTER_THRUSTERS,
  TESLA_ROADSTER_FANS,
} = await import(cityModule('assets/tesla-roadster'));
const active = (model) =>
  model.group.children.find((child) => child.isGroup && child.visible);
const meshes = (root) => {
  const found = [];
  root.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
};

test('all three source-authored Tesla levels are finite with monotonic, bounded geometry and shared materials', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    const roles = new Map();
    let previous = 0;
    for (const [quality, budget] of [
      ['low', 12_000],
      ['medium', 30_000],
      ['high', 60_000],
    ]) {
      model.setQuality(quality);
      const stat = model.stats(),
        level = active(model);
      assert.equal(stat.quality, quality);
      assert.ok(stat.triangles > previous && stat.triangles < budget);
      assert.ok(stat.meshes <= 36);
      assert.equal(stat.materials, 13);
      previous = stat.triangles;
      assert.equal(meshes(level).length, stat.meshes);
      for (const mesh of meshes(level)) {
        const position = mesh.geometry.getAttribute('position'),
          normal = mesh.geometry.getAttribute('normal');
        assert.equal(position.itemSize, 3);
        assert.equal(normal.count, position.count);
        assert.ok(Array.from(position.array).every(Number.isFinite));
        assert.ok(Array.from(normal.array).every(Number.isFinite));
        assert.ok(mesh.geometry.boundingSphere.radius > 0);
        assert.equal(mesh.material.vertexColors, false);
        assert.ok(
          !Object.values(mesh.material).some((value) => value?.isTexture),
        );
        const role = mesh.material.userData.semantic_role;
        if (roles.has(role)) assert.equal(mesh.material, roles.get(role));
        else roles.set(role, mesh.material);
      }
    }
    assert.equal(roles.size, 12);
  } finally {
    model.dispose();
  }
});

test('tier switching reuses exactly three roots and preserves wheel/yoke/fan/wing pose', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    model.update({
      steeringRad: 0.31,
      wheelSpinRad: 1.7,
      fanSpinRad: 2.2,
      wingDeploy: 0.8,
    });
    const roots = new Map();
    for (let cycle = 0; cycle < 8; cycle++)
      for (const quality of ['high', 'medium', 'low']) {
        model.setQuality(quality);
        const root = active(model);
        if (roots.has(quality)) assert.equal(root, roots.get(quality));
        roots.set(quality, root);
        assert.equal(
          model.group.children.filter((child) => child.isGroup && child.visible)
            .length,
          1,
        );
        assert.equal(root.getObjectByName('front-left-steer').rotation.y, 0.31);
        assert.equal(root.getObjectByName('rear-left-steer').rotation.y, 0);
        assert.equal(
          root.getObjectByName('front-left-steer-roll').rotation.x,
          1.7,
        );
        assert.equal(
          root.getObjectByName('steer-by-wire-yoke').rotation.z,
          -0.31 * 2.6,
        );
        assert.equal(
          root.getObjectByName('illustrative-underbody-fan-0').rotation.y,
          2.2,
        );
        assert.equal(
          root.getObjectByName('illustrative-underbody-fan-1').rotation.y,
          -2.2,
        );
        assert.ok(
          Math.abs(
            root.getObjectByName('active-rear-wing').position.y -
              (0.74 + 0.8 * 0.23),
          ) < 1e-12,
        );
      }
    assert.equal(model.stats().cachedLevels, 3);
    assert.equal(model.group.children.length, 4);
    assert.throws(
      () => model.setQuality('ultra'),
      /Unknown Tesla model quality/,
    );
    assert.equal(model.stats().cachedLevels, 3);
  } finally {
    model.dispose();
  }
});

test('collision metadata contains actual animated vertices across gameplay steering, wheel rotation and deployed wings', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    const [hx, hy, hz] = model.dimensions.halfExtents;
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      for (const steeringRad of [-0.42, 0, 0.42]) {
        model.update({
          steeringRad,
          wheelSpinRad: 0.4,
          wingDeploy: 1,
          thrust: 0,
        });
        // Precise vertices avoid rotating a tyre's bounding box as if its
        // empty corners were physical geometry, especially after wheel spin.
        const bounds = new THREE.Box3().setFromObject(active(model), true);
        assert.ok(bounds.min.x >= -hx && bounds.max.x <= hx);
        assert.ok(bounds.min.y >= -1e-6 && bounds.max.y <= hy * 2 + 1e-6);
        assert.ok(bounds.min.z >= -hz && bounds.max.z <= hz);
      }
    }
  } finally {
    model.dispose();
  }
});

test('the contact datum, conservative hull and driver eye agree with the actual closed cockpit', () => {
  const model = createTeslaRoadster({ quality: 'high' });
  try {
    model.group.updateMatrixWorld(true);
    const level = active(model),
      bounds = new THREE.Box3().setFromObject(level),
      [hx, hy, hz] = model.dimensions.halfExtents;
    assert.ok(bounds.min.y >= -1e-6 && bounds.min.y < 0.001);
    assert.ok(bounds.max.y <= 2 * hy + 1e-6);
    assert.ok(bounds.max.x <= hx && bounds.min.x >= -hx);
    assert.ok(bounds.max.z <= hz && bounds.min.z >= -hz);
    assert.equal(model.dimensions.contactToCenter, 0.62);
    assert.equal(model.dimensions.wheelbase, 2.78);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(0, 4, -0.5),
      new THREE.Vector3(0, -1, 0),
    );
    const roof = ray.intersectObject(level, true)[0];
    assert.equal(roof.object.material.userData.semantic_role, 'carbon');
    assert.ok(roof.point.y > 1.2, 'closed opaque roof above the driver');
    const eye = new THREE.Vector3(...model.anchors.driverEye),
      look = new THREE.Vector3(...model.anchors.driverLookAt)
        .sub(eye)
        .normalize();
    ray.set(eye, look);
    const forwardBlockers = ray
      .intersectObject(level, true)
      .filter((hit) => !hit.object.material.transparent && hit.distance < 0.7);
    assert.equal(
      forwardBlockers.length,
      0,
      'yoke/dash cannot obscure the forward eye point',
    );
    assert.ok(
      model.anchors.driverEye[0] > 0,
      'left-hand driving is +X in this model convention',
    );
    assert.equal(model.anchors, TESLA_ROADSTER_ANCHORS);
    assert.equal(model.dimensions, TESLA_ROADSTER_DIMENSIONS);
  } finally {
    model.dispose();
  }
});

test('ground-fit metadata follows actual wheel contact centres and the lowest rigid body at every LOD', () => {
  const model = createTeslaRoadster({ quality: 'low' }),
    datum = TESLA_ROADSTER_GROUND_SUPPORT,
    wheelNames = [
      'front-right-steer',
      'front-left-steer',
      'rear-right-steer',
      'rear-left-steer',
    ];
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  const clipAtZ = (polygon, z, keepAbove) => {
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        aInside = keepAbove ? a.z >= z : a.z <= z,
        bInside = keepAbove ? b.z >= z : b.z <= z;
      if (aInside) clipped.push(a);
      if (aInside !== bInside)
        clipped.push(a.clone().lerp(b, (z - a.z) / (b.z - a.z)));
    }
    return clipped;
  };
  assert.equal(datum.wheelContacts.length, 4);
  assert.ok(Object.isFrozen(datum) && Object.isFrozen(datum.wheelContacts));
  assert.ok(datum.suspensionTravel > 0 && datum.suspensionTravel <= 0.05);
  assert.ok(Object.isFrozen(datum.bodySections));
  assert.equal(datum.bodySections[0].minZ, -model.dimensions.halfExtents[2]);
  assert.equal(datum.bodySections.at(-1).maxZ, model.dimensions.halfExtents[2]);
  for (const [i, section] of datum.bodySections.entries()) {
    assert.ok(Object.isFrozen(section) && section.minZ < section.maxZ);
    if (i)
      assert.equal(
        section.minZ,
        datum.bodySections[i - 1].maxZ,
        'body slabs cover the complete length without gaps',
      );
  }
  try {
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      model.update({ steeringRad: 0.42, wingDeploy: 1, wheelSpinRad: 0 });
      model.group.updateMatrixWorld(true);
      const level = active(model);
      for (const [i, name] of wheelNames.entries()) {
        const centre = level
            .getObjectByName(name)
            .getWorldPosition(new THREE.Vector3()),
          contact = new THREE.Vector3(...datum.wheelContacts[i]),
          ray = new THREE.Raycaster(
            contact.clone().add(new THREE.Vector3(0, -0.05, 0)),
            new THREE.Vector3(0, 1, 0),
          );
        assert.ok(Object.isFrozen(datum.wheelContacts[i]));
        near(contact.x, centre.x);
        near(contact.z, centre.z);
        near(contact.y, centre.y - model.dimensions.wheelRadius);
        const tyre = level.getObjectByName(`${name}:rubber`),
          hit = ray.intersectObject(tyre)[0];
        assert.ok(
          hit,
          `${quality}: the metadata point lies below the actual tyre tread`,
        );
        near(hit.point.y, contact.y);
      }
      near(datum.wheelContacts[1][0] - datum.wheelContacts[0][0], datum.track);
      near(
        datum.wheelContacts[0][2] - datum.wheelContacts[2][2],
        model.dimensions.wheelbase,
      );
      const bounds = new THREE.Box3(),
        sectionMinimums = datum.bodySections.map(() => Infinity);
      let minimum = Infinity,
        front = Infinity,
        rear = Infinity,
        fan = Infinity;
      level.traverse((object) => {
        if (!object.isMesh) return;
        for (
          let ancestor = object;
          ancestor && ancestor !== level;
          ancestor = ancestor.parent
        )
          if (wheelNames.includes(ancestor.name)) return;
        const position = object.geometry.getAttribute('position'),
          point = new THREE.Vector3();
        for (let i = 0; i < position.count; i++) {
          point
            .fromBufferAttribute(position, i)
            .applyMatrix4(object.matrixWorld);
          bounds.expandByPoint(point);
          minimum = Math.min(minimum, point.y);
          if (
            point.z >=
            datum.wheelContacts[0][2] + model.dimensions.wheelRadius
          )
            front = Math.min(front, point.y);
          if (
            point.z <=
            datum.wheelContacts[2][2] - model.dimensions.wheelRadius
          )
            rear = Math.min(rear, point.y);
          if (object.name === 'fan-rotor:titanium')
            fan = Math.min(fan, point.y);
        }
        const index = object.geometry.index,
          count = index?.count ?? position.count;
        for (let i = 0; i < count; i += 3) {
          const triangle = [0, 1, 2].map((corner) =>
            new THREE.Vector3()
              .fromBufferAttribute(
                position,
                index ? index.getX(i + corner) : i + corner,
              )
              .applyMatrix4(object.matrixWorld),
          );
          for (const [sectionIndex, section] of datum.bodySections.entries()) {
            let polygon = clipAtZ(triangle, section.minZ, true);
            if (polygon.length) polygon = clipAtZ(polygon, section.maxZ, false);
            for (const point of polygon)
              sectionMinimums[sectionIndex] = Math.min(
                sectionMinimums[sectionIndex],
                point.y,
              );
          }
        }
      });
      for (const [i, section] of datum.bodySections.entries()) {
        near(sectionMinimums[i], datum.measured.bodySectionMinimumY[i]);
        assert.ok(
          section.clearance <= sectionMinimums[i] &&
            sectionMinimums[i] - section.clearance < 0.01,
          `${quality}: slab clearance rounds down from triangles clipped at both Z boundaries`,
        );
      }
      near(minimum, datum.measured.minimumBodyY);
      near(front, datum.measured.frontBumperMinimumY);
      near(rear, datum.measured.rearDiffuserMinimumY);
      near(fan, datum.measured.centralFanMinimumY);
      assert.ok(
        datum.chassisClearance <= minimum &&
          minimum - datum.chassisClearance < 0.01,
      );
      const frontOverhang = bounds.max.z - datum.wheelContacts[0][2],
        rearOverhang = datum.wheelContacts[2][2] - bounds.min.z;
      assert.ok(
        frontOverhang <= datum.measured.frontOverhang &&
          datum.measured.frontOverhang - frontOverhang < 0.001,
      );
      assert.ok(
        rearOverhang <= datum.measured.rearOverhang &&
          datum.measured.rearOverhang - rearOverhang < 0.001,
      );
      const floorRay = new THREE.Raycaster(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 1, 0),
      );
      near(
        floorRay.intersectObject(level, true)[0].point.y,
        datum.measured.undertrayMinimumY,
      );
    }
  } finally {
    model.dispose();
  }
});

test('body geometry leaves real wheel openings and cockpit systems survive the low tier', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    const level = active(model);
    model.group.updateMatrixWorld(true);
    const paint = level.getObjectByName('body:paint'),
      ray = new THREE.Raycaster(
        new THREE.Vector3(2, 0.35, 1.39),
        new THREE.Vector3(-1, 0, 0),
      );
    assert.equal(
      ray.intersectObject(paint).length,
      0,
      'front wheel opening is not a painted solid slab',
    );
    for (const name of [
      'body:white',
      'body:suede',
      'body:display',
      'body:headlight',
      'body:tail',
      'steer-by-wire-yoke',
      'active-rear-wing',
    ])
      assert.ok(level.getObjectByName(name), name);
    assert.equal(
      level.getObjectByName('body:glass').userData.excludeFromSSAO,
      true,
    );
    assert.equal(
      level.getObjectByName('body:glass').material.depthWrite,
      false,
    );
    assert.ok(level.getObjectByName('body:glass').material.opacity >= 0.7);
    assert.equal(
      level.getObjectByName('body:glass').material.side,
      THREE.FrontSide,
    );
  } finally {
    model.dispose();
  }
});

test('closed copper canopy hides the bright cockpit from rear chase while its inside view stays clear', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      model.group.updateMatrixWorld(true);
      const level = active(model),
        glass = level.getObjectByName('body:glass'),
        outside = new THREE.Vector3(0, 3.4, -7.3),
        rearPane = new THREE.Vector3(0, 1.015, -1.255),
        direction = rearPane.clone().sub(outside).normalize(),
        ray = new THREE.Raycaster(outside, direction);
      assert.ok(
        1 - glass.material.opacity <= 0.04,
        'at most 4% of a bright seat reaches the exterior through smoked glazing',
      );
      assert.equal(glass.material.side, THREE.FrontSide);
      const exteriorHit = ray.intersectObject(level, true)[0];
      assert.equal(
        exteriorHit.object,
        glass,
        `${quality}: rear glazing closes the cabin`,
      );
      assert.ok(
        exteriorHit.face.normal.dot(direction.clone().negate()) > 0.5,
        'rear glazing faces the outside camera instead of being backface-culled',
      );
      ray.set(
        new THREE.Vector3(...model.anchors.driverEye),
        new THREE.Vector3(0, 0, 1),
      );
      assert.equal(
        ray.intersectObject(glass).length,
        0,
        'the driver sees outward without a tinted overlay',
      );
      glass.material.side = THREE.DoubleSide;
      assert.ok(
        ray.intersectObject(glass).length > 0,
        'the clear interior ray actually crosses the windscreen',
      );
      glass.material.side = THREE.FrontSide;
    }
  } finally {
    model.dispose();
  }
});

test('raised front fenders cover the inboard tyre shoulder at every geometry tier', () => {
  const model = createTeslaRoadster({ quality: 'low' });
  try {
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      model.group.updateMatrixWorld(true);
      for (const sign of [-1, 1]) {
        const ray = new THREE.Raycaster(
            new THREE.Vector3(sign * 0.847, 2, 1.47),
            new THREE.Vector3(0, -1, 0),
          ),
          hit = ray.intersectObject(active(model), true)[0];
        assert.equal(
          hit.object.material.userData.semantic_role,
          'paint',
          quality,
        );
        assert.ok(
          hit.point.y > 0.71,
          'tyre tread cannot poke through the white fender',
        );
      }
      const light = active(model)
        .getObjectByName('body:headlight')
        .geometry.getAttribute('position');
      for (let i = 0; i < light.count; i++)
        assert.ok(
          Math.hypot(light.getY(i) - 0.35, light.getZ(i) - 1.39) > 0.35,
          'lamp aperture stays ahead of the tyre volume',
        );
    }
  } finally {
    model.dispose();
  }
});

test('the revised front has a rear-narrow/front-wide central hood, raised outer wings and a real recessed lamp', () => {
  const model = createTeslaRoadster({ quality: 'high' });
  try {
    const level = active(model),
      hood = level
        .getObjectByName('body:hood')
        .geometry.getAttribute('position');
    let rearWidth = 0,
      frontWidth = 0;
    for (let i = 0; i < hood.count; i++) {
      if (Math.abs(hood.getZ(i) - 0.7) < 1e-5)
        rearWidth = Math.max(rearWidth, Math.abs(hood.getX(i)));
      if (Math.abs(hood.getZ(i) - 2.3) < 1e-5)
        frontWidth = Math.max(frontWidth, Math.abs(hood.getX(i)));
    }
    assert.ok(
      frontWidth > rearWidth * 1.15,
      'central nose widens towards the front, unlike the early draft',
    );
    model.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
        new THREE.Vector3(0.98, 2, 1.4),
        new THREE.Vector3(0, -1, 0),
      ),
      outerWing = ray.intersectObject(level, true)[0];
    assert.equal(outerWing.object.material.userData.semantic_role, 'paint');
    assert.ok(outerWing.point.y > 0.81);
    ray.set(new THREE.Vector3(0.86, 2, 1.8), new THREE.Vector3(0, -1, 0));
    assert.equal(
      ray.intersectObject(level, true)[0].object.material.userData
        .semantic_role,
      'headlight',
      'paint has a real aperture over the recessed lens',
    );
  } finally {
    model.dispose();
  }
});

test('frame updates have bounded transforms/effects without allocating geometries, materials or scene objects', () => {
  const model = createTeslaRoadster();
  try {
    const before = meshes(model.group).map((mesh) => [
      mesh.uuid,
      mesh.geometry.uuid,
      mesh.material.uuid,
    ]);
    const jets = model.group.getObjectByName('bounded-cold-gas-jets');
    for (let i = 0; i < 800; i++)
      model.update({
        steeringRad: i * 100,
        wheelSpinRad: i * 1e10,
        fanSpinRad: i * 1e11,
        thrust: i % 2,
        wingDeploy: i,
        brake: i,
        night: i % 2 === 0,
      });
    assert.deepEqual(
      meshes(model.group).map((mesh) => [
        mesh.uuid,
        mesh.geometry.uuid,
        mesh.material.uuid,
      ]),
      before,
    );
    assert.equal(jets.count, 10);
    assert.equal(jets.geometry.getAttribute('position').count, 18);
    assert.ok(jets.material.transparent && !jets.material.depthWrite);
    assert.equal(jets.userData.excludeFromSSAO, true);
    assert.ok(Array.from(jets.instanceMatrix.array).every(Number.isFinite));
    model.update({
      steeringRad: NaN,
      wheelSpinRad: Infinity,
      fanSpinRad: -Infinity,
      thrust: NaN,
      wingDeploy: Infinity,
      brake: -Infinity,
    });
    model.group.updateMatrixWorld(true);
    model.group.traverse((object) =>
      assert.ok(object.matrixWorld.elements.every(Number.isFinite)),
    );
    assert.equal(jets.visible, false);
    assert.ok(
      Math.abs(active(model).getObjectByName('front-left-steer').rotation.y) <=
        0.62,
    );
  } finally {
    model.dispose();
  }
});

test('night and braking retain material identity and do not introduce extra light or shadow passes', () => {
  const model = createTeslaRoadster();
  try {
    const tail = active(model).getObjectByName('body:tail').material,
      original = tail.color.clone();
    model.update({ brake: 1, night: true });
    assert.ok(tail.color.r > original.r);
    assert.equal(active(model).getObjectByName('body:tail').material, tail);
    const lights = [];
    model.group.traverse((object) => {
      if (object.isLight) lights.push(object);
    });
    assert.equal(lights.length, 0);
    model.update({ brake: 0, night: false });
    assert.ok(
      tail.color.equals(original),
      'returning to day restores the authored baseline',
    );
  } finally {
    model.dispose();
  }
});

test('disposal frees every unique cached geometry and shared material once and detaches the model', () => {
  const model = createTeslaRoadster({ quality: 'low' }),
    parent = new THREE.Group(),
    counts = new Map();
  parent.add(model.group);
  model.setQuality('medium');
  model.setQuality('high');
  for (const mesh of meshes(model.group))
    for (const resource of [mesh.geometry, mesh.material])
      if (!counts.has(resource)) {
        counts.set(resource, 0);
        resource.addEventListener('dispose', () =>
          counts.set(resource, counts.get(resource) + 1),
        );
      }
  model.dispose();
  model.dispose();
  model.setQuality('medium');
  model.update({ thrust: 1 });
  assert.equal(parent.children.length, 0);
  assert.equal(model.group.children.length, 0);
  assert.ok([...counts.values()].every((count) => count === 1));
  assert.equal(model.stats().disposed, true);
  assert.equal(model.stats().triangles, 0);
  assert.equal(model.stats().cachedLevels, 0);
});

test('provenance distinguishes the 2026 Rocket interpretation from Tesla CAD and the 2017 concept', () => {
  assert.match(TESLA_ROADSTER_PROVENANCE.model, /October 15, 2026.*Rocket/);
  assert.ok(
    TESLA_ROADSTER_PROVENANCE.references.every((url) =>
      [
        'tesla.com',
        'digitalassets.tesla.com',
        'www.tesla.com',
        'www.youtube.com',
      ].includes(new URL(url).hostname),
    ),
  );
  assert.ok(
    TESLA_ROADSTER_PROVENANCE.limitations.some((note) =>
      /Not Tesla CAD/.test(note),
    ),
  );
  assert.ok(
    TESLA_ROADSTER_PROVENANCE.limitations.some((note) =>
      /illustrative/.test(note),
    ),
  );
  assert.match(
    TESLA_ROADSTER_PROVENANCE.source,
    /YiTaChen\/vancouver-living-atlas/,
  );
});

test('Rocket exposes the revealed four rear, four lift and two front yaw nozzles plus four rear suction fans', () => {
  assert.equal(TESLA_ROADSTER_THRUSTERS.length, 10);
  assert.equal(TESLA_ROADSTER_FANS.length, 4);
  for (const [kind, count] of [
    ['rear', 4],
    ['lift', 4],
    ['yaw', 2],
  ])
    assert.equal(
      TESLA_ROADSTER_THRUSTERS.filter((port) => port.kind === kind).length,
      count,
    );
  assert.ok(
    TESLA_ROADSTER_THRUSTERS.filter((port) => port.kind === 'yaw').every(
      (port) => port.position[2] > 1 && Math.abs(port.direction[0]) === 1,
    ),
  );
  assert.ok(
    TESLA_ROADSTER_THRUSTERS.filter((port) => port.kind === 'lift').every(
      (port) => port.direction[1] === -1,
    ),
  );
  const model = createTeslaRoadster();
  try {
    model.update({ thrust: 1, fanSpinRad: 1.1 });
    const level = active(model);
    assert.equal(
      level.children.filter((part) =>
        part.name.startsWith('illustrative-underbody-fan-'),
      ).length,
      4,
    );
    assert.equal(
      model.group.getObjectByName('bounded-cold-gas-jets').count,
      10,
    );
  } finally {
    model.dispose();
  }
});
