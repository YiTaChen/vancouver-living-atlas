/** LOCAL VISUAL QA: matched-resolution city, street and character evidence. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';
import { QACPUProfile } from './qa-cpu-profile';
import { installArchitectureModuleCandidateQA } from './architecture-module-candidate-qa';
import { project } from './geo';
import { sampleAtmosphere, type AtmosphereMode } from './atmosphere';
import {
  CITY_MATERIAL_MANIFEST,
  getCityMaterialLibrary,
} from './material-library';
import { RESIDENTIAL_GROUND_LIMITS } from './residential-ground-plan';
import {
  DOMESTIC_QA_VIEWS,
  selectDomesticQA,
  type DomesticQAView,
} from './domestic-qa';
import {
  MODERN_BAY_QA_VIEWS,
  selectModernBayQA,
  modernBayQAState,
  restoreModernBayQA,
  type ModernBayQAView,
} from './modern-bay-qa';
import {
  clearQAOrbitMomentum,
  captureQAPose,
  qaPoseError,
} from './upgrade-qa-pose';

/** Local evidence only; inspect existing atlas ownership without initiating a
 * second load. Three named textures prove the shared library was initialized by
 * the production scene before its cached readiness uniform is read. */
function materialEvidence(e: CityEngine) {
  const atlasNames = ['color', 'normal', 'orm'].map(
    (name) => `Shared city material ${name}`,
  );
  const owned = [...(e.extraTextures ?? [])].filter((texture) =>
    atlasNames.includes(texture.name),
  );
  const initialized = atlasNames.every((name) =>
    owned.some((texture) => texture.name === name),
  );
  const library = initialized ? getCityMaterialLibrary(e) : null;
  return {
    manifestVersion: CITY_MATERIAL_MANIFEST.version,
    slots: CITY_MATERIAL_MANIFEST.materials.map((material) => material.id),
    atlas: CITY_MATERIAL_MANIFEST.atlas,
    mapFiles: CITY_MATERIAL_MANIFEST.files,
    initialized,
    ready: library?.ready.value === 1 && !e.disposed,
    ownedTextures: owned.length,
    fallback:
      'Catalogue average colors and surface response while atlas maps are unavailable.',
  };
}

export function upgradeSceneEvidence(e: CityEngine) {
  const report = e.data?.residentialGround;
  const examples = (report?.examples ?? []) as {
    key: string;
    center: number[];
  }[];
  const target = e.controls?.target;
  const nearby = target
    ? examples
        .map((example) => ({
          ...example,
          distanceToTargetM: Math.hypot(
            example.center[0] - target.x,
            example.center[1] - target.z,
          ),
        }))
        .sort((a, b) => a.distanceToTargetM - b.distanceToTargetM)
    : [];
  return {
    atmosphere: e.atmosphere,
    architectureModuleCandidate: e.data?.architectureModuleCandidate?.snapshot?.() ?? null,
    sharedMaterials: materialEvidence(e),
    residentialGround: report
      ? {
          candidates: report.candidates,
          plots: report.plots,
          beds: report.beds,
          plants: report.plants,
          triangles: report.triangles,
          batches: report.batches,
          limits: RESIDENTIAL_GROUND_LIMITS,
          maximumTriangles:
            RESIDENTIAL_GROUND_LIMITS.plots *
            2 *
            (RESIDENTIAL_GROUND_LIMITS.maxBedTriangles + 14),
          withinCaps:
            report.plots <= RESIDENTIAL_GROUND_LIMITS.plots &&
            report.beds <= RESIDENTIAL_GROUND_LIMITS.plots * 2 &&
            report.triangles <=
              RESIDENTIAL_GROUND_LIMITS.plots *
                2 *
                (RESIDENTIAL_GROUND_LIMITS.maxBedTriangles + 14),
          nearbyPlotsWithin90m: nearby.filter(
            (example) => example.distanceToTargetM <= 90,
          ).length,
          nearestSourceExamples: nearby.slice(0, 8),
          note: 'Representative foundation planting selected from existing domestic-cladding profiles; nearby counts are geographic coverage, not on-screen visibility.',
        }
      : null,
  };
}

