import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { stationSolidIndex } from './helpers/station-solid-index.mjs';
import { cityModule } from './helpers/city-modules.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildWaterfront } from '../tools/station-interiors/waterfront.mjs';
import {
  WATERFRONT_VIEWPOINTS,
  prepareWaterfrontViewpoint,
} from '../tools/station-interiors/capture-waterfront-views.mjs';
const { SkyTrainStationOwner, stationWorldPose } = await import(
  cityModule('skytrain-stations')
);
const { adaptSkyTrainStationFrame, validateSkyTrainRoutes } = await import(
  cityModule('skytrain-ride-path')
);
const { project, inPolygon } = await import(cityModule('geo'));
const original = JSON.parse(
  fs.readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
).stations.find((s) => s.stationId === 'waterfront');
const built = rebuildWaterfront(original),
  s = makeRuntimeStation(built, '0'.repeat(64));
const owner = () => new SkyTrainStationOwner(s, () => 0, 'balanced', false);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('Waterfront rendered platform-end walls reject supported bodies rather than allowing visible wall penetration', () => {
  const o = owner(),
    withoutWalls = structuredClone(s),
    ids = new Set(
      s.parts.filter((p) => /-portal-wall-/.test(p.id)).map((p) => p.id),
    );
  withoutWalls.obstacles = withoutWalls.obstacles.filter((p) => !ids.has(p.id));
  const missing = new SkyTrainStationOwner(
    withoutWalls,
    () => 0,
    'balanced',
    false,
  );
  try {
    const drawn = stationSolidIndex(o.group).boxes;
    assert.equal(
      ids.size,
      16,
      'four sides at both ends of all four retained platform tracks',
    );
    for (const id of ids) {
      const part = s.parts.find((p) => p.id === id),
        physical = s.obstacles.find((p) => p.id === id);
      assert(physical, `${id}: the visible end wall is physical`);
      for (const key of ['position', 'size', 'quaternion'])
        assert.deepEqual(physical[key], part[key]);
    }
    for (const [floorId, point, wallId] of [
      [
        'waterfront-expo-lift-lower',
        [-39.86750000000001, -7.044629622850913, -53.826],
        'waterfront-expo-eastbound-portal-wall--1--1',
      ],
      [
        'waterfront-canada-lift-lower',
        [56.811796860046634, -3.793629622850913, 24.276668099790996],
        'waterfront-canada-northbound-portal-wall--1-1',
      ],
    ]) {
      const foot = o.floorAt(point, floorId),
        unsafe = missing.floorAt(point, floorId);
      assert(foot && unsafe, 'retain the original supported floor triangles');
      assert(
        missing.isClearFoot(unsafe),
        'negative fixture reproduces the previously accepted wall intersection',
      );
      const body = new OBB(
        new THREE.Vector3(...point).add(new THREE.Vector3(0, 0.85, 0)),
        new THREE.Vector3(0.24, 0.85, 0.24),
      );
      assert(
        drawn.find((p) => p.id === wallId)?.box.intersectsOBB(body),
        'the actual rendered wall intersects the complete standing body',
      );
      assert(
        !o.isClearFoot(foot),
        'the unchanged visible wall now correctly rejects that body',
      );
    }
  } finally {
    missing.dispose();
    o.dispose();
  }
});

test('Waterfront Canada north lift uses a body-clear island-side slot beside the retained train tunnel wall', () => {
  const o = owner();
  try {
    const floor = s.floors.find(
        (f) => f.id === 'waterfront-canada-lift-passage-0',
      ),
      start = s.connections.find(
        (c) => c.id === 'canada-lift-lower-passage',
      ).start,
      end = s.connections.find(
        (c) => c.id === 'canada-lift-passage-platform',
      ).start,
      tangent = new THREE.Vector3(...end)
        .sub(new THREE.Vector3(...start))
        .normalize(),
      across = new THREE.Vector3(tangent.z, 0, -tangent.x),
      solids = stationSolidIndex(o.group);
    assert(floor && start && end);
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9])
      for (const side of [-0.15, 0, 0.15]) {
        const p = new THREE.Vector3(...start)
            .lerp(new THREE.Vector3(...end), t)
            .addScaledVector(across, side),
          foot = o.floorAt(p.toArray(), floor.id);
        assert(
          foot && o.isClearFoot(foot),
          'supported aisle centres clear both physical walls with the whole capsule',
        );
        const body = new OBB(
          p.clone().add(new THREE.Vector3(0, 0.875, 0)),
          new THREE.Vector3(0.24, 0.825, 0.24),
        );
        assert.equal(
          solids.firstIntersection(body),
          null,
          'actual emitted structure clears the standing body above the contact plane',
        );
      }
    const width = new THREE.Vector3(...floor.vertices[3]).distanceTo(
      new THREE.Vector3(...floor.vertices[0]),
    );
    assert(
      Math.abs(width - 1.1) < 1e-8,
      'retain the explicitly inferred0.9m clear aisle plus its two wall half-thicknesses',
    );
  } finally {
    o.dispose();
  }
});

function straight(o, foot, goal, strict = true) {
  const origin = `${foot.surfaceId} ${foot.position}`;
  const dx = goal[0] - foot.position[0],
    dz = goal[2] - foot.position[2];
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.045));
  for (let i = 0; i < count; i++) {
    const next = o.walk(foot, dx / count, dz / count);
    assert(
      Math.abs(next.position[1] - foot.position[1]) <= 0.221,
      'a step cannot teleport between floors',
    );
    assert(
      o.isClearFoot(next),
      `${o.data.id}: capsule loses supported clearance`,
    );
    foot = next;
  }
  if (strict) {
    assert(
      distance(foot.position, goal) < 0.17,
      `${o.data.id}: blocked waypoint ${goal}; stopped ${foot.position}; from ${origin}`,
    );
    assert(
      Math.abs(foot.position[1] - goal[1]) < 0.23,
      `${o.data.id}: wrong level at ${goal}`,
    );
  }
  return foot;
}

