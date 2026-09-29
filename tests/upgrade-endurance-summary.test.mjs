import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { enduranceFrameSummary, summarizeEnduranceMemory } = await import(
  cityModule('upgrade-endurance-summary')
);

test('frame summary counts long responsiveness gaps without inventing FPS for an empty interval', () => {
  const report = enduranceFrameSummary([16, 16, 16, 52, 140], 240);
  assert.equal(report.frames, 5);
  assert.equal(report.fps, (5 * 1000) / 240);
  assert.equal(report.maxMs, 140);
  assert.equal(report.over50Ms, 2);
  assert.equal(report.over100Ms, 1);
  assert.equal(enduranceFrameSummary([], 0).fps, 0);
});

test('resource summary checks hard cache bounds and preserves absent heap as unavailable', () => {
  const row = (a, s, geometries, textures, heap = null) => ({
    architecture: { cacheCells: a },
    streetscape: { cacheCells: s },
    geometries,
    textures,
    heap,
  });
  const samples = [
    row(16, 4, 650, 70),
    row(38, 12, 710, 76),
    row(38, 12, 705, 76),
  ];
  const result = summarizeEnduranceMemory(samples, {
    architectureCells: 38,
    streetscapeCells: 12,
  });
  assert(result.withinCellLimits);
  assert.equal(result.usedJSHeapBytes, null);
  assert.equal(result.geometries.delta, 55);
  assert.equal(result.geometries.max, 710);
  assert.equal(result.textures.last, 76);
  assert.equal(
    summarizeEnduranceMemory([...samples, row(39, 12, 700, 76)], {
      architectureCells: 38,
      streetscapeCells: 12,
    }).withinCellLimits,
    false,
  );
  const gc = summarizeEnduranceMemory(
    [
      row(38, 12, 710, 76, { usedJSHeapSize: 900 }),
      row(38, 12, 710, 76, { usedJSHeapSize: 700 }),
    ],
    { architectureCells: 38, streetscapeCells: 12 },
  );
  assert.equal(gc.usedJSHeapBytes.delta, -200);
  const missing = summarizeEnduranceMemory(
    [{ ...samples[0], architecture: null, streetscape: null }],
    { architectureCells: 38, streetscapeCells: 12 },
  );
  assert.equal(missing.cacheDataAvailable, false);
  assert.equal(
    missing.withinCellLimits,
    false,
    'absent detail systems cannot prove cache bounds',
  );
});
