import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { CityTeslaWorld } = await import(cityModule('tesla-city-world'));
const { TravelSurfaceIndex } = await import(cityModule('travel-surfaces'));
const { createTeslaRoadsterShape } = await import(cityModule('tesla-shape'));
const shape = createTeslaRoadsterShape();
const groundIdentity = { surfaceId: 'ground', layer: 0 };
function fixture({
  grade = 0,
  tree = false,
  ceiling = null,
  deck = false,
  walkOnly = false,
  ridge = false,
  furniture = false,
  singleDeck = false,
} = {}) {
  const roads = new THREE.Group(),
    terrain = new THREE.Group(),
    medium = new THREE.Group(),
    holder = new THREE.Group(),
    geometries = [],
    materials = [];
  const add = (parent, geometry, flags = {}) => {
    const material = new THREE.MeshBasicMaterial(),
      mesh = new THREE.Mesh(geometry, material);
    Object.assign(mesh.userData, flags);
    parent.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    return mesh;
  };
  const road = new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    vertices = road.getAttribute('position');
  for (let i = 0; i < vertices.count; i++)
    vertices.setY(i, grade * vertices.getZ(i));
  add(roads, road, { asphaltSurface: true, walkSurface: true });
  if (ridge) {
    const geometry = new THREE.BufferGeometry(),
      xs = [-0.2, -0.2, 0.2, -0.2, 0.2, 0.2],
      zs = [-2.3, -2.2, -2.2, -2.3, -2.2, -2.3];
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        xs.flatMap((x, i) => [x, grade * zs[i] + 0.07, zs[i]]),
        3,
      ),
    );
    add(roads, geometry, { walkSurface: true });
  }
  if (ceiling !== null) {
    const mesh = add(
      medium,
      new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
    );
    mesh.position.y = ceiling;
    holder.add(medium);
  }
  const protectedSurfaces = deck
    ? [
        {
          surfaceId: 'bridge:launch',
          routeId: 'bridge:launch',
          layer: 1,
          allowedModes: walkOnly ? ['walk'] : ['drive'],
          triangles: [
            -40, 8, -40, -40, 8, 40, 40, 8, 40, -40, 8, -40, 40, 8, 40, 40, 8,
            -40,
          ],
        },
      ]
    : [];
  if (singleDeck && protectedSurfaces.length)
    protectedSurfaces[0].triangles = [-40, 8, -40, 80, 8, -40, -40, 8, 80];
  const e = {
    roads,
    terrain,
    data: {
      flightBuildingVolumes: [],
      buildingRoofs: new Map(),
      travelSurfaces: new TravelSurfaceIndex(protectedSurfaces),
      streetLampPoints: [],
    },
    landmarkDetails: ceiling === null ? [] : [{ holder, medium }],
    detailedTrees: {
      trees: tree ? [{ x: 4, z: 0, y: 0, h: 20, conifer: false }] : [],
    },
    settings: { buildings: true },
    elevation: () => 0,
    waterWorld: { at: () => null },
    streetFurniture: furniture
      ? {
          ready: false,
          placements: [
            {
              id: 'overhead-bench',
              kind: 'cedar-bench',
              x: 0,
              y: 5,
              z: 0,
              yaw: 0,
            },
          ],
        }
      : null,
  };
  const world = new CityTeslaWorld(e);
  return {
    e,
    world,
    spawn: () => world.groundPoseNear([0, 0, 0], shape, 0, 0),
    dispose: () => {
      world.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

test('placement callbacks see only verified road candidates and skip a real canopy while leaving tree collision intact', () => {
  const f = fixture({ tree: true });
  try {
    const blocked = f.spawn();
    assert(blocked);
    assert.equal(
      f.world.hasLaunchClearance(blocked, shape),
      false,
      'source tree crown blocks the full twenty-metre vehicle corridor',
    );
    const top = {
      ...blocked.pose,
      position: [
        blocked.pose.position[0],
        blocked.pose.position[1] + 20,
        blocked.pose.position[2],
      ],
    };
    assert.match(
      f.world.sweep({
        from: blocked.pose,
        to: top,
        shape,
        ignoreSurfaceId: blocked.contact.surfaceId,
      })?.surfaceId ?? '',
      /^tree:0:crown/,
    );
    let checked = 0;
    const open = f.world.groundPoseNear(
      [0, 0, 0],
      shape,
      0,
      16,
      groundIdentity,
      (candidate) => {
        checked++;
        assert.equal(candidate.identity.surfaceId, 'ground');
        assert(
          f.world.support({
            pose: candidate.pose,
            shape,
            maxDistance: 1.03,
            preferredSurfaceId: candidate.contact.surfaceId,
            adhesion: false,
          }),
        );
        assert.equal(
          f.world.sweep({
            from: candidate.pose,
            to: candidate.pose,
            shape,
            ignoreSurfaceId: candidate.contact.surfaceId,
          }),
          null,
        );
        return f.world.hasLaunchClearance(candidate, shape);
      },
    );
    assert(open);
    assert(checked > 1);
    assert(Math.hypot(open.pose.position[0], open.pose.position[2]) >= 7.9);
    assert.equal(f.world.hasLaunchClearance(open, shape), true);
    assert.equal(
      f.world.hasLaunchClearance(blocked, shape),
      false,
      'checking another candidate never removes the existing crown',
    );
    assert.equal(
      f.world.groundPoseNear([0, 0, 0], shape, 0, 0, groundIdentity, (c) =>
        f.world.hasLaunchClearance(c, shape),
      ),
      null,
    );
    assert(
      f.spawn(),
      'the ordinary verified road remains available when open-sky preference fails',
    );
  } finally {
    f.dispose();
  }
});

test('open-ascent proof retains a sloped ordinary ground body while its initial full tyre-plane box overlaps neighbouring paving', () => {
  const f = fixture({ grade: 0.03, ridge: true });
  try {
    const spawn = f.spawn();
    assert(spawn);
    assert(
      f.world.sweep({ from: spawn.pose, to: spawn.pose, shape }),
      'the full tyre-plane envelope initially intersects the real rear paving',
    );
    assert.equal(
      f.world.sweep({
        from: spawn.pose,
        to: spawn.pose,
        shape,
        ignoreSurfaceId: spawn.contact.surfaceId,
      }),
      null,
      'the authored rear body clearance is physically valid',
    );
    assert.equal(
      f.world.hasLaunchClearance(spawn, shape),
      true,
      'strict departure clears the source without ignoring the adjacent paving or any overhead object',
    );
  } finally {
    f.dispose();
  }
});

test('both a close ceiling and an overhead obstacle in the upper corridor reject the full vehicle, while a higher roof is outside the bounded preference', () => {
  for (const [ceiling, clear] of [
    [1.55, false],
    [10, false],
    [20.9, false],
    [25, true],
  ]) {
    const f = fixture({ ceiling });
    try {
      const spawn = f.spawn();
      assert(spawn);
      assert.equal(
        f.world.hasLaunchClearance(spawn, shape),
        clear,
        `ceiling ${ceiling}m`,
      );
      if (ceiling === 25)
        assert.equal(
          f.world.hasLaunchClearance(spawn, shape, 32),
          false,
          'twenty metres is a bounded preference, not unlimited clearance',
        );
    } finally {
      f.dispose();
    }
  }
});

test('protected road launch proof retains exact layer and drive permission without ignoring an upper floor', () => {
  const f = fixture({ deck: true });
  try {
    const lower = f.spawn();
    assert(lower);
    assert.equal(
      f.world.hasLaunchClearance(lower, shape),
      false,
      'the real deck blocks the lower ordinary road',
    );
    const upper = f.world.groundPoseNear([0, 8, 0], shape, 0, 0, {
      surfaceId: 'bridge:launch',
      layer: 1,
    });
    assert(upper);
    assert.equal(upper.identity.layer, 1);
    assert.equal(f.world.hasLaunchClearance(upper, shape), true);
    let seen = 0;
    const same = f.world.groundPoseNear(
      [0, 8, 0],
      shape,
      0,
      0,
      { surfaceId: 'bridge:launch', layer: 1 },
      (candidate) => {
        seen++;
        assert.equal(candidate.identity.surfaceId, 'bridge:launch');
        assert.equal(candidate.identity.layer, 1);
        return f.world.hasLaunchClearance(candidate, shape);
      },
    );
    assert(same);
    assert.equal(seen, 1);
  } finally {
    f.dispose();
  }
  const blocked = fixture({ deck: true, ceiling: 15 });
  try {
    const upper = blocked.world.groundPoseNear([0, 8, 0], shape, 0, 0, {
      surfaceId: 'bridge:launch',
      layer: 1,
    });
    assert(upper);
    assert.equal(blocked.world.hasLaunchClearance(upper, shape), false);
  } finally {
    blocked.dispose();
  }
  const pedestrian = fixture({ deck: true, walkOnly: true });
  try {
    const fake = {
      pose: { position: [0, 8.682, 0], quaternion: [0, 0, 0, 1] },
      contact: {
        surfaceId: 'protected:0:face:0',
        kind: 'ground',
        point: [0, 8, 0],
        normal: [0, 1, 0],
        adherable: true,
      },
    };
    assert.equal(
      pedestrian.world.hasLaunchClearance(fake, shape),
      false,
      'a pedestrian-only deck cannot acquire drive or departure permission',
    );
  } finally {
    pedestrian.dispose();
  }
});

test('protected launch preference rejects true initial penetration even when one exact source triangle spans the full vehicle', () => {
  const f = fixture({ deck: true, singleDeck: true });
  try {
    assert.equal(f.e.data.travelSurfaces.surfaces[0].triangles.length, 9);
    const spawn = f.world.groundPoseNear([0, 8, 0], shape, 0, 0, {
      surfaceId: 'bridge:launch',
      layer: 1,
    });
    assert(spawn);
    assert.equal(f.world.hasLaunchClearance(spawn, shape), true);
    const penetrated = {
      ...spawn,
      pose: {
        ...spawn.pose,
        position: [
          spawn.pose.position[0],
          spawn.pose.position[1] - 0.03,
          spawn.pose.position[2],
        ],
      },
    };
    assert(
      f.world.support({
        pose: penetrated.pose,
        shape,
        maxDistance: 1.03,
        preferredSurfaceId: spawn.contact.surfaceId,
        adhesion: false,
      }),
      'legacy support tolerance alone is not clearance',
    );
    assert.equal(
      f.world.hasLaunchClearance(penetrated, shape),
      false,
      'no protected source is ignored to excuse an already penetrating origin',
    );
  } finally {
    f.dispose();
  }
});

test('launch preference re-proves source and current overhead props and fails closed for finite, identity and disposed-world errors', () => {
  const f = fixture({ furniture: true });
  try {
    const spawn = f.spawn();
    assert(spawn);
    assert.equal(f.world.hasLaunchClearance(spawn, shape), true);
    f.e.streetFurniture.ready = true;
    assert.equal(
      f.world.hasLaunchClearance(spawn, shape),
      false,
      'a newly visible overhead prop is included in the current sweep',
    );
    f.e.streetFurniture.ready = false;
    assert.equal(f.world.hasLaunchClearance(spawn, shape), true);
    for (const height of [NaN, Infinity, -1, 0, 0.349, 65, 1e8])
      assert.equal(f.world.hasLaunchClearance(spawn, shape, height), false);
    for (const patch of [
      { pose: { ...spawn.pose, position: [NaN, 0, 0] } },
      { pose: { ...spawn.pose, quaternion: [0, 0, 0, NaN] } },
      { pose: { ...spawn.pose, position: [1e8, 0.682, 0] } },
      { pose: { ...spawn.pose, position: [0, 3, 0] } },
      { contact: { ...spawn.contact, surfaceId: 'ground:asphalt:missing' } },
      { contact: { ...spawn.contact, kind: 'roof' } },
    ])
      assert.equal(
        f.world.hasLaunchClearance({ ...spawn, ...patch }, shape),
        false,
      );
    assert.equal(
      f.world.hasLaunchClearance(spawn, {
        ...shape,
        halfExtents: [NaN, 0.62, 2.34],
      }),
      false,
    );
    f.world.dispose();
    assert.equal(f.world.hasLaunchClearance(spawn, shape), false);
  } finally {
    f.dispose();
  }
});
