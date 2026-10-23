import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// These are the 20 measured production roadGraph junctions from the broader
// failure diagnosis: 7 tall initial overlaps, 7 distributed obstructions and
// 6 clear controls. Coordinates identify sites, never a synthetic launch pose.
// No flight state, velocity, throttle, damage or outcome is assigned here.
const sites = [
  {
    node: 1998,
    x: 269.7688969385132,
    z: 116.21808000002972,
    names: ['THURLOW ST', 'EIHU LANE'],
    category: 'tall-initial-overlap',
    initialHeights: [63.7, 15.96, 4.69],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 2049,
    x: 396.4699489048762,
    z: -12.245199999931913,
    names: ['THURLOW ST', 'MELVILLE ST'],
    category: 'tall-initial-overlap',
    initialHeights: [102.0, 9.49],
    baselineOutcome: 'crashed',
    baselineFlight: 1.7999999999999985,
  },
  {
    node: 1746,
    x: -74.43478042994892,
    z: -451.25788400000545,
    names: ['NICOLA ST', 'W PENDER ST'],
    category: 'tall-initial-overlap',
    initialHeights: [30.88],
    baselineOutcome: 'crashed',
    baselineFlight: 0.7000000000000005,
  },
  {
    node: 2099,
    x: 473.89635254579673,
    z: -90.72579999953149,
    names: ['500-600 THURLOW ST', 'W PENDER ST'],
    category: 'tall-initial-overlap',
    initialHeights: [31.32],
    baselineOutcome: 'crashed',
    baselineFlight: 2.249999999999997,
  },
  {
    node: 2038,
    x: 381.0616371239753,
    z: -311.9409039997626,
    names: ['W HASTINGS ST', 'BUTE ST'],
    category: 'tall-initial-overlap',
    initialHeights: [10.45, 31.84],
    baselineOutcome: 'crashed',
    baselineFlight: 0.8166666666666675,
  },
  {
    node: 2122,
    x: 514.9658207059964,
    z: -132.3483479994863,
    names: ['EVELEIGH ST', '500-600 THURLOW ST', 'THURLOW ST'],
    category: 'tall-initial-overlap',
    initialHeights: [36.55],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 2141,
    x: 551.3518010715693,
    z: -169.23979599952133,
    names: ['THURLOW ST', 'W PENDER ST'],
    category: 'tall-initial-overlap',
    initialHeights: [36.55],
    baselineOutcome: 'crashed',
    baselineFlight: 1.2000000000000006,
  },
  {
    node: 791,
    x: -951.6992421975933,
    z: -786.8876839997572,
    names: ['LAGOON DRIVE', 'STOVOLD LANE'],
    category: 'distributed-obstructed',
    initialHeights: [9.4],
    baselineOutcome: 'crashed',
    baselineFlight: 0.016666666666666666,
  },
  {
    node: 1434,
    x: -434.9979895801475,
    z: -660.4838240001328,
    names: ['DENMAN ST', 'ALBERNI ST'],
    category: 'distributed-obstructed',
    initialHeights: [6.15],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 2521,
    x: 990.7355683696438,
    z: -31.280920000120886,
    names: ['CANADA PLACE', 'HOWE ST'],
    category: 'distributed-obstructed',
    initialHeights: [27, 24.68],
    baselineOutcome: 'crashed',
    baselineFlight: 1.6333333333333324,
  },
  {
    node: 2595,
    x: 1133.1571646375814,
    z: 395.96524000007776,
    names: ['HOMER ST', 'W PENDER ST'],
    category: 'distributed-obstructed',
    initialHeights: [34.82],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 2360,
    x: 770.996486781303,
    z: 924.4124120004119,
    names: ['SMITHE ST', 'MAINLAND ST'],
    category: 'distributed-obstructed',
    initialHeights: [13.61],
    baselineOutcome: 'crashed',
    baselineFlight: 1.4166666666666665,
  },
  {
    node: 1518,
    x: -316.2842811379927,
    z: 1152.8633159997758,
    names: ['PACIFIC ST', 'HORNBY ST'],
    category: 'distributed-obstructed',
    initialHeights: [4.65],
    baselineOutcome: 'crashed',
    baselineFlight: 0.5166666666666666,
  },
  {
    node: 1325,
    x: -542.7980822788137,
    z: 396.4327840000047,
    names: ['PANTAGES LANE', 'JERVIS ST'],
    category: 'distributed-obstructed',
    initialHeights: [20.95, 11.19],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 1046,
    x: -692.604340696605,
    z: -683.7942319996537,
    names: ['ROSEMARY BROWN LANE', 'GILFORD ST'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 1098,
    x: -654.0182102505976,
    z: -723.0122679999843,
    names: ['ROBSON ST', 'GILFORD ST'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'crashed',
    baselineFlight: 1.1166666666666676,
  },
  {
    node: 2006,
    x: 295.2993513323657,
    z: -453.940695999718,
    names: ['JERVIS ST', 'JERVIS MEWS', 'W CORDOVA ST'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'crashed',
    baselineFlight: 0.016666666666666666,
  },
  {
    node: 2472,
    x: 909.1702685387469,
    z: -238.58102399989008,
    names: ['800-900 CANADA PLACE', 'BURRARD ST', 'CANADA PLACE'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'crashed',
    baselineFlight: 0.016666666666666666,
  },
  {
    node: 2459,
    x: 877.5331269594919,
    z: 372.30974000047894,
    names: ['SEYMOUR ST', 'ST. REGIS LANE'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
  {
    node: 1876,
    x: 94.04007817259442,
    z: 948.6579079997866,
    names: ['DAVIE ST', 'HOWE ST'],
    category: 'distributed-clear',
    initialHeights: [],
    baselineOutcome: 'flight',
    baselineFlight: 8.016666666666644,
  },
];
const representativeNodes = [2049, 1746, 1098, 2472];
const citySources = ['building', 'bridge', 'landmark'];
const quality = process.env.ROCKET_GROUND_CONTACT_QUALITY || 'balanced';
const mode =
  process.env.ROCKET_GROUND_CONTACT_MODE ||
  (quality === 'balanced' ? 'all' : 'representatives');
assert(['balanced', 'high', 'ultra'].includes(quality));
assert(['all', 'broad', 'representatives'].includes(mode));
assert.equal(sites.length, 20);
assert.deepEqual(
  Object.fromEntries(
    ['tall-initial-overlap', 'distributed-obstructed', 'distributed-clear'].map(
      (category) => [
        category,
        sites.filter((site) => site.category === category).length,
      ],
    ),
  ),
  {
    'tall-initial-overlap': 7,
    'distributed-obstructed': 7,
    'distributed-clear': 6,
  },
);
const sourcePaths = [
  'lib/city/rocket-controller.ts',
  'lib/city/rocket-state.ts',
  'lib/city/rocket-effects.ts',
  'lib/city/rocket-snapshot.ts',
  'lib/city/assets/rocket.ts',
  'lib/city/assets/rocket-design.ts',
  'lib/city/assets/rocket-wreckage.ts',
  'lib/city/assets/rocket-exhaust.ts',
  'lib/city/rocket-space.ts',
  'lib/city/rocket-space-shaders.ts',
  'lib/city/building-bodies.ts',
  'lib/city/facade-details.ts',
  'components/rocket-controls.tsx',
  'components/rocket-controls.css',
];
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await fs.readFile(new URL('../' + path, import.meta.url)))
          .digest('hex'),
      ]),
    ),
  );
const temp = `/private/tmp/rocket-ground-contact-${quality}-${Date.now()}/`;
await fs.mkdir(temp, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  quality,
  mode,
  method:
    'Independent headless Chrome Metal; 20 previously diagnosed real roadGraph junctions; fresh rendered ground raycast and original supportAt/start/update(1/60). First eight flight seconds at all 20 sites; four representative complete missions and exact city return. Query/contact observers return original results unchanged; no forced flight state or outcome.',
  sites,
  classificationNote:
    'The historical distributed-clear category means clear of polygon building prisms in the original upright inventory. It does not exclude landmark/bridge triangle meshes or steep terrain; actual initial city contacts and surveyed grade are recorded separately.',
  sourceHashes: await sourceHashes(),
  errors: [],
  consoleErrors: [],
  httpFailures: [],
  failedRequests: [],
  hmr: [],
  missions: [],
  screenshots: [],
  checks: {},
};
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) =>
  report.errors.push(error.stack || String(error)),
);
page.on('console', (message) => {
  if (message.type() === 'error') report.consoleErrors.push(message.text());
  if (/\[vite\].*(?:hot updated|reload)/.test(message.text()))
    report.hmr.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400)
    report.httpFailures.push({
      url: response.url(),
      status: response.status(),
    });
});
page.on('requestfailed', (request) =>
  report.failedRequests.push({
    url: request.url(),
    failure: request.failure(),
  }),
);
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
  await page.evaluate(() => window.__groundRecord(true));
  await page.screenshot({ path: temp + name, quality: 84 });
  report.screenshots.push(name);
}
async function advanceUntil({
  flight,
  phase,
  stage,
  seconds = 180,
  settleWreckage = false,
}) {
  return page.evaluate(
    async ({ flight, phase, stage, seconds, settleWreckage }) => {
      const r = window.__atlas.rocket;
      let previousPhase = r.state.phase,
        previousStage = r.state.stage;
      const started = r.state.elapsed;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        window.__groundStep(1 / 60);
        const s = r.state;
        if (
          i % 12 === 0 ||
          s.phase !== previousPhase ||
          s.stage !== previousStage
        )
          window.__groundRecord();
        previousPhase = s.phase;
        previousStage = s.stage;
        if (
          phase === s.phase ||
          stage === s.stage ||
          (flight !== undefined && s.flightElapsed >= flight)
        )
          break;
        if (
          !settleWreckage &&
          ['crashed', 'sinking', 'space'].includes(s.phase)
        )
          break;
        if (i % (s.flightElapsed < 8 ? 12 : 90) === 0) {
          await new Promise(requestAnimationFrame);
          window.__groundRecord(true);
        }
        if (s.elapsed - started >= seconds) break;
      }
      window.__groundRecord();
      r.onChange(r.snapshot);
      return { state: r.state, snapshot: r.snapshot };
    },
    { flight, phase, stage, seconds, settleWreckage },
  );
}
try {
  await page.goto(
    process.env.ROCKET_QA_URL ||
      `http://127.0.0.1:5173/?inspect${quality === 'balanced' ? '&graphics=compatible' : ''}`,
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () =>
      window.__atlas?.renderReady &&
      window.__atlas.rocket &&
      window.__atlas.data.rocketBuildingParts?.length,
    null,
    { timeout: 120000 },
  );
  await page
    .locator('.rocket-mode-button:not(:disabled)')
    .waitFor({ timeout: 120000 });
  await page.locator('button[aria-controls="layers-panel"]').click();
  await page
    .locator('.quality-options [role="radio"]')
    .nth({ ultra: 1, high: 2, balanced: 3 }[quality])
    .click();
  await page.locator('#layers-panel .settings-title button').click();
  await page.waitForFunction(
    (quality) =>
      window.__atlas.settings.quality === quality &&
      window.__atlas.settings.qualityMode === 'manual',
    quality,
  );
  await settle();
  await page.evaluate(() => {
    const e = window.__atlas,
      r = e.rocket;
    window.__groundStep = r.update.bind(r);
    r.update = () => {};
    e.setClock({ hour: 12, running: false });
    window.__groundHash = () => {
      let hash = 2166136261;
      for (const key of ['position', 'color']) {
        const array =
          e.data.rocketBuildingMesh.geometry.getAttribute(key).array;
        const bits = new Uint32Array(
          array.buffer,
          array.byteOffset,
          array.byteLength / 4,
        );
        for (const value of bits) hash = Math.imul(hash ^ value, 16777619);
      }
      return hash >>> 0;
    };
    window.__groundArrayHash = (array) => {
      let hash = 2166136261;
      const bits = new Uint32Array(
        array.buffer,
        array.byteOffset,
        array.byteLength / 4,
      );
      for (const value of bits) hash = Math.imul(hash ^ value, 16777619);
      return hash >>> 0;
    };
    window.__groundBaseline = window.__groundHash();
    window.__groundSourceVolumes = JSON.stringify(e.data.flightBuildingVolumes);
    // Loading modules is allowed to finish during this discarded construction;
    // the measured launches below always start from their real road surface.
    r.start('super-heavy', 0, e.elevation(0, 0) + 0.45, 0);
  });
  await page.waitForFunction(
    () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
    null,
    { timeout: 90000 },
  );
  assert(
    await page.evaluate(() => window.__atlas.rocket.loaded),
    'production rocket modules load',
  );
  await page.evaluate(() => {
    const e = window.__atlas,
      r = e.rocket,
      query = r.queryContacts.bind(r);
    window.__groundTrace = null;
    r.queryContacts = (sweeps, state) => {
      const results = query(sweeps, state),
        trace = window.__groundTrace;
      if (!trace) return results;
      for (const { volume, contact } of results) {
        if (trace.forces.length >= 4096) {
          trace.forceTraceTruncated = true;
          break;
        }
        const normal = contact.normal,
          velocity = { ...state.velocity },
          surfaceVelocity = contact.surfaceVelocity ?? { x: 0, y: 0, z: 0 };
        const n = normal ? Math.hypot(normal.x, normal.y, normal.z) : 0;
        const expected =
          n > 1e-8
            ? Math.max(
                0,
                -(
                  (velocity.x - surfaceVelocity.x) * normal.x +
                  (velocity.y - surfaceVelocity.y) * normal.y +
                  (velocity.z - surfaceVelocity.z) * normal.z
                ) / n,
              )
            : null;
        trace.forces.push({
          elapsed: state.elapsed,
          flight: state.flightElapsed,
          phase: state.phase,
          stage: state.stage,
          altitude: state.altitude,
          velocity,
          surfaceVelocity,
          speed: state.speed,
          mass: state.mass,
          integrity: state.integrity,
          contactDamage: state.contactDamage,
          supportIntegrity: state.supportIntegrity,
          supportCollapsed: state.supportCollapsed,
          source: contact.source,
          part: contact.part,
          initialOverlap: contact.initialOverlap,
          normal,
          point: contact.point,
          bounds: contact.bounds,
          penetration: contact.penetration,
          normalSpeed: contact.normalSpeed,
          expectedNormalSpeed: expected,
          impactEnergy: contact.impactEnergy,
          force: contact.force,
          obstacleMass: contact.obstacleMass,
          yieldProgress: contact.yieldProgress,
          originalTop: volume
            ? r.contactVolumes.get(volume)?.originalTop
            : null,
          currentTop: volume?.bounds.max.y,
          meshName: volume?.mesh?.name,
          meshType: volume?.mesh?.geometry.type,
          triangleCount: (volume?.triangles?.length || 0) / 9,
          closedMesh: volume?.closed,
          localVolume: !!volume?.local,
          collisionAdopted: volume
            ? r.surfaceGeometry?.get(volume)?.current !==
              r.surfaceGeometry?.get(volume)?.original
            : false,
          collisionCacheAtQuery: r.effects?.collisionCacheStats ?? null,
          renderedOwnerDisplacement: volume?.mesh
            ? (window.__groundLastRenderedSurfaces.get(volume.mesh.name)
                ?.maximumDisplacement ?? 0)
            : 0,
        });
      }
      return results;
    };
    window.__groundRecord = (rendered = false) => {
      const trace = window.__groundTrace,
        s = r.state,
        fx = r.effects;
      if (!trace || !s) return;
      const position = fx?.body?.geometry.getAttribute('position');
      let alteredEntries = 0,
        maximumBodyDisplacement = 0;
      const contactParts = [];
      for (const d of [...(fx?.parts || []), ...(fx?.contactParts || [])]) {
        let maximumDisplacement = 0,
          contactDentDisplacement = 0,
          entries = 0;
        if (d.collapse || d.exposure)
          for (let i = 0; i < d.position.length; i++) {
            const difference = Math.abs(
              position.array[d.part.start * 3 + i] - d.position[i],
            );
            if (difference > 0.001) entries++;
            maximumDisplacement = Math.max(maximumDisplacement, difference);
          }
        if (d.contact)
          for (let i = 0; i < d.part.count; i++) {
            const j = i * 3,
              lift = Math.max(0, d.position[j + 1] - d.part.minY);
            const shift = d.collapse * lift * 0.16;
            const settled = Math.max(
              lift * 0.075,
              lift - (d.part.maxY - d.part.minY) * d.collapse * 0.925,
            );
            const base = d.part.start * 3 + j;
            contactDentDisplacement = Math.max(
              contactDentDisplacement,
              Math.hypot(
                position.array[base] - d.position[j] - shift,
                position.array[base + 1] - d.part.minY - settled,
                position.array[base + 2] - d.position[j + 2] - shift * 0.5,
              ),
            );
          }
        alteredEntries += entries;
        maximumBodyDisplacement = Math.max(
          maximumBodyDisplacement,
          maximumDisplacement,
        );
        if (d.contact)
          contactParts.push({
            key: d.part.key,
            start: d.part.start,
            count: d.part.count,
            center: d.part.center,
            minY: d.part.minY,
            maxY: d.part.maxY,
            collapse: d.collapse,
            exposure: d.exposure,
            contact: d.contact.toArray(),
            normal: d.contactNormal?.toArray(),
            radius: d.contactRadius,
            dent: d.contactDent,
            alteredEntries: entries,
            maximumDisplacement,
            contactDentDisplacement,
          });
      }
      const surfaceAdapters = rendered
        ? [...(fx?.buildingSurfaces.values() || [])].map((surface) => {
            let maximumDamage = 0,
              maximumDisplacement = 0,
              maximumContactDent = 0,
              displacedVertices = 0;
            for (const value of surface.damage.array)
              maximumDamage = Math.max(maximumDamage, value);
            if (surface.position) {
              const current = surface.geometry.getAttribute('position').array;
              const worldPoint = e.camera.position.clone();
              for (let i = 0; i < surface.position.length; i += 3) {
                const displacement = Math.hypot(
                  current[i] - surface.position[i],
                  current[i + 1] - surface.position[i + 1],
                  current[i + 2] - surface.position[i + 2],
                );
                if (displacement > 0.001) displacedVertices++;
                maximumDisplacement = Math.max(
                  maximumDisplacement,
                  displacement,
                );
                const area = surface.areas[i / 3];
                if (area?.contactNormal && surface.world) {
                  const x = surface.world[i],
                    y = surface.world[i + 1],
                    z = surface.world[i + 2];
                  const lift = Math.max(0, y - area.part.minY),
                    shift = area.collapse * lift * 0.16;
                  worldPoint
                    .fromArray(current, i)
                    .applyMatrix4(surface.mesh.matrixWorld);
                  maximumContactDent = Math.max(
                    maximumContactDent,
                    Math.hypot(
                      worldPoint.x - x - shift,
                      worldPoint.y -
                        area.part.minY -
                        lift * (1 - area.collapse * 0.925),
                      worldPoint.z - z - shift * 0.5,
                    ),
                  );
                }
              }
            }
            const ancestors = [];
            let owner = 'other';
            for (let object = surface.mesh; object; object = object.parent) {
              ancestors.push({ name: object.name, visible: object.visible });
              if (object === e.buildings) owner = 'buildings';
              else if (object === e.landmarks) owner = 'landmarks';
            }
            return {
              name: surface.mesh.name,
              sourceGeometryName: surface.source.name,
              owner,
              isBody: surface.mesh === fx.body,
              ancestors,
              instanced: !!surface.mesh.isInstancedMesh,
              shared: surface.shared,
              maximumDamage,
              maximumDisplacement,
              maximumContactDent,
              displacedVertices,
              entries: surface.damage.count,
              originalGeometryRestored:
                surface.mesh.geometry === surface.source,
            };
          })
        : [];
      const dust = (fx?.particles || []).filter(
        (p) => p.dust && p.age < p.life,
      );
      if (rendered)
        for (const surface of surfaceAdapters)
          window.__groundLastRenderedSurfaces.set(surface.name, surface);
      const marks = (fx?.contactMarks || []).map((mark) => ({
        key: mark.key,
        point: mark.point.toArray(),
        normal: mark.normal.toArray(),
        radius: mark.radius,
        age: mark.age,
        ndc: mark.point.clone().project(e.camera).toArray(),
      }));
      const jets = [r.model?.flame, ...(r.model?.strapPlumes || [])]
        .filter(Boolean)
        .map((mesh) => ({
          name: mesh.name,
          visible: mesh.visible,
          shader: mesh.material.name,
          geometry: mesh.geometry.type,
          ndc: mesh
            .getWorldPosition(e.camera.position.clone())
            .project(e.camera)
            .toArray(),
        }));
      const bodyVisible = [];
      for (let object = fx?.body; object; object = object.parent)
        bodyVisible.push(object.visible);
      trace.timeline.push({
        rendered,
        elapsed: s.elapsed,
        flight: s.flightElapsed,
        phase: s.phase,
        stage: s.stage,
        position: { ...s.position },
        velocity: { ...s.velocity },
        altitude: s.altitude,
        speed: s.speed,
        integrity: s.integrity,
        contactDamage: s.contactDamage,
        contactState: s.contactState,
        contactImpact: s.contactImpact,
        support: s.support,
        supportIntegrity: s.supportIntegrity,
        supportCollapsed: s.supportCollapsed,
        failureStage: s.failureStage,
        failure: s.failureReason,
        snapshot: r.snapshot,
        quality: e.settings.quality,
        strapAttached: s.strapAttached,
        boosterAttached: s.boosterAttached,
        stageThrust: s.stageThrust,
        jets,
        dustCount: dust.length,
        dustMaximumRadius: Math.max(
          0,
          ...dust.map((p) =>
            Math.hypot(p.p.x - s.origin.x, p.p.z - s.origin.z),
          ),
        ),
        damagedParts: fx?.parts.length || 0,
        alteredEntries,
        maximumBodyDisplacement,
        bodyVisible,
        contactParts,
        contactMarks: marks,
        collisionCache: fx?.collisionCacheStats ?? null,
        visibleContactMarks: fx?.contactMesh.count || 0,
        contactMarkerCapacity: fx?.contactMesh.instanceMatrix.count || 0,
        contactChips: rendered
          ? window.__groundChipRefs
              .slice(0, 32)
              .map(({ fragment, initial }) => ({
                point: fragment.p.toArray(),
                age: fragment.age,
                initial,
                outwardDistance: fragment.p
                  .clone()
                  .sub(e.camera.position.clone().set(...initial.point))
                  .dot(e.camera.position.clone().set(...initial.normal)),
                ndc: fragment.p.clone().project(e.camera).toArray(),
              }))
          : [],
        renderedRubbleInstances: fx?.rubble.count || 0,
        surfaceAdapters,
        adapterOwnership: { ...trace.adapterOwnership },
        renderer: rendered
          ? {
              calls: e.renderer.info.render.calls,
              triangles: e.renderer.info.render.triangles,
              geometries: e.renderer.info.memory.geometries,
              programs: e.renderer.info.programs.length,
            }
          : null,
        hudText: rendered
          ? [...document.querySelectorAll('.rocket-panel, .rocket-contact-cue')]
              .map((node) => node.textContent)
              .join(' / ')
          : null,
      });
    };
  });
  // A file write anywhere in the Tailwind scan can invalidate a mission, even
  // when the product hashes stay equal. Keep the same strict HMR guard.
  await page.waitForTimeout(3000);
  assert.equal(report.hmr.length, 0, 'clean startup has no source/CSS reload');
  const plan =
    mode === 'broad'
      ? sites.map((site) => ({ ...site, complete: false }))
      : mode === 'representatives'
        ? sites
            .filter((site) => representativeNodes.includes(site.node))
            .sort(
              (a, b) =>
                representativeNodes.indexOf(a.node) -
                representativeNodes.indexOf(b.node),
            )
            .map((site) => ({ ...site, complete: true }))
        : sites.map((site) => ({
            ...site,
            complete: representativeNodes.includes(site.node),
          }));
  for (const [index, site] of plan.entries()) {
    console.log(
      'GROUND_START',
      JSON.stringify({
        index,
        node: site.node,
        roads: site.names,
        complete: site.complete,
      }),
    );
    await page.evaluate(() => window.__atlas.rocket.returnToCity());
    await settle();
    const picked = await page.evaluate((site) => {
      const e = window.__atlas,
        r = e.rocket;
      const graph = e.data.roadGraph,
        node = graph.nodes[site.node];
      if (
        !node ||
        Math.hypot(node.point[0] - site.x, node.point[1] - site.z) > 0.001
      )
        throw Error('RoadGraph site identity changed: ' + site.node);
      const junction = graph.junctions.find((j) => j.nodeId === site.node);
      if (!junction || junction.approaches.length < 3)
        throw Error('Not a real junction: ' + site.node);
      const names = [
        ...new Set(
          node.edgeIds.flatMap((id) => graph.edges[id].names).filter(Boolean),
        ),
      ];
      const ray = new e.placement.raycaster.constructor();
      ray.set(
        e.camera.position.clone().set(site.x, 1500, site.z),
        e.camera.position.clone().set(0, -1, 0),
      );
      const hit = ray.intersectObjects(e.placement.groundMeshes, false)[0];
      if (!hit) throw Error('No rendered placement surface: ' + site.node);
      const terrain = e.elevation(site.x, site.z);
      const road = e.data.roadSurface?.sample(site.x, site.z, terrain + 1.05);
      window.__groundTrace = {
        forces: [],
        received: [],
        chips: [],
        collisionOwners: {},
        collisionAttempts: {},
        collisionSamples: [],
        timeline: [],
        forceTraceTruncated: false,
        adapterOwnership: { draws: 0, applied: 0, restored: 0, failures: 0 },
      };
      window.__groundSurfaceRefs = new Map();
      window.__groundChipRefs = [];
      window.__groundCollisionRefs = new Map();
      window.__groundCollisionAttemptIds = new Map();
      window.__groundLastRenderedSurfaces = new Map();
      r.start(
        'super-heavy',
        site.x,
        hit.point.y + 0.45,
        site.z,
        r.supportAt(hit.point, false),
      );
      return {
        names,
        approaches: junction.approaches.length,
        point: hit.point.toArray(),
        surfaceMesh: hit.object.name,
        terrain,
        road,
      };
    }, site);
    assert.deepEqual(
      [...picked.names].sort((a, b) => a.localeCompare(b)),
      [...site.names].sort((a, b) => a.localeCompare(b)),
      'same named real junction',
    );
    await page.waitForFunction(
      () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
      null,
      { timeout: 90000 },
    );
    assert(await page.evaluate(() => window.__atlas.rocket.loaded));
    const initial = await page.evaluate(() => {
      const r = window.__atlas.rocket,
        fx = r.effects,
        trace = window.__groundTrace;
      if (fx.collisionSurface) {
        const collisionSurface = fx.collisionSurface.bind(fx);
        fx.collisionSurface = (owner, source) => {
          const result = collisionSurface(owner, source);
          if (!window.__groundCollisionAttemptIds.has(owner))
            window.__groundCollisionAttemptIds.set(
              owner,
              owner.uuid ??
                'local-surface-' + window.__groundCollisionAttemptIds.size,
            );
          const attemptKey = window.__groundCollisionAttemptIds.get(owner),
            priorAttempt = trace.collisionAttempts[attemptKey];
          trace.collisionAttempts[attemptKey] = {
            name: owner.name ?? 'Local bridge surface',
            vertices: source.length / 3,
            calls: (priorAttempt?.calls ?? 0) + 1,
            everAdopted: !!result || priorAttempt?.everAdopted === true,
            lastAdopted: !!result,
            lastElapsed: r.state.elapsed,
            cache: fx.collisionCacheStats,
          };
          if (!result) return result;
          if (!window.__groundCollisionRefs.has(owner))
            window.__groundCollisionRefs.set(owner, {
              source,
              hash: window.__groundArrayHash(source),
              key:
                owner.uuid ??
                'local-surface-' + window.__groundCollisionRefs.size,
            });
          const key = window.__groundCollisionRefs.get(owner).key,
            old = trace.collisionOwners[key];
          if (!old || r.state.elapsed - old.sampleElapsed >= 0.2) {
            let maximumDisplacement = 0,
              maximumSurfaceSpeed = 0;
            for (let i = 0; i < result.triangles.length; i += 3) {
              maximumDisplacement = Math.max(
                maximumDisplacement,
                Math.hypot(
                  result.triangles[i] - source[i],
                  result.triangles[i + 1] - source[i + 1],
                  result.triangles[i + 2] - source[i + 2],
                ),
              );
              if (result.deltaTime > 0 && result.previousTriangles)
                maximumSurfaceSpeed = Math.max(
                  maximumSurfaceSpeed,
                  Math.hypot(
                    result.triangles[i] - result.previousTriangles[i],
                    result.triangles[i + 1] - result.previousTriangles[i + 1],
                    result.triangles[i + 2] - result.previousTriangles[i + 2],
                  ) / result.deltaTime,
                );
            }
            const sample = {
              name: owner.name ?? 'Local bridge surface',
              sampleElapsed: r.state.elapsed,
              flight: r.state.flightElapsed,
              revision: result.revision,
              time: result.time,
              deltaTime: result.deltaTime,
              vertices: result.triangles.length / 3,
              previousVertices: result.previousTriangles?.length / 3,
              maximumDisplacement,
              maximumSurfaceSpeed,
              bounds: {
                min: result.bounds.min.toArray(),
                max: result.bounds.max.toArray(),
              },
              sourceHash: window.__groundCollisionRefs.get(owner).hash,
            };
            trace.collisionOwners[key] = sample;
            if (trace.collisionSamples.length < 256)
              trace.collisionSamples.push(sample);
          }
          return result;
        };
      }
      const receive = fx.receiveCollision.bind(fx);
      fx.receiveCollision = (contact, state, dt) => {
        const existingFragments = new Set(fx.fragments);
        if (trace.received.length < 4096) {
          const { polygon: _polygon, ...plain } = contact;
          trace.received.push({
            elapsed: state.elapsed,
            flight: state.flightElapsed,
            phase: state.phase,
            velocity: { ...state.velocity },
            integrity: state.integrity,
            contactDamage: state.contactDamage,
            dt,
            ...plain,
          });
        }
        const result = receive(contact, state, dt);
        if (
          contact.normal &&
          ['building', 'bridge', 'landmark'].includes(contact.source)
        ) {
          const normal = window.__atlas.camera.position
            .clone()
            .set(contact.normal.x, contact.normal.y, contact.normal.z)
            .normalize();
          const point = window.__atlas.camera.position
            .clone()
            .set(contact.point.x, contact.point.y, contact.point.z);
          for (const fragment of fx.fragments) {
            if (existingFragments.has(fragment) || trace.chips.length >= 96)
              continue;
            const initial = {
              flight: state.flightElapsed,
              point: point.toArray(),
              normal: normal.toArray(),
              position: fragment.p.toArray(),
              velocity: fragment.v.toArray(),
              normalOffset: fragment.p.clone().sub(point).dot(normal),
              normalVelocity: fragment.v.dot(normal),
              size: fragment.size.toArray(),
            };
            trace.chips.push(initial);
            window.__groundChipRefs.push({ fragment, initial });
          }
        }
        return result;
      };
      const before = fx.beforeRender.bind(fx),
        after = fx.afterRender.bind(fx);
      fx.beforeRender = () => {
        before();
        trace.adapterOwnership.draws++;
        for (const restore of fx.surfaceRestores) {
          trace.adapterOwnership.applied++;
          if (
            restore.mesh.geometry !== restore.appliedGeometry ||
            restore.mesh.material !== restore.appliedMaterial
          )
            trace.adapterOwnership.failures++;
          window.__groundSurfaceRefs.set(restore.mesh, {
            geometry: restore.geometry,
            material: restore.material,
          });
        }
      };
      fx.afterRender = () => {
        const restores = [...fx.surfaceRestores];
        after();
        for (const restore of restores) {
          trace.adapterOwnership.restored++;
          if (
            restore.mesh.geometry !== restore.geometry ||
            restore.mesh.material !== restore.material
          )
            trace.adapterOwnership.failures++;
        }
      };
      return {
        origin: r.state.origin,
        support: r.state.support,
        actualCityContacts: trace.forces
          .filter((force) => force.phase === 'building')
          .map(({ source, part, point, bounds, normal, penetration }) => ({
            source,
            part,
            point,
            bounds,
            normal,
            penetration,
          })),
        initialVolumes: [...r.initialContacts.keys()].map((v) => ({
          min: v.bounds.min.toArray(),
          max: v.bounds.max.toArray(),
          height: v.bounds.max.y - v.bounds.min.y,
        })),
        baselineHash: window.__groundHash(),
      };
    });
    await advanceUntil({ phase: 'ready', seconds: 22 });
    assert.equal(
      await page.evaluate(() => window.__atlas.rocket.state.phase),
      'ready',
      'natural construction reaches ready',
    );
    if (site.complete && quality !== 'balanced')
      await page.waitForTimeout(2400);
    await page.evaluate(() => window.__atlas.rocket.launch());
    await advanceUntil({ phase: 'ignition', seconds: 8 });
    await advanceUntil({ seconds: 0.5 });
    if (site.complete) await shot(`node-${site.node}-ignition-0.5s.jpg`);
    await advanceUntil({ seconds: 1 });
    if (site.complete) await shot(`node-${site.node}-ignition-1.5s.jpg`);
    for (const flight of [0.5, 1.5, 3, 5, 8]) {
      await advanceUntil({ flight, seconds: 15 });
      await settle();
      await page.evaluate(() => window.__groundRecord(true));
      if (site.complete && [0.5, 3, 8].includes(flight))
        await shot(`node-${site.node}-flight-${flight}s.jpg`);
      if (
        ['crashed', 'sinking'].includes(
          await page.evaluate(() => window.__atlas.rocket.state.phase),
        )
      )
        break;
    }
    const firstEight = await page.evaluate(() => ({
      state: window.__atlas.rocket.state,
      snapshot: window.__atlas.rocket.snapshot,
    }));
    if (
      site.complete &&
      !['crashed', 'sinking'].includes(firstEight.state.phase)
    ) {
      await advanceUntil({ stage: 'strap-separating', seconds: 35 });
      await advanceUntil({ seconds: 0.3 });
      await shot(`node-${site.node}-strap-release.jpg`);
      await advanceUntil({ phase: 'space', seconds: 150 });
      await shot(`node-${site.node}-outcome.jpg`);
    } else if (firstEight.state.wreckage) {
      await shot(`node-${site.node}-failure.jpg`);
    }
    const details = await page.evaluate(() => ({
      state: window.__atlas.rocket.state,
      snapshot: window.__atlas.rocket.snapshot,
      ...window.__groundTrace,
    }));
    const restoration = await page.evaluate(() => {
      const e = window.__atlas,
        r = e.rocket;
      const retiredEffects = r.effects;
      r.returnToCity();
      return {
        immutableCollisionSources: [
          ...window.__groundCollisionRefs.values(),
        ].every(
          (record) => window.__groundArrayHash(record.source) === record.hash,
        ),
        collisionCacheReleased:
          !retiredEffects?.collisionCacheStats ||
          retiredEffects.collisionCacheStats.meshes === 0,
        cityGeometryBytes: window.__groundHash() === window.__groundBaseline,
        flightSourceVolumes:
          JSON.stringify(e.data.flightBuildingVolumes) ===
          window.__groundSourceVolumes,
        detailGeometryAndMaterial: [...window.__groundSurfaceRefs].every(
          ([mesh, original]) =>
            mesh.geometry === original.geometry &&
            mesh.material === original.material,
        ),
      };
    });
    report.missions.push({
      site,
      picked,
      initial,
      firstEight,
      restoration,
      ...details,
    });
    console.log(
      'GROUND_RESULT',
      JSON.stringify({
        node: site.node,
        roads: site.names,
        phaseAtEight: firstEight.state.phase,
        phase: details.state.phase,
        flight: details.state.flightElapsed,
        groundSlope: initial.support.slopeGrade,
        supportCollapsed: details.state.supportCollapsed,
        integrity: details.state.integrity,
        contactDamage: details.state.contactDamage,
        contacts: details.received.length,
        maxBodyDisplacement: Math.max(
          0,
          ...details.timeline.map((t) => t.maximumBodyDisplacement),
        ),
        maxMarkers: Math.max(
          0,
          ...details.timeline.map((t) => t.visibleContactMarks),
        ),
        restoration,
      }),
    );
  }
  const missions = report.missions;
  const complete = missions.filter((mission) => mission.site.complete);
  const contacted = missions.filter((mission) =>
    mission.received.some(
      (contact) =>
        citySources.includes(contact.source) &&
        ['ignition', 'flight'].includes(contact.phase),
    ),
  );
  const ordinary = missions.filter(
    (mission) =>
      mission.initial.support.kind === 'ground' &&
      (mission.initial.support.slopeGrade ?? Infinity) <= 0.15,
  );
  const rendered = (mission) =>
    mission.timeline.filter((sample) => sample.rendered);
  const stagesInOrder = (mission) => {
    const types = mission.state.events.map((event) => event.type);
    const order = [
      'core-ignition',
      'strap-on-separation',
      'core-only',
      'stage-separation',
      'upper-ignition',
      'mission-complete',
    ];
    return (
      mission.state.strapSeparation?.time < mission.state.separation?.time &&
      order.every(
        (type, index) =>
          types.indexOf(type) >= 0 &&
          (!index || types.indexOf(type) > types.indexOf(order[index - 1])),
      )
    );
  };
  report.checks = {
    exactMeasuredInventory:
      mode === 'representatives'
        ? missions.length === representativeNodes.length
        : missions.length === 20 &&
          new Set(missions.map((mission) => mission.site.node)).size === 20,
    representativeSitesPresent:
      mode === 'broad' ||
      representativeNodes.every((node) =>
        complete.some((mission) => mission.site.node === node),
      ),
    actualNamedRoadJunctions: missions.every(
      (mission) => mission.picked.approaches >= 3,
    ),
    newTallAndClearConditionsMatchBaseline: missions.every((mission) => {
      const heights = mission.initial.initialVolumes.map(
        (volume) => volume.height,
      );
      return mission.site.category === 'distributed-clear'
        ? heights.length === 0
        : heights.length > 0 &&
            (mission.site.category !== 'tall-initial-overlap' ||
              Math.max(...heights) > 25);
    }),
    actualRoadElevationPreserved: missions.every(
      (mission) =>
        Math.abs(
          mission.initial.origin.y -
            (Math.max(
              mission.picked.point[1],
              mission.picked.road ?? mission.picked.terrain,
            ) +
              0.45),
        ) < 0.1,
    ),
    slopeAndBearingAreSeparate: missions.every(
      (mission) =>
        Number.isFinite(mission.initial.support.slopeGrade) &&
        mission.initial.support.strength === 1,
    ),
    ordinaryGroundDoesNotCollapse:
      ordinary.length > 0 &&
      ordinary.every((mission) =>
        mission.timeline.every(
          (sample) => !sample.supportCollapsed && sample.supportIntegrity > 0,
        ),
      ),
    everyEightSecondCaseHasARealOutcome: missions.every((mission) => {
      const s = mission.firstEight.state;
      if (s.phase === 'flight' && s.flightElapsed >= 8) return true;
      const firstContact = mission.received.find((contact) =>
        ['building', 'bridge', 'landmark'].includes(contact.source),
      );
      return (
        s.phase === 'crashed' &&
        s.contactImpact?.fatal &&
        s.contactDamage >= 0.9 &&
        firstContact &&
        s.elapsed - firstContact.elapsed >= 1 &&
        mission.timeline.some(
          (sample) =>
            sample.rendered &&
            sample.phase !== 'crashed' &&
            sample.contactDamage > 0.05 &&
            sample.maximumBodyDisplacement > 0.2,
        )
      );
    }),
    noHealthyVehicleRupturesFromLowEnergyCityContact: missions.every(
      (mission) => {
        const s = mission.firstEight.state,
          strike = s.contactImpact;
        return (
          s.phase !== 'crashed' ||
          !['building', 'bridge', 'landmark'].includes(strike?.source) ||
          strike.normalSpeed >= 2 ||
          s.contactDamage >= 0.9
        );
      },
    ),
    normalContactSpeedMatchesIncomingVelocity:
      contacted.length > 0 &&
      contacted.every((mission) =>
        mission.forces
          .filter((force) => force.normal && citySources.includes(force.source))
          .every(
            (force) =>
              Number.isFinite(force.normalSpeed) &&
              Math.abs(force.normalSpeed - force.expectedNormalSpeed) < 1e-7,
          ),
      ),
    actualContactEnergyAndForceRecorded: contacted.every((mission) =>
      mission.forces.some(
        (force) =>
          citySources.includes(force.source) &&
          Number.isFinite(force.impactEnergy) &&
          force.impactEnergy >= 0 &&
          Number.isFinite(force.force) &&
          force.force > 0,
      ),
    ),
    noContactTraceTruncated: missions.every(
      (mission) => !mission.forceTraceTruncated,
    ),
    liveContactProducesRenderedMarksAndLocalDent: contacted.every((mission) =>
      rendered(mission).some(
        (sample) =>
          sample.visibleContactMarks > 0 &&
          (sample.contactParts.some(
            (part) => part.dent > 0 && part.contactDentDisplacement > 0.005,
          ) ||
            sample.surfaceAdapters.some(
              (surface) => surface.maximumContactDent > 0.005,
            )) &&
          sample.bodyVisible.every(Boolean),
      ),
    ),
    contactMarkersBounded: missions.every((mission) =>
      mission.timeline.every(
        (sample) =>
          sample.visibleContactMarks <= 8 &&
          sample.contactMarkerCapacity === 8 &&
          sample.contactMarks.length <= 8,
      ),
    ),
    contactMarksRemainNearRealWallContacts: contacted.every((mission) =>
      rendered(mission).some((sample) =>
        sample.contactMarks.some((mark) =>
          mission.received.some(
            (contact) =>
              Math.hypot(
                mark.point[0] - contact.point.x,
                mark.point[1] - contact.point.y,
                mark.point[2] - contact.point.z,
              ) < 0.2,
          ),
        ),
      ),
    ),
    actualContactChipsStartOutsideAndMoveOutward: contacted.every(
      (mission) =>
        mission.chips.length > 0 &&
        mission.chips.every(
          (chip) => chip.normalOffset > 0 && chip.normalVelocity > 0,
        ),
    ),
    nearbyBuildingsActuallyDeform: missions.every((mission) =>
      rendered(mission).some(
        (sample) =>
          sample.maximumBodyDisplacement > 0.2 &&
          sample.alteredEntries > 0 &&
          sample.bodyVisible.every(Boolean),
      ),
    ),
    productionFiveJetsActiveTogether: missions.every((mission) =>
      mission.timeline.some(
        (sample) =>
          sample.phase === 'ignition' &&
          sample.jets.length === 5 &&
          sample.jets.every(
            (jet) =>
              jet.visible &&
              jet.geometry === 'LatheGeometry' &&
              /Titan/.test(jet.shader),
          ),
      ),
    ),
    groundDustActuallySpreads: missions.every((mission) =>
      rendered(mission).some(
        (sample) => sample.dustCount >= 8 && sample.dustMaximumRadius > 15,
      ),
    ),
    originalThreeRepresentativeMissionsReach100Km:
      mode === 'broad' ||
      [2049, 1746, 1098].every((node) =>
        complete.some(
          (mission) =>
            mission.site.node === node &&
            mission.state.phase === 'space' &&
            mission.state.altitude >= 100000,
        ),
      ),
    allFourRepresentativeOutcomesAccountedFor:
      mode === 'broad' ||
      (complete.length === representativeNodes.length &&
        complete.every(
          (mission) =>
            (mission.state.phase === 'space' &&
              mission.state.altitude >= 100000) ||
            (mission.state.wreckage &&
              mission.state.contactDamage >= 0.9 &&
              mission.received.length > 0 &&
              mission.state.elapsed - mission.received[0].elapsed >= 1),
        )),
    sideBoostersDetachBeforeCore:
      mode === 'broad' ||
      complete
        .filter((mission) => mission.state.phase === 'space')
        .every(stagesInOrder),
    coreBurnContinuesThroughSideBoosterRelease:
      mode === 'broad' ||
      complete
        .filter((mission) => mission.state.phase === 'space')
        .every((mission) => {
          const release = mission.timeline.filter(
            (sample) => sample.stage === 'strap-separating',
          );
          return (
            release.length > 0 &&
            release.every(
              (sample) =>
                !sample.strapAttached &&
                sample.boosterAttached &&
                sample.stageThrust > 0 &&
                sample.jets[0]?.visible &&
                sample.jets.slice(1).every((jet) => !jet.visible),
            )
          );
        }),
    causalSnapshotFieldsRecorded: missions.every((mission) =>
      mission.timeline.every(
        (sample) =>
          Number.isFinite(sample.snapshot.contactDamage) &&
          Number.isFinite(sample.snapshot.integrity) &&
          sample.snapshot.supportCollapsed === sample.supportCollapsed &&
          sample.snapshot.groundSlopeGrade === sample.support.slopeGrade &&
          sample.snapshot.steepSurface === sample.support.slopeGrade > 0.15,
      ),
    ),
    contactFailureHasActualImpactCause: missions.every((mission) => {
      const s = mission.state;
      return (
        s.phase !== 'crashed' ||
        s.wreckage?.cause !== 'impact' ||
        s.supportCollapsed ||
        !!s.contactImpact?.fatal
      );
    }),
    detailAdaptersBounded: missions.every((mission) =>
      rendered(mission).every(
        (sample) =>
          sample.damagedParts <= 96 &&
          sample.surfaceAdapters.length <= 32 &&
          sample.surfaceAdapters
            .filter((surface) => surface.instanced)
            .reduce((n, surface) => n + surface.entries, 0) <= 4096 &&
          sample.surfaceAdapters
            .filter((surface) => !surface.shared)
            .reduce((n, surface) => n + surface.entries, 0) <= 240000,
      ),
    ),
    meshCollisionCacheBounded: missions.every((mission) =>
      rendered(mission).every(
        (sample) =>
          sample.collisionCache &&
          sample.collisionCache.meshes <= 32 &&
          sample.collisionCache.vertices <= 240000 &&
          sample.collisionCache.outputBytes <= 5760000 &&
          sample.collisionCache.areaReferences <= 240000,
      ),
    ),
    conventionCentreUsesDeformedPhysicalTriangles:
      !missions.some((mission) => mission.site.node === 2472) ||
      missions
        .filter((mission) => mission.site.node === 2472)
        .every(
          (mission) =>
            Object.values(mission.collisionOwners).some((owner) =>
              /Convention Centre/.test(owner.name),
            ) &&
            mission.collisionSamples.some(
              (sample) =>
                sample.maximumDisplacement > 0.01 &&
                sample.vertices > 0 &&
                sample.vertices === sample.previousVertices,
            ),
        ),
    detailGeometryAndMaterialsRestoredAfterDraw: missions.every(
      (mission) =>
        mission.adapterOwnership.failures === 0 &&
        mission.adapterOwnership.applied ===
          mission.adapterOwnership.restored &&
        rendered(mission).every((sample) =>
          sample.surfaceAdapters.every(
            (surface) => surface.originalGeometryRestored,
          ),
        ),
    ),
    highQualityRealDetailsActuallyAffected:
      quality === 'balanced' ||
      complete.some((mission) =>
        rendered(mission).some((sample) =>
          sample.surfaceAdapters.some(
            (surface) =>
              !surface.isBody &&
              surface.maximumDamage > 0 &&
              (surface.maximumDisplacement > 0.01 || surface.instanced) &&
              surface.ancestors.every((parent) => parent.visible),
          ),
        ),
      ),
    noVisibleConventionCentreContactUsesStaleCollider: missions
      .filter((mission) => mission.site.node === 2472)
      .every((mission) =>
        mission.forces
          .filter(
            (force) =>
              /Convention Centre/.test(force.meshName) &&
              force.renderedOwnerDisplacement > 0.05,
          )
          .every((force) => force.collisionAdopted),
      ),
    requestedQualityRendered: missions.every((mission) =>
      mission.timeline.every((sample) => sample.quality === quality),
    ),
    exactCityRestoration: missions.every((mission) =>
      Object.values(mission.restoration).every(Boolean),
    ),
    noJavaScriptOrWebGLErrors:
      report.errors.length === 0 &&
      !report.consoleErrors.some(
        (message) => !message.startsWith('Failed to load resource:'),
      ),
    noMissingRocketOrWorkerAssets: !report.httpFailures.some((response) =>
      /rocket|worker|city-chunks/.test(response.url),
    ),
    noHotReloads: report.hmr.length === 0,
  };
} catch (error) {
  report.failure = error.stack || String(error);
  await page
    .screenshot({ path: temp + 'harness-failure.jpg', quality: 84 })
    .catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.finalSourceHashes = await sourceHashes();
  report.sourceFilesUnchanged =
    JSON.stringify(report.sourceHashes) ===
    JSON.stringify(report.finalSourceHashes);
  report.checks.sourceFilesUnchanged = report.sourceFilesUnchanged;
  const max = (mission, field) =>
    Math.max(0, ...mission.timeline.map((sample) => sample[field] || 0));
  const rawReport = JSON.stringify(report, null, 2);
  const compactTimeline = (mission) => {
    const samples = mission.timeline.filter(
      (sample) =>
        sample.rendered &&
        !['building', 'ready', 'countdown'].includes(sample.phase),
    );
    const selected = new Set();
    const add = (sample) => {
      if (sample) selected.add(sample);
    };
    add(samples[0]);
    add(samples.at(-1));
    const stages = new Set();
    for (const sample of samples) {
      const key = sample.phase + ':' + sample.stage;
      if (!stages.has(key)) {
        stages.add(key);
        add(sample);
      }
    }
    for (const flight of [0.5, 1.5, 3, 5, 8, 11.3, 24.3]) {
      if (flight > mission.state.flightElapsed) continue;
      add(
        samples.reduce(
          (a, b) =>
            !a || Math.abs(b.flight - flight) < Math.abs(a.flight - flight)
              ? b
              : a,
          null,
        ),
      );
    }
    add(samples.find((sample) => sample.visibleContactMarks > 0));
    return [...selected]
      .sort((a, b) => a.elapsed - b.elapsed)
      .map((sample) => ({
        elapsed: sample.elapsed,
        flight: sample.flight,
        phase: sample.phase,
        stage: sample.stage,
        altitude: sample.altitude,
        speed: sample.speed,
        integrity: sample.integrity,
        contactDamage: sample.contactDamage,
        contactState: sample.contactState,
        contactCause: sample.contactImpact
          ? {
              source: sample.contactImpact.source,
              part: sample.contactImpact.part,
              normalSpeed: sample.contactImpact.normalSpeed,
              severity: sample.contactImpact.severity,
              fatal: sample.contactImpact.fatal,
            }
          : null,
        supportIntegrity: sample.supportIntegrity,
        supportCollapsed: sample.supportCollapsed,
        groundSlopeGrade: sample.support.slopeGrade,
        collisionCache: sample.collisionCache,
        maximumBodyDisplacement: sample.maximumBodyDisplacement,
        maximumContactDent: Math.max(
          0,
          ...sample.contactParts.map((part) => part.contactDentDisplacement),
        ),
        visibleMarks: sample.visibleContactMarks,
        marks: sample.contactMarks
          .slice(0, 8)
          .map(({ point, normal, radius, age }) => ({
            point,
            normal,
            radius,
            age,
          })),
        chipCount: sample.contactChips.length,
        renderedRubbleInstances: sample.renderedRubbleInstances,
        detail: {
          surfaces: sample.surfaceAdapters.length,
          instanceAttributes: sample.surfaceAdapters
            .filter((surface) => surface.instanced)
            .reduce((n, surface) => n + surface.entries, 0),
          clonedVertices: sample.surfaceAdapters
            .filter((surface) => !surface.shared)
            .reduce((n, surface) => n + surface.entries, 0),
          maximumDisplacement: Math.max(
            0,
            ...sample.surfaceAdapters.map(
              (surface) => surface.maximumDisplacement,
            ),
          ),
          maximumChar: Math.max(
            0,
            ...sample.surfaceAdapters.map((surface) => surface.maximumDamage),
          ),
          owners: [
            ...new Set(
              sample.surfaceAdapters
                .filter((surface) => surface.maximumDamage > 0)
                .map((surface) => surface.owner),
            ),
          ],
        },
        dustCount: sample.dustCount,
        dustMaximumRadius: sample.dustMaximumRadius,
        coreFlame: sample.jets[0]?.visible,
        sideFlames: sample.jets.slice(1).filter((jet) => jet.visible).length,
      }));
  };
  const summary = {
    method: report.method,
    quality,
    mode,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    checks: report.checks,
    outcomes: {
      tested: report.missions.length,
      completedEightSeconds: report.missions.filter(
        (mission) =>
          mission.firstEight.state.phase === 'flight' &&
          mission.firstEight.state.flightElapsed >= 8,
      ).length,
      failedBeforeEightSeconds: report.missions
        .filter((mission) => mission.firstEight.state.phase !== 'flight')
        .map((mission) => ({
          node: mission.site.node,
          phase: mission.firstEight.state.phase,
          flight: mission.firstEight.state.flightElapsed,
          reason: mission.firstEight.state.failureReason,
          contact: mission.firstEight.state.contactImpact,
        })),
      reachedSpace: report.missions.filter(
        (mission) => mission.state.phase === 'space',
      ).length,
    },
    classificationNote: report.classificationNote,
    rawReport: {
      path: 'report.json',
      bytes: Buffer.byteLength(rawReport),
      sha256: createHash('sha256').update(rawReport).digest('hex'),
      retained: 'ignored work; not for Git',
    },
    failure: report.failure,
    errors: report.errors,
    consoleErrors: report.consoleErrors,
    httpFailures: report.httpFailures,
    failedRequests: report.failedRequests,
    hmr: report.hmr,
    sourceHashes: report.sourceHashes,
    finalSourceHashes: report.finalSourceHashes,
    sourceFilesUnchanged: report.sourceFilesUnchanged,
    screenshots: report.screenshots,
    missions: report.missions.map((mission) => ({
      node: mission.site.node,
      roads: mission.site.names,
      category: mission.site.category,
      completeMission: mission.site.complete,
      coordinates: [mission.site.x, mission.site.z],
      baselineOutcome: mission.site.baselineOutcome,
      baselineFlight: mission.site.baselineFlight,
      picked: mission.picked,
      launchOrigin: mission.initial.origin,
      support: mission.initial.support,
      actualInitialCityContacts: mission.initial.actualCityContacts,
      initialVolumes: mission.initial.initialVolumes,
      eightSecondOutcome: {
        phase: mission.firstEight.state.phase,
        flight: mission.firstEight.state.flightElapsed,
        altitude: mission.firstEight.state.altitude,
        integrity: mission.firstEight.state.integrity,
        supportCollapsed: mission.firstEight.state.supportCollapsed,
        contactDamage: mission.firstEight.state.contactDamage,
      },
      outcome: mission.state.phase,
      altitude: mission.state.altitude,
      flight: mission.state.flightElapsed,
      integrity: mission.state.integrity,
      contactDamage: mission.state.contactDamage,
      contactImpact: mission.state.contactImpact,
      wreckage: mission.state.wreckage,
      failure: mission.state.failureReason,
      restoration: mission.restoration,
      contactCount: mission.received.length,
      contactChipCount: mission.chips.length,
      firstContactChips: mission.chips.slice(0, 8),
      forceSamples: mission.forces.length,
      firstContacts: mission.received.slice(0, 3),
      maxNormalSpeed: Math.max(
        0,
        ...mission.forces.map((force) => force.normalSpeed || 0),
      ),
      maxForceNewtons: Math.max(
        0,
        ...mission.forces.map((force) => force.force || 0),
      ),
      maxImpactJoules: Math.max(
        0,
        ...mission.forces.map((force) => force.impactEnergy || 0),
      ),
      maximumBodyDisplacement: max(mission, 'maximumBodyDisplacement'),
      maximumVisibleMarks: max(mission, 'visibleContactMarks'),
      maximumDustCount: max(mission, 'dustCount'),
      maximumDustRadius: max(mission, 'dustMaximumRadius'),
      adapterOwnership: mission.adapterOwnership,
      collisionOwners: Object.values(mission.collisionOwners),
      collisionAttempts: Object.values(mission.collisionAttempts),
      actualContactOwners: [
        ...new Set(
          mission.forces.map((force) => force.meshName).filter(Boolean),
        ),
      ],
      unadoptedRenderedContactSamples: mission.forces
        .filter(
          (force) =>
            force.meshName &&
            force.renderedOwnerDisplacement > 0.05 &&
            !force.collisionAdopted,
        )
        .slice(0, 8),
      collisionSamples: mission.collisionSamples
        .filter((_, index) => index % 8 === 0)
        .slice(0, 32),
      events: mission.state.events,
      releaseSamples: mission.timeline
        .filter((sample) => sample.stage === 'strap-separating')
        .map((sample) => ({
          flight: sample.flight,
          strapAttached: sample.strapAttached,
          boosterAttached: sample.boosterAttached,
          coreFlame: sample.jets[0]?.visible,
          sideFlames: sample.jets.slice(1).filter((jet) => jet.visible).length,
          stageThrust: sample.stageThrust,
        })),
      renderedTimeline: compactTimeline(mission),
    })),
  };
  await fs.writeFile(temp + 'report.json', rawReport);
  await fs.writeFile(temp + 'summary.json', JSON.stringify(summary, null, 2));
  await browser.close();
  const target = new URL(
    `../work/rocket-ground-contact-${quality}-qa/`,
    import.meta.url,
  );
  await fs.mkdir(target, { recursive: true });
  await fs.cp(temp, target, { recursive: true });
  console.log(
    'GROUND_ACCEPTANCE',
    JSON.stringify({
      checks: report.checks,
      failure: report.failure,
      errors: report.errors,
      path: new URL('summary.json', target).pathname,
    }),
  );
}
if (
  report.failure ||
  report.errors.length ||
  Object.values(report.checks).some((value) => !value)
)
  process.exitCode = 1;
