import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { StreetNavigation } = await import(cityModule('navigation'));
const { GroundSurfaceIndex } = await import(cityModule('ground-surface'));
const { TravelSurfaceIndex } = await import(cityModule('travel-surfaces'));
const { VehicleImpactWorld } = await import(cityModule('vehicle-impact-world'));
const { VehicleCondition } = await import(cityModule('vehicle-condition'));

function rectangle(x0, x1, z0, z1, y) {
  return [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
}
function fixture({
  asphalt = rectangle(-6, 6, -10, 10, 1.05),
  walkHeight = 1.5,
  allowedModes = ['walk'],
} = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(asphalt, 3),
    ),
    new THREE.MeshBasicMaterial(),
  );
  const road = new GroundSurfaceIndex([mesh]);
  const gate = {
    id: 'pedestrian-entry',
    from: { surfaceId: 'ground', layer: 0 },
    to: { surfaceId: 'walkway', layer: 1 },
    allowedModes,
    twoWay: true,
    maxSeamStep: 0.02,
    geometry: { kind: 'gate', a: [-4, 0], b: [4, 0], fromSide: -1 },
  };
  const index = new TravelSurfaceIndex([
    {
      surfaceId: 'walkway',
      layer: 1,
      routeId: 'walk-entry',
      allowedModes,
      triangles: rectangle(-4, 4, 0, 10, walkHeight),
    },
  ]);
  const e = {
    elevation: () => 0,
    onLand: () => true,
    data: {
      roadSurface: road,
      travelSurfaces: index,
      causewayConnections: [gate],
      waterPolys: [],
    },
    scene: new THREE.Scene(),
    roads: new THREE.Group(),
    settings: { trees: true, quality: 'balanced' },
    detailedTrees: { trees: [] },
  };
  const car = new THREE.Group();
  e.scene.add(car, e.roads);
  const nav = Object.assign(Object.create(StreetNavigation.prototype), {
    e,
    mode: 'drive',
    position: new THREE.Vector3(0, 1.25, -0.5),
    yaw: 0,
    car,
    speed: 33.333333,
    collisions: new Map(),
    surface: 'ground',
    surfaceId: undefined,
    surfaceLayer: undefined,
  });
  const dispose = () => {
    nav.condition?.dispose();
    e.vehicleImpacts?.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  };
  return { e, nav, gate, index, dispose };
}

test('ordinary Drive stays on its paved ground floor when a walk-only entrance gate crosses the road', () => {
  const f = fixture();
  try {
    f.nav.move(0, 1);
    assert.equal(f.nav.position.z, 0.5);
    assert.equal(f.nav.speed, 33.333333);
    assert.equal(f.nav.surfaceId, 'ground');
    assert(Math.abs(f.nav.position.y - 1.25) < 1e-6);
  } finally {
    f.dispose();
  }
});

test('walking still selects its explicitly connected entrance floor', () => {
  const f = fixture({ walkHeight: 1.05 });
  try {
    f.nav.mode = 'walk';
    f.nav.groundHeight = () => 1.05;
    f.nav.move(0, 1);
    assert.equal(f.nav.position.z, 0.5);
    assert.equal(f.nav.surfaceId, 'walkway');
    assert.equal(f.nav.surfaceLayer, 1);
  } finally {
    f.dispose();
  }
});

test('a drive-allowed gate keeps priority over the same ground asphalt', () => {
  const f = fixture({ walkHeight: 1.05, allowedModes: ['walk', 'drive'] });
  try {
    f.nav.move(0, 1);
    assert.equal(f.nav.surfaceId, 'walkway');
    assert.equal(f.nav.surfaceLayer, 1);
  } finally {
    f.dispose();
  }
});

test('a reversed two-way pedestrian gate also preserves the paved ground identity', () => {
  const f = fixture();
  try {
    [f.gate.from, f.gate.to] = [f.gate.to, f.gate.from];
    f.gate.geometry.fromSide = 1;
    f.nav.move(0, 1);
    assert.equal(f.nav.position.z, 0.5);
    assert.equal(f.nav.surfaceId, 'ground');
  } finally {
    f.dispose();
  }
});

test('an uncrossed walk gate performs no pavement-track exception work', () => {
  const f = fixture();
  try {
    f.nav.pavedDriveContinuation = () => {
      throw new Error('uncrossed gate must not request a proof');
    };
    assert.equal(f.nav.protectedStep(0, -0.25).surfaceId, 'ground');
  } finally {
    f.dispose();
  }
});

