import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { SceneryMotionTracker, DetailWorkBudget } = await import(
  cityModule('scenery-motion')
);

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const leadDistance = (state) =>
  Math.hypot(
    state.lookAheadXYZ[0] - state.positionXYZ[0],
    state.lookAheadXYZ[2] - state.positionXYZ[2],
  );

test('walking uses continuous camera displacement when the navigator has no authoritative walking speed', () => {
  const tracker = new SceneryMotionTracker();
  let state;
  for (let frame = 0; frame <= 100; frame++)
    state = tracker.update(
      frame * 20,
      [frame * 0.08, 1.25, 0],
      'walk',
      1.25,
      undefined,
      true,
    );
  near(state.speedMps, 4, 0.001);
  assert.equal(state.moving, true);
  assert.equal(state.fast, false);
  assert.equal(state.stationaryForMs, 0);
  assert.equal(state.preparationBudgetMs, 0.65);
  assert.equal(state.selectionIntervalMs, 220);
  assert.equal(state.lookAheadXYZ[1], 1.25);
  near(leadDistance(state), 2.6, 0.001);
});

test('authoritative drive speed wins over chase-camera displacement and handles reverse travel', () => {
  const tracker = new SceneryMotionTracker();
  tracker.update(0, [0, 10, 0], 'drive', 10, 25, true);
  const fast = tracker.update(20, [0, 10, 0.01], 'drive', 10, -25, true);
  assert.equal(fast.speedMps, 25);
  assert.equal(fast.moving, true);
  assert.equal(fast.fast, true);
  near(leadDistance(fast), 37.5);
  const stopped = tracker.update(40, [0, 10, 5], 'drive', 10, 0, true);
  assert.equal(stopped.speedMps, 0);
  assert.equal(
    stopped.moving,
    false,
    'a chase-camera adjustment cannot accelerate a stopped vehicle',
  );
  assert.deepEqual(stopped.lookAheadXYZ, stopped.positionXYZ);
});

test('provided three-dimensional takeoff speed counts vertical helicopter travel without projecting a ground target upward', () => {
  const tracker = new SceneryMotionTracker();
  const horizontalSpeed = 0,
    verticalSpeed = 7;
  const bodySpeed = Math.hypot(horizontalSpeed, verticalSpeed);
  tracker.update(0, [0, 30, 0], 'flight', 30, bodySpeed, true);
  const rising = tracker.update(
    200,
    [0, 31.4, 0],
    'flight',
    31.4,
    bodySpeed,
    true,
  );
  assert.equal(rising.speedMps, 7);
  assert.equal(rising.moving, true);
  assert.equal(rising.stationaryForMs, 0);
  assert.equal(rising.preparationBudgetMs, 0.65);
  assert.deepEqual(rising.lookAheadXYZ, [0, 31.4, 0]);
});

test('teleport discontinuity discards camera-estimated velocity and look-ahead, then reacquires real motion', () => {
  const tracker = new SceneryMotionTracker();
  tracker.update(0, [0, 2, 0], 'walk', 2, undefined, true);
  assert.equal(
    tracker.update(100, [1, 2, 0], 'walk', 2, undefined, true).moving,
    true,
  );
  const cut = tracker.update(200, [5_000, 2, 0], 'walk', 2, undefined, true);
  assert.equal(cut.speedMps, 0);
  assert.equal(cut.moving, false);
  assert.equal(cut.fast, false);
  assert.equal(cut.stationaryForMs, 0);
  assert.equal(cut.allowNewDetails, false);
  assert.deepEqual(cut.lookAheadXYZ, cut.positionXYZ);
  const continued = tracker.update(
    300,
    [5_000.4, 2, 0],
    'walk',
    2,
    undefined,
    true,
  );
  assert.equal(continued.moving, true);
  assert.ok(continued.speedMps < 4 && continued.speedMps > 1.2);
  assert.ok(leadDistance(continued) <= 8);
});

test('reversed, repeated or paused clocks re-anchor camera observations without manufacturing velocity', () => {
  for (const discontinuousTime of [50, 100, 1_500]) {
    const tracker = new SceneryMotionTracker();
    tracker.update(0, [0, 2, 0], 'walk', 2, undefined, true);
    tracker.update(100, [1, 2, 0], 'walk', 2, undefined, true);
    const reset = tracker.update(
      discontinuousTime,
      [2, 2, 0],
      'walk',
      2,
      undefined,
      true,
    );
    assert.equal(reset.speedMps, 0);
    assert.equal(reset.moving, false);
    assert.equal(reset.stationaryForMs, 0);
    assert.deepEqual(reset.lookAheadXYZ, reset.positionXYZ);
    const resumed = tracker.update(
      discontinuousTime + 100,
      [2.4, 2, 0],
      'walk',
      2,
      undefined,
      true,
    );
    assert.equal(resumed.moving, true);
    assert.ok(resumed.speedMps < 4);
  }
});

