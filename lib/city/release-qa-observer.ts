import type { FacadeDetails } from './facade-details';

type PreparationMetrics = {
  requested: number;
  succeeded: number;
  cancelled: number;
  failed: number;
  pending: number;
  totalAsyncWallMs: number;
  lastAsyncWallMs: number;
  maxAsyncWallMs: number;
};

/** Immutable, low-rate QA snapshot; wall times include FIFO wait and are not GPU times. */
export function snapshotFacadeQueue(
  facade:
    | (FacadeDetails & { preparationMetrics?: PreparationMetrics })
    | null
    | undefined,
) {
  if (!facade?.queue) return null;
  const queue = facade.queue;
  let ready = 0,
    visible = 0;
  for (const record of queue.records.values()) {
    if (!record.ready) continue;
    ready++;
    if (record.ready.group.visible) visible++;
  }
  return {
    metrics: { ...queue.metrics },
    cacheBytes: queue.cacheBytes,
    pendingBytes: queue.pendingBytes,
    pendingId: queue.pendingId ?? null,
    pendingToken: queue.pendingToken ?? null,
    lastError: queue.lastError,
    records: { total: queue.records.size, ready, visible },
    preparation: facade.preparationMetrics
      ? { ...facade.preparationMetrics }
      : null,
  };
}

/** LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Optional LOCAL visual-QA instrumentation proposal; no public UI.
 * Place beside engine.ts only when integrating. No movement or camera rewriting.
 * Observe actual render submission; screenshot review still verifies appearance.
 */
import type { CityEngine } from './engine';
import type { LandmarkWorkerMetric } from './landmark-worker-client';
import type * as THREE from 'three';

type Options = {
  durationMs: number;
  action: () => void;
  expectedMode?: 'orbit' | 'walk' | 'drive' | 'boat';
  signal?: AbortSignal;
};
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    count: values.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    maxMs: sorted.at(-1) ?? 0,
    over50Ms: values.filter((v) => v > 50).length,
    over100Ms: values.filter((v) => v > 100).length,
  };
};

