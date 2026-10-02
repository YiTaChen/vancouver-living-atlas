/** LOCAL VISUAL QA only. Configured real walking runs with explicit setup resets. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';
import { ARCHITECTURE_BUDGET } from './architecture-details';
import { upgradeSceneEvidence } from './upgrade-qa';
import {
  enduranceFrameSummary,
  summarizeEnduranceMemory,
  enduranceCorridorPosition,
  type EnduranceCorridor,
} from './upgrade-endurance-summary';

type UI = {
  button(label: string, callback: () => void): void;
  apply(id: string, quality: VisualQuality): void;
  begin(): boolean;
  end(): void;
  panel: HTMLElement;
  status: HTMLElement;
  output: HTMLTextAreaElement;
};
type GroundRoute = Pick<EnduranceCorridor, 'start' | 'end' | 'source'> & {
  name: string;
};
type RunConfig = {
  id: string;
  label: string;
  routes: readonly string[];
  legs: number;
  legMs: number;
  protocol: string;
  corridor?: EnduranceCorridor;
  placements?: Readonly<Record<string, GroundRoute>>;
};
// Named crossings from the current connected Robson RoadGraph path: 11 edges,
// 12 nodes; 1346.884 m along source edges, <=0.553 m from this straight axis.
const ROBSON_CORRIDOR: EnduranceCorridor = {
  start: [415.67587947125975, 339.6261879997863],
  end: [-539.8137202898291, -609.6551120001666],
  halfWidthMeters: 6,
  startCrossing: 'BURRARD ST',
  crossings: [
    { name: 'BURRARD ST', distanceMeters: 27.337534082622724 },
    { name: 'THURLOW ST', distanceMeters: 260.7600593646863 },
    { name: 'BUTE ST', distanceMeters: 482.0630496704663 },
    { name: 'JERVIS ST', distanceMeters: 610.034520584157 },
    { name: 'BROUGHTON ST', distanceMeters: 783.778941907359 },
    { name: 'NICOLA ST', distanceMeters: 904.2504212219565 },
    { name: 'CARDERO ST', distanceMeters: 1025.2538242563494 },
    { name: 'BIDWELL ST', distanceMeters: 1185.9958683813893 },
    { name: 'DENMAN ST', distanceMeters: 1327.3835957920849 },
  ],
  source:
    'Current RoadGraph Robson edges 3953,3798,588,2999,3775,2753,340,3095,3022,858,665; Burrard through Denman, nine named crossing gates define eight block intervals.',
};
// A generic Water Street spawn points beyond its road segment into Harbour
// Centre after ~154 m. This initial QA placement stays on two connected source
// arterial edges for 300.432 m, leaving >60 m beyond a full 60s walk at 4 m/s.
const WATER_ENDURANCE_ROUTE: GroundRoute = {
  name: 'Water Street connected arterial QA leg',
  start: [1704.4201986244195, 273.28826168075756],
  end: [1415.0585986383298, 192.48575031961587],
  source:
    'Connected WATER ST arterial RoadGraph edges 2973,3794; source IDs 29:0,846:0; nodes 2838→2745→2681. The fixed chord is inset 20m at each end, spans 300.432m and deviates at most 0.202m from the source centerline. Initial placement only; live preflight and movement collision checks remain authoritative.',
};
const RUNS: readonly RunConfig[] = [
  {
    id: 'water-street-detail-walk',
    label: 'Upgrade Water Street detail walk',
    routes: ['water-street'],
    placements: { 'water-street': WATER_ENDURANCE_ROUTE },
    legs: 1,
    legMs: 60000,
    protocol:
      'One 60s continuous actual W-input walk along the audited 300.432m Water Street arterial route. One initial placement; no position or heading rewrites during the measured leg. Live collision and protected-surface preflight remain mandatory.',
  },
  {
    id: 'route-endurance-10m',
    label: 'Upgrade route endurance 10m',
    routes: ['robson-walk', 'water-street'],
    placements: { 'water-street': WATER_ENDURANCE_ROUTE },
    legs: 10,
    legMs: 60000,
    protocol:
      'Ten 60s RAF-timed actual W-input walking legs alternate the existing Robson QA placement and a source-audited 300.432m Water Street arterial segment. Water legs override only initial placement after the existing preset and log a full live ground/protected-surface preflight. Explicit teleports/reset headings occur only between legs, followed by 2.5s setup. This probes repeated-route cache bounds, not a continuous single 10-minute path.',
  },
  {
    id: 'robson-corridor-8-blocks',
    label: 'Upgrade Robson corridor 8 blocks',
    routes: ['robson-walk'],
    legs: 1,
    legMs: 480000,
    corridor: ROBSON_CORRIDOR,
    protocol:
      'One continuous actual W-input walking leg along the source Robson centerline from Burrard through Denman, up to 480s of RAF time. Nine observed named crossing gates establish eight source block intervals; crossing the far Denman endpoint stops W immediately. A timeout retains actual partial crossing count and cannot claim full completion. One initial placement precedes the leg; there are no between-leg teleports or in-leg heading/position rewrites. This centerline tests rendered road/navigation continuity, not pedestrian traffic safety.',
  },
];
const SETUP_MS = 2500,
  SAMPLE_MS = 5000;

function prepareGroundRoute(e: CityEngine, route: GroundRoute) {
  const nav = e.navigation!,
    dx = route.end[0] - route.start[0],
    dz = route.end[1] - route.start[1],
    length = Math.hypot(dx, dz),
    direction = [dx / length, dz / length],
    checks = Math.ceil(length / 2);
  let blockedSamples = 0,
    protectedSamples = 0;
  // Read-only preflight of current collision/land data. The real movement
  // resolver remains authoritative during the run; no checks are bypassed.
  for (let i = 0; i <= checks; i++) {
    const distance = Math.min(length, i * 2),
      x = route.start[0] + direction[0] * distance,
      z = route.start[1] + direction[1] * distance;
    for (const lateral of [-0.45, 0, 0.45]) {
      const px = x - direction[1] * lateral,
        pz = z + direction[0] * lateral;
      if (!nav.clearGround(px, pz, 'walk')) blockedSamples++;
      if (e.data.travelSurfaces?.lookup(px, pz).length) protectedSamples++;
    }
  }
  const preflight = {
    ...route,
    yaw: Math.atan2(direction[0], direction[1]),
    lengthMeters: length,
    sampleStepMeters: 2,
    lateralProbeMeters: 0.45,
    samples: (checks + 1) * 3,
    blockedSamples,
    protectedSamples,
  };
  if (blockedSamples || protectedSamples)
    throw new Error(
      `${route.name} preflight failed: ${JSON.stringify(preflight)}`,
    );
  const [x, z] = route.start;
  if (
    !nav.startAt('walk', {
      x,
      z,
      y: nav.roadHeight(x, z),
      yaw: preflight.yaw,
      surface: 'ground',
      name: route.name,
      snappedDistance: 0,
    })
  )
    throw new Error(`${route.name} initial placement failed`);
  nav.cameraDistances.walk = 0;
  nav.snapCamera = true;
  nav.update(0);
  return preflight;
}

const heapSnapshot = () => {
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  return memory
    ? {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
      }
    : null;
};

function memorySnapshot(e: CityEngine) {
  const architecture = e.architecturalDetails;
  return {
    ...upgradeSceneEvidence(e),
    architecture: architecture
      ? { ...architecture.stats, cacheCells: architecture.records.size }
      : null,
    streetscape: e.streetscapeKit?.snapshot() ?? null,
    geometries: e.renderer.info.memory.geometries,
    textures: e.renderer.info.memory.textures,
    calls: e.renderer.info.render.calls,
    triangles: e.renderer.info.render.triangles,
    heap: heapSnapshot(),
  };
}

/** Uses RAF time exclusively. Abort resolves immediately even if RAF stops in a
 * hidden/disposed page; keys are cleared by the run-level cancellation handler. */
