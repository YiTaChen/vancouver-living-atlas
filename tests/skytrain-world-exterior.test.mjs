import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { SkyTrainWorldExteriors, SKYTRAIN_WORLD_STOCK } = await import(
  cityModule('skytrain-world-exterior')
);
const meshes = (root) => {
  const result = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
};

test('world stock uses the reviewed source dimensions and actual paired-door centres with independent four/two-car frames', () => {
  const mark = JSON.parse(
      readFileSync(
        'tools/assets/skytrain-mark-v-interior/layout-assumptions.json',
      ),
    ),
    canada = JSON.parse(
      readFileSync(
        'tools/assets/canada-line-stage2/references/source-review.json',
      ),
    ).dimensionBasis,
    owner = new SkyTrainWorldExteriors();
  try {
    assert.deepEqual(SKYTRAIN_WORLD_STOCK.expo.doorCenters, mark.doorCentersZ);
    const components = JSON.parse(
      readFileSync(
        'tools/assets/skytrain-mark-v-interior/exports/mark-v-a-car-interior.lod1.components.json',
      ),
    );
    assert.equal(
      components.glbSha256,
      createHash('sha256')
        .update(
          readFileSync(
            'public/models/blender/metro/mark-v-a-car-interior.lod1.glb',
          ),
        )
        .digest('hex'),
      'door component bounds must describe the actual current runtime GLB',
    );
    const glass = components.batches.find(
      (batch) => batch.batch === 'interior-batch-glass',
    ).ranges;
    for (const side of [-1, 1])
      for (let door = 0; door < 3; door++) {
        const a = glass.find(
            (part) => part.componentId === `door-${side}-${door}-a-window`,
          ),
          b = glass.find(
            (part) => part.componentId === `door-${side}-${door}-b-window`,
          ),
          center = (a.boundsM.min[2] + b.boundsM.max[2]) / 2;
        assert(
          Math.abs(center - SKYTRAIN_WORLD_STOCK.expo.doorCenters[door]) < 1e-5,
          'the shared exterior door centres align with actual paired GLB leaves',
        );
      }
    assert.deepEqual(
      SKYTRAIN_WORLD_STOCK.canada.doorCenters,
      canada.doorCentersZPerCarM,
    );
    assert.equal(SKYTRAIN_WORLD_STOCK.canada.length, canada.carBodyLengthM);
    assert.equal(SKYTRAIN_WORLD_STOCK.canada.width, canada.bodyWidthM);
    for (const line of ['expo', 'canada']) {
      const exterior = owner.create(line),
        stock = SKYTRAIN_WORLD_STOCK[line];
      assert.equal(exterior.cars.length, line === 'expo' ? 4 : 2);
      assert.equal(meshes(exterior.group).length, line === 'expo' ? 10 : 6);
      assert(exterior.group.userData.exteriorOnly);
      for (const [index, car] of exterior.cars.entries()) {
        assert.equal(car.userData.offset, stock.offsets[index]);
        assert.deepEqual(car.userData.doorCenters, stock.doorCenters);
        const bounds = new THREE.Box3().setFromObject(car),
          size = bounds.getSize(new THREE.Vector3());
        assert(size.x >= stock.width && size.x < stock.width + 0.2);
        assert(size.y > stock.height && size.y < stock.height + 0.5);
        assert(size.z >= stock.length && size.z < stock.length + 0.9);
        for (const object of meshes(car)) {
          assert(!object.castShadow);
          assert(object.receiveShadow);
          assert.equal(object.material.transparent, false);
          assert.equal(
            object.geometry.getAttribute('color').count,
            object.geometry.getAttribute('position').count,
          );
        }
      }
      exterior.cars[0].rotation.y = 0.25;
      assert.equal(
        exterior.cars[1].rotation.y,
        0,
        'each car follows its own route arc',
      );
    }
  } finally {
    owner.dispose();
  }
});

test('rounded source-informed shells have outward roof faces, non-box normals, bogies and a bounded triangle budget', () => {
  const owner = new SkyTrainWorldExteriors();
  try {
    for (const line of ['expo', 'canada']) {
      const exterior = owner.create(line),
        car = exterior.cars[0],
        shell = car.children[0],
        stock = SKYTRAIN_WORLD_STOCK[line];
      car.updateWorldMatrix(true, true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(0, 10, car.position.z),
        new THREE.Vector3(0, -1, 0),
      );
      const roof = ray.intersectObject(shell)[0];
      assert(
        roof && roof.face.normal.y > 0.99,
        'real front-side roof triangles render from outside',
      );
      assert(Math.abs(roof.point.y - stock.height) < 1e-4);
      const normals = shell.geometry.getAttribute('normal');
      let slopedShoulder = false;
      for (let i = 0; i < normals.count; i++)
        if (Math.abs(normals.getX(i)) > 0.2 && Math.abs(normals.getY(i)) > 0.2)
          slopedShoulder = true;
      assert(
        slopedShoulder,
        'roof shoulders and cab taper are actual geometry',
      );
      const triangles = meshes(exterior.group).reduce(
        (total, object) =>
          total +
          (object.geometry.index?.count ??
            object.geometry.getAttribute('position').count) /
            3,
        0,
      );
      assert(triangles < (line === 'expo' ? 7000 : 4000));
    }
  } finally {
    owner.dispose();
  }
});

test('all city trains share a bounded geometry/material cache; head/tail direction stays local and night glazing is shared', () => {
  const owner = new SkyTrainWorldExteriors(),
    all = [];
  for (let i = 0; i < 40; i++)
    all.push(owner.create(i % 2 ? 'expo' : 'canada'));
  const geometries = new Set(),
    materials = new Set();
  for (const exterior of all)
    for (const object of meshes(exterior.group)) {
      geometries.add(object.geometry);
      materials.add(object.material);
    }
  assert(geometries.size <= 14);
  assert(materials.size <= 4);
  const first = all[0].cars[0].getObjectByName('Cab directional lamps'),
    second = all[2].cars[0].getObjectByName('Cab directional lamps'),
    head = second.material;
  all[0].setDirection(-1);
  assert.notEqual(first.material, head);
  assert.equal(second.material, head);
  const glass = all[0].cars[0].children[1].material,
    day = glass.emissiveIntensity;
  owner.setNight(1);
  assert(glass.emissiveIntensity > day + 0.5);
  assert.equal(all[1].cars[0].children[1].material, glass);
  const disposals = new Map();
  for (const resource of [...geometries, ...materials]) {
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () =>
      disposals.set(resource, disposals.get(resource) + 1),
    );
  }
  all[0].dispose();
  assert([...disposals.values()].every((count) => count === 0));
  owner.dispose();
  owner.dispose();
  assert([...disposals.values()].every((count) => count === 1));
  assert.throws(() => owner.create('expo'), /disposed/);
});
