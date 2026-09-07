import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
const { paintStartupProgress } = await import(cityModule('startup-progress'));

test('milestone publishes before yielding and cancellation prevents the next stage', async (t) => {
  let frame,
    cancelled = false;
  const reports = [],
    cleared = [];
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) => {
    frame = callback;
    return 7;
  });
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => cleared.push(id));
  const pending = paintStartupProgress(
    48,
    (value) => reports.push(value),
    () => cancelled,
  );
  assert.deepEqual(reports, [48]);
  cancelled = true;
  frame();
  assert.equal(await pending, false);
  assert(cleared.includes(7));
  assert.equal(
    await paintStartupProgress(
      64,
      (value) => reports.push(value),
      () => cancelled,
    ),
    false,
  );
  assert.deepEqual(reports, [48]);
});

test('a hidden tab with no animation frame still finishes the yield', async (t) => {
  t.mock.method(globalThis, 'requestAnimationFrame', () => 8);
  t.mock.method(globalThis, 'cancelAnimationFrame', () => {});
  const reports = [];
  assert.equal(
    await paintStartupProgress(
      95,
      (value) => reports.push(value),
      () => false,
    ),
    true,
  );
  assert.deepEqual(reports, [95]);
});
