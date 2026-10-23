import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
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
function glazedSolids(o) {
  const ids = new Set(
    o.geometryData.parts
      .filter(
        (p) =>
          p.material === 'glass' ||
          p.id.includes('gable-mullion') ||
          p.id.includes('glass-mullion') ||
          p.id.includes('street-portal'),
      )
      .map((p) => p.id),
  );
  return stationSolidIndex(o.group).boxes.filter((p) => ids.has(p.id));
}
function capsuleIntersectsBox(box, start, end, radius) {
  const inverse = box.rotation.clone().transpose(),
    a = start.clone().sub(box.center).applyMatrix3(inverse),
    d = end.clone().sub(start).applyMatrix3(inverse),
    half = box.halfSize,
    knots = [0, 1],
    axes = ['x', 'y', 'z'];
  for (const axis of axes)
    if (Math.abs(d[axis]) > 1e-12)
      for (const side of [-1, 1]) {
        const t = (side * half[axis] - a[axis]) / d[axis];
        if (t > 0 && t < 1) knots.push(t);
      }
  knots.sort((x, y) => x - y);
  const distanceSq = (t) =>
    axes.reduce((sum, axis) => {
      const outside = Math.max(0, Math.abs(a[axis] + d[axis] * t) - half[axis]);
      return sum + outside * outside;
    }, 0);
  let closest = Math.min(...knots.map(distanceSq));
  for (let i = 0; i + 1 < knots.length; i++) {
    const lo = knots[i],
      hi = knots[i + 1],
      middle = (lo + hi) / 2;
    let quadratic = 0,
      linear = 0;
    for (const axis of axes) {
      const coordinate = a[axis] + d[axis] * middle;
      if (Math.abs(coordinate) <= half[axis]) continue;
      const offset = a[axis] - Math.sign(coordinate) * half[axis];
      quadratic += d[axis] * d[axis];
      linear += offset * d[axis];
    }
    if (quadratic > 0)
      closest = Math.min(
        closest,
        distanceSq(THREE.MathUtils.clamp(-linear / quadratic, lo, hi)),
      );
  }
  return closest < radius * radius - 1e-8;
}
function hits(solids, point, eye = false) {
  const start = new THREE.Vector3(
      point[0],
      point[1] + (eye ? 1.63 : 0.24),
      point[2],
    ),
    end = eye
      ? start.clone()
      : new THREE.Vector3(point[0], point[1] + 1.49, point[2]);
  return solids
    .filter((part) =>
      capsuleIntersectsBox(part.box, start, end, eye ? 0.025 : 0.24),
    )
    .map((p) => p.id);
}

test('Burrard vertical glazing and mullions have exact physical colliders while roof glazing keeps its ceiling role', () => {
  const shell = source.geometryParts.filter((p) =>
    /^burrard-ticket-atrium-(glass-side-|gable-pane-|gable-mullion-|glass-mullion-|street-portal-)/.test(
      p.id,
    ),
  );
  assert(shell.length > 60);
  for (const part of shell) {
    const obstacle = source.obstacles.find((o) => o.id === part.id);
    assert(
      obstacle,
      `${part.id}: visible vertical structure must block bodies`,
    );
    assert.deepEqual(obstacle.centerM, part.centerM);
    assert.deepEqual(obstacle.sizeM, part.sizeM);
    assert.equal(obstacle.yawDegrees, part.yawDegrees);
    assert.deepEqual(
      obstacle.rotationQuaternionXYZW,
      part.rotationQuaternionXYZW,
    );
  }
  for (const part of source.geometryParts.filter((p) =>
    p.id.startsWith('burrard-ticket-atrium-glass-roof-'),
  )) {
    assert.equal(part.role, 'ceiling');
    assert(!source.obstacles.some((o) => o.id === part.id));
  }
  const o = owner(source);
  try {
    const point = [-11.85, -6.5, -101.5],
      foot = o.floorAt(point, 'burrard-ticket-atrium');
    assert(
      foot,
      'the supported atrium floor continues to the bounded outer wall',
    );
    assert(
      hits(glazedSolids(o), point).includes(
        'burrard-ticket-atrium-glass-mullion--11-3.5',
      ),
      'the original full-body probe intersects the actual visible outer post',
    );
    assert(
      !o.isClearFoot(foot),
      'native body cannot pass through that outer post',
    );
  } finally {
    o.dispose();
  }
});

