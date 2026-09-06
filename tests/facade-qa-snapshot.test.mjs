import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { snapshotFacadeQueue } = await import(cityModule('release-qa-observer'));

test('facade QA snapshots retain ready/visible, budget and optional async-wall counters without live references', () => {
  assert.equal(snapshotFacadeQueue(null), null);
  assert.equal(snapshotFacadeQueue({}), null);
  const queue = {
    records: new Map([
      ['visible', { ready: { group: { visible: true } } }],
      ['cached', { ready: { group: { visible: false } } }],
      ['pending', { ready: null }],
    ]),
    metrics: {
      steps: 5,
      pumps: 9,
      completed: 2,
      cancelled: 1,
      evicted: 0,
      failed: 0,
      maxStepMs: 1.1,
      maxPumpMs: 2.2,
      budgetOverruns: 1,
    },
    cacheBytes: 900,
    pendingBytes: 80,
    pendingId: 'pending',
    pendingToken: 3,
    lastError: null,
  };
  const preparationMetrics = {
    requested: 3,
    succeeded: 1,
    cancelled: 1,
    failed: 0,
    pending: 1,
    totalAsyncWallMs: 50,
    lastAsyncWallMs: 20,
    maxAsyncWallMs: 30,
  };
  const before = snapshotFacadeQueue({ queue });
  assert.equal(before.preparation, null);
  const captured = snapshotFacadeQueue({ queue, preparationMetrics });
  assert.deepEqual(captured.records, { total: 3, ready: 2, visible: 1 });
  assert.equal(captured.pendingToken, 3);
  assert.equal(captured.metrics.budgetOverruns, 1);
  queue.metrics.steps = 10;
  preparationMetrics.totalAsyncWallMs = 90;
  queue.records.clear();
  assert.equal(captured.metrics.steps, 5);
  assert.equal(captured.preparation.totalAsyncWallMs, 50);
  assert.equal(captured.records.total, 3);
});
