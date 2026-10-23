import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
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

  test(`${id}: rebuilding retains both original train platforms and every train anchor`, () => {
    const original = packet.stations.find((s) => s.stationId === id);
    for (const platform of original.platforms) {
      assert.deepEqual(
        source.platforms.find((p) => p.platformId === platform.platformId),
        platform,
      );
      assert.deepEqual(
        source.floorSurfaces.find((f) => f.surfaceId === platform.surfaceId)
          .verticesM,
        original.floorSurfaces.find((f) => f.surfaceId === platform.surfaceId)
          .verticesM,
      );
    }
    for (const anchor of original.anchors.filter((a) =>
      ['vehicle-root-stop', 'platform-door'].includes(a.kind),
    ))
      assert.deepEqual(
        source.anchors.find((a) => a.id === anchor.id),
        anchor,
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
      const ascent =
        id === 'burrard'
          ? [
              [-7, 0, -82],
              [-7, -2.6, -74.4],
              [-5, -2.6, -70],
              [-5, -2.6, -61],
              [-5, upper, -46.4],
            ]
          : [
              [-4.175, 0, -99],
              [-4.175, -3, -91.4],
              [-5, -3, -90],
              [-5, -3, -78],
              [
                -5,
                -3,
                data.connections.find((c) => c.id === 'granville-big-three-2')
                  .start[2],
              ],
              [-5, upper, -45.4],
            ];
      for (const target of ascent)
        point = walkTo(owner, point, target, `${id} entrance/ticket/long bank`);
      for (const target of [
        [-5, upper, -40],
        [0, upper, -40],
        [0, upper, -36],
      ])
        point = walkTo(owner, point, target, `${id} upper platform`);
      assert.equal(point.surfaceId, `${id}-upper`);
      for (const target of [
        [0, upper, -40],
        [-13.4, upper, -40],
        [-13.4, upper, -43.5],
        [-14, upper, -43.5],
        [-26.6, lower, -43.5],
        [-27, lower, -45.9],
        [0, lower, -45.9],
        [0, lower, -36],
      ])
        point = walkTo(owner, point, target, `${id} lower platform connector`);
      assert.equal(point.surfaceId, `${id}-lower`);
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
        let point = owner.floorAt(
          [27.247, 0, -25.409],
          'granville-seymour-entrance',
        );
        for (const target of [
          [25.247, 0, -25.409],
          [16.647, -3, -25.409],
          [15.247, -3, -25.409],
          [15.247, -3, -85],
          [5, -3, -85],
        ])
          point = walkTo(
            owner,
            point,
            target,
            'Seymour to original ticket hall',
          );
        assert.equal(point.surfaceId, 'granville-original-ticket-hall');
        point = owner.floorAt([-5, 0, -104.3], 'granville-mall-entrance');
        for (const target of [
          [0, 0, -102],
          [49.108, 0, -102],
          [49.108, 0, -77],
        ])
          point = walkTo(owner, point, target, 'Unpaid Hudson Mall connection');
        assert.equal(point.surfaceId, 'granville-dunsmuir-street-hall');
        point = owner.floorAt(
          [49.108, 0, -62.3],
          'granville-dunsmuir-street-hall',
        );
        for (const target of [
          [49.108, 0, -69.667],
          [42.108, 0, -69.667],
          [7.508, upper, -69.667],
          [-11, upper, -69.667],
          [-11, upper, -46.4],
          [-11, upper, -40],
          [0, upper, -40],
          [0, upper, -36],
        ])
          point = walkTo(
            owner,
            point,
            target,
            'Dunsmuir bank to upper platform',
          );
        assert.equal(point.surfaceId, 'granville-upper');
        for (const target of [
          [0, upper, -40],
          [-11, upper, -40],
          [-11, upper, -69.667],
          [-13.4, upper, -69.667],
          [-13.4, upper, -71.167],
          [-14, upper, -71.167],
          [-26.6, lower, -71.167],
          [-27, lower, -73.567],
          [-11, lower, -73.567],
          [-11, lower, -46.4],
          [0, lower, -46.4],
          [0, lower, -36],
        ])
          point = walkTo(
            owner,
            point,
            target,
            'Dunsmuir short connector to lower platform',
          );
        assert.equal(point.surfaceId, 'granville-lower');
      } finally {
        owner.dispose();
      }
    });
}
