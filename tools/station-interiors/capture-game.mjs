/** Browser evidence from the complete running city, including its real avatar.
 * The inspect-only placements select existing supported floors; they do not
 * claim to prove an uninterrupted player walk between the captured viewpoints.
 */
import { chromium } from 'playwright';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { launchOptionsForProfile } from '../hosted-browser-qa.mjs';

// The canvas is the subject of this evidence. A stalled remote UI font must
// not prevent a screenshot of an already rendered city.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

const stationId = process.argv[2] ?? 'waterfront';
if (!['waterfront', 'burrard', 'granville'].includes(stationId))
  throw new Error(
    'Choose waterfront, burrard or granville as the station argument',
  );
const origin = process.env.STATION_GAME_URL ?? 'http://127.0.0.1:3200/?inspect',
  output = resolve('docs/qa/station-interiors-20261023'),
  debugOutput = resolve('.cache/station-interior-debug'),
  errors = [],
  responses = [],
  warnings = [],
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
page.on('pageerror', (error) => {
  const message = String(error.stack ?? error).slice(0, 2000);
  errors.push(message);
  console.error(message);
});
page.on('response', (response) => {
  if (response.status() >= 400) {
    const item = { url: response.url(), status: response.status() };
    responses.push(item);
    console.error(JSON.stringify(item));
  }
});
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error')
    warnings.push(message.text().slice(0, 1000));
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
  runtimePacket,
};
async function snapshot(label) {
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const engine = window.__atlas,
      travel = engine.skyTrainTravel,
      owner = travel.owner,
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
      render: engine.renderer.info.render,
    };
  });
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
    nav.position.fromArray(entry.inward);
    nav.yaw = owner.yaw;
    nav.pitch = 0;
    nav.cameraDistances.walk = 4;
    nav.snapCamera = true;
    return {
      ready: travel.ready,
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
  const entered = await page.evaluate(async (stationId) => {
    const travel = window.__atlas.skyTrainTravel;
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
      ? 'heritage-thirdperson'
      : 'entrance-thirdperson',
  );
  if (stationId === 'waterfront') {
    for (const [line, label] of [
      ['expo', 'expo'],
      ['canada', 'canada'],
    ]) {
      await page.evaluate(
        ({ line }) => {
          const travel = window.__atlas.skyTrainTravel,
            owner = travel.owner,
            platform = owner.geometryData.platforms.find(
              (item) => item.line === line,
            );
          travel.clearInput();
          travel.foot = owner.boardingPoint(line, platform.direction);
          travel.line = line;
          travel.direction = platform.direction;
          travel.level = 'platform';
          travel.yaw = travel.foot.yaw + Math.PI / 2;
          travel.lookYaw = 0;
          travel.pitch = -0.22;
          travel.distanceView = 4;
          travel.updateCamera();
        },
        { line },
      );
      await snapshot(`${label}-platform-thirdperson`);
      if (line === 'canada') {
        await page.evaluate(() => {
          const travel = window.__atlas.skyTrainTravel;
          travel.distanceView = 10;
          travel.pitch = -0.75;
          travel.updateCamera();
        });
        await snapshot('canada-overhead-thirdperson');
      }
      await page.evaluate(() => {
        const travel = window.__atlas.skyTrainTravel;
        travel.distanceView = 0;
        travel.pitch = 0.1;
        travel.updateCamera();
      });
      await snapshot(`${label}-platform-firstperson`);
      const stair = await page.evaluate(
        ({ line }) => {
          const travel = window.__atlas.skyTrainTravel,
            owner = travel.owner,
            connection = owner.geometryData.connections.find(
              (item) =>
                (item.type === 'stairs' || item.type === 'escalator') &&
                item.id.includes(line) &&
                item.treads.length,
            ),
            index = Math.floor(connection.treads.length / 2),
            tread = connection.treads[index],
            point = tread.vertices.reduce(
              (sum, vertex) =>
                sum.map(
                  (value, axis) => value + vertex[axis] / tread.vertices.length,
                ),
              [0, 0, 0],
            );
          const foot = owner.floorAt(point, `${connection.id}:step:${index}`);
          if (!foot || !owner.isClearFoot(foot))
            throw new Error(
              `Stair capture has no clear supported foot: ${connection.id}`,
            );
          travel.foot = foot;
          travel.yaw = Math.atan2(
            connection.end[0] - connection.start[0],
            connection.end[2] - connection.start[2],
          );
          travel.lookYaw = 0;
          travel.pitch = -0.18;
          travel.distanceView = 0;
          travel.updateCamera();
          return connection.id;
        },
        { line },
      );
      await snapshot(`${label}-stairs-firstperson`);
      captures.at(-1).connection = stair;
      if (line === 'expo') {
        report.expoStairRayHits = await page.evaluate(() => {
          const engine = window.__atlas,
            owner = engine.skyTrainTravel.owner,
            ray = new engine.placement.raycaster.constructor(),
            publicSite = engine.interiors.sites.find(
              (site) => site.id === 'waterfront',
            ),
            ancestor = (object, target) => {
              for (let current = object; current; current = current.parent)
                if (current === target) return true;
              return false;
            },
            visible = (object) => {
              for (let current = object; current; current = current.parent)
                if (!current.visible) return false;
              return true;
            };
          engine.scene.updateMatrixWorld(true);
          engine.camera.updateMatrixWorld(true);
          return [
            [0, 0],
            [0, 0.35],
            [0, -0.35],
            [-0.3, 0.15],
            [0.3, 0.15],
          ].map(([x, y]) => {
            ray.setFromCamera({ x, y }, engine.camera);
            ray.far = 25;
            const describe = (hit) => ({
              distance: hit.distance,
              point: hit.point.toArray(),
              local: owner.toLocal(hit.point.toArray()),
              mesh: hit.object.name,
              uuid: hit.object.uuid,
              instanceId: hit.instanceId,
              part: hit.object.userData.stationPartIds?.[hit.instanceId],
              role: hit.object.userData.stationPartRoles?.[hit.instanceId],
              owner: ancestor(hit.object, owner.group),
              publicWaterfront:
                ancestor(hit.object, publicSite?.group) ||
                ancestor(hit.object, publicSite?.envelope),
              ancestors: (() => {
                const result = [];
                for (let object = hit.object; object; object = object.parent)
                  result.push(object.name || object.type);
                return result;
              })(),
            });
            return {
              ndc: [x, y],
              fullScene: ray
                .intersectObject(engine.scene, true)
                .filter((hit) => visible(hit.object))
                .slice(0, 8)
                .map(describe),
              ownerOnly: ray
                .intersectObject(owner.group, true)
                .filter((hit) => visible(hit.object))
                .slice(0, 8)
                .map(describe),
            };
          });
        });
        await page.evaluate(() => {
          const engine = window.__atlas,
            owner = engine.skyTrainTravel.owner,
            walker = engine.navigation.walker.group,
            inside = (object, target) => {
              for (let parent = object; parent; parent = parent.parent)
                if (parent === target) return true;
              return false;
            };
          window.__stationCaptureHidden = [];
          engine.scene.traverse((object) => {
            if (
              object.isMesh &&
              !inside(object, owner.group) &&
              !inside(object, walker)
            ) {
              window.__stationCaptureHidden.push([object, object.visible]);
              object.visible = false;
            }
          });
        });
        await snapshot('expo-stairs-owner-only');
        await page.evaluate(() => {
          for (const [object, visible] of window.__stationCaptureHidden)
            object.visible = visible;
          delete window.__stationCaptureHidden;
          const travel = window.__atlas.skyTrainTravel,
            connection = travel.owner.geometryData.connections.find(
              (item) => item.id === travel.foot.surfaceId.split(':step:')[0],
            );
          travel.pitch = Math.atan2(
            connection.end[1] - connection.start[1],
            Math.hypot(
              connection.end[0] - connection.start[0],
              connection.end[2] - connection.start[2],
            ),
          );
          travel.updateCamera();
        });
        await snapshot('expo-stairs-look-down');
      }
    }
  } else {
    await captureDunsmuirStation();
  }
  await page.evaluate(() => window.__atlas.skyTrainTravel.setOverview(true));
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
    !report.final?.contextLost &&
    captures.length >= 10 &&
    captures
      .filter((capture) => capture.cameraView === 'third-person')
      .every(
        (capture) =>
          capture.avatar.visible &&
          capture.avatar.assetState === 'ready' &&
          capture.avatar.skinnedMeshes > 0,
      );
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