function rafWindow(
  durationMs: number,
  signal: AbortSignal,
  frame?: (elapsedMs: number, gapMs: number) => boolean | void,
) {
  return new Promise<number>((resolve, reject) => {
    let raf = 0,
      finished = false,
      previous = performance.now();
    const start = previous;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      signal.removeEventListener('abort', abort);
      resolve(performance.now() - start);
    };
    const abort = () => finish();
    const tick = (now: number) => {
      if (finished) return;
      try {
        if (frame?.(now - start, now - previous) === true) {
          finish();
          return;
        }
      } catch (error) {
        finished = true;
        signal.removeEventListener('abort', abort);
        reject(error);
        return;
      }
      previous = now;
      if (signal.aborted || now - start >= durationMs) finish();
      else raf = requestAnimationFrame(tick);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish();
    else raf = requestAnimationFrame(tick);
  });
}

async function walkingLeg(
  e: CityEngine,
  ui: UI,
  signal: AbortSignal,
  cancel: (reason: string) => void,
  leg: number,
  route: string,
  quality: VisualQuality,
  runStart: number,
  config: RunConfig,
) {
  const nav = e.navigation!;
  const start = nav.position.toArray(),
    yaw = nav.yaw;
  const renderSize = [
    e.renderer.domElement.width,
    e.renderer.domElement.height,
  ];
  const frames: number[] = [];
  const counters = {
    updateCalls: 0,
    simulationSeconds: 0,
    moveCalls: 0,
    attemptedMeters: 0,
    traveledMeters: 0,
    blockedMoveCalls: 0,
    groundRejections: 0,
    protectedSurfaceRejections: 0,
    submittedFrames: 0,
  };
  const flags = {
    modeMismatch: false,
    qualityMismatch: false,
    inputMismatch: false,
    renderSizeChanged: false,
    headingChanged: false,
    leftSourceCorridor: false,
    unobservedDisplacement: false,
  };
  const corridorStart = config.corridor
    ? enduranceCorridorPosition(start, config.corridor)
    : null;
  let previousCorridor = corridorStart;
  let reachedEnd = false;
  const crossed: {
    name: string;
    elapsedMs: number;
    alongMeters: number;
    position: number[];
  }[] = [];
  let activeMove = false,
    moveRejected = false,
    lastSampleMs = 0,
    lastSampleMeters = 0;
  const originalMove = nav.move,
    originalBlocked = nav.blocked,
    originalProtected = nav.protectedStep;
  const originalUpdate = nav.update,
    originalRender = e.renderScene;
  const move: typeof nav.move = function (this: typeof nav, dx, dz) {
    const attempted = Math.hypot(dx, dz),
      x = this.position.x,
      z = this.position.z;
    if (attempted <= 1e-9) return originalMove.call(this, dx, dz);
    counters.moveCalls++;
    counters.attemptedMeters += attempted;
    activeMove = true;
    moveRejected = false;
    try {
      return originalMove.call(this, dx, dz);
    } finally {
      activeMove = false;
      const actual = Math.hypot(this.position.x - x, this.position.z - z);
      counters.traveledMeters += actual;
      if (moveRejected || actual + 1e-5 < attempted)
        counters.blockedMoveCalls++;
    }
  };
  const blocked: typeof nav.blocked = function (this: typeof nav, x, z) {
    const result = originalBlocked.call(this, x, z);
    if (activeMove && result) {
      counters.groundRejections++;
      moveRejected = true;
    }
    return result;
  };
  const protectedStep: typeof nav.protectedStep = function (
    this: typeof nav,
    x,
    z,
  ) {
    const result = originalProtected.call(this, x, z);
    if (activeMove && !result) {
      counters.protectedSurfaceRejections++;
      moveRejected = true;
    }
    return result;
  };
  const update: typeof nav.update = function (this: typeof nav, dt) {
    counters.updateCalls++;
    counters.simulationSeconds += Math.max(0, Math.min(0.05, dt));
    return originalUpdate.call(this, dt);
  };
  const render: typeof e.renderScene = function (this: CityEngine) {
    originalRender.call(this);
    counters.submittedFrames++;
  };
  nav.move = move;
  nav.blocked = blocked;
  nav.protectedStep = protectedStep;
  nav.update = update;
  e.renderScene = render;
  const sample = (elapsedMs: number) => ({
    leg,
    route,
    elapsedMs,
    runElapsedMs: performance.now() - runStart,
    windowMs: elapsedMs - lastSampleMs,
    windowMeters: counters.traveledMeters - lastSampleMeters,
    ...counters,
    position: nav.position.toArray(),
    yaw: nav.yaw,
    heldKeys: [...nav.keys].sort(),
    mode: nav.mode,
    quality: e.settings.quality,
    surfaceId: nav.surfaceId ?? nav.surface,
    render: [e.renderer.domElement.width, e.renderer.domElement.height],
    corridor: config.corridor
      ? {
          ...enduranceCorridorPosition(nav.position.toArray(), config.corridor),
          crossings: crossed.map((gate) => gate.name),
        }
      : null,
    ...memorySnapshot(e),
  });
  const trace: ReturnType<typeof sample>[] = [];
  let elapsedMs = 0;
  try {
    nav.keys.clear();
    nav.keys.add('w');
    trace.push(sample(0));
    elapsedMs = await rafWindow(config.legMs, signal, (elapsed, gap) => {
      frames.push(gap);
      flags.modeMismatch ||= nav.mode !== 'walk';
      flags.qualityMismatch ||= e.settings.quality !== quality;
      flags.headingChanged ||=
        Math.abs(Math.atan2(Math.sin(nav.yaw - yaw), Math.cos(nav.yaw - yaw))) >
        1e-4;
      flags.inputMismatch ||=
        nav.keys.size !== 1 ||
        !nav.keys.has('w') ||
        nav.touchX !== 0 ||
        nav.touchY !== 0;
      flags.renderSizeChanged ||=
        e.renderer.domElement.width !== renderSize[0] ||
        e.renderer.domElement.height !== renderSize[1];
      if (document.hidden) cancel('page-hidden');
      if (e.disposed) cancel('disposed');
      if (config.corridor && corridorStart && previousCorridor) {
        const progress = enduranceCorridorPosition(
          nav.position.toArray(),
          config.corridor,
        );
        flags.leftSourceCorridor ||= !progress.withinCorridor;
        flags.unobservedDisplacement ||=
          Math.abs(progress.alongMeters - corridorStart.alongMeters) >
          counters.traveledMeters + 0.5;
        if (flags.leftSourceCorridor) cancel('left-source-corridor');
        if (flags.unobservedDisplacement) cancel('unobserved-position-change');
        if (
          progress.withinCorridor &&
          previousCorridor.withinCorridor &&
          !flags.unobservedDisplacement
        ) {
          for (const gate of config.corridor.crossings) {
            if (
              previousCorridor.alongMeters < gate.distanceMeters &&
              progress.alongMeters >= gate.distanceMeters &&
              !crossed.some((value) => value.name === gate.name)
            )
              crossed.push({
                name: gate.name,
                elapsedMs: elapsed,
                alongMeters: progress.alongMeters,
                position: nav.position.toArray(),
              });
          }
          reachedEnd =
            progress.alongMeters >= progress.lengthMeters &&
            crossed.length === config.corridor.crossings.length;
        }
        previousCorridor = progress;
      }
      if (Object.values(flags).some(Boolean))
        cancel('test-input-or-mode-changed');
      if (elapsed - lastSampleMs >= SAMPLE_MS) {
        trace.push(sample(elapsed));
        lastSampleMs = elapsed;
        lastSampleMeters = counters.traveledMeters;
        ui.status.textContent = `Endurance leg ${leg + 1}/${config.legs} · ${route} · ${Math.floor(elapsed / 1000)}/${config.legMs / 1000}s · ${counters.traveledMeters.toFixed(1)}m`;
      }
      return reachedEnd;
    });
    // Include the final partial window when cancellation or frame cadence does
    // not land exactly on a five-second boundary.
    if (elapsedMs - lastSampleMs > 1) trace.push(sample(elapsedMs));
  } finally {
    nav.keys.clear();
    if (nav.move === move) nav.move = originalMove;
    if (nav.blocked === blocked) nav.blocked = originalBlocked;
    if (nav.protectedStep === protectedStep)
      nav.protectedStep = originalProtected;
    if (nav.update === update) nav.update = originalUpdate;
    if (e.renderScene === render) e.renderScene = originalRender;
  }
  const stalledWindows = trace.filter(
    (row) => row.windowMs >= 4500 && row.windowMeters < 0.5,
  ).length;
  return {
    leg,
    route,
    start,
    end: nav.position.toArray(),
    startYaw: yaw,
    endYaw: nav.yaw,
    elapsedMs,
    counters,
    flags,
    corridor: config.corridor
      ? {
          source: config.corridor,
          start: corridorStart,
          end: previousCorridor,
          crossed,
          completedBlockIntervals: Math.max(0, crossed.length - 1),
          plannedBlockIntervals: Math.max(
            0,
            config.corridor.crossings.length - 1,
          ),
          reachedEnd,
        }
      : null,
    stopReason: signal.aborted
      ? String(signal.reason)
      : reachedEnd
        ? 'end-gate'
        : 'time-limit',
    trace,
    frames: enduranceFrameSummary(frames, elapsedMs),
    completed:
      !signal.aborted &&
      (config.corridor ? reachedEnd : elapsedMs >= config.legMs) &&
      counters.submittedFrames > 1 &&
      counters.updateCalls > 1,
    continuousMotion: counters.blockedMoveCalls === 0 && stalledWindows === 0,
    stalledWindows,
  };
}

