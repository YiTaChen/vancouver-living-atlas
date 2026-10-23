import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { rebuildYaletown } from '../tools/station-interiors/southeast.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { project } = await import(cityModule('geo'));
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const input = JSON.parse(
  readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
).stations.find((s) => s.stationId === 'yaletown-roundhouse');
const source = rebuildYaletown(input),
  runtime = makeRuntimeStation(source, 'a'.repeat(64));

test('Yaletown existing fire plan retains the transverse upper switchback and separate broad stair/escalator openings', () => {
  const byId = (id) => source.connections.find((c) => c.connectionId === id);
  const upper = byId('yaletown-upper-entry-stair'),
    entryLower = byId('yaletown-lower-entry-stair'),
    stair = byId('yaletown-platform-stair');
  for (const c of [upper, entryLower])
    assert(
      Math.abs(c.startPointM[0] - c.endPointM[0]) > 7 &&
        Math.abs(c.startPointM[2] - c.endPointM[2]) < 0.01,
      'upper flights run across the island axis',
    );
  assert(
    (upper.endPointM[0] - upper.startPointM[0]) *
      (entryLower.endPointM[0] - entryLower.startPointM[0]) <
      0,
  );
  assert(
    stair.clearWidthM >= 2.8,
    'opening photograph shows a broad standalone platform stair',
  );
  assert.equal(stair.type, 'stairs');
  assert.equal(stair.riserCount, 41);
  const lowerEscalators = source.connections.filter(
    (c) =>
      c.connectionId.startsWith('yaletown-platform-') && c.type === 'escalator',
  );
  assert.equal(
    lowerEscalators.length,
    2,
    'two lower escalators remain separate from the single 41-riser stair',
  );
  assert.equal(
    source.connections.filter(
      (c) =>
        c.connectionId.startsWith('yaletown-platform-') && c.type === 'stairs',
    ).length,
    1,
  );
  for (const c of lowerEscalators) {
    assert(
      c.startPointM[1] < c.endPointM[1],
      'both lower escalators run from platform up to concourse',
    );
    assert(
      Math.max(c.startPointM[2], c.endPointM[2]) + 1 <
        Math.min(stair.startPointM[2], stair.endPointM[2]),
      'stair and escalator banks occupy different longitudinal wells',
    );
  }
});

test('Yaletown nominal raw waiting origins have capsule clearance and walk toward every unchanged sill without safePoint relocation', () => {
  const owner = new SkyTrainStationOwner(runtime, () => 0, 'balanced', false);
  let checked = 0;
  try {
    for (const platform of runtime.platforms) {
      const resolved = owner.boardingDoors(platform.line, platform.direction);
      for (const [i, door] of platform.doors.entries()) {
        const raw = owner.floorAt(door.waiting, platform.surfaceId);
        assert(
          raw && owner.isClearFoot(raw),
          `${door.id}: raw source origin must already support the complete capsule`,
        );
        assert.equal(Math.abs(door.waiting[0]), 2.3);
        assert.deepEqual(
          resolved[i].waiting.position,
          raw.position,
          `${door.id}: safePoint must not repair a nominal source collision`,
        );
        assert.deepEqual(resolved[i].threshold, door.sill);
        const outward = Math.sign(door.edge[0]),
          approach = [
            door.edge[0] - outward * 0.28,
            door.edge[1],
            door.edge[2],
          ];
        let foot = raw;
        for (const goal of [approach, raw.position]) {
          const dx = goal[0] - foot.position[0],
            dz = goal[2] - foot.position[2],
            n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.025));
          for (let k = 0; k < n; k++) {
            const next = owner.walk(foot, dx / n, dz / n);
            assert(owner.isClearFoot(next));
            assert(Math.abs(next.position[1] - foot.position[1]) < 0.001);
            foot = next;
          }
          assert(
            Math.hypot(foot.position[0] - goal[0], foot.position[2] - goal[2]) <
              0.02,
            `${door.id}: stair shaft cannot pin the passenger behind the nominal waiting origin`,
          );
        }
        // The supported platform approach faces the real sill. The remaining
        // 0.24m edge/sill gap belongs to the existing F boarding transition;
        // it must never be filled with a permanent floor over the running rail.
        assert(Math.abs(approach[2] - door.sill[2]) < 1e-9);
        assert(Math.abs(Math.abs(door.sill[0] - approach[0]) - 0.52) < 1e-9);
        checked++;
      }
    }
    assert.equal(checked, 12);
  } finally {
    owner.dispose();
  }
});

