import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { roofCellWork } = await import(cityModule('architecture-roof-budget'));
const { createProfile } = await import(cityModule('facade-profile'));

const parts = Array.from({ length: 8 }, (_, i) => {
  const key = `roof-${i}`,
    x = i * 40,
    size = i === 7 ? 38 : 25;
  const profile = createProfile({
    key,
    heightM: 18,
    footprintAreaM2: size * 25,
    center: [x, 0],
  });
  return {
    key,
    polygon: [
      [
        [x, 0],
        [x + size, 0],
        [x + size, 25],
        [x, 25],
      ],
    ],
    ground: 0,
    height: 18,
    minHeight: 0,
    profile,
    roof: true,
  };
});

test('budgeted roof appearance reaches every eligible roof before secondary trim spends the remainder', () => {
  const boxes = [...roofCellWork(parts, 26, [290, 50, 0])].filter(Boolean);
  assert.equal(boxes.length, 26);
  for (let i = 0; i < parts.length; i++) {
    const assigned = boxes.filter(
      (box) =>
        box.kind === 'equipment' && box.x > i * 40 && box.x < i * 40 + 38,
    );
    assert(
      assigned.length >= 2,
      `roof ${i} did not receive a grounded equipment pair`,
    );
  }
  assert(
    boxes.slice(0, parts.length * 2).every((box) => box.kind === 'equipment'),
  );
  assert(boxes.slice(parts.length * 2).some((box) => box.kind === 'parapet'));
});

test('large nearby roof is prioritized independent of source-file order, while the hard cap always holds', () => {
  const focus = [290, 50, 0];
  const small = [...roofCellWork(parts, 2, focus)].filter(Boolean);
  assert.equal(small.length, 2);
  assert(small.every((box) => box.x >= 280));
  const forward = [...roofCellWork(parts, 35, focus)].filter(Boolean);
  const reverse = [...roofCellWork([...parts].reverse(), 35, focus)].filter(
    Boolean,
  );
  assert.deepEqual(forward, reverse);
  assert.equal([...roofCellWork(parts, 0, focus)].filter(Boolean).length, 0);
});
