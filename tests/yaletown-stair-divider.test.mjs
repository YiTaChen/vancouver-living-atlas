import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebuildYaletown } from '../tools/station-interiors/southeast.mjs';
import { prepareSoutheastFlightViewpoint } from '../tools/station-interiors/capture-southeast-views.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const input = JSON.parse(readFileSync(SOURCE)).stations.find(
  (s) => s.stationId === 'yaletown-roundhouse',
);
const source = rebuildYaletown(input),
  data = makeRuntimeStation(source, 'a'.repeat(64));
const stair = data.connections.find((c) => c.id === 'yaletown-platform-stair');
const owner = () => new SkyTrainStationOwner(data, () => 0, 'balanced', false);
const middle = (tread) =>
  tread.vertices.reduce(
    (sum, p) => sum.map((n, i) => n + p[i] / tread.vertices.length),
    [0, 0, 0],
  );

test('Yaletown retains its physical 2.9m 41-riser staircase with photographed colliding central rail and a real side walking lane', () => {
  const o = owner();
  try {
    assert.equal(stair.treads.length, 41);
    assert.equal(stair.width, 2.9);
    assert(
      Math.abs(stair.start[0] + 0.7) < 1e-10 &&
        Math.abs(stair.end[0] + 0.7) < 1e-10,
    );
    const tread = stair.treads[20],
      p = middle(tread);
    assert.equal(
      p[0],
      0,
      'physical treads stay on the photographed central axis',
    );
    const centre = o.floorAt(p, `${stair.id}:step:20`);
    assert(
      centre && !o.isClearFoot(centre),
      'real central divider rejects walking through its body',
    );
    const parts = source.geometryParts.filter((p) =>
      p.id.startsWith('yaletown-platform-stair-central-'),
    );
    assert.equal(parts.length, 7);
    assert(
      parts.every((p) => source.obstacles.some((o) => o.id === p.id)),
      'every rendered rail/post has its exact physical collider',
    );
    const pose = prepareSoutheastFlightViewpoint(stair.id, o);
    assert(Math.abs(pose.point[0] + 0.7) < 1e-10);
    assert.equal(pose.point[1], p[1], 'capture retains actual tread height');
    assert(
      o.isClearFoot(pose.foot),
      'camera stands beside the rail on a true supported lane',
    );
    for (const reverse of [false, true]) {
      const start = reverse ? stair.end : stair.start,
        end = reverse ? stair.start : stair.end;
      let foot = o.floorAt(start, reverse ? stair.to : stair.from);
      assert(foot && o.isClearFoot(foot));
      const n = Math.ceil(
        Math.hypot(end[0] - start[0], end[2] - start[2]) / 0.045,
      );
      for (let i = 0; i < n; i++) {
        const next = o.walk(
          foot,
          (end[0] - start[0]) / n,
          (end[2] - start[2]) / n,
        );
        assert(o.isClearFoot(next));
        assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
        foot = next;
      }
      assert(
        Math.hypot(foot.position[0] - end[0], foot.position[2] - end[2]) < 0.1,
      );
      assert(Math.abs(foot.position[1] - end[1]) < 0.2);
    }
    assert(o.stats().drawCalls <= 32);
  } finally {
    o.dispose();
  }
});

function signIntrusions(station) {
  const items = [
      ...station.interiorSigns.map((s) => ({ ...s, depth: 0.04 })),
      ...station.geometryParts
        .filter((p) => p.role === 'arrival-board')
        .map((p) => ({
          text: p.id,
          position: p.centerM,
          width: p.sizeM[0],
          height: p.sizeM[1],
          depth: p.sizeM[2],
          yaw: 0,
        })),
    ],
    result = [];
  for (const c of station.connections.filter((c) => c.treadSurfaces?.length))
    for (const tread of c.treadSurfaces) {
      const p = tread.verticesM.reduce(
        (sum, v) => sum.map((n, i) => n + v[i] / 4),
        [0, 0, 0],
      );
      for (const sign of items) {
        const dx = p[0] - sign.position[0],
          dz = p[2] - sign.position[2],
          across = dx * Math.cos(sign.yaw) - dz * Math.sin(sign.yaw),
          normal = dx * Math.sin(sign.yaw) + dz * Math.cos(sign.yaw),
          bottom = sign.position[1] - sign.height / 2,
          top = sign.position[1] + sign.height / 2;
        if (
          Math.abs(across) <= sign.width / 2 + 0.24 &&
          Math.abs(normal) <= sign.depth / 2 + 0.24 &&
          top > p[1] + 0.01 &&
          bottom < p[1] + 1.9
        )
          result.push({ flight: c.connectionId, sign: sign.text, point: p });
      }
    }
  return result;
}

test('both Yaletown platform sign/arrival-board pairs occupy flat end bays and clear every actual flight; the former stair placement fails', () => {
  assert.deepEqual(signIntrusions(source), []);
  const names = source.interiorSigns.filter(
    (s) => s.text === 'Yaletown–Roundhouse' && s.position[1] < -10,
  );
  assert.deepEqual(
    names.map((s) => s.position[2]),
    [-19, 20.4],
  );
  const o = owner();
  try {
    for (const name of names)
      for (const x of [-2.3, 2.3]) {
        const foot = o.floorAt([x, -16.2, name.position[2]], 'yaletown-canada');
        assert(foot && o.isClearFoot(foot));
        assert(name.position[1] - name.height / 2 - foot.position[1] > 2);
      }
  } finally {
    o.dispose();
  }
  const negative = structuredClone(source);
  negative.interiorSigns.find(
    (s) => s.text === 'Yaletown–Roundhouse' && s.position[2] === 20.4,
  ).position[2] = 9;
  negative.interiorSigns.find(
    (s) => s.text === 'Waterfront     2 min' && s.position[2] > 20,
  ).position[2] = 10.22;
  negative.geometryParts.find(
    (p) => p.id === 'yaletown-arrival-board-1',
  ).centerM[2] = 10.3;
  assert(
    signIntrusions(negative).some(
      (x) => x.flight === 'yaletown-platform-stair',
    ),
    'negative fixture restores the visible signs through the stairs',
  );
});
