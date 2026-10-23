import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { rebuildStadium, rebuildYaletown } from '../tools/station-interiors/southeast.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const source = JSON.parse(fs.readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'));
const builders = new Map([['stadium-chinatown', rebuildStadium], ['yaletown-roundhouse', rebuildYaletown]]);
const data = source.stations.filter(s => s.authoredInterior || builders.has(s.stationId)).map(s =>
  makeRuntimeStation(builders.has(s.stationId) ? builders.get(s.stationId)(s) : s, '0'.repeat(64)));
const owner = s => new SkyTrainStationOwner(s, () => 0, 'balanced', false);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function straight(o, foot, goal, strict = true) {
  const origin = `${foot.surfaceId} ${foot.position}`;
  const dx = goal[0] - foot.position[0], dz = goal[2] - foot.position[2];
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .045));
  for (let i = 0; i < count; i++) {
    const next = o.walk(foot, dx / count, dz / count);
    assert(Math.abs(next.position[1] - foot.position[1]) <= .221, 'a step cannot teleport between floors');
    assert(o.isClearFoot(next), `${o.data.id}: capsule loses supported clearance`);
    foot = next;
  }
  if (strict) {
    assert(distance(foot.position, goal) < .17, `${o.data.id}: blocked waypoint ${goal}; stopped ${foot.position}; from ${origin}`);
    assert(Math.abs(foot.position[1] - goal[1]) < .23, `${o.data.id}: wrong level at ${goal}`);
  }
  return foot;
}

/** Plan only flat-room movement. Every proposed edge is executed by the real
 * capsule walker; stairs themselves are always traversed tread by tread. */
function flat(o, initial, goal) {
  const direct = straight(o, initial, goal, false);
  if (distance(direct.position, goal) < .13 && Math.abs(direct.position[1] - goal[1]) < .23) return direct;
  const step = .3, key = f => `${Math.round((f.position[0] - initial.position[0]) / step)},${Math.round((f.position[2] - initial.position[2]) / step)},${f.surfaceId}`;
  const queue = [{ foot: initial, cost: 0, score: distance(initial.position, goal) }], best = new Map([[key(initial), 0]]);
  let iterations = 0;
  while (queue.length && iterations++ < 12000) {
    queue.sort((a, b) => b.score - a.score);
    const node = queue.pop();
    if (distance(node.foot.position, goal) < .7) {
      const end = straight(o, node.foot, goal, false);
      if (distance(end.position, goal) < .13 && Math.abs(end.position[1] - goal[1]) < .23) return end;
    }
    for (const [x, z] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const dx = x * step, dz = z * step, next = o.walk(node.foot, dx, dz);
      if (distance(next.position, [node.foot.position[0] + dx, next.position[1], node.foot.position[2] + dz]) > .015 || Math.min(Math.abs(next.position[1] - initial.position[1]), Math.abs(next.position[1] - goal[1])) > .025) continue;
      const k = key(next), cost = node.cost + Math.hypot(dx, dz);
      if (cost >= (best.get(k) ?? Infinity)) continue;
      best.set(k, cost);
      queue.push({ foot: next, cost, score: cost + distance(next.position, goal) });
    }
  }
  assert.fail(`${o.data.id}: no physically supported flat route from ${initial.position} to ${goal}`);
}

function path(s, from, to, allowElevator = false) {
  const queue = [from], seen = new Set(queue), previous = new Map();
  for (const id of queue) {
    if (id === to) break;
    for (const c of s.connections.filter(c => allowElevator || c.type !== 'elevator')) {
      const next = c.from === id ? c.to : c.to === id ? c.from : null;
      if (!next || seen.has(next)) continue;
      seen.add(next); previous.set(next, { surface: id, connection: c }); queue.push(next);
    }
  }
  if (!seen.has(to)) return null;
  const result = [];
  while (to !== from) { const p = previous.get(to); result.unshift({ connection: p.connection, forward: p.connection.from === p.surface }); to = p.surface; }
  return result;
}

for (const s of data) test(`${s.id}: authored flights support capsule walking in both directions`, () => {
    const o = owner(s);
    try {
      for (const c of s.connections.filter(c => c.treads.length)) for (const forward of [true, false]) {
        const start = forward ? c.start : c.end, end = forward ? c.end : c.start;
        const foot = o.floorAt(start, forward ? c.from : c.to);
        assert(foot && o.isClearFoot(foot), `${s.id}/${c.id}: blocked ${forward ? 'start' : 'return'} landing`);
        straight(o, foot, end);
      }
    } finally { o.dispose(); }
});

