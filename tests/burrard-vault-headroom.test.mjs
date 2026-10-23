import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { cityModule } from './helpers/city-modules.mjs';
import { stationSolidIndex } from './helpers/station-solid-index.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildBurrard } from '../tools/station-interiors/dunsmuir.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const original = JSON.parse(readFileSync(SOURCE)).stations.find(
  (s) => s.stationId === 'burrard',
);
const source = rebuildBurrard(original);
function owner(station) {
  return new SkyTrainStationOwner(
    makeRuntimeStation(station, 'a'.repeat(64)),
    () => 0,
    'balanced',
    false,
  );
}
function structure(o) {
  const parts = new Map(o.geometryData.parts.map((p) => [p.id, p]));
  return stationSolidIndex(o.group).boxes.filter(({ id }) => {
    const p = parts.get(id);
    return p && ['ceiling', 'wall'].includes(p.role);
  });
}
function bodyAt(point) {
  return new OBB(
    point.clone().add(new THREE.Vector3(0, 0.85, 0)),
    new THREE.Vector3(0.24, 0.85, 0.24),
  );
}
function hits(parts, point) {
  return parts
    .filter(({ box }) => box.intersectsOBB(bodyAt(point)))
    .map(({ id }) => id);
}
function rayDistance(parts, origin, direction) {
  const ray = new THREE.Ray(origin, direction);
  let nearest = Infinity;
  for (const { box } of parts) {
    const local = ray
      .clone()
      .applyMatrix4(
        new THREE.Matrix4()
          .compose(
            box.center,
            new THREE.Quaternion().setFromRotationMatrix(
              new THREE.Matrix4().setFromMatrix3(box.rotation),
            ),
            new THREE.Vector3(1, 1, 1),
          )
          .invert(),
      );
    const hit = local.intersectBox(
      new THREE.Box3(box.halfSize.clone().negate(), box.halfSize.clone()),
      new THREE.Vector3(),
    );
    if (hit) {
      const world = hit.clone().applyMatrix3(box.rotation).add(box.center);
      nearest = Math.min(nearest, world.distanceTo(origin));
    }
  }
  return nearest;
}
function roofHeight(parts, x, z, floorY) {
  const y = floorY + 1.8;
  return (
    y +
    rayDistance(parts, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0))
  );
}

test('Burrard triple-bank roof joint and open-air park landings clear actual standing bodies while retaining physical cover', () => {
  const o = owner(source);
  try {
    const parts = structure(o),
      roofs = parts.filter(({ id }) => /vault-panel/.test(id));
    let checked = 0;
    for (const c of o.geometryData.connections.filter((c) =>
      /^burrard-(main-escalator-bank-|park-stairs-)/.test(c.id),
    ))
      for (const [index, tread] of c.treads.entries()) {
        const v = tread.vertices.map((p) => new THREE.Vector3(...p)),
          centre = v
            .reduce((a, p) => a.add(p), new THREE.Vector3())
            .multiplyScalar(1 / v.length),
          across = v[3].clone().sub(v[0]);
        for (const offset of [-0.25, 0, 0.25]) {
          const point = centre.clone().addScaledVector(across, offset),
            foot = o.floorAt(point.toArray(), `${c.id}:step:${index}`);
          assert(foot);
          if (!o.isClearFoot(foot)) continue;
          checked++;
          assert.deepEqual(
            hits(parts, point),
            [],
            `${tread.id}/${offset}: actual emitted wall/roof clears the complete standing body`,
          );
          if (c.id.startsWith('burrard-main-escalator-bank-')) {
            const y = roofHeight(roofs, point.x, point.z, point.y);
            assert(
              Number.isFinite(y) && y >= point.y + 1.8 && y <= point.y + 4,
              `${tread.id}: shaft or hub provides real overhead cover`,
            );
          }
        }
      }
    assert(checked > 150);
    // Both sides of the roof joint retain physical panels, rather than simply
    // hiding the entire hub ellipse to make body assertions pass.
    for (const x of [23.3, 25, 28])
      for (const z of [-108, -105, -99])
        assert(
          Number.isFinite(roofHeight(roofs, x, z, -14)),
          `retained hub roof at ${x}/${z}`,
        );
    const joint = parts.filter(({ id }) =>
        /burrard-(main-escalator-bank|upper-hub)-.*(vault-panel|sidewall|vault-end-infill)/.test(
          id,
        ),
      ),
      unfinished = joint.filter(({ id }) => !id.includes('vault-end-infill')),
      eye = new THREE.Vector3(22.85555555555556, -12.35, -105);
    let priorGaps = 0;
    for (const z of [-107.415, -102.585])
      for (const y of [-11.8, -11.6, -11.3]) {
        const direction = new THREE.Vector3(23, y, z).sub(eye).normalize();
        assert(
          Number.isFinite(rayDistance(joint, eye, direction)),
          'oblique rays meet the real joint roof or bounded end-arch infill',
        );
        if (!Number.isFinite(rayDistance(unfinished, eye, direction)))
          priorGaps++;
      }
    assert(
      priorGaps >= 2,
      'removing only the end infill reproduces actual oblique sky gaps missed by centre-only roof probes',
    );
    assert(
      !source.geometryParts.some((p) =>
        /^burrard-park-intermediate-[12]-(north|south)-lintel-/.test(p.id),
      ),
      'photographed open-air stair mouths have no floating overhead beams',
    );
    assert(o.stats().drawCalls <= 32);
  } finally {
    o.dispose();
  }
});

test('restoring the closed hub roof or a low park lintel reproduces the original visible headroom obstruction', () => {
  const closed = structuredClone(source),
    panel = structuredClone(
      closed.geometryParts.find(
        (p) => p.id === 'burrard-upper-hub-vault-panel-8-portal-return-0',
      ),
    );
  assert(panel);
  panel.id = 'negative-restored-closed-hub-vault';
  panel.centerM[2] = -103.64833383;
  panel.sizeM[2] = 10;
  closed.geometryParts.push(panel);
  const park = closed.floorSurfaces.find(
      (f) => f.surfaceId === 'burrard-park-intermediate-1',
    ),
    y = park.verticesM[0][1];
  closed.geometryParts.push({
    id: 'negative-park-mouth-lintel',
    yawDegrees: 0,
    centerM: [-4.89, y + 1.9, -138.16],
    sizeM: [3.8, 0.4, 0.2],
    material: 'concrete',
    role: 'wall',
  });
  const o = owner(closed);
  try {
    const parts = structure(o);
    assert(
      hits(
        parts,
        new THREE.Vector3(19.1, -11.666666666666668, -103.35),
      ).includes(panel.id),
      'closed ellipse intersects the visible main-bank body',
    );
    assert(
      hits(parts, new THREE.Vector3(-4.89, -3.32994374, -138.4)).includes(
        'negative-park-mouth-lintel',
      ),
      'unverified low lintel intersects the approaching stair body',
    );
  } finally {
    o.dispose();
  }
});
