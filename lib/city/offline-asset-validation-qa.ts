/** LOCAL VISUAL QA: same-pose offline asset comparisons, never a production UI. */
import type { CityEngine } from './engine';
import { selectCitizenAssetForQA, type CitizenQAVariant } from './citizen';
import { hash, project } from './geo';
import { ROOFTOP_EQUIPMENT, ROOFTOP_TEMPLATES } from './rooftop-equipment';
import {
  clearQAOrbitMomentum,
  captureQAPose,
  qaPoseError,
} from './upgrade-qa-pose';

type Lease = { begin(): boolean; end(): void; isRunning(): boolean };

export function installOfflineAssetValidationQA(
  e: CityEngine,
  parent: HTMLElement,
  lease: Lease,
  measureCitizen: () => void,
) {
  const field = document.createElement('fieldset');
  field.setAttribute('aria-label', 'Offline asset comparisons');
  const legend = document.createElement('legend');
  legend.textContent =
    'Offline assets: explicit variant and same-pose evidence';
  const status = document.createElement('p');
  status.id = 'offline-asset-status';
  status.textContent =
    'Baseline defaults. Select a candidate, then capture its exact pose.';
  field.appendChild(legend);
  field.appendChild(status);
  parent.appendChild(field);
  const button = (text: string, action: () => void) => {
    const node = document.createElement('button');
    node.textContent = text;
    node.onclick = action;
    field.appendChild(node);
    return node;
  };
  async function change(action: () => Promise<unknown>, label: string) {
    if (e.disposed || !lease.begin()) return;
    status.textContent = `Loading ${label}`;
    try {
      await action();
      status.textContent = `Ready ${label}: ${JSON.stringify({
        citizen: e.navigation?.walker.group.userData,
        tree: e.detailedTrees?.getMaterialCandidateState(),
        treeGeometry: e.detailedTrees?.getGeometryCandidateState?.(),
        trafficGeometry: e.traffic?.vehicleAssets?.stats,
        rooftopGeometry: rooftopEvidence(),
      })}`;
    } catch (error) {
      status.textContent = `Asset switch failed: ${error}`;
    } finally {
      lease.end();
    }
  }
  for (const variant of [
    'baseline-2048',
    'candidate-1024',
  ] as CitizenQAVariant[])
    button(
      `Citizen ${variant}`,
      () =>
        void change(async () => {
          if (!e.navigation) throw new Error('Navigation unavailable');
          await selectCitizenAssetForQA(e.navigation.walker.group, variant);
        }, variant),
    );
  button('Measure selected citizen', measureCitizen);
  for (const variant of ['baseline', 'leaf-rgba'] as const)
    button(
      `Tree materials ${variant}`,
      () =>
        void change(async () => {
          if (
            !e.detailedTrees ||
            !(await e.detailedTrees.setMaterialCandidate(variant))
          )
            throw new Error('Tree candidate failed to load');
        }, variant),
    );
  for (const variant of ['baseline', 'blender'] as const)
    button(
      `Tree geometry ${variant}`,
      () =>
        void change(async () => {
          if (!e.detailedTrees || !(await e.detailedTrees.setGeometryCandidate(variant)))
            throw new Error('Tree geometry candidate failed to load');
        }, `tree geometry ${variant}`),
    );
  for (const enabled of [false, true])
    button(
      `Traffic geometry ${enabled ? 'blender' : 'baseline'}`,
      () => void change(async () => {
        if (!e.traffic?.vehicleAssets?.setEnabled(enabled))
          throw new Error('Traffic geometry comparison unavailable');
      }, `traffic geometry ${enabled ? 'blender' : 'baseline'}`),
    );
  let rooftopEnabled = true;
  function rooftopEvidence() {
    const architecture = e.architecturalDetails;
    if (!architecture) return null;
    const batches: { name: string; count: number; trianglesPerInstance: number }[] = [];
    architecture.root.traverse((object) => {
      if (!object.userData.rooftopEquipment) return;
      const mesh = object as import('three').InstancedMesh;
      if (!mesh.isInstancedMesh || !mesh.visible) return;
      for (let ancestor = mesh.parent; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
      batches.push({ name: mesh.name, count: mesh.count, trianglesPerInstance: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 });
    });
    return { enabled: rooftopEnabled, stats: { ...architecture.rooftopEquipment.stats }, admittedUnits: architecture.stats.rooftopUnits, batches, admission: ROOFTOP_EQUIPMENT, sourceTemplates: ROOFTOP_TEMPLATES };
  }
  for (const enabled of [false, true])
    button(
      `Rooftop geometry ${enabled ? 'blender' : 'baseline'}`,
      () => void change(async () => {
        if (!e.architecturalDetails) throw new Error('Rooftop geometry comparison unavailable');
        e.architecturalDetails.setRooftopEnabled(enabled);
        rooftopEnabled = enabled;
      }, `rooftop geometry ${enabled ? 'blender' : 'baseline'}`),
    );

  async function captureSourceTraffic(enabled: boolean) {
    if (e.disposed || !lease.begin()) return;
    const variant = enabled ? 'blender' : 'baseline';
    let hidden = document.hidden;
    const visibility = () => { hidden ||= document.hidden; };
    document.addEventListener('visibilitychange', visibility);
    const frame = () => new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No visible animation frame')), 3000);
      requestAnimationFrame(() => {
        window.clearTimeout(timeout);
        if (hidden || document.hidden || e.disposed || e.contextLost) reject(new Error('Hidden, disposed or lost WebGL context'));
        else resolve();
      });
    });
    try {
      status.textContent = `Preparing source traffic car ${variant}`;
      const traffic = e.traffic;
      if (!traffic || traffic.vehicleAssets.stats.status !== 'ready') throw new Error('Traffic templates are not ready; retry after loading');
      const routeIndex = traffic.routes.findIndex((r) => r.length > 0 && [r.length, r.speed, r.phase, ...r.a, ...r.b].every(Number.isFinite));
      if (routeIndex < 0) throw new Error('No valid source traffic route');
      const route = traffic.routes[routeIndex];
      const yaw = Math.atan2(route.b[0] - route.a[0], route.b[1] - route.a[1]);
      const sourceAt = (timeSeconds: number) => {
        const phase = (route.phase + timeSeconds * route.speed / route.length) % 1;
        const x = route.a[0] + (route.b[0] - route.a[0]) * phase;
        const z = route.a[1] + (route.b[1] - route.a[1]) * phase;
        const fallback = (e.data.roadRelief?.(x, z) ?? e.elevation(x, z)) + 1.05;
        const roadGround = e.data.roadSurface?.sample(x, z, fallback) ?? fallback;
        if (![x, z, roadGround].every(Number.isFinite)) throw new Error('Non-finite source traffic ground');
        return { timeSeconds, phase, x, z, roadGround, fallback };
      };
      if (!traffic.vehicleAssets.setEnabled(enabled)) throw new Error('Traffic comparison unavailable');
      e.navigation?.keys.clear();
      e.navigation?.setMode('orbit');
      e.transition = null;
      e.applySettings({ ...e.settings, mode: 'orbit', qualityMode: 'manual', quality: 'high', traffic: true, labels: false, autoRotate: false });
      clearQAOrbitMomentum(e.controls);
      e.controls.enabled = false;
      // Keep the live elapsed-time traffic and city clock running. This is an
      // appearance probe, not a frozen-phase or same-position performance sample.
      e.setClock({ hour: 14, running: true });
      e.setAtmosphere('clear');
      e.renderer.setPixelRatio(1);
      e.renderer.setSize(1920, 1080, false);
      e.composer?.setPixelRatio(1);
      e.composer?.setSize(1920, 1080);
      e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
      e.camera.aspect = 1920 / 1080;
      e.camera.fov = 42;
      e.camera.near = 0.15;
      e.controls.minDistance = 0.5;
      const framed = sourceAt(performance.now() / 1000);
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      e.camera.position.set(framed.x - dx * 20 + dz * 15, framed.roadGround + 10, framed.z - dz * 20 - dx * 15);
      e.controls.target.set(framed.x, framed.roadGround + 1, framed.z);
      e.camera.updateProjectionMatrix();
      e.controls.update();
      e.renderer.shadowMap.needsUpdate = true;
      const expectedPose = captureQAPose(e.camera, e.controls);
      await frame();
      await frame();
      const captured = sourceAt(Number(e.uniforms.time.value));
      const gl = e.renderer.getContext();
      const programs = e.renderer.info.programs ?? [];
      const linked = (program: (typeof programs)[number]) => Boolean(program.program) && gl.getProgramParameter(program.program as WebGLProgram, gl.LINK_STATUS) === true;
      const shaderReady = programs.length > 0 && programs.every(linked) && (!enabled || programs.some((p) => p.cacheKey.includes('traffic-source-wheel-v1') && linked(p)));
      const trafficReady = traffic.vehicleAssets.stats.status === 'ready' && (enabled ? traffic.vehicleAssets.group.visible && traffic.vehicleAssets.stats.actors === traffic.routes.length && traffic.vehicleAssets.stats.lodCounts[0] > 0 : traffic.mesh.visible && traffic.cabins.visible);
      const ndc = e.controls.target.clone().set(captured.x, captured.roadGround + 1, captured.z).project(e.camera);
      const valid = !hidden && !document.hidden && !e.disposed && !e.contextLost && !gl.isContextLost() && shaderReady && trafficReady && qaPoseError(e.camera, e.controls, expectedPose) < 0.05 && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9 && ndc.z > -1 && ndc.z < 1;
      if (!valid) throw new Error('Traffic moved out of view, shader/load not ready, hidden or lost context; no capture saved');
      const model = hash(routeIndex + 91) < 0.28 ? 'suv' : 'sedan';
      const row = {
        kind: 'source-traffic-appearance-v1', valid, variant, shaderReady, trafficReady,
        performanceNowSeconds: performance.now() / 1000,
        framed, captured, routeIndex, route: { ...route, a: [...route.a], b: [...route.b] }, yaw,
        camera: e.camera.position.toArray(), target: e.controls.target.toArray(), expectedPose,
        projectedSource: ndc.toArray(), render: [e.renderer.domElement.width, e.renderer.domElement.height],
        quality: e.settings.quality, atmosphere: 'clear', requestedHour: 14, clock: e.clock.snapshot(),
        trafficGeometry: { ...traffic.vehicleAssets.stats, lodCounts: [...traffic.vehicleAssets.stats.lodCounts] },
        routePopulation: traffic.routes.length, roadGround: captured.roadGround,
        vehicle: {
          selectedGeometry: enabled ? model : 'legacy-body-and-cabin', sourceVariant: model,
          authoredBoundsM: model === 'suv' ? { min: [-0.96, 0, -2.277], max: [0.96, 1.76, 2.382] } : { min: [-0.93, 0, -2.202], max: [0.93, 1.48, 2.307] },
          boundsBasis: 'Delivered traffic-car-templates bounds rounded to 1 mm; unit-scale wheel-contact datum, +Z forward; runtime close LOD fits front/rear and cross-road samples. Legacy box origin remains roadRelief/elevation +1.8 m.',
        },
        protocol: 'Single appearance capture of an existing route actor after two visible RAF updates, High 1920x1080, side/rear 25 m and ground +10 m. Traffic and solar clock keep running; no actor is created, teleported or frozen. Baseline and Blender are separate live-phase views, not matched-phase FPS evidence.',
      };
      const response = await fetch('/__visual-qa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `source-traffic-${variant}`, row, screenshot: e.screenshot() }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Traffic capture upload failed (${response.status})`);
      status.textContent = `Saved source-traffic-${variant}: existing ${model}, route ${routeIndex}, live phase ${captured.phase.toFixed(4)}`;
    } catch (error) {
      status.textContent = `Source traffic capture failed: ${error}`;
    } finally {
      document.removeEventListener('visibilitychange', visibility);
      e.navigation?.keys.clear();
      if (!e.disposed) e.controls.enabled = e.navigation?.mode === 'orbit';
      lease.end();
    }
  }
  for (const enabled of [false, true])
    button(`Capture source traffic car ${enabled ? 'blender' : 'baseline'}`, () => void captureSourceTraffic(enabled));

  let tree:
    | NonNullable<CityEngine['detailedTrees']>['trees'][number]
    | undefined;
  for (const quality of ['high', 'ultra'] as const)
    button(`Asset comparison ${quality}`, () => {
      if (lease.isRunning()) return;
      e.applySettings({ ...e.settings, qualityMode: 'manual', quality });
      e.detailedTrees?.update(true);
      status.textContent = `Comparison quality: ${quality}`;
    });
  for (const conifer of [false, true])
    for (const distance of [10, 30, 65])
      button(
        `Frame ${conifer ? 'conifer' : 'broadleaf'} tree ${distance}m`,
        () => {
          if (lease.isRunning() || !e.detailedTrees) return;
          // Select an existing source tree in a park clearing; no artificial population.
          if (!tree || tree.conifer !== conifer) {
            const [x, z] = project([-123.149, 49.294]);
            tree = e.detailedTrees.trees
              .filter((t) => t.conifer === conifer && t.h >= 6)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
              )[0];
          }
          if (!tree) {
            status.textContent = 'No matching source tree';
            return;
          }
          e.navigation?.keys.clear();
          e.navigation?.setMode('orbit');
          e.transition = null;
          e.applySettings({
            ...e.settings,
            mode: 'orbit',
            qualityMode: 'manual',
            quality: e.settings.quality === 'ultra' ? 'ultra' : 'high',
            labels: false,
            autoRotate: false,
          });
          clearQAOrbitMomentum(e.controls);
          e.controls.enabled = true;
          e.setClock({ hour: 14, running: false });
          e.setAtmosphere('clear');
          e.camera.fov = 48;
          e.camera.near = 0.15;
          e.controls.minDistance = 0.5;
          e.camera.position.set(
            tree.x + distance * 0.65,
            tree.y + tree.h * 0.55 + 2,
            tree.z + distance * 0.76,
          );
          e.controls.target.set(tree.x, tree.y + tree.h * 0.55, tree.z);
          e.controls.update();
          e.data.offlineTreeProbe = {
            x: tree.x,
            y: tree.y,
            z: tree.z,
            height: tree.h,
            seed: tree.seed,
            conifer,
            distance,
          };
          status.textContent = `Framed existing tree: ${JSON.stringify(e.data.offlineTreeProbe)}`;
        },
      );
  const name = document.createElement('input');
  name.setAttribute('aria-label', 'Asset checkpoint name');
  name.value = 'offline-checkpoint';
  field.appendChild(name);
  const sweepLabel = document.createElement('label');
  sweepLabel.textContent = 'Capture four lighting conditions ';
  const sweep = document.createElement('input');
  sweep.type = 'checkbox';
  sweep.checked = true;
  sweepLabel.appendChild(sweep);
  field.appendChild(sweepLabel);

  async function sample(
    ms: number,
    pose: ReturnType<typeof captureQAPose>,
    ready: () => boolean = () => true,
    maxMs = ms,
  ) {
    const gaps: number[] = [];
    let hidden = document.hidden,
      error = 0,
      last = performance.now();
    const started = last;
    const visibility = () => {
      hidden ||= document.hidden;
    };
    document.addEventListener('visibilitychange', visibility);
    try {
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          hidden ||= document.hidden;
          error = Math.max(error, qaPoseError(e.camera, e.controls, pose));
          gaps.push(now - last);
          last = now;
          if (
            e.disposed ||
            now - started >= maxMs ||
            (now - started >= ms && ready())
          )
            resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    } finally {
      document.removeEventListener('visibilitychange', visibility);
    }
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      valid: !hidden && !e.disposed && error < 0.05,
      hidden,
      maxPoseError: error,
      sampleMs: last - started,
      frames: gaps.length,
      fps: (gaps.length * 1000) / (last - started),
      p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    };
  }
  button(
    'Save asset checkpoint',
    () =>
      void (async () => {
        if (!/^[a-z0-9-]+$/.test(name.value) || e.disposed || !lease.begin())
          return;
        const label = name.value;
        try {
          e.controls.enabled = false;
          e.renderer.setPixelRatio(1);
          e.renderer.setSize(1920, 1080, false);
          e.composer?.setPixelRatio(1);
          e.composer?.setSize(1920, 1080);
          e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
          e.camera.aspect = 1920 / 1080;
          e.camera.updateProjectionMatrix();
          const pose = captureQAPose(e.camera, e.controls);
          const isReady = () => {
            const architecture = e.architecturalDetails?.stats;
            const modules = e.data.architectureModuleCandidate?.snapshot?.();
            const leaves = e.detailedTrees?.getMaterialCandidateState();
            const treeGeometry = e.detailedTrees?.getGeometryCandidateState?.();
            const trafficGeometry = e.traffic?.vehicleAssets?.stats;
            const rooftopGeometry = e.architecturalDetails?.rooftopEquipment.stats;
            return (
              (!architecture ||
                (architecture.pendingCells === 0 &&
                  architecture.readySelectedCells ===
                    architecture.selectedCells)) &&
              (!modules ||
                modules.status === 'off' ||
                (modules.status === 'ready' &&
                  modules.sharedAtlasReady &&
                  modules.visibleReplacements > 0)) &&
              (!leaves ||
                leaves.active === 'baseline' ||
                leaves.status === 'ready') &&
              (!treeGeometry || e.settings.quality !== 'ultra' || treeGeometry.active === 'baseline' || treeGeometry.status === 'ready') &&
              (!trafficGeometry || !trafficGeometry.enabled || trafficGeometry.status === 'ready') &&
              (!rooftopGeometry || !rooftopEnabled || rooftopGeometry.selectedCells === 0 || rooftopGeometry.status === 'ready') &&
              (e.navigation?.mode !== 'walk' ||
                e.navigation.walker.group.userData.assetState === 'ready')
            );
          };
          const conditions = [
            ['clear', 'clear', 14],
            ['overcast', 'overcast', 14],
            ['dusk', 'clear', 19.8],
            ['night', 'clear', 23],
          ] as const;
          for (const [condition, atmosphere, hour] of sweep.checked
            ? conditions
            : conditions.slice(0, 1)) {
            status.textContent = `Preparing ${label} / ${condition}`;
            e.setAtmosphere(atmosphere);
            e.setClock({ hour, running: false });
            e.renderer.shadowMap.needsUpdate = true;
            const warmup = await sample(5000, pose, isReady, 30000);
            const readyBefore = isReady();
            status.textContent = `Measuring ${label} / ${condition}`;
            const measured = await sample(8000, pose);
            const architecture = e.architecturalDetails?.stats;
            const modules =
              e.data.architectureModuleCandidate?.snapshot?.() ?? null;
            const leaves = e.detailedTrees?.getMaterialCandidateState();
            const ready = readyBefore && isReady();
            const gl = e.renderer.getContext(),
              ext = gl.getExtension('WEBGL_debug_renderer_info');
            const row = {
              kind: 'offline-asset-checkpoint-v1',
              ...measured,
              valid: measured.valid && warmup.valid && ready,
              warmup,
              ready,
              quality: e.settings.quality,
              atmosphere,
              hour,
              expectedPose: pose,
              camera: e.camera.position.toArray(),
              target: e.controls.target.toArray(),
              mode: e.navigation?.mode,
              render: [
                e.renderer.domElement.width,
                e.renderer.domElement.height,
              ],
              calls: e.renderer.info.render.calls,
              triangles: e.renderer.info.render.triangles,
              geometries: e.renderer.info.memory.geometries,
              textures: e.renderer.info.memory.textures,
              architecture,
              modules,
              citizen: e.navigation?.walker.group.userData,
              tree: leaves,
              treeGeometry: e.detailedTrees?.getGeometryCandidateState?.() ?? null,
              trafficGeometry: e.traffic?.vehicleAssets?.stats ?? null,
              rooftopGeometry: rooftopEvidence(),
              treeProbe: e.data.offlineTreeProbe ?? null,
              treePools: e.detailedTrees?.pools.map((p) => ({
                count: p.count,
                map: (
                  p.foliage.material as import('three').MeshStandardMaterial
                ).map?.name,
                shadowMapMatches:
                  (p.foliage.material as import('three').MeshStandardMaterial)
                    .map ===
                  (
                    p.foliage
                      .customDepthMaterial as import('three').MeshDepthMaterial
                  )?.map,
              })),
              renderer: ext
                ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER),
              protocol:
                'Actual fixed1080p renderer; unchanged camera and selected source objects; visible5s warmup and8s uninstrumented RAF sample per lighting condition. Draw counters include all render passes. No synthetic asset movement.',
            };
            const response = await fetch('/__visual-qa', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `${label}-${condition}`,
                row,
                screenshot: e.screenshot(),
              }),
            });
            if (!response.ok || !row.valid)
              throw new Error('Hidden, unsettled or drifting checkpoint');
          }
          status.textContent = `Saved ${label}: ${sweep.checked ? 4 : 1} valid actual renderer checkpoints`;
        } catch (error) {
          status.textContent = `Checkpoint failed: ${error}`;
        } finally {
          lease.end();
          e.controls.enabled = e.navigation?.mode === 'orbit';
        }
      })(),
  );
}
