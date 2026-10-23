import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { station } from './helpers/skytrain-geometry.mjs';

const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const vector = (x, y, z) => new THREE.Vector3(x, y, z);

function cityBodies() {
  const buildings = JSON.parse(readFileSync('public/data/buildings.geojson')),
    source = JSON.stringify(buildings),
    e = {
      data: { buildings, roadRelief: () => 5.4 },
      elevation: cityElevation,
      buildings: new THREE.Group(),
      extraTextures: new Set(),
      stats: {},
      uniforms: { night: { value: 0 } },
      renderer: { shadowMap: {} },
      geometry(positions, normals, colors, uv) {
        const geometry = new THREE.BufferGeometry();
        for (const [name, values, size] of [
          ['position', positions, 3],
          ['normal', normals, 3],
          ['color', colors, 3],
          ['uv', uv, 2],
        ])
          geometry.setAttribute(
            name,
            new THREE.Float32BufferAttribute(values, size),
          );
        return geometry;
      },
    };
  const load = Object.getOwnPropertyDescriptor(
    THREE.TextureLoader.prototype,
    'load',
  );
  assert(load);
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    createBuildingBodies(e);
  } finally {
    Object.defineProperty(THREE.TextureLoader.prototype, 'load', load);
  }
  return {
    e,
    assertSource() {
      assert.equal(JSON.stringify(buildings), source);
    },
    dispose() {
      e.facadeDetails.dispose();
      e.data.rocketBuildingMesh.geometry.dispose();
      e.data.rocketBuildingMesh.material.dispose();
      for (const texture of e.extraTextures) texture.dispose();
    },
  };
}

test('the real GIS body batch makes a whole source building transparent without hiding distant source spans or changing physical geometry', (t) => {
  const city = cityBodies(),
    mesh = city.e.data.rocketBuildingMesh,
    parts = city.e.data.rocketBuildingParts,
    geometry = mesh.geometry,
    sourceAttributes = new Map(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        { attribute, bytes: Buffer.from(attribute.array.buffer).slice() },
      ]),
    ),
    volumes = JSON.stringify(city.e.data.flightBuildingVolumes),
    cutaway = new TravelOcclusion([city.e.buildings], [{ mesh, parts }]);
  try {
    assert(parts.length > 7000, 'exercise the complete real merged city batch');
    assert.equal(city.e.buildings.children.length, 1, 'no per-building draws');
    const metadataBytes = ['aTravelOccluderMin', 'aTravelOccluderMax'].reduce(
      (bytes, name) => bytes + geometry.getAttribute(name).array.byteLength,
      0,
    );
    assert.equal(metadataBytes, geometry.getAttribute('position').count * 24);
    t.diagnostic(
      `${parts.length} GIS source parts: ${metadataBytes} camera metadata bytes; no added meshes/draws`,
    );
    const target = parts.find(
      ({ bounds: b, minY, maxY }) =>
        b.maxX - b.minX > 12 &&
        b.maxX - b.minX < 28 &&
        b.maxZ - b.minZ > 7 &&
        b.maxZ - b.minZ < 17 &&
        maxY - minY > 7,
    );
    assert(target, 'a measured source body fits a bounded chase sightline');
    const b = target.bounds,
      x = (b.minX + b.maxX) / 2,
      feet = vector(x, target.minY, b.maxZ + 2),
      camera = vector(x, target.minY + 4.2, b.minZ - 3);
    mesh.updateWorldMatrix(true, false);
    cutaway.update(camera, feet);
    for (const offAxisX of [b.minX + 0.01, x, b.maxX - 0.01])
      assert.equal(
        cutaway.coverageAt(vector(offAxisX, target.minY + 2, b.minZ), {
          object: mesh,
          vertexIndex: target.start,
        }),
        1,
        'the selected building disappears across its full facade, not a torso-sized hole',
      );
    let distant = 0;
    for (const part of parts) {
      const p = part.bounds,
        px = (p.minX + p.maxX) / 2,
        pz = (p.minZ + p.maxZ) / 2;
      if (Math.hypot(px - x, pz - feet.z) < 100) continue;
      assert.equal(
        cutaway.coverageAt(vector(px, part.maxY, pz), {
          object: mesh,
          vertexIndex: part.start,
        }),
        0,
        'shared material and mesh do not erase distant source buildings',
      );
      if (++distant === 50) break;
    }
    assert.equal(distant, 50);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.visible, true);
    assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.material.transparent, false);
    assert.equal(JSON.stringify(city.e.data.flightBuildingVolumes), volumes);
    for (const [name, original] of sourceAttributes) {
      assert.equal(geometry.attributes[name], original.attribute);
      assert.deepEqual(
        Buffer.from(geometry.attributes[name].array.buffer),
        original.bytes,
        `${name}: physical/source buffers are unchanged`,
      );
    }
    city.assertSource();
    cutaway.clear();
    assert.equal(
      cutaway.coverageAt(vector(x, target.minY + 2, b.minZ), {
        object: mesh,
        vertexIndex: target.start,
      }),
      0,
      'Overview restores the whole building',
    );
  } finally {
    cutaway.dispose();
    city.dispose();
  }
});

