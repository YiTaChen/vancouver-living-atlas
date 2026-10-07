import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { AutoQualityController } = await import(cityModule('auto-quality'));
const frame60 = 1_000 / 60;

function harness() {
  const policy = new AutoQualityController();
  let nowMs = 0;
  const events = [];
  let context = {
    mode: 'orbit',
    speedMps: 0,
    altitudeM: 3,
    moving: false,
    visible: true,
    transitioning: false,
  };
  const step = (frameMs = frame60, overrides = {}) => {
    nowMs += Number.isFinite(frameMs) && frameMs > 0 ? frameMs : frame60;
    const before = policy.snapshot().changes;
    const result = policy.observe({ ...context, nowMs, frameMs, ...overrides });
    if (result.changes > before) events.push({ nowMs, ...result });
    return result;
  };
  const run = (durationMs, frameMs = frame60, nextContext = {}) => {
    context = { ...context, ...nextContext };
    const end = nowMs + durationMs;
    while (nowMs < end)
      step(
        typeof frameMs === 'function' ? frameMs(policy.snapshot()) : frameMs,
      );
    return policy.snapshot();
  };
  return { policy, step, run, events, now: () => nowMs };
}

test('starts conservatively, needs sustained foreground headroom, and never selects Ultra', () => {
  const h = harness();
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().resolutionScale, 1);
  assert.equal(h.policy.snapshot().targetFps, 35);
  assert.equal(h.policy.snapshot().frameMs, null);
  h.run(18_000);
  assert.equal(h.policy.snapshot().quality, 'balanced');
  h.run(4_000);
  assert.equal(h.policy.snapshot().quality, 'high');
  h.run(180_000, 1_000 / 120);
  assert.equal(h.policy.snapshot().quality, 'high');
  assert.equal(h.policy.snapshot().changes, 1);
  assert.equal(h.policy.snapshot().sampleCount, 240);
  assert.equal(h.policy.snapshot().highPromotions, 1);
  assert.equal(h.policy.snapshot().targetFps, 35);
});

test('a 120 ms hitch remains measurable but cannot cause a downgrade', () => {
  const h = harness();
  h.run(10_000);
  const changes = h.policy.snapshot().changes;
  const snapshot = h.step(120);
  assert.equal(snapshot.lastFrameMs, 120);
  assert.equal(snapshot.hitches, 1);
  assert.equal(snapshot.excludedSamples, 0);
  h.run(600);
  assert.equal(h.policy.snapshot().maxFrameMs, 120);
  assert.equal(h.policy.snapshot().p95Ms, frame60);
  assert.equal(h.policy.snapshot().changes, changes);
  h.run(6_000);
  assert.equal(h.policy.snapshot().changes, changes);
  // A percentile on a small warm-up window must include the hitch normally.
  const short = harness();
  short.step(120);
  assert.equal(short.policy.snapshot().p95Ms, 120);
  assert.equal(short.policy.snapshot().maxFrameMs, 120);
});

test('persistent load lowers resolution finitely and spaces changes at least four seconds', () => {
  const h = harness();
  h.run(60_000, 80);
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().resolutionScale, 0.65);
  assert.equal(h.policy.snapshot().changes, 2);
  assert.equal(h.policy.snapshot().reason, 'resolution-floor');
  assert.deepEqual(
    h.events.map((s) => s.resolutionScale),
    [0.8, 0.65],
  );
  assert.ok(h.events[1].nowMs - h.events[0].nowMs >= 4_000);
  const floorChanges = h.policy.snapshot().changes;
  h.run(180_000, 80);
  assert.equal(h.policy.snapshot().changes, floorChanges);
  assert.ok(Number.isFinite(h.policy.snapshot().frameMs));
});

test('drive and boat reduce High resolution before reducing the tier', () => {
  for (const mode of ['drive', 'boat']) {
    const h = harness();
    h.run(22_000);
    assert.equal(h.policy.snapshot().quality, 'high');
    const first = h.events.length;
    h.run(22_000, 50, { mode, speedMps: 20, moving: true });
    const changes = h.events.slice(first);
    assert.equal(changes[0].quality, 'high');
    assert.equal(changes[0].resolutionScale, 0.8);
    assert.equal(changes[0].reason, 'lower-resolution');
    assert.equal(changes[1].quality, 'balanced');
    assert.equal(changes[1].resolutionScale, 0.8);
    assert.equal(changes[1].reason, 'lower-quality');
    assert.equal(changes.at(-1).resolutionScale, 0.65);
    assert.equal(h.policy.snapshot().targetFps, 45);
    assert.equal(h.policy.snapshot().failedHighUpgrades, 1);
  }
});

