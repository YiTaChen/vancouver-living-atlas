import test from 'node:test';
// Tests intentionally compare function identity; no detached method is invoked.
/* oxlint-disable typescript/unbound-method */
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { QACPUProfile } = await import(cityModule('qa-cpu-profile'));

test('CPU profiler preserves arguments, this, return values and inherited method ownership', () => {
  let time = 0;
  class Target { run(n) { time += 2; return this.value + n; } }
  const target = new Target();
  target.value = 4;
  const original = target.run;
  const profile = new QACPUProfile(() => time);
  profile.wrap(target, 'run', 'run');
  assert.equal(target.run(3), 7);
  const result = profile.stop();
  assert.equal(target.run, original);
  assert.equal(Object.hasOwn(target, 'run'), false);
  assert.deepEqual(result.methods.run, { calls: 1, totalMs: 2, p50Ms: 2, p95Ms: 2, maxMs: 2, capped: false });
  assert.deepEqual(profile.stop(), result);
});

test('CPU profiler records throwing methods and preserves a newer method owner', () => {
  let time = 0;
  const target = { run() { time += 3; throw new Error('original error'); } };
  const profile = new QACPUProfile(() => time);
  profile.wrap(target, 'run', 'run');
  assert.throws(() => target.run(), /original error/);
  const newer = () => 8;
  target.run = newer;
  assert.equal(profile.stop().methods.run.totalMs, 3);
  assert.equal(target.run, newer);
});

test('CPU profiler bounds samples and does not instrument after stopping', () => {
  let time = 0;
  const target = { run() { time++; } };
  const original = target.run;
  const profile = new QACPUProfile(() => time);
  profile.wrap(target, 'run', 'run');
  for (let i = 0; i < 20_010; i++) target.run();
  const report = profile.stop();
  assert.equal(report.methods.run.calls, 20_000);
  assert.equal(report.methods.run.capped, true);
  assert.equal(target.run, original);
  profile.wrap(target, 'run', 'again');
  assert.equal(target.run, original);
});
