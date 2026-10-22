import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { cityModule } from './helpers/city-modules.mjs';
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
const catalog = source.stations.map((s) =>
  JSON.parse(readFileSync(`${TARGET}/${s.stationId}.json`)),
);
const get = (id) => structuredClone(catalog.find((s) => s.id === id));
const owner = (id = 'burrard', quality = 'balanced') =>
  new SkyTrainStationOwner(get(id), () => 42, quality);
const close = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);

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

test('terrain street datum and station quaternion are applied exactly once, including perpendicular Waterfront lines', () => {
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
  close(a.dot(b), 0);
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
    let p = west;
    for (let i = 0; i < 100; i++) p = o.walk(p, 1, 0);
    assert(p.position[0] < 2.25 - 0.23);
    assert.equal(p.surfaceId, west.surfaceId);
    close(p.position[1], west.position[1]);
    o.dispose();
  }
});

test('the actual station bench and column bounds stop continuous walking without freezing reverse input', () => {
  const o = owner('burrard');
  let p = o.floorAt([1.25, -9, -30], 'burrard-upper');
  assert(p);
  for (let i = 0; i < 20; i++) p = o.walk(p, -0.1, 0);
  assert(p.position[0] > 0.3);
  const reverse = o.walk(p, 0.4, 0);
  assert(reverse.position[0] > p.position[0] + 0.35);
  o.dispose();
});

test('station floor holes are respected rather than snapping to an overlapping stacked surface', () => {
  const d = get('burrard');
  const floor = d.floors.find((f) => f.id === 'burrard-upper');
  floor.vertices = [
    [-2.25, -9, -37],
    [-2.25, -9, -1],
    [2.25, -9, -1],
    [2.25, -9, -37],
    [-2.25, -9, 1],
    [-2.25, -9, 37],
    [2.25, -9, 37],
    [2.25, -9, 1],
  ];
  floor.indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const o = new SkyTrainStationOwner(d, () => 0);
  let p = o.floorAt([1.2, -9, -3], 'burrard-upper');
  for (let i = 0; i < 50; i++) p = o.walk(p, 0, 0.2);
  assert(p.position[2] < -1.2);
  assert.equal(p.surfaceId, 'burrard-upper');
  assert.equal(o.floorAt([1, -9, 0]), null);
  o.dispose();
});

test('exact stair tread connectivity permits supported rising steps but never an elevator shaft fall', () => {
  const o = owner('burrard'),
    c = o.data.connections.find((c) => c.type === 'stairs'),
    first = o.floorAt(c.start, c.from);
  assert(first);
  let p = { ...first, position: [...first.position] };
  const v = new THREE.Vector3(...c.end).sub(new THREE.Vector3(...c.start));
  for (let i = 0; i < 100; i++) p = o.walk(p, v.x / 100, v.z / 100);
  assert(p.position[1] > c.start[1] + 2.5);
  assert(Math.abs(p.position[1] - c.end[1]) < 0.3);
  o.dispose();
});

test('fixed instancing budgets remain small at all world qualities and disposal is idempotent', () => {
  for (const quality of ['balanced', 'high', 'ultra'])
    for (const data of catalog) {
      const o = owner(data.id, quality),
        stats = o.stats();
      assert(stats.drawCalls <= 24, `${data.id}: ${stats.drawCalls}`);
      assert(stats.triangles < 20_000);
      assert(stats.instances < 1600);
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
  const o = owner('burrard'),
    entry = o.entry('expo');
  const before = o.walk(entry, 0, -0.5);
  assert(before.position[2] < entry.position[2] - 0.4);
  let p = entry;
  for (let i = 0; i < 30; i++) p = o.walk(p, 0.1, 0);
  assert(p.position[0] < 0.72, 'body stops before the actual reader post');
  const reverse = o.walk(p, -0.4, 0);
  assert(reverse.position[0] < p.position[0] - 0.35);
  o.dispose();
});

test('Granville retains three recognizable escalator banks, sloped handrails and the original supported centre flight', () => {
  for (const id of ['granville', 'burrard']) {
    const o = owner(id),
      flights = o.data.connections.filter((c) => c.type === 'stairs'),
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

test('underground shells block outside views while retaining every access-floor body clearance and full train portal', () => {
  for (const d of catalog) {
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
    o = owner('burrard');
    const boarding = o.group.getObjectByName('station-sign-SkyTrain');
    assert(boarding instanceof THREE.Sprite);
    const sign = o.group.getObjectByName(
      `station-sign-${o.data.name.toUpperCase()}`,
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
    let textureDisposals = 0,
      materialDisposals = 0;
    boarding.material.map.addEventListener('dispose', () => textureDisposals++);
    boarding.material.addEventListener('dispose', () => materialDisposals++);
    o.dispose();
    o.dispose();
    assert.equal(textureDisposals, 1);
    assert.equal(materialDisposals, 1);
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
      close(
        access.position[0],
        raw[0] + ((center[0] - raw[0]) / distance) * 0.8,
      );
      close(
        access.position[2],
        raw[2] + ((center[2] - raw[2]) / distance) * 0.8,
      );
      const e = data.entrances.find((e) =>
          p.line === 'expo' ? !e.id.includes('canada') : !e.id.includes('expo'),
        ),
        entry = o.entry(p.line, p.direction);
      assert.equal(entry.surfaceId, e.surfaceId);
      assert.deepEqual(entry.position, e.point);
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

test('Waterfront transfer portals have matching square support geometry and collision with clear body routes on both sides', () => {
  const o = owner('waterfront'),
    before = get('waterfront');
  for (const portal of [
    {
      id: 'waterfront-expo-entry-post-3.4',
      from: [-26.5, 0, -59.4],
      dx: -0.1,
      dz: 0,
      axis: 0,
      goal: -28.5,
    },
    {
      id: 'waterfront-canada-entry-post3.4',
      from: [-29.8, 0, 3.6],
      dx: 0,
      dz: 0.1,
      axis: 2,
      goal: 5.6,
    },
  ]) {
    const mesh = o.group.children.find(
      (m) =>
        m instanceof THREE.InstancedMesh &&
        m.userData.stationPartIds?.includes(portal.id),
    );
    assert(mesh instanceof THREE.InstancedMesh);
    const index = mesh.userData.stationPartIds.indexOf(portal.id),
      matrix = new THREE.Matrix4(),
      scale = new THREE.Vector3();
    mesh.getMatrixAt(index, matrix);
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    assert(Math.abs(scale.x - 0.22) < 1e-5);
    assert(Math.abs(scale.z - 0.22) < 1e-5);
    close(scale.y, 3.4);
    let p = o.floorAt(portal.from);
    assert(p);
    for (let i = 0; i < 20; i++) p = o.walk(p, portal.dx, portal.dz);
    close(p.position[portal.axis], portal.goal);
    const support = before.obstacles.find((b) => b.id === portal.id),
      foot = o.floorAt([support.position[0], 0, support.position[2] - 0.8]);
    assert(foot);
    let blocked = foot;
    for (let i = 0; i < 20; i++) blocked = o.walk(blocked, 0, 0.1);
    assert(
      blocked.position[2] < support.position[2] - 0.25,
      'square support remains physically solid',
    );
  }
  assert.deepEqual(o.data, before);
  o.dispose();
});