test('Burrard street-bank glazing has a real standing-height portal while retaining upper panes, roof, floors and train contracts', () => {
  const portal = source.authoredInterior.glazedStreetPortal;
  assert.equal(portal.planeZ, -97.9);
  assert.equal(portal.minX, -10.3);
  assert(Math.abs(portal.maxX - 0.3) < 1e-10);
  assert.equal(portal.requiredStandingHeadroomM, 2);
  assert(Math.abs(portal.topY - portal.highestTreadY - 2) < 1e-10);
  assert.deepEqual(source.floorSurfaces, original.floorSurfaces);
  assert.deepEqual(source.connections, original.connections);
  assert.deepEqual(source.platforms, original.platforms);
  const retained = (s) =>
    s.geometryParts
      .filter((p) =>
        /burrard-ticket-atrium-(glass-roof|glass-side|truss-|gable-pane--1-|gable-mullion--1-)/.test(
          p.id,
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(
    retained(source),
    retained(original),
    'roof, back gable and side glazing remain exact',
  );
  for (const part of source.geometryParts.filter(
    (p) =>
      p.id.startsWith('burrard-ticket-atrium-gable-pane-1-') &&
      !p.id.includes('-portal-return-'),
  )) {
    const prior = original.geometryParts.find((p) => p.id === part.id);
    assert(
      Math.abs(
        part.centerM[1] +
          part.sizeM[1] / 2 -
          prior.centerM[1] -
          prior.sizeM[1] / 2,
      ) < 1e-10,
      `${part.id}: original top glazing boundary remains`,
    );
  }
  const o = owner(source);
  try {
    const solids = glazedSolids(o);
    for (const x of [-3, -7.8]) {
      const point = [x, -2.8333333333333335, portal.planeZ];
      assert.deepEqual(
        hits(solids, point),
        [],
        'actual rendered glazing and mullions clear the full body',
      );
      assert.deepEqual(
        hits(solids, point, true),
        [],
        'actual eye volume clears the portal',
      );
    }
    for (const point of [
      [10.144444444, -6.5, -105],
      [-12, -6.5, -105],
    ]) {
      assert.deepEqual(
        hits(solids, point),
        [],
        'east bank and west public door retain real body clearance through their mullions',
      );
      assert.deepEqual(
        hits(solids, point, true),
        [],
        'side-door eye volumes are clear',
      );
    }
    assert(o.stats().drawCalls <= 32);
  } finally {
    o.dispose();
  }
});

test('every Burrard flight clears actual emitted glazing and mullions across supported standing-body and eye lanes; restored closed panes and low posts fail', () => {
  const o = owner(source);
  try {
    const solids = glazedSolids(o);
    let probes = 0;
    const flights = o.data.connections.filter((c) => c.treads.length);
    for (const c of flights) {
      const a = new THREE.Vector3(...c.start),
        b = new THREE.Vector3(...c.end),
        side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize(),
        half = Math.max(0, c.width / 2 - 0.3);
      for (const tread of c.treads) {
        const middle = tread.vertices
          .reduce((s, p) => s.add(new THREE.Vector3(...p)), new THREE.Vector3())
          .multiplyScalar(1 / tread.vertices.length);
        for (const across of [-half, 0, half]) {
          const point = middle.clone().addScaledVector(side, across).toArray();
          const foot = o.floorAt(point);
          if (across === 0)
            assert(
              foot &&
                Math.abs(foot.position[1] - point[1]) < 0.01 &&
                o.isClearFoot(foot),
              `${c.id}: central tread remains fully supported and body-clear`,
            );
          if (
            !foot ||
            Math.abs(foot.position[1] - point[1]) > 0.01 ||
            !o.isClearFoot(foot)
          )
            continue;
          assert.deepEqual(
            hits(solids, point),
            [],
            `${c.id}: rendered glass cannot cross a walking body at ${point}`,
          );
          assert.deepEqual(
            hits(solids, point, true),
            [],
            `${c.id}: rendered glass cannot cross an eye at ${point}`,
          );
          probes++;
        }
      }
    }
    assert(probes >= flights.reduce((sum, c) => sum + c.treads.length, 0));
  } finally {
    o.dispose();
  }
  const closed = structuredClone(source);
  for (const p of closed.geometryParts.filter(
    (p) =>
      p.id.startsWith('burrard-ticket-atrium-gable-pane-1-') &&
      !p.id.includes('-portal-return-'),
  )) {
    const top = p.centerM[1] + p.sizeM[1] / 2;
    p.centerM[1] = (-4 + top) / 2;
    p.sizeM[1] = top + 4;
  }
  for (const p of closed.geometryParts.filter((p) =>
    p.id.includes('-glass-mullion-'),
  )) {
    p.centerM[1] = -6.5 + 4.7;
    p.sizeM[1] = 7.5;
  }
  const negative = owner(closed);
  try {
    const solids = glazedSolids(negative);
    for (const x of [-3, -7.8]) {
      const point = [x, -2.8333333333333335, -97.9];
      assert(
        hits(solids, point).some((id) => id.includes('gable-pane')),
        'negative fixture restores the visible wall through each flight',
      );
      assert(
        hits(solids, point, true).some((id) => id.includes('gable-pane')),
        'negative fixture obstructs the actual eye, even with collision disabled',
      );
    }
    for (const point of [
      [10.144444444, -6.5, -105],
      [-12, -6.5, -105],
    ])
      assert(
        hits(solids, point).some((id) => id.includes('glass-mullion')),
        'negative fixture restores a real side-door post through the body',
      );
  } finally {
    negative.dispose();
  }
});
