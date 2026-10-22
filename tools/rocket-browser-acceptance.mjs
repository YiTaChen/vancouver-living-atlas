import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { ROCKET_CONFIGS } from '../lib/city/rocket-state.ts';

const evidence = new URL(
  '../docs/rocket-launch-game/evidence/',
  import.meta.url,
).pathname;
const reportFile = new URL(
  '../work/rocket-environment-qa.json',
  import.meta.url,
).pathname;
await fs.mkdir(new URL('../work/', import.meta.url), { recursive: true });
const tempEvidence = '/private/tmp/rocket-environment-qa-' + Date.now() + '/';
await fs.mkdir(tempEvidence, { recursive: true });
const resume = process.env.ROCKET_QA_RESUME === '1';
const previous = resume
  ? JSON.parse(await fs.readFile(reportFile, 'utf8'))
  : null;
const report = {
  method:
    'Accelerated integration tests call the real RocketController.update(1/60) repeatedly; physical phases, fuel, collisions and 100 km ascent are not bypassed. Rendering uses hardware WebGL in Google Chrome Metal. Production source is not modified.',
  startedAt: new Date().toISOString(),
  consoleErrors: [],
  pageErrors: [],
  console: [],
  scenarios: previous?.scenarios ?? {},
  screenshots: [],
  previousInterruptedAttempt: previous
    ? {
        cause:
          'The root confirmed a development HMR reload during an in-flight startup shader compilation. Overlay screenshots from that attempt were discarded.',
        errors: previous.pageErrors,
        at: previous.startedAt,
      }
    : undefined,
};
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
page.on('console', (message) => {
  if (message.type() === 'error') report.consoleErrors.push(message.text());
  if (report.console.length < 100)
    report.console.push(message.type() + ': ' + message.text());
});
page.on('pageerror', (error) =>
  report.pageErrors.push(error.stack ?? String(error)),
);
const log = (label, result) => {
  console.log(label, JSON.stringify(result));
};
const screenshot = async (name) => {
  await page.screenshot({ path: tempEvidence + name });
  report.screenshots.push('docs/rocket-launch-game/evidence/' + name);
};
const snapshot = () =>
  page.evaluate(() => ({
    snapshot: window.__atlas.rocket.snapshot,
    state: window.__atlas.rocket.state,
  }));
