import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
import { walkFlat } from './helpers/station-walker.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../tools/station-interiors/dunsmuir.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const packet = JSON.parse(readFileSync(SOURCE));

function walkTo(owner, origin, destination, label) {
  let point = origin;
  for (let i = 0; i < 4000; i++) {
    const dx = destination[0] - point.position[0],
      dz = destination[2] - point.position[2],
      length = Math.hypot(dx, dz);
    if (length < 0.045) break;
    const step = Math.min(0.075, length);
    const next = owner.walk(point, (dx / length) * step, (dz / length) * step);
    assert(
      Math.hypot(
        next.position[0] - point.position[0],
        next.position[2] - point.position[2],
      ) > 0.001,
      `${label}: stopped at ${point.position} on ${point.surfaceId}`,
    );
    point = next;
  }
  assert(
    Math.hypot(
      point.position[0] - destination[0],
      point.position[2] - destination[2],
    ) < 0.05,
    `${label}: reached horizontal waypoint`,
  );
  assert(
    Math.abs(point.position[1] - destination[1]) < 0.05,
    `${label}: expected floor height ${destination[1]}, got ${point.position[1]}`,
  );
  return point;
}

for (const [id, rebuild, count] of [
  ['burrard', rebuildBurrard, 5],
  ['granville', rebuildGranville, 9],
]) {
  const source = rebuild(packet.stations.find((s) => s.stationId === id));
  const data = makeRuntimeStation(source, 'a'.repeat(64));

  test(`${id}: every authored stair and escalator traverses physically in both directions`, () => {
    const owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
    try {
      assert.equal(
        data.connections.filter((c) => c.type === 'escalator').length,
        count,
      );
      for (const connection of data.connections.filter(
        (c) => c.treads.length,
      )) {
        for (const reverse of [false, true]) {
          const [start, end, from, to] = reverse
            ? [connection.end, connection.start, connection.to, connection.from]
            : [
                connection.start,
                connection.end,
                connection.from,
                connection.to,
              ];
          const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
          const direction = [
            (end[0] - start[0]) / length,
            (end[2] - start[2]) / length,
          ];
          const origin = [
            start[0] - direction[0] * 0.55,
            start[1],
            start[2] - direction[1] * 0.55,
          ];
          let point = owner.floorAt(origin, from);
          assert(point, `${connection.id}: origin lies on ${from}`);
          assert(
            owner.isClearFoot(point),
            `${connection.id}: origin capsule supported`,
          );
          for (let i = 0; i < Math.ceil((length + 1.1) / 0.075); i++)
            point = owner.walk(
              point,
              direction[0] * 0.075,
              direction[1] * 0.075,
            );
          assert(
            Math.abs(point.position[1] - end[1]) < 0.05,
            `${connection.id} ${reverse ? 'reverse' : 'forward'} stayed at y=${point.position[1]}, expected ${end[1]}; surface=${point.surfaceId}`,
          );
          assert(
            owner.floorAt(point.position, to),
            `${connection.id}: destination landing supports capsule`,
          );
          assert(
            owner.isClearFoot(point),
            `${connection.id}: destination capsule supported`,
          );
        }
      }
    } finally {
      owner.dispose();
    }
  });

  test(`${id}: platform calibration preserves the rigid train and car-local door contracts`, () => {
    const original = packet.stations.find((s) => s.stationId === id),
      before = original.platforms[0].stopPosition.translationM,
      after = source.platforms[0].stopPosition.translationM,
      shift = after.map((v, i) => v - before[i]),
      translated = (p) => p.map((v, i) => v + shift[i]);
    for (const platform of original.platforms) {
      const expected = structuredClone(platform);
      expected.floorHeightM += shift[1];
      expected.railHeightM += shift[1];
      expected.stopPosition.translationM = translated(
        expected.stopPosition.translationM,
      );
      for (const d of expected.doorAlignmentPoints)
        for (const key of [
          'stationSillPointM',
          'platformEdgePointM',
          'stationWaitingPointM',
        ])
          d[key] = translated(d[key]);
      for (const r of expected.waitingRegions ?? [])
        r.polygonM = r.polygonM.map(translated);
      assert.deepEqual(
        source.platforms.find((p) => p.platformId === platform.platformId),
        expected,
      );
      assert.deepEqual(
        source.floorSurfaces.find((f) => f.surfaceId === platform.surfaceId)
          .verticesM,
        original.floorSurfaces
          .find((f) => f.surfaceId === platform.surfaceId)
          .verticesM.map(translated),
      );
    }
    for (const anchor of original.anchors.filter((a) =>
      ['vehicle-root-stop', 'platform-door'].includes(a.kind),
    ))
      assert.deepEqual(
        source.anchors.find((a) => a.id === anchor.id),
        { ...anchor, pointM: translated(anchor.pointM) },
      );
  });

  test(`${id}: original entrance route reaches both platforms through the shared ticket hall`, () => {
    const owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
    const upper = data.platforms.find((p) =>
      p.surfaceId.endsWith('upper'),
    ).floorHeight;
    const lower = data.platforms.find((p) =>
      p.surfaceId.endsWith('lower'),
    ).floorHeight;
    try {
      const initial =
        id === 'burrard'
          ? owner.floorAt([-5, 0, -87.3], 'burrard-street-plaza')
          : owner.floorAt([-5, 0, -104.3], 'granville-mall-entrance');
      let point = initial;
      assert(point && owner.isClearFoot(point));
      if (id === 'burrard') {
        const [px, , pz] =
            source.authoredInterior.platformCalibration.platformCenterM,
          northZ = pz - 37;
        point = walkFlat(owner, point, [-3, 0, -91.7]);
        point = walkTo(
          owner,
          point,
          [-3, -6.5, -105.6],
          'Burrard street stair',
        );
        point = walkFlat(owner, point, [9.4, -6.5, -105]);
        point = walkTo(
          owner,
          point,
          [23.6, upper, -105],
          'Burrard eastward triple bank',
        );
        point = walkFlat(owner, point, [px, upper, northZ - 0.6]);
        point = walkTo(
          owner,
          point,
          [px, upper, northZ + 0.6],
          'Burrard upper platform',
        );
        assert.equal(point.surfaceId, 'burrard-upper');
        point = walkFlat(owner, point, [24, upper, northZ - 0.6]);
        point = walkTo(
          owner,
          point,
          [24, lower, northZ + 12.6],
          'Burrard short lower connector',
        );
        point = walkFlat(owner, point, [px - 1.5, lower, northZ + 12.75]);
        assert.equal(point.surfaceId, 'burrard-lower');
        return;
      }
      const endZ = data.connections.find(
        (c) => c.id === 'granville-big-three-2',
      ).end[2];
      const hubZ = endZ + 5,
        westX = 82.48954321 - 2.25;
      point = walkFlat(owner, point, [-3.2, 0, -80.175]);
      point = walkTo(owner, point, [11.2, -3, -80.175], 'Granville Bay pair');
      point = walkFlat(owner, point, [13, -3, -105.4]);
      point = walkFlat(owner, point, [75.2, -3, -100.6]);
      point = walkTo(
        owner,
        point,
        [75.2, upper, endZ + 0.6],
        'Granville 35 m Big 3',
      );
      point = walkFlat(owner, point, [westX + 0.6, upper, hubZ]);
      assert.equal(point.surfaceId, 'granville-upper');
      point = walkFlat(owner, point, [65.1, upper, hubZ - 3.1]);
      point = walkTo(
        owner,
        point,
        [51.9, lower, hubZ - 3.1],
        'Granville short lower connector',
      );
      point = walkFlat(owner, point, [westX + 0.6, lower, hubZ]);
      assert.equal(point.surfaceId, 'granville-lower');
    } finally {
      owner.dispose();
    }
  });

  if (id === 'granville')
    test('Granville: Seymour, Hudson unpaid passage and independent Dunsmuir platform paths remain continuous', () => {
      const owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
      const upper = data.platforms.find((p) =>
        p.surfaceId.endsWith('upper'),
      ).floorHeight;
      const lower = data.platforms.find((p) =>
        p.surfaceId.endsWith('lower'),
      ).floorHeight;
      try {
        const sx = 22.61400566,
          sz = -30.86257589,
          streetY = -2.07414,
          seymourY = 1.21093;
        let point = owner.floorAt(
          [sx, seymourY, sz],
          'granville-seymour-entrance',
        );
        point = walkFlat(owner, point, [sx + 1.8, seymourY, sz]);
        point = walkTo(
          owner,
          point,
          [sx + 12.2, streetY, sz],
          'Seymour entrance stairs',
        );
        point = walkFlat(owner, point, [69, streetY, sz]);
        point = walkFlat(owner, point, [69, streetY, -84.4]);
        point = walkFlat(owner, point, [70, streetY, -84.4]);
        point = walkTo(
          owner,
          point,
          [70, -3, -100.6],
          'Seymour original farehall graded passage',
        );
        point = walkFlat(owner, point, [75.2, -3, -101]);
        assert.equal(point.surfaceId, 'granville-original-ticket-hall');
        point = owner.floorAt([-5, 0, -104.3], 'granville-mall-entrance');
        point = walkFlat(owner, point, [-5, 0, -89]);
        point = walkFlat(owner, point, [16, 0, -89]);
        point = walkTo(
          owner,
          point,
          [66, streetY, -89],
          'Unpaid Hudson gentle grade',
        );
        point = walkFlat(owner, point, [70.11, streetY, -72.27427749]);
        point = walkTo(
          owner,
          point,
          [63.56, streetY - 3, -72.27427749],
          'Dunsmuir southwest entry stair',
        );
        point = walkFlat(owner, point, [52.76, streetY - 3, -75.87427749]);
        point = walkFlat(owner, point, [51.76, streetY - 3, -85.1]);
        point = walkFlat(owner, point, [61.46, streetY - 3, -85.03]);
        point = walkTo(
          owner,
          point,
          [61.46, upper, -58.14],
          'Independent Dunsmuir triple bank',
        );
        const westX = 82.48954321 - 2.25;
        point = walkFlat(owner, point, [westX + 0.6, upper, -53.74]);
        assert.equal(point.surfaceId, 'granville-upper');
        point = walkFlat(owner, point, [57.6, upper, -55.34]);
        point = walkTo(
          owner,
          point,
          [44.4, lower, -55.34],
          'Dunsmuir short lower connector',
        );
        point = walkFlat(owner, point, [westX + 0.6, lower, -53.74]);
        assert.equal(point.surfaceId, 'granville-lower');
      } finally {
        owner.dispose();
      }
    });
}