/** Plan only flat-room movement. Every proposed edge is executed by the real
 * capsule walker; stairs themselves are always traversed tread by tread. */
function flat(o, initial, goal) {
  const direct = straight(o, initial, goal, false);
  if (
    distance(direct.position, goal) < 0.13 &&
    Math.abs(direct.position[1] - goal[1]) < 0.23
  )
    return direct;
  const step = 0.3,
    key = (f) =>
      `${Math.round((f.position[0] - initial.position[0]) / step)},${Math.round((f.position[2] - initial.position[2]) / step)},${f.surfaceId}`;
  const queue = [
      { foot: initial, cost: 0, score: distance(initial.position, goal) },
    ],
    best = new Map([[key(initial), 0]]);
  let iterations = 0;
  while (queue.length && iterations++ < 12000) {
    queue.sort((a, b) => b.score - a.score);
    const node = queue.pop();
    if (distance(node.foot.position, goal) < 0.7) {
      const end = straight(o, node.foot, goal, false);
      if (
        distance(end.position, goal) < 0.13 &&
        Math.abs(end.position[1] - goal[1]) < 0.23
      )
        return end;
    }
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const dx = x * step,
        dz = z * step,
        next = o.walk(node.foot, dx, dz);
      if (
        distance(next.position, [
          node.foot.position[0] + dx,
          next.position[1],
          node.foot.position[2] + dz,
        ]) > 0.015 ||
        Math.min(
          Math.abs(next.position[1] - initial.position[1]),
          Math.abs(next.position[1] - goal[1]),
        ) > 0.28
      )
        continue;
      const k = key(next),
        cost = node.cost + Math.hypot(dx, dz);
      if (cost >= (best.get(k) ?? Infinity)) continue;
      best.set(k, cost);
      queue.push({
        foot: next,
        cost,
        score: cost + distance(next.position, goal),
      });
    }
  }
  assert.fail(
    `${o.data.id}: no physically supported flat route from ${initial.position} to ${goal}`,
  );
}

function path(s, from, to, allowElevator = false) {
  const queue = [from],
    seen = new Set(queue),
    previous = new Map();
  for (const id of queue) {
    if (id === to) break;
    for (const c of s.connections.filter(
      (c) => allowElevator || c.type !== 'elevator',
    )) {
      const next = c.from === id ? c.to : c.to === id ? c.from : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { surface: id, connection: c });
      queue.push(next);
    }
  }
  if (!seen.has(to)) return null;
  const result = [];
  while (to !== from) {
    const p = previous.get(to);
    result.unshift({
      connection: p.connection,
      forward: p.connection.from === p.surface,
    });
    to = p.surface;
  }
  return result;
}

test('Waterfront mapped v3: every flight supports the actual walker in both directions', () => {
  const o = owner();
  try {
    for (const c of s.connections.filter((c) => c.treads.length))
      for (const forward of [true, false]) {
        const start = forward ? c.start : c.end,
          end = forward ? c.end : c.start;
        const foot = o.floorAt(start, forward ? c.from : c.to);
        assert(
          foot && o.isClearFoot(foot),
          `${c.id}: blocked ${forward ? 'start' : 'return'} landing`,
        );
        straight(o, foot, end);
      }
  } finally {
    o.dispose();
  }
});
test('Waterfront mapped v3: all walking entrances reach both islands and return continuously', () => {
  const o = owner();
  try {
    for (const e of s.entrances.filter((e) => e.id !== 'granville-canada-lift'))
      for (const platform of new Map(
        s.platforms.map((p) => [p.surfaceId, p]),
      ).values()) {
        const inward = e.inwardDirection ?? [0, 0, 1];
        const starts = [0.4, -0.4, 0].map((offset) =>
          e.point.map((n, i) => n + inward[i] * offset),
        );
        const first = starts
          .map((point) => o.floorAt(point, e.surfaceId))
          .find((foot) => foot && o.isClearFoot(foot));
        const start = first?.position;
        let foot = first;
        assert(foot && o.isClearFoot(foot), `${e.id}: no clear doorway`);
        const chain = path(s, e.surfaceId, platform.surfaceId);
        for (const { connection: c, forward } of chain) {
          foot = flat(o, foot, forward ? c.start : c.end);
          foot = c.treads.length
            ? straight(o, foot, forward ? c.end : c.start)
            : flat(o, foot, forward ? c.end : c.start);
        }
        assert(o.floorAt(foot.position, platform.surfaceId));
        for (const { connection: c, forward } of [...chain].reverse()) {
          foot = flat(o, foot, forward ? c.end : c.start);
          foot = c.treads.length
            ? straight(o, foot, forward ? c.start : c.end)
            : flat(o, foot, forward ? c.start : c.end);
        }
        flat(o, foot, start);
      }
  } finally {
    o.dispose();
  }
});
test('Waterfront mapped v3: platform seats and every boarding door stay physically clear', () => {
  const o = owner();
  try {
    for (const p of s.platforms)
      for (const d of o.boardingDoors(p.line, p.direction))
        assert(o.isClearFoot(d.waiting), d.id);
    for (const seat of o.benchSeats())
      assert(o.isClearFoot(seat.stand), seat.id);
  } finally {
    o.dispose();
  }
});
test('Waterfront mapped v3: step counts, mapped entries and graded walkway are explicit', () => {
  assert.equal(
    s.connections.find((c) => c.id === 'waterfront-granville-stairs').treads
      .length,
    42,
  );
  assert.equal(
    s.connections.find((c) => c.id === 'waterfront-canada-south-stairs').treads
      .length,
    24,
  );
  assert.equal(
    s.connections.filter((c) => c.id.startsWith('waterfront-howe-upper-'))
      .length,
    3,
  );
  assert.equal(
    s.connections.filter(
      (c) =>
        c.id.startsWith('waterfront-expo-platform-') && c.type === 'escalator',
    ).length,
    2,
  );
  const ramps = built.floorSurfaces.filter(
    (f) =>
      f.surfaceId.startsWith('waterfront-under-cordova-passage-') &&
      new Set(f.verticesM.map((p) => p[1].toFixed(5))).size > 1,
  );
  assert.equal(ramps.length, 3);
  for (const f of ramps)
    assert(
      new Set(f.verticesM.map((p) => p[1].toFixed(5))).size > 1,
      'walkway uses real graded triangles',
    );
  assert(s.entrances.some((e) => e.id === 'howe-expo'));
  assert(s.entrances.some((e) => e.id === 'granville-canada-lift'));
  const repeat = rebuildWaterfront(built);
  assert.equal(repeat.connections.length, built.connections.length);
  assert.equal(repeat.geometryParts.length, built.geometryParts.length);
  for (const p of built.platforms) {
    const twice = repeat.platforms.find((q) => q.platformId === p.platformId);
    assert(
      Math.hypot(
        ...p.stopPosition.translationM.map(
          (n, i) => n - twice.stopPosition.translationM[i],
        ),
      ) < 1e-7,
    );
  }
});