const VIEWS = [
  'atlas-aerial',
  'gastown-roofs',
  'gastown-street',
  'citizen',
] as const;
type View = (typeof VIEWS)[number];
const WIDTH = 1920,
  HEIGHT = 1080;

type QARunLease = {
  isRunning(): boolean;
  begin(): boolean;
  end(): void;
};

export function installUpgradeQA(
  e: CityEngine,
  parent: HTMLElement,
  lease?: QARunLease,
) {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'City quality upgrade checks');
  section.style.cssText = 'border:1px solid #b6cd85;padding:8px;margin:8px 0';
  const status = document.createElement('p');
  status.id = 'upgrade-qa-status';
  status.textContent = 'Matched 1920 × 1080 · 14:00 · four scales';
  section.appendChild(status);
  parent.insertBefore(section, parent.firstChild);
  const cpuLabel = document.createElement('label');
  const cpuToggle = document.createElement('input');
  cpuToggle.type = 'checkbox';
  cpuLabel.textContent = 'Record CPU method timings (instrumented) ';
  cpuLabel.appendChild(cpuToggle);
  section.appendChild(cpuLabel);
  let busy = false;
  installArchitectureModuleCandidateQA(e, section, () => busy || lease?.isRunning() === true);
  let expectedPose: ReturnType<typeof captureQAPose> | null = null;
  function fixedResolution() {
    e.renderer.setPixelRatio(1);
    e.renderer.setSize(WIDTH, HEIGHT, false);
    e.composer?.setPixelRatio(1);
    e.composer?.setSize(WIDTH, HEIGHT);
    e.fxaa?.uniforms.resolution.value.set(1 / WIDTH, 1 / HEIGHT);
    e.camera.aspect = WIDTH / HEIGHT;
    e.camera.updateProjectionMatrix();
  }
  function select(view: View, quality: VisualQuality) {
    restoreModernBayQA(e);
    e.setAtmosphere('clear');
    const nav = e.navigation!;
    nav.keys.clear();
    nav.setMode('orbit');
    e.transition = null;
    e.applySettings({
      ...e.settings,
      quality,
      mode: 'orbit',
      labels: false,
      autoRotate: false,
    });
    clearQAOrbitMomentum(e.controls);
    e.controls.enabled = !busy;
    e.setClock({ hour: 14, running: false });
    e.camera.fov = 48;
    e.camera.near = 0.15;
    e.controls.maxPolarAngle = Math.PI * 0.499;
    if (view === 'atlas-aerial' || view === 'gastown-roofs') {
      const [x, z] = project(
        view === 'atlas-aerial' ? [-123.116, 49.2847] : [-123.1078, 49.2838],
      );
      const y = e.elevation(x, z);
      if (view === 'atlas-aerial') {
        e.camera.position.set(x + 650, y + 480, z + 780);
        e.controls.target.set(x - 180, y + 65, z - 80);
      } else {
        e.camera.position.set(x + 70, y + 105, z + 115);
        e.controls.target.set(x, y + 16, z);
      }
      e.controls.update();
    } else {
      nav.setMode('walk', 'WATER ST');
      if (nav.mode !== 'walk')
        throw new Error('Water Street QA placement failed');
      e.applySettings({ ...e.settings, mode: 'walk' });
      nav.cameraDistances.walk = view === 'citizen' ? 4.2 : 0;
      nav.pitch = view === 'citizen' ? 0.08 : 0;
      nav.snapCamera = true;
      nav.update(0);
    }
    e.ensureSSAO();
    fixedResolution();
    e.renderer.shadowMap.needsUpdate = true;
    expectedPose = captureQAPose(e.camera, e.controls);
  }
  async function collect(
    duration: number,
    ready: () => boolean = () => true,
    maxDuration = duration,
  ) {
    const gaps: number[] = [];
    let maxPoseError = 0;
    let last = performance.now(),
      hidden = document.hidden;
    const start = last;
    const visibility = () => {
      hidden ||= document.hidden;
    };
    document.addEventListener('visibilitychange', visibility);
    try {
      await new Promise<void>((resolve) => {
        const frame = (now: number) => {
          hidden ||= document.hidden;
          if (expectedPose)
            maxPoseError = Math.max(
              maxPoseError,
              qaPoseError(e.camera, e.controls, expectedPose),
            );
          gaps.push(now - last);
          last = now;
          if (
            e.disposed ||
            now - start >= maxDuration ||
            (now - start >= duration && ready())
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
    const percentile = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
    return {
      valid: !hidden && !e.disposed && maxPoseError < 0.05,
      maxPoseError,
      sampleMs: last - start,
      frames: gaps.length,
      fps: (gaps.length * 1000) / (last - start),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: Math.max(...gaps),
      over50Ms: gaps.filter((n) => n > 50).length,
      over100Ms: gaps.filter((n) => n > 100).length,
    };
  }
  async function suite(quality: VisualQuality) {
    if (busy || lease?.begin() === false) return;
    busy = true;
    const instrumented = cpuToggle.checked;
    cpuToggle.disabled = true;
    try {
      for (const view of VIEWS) {
        status.textContent = `Preparing ${view} / ${quality}`;
        select(view, quality);
        // Compare fully warmed views. Streaming latency remains explicit evidence,
        // and a hidden warmup or incomplete selected set invalidates the capture.
        const detailReady = () => {
          const stats = e.architecturalDetails?.stats;
          const kit = e.streetscapeKit?.snapshot();
          const street = view === 'gastown-street' || view === 'citizen';
          return (
            materialEvidence(e).ready &&
            (!stats ||
              (stats.pendingCells === 0 &&
                stats.readySelectedCells === stats.selectedCells)) &&
            (!kit ||
              (!kit.loading &&
                !kit.failed &&
                kit.pendingCells === 0 &&
                (!kit.selectedBays || kit.loaded) &&
                (!street || kit.visibleBays > 0))) &&
            (!street ||
              e.compatibleGraphics ||
              e.navigation?.walker.group.userData.assetState === 'ready')
          );
        };
        const warmup = await collect(5000, detailReady, 30000);
        const settled = detailReady();
        const architectureAtSettle = e.architecturalDetails
          ? { ...e.architecturalDetails.stats }
          : null;
        fixedResolution();
        status.textContent = `Measuring ${view} / ${quality}`;
        const cpu = instrumented ? new QACPUProfile() : null;
        if (cpu) {
          cpu.wrap(e, 'renderScene', 'renderScene');
          cpu.wrap(e.renderer, 'render', 'renderer.render');
          if (e.ssao) cpu.wrap(e.ssao, 'render', 'ssao.render');
          if (e.navigation) cpu.wrap(e.navigation, 'update', 'navigation.update');
          if (e.detailedTrees) cpu.wrap(e.detailedTrees, 'update', 'trees.update');
          if (e.architecturalDetails) cpu.wrap(e.architecturalDetails, 'update', 'architecture.update');
          if (e.streetscapeKit) cpu.wrap(e.streetscapeKit, 'update', 'streetscape.update');
          if (e.facadeDetails) cpu.wrap(e.facadeDetails, 'update', 'facades.update');
          if (e.interiors) cpu.wrap(e.interiors, 'update', 'interiors.update');
        }
        let cpuProfile: ReturnType<QACPUProfile['stop']> | null = null;
        const sample = await collect(8000).finally(() => { cpuProfile = cpu?.stop() ?? null; });
        const gl = e.renderer.getContext();
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const row = {
          kind: 'upgrade-matched-v1',
          ...upgradeSceneEvidence(e),
          atmosphere: e.atmosphere,
          paving: e.data.pavementStats,
          id: view,
          quality,
          ...sample,
          instrumented,
          cpuProfile,
          valid:
            sample.valid &&
            warmup.valid &&
            settled &&
            e.renderer.domElement.width === WIDTH &&
            e.renderer.domElement.height === HEIGHT,
          expectedPose,
          hour: e.clock.hour,
          fov: e.camera.fov,
          viewport: [innerWidth, innerHeight],
          render: [e.renderer.domElement.width, e.renderer.domElement.height],
          camera: e.camera.position.toArray(),
          target: e.controls.target.toArray(),
          mode: e.navigation!.mode,
          position: e.navigation!.position.toArray(),
          calls: e.renderer.info.render.calls,
          triangles: e.renderer.info.render.triangles,
          geometries: e.renderer.info.memory.geometries,
          textures: e.renderer.info.memory.textures,
          settleMs: warmup.sampleMs,
          warmupVisible: warmup.valid,
          detailReady: settled,
          architectureAtSettle,
          architecture: e.architecturalDetails
            ? { ...e.architecturalDetails.stats }
            : null,
          streetscape: e.streetscapeKit?.snapshot() ?? null,
          shadowCoverage: e.shadowCoverageState,
          ssaoExclusions: e.aoExclusions ? { ...e.aoExclusions.stats } : null,
          citizen:
            e.navigation?.walker.group.userData.assetState ??
            'procedural-compatible',
          renderer: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          protocol:
            'Fixed 1920x1080 drawing buffer; 14h; warm-up at least 5s and until selected architecture and applicable street/citizen assets are ready, capped at 30s; 8s visible RAF sample. settleMs reports streaming wait separately; hidden warm-up or detail timeout invalidates capture. Render counters include multipass work, not unique geometry.',
        };
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${quality}-${view}${instrumented ? '-cpu' : ''}`,
            row,
            screenshot: e.screenshot(),
          }),
        });
        if (!response.ok || !row.valid)
          throw new Error(
            `Capture failed or camera/readiness invalid: ${response.status}`,
          );
      }
      status.textContent = `Completed matched ${quality}: 4 views`;
    } catch (error) {
      status.textContent = `Upgrade check failed: ${error}`;
    } finally {
      busy = false;
      cpuToggle.disabled = false;
      e.controls.enabled = e.navigation?.mode === 'orbit';
      lease?.end();
    }
  }
  for (const quality of ['high', 'ultra'] as const) {
    const button = document.createElement('button');
    button.textContent = `Upgrade matched ${quality}`;
    button.style.cssText = 'padding:8px;margin:3px;border:1px solid #b6cd85';
    button.onclick = () => void suite(quality);
    section.appendChild(button);
  }
  for (const view of VIEWS) {
    const button = document.createElement('button');
    button.textContent = `Upgrade preview ${view}`;
    button.onclick = () => {
      if (busy || lease?.isRunning()) return;
      select(view, e.settings.quality);
      status.textContent = `Preview ${view} / ${e.settings.quality}`;
    };
    section.appendChild(button);
  }
  const inspect = document.createElement('button');
  inspect.textContent = 'Inspect upgrade assets';
  inspect.onclick = () => {
    if (busy || lease?.isRunning()) return;
    status.textContent = JSON.stringify({
      ...upgradeSceneEvidence(e),
      architecture: e.architecturalDetails?.stats,
      streetscape: e.streetscapeKit?.snapshot(),
      citizen: e.navigation?.walker.group.userData,
    });
  };
  section.appendChild(inspect);
  const motion = document.createElement('button');
  motion.textContent = 'Upgrade citizen motion 8s';
  motion.onclick = async () => {
    if (busy || lease?.begin() === false) return;
    busy = true;
    const nav = e.navigation!;
    let hidden = document.hidden;
    const visibility = () => {
      hidden ||= document.hidden;
      if (hidden) nav.keys.clear();
    };
    document.addEventListener('visibilitychange', visibility);
    try {
      select('citizen', e.settings.quality);
      expectedPose = null; // This check intentionally follows real navigation.
      status.textContent = 'Preparing citizen motion';
      const warmup = await collect(
        5000,
        () => nav.walker.group.userData.assetState === 'ready',
        30000,
      );
      if (!warmup.valid || nav.walker.group.userData.assetState !== 'ready')
        throw new Error('Citizen did not become ready in a visible page');
      const startDistance = nav.walkingDistance;
      const startPosition = nav.position.toArray();
      nav.keys.add('w');
      for (const seconds of [2, 4, 8]) {
        status.textContent = `Recording citizen motion ${seconds}s`;
        const sample = await collect(seconds === 8 ? 4000 : 2000);
        const row = {
          kind: 'upgrade-citizen-motion-v1',
          seconds,
          ...sample,
          valid: sample.valid && !hidden && nav.walkingDistance > startDistance,
          quality: e.settings.quality,
          mode: nav.mode,
          startPosition,
          position: nav.position.toArray(),
          distance: nav.walkingDistance - startDistance,
          citizen: nav.walker.group.userData,
          render: [e.renderer.domElement.width, e.renderer.domElement.height],
          protocol:
            'Existing W navigation input, third-person camera, unchanged movement speed. Snapshots during 8 seconds of real motion; no synthetic character displacement.',
        };
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${e.settings.quality}-citizen-motion-${seconds}s`,
            row,
            screenshot: e.screenshot(),
          }),
        });
        if (!response.ok || !row.valid)
          throw new Error('Citizen motion capture failed');
      }
      status.textContent =
        'Completed citizen motion: 3 real navigation captures';
    } catch (error) {
      status.textContent = `Citizen motion failed: ${error}`;
    } finally {
      nav.keys.clear();
      document.removeEventListener('visibilitychange', visibility);
      busy = false;
      e.controls.enabled = e.navigation?.mode === 'orbit';
      lease?.end();
    }
  };
  section.appendChild(motion);
  const lighting = document.createElement('button');
  lighting.textContent = 'Upgrade lighting sweep';
  const runLighting = async (atmosphere: AtmosphereMode) => {
    if (busy || lease?.begin() === false) return;
    busy = true;
    try {
      for (const view of ['gastown-roofs', 'gastown-street'] as const) {
        for (const hour of [14, 19, 19.8, 23]) {
          select(view, 'high');
          e.setAtmosphere(atmosphere);
          e.setClock({ hour, running: false });
          status.textContent = `Lighting ${view} / ${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;
          const ready = () => {
            const architecture = e.architecturalDetails?.stats;
            const kit = e.streetscapeKit?.snapshot();
            return (
              materialEvidence(e).ready &&
              (!architecture ||
                (architecture.pendingCells === 0 &&
                  architecture.readySelectedCells ===
                    architecture.selectedCells)) &&
              (!kit ||
                (!kit.failed &&
                  !kit.loading &&
                  kit.pendingCells === 0 &&
                  (!kit.selectedBays || kit.loaded)))
            );
          };
          const warmup = await collect(5000, ready, 30000);
          const row = {
            kind: 'upgrade-lighting-v1',
            ...upgradeSceneEvidence(e),
            atmosphere,
            palette: sampleAtmosphere(hour, atmosphere),
            id: view,
            hour,
            quality: 'high',
            valid: warmup.valid && ready(),
            settleMs: warmup.sampleMs,
            maxPoseError: warmup.maxPoseError,
            expectedPose,
            render: [e.renderer.domElement.width, e.renderer.domElement.height],
            camera: e.camera.position.toArray(),
            target: e.controls.target.toArray(),
            shadowCoverage: e.shadowCoverageState,
            ssaoExclusions: e.aoExclusions ? { ...e.aoExclusions.stats } : null,
            streetscape: e.streetscapeKit?.snapshot(),
            protocol:
              'Actual High renderer at fixed 1080p, four fixed hours (14, 19, 19.8 twilight, 23) and two fixed cameras; visible readiness warmup. Visual inspection, not a matched performance sample.',
          };
          const response = await fetch('/__visual-qa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `high-${atmosphere === 'overcast' ? 'overcast-' : ''}lighting-${view}-${String(hour).replace('.', 'p')}h`,
              row,
              screenshot: e.screenshot(),
            }),
          });
          if (!response.ok || !row.valid)
            throw new Error('Lighting capture failed');
        }
      }
      status.textContent = `Completed ${atmosphere} lighting sweep: 8 actual renders`;
    } catch (error) {
      status.textContent = `Lighting sweep failed: ${error}`;
    } finally {
      busy = false;
      e.controls.enabled = e.navigation?.mode === 'orbit';
      lease?.end();
    }
  };
  lighting.onclick = () => runLighting('clear');
  section.appendChild(lighting);
  const overcast = document.createElement('button');
  overcast.textContent = 'Upgrade overcast sweep';
  overcast.onclick = () => runLighting('overcast');
  section.appendChild(overcast);
  const regional = document.createElement('button');
  regional.textContent = 'Upgrade regional views';
  regional.onclick = async () => {
    if (busy || lease?.begin() === false) return;
    busy = true;
    try {
      const views = [...DOMESTIC_QA_VIEWS, ...MODERN_BAY_QA_VIEWS];
      for (const view of views) {
        restoreModernBayQA(e);
        e.setAtmosphere('clear');
        e.applySettings({ ...e.settings, quality: 'high' });
        const modern =
          view.id === 'west-end-modern-bay' ||
          view.id === 'yaletown-modern-bay';
        const metadata = modern
          ? selectModernBayQA(e, view.id as ModernBayQAView)
          : selectDomesticQA(e, view.id as DomesticQAView);
        expectedPose = metadata.expectedPose;
        e.controls.enabled = false;
        status.textContent = `Preparing regional ${view.id}`;
        const ready = () => {
          const stats = e.architecturalDetails?.stats;
          return (
            materialEvidence(e).ready &&
            (!stats ||
              (stats.pendingCells === 0 &&
                stats.readySelectedCells === stats.selectedCells)) &&
            (!modern || modernBayQAState(e, view.id as ModernBayQAView).ready)
          );
        };
        const warmup = await collect(5000, ready, 30000);
        const row = {
          kind: 'upgrade-regional-v1',
          ...upgradeSceneEvidence(e),
          ...metadata,
          maxPoseError: warmup.maxPoseError,
          quality: e.settings.quality,
          valid: warmup.valid && ready(),
          settleMs: warmup.sampleMs,
          render: [e.renderer.domElement.width, e.renderer.domElement.height],
          camera: e.camera.position.toArray(),
          target: e.controls.target.toArray(),
          architecture: e.architecturalDetails
            ? { ...e.architecturalDetails.stats }
            : null,
          streetscape: e.streetscapeKit?.snapshot(),
          modernBay: modern
            ? modernBayQAState(e, view.id as ModernBayQAView)
            : null,
          protocol:
            'Actual source-backed regional view, High, 14:00, fixed 1080p; visible readiness warmup, separate from four-view matched performance samples.',
        };
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `high-regional-${view.id}`,
            row,
            screenshot: e.screenshot(),
          }),
        });
        if (!response.ok || !row.valid)
          throw new Error(`Regional view failed: ${view.id}`);
      }
      status.textContent = 'Completed regional views: 4 source-backed captures';
    } catch (error) {
      status.textContent = `Regional check failed: ${error}`;
    } finally {
      restoreModernBayQA(e);
      busy = false;
      e.controls.enabled = e.navigation?.mode === 'orbit';
      lease?.end();
    }
  };
  section.appendChild(regional);
  const restore = document.createElement('button');
  restore.textContent = 'Restore normal render size';
  restore.onclick = () => {
    if (busy || lease?.isRunning()) return;
    restoreModernBayQA(e);
    const w = e.container.clientWidth,
      h = e.container.clientHeight;
    e.camera.aspect = w / h;
    e.camera.updateProjectionMatrix();
    e.renderer.setSize(w, h);
    e.composer?.setSize(w, h);
    e.resizeQuality();
  };
  section.appendChild(restore);
}