for (const s of data) test(`${s.id}: every public entrance reaches every platform through supported walking or real lift cabins and returns`, () => {
    const o = owner(s);
    try {
      for (const entrance of s.entrances) for (const platform of new Map(s.platforms.map(p => [p.surfaceId, p])).values()) {
        const inward = entrance.inwardDirection ?? [0, 0, 1];
        const footOptions = [.4,-.4,0].map(distance => o.floorAt(entrance.point.map((n,i) => n+inward[i]*distance),entrance.surfaceId));
        let foot = footOptions.find(point => point && o.isClearFoot(point));
        assert(foot, `${s.id}/${entrance.id}: doorway/stair head has no supported public foot point`);
        const start = foot.position;
        // Prefer the complete walking route. Only a genuinely separate accessible
        // entrance may need a lift; arbitrary inter-floor walking remains forbidden.
        const walking = path(s, entrance.surfaceId, platform.surfaceId);
        const chain = walking ?? path(s, entrance.surfaceId, platform.surfaceId, true);
        assert(chain, `${s.id}/${entrance.id}: entrance has no public circulation route`);
        const traverse = (c, forward) => {
          const start = forward ? c.start : c.end, end = forward ? c.end : c.start;
          foot = flat(o, foot, start);
          if (c.type !== 'elevator') {
            foot = c.treads.length ? straight(o, foot, end) : flat(o, foot, end);
            return;
          }
          assert(!walking, 'a walking entrance must retain its physical stairs route');
          assert(Math.hypot(start[0] - end[0], start[2] - end[2]) < .01, 'lift travel stays inside one real vertical shaft');
          for (const [point, floor] of [[start, forward ? c.from : c.to], [end, forward ? c.to : c.from]]) {
            assert(s.authoredInterior.elevatorLandings.some(l => l.floorId === floor && Math.hypot(...l.pointM.map((n, i) => n - point[i])) < .01), 'lift endpoint has authored cabin/door geometry');
          }
          // The production interaction is exercised separately. Here the graph
          // transition is permitted only between supported centres of that cabin.
          foot = o.floorAt(end, forward ? c.to : c.from);
          assert(foot && o.isClearFoot(foot), 'lift arrival supports the complete passenger capsule');
        };
        for (const { connection: c, forward } of chain) {
          traverse(c, forward);
        }
        assert(o.floorAt(foot.position, platform.surfaceId), `${s.id}: walking route ends outside public platform`);
        for (const { connection: c, forward } of [...chain].reverse()) {
          traverse(c, !forward);
        }
        foot = flat(o, foot, start);
        assert(o.floorAt(foot.position, entrance.surfaceId), `${s.id}: return route ends outside its entrance`);
      }
    } finally { o.dispose(); }
});

test('Stadium spare platform is excluded from public navigation and all Yaletown train doors remain clear', () => {
  const stadium = data.find(s => s.id === 'stadium-chinatown');
  assert(stadium.parts.some(p => p.role === 'restricted-platform'));
  assert(!stadium.floors.some(f => f.id.includes('spare')));
  const yaletown = data.find(s => s.id === 'yaletown-roundhouse'), o = owner(yaletown);
  try {
    for (const platform of yaletown.platforms) for (const door of o.boardingDoors(platform.line, platform.direction)) assert(o.isClearFoot(door.waiting), `blocked original train door ${door.id}`);
  } finally { o.dispose(); }
});

test('Stadium and Yaletown platform seats have physically reachable boarding-free stand positions', () => {
  for (const id of builders.keys()) {
    const s = data.find(s => s.id === id), o = owner(s);
    try {
      const seats = o.benchSeats();
      assert(seats.length >= 8, `${id}: platform waiting seats must be usable`);
      for (const seat of seats) {
        assert(o.isClearFoot(seat.stand));
        const front = [Math.sin(seat.yaw), 0, Math.cos(seat.yaw)];
        const near = seat.stand.position.map((v, i) => v + front[i] * .6);
        const from = o.floorAt(near, seat.stand.surfaceId);
        assert(from && o.isClearFoot(from), `${id}: a seat requires an unobstructed approach`);
        assert(o.canApproachSeat(seat, from));
      }
      for (const platform of s.platforms) for (const door of o.boardingDoors(platform.line, platform.direction)) {
        assert(o.isClearFoot(door.waiting), `${id}: seating obstructs a train door`);
      }
    } finally { o.dispose(); }
  }
});

