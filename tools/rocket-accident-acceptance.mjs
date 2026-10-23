import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROCKET_CONFIGS } from '../lib/city/rocket-state.ts';

const temp = '/private/tmp/rocket-accident-qa-' + Date.now() + '/';
await fs.mkdir(temp, { recursive: true });
const report = {
  method:
    'Real city, RocketController, RocketEffects and model in hardware WebGL. Automatic rocket updates are paused only by the test harness, which repeatedly calls the original update(1/60), allowing exact screenshots. No phase, heat, fire, collision or destruction outcome is assigned. Replay seeds and manual throttle commands are supplied as normal inputs.',
  startedAt: new Date().toISOString(),
  errors: [],
  consoleErrors: [],
  httpFailures: [],
  checks: {},
  roof: [],
  forest: [],
  screenshots: [],
};
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => report.errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') report.consoleErrors.push(m.text());
});
page.on('response', (response) => {
  if (response.status() >= 400)
    report.httpFailures.push({
      url: response.url(),
      status: response.status(),
    });
});
await page.addInitScript(() =>
  localStorage.setItem('vancouver-atlas-language', 'zh-Hant'),
);
const shot = async (name) => {
  await page.screenshot({ path: temp + name });
  report.screenshots.push(name);
};
await page.exposeFunction('__rocketQAScreenshot', shot);
const settle = () =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
async function advance(seconds, stop) {
  return page.evaluate(
    async ({ seconds, stop }) => {
      const e = window.__atlas,
        r = e.rocket;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        window.__rocketQAStep(1 / 60);
        if (
          (stop === 'ready' && r.state.phase === 'ready') ||
          (stop === 'falling' && r.state.phase === 'falling') ||
          (stop === 'impact' && r.state.wreckage) ||
          (stop === 'explosion' && r.state.wreckage?.exploded) ||
          (stop === 'space' && r.state.phase === 'space')
        )
          break;
        if (i % 120 === 119) await new Promise(requestAnimationFrame);
      }
      r.onChange(r.snapshot);
      return {
        snapshot: r.snapshot,
        events: r.state.events,
        position: r.state.position,
        supportElapsed: r.state.supportCollapseElapsed,
        wreckage: r.state.wreckage,
      };
    },
    { seconds, stop },
  );
}
async function recordRoof(label) {
  await settle();
  const result = await page.evaluate((label) => {
    const r = window.__atlas.rocket;
    const focus =
      r.damageFocus?.clone() ??
      r.model.group.position.clone().add(
        r.model.group.position
          .clone()
          .set(0, r.model.height * 0.45, 0)
          .applyQuaternion(r.model.group.quaternion),
      );
    return {
      label,
      elapsed: r.state.elapsed,
      viewClear: !r.world.hit(focus, window.__atlas.camera.position, 0.5),
      position: { ...r.state.position },
      snapshot: r.snapshot,
      roofTop: r.effects.supportCollisionHeight(
        r.state.origin.x,
        r.state.origin.z,
        r.state,
      ),
      pieces: r.model.group.children.filter((c) =>
        c.name.startsWith('Ruptured rocket section'),
      ).length,
      options: document.querySelectorAll(
        '.rocket-panel,.rocket-compact-actions,.rocket-space-panel',
      ).length,
      observation: document.querySelector('.rocket-accident-observation')
        ?.textContent,
    };
  }, label);
  report.roof.push(result);
  console.log(label, JSON.stringify(result));
  return result;
}
async function start(kind, point, support) {
  await page.evaluate(() => window.__atlas.rocket.returnToCity());
  await settle();
  await page.evaluate(
    ({ kind, point, support }) =>
      window.__atlas.rocket.start(kind, ...point, support),
    { kind, point, support },
  );
  await page.waitForFunction(
    () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
    null,
    { timeout: 90000 },
  );
  assert(await page.evaluate(() => window.__atlas.rocket.loaded));
  await advance(ROCKET_CONFIGS[kind].buildDuration + 0.2, 'ready');
  assert.equal(
    await page.evaluate(() => window.__atlas.rocket.state.phase),
    'ready',
  );
}
try {
  await page.goto('http://127.0.0.1:5173/?inspect&graphics=compatible', {
    timeout: 120000,
  });
  await page.waitForFunction(
    () =>
      window.__atlas?.rocket &&
      window.__atlas.data.flightBuildingVolumes?.length &&
      window.__atlas.detailedTrees?.trees?.length,
    null,
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    const r = window.__atlas.rocket;
    window.__rocketQAStep = r.update.bind(r);
    r.update = () => {};
  });
  const roof = await page.evaluate(() => {
    const e = window.__atlas;
    return e.data.flightBuildingVolumes
      .map((v) => {
        const ring = v.polygon[0],
          x = ring.reduce((s, p) => s + p[0], 0) / ring.length,
          z = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        const area =
          Math.abs(
            ring.reduce((s, p, i) => {
              const q = ring[(i + 1) % ring.length];
              return s + p[0] * q[1] - q[0] * p[1];
            }, 0),
          ) / 2;
        return {
          x,
          z,
          top: v.maxY,
          ground: e.elevation(x, z),
          area,
          height: v.maxY - v.minY,
        };
      })
      .filter(
        (v) =>
          v.area > 90 &&
          v.area < 340 &&
          v.height > 5 &&
          v.height < 13 &&
          e.onLand(v.x, v.z),
      )
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
  });
  assert(roof);
  report.roofSite = roof;
  await start('large', [roof.x, roof.top + 0.45, roof.z], {
    kind: 'roof-small',
    groundY: roof.ground,
    seed: 13,
  });
  await page.evaluate(() => {
    window.__atlas.rocket.setView('first');
    window.__atlas.rocket.launch();
  });
  await advance(12, 'falling');
  const collapse = await recordRoof('collapse');
  await shot('accident-roof-collapse.png');
  assert.equal(collapse.snapshot.phase, 'falling');
  assert.equal(collapse.snapshot.view, 'chase');
  assert.equal(collapse.options, 0);
  await advance(1);
  const sag = await recordRoof('supported-sag');
  await advance(0.75);
  const fall = await recordRoof('freefall');
  await shot('accident-roof-freefall.png');
  assert.equal(fall.snapshot.failureStage, 'freefall');
  assert.equal(fall.options, 0);
  await advance(6, 'impact');
  const impact = await recordRoof('impact');
  await shot('accident-roof-rupture.png');
  assert.equal(impact.snapshot.phase, 'crashed');
  assert.equal(impact.pieces, 6);
  assert.equal(impact.options, 0);
  assert(impact.elapsed - collapse.elapsed > 1.5);
  const aftermath = await advance(2, 'explosion');
  const scheduledExplosion = aftermath.wreckage.explosionDelay !== null;
  const observed = await recordRoof(
    scheduledExplosion ? 'explosion' : 'nonexplosive-wreckage',
  );
  await shot(
    scheduledExplosion
      ? 'accident-roof-explosion.png'
      : 'accident-roof-nonexplosive-wreckage.png',
  );
  if (scheduledExplosion) {
    assert.equal(aftermath.wreckage.exploded, true);
    assert(observed.snapshot.failureAge < 0.1);
  } else {
    assert.equal(aftermath.wreckage.exploded, false);
    assert.equal(aftermath.wreckage.explosionTime, null);
    assert(!aftermath.events.some((event) => event.type === 'exploded'));
  }
  report.roofOutcome = {
    branch: scheduledExplosion ? 'delayed-explosion' : 'nonexplosive-impact',
    observationAnchor: scheduledExplosion
      ? 'actual-explosion'
      : 'actual-impact',
    wreckage: aftermath.wreckage,
  };
  await advance(Math.max(0, 4.8 - observed.snapshot.failureAge));
  const waiting = await recordRoof(
    scheduledExplosion ? 'post-explosion-4.8s' : 'post-impact-4.8s',
  );
  await shot('accident-roof-observation.png');
  assert.equal(waiting.options, 0);
  await advance(0.35);
  await settle();
  const fadeStart = await page
    .locator('.rocket-failure-panel')
    .evaluate((el) => ({
      opacity: Number(getComputedStyle(el).opacity),
      animation: getComputedStyle(el).animationName,
    }));
  await page.waitForTimeout(750);
  const recovery = await recordRoof('recovery');
  const fadeEnd = await page
    .locator('.rocket-failure-panel')
    .evaluate((el) => Number(getComputedStyle(el).opacity));
  await shot('accident-roof-recovery.png');
  report.fade = { start: fadeStart, end: fadeEnd };
  assert.equal(recovery.options, 1);
  assert.equal(fadeStart.animation, 'rocket-failure-reveal');
  assert(fadeEnd > 0.99);
  report.checks = {
    ...report.checks,
    gradualRoofCollapse:
      sag.roofTop < collapse.roofTop && fall.roofTop < sag.roofTop,
    visibleFreefall: impact.elapsed - collapse.elapsed > 1.5,
    actualSixShellSections: impact.pieces === 6,
    firstPersonFramesAccident: collapse.snapshot.view === 'chase',
    noRecoveryBeforeFiveSeconds: waiting.options === 0,
    recoveryFadesIn: fadeEnd > 0.99 && !!fadeStart.animation,
    accidentCameraClearsBuildings: fall.viewClear && waiting.viewClear,
  };
  assert(report.checks.accidentCameraClearsBuildings);
  await page.getByRole('button', { name: '修復城市', exact: true }).click();
  await settle();
  await advance(0.25);
  report.restoredCity = await page.evaluate(() => {
    const r = window.__atlas.rocket;
    return {
      damaged: r.effects?.damaged,
      shockAge: r.effects?.shockAge,
      restoredRoof: r.effects?.supportCollisionHeight(
        r.state.origin.x,
        r.state.origin.z,
        r.state,
      ),
      supportColliders: r.supportVolumes.length,
      failureAge: r.snapshot.failureAge,
    };
  });
  assert.equal(report.restoredCity.damaged, 0);
  assert.equal(report.restoredCity.restoredRoof, null);
  assert(report.restoredCity.shockAge > 5);
  assert.equal(report.restoredCity.supportColliders, 0);
  report.checks.cityRepairDoesNotReplayAccident = true;

  // A dense real forest, with manual near-ground flight. Real exhaust ignites
  // the trees; their local heat is sampled back into the real thermal state.
  const forest = await page.evaluate(() => {
    const e = window.__atlas,
      trees = e.detailedTrees.trees;
    const sites = trees
      .filter((t, i) => i % 13 === 0 && t.h > 8 && e.onLand(t.x, t.z))
      .map((t) => {
        const close = trees.filter(
          (q) => Math.hypot(q.x - t.x, q.z - t.z) < 12,
        ).length;
        const y = e.elevation(t.x, t.z),
          slope = Math.max(
            ...[
              [3, 0],
              [-3, 0],
              [0, 3],
              [0, -3],
            ].map(([x, z]) => Math.abs(e.elevation(t.x + x, t.z + z) - y)),
          );
        return { x: t.x, z: t.z, y, close, slope };
      })
      .filter((t) => t.close >= 4 && t.slope < 0.8)
      .sort((a, b) => b.close - a.close);
    return sites[0];
  });
  assert(forest);
  report.forestSite = forest;
  await start('small', [forest.x, forest.y + 0.45, forest.z], {
    kind: 'ground',
    groundY: forest.y,
    strength: 1,
    seed: 1,
  });
  await page.evaluate(() => {
    const r = window.__atlas.rocket;
    r.setAuto(false);
    r.setStabilize(true);
    r.setThrottle(0.18);
    r.launch();
  });
  const forestResult = await page.evaluate(async () => {
    const r = window.__atlas.rocket,
      trace = [];
    let escapedAt = null,
      ignitedAt = null;
    let maxHeat = 0,
      maxExposure = 0,
      fireShot = false;
    for (let i = 0; i < 40 * 60; i++) {
      const s = r.state;
      if (s.phase === 'flight' && escapedAt === null) {
        // User throttle commands hold the vehicle just above its placement.
        const a = Math.max(
          -2,
          Math.min(2, (3 - s.altitude) * 0.8 - s.velocity.y * 1.6),
        );
        r.setThrottle(
          Math.max(0.01, Math.min(1, (s.mass * (9.80665 + a)) / 1600000)),
        );
        if (s.heat > 0.99 && s.fireElapsed > 2.5) {
          r.setAuto(true);
          escapedAt = s.elapsed;
        }
      }
      window.__rocketQAStep(1 / 60);
      maxHeat = Math.max(maxHeat, r.state.heat);
      maxExposure = Math.max(maxExposure, r.effects.sampleVehicleHeat(r.state));
      if (r.state.fireIntensity > 0 && ignitedAt === null)
        ignitedAt = r.state.elapsed;
      if (r.state.fireIntensity > 0.3 && !fireShot) {
        fireShot = true;
        r.onChange(r.snapshot);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await window.__rocketQAScreenshot('accident-forest-onboard-fire.png');
      }
      if (i % 30 === 0)
        trace.push({
          t: r.state.elapsed,
          phase: r.state.phase,
          h: r.state.altitude,
          heat: r.state.heat,
          fire: r.state.fireIntensity,
          exposure: r.effects.sampleVehicleHeat(r.state),
          trees: r.effects.burning,
          throttle: r.state.throttle,
          vy: r.state.velocity.y,
        });
      if (r.state.wreckage) {
        r.onChange(r.snapshot);
        return {
          trace,
          escapedAt,
          ignitedAt,
          maxHeat,
          maxExposure,
          snapshot: r.snapshot,
          wreckage: r.state.wreckage,
        };
      }
      if (i % 120 === 119) await new Promise(requestAnimationFrame);
    }
    return {
      trace,
      escapedAt,
      ignitedAt,
      maxHeat,
      maxExposure,
      snapshot: r.snapshot,
      wreckage: r.state.wreckage,
    };
  });
  report.forest = forestResult;
  console.log('forest', JSON.stringify(forestResult));
  await advance(0.35);
  await settle();
  await shot('accident-forest-airburst.png');
  assert(forestResult.maxExposure > 0.5);
  assert(forestResult.ignitedAt !== null);
  assert.equal(forestResult.wreckage?.cause, 'fire');
  assert(
    forestResult.escapedAt !== null &&
      forestResult.wreckage.time > forestResult.escapedAt,
  );
  report.checks.realForestHeat = true;
  report.checks.visibleBurnBeforeExplosion =
    forestResult.wreckage.time - forestResult.ignitedAt > 3;
  report.checks.fireCanExplodeAfterLiftoff =
    forestResult.wreckage.position.y > forest.y + 10;
  await advance(5.3);
  await page.waitForTimeout(750);
  await shot('accident-forest-wreckage.png');

  // A normal automatic launch at this same forest site is allowed to escape.
  await start('small', [forest.x, forest.y + 0.45, forest.z], {
    kind: 'ground',
    groundY: forest.y,
    strength: 1,
    seed: 0,
  });
  await page.evaluate(() => window.__atlas.rocket.launch());
  const normal = await advance(100, 'space');
  report.normalForest = normal.snapshot;
  assert.equal(normal.snapshot.phase, 'space');
  report.checks.forestDoesNotAlwaysExplode = true;
  await page.evaluate(() => window.__atlas.rocket.returnToCity());
  await settle();
  report.checks.returnToCity = await page.evaluate(
    () =>
      !window.__atlas.rocket.active && window.__atlas.settings.mode === 'orbit',
  );
} catch (e) {
  report.failure = String(e);
  await shot('accident-qa-failure.png').catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(temp + 'report.json', JSON.stringify(report, null, 2));
  await browser.close();
  const target = new URL('../work/rocket-accident-qa/', import.meta.url);
  await fs.mkdir(target, { recursive: true });
  await fs.cp(temp, target, { recursive: true });
  console.log(
    'RESULT',
    JSON.stringify({
      checks: report.checks,
      failure: report.failure,
      errors: report.errors,
      consoleErrors: report.consoleErrors,
      report: new URL('report.json', target).pathname,
    }),
  );
}
if (
  report.failure ||
  report.errors.length ||
  Object.values(report.checks).some((v) => !v)
)
  process.exitCode = 1;
