import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const {
  STREET_PILOT_BASELINE_LIGHTING,
  STREET_PILOT_LIGHTING_TARGETS,
  streetPilotLightingWeight,
  streetPilotLightingMultipliers,
} = await import(cityModule('street-pilot-lighting'));
const { STREET_SHOWCASE_SEGMENTS, STREET_SHOWCASE_BOUNDS } = await import(
  cityModule('street-quality-profile')
);
const { sampleAtmosphere } = await import(cityModule('atmosphere'));
const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

test('pilot lighting responds to camera movement at fixed time and fades by local altitude', () => {
  const [x, z] = centre;
  const fixedAtmosphere = sampleAtmosphere(14);
  assert.equal(streetPilotLightingWeight(x, 2, z), 1);
  assert.equal(streetPilotLightingWeight(x, 25, z), 1);
  assert.equal(streetPilotLightingWeight(x, 57.5, z), 0.5);
  assert.equal(streetPilotLightingWeight(x, 90, z), 0);
  assert.equal(streetPilotLightingWeight(x, 900, z), 0);
  const outside = streetPilotLightingWeight(
    STREET_SHOWCASE_BOUNDS.maxX + 1,
    2,
    z,
  );
  assert.equal(outside, 0);
  assert.strictEqual(
    streetPilotLightingMultipliers(fixedAtmosphere, outside),
    STREET_PILOT_BASELINE_LIGHTING,
  );
  assert.notDeepEqual(
    streetPilotLightingMultipliers(fixedAtmosphere, 1),
    STREET_PILOT_BASELINE_LIGHTING,
  );
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(streetPilotLightingWeight(value, 2, z), 0);
    assert.equal(streetPilotLightingWeight(x, value, z), 0);
    assert.equal(streetPilotLightingWeight(x, 2, value), 0);
  }
});

test('daylight redistributes existing fill and PMREM intensity without changing the atmosphere sample', () => {
  for (const [mode, expected] of [
    ['clear', STREET_PILOT_LIGHTING_TARGETS.dayClear],
    ['overcast', STREET_PILOT_LIGHTING_TARGETS.dayOvercast],
  ]) {
    const base = sampleAtmosphere(14, mode);
    const original = structuredClone(base);
    const multipliers = streetPilotLightingMultipliers(base, 1);
    for (const key of Object.keys(expected)) {
      assert(Math.abs(multipliers[key] - expected[key]) < 1e-12);
      const half = streetPilotLightingMultipliers(base, 0.5);
      assert(Math.abs(half[key] - (1 + expected[key]) / 2) < 1e-12);
    }
    assert.deepEqual(structuredClone(base), original);
    assert(base.environmentIntensity * multipliers.environmentIntensity < 0.1);
  }
});

test('night preserves visibility fill and dawn/sunset transitions remain finite and continuous', () => {
  assert.deepEqual(
    streetPilotLightingMultipliers(sampleAtmosphere(23), 1),
    STREET_PILOT_LIGHTING_TARGETS.night,
  );
  for (const mode of ['clear', 'overcast']) {
    let previous;
    for (let hour = 0; hour <= 24; hour += 0.01) {
      const base = sampleAtmosphere(hour, mode);
      const multipliers = streetPilotLightingMultipliers(base, 1);
      assert(multipliers.ambientIntensity >= 0.62);
      assert(multipliers.sunIntensity >= 1);
      assert(multipliers.environmentIntensity >= 2);
      assert(multipliers.environmentIntensity <= 2.2);
      assert(multipliers.exposure >= 0.98);
      if (previous)
        for (const key of Object.keys(multipliers))
          assert(Math.abs(multipliers[key] - previous[key]) < 0.025);
      previous = multipliers;
    }
  }
  for (const weight of [NaN, Infinity, -Infinity, -1, 0])
    assert.strictEqual(
      streetPilotLightingMultipliers({ night: 0, cloud: 0 }, weight),
      STREET_PILOT_BASELINE_LIGHTING,
    );
  for (const value of Object.values(
    streetPilotLightingMultipliers({ night: NaN, cloud: Infinity }, 1),
  ))
    assert(Number.isFinite(value));
});
