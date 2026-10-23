import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ROCKET_CONFIGS } from '../lib/city/rocket-state.ts';

const temp = '/private/tmp/rocket-titan-boosters-qa-' + Date.now() + '/';
await fs.mkdir(temp, { recursive: true });
const report = {
  method:
    'Four external Titan boosters and the main core fire together; the side boosters release first while the core continues. Real production city/controller/effects/models in Chrome Metal. The harness pauses automatic rocket updates and calls the original update(1/60). It does not assign phase, altitude, heat, damage counters or a success outcome. All three rockets use the same measured clear ground site and natural ground support.',
  startedAt: new Date().toISOString(),
  errors: [],
  consoleErrors: [],
  httpFailures: [],
  checks: {},
  missions: {},
  screenshots: [],
};
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
const settle = () =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
async function shot(name) {
  await settle();
  await page.screenshot({ path: temp + name });
  report.screenshots.push(name);
}
async function advance(seconds, stop) {
  return page.evaluate(
    async ({ seconds, stop }) => {
      const r = window.__atlas.rocket;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        window.__titanStep(1 / 60);
        if (
          (stop === 'ready' && r.state.phase === 'ready') ||
          (stop === 'liftoff' && r.state.phase === 'flight') ||
          (stop === 'strap-staging' && !r.state.strapAttached) ||
          (stop === 'staging' && !r.state.boosterAttached) ||
          (stop === 'space' && r.state.phase === 'space')
        )
          break;
        if (['crashed', 'sinking'].includes(r.state.phase)) break;
        if (i % 120 === 119) await new Promise(requestAnimationFrame);
      }
      r.onChange(r.snapshot);
      return { snapshot: r.snapshot, state: r.state };
    },
    { seconds, stop },
  );
}
async function start(kind, site) {
  await page.evaluate(() => window.__atlas.rocket.returnToCity());
  await settle();
  await page.evaluate(
    ({ kind, site }) =>
      window.__atlas.rocket.start(kind, site.x, site.y + 0.45, site.z),
    { kind, site },
  );
  await page.waitForFunction(
    () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
    null,
    { timeout: 90000 },
  );
  assert(await page.evaluate(() => window.__atlas.rocket.loaded));
  const ready = await advance(
    ROCKET_CONFIGS[kind].buildDuration + 0.2,
    'ready',
  );
  assert.equal(ready.snapshot.phase, 'ready');
  return ready;
}
async function effects() {
  return page.evaluate(() => {
    const r = window.__atlas.rocket,
      fx = r.effects,
      origin = r.state.origin;
    const distance = (x, z) => Math.hypot(x - origin.x, z - origin.z);
    return {
      damaged: fx.damaged,
      burning: fx.burning,
      debris: fx.debris,
      buildingRange: Math.max(
        0,
        ...fx.parts
          .filter((p) => p.collapse > 0)
          .map((p) => distance(...p.part.center)),
      ),
      heatRange: Math.max(
        0,
        ...fx.trees.filter((t) => t.heat > 0.13).map((t) => distance(t.x, t.z)),
      ),
      pressureTrees: fx.trees.filter((t) => t.pressure > 0.01).length,
      pressureTreeRange: Math.max(
        0,
        ...fx.trees
          .filter((t) => t.pressure > 0.01)
          .map((t) => distance(t.x, t.z)),
      ),
      profile: {
        buildings: fx.parts.length,
        trees: fx.trees.length,
        particles: fx.particles.length,
        actors: fx.flying.length,
        rubble: fx.fragments.length,
      },
      stage: r.state.stage,
      strapAttached: r.state.strapAttached,
      boosterAttached: r.state.boosterAttached,
      strapFuel: r.state.strapFuel,
      coreFuel: r.state.boosterFuel,
      stageThrust: r.state.stageThrust,
      mass: r.state.mass,
      corePlumeVisible: r.model.flame.visible,
      strapPlumeCount: r.model.strapPlumes.filter((p) => p.visible).length,
      strapCount: r.model.strapOns.length,
      groundRibbons:
        fx.group.getObjectByName('Titan five-jet ground flame outwash')
          ?.count || 0,
      phase: r.state.phase,
      flightElapsed: r.state.flightElapsed,
      altitude: r.state.altitude,
    };
  });
}
try {
  await page.goto('http://127.0.0.1:5173/?inspect&graphics=compatible', {
    timeout: 120000,
  });
  await page.waitForFunction(
    () =>
      window.__atlas?.rocket &&
      window.__atlas.renderReady &&
      window.__atlas.data.rocketBuildingParts?.length &&
      window.__atlas.detailedTrees?.trees?.length,
    null,
    { timeout: 120000 },
  );
  await page
    .locator('.rocket-mode-button:not(:disabled)')
    .waitFor({ timeout: 120000 });
  // The inspector is exposed before React's initial mode effect commits.
  // A real placement click can only occur after the enabled mode button.
  await settle();
  await page.evaluate(() => {
    const e = window.__atlas,
      r = e.rocket;
    window.__titanStep = r.update.bind(r);
    r.update = () => {};
    window.__titanHash = () => {
      let hash = 2166136261;
      for (const key of ['position', 'color']) {
        const a = e.data.rocketBuildingMesh.geometry.getAttribute(key).array;
        const data = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
        for (const n of data) hash = Math.imul(hash ^ n, 16777619);
      }
      return hash >>> 0;
    };
    window.__titanBaseline = window.__titanHash();
    r.start('super-heavy', 0, e.elevation(0, 0) + 0.45, 0);
  });
  await page.waitForFunction(() => window.__atlas?.rocket?.loaded, null, {
    timeout: 90000,
  });
  const site = await page.evaluate((footprint) => {
    const e = window.__atlas,
      world = e.rocket.world,
      parts = e.data.rocketBuildingParts,
      trees = e.detailedTrees.trees;
    let best;
    for (let x = -1800; x <= 1800; x += 75)
      for (let z = -1000; z <= 2200; z += 75) {
        if (!e.onLand(x, z) || e.waterWorld.at(x, z)) continue;
        const y = e.elevation(x, z),
          heights = [
            [footprint * 1.5, 0],
            [-footprint * 1.5, 0],
            [0, footprint * 1.5],
            [0, -footprint * 1.5],
          ].map(([dx, dz]) => e.elevation(x + dx, z + dz));
        if (Math.max(...heights) - Math.min(...heights) > 1) continue;
        const base = e.camera.position.clone().set(x, y + footprint, z),
          tip = e.camera.position.clone().set(x, y + 112, z);
        if (world.hit(base, tip, footprint)) continue;
        const near = parts.filter(
          (p) => Math.hypot(p.center[0] - x, p.center[1] - z) < 95,
        ).length;
        const outer = parts.filter((p) => {
          const d = Math.hypot(p.center[0] - x, p.center[1] - z);
          return d > 110 && d < 210;
        }).length;
        const treeCount = trees.filter(
          (t) => Math.hypot(t.x - x, t.z - z) < 105,
        ).length;
        if (near < 2 || outer < 4 || treeCount < 3) continue;
        const score =
          Math.min(outer, 70) * 2 +
          Math.min(near, 15) +
          Math.min(treeCount, 20) * 0.4 -
          Math.hypot(x, z) * 0.005;
        if (!best || score > best.score)
          best = { x, y, z, near, outer, treeCount, score };
      }
    if (!best) throw Error('No measured clear Titan launch site');
    return best;
  }, ROCKET_CONFIGS['super-heavy'].footprintRadius);
  report.site = site;
  console.log('site', JSON.stringify(site));
  await page.evaluate(() =>
    window.__atlas.setClock({ hour: 12, running: false }),
  );
  for (const kind of ['small', 'large', 'super-heavy']) {
    const ready = await start(kind, site);
    assert.equal(ready.snapshot.support, 'ground');
    assert.equal(ready.snapshot.countdown, 5);
    await shot(`titan-four-${kind}-ready.png`);
    if (kind === 'super-heavy') {
      await page.evaluate(() =>
        window.__atlas.setClock({ hour: 18.5, running: false }),
      );
      await shot('titan-four-dusk-materials.png');
      await page.evaluate(() =>
        window.__atlas.setClock({ hour: 12, running: false }),
      );
    }
    await page.evaluate(() => window.__atlas.rocket.launch());
    await advance(
      ROCKET_CONFIGS[kind].countdownDuration +
        ROCKET_CONFIGS[kind].ignitionDuration +
        0.2,
      'liftoff',
    );
    await advance(1);
    const early = await effects();
    await shot(`titan-four-${kind}-ignition.png`);
    if (kind === 'super-heavy') {
      const orbit = await page.evaluate(() => {
        const r = window.__atlas.rocket;
        const saved = { yaw: r.lookYaw, pitch: r.lookPitch };
        r.lookYaw = 1.4;
        r.lookPitch = 1.0;
        r.updateCamera(1);
        return saved;
      });
      await shot('titan-four-ground-outwash.png');
      await page.evaluate(({ yaw, pitch }) => {
        const r = window.__atlas.rocket;
        r.lookYaw = yaw;
        r.lookPitch = pitch;
        r.updateCamera(1);
      }, orbit);
    }
    assert.equal(early.phase, 'flight');
    await advance(4);
    const response = await effects();
    report.missions[kind] = { ready: ready.snapshot, early, response };
    console.log(kind, JSON.stringify(response));
    if (kind === 'super-heavy') {
      assert.equal(early.strapPlumeCount, 4);
      assert.equal(early.corePlumeVisible, true);
      assert.equal(early.groundRibbons, 40);
      assert(early.coreFuel < ROCKET_CONFIGS[kind].stages.boost.fuelMass);
      const pack = await advance(15, 'strap-staging');
      assert.equal(pack.state.strapAttached, false);
      assert.equal(pack.state.boosterAttached, true);
      assert.equal(pack.snapshot.stage, 'strap-separating');
      assert(pack.state.stageThrust > 0);
      await advance(0.45);
      const releasing = await effects();
      assert.equal(releasing.strapPlumeCount, 0);
      assert.equal(releasing.corePlumeVisible, true);
      assert(releasing.coreFuel > 0 && releasing.coreFuel < response.coreFuel);
      report.missions[kind].strapRelease = {
        snapshot: pack.snapshot,
        separation: pack.state.strapSeparation,
        visual: releasing,
      };
      await shot('titan-four-booster-transition.png');
      await advance(1.1);
      await shot('titan-four-booster-release.png');
      const stage = await advance(35, 'staging');
      assert.equal(stage.state.boosterAttached, false);
      assert.equal(stage.snapshot.phase, 'flight');
      await advance(0.9);
      await shot('titan-four-core-release.png');
      const complete = await advance(80, 'space');
      assert.equal(complete.snapshot.phase, 'space');
      report.missions[kind].complete = complete.snapshot;
      report.missions[kind].events = complete.state.events;
      report.missions[kind].flightElapsed = complete.state.flightElapsed;
      await shot('titan-four-mission-complete.png');
    }
    await page.evaluate(() => window.__atlas.rocket.returnToCity());
    await settle();
    const restored = await page.evaluate(() => ({
      hash: window.__titanHash(),
      baseline: window.__titanBaseline,
      active: window.__atlas.rocket.active,
      mode: window.__atlas.settings.mode,
    }));
    assert.equal(restored.hash, restored.baseline);
    assert.equal(restored.active, false);
    assert.equal(restored.mode, 'orbit');
    report.missions[kind].restored = restored;
  }
  const s = report.missions.small.response,
    l = report.missions.large.response,
    t = report.missions['super-heavy'].response;
  report.checks = {
    threeSelectableKinds: true,
    loadingBuffersPreserved: Object.values(report.missions).every(
      (m) => m.ready.countdown === 5,
    ),
    allLaunchFromActualGround: true,
    moreBuildingsAffected: t.damaged > l.damaged && l.damaged >= s.damaged,
    buildingEffectsReachFurther: t.buildingRange > l.buildingRange,
    widerTreeResponse: t.pressureTreeRange > l.heatRange,
    heatAndPressureHaveDifferentRanges: t.pressureTrees > 0,
    fourBoostersAndCoreIgniteTogether:
      report.missions['super-heavy'].early.strapPlumeCount === 4 &&
      report.missions['super-heavy'].early.corePlumeVisible,
    fiveJetsSpreadOnGround:
      report.missions['super-heavy'].early.groundRibbons === 40,
    directGroundFlamesStopAbovePlumeReach:
      report.missions['super-heavy'].response.groundRibbons === 0,
    sideBoostersReleaseBeforeCore:
      report.missions['super-heavy'].strapRelease.snapshot.stage ===
        'strap-separating' &&
      report.missions['super-heavy'].strapRelease.visual.boosterAttached,
    coreKeepsFiringAfterSideRelease:
      report.missions['super-heavy'].strapRelease.visual.corePlumeVisible &&
      report.missions['super-heavy'].strapRelease.visual.stageThrust > 0,
    naturalStageEventOrder: [
      'strap-on-separation',
      'core-only',
      'stage-separation',
      'upper-ignition',
      'mission-complete',
    ].every((name, index, order) => {
      const events = report.missions['super-heavy'].events;
      const at = events.findIndex((e) => e.type === name);
      return (
        at >= 0 &&
        (!index || at > events.findIndex((e) => e.type === order[index - 1]))
      );
    }),
    titanStageSeparation: true,
    titanMissionComplete:
      report.missions['super-heavy'].complete.altitude >= 100000,
    boundedEffects:
      t.profile.buildings <= 96 &&
      t.profile.trees <= 56 &&
      t.profile.particles <= 600 &&
      t.profile.actors <= 96 &&
      t.profile.rubble <= 96,
    exactBuildingGeometryRestored: true,
    allReturnToCity: true,
  };
  assert(
    Object.values(report.checks).every(Boolean),
    JSON.stringify(report.checks),
  );
  assert(
    report.consoleErrors.every((message) =>
      message.startsWith('Failed to load resource:'),
    ),
    'the real city run has no shader, WebGL or JavaScript console errors',
  );
} catch (error) {
  report.failure = String(error);
  await shot('titan-qa-failure.png').catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(temp + 'report.json', JSON.stringify(report, null, 2));
  await browser.close();
  const target = new URL('../work/rocket-titan-boosters-qa/', import.meta.url);
  await fs.mkdir(target, { recursive: true });
  await fs.cp(temp, target, { recursive: true });
  console.log(
    'RESULT',
    JSON.stringify({
      checks: report.checks,
      failure: report.failure,
      errors: report.errors,
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
