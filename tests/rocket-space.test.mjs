import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { RocketSpace, ROCKET_SPACE_METERS_TO_UNITS } = await import(
  cityModule('rocket-space')
);
const body = (space, name) => {
  let result;
  space.scene.traverse((object) => {
    if (object.userData.celestialBody === name) result = object;
  });
  assert.ok(result, `missing ${name}`);
  return result;
};

test('Sun and Moon preserve natural angular sizes while observation hints zoom only the camera', () => {
  const space = new RocketSpace();
  try {
    for (const name of ['sun', 'moon']) {
      const object = body(space, name);
      const hint = space.getCelestialFocus(name);
      const measured = THREE.MathUtils.radToDeg(
        2 * Math.atan(object.userData.radiusUnits / object.position.length()),
      );
      assert.ok(Math.abs(measured - hint.angularDiameterDegrees) < 1e-10);
      assert.ok(measured > 0.5 && measured < 0.55);
      assert.ok(hint.fovDegrees >= 10 && hint.fovDegrees <= 18);
      hint.target.set(0, 0, 0);
      hint.direction.set(0, 0, 0);
      assert.ok(space.getCelestialFocus(name).target.length() > 400);
      assert.ok(
        Math.abs(space.getCelestialFocus(name).direction.length() - 1) < 1e-12,
      );
    }
    const sunDirection = body(space, 'sun').position.clone().normalize();
    const moonDirection = body(space, 'moon').position.clone().normalize();
    assert.ok(
      sunDirection.angleTo(moonDirection) > Math.PI / 3,
      'Moon must retain a readable sunlit phase',
    );
  } finally {
    space.dispose();
  }
});

test('the Sun is discoverable in the actual chase camera on desktop and portrait screens', () => {
  const space = new RocketSpace();
  try {
    for (const aspect of [1440 / 1000, 390 / 844]) {
      space.update(100_000, 120, aspect, false);
      space.camera.fov = 55;
      space.camera.lookAt(
        space.camera.position
          .clone()
          .add(new THREE.Vector3(-0.545, -0.257, -0.797)),
      );
      space.camera.updateProjectionMatrix();
      space.camera.updateMatrixWorld();
      const point = space.getCelestialFocus('sun').target.project(space.camera);
      assert.ok(
        Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95,
        JSON.stringify({ aspect, point }),
      );
      if (aspect === 1440 / 1000) {
        const x = ((point.x + 1) * 1440) / 2;
        const y = ((1 - point.y) * 1000) / 2;
        assert.ok(y > 94, 'Sun must clear the desktop header');
        assert.ok(
          !(x > 508 && x < 1115 && y > 95 && y < 164),
          'Sun must clear the vehicle mode bar',
        );
        assert.ok(
          !(x > 14 && x < 354 && y > 154 && y < 365),
          'Sun must clear the mission card',
        );
      }
    }
  } finally {
    space.dispose();
  }
});

test('vehicle fill follows the final render camera before opaque drawing while the Sun direction stays shared', () => {
  const space = new RocketSpace();
  try {
    space.update(100_000, 120, 1.44, false);
    const camera = new THREE.PerspectiveCamera(55, 1.44, 0.000001, 1200);
    camera.position.set(0.0004, 0.0008, 0.0005);
    camera.lookAt(new THREE.Vector3(0, 0.0003, 0));
    camera.updateMatrixWorld();
    space.scene.onBeforeRender(null, space.scene, camera);
    const fill = space.scene.getObjectByName('Soft camera-side vehicle fill');
    const local = fill.position.clone().applyMatrix4(camera.matrixWorldInverse);
    assert.ok(local.distanceTo(new THREE.Vector3(0.6, 0.8, 1)) < 1e-12);
    assert.ok(fill.target.position.distanceTo(camera.position) < 1e-12);
    const sunlight = space.scene.getObjectByName(
      'Sunlight — shares the planetary shader direction',
    );
    assert.ok(
      sunlight.position
        .clone()
        .normalize()
        .distanceTo(body(space, 'moon').material.uniforms.uSun.value) < 1e-12,
    );
  } finally {
    space.dispose();
  }
});