test('travel mode changes and explicit resets discard previous camera velocity and direction', () => {
  const tracker = new SceneryMotionTracker();
  tracker.update(0, [0, 2, 0], 'walk', 2, undefined, true);
  const walking = tracker.update(100, [1, 2, 0], 'walk', 2, undefined, true);
  assert.equal(walking.moving, true);
  const changed = tracker.update(200, [2, 2, 0], 'drive', 2, undefined, true);
  assert.equal(changed.speedMps, 0);
  assert.equal(changed.moving, false);
  assert.deepEqual(changed.lookAheadXYZ, changed.positionXYZ);
  // An authoritative body may keep moving after a camera cut, but its old
  // camera direction cannot become a new selection target.
  const bodyCut = tracker.update(300, [9_000, 20, 0], 'flight', 20, 40, true);
  assert.equal(bodyCut.moving, true);
  assert.deepEqual(bodyCut.lookAheadXYZ, bodyCut.positionXYZ);
  tracker.reset();
  const fresh = tracker.update(0, [777, 3, -888], 'orbit', 3, undefined, true);
  assert.equal(fresh.speedMps, 0);
  assert.equal(fresh.fast, false);
  assert.deepEqual(fresh.lookAheadXYZ, [777, 3, -888]);
});

test('look-ahead stays bounded for every mode and preserves the current surface height', () => {
  for (const [mode, maximumLead] of [
    ['walk', 8],
    ['drive', 90],
    ['boat', 90],
    ['flight', 120],
    ['orbit', 0],
  ]) {
    const tracker = new SceneryMotionTracker();
    tracker.update(0, [0, 17, 0], mode, 17, 1e6, true);
    const state = tracker.update(100, [6, 17, 8], mode, 17, 1e6, true);
    assert.equal(
      state.speedMps,
      320,
      `${mode} clamps invalidly large finite speed`,
    );
    near(leadDistance(state), maximumLead);
    assert.equal(state.lookAheadXYZ[1], 17);
    assert.ok(state.lookAheadXYZ[0] >= 6 && state.lookAheadXYZ[2] >= 8);
  }
});

test('moving speed hysteresis avoids toggling around the start and stop thresholds', () => {
  const tracker = new SceneryMotionTracker();
  let now = 0;
  const observe = (speed) =>
    tracker.update((now += 20), [0, 2, 0], 'drive', 2, speed, true);
  assert.equal(observe(1.1).moving, false);
  assert.equal(observe(1.3).moving, true);
  assert.equal(observe(0.8).moving, true);
  assert.equal(observe(0.56).moving, true);
  assert.equal(observe(0.54).moving, false);
  assert.equal(observe(0.8).moving, false);
  assert.equal(observe(1.21).moving, true);
});

test('fast travel hysteresis prevents per-frame budget changes near each mode threshold', () => {
  for (const [mode, threshold] of [
    ['walk', 6],
    ['drive', 14],
    ['boat', 14],
    ['flight', 24],
    ['orbit', 35],
  ]) {
    const tracker = new SceneryMotionTracker();
    let now = 0;
    const observe = (speed) =>
      tracker.update((now += 20), [0, 10, 0], mode, 10, speed, true);
    assert.equal(observe(threshold - 0.01).fast, false, mode);
    const fast = observe(threshold + 0.01);
    assert.equal(fast.fast, true, mode);
    assert.equal(fast.preparationBudgetMs, 0.2);
    assert.equal(observe(threshold * 0.8).fast, true, mode);
    const slow = observe(threshold * 0.7);
    assert.equal(slow.fast, false, mode);
    assert.equal(slow.preparationBudgetMs, 0.65);
  }
});

test('Auto pauses new detail admission during fast or high flight while manual quality remains available', () => {
  for (const [speed, altitude] of [
    [40, 20],
    [7, 200],
  ]) {
    const tracker = new SceneryMotionTracker();
    tracker.update(0, [0, altitude, 0], 'flight', altitude, speed, true);
    const automatic = tracker.update(
      100,
      [1, altitude, 0],
      'flight',
      altitude,
      speed,
      true,
    );
    assert.equal(automatic.allowNewDetails, false);
    assert.equal(automatic.admissionsPerFrame, 0);
    const manual = tracker.update(
      200,
      [2, altitude, 0],
      'flight',
      altitude,
      speed,
      false,
    );
    assert.equal(manual.auto, false);
    assert.equal(manual.allowNewDetails, true);
    assert.ok(manual.admissionsPerFrame > 0);
    assert.equal(manual.moving, automatic.moving);
    assert.equal(manual.speedMps, speed);
  }
});

