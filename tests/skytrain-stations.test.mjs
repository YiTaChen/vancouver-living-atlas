import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { cityModule } from './helpers/city-modules.mjs';
import { walkFlat } from './helpers/station-walker.mjs';
import {
  makeRuntimeStation,
  SOURCE,
  TARGET,
} from '../tools/build-skytrain-runtime-stations.mjs';
const {
  SkyTrainStationOwner,
  SkyTrainStations,
  validateRuntimeStation,
  trainStopFor,
  stationWorldPose,
} = await import(cityModule('skytrain-stations'));
const sourceBytes = readFileSync(SOURCE),
  source = JSON.parse(sourceBytes),
  sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
// Optional source-author QA never writes SOURCE or public packets. Restrict the
// test-name-pattern to the geometry/approach checks when using this mode;
// published-file provenance remains a separate normal-suite requirement.
const inMemoryIds = new Set(
  (process.env.STATION_OWNER_REBUILD ?? '').split(',').filter(Boolean),
);
const inMemoryBuilders = inMemoryIds.size
  ? await import('../tools/station-interiors/dunsmuir.mjs')
  : null;
for (const id of inMemoryIds) assert(['burrard', 'granville'].includes(id));
const catalog = source.stations.map((s) =>
  inMemoryIds.has(s.stationId)
    ? makeRuntimeStation(
        inMemoryBuilders[
          s.stationId === 'burrard' ? 'rebuildBurrard' : 'rebuildGranville'
        ](s),
        sourceHash,
      )
    : JSON.parse(readFileSync(`${TARGET}/${s.stationId}.json`)),
);
const get = (id) => structuredClone(catalog.find((s) => s.id === id));
const owner = (id = 'burrard', quality = 'balanced') =>
  new SkyTrainStationOwner(get(id), () => 42, quality);
const close = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
const partRotation = (part) =>
  part.quaternion
    ? new THREE.Quaternion(...part.quaternion)
    : new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(part.yaw),
      );
function renderedPart(o, id) {
  for (const mesh of o.group.children) {
    if (!(mesh instanceof THREE.InstancedMesh)) continue;
    const index = mesh.userData.stationPartIds?.indexOf(id) ?? -1;
    if (index < 0) continue;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    return { mesh, index, matrix };
  }
  assert.fail(`${o.data.id}: source part is not rendered: ${id}`);
}
function walkSegment(o, initial, target) {
  const dx = target[0] - initial.position[0],
    dz = target[2] - initial.position[2],
    steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.05));
  let foot = initial;
  for (let i = 0; i < steps; i++) {
    const next = o.walk(foot, dx / steps, dz / steps);
    assert(o.isClearFoot(next));
    assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
    foot = next;
  }
  return foot;
}
function assertFlightBothWays(o, connection) {
  const rise = connection.end[1] - connection.start[1];
  assert(Math.abs(rise) > 0.5);
  for (const reverse of [false, true]) {
    const start = reverse ? connection.end : connection.start,
      end = reverse ? connection.start : connection.end,
      first = o.floorAt(start, reverse ? connection.to : connection.from);
    assert(
      first && o.isClearFoot(first),
      `${connection.id}: supported ${reverse ? 'lower' : 'upper'} endpoint`,
    );
    const last = walkSegment(o, first, end);
    assert(
      Math.hypot(...last.position.map((v, axis) => v - end[axis])) < 0.24,
      `${connection.id}: ${reverse ? 'reverse' : 'forward'} ended ${last.position}, expected ${end}`,
    );
    assert(
      (last.position[1] - start[1]) * Math.sign(end[1] - start[1]) >
        Math.abs(rise) - 0.24,
    );
  }
}
function assertColliderStopsAndReverses(o, part, axes = [2, 0]) {
  const rotation = partRotation(part),
    floorY = part.position[1] - part.size[1] / 2;
  for (const axis of axes)
    for (const sign of [1, -1]) {
      const normal = new THREE.Vector3()
          .setComponent(axis, sign)
          .applyQuaternion(rotation)
          .setY(0)
          .normalize(),
        half = part.size[axis] / 2,
        start = new THREE.Vector3(...part.position)
          .addScaledVector(normal, half + 0.85)
          .setY(floorY),
        initial = o.floorAt(start.toArray());
      if (!initial || !o.isClearFoot(initial)) continue;
      const target = new THREE.Vector3(...part.position)
          .addScaledVector(normal, -half - 0.85)
          .setY(floorY),
        stopped = walkSegment(o, initial, target.toArray()),
        separation = new THREE.Vector3(...stopped.position)
          .sub(new THREE.Vector3(...part.position))
          .dot(normal);
      assert(
        separation > half + 0.21 && separation < half + 0.4,
        `${part.id}: body must stop at this actual collider face (${separation}, half ${half})`,
      );
      const away = o.walk(stopped, normal.x * 0.4, normal.z * 0.4);
      assert(
        new THREE.Vector3(...away.position)
          .sub(new THREE.Vector3(...stopped.position))
          .dot(normal) > 0.35,
        `${part.id}: reverse input leaves the collider`,
      );
      return;
    }
  assert.fail(`${part.id}: no supported approach to the real collider`);
}

