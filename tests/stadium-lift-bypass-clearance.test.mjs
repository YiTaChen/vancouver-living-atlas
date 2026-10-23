import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { cityModule } from './helpers/city-modules.mjs';
import { stationSolidIndex } from './helpers/station-solid-index.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildStadium } from '../tools/station-interiors/southeast.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const input = JSON.parse(
  readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
).stations.find((s) => s.stationId === 'stadium-chinatown');

test('Stadium level lift bypass and physical guards stay outside the complete escalator flight envelope', () => {
  const owner = new SkyTrainStationOwner(
    makeRuntimeStation(rebuildStadium(input), 'a'.repeat(64)),
    () => 0,
    'balanced',
    false,
  );
  try {
    const data = owner.geometryData,
      flight = data.connections.find(
        (c) => c.id === 'stadium-beatty-up-escalator',
      ),
      floorId = 'floor-stadium-lift-upper-hall',
      guardPrefix = 'stadium-upper-lift-bypass-guard-',
      solids = stationSolidIndex(owner.group).boxes.filter(
        (p) => p.id === floorId || p.id.startsWith(guardPrefix),
      );
    assert(
      flight && solids.length === 3,
      'test the actual rendered deck and both glass guards',
    );
    let checked = 0;
    for (const [treadIndex, tread] of flight.treads.entries()) {
      const vertices = tread.vertices.map((p) => new THREE.Vector3(...p)),
        centre = vertices
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .multiplyScalar(0.25),
        across = vertices[3].clone().sub(vertices[0]),
        along = vertices[1].clone().sub(vertices[0]);
      for (const side of [-0.25, 0, 0.25])
        for (const step of [-0.45, 0, 0.45]) {
          const p = centre
              .clone()
              .addScaledVector(across, side)
              .addScaledVector(along, step),
            foot = owner.floorAt(
              p.toArray(),
              `${flight.id}:step:${treadIndex}`,
            );
          assert(foot, 'every probe belongs to an actual tread');
          // Keep a foreign deck out of the complete bank, including its outer
          // walking quarters. The lane's own rails separately limit where the
          // pedestrian's centre may go; they cannot excuse a crossing deck.
          // This is the production occupied-body box, checked against the
          // transformed instances actually drawn, including the deck's soffit.
          const body = new OBB(
            p.clone().add(new THREE.Vector3(0, 0.85, 0)),
            new THREE.Vector3(0.24, 0.85, 0.24),
          );
          for (const solid of solids)
            assert(
              !solid.box.intersectsOBB(body),
              `${tread.id}/${side}/${step}: ${solid.id} crosses a supported rider`,
            );
          checked++;
        }
    }
    assert.equal(checked, flight.treads.length * 9, 'cover every actual tread');
    const guards = data.parts.filter((p) => p.id.startsWith(guardPrefix));
    for (const guard of guards)
      assert(
        data.obstacles.some((o) => o.id === guard.id),
        'the bypass guard must also stop a walking body',
      );
    const hall = data.floors.find((f) => f.id === 'stadium-lift-upper-hall');
    assert(
      Math.max(...hall.vertices.map((p) => p[0])) < 8.6,
      'retain the existing outer shaft wall',
    );
    assert(
      Math.max(...hall.vertices.map((p) => p[0])) -
        Math.min(...hall.vertices.map((p) => p[0])) >=
        1.69,
    );
  } finally {
    owner.dispose();
  }
});