test('Granville round stainless concourse column blocks all eight radial approaches and permits reverse movement', () => {
  const s = rebuildGranville(
      packet.stations.find((s) => s.stationId === 'granville'),
    ),
    data = makeRuntimeStation(s, 'a'.repeat(64)),
    owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false),
    column = data.parts.find(
      (p) => p.id === 'granville-original-ticket-hall-round-column',
    ),
    faces = data.parts.filter((p) =>
      p.id.startsWith(`${column.id}-stainless-face-`),
    );
  try {
    assert.equal(faces.length, 16);
    for (const p of [column, ...faces])
      assert(
        data.obstacles.some((o) => o.id === p.id),
        `${p.id}: same physical geometry`,
      );
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2,
        dx = Math.sin(angle),
        dz = Math.cos(angle),
        start = [
          column.position[0] + dx * 1.1,
          -3,
          column.position[2] + dz * 1.1,
        ];
      let foot = owner.floorAt(start, 'granville-original-ticket-hall');
      assert(
        foot && owner.isClearFoot(foot),
        `radial approach ${i} is supported`,
      );
      for (let j = 0; j < 44; j++)
        foot = owner.walk(foot, -dx * 0.05, -dz * 0.05);
      const separation =
        (foot.position[0] - column.position[0]) * dx +
        (foot.position[2] - column.position[2]) * dz;
      assert(
        separation > 0.5 && separation < 0.85,
        `body stops at the complete round column: ${i}/${separation}`,
      );
      const away = owner.walk(foot, dx * 0.4, dz * 0.4);
      assert(
        (away.position[0] - foot.position[0]) * dx +
          (away.position[2] - foot.position[2]) * dz >
          0.35,
      );
    }
  } finally {
    owner.dispose();
  }
});
