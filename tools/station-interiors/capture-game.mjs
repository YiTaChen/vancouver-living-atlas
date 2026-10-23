/** Browser evidence from the complete running city, including its real avatar.
 * The inspect-only placements select existing supported floors; they do not
 * claim to prove an uninterrupted player walk between the captured viewpoints.
 */
import { chromium } from 'playwright';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { launchOptionsForProfile } from '../hosted-browser-qa.mjs';
import { captureDunsmuirStation } from './capture-dunsmuir-views.mjs';
import { captureSoutheastStation } from './capture-southeast-views.mjs';
import { captureWaterfrontStation } from './capture-waterfront-views.mjs';
import { prepareStationOverviewViewpoint } from './capture-overview-view.mjs';

// The canvas is the subject of this evidence. A stalled remote UI font must
// not prevent a screenshot of an already rendered city.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

const stationId = process.argv[2] ?? 'waterfront';
if (
  ![
    'waterfront',
    'burrard',
    'granville',
    'stadium-chinatown',
    'yaletown-roundhouse',
  ].includes(stationId)
)
  throw new Error(
    'Choose waterfront, burrard, granville, stadium-chinatown or yaletown-roundhouse',
  );
const origin = process.env.STATION_GAME_URL ?? 'http://127.0.0.1:3200/?inspect',
  output = resolve(
    process.env.STATION_GAME_OUTPUT ?? 'docs/qa/station-interiors-20261023',
  ),
  debugOutput = resolve('.cache/station-interior-debug'),
  errors = [],
  responses = [],
  warnings = [],
  consoleMessages = [],
  captures = [];
const packetUrl = new URL(
    `/models/skytrain-stations/${stationId}.json`,
    origin,
  ),
  packetResponse = await fetch(packetUrl),
  packetBytes = Buffer.from(await packetResponse.arrayBuffer()),
  packet = JSON.parse(packetBytes.toString());
if (!packetResponse.ok)
  throw new Error(`Runtime packet fetch failed: ${packetResponse.status}`);
