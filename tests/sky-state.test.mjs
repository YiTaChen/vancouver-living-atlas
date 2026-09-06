import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { NightSkyCycle, DEFAULT_SKY, normalizeSky, MOON_PHASES } = await import(
  cityModule('sky-state')
);
const { CityClock } = await import(cityModule('clock'));
test('first encountered night is a quarter moon and aurora, including after midnight; later nights do not reroll during scrubbing', () => {
  for (const h of [21, 23, 2, 5]) {
    const c = new NightSkyCycle(0.5);
    c.update(16, 0);
    const a = c.update(h, 0);
    assert(a.night && a.aurora);
    assert.equal(a.phase, 0.25);
    assert.deepEqual(c.update(h, 0), a);
  }
  const c = new NightSkyCycle(0.123),
    a = c.update(23, 0),
    b = c.update(1, 1);
  assert.equal(a.key, b.key);
  assert.equal(b.phase, 0.25);
  assert.equal(b.aurora, true);
  c.update(12, 1);
  const next = c.update(22, 1);
  c.update(21, 1);
  assert.deepEqual(c.update(22, 1), next);
  let hits = 0;
  for (let day = 1; day <= 3000; day++)
    hits += Number(c.update(23, day).aurora);
  assert(hits > 900 && hits < 1100, `night sample ${hits}/3000`);
});
test('clock tracks full simulated days across midnight and multi-day ticks, not time slider seeks', () => {
  const c = new CityClock({ hour: 23, rate: 300 });
  c.tick(0);
  c.tick(12000);
  assert.equal(c.calendarDay, 1);
  c.tick(12000 + 864000);
  assert.equal(c.calendarDay, 4);
  c.configure({ hour: 8, running: false }, 876000);
  assert.equal(c.calendarDay, 4);
  c.tick(900000);
  assert.equal(c.calendarDay, 4);
});
test('sky controls support eight phases plus eclipse, clamp finite ranges and accept independent visibility', () => {
  assert.equal(MOON_PHASES.length, 10);
  const s = normalizeSky({
    starDensity: 4,
    auroraDensity: -1,
    auroraIntensity: NaN,
    moon: false,
    sun: false,
    moonPhase: 'eclipse',
    meteors: false,
  });
  assert.equal(s.starDensity, 1);
  assert.equal(s.auroraDensity, 0);
  assert.equal(s.auroraIntensity, DEFAULT_SKY.auroraIntensity);
  assert.equal(s.moonPhase, 'eclipse');
  assert.equal(s.sun, false);
  assert.equal(s.moon, false);
  assert.equal(s.meteors, false);
  assert.equal(DEFAULT_SKY.moon, true);
});
