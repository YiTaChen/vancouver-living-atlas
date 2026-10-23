import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const routes = JSON.parse(readFileSync('public/models/skytrain-routes.json'));
const makeOwner = (id) =>
  new SkyTrainStationOwner(
    adaptSkyTrainStationFrame(
      JSON.parse(readFileSync(`public/models/skytrain-stations/${id}.json`)),
      routes,
    ),
    cityElevation,
    'balanced',
    true,
  );

for (const id of ['burrard', 'granville'])
  test(`${id}: mapped doorway attachments stop at the real door and preserve every authored stair`, () => {
    const owner = makeOwner(id);
    try {
      for (const entry of owner.streetEntrances()) {
        const sourceId =
            owner.data.authoredInterior.streetEntranceMap[entry.id],
          door = owner.data.entrances.find((e) => e.id === sourceId),
          threshold = new THREE.Vector3(...owner.toLocal(entry.threshold)),
          direction = new THREE.Vector3(...entry.localDirection),
          apron = owner.geometryData.floors.find(
            (f) => f.id === entry.surfaceId,
          ),
          throat = owner.geometryData.floors.find(
            (f) => f.id === `${id}-${entry.id}-authored-threshold`,
          );
        assert(
          door && apron && throat,
          `${entry.id}: exact mapped attachment exists`,
        );
        assert(
          Math.hypot(door.point[0] - threshold.x, door.point[2] - threshold.z) <
            0.2,
        );
        for (const point of apron.vertices)
          assert(
            new THREE.Vector3(...point).sub(threshold).dot(direction) <= 1e-5,
            `${apron.id}: attachment may not extend inward over the real first flight`,
          );
        const throatStart = owner.geometryData.connections.find(
            (c) => c.id === `${apron.id}-join`,
          ).start,
          throatDirection = new THREE.Vector3(...door.point)
            .sub(new THREE.Vector3(...throatStart))
            .setY(0)
            .normalize();
        for (const point of throat.vertices)
          assert(
            new THREE.Vector3(...point)
              .sub(new THREE.Vector3(...door.point))
              .dot(throatDirection) <= 1e-5,
            `${entry.id}: the full threshold section ends on the actual source door plane`,
          );
        const handoff = owner.floorAt(
          owner.toLocal(entry.inward),
          entry.surfaceId,
        );
        assert(
          handoff && owner.isClearFoot(handoff),
          `${entry.id}: public handoff remains on its real supporting apron`,
        );
        assert(
          owner.tryEnterFromStreet(entry.inward),
          `${entry.id}: the supplied entry point admits a supported real body`,
        );
        for (const sourceFloor of owner.data.floors)
          assert.deepEqual(
            owner.geometryData.floors.find((f) => f.id === sourceFloor.id),
            sourceFloor,
            `${entry.id}: attachment must not rewrite the source floor or its stairwell holes`,
          );
        for (const c of owner.data.connections.filter(
          (c) => c.treads.length && c.from === door.surfaceId,
        )) {
          assert.deepEqual(
            owner.geometryData.connections.find((v) => v.id === c.id),
            c,
          );
          for (const tread of c.treads) {
            const p = tread.vertices.reduce(
              (sum, v) =>
                sum.map((n, axis) => n + v[axis] / tread.vertices.length),
              [0, 0, 0],
            );
            if (new THREE.Vector3(...p).sub(threshold).dot(direction) > 0.02) {
              assert.equal(
                owner.floorAt(p, apron.id),
                null,
                `${entry.id}: no generated street floor covers ${tread.id}`,
              );
              assert.equal(
                owner.floorAt(p, throat.id),
                null,
                `${entry.id}: no generated threshold covers ${tread.id}`,
              );
            }
          }
        }
      }
    } finally {
      owner.dispose();
    }
  });

