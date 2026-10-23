import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { SKYTRAIN_STREET_ENTRANCES } = await import(
  cityModule('skytrain-street-access')
);
const { project } = await import(cityModule('geo'));
const routes = JSON.parse(readFileSync('public/models/skytrain-routes.json'));
const mapEvidence = JSON.parse(
  readFileSync('tools/station-interiors/references/street-map-20261023.json'),
);

for (const id of [
  'burrard',
  'granville',
  'stadium-chinatown',
  'yaletown-roundhouse',
])
  test(`${id}: every maintained street doorway occupies its referenced map location`, () => {
    const raw = JSON.parse(
      readFileSync(`public/models/skytrain-stations/${id}.json`),
    );
    assert(raw.authoredInterior, `${id} has its reviewed interior`);
    const data = adaptSkyTrainStationFrame(raw, routes),
      [x, z] = project(data.lonlat),
      q = new THREE.Quaternion(...data.quaternion);
    for (const ref of SKYTRAIN_STREET_ENTRANCES[id]) {
      const record = mapEvidence.stations[id].find(
        (r) => r.url === ref.coordinateSource,
      );
      assert(
        record,
        `${id}/${ref.id}: doorway coordinate has a retained external reference`,
      );
      if (record.type === 'interpreted-entrance') {
        assert.match(ref.coordinateAccuracy, /inferred/);
        assert.match(record.inference, /not surveyed/);
        assert(record.mappedStairHead?.url);
      }
      const referencePoints = Array.isArray(record.lonlat)
        ? [record.lonlat]
        : [record.coordinates[0], record.coordinates.at(-1)];
      assert(
        referencePoints.some(
          (p) =>
            Math.hypot(
              ...project(p).map((v, k) => v - project(ref.lonlat)[k]),
            ) < 0.25,
        ),
        `${id}/${ref.id}: street registry cannot drift away from the referenced doorway`,
      );
      const entrance = data.entrances.find(
        (e) =>
          e.id === (data.authoredInterior.streetEntranceMap[ref.id] ?? ref.id),
      );
      assert(
        entrance,
        `${id}/${ref.id}: real street doorway remains in the authored model`,
      );
      const p = new THREE.Vector3(...entrance.point)
          .applyQuaternion(q)
          .add(new THREE.Vector3(x, 0, z)),
        expected = project(ref.lonlat);
      assert(
        Math.hypot(p.x - expected[0], p.z - expected[1]) < 0.25,
        `${id}/${ref.id}: model doorway is displaced from the map reference`,
      );
      const inward = new THREE.Vector3(
          ...entrance.inwardDirection,
        ).applyQuaternion(q),
        bearing =
          ((Math.atan2(inward.x, -inward.z) * 180) / Math.PI + 360) % 360,
        difference = Math.abs(((bearing - ref.bearing + 540) % 360) - 180);
      assert(
        difference < 5,
        `${id}/${ref.id}: street approach and authored doorway must face the same physical direction`,
      );
    }
  });