test('all seven compact station layouts reproduce original authored geometry and exact source provenance', () => {
  const manifest = JSON.parse(readFileSync(`${TARGET}/manifest.json`));
  assert.equal(manifest.sourceSha256, sourceHash);
  assert.equal(manifest.files.length, 7);
  for (const s of source.stations) {
    const data = get(s.stationId);
    assert.deepEqual(data, makeRuntimeStation(s, sourceHash));
    assert.equal(validateRuntimeStation(data, s.stationId), data);
    const f = manifest.files.find((f) => f.id === s.stationId),
      bytes = readFileSync(`${TARGET}/${f.file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
    assert.equal(bytes.length, f.bytes);
    assert(data.source.accuracy.includes('not a survey'));
    assert(!data.verticalDatum.includes('adopted unchanged'));
  }
});

test('station metadata fails closed for malformed floor triangles, body bounds, lines and foreign identities', () => {
  for (const mutate of [
    (d) => (d.id = 'foreign'),
    (d) => (d.floors[0].indices[0] = 999),
    (d) => (d.floors[0].vertices[0][1] = NaN),
    (d) => (d.parts[0].size[0] = -1),
    (d) => (d.platforms[0].line = 'boat'),
    (d) => (d.quaternion = [0, 0, 0, 0]),
    (d) => (d.connections[0].from = 'unknown'),
  ]) {
    const d = get('burrard');
    mutate(d);
    assert.throws(() => validateRuntimeStation(d));
  }
  assert.throws(() => validateRuntimeStation(get('burrard'), 'granville'));
  assert.throws(() => new SkyTrainStationOwner(get('burrard'), () => NaN));
});

test('every real line/direction has clear entry, exact platform foot origin and a central first-car door', () => {
  for (const d of catalog) {
    const o = owner(d.id);
    for (const p of d.platforms) {
      for (const level of ['entry', 'platform']) {
        const s = o.spawn(level, p.line, p.direction);
        assert.equal(o.floorAt(s.position, s.surfaceId).surfaceId, s.surfaceId);
        assert(s.layer > 0);
        const moved = o.walk(s, 0.01, 0.01);
        assert.equal(moved.layer, s.layer);
        close(moved.position[1], s.position[1]);
        const a = o.accessPoint(level, p.line, p.direction);
        assert(o.floorAt(a.position, a.surfaceId));
      }
      const stop = o.trainStop(p.line, p.direction);
      assert.equal(stop.platformId, p.id);
      assert.equal(stop.door.carIndex, 0);
      assert.equal(stop.door.carDoor[2], 0);
      assert.equal(stop.floorHeight, p.floorHeight);
      assert.equal(stop.railHeight, p.railHeight);
      assert.deepEqual(stop, trainStopFor(d, p.line, p.direction));
    }
    o.dispose();
  }
});

test('Yaletown platform access follows the real staircase endpoint without stepping into its carved well', () => {
  const o = owner('yaletown-roundhouse');
  try {
    const c = o.data.connections.find(
        (c) => c.id === 'yaletown-platform-stair',
      ),
      floor = o.data.floors.find((f) => f.id === 'yaletown-canada'),
      center = floor.vertices.reduce(
        (a, b) => a.map((v, axis) => v + b[axis] / floor.vertices.length),
        [0, 0, 0],
      ),
      raw = c.from === floor.id ? c.start : c.end,
      towardCenter = new THREE.Vector3(...center)
        .sub(new THREE.Vector3(...raw))
        .setY(0)
        .normalize(),
      oldCandidate = new THREE.Vector3(...raw)
        .addScaledVector(towardCenter, 0.8)
        .toArray();
    assert.equal(
      o.floorAt(oldCandidate, floor.id),
      null,
      'the real stairwell remains a hole',
    );
    for (const platform of o.data.platforms) {
      const access = o.accessPoint(
        'platform',
        platform.line,
        platform.direction,
      );
      assert(o.floorAt(access.position, floor.id));
      assert(o.isClearFoot(access));
      assert.equal(access.surfaceId, floor.id);
      const rawPoint = new THREE.Vector3(...raw),
        inset = new THREE.Vector3(...access.position).sub(rawPoint),
        awayFromWell = rawPoint
          .clone()
          .sub(new THREE.Vector3(...(c.from === floor.id ? c.end : c.start)))
          .setY(0)
          .normalize();
      assert(
        inset.length() <= 1,
        'platform access stays within one metre of its actual stair endpoint',
      );
      assert(
        inset.dot(awayFromWell) >= 0.24,
        'the supported platform inset lies at least one body radius away from the stairwell',
      );
      const reached = walkSegment(o, access, raw);
      assert(
        new THREE.Vector3(...reached.position).distanceTo(rawPoint) < 0.24,
        'the platform inset physically reaches the actual stair endpoint',
      );
      const returned = walkSegment(o, reached, access.position);
      assert(
        new THREE.Vector3(...returned.position).distanceTo(
          new THREE.Vector3(...access.position),
        ) < 0.24,
        'the actual stair endpoint physically returns to the supported platform inset',
      );
    }
    assertFlightBothWays(o, c);
  } finally {
    o.dispose();
  }
});

test('each authored Dunsmuir station retains all24 clear train-door approaches around its actual platform fixtures', () => {
  for (const id of ['burrard', 'granville']) {
    if (!get(id).authoredInterior) continue;
    const o = owner(id);
    let checked = 0;
    try {
      for (const platform of o.data.platforms) {
        const access = o.accessPoint(
          'platform',
          platform.line,
          platform.direction,
        );
        assert(o.isClearFoot(access));
        for (const door of o.boardingDoors(platform.line, platform.direction)) {
          assert(
            o.isClearFoot(door.waiting),
            `${id}: source door ${door.id} has full body support`,
          );
          const reached = walkFlat(o, access, door.waiting.position);
          assert.equal(reached.surfaceId, platform.surfaceId);
          assert(
            new THREE.Vector3(...reached.position).distanceTo(
              new THREE.Vector3(...door.waiting.position),
            ) < 0.18,
            `${id}: actual platform fixtures cannot isolate door ${door.id}`,
          );
          checked++;
        }
      }
      assert.equal(checked, 24);
    } finally {
      o.dispose();
    }
  }
});

test('terrain street datum and station quaternion are applied exactly once, including independently mapped Waterfront line axes', () => {
  const o = owner('waterfront');
  for (const line of ['expo', 'canada']) {
    const stop = o.trainStop(line);
    const p = o.toWorld(stop.position);
    const actual = stationWorldPose(
      o.data,
      () => 42,
      stop.position,
      stop.quaternion,
    );
    assert.deepEqual(p, actual.position);
    o.toLocal(p).forEach((v, i) => close(v, stop.position[i]));
    close(p[1], 42 + stop.railHeight);
  }
  const expo = stationWorldPose(
      o.data,
      () => 42,
      o.trainStop('expo').position,
      o.trainStop('expo').quaternion,
    ),
    canada = stationWorldPose(
      o.data,
      () => 42,
      o.trainStop('canada').position,
      o.trainStop('canada').quaternion,
    );
  const a = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(...expo.quaternion),
    ),
    b = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(...canada.quaternion),
    );
  const localExpo = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(...o.trainStop('expo').quaternion),
    ),
    localCanada = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(...o.trainStop('canada').quaternion),
    );
  close(a.dot(b), localExpo.dot(localCanada));
  assert(
    Math.abs(a.dot(b)) < 0.95,
    'independent source-backed line axes remain nonparallel',
  );
  for (const line of ['expo', 'canada']) {
    const stop = o.trainStop(line),
      actual = stationWorldPose(
        o.data,
        () => 42,
        stop.position,
        stop.quaternion,
      ),
      expected = new THREE.Quaternion(...o.data.quaternion)
        .multiply(new THREE.Quaternion(...stop.quaternion))
        .toArray();
    // angleTo assumes perfectly unit quaternions; an identical product with
    // norm² 0.9999999999999978 otherwise has a false 1.33e-7 self-angle.
    actual.quaternion.forEach((value, i) => close(value, expected[i], 1e-12));
  }
  o.dispose();
});

test('stacked Dunsmuir platforms remain independent and an oversized step cannot enter tracks or another floor', () => {
  for (const id of ['burrard', 'granville']) {
    const o = owner(id),
      west = o.spawn('platform', 'expo', 'westbound'),
      east = o.spawn('platform', 'expo', 'eastbound');
    assert.notEqual(west.surfaceId, east.surfaceId);
    assert.equal(west.position[0], east.position[0]);
    assert.notEqual(west.layer, east.layer);
    assert(west.position[1] - east.position[1] > 5);
    const invalid = o.walk({ ...west, layer: east.layer }, 0, 1);
    assert.deepEqual(invalid.position, west.position);
    assert.deepEqual(o.walk(west, Infinity, 0), west);
    assert.deepEqual(o.walk(west, 900, 0), west);
    const platform = o.platform('expo', 'westbound'),
      across = new THREE.Vector3(1, 0, 0).applyQuaternion(
        new THREE.Quaternion(...platform.quaternion),
      ),
      edge = new THREE.Vector3(...platform.doors[0].edge);
    let p = west;
    for (let i = 0; i < 100; i++) p = o.walk(p, across.x, across.z);
    assert(new THREE.Vector3(...p.position).sub(edge).dot(across) < -0.23);
    assert.equal(p.surfaceId, west.surfaceId);
    close(p.position[1], west.position[1]);
    o.dispose();
  }
});

test('actual station benches and every maintained column stop continuous walking without freezing reverse input', () => {
  for (const id of ['burrard', 'granville']) {
    const o = owner(id);
    if (o.data.authoredInterior) {
      const bench = o.data.obstacles.find((part) =>
          part.id.endsWith('-bench-body'),
        ),
        columns = o.data.parts.filter((part) => part.role === 'column');
      assert(bench);
      assertColliderStopsAndReverses(o, bench);
      for (const column of columns) {
        const collider = o.data.obstacles.find((part) => part.id === column.id);
        assert(
          collider,
          `${column.id}: a visible maintained column must have real body collision`,
        );
        assertColliderStopsAndReverses(o, collider);
      }
      o.dispose();
      continue;
    }
    if (id !== 'burrard') {
      o.dispose();
      continue;
    }
    let p = o.floorAt([1.25, -9, -30], 'burrard-upper');
    assert(p);
    for (let i = 0; i < 20; i++) p = o.walk(p, -0.1, 0);
    assert(p.position[0] > 0.3);
    const reverse = o.walk(p, 0.4, 0);
    assert(reverse.position[0] > p.position[0] + 0.35);
    o.dispose();
  }
});

test('station floor holes are respected rather than snapping to an overlapping stacked surface', () => {
  const d = get('burrard');
  const floor = d.floors.find((f) => f.id === 'burrard-upper'),
    platform = d.platforms.find((p) => p.surfaceId === floor.id),
    rotation = new THREE.Quaternion(...platform.quaternion),
    origin = new THREE.Vector3(...platform.position),
    inverse = rotation.clone().invert(),
    bounds = new THREE.Box3().setFromPoints(
      floor.vertices.map((v) =>
        new THREE.Vector3(...v).sub(origin).applyQuaternion(inverse),
      ),
    ),
    center = bounds.getCenter(new THREE.Vector3()),
    at = (x, z) =>
      new THREE.Vector3(x, center.y, z)
        .applyQuaternion(rotation)
        .add(origin)
        .toArray();
  floor.vertices = [
    at(bounds.min.x, bounds.min.z),
    at(bounds.min.x, center.z - 1),
    at(bounds.max.x, center.z - 1),
    at(bounds.max.x, bounds.min.z),
    at(bounds.min.x, center.z + 1),
    at(bounds.min.x, bounds.max.z),
    at(bounds.max.x, bounds.max.z),
    at(bounds.max.x, center.z + 1),
  ];
  floor.indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const o = new SkyTrainStationOwner(d, () => 0);
  const along = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  let p = o.floorAt(at(center.x + 1.2, center.z - 3), floor.id);
  assert(p);
  for (let i = 0; i < 50; i++) p = o.walk(p, along.x * 0.2, along.z * 0.2);
  assert(
    new THREE.Vector3(...p.position).sub(origin).applyQuaternion(inverse).z <
      center.z - 1.2,
  );
  assert.equal(p.surfaceId, 'burrard-upper');
  assert.equal(o.floorAt(at(center.x + 1, center.z)), null);
  o.dispose();
});

test('exact stair tread connectivity permits supported rising steps but never an elevator shaft fall', () => {
  for (const id of ['burrard', 'granville']) {
    const o = owner(id),
      stairs = o.data.connections.filter((c) => c.type === 'stairs');
    if (o.data.authoredInterior) {
      for (const c of stairs) assertFlightBothWays(o, c);
      for (const c of o.data.connections.filter((c) => c.type === 'elevator')) {
        const first = o.floorAt(c.start, c.from);
        assert(first);
        assert.equal(o.walk(first, 0, 0).layer, first.layer);
        close(o.walk(first, 0, 0).position[1], c.start[1]);
      }
      o.dispose();
      continue;
    }
    if (id !== 'burrard') {
      o.dispose();
      continue;
    }
    const c = stairs[0],
      first = o.floorAt(c.start, c.from);
    assert(first);
    let p = { ...first, position: [...first.position] };
    const v = new THREE.Vector3(...c.end).sub(new THREE.Vector3(...c.start));
    for (let i = 0; i < 100; i++) p = o.walk(p, v.x / 100, v.z / 100);
    assert(p.position[1] > c.start[1] + 2.5);
    assert(Math.abs(p.position[1] - c.end[1]) < 0.3);
    o.dispose();
  }
});

test('fixed instancing budgets remain small at all world qualities and disposal is idempotent', () => {
  for (const quality of ['balanced', 'high', 'ultra'])
    for (const data of catalog) {
      const o = owner(data.id, quality),
        stats = o.stats();
      // Complete enclosures replace the former few generic corridor boxes;
      // batching remains bounded independently of world quality.
      assert(
        stats.drawCalls <= (data.authoredInterior ? 32 : 24),
        `${data.id}: ${stats.drawCalls}`,
      );
      assert(stats.triangles < (data.authoredInterior ? 50_000 : 20_000));
      assert(stats.instances < (data.authoredInterior ? 4_000 : 1600));
      assert(o.group.children.some((c) => c instanceof THREE.InstancedMesh));
      assert(!o.group.children.some((c) => c instanceof THREE.AmbientLight));
      assert(
        o.group.children.filter((c) => c instanceof THREE.PointLight).length <=
          4,
      );
      o.setBoardingOpen(
        data.platforms[0].line,
        data.platforms[0].direction,
        true,
      );
      assert(
        o.group.getObjectByName('conditional-passenger-threshold').visible,
      );
      o.setBoardingOpen(
        data.platforms[0].line,
        data.platforms[0].direction,
        false,
      );
      assert(
        !o.group.getObjectByName('conditional-passenger-threshold').visible,
      );
      o.dispose();
      o.dispose();
      assert.equal(o.group.children.length, 0);
      assert(o.stats().disposed);
    }
});

test('metadata prefetch does not replace the active station, and only one interior survives a switch', async () => {
  const scene = new THREE.Scene(),
    calls = [];
  const stations = new SkyTrainStations({
    scene,
    heightAt: () => 10,
    fetchStation: async (id) => {
      calls.push(id);
      return get(id);
    },
  });
  const original = await stations.load('burrard', 'expo');
  const data = await stations.describe('granville');
  assert.equal(data.id, 'granville');
  assert.equal(stations.active, original);
  assert.equal(scene.children.length, 1);
  const next = await stations.load('granville', 'expo');
  assert(original.stats().disposed);
  assert.equal(scene.children.length, 1);
  assert.equal(stations.active, next);
  assert.deepEqual(calls, ['burrard', 'granville']);
  await assert.rejects(stations.load('granville', 'canada'));
  assert.equal(stations.active, next);
  stations.dispose();
  stations.dispose();
  assert.equal(scene.children.length, 0);
  await assert.rejects(stations.load('burrard', 'expo'));
  await assert.rejects(stations.describe('burrard'));
});

test('a stale async request never takes over a later station or survives disposal', async () => {
  const pending = new Map(),
    stations = new SkyTrainStations({
      heightAt: () => 0,
      fetchStation: (id) => new Promise((resolve) => pending.set(id, resolve)),
    });
  const a = stations.load('burrard', 'expo');
  const rejection = assert.rejects(a, /superseded/);
  const b = stations.load('granville', 'expo');
  pending.get('granville')(get('granville'));
  const owner = await b;
  pending.get('burrard')(get('burrard'));
  await rejection;
  assert.equal(stations.active, owner);
  const c = stations.describe('waterfront'),
    cancelled = assert.rejects(c, /superseded/);
  stations.dispose();
  pending.get('waterfront')(get('waterfront'));
  await cancelled;
  assert(owner.stats().disposed);
});

test('Dunsmuir vault geometry clears the full train roof envelope on both stacked levels', () => {
  for (const id of ['burrard', 'granville']) {
    const o = owner(id);
    if (o.data.authoredInterior) {
      const ceilings = o.data.parts.filter((part) =>
        /-vault-panel-/.test(part.id),
      );
      assert(
        ceilings.length >= 24,
        `${id}: both actual platform vaults are authored`,
      );
      const unit = new THREE.Box3(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5),
      );
      o.group.updateWorldMatrix(true, true);
      const roofInstances = ceilings.map((part) => {
        const instance = renderedPart(o, part.id);
        return {
          part,
          ...instance,
          box: new OBB().fromBox3(unit).applyMatrix4(instance.matrix),
        };
      });
      for (const p of o.data.platforms) {
        const q = new THREE.Quaternion(...p.quaternion),
          center = new THREE.Vector3(
            0,
            p.floorHeight + 1.375 - p.position[1],
            0,
          )
            .applyQuaternion(q)
            .add(new THREE.Vector3(...p.position)),
          train = new OBB(
            center,
            new THREE.Vector3(1.35, 1.325, 35.35),
            new THREE.Matrix3().setFromMatrix4(
              new THREE.Matrix4().makeRotationFromQuaternion(q),
            ),
          ),
          platformCeilings = roofInstances.filter(({ part }) =>
            part.id.startsWith(`${p.surfaceId}-vault-panel-`),
          );
        assert.equal(
          platformCeilings.length,
          12,
          `${p.id}: continuous twelve-panel source vault`,
        );
        for (const roof of roofInstances)
          assert(
            !roof.box.intersectsOBB(train),
            `${id} ${p.direction}: train body intersects ${roof.part.id}`,
          );
        for (const dx of [-1.4, 0, 1.4])
          for (const z of [-30, 0, 30]) {
            const origin = new THREE.Vector3(
                dx,
                p.floorHeight + 2.7 - p.position[1],
                z,
              )
                .applyQuaternion(q)
                .add(new THREE.Vector3(...p.position)),
              ray = new THREE.Ray(origin, new THREE.Vector3(0, 1, 0)),
              hits = platformCeilings
                .map(({ box }) => box.intersectRay(ray, new THREE.Vector3()))
                .filter(Boolean),
              nearest = Math.min(...hits.map((hit) => hit.y - origin.y)),
              worldOrigin = new THREE.Vector3(...o.toWorld(origin.toArray())),
              worldUp = new THREE.Vector3(0, 1, 0).transformDirection(
                o.group.matrixWorld,
              ),
              partIds = new Set(platformCeilings.map(({ part }) => part.id)),
              renderedHits = new THREE.Raycaster(worldOrigin, worldUp)
                .intersectObjects(
                  [...new Set(platformCeilings.map(({ mesh }) => mesh))],
                  false,
                )
                .filter((hit) =>
                  partIds.has(
                    hit.object.userData.stationPartIds?.[hit.instanceId],
                  ),
                );
            assert(
              hits.length,
              `${p.id}: rendered vault covers train roof ${dx}/${z}`,
            );
            assert(
              renderedHits.length,
              `${p.id}: the real rendered triangles cover the roof`,
            );
            close(renderedHits[0].distance, nearest, 1e-4);
            assert(
              nearest >= 0.3,
              `${id} ${p.direction}: roof clearance ${nearest}m at ${dx}/${z}`,
            );
            assert(
              renderedHits[0].distance >= 0.3,
              `${p.id}: visible roof triangles preserve .3m clearance`,
            );
          }
      }
      o.dispose();
      continue;
    }
    const vaults = o.group.children.filter((mesh) =>
      mesh.name.startsWith('representative-dunsmuir-vault-'),
    );
    assert.equal(vaults.length, 2);
    for (const [i, p] of o.data.platforms.entries())
      for (const dx of [-1.4, 0, 1.4]) {
        const rail = o.toWorld([p.position[0] + dx, p.floorHeight + 2.7, 0]);
        const ray = new THREE.Raycaster(
          new THREE.Vector3(...rail),
          new THREE.Vector3(0, 1, 0),
        );
        const hit = ray.intersectObject(vaults[i], false)[0];
        assert(hit);
        assert(
          hit.distance >= 0.3,
          `${id} ${p.direction} roof intersects at ${dx}`,
        );
      }
    o.dispose();
  }
});

test('visible ticket reader posts block the pedestrian body and retain a usable central gate aisle', () => {
  for (const id of ['burrard', 'granville']) {
    const o = owner(id);
    if (o.data.authoredInterior) {
      const posts = o.data.parts.filter((part) => part.role === 'faregate'),
        rows = new Map();
      assert(posts.length >= 6);
      for (const post of posts) {
        assert(
          o.data.obstacles.some((obstacle) => obstacle.id === post.id),
          `${post.id}: visible post is physical`,
        );
        const alongAxis = post.size[0] > post.size[2] ? 0 : 2;
        assertColliderStopsAndReverses(o, post, [
          alongAxis,
          alongAxis === 0 ? 2 : 0,
        ]);
        const rowId = post.id.replace(/-\d+$/, ''),
          row = rows.get(rowId) ?? [];
        row.push(post);
        rows.set(rowId, row);
      }
      for (const [rowId, row] of rows) {
        const first = row[0],
          alongAxis = first.size[0] > first.size[2] ? 0 : 2,
          acrossAxis = alongAxis === 0 ? 2 : 0,
          rotation = partRotation(first),
          along = new THREE.Vector3()
            .setComponent(alongAxis, 1)
            .applyQuaternion(rotation),
          across = new THREE.Vector3()
            .setComponent(acrossAxis, 1)
            .applyQuaternion(rotation);
        row.sort(
          (a, b) =>
            new THREE.Vector3(...a.position).dot(across) -
            new THREE.Vector3(...b.position).dot(across),
        );
        for (let i = 1; i < row.length; i++) {
          const a = row[i - 1],
            b = row[i],
            center = new THREE.Vector3(...a.position)
              .add(new THREE.Vector3(...b.position))
              .multiplyScalar(0.5),
            half = first.size[alongAxis] / 2 + 0.25;
          center.y = first.position[1] - first.size[1] / 2;
          const start = center.clone().addScaledVector(along, half),
            end = center.clone().addScaledVector(along, -half),
            initial = o.floorAt(start.toArray());
          assert(
            initial && o.isClearFoot(initial),
            `${rowId}: gate gap has a supported approach`,
          );
          const last = walkSegment(o, initial, end.toArray());
          assert(
            new THREE.Vector3(...last.position).distanceTo(end) < 0.18,
            `${rowId}: gap ${i - 1}/${i} admits the real body`,
          );
        }
      }
      o.dispose();
      continue;
    }
    if (id !== 'burrard') {
      o.dispose();
      continue;
    }
    const entry = o.entry('expo');
    const before = o.walk(entry, 0, -0.5);
    assert(before.position[2] < entry.position[2] - 0.4);
    let p = entry;
    for (let i = 0; i < 30; i++) p = o.walk(p, 0.1, 0);
    assert(p.position[0] < 0.72, 'body stops before the actual reader post');
    const reverse = o.walk(p, -0.4, 0);
    assert(reverse.position[0] < p.position[0] - 0.35);
    o.dispose();
  }
});

test('Dunsmuir retains the actual source escalator lanes, sloped handrails and supported bidirectional flights', () => {
  for (const id of ['granville', 'burrard']) {
    const o = owner(id);
    if (o.data.authoredInterior) {
      const escalators = o.data.connections.filter(
        (connection) => connection.type === 'escalator',
      );
      assert.equal(escalators.length, id === 'granville' ? 9 : 5);
      assert.equal(o.data.authoredInterior.escalatorCount, escalators.length);
      if (id === 'granville') {
        const three = escalators.filter((c) =>
          /^granville-big-three-[123]$/.test(c.id),
        );
        assert.equal(three.length, 3);
        const direction = new THREE.Vector3(...three[0].end)
            .sub(new THREE.Vector3(...three[0].start))
            .normalize(),
          across = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
        for (const c of three) {
          const delta = new THREE.Vector3(...c.end).sub(
            new THREE.Vector3(...c.start),
          );
          assert(
            delta.clone().normalize().dot(direction) > 0.99999,
            'the original three are parallel lanes',
          );
          close(
            new THREE.Vector3(...c.start)
              .sub(new THREE.Vector3(...three[0].start))
              .dot(direction),
            0,
          );
          close(
            new THREE.Vector3(...c.start).distanceTo(
              new THREE.Vector3(...c.end),
            ),
            35,
          );
        }
        const laneOffsets = three
          .map((c) => new THREE.Vector3(...c.start).dot(across))
          .sort((a, b) => a - b);
        assert(laneOffsets[1] - laneOffsets[0] > three[0].width + 0.1);
        assert(laneOffsets[2] - laneOffsets[1] > three[0].width + 0.1);
        assert.equal(
          escalators.filter((c) =>
            /^granville-dunsmuir-main-triple-[123]$/.test(c.id),
          ).length,
          3,
        );
      }
      for (const c of escalators) {
        const delta = new THREE.Vector3(...c.end).sub(
            new THREE.Vector3(...c.start),
          ),
          tangent = delta.clone().normalize();
        assert(c.treads.length >= 2);
        for (const side of [-1, 1]) {
          const rail = o.data.parts.find(
            (part) => part.id === `${c.id}-handrail-${side}`,
          );
          assert(rail, `${c.id}: both continuous handrails are authored`);
          const instance = renderedPart(o, rail.id),
            axis = new THREE.Vector3(0, 0, 1).transformDirection(
              instance.matrix,
            );
          assert(
            Math.abs(axis.dot(tangent)) > 0.99999,
            `${rail.id}: rendered rail follows the actual incline`,
          );
          close(rail.size[2], delta.length());
          close(rail.position[1], (c.start[1] + c.end[1]) / 2 + 0.98);
          const balustrade = o.data.parts.find(
            (part) => part.id === `${c.id}-balustrade-${side}`,
          );
          assert(
            balustrade && balustrade.material === 'glass',
            `${c.id}: both escalator balustrades are rendered`,
          );
          const glass = renderedPart(o, balustrade.id);
          assert(
            Math.abs(
              new THREE.Vector3(0, 0, 1)
                .transformDirection(glass.matrix)
                .dot(tangent),
            ) > 0.99999,
          );
        }
        for (const [index, tread] of c.treads.entries()) {
          const part = o.data.parts.find((part) => part.id === tread.id),
            instance = renderedPart(o, tread.id),
            expected = new THREE.Matrix4().compose(
              new THREE.Vector3(...part.position),
              partRotation(part),
              new THREE.Vector3(...part.size),
            );
          instance.matrix.elements.forEach((value, i) =>
            close(value, expected.elements[i], 1e-4),
          );
          assert.equal(part.role, 'escalator-tread');
          for (const vertex of tread.vertices)
            close(vertex[1], part.position[1] + part.size[1] / 2);
          if (index)
            assert(
              Math.abs(
                tread.vertices[0][1] - c.treads[index - 1].vertices[0][1],
              ) <= 0.17,
            );
        }
        assertFlightBothWays(o, c);
      }
      o.dispose();
      continue;
    }
    const flights = o.data.connections.filter((c) => c.type === 'stairs'),
      rails = o.group.getObjectByName('station-escalator-escalator'),
      glass = o.group.getObjectByName('station-escalator-glass'),
      walls = o.group.getObjectByName('station-escalator-wall'),
      ribs = o.group.getObjectByName('station-escalator-steel'),
      lights = o.group.getObjectByName('station-escalator-light');
    assert(rails instanceof THREE.InstancedMesh);
    assert(glass instanceof THREE.InstancedMesh);
    assert(walls instanceof THREE.InstancedMesh);
    assert(ribs instanceof THREE.InstancedMesh);
    assert(lights instanceof THREE.InstancedMesh);
    assert.equal(rails.count, flights.length * (id === 'granville' ? 8 : 2));
    assert.equal(glass.count, flights.length * (id === 'granville' ? 6 : 2));
    assert.equal(walls.count, flights.length * 2);
    assert.equal(lights.count, flights.length);
    assert(ribs.count > flights.length * 2);
    const matrix = new THREE.Matrix4();
    rails.getMatrixAt(id === 'granville' ? 1 : 0, matrix);
    const direction = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    assert(Math.abs(direction.y) > 0.1, 'handrails follow the sloped flight');
    const c = flights[0],
      first = o.floorAt(c.start, c.from),
      v = new THREE.Vector3(...c.end).sub(new THREE.Vector3(...c.start));
    assert(first);
    let p = first;
    for (let i = 0; i < 100; i++) p = o.walk(p, v.x / 100, v.z / 100);
    assert(Math.abs(p.position[1] - c.end[1]) < 0.3);
    o.dispose();
  }
});

test('one selected boarding marker follows the safe waiting floor, hides with doors, has no collision and releases its resources once', () => {
  const o = owner('waterfront'),
    marker = o.group.getObjectByName('selected-platform-boarding-marker');
  assert(marker instanceof THREE.Group);
  assert(!marker.visible);
  const mesh = marker.getObjectByName('boarding-ring-and-down-chevron');
  assert(mesh instanceof THREE.Mesh);
  const resources = [mesh.geometry, mesh.material],
    disposed = resources.map(() => 0);
  resources.forEach((r, i) =>
    r.addEventListener('dispose', () => disposed[i]++),
  );
  for (const platform of o.data.platforms) {
    const waiting = o.boardingPoint(platform.line, platform.direction),
      before = o.walk(waiting, 0.1, 0);
    o.setBoardingOpen(platform.line, platform.direction, true);
    assert(marker.visible);
    assert.deepEqual(marker.position.toArray(), waiting.position);
    assert.equal(marker.userData.platformId, platform.id);
    assert.equal(marker.userData.surfaceId, waiting.surfaceId);
    assert.equal(marker.rotation.y, waiting.yaw);
    assert.deepEqual(o.walk(waiting, 0.1, 0), before);
    assert(o.floorAt(marker.position.toArray(), waiting.surfaceId));
    o.setBoardingOpen(platform.line, platform.direction, false);
    assert(!marker.visible);
  }
  assert.equal(
    o.group.children.filter((g) => g.name === marker.name).length,
    1,
  );
  o.dispose();
  o.dispose();
  assert.deepEqual(disposed, [1, 1]);
});

test('legacy underground shells retain access-floor clearance and full train portals', () => {
  for (const d of catalog) {
    if (d.authoredInterior) continue; // Exact authored enclosures have physical circulation sweeps.
    const o = owner(d.id),
      structural = [];
    for (const mesh of o.group.children) {
      if (!(mesh instanceof THREE.InstancedMesh)) continue;
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i++) {
        if (
          !mesh.userData.stationPartIds?.[i]?.startsWith('underground-') &&
          mesh.name !== 'station-escalator-wall'
        )
          continue;
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        structural.push({
          name: mesh.userData.stationPartIds?.[i] ?? mesh.name,
          box: new OBB()
            .fromBox3(mesh.geometry.boundingBox)
            .applyMatrix4(matrix),
        });
      }
    }
    if (d.id === 'main-street-science-world') {
      assert.equal(structural.length, 0, 'elevated station stays open');
      o.dispose();
      continue;
    }
    assert(structural.length > 0);
    const feet = d.floors.map((f) =>
      new THREE.Box3()
        .setFromPoints(f.vertices.map((v) => new THREE.Vector3(...v)))
        .getCenter(new THREE.Vector3()),
    );
    for (const c of d.connections.filter((c) => c.type === 'stairs'))
      for (const t of [0.1, 0.5, 0.9])
        feet.push(
          new THREE.Vector3(...c.start).lerp(new THREE.Vector3(...c.end), t),
        );
    for (const foot of feet) {
      const body = new OBB(
        foot.clone().add(new THREE.Vector3(0, 0.95, 0)),
        new THREE.Vector3(0.24, 0.9, 0.24),
      );
      for (const part of structural)
        assert(
          !part.box.intersectsOBB(body),
          `${d.id}: body intersects ${part.name} at ${foot.toArray()}`,
        );
    }
    for (const p of d.platforms) {
      const q = new THREE.Quaternion(...p.quaternion),
        center = new THREE.Vector3(0, p.floorHeight + 1.375 - p.position[1], 0)
          .applyQuaternion(q)
          .add(new THREE.Vector3(...p.position)),
        train = new OBB(
          center,
          new THREE.Vector3(1.35, 1.325, p.line === 'expo' ? 35.35 : 20.3),
          new THREE.Matrix3().setFromMatrix4(
            new THREE.Matrix4().makeRotationFromQuaternion(q),
          ),
        );
      for (const part of structural)
        assert(
          !part.box.intersectsOBB(train),
          `${d.id}: train intersects ${part.name}`,
        );
    }
    for (const c of d.connections.filter(
      (c) =>
        c.type === 'stairs' &&
        d.id !== 'stadium-chinatown' &&
        Math.max(c.start[1], c.end[1]) < -0.1,
    )) {
      const foot = new THREE.Vector3(...c.start).lerp(
          new THREE.Vector3(...c.end),
          0.5,
        ),
        run = new THREE.Vector3(...c.end).sub(new THREE.Vector3(...c.start)),
        lateral = new THREE.Vector3(run.z, 0, -run.x).normalize();
      for (const direction of [
        lateral,
        lateral.clone().negate(),
        new THREE.Vector3(0, 1, 0),
      ]) {
        const ray = new THREE.Ray(
          foot.clone().add(new THREE.Vector3(0, 1.65, 0)),
          direction,
        );
        assert(
          structural.some((part) => part.box.intersectsRay(ray)),
          `${d.id}: open stair shaft`,
        );
      }
    }
    o.dispose();
  }
});

test('boarding text billboards and overhead station signs have correctly oriented front and back faces', () => {
  const previous = globalThis.document,
    canvas = () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) });
  globalThis.document = Object.fromEntries([['createElement', canvas]]);
  let o;
  try {
    for (const data of catalog) {
      o = owner(data.id);
      const boarding = o.group.getObjectByName('station-sign-SkyTrain');
      assert(boarding instanceof THREE.Sprite);
      const normalized = (text) =>
        text
          .normalize('NFKC')
          .replace(/[‐‑‒–—−]/g, '-')
          .toLowerCase();
      const sourceSign = o.data.authoredInterior
        ? o.data.signs.find((sign) =>
            normalized(sign.text).includes(
              normalized(o.data.name.replace(' Station', '')),
            ),
          )
        : null;
      if (o.data.authoredInterior)
        assert(sourceSign, `${data.id}: real station name sign is authored`);
      const sign = o.group.getObjectByName(
        `station-sign-${sourceSign?.text ?? o.data.name.toUpperCase()}`,
      );
      assert(sign instanceof THREE.Mesh);
      assert.equal(sign.material.side, THREE.FrontSide);
      const normals = sign.geometry.getAttribute('normal');
      assert(
        Array.from({ length: normals.count }, (_, i) => normals.getZ(i)).some(
          (z) => z > 0.9,
        ),
      );
      assert(
        Array.from({ length: normals.count }, (_, i) => normals.getZ(i)).some(
          (z) => z < -0.9,
        ),
      );
      const uv = sign.geometry.getAttribute('uv');
      assert.equal(uv.getX(0), uv.getX(4));
      assert.equal(uv.getX(1), uv.getX(5));
      const resources = [
          boarding.material.map,
          boarding.material,
          sign.geometry,
          sign.material.map,
          sign.material,
        ],
        disposed = resources.map(() => 0);
      resources.forEach((resource, index) =>
        resource.addEventListener('dispose', () => disposed[index]++),
      );
      o.dispose();
      o.dispose();
      assert.deepEqual(
        disposed,
        resources.map(() => 1),
      );
    }
  } finally {
    o?.dispose();
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('Main Street publicly uses the coherent authored east entrance and platform route while preserving the west graph', () => {
  const o = owner('main-street-science-world'),
    before = get('main-street-science-world'),
    east = before.entrances.find((e) => e.id === 'main-east');
  for (const direction of ['eastbound', 'westbound']) {
    const entry = o.entry('expo', direction),
      access = o.accessPoint('platform', 'expo', direction);
    assert.equal(entry.surfaceId, east.surfaceId);
    assert.deepEqual(entry.position, east.point);
    assert.equal(access.surfaceId, 'main-expo');
    assert.deepEqual(access.position, [0, 8, 36.2]);
    assert.deepEqual(o.accessPoint('entry', 'expo', direction), entry);
    assert.deepEqual(o.spawn('entry', 'expo', direction), entry);
    let foot = entry;
    for (let i = 0; i < 20; i++) foot = o.walk(foot, 0, -0.2);
    for (let i = 0; i < 100; i++) foot = o.walk(foot, 0, -0.14);
    for (let i = 0; i < 24; i++) foot = o.walk(foot, 0, -0.2);
    close(foot.position[2], access.position[2]);
    close(foot.position[1], access.position[1]);
    assert.equal(foot.surfaceId, access.surfaceId);
    for (let i = 0; i < 24; i++) foot = o.walk(foot, 0, 0.2);
    for (let i = 0; i < 100; i++) foot = o.walk(foot, 0, 0.14);
    for (let i = 0; i < 20; i++) foot = o.walk(foot, 0, 0.2);
    close(foot.position[2], entry.position[2]);
    close(foot.position[1], entry.position[1]);
    assert.equal(foot.surfaceId, entry.surfaceId);
  }
  assert.deepEqual(o.data, before, 'selection never changes source metadata');
  assert(o.data.entrances.some((e) => e.id === 'main-expo-entry'));
  assert(
    o.data.connections.some(
      (c) => c.id === 'main-expo--main-expo-landing-walk',
    ),
  );
  o.dispose();
});

test('other stations retain their existing authored entrance and first platform access connection', () => {
  for (const data of catalog.filter(
    (d) => d.id !== 'main-street-science-world',
  )) {
    const o = owner(data.id);
    for (const p of data.platforms) {
      const c = data.connections.find(
          (c) => c.from === p.surfaceId || c.to === p.surfaceId,
        ),
        raw = c.from === p.surfaceId ? c.start : c.end,
        f = data.floors.find((f) => f.id === p.surfaceId),
        center = f.vertices.reduce(
          (a, b) => a.map((v, i) => v + b[i] / f.vertices.length),
          [0, 0, 0],
        ),
        distance = Math.hypot(center[0] - raw[0], center[2] - raw[2]),
        access = o.accessPoint('platform', p.line, p.direction);
      if (data.authoredInterior) {
        assert(o.floorAt(access.position, p.surfaceId));
        assert(o.isClearFoot(access));
        close(access.position[1], p.floorHeight);
        assert(
          Math.hypot(
            access.position[0] - raw[0],
            access.position[2] - raw[2],
          ) <= 2.5,
        );
        const endpoint = walkSegment(o, access, raw);
        assert(
          Math.hypot(...endpoint.position.map((v, axis) => v - raw[axis])) <
            0.24,
          `${data.id}: supported platform access physically reaches its real connection endpoint`,
        );
      } else {
        close(
          access.position[0],
          raw[0] + ((center[0] - raw[0]) / distance) * 0.8,
        );
        close(
          access.position[2],
          raw[2] + ((center[2] - raw[2]) / distance) * 0.8,
        );
      }
      const e = data.entrances.find((e) =>
          p.line === 'expo' ? !e.id.includes('canada') : !e.id.includes('expo'),
        ),
        entry = o.entry(p.line, p.direction);
      assert.equal(entry.surfaceId, e.surfaceId);
      if (data.authoredInterior) {
        assert(
          o.isClearFoot(entry),
          `${data.id}: entrance has full body support`,
        );
        assert(
          new THREE.Vector3(...entry.position).distanceTo(
            new THREE.Vector3(...e.point),
          ) <= 0.35,
          `${data.id}: supported entry remains within one body width of the authored doorway`,
        );
        assert.deepEqual(o.accessPoint('entry', p.line, p.direction), entry);
      } else assert.deepEqual(entry.position, e.point);
    }
    o.dispose();
  }
});

test('the integrated Main Street walker cannot enter the retained west display branch and its guide leaves train portals clear', () => {
  const o = owner('main-street-science-world'),
    original = get('main-street-science-world');
  for (const x of [-2, 0, 2]) {
    let p = o.floorAt([x, 8, -34], 'main-expo');
    assert(p);
    for (let i = 0; i < 100; i++) p = o.walk(p, 0, -0.15);
    assert.equal(p.surfaceId, 'main-expo');
    assert(
      p.position[2] > -36.2,
      'guide stops the body before the unintegrated west branch',
    );
    const reverse = o.walk(p, 0, 0.6);
    assert(reverse.position[2] > p.position[2] + 0.5);
  }
  assert(
    !o.floors.some(
      (f) => f.id.startsWith('main-expo-landing--') && f.kind === 'stair',
    ),
  );
  assert.deepEqual(o.data, original);
  const panels = o.group.children.filter(
      (m) => m instanceof THREE.InstancedMesh,
    ),
    guides = [];
  for (const mesh of panels) {
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++)
      if (
        mesh.userData.stationPartIds?.[i]?.startsWith('main-east-route-guide-')
      ) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        guides.push(
          new OBB().fromBox3(mesh.geometry.boundingBox).applyMatrix4(matrix),
        );
      }
  }
  assert(guides.length >= 5);
  for (const platform of original.platforms) {
    const envelope = new OBB(
      new THREE.Vector3(platform.position[0], platform.floorHeight + 1.35, 0),
      new THREE.Vector3(1.35, 1.3, 35.35),
    );
    assert(guides.every((guide) => !guide.intersectsOBB(envelope)));
  }
  o.dispose();
});

test('every maintained Waterfront heritage column renders at source scale and stops a real body without freezing reverse input', () => {
  const o = owner('waterfront'),
    before = get('waterfront'),
    columns = before.obstacles.filter((b) =>
      b.id.startsWith('heritage-column'),
    );
  try {
    assert(columns.length >= 4);
    for (const support of columns) {
      const rendered = renderedPart(o, support.id),
        expected = new THREE.Matrix4().compose(
          new THREE.Vector3(...support.position),
          partRotation(support),
          new THREE.Vector3(...support.size),
        );
      rendered.matrix.elements.forEach((v, i) =>
        close(v, expected.elements[i]),
      );
      assertColliderStopsAndReverses(o, support);
      const rotation = partRotation(support),
        forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation),
        start = new THREE.Vector3(1.2, -support.size[1] / 2, -1.5)
          .applyQuaternion(rotation)
          .add(new THREE.Vector3(...support.position));
      let aisle = o.floorAt(start.toArray(), 'waterfront-heritage-hall');
      assert(
        aisle && o.isClearFoot(aisle),
        `${support.id}: real side aisle supports the complete body`,
      );
      for (let i = 0; i < 30; i++) {
        aisle = o.walk(aisle, forward.x * 0.1, forward.z * 0.1);
        assert(o.isClearFoot(aisle));
      }
      assert(
        new THREE.Vector3(...aisle.position).sub(start).dot(forward) > 2.9,
        `${support.id}: real native side aisle remains traversable`,
      );
    }
    assert.deepEqual(o.data, before);
  } finally {
    o.dispose();
  }
});