test('Yaletown waiting-origin correction preserves all train, door, sill, edge and rail contracts', () => {
  for (const p of source.platforms) {
    const before = input.platforms.find((q) => q.platformId === p.platformId),
      shift = p.stopPosition.translationM.map(
        (v, i) => v - before.stopPosition.translationM[i],
      );
    assert.deepEqual(
      p.stopPosition.rotationQuaternionXYZW,
      before.stopPosition.rotationQuaternionXYZW,
    );
    assert(Math.abs(p.railHeightM - before.railHeightM - shift[1]) < 1e-9);
    for (const d of p.doorAlignmentPoints) {
      const old = before.doorAlignmentPoints.find((q) => q.id === d.id);
      for (const key of [
        'carIndex',
        'carLocalDoorZ',
        'carLocalSillPointM',
        'consistLocalSillPointM',
        'carLocalSide',
        'carPoseInConsist',
        'horizontalThresholdGapM',
        'verticalDifferenceM',
        'openingWidthM',
        'boardingSide',
        'thresholdBridgeId',
      ])
        assert.deepEqual(d[key], old[key], `${d.id}/${key}`);
      for (const key of ['stationSillPointM', 'platformEdgePointM'])
        for (let axis = 0; axis < 3; axis++)
          assert(Math.abs(d[key][axis] - old[key][axis] - shift[axis]) < 1e-9);
      assert(
        p.waitingRegions.some((r) => {
          const xs = r.polygonM.map((v) => v[0]),
            zs = r.polygonM.map((v) => v[2]);
          return (
            d.stationWaitingPointM[0] > Math.min(...xs) &&
            d.stationWaitingPointM[0] < Math.max(...xs) &&
            d.stationWaitingPointM[2] > Math.min(...zs) &&
            d.stationWaitingPointM[2] < Math.max(...zs)
          );
        }),
      );
    }
  }
});

test('Yaletown uses the photographed two separate lift cores with a real paid-hall connection', () => {
  const lifts = source.connections.filter((c) => c.type === 'elevator');
  assert.equal(lifts.length, 2);
  assert(
    Math.hypot(
      lifts[0].startPointM[0] - lifts[1].startPointM[0],
      lifts[0].startPointM[2] - lifts[1].startPointM[2],
    ) > 20,
  );
  const owner = new SkyTrainStationOwner(runtime, () => 0);
  try {
    for (const z of [-7, 8])
      assert.equal(
        owner.floorAt([0, -16.2, z], 'yaletown-canada'),
        null,
        'both visible circulation wells remove the island slab/support',
      );
  } finally {
    owner.dispose();
  }
});