test('Waterfront mapped v3: separate Granville lift follows a step-free two-core route to the island and back', () => {
  const o = owner();
  try {
    const e = s.entrances.find((e) => e.id === 'granville-canada-lift'),
      platform = s.platforms.find((p) => p.line === 'canada');
    const queue = [e.surfaceId],
      previous = new Map(),
      seen = new Set(queue);
    for (const id of queue) {
      if (id === platform.surfaceId) break;
      for (const c of s.connections.filter(
        (c) => c.type === 'walk' || c.type === 'elevator',
      )) {
        const next = c.from === id ? c.to : c.to === id ? c.from : null;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        previous.set(next, { surface: id, connection: c });
        queue.push(next);
      }
    }
    assert(
      seen.has(platform.surfaceId),
      'the separate street lift needs a complete step-free graph, including its platform lift',
    );
    let id = platform.surfaceId;
    const chain = [];
    while (id !== e.surfaceId) {
      const p = previous.get(id);
      chain.unshift({
        connection: p.connection,
        forward: p.connection.from === p.surface,
      });
      id = p.surface;
    }
    assert.equal(
      chain.filter((p) => p.connection.type === 'elevator').length,
      2,
      'street/concourse and island lifts must not become a flat track crossing',
    );
    const start = e.point.map(
      (v, i) => v + (e.inwardDirection ?? [0, 0, -1])[i] * 0.3,
    );
    let foot = o.floorAt(start, e.surfaceId);
    assert(foot && o.isClearFoot(foot));
    for (const reverse of [false, true])
      for (const { connection: c, forward: raw } of reverse
        ? [...chain].reverse()
        : chain) {
        const forward = reverse ? !raw : raw;
        foot = flat(o, foot, forward ? c.start : c.end);
        if (c.type === 'elevator') {
          const target = o.floorAt(
            forward ? c.end : c.start,
            forward ? c.to : c.from,
          );
          assert(
            target && o.isClearFoot(target),
            'lift endpoints require supported cabin floors',
          );
          foot = target;
        } else foot = flat(o, foot, forward ? c.end : c.start);
      }
    flat(o, foot, start);
  } finally {
    o.dispose();
  }
});

test('Waterfront mapped v3: complete boarding transforms preserve carriage-local contracts and measured gaps', () => {
  for (const p of built.platforms) {
    const base = original.platforms.find((q) => q.platformId === p.platformId);
    for (const d of p.doorAlignmentPoints) {
      const before = base.doorAlignmentPoints.find((v) => v.id === d.id);
      for (const key of [
        'carIndex',
        'carLocalDoorZ',
        'consistLocalSillPointM',
        'carLocalSillPointM',
        'carLocalSide',
        'carPoseInConsist',
        'horizontalThresholdGapM',
        'verticalDifferenceM',
        'openingWidthM',
        'boardingSide',
      ])
        assert.deepEqual(
          d[key],
          before[key],
          `${p.platformId}/${key} is carriage-local or an actual gap contract`,
        );
      assert(
        Math.abs(
          Math.hypot(
            d.platformEdgePointM[0] - d.stationSillPointM[0],
            d.platformEdgePointM[2] - d.stationSillPointM[2],
          ) - d.horizontalThresholdGapM,
        ) < 1e-7,
      );
      assert(Math.abs(d.stationSillPointM[1] - p.floorHeightM) < 1e-7);
    }
    assert(
      built.trackExclusionVolumes.some((e) => e.id === p.trackExclusionId),
    );
  }
  for (const bridge of built.thresholdBridges) {
    const before = original.thresholdBridges.find(
      (b) => b.instanceId === bridge.instanceId,
    );
    for (let i = 0; i < bridge.deployedFloor.verticesM.length; i++) {
      const p = bridge.deployedFloor.verticesM[i],
        q = before.deployedFloor.verticesM[i];
      assert(
        Math.abs(
          p[1] -
            bridge.deployedFloor.verticesM[0][1] -
            (q[1] - before.deployedFloor.verticesM[0][1]),
        ) < 1e-7,
        "a rigid edit preserves the bridge's real 15 mm rise",
      );
    }
    assert(bridge.sequence.length > 0);
  }
});

