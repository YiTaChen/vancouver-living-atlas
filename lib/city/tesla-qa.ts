/** Explicit loopback + opt-in QA only; imported from the stripped visual-qa entry. */
import type { CityEngine } from './engine';
import { inPolygon, project } from './geo';
import type { TeslaStepReport } from './tesla-state';

interface Lease {
  isRunning(): boolean;
  begin(): boolean;
  end(): void;
}
interface BuildingVolume {
  polygon: number[][][];
  minY: number;
  maxY: number;
}
interface WallCandidate {
  building: number;
  edge: number;
  midpoint: [number, number];
  normal: [number, number];
  length: number;
  distance: number;
}
const ROBSON = project([-123.12416073213134, 49.2841737758357]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Bounded actual exterior faces, with normals checked against holes/footprints. */
export function teslaQAWallCandidates(
  volumes: readonly BuildingVolume[],
  origin: readonly [number, number] = ROBSON,
  limit = 32,
): WallCandidate[] {
  const found: WallCandidate[] = [];
  for (let building = 0; building < volumes.length; building++) {
    const volume = volumes[building];
    if (volume.maxY - volume.minY < 10) continue;
    const ring = volume.polygon[0];
    if (!ring || ring.length < 3) continue;
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge],
        b = ring[(edge + 1) % ring.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 14) continue;
      const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        distance = Math.hypot(midpoint[0] - origin[0], midpoint[1] - origin[1]);
      if (!Number.isFinite(distance) || distance > 420) continue;
      let nx = dz / length,
        nz = -dx / length;
      if (
        inPolygon(
          [midpoint[0] + nx * 0.1, midpoint[1] + nz * 0.1],
          volume.polygon,
        )
      ) {
        nx = -nx;
        nz = -nz;
      }
      if (
        inPolygon(
          [midpoint[0] + nx * 0.1, midpoint[1] + nz * 0.1],
          volume.polygon,
        )
      )
        continue;
      found.push({
        building,
        edge,
        midpoint,
        normal: [nx, nz],
        length,
        distance,
      });
    }
  }
  return found
    .sort((a, b) => a.distance - b.distance || b.length - a.length)
    .slice(
      0,
      Math.min(
        64,
        Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 32),
      ),
    );
}