test('walk reduces High tier first, then resolution if the load persists', () => {
  const h = harness();
  h.run(22_000);
  const first = h.events.length;
  h.run(20_000, 60, { mode: 'walk', moving: true, speedMps: 1.5 });
  const changes = h.events.slice(first);
  assert.deepEqual(
    [changes[0].quality, changes[0].resolutionScale],
    ['balanced', 1],
  );
  assert.equal(changes[0].reason, 'lower-quality');
  assert.deepEqual(
    changes.map((s) => s.resolutionScale),
    [1, 0.8, 0.65],
  );
});

test('all flight is capped immediately, and returning to ground requires fresh headroom', () => {
  const h = harness();
  h.run(22_000);
  assert.equal(h.policy.snapshot().quality, 'high');
  h.run(20, frame60, {
    mode: 'flight',
    altitudeM: 0,
    speedMps: 0,
    transitioning: true,
  });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().capQuality, 'balanced');
  assert.equal(h.policy.snapshot().failedHighUpgrades, 0);
  h.run(90_000, frame60, {
    transitioning: false,
    speedMps: 110,
    altitudeM: 400,
    moving: true,
  });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().targetFps, 45);
  h.run(18_000, frame60, {
    mode: 'orbit',
    speedMps: 0,
    moving: false,
    altitudeM: 3,
  });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  h.run(4_000);
  assert.equal(h.policy.snapshot().quality, 'high');
});

test('compatible tier cap still adapts resolution and cannot misleadingly report High', () => {
  const h = harness();
  h.run(22_000);
  h.run(20, frame60, { maxQuality: 'balanced' });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().capQuality, 'balanced');
  h.run(25_000, 60);
  assert.equal(h.policy.snapshot().resolutionScale, 0.65);
  h.run(100_000);
  assert.equal(h.policy.snapshot().resolutionScale, 1);
  assert.equal(h.policy.snapshot().quality, 'balanced');
  h.run(18_000, frame60, { maxQuality: 'high' });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  h.run(4_000);
  assert.equal(h.policy.snapshot().quality, 'high');
});

test('recovery restores resolution gradually before attempting High', () => {
  const h = harness();
  h.run(25_000, 60, { mode: 'drive', speedMps: 20, moving: true });
  assert.equal(h.policy.snapshot().resolutionScale, 0.65);
  const first = h.events.length;
  h.run(11_000);
  assert.equal(h.policy.snapshot().resolutionScale, 0.65);
  h.run(65_000);
  const changes = h.events.slice(first);
  assert.deepEqual(
    changes.map((s) => [s.quality, s.resolutionScale]),
    [
      ['balanced', 0.8],
      ['balanced', 1],
      ['high', 1],
    ],
  );
  assert.ok(changes[1].nowMs - changes[0].nowMs >= 12_000);
  assert.ok(changes[2].nowMs - changes[1].nowMs >= 24_000);
});

test('hidden, load transitions and discontinuous clocks clear measurements, never quality or scale', () => {
  const h = harness();
  h.run(12_000, 60);
  const preserved = h.policy.snapshot();
  const reset = h.policy.resetTiming('manual-return');
  assert.equal(reset.quality, preserved.quality);
  assert.equal(reset.resolutionScale, preserved.resolutionScale);
  assert.equal(reset.changes, preserved.changes);
  assert.equal(reset.sampleCount, 0);
  assert.equal(reset.frameMs, null);
  h.run(30_000, 60, { visible: false });
  assert.equal(h.policy.snapshot().changes, preserved.changes);
  assert.equal(h.policy.snapshot().samples, preserved.samples);
  h.run(30_000, 60, { visible: true, transitioning: true });
  assert.equal(h.policy.snapshot().changes, preserved.changes);
  h.run(1_000, 60, { transitioning: false });
  assert.equal(h.policy.snapshot().changes, preserved.changes);
  assert.equal(h.policy.snapshot().lastFrameMs, 60);
  h.step(6_000);
  assert.equal(h.policy.snapshot().sampleCount, 0);
  assert.equal(h.policy.snapshot().reason, 'invalid-frame');
  h.step(frame60);
  h.step(frame60, { nowMs: 1 });
  assert.equal(h.policy.snapshot().reason, 'clock-discontinuity');
  assert.equal(h.policy.snapshot().sampleCount, 0);
  assert.equal(h.policy.snapshot().quality, preserved.quality);
  assert.equal(h.policy.snapshot().resolutionScale, preserved.resolutionScale);
});