test('body support probes do not add a second whole-car furniture radius beside a clear roadside object', () => {
  const f = fixture();
  try {
    f.e.streetFurniture = {
      blocked: (x, z, radius) => Math.hypot(x - 2, z) < radius + 0.13,
    };
    assert.equal(f.nav.clearGround(0, 0), true);
    f.nav.move(0, 1);
    assert.equal(f.nav.position.z, 0.5);
    assert.equal(f.nav.speed, 33.333333);
    // The ordinary centre test still refuses a genuine intrusion.
    f.e.streetFurniture = {
      blocked: (x, z, radius) => Math.hypot(x - 0.9, z) < radius + 0.13,
    };
    assert.equal(f.nav.clearGround(0, 0), false);
  } finally {
    f.dispose();
  }
});

test('asphalt must support the full nose, tail and both sides throughout the crossing', () => {
  const variants = [
    { label: 'no ordinary asphalt', asphalt: [] },
    {
      label: 'asphalt ends at the entrance',
      asphalt: rectangle(-6, 6, -10, 0, 1.05),
    },
    {
      label: 'centreline is paved but tyres overhang',
      asphalt: rectangle(-0.7, 0.7, -10, 10, 1.05),
    },
    {
      label: 'intermediate pavement gap',
      asphalt: [
        ...rectangle(-6, 6, -10, -0.2, 1.05),
        ...rectangle(-6, 6, 0.2, 10, 1.05),
      ],
    },
    ...[0.02, 0.1].map((gap) => ({
      label: `${gap * 100}cm gap between the former .3m sampling stations`,
      asphalt: [
        ...rectangle(-6, 6, -10, 0.08, 1.05),
        ...rectangle(-6, 6, 0.08 + gap, 10, 1.05),
      ],
    })),
    {
      label: 'same XY belongs to a different elevation',
      asphalt: rectangle(-6, 6, -10, 10, 2.05),
    },
  ];
  for (const v of variants) {
    const f = fixture(v);
    try {
      f.nav.move(0, 1);
      assert.equal(f.nav.position.z, -0.5, v.label);
      assert.equal(f.nav.speed, 0, v.label);
    } finally {
      f.dispose();
    }
  }
});

test('water, buildings and interiors retain their own ground permissions', () => {
  for (const kind of ['water', 'building', 'interior']) {
    const f = fixture();
    try {
      if (kind === 'water')
        f.e.data.waterPolys = [
          [
            [
              [-6, 0],
              [-6, 10],
              [6, 10],
              [6, 0],
            ],
          ],
        ];
      if (kind === 'building')
        f.nav.collisions.set('0,0', [
          [
            [
              [0, 0],
              [0, 10],
              [6, 10],
              [6, 0],
            ],
          ],
        ]);
      if (kind === 'interior')
        f.e.interiors = { height: () => 1.05, clear: () => true };
      f.nav.move(0, 1);
      assert(
        f.nav.position.z < 0,
        `${kind}: the forbidden entrance gate remains uncrossed`,
      );
      assert.equal(f.nav.speed, 0, kind);
    } finally {
      f.dispose();
    }
  }
});

test('an existing protected floor never falls back to the ordinary asphalt proof', () => {
  const f = fixture();
  try {
    f.nav.position.set(0, 1.5, 0.5);
    f.nav.surface = 'bridge';
    f.nav.surfaceId = 'walkway';
    f.nav.surfaceLayer = 1;
    f.nav.move(0, 1);
    assert.equal(f.nav.position.z, 0.5);
    assert.equal(f.nav.surfaceId, 'walkway');
    assert.equal(f.nav.speed, 0);
  } finally {
    f.dispose();
  }
});

test('the same paved crossing still runs full vehicle CCD against a real trunk', () => {
  const f = fixture();
  try {
    // Starts clear, with a full-size trunk beyond the front bumper.
    f.nav.position.z = -3.2;
    f.e.detailedTrees.trees = [{ x: 0, y: 0, z: 1.8, h: 26, conifer: false }];
    f.e.vehicleImpacts = new VehicleImpactWorld(f.e);
    f.nav.condition = new VehicleCondition(f.e, f.nav.car, 1550, 0.7);
    f.nav.move(0, 4);
    assert(f.nav.position.z < 1.8 - 26 * 0.035 - 2.4);
    assert(Math.abs(f.nav.speed) < 2);
    assert(f.nav.condition.damage.overall > 0);
    assert.equal(f.e.vehicleImpacts.broken.size, 0);
  } finally {
    f.dispose();
  }
});