function nextFrame(signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Tesla QA stopped'));
      return;
    }
    const abort = () => {
        cancelAnimationFrame(id);
        reject(new Error('Tesla QA stopped'));
      },
      id = requestAnimationFrame((now) => {
        signal?.removeEventListener('abort', abort);
        resolve(now);
      });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function installTeslaQA(
  e: CityEngine,
  panel: HTMLElement,
  lease: Lease,
) {
  if (
    process.env.VANCOUVER_VISUAL_QA !== '1' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
      globalThis.location?.hostname ?? '',
    )
  )
    return;
  const status = document.createElement('p'),
    output = document.createElement('textarea'),
    label = document.createElement('input');
  status.id = 'tesla-qa-status';
  status.textContent = 'Tesla QA ready';
  label.setAttribute('aria-label', 'Tesla QA capture label');
  label.placeholder = 'Optional capture label';
  label.maxLength = 40;
  output.id = 'tesla-qa-report';
  output.setAttribute('aria-label', 'Tesla QA report');
  output.style.cssText = 'display:block;width:100%;height:70px';
  panel.appendChild(status);
  panel.appendChild(label);
  let sequence = 0,
    caseName = 'manual',
    motion: AbortController | null = null;
  let lastRun: {
    kind: string;
    startedAt: string;
    result: string;
    target?: unknown;
    inputs?: {
      throttleReleased: boolean;
      brakeRequestedOnWall: boolean;
      parkCommandRequested: boolean;
    };
    verifiedHoldMs?: number;
    trace: unknown[];
  } | null = null;
  const step = () => {
    const diagnostics = e.tesla as unknown as {
      lastStep?: TeslaStepReport;
    } | null;
    return diagnostics?.lastStep ? { ...diagnostics.lastStep } : null;
  };
  const validFrame = () =>
    !document.hidden && !e.disposed && !e.pageSuspended && !e.contextLost;
  const ensureActive = () => {
    const t = e.tesla;
    if (!t?.active || !t.state || !t.world)
      throw new Error('Enter Tesla on Robson first');
    return t;
  };
  const sample = (started: number) => {
    const t = ensureActive(),
      s = t.state!;
    if (!lastRun || lastRun.trace.length >= 600) return;
    lastRun.trace.push({
      elapsedMs: performance.now() - started,
      simulatedS: s.timeS,
      mode: s.mode,
      position: [...s.position],
      quaternion: [...s.quaternion],
      speedMps: t.speedMps,
      parked: s.parked,
      wallHolding: s.wallHolding,
      adhesionArmed: s.adhesionArmed,
      contact: s.contact
        ? {
            surfaceId: s.contact.surfaceId,
            kind: s.contact.kind,
            normal: [...s.contact.normal],
          }
        : null,
      attachment: s.attachment
        ? {
            index: s.attachment.index,
            count: s.attachment.waypoints.length,
            surfaceId: s.attachment.contact.surfaceId,
          }
        : null,
      step: step(),
    });
  };
  const clear = () => {
    e.tesla?.clearInput();
    e.tesla?.setButton('up', false);
    e.tesla?.setButton('brake', false);
  };
  const button = (
    text: string,
    action: () => void | Promise<void>,
    stop = false,
  ) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = () => {
      if (!stop && lease.isRunning()) return;
      try {
        const result = action();
        if (result)
          return result.catch((error: unknown) => {
            status.textContent = String(error);
          });
      } catch (error) {
        status.textContent = String(error);
      }
    };
    panel.appendChild(b);
  };
  const run = async (
    kind: string,
    action: (signal: AbortSignal, started: number) => Promise<void>,
  ) => {
    if (!lease.begin()) return;
    const controller = new AbortController();
    motion = controller;
    const started = performance.now();
    lastRun = {
      kind,
      startedAt: new Date().toISOString(),
      result: 'running',
      trace: [],
    };
    const hide = () => {
      if (document.hidden) controller.abort();
    };
    document.addEventListener('visibilitychange', hide);
    try {
      await action(controller.signal, started);
      lastRun.result = 'completed';
    } catch (error) {
      lastRun.result = String(error);
      status.textContent = String(error);
    } finally {
      clear();
      document.removeEventListener('visibilitychange', hide);
      if (motion === controller) motion = null;
      output.value = JSON.stringify(lastRun, null, 2);
      lease.end();
    }
  };
  const spawnRobson = () => {
    e.tesla?.deactivate();
    e.flight?.clear();
    e.navigation?.blur();
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      buildings: true,
      labels: false,
      autoRotate: false,
    });
    e.transition = null;
    e.controls.target.set(ROBSON[0], e.elevation(...ROBSON), ROBSON[1]);
    e.setClock({ hour: 14, running: false });
    if (!e.tesla?.enter())
      throw new Error('Robson has no proven full-vehicle road spawn');
    e.tesla.setView('chase');
    e.tesla.clearInput();
    caseName = 'robson';
    status.textContent = `Tesla QA on Robson: ${e.tesla.state?.contact?.surfaceId ?? 'unproven'}`;
  };
  button('Tesla QA: spawn Robson', () =>
    run('robson-ground-spawn', async (_signal, started) => {
      spawnRobson();
      sample(started);
    }),
  );
  const approachWall = (automaticHold: boolean) =>
    run(
      automaticHold
        ? 'real-building-wall-auto-hold'
        : 'real-building-wall-approach',
      async (signal, started) => {
        if (!e.tesla?.active) spawnRobson();
        const t = ensureActive(),
          world = t.world!,
          nav = e.navigation;
        if (!nav) throw new Error('Navigation unavailable');
        clear();
        if (!automaticHold) t.setButton('brake', true);
        lastRun!.inputs = {
          throttleReleased: false,
          brakeRequestedOnWall: false,
          parkCommandRequested: false,
        };
        const candidates = teslaQAWallCandidates(
          e.data.flightBuildingVolumes ?? [],
        );
        status.textContent = `Tesla QA checking ${candidates.length} real building faces`;
        let selected: {
          candidate: WallCandidate;
          spawn: NonNullable<ReturnType<typeof world.groundPoseNear>>;
          surfaceId: string;
          heading: number;
        } | null = null;
        for (let index = 0; index < candidates.length && !selected; index++) {
          if (index % 4 === 0) await nextFrame(signal);
          if (!validFrame())
            throw new Error('Tesla QA requires a live foreground WebGL frame');
          const candidate = candidates[index],
            [nx, nz] = candidate.normal,
            heading = Math.atan2(-nx, -nz);
          for (const distance of [10, 14, 18]) {
            const x = candidate.midpoint[0] + nx * distance,
              z = candidate.midpoint[1] + nz * distance,
              y = e.data.roadRelief?.(x, z) ?? e.elevation(x, z),
              spawn = world.groundPoseNear(
                [x, y + 1.05, z],
                t.shape,
                heading,
                0,
              );
            if (!spawn) continue;
            // Public entry prefers a clear launch corridor. Use the same proof so
            // it will retain this actual road seed instead of relocating the test.
            if (automaticHold && !world.hasLaunchClearance(spawn, t.shape))
              continue;
            const hit = world.sweep({
              from: spawn.pose,
              to: {
                position: [
                  candidate.midpoint[0],
                  spawn.pose.position[1],
                  candidate.midpoint[1],
                ],
                quaternion: spawn.pose.quaternion,
              },
              shape: t.shape,
              ignoreSurfaceId: spawn.contact.surfaceId,
            });
            if (
              hit?.kind !== 'wall' ||
              !hit.adherable ||
              !hit.surfaceId.startsWith('building:') ||
              hit.normal[0] * nx + hit.normal[2] * nz < 0.98
            )
              continue;
            selected = { candidate, spawn, surfaceId: hit.surfaceId, heading };
            break;
          }
        }
        if (!selected)
          throw new Error(
            'No clear asphalt-to-building approach; no wall state was forced',
          );
        lastRun!.target = clone(selected);
        // This is an initial, proven GROUND spawn. From here onward only ordinary
        // controller inputs move or rotate the car, including the complete corner.
        t.deactivate();
        e.applySettings({
          ...e.settings,
          mode: 'drive',
          buildings: true,
          labels: false,
          autoRotate: false,
        });
        const { pose, contact } = selected.spawn;
        const placed = nav.startAt('drive', {
          x: pose.position[0],
          z: pose.position[2],
          y: contact.point[1] + 1.05,
          yaw: selected.heading,
          surface: 'ground',
          surfaceId: 'ground',
          layer: 0,
          name: 'Tesla QA actual building approach',
          snappedDistance: 0,
        });
        if (placed === false || !t.enter())
          throw new Error(
            'Proven ground approach rejected by the real controller',
          );
        if (
          Math.hypot(
            t.state!.position[0] - pose.position[0],
            t.state!.position[2] - pose.position[2],
          ) > 0.5
        )
          throw new Error(
            'Controller selected a different ground spawn; approach cancelled',
          );
        t.setView('chase');
        t.clearInput();
        caseName = automaticHold ? 'building-wall-auto-hold' : 'building-wall';
        sample(started);
        const movingAt = performance.now();
        let lastSample = -Infinity,
          askedPark = false,
          releasedAt: number | null = null,
          heldAt: number | null = null,
          heldPose: { position: number[]; quaternion: number[] } | null = null;
        while (
          performance.now() - movingAt <
          (automaticHold ? 35_000 : 20_000)
        ) {
          await nextFrame(signal);
          if (!validFrame() || !t.active)
            throw new Error('Tesla QA interrupted before wall proof');
          const s = t.state!;
          if (performance.now() - lastSample >= 100) {
            sample(started);
            lastSample = performance.now();
          }
          if (s.mode === 'wall' && !s.attachment) {
            if (s.contact?.surfaceId !== selected.surfaceId)
              throw new Error(
                'A different wall was reached; inspect the real trace',
              );
            t.setAxes(0, 0);
            lastRun!.inputs!.throttleReleased = true;
            if (automaticHold) {
              t.setButton('brake', false);
              releasedAt ??= performance.now();
              if (s.parked)
                throw new Error(
                  'Manual parking cannot qualify as automatic wall hold',
                );
              const holding = s.wallHolding && s.velocity.every((v) => v === 0);
              if (heldPose) {
                if (
                  !holding ||
                  s.position.some((v, i) => v !== heldPose!.position[i]) ||
                  s.quaternion.some((v, i) => v !== heldPose!.quaternion[i])
                )
                  throw new Error(
                    'Automatic wall hold lost its exact stationary pose',
                  );
                lastRun!.verifiedHoldMs = performance.now() - heldAt!;
                if (lastRun!.verifiedHoldMs >= 8_000) {
                  sample(started);
                  status.textContent = `Tesla QA automatic hold on ${s.contact.surfaceId}: 8s exact pose, no P or brake`;
                  return;
                }
              } else if (holding) {
                heldAt = performance.now();
                heldPose = {
                  position: [...s.position],
                  quaternion: [...s.quaternion],
                };
                lastRun!.verifiedHoldMs = 0;
              } else if (performance.now() - releasedAt > 5_000)
                throw new Error(
                  'Automatic wall hold did not settle after throttle release',
                );
              status.textContent = `Tesla QA ${heldPose ? 'verifying 8s automatic wall hold' : 'released throttle; waiting for automatic wall hold'}`;
              continue;
            }
            t.setButton('brake', true);
            lastRun!.inputs!.brakeRequestedOnWall = true;
            if (!s.parked && !askedPark) {
              t.command('park');
              askedPark = true;
              lastRun!.inputs!.parkCommandRequested = true;
            }
            if (s.parked) {
              sample(started);
              status.textContent = `Tesla QA parked on ${s.contact.surfaceId} through real simulation`;
              return;
            }
          } else {
            if (releasedAt !== null)
              throw new Error('Automatic wall hold left the proven wall');
            if (performance.now() - movingAt >= 20_000)
              throw new Error(
                'Wall approach timed out; no adhesion pose was forced',
              );
            t.setAxes(0, s.attachment ? 0 : 0.14);
            status.textContent = `Tesla QA ${s.attachment ? 'sweeping full corner' : 'driving to real wall'}: ${t.speedMps.toFixed(1)} m/s`;
          }
        }
        throw new Error('Wall approach timed out; no adhesion pose was forced');
      },
    );
  button('Tesla QA: approach real wall + park', () => approachWall(false));
  button('Tesla QA: approach real wall + auto hold', () => approachWall(true));
  button('Tesla QA: launch fly', () =>
    run('ground-to-flight-input', async (signal, started) => {
      const t = ensureActive();
      clear();
      caseName = 'flight';
      if (t.state!.mode !== 'air') t.command('jump');
      t.setButton('up', true);
      const launchAt = performance.now();
      let lastSample = -Infinity;
      while (performance.now() - launchAt < 3000) {
        await nextFrame(signal);
        if (!validFrame() || !t.active)
          throw new Error('Tesla launch interrupted');
        if (performance.now() - lastSample >= 100) {
          sample(started);
          lastSample = performance.now();
        }
      }
      t.setButton('up', false);
      sample(started);
      if (t.state!.mode !== 'air')
        throw new Error(
          'Real lift input did not reach air; inspect the recorded physics',
        );
      status.textContent = `Tesla QA released lift after 3s: ${t.state!.mode}, ${t.snapshot.altitudeM}m; manual controls are live`;
    }),
  );
  button(
    'Tesla QA: stop',
    () => {
      if (motion) {
        motion.abort();
        clear();
      }
    },
    true,
  );
  for (const view of ['chase', 'cockpit'] as const)
    button(`Tesla QA: ${view}`, () => {
      ensureActive().setView(view);
      status.textContent = `Tesla QA view ${view}`;
    });
  for (const quality of ['low', 'medium', 'high', 'auto'] as const)
    button(`Tesla QA: ${quality}`, () => {
      ensureActive().setQuality(quality);
      status.textContent = `Tesla QA requested ${quality}`;
    });
  button('Tesla QA: save checkpoint', async () => {
    if (!lease.begin()) return;
    const controller = new AbortController();
    const hidden = () => {
      if (document.hidden) controller.abort();
    };
    document.addEventListener('visibilitychange', hidden);
    try {
      if (!validFrame())
        throw new Error('Tesla capture needs a live foreground frame');
      await nextFrame(controller.signal);
      const screenshot = e.screenshot(),
        capturedAt = new Date().toISOString(),
        t = e.tesla,
        snapshot = t?.snapshot ?? null,
        user = label.value
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40),
        name = `tesla-${user || caseName}-${snapshot?.mode ?? 'inactive'}-${snapshot?.view ?? 'none'}-${snapshot?.quality ?? 'none'}-${capturedAt.toLowerCase().replace(/[^a-z0-9]/g, '')}-${String(++sequence).padStart(3, '0')}`,
        row = {
          kind: 'city-tesla-webgl-v1',
          id: name,
          capturedAt,
          valid: validFrame() && !!t?.active,
          localOptIn: true,
          case: caseName,
          snapshot,
          state: t?.state ? clone(t.state) : null,
          steps: step(),
          activeLOD: t?.model?.stats() ?? null,
          world: t?.world?.stats() ?? null,
          shape: t?.shape ? clone(t.shape) : null,
          scenario: lastRun ? clone(lastRun) : null,
          settings: { ...e.settings },
          hour: e.clock.hour,
          night: e.uniforms.night.value,
          compatible: e.compatibleGraphics,
          fps: e.stats.fps,
          viewport: [innerWidth, innerHeight],
          render: [e.renderer.domElement.width, e.renderer.domElement.height],
          pixelRatio: e.renderer.getPixelRatio(),
          camera: {
            position: e.camera.position.toArray(),
            quaternion: e.camera.quaternion.toArray(),
            up: e.camera.up.toArray(),
            target: e.controls.target.toArray(),
            near: e.camera.near,
            far: e.camera.far,
            fov: e.camera.fov,
          },
          renderer: {
            calls: e.renderer.info.render.calls,
            triangles: e.renderer.info.render.triangles,
            points: e.renderer.info.render.points,
            lines: e.renderer.info.render.lines,
            geometries: e.renderer.info.memory.geometries,
            textures: e.renderer.info.memory.textures,
          },
          workerErrors: e.data.landmarkWorkerErrors ?? {},
        };
      output.value = JSON.stringify(row, null, 2);
      const response = await fetch('/__visual-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, row, screenshot }),
      });
      if (!response.ok)
        throw new Error(`Tesla QA capture failed ${response.status}`);
      status.textContent = `Saved ${name}`;
    } catch (error) {
      status.textContent = String(error);
    } finally {
      document.removeEventListener('visibilitychange', hidden);
      lease.end();
    }
  });
  panel.appendChild(output);
}
