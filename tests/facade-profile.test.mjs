import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  structureKey,
  summarizeStructures,
  createProfile,
  fitBays,
  windowBounds,
  windowRows,
  wallV,
  sampleFacade,
  fitEntrance,
} from '../lib/city/facade-profile.ts';
const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const make = (overrides = {}) =>
  createProfile({
    key: 'building-12',
    heightM: 24,
    footprintAreaM2: 800,
    center: [1000, 200],
    ...overrides,
  });
const p = make(),
  extent = { minHeightM: 0, heightM: 25 };
test('stable identity precedence, numeric zero, and explicit missing-ID rejection', () => {
  assert.equal(structureKey({ structureId: 's', buildingId: 'b', id: 8 }), 's');
  assert.equal(structureKey({ id: 0 }), '0');
  assert.throws(() => structureKey({}));
  assert.equal(
    structureKey({}, 'canonical-footprint'),
    'geometry:canonical-footprint',
  );
});
test('structure classification independent of part order; max height, largest ground part', () => {
  const parts = [
    {
      structureId: 's',
      id: 'podium',
      heightM: 12,
      minHeightM: 0,
      footprintAreaM2: 1000,
      center: [1000, 200],
    },
    {
      structureId: 's',
      id: 'tower',
      heightM: 80,
      minHeightM: 12,
      footprintAreaM2: 300,
      center: [1050, 200],
    },
    {
      structureId: 's',
      id: 'wing',
      heightM: 8,
      minHeightM: 0,
      footprintAreaM2: 200,
      center: [1060, 220],
    },
  ];
  const original = structuredClone(parts),
    a = summarizeStructures(parts).get('s'),
    b = summarizeStructures([...parts].reverse()).get('s');
  assert.deepEqual(a, b);
  assert.equal(a.heightM, 80);
  assert.equal(a.footprintAreaM2, 1000);
  assert.deepEqual(createProfile(a), createProfile(b));
  assert.deepEqual(parts, original);
  assert.notEqual(createProfile(a).kind, 'heritage-brick');
});
test('five representative types and stable finite constants', () => {
  const profiles = [
    make(),
    make({ heightM: 12, center: [-500, 100] }),
    make({ center: [-500, 100] }),
    ...Array.from({ length: 25 }, (_, i) =>
      make({ key: `tower-${i}`, heightM: 80, center: [-500, 100] }),
    ),
  ];
  assert.equal(new Set(profiles.map((q) => q.kind)).size, 5);
  for (const q of profiles) {
    for (const value of Object.values(q))
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    assert.ok(q.glassRoughness < q.wallRoughness);
    assert.ok(q.pane[0] < q.pane[1]);
  }
  assert.deepEqual(make(), make());
});
test('bay fit stays inside short/long walls and is unchanged by edge reversal', () => {
  for (const length of [0.1, 2, 3, 9, 17.4, 75, 120]) {
    const g = fitBays(p, length);
    for (let i = 0; i < g.count; i++) {
      const a = windowBounds(p, g, i, 0),
        b = windowBounds(p, g, g.count - 1 - i, 0);
      assert.ok(a.left >= 0 && a.right <= length);
      close(a.left, length - b.right);
      close(a.right, length - b.left);
    }
  }
  assert.equal(fitBays(p, 0.1).count, 0);
});
test('CPU frames and shared shader mask agree for all bays/floors', () => {
  const g = fitBays(p, 26);
  for (let i = 0; i < g.count; i++)
    for (const row of windowRows(p, extent)) {
      const b = windowBounds(p, g, i, row),
        u = (b.left + b.right) / 2,
        v = (b.bottom + b.top) / 2;
      assert.equal(sampleFacade(p, g, extent, u, v).pane, 1);
      for (const [x, y] of [
        [b.left - 0.01, v],
        [b.right + 0.01, v],
        [u, b.bottom - 0.01],
        [u, b.top + 0.01],
      ])
        assert.equal(sampleFacade(p, g, extent, x, y).pane, 0);
    }
});
test('minHeight UV preserves metres and floor phase across parts', () => {
  const e = { minHeightM: 13, heightM: 42 },
    g = fitBays(p, 20);
  close(wallV(e, 0), 13);
  close(wallV(e, 1), 42);
  close(wallV(e, 0.5), 27.5);
  close(wallV(e, 0.6) - wallV(e, 0.5), 2.9);
  const fullRows = new Set(windowRows(p, { minHeightM: 0, heightM: 42 }));
  for (const row of windowRows(p, e)) {
    assert.ok(fullRows.has(row));
    const b = windowBounds(p, g, 0, row);
    assert.ok(b.bottom >= e.minHeightM && b.top <= e.heightM);
  }
  const crossing = windowBounds(p, g, 0, 2),
    clipped = { minHeightM: crossing.bottom + 0.2, heightM: 42 };
  assert.equal(
    sampleFacade(
      p,
      g,
      clipped,
      (crossing.left + crossing.right) / 2,
      (crossing.bottom + crossing.top) / 2,
    ).pane,
    0,
  );
});
test('brick normal only on wall masonry; no brick normal on glass or roof', () => {
  const g = fitBays(p, 20),
    b = windowBounds(p, g, 0, 0),
    v = (b.bottom + b.top) / 2;
  const glass = sampleFacade(p, g, extent, (b.left + b.right) / 2, v);
  close(glass.roughness, p.glassRoughness);
  assert.equal(glass.brickNormalWeight, 0);
  assert.ok(sampleFacade(p, g, extent, b.left - 0.1, v).brickNormalWeight > 0);
  assert.equal(sampleFacade(p, g, extent, 2, 2, false).brickNormalWeight, 0);
  assert.equal(
    sampleFacade(make({ heightM: 220 }), g, extent, 0, 2).brickNormalWeight,
    0,
  );
});
test('entrance fits actual sidewalk datum while retaining structure floor phase', () => {
  const foundation = 10,
    e = fitEntrance(p, extent, foundation, [11.5, 11.53, 11.55]);
  assert.ok(e);
  close(e.thresholdY, 11.57);
  close(e.heightM, 2.65);
  assert.ok(e.headY < foundation + p.groundStoreyM + p.pane[2] * p.storeyM);
  assert.ok(fitEntrance(p, extent, foundation, [12.2, 12.2, 12.2]));
});
test('steep, absent, uphill-obstructed, and elevated-part entrances rejected', () => {
  assert.equal(fitEntrance(p, extent, 10, [11.5, 11.7, 11.9]), null);
  assert.equal(fitEntrance(p, extent, 10, [11.5, null, 11.5]), null);
  assert.equal(fitEntrance(p, extent, 10, [13, 13, 13]), null);
  assert.equal(
    fitEntrance(p, { minHeightM: 5, heightM: 25 }, 10, [11.5, 11.5, 11.5]),
    null,
  );
  assert.equal(fitEntrance(p, extent, 10, [9, 9, 9]), null);
});

test('ground-floor glazing clears frontage grade without inventing entrances or elevated windows', async () => {
  const { groundGlazing } = await import('../lib/city/facade-profile.ts');
  const profile = make({ center: [-500, 100], heightM: 24 });
  assert.deepEqual(
    groundGlazing(profile, extent, 10, [11.5, 11.6, 11.55]),
    [1.8499999999999996, 3.9],
  );
  assert.deepEqual(groundGlazing(p, extent, 10, [11.5]), [0, 0]);
  assert.deepEqual(
    groundGlazing(profile, { minHeightM: 12, heightM: 25 }, 10, [11.5]),
    [0, 0],
  );
  assert.deepEqual(groundGlazing(profile, extent, 10, [13.8]), [0, 0]);
  assert.deepEqual(groundGlazing(profile, extent, 10, [NaN]), [0, 0]);
});
