import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { ScenePreparationQueue } = await import(cityModule('scene-preparation'));

test('background scenery honours a bounded frame budget and cancels unfinished work', () => {
  const queue = new ScenePreparationQueue();
  let time = 0,
    steps = 0,
    cleaned = false;
  function* work() {
    try {
      for (let i = 0; i < 100; i++) {
        time += 0.4;
        steps++;
        yield;
      }
    } finally {
      cleaned = true;
    }
  }
  queue.add(work());
  queue.pump(1, () => time);
  assert.equal(steps, 3);
  assert.equal(queue.pending, 1);
  queue.pump(0, () => time);
  assert.equal(steps, 3);
  queue.dispose();
  assert(cleaned);
  queue.pump(2, () => time);
  assert.equal(steps, 3);
});