test('Burrard Park handoff, exact first flight and return remain supported with at most .221m native steps', () => {
  const owner = makeOwner('burrard');
  try {
    const entry = owner.streetEntrances().find((e) => e.id === 'burrard-park'),
      sourceDoor = owner.data.entrances.find(
        (e) => e.id === owner.data.authoredInterior.streetEntranceMap[entry.id],
      ),
      flight = owner.data.connections.find(
        (c) => c.from === sourceDoor.surfaceId && c.type === 'stairs',
      ),
      throat = owner.geometryData.connections.find(
        (c) => c.id === `burrard-${entry.id}-street-apron-join`,
      );
    assert(flight && throat);
    const street = owner.toWorld(
      new THREE.Vector3(...owner.toLocal(entry.threshold))
        .addScaledVector(new THREE.Vector3(...entry.localDirection), -1.6)
        .toArray(),
    );
    street[1] = cityElevation(street[0], street[2]);
    let foot = owner.tryEnterFromStreet(street);
    assert(foot && owner.isClearFoot(foot));
    const initial = structuredClone(foot),
      walk = (goal) => {
        const dx = goal[0] - foot.position[0],
          dz = goal[2] - foot.position[2],
          count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.04));
        for (let i = 0; i < count; i++) {
          const next = owner.walk(foot, dx / count, dz / count);
          assert(
            Math.abs(next.position[1] - foot.position[1]) <= 0.221,
            'actual native riser limit is unchanged',
          );
          assert(
            owner.isClearFoot(next),
            'every capsule sample has actual floor support and collision clearance',
          );
          foot = next;
        }
        assert(
          Math.hypot(foot.position[0] - goal[0], foot.position[2] - goal[2]) <
            0.08,
          `native input stops before ${goal}: ${foot.position}`,
        );
        assert(
          Math.abs(foot.position[1] - goal[1]) <= 0.221,
          `waypoint height differs: ${foot.position}, expected ${goal}`,
        );
      };
    for (const goal of [
      throat.start,
      sourceDoor.point,
      flight.end,
      flight.start,
      throat.start,
      initial.position,
    ])
      walk(goal);
    assert(
      new THREE.Vector3(...foot.position).distanceTo(
        new THREE.Vector3(...initial.position),
      ) < 0.08,
    );
  } finally {
    owner.dispose();
  }
});

test('a rendered street datum above the source lift door cannot raise its mapped throat over the real landing', () => {
  const base = makeOwner('burrard'),
    streetHeight = (x, z) => cityElevation(x, z) + 1.1,
    owner = new SkyTrainStationOwner(
      base.data,
      cityElevation,
      'balanced',
      true,
      streetHeight,
    );
  try {
    const entry = owner
        .streetEntrances()
        .find((e) => e.id === 'burrard-elevator'),
      door = owner.data.entrances.find(
        (e) => e.id === owner.data.authoredInterior.streetEntranceMap[entry.id],
      ),
      inward = owner.floorAt(owner.toLocal(entry.inward), entry.surfaceId);
    assert(inward && owner.isClearFoot(inward));
    assert(Math.abs(inward.position[1] - door.point[1]) < 1e-7);
    const direction = new THREE.Vector3(
        ...entry.localDirection,
      ).applyQuaternion(owner.group.quaternion),
      start = new THREE.Vector3(...entry.threshold).addScaledVector(
        direction,
        -2.2,
      );
    start.y = streetHeight(start.x, start.z);
    let foot = owner.tryEnterFromStreet(start.toArray()),
      maximumRise = 0;
    assert(
      foot,
      'the public street owns the outer apron before its source-height blend',
    );
    for (let i = 0; i < 44; i++) {
      const next = owner.worldWalk(
        foot,
        direction.x * 0.05,
        direction.z * 0.05,
      );
      maximumRise = Math.max(
        maximumRise,
        Math.abs(next.position[1] - foot.position[1]),
      );
      assert(owner.isClearFoot(next));
      foot = next;
    }
    assert(
      Math.hypot(
        foot.position[0] - door.point[0],
        foot.position[2] - door.point[2],
      ) < 0.02,
    );
    assert(Math.abs(foot.position[1] - door.point[1]) < 1e-7);
    assert(maximumRise <= 0.221);
  } finally {
    owner.dispose();
    base.dispose();
  }
});