test('both celestial focus targets enter first and third person frustums without resizing either body', () => {
  const space = new RocketSpace();
  try {
    for (const firstPerson of [false, true])
      for (const name of ['sun', 'moon']) {
        space.update(120_000, 140, 390 / 844, firstPerson);
        const object = body(space, name);
        const radiusBefore = object.userData.radiusUnits;
        const focus = space.getCelestialFocus(name);
        space.camera.lookAt(focus.target);
        space.camera.fov = focus.fovDegrees;
        space.camera.updateProjectionMatrix();
        space.camera.updateMatrixWorld();
        const projected = focus.target.clone().project(space.camera);
        assert.ok(Math.abs(projected.x) < 1e-9 && Math.abs(projected.y) < 1e-9);
        assert.ok(projected.z > -1 && projected.z < 1);
        assert.equal(object.userData.radiusUnits, radiusBefore);
      }
  } finally {
    space.dispose();
  }
});

test('analytic limb samples the final render camera after the controller overwrites its pose and FOV', () => {
  const space = new RocketSpace();
  try {
    space.update(100_000, 123, 1.6, false);
    const planet = body(space, 'earth');
    assert.equal(planet.userData.renderTechnique, 'analytic-ray-sphere');
    assert.equal(
      planet.geometry.index.count,
      6,
      'planet silhouette must not depend on sphere triangles',
    );
    assert.equal(planet.material.depthWrite, false);
    assert.equal(planet.material.depthTest, true);
    const camera = new THREE.PerspectiveCamera(12, 0.7, 0.000001, 1200);
    camera.position.set(0.00035, 0.00018, 0.00075);
    camera.lookAt(space.getCelestialFocus('moon').target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    planet.onBeforeRender(null, space.scene, camera);
    assert.ok(
      planet.material.uniforms.uCameraWorld.value.equals(camera.matrixWorld),
    );
    assert.ok(
      planet.material.uniforms.uInverseProjection.value.equals(
        camera.projectionMatrixInverse,
      ),
    );
    assert.ok(planet.material.uniforms.uEye.value.equals(camera.position));
    assert.equal(planet.material.uniforms.uTime.value, 123);
    assert.ok(
      planet.material.fragmentShader.includes('fwidth(distanceToLimb)'),
    );
  } finally {
    space.dispose();
  }
});

test('Earth observation targets stay just below the geometric horizon across the atmosphere transition', () => {
  const space = new RocketSpace();
  try {
    for (const altitude of [15_000, 45_000, 100_000, 120_000]) {
      space.update(altitude, 10, 1, false);
      const target = space.getHorizonTarget();
      assert.ok(target.toArray().every(Number.isFinite));
      const ray = target.clone().sub(space.camera.position).normalize();
      const origin = space.camera.position
        .clone()
        .sub(
          new THREE.Vector3(
            0,
            -(6_371_000 + altitude) * ROCKET_SPACE_METERS_TO_UNITS,
            0,
          ),
        );
      const closest = Math.sqrt(origin.lengthSq() - origin.dot(ray) ** 2);
      const radius = 6_371_000 * ROCKET_SPACE_METERS_TO_UNITS;
      assert.ok(closest < radius && closest > radius * 0.95);
      assert.ok(ray.y < 0);
    }
  } finally {
    space.dispose();
  }
});

test('disposing the analytic environment releases its own material once and preserves the caller vehicle', () => {
  const space = new RocketSpace();
  const planet = body(space, 'earth');
  let ownDisposals = 0;
  planet.material.addEventListener('dispose', () => ownDisposals++);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const vehicle = new THREE.Mesh(geometry, material);
  let vehicleDisposals = 0;
  geometry.addEventListener('dispose', () => vehicleDisposals++);
  material.addEventListener('dispose', () => vehicleDisposals++);
  space.scene.add(vehicle);
  space.dispose();
  space.dispose();
  assert.equal(ownDisposals, 1);
  assert.equal(vehicleDisposals, 0);
  assert.equal(vehicle.parent, space.scene);
  geometry.dispose();
  material.dispose();
});