test('Waterfront mapped v3: Cordova accessible paths walk every lift bypass to both islands', () => {
  const o = owner();
  try {
    for (const platform of new Map(
      s.platforms.map((p) => [p.surfaceId, p]),
    ).values()) {
      const from = s.entrances.find((e) => e.id === 'cordova-lobby').surfaceId,
        queue = [from],
        seen = new Set(queue),
        previous = new Map();
      for (const id of queue) {
        if (id === platform.surfaceId) break;
        for (const c of s.connections.filter((c) =>
          ['walk', 'elevator'].includes(c.type),
        )) {
          const next = c.from === id ? c.to : c.to === id ? c.from : null;
          if (!next || seen.has(next)) continue;
          seen.add(next);
          previous.set(next, { surface: id, connection: c });
          queue.push(next);
        }
      }
      assert(
        seen.has(platform.surfaceId),
        'Cordova requires an accessible path to both lines',
      );
      let id = platform.surfaceId;
      const chain = [];
      while (id !== from) {
        const p = previous.get(id);
        chain.unshift({
          connection: p.connection,
          forward: p.connection.from === p.surface,
        });
        id = p.surface;
      }
      const primary = s.entrances.find((e) => e.id === 'cordova-lobby');
      const origin = o.floorAt(
        primary.point.map(
          (v, i) => v + (primary.inwardDirection ?? [0, 0, 1])[i] * 0.4,
        ),
        from,
      );
      let foot = origin;
      for (const reverse of [false, true])
        for (const { connection: c, forward: raw } of reverse
          ? [...chain].reverse()
          : chain) {
          const forward = reverse ? !raw : raw;
          foot = flat(o, foot, forward ? c.start : c.end);
          if (c.type === 'elevator') {
            foot = o.floorAt(
              forward ? c.end : c.start,
              forward ? c.to : c.from,
            );
            assert(
              foot && o.isClearFoot(foot),
              'lift travel ends on its physical landing',
            );
          } else foot = flat(o, foot, forward ? c.end : c.start);
        }
      flat(o, foot, origin.position);
    }
  } finally {
    o.dispose();
  }
});

test('Waterfront mapped v3: staged surveyed Cordova anchor keeps all four street doors within 25 cm of real references', () => {
  const routes = validateSkyTrainRoutes(
    JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
  );
  // The registry is intentionally switched only when phase4 assets are
  // generated. Replay that explicitly staged primary anchor without mutating
  // the shared runtime registry used by the still-deployed phase1 fixture.
  const adapted = {
    ...adaptSkyTrainStationFrame(s, routes),
    lonlat: [...built.authoredInterior.mappedHorizontalBasis.datumLonLat],
  };
  const refs = {
    'cordova-lobby': [-123.1120035, 49.2856425, 0],
    'howe-expo': [-123.113392, 49.2868766, 2.14722793448],
    'granville-canada': [-123.114375, 49.285054, 7.20667588571],
    'granville-canada-lift': [-123.1141964, 49.285239, 6.70080067658],
  };
  for (const [id, lonlat] of Object.entries(refs)) {
    const entrance = adapted.entrances.find((e) => e.id === id);
    assert(
      Math.abs(entrance.point[1] - lonlat[2]) < 0.01,
      `${id}: street height follows its own ground sample`,
    );
    const actual = stationWorldPose(adapted, () => 0, entrance.point).position,
      expected = project(lonlat);
    assert(
      Math.hypot(actual[0] - expected[0], actual[2] - expected[1]) < 0.25,
      `${id}: geographic threshold drift`,
    );
  }
});

test('Waterfront mapped v3: primary datum correction preserves the verified world section and all boarding anchors', () => {
  const {
    datumGroundDemM: base,
    previousDatumGroundDemM: oldBase,
    sourceVerticalRebaseM: dy,
    heritageHallFloorYM: hallY,
    primaryThresholdHeightM: step,
  } = built.authoredInterior.verticalInference;
  assert(Math.abs(base + dy - oldBase) < 1e-10);
  assert(Math.abs(base + hallY - oldBase) < 1e-10);
  assert(step > 0 && step < 0.05);
  assert.equal(
    built.authoredInterior.mappedHorizontalBasis.primaryDoorReference,
    'https://www.openstreetmap.org/node/1692226746',
  );
  for (const p of built.platforms) {
    const worldExpected =
      p.lineId === 'expo' ? 6.105608777147175 : 9.356608777147175;
    assert(Math.abs(p.floorHeightM + base - worldExpected) < 1e-8);
    const stop = built.anchors.find(
      (a) => a.kind === 'vehicle-root-stop' && a.id === p.platformId + '-stop',
    );
    assert(stop);
    assert(
      Math.hypot(
        ...stop.pointM.map((n, i) => n - p.stopPosition.translationM[i]),
      ) < 1e-7,
    );
    for (const d of p.doorAlignmentPoints) {
      const a = built.anchors.find(
        (a) => a.kind === 'platform-door' && a.id === d.id,
      );
      assert(a);
      assert(
        Math.hypot(...a.pointM.map((n, i) => n - d.platformEdgePointM[i])) <
          1e-7,
      );
    }
  }
});

test('Waterfront Cordova: adapted entry follows the mapped public approach northeast into the actual heritage footprint', () => {
  const routes = validateSkyTrainRoutes(
      JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
    ),
    adapted = {
      ...adaptSkyTrainStationFrame(s, routes),
      lonlat: [...built.authoredInterior.mappedHorizontalBasis.datumLonLat],
    },
    o = new SkyTrainStationOwner(adapted, () => 0, 'balanced', false);
  try {
    // Independent current OSM source: outside way364284185 joins door1692226746;
    // indoor way1446762153 continues to these two points in the heritage nave.
    const mapped = [
        [-123.1120325, 49.2856245],
        [-123.1120035, 49.2856425],
        [-123.1119318, 49.28569],
        [-123.1118684, 49.2857315],
      ].map((p) => {
        const [x, z] = project(p);
        return o.toLocal([x, 0, z]);
      }),
      entry = adapted.entrances.find((e) => e.id === 'cordova-lobby'),
      normal = new THREE.Vector3(...mapped[2])
        .sub(new THREE.Vector3(...mapped[1]))
        .setY(0)
        .normalize(),
      inward = new THREE.Vector3(...entry.inwardDirection);
    assert(normal.dot(inward) > 0.999999999);
    const world = inward.clone().applyQuaternion(o.group.quaternion),
      bearing =
        (THREE.MathUtils.radToDeg(Math.atan2(world.x, -world.z)) + 360) % 360;
    assert(Math.abs(bearing - 44.55555277232628) < 1e-7);
    assert(
      new THREE.Vector3(...mapped[0])
        .sub(new THREE.Vector3(...mapped[1]))
        .dot(inward) < 0,
    );
    let foot = o.floorAt(
      entry.point.map((n, i) => n + entry.inwardDirection[i] * 0.4),
      entry.surfaceId,
    );
    assert(foot && o.isClearFoot(foot));
    for (const point of mapped.slice(2))
      foot = straight(o, foot, [point[0], foot.position[1], point[2]]);
    assert.equal(foot.surfaceId, 'waterfront-heritage-hall');
    // Continue physically left along the hall to the retained Canada bank.
    const canadaHead = adapted.connections.find(
      (c) => c.id === 'waterfront-canada-lobby-up-hall',
    );
    const origin = foot;
    foot = flat(o, foot, canadaHead.start);
    straight(o, foot, canadaHead.end);
    foot = flat(o, foot, origin.position);
    straight(
      o,
      foot,
      entry.point.map((n, i) =>
        i === 1 ? foot.position[1] : n + entry.inwardDirection[i] * 0.4,
      ),
    );

    const building = JSON.parse(
        fs.readFileSync('public/data/buildings.geojson'),
      ).features.find((f) => f.properties.sourceIds?.includes('osm-78393326')),
      polygon = building.geometry.coordinates.map((ring) => ring.map(project)),
      ring = polygon[0],
      segmentDistance = (p, a, b) => {
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz),
            ),
          );
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
      };
    for (const id of [
      'waterfront-heritage-hall',
      'waterfront-heritage-entry-vestibule',
    ]) {
      const f = adapted.floors.find((f) => f.id === id);
      for (const point of f.vertices) {
        const w = o.toWorld(point),
          p = [w[0], w[2]],
          boundary = Math.min(
            ...ring.slice(1).map((b, i) => segmentDistance(p, ring[i], b)),
          );
        assert(
          inPolygon(p, polygon) || boundary < 0.15,
          `${id}: an authored public nave corner cannot extend into the street outside the true heritage footprint (${p.join(',')})`,
        );
      }
    }
  } finally {
    o.dispose();
  }
});