test('Granville Dunsmuir exits and returns over a rendered apron above its overlapping source hall', () => {
  const base = makeOwner('granville'),
    streetHeight = (x, z) => cityElevation(x, z) + 1.1,
    owner = new SkyTrainStationOwner(
      base.data,
      cityElevation,
      'balanced',
      true,
      streetHeight,
    );
  try {
    const entry = owner
        .streetEntrances()
        .find((e) => e.id === 'dunsmuir-street'),
      direction = new THREE.Vector3(...entry.localDirection),
      start = owner.tryEnterFromStreet(entry.inward);
    assert(start && owner.isClearFoot(start));
    let foot = start,
      raisedApron = false,
      maximumRise = 0,
      exit = null;
    const step = (sign) => {
      const next = owner.walk(
        foot,
        direction.x * 0.05 * sign,
        direction.z * 0.05 * sign,
      );
      maximumRise = Math.max(
        maximumRise,
        Math.abs(next.position[1] - foot.position[1]),
      );
      assert(owner.isClearFoot(next));
      assert(
        Math.hypot(
          next.position[0] - foot.position[0],
          next.position[2] - foot.position[2],
        ) > 0.045,
        `continuous native motion cannot stall on a lower overlapping hall: ${foot.surfaceId} ${foot.position}`,
      );
      raisedApron ||=
        next.surfaceId === entry.surfaceId &&
        next.position[1] > start.position[1] + 0.3;
      foot = next;
    };
    let outwardSteps = 0;
    while (!exit && outwardSteps++ < 80) {
      step(-1);
      exit = owner.streetExit(foot);
    }
    assert(exit, 'the real outside apron releases ownership to the city');
    assert(
      raisedApron,
      'the visible raised apron owns the body above the hall underlay',
    );
    for (let i = 0; i < outwardSteps; i++) step(1);
    assert(
      new THREE.Vector3(...foot.position).distanceTo(
        new THREE.Vector3(...start.position),
      ) < 0.08,
    );
    assert(maximumRise <= 0.221, 'the fix retains real step-height limits');
    for (const floor of owner.data.floors)
      assert.deepEqual(
        owner.geometryData.floors.find((f) => f.id === floor.id),
        floor,
      );
  } finally {
    owner.dispose();
    base.dispose();
  }
});

test('a lower street apron cannot pull a walker through the higher visible hall floor', () => {
  const base = makeOwner('granville'),
    data = structuredClone(base.data),
    x = -140,
    z = -140,
    upperId = 'fixture-visible-upper-hall',
    lowerId = 'fixture-lower-street-apron';
  const floor = (id, y, kind) => ({
    id,
    level: id,
    kind,
    vertices: [
      [x - 3, y, z - 3],
      [x - 3, y, z + 3],
      [x + 3, y, z + 3],
      [x + 3, y, z - 3],
    ],
    indices: [0, 1, 2, 0, 2, 3],
  });
  data.floors.push(
    floor(upperId, 0, 'corridor'),
    floor(lowerId, -0.15, 'street-apron'),
  );
  data.parts.push(
    ...[
      [upperId, 0],
      [lowerId, -0.15],
    ].map(([id, y]) => ({
      id: `floor-${id}`,
      position: [x, y - 0.1, z],
      size: [6, 0.2, 6],
      yaw: 0,
      material: 'floor',
      role: 'floor',
    })),
  );
  data.connections.push({
    id: 'fixture-coplanar-neighbors',
    from: upperId,
    to: lowerId,
    type: 'walk',
    start: [x, 0, z],
    end: [x, -0.15, z],
    width: 2.4,
    treads: [],
  });
  const owner = new SkyTrainStationOwner(data, cityElevation, 'balanced', true);
  try {
    let foot = owner.floorAt([x, 0, z], upperId);
    assert(foot && owner.isClearFoot(foot));
    for (const sign of [1, -1])
      for (let i = 0; i < 24; i++) {
        foot = owner.walk(foot, sign * 0.05, sign * 0.025);
        assert(owner.isClearFoot(foot));
        assert.equal(
          foot.surfaceId,
          upperId,
          'the lower apron never steals a higher supported floor',
        );
        assert(
          Math.abs(foot.position[1]) < 1e-9,
          'the body stays on the higher rendered slab',
        );
      }
  } finally {
    owner.dispose();
    base.dispose();
  }
});