const runtimePacket = {
  url: packetUrl.href,
  bytes: packetBytes.length,
  sha256: createHash('sha256').update(packetBytes).digest('hex'),
  sourceSha256: packet.source.sha256,
};
await mkdir(output, { recursive: true });
await mkdir(debugOutput, { recursive: true });
const browser = await chromium.launch({
    ...launchOptionsForProfile(),
    headless: true,
  }),
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
const network = await page.context().newCDPSession(page);
await network.send('Network.enable');
const failedResponse = (url, status) => {
  if (!responses.some((item) => item.url === url && item.status === status)) {
    const item = { url, status };
    responses.push(item);
    console.error(JSON.stringify(item));
  }
};
// Chromium's automatic favicon request is absent from Playwright's page
// response events. Include the browser network stream in the HTTP gate.
network.on('Network.responseReceived', ({ response }) => {
  if (response.status >= 400) failedResponse(response.url, response.status);
});
page.on('pageerror', (error) => {
  const message = String(error.stack ?? error).slice(0, 2000);
  errors.push(message);
  console.error(message);
});
page.on('response', (response) => {
  if (response.status() >= 400) {
    failedResponse(response.url(), response.status());
  }
});
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') {
    warnings.push(message.text().slice(0, 1000));
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1000),
      location: message.location(),
    });
  }
});
const report = {
  stationId,
  url: origin,
  capturedAt: new Date().toISOString(),
  placements:
    'Inspect-only supported-floor placements; separate route tests verify circulation.',
  captures,
  errors,
  responses,
  warnings,
  consoleMessages,
  runtimePacket,
};
async function snapshot(label) {
  await page.waitForTimeout(1200);
  const data = await page.evaluate((stationId) => {
    const engine = window.__atlas,
      travel = engine.skyTrainTravel,
      owner = travel.owner ?? travel.stations.get(stationId),
      walker = engine.navigation.walker;
    let meshes = 0,
      skinnedMeshes = 0;
    walker.group.traverse((object) => {
      if (object.isMesh) meshes++;
      if (object.isSkinnedMesh) skinnedMeshes++;
    });
    return {
      snapshot: travel.snapshot(),
      foot: travel.foot,
      camera: engine.camera.position.toArray(),
      cutaway: owner?.group.userData.stationCutaway ?? false,
      authoredSource: owner?.data.authoredInterior?.revision,
      sourceSha256: owner?.data.source.sha256,
      authoredGeometry: owner?.geometryData.authoredInterior?.revision,
      openWorld: owner?.openWorld,
      geometryParts: owner?.geometryData.parts.length,
      mode: engine.settings.mode,
      cameraView:
        engine.settings.mode === 'orbit'
          ? 'orbit'
          : engine.renderer.domElement.getAttribute('data-camera-view'),
      avatar: {
        visible: walker.group.visible,
        assetState: walker.group.userData.assetState,
        assetVariant: walker.group.userData.assetVariant,
        meshes,
        skinnedMeshes,
        position: walker.group.position.toArray(),
      },
      occlusion: engine.travelOcclusion?.snapshot(),
      render: engine.renderer.info.render,
    };
  }, stationId);
  const file = `game-${stationId}-${label}.png`;
  const diagnostic = label.includes('owner-only');
  await page.screenshot({
    path: resolve(debugOutput, file),
  });
  if (!diagnostic) captures.push({ label, file, ...data });
  console.log(
    `Captured ${file}: ${data.cameraView}, avatar ${data.avatar.visible}, authored ${data.authoredGeometry}`,
  );
}
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
  let reloads = 0;
  report.startup = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await page.evaluate(
      (stationId) => ({
        ready: Boolean(
          window.__atlas?.skyTrainTravel?.ready &&
          window.__atlas.skyTrainTravel.stations.get(stationId),
        ),
        engine: !!window.__atlas,
        body: document.body.innerText.slice(-1200),
      }),
      stationId,
    );
    if (status.ready) break;
    report.startup.push(status);
    console.log(`City loading ${attempt + 1}/30 ${JSON.stringify(status)}`);
    if (attempt === 1)
      await page
        .screenshot({
          path: resolve(debugOutput, `game-${stationId}-loading.png`),
          timeout: 5000,
        })
        .catch(() => {});
    if (
      reloads < 2 &&
      (errors.some((message) =>
        message.includes('dynamically imported module'),
      ) ||
        responses.some((response) => response.status === 504))
    ) {
      report.bootstrapReloads ??= [];
      report.bootstrapReloads.push({
        errors: errors.splice(0),
        responses: responses.splice(0),
      });
      reloads++;
      console.log(
        `Reloading after Vite optimizer bootstrap error (${reloads}/2)`,
      );
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForTimeout(5000);
  }
  // __atlas is exposed just before React's onReady callback commits its initial
  // Orbit settings. Let that commit finish before selecting a travel mode.
  await page
    .locator('.loading-overlay')
    .waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForTimeout(300);
  report.initial = await page.evaluate((stationId) => {
    const engine = window.__atlas;
    if (!engine) throw new Error('City inspect engine did not load');
    const travel = engine.skyTrainTravel,
      owner = travel.stations.get(stationId);
    if (!owner)
      throw new Error(`${stationId} owner unavailable: ${travel.error}`);
    if (!owner.geometryData.authoredInterior)
      throw new Error(`${stationId} has no restored authored interior`);
    const entries = owner.streetEntrances();
    engine.applySettings({
      ...engine.settings,
      mode: 'walk',
      autoRotate: false,
      qualityMode: 'manual',
      quality: 'balanced',
    });
    engine.onTravelResume('walk');
    engine.setClock({ hour: 12, running: false });
    const nav = engine.navigation,
      entry = entries.find((item) => item.id === 'cordova-lobby') ?? entries[0];
    nav.blur();
    nav.mode = 'walk';
    nav.surface = 'ground';
    nav.position.fromArray(entry.outward);
    const direction = new nav.position.constructor(
      ...entry.localDirection,
    ).applyQuaternion(owner.group.quaternion);
    nav.yaw = Math.atan2(direction.x, direction.z);
    nav.pitch = 0;
    nav.cameraDistances.walk = 4;
    nav.snapCamera = true;
    return {
      ready: travel.ready,
      authorityCheckpoint: {
        installed: engine.interiors?.waterfrontAuthority?.installed ?? null,
        legacyHallVisible:
          engine.interiors?.sites.find((site) => site.id === 'waterfront')
            ?.legacyHall?.visible ?? null,
        prepareOwner: typeof travel.stations.options.prepareOwner,
      },
      stationCount: travel.stations.owners.length,
      fleetCount: travel.fleet.length,
      worldPaths: travel.worldPaths.size,
      entries,
      sourceRevision: owner.data.authoredInterior?.revision,
      geometryRevision: owner.geometryData.authoredInterior?.revision,
      sourceFloors: owner.data.floors.length,
      geometryFloors: owner.geometryData.floors.length,
      entryCandidate: owner.tryEnterFromStreet([
        nav.position.x,
        nav.walkingHeight(),
        nav.position.z,
      ]),
      entryDiagnostics: {
        navPosition: nav.position.toArray(),
        walkingHeight: nav.walkingHeight(),
        floorAtInward: owner.floorAt(
          owner.toLocal(entry.inward),
          entry.surfaceId,
        ),
        clearAtInward: (() => {
          const point = owner.floorAt(
            owner.toLocal(entry.inward),
            entry.surfaceId,
          );
          return point && owner.isClearFoot(point);
        })(),
        localStreetFoot: owner.toLocal([
          nav.position.x,
          nav.walkingHeight(),
          nav.position.z,
        ]),
        apron: owner.geometryData.floors.find(
          (floor) => floor.id === entry.surfaceId,
        ),
      },
      error: travel.error,
    };
  }, stationId);
  console.log(
    'Runtime authority: ' + JSON.stringify(report.initial.authorityCheckpoint),
  );
  await page.waitForFunction(
    () =>
      window.__atlas?.settings.mode === 'walk' &&
      [...document.querySelectorAll('.mode-pill.active')].some(
        (item) => item.textContent.trim() === 'Walk',
      ),
    undefined,
    { timeout: 15000 },
  );
  const entered = await page.evaluate(async (stationId) => {
    const travel = window.__atlas.skyTrainTravel;
    const nav = window.__atlas.navigation;
    // Start on the public street and walk across the real height transition.
    // Placing the city controller on a lower inner landing bypasses that slope.
    nav.setTouchAxes(0, 1);
    for (let step = 0; step < 100 && !travel.active; step++) {
      nav.update(0.05);
      travel.update(0.05);
    }
    nav.blur();
    travel.clearInput();
    return travel.active || (await travel.enter(stationId));
  }, stationId);
  report.enteredByStreet = entered;
  if (!entered) {
    report.entryFailure =
      'The geographic entrance refused entry. Interior captures use an explicit inspect-only supported-floor placement.';
    console.error(report.entryFailure);
    await page.evaluate((stationId) => {
      const engine = window.__atlas,
        travel = engine.skyTrainTravel,
        owner = travel.stations.get(stationId),
        floor = owner.floors.find(
          (item) =>
            item.id ===
            {
              waterfront: 'waterfront-heritage-hall',
              burrard: 'burrard-ticket-atrium',
              granville: 'granville-original-ticket-hall',
              'stadium-chinatown': 'stadium-main-concourse',
              'yaletown-roundhouse': 'yaletown-unpaid-concourse',
            }[stationId],
        );
      let foot = null;
      for (let index = 0; index < floor.indices.length; index += 3) {
        const vertices = floor.indices
            .slice(index, index + 3)
            .map((i) => floor.vertices[i]),
          point = vertices.reduce(
            (sum, v) => sum.map((value, axis) => value + v[axis] / 3),
            [0, 0, 0],
          ),
          candidate = owner.floorAt(point, floor.id);
        if (candidate && owner.isClearFoot(candidate)) {
          foot = candidate;
          break;
        }
      }
      if (!foot)
        throw new Error(
          'No clear authored hall floor for the independent visual capture',
        );
      travel.owner = owner;
      travel.station = stationId;
      travel.phase = 'station';
      travel.foot = foot;
      travel.level = 'concourse';
      travel.line = 'expo';
      travel.direction = 'eastbound';
      travel.yaw = 0;
      travel.lookYaw = 0;
      engine.navigation.mode = 'orbit';
    }, stationId);
  }
  await page.evaluate(() => {
    const travel = window.__atlas.skyTrainTravel;
    travel.distanceView = 4;
    travel.pitch = -0.18;
    travel.updateCamera();
  });
  await page.waitForFunction(
    () => {
      const state = window.__atlas.navigation.walker.group.userData.assetState;
      return (
        state === undefined || state === 'ready' || state === 'fallback-error'
      );
    },
    undefined,
    { timeout: 45000 },
  );
  await snapshot(
    stationId === 'waterfront'
      ? 'initial-street-handoff-thirdperson'
      : 'entrance-thirdperson',
  );
  if (stationId === 'waterfront') {
    await captureWaterfrontStation(page, snapshot, report, stationId);
  } else if (stationId === 'burrard' || stationId === 'granville') {
    await captureDunsmuirStation(page, snapshot, report, stationId);
  } else {
    await captureSoutheastStation(page, snapshot, report, stationId);
  }
  report.overviewViewpoint = await page.evaluate(prepareStationOverviewViewpoint);
  await page.evaluate(() => window.__atlas.skyTrainTravel.setOverview(true));
  await page.evaluate(() => {
    const engine = window.__atlas,
      travel = engine.skyTrainTravel,
      origin = travel.interactionOrigin;
    if (!origin || !travel.foot)
      throw new Error('Missing occupied cutaway level');
    // Zoom the normal local-map orbit to the occupied interior. The launcher
    // starts at city scale, beyond the public building's cutaway distance.
    engine.controls.target.set(...origin);
    engine.camera.position.set(origin[0] + 55, origin[1] + 85, origin[2] + 65);
    engine.controls.update();
    travel.owner.updateCutaway(engine.camera.position, travel.foot.position[1]);
  });
  await snapshot('overview-cutaway');
  report.final = await page.evaluate(() => ({
    snapshot: window.__atlas.skyTrainTravel.snapshot(),
    contextLost: window.__atlas.renderer.getContext().isContextLost(),
    stationOwners: window.__atlas.skyTrainTravel.stations.owners.map(
      (owner) => ({
        id: owner.data.id,
        authored: owner.geometryData.authoredInterior?.revision,
        parts: owner.geometryData.parts.length,
      }),
    ),
  }));
  const finalBytes = Buffer.from(await (await fetch(packetUrl)).arrayBuffer());
  report.runtimePacket.verifiedAfterCapture = createHash('sha256')
    .update(finalBytes)
    .digest('hex');
  if (
    report.runtimePacket.verifiedAfterCapture !== report.runtimePacket.sha256 ||
    captures.some(
      (capture) => capture.sourceSha256 !== runtimePacket.sourceSha256,
    )
  )
    throw new Error('Runtime station packet changed during capture');
} catch (error) {
  report.failure = String(error.stack ?? error);
  report.failurePage = await page
    .evaluate(() => ({
      body: document.body.innerText.slice(-3000),
      engine: !!window.__atlas,
    }))
    .catch(() => null);
  await page
    .screenshot({ path: resolve(debugOutput, `game-${stationId}-failure.png`) })
    .catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.warnings = [...new Set(warnings)].slice(0, 40);
  await writeFile(
    resolve(debugOutput, `game-${stationId}-browser-debug.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  report.debugReport = `.cache/station-interior-debug/game-${stationId}-browser-debug.json`;
  if (report.startup)
    report.startup = report.startup.map(({ ready, engine, body }) => ({
      ready,
      engine,
      progress: body.match(/(\d+)%/)?.[1],
    }));
  if (report.initial?.entryDiagnostics) {
    const { walkingHeight, floorAtInward, clearAtInward, localStreetFoot } =
      report.initial.entryDiagnostics;
    report.initial.entryDiagnostics = {
      walkingHeight,
      floorAtInward,
      clearAtInward,
      localStreetFoot,
    };
  }
  if (report.expoStairRayHits)
    report.expoStairRayHits = report.expoStairRayHits.map(
      ({ ndc, fullScene, ownerOnly }) => ({
        ndc,
        fullScene: fullScene
          .slice(0, 3)
          .map(
            ({
              distance,
              local,
              mesh,
              part,
              role,
              owner,
              publicWaterfront,
            }) => ({
              distance,
              local,
              mesh,
              part,
              role,
              owner,
              publicWaterfront,
            }),
          ),
        ownerOnly: ownerOnly
          .slice(0, 2)
          .map(({ distance, local, mesh, part, role }) => ({
            distance,
            local,
            mesh,
            part,
            role,
          })),
      }),
    );
  report.passed =
    !!report.enteredByStreet &&
    !report.failure &&
    errors.length === 0 &&
    responses.length === 0 &&
    !warnings.some((message) =>
      /(?:THREE\.WebGLProgram|shader error|VALIDATE_STATUS|GL_INVALID_OPERATION)/i.test(
        message,
      ),
    ) &&
    !report.final?.contextLost &&
    captures.length >= 10 &&
    (report.entryTransitions?.every((entry) => entry.entered && entry.left) ??
      true) &&
    captures
      .filter((capture) => capture.cameraView === 'third-person')
      .every(
        (capture) =>
          capture.avatar.visible &&
          capture.avatar.assetState === 'ready' &&
          capture.avatar.skinnedMeshes > 0 &&
          capture.occlusion?.shaderFailures === 0,
      );
  report.acceptanceBoundary =
    'passed covers native input, runtime and shader checks. Visible avatar pixels, enclosing architecture and photo correspondence require the separate manual image review.';
  if (report.passed)
    for (const capture of captures)
      await copyFile(
        resolve(debugOutput, capture.file),
        resolve(output, capture.file),
      );
  else process.exitCode = 1;
  await writeFile(
    resolve(
      report.passed ? output : debugOutput,
      `game-${stationId}-browser.json`,
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  await browser.close();
}