test('stopping requires 250ms of settled motion before Auto can admit nearby details again', () => {
  const tracker = new SceneryMotionTracker();
  tracker.update(0, [0, 200, 0], 'flight', 200, 40, true);
  tracker.update(100, [4, 200, 0], 'flight', 200, 40, true);
  const stop = tracker.update(200, [4, 200, 0], 'flight', 200, 0, true);
  assert.equal(stop.moving, false);
  assert.equal(stop.fast, false);
  assert.equal(stop.stationaryForMs, 0);
  assert.equal(stop.allowNewDetails, false);
  const settling = tracker.update(449, [4, 200, 0], 'flight', 200, 0, true);
  assert.equal(settling.stationaryForMs, 249);
  assert.equal(settling.admissionsPerFrame, 0);
  const ready = tracker.update(450, [4, 200, 0], 'flight', 200, 0, true);
  assert.equal(ready.stationaryForMs, 250);
  assert.equal(ready.allowNewDetails, true);
  assert.equal(ready.admissionsPerFrame, 2);
  assert.equal(ready.preparationBudgetMs, 1.25);
});

test('motion snapshots copy and freeze position data instead of granting authority over the caller position', () => {
  const position = [1, 2, 3];
  const state = new SceneryMotionTracker().update(
    0,
    position,
    'walk',
    2,
    undefined,
    true,
  );
  position[0] = 999;
  assert.deepEqual(state.positionXYZ, [1, 2, 3]);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.positionXYZ));
  assert.ok(Object.isFrozen(state.lookAheadXYZ));
  assert.throws(() => {
    state.positionXYZ[0] = -1;
  }, TypeError);
});

test('invalid motion observations cannot poison a previously valid observation', () => {
  const tracker = new SceneryMotionTracker();
  tracker.update(0, [0, 2, 0], 'walk', 2, undefined, true);
  for (const args of [
    [-1, [0, 2, 0], 'walk', 2],
    [20, [NaN, 2, 0], 'walk', 2],
    [20, [0, Infinity, 0], 'walk', 2],
    [20, [0, 2, 0], 'teleport', 2],
    [20, [0, 2, 0], 'walk', NaN],
    [20, [0, 2, 0], 'walk', 2, Infinity],
  ])
    assert.throws(
      () => tracker.update(...args),
      /Invalid scenery motion observation/,
    );
  assert.equal(
    tracker.update(100, [1, 2, 0], 'walk', 2, undefined, true).moving,
    true,
  );
});

function budgetFixture() {
  let time = 0;
  const budget = new DetailWorkBudget(() => time);
  return {
    budget,
    spend: (ms) => {
      time += ms;
    },
    work: (ms) => () => {
      time += ms;
    },
  };
}

test('all consumers share cumulative callback work time rather than separate allowances or elapsed frame time', () => {
  const { budget, work, spend } = budgetFixture();
  budget.reset(1.25, 2);
  assert.equal(budget.run(work(0.4)), true);
  spend(1_000); // Rendering, waiting or another subsystem outside the callback.
  near(budget.remainingMs(), 0.85);
  assert.equal(budget.run(work(0.4)), true);
  assert.equal(budget.run(work(0.45)), true);
  near(budget.stats.usedMs, 1.25);
  near(budget.remainingMs(), 0);
  let ran = false;
  assert.equal(
    budget.run(() => {
      ran = true;
    }),
    false,
  );
  assert.equal(ran, false);
  assert.equal(budget.stats.attempts, 4);
  assert.equal(budget.stats.skipped, 1);
});

test('admission tokens are shared even by zero-cost callbacks while bounded continuation work needs no new token', () => {
  const { budget, work } = budgetFixture();
  budget.reset(2, 2);
  assert.equal(budget.run(work(0), { admission: true }), true);
  assert.equal(budget.run(work(0), { admission: true }), true);
  let thirdAdmission = false;
  assert.equal(
    budget.run(
      () => {
        thirdAdmission = true;
      },
      { admission: true },
    ),
    false,
  );
  assert.equal(thirdAdmission, false);
  assert.equal(budget.run(work(0.1)), true);
  assert.equal(budget.stats.admissions, 2);
  near(budget.stats.usedMs, 0.1);
  budget.reset(0.65, 0); // Auto high flight admits no new optional assets.
  assert.equal(budget.run(work(0.1), { admission: true }), false);
  assert.equal(budget.run(work(0.1)), true);
  near(budget.stats.usedMs, 0.1);
});

