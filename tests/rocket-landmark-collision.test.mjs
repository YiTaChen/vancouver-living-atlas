import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { RocketEffects } = await import(cityModule('rocket-effects'));
const { createRocket } = await import(cityModule('rocket-state'));
const { createConventionCentre } = await import(
  cityModule('assets/convention-centre')
);
const { collisionTriangles, hitTriangles } = await import(
  cityModule('flight-collision')
);

function centroid(triangles, offset) {
  return new THREE.Vector3(
    (triangles[offset] + triangles[offset + 3] + triangles[offset + 6]) / 3,
    (triangles[offset + 1] + triangles[offset + 4] + triangles[offset + 7]) / 3,
    (triangles[offset + 2] + triangles[offset + 5] + triangles[offset + 8]) / 3,
  );
}

for (const detail of [false, true]) {
  test(`the actual Convention Centre ${detail ? 'Ultra' : 'medium'} surface keeps its visible collapsed roof physical and restores source ownership`, () => {
    const scene = new THREE.Scene(),
      landmarks = new THREE.Group(),
      holder = new THREE.Group(),
      model = createConventionCentre(detail);
    holder.position.set(85, 15, -65);
    holder.rotation.y = 0.43;
    holder.add(model);
    landmarks.add(holder);
    scene.add(landmarks);
    scene.updateMatrixWorld(true);
    const mesh = model.children.find(
      (object) =>
        object instanceof THREE.Mesh && object.name.endsWith('/metal'),
    );
    assert(mesh, 'the production model provides the real metal roof mesh');
    const sourceGeometry = mesh.geometry,
      sourceMaterial = mesh.material,
      sourcePositions = sourceGeometry.getAttribute('position').array.slice(),
      sourceTriangles = collisionTriangles(mesh),
      originalTriangles = sourceTriangles.slice(),
      bounds = new THREE.Box3().setFromObject(mesh),
      triangle = new THREE.Triangle(),
      candidates = [];
    for (let i = 0; i < sourceTriangles.length; i += 9) {
      triangle.a.fromArray(sourceTriangles, i);
      triangle.b.fromArray(sourceTriangles, i + 3);
      triangle.c.fromArray(sourceTriangles, i + 6);
      if (Math.abs(triangle.getNormal(new THREE.Vector3()).y) > 0.85)
        candidates.push(i);
    }
    candidates.sort(
      (a, b) => centroid(sourceTriangles, b).y - centroid(sourceTriangles, a).y,
    );
    assert(candidates.length > 0, 'the actual roof has broad horizontal faces');
    const point = centroid(sourceTriangles, candidates[0]),
      state = createRocket('super-heavy', point.x - 25, bounds.min.y, point.z),
      engine = {
        scene,
        data: {},
        settings: { quality: 'balanced' },
        compatibleGraphics: false,
        container: { clientHeight: 800 },
        renderer: { shadowMap: { needsUpdate: false } },
        landmarks,
        landmarkDetails: [],
      },
      effects = new RocketEffects(engine, state),
      contact = {
        source: 'landmark',
        part: 'strap-on',
        point: { x: point.x, y: point.y, z: point.z },
        normal: { x: 0, y: 1, z: 0 },
        from: { x: point.x, y: point.y + 3, z: point.z },
        to: { x: point.x, y: point.y + 1, z: point.z },
        radius: 3.2,
        speed: 2,
        normalSpeed: 2,
        mass: state.mass,
        force: 1e6,
        impactEnergy: 1e5,
        penetration: 0.2,
        initialOverlap: true,
        bounds: {
          minX: bounds.min.x,
          maxX: bounds.max.x,
          minY: bounds.min.y,
          maxY: bounds.max.y,
          minZ: bounds.min.z,
          maxZ: bounds.max.z,
        },
      };
    state.phase = 'ignition';
    state.throttle = 0;
    try {
      // Repeated physical-contact inputs exercise the real progressive damage
      // field. This is a CPU geometry fixture, not a natural city-flight claim.
      for (let i = 0; i < 40; i++) {
        state.elapsed += 0.1;
        effects.receiveCollision(contact, state, 0.1);
        effects.update(0.1, state);
        effects.beforeRender();
        effects.afterRender();
        effects.collisionSurface(mesh, sourceTriangles);
      }
      effects.beforeRender();
      assert.notEqual(mesh.geometry, sourceGeometry);
      const rendered = collisionTriangles(mesh);
      effects.afterRender();
      const surface = effects.collisionSurface(mesh, sourceTriangles);
      assert(surface, 'the damaged rendered surface has a mission collider');
      assert.equal(surface.triangles.length, rendered.length);
      let maximumError = 0,
        maximumMovement = 0;
      for (let i = 0; i < rendered.length; i++) {
        maximumError = Math.max(
          maximumError,
          Math.abs(rendered[i] - surface.triangles[i]),
        );
        maximumMovement = Math.max(
          maximumMovement,
          Math.abs(originalTriangles[i] - surface.triangles[i]),
        );
      }
      assert(maximumError < 2e-4, `render/collision error ${maximumError} m`);
      assert(maximumMovement > 5, 'this fixture actually collapses the roof');
      const relocated = candidates.find((offset) => {
        const before = centroid(originalTriangles, offset),
          after = centroid(surface.triangles, offset);
        return (
          before.distanceTo(after) > 5 &&
          hitTriangles(originalTriangles, before, before, 0.15, false) &&
          !hitTriangles(surface.triangles, before, before, 0.15, false) &&
          hitTriangles(surface.triangles, after, after, 0.15, false)
        );
      });
      assert.notEqual(
        relocated,
        undefined,
        'the old roof leaves empty air while its real fallen portion still collides',
      );
      assert.equal(mesh.geometry, sourceGeometry);
      assert.equal(mesh.material, sourceMaterial);
      assert.deepEqual(
        sourceGeometry.getAttribute('position').array,
        sourcePositions,
      );
      assert.deepEqual(sourceTriangles, originalTriangles);
      effects.reset();
      assert.equal(effects.collisionSurface(mesh, sourceTriangles), null);
      assert.equal(effects.collisionCacheStats.meshes, 0);
      assert.deepEqual(sourceTriangles, originalTriangles);
      assert.equal(mesh.geometry, sourceGeometry);
      assert.equal(mesh.material, sourceMaterial);
    } finally {
      effects.dispose();
      const materials = new Set();
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      });
      for (const material of materials) material.dispose();
    }
  });
}
