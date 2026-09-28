import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { architectureWork, roofBoxFits } = await import(
  cityModule('architecture-plan')
);
const { ArchitecturalDetails, ARCHITECTURE_BUDGET } = await import(
  cityModule('architecture-details')
);
const { createProfile, windowBounds, fitBays } = await import(
  cityModule('facade-profile')
);
const { unproject } = await import(cityModule('geo'));

const rectangle = [
  [0, 0],
  [30, 0],
  [30, 20],
  [0, 20],
];
const profile = createProfile({
  key: 'sample',
  heightM: 18,
  footprintAreaM2: 600,
  center: [0, 0],
});
const part = {
  key: 'sample',
  polygon: [rectangle],
  ground: 12,
  height: 18,
  minHeight: 0,
  profile,
  roof: true,
};

test('roof placement respects concave edges, courtyards, roof equipment exclusions and rotation', () => {
  assert(roofBoxFits([rectangle], 15, 10, 4, 3, Math.PI / 4));
  assert(!roofBoxFits([rectangle], 1, 1, 4, 3, Math.PI / 4));
  const hole = [
    [14.1, 10.1],
    [14.4, 10.1],
    [14.4, 10.4],
    [14.1, 10.4],
  ];
  // All nine old sample points would miss this enclosed courtyard.
  assert(!roofBoxFits([rectangle, hole], 15, 10, 6, 6, 0));
  assert(!roofBoxFits([rectangle], 15, 10, 6, 6, 0, [[hole]]));
  const notch = [
    [0, 0],
    [30, 0],
    [30, 20],
    [17, 20],
    [17, 8],
    [16.6, 8],
    [16.6, 20],
    [0, 20],
  ];
  assert(!roofBoxFits([notch], 15, 10, 8, 6, 0));
});

test('architectural descriptors are finite, deterministic and roof equipment clears source roof margins', () => {
  const first = [...architectureWork([part], 'roof')].filter(Boolean);
  assert.deepEqual(
    first,
    [...architectureWork([part], 'roof')].filter(Boolean),
  );
  assert(first.some((b) => b.kind === 'parapet'));
  assert(first.some((b) => b.kind === 'equipment'));
  for (const b of first) {
    for (const key of ['x', 'y', 'z', 'width', 'height', 'depth', 'yaw'])
      assert(Number.isFinite(b[key]));
    assert(b.width > 0 && b.height > 0 && b.depth > 0);
    if (['equipment', 'vent', 'duct'].includes(b.kind)) {
      assert(roofBoxFits(part.polygon, b.x, b.z, b.width, b.depth, b.yaw));
      assert(b.y - b.height / 2 >= part.ground + part.height - 1e-8);
    }
  }
});

test('lowrise sills match the existing facade metre grid and tall buildings do not duplicate near frames', () => {
  const boxes = [...architectureWork([part], 'street')].filter(Boolean);
  assert(boxes.some((b) => b.kind === 'jamb'));
  const pane = windowBounds(profile, fitBays(profile, 30), 0, 0);
  assert(
    boxes.some(
      (b) =>
        b.kind === 'sill' &&
        Math.abs(b.x - (pane.left + pane.right) / 2) < 1e-8 &&
        Math.abs(b.y - (part.ground + pane.bottom - 0.035)) < 1e-8,
    ),
  );
  assert.equal(
    [...architectureWork([{ ...part, height: 70 }], 'street')].filter(Boolean)
      .length,
    0,
  );
  const heritage = createProfile({
    key: 'historic',
    heightM: 18,
    footprintAreaM2: 600,
    center: [1100, 200],
  });
  assert.equal(
    [...architectureWork([{ ...part, profile: heritage }], 'street')].filter(
      Boolean,
    ).length,
    0,
  );
});

function host(count = 80) {
  const foundations = new Map(),
    profiles = new Map();
  const features = Array.from({ length: count }, (_, i) => {
    const x = i * 240,
      key = `test-${i}`;
    foundations.set(key, 12);
    profiles.set(
      key,
      createProfile({
        key,
        heightM: 18,
        footprintAreaM2: 600,
        center: [x + 15, 10],
      }),
    );
    return {
      properties: { id: key, height: 18, minHeight: 0 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [...rectangle, rectangle[0]].map(([px, z]) => unproject(x + px, z)),
        ],
      },
    };
  });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(15, 20, 10);
  return {
    data: {
      buildings: { features },
      buildingProfiles: profiles,
      buildingFoundations: foundations,
    },
    settings: { quality: 'high', buildings: true },
    camera,
    buildings: new THREE.Group(),
    renderer: { shadowMap: { needsUpdate: false } },
  };
}

test('streamed architecture bounds visible batches, per-cell data, cache and cancellation during travel', () => {
  const e = host(),
    system = new ArchitecturalDetails(e);
  assert.equal(system.root.children.length, 0);
  for (let i = 0; i < 700; i++) system.update();
  assert(system.stats.visibleInstances > 0);
  assert(system.stats.visibleCells <= 23);
  assert.equal(system.stats.pendingCells, 0);
  assert.equal(system.stats.selectedCells, system.stats.visibleCells);
  for (const record of system.records.values()) {
    assert(
      record.count <=
        (record.tier === 'roof'
          ? ARCHITECTURE_BUDGET.roofInstancesPerCell
          : ARCHITECTURE_BUDGET.streetInstancesPerCell),
    );
    assert(record.group.children.length <= 2);
    for (const mesh of record.group.children) {
      for (const value of mesh.instanceMatrix.array)
        assert(Number.isFinite(value));
      assert(mesh.boundingSphere.radius < 400);
    }
  }
  for (let step = 0; step < 20; step++) {
    e.camera.position.x = step * 850;
    for (let i = 0; i < 80; i++) system.update();
    assert(system.records.size <= ARCHITECTURE_BUDGET.cachedCells);
  }
  e.settings.buildings = false;
  system.update(true);
  assert.equal(system.stats.visibleCells, 0);
  assert.equal(system.stats.visibleInstances, 0);
  assert.equal(system.stats.pendingCells, 0);
  assert.equal(system.stats.selectedCells, 0);
  system.dispose();
  assert.equal(e.buildings.children.length, 0);
  assert.equal(system.records.size, 0);
  system.update();
  system.dispose();
});
