import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { interior } from '../tools/station-interiors/builder.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const source = JSON.parse(readFileSync(SOURCE)).stations.find(
  (s) => s.stationId === 'burrard',
);

for (const kind of ['stairs', 'escalator'])
  for (const rise of [-3, 3])
    for (const [dx, dz] of [
      [0, 1],
      [1, 0],
      [-1, -1],
    ]) {
      test(`flight ${kind} rise${rise} heading${dx}/${dz}: rendered barriers have exact collision and preserve central passage`, () => {
        const b = interior(source, 'flight-barrier-fixture', [
          {
            url: 'https://www.translink.ca/',
            note: 'Synthetic rendered/physical barrier transform fixture.',
          },
        ]);
        for (const p of source.platforms)
          b.platform(p.surfaceId, { columns: false, roof: false });
        const tangent = new THREE.Vector3(dx, 0, dz).normalize(),
          across = new THREE.Vector3(tangent.z, 0, -tangent.x),
          start = new THREE.Vector3(-200, 0, -200),
          end = start.clone().addScaledVector(tangent, 6).setY(rise),
          yaw = THREE.MathUtils.radToDeg(Math.atan2(tangent.x, tangent.z));
        b.floor(
          'flight-from',
          start.clone().addScaledVector(tangent, -1).toArray(),
          2,
          2,
          'landing',
          'flight-from',
          'floor',
          yaw,
        );
        b.floor(
          'flight-to',
          end.clone().addScaledVector(tangent, 1).toArray(),
          2,
          2,
          'landing',
          'flight-to',
          'floor',
          yaw,
        );
        b.entrance(
          'fixture-entry',
          'Fixture entry',
          'flight-from',
          start.clone().addScaledVector(tangent, -0.6).toArray(),
        );
        b.flight(
          'fixture-flight',
          'flight-from',
          'flight-to',
          start.toArray(),
          end.toArray(),
          1.1,
          { kind, enclosed: true },
        );
        const built = b.finish(),
          data = makeRuntimeStation(built, '0'.repeat(64)),
          owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false),
          connection = data.connections.find((c) => c.id === 'fixture-flight');
        try {
          const barriers = data.parts.filter(
            (p) =>
              p.id.startsWith('fixture-flight-') &&
              ['handrail', 'balustrade'].includes(p.role),
          );
          assert.equal(barriers.length, kind === 'escalator' ? 6 : 4);
          for (const p of barriers) {
            const o = data.obstacles.find((o) => o.id === p.id);
            assert(o, `${p.id}: every visible barrier is physical`);
            assert.deepEqual(o.position, p.position);
            assert.deepEqual(o.size, p.size);
            assert.deepEqual(o.quaternion, p.quaternion);
            const sourcePart = built.geometryParts.find((v) => v.id === p.id),
              sourceObstacle = built.obstacles.find((v) => v.id === p.id);
            assert.deepEqual(
              sourceObstacle.rotationQuaternionXYZW,
              sourcePart.rotationQuaternionXYZW,
            );
            const mesh = owner.group.children.find((m) =>
                m.userData.stationPartIds?.includes(p.id),
              ),
              rendered = new THREE.Matrix4(),
              physical = new THREE.Matrix4().compose(
                new THREE.Vector3(...o.position),
                new THREE.Quaternion(...o.quaternion),
                new THREE.Vector3(...o.size),
              );
            mesh.getMatrixAt(
              mesh.userData.stationPartIds.indexOf(p.id),
              rendered,
            );
            for (let i = 0; i < 16; i++)
              assert(
                Math.abs(rendered.elements[i] - physical.elements[i]) < 2e-5,
                `${p.id}: rendered instance and collider coincide`,
              );
          }
          const tread =
              connection.treads[Math.floor(connection.treads.length / 2)],
            center = tread.vertices
              .reduce(
                (v, p) => v.add(new THREE.Vector3(...p)),
                new THREE.Vector3(),
              )
              .multiplyScalar(0.25);
          assert(
            owner.isClearFoot(
              owner.floorAt(
                center.toArray(),
                `${connection.id}:step:${Math.floor(connection.treads.length / 2)}`,
              ),
            ),
          );
          const innerFace = (part) =>
              Math.abs(
                new THREE.Vector3(...part.position).sub(center).dot(across),
              ) -
              part.size[0] / 2,
            wallRails = barriers.filter((p) =>
              p.id.includes('-wall-handrail-'),
            ),
            flightRails = barriers.filter(
              (p) => !p.id.includes('-wall-handrail-'),
            ),
            radiusAlong = 0.24 * (Math.abs(across.x) + Math.abs(across.z)),
            edgeOffset =
              (Math.min(...wallRails.map(innerFace)) +
                Math.min(...flightRails.map(innerFace))) /
                2 -
              radiusAlong,
            edge = center.clone().addScaledVector(across, edgeOffset),
            edgeFoot = owner.floorAt(
              edge.toArray(),
              `${connection.id}:step:${Math.floor(connection.treads.length / 2)}`,
            );
          assert(edgeOffset > 0);
          assert(
            edgeFoot && !owner.isClearFoot(edgeFoot),
            'the more-inboard shaft handrail is physical too',
          );
          for (const sign of [-1, 1]) {
            const point = center
                .clone()
                .addScaledVector(across, (sign * connection.width) / 4),
              foot = owner.floorAt(
                point.toArray(),
                `${connection.id}:step:${Math.floor(connection.treads.length / 2)}`,
              ),
              body = new OBB(
                point.clone().add(new THREE.Vector3(0, 0.85, 0)),
                new THREE.Vector3(0.24, 0.85, 0.24),
              );
            assert(foot, 'the original tread geometry is retained');
            assert(
              barriers.some((p) =>
                new OBB(
                  new THREE.Vector3(),
                  new THREE.Vector3(...p.size).multiplyScalar(0.5),
                )
                  .applyMatrix4(
                    new THREE.Matrix4().compose(
                      new THREE.Vector3(...p.position),
                      new THREE.Quaternion(...p.quaternion),
                      new THREE.Vector3(1, 1, 1),
                    ),
                  )
                  .intersectsOBB(body),
              ),
              'the quarter-width body really overlaps rendered barrier geometry',
            );
            assert(
              !owner.isClearFoot(foot),
              'a body cannot be accepted through its actual handrail/glass',
            );
          }
          for (const reverse of [false, true]) {
            const a = reverse ? end : start,
              z = reverse ? start : end;
            let foot = owner.floorAt(
              a.toArray(),
              reverse ? 'flight-to' : 'flight-from',
            );
            assert(
              foot && owner.isClearFoot(foot),
              'the central landing remains usable',
            );
            const count = 180,
              step = z
                .clone()
                .sub(a)
                .multiplyScalar(1 / count);
            for (let i = 0; i < count; i++) {
              const next = owner.walk(foot, step.x, step.z);
              assert(owner.isClearFoot(next));
              assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
              foot = next;
            }
            assert(
              Math.hypot(foot.position[0] - z.x, foot.position[2] - z.z) < 0.1,
              'continuous centre passage reaches the opposite landing',
            );
            assert(Math.abs(foot.position[1] - z.y) < 0.18);
          }
        } finally {
          owner.dispose();
        }
      });
    }

