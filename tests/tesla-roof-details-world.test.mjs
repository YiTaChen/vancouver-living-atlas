import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { TeslaRenderedRoofDetailsWorld } = await import(
  cityModule('tesla-roof-details-world')
);
const { CityTeslaWorld } = await import(cityModule('tesla-city-world'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const { teslaFrame } = await import(cityModule('tesla-math'));
const tiny = { halfExtents: [0.1, 0.1, 0.1], clearance: 0 };
const pose = (x, y, z) => ({ position: [x, y, z], quaternion: [0, 0, 0, 1] });
function fixture() {
  const scene = new THREE.Scene(),
    root = new THREE.Group(),
    records = new Map();
  scene.add(root);
  const host = {
    settings: { buildings: true },
    architecturalDetails: { root, records },
  };
  function add(
    id = '0,0/roof',
    {
      position = [0, 10, 0],
      size = [4, 1, 1],
      yaw = 0,
      count = 1,
      tier = 'roof',
    } = {},
  ) {
    const group = new THREE.Group(),
      mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshBasicMaterial(),
        count,
      );
    for (let i = 0; i < count; i++)
      mesh.setMatrixAt(
        i,
        new THREE.Matrix4().compose(
          new THREE.Vector3(position[0] + i * 100, position[1], position[2]),
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            yaw,
          ),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    root.add(group);
    const record = {
      id,
      tier,
      ready: true,
      group,
      cell: {
        bounds: new THREE.Box3(
          new THREE.Vector3(
            position[0] - 30,
            position[1] - 10,
            position[2] - 30,
          ),
          new THREE.Vector3(
            position[0] + Math.max(30, count * 100),
            position[1] + 10,
            position[2] + 30,
          ),
        ),
      },
    };
    records.set(id, record);
    return { record, mesh };
  }
  return { host, root, records, add };
}
const query = (from, to = from, shape = tiny) => ({ from, to, shape });

test('only actual ready visible roof instances collide, using rotated envelopes rather than world AABBs', () => {
  const { host, root, records, add } = fixture(),
    { record, mesh } = add('0,0/roof', { yaw: Math.PI / 4 }),
    world = new TeslaRenderedRoofDetailsWorld(host);
  try {
    const hit = world.sweep(query(pose(-10, 10, 0), pose(10, 10, 0)));
    assert.equal(hit?.kind, 'obstacle');
    assert.equal(hit?.adherable, false);
    assert.ok(hit.fraction > 0 && hit.fraction < 1);
    assert.equal(
      world.sweep(query(pose(1.5, 10, 1.5))),
      null,
      'empty corner of rotated box AABB stays clear',
    );
    const cases = [
      [() => (record.ready = false), () => (record.ready = true)],
      [
        () => (record.group.visible = false),
        () => (record.group.visible = true),
      ],
      [() => (mesh.visible = false), () => (mesh.visible = true)],
      [() => (root.visible = false), () => (root.visible = true)],
      [
        () => (host.settings.buildings = false),
        () => (host.settings.buildings = true),
      ],
      [() => records.delete(record.id), () => records.set(record.id, record)],
    ];
    for (const [hide, show] of cases) {
      hide();
      assert.equal(world.sweep(query(pose(-10, 10, 0), pose(10, 10, 0))), null);
      show();
      assert.ok(world.sweep(query(pose(-10, 10, 0), pose(10, 10, 0))));
    }
    record.tier = 'street';
    assert.equal(world.sweep(query(pose(0, 10, 0))), null);
    host.architecturalDetails = null;
    assert.equal(world.sweep(query(pose(0, 10, 0))), null);
  } finally {
    world.dispose();
  }
});

test('warm signatures follow actual LOD geometry, instance and parent transforms without retaining old obstacles', () => {
  const { host, add } = fixture(),
    { record, mesh } = add(),
    world = new TeslaRenderedRoofDetailsWorld(host);
  try {
    assert.equal(world.sweep(query(pose(0, 10, 1))), null);
    mesh.geometry = new THREE.BoxGeometry(4, 1, 4);
    assert.ok(world.sweep(query(pose(0, 10, 1))));
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(8, 10, 0));
    mesh.instanceMatrix.needsUpdate = true;
    assert.equal(world.sweep(query(pose(0, 10, 0))), null);
    assert.ok(world.sweep(query(pose(8, 10, 0))));
    record.group.position.z = 5;
    assert.equal(world.sweep(query(pose(8, 10, 0))), null);
    assert.ok(world.sweep(query(pose(8, 10, 5))));
    const attr = mesh.geometry.getAttribute('position');
    for (let i = 0; i < attr.count; i++) attr.setY(i, attr.getY(i) + 4);
    attr.needsUpdate = true;
    assert.equal(world.sweep(query(pose(8, 10, 5))), null);
    assert.ok(
      world.sweep(query(pose(8, 14, 5))),
      'changed position version recomputes source bounds',
    );
  } finally {
    world.dispose();
  }
});

test('the source-cell broad phase retains actual outward cornice envelopes without inflating collision geometry', () => {
  const { host, add } = fixture(),
    { record } = add('edge', {
      position: [30.2, 10, 0],
      size: [0.25, 0.25, 4],
    }),
    world = new TeslaRenderedRoofDetailsWorld(host);
  record.cell.bounds.max.x = 30;
  const pointShape = { halfExtents: [0.01, 0.01, 0.01], clearance: 0 };
  try {
    assert.ok(world.sweep(query(pose(30.2, 10, 0), undefined, pointShape)));
    assert.equal(
      world.sweep(query(pose(30.45, 10, 0), undefined, pointShape)),
      null,
    );
  } finally {
    world.dispose();
  }
});

test('local lazy metadata leaves remote geometry unread and caps both record and tile caches', () => {
  const { host, add } = fixture(),
    { mesh } = add('local', { count: 650 }),
    remote = add('remote', { position: [100000, 10, 0] }),
    world = new TeslaRenderedRoofDetailsWorld(host);
  remote.mesh.geometry.computeBoundingBox = () => {
    throw new Error('remote mesh was inspected');
  };
  try {
    assert.ok(world.sweep(query(pose(-4, 10, 0), pose(4, 10, 0))));
    assert.equal(world.stats().builtRecords, 1);
    assert.equal(world.stats().instanceSources, 650);
    assert.ok(
      world.stats().cachedFaces <= 48,
      '650 boxes do not eagerly build 7800 faces',
    );
    const built = world.stats().builtRecords;
    for (let i = 0; i < 20; i++)
      world.sweep(query(pose(-4, 10, 0), pose(4, 10, 0)));
    assert.equal(
      world.stats().builtRecords,
      built,
      'warm queries reuse geometry',
    );
    for (let i = 1; i <= 6; i++) {
      add(`cell${i}`, { position: [i * 1000, 10, 100] });
      world.sweep(query(pose(i * 1000, 10, 100)));
    }
    assert.ok(world.stats().cachedRecords <= 4);
    assert.ok(world.stats().cachedTiles <= 16);
    assert.ok(mesh.count === 650);
  } finally {
    world.dispose();
  }
  assert.equal(world.stats().cachedRecords, 0);
  assert.equal(world.sweep(query(pose(0, 10, 0))).fraction, 0);
});

function city(host, volume = false) {
  const roads = new THREE.Group(),
    floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    );
  floor.userData.asphaltSurface = floor.userData.walkSurface = true;
  roads.add(floor);
  return new CityTeslaWorld({
    ...host,
    roads,
    terrain: new THREE.Group(),
    data: {
      flightBuildingVolumes: volume
        ? [
            {
              polygon: [
                [
                  [-12, 0],
                  [12, 0],
                  [12, 30],
                  [-12, 30],
                ],
              ],
              minY: 0,
              maxY: 10,
            },
          ]
        : [],
      buildingRoofs: new Map(),
      streetLampPoints: [],
    },
    landmarkDetails: [],
    detailedTrees: { trees: [] },
    elevation: () => 0,
    streetFurniture: null,
  });
}
test('city nearest sweep and roof planner see actual visible equipment while hidden/unready detail cannot block them', () => {
  const f = fixture(),
    { record } = f.add('roof', {
      position: [0, 10.525, -2.5],
      size: [24, 0.05, 7],
    }),
    world = city(f.host, true),
    shape = createTeslaRoadsterShape(),
    roofQuery = {
      pose: {
        position: [
          0,
          10 - shape.halfExtents[2] - shape.clearance - 0.005,
          -0.68,
        ],
        quaternion: teslaFrame([0, 0, -1], [0, 1, 0]).quaternion,
      },
      shape,
      sourceSurfaceId: 'building:0:wall:0:0',
    };
  try {
    record.ready = false;
    assert.ok(world.planWallToRoof(roofQuery));
    record.ready = true;
    assert.equal(
      world.planWallToRoof(roofQuery),
      null,
      'late visible overhang blocks the exact planned arc',
    );
    const hit = world.sweep(
      query(pose(-20, 10.525, -2.5), pose(20, 10.525, -2.5)),
    );
    assert.ok(hit?.surfaceId.startsWith('architecture:'));
    assert.ok(world.stats().renderedRoofDetails.instanceSources > 0);
  } finally {
    world.dispose();
  }
});