async function start(kind, position, support) {
  // Returning uses the app's React settings bridge. Let its orbit commit and
  // passive effect settle before issuing a new world-coordinate test action.
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await page.evaluate(
    ({ kind, position, support }) =>
      window.__atlas.rocket.start(kind, ...position, support),
    { kind, position, support },
  );
  await page.waitForFunction(
    () => window.__atlas?.rocket?.loaded || window.__atlas?.rocket?.loadError,
    null,
    { timeout: 90000 },
  );
  const loaded = await page.evaluate(() => window.__atlas.rocket.loaded);
  if (!loaded) throw new Error('Resources failed to load');
}
async function advance(seconds, until) {
  return page.evaluate(
    async ({ seconds, until }) => {
      const r = window.__atlas.rocket;
      let frames = 0;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        r.update(1 / 60);
        frames++;
        if (until && until.includes(r.state.phase)) break;
        if (i % 120 === 119)
          await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { frames, snapshot: r.snapshot, state: r.state };
    },
    { seconds, until },
  );
}
async function launch() {
  const kind = await page.evaluate(() => window.__atlas.rocket.state.kind);
  await advance(ROCKET_CONFIGS[kind].buildDuration + 0.2, [
    'ready',
    'sinking',
    'crashed',
  ]);
  await page.evaluate(() => window.__atlas.rocket.launch());
}
try {
  console.log('Launching actual city in Google Chrome Metal');
  await page.goto('http://127.0.0.1:5173/?inspect&graphics=compatible', {
    waitUntil: 'domcontentloaded',
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
  report.startup = await page.evaluate(() => {
    const e = window.__atlas;
    const gl = e.renderer.getContext();
    return {
      buildings: e.data.flightBuildingVolumes.length,
      trees: e.detailedTrees.trees.length,
      ready: e.renderReady,
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
    };
  });
  log('startup', report.startup);

  // Pick a measured small roof through the actual screen-space placement path.
  const roof = await page.evaluate(() => {
    const e = window.__atlas,
      candidates = e.data.flightBuildingVolumes
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
            v.height > 4 &&
            v.height < 13 &&
            e.onLand(v.x, v.z),
        )
        .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const roof = candidates[0];
    if (!roof) throw new Error('No small measured roof candidate');
    e.rocket.beginPlacement('large');
    e.rocket.setInputEnabled(true);
    e.camera.position.set(roof.x + 35, roof.top + 140, roof.z + 60);
    e.controls.target.set(roof.x, roof.top, roof.z);
    e.controls.update();
    e.camera.lookAt(e.controls.target);
    e.camera.updateMatrixWorld();
    const p = e.camera.position
        .clone()
        .set(roof.x, roof.top, roof.z)
        .project(e.camera),
      rect = e.renderer.domElement.getBoundingClientRect();
    const sx = rect.left + ((p.x + 1) * rect.width) / 2,
      sy = rect.top + ((1 - p.y) * rect.height) / 2;
    e.rocket.pick(sx, sy, true);
    return {
      candidate: roof,
      screen: { sx, sy },
      picked: e.rocket.snapshot,
      origin: e.rocket.state?.origin,
    };
  });
  report.scenarios.roofPick = roof;
  log('roofPick', roof);
  if (!roof.picked.exists)
    throw new Error('Actual roof pick did not place a rocket');
  await page.waitForFunction(() => window.__atlas.rocket.loaded, null, {
    timeout: 90000,
  });
  await launch();
  const roofFailure = await advance(30, ['crashed', 'space']);
  report.scenarios.largeSmallRoof = roofFailure;
  log('largeSmallRoof', roofFailure.snapshot);
  await screenshot('integrated-large-roof-failure.png');
  await page.evaluate(() => window.__atlas.rocket.returnToCity());
  // A real next placement click happens after React publishes the returned
  // orbit mode. Match that boundary before the next imperative screen pick.
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

  if (!resume) {
    // Use a real visible ocean point for screen-space water placement.
    const sea = await page.evaluate(() => {
      const e = window.__atlas;
      let point;
      for (let x = -1800; x < 1800 && !point; x += 150)
        for (let z = 300; z < 1800; z += 150)
          if (e.waterWorld.at(x, z)?.kind === 'sea') {
            point = [x, e.waterWorld.sea.level, z];
            break;
          }
      if (!point) throw new Error('No ocean point in current city');
      e.rocket.beginPlacement('small');
      e.rocket.setInputEnabled(true);
      e.camera.position.set(point[0], point[1] + 160, point[2] + 40);
      e.controls.target.set(...point);
      e.controls.update();
      e.camera.lookAt(e.controls.target);
      e.camera.updateMatrixWorld();
      const p = e.camera.position
          .clone()
          .set(...point)
          .project(e.camera),
        rect = e.renderer.domElement.getBoundingClientRect();
      e.rocket.pick(
        rect.left + ((p.x + 1) * rect.width) / 2,
        rect.top + ((1 - p.y) * rect.height) / 2,
        true,
      );
      return {
        point,
        snapshot: e.rocket.snapshot,
        origin: e.rocket.state?.origin,
      };
    });
    report.scenarios.seaPick = sea;
    log('seaPick', sea);
    await page.waitForFunction(() => window.__atlas.rocket.loaded, null, {
      timeout: 90000,
    });
    report.scenarios.seaSinking = await advance(5);
    log('seaSinking', report.scenarios.seaSinking.snapshot);

    // The loaded city has sea/lake surfaces; river support is exercised through
    // the public world-coordinate entry, without adding synthetic geography.
    await start('small', sea.point, {
      kind: 'river',
      groundY: sea.point[1] - 20,
    });
    report.scenarios.riverSinking = await advance(5);
    log('riverSinking', report.scenarios.riverSinking.snapshot);

    const lake = await page.evaluate(() => {
      const e = window.__atlas,
        surface = e.waterWorld.surfaces.find(
          (s) => s.kind === 'lake' && s.polygon?.[0]?.length > 5,
        );
      if (!surface) return null;
      const ring = surface.polygon[0],
        x = ring.reduce((s, p) => s + p[0], 0) / ring.length,
        z = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      return {
        name: surface.name,
        position: [x, surface.level + 0.45, z],
        level: surface.level,
      };
    });
    if (lake) {
      await start('large', lake.position, {
        kind: 'lake',
        groundY: lake.level - 20,
        seed: 7,
      });
      await launch();
      report.scenarios.lakeUnstable = {
        lake,
        result: await advance(35, ['crashed', 'space']),
      };
      log('lakeUnstable', report.scenarios.lakeUnstable.result.snapshot);
    }
  }

  // Find an actual clear launch position beside measured low buildings and
  // trees, rather than injecting targets or forcing any damage counters.
  const site = resume
    ? report.scenarios.cityBlastSite
    : await page.evaluate(() => {
        const e = window.__atlas,
          world = e.rocket.world;
        const parts = e.data.rocketBuildingParts.filter(
          (p) => p.maxY - p.minY < 14 && Math.hypot(...p.center) < 2600,
        );
        const trees = [...e.detailedTrees.trees]
          .filter((t) => Math.hypot(t.x, t.z) < 2600)
          .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
        let best;
        for (const tree of trees.slice(0, 1800))
          for (const radius of [14, 20, 28])
            for (let i = 0; i < 8; i++) {
              const a = (i * Math.PI) / 4,
                x = tree.x + Math.cos(a) * radius,
                z = tree.z + Math.sin(a) * radius;
              if (!e.onLand(x, z) || e.waterWorld.at(x, z)) continue;
              const y = e.elevation(x, z),
                nearby = parts.filter(
                  (p) => Math.hypot(p.center[0] - x, p.center[1] - z) < 68,
                );
              if (!nearby.length) continue;
              const base = e.camera.position.clone().set(x, y + 4, z),
                tip = e.camera.position.clone().set(x, y + 48, z);
              if (world.hit(base, tip, 4.6)) continue;
              const buildingDistance = Math.min(
                ...nearby.map((p) =>
                  Math.hypot(p.center[0] - x, p.center[1] - z),
                ),
              );
              const score =
                buildingDistance + radius * 0.5 + Math.hypot(x, z) * 0.003;
              if (!best || score < best.score)
                best = {
                  position: [x, y + 0.45, z],
                  groundY: y,
                  score,
                  nearby: nearby.length,
                  buildingDistance,
                  treeDistance: radius,
                };
            }
        return best;
      });
  if (!site) throw new Error('No clear city blast-site candidate');
  report.scenarios.cityBlastSite = site;
  log('cityBlastSite', site);
  await start('large', site.position, {
    kind: 'platform',
    groundY: site.groundY,
    strength: 1,
  });
  await launch();
  const city = await advance(10, ['crashed', 'space']);
  report.scenarios.cityDamage = city;
  log('cityDamage', city.snapshot);
  await screenshot('integrated-city-blast-effects.png');
  report.scenarios.largeStaging = await page.evaluate(async () => {
    const r = window.__atlas.rocket;
    for (
      let i = 0;
      i < 50 * 60 && r.state.boosterAttached && r.state.phase === 'flight';
      i++
    ) {
      r.update(1 / 60);
      if (i % 120 === 119)
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { snapshot: r.snapshot, state: r.state };
  });
  await advance(0.3);
  await screenshot('integrated-stage-separation.png');
  report.scenarios.largeSuccess = await advance(90, ['space', 'crashed']);
  log('largeSuccess', report.scenarios.largeSuccess.snapshot);
  await page
    .getByRole('region', { name: 'Space observation', exact: true })
    .waitFor();
  await screenshot('integrated-upper-stage-space.png');
  const returnState = await page.evaluate(() => {
    const e = window.__atlas;
    e.rocket.returnToCity();
    return {
      mode: e.settings.mode,
      controls: e.controls.enabled,
      snapshot: e.rocket.snapshot,
    };
  });
  report.scenarios.returnRestoration = returnState;

  // Manual steering then a bounded physical autopilot recovery, all the way
  // from construction through ignition and the 100 km completion threshold.
  await start('small', site.position, {
    kind: 'platform',
    groundY: site.groundY,
    strength: 1,
  });
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  await launch();
  await advance(
    ROCKET_CONFIGS.small.countdownDuration +
      ROCKET_CONFIGS.small.ignitionDuration +
      6.5,
  );
  const beforeManual = await snapshot();
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  const afterManual = await advance(0.5);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  const camera = await page.evaluate(() => {
    const r = window.__atlas.rocket,
      before = {
        fuel: r.state.fuel,
        phase: r.state.phase,
        altitude: r.state.altitude,
      };
    r.setView('first');
    r.update(1 / 60);
    const first = r.snapshot.view;
    r.setView('chase');
    r.update(1 / 60);
    return {
      before,
      first,
      after: {
        fuel: r.state.fuel,
        phase: r.state.phase,
        altitude: r.state.altitude,
        view: r.snapshot.view,
      },
    };
  });
  await page.evaluate(() => window.__atlas.rocket.setAuto(true));
  const success = await advance(180, ['space', 'crashed']);
  report.scenarios.smallManualRecovery = {
    before: beforeManual,
    afterInput: afterManual,
    camera,
    result: success,
  };
  log('smallManualRecovery', success.snapshot);
  if (success.snapshot.phase === 'space') {
    await page
      .getByRole('region', { name: 'Space observation', exact: true })
      .waitFor();
    report.scenarios.celestialFocus = {};
    for (const body of ['sun', 'moon']) {
      await page.locator(`[data-rocket-focus="${body}"]`).click();
      await advance(3);
      report.scenarios.celestialFocus[body] = await page.evaluate((body) => {
        const r = window.__atlas.rocket,
          camera = r.space.camera;
        camera.updateMatrixWorld();
        const focus = r.space.getCelestialFocus(body);
        const screen = focus.target.clone().project(camera);
        return {
          focus: r.snapshot.spaceFocus,
          vehicleVisible: r.model.group.visible,
          fov: camera.fov,
          screen: screen.toArray(),
          angularDiameter: focus.angularDiameterDegrees,
        };
      }, body);
      await screenshot(`integrated-${body}-observation.png`);
    }
    await page.locator('[data-rocket-focus="rocket"]').click();
    await advance(2);
    await page.evaluate(() => window.__atlas.rocket.setView('first'));
    await page.mouse.move(790, 220);
    await page.mouse.down();
    await page.mouse.move(790, 920, { steps: 18 });
    await page.mouse.up();
    await page.evaluate(() => window.__atlas.rocket.update(1 / 60));
    report.scenarios.firstPersonEarthLook = await page.evaluate(() => {
      const r = window.__atlas.rocket,
        e = window.__atlas;
      const direction = r.space.camera.getWorldDirection(
        e.camera.position.clone(),
      );
      return {
        view: r.snapshot.view,
        phase: r.snapshot.phase,
        lookPitch: r.lookPitch,
        direction: direction.toArray(),
        cabinParentIsSpaceCamera: r.cabin.parent === r.space.camera,
        cabinScale: r.cabin.scale.x,
        cameraNear: r.space.camera.near,
      };
    });
    await screenshot('integrated-first-person-earth-look.png');
  }
  report.scenarios.finalReturn = await page.evaluate(() => {
    const e = window.__atlas;
    e.rocket.returnToCity();
    return {
      mode: e.settings.mode,
      controlsEnabled: e.controls.enabled,
      active: e.rocket.active,
      effectsRemoved:
        e.rocket.snapshot.damaged === 0 && e.rocket.snapshot.burning === 0,
    };
  });
  report.checks = {
    actualRoofClassification: roof.picked.support.startsWith('roof-'),
    roofAltitudeMatchesMeasuredBuilding:
      Math.abs(roof.origin.y - roof.candidate.top) < 6,
    largeRoofSupportCollapsed: roofFailure.state.supportCollapsed,
    largeRoofActuallyDamaged:
      roofFailure.snapshot.damaged > 0 && roofFailure.snapshot.debris > 0,
    largeRoofCrash: roofFailure.snapshot.phase === 'crashed',
    actualSeaClassification:
      report.scenarios.seaPick.snapshot.support === 'ocean' &&
      report.scenarios.seaPick.snapshot.phase === 'sinking',
    seaSinks:
      report.scenarios.seaSinking.state.position.y <
      report.scenarios.seaPick.origin.y - 4,
    riverSinks: report.scenarios.riverSinking.snapshot.phase === 'sinking',
    lakeUnstable:
      !!report.scenarios.lakeUnstable?.result.state.supportCollapsed,
    nearbyBuildingsDamaged: city.snapshot.damaged > 0,
    nearbyTreesBurning: city.snapshot.burning > 0,
    nearbyObjectsBecomeDebris: city.snapshot.debris > 0,
    manualSteers:
      Math.abs(
        afterManual.state.attitude.roll - beforeManual.state.attitude.roll,
      ) > 0.01,
    cameraDoesNotResetMission:
      camera.before.phase === camera.after.phase &&
      camera.after.fuel < camera.before.fuel &&
      camera.after.altitude >= camera.before.altitude,
    smallManualToAutoReachesSpace:
      success.snapshot.phase === 'space' && success.snapshot.altitude >= 100000,
    bothRocketsReachSpaceInHalfTheTime:
      report.scenarios.largeSuccess.snapshot.phase === 'space' &&
      report.scenarios.largeSuccess.state.flightElapsed > 55 &&
      report.scenarios.largeSuccess.state.flightElapsed < 75 &&
      success.state.flightElapsed > 55 &&
      success.state.flightElapsed < 75,
    boosterSeparatesAfterBurnout:
      report.scenarios.largeStaging.state.stage === 'separating' &&
      !report.scenarios.largeStaging.state.boosterAttached &&
      report.scenarios.largeStaging.state.boosterFuel === 0 &&
      success.state.events.some((event) => event.type === 'upper-ignition'),
    sunAndMoonCanBeFound: ['sun', 'moon'].every(
      (body) =>
        report.scenarios.celestialFocus?.[body]?.focus === body &&
        !report.scenarios.celestialFocus[body].vehicleVisible &&
        Math.abs(report.scenarios.celestialFocus[body].screen[0]) < 0.02 &&
        Math.abs(report.scenarios.celestialFocus[body].screen[1]) < 0.02,
    ),
    firstPersonCanLookDownToEarth:
      report.scenarios.firstPersonEarthLook?.direction[1] < -0.5 &&
      report.scenarios.firstPersonEarthLook?.cabinParentIsSpaceCamera,
    finalCityRestored:
      report.scenarios.finalReturn.mode === 'orbit' &&
      report.scenarios.finalReturn.controlsEnabled &&
      report.scenarios.finalReturn.effectsRemoved,
    noUncaughtErrors: report.pageErrors.length === 0,
  };
} catch (error) {
  report.failure = String(error);
  console.error(error);
  report.last = await snapshot().catch(() => null);
  await screenshot('integrated-qa-failure.png').catch(() => {});
} finally {
  report.completedAt = new Date().toISOString();
  log('checks', report.checks ?? report.failure);
  await browser.close();
  // Copy evidence only after closing the browser, so the development watcher
  // cannot reload the engine while it is being tested.
  if (
    !report.failure &&
    report.pageErrors.length === 0 &&
    Object.values(report.checks ?? {}).every(Boolean)
  ) {
    await fs.mkdir(evidence, { recursive: true });
    for (const path of report.screenshots) {
      const name = path.split('/').at(-1);
      await fs.copyFile(tempEvidence + name, evidence + name);
    }
  }
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
}
if (
  report.failure ||
  Object.values(report.checks ?? {}).some((check) => !check)
)
  process.exitCode = 1;