test('invalid finite-input boundary cannot corrupt measurements or select unsupported states', () => {
  const h = harness();
  for (const overrides of [
    { nowMs: NaN },
    { nowMs: Infinity },
    { frameMs: NaN },
    { frameMs: Infinity },
    { frameMs: 0 },
    { frameMs: -1 },
    { speedMps: NaN },
    { speedMps: -1 },
    { altitudeM: Infinity },
    { mode: 'teleport' },
    { maxQuality: 'ultra' },
    { visible: 1 },
    { moving: undefined },
    { transitioning: null },
  ]) {
    const s = h.step(frame60, overrides);
    assert.equal(s.quality, 'balanced');
    assert.equal(s.resolutionScale, 1);
    assert.equal(s.frameMs, null);
    assert.equal(s.sampleCount, 0);
  }
  h.run(22_000);
  assert.equal(h.policy.snapshot().quality, 'high');
});

test('steady 30 Hz walk/orbit does not repeatedly sacrifice resolution; travel remains bounded', () => {
  for (const mode of ['orbit', 'walk']) {
    const h = harness();
    h.run(120_000, 1_000 / 30, { mode });
    assert.equal(h.policy.snapshot().quality, 'balanced');
    assert.equal(h.policy.snapshot().resolutionScale, 1);
    assert.equal(h.policy.snapshot().changes, 0);
  }
  const travel = harness();
  travel.run(120_000, 1_000 / 30, {
    mode: 'drive',
    moving: true,
    speedMps: 15,
  });
  assert.equal(travel.policy.snapshot().resolutionScale, 0.65);
  assert.equal(travel.policy.snapshot().changes, 2);
  assert.equal(travel.policy.snapshot().targetFps, 45);
});

test('repeated High failure backs off 60 then 120 seconds instead of oscillating every 18 seconds', () => {
  const h = harness();
  const sameSceneLoad = (s) => (s.quality === 'high' ? 50 : frame60);
  h.run(120_000, sameSceneLoad);
  const s = h.policy.snapshot();
  assert.equal(s.highPromotions, 2);
  assert.equal(s.failedHighUpgrades, 2);
  assert.equal(s.quality, 'balanced');
  assert.equal(s.resolutionScale, 1);
  assert.equal(s.changes, 4);
  assert.ok(s.highRetryMs > 80_000 && s.highRetryMs < 120_000);
  const promotions = h.events.filter((e) => e.reason === 'raise-quality');
  const demotions = h.events.filter((e) => e.reason === 'lower-quality');
  assert.ok(promotions[1].nowMs - demotions[0].nowMs >= 60_000);
  const retry = s.highRetryMs;
  h.policy.resetTiming('manual-return');
  h.run(30_000, frame60, { visible: false });
  assert.equal(h.policy.snapshot().highRetryMs, retry);
  assert.equal(h.policy.snapshot().failedHighUpgrades, 2);
  h.run(25_000, frame60, { visible: true });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  // Explicit mode context change may forget failures, but still needs headroom.
  h.run(18_000, frame60, { mode: 'walk' });
  assert.equal(h.policy.snapshot().failedHighUpgrades, 0);
  assert.equal(h.policy.snapshot().quality, 'balanced');
  h.run(4_000);
  assert.equal(h.policy.snapshot().quality, 'high');
});

test('alternating borderline load cannot flip tiers or reset quality every second', () => {
  const h = harness();
  h.run(120_000, () => (Math.floor(h.now() / 1_000) % 2 ? 34 : frame60));
  assert.equal(h.policy.snapshot().quality, 'balanced');
  assert.equal(h.policy.snapshot().changes, 0);
});

test('resetting the clock origin preserves quality and permits later bounded changes', () => {
  const h = harness();
  h.run(22_000);
  h.run(6_000, 60, { mode: 'walk' });
  assert.equal(h.policy.snapshot().quality, 'balanced');
  const changes = h.policy.snapshot().changes;
  h.policy.resetTiming('bfcache');
  // Start another clock timeline while keeping controller state and its budget.
  for (let nowMs = 100; nowMs <= 3_000; nowMs += 60) {
    h.policy.observe({
      nowMs,
      frameMs: 60,
      mode: 'walk',
      speedMps: 0,
      altitudeM: 3,
      moving: false,
      visible: true,
      transitioning: false,
    });
  }
  assert.equal(h.policy.snapshot().changes, changes);
  assert.equal(h.policy.snapshot().resolutionScale, 1);
  for (let nowMs = 3_100; nowMs <= 6_000; nowMs += 60) {
    h.policy.observe({
      nowMs,
      frameMs: 60,
      mode: 'walk',
      speedMps: 0,
      altitudeM: 3,
      moving: false,
      visible: true,
      transitioning: false,
    });
  }
  assert.equal(h.policy.snapshot().changes, changes + 1);
  assert.equal(h.policy.snapshot().resolutionScale, 0.8);
});