test('Yaletown mapped street lift enters northwest from the outside footway through its actual open portal', () => {
  const owner = new SkyTrainStationOwner(runtime, () => 0, 'balanced', false);
  try {
    const entry = source.entrances.find(
        (e) => e.entranceId === 'yaletown-street-lift-entry',
      ),
      connection = source.connections.find(
        (c) => c.connectionId === 'yaletown-lift-street-concourse',
      ),
      evidence = JSON.parse(
        readFileSync(
          'tools/station-interiors/references/street-map-20261023.json',
        ),
      ).stations['yaletown-roundhouse'],
      footway = evidence.find((e) => e.id === 988151952),
      doorWorld = project(footway.coordinates[0]),
      outsideWorld = project(footway.coordinates[1]),
      adapted = adaptSkyTrainStationFrame(
        runtime,
        JSON.parse(readFileSync('public/models/skytrain-routes.json')),
      ),
      inwardWorld = new THREE.Vector3(...entry.inwardDirectionM)
        .applyQuaternion(new THREE.Quaternion(...adapted.quaternion))
        .normalize(),
      mappedInward = new THREE.Vector3(
        doorWorld[0] - outsideWorld[0],
        0,
        doorWorld[1] - outsideWorld[1],
      ).normalize();
    assert(inwardWorld.dot(mappedInward) > 0.99999);
    assert(connection.startPointM[2] < entry.pointM[2]);
    const outside = entry.pointM.map(
      (v, axis) => v - entry.inwardDirectionM[axis] * 0.6,
    );
    let foot = owner.floorAt(outside, entry.surfaceId);
    assert(
      foot && owner.isClearFoot(foot),
      'raw exterior approach supports the capsule',
    );
    for (const goal of [entry.pointM, connection.startPointM, outside]) {
      const dx = goal[0] - foot.position[0],
        dz = goal[2] - foot.position[2],
        count = Math.ceil(Math.hypot(dx, dz) / 0.025);
      for (let i = 0; i < count; i++) {
        foot = owner.walk(foot, dx / count, dz / count);
        assert(owner.isClearFoot(foot));
        assert(Math.abs(foot.position[1]) < 1e-9);
      }
      assert(
        Math.hypot(foot.position[0] - goal[0], foot.position[2] - goal[2]) <
          0.025,
      );
    }
    for (const side of [-1, 1])
      assert(
        owner.blocked([entry.pointM[0] + side * 1.1, 0, entry.pointM[2]]),
        'solid lift jambs remain on both sides of the real open doorway',
      );
    assert(
      source.obstacles.some((p) => p.id === 'yaletown-glass-headhouse-south-0'),
    );
    assert(
      source.obstacles.some((p) => p.id === 'yaletown-glass-headhouse-south-1'),
    );
  } finally {
    owner.dispose();
  }
});

test('Yaletown door spacing and island placement match independent retained map geometry', () => {
  const evidence = JSON.parse(
    readFileSync('tools/station-interiors/references/street-map-20261023.json'),
  ).stations['yaletown-roundhouse'];
  const point = (id) => project(evidence.find((e) => e.id === id).lonlat),
    main = point(2383770178),
    lift = point(9133604358);
  const adapted = adaptSkyTrainStationFrame(
      runtime,
      JSON.parse(readFileSync('public/models/skytrain-routes.json')),
    ),
    q = new THREE.Quaternion(...adapted.quaternion);
  const a = source.entrances.find(
      (e) => e.entranceId === 'yaletown-davie-mainland-entry',
    ).pointM,
    b = source.entrances.find(
      (e) => e.entranceId === 'yaletown-street-lift-entry',
    ).pointM;
  const d = new THREE.Vector3(...b)
    .sub(new THREE.Vector3(...a))
    .applyQuaternion(q);
  assert(
    Math.hypot(d.x - (lift[0] - main[0]), d.z - (lift[1] - main[1])) < 0.25,
  );
  const polygon = evidence.find((e) => e.id === 923500678).coordinates,
    lon =
      (Math.min(...polygon.map((p) => p[0])) +
        Math.max(...polygon.map((p) => p[0]))) /
      2,
    lat =
      (Math.min(...polygon.map((p) => p[1])) +
        Math.max(...polygon.map((p) => p[1]))) /
      2,
    centre = project([lon, lat]);
  const islandDelta = new THREE.Vector3(-a[0], 0, -a[2]).applyQuaternion(q);
  assert(
    Math.hypot(
      islandDelta.x - (centre[0] - main[0]),
      islandDelta.z - (centre[1] - main[1]),
    ) < 0.25,
  );
});

test('rebuilding Yaletown cannot duplicate slabs or accumulate another train-frame shift', () => {
  const again = rebuildYaletown(source);
  assert.deepEqual(again.platforms, source.platforms);
  assert.equal(again.geometryParts.length, source.geometryParts.length);
  assert.deepEqual(again.floorSurfaces, source.floorSurfaces);
});