test('Stadium uses mapped stair runs and keeps carriage-local geometry while translating the complete boarding assembly', () => {
  const original = source.stations.find(s => s.stationId === 'stadium-chinatown');
  const rebuilt = rebuildStadium(original), runtime = makeRuntimeStation(rebuilt, '0'.repeat(64));
  const repeated = rebuildStadium(rebuilt);
  assert.equal(repeated.geometryParts.length, rebuilt.geometryParts.length, 'rebuilding cannot duplicate the spare track');
  assert.equal(repeated.connections.length, rebuilt.connections.length);
  const main = runtime.connections.find(c => c.id === 'stadium-beatty-main-stair');
  const lower = runtime.connections.find(c => c.id === 'stadium-concourse-island-stair');
  assert(Math.abs(distance(main.start, main.end) - 13.07) < .05);
  assert(Math.abs(distance(lower.start, lower.end) - 7.965) < .05);
  assert.equal(main.treads.length, 27, 'main Beatty staircase matches the approximately 27-tread reference photograph');
  assert.equal(main.start[1] - main.end[1], 4.5);
  assert.equal(lower.start[1] - lower.end[1], 3.5);
  assert(runtime.platforms.every(p => p.floorHeight === -8));
  const beatty = runtime.entrances.find(e => e.id === 'stadium-beatty-entry');
  const expo = runtime.entrances.find(e => e.id === 'stadium-expo-boulevard-entry');
  assert(Math.abs(distance(beatty.point, expo.point) - 161.5) < .3);
  assert(runtime.parts.find(p => p.role === 'restricted-platform').position[0] < runtime.platforms[0].position[0]);
  for (const [i, platform] of rebuilt.platforms.entries()) {
    const old = original.platforms[i], shift = platform.stopPosition.translationM.map((v, k) => v - old.stopPosition.translationM[k]);
    for (const [j, door] of platform.doorAlignmentPoints.entries()) {
      const before = old.doorAlignmentPoints[j];
      for (const key of ['carLocalSillPointM', 'consistLocalSillPointM', 'carPoseInConsist']) assert.deepEqual(door[key], before[key]);
      for (const key of ['stationSillPointM', 'platformEdgePointM', 'stationWaitingPointM']) for (let k = 0; k < 3; k++) assert(Math.abs(door[key][k] - before[key][k] - shift[k]) < 1e-9);
    }
    for (const [j, region] of platform.waitingRegions.entries()) for (const [n, point] of region.polygonM.entries()) for (let k = 0; k < 3; k++) assert(Math.abs(point[k] - old.waitingRegions[j].polygonM[n][k] - shift[k]) < 1e-9);
    for (const anchor of rebuilt.anchors.filter(a => a.kind === 'vehicle-root-stop' || a.kind === 'platform-door')) {
      const before = original.anchors.find(a => a.id === anchor.id);
      for (let k = 0; k < 3; k++) assert(Math.abs(anchor.pointM[k] - before.pointM[k] - shift[k]) < 1e-9);
    }
  }
  const deltaY = rebuilt.platforms[0].floorHeightM - original.platforms[0].floorHeightM;
  for (const [i, exclusion] of rebuilt.trackExclusionVolumes.entries()) {
    assert(Math.abs(exclusion.minY - original.trackExclusionVolumes[i].minY - deltaY) < 1e-9);
    assert(Math.abs(exclusion.maxY - original.trackExclusionVolumes[i].maxY - deltaY) < 1e-9);
  }
  for (const [i, bridge] of rebuilt.thresholdBridges.entries()) for (const pose of ['storedTransform', 'deployedTransform']) assert(Math.abs(bridge[pose].translationM[1] - original.thresholdBridges[i][pose].translationM[1] - deltaY) < 1e-9);
  const o = owner(runtime);
  try { for (const p of runtime.platforms) for (const d of o.boardingDoors(p.line, p.direction)) assert(o.isClearFoot(d.waiting), 'shifted Stadium boarding point remains physically clear'); }
  finally { o.dispose(); }
});