export async function measureReleaseWindow(e: CityEngine, options: Options) {
  const start = performance.now();
  const initialPosition = e.navigation!.position.clone();
  const initialMode = e.navigation!.mode;
  const initialHour = e.clock.hour;
  const initialFacade = snapshotFacadeQueue(e.facadeDetails);
  const landmarks = e.landmarkDetails.map((detail) => ({
    name: detail.holder.name,
    ultraPresentInitially: !!detail.ultra,
    firstAttachedMs: detail.ultra ? 0 : (null as number | null),
    firstSubmittedMs: null as number | null,
    constructionMs: [] as number[],
    attachmentUpdateMs: [] as number[],
    // Sampled at frame boundaries; brief async transitions may be unobserved.
    loadStateTimeline: [] as { elapsedMs: number; state: string }[],
    visibleLevel: 'medium',
    nightIntensityRange: [] as number[],
  }));
  const restores: (() => void)[] = [];
  const workerJobs: (LandmarkWorkerMetric & { receivedMs: number })[] = [];
  const clients = new WeakSet<object>();
  const watchWorker = () => {
    const client = e.landmarkWorker;
    if (!client || clients.has(client)) return;
    clients.add(client);
    const old = client.onMetrics;
    const observe: typeof client.onMetrics = (metric) => {
      try {
        old?.(metric);
      } finally {
        workerJobs.push({ ...metric, receivedMs: performance.now() - start });
      }
    };
    client.onMetrics = observe;
    restores.push(() => {
      if (client.onMetrics === observe) client.onMetrics = old;
    });
  };
  watchWorker();
  let travelSimulationSeconds = 0;
  const originalUpdate = e.navigation!.update;
  e.navigation!.update = function (dt: number) {
    // Mirror the controller's existing dt cap only for accounting; never change dt.
    if (this.mode !== 'orbit')
      travelSimulationSeconds += Math.max(0, Math.min(0.05, dt));
    originalUpdate.call(this, dt);
  };
  restores.push(() => {
    e.navigation!.update = originalUpdate;
  });
  const watched = new WeakSet<THREE.Object3D>();
  const watchGroup = (group: THREE.Group, row: (typeof landmarks)[number]) => {
    if (watched.has(group)) return;
    watched.add(group);
    group.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh && !(object as THREE.Points).isPoints)
        return;
      const old = object.onAfterRender;
      object.onAfterRender = function (...args: Parameters<typeof old>) {
        old.apply(this, args);
        if (row.firstSubmittedMs === null && group.visible)
          row.firstSubmittedMs = performance.now() - start;
      };
      restores.push(() => {
        object.onAfterRender = old;
      });
    });
  };
  e.landmarkDetails.forEach((detail, i) => {
    const sampleState = () => {
      const state = detail.loadState?.status;
      const timeline = landmarks[i].loadStateTimeline;
      if (state && timeline.at(-1)?.state !== state)
        timeline.push({ elapsedMs: performance.now() - start, state });
    };
    sampleState();
    const old = detail.update;
    if (detail.ultra) watchGroup(detail.ultra, landmarks[i]);
    detail.update = function () {
      const before = !!detail.ultra,
        t = performance.now();
      sampleState();
      old.call(this);
      watchWorker();
      sampleState();
      if (!before && detail.ultra) {
        const times = detail.loadState
          ? landmarks[i].attachmentUpdateMs
          : landmarks[i].constructionMs;
        times.push(performance.now() - t);
        landmarks[i].firstAttachedMs = performance.now() - start;
        watchGroup(detail.ultra, landmarks[i]);
      }
    };
    restores.push(() => {
      detail.update = old;
    });
  });
  const gaps: { elapsedMs: number; gapMs: number }[] = [];
  const renderDurations: number[] = [];
  const trace: Record<string, unknown>[] = [];
  let traveled = 0,
    intervalDistance = 0,
    lastTrace = 0,
    lastPosition = initialPosition.clone();
  let modeMismatch = false,
    hidden = document.hidden,
    contextLost = false,
    aborted = false;
  let collisionFrames = 0,
    submittedFrames = 0;
  const originalRender = e.renderScene;
  e.renderScene = function () {
    const t = performance.now();
    originalRender.call(this);
    renderDurations.push(performance.now() - t);
    submittedFrames++;
    const nav = e.navigation!;
    modeMismatch ||=
      !!options.expectedMode && nav.mode !== options.expectedMode;
    const d = Math.hypot(
      nav.position.x - lastPosition.x,
      nav.position.z - lastPosition.z,
    );
    traveled += d;
    intervalDistance += d;
    lastPosition.copy(nav.position);
    if (nav.mode === 'boat' && nav.boat.state.collided) collisionFrames++;
    const elapsed = performance.now() - start;
    if (elapsed - lastTrace >= 1000) {
      trace.push({
        elapsedMs: elapsed,
        facade: snapshotFacadeQueue(e.facadeDetails),
        windowMs: elapsed - lastTrace,
        windowMeters: intervalDistance,
        measuredSpeed: (intervalDistance / (elapsed - lastTrace)) * 1000,
        heldKeys: [...nav.keys].sort(),
        position: nav.position.toArray(),
        mode: nav.mode,
        yaw: nav.yaw,
        controllerSpeed: nav.speed,
        surfaceId: nav.surfaceId ?? nav.surface,
        boatSurfaceId: nav.mode === 'boat' ? nav.boat.state.surfaceId : null,
        camera: e.camera.position.toArray(),
        quaternion: e.camera.quaternion.toArray(),
        target: e.controls.target.toArray(),
        cameraDistance: nav.cameraDistance,
        cockpit: nav.cameraView,
        quality: e.settings.quality,
        render: [e.renderer.domElement.width, e.renderer.domElement.height],
        triangles: e.renderer.info.render.triangles,
        calls: e.renderer.info.render.calls,
        geometries: e.renderer.info.memory.geometries,
        textures: e.renderer.info.memory.textures,
      });
      lastTrace = elapsed;
      intervalDistance = 0;
    }
  };
  restores.push(() => {
    e.renderScene = originalRender;
  });
  let raf = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    previous = start;
  let actionMs = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const visibility = () => {
        if (document.hidden) {
          hidden = true;
          finish();
        }
      };
      const loss = () => {
        contextLost = true;
        finish();
      };
      const abort = () => {
        aborted = true;
        finish();
      };
      document.addEventListener('visibilitychange', visibility);
      e.renderer.domElement.addEventListener('webglcontextlost', loss);
      options.signal?.addEventListener('abort', abort, { once: true });
      restores.push(() => {
        document.removeEventListener('visibilitychange', visibility);
        e.renderer.domElement.removeEventListener('webglcontextlost', loss);
        options.signal?.removeEventListener('abort', abort);
      });
      const frame = () => {
        if (done) return;
        const now = performance.now();
        gaps.push({ elapsedMs: now - start, gapMs: now - previous });
        previous = now;
        if (e.disposed || now - start >= options.durationMs) finish();
        else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      timer = setTimeout(finish, options.durationMs + 2000);
      try {
        // Record first, then act. In particular do not discard a 2.5s warm-up.
        const t = performance.now();
        options.action();
        actionMs = performance.now() - t;
        // Prepare placements before recording; action should only set W or quality.
        lastPosition.copy(e.navigation!.position);
      } catch (error) {
        done = true;
        reject(error);
      }
    });
    const elapsedMs = performance.now() - start;
    e.landmarkDetails.forEach((detail, i) => {
      landmarks[i].visibleLevel = detail.ultra?.visible
        ? 'ultra'
        : detail.medium.visible
          ? 'medium'
          : 'none';
      const group = detail.ultra?.visible ? detail.ultra : detail.medium;
      const intensities = (group.userData.nightMaterials ?? []).map(
        (n: { material: THREE.MeshStandardMaterial }) =>
          n.material.emissiveIntensity,
      );
      landmarks[i].nightIntensityRange = intensities.length
        ? [Math.min(...intensities), Math.max(...intensities)]
        : [];
    });
    return {
      schema: 'release-render-window-v1',
      elapsedMs,
      actionMs,
      valid:
        !hidden && !aborted && !contextLost && !e.disposed && !modeMismatch,
      flags: {
        hidden,
        aborted,
        contextLost,
        disposed: e.disposed,
        modeMismatch,
      },
      initialMode,
      initialHour,
      finalHour: e.clock.hour,
      night: e.uniforms.night.value,
      frames: summary(gaps.map((v) => v.gapMs)),
      coldFirst2s: summary(
        gaps.filter((v) => v.elapsedMs - v.gapMs < 2000).map((v) => v.gapMs),
      ),
      // Include crossing frames: a >2s initial stall remains in the cold window.
      coldFirstFrame: gaps[0] ?? null,
      renderCPU: summary(renderDurations),
      submittedFrames,
      traveledMeters: traveled,
      travelSimulationSeconds,
      collisionFrames,
      trace,
      facade: {
        initial: initialFacade,
        final: snapshotFacadeQueue(e.facadeDetails),
      },
      landmarks,
      workerJobs,
      landmarkErrors: { ...e.data.landmarkWorkerErrors },
      rawGaps: gaps,
      note: 'RAF gaps measure responsiveness. Async attachmentUpdateMs excludes worker creation; worker factory/decode timings exclude queue, packing, transfer and GPU time. Load states are frame samples. First submitted marks a render callback, not pixel/occlusion verification. No GPU timer query.',
    };
  } finally {
    cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    for (const restore of restores.reverse()) restore();
  }
}