test('Waterfront Howe: five real gate lanes separate the unpaid mall junction from the lower platform bank', () => {
  const o = owner();
  try {
    const boundary = s.authoredInterior.howeFareBoundary,
      readers = s.parts
        .filter(
          (p) =>
            p.role === 'faregate' &&
            p.id.startsWith('waterfront-howe-fares-reader-'),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      entrance = s.entrances.find((e) => e.id === 'howe-expo'),
      mall = s.floors.find((f) => f.id === 'waterfront-howe-mall-vestibule-0');
    assert.equal(
      readers.length,
      6,
      'the primary photograph shows six housings and five lanes',
    );
    assert.equal(boundary.lanes, 5);
    assert.equal(
      s.connections.filter(
        (c) =>
          c.id.startsWith('waterfront-howe-upper-') && c.type === 'escalator',
      ).length,
      2,
    );
    assert.equal(
      s.connections.filter(
        (c) =>
          c.id.startsWith('waterfront-howe-lower-') && c.type === 'escalator',
      ).length,
      1,
    );
    assert(
      path(s, entrance.surfaceId, 'waterfront-expo').some(
        ({ connection }) => connection.id === boundary.boundaryConnectionId,
      ),
    );
    assert.equal(
      path(
        {
          ...s,
          connections: s.connections.filter(
            (c) => c.id !== boundary.boundaryConnectionId,
          ),
        },
        entrance.surfaceId,
        'waterfront-expo',
      ),
      null,
      'the street route cannot bypass the paid boundary through the public mall',
    );
    const mallPath = path(s, entrance.surfaceId, mall.id);
    assert(
      mallPath &&
        mallPath.every(
          ({ connection }) => connection.id !== boundary.boundaryConnectionId,
        ),
      'the commercial branch remains entirely outside the fare boundary',
    );
    const inward = entrance.inwardDirection;
    let foot = [0.4, -0.4, 0]
      .map((offset) =>
        o.floorAt(
          entrance.point.map((n, i) => n + inward[i] * offset),
          entrance.surfaceId,
        ),
      )
      .find((p) => p && o.isClearFoot(p));
    assert(foot);
    const origin = foot;
    for (const reverse of [false, true]) {
      for (const { connection: c, forward: raw } of reverse
        ? [...mallPath].reverse()
        : mallPath) {
        const forward = reverse ? !raw : raw;
        foot = flat(o, foot, forward ? c.start : c.end);
        foot = c.treads.length
          ? straight(o, foot, forward ? c.end : c.start)
          : flat(o, foot, forward ? c.end : c.start);
      }
      if (!reverse) {
        const center = mall.vertices[0].map(
          (_, i) =>
            mall.vertices.reduce((n, p) => n + p[i], 0) / mall.vertices.length,
        );
        foot = flat(o, foot, center);
      }
    }
    flat(o, foot, origin.position);

    const direction = new THREE.Vector3(...boundary.directionToPlatformM),
      across = new THREE.Vector3(...readers.at(-1).position)
        .sub(new THREE.Vector3(...readers[0].position))
        .setY(0)
        .normalize(),
      gateCentre = new THREE.Vector3(...readers[0].position)
        .add(new THREE.Vector3(...readers.at(-1).position))
        .multiplyScalar(0.5);
    gateCentre.y -= 0.53;
    for (let i = 0; i < readers.length - 1; i++) {
      const center = new THREE.Vector3(...readers[i].position)
        .add(new THREE.Vector3(...readers[i + 1].position))
        .multiplyScalar(0.5);
      center.y = gateCentre.y;
      const a = center.clone().addScaledVector(direction, -0.95).toArray(),
        b = center.clone().addScaledVector(direction, 0.95).toArray();
      let laneFoot = o.floorAt(a, boundary.unpaidSurfaceId);
      assert(
        laneFoot && o.isClearFoot(laneFoot),
        `gate lane ${i}: unsupported city-side approach`,
      );
      laneFoot = straight(o, laneFoot, b);
      assert.equal(laneFoot.surfaceId, boundary.paidSurfaceId);
      straight(o, laneFoot, a);
    }
    for (const side of [-1, 1]) {
      // Probe the only possible outer sliver with the full passenger capsule.
      // The end housing merges into the enclosing wall, so it is not a lane.
      const a = gateCentre
          .clone()
          .addScaledVector(across, side * 3.12)
          .addScaledVector(direction, -0.95)
          .toArray(),
        b = gateCentre
          .clone()
          .addScaledVector(across, side * 3.12)
          .addScaledVector(direction, 0.95)
          .toArray(),
        start = o.floorAt(a, boundary.unpaidSurfaceId);
      // A wall may already reject that narrow outer approach. If the full
      // body can stand there, its real attempted motion must still stop.
      if (start && o.isClearFoot(start)) {
        const stopped = straight(o, start, b, false);
        assert(
          distance(stopped.position, b) > 0.5,
          'no passenger can squeeze outside an end housing',
        );
      }
      const outside = gateCentre
          .clone()
          .addScaledVector(across, side * 3.7)
          .addScaledVector(direction, -0.95)
          .toArray(),
        unsupported = o.floorAt(outside, boundary.unpaidSurfaceId);
      assert(
        !unsupported || !o.isClearFoot(unsupported),
        'no invisible floor bypass exists beyond the side walls',
      );
    }
  } finally {
    o.dispose();
  }
});

test('Waterfront Expo annex: visible fare lanes and the mapped lift door retain a full passenger exit apron', () => {
  const o = owner();
  try {
    const readers = s.parts
        .filter(
          (p) =>
            p.role === 'faregate' &&
            p.id.startsWith('waterfront-expo-fares-reader-'),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      floorId = 'waterfront-expo-paid-annex',
      gateZ = readers[0].position[2],
      floorY = readers[0].position[1] - 0.53;
    for (let i = 0; i < readers.length - 1; i++) {
      const x = (readers[i].position[0] + readers[i + 1].position[0]) / 2,
        a = [x, floorY, gateZ - 1],
        b = [x, floorY, gateZ + 1];
      let foot = o.floorAt(a, floorId);
      assert(foot && o.isClearFoot(foot));
      foot = straight(o, foot, b);
      straight(o, foot, a);
    }
    for (const x of [-48.2, -37.3]) {
      const a = [x, floorY, gateZ - 1],
        b = [x, floorY, gateZ + 1],
        foot = o.floorAt(a, floorId);
      assert(foot && o.isClearFoot(foot));
      assert(
        distance(straight(o, foot, b, false).position, b) > 0.5,
        'the visible side barrier prevents a paid-line edge bypass',
      );
    }
    const lift = s.authoredInterior.elevatorLandings.find(
        (l) => l.floorId === floorId,
      ),
      start = o.floorAt(lift.pointM, floorId);
    assert(start && o.isClearFoot(start));
    const outside = lift.pointM.map(
        (n, i) => n + lift.outwardDirectionM[i] * 1.65,
      ),
      end = straight(o, start, outside);
    straight(o, end, lift.pointM);
  } finally {
    o.dispose();
  }
});

test('Waterfront heritage Canada bank: shared landings close the lane gaps without covering live treads', () => {
  const o = owner();
  try {
    const upper = s.floors.find(
        (f) => f.id === 'waterfront-canada-lobby-full-bank-upper-landing',
      ),
      lower = s.floors.find(
        (f) => f.id === 'waterfront-canada-lobby-full-bank-lower-landing',
      ),
      centre = (f) =>
        f.vertices
          .reduce(
            (sum, p) => sum.add(new THREE.Vector3(...p)),
            new THREE.Vector3(),
          )
          .multiplyScalar(1 / f.vertices.length),
      direction = centre(lower).sub(centre(upper)).setY(0).normalize(),
      projection = (p) => new THREE.Vector3(...p).dot(direction),
      flights = s.connections.filter(
        (c) => c.id.startsWith('waterfront-canada-lobby-') && c.treads.length,
      );
    assert.equal(flights.length, 3);
    const upperEnd = Math.max(...upper.vertices.map(projection)),
      lowerStart = Math.min(...lower.vertices.map(projection));
    for (const c of flights) {
      assert(
        projection(c.start) - upperEnd >= 0.02,
        `${c.id}: a flat upper cap must finish before the live first tread`,
      );
      assert(
        lowerStart - projection(c.end) >= 0.02,
        `${c.id}: a flat lower cap must begin after the staggered last tread`,
      );
    }
    for (const f of [upper, lower]) {
      const c = centre(f),
        across = new THREE.Vector3(...f.vertices[3])
          .sub(new THREE.Vector3(...f.vertices[0]))
          .setY(0),
        halfWidth = across.length() / 2;
      across.normalize();
      const a = c
          .clone()
          .addScaledVector(across, -halfWidth + 0.4)
          .toArray(),
        b = c
          .clone()
          .addScaledVector(across, halfWidth - 0.4)
          .toArray(),
        foot = o.floorAt(a, f.id);
      assert(foot && o.isClearFoot(foot), `${f.id}: real full-width support`);
      // The real under-Cordova passage wall enters the lower landing at an
      // angle. Walk around its end; a line through that solid wall is not a
      // valid cross-bank path.
      const end = flat(o, foot, b);
      flat(o, end, a);
      // A mesh must physically back the entire cross-bank landing, not only
      // the three narrow graph lanes which happened to pass earlier tests.
      for (
        let offset = -halfWidth + 0.4;
        offset <= halfWidth - 0.4;
        offset += 0.4
      ) {
        const p = c.clone().addScaledVector(across, offset),
          hit = renderedRay(
            o,
            p.clone().add(new THREE.Vector3(0, 0.3, 0)),
            new THREE.Vector3(0, -1, 0),
            0.6,
            (id) => id === `floor-${f.id}`,
          );
        assert(hit, `${f.id}: rendered slab missing between live lanes`);
      }
    }
  } finally {
    o.dispose();
  }
});

function renderedRay(o, origin, direction, far, matches) {
  o.group.updateMatrixWorld(true);
  const worldOrigin = new THREE.Vector3(...o.toWorld(origin.toArray())),
    worldDirection = direction.clone().transformDirection(o.group.matrixWorld);
  return new THREE.Raycaster(worldOrigin, worldDirection, 0, far)
    .intersectObject(o.group, true)
    .find((hit) =>
      matches(
        hit.object.userData.stationTrianglePartIds?.[hit.faceIndex] ??
          hit.object.userData.stationPartIds?.[hit.instanceId],
      ),
    );
}

test('Waterfront covered passages retain real roofs across full-width miter corners and the former first-person sky slit', () => {
  const o = owner();
  try {
    const parts = new Map(s.parts.map((p) => [p.id, p])),
      covered = s.floors.filter((f) =>
        s.parts.some(
          (p) =>
            p.renderFloorSurfaceId === f.id && parts.has(`${f.id}-ceiling`),
        ),
      ),
      isRoof = (id) => /ceiling|soffit|roof/.test(parts.get(id)?.role ?? '');
    assert.equal(covered.length, 20);
    let probes = 0;
    for (const floor of covered)
      for (let offset = 0; offset < floor.indices.length; offset += 3) {
        const [a, b, c] = floor.indices
          .slice(offset, offset + 3)
          .map((i) => new THREE.Vector3(...floor.vertices[i]));
        // Include near-boundary points that cannot hold a passenger capsule:
        // they still form the visible roof/wall perimeter of the enclosure.
        for (const u of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.998])
          for (const v of [0.001, 0.05, 0.25, 0.5, 0.75, 0.95, 0.998]) {
            if (u + v >= 1) continue;
            const point = a
                .clone()
                .multiplyScalar(u)
                .addScaledVector(b, v)
                .addScaledVector(c, 1 - u - v),
              hit = renderedRay(
                o,
                point.clone().add(new THREE.Vector3(0, 2, 0)),
                new THREE.Vector3(0, 1, 0),
                2.2,
                isRoof,
              );
            assert(
              hit,
              `${floor.id}: uncovered roof corner at ${point.toArray()}`,
            );
            assert(
              hit.distance >= 0.5,
              `${floor.id}: roof infill retains standing headroom`,
            );
            probes++;
          }
      }
    assert(probes >= 900);

    const spec = WATERFRONT_VIEWPOINTS.find(
        (v) => v.label === 'under-cordova-graded-passage-1-of-three',
      ),
      view = prepareWaterfrontViewpoint(spec, o),
      eye = new THREE.Vector3(...o.toWorld(view.foot)).add(
        new THREE.Vector3(0, 1.65, 0),
      ),
      camera = new THREE.PerspectiveCamera(65, 1.44, 0.05, 2000);
    camera.position.copy(eye);
    camera.lookAt(new THREE.Vector3(...o.toWorld(view.target)));
    camera.updateMatrixWorld(true);
    o.group.updateMatrixWorld(true);
    for (const x of [1200, 1220, 1240, 1260, 1280])
      for (const y of [416, 420]) {
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(x / 720 - 1, 1 - y / 500), camera);
        const hit = ray.intersectObject(o.group, true)[0],
          id =
            hit?.object.userData.stationTrianglePartIds?.[hit.faceIndex] ??
            hit?.object.userData.stationPartIds?.[hit.instanceId];
        assert(
          id?.startsWith('waterfront-under-cordova-passage-') && isRoof(id),
          `former far-bend sky pixel ${x}/${y} must hit its actual enclosing roof`,
        );
      }
  } finally {
    o.dispose();
  }
});

