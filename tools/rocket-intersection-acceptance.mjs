import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Real junctions, rendered picking surfaces and unmodified controller updates.
// This harness never assigns flight phase, altitude, damage or mission outcomes.
const inventoryOnly = process.env.ROCKET_INTERSECTION_INVENTORY === '1';
const diagnose = process.env.ROCKET_INTERSECTION_DIAGNOSE === '1';
const quality = process.env.ROCKET_INTERSECTION_QUALITY || 'balanced';
const representative =
  process.env.ROCKET_INTERSECTION_CASES === 'representative';
const sourcePaths = [
  'lib/city/rocket-controller.ts',
  'lib/city/rocket-effects.ts',
  'lib/city/rocket-state.ts',
  'lib/city/assets/rocket.ts',
  'lib/city/assets/rocket-design.ts',
  'lib/city/assets/rocket-wreckage.ts',
  'lib/city/assets/rocket-exhaust.ts',
  'lib/city/facade-details.ts',
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
const temp = `/private/tmp/rocket-intersection-${Date.now()}/`;
await fs.mkdir(temp, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  method:
    'Headless Chrome Metal; actual downtown roadGraph junctions; rendered ground raycast and original supportAt/start; fixed 1/60 original controller update; no forced flight states or outcomes.',
  diagnose,
  quality,
  sourceHashes: await sourceHashes(),
  errors: [],
  consoleErrors: [],
  httpFailures: [],
  hmr: [],
  candidates: [],
  missions: [],
  checks: {},
  screenshots: [],
};
const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (error) => report.errors.push(String(error)));
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
  await page.evaluate(() => window.__intersectionRecord?.(true));
  await page.screenshot({ path: temp + name });
  report.screenshots.push(name);
  if (
    (quality === 'balanced' &&
      /intersection-(?:0-clear-contact-1.5s|2-strap-obstructed-(?:ignition-1.5s|contact-3s))\.png$/.test(
        name,
      )) ||
    (quality !== 'balanced' &&
      name.endsWith('intersection-1-strap-obstructed-contact-3s.png'))
  ) {
    const compact = name.replace(/\.png$/, '.jpg');
    await page.screenshot({ path: temp + compact, quality: 82 });
    report.screenshots.push(compact);
  }
}
async function advance(seconds, stop = '') {
  return page.evaluate(
    async ({ seconds, stop }) => {
      const r = window.__atlas.rocket;
      for (let i = 0; i < Math.ceil(seconds * 60); i++) {
        window.__intersectionStep(1 / 60);
        if (i % 30 === 0) window.__intersectionRecord();
        if (stop === r.state.phase || stop === r.state.stage) break;
        if (
          stop !== 'settle' &&
          ['crashed', 'sinking', 'space'].includes(r.state.phase)
        )
          break;
        if (i % (r.state.flightElapsed < 6 ? 12 : 120) === 0)
          await new Promise(requestAnimationFrame);
      }
      window.__intersectionRecord();
      r.onChange(r.snapshot);
      return { snapshot: r.snapshot, state: r.state };
    },
    { seconds, stop },
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
      window.__atlas?.rocket &&
      window.__atlas.renderReady &&
      window.__atlas.data.rocketBuildingParts?.length,
    null,
    { timeout: 120000 },
  );
  await page
    .locator('.rocket-mode-button:not(:disabled)')
    .waitFor({ timeout: 120000 });
  await settle();
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
  await page.evaluate(() => {
    const e = window.__atlas,
      r = e.rocket;
    window.__intersectionStep = r.update.bind(r);
    r.update = () => {};
    window.__intersectionHash = () => {
      let hash = 2166136261;
      for (const key of ['position', 'color']) {
        const array =
            e.data.rocketBuildingMesh.geometry.getAttribute(key).array,
          bits = new Uint32Array(
            array.buffer,
            array.byteOffset,
            array.byteLength / 4,
          );
        for (const value of bits) hash = Math.imul(hash ^ value, 16777619);
      }
      return hash >>> 0;
    };
    window.__intersectionBaseline = window.__intersectionHash();
    e.setClock({ hour: 12, running: false });
    r.start('super-heavy', 0, e.elevation(0, 0) + 0.45, 0);
  });
  await page.evaluate(async () => {
    window.__intersectionGeo = await import('/lib/city/geo.ts');
  });
  await page.waitForFunction(
    () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
    null,
    { timeout: 90000 },
  );
  assert(await page.evaluate(() => window.__atlas.rocket.loaded));
  report.candidates = await page.evaluate(() => {
    const e = window.__atlas,
      r = e.rocket,
      graph = e.data.roadGraph,
      result = [],
      vector = (...args) => new e.camera.position.constructor(...args),
      ray = new e.placement.raycaster.constructor();
    const filtered = graph.junctions.filter(
      (junction) => junction.approaches.length >= 3,
    );
    for (const junction of filtered) {
      const node = graph.nodes[junction.nodeId],
        [x, z] = node.point;
      if (Math.hypot(x, z) > 2400 || !e.onLand(x, z) || e.waterWorld.at(x, z))
        continue;
      const edges = node.edgeIds.map((id) => graph.edges[id]);
      const names = [
        ...new Set(edges.flatMap((edge) => edge.names).filter(Boolean)),
      ];
      if (
        names.length < 2 ||
        edges.some((edge) =>
          edge.classes.some((name) =>
            /path|trail|bikeway|stairs|pedestrian|bridge/i.test(name),
          ),
        )
      )
        continue;
      const terrain = e.elevation(x, z),
        road = e.data.roadSurface?.sample(x, z, terrain + 1.05);
      ray.set(vector(x, 1500, z), vector(0, -1, 0));
      const hit = ray.intersectObjects(e.placement.groundMeshes, false)[0];
      if (!hit) continue;
      const y = hit.point.y,
        origin = vector(x, y + 0.45, z);
      const coreHit = r.world.hit(
        origin.clone().add(vector(0, 6.3, 0)),
        origin.clone().add(vector(0, 103.7, 0)),
        6.3 * 0.75,
      );
      const probes = r.model.collisionSegments
        .map((probe, index) => ({
          index,
          strapOn: !!probe.strapOn,
          booster: probe.booster,
          hit: r.world.hit(
            probe.from.clone().add(origin),
            probe.to.clone().add(origin),
            probe.radius,
          ),
        }))
        .filter((probe) => probe.hit);
      const parts = e.data.rocketBuildingParts.filter(
        (part) => Math.hypot(part.center[0] - x, part.center[1] - z) < 200,
      );
      const initialContacts = [];
      if (Math.hypot(x, z) < 600 && (coreHit || probes.length)) {
        const samples = probes.map((probe) => ({
          label: `probe-${probe.index}`,
          a: r.model.collisionSegments[probe.index].from.clone().add(origin),
          b: r.model.collisionSegments[probe.index].to.clone().add(origin),
          radius: r.model.collisionSegments[probe.index].radius,
        }));
        if (coreHit)
          samples.push({
            label: 'core',
            a: origin.clone().add(vector(0, 6.3, 0)),
            b: origin.clone().add(vector(0, 103.7, 0)),
            radius: 4.725,
          });
        for (const volume of e.data.flightBuildingVolumes) {
          const xs = volume.polygon[0].map((point) => point[0]),
            zs = volume.polygon[0].map((point) => point[1]);
          if (
            Math.min(...xs) > x + 16 ||
            Math.max(...xs) < x - 16 ||
            Math.min(...zs) > z + 16 ||
            Math.max(...zs) < z - 16
          )
            continue;
          for (const sample of samples) {
            let contact = null;
            const steps = Math.max(
              1,
              Math.ceil(sample.a.distanceTo(sample.b) / 0.7),
            );
            for (let i = 0; i <= steps && !contact; i++) {
              const point = sample.a.clone().lerp(sample.b, i / steps);
              if (
                point.y + sample.radius < volume.minY ||
                point.y - sample.radius > volume.maxY
              )
                continue;
              for (const [dx, dz] of [
                [0, 0],
                [sample.radius, 0],
                [-sample.radius, 0],
                [0, sample.radius],
                [0, -sample.radius],
              ])
                if (
                  window.__intersectionGeo.inPolygon(
                    [point.x + dx, point.z + dz],
                    volume.polygon,
                  )
                ) {
                  contact = [point.x + dx, point.y, point.z + dz];
                  break;
                }
            }
            if (contact)
              initialContacts.push({ probe: sample.label, contact, volume });
          }
        }
      }
      result.push({
        node: node.id,
        x,
        y,
        z,
        terrain,
        road,
        roadOffset: (road ?? terrain) - terrain,
        surfaceMesh: hit.object.name,
        approaches: junction.approaches.length,
        names,
        widths: edges.map((edge) => edge.width),
        coreHit,
        probes,
        initialContacts,
        nearBuildings: parts.length,
        support: r.supportAt(hit.point, false),
      });
    }
    return result.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  });
  console.log(
    'JUNCTION_INVENTORY',
    JSON.stringify({
      count: report.candidates.length,
      nearest: report.candidates.slice(0, 5),
    }),
  );
  if (!inventoryOnly) {
    const choose = (predicate, count) =>
      report.candidates.filter(predicate).slice(0, count);
    const sites = [
      ...choose(
        (site) =>
          !site.coreHit && !site.probes.length && site.nearBuildings >= 3,
        representative ? 1 : 2,
      ).map((site) => ({ ...site, category: 'clear' })),
      ...choose(
        (site) => !site.coreHit && site.probes.some((probe) => probe.strapOn),
        representative ? 1 : 2,
      ).map((site) => ({ ...site, category: 'strap-obstructed' })),
      ...choose((site) => site.coreHit, 1).map((site) => ({
        ...site,
        category: 'core-obstructed',
      })),
    ];
    assert(
      sites.some((site) => site.category === 'clear'),
      'a genuine clear road junction exists',
    );
    assert(
      sites.some((site) => site.category !== 'clear'),
      'a genuinely obstructed road junction is included',
    );
    for (const [index, site] of sites.entries()) {
      await page.evaluate(() => window.__atlas.rocket.returnToCity());
      await settle();
      await page.evaluate((site) => {
        const e = window.__atlas,
          r = e.rocket;
        window.__intersectionTimeline = [];
        window.__intersectionCollisions = [];
        window.__intersectionContacts = [];
        window.__intersectionRecord = (rendered = false) => {
          const s = r.state,
            fx = r.effects;
          if (!s) return;
          const damagedParts = (fx?.parts || []).filter(
            (part) => part.collapse > 0 || part.exposure > 0.12,
          );
          let alteredVertices = 0,
            largestDeformation = 0;
          const position = fx?.body?.geometry.getAttribute('position');
          for (const damage of damagedParts)
            for (let i = 0; i < damage.position.length; i++) {
              const change = Math.abs(
                position.array[damage.part.start * 3 + i] - damage.position[i],
              );
              if (change > 0.001) alteredVertices++;
              largestDeformation = Math.max(largestDeformation, change);
            }
          const bodyAncestors = [];
          for (let object = fx?.body; object; object = object.parent)
            bodyAncestors.push({ name: object.name, visible: object.visible });
          const jetMeshes = [r.model?.flame, ...(r.model?.strapPlumes || [])]
            .filter(Boolean)
            .map((mesh) => {
              const center = mesh
                .getWorldPosition(e.camera.position.clone())
                .project(e.camera);
              return {
                name: mesh.name,
                visible: mesh.visible,
                shader: mesh.material.name,
                geometry: mesh.geometry.type,
                vertices: mesh.geometry.getAttribute('position').count,
                ndc: center.toArray(),
              };
            });
          const surfaceAdapters = rendered
            ? [...(fx?.buildingSurfaces?.values() || [])].map((surface) => {
                let maximumDamage = 0,
                  displacedVertices = 0,
                  maximumDisplacement = 0;
                for (const value of surface.damage.array)
                  maximumDamage = Math.max(maximumDamage, value);
                if (surface.position) {
                  const positions =
                    surface.geometry.getAttribute('position').array;
                  for (let i = 0; i < surface.position.length; i += 3) {
                    const change = Math.hypot(
                      positions[i] - surface.position[i],
                      positions[i + 1] - surface.position[i + 1],
                      positions[i + 2] - surface.position[i + 2],
                    );
                    if (change > 0.001) displacedVertices++;
                    maximumDisplacement = Math.max(maximumDisplacement, change);
                  }
                }
                const ancestors = [];
                let owner = 'other';
                for (
                  let object = surface.mesh;
                  object;
                  object = object.parent
                ) {
                  ancestors.push({
                    name: object.name,
                    visible: object.visible,
                  });
                  if (object === e.landmarks) owner = 'landmarks';
                  else if (object === e.buildings) owner = 'buildings';
                }
                return {
                  name: surface.mesh.name,
                  sourceGeometryName: surface.source.name,
                  owner,
                  isBody: surface.mesh === fx.body,
                  ancestors,
                  shared: surface.shared,
                  instanced: surface.mesh.isInstancedMesh === true,
                  maximumDamage,
                  displacedVertices,
                  maximumDisplacement,
                  damageEntries: surface.damage.count,
                  originalGeometryRestoredAfterDraw:
                    surface.mesh.geometry === surface.source,
                };
              })
            : [];
          const dust = (fx?.particles || []).filter(
            (particle) => particle.dust && particle.age < particle.life,
          );
          window.__intersectionTimeline.push({
            rendered,
            renderer: rendered
              ? {
                  calls: e.renderer.info.render.calls,
                  triangles: e.renderer.info.render.triangles,
                  geometries: e.renderer.info.memory.geometries,
                  programs: e.renderer.info.programs.length,
                }
              : null,
            elapsed: s.elapsed,
            quality: e.settings.quality,
            flightElapsed: s.flightElapsed,
            phase: s.phase,
            stage: s.stage,
            strapAttached: s.strapAttached,
            boosterAttached: s.boosterAttached,
            stageThrust: s.stageThrust,
            dustCount: dust.length,
            dustMaximumCenterRadius: Math.max(
              0,
              ...dust.map((particle) =>
                Math.hypot(
                  particle.p.x - s.origin.x,
                  particle.p.z - s.origin.z,
                ),
              ),
            ),
            position: { ...s.position },
            altitude: s.altitude,
            speed: s.speed,
            throttle: s.throttle,
            failure: s.failureReason,
            failureStage: s.failureStage,
            support: { ...s.support },
            supportIntegrity: s.supportIntegrity,
            integrity: s.integrity,
            supportCollapsed: s.supportCollapsed,
            wreckage: s.wreckage,
            damaged: fx?.damaged,
            damagedParts: damagedParts.length,
            alteredVertices,
            largestDeformation,
            maxCollapse: Math.max(
              0,
              ...damagedParts.map((part) => part.collapse),
            ),
            bodyAncestors,
            geometryVersion: position?.version,
            contactVolumes: [...r.contactVolumes.entries()].map(
              ([volume, contact]) => ({
                min: volume.bounds.min.toArray(),
                max: volume.bounds.max.toArray(),
                originalTop: contact.originalTop,
                point: contact.point.toArray(),
              }),
            ),
            jetMeshes,
            surfaceAdapters,
            damagedBuildings: damagedParts
              .filter((part) => part.collapse > 0)
              .slice(0, 8)
              .map((part) => ({
                key: part.part.key,
                center: part.part.center,
                bottom: part.part.minY,
                top: part.part.maxY,
                exposure: part.exposure,
                collapse: part.collapse,
              })),
            flames: r.model?.strapPlumes?.filter((plume) => plume.visible)
              .length,
            coreFlame: r.model?.flame?.visible,
            groundRibbons:
              fx?.group.getObjectByName('Titan five-jet ground flame outwash')
                ?.count || 0,
          });
        };
        const point = e.camera.position.clone().set(site.x, site.y, site.z);
        r.start(
          'super-heavy',
          site.x,
          site.y + 0.45,
          site.z,
          r.supportAt(point, false),
        );
      }, site);
      await page.waitForFunction(
        () => window.__atlas.rocket.loaded || window.__atlas.rocket.loadError,
        null,
        { timeout: 90000 },
      );
      assert(await page.evaluate(() => window.__atlas.rocket.loaded));
      await page.evaluate(() => {
        const r = window.__atlas.rocket,
          originalHit = r.world.hit.bind(r.world);
        if (r.effects.receiveCollision) {
          const originalContact = r.effects.receiveCollision.bind(r.effects);
          r.effects.receiveCollision = (contact, state, dt) => {
            if (window.__intersectionContacts.length < 300)
              window.__intersectionContacts.push({
                elapsed: state.elapsed,
                flightElapsed: state.flightElapsed,
                phase: state.phase,
                dt,
                ...contact,
              });
            return originalContact(contact, state, dt);
          };
        }
        r.world.hit = (a, b, radius) => {
          const hit = originalHit(a, b, radius);
          if (
            hit &&
            ['flight', 'falling', 'aborted'].includes(r.state.phase) &&
            window.__intersectionCollisions.length < 20
          ) {
            const seen = new Set([...r.world.cells.values()].flat()),
              volumes = [];
            for (const volume of seen) {
              if (!volume.polygon) continue;
              const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.7));
              let contact = null;
              for (let i = 0; i <= steps && !contact; i++) {
                const point = a.clone().lerp(b, i / steps);
                if (
                  point.y + radius < volume.bounds.min.y ||
                  point.y - radius > volume.bounds.max.y
                )
                  continue;
                for (const [dx, dz] of [
                  [0, 0],
                  [radius, 0],
                  [-radius, 0],
                  [0, radius],
                  [0, -radius],
                ])
                  if (
                    window.__intersectionGeo.inPolygon(
                      [point.x + dx, point.z + dz],
                      volume.polygon,
                    )
                  ) {
                    contact = [point.x + dx, point.y, point.z + dz];
                    break;
                  }
              }
              if (contact)
                volumes.push({
                  contact,
                  min: volume.bounds.min.toArray(),
                  max: volume.bounds.max.toArray(),
                  source: window.__atlas.data.flightBuildingVolumes.find(
                    (source) => source.polygon === volume.polygon,
                  ),
                });
            }
            window.__intersectionCollisions.push({
              elapsed: r.state.elapsed,
              a: a.toArray(),
              b: b.toArray(),
              radius,
              volumes,
            });
          }
          return hit;
        };
      });
      const ready = await advance(18, 'ready');
      if (quality !== 'balanced') await page.waitForTimeout(2200);
      await shot(`intersection-${index}-${site.category}-ready.png`);
      await page.evaluate(() => window.__atlas.rocket.launch());
      await advance(6, 'ignition');
      await advance(0.5);
      await shot(`intersection-${index}-${site.category}-ignition-0.5s.png`);
      await advance(1);
      await shot(`intersection-${index}-${site.category}-ignition-1.5s.png`);
      await advance(2, 'flight');
      await shot(`intersection-${index}-${site.category}-first-contact.png`);
      for (const [duration, label] of [
        [0.5, '0.5'],
        [1, '1.5'],
        [1.5, '3'],
        [2, '5'],
      ]) {
        await advance(duration, 'settle');
        await shot(
          `intersection-${index}-${site.category}-contact-${label}s.png`,
        );
      }
      if (
        quality === 'balanced' &&
        index === 2 &&
        !['crashed', 'sinking'].includes(
          await page.evaluate(() => window.__atlas.rocket.state.phase),
        )
      ) {
        await advance(20, 'strap-separating');
        await advance(0.35);
        await shot(`intersection-${index}-${site.category}-strap-release.png`);
      }
      const outcome = await advance(85);
      if (
        outcome.state.wreckage &&
        outcome.state.elapsed - outcome.state.wreckage.time < 5
      )
        await advance(
          5 - (outcome.state.elapsed - outcome.state.wreckage.time),
          'settle',
        );
      await shot(`intersection-${index}-${site.category}-outcome.png`);
      const details = await page.evaluate(() => ({
        snapshot: window.__atlas.rocket.snapshot,
        state: window.__atlas.rocket.state,
        timeline: window.__intersectionTimeline,
        collisions: window.__intersectionCollisions,
        contacts: window.__intersectionContacts,
      }));
      const restored = await page.evaluate(() => {
        window.__atlas.rocket.returnToCity();
        return window.__intersectionHash() === window.__intersectionBaseline;
      });
      report.missions.push({
        site,
        readyOrigin: ready.state.origin,
        exactCityGeometryRestored: restored,
        ...details,
      });
      console.log(
        'JUNCTION_RESULT',
        JSON.stringify({
          site: site.names,
          category: site.category,
          phase: details.state.phase,
          flightElapsed: details.state.flightElapsed,
          failure: details.state.failureReason,
          maxDamaged: Math.max(
            ...details.timeline.map((sample) => sample.damaged || 0),
          ),
          maxDeformation: Math.max(
            ...details.timeline.map((sample) => sample.largestDeformation),
          ),
          collisions: details.collisions.slice(0, 2),
        }),
      );
    }
    report.checks = {
      severalRealJunctions: report.missions.length >= 3,
      clearJunctionMissionComplete: report.missions
        .filter((mission) => mission.site.category === 'clear')
        .every((mission) => mission.state.phase === 'space'),
      clearJunctionHasVisiblePressureDamage: report.missions
        .filter((mission) => mission.site.category === 'clear')
        .every((mission) =>
          mission.timeline.some(
            (sample) =>
              sample.rendered &&
              sample.altitude < 500 &&
              sample.largestDeformation > 0.2 &&
              sample.bodyAncestors.every((body) => body.visible),
          ),
        ),
      groundPlacementFollowsActualRoadHeight: report.missions.every(
        (mission) =>
          Math.abs(
            mission.readyOrigin.y -
              (Math.max(
                mission.site.y,
                mission.site.road ?? mission.site.terrain,
              ) +
                0.45),
          ) < 0.1,
      ),
      initialLowSpeedOverlapDoesNotDisintegrateVehicle: report.missions
        .filter((mission) => mission.site.category !== 'clear')
        .every((mission) => {
          const crash = mission.timeline.find(
            (sample) => sample.phase === 'crashed',
          );
          return !crash || crash.flightElapsed > 0.25 || crash.speed > 2;
        }),
      obstructedSiteOutcomeAccountedFor: report.missions
        .filter((mission) => mission.site.category !== 'clear')
        .every((mission) => ['space', 'crashed'].includes(mission.state.phase)),
      obstructedSiteHasRenderedBuildingDamage: report.missions
        .filter((mission) => mission.site.category !== 'clear')
        .every((mission) =>
          mission.timeline.some((sample) => sample.alteredVertices > 0),
        ),
      nearbyBuildingsReactBeforeVehicleDisintegrates: report.missions
        .filter((mission) => mission.site.category !== 'clear')
        .every((mission) =>
          mission.timeline.some(
            (sample) =>
              sample.rendered &&
              sample.phase !== 'crashed' &&
              sample.largestDeformation > 0.2,
          ),
        ),
      allFiveProductionJetVolumesActive: report.missions.every((mission) =>
        mission.timeline.some(
          (sample) =>
            sample.phase === 'ignition' &&
            sample.jetMeshes.length === 5 &&
            sample.jetMeshes.every(
              (jet) =>
                jet.visible &&
                jet.geometry === 'LatheGeometry' &&
                /Titan/.test(jet.shader),
            ),
        ),
      ),
      sideBoostersNaturallyDetachBeforeCentralCore: report.missions
        .filter((mission) => mission.state.phase === 'space')
        .every((mission) => {
          const types = mission.state.events.map((event) => event.type),
            order = [
              'core-ignition',
              'strap-on-separation',
              'core-only',
              'stage-separation',
              'upper-ignition',
              'mission-complete',
            ];
          return (
            mission.state.strapSeparation.time <
              mission.state.separation.time &&
            order.every(
              (type, index) =>
                types.indexOf(type) >= 0 &&
                (!index ||
                  types.indexOf(type) > types.indexOf(order[index - 1])),
            )
          );
        }),
      centralEngineKeepsFiringWhileFourSideEnginesAreOff: report.missions
        .filter((mission) => mission.state.phase === 'space')
        .every((mission) => {
          const samples = mission.timeline.filter(
            (sample) => sample.stage === 'strap-separating',
          );
          return (
            samples.length > 0 &&
            samples.every(
              (sample) =>
                !sample.strapAttached &&
                sample.boosterAttached &&
                sample.coreFlame &&
                sample.flames === 0 &&
                sample.stageThrust > 0,
            )
          );
        }),
      groundDustActuallySpreads: report.missions.every((mission) =>
        mission.timeline.some(
          (sample) =>
            sample.rendered &&
            sample.dustCount >= 8 &&
            sample.dustMaximumCenterRadius > 15,
        ),
      ),
      exactCityGeometryRestored: report.missions.every(
        (mission) => mission.exactCityGeometryRestored,
      ),
      requestedQualityActuallyRendered: report.missions.every((mission) =>
        mission.timeline.every((sample) => sample.quality === quality),
      ),
      damageAdaptersStayBounded: report.missions.every((mission) =>
        mission.timeline
          .filter((sample) => sample.rendered)
          .every(
            (sample) =>
              sample.surfaceAdapters.length <= 32 &&
              sample.surfaceAdapters
                .filter((surface) => surface.instanced)
                .reduce((count, surface) => count + surface.damageEntries, 0) <=
                4096 &&
              sample.surfaceAdapters
                .filter((surface) => !surface.shared)
                .reduce((count, surface) => count + surface.damageEntries, 0) <=
                240000,
          ),
      ),
      adapterOriginalGeometryRestoredAfterEveryDraw: report.missions.every(
        (mission) =>
          mission.timeline
            .filter((sample) => sample.rendered)
            .every((sample) =>
              sample.surfaceAdapters.every(
                (surface) => surface.originalGeometryRestoredAfterDraw,
              ),
            ),
      ),
      noShaderOrRuntimeErrors:
        report.errors.length === 0 &&
        !report.consoleErrors.some(
          (message) => !message.startsWith('Failed to load resource:'),
        ),
      sourceRemainedStable: report.hmr.length === 0,
    };
    if (!diagnose)
      assert(
        Object.values(report.checks).every(Boolean),
        JSON.stringify(report.checks),
      );
  }
} catch (error) {
  report.failure = String(error);
  await shot('intersection-failure.png').catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.finalSourceHashes = await sourceHashes();
  report.sourceFilesUnchanged =
    JSON.stringify(report.sourceHashes) ===
    JSON.stringify(report.finalSourceHashes);
  if (!inventoryOnly)
    report.checks.sourceRemainedStable &&= report.sourceFilesUnchanged;
  await fs.writeFile(temp + 'report.json', JSON.stringify(report, null, 2));
  const summary = {
    method: report.method,
    quality,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    checks: report.checks,
    failure: report.failure,
    errors: report.errors,
    consoleErrors: report.consoleErrors,
    httpFailures: report.httpFailures,
    hmr: report.hmr,
    sourceHashes: report.sourceHashes,
    finalSourceHashes: report.finalSourceHashes,
    sourceFilesUnchanged: report.sourceFilesUnchanged,
    images: report.screenshots.filter((name) => name.endsWith('.jpg')),
    missions: report.missions.map((mission) => ({
      roads: mission.site.names,
      category: mission.site.category,
      x: mission.site.x,
      z: mission.site.z,
      pickedGroundY: mission.site.y,
      terrainY: mission.site.terrain,
      sampledRoadY: mission.site.road,
      actualLaunchOrigin: mission.readyOrigin,
      initialCoreHit: mission.site.coreHit,
      initialHitProbes: mission.site.probes,
      outcome: mission.state.phase,
      flightSeconds: mission.state.flightElapsed,
      altitude: mission.state.altitude,
      failure: mission.state.failureReason,
      exactCityGeometryRestored: mission.exactCityGeometryRestored,
      events: mission.state.events.map(
        ({ type, time, position, magnitude }) => ({
          type,
          time,
          position,
          magnitude,
        }),
      ),
      recordedContactCount: mission.contacts.length,
      stagingSamples: mission.timeline
        .filter((sample) => sample.stage === 'strap-separating')
        .map(
          ({
            elapsed,
            flightElapsed,
            stage,
            strapAttached,
            boosterAttached,
            coreFlame,
            flames,
            stageThrust,
          }) => ({
            elapsed,
            flightSeconds: flightElapsed,
            stage,
            strapAttached,
            boosterAttached,
            coreFlame,
            sideFlames: flames,
            stageThrust,
          }),
        ),
      firstContacts: mission.contacts.slice(0, 3),
      renderedTimeline: mission.timeline
        .filter((sample) => sample.rendered)
        .map((sample) => ({
          elapsed: sample.elapsed,
          flightSeconds: sample.flightElapsed,
          phase: sample.phase,
          stage: sample.stage,
          altitude: sample.altitude,
          speed: sample.speed,
          integrity: sample.integrity,
          failureStage: sample.failureStage,
          damaged: sample.damaged,
          alteredPositionEntries: sample.alteredVertices,
          largestBuildingDisplacement: sample.largestDeformation,
          maxCollapse: sample.maxCollapse,
          dustCount: sample.dustCount,
          dustMaximumCenterRadius: sample.dustMaximumCenterRadius,
          visibleJets: sample.jetMeshes.filter((jet) => jet.visible).length,
          surfaceAdapters: sample.surfaceAdapters,
          renderer: sample.renderer,
          contactVolumeTops: sample.contactVolumes.map(
            ({ max, originalTop }) => ({ currentTop: max[1], originalTop }),
          ),
        })),
    })),
  };
  await fs.writeFile(temp + 'summary.json', JSON.stringify(summary, null, 2));
  await browser.close();
  const target = new URL(
    `../work/rocket-intersection-${quality}-qa/`,
    import.meta.url,
  );
  await fs.mkdir(target, { recursive: true });
  await fs.cp(temp, target, { recursive: true });
  console.log(
    'RESULT',
    JSON.stringify({
      checks: report.checks,
      failure: report.failure,
      errors: report.errors,
      path: new URL('report.json', target).pathname,
    }),
  );
}
if (
  report.failure ||
  report.errors.length ||
  (!diagnose && Object.values(report.checks).some((value) => !value))
)
  process.exitCode = 1;