export function installUpgradeEnduranceQA(e: CityEngine, ui: UI) {
  let active: AbortController | null = null;
  let cancelRun: ((reason: string) => void) | null = null;
  ui.button('Stop upgrade endurance', () => cancelRun?.('cancelled-by-user'));
  async function run(config: RunConfig) {
    if (active || !ui.begin()) return;
    const controller = new AbortController();
    active = controller;
    const quality = e.settings.quality,
      hour = e.clock.hour,
      runStart = performance.now();
    const flags = {
      hidden: document.hidden,
      contextLost: false,
      disposed: false,
      reason: '',
    };
    const cancel = (reason: string) => {
      e.navigation?.keys.clear();
      flags.hidden ||= document.hidden;
      flags.disposed ||= e.disposed || reason === 'disposed';
      if (!flags.reason) flags.reason = reason;
      controller.abort(reason);
    };
    cancelRun = cancel;
    const visibility = () => {
      if (document.hidden) {
        flags.hidden = true;
        cancel('page-hidden');
      }
    };
    const contextLoss = () => {
      flags.contextLost = true;
      cancel('webgl-context-lost');
    };
    const originalDestroy = e.destroy;
    const destroy: typeof e.destroy = function (this: CityEngine) {
      flags.disposed = true;
      cancel('disposed');
      return originalDestroy.call(this);
    };
    const buttonStates = [...ui.panel.querySelectorAll('button')].map(
      (button) => ({ button, disabled: button.disabled }),
    );
    buttonStates.forEach(({ button }) => {
      button.disabled = button.textContent !== 'Stop upgrade endurance';
    });
    e.destroy = destroy;
    document.addEventListener('visibilitychange', visibility);
    e.renderer.domElement.addEventListener('webglcontextlost', contextLoss);
    const legs: Awaited<ReturnType<typeof walkingLeg>>[] = [];
    const resets: {
      leg: number;
      route: string;
      from: number[];
      to: number[];
      setupMs: number;
      kind: 'initial-placement' | 'between-leg-teleport';
      sourcePlacement: ReturnType<typeof prepareGroundRoute> | null;
    }[] = [];
    let initial: ReturnType<typeof memorySnapshot> | null = null;
    let corridorPreflight: ReturnType<typeof prepareGroundRoute> | null = null;
    let failure: string | null = null;
    try {
      initial = memorySnapshot(e);
      if (flags.hidden || e.disposed)
        cancel(flags.hidden ? 'page-hidden' : 'disposed');
      if (quality === 'balanced')
        throw new Error(
          'Endurance requires High or Ultra for detail cache coverage.',
        );
      if (e.compatibleGraphics)
        throw new Error(
          'Run detail endurance on the desktop renderer; inspect compatible graphics separately.',
        );
      for (
        let leg = 0;
        leg < config.legs && !controller.signal.aborted;
        leg++
      ) {
        const route = config.routes[leg % config.routes.length],
          nav = e.navigation!;
        nav.keys.clear();
        const from = nav.position.toArray();
        ui.status.textContent = `Reset/setup ${leg + 1}/${config.legs}: ${route}`;
        ui.apply(route, quality);
        let sourcePlacement: ReturnType<typeof prepareGroundRoute> | null =
          null;
        if (config.corridor) {
          sourcePlacement = prepareGroundRoute(e, {
            ...config.corridor,
            name: 'Robson Burrard-to-Denman QA corridor',
          });
          corridorPreflight = sourcePlacement;
        } else if (config.placements?.[route]) {
          sourcePlacement = prepareGroundRoute(e, config.placements[route]);
        }
        e.setClock({ hour, running: false });
        // Endurance uses the normal selected preset, even if a previous matched
        // screenshot test left its drawing buffer at a fixed 1920×1080.
        const width = e.container.clientWidth,
          height = e.container.clientHeight;
        e.camera.aspect = width / Math.max(1, height);
        e.camera.updateProjectionMatrix();
        e.renderer.setSize(width, height, false);
        e.composer?.setSize(width, height);
        e.resizeQuality();
        const setupMs = await rafWindow(SETUP_MS, controller.signal, () => {
          if (document.hidden) cancel('page-hidden');
          if (e.disposed) cancel('disposed');
        });
        resets.push({
          leg,
          route,
          from,
          to: nav.position.toArray(),
          setupMs,
          kind: leg === 0 ? 'initial-placement' : 'between-leg-teleport',
          sourcePlacement,
        });
        if (controller.signal.aborted) break;
        if (nav.mode !== 'walk')
          throw new Error(`${route} did not enter walk mode`);
        legs.push(
          await walkingLeg(
            e,
            ui,
            controller.signal,
            cancel,
            leg,
            route,
            quality,
            runStart,
            config,
          ),
        );
      }
    } catch (error) {
      failure = String(error);
      cancel('measurement-error');
    } finally {
      e.navigation?.keys.clear();
      document.removeEventListener('visibilitychange', visibility);
      e.renderer.domElement.removeEventListener(
        'webglcontextlost',
        contextLoss,
      );
      if (e.destroy === destroy) e.destroy = originalDestroy;
      buttonStates.forEach(({ button, disabled }) => {
        button.disabled = disabled;
      });
      active = null;
      cancelRun = null;
    }
    try {
      const samples = [
        ...(initial ? [initial] : []),
        ...legs.flatMap((leg) => leg.trace),
      ];
      const memory = summarizeEnduranceMemory(samples, {
        architectureCells: ARCHITECTURE_BUDGET.cachedCells,
        streetscapeCells: 12, // StreetscapeKit.update's current explicit cache cap.
      });
      const completed =
        legs.length === config.legs && legs.every((leg) => leg.completed);
      const continuousMotion =
        legs.length > 0 && legs.every((leg) => leg.continuousMotion);
      const environmentValid =
        !flags.hidden &&
        !flags.contextLost &&
        !flags.disposed &&
        !failure &&
        !controller.signal.aborted;
      const row = {
        kind: 'upgrade-route-endurance-v1',
        ...upgradeSceneEvidence(e),
        id: config.id,
        quality,
        hour,
        valid:
          environmentValid &&
          completed &&
          continuousMotion &&
          memory.withinCellLimits,
        environmentValid,
        completed,
        continuousMotion,
        flags,
        failure,
        plannedWalkingMs: config.legs * config.legMs,
        observedWalkingMs: legs.reduce((sum, leg) => sum + leg.elapsedMs, 0),
        totalWallMs: performance.now() - runStart,
        traveledMeters: legs.reduce(
          (sum, leg) => sum + leg.counters.traveledMeters,
          0,
        ),
        simulationSeconds: legs.reduce(
          (sum, leg) => sum + leg.counters.simulationSeconds,
          0,
        ),
        resets,
        corridorPreflight,
        memory,
        legs,
        viewport: [innerWidth, innerHeight],
        render: [e.renderer.domElement.width, e.renderer.domElement.height],
        protocol: `${config.protocol} Setup/reset distance is excluded from walking metrics. Within each leg the test never rewrites position or heading. Five-second resource snapshots, real move rejection counters and controller simulation dt are recorded. Hidden/context-lost/disposed/cancelled runs abort and clear input. This is not exhaustive collision testing, a memory-leak proof, or a 30/60 FPS guarantee. Optional Chromium JS heap is GC-dependent. Render counters include multipass work.`,
      };
      ui.output.value = JSON.stringify(row, null, 2);
      const screenshot =
        !document.hidden && !e.disposed && !flags.contextLost
          ? e.screenshot()
          : undefined;
      const response = await fetch('/__visual-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${quality}-${config.id}`,
          row,
          screenshot,
        }),
      });
      if (!response.ok)
        throw new Error(`Endurance save failed: ${response.status}`);
      ui.status.textContent = `Saved ${config.id}: ${row.valid ? 'PASS' : 'CHECK FAILURE'} · ${legs.length}/${config.legs} legs · ${row.traveledMeters.toFixed(1)}m`;
    } catch (error) {
      ui.status.textContent = String(error);
    } finally {
      e.navigation?.keys.clear();
      ui.end();
    }
  }
  for (const config of RUNS) ui.button(config.label, () => void run(config));
}
