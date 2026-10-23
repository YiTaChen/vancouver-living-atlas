import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const targets = [
  'waterfront',
  'burrard',
  'granville',
  'stadium-chinatown',
  'yaletown-roundhouse',
];
const packet = (id) =>
  JSON.parse(readFileSync(`public/models/skytrain-stations/${id}.json`));

/** Read actual draw triangles, including both instances and the merged exact
 * slab batches. Filtering by source role prevents a stair nosing, bench or
 * overhead floor on another level from being mistaken for this foot's floor. */
function floorRays(owner, includeTreads = false) {
  owner.group.updateMatrixWorld(true);
  const byId = new Map(owner.geometryData.parts.map((p) => [p.id, p])),
    allowed = (part) =>
      part &&
      (part.role === 'floor' || (includeTreads && part.role.endsWith('tread'))),
    draws = [],
    matrix = new THREE.Matrix4(),
    ray = new THREE.Raycaster();
  owner.group.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        const id = mesh.userData.stationPartIds?.[i];
        if (!allowed(byId.get(id))) continue;
        mesh.getMatrixAt(i, matrix);
        const draw = new THREE.Mesh(mesh.geometry, mesh.material);
        draw.matrixAutoUpdate = false;
        draw.matrixWorld.copy(mesh.matrixWorld).multiply(matrix);
        draw.userData.sourcePartId = id;
        draws.push(draw);
      }
    } else if (mesh.userData.stationTrianglePartIds) draws.push(mesh);
  });
  return (local) => {
    const world = new THREE.Vector3(...owner.toWorld(local.toArray()));
    ray.set(
      world.clone().add(new THREE.Vector3(0, 0.55, 0)),
      new THREE.Vector3(0, -1, 0),
    );
    ray.near = 0;
    ray.far = 1.2;
    const hits = ray.intersectObjects(draws, false);
    for (const hit of hits) {
      const id =
        hit.object.userData.sourcePartId ??
        hit.object.userData.stationTrianglePartIds?.[hit.faceIndex];
      if (!allowed(byId.get(id))) continue;
      if (
        hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y <=
        0.55
      )
        continue;
      return { id, error: hit.point.y - world.y };
    }
    return null;
  };
}

for (const id of targets) {
  test(`${id}: every capsule-clear authored floor sample meets its highest rendered floor within 1cm`, () => {
    const owner = new SkyTrainStationOwner(packet(id), () => 0),
      ray = floorRays(owner);
    let checked = 0;
    try {
      for (const floor of owner.data.floors) {
        for (let offset = 0; offset < floor.indices.length; offset += 3) {
          const [a, b, c] = floor.indices
            .slice(offset, offset + 3)
            .map((i) => new THREE.Vector3(...floor.vertices[i]));
          for (let i = 0; i < 8; i++)
            for (let j = 0; j < 8 - i; j++) {
              const u = (i + 0.22) / 8,
                v = (j + 0.22) / 8;
              if (u + v >= 1) continue;
              const point = a
                  .clone()
                  .multiplyScalar(1 - u - v)
                  .addScaledVector(b, u)
                  .addScaledVector(c, v),
                foot = owner.floorAt(point.toArray(), floor.id);
              // A retained stair plinth can pass above a source rectangle. It is
              // irrelevant to walking only when the actual capsule rejects it.
              if (!foot || !owner.isClearFoot(foot)) continue;
              const hit = ray(point),
                label = `${id}/${floor.id} at ${point.toArray()}`;
              assert(hit, `${label}: a physical visible floor is missing`);
              assert(
                Math.abs(hit.error) <= 0.01,
                `${label}: visible ${hit.id} differs from supported foot by ${hit.error}m`,
              );
              checked++;
            }
        }
      }
      assert(checked > 100, `${id}: meaningful authored floor coverage`);
    } finally {
      owner.dispose();
    }
  });

  test(`${id}: every actual stair and escalator tread has matching visible support across its walking width`, () => {
    const owner = new SkyTrainStationOwner(packet(id), () => 0),
      ray = floorRays(owner, true);
    let checked = 0;
    try {
      for (const connection of owner.data.connections)
        for (const tread of connection.treads) {
          const vertices = tread.vertices.map((p) => new THREE.Vector3(...p)),
            center = vertices
              .reduce((sum, p) => sum.add(p), new THREE.Vector3())
              .multiplyScalar(1 / vertices.length),
            across = vertices[3].clone().sub(vertices[0]);
          for (const offset of [-0.25, 0, 0.25]) {
            const point = center.clone().addScaledVector(across, offset),
              hit = ray(point);
            assert(hit, `${id}/${tread.id}: rendered tread missing`);
            assert(
              Math.abs(hit.error) <= 0.01,
              `${id}/${tread.id}: visible ${hit.id} differs from actual tread by ${hit.error}m`,
            );
            checked++;
          }
        }
      assert(checked > 100, `${id}: every actual flight is sampled`);
    } finally {
      owner.dispose();
    }
  });
}