test('Waterfront lift-cross landing excludes only the true retaining-plinth slice and retains its supported centre route', () => {
  const o = owner();
  try {
    const floorId = 'waterfront-canada-cordova-lift-cross-0',
      floor = s.floors.find((f) => f.id === floorId),
      bank = s.parts.find(
        (p) => p.id === 'waterfront-canada-lobby-bank-underslab',
      ),
      slab = s.parts.find((p) => p.id === `floor-${floorId}`),
      rotation = new THREE.Quaternion(...bank.quaternion),
      matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...bank.position),
        rotation,
        new THREE.Vector3(1, 1, 1),
      ),
      solid = new OBB(
        new THREE.Vector3(),
        new THREE.Vector3(...bank.size).multiplyScalar(0.5),
      ).applyMatrix4(matrix),
      inverse = matrix.clone().invert(),
      y = floor.vertices[0][1];
    assert.equal(bank.size[1], 0.2, 'the actual retaining slab stays physical');
    assert.equal(slab.renderFloorSurfaceId, floorId);
    for (const [x, py, z] of floor.vertices) {
      assert.equal(py, y);
      assert(x >= -14.5 && x <= -8 && z >= -40.7 && z <= -39.2);
    }
    let removed = 0,
      retained = 0;
    for (let x = -14.45; x < -8; x += 0.1)
      for (let z = -40.675; z < -39.2; z += 0.05) {
        const point = new THREE.Vector3(x, y, z),
          local = point.clone().applyMatrix4(inverse),
          faceDistance = Math.min(
            ...local
              .toArray()
              .map((v, i) => Math.abs(Math.abs(v) - bank.size[i] / 2)),
          );
        if (faceDistance < 1e-6) continue;
        const foot = o.floorAt(point.toArray(), floorId);
        if (solid.containsPoint(point)) {
          assert(
            !foot,
            'a flat walking triangle cannot pass through real concrete',
          );
          removed++;
        } else {
          assert(foot, 'the notch cannot remove unrelated landing floor');
          retained++;
        }
      }
    assert(removed > 10 && retained > 1000);
    const bad = new THREE.Vector3(-11.705, y, -40.47125);
    assert(solid.containsPoint(bad));
    assert(!o.floorAt(bad.toArray(), floorId));
    assert(
      !renderedRay(
        o,
        bad.clone().add(new THREE.Vector3(0, 0.5, 0)),
        new THREE.Vector3(0, -1, 0),
        0.8,
        (id) => id === slab.id,
      ),
      'the exact rendered landing must preserve its physical notch',
    );
    assert(
      renderedRay(
        o,
        bad.clone().add(new THREE.Vector3(0, 0.5, 0)),
        new THREE.Vector3(0, -1, 0),
        0.8,
        (id) => id === bank.id,
      ),
      'the foundation is retained rather than made invisible',
    );
    const start = o.floorAt([-8, y, -40.7], floorId),
      goal = [-14.5, y, -39.4];
    assert(start && o.isClearFoot(start));
    const end = flat(o, start, goal);
    flat(o, end, start.position);
  } finally {
    o.dispose();
  }
});