test('a zero work allowance rejects execution without consuming admission tokens', () => {
  const { budget, work } = budgetFixture();
  assert.equal(
    budget.run(work(0.1)),
    false,
    'uninitialized allowance is closed',
  );
  budget.reset(0, 2);
  assert.equal(budget.run(work(0), { admission: true }), false);
  assert.equal(budget.run(work(0)), false);
  assert.equal(budget.stats.usedMs, 0);
  assert.equal(budget.stats.admissions, 0);
});

test('reentrant consumers cannot execute nested work or spend another admission token', () => {
  const { budget, spend, work } = budgetFixture();
  budget.reset(1.25, 2);
  let nestedRan = false;
  assert.equal(
    budget.run(
      () => {
        assert.equal(
          budget.run(
            () => {
              nestedRan = true;
            },
            { admission: true },
          ),
          false,
        );
        spend(0.25);
      },
      { admission: true },
    ),
    true,
  );
  assert.equal(nestedRan, false);
  assert.equal(budget.stats.admissions, 1);
  assert.equal(budget.stats.skipped, 1);
  assert.equal(budget.run(work(0.2), { admission: true }), true);
  assert.equal(budget.stats.admissions, 2);
  assert.equal(budget.run(work(0), { admission: true }), false);
  near(budget.stats.usedMs, 0.45);
});

test('throwing work releases the execution lock, charges actual time and retains its consumed admission', () => {
  const { budget, spend, work } = budgetFixture();
  const failure = new Error('asset preparation failed');
  budget.reset(1.25, 1);
  assert.throws(
    () =>
      budget.run(
        () => {
          spend(0.4);
          throw failure;
        },
        { admission: true },
      ),
    (error) => error === failure,
  );
  near(budget.stats.usedMs, 0.4);
  assert.equal(budget.stats.admissions, 1);
  assert.equal(budget.run(work(0.1), { admission: true }), false);
  assert.equal(
    budget.run(work(0.25)),
    true,
    'the execution lock is released in finally',
  );
  near(budget.stats.usedMs, 0.65);
  budget.reset(1.25, 1);
  assert.equal(budget.run(work(0.1), { admission: true }), true);
  assert.equal(budget.stats.admissions, 2);
});

test('one indivisible overrun closes the shared frame and reset renews allowance without erasing lifetime evidence', () => {
  const { budget, work } = budgetFixture();
  budget.reset(0.2, 1);
  assert.equal(budget.run(work(0.35), { admission: true }), true);
  assert.equal(budget.remainingMs(), 0);
  assert.equal(budget.stats.overruns, 1);
  assert.equal(budget.run(work(0.1)), false);
  assert.equal(budget.run(work(0.1), { admission: true }), false);
  near(budget.stats.usedMs, 0.35);
  assert.equal(budget.stats.overruns, 1);
  budget.reset(0.2, 1);
  assert.equal(budget.stats.frames, 2);
  assert.equal(budget.stats.usedMs, 0);
  assert.equal(budget.stats.attempts, 3);
  assert.equal(budget.stats.skipped, 2);
  near(budget.stats.maxWorkMs, 0.35);
  assert.equal(budget.run(work(0.1), { admission: true }), true);
  near(budget.stats.usedMs, 0.1);
  assert.equal(budget.stats.admissions, 2);
  assert.equal(budget.stats.overruns, 1);
});

test('invalid preparation allowances fail before replacing a usable frame budget', () => {
  const { budget, work } = budgetFixture();
  budget.reset(1.25, 2);
  budget.run(work(0.25), { admission: true });
  for (const allowance of [
    [NaN, 1],
    [-0.1, 1],
    [2.01, 1],
    [1, -1],
    [1, 1.5],
    [1, 9],
  ])
    assert.throws(
      () => budget.reset(...allowance),
      /Invalid scenery preparation allowance/,
    );
  assert.equal(budget.stats.frames, 1);
  near(budget.remainingMs(), 1);
  assert.equal(budget.run(work(0.25), { admission: true }), true);
  assert.equal(budget.stats.admissions, 2);
  assert.equal(budget.run(work(0), { admission: true }), false);
});