function instance(root, match) {
  let result;
  root.traverse((mesh) => {
    if (!(mesh instanceof THREE.InstancedMesh) || result) return;
    const index = mesh.userData.stationPartIds?.findIndex(match) ?? -1;
    if (index < 0) return;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    matrix.premultiply(mesh.matrixWorld);
    result = { mesh, index, matrix };
  });
  return result;
}

test('real Waterfront instancing removes full roof and wall widths while retaining unrelated instances, floors and source transforms', () => {
  const owner = new SkyTrainStationOwner(
      station('waterfront'),
      cityElevation,
      'balanced',
      true,
    ),
    cutaway = new TravelOcclusion([owner.group]);
  try {
    owner.group.updateWorldMatrix(true, true);
    const roof = instance(
        owner.group,
        (id) =>
          id ===
          'waterfront-canada-southbound-portal-roof-1',
      ),
      otherRoof = instance(
        owner.group,
        (id) =>
          id === 'waterfront-expo-westbound-portal-roof-1',
      );
    assert(roof && otherRoof);
    assert.strictEqual(roof.mesh, otherRoof.mesh, 'actual shared wall batch');
    const center = vector(0, 0, 0).applyMatrix4(roof.matrix),
      feet = center.clone().add(vector(0, -3.5, 0)),
      camera = center.clone().add(vector(0, 3, -2)),
      originalMatrices = roof.mesh.instanceMatrix.array.slice();
    cutaway.update(camera, feet);
    const size = new THREE.Vector3().setFromMatrixScale(roof.matrix),
      longAxis = size.x > size.z ? vector(1, 0, 0) : vector(0, 0, 1);
    for (const fraction of [-0.45, 0, 0.45]) {
      const p = longAxis
        .clone()
        .multiplyScalar(fraction)
        .applyMatrix4(roof.matrix);
      assert.equal(
        cutaway.coverageAt(p, { object: roof.mesh, instanceId: roof.index }),
        1,
        'full selected platform roof width is transparent, including far from the torso ray',
      );
      assert.equal(
        cutaway.coverageAt(p, {
          object: roof.mesh,
          instanceId: roof.index,
          normalPass: true,
        }),
        1,
        'SSAO removes the same whole roof',
      );
    }
    assert.equal(
      cutaway.coverageAt(vector(0, 0, 0).applyMatrix4(otherRoof.matrix), {
        object: otherRoof.mesh,
        instanceId: otherRoof.index,
      }),
      0,
      'the neighboring line roof stays opaque within the same actual batch',
    );
    const wall = instance(
      owner.group,
      (id) =>
        id === 'canada-dark-track-wall-16.4',
    );
    assert(wall, 'exercise an authored opaque underground enclosure wall');
    const wallCenter = vector(0, 0, 0).applyMatrix4(wall.matrix),
      wallSize = new THREE.Vector3().setFromMatrixScale(wall.matrix),
      thin = wallSize.x < wallSize.z ? 0 : 2,
      tangent = thin === 0 ? 2 : 0,
      normal = new THREE.Vector3()
        .setFromMatrixColumn(wall.matrix, thin)
        .normalize(),
      wallFeet = wallCenter.clone().addScaledVector(normal, -2);
    wallFeet.y -= 1.6;
    const wallCamera = wallCenter.clone().addScaledVector(normal, 3);
    wallCamera.y += 1;
    cutaway.update(wallCamera, wallFeet);
    for (const fraction of [-0.45, 0, 0.45]) {
      const point = vector(0, 0, 0);
      point.setComponent(tangent, fraction);
      point.applyMatrix4(wall.matrix);
      assert.equal(
        cutaway.coverageAt(point, {
          object: wall.mesh,
          instanceId: wall.index,
        }),
        1,
        'the entire wall panel is transparent rather than a circular cutout',
      );
    }
    const floor = instance(
      owner.group,
      (id) => id === 'floor-waterfront-canada',
    );
    assert(floor);
    assert.equal(
      cutaway.coverageAt(vector(0, 0.5, 0).applyMatrix4(floor.matrix), {
        object: floor.mesh,
        instanceId: floor.index,
      }),
      0,
      'actual walking floor remains rendered',
    );
    assert.deepEqual(roof.mesh.instanceMatrix.array, originalMatrices);
    assert.equal(roof.mesh.visible, true);
    assert.equal(roof.mesh.material.opacity, 1);
    assert.equal(roof.mesh.material.transparent, false);
    assert.equal(cutaway.snapshot().shaderFailures, 0);
  } finally {
    cutaway.dispose();
    owner.dispose();
  }
});