test('Waterfront enclosure finishing: real rendered fascia, mall backing and arrival return close the reviewed holes', () => {
  const o = owner();
  try {
    for (const [floorId, closureId, heights] of [
      [
        'waterfront-seabus-heritage-connector-1',
        'heritage-seabus-skywalk-roof-fascia',
        [3.65, 3.9, 4.15],
      ],
      [
        'waterfront-howe-mall-vestibule-0',
        'waterfront-howe-commercial-scope-closure',
        [0.3, 1.3, 2.4],
      ],
    ]) {
      const f = s.floors.find((f) => f.id === floorId),
        start = new THREE.Vector3(...f.vertices[0])
          .add(new THREE.Vector3(...f.vertices[3]))
          .multiplyScalar(0.5),
        end = new THREE.Vector3(...f.vertices[1])
          .add(new THREE.Vector3(...f.vertices[2]))
          .multiplyScalar(0.5),
        direction = end.clone().sub(start).setY(0).normalize(),
        across = new THREE.Vector3(direction.z, 0, -direction.x),
        halfWidth =
          new THREE.Vector3(...f.vertices[2]).distanceTo(
            new THREE.Vector3(...f.vertices[1]),
          ) / 2;
      assert(
        s.obstacles.some((p) => p.id === closureId),
        `${String(closureId)}: solid physical backing`,
      );
      for (const height of heights)
        for (const offset of [-halfWidth + 0.15, 0, halfWidth - 0.15]) {
          const origin = end
            .clone()
            .addScaledVector(direction, -0.45)
            .addScaledVector(across, offset)
            .add(new THREE.Vector3(0, height, 0));
          assert(
            renderedRay(o, origin, direction, 0.7, (id) => id === closureId),
            `${String(closureId)}: actual rendered triangles must block the former opening at ${offset}/${String(height)}`,
          );
        }
    }
    // Probe the reviewed strips beside the oblique passage mouths. A wide
    // room opening can remain a real underground slit even when the route
    // centre line and the new far-end backing are both sound.
    const junction = s.floors.find(
        (f) => f.id === 'waterfront-howe-middle-junction',
      ),
      jx = Math.min(...junction.vertices.map((p) => p[0])),
      jz = Math.max(...junction.vertices.map((p) => p[2])),
      jy = junction.vertices[0][1];
    assert(
      renderedRay(
        o,
        new THREE.Vector3(jx + 0.5, jy + 1.3, jz - 0.3),
        new THREE.Vector3(-1, 0, 0),
        0.9,
        (id) => id?.startsWith('waterfront-howe-middle-junction-west-'),
      ),
      'the oblique west mouth cannot leave its former 0.6 m unbacked strip',
    );
    for (const offset of [-2.7, 1.95])
      assert(
        renderedRay(
          o,
          new THREE.Vector3(jx + 4.1 + offset, jy + 1.3, jz - 0.5),
          new THREE.Vector3(0, 0, 1),
          0.9,
          (id) => id?.startsWith('waterfront-howe-middle-junction-south-'),
        ),
        'solid +Z jambs enclose both sides of the narrower commercial mouth',
      );
    for (const offset of [-3.3, 3.85])
      assert(
        renderedRay(
          o,
          new THREE.Vector3(jx + 4.1 + offset, jy + 1.3, jz - 8.2 + 0.5),
          new THREE.Vector3(0, 0, -1),
          0.9,
          (id) => id?.startsWith('waterfront-howe-middle-junction-north-'),
        ),
        'the -Z fare-hall mouth meets its oblique walls without an outside slit',
      );
    const arrival = s.floors.find(
        (f) => f.id === 'waterfront-canada-transfer-arrival-0',
      ),
      ax =
        arrival.vertices.reduce((sum, p) => sum + p[0], 0) /
        arrival.vertices.length,
      az = Math.max(...arrival.vertices.map((p) => p[2])),
      ay = arrival.vertices[0][1];
    for (const offset of [-3.72, 2.7])
      assert(
        renderedRay(
          o,
          new THREE.Vector3(ax + offset, ay + 1.3, az - 0.5),
          new THREE.Vector3(0, 0, 1),
          0.9,
          (id) =>
            id?.startsWith('waterfront-canada-transfer-arrival-room-south-'),
        ),
        'arrival jambs must meet the actual angled passage, not expose its outside',
      );
    const returnId = 'waterfront-canada-lobby-left-arrival-return',
      wall = s.parts.find((p) => p.id === returnId),
      rotation = (p) =>
        p.quaternion
          ? new THREE.Quaternion(...p.quaternion)
          : new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              THREE.MathUtils.degToRad(p.yaw),
            ),
      box = (p) =>
        new OBB(
          new THREE.Vector3(),
          new THREE.Vector3(...p.size).multiplyScalar(0.5),
        ).applyMatrix4(
          new THREE.Matrix4().compose(
            new THREE.Vector3(...p.position),
            rotation(p),
            new THREE.Vector3(1, 1, 1),
          ),
        );
    assert(s.obstacles.some((p) => p.id === returnId));
    for (const id of [
      'waterfront-canada-lobby-bank-shaft-wall--1',
      'waterfront-canada-transfer-arrival-room-north-0',
    ])
      assert(
        box(wall).intersectsOBB(box(s.parts.find((p) => p.id === id))),
        `${returnId}: backing must physically join ${id}, not leave a crack at either end`,
      );
    const q = rotation(wall),
      normal = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    for (const y of [-1.2, 0, 1.2])
      for (const z of [-wall.size[2] * 0.35, 0, wall.size[2] * 0.35]) {
        const origin = new THREE.Vector3(-0.5, y, z)
          .applyQuaternion(q)
          .add(new THREE.Vector3(...wall.position));
        assert(renderedRay(o, origin, normal, 0.8, (id) => id === returnId));
      }
  } finally {
    o.dispose();
  }
});
