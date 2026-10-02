import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { FLAT_ROOF_FINISHES, selectFlatRoofFinish } = await import(
  cityModule('building-surface-palette')
);
const { createProfile, facadeTemplates } = await import(
  cityModule('facade-profile')
);
const kinds = facadeTemplates.map(({ kind }) => kind);
const linear = (srgb) =>
  srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
const luminance = ({ colorSRGB }) => {
  const [r, g, b] = colorSRGB.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('three shared matte finishes retain the authored sRGB colours and plausible albedo', () => {
  assert.deepEqual(
    FLAT_ROOF_FINISHES.map(({ id }) => id),
    ['asphalt', 'mineral-gravel', 'coated-membrane'],
  );
  assert.deepEqual(
    FLAT_ROOF_FINISHES[0].colorSRGB,
    [0.259805, 0.279812, 0.279812],
  );
  assert.equal(FLAT_ROOF_FINISHES[0].roughness, 0.93);
  assert.deepEqual(
    FLAT_ROOF_FINISHES.slice(1).map(({ colorSRGB }) =>
      colorSRGB.map((value) => Math.round(value * 255)),
    ),
    [
      [0x93, 0x98, 0x8e],
      [0xb9, 0xc0, 0xbb],
    ],
  );
  for (const finish of FLAT_ROOF_FINISHES) {
    assert.ok(
      finish.colorSRGB.every((n) => Number.isFinite(n) && n > 0 && n < 1),
    );
    assert.ok(Number.isFinite(finish.roughness));
    assert.ok(finish.roughness >= 0.75 && finish.roughness <= 1);
    assert.ok(luminance(finish) > 0.04 && luminance(finish) < 0.7);
  }
  const [asphalt, mineral, coated] = FLAT_ROOF_FINISHES.map(luminance);
  assert.ok(mineral > asphalt * 3, 'mineral must improve dark overview roofs');
  assert.ok(
    coated > mineral * 1.5,
    'coated roofs must remain visibly distinct',
  );
});

test('existing stable profile seeds give identical finishes after source reordering', () => {
  const structures = Array.from({ length: 120 }, (_, i) => ({
    key: `roof-profile-fixture-${i}`,
    heightM: [9, 16, 32, 90, 190][i % 5],
    footprintAreaM2: [120, 900, 1800][i % 3],
    center: i % 2 ? [-500, 100] : [1000, 200],
  }));
  const assignments = (items) =>
    new Map(
      items.map((structure) => {
        const { kind, seed } = createProfile(structure);
        assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed < 4096);
        return [structure.key, selectFlatRoofFinish(kind, seed)];
      }),
    );
  const original = assignments(structures);
  const reordered = assignments([...structures].reverse());
  for (const [key, finish] of original)
    assert.equal(reordered.get(key), finish, key);
});

test('full profile seed range keeps older, modern and domestic roof mixes distinct', () => {
  const distribution = Object.fromEntries(
    kinds.map((kind) => {
      const counts = [0, 0, 0];
      for (let seed = 0; seed < 4096; seed++) {
        const index = selectFlatRoofFinish(kind, seed);
        assert.ok(Number.isInteger(index) && index >= 0 && index < 3);
        counts[index]++;
      }
      return [kind, counts.map((n) => n / 4096)];
    }),
  );
  for (const kind of ['heritage-brick', 'lowrise-masonry']) {
    const [dark, mineral, coated] = distribution[kind];
    assert.ok(dark >= 0.35 && dark <= 0.45, kind);
    assert.ok(mineral > 0.5, kind);
    assert.equal(coated, 0, kind);
  }
  for (const kind of ['midrise-grid', 'balcony-slab', 'curtain-wall']) {
    const [dark, mineral, coated] = distribution[kind];
    assert.equal(dark, 0, kind);
    assert.ok(mineral > 0.25 && mineral < 0.35, kind);
    assert.ok(coated > 0.65 && coated < 0.75, kind);
  }
  const [dark, mineral, coated] = distribution['domestic-cladding'];
  assert.ok(dark > 0.15 && dark < 0.25);
  assert.ok(mineral > 0.35 && coated > 0.35);
});

test('selector preserves integer precision beyond 32-bit seeds and safely handles invalid inputs', () => {
  for (const kind of kinds) {
    for (const seed of [0, 1, 7, 8, 11, 12, 19, 4095])
      assert.equal(
        selectFlatRoofFinish(kind, seed + 20 * 2 ** 30),
        selectFlatRoofFinish(kind, seed),
        'integer modulo must not truncate to signed 32-bit arithmetic',
      );
    for (const seed of [
      NaN,
      Infinity,
      -Infinity,
      -1,
      -4096,
      0.25,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER + 1,
      null,
      undefined,
      '12',
    ])
      assert.equal(selectFlatRoofFinish(kind, seed), 1);
    const largest = selectFlatRoofFinish(kind, Number.MAX_SAFE_INTEGER);
    assert.ok(Number.isInteger(largest) && largest >= 0 && largest < 3);
  }
  for (const kind of ['unknown', '', null, undefined])
    assert.equal(selectFlatRoofFinish(kind, 0), 1);
});

test('citywide selection only references the same three immutable shared finishes', () => {
  const initial = [...FLAT_ROOF_FINISHES];
  const references = new Set();
  for (const kind of kinds)
    for (let seed = 0; seed < 4096; seed++) {
      const index = selectFlatRoofFinish(kind, seed);
      assert.equal(typeof index, 'number', 'per-building data is one scalar');
      references.add(FLAT_ROOF_FINISHES[index]);
    }
  assert.equal(references.size, 3, 'no per-building material variants');
  assert.ok(Object.isFrozen(FLAT_ROOF_FINISHES));
  initial.forEach((finish, i) => {
    assert.equal(FLAT_ROOF_FINISHES[i], finish);
    assert.ok(Object.isFrozen(finish));
    assert.ok(Object.isFrozen(finish.colorSRGB));
  });
});
