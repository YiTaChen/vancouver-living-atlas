/** LOCAL VISUAL QA: same-pose offline asset comparisons, never a production UI. */
import type { CityEngine } from './engine';
import { selectCitizenAssetForQA, type CitizenQAVariant } from './citizen';
import { project } from './geo';
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

  let tree:
    | NonNullable<CityEngine['detailedTrees']>['trees'][number]
    | undefined;
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
            quality: 'high',
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