test('a representative side walking lane follows a real central divider without moving any physical flight geometry', () => {
  const start = new THREE.Vector3(-200, 0, -200),
    end = new THREE.Vector3(-195.7573593128807, -3, -195.7573593128807),
    tangent = end.clone().sub(start).setY(0).normalize(),
    lateral = new THREE.Vector3(tangent.z, 0, -tangent.x),
    yaw = THREE.MathUtils.radToDeg(Math.atan2(tangent.x, tangent.z));
  const build = (offset) => {
    const b = interior(source, 'side-lane-fixture', [
      {
        url: 'https://www.translink.ca/',
        note: 'Synthetic physical centre-divider and side walking lane fixture.',
      },
    ]);
    for (const p of source.platforms)
      b.platform(p.surfaceId, { columns: false, roof: false });
    b.floor(
      'lane-from',
      start.clone().addScaledVector(tangent, -1).toArray(),
      4,
      2,
      'landing',
      'lane-from',
      'floor',
      yaw,
    );
    b.floor(
      'lane-to',
      end.clone().addScaledVector(tangent, 1).toArray(),
      4,
      2,
      'landing',
      'lane-to',
      'floor',
      yaw,
    );
    b.entrance(
      'lane-entry',
      'Fixture side entry',
      'lane-from',
      start.clone().addScaledVector(tangent, -0.6).toArray(),
    );
    b.flight(
      'side-flight',
      'lane-from',
      'lane-to',
      start.toArray(),
      end.toArray(),
      3,
      { walkLaneOffsetM: offset },
    );
    b.beam(
      'side-flight-central-divider',
      start
        .clone()
        .add(new THREE.Vector3(0, 0.93, 0))
        .toArray(),
      end
        .clone()
        .add(new THREE.Vector3(0, 0.93, 0))
        .toArray(),
      0.06,
      0.08,
      'red',
      'handrail',
    );
    b.beam(
      'explicit-visual-only',
      [-220, 0, -220],
      [-220, 1, -219],
      0.05,
      0.05,
      'red',
      'handrail',
      false,
    );
    return b.finish();
  };
  const central = build(0);
  assert(
    central.obstacles.some((p) => p.id === 'side-flight-central-divider'),
    'handrail beams are physical by default',
  );
  assert(
    !central.obstacles.some((p) => p.id === 'explicit-visual-only'),
    'explicit false remains possible',
  );
  const baseline = makeRuntimeStation(central, '0'.repeat(64)),
    blocked = new SkyTrainStationOwner(baseline, () => 0, 'balanced', false);
  try {
    const c = baseline.connections.find((c) => c.id === 'side-flight'),
      i = Math.floor(c.treads.length / 2),
      center = c.treads[i].vertices
        .reduce(
          (sum, p) => sum.add(new THREE.Vector3(...p)),
          new THREE.Vector3(),
        )
        .multiplyScalar(0.25),
      foot = blocked.floorAt(center.toArray(), `${c.id}:step:${i}`);
    assert(
      foot && !blocked.isClearFoot(foot),
      'the real central rail remains an obstacle',
    );
  } finally {
    blocked.dispose();
  }
  for (const offset of [-0.7, 0.7]) {
    const shifted = build(offset),
      data = makeRuntimeStation(shifted, '0'.repeat(64)),
      owner = new SkyTrainStationOwner(data, () => 0, 'balanced', false),
      c = data.connections.find((c) => c.id === 'side-flight');
    try {
      for (const key of ['geometryParts', 'obstacles', 'floorSurfaces'])
        assert.deepEqual(
          shifted[key],
          central[key],
          `${key}: walking-lane selection cannot modify physical geometry`,
        );
      assert.deepEqual(
        shifted.connections[0].treadSurfaces,
        central.connections[0].treadSurfaces,
      );
      for (const [actual, original] of [
        [c.start, start],
        [c.end, end],
      ])
        assert(
          new THREE.Vector3(...actual).distanceTo(
            original.clone().addScaledVector(lateral, offset),
          ) < 1e-10,
          'both representative walking endpoints use the same physical lateral offset',
        );
      for (const reverse of [false, true]) {
        const a = reverse ? c.end : c.start,
          z = reverse ? c.start : c.end;
        let foot = owner.floorAt(a, reverse ? c.to : c.from);
        assert(foot && owner.isClearFoot(foot));
        const delta = new THREE.Vector3(...z)
          .sub(new THREE.Vector3(...a))
          .multiplyScalar(1 / 180);
        for (let i = 0; i < 180; i++) {
          const next = owner.walk(foot, delta.x, delta.z);
          assert(owner.isClearFoot(next));
          assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
          foot = next;
        }
        assert(
          Math.hypot(foot.position[0] - z[0], foot.position[2] - z[2]) < 0.1,
          'the actual side lane reaches its opposite landing',
        );
        assert(Math.abs(foot.position[1] - z[1]) < 0.18);
      }
    } finally {
      owner.dispose();
    }
  }
  for (const offset of [NaN, Infinity, 'bad', 1.3, -1.3])
    assert.throws(() => build(offset), /walking lane/);
});