test('strict ground withdrawal preserves source proof and also sweeps every rendered roof detail without caller ignore permission', () => {
  const f = fixture(),
    { record } = f.add('low-actual-ceiling', {
      position: [0, 1.525, 0],
      size: [8, 0.05, 8],
    }),
    world = city(f.host),
    shape = createTeslaRoadsterShape();
  try {
    const spawn = world.groundPoseNear([0, 1.05, 0], shape, 0, 0);
    assert.ok(spawn);
    const from = spawn.pose,
      to = {
        ...from,
        position: [from.position[0], from.position[1] + 0.35, from.position[2]],
      },
      request = {
        from,
        to,
        origin: from,
        shape,
        sourceSurfaceId: spawn.contact.surfaceId,
      };
    const hit = world.sweepGroundDeparture(request);
    assert.ok(hit?.surfaceId.startsWith('architecture:'));
    assert.ok(hit.fraction > 0 && hit.fraction < 1);
    assert.ok(
      world.sweepGroundDeparture({
        ...request,
        ignoreSurfaceId: hit.surfaceId,
      }),
      'a caller cannot skip nonadherable detail',
    );
    record.group.visible = false;
    assert.equal(world.sweepGroundDeparture(request), null);
    assert.equal(
      world.sweepGroundDeparture({
        ...request,
        sourceSurfaceId: 'wrong-source',
      }).fraction,
      0,
    );
  } finally {
    world.dispose();
  }
});
