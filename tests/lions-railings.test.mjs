import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { buildLionsRailings } = await import(cityModule('lions-railings'));
test('continuous outer railing follows mitered, sloping sections without a floor lookup; only explicit tower openings remain', () => {
  const sections = [],
    segments = [];
  for (const [sourceId, side] of [
    [70954668, 1],
    [70954672, -1],
  ]) {
    const routeId = String(sourceId);
    for (let s = 0; s <= 1000; s += 2.5) {
      const y = 65 + s * 0.003,
        x = side * (10 + Math.sin(s / 90) * 0.15);
      sections.push({
        routeId,
        s,
        center: [side * 9, y, s],
        outerLeft: [x, y, s],
        outerRight: [side * 8, y, s],
      });
      if (s < 1000) segments.push({ routeId, sourceId, s0: s, s1: s + 2.5 });
    }
  }
  const before = JSON.stringify(sections),
    r = buildLionsRailings({ sections }, segments, [0, 0], [0, 1000]);
  assert(r.positions.every(Number.isFinite));
  assert(r.positions.length / 9 < 200000);
  for (const [side, length] of [
    ['east', 1000],
    ['west', 988],
  ]) {
    const spans = r.spans.filter((s) => s.side === side);
    assert(
      Math.abs(spans.reduce((sum, s) => sum + s.s1 - s.s0, 0) - length) < 1e-6,
    );
    for (let i = 1; i < spans.length; i++) {
      const a = spans[i - 1],
        b = spans[i],
        gap = b.s0 - a.s1;
      if (gap > 1e-6)
        assert(
          side === 'west' &&
            [
              [184, 190],
              [656, 662],
            ].some(
              ([x, y]) =>
                Math.abs(a.s1 - x) < 1e-6 && Math.abs(b.s0 - y) < 1e-6,
            ),
        );
      else assert(Math.hypot(...a.b.map((v, k) => v - b.a[k])) < 1e-6);
    }
    assert(spans.every((s) => Math.abs(s.a[0]) > 9.8));
  }
  assert.equal(JSON.stringify(sections), before);
});