test('Yaletown follows counted 57/41 stair proportions and moves every boarding component together', () => {
  const original = source.stations.find(s => s.stationId === 'yaletown-roundhouse');
  const rebuilt = rebuildYaletown(original), runtime = makeRuntimeStation(rebuilt, '0'.repeat(64));
  const upper = rebuilt.connections.find(c => c.connectionId === 'yaletown-upper-entry-stair');
  const lowerEntry = rebuilt.connections.find(c => c.connectionId === 'yaletown-lower-entry-stair');
  const platformStair = rebuilt.connections.find(c => c.connectionId === 'yaletown-platform-stair');
  assert.equal(upper.riserCount, 28);
  assert.equal(lowerEntry.riserCount, 29);
  assert.equal(upper.riserCount + lowerEntry.riserCount, 57);
  assert.equal(platformStair.riserCount, 41);
  assert.equal(upper.endPointM[1], -4.65);
  assert.equal(lowerEntry.endPointM[1], -9.4);
  assert.equal(platformStair.startPointM[1], -16.2);
  assert((upper.endPointM[0] - upper.startPointM[0]) * (lowerEntry.endPointM[0] - lowerEntry.startPointM[0]) < 0, 'photographed entry stairs reverse perpendicular to the platform across their shared landing');
  assert(rebuilt.authoredInterior.verticalInference.status.includes('not surveyed'));
  assert(rebuilt.authoredInterior.horizontalInference.status.includes('representative'));
  const deltaY = -16.2 - original.platforms[0].floorHeightM;
  const checkPoint = (after, before) => {
    assert.equal(after[0], before[0]); assert.equal(after[2], before[2]);
    assert(Math.abs(after[1] - before[1] - deltaY) < 1e-9);
  };
  for (const [i, platform] of rebuilt.platforms.entries()) {
    const old = original.platforms[i];
    checkPoint(platform.stopPosition.translationM, old.stopPosition.translationM);
    assert(Math.abs(platform.railHeightM - old.railHeightM - deltaY) < 1e-9);
    for (const [j, door] of platform.doorAlignmentPoints.entries()) {
      const before = old.doorAlignmentPoints[j];
      for (const key of ['carLocalSillPointM', 'consistLocalSillPointM', 'carPoseInConsist']) assert.deepEqual(door[key], before[key]);
      for (const key of ['stationSillPointM', 'platformEdgePointM']) checkPoint(door[key], before[key]);
      assert.equal(Math.abs(door.stationWaitingPointM[0]), 2.3, 'Yaletown waiting centres occupy the clear aisle beside the real stair shaft');
      assert.equal(door.stationWaitingPointM[2], before.stationWaitingPointM[2]);
      assert(Math.abs(door.stationWaitingPointM[1] - before.stationWaitingPointM[1] - deltaY) < 1e-9);
      assert(platform.waitingRegions.some(region => {
        const xs = region.polygonM.map(p => p[0]), zs = region.polygonM.map(p => p[2]), point = door.stationWaitingPointM;
        return point[0] >= Math.min(...xs) && point[0] <= Math.max(...xs) && point[2] >= Math.min(...zs) && point[2] <= Math.max(...zs);
      }), 'the new nominal origin remains inside an authored waiting region');
    }
    for (const [j, region] of platform.waitingRegions.entries()) for (const [n, point] of region.polygonM.entries()) checkPoint(point, old.waitingRegions[j].polygonM[n]);
  }
  for (const anchor of rebuilt.anchors) checkPoint(anchor.pointM, original.anchors.find(a => a.id === anchor.id).pointM);
  for (const old of original.geometryParts.filter(p => ['rail', 'trackbed'].includes(p.role) || p.id.startsWith('tactile-'))) checkPoint(rebuilt.geometryParts.find(p => p.id === old.id).centerM, old.centerM);
  for (const [i, exclusion] of rebuilt.trackExclusionVolumes.entries()) {
    assert(Math.abs(exclusion.minY - original.trackExclusionVolumes[i].minY - deltaY) < 1e-9);
    assert(Math.abs(exclusion.maxY - original.trackExclusionVolumes[i].maxY - deltaY) < 1e-9);
    exclusion.footprintM.forEach((p, j) => checkPoint(p, original.trackExclusionVolumes[i].footprintM[j]));
  }
  for (const [i, bridge] of rebuilt.thresholdBridges.entries()) {
    const old = original.thresholdBridges[i];
    for (const pose of ['storedTransform', 'deployedTransform']) checkPoint(bridge[pose].translationM, old[pose].translationM);
    bridge.deployedFloor.verticesM.forEach((p, j) => checkPoint(p, old.deployedFloor.verticesM[j]));
    bridge.sequence.forEach((p, j) => checkPoint(p.translationM, old.sequence[j].translationM));
  }
  const again = rebuildYaletown(rebuilt);
  assert.deepEqual(again.platforms, rebuilt.platforms, 'rebuilds cannot accumulate another depth shift');
  assert.equal(again.geometryParts.length, rebuilt.geometryParts.length);
  const o = owner(runtime);
  try { for (const p of runtime.platforms) for (const door of o.boardingDoors(p.line, p.direction)) assert(o.isClearFoot(door.waiting)); }
  finally { o.dispose(); }
});

test('Yaletown lift cabins have actual floor-supported entry and exit portals on every level', () => {
  const s = data.find(s => s.id === 'yaletown-roundhouse'), o = owner(s);
  try {
    assert.equal(s.authoredInterior.elevatorLandings.length, 4);
    for (const landing of s.authoredInterior.elevatorLandings) {
      const outside = landing.pointM.map((v, i) => v + landing.outwardDirectionM[i] * 1.8);
      let foot = o.floorAt(outside, landing.floorId);
      assert(foot && o.isClearFoot(foot), `lift on ${landing.floorId} needs a supported public approach`);
      foot = straight(o, foot, landing.pointM);
      assert(o.isClearFoot(foot), 'lift cabin centre must support its passenger');
      foot = straight(o, foot, outside);
      assert(o.isClearFoot(foot));
    }
  } finally { o.dispose(); }
});
