import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuntimePerformance } from '../tools/summarize-runtime-performance.mjs';

const snapshot = () => ({
  kind: 'opt-in-runtime-performance',
  schemaVersion: 1,
  frames: [
    { id: 1, rafAtMs: 10, rafIntervalMs: null },
    { id: 2, rafAtMs: 1210, rafIntervalMs: 1200 },
  ],
  hitches: [
    {
      frameId: 2,
      intervalStartMs: 10,
      intervalEndMs: 1210,
      rafIntervalMs: 1200,
      precedingFrame: {
        id: 1,
        cpuFrameMs: 100,
        spans: {
          render: { calls: 1, totalMs: 90, maxMs: 90 },
          nestedDriver: { calls: 1, totalMs: 80, maxMs: 80 },
        },
      },
    },
  ],
  browserEvents: [
    { type: 'longtask', startMs: 20, durationMs: 70 },
    { type: 'gc', startMs: 1300, durationMs: 60 },
  ],
  gpu: { status: 'ready', samples: [{ frameId: 1, gpuElapsedMs: 23 }] },
  stats: { frames: 500, hitches: 25 },
  dropped: { frames: 200 },
  observerSupport: { longtask: 'observing', gc: 'unsupported' },
});

test('summary correlates only overlapping evidence, preserves raw hitches and keeps nested CPU spans separate', () => {
  const result = summarizeRuntimePerformance({
    runtimePerformance: snapshot(),
  });
  assert.equal(result.retainedFrameIntervals.count, 1);
  assert.equal(result.retainedFrameIntervals.p95Ms, 1200);
  assert.equal(result.retainedHitchCount, 1);
  assert.equal(result.lifetimeCounters.hitches, 25);
  const hitch = result.largestIntervals[0];
  assert.equal(hitch.cause, 'unattributed');
  assert.equal(hitch.precedingCpuFrameMs, 100);
  assert.deepEqual(
    hitch.precedingInclusiveCpuSpans.map((span) => span.label),
    ['render', 'nestedDriver'],
  );
  assert.equal(hitch.precedingRenderGpuMs, 23);
  assert.deepEqual(
    hitch.overlappingBrowserEvents.map((event) => event.type),
    ['longtask'],
  );
  assert.match(result.interpretation, /do not add/);
});

test('release windows filter retained evidence without relabeling lifetime counts or missing GPU as zero', () => {
  const report = snapshot();
  report.gpu.samples = [];
  const result = summarizeRuntimePerformance({
    measurement: {
      runtimePerformance: report,
      runtimeWindow: { startMs: 1000, endMs: 2000 },
    },
  });
  assert.equal(result.retainedHitchCount, 1);
  assert.equal(result.largestIntervals[0].precedingRenderGpuMs, null);
  const excluded = summarizeRuntimePerformance({
    runtimePerformance: report,
    runtimeWindow: { startMs: 2000, endMs: 3000 },
  });
  assert.equal(excluded.retainedHitchCount, 0);
  assert.equal(excluded.retainedFrameIntervals.count, 0);
  assert.equal(excluded.retainedFrameIntervals.p95Ms, null);
  assert.equal(excluded.lifetimeCounters.hitches, 25);
});

test('analyzer rejects unrelated data and never turns null or invalid intervals into zero-ms samples', () => {
  assert.throws(
    () => summarizeRuntimePerformance({ kind: 'startup-wall-v1' }),
    /runtime timing report/,
  );
  const report = snapshot();
  report.frames.push(
    { rafAtMs: 1300, rafIntervalMs: -2 },
    { rafAtMs: 1400, rafIntervalMs: '4' },
  );
  report.gpu.samples[0].gpuElapsedMs = NaN;
  const result = summarizeRuntimePerformance(report);
  assert.equal(result.retainedFrameIntervals.count, 1);
  assert.equal(result.largestIntervals[0].precedingRenderGpuMs, null);
});
