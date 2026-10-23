/** Local QA only. Fixed pilot poses and raw RAF samples; never a public feature. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project } from './geo';
import { clearQAOrbitMomentum } from './upgrade-qa-pose';

type Lease = { begin(): boolean; end(): void; isRunning(): boolean };
type Pose = 'robson-drive' | 'burrard-eye' | 'corner-eye' | 'roadster-detail';
const WIDTH = 1280,
  HEIGHT = 720;
const INTERSECTION = [-123.1228089, 49.2832957] as const;
const ROBSON = [-123.12381, 49.28395] as const;
const BURRARD = [-123.12219, 49.28371] as const;
const percentile = (a: readonly number[], p: number) => {
  if (!a.length) return null;
  const sorted = [...a].sort((x, y) => x - y);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))
  ];
};

export function installStreetPilotQA(
  e: CityEngine,
  parent: HTMLElement,
  lease: Lease,
) {
  const originalOrbitMinDistance = e.controls.minDistance;
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Robson Burrard pilot evidence');
  section.style.cssText = 'border:1px solid #bdd3a0;padding:8px;margin:8px 0';
  const title = document.createElement('strong');
  title.textContent = 'Robson / Burrard — matched pilot';
  const status = document.createElement('p');
  status.id = 'street-pilot-status';
  status.textContent = '1280×720 drawing buffer, High manual; select a pose';
  const output = document.createElement('textarea');
  output.setAttribute('aria-label', 'Street pilot evidence');
  output.style.cssText = 'display:block;width:100%;height:60px';
  section.appendChild(title);
  section.appendChild(status);
  parent.insertBefore(section, parent.firstChild);
  let pose: Pose = 'robson-drive',
    sequence = 0;
  let suiteRunning = false;

  const fixedResolution = () => {
    e.renderer.setPixelRatio(1);
    e.renderer.setSize(WIDTH, HEIGHT, false);
    e.composer?.setPixelRatio(1);
    e.composer?.setSize(WIDTH, HEIGHT);
    e.fxaa?.uniforms.resolution.value.set(1 / WIDTH, 1 / HEIGHT);
    e.camera.aspect = WIDTH / HEIGHT;
    e.camera.updateProjectionMatrix();
  };
  const select = (next: Pose) => {
    const nav = e.navigation;
    if (!nav) return;
    e.controls.minDistance = originalOrbitMinDistance;
    pose = next;
    nav.keys.clear();
    nav.setMode('orbit');
    nav.car.visible = false;
    e.transition = null;
    e.setAtmosphere('clear');
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      quality: 'high',
      qualityMode: 'manual',
      labels: false,
      autoRotate: false,
    });
    e.setClock({ hour: 14, running: false });
    clearQAOrbitMomentum(e.controls);
    const [cx, cz] = project(INTERSECTION);
    const [x, z] = project(
      next === 'robson-drive' || next === 'roadster-detail'
        ? ROBSON
        : next === 'burrard-eye'
          ? BURRARD
          : INTERSECTION,
    );
    const ground = e.elevation(x, z);
    if (next === 'robson-drive' || next === 'roadster-detail') {
      e.controls.target.set(x, ground, z);
      // Deliberately omit the exact anchor-map key so selection uses this pilot target.
      nav.setMode('drive', 'ROBSON');
      e.applySettings({
        ...e.settings,
        mode: 'drive',
        quality: 'high',
        qualityMode: 'manual',
      });
      nav.setCarModel('roadster');
      nav.cameraDistances.drive = 14;
      nav.snapCamera = true;
      nav.update(0);
      if (next === 'roadster-detail') {
        // A fixed observer separates material changes from the revised chase.
        // Keep the exact existing parked car visible in this QA-only orbit view.
        nav.setMode('orbit');
        e.applySettings({ ...e.settings, mode: 'orbit' });
        nav.car.visible = true;
        const offset = new THREE.Vector3(4.6, 2.5, 5.3).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          nav.yaw,
        );
        e.camera.position.copy(nav.car.position).add(offset);
        e.controls.target
          .copy(nav.car.position)
          .add(new THREE.Vector3(0, 0.72, 0));
        e.camera.fov = 40;
        e.camera.near = 0.2;
        e.camera.lookAt(e.controls.target);
        // QA-only close-up: the normal 28 m orbit floor otherwise expands this
        // authored 7.24 m observer. Every other pose restores the install value.
        e.controls.minDistance = Math.min(originalOrbitMinDistance, 2);
        e.controls.update();
      }
    } else {
      e.camera.near = 0.2;
      e.camera.fov = 48;
      if (next === 'burrard-eye') {
        e.camera.position.set(x + 7, ground + 2.2, z - 7);
        e.controls.target.set(cx, e.elevation(cx, cz) + 6, cz);
      } else {
        // Same street-corner observer before/after; independent of the improved chase camera.
        e.camera.position.set(cx - 17, ground + 2.2, cz - 6);
        e.controls.target.set(cx + 42, ground + 5, cz + 38);
      }
      e.camera.lookAt(e.controls.target);
      e.controls.update();
    }
    fixedResolution();
    e.renderer.shadowMap.needsUpdate = true;
    status.textContent = `Selected ${pose} / High / 14h / 1280×720`;
  };
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:6px;margin:3px;border:1px solid #aac4bc';
    b.onclick = () => {
      if (!lease.isRunning() && !suiteRunning) action();
    };
    section.appendChild(b);
  };
  for (const name of [
    'robson-drive',
    'burrard-eye',
    'corner-eye',
    'roadster-detail',
  ] as const)
    button(`Pilot pose: ${name}`, () => select(name));
  button('Pilot time: day', () => {
    e.setClock({ hour: 14, running: false });
    status.textContent = `${pose} / 14h`;
  });
  button('Pilot time: night', () => {
    e.setClock({ hour: 23, running: false });
    status.textContent = `${pose} / 23h`;
  });

  async function capture(drive: boolean) {
    if (!lease.begin()) return;
    const nav = e.navigation!;
    const gaps: number[] = [],
      calls: number[] = [],
      triangles: number[] = [];
    let previous: number | null = null,
      hidden = false;
    const start = performance.now();
    const startPosition = nav.position.toArray();
    const cameraStart = e.camera.position.toArray();
    const targetStart = e.controls.target.toArray();
    const targetDistanceStart = e.camera.position.distanceTo(e.controls.target);
    const kind = drive ? 'travel' : 'still';
    try {
      if (drive && nav.mode !== 'drive')
        throw new Error('Select the Robson drive pose first');
      fixedResolution();
      status.textContent = `Measuring ${pose} / ${kind} / 12s; do not hide this tab`;
      if (drive) nav.keys.add('w');
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          hidden ||= document.hidden;
          if (previous !== null) gaps.push(now - previous);
          previous = now;
          calls.push(e.renderer.info.render.calls);
          triangles.push(e.renderer.info.render.triangles);
          if (now - start >= 12000 || e.disposed || e.contextLost) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      nav.keys.clear();
      const elapsed = performance.now() - start;
      const pilot = (e as unknown as { streetShowcase?: { stats?: unknown } })
        .streetShowcase;
      const row = {
        kind: 'robson-burrard-pilot-v1',
        pose,
        action: kind,
        valid: !hidden && !e.disposed && !e.contextLost && gaps.length > 0,
        clock: { hour: e.clock.hour, fixed: true },
        settings: { ...e.settings },
        viewport: [innerWidth, innerHeight],
        render: [e.renderer.domElement.width, e.renderer.domElement.height],
        elapsedMs: elapsed,
        frames: gaps.length,
        fps: (gaps.length * 1000) / gaps.reduce((a, b) => a + b, 0),
        p50Ms: percentile(gaps, 0.5),
        p95Ms: percentile(gaps, 0.95),
        p99Ms: percentile(gaps, 0.99),
        maxMs: Math.max(...gaps),
        over50Ms: gaps.filter((n) => n > 50).length,
        over100Ms: gaps.filter((n) => n > 100).length,
        rawRafIntervalsMs: gaps,
        calls: { median: percentile(calls, 0.5), max: Math.max(...calls) },
        triangles: {
          median: percentile(triangles, 0.5),
          max: Math.max(...triangles),
        },
        memory: { ...e.renderer.info.memory },
        camera: {
          start: cameraStart,
          end: e.camera.position.toArray(),
          targetStart,
          targetEnd: e.controls.target.toArray(),
          targetDistanceStart,
          targetDistanceEnd: e.camera.position.distanceTo(e.controls.target),
          orbitMinDistance: e.controls.minDistance,
          fov: e.camera.fov,
        },
        navigation: {
          mode: nav.mode,
          start: startPosition,
          end: nav.position.toArray(),
          speedMps: nav.speed,
        },
        pedestrians: e.pedestrians?.stats() ?? null,
        traffic: e.traffic?.vehicleAssets.stats ?? null,
        lighting: {
          sun: e.sun.intensity,
          ambient: e.ambient.intensity,
          environment: e.scene.environmentIntensity,
          exposure: e.renderer.toneMappingExposure,
        },
        showcase:
          typeof pilot?.stats === 'function'
            ? pilot.stats()
            : (pilot?.stats ?? null),
        runtimePerformance: e.runtimePerformance?.snapshot() ?? null,
        protocol:
          '12 seconds visible raw RAF; matched 1280x720 drawing buffer, manual High, fixed clear/day-or-night. Still corner is camera-matched; chase mode intentionally evaluates the changed camera. Startup/build work excluded; first scene selection and asset settling are separate. Render counters include multipass submission, not unique visible geometry.',
      };
      // Keep the visible textarea small; the saved evidence retains every raw
      // interval and the full recorder snapshot without overwhelming native AX.
      output.value = JSON.stringify(
        { ...row, rawRafIntervalsMs: undefined, runtimePerformance: undefined },
        null,
        2,
      );
      const name = `pilot-${pose}-${e.clock.hour === 23 ? 'night' : 'day'}-${kind}-${String(++sequence).padStart(2, '0')}`;
      const visible = parent.style.visibility;
      let screenshot: string;
      try {
        parent.style.visibility = 'hidden';
        screenshot = e.screenshot();
      } finally {
        parent.style.visibility = visible;
      }
      const response = await fetch('/__visual-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, row, screenshot }),
      });
      if (!response.ok)
        throw new Error(`Pilot save failed: ${response.status}`);
      status.textContent = `Saved ${name}: ${row.valid ? 'valid' : 'INVALID'}, ${row.fps.toFixed(1)} FPS, p95 ${row.p95Ms?.toFixed(1)}ms`;
    } catch (error) {
      status.textContent = String(error);
    } finally {
      nav.keys.clear();
      lease.end();
    }
  }
  button('Pilot capture: 12s still', () => {
    void capture(false);
  });
  button('Pilot capture: 12s drive', () => {
    void capture(true);
  });
  button('Pilot run: matched suite', () => {
    void runSuite();
  });
  async function runSuite() {
    if (suiteRunning || lease.isRunning()) return;
    suiteRunning = true;
    const cases: readonly [Pose, number, boolean][] = [
      ['corner-eye', 14, false],
      ['corner-eye', 14, false],
      ['robson-drive', 14, false],
      ['robson-drive', 23, false],
      ['burrard-eye', 14, false],
      ['roadster-detail', 14, false],
      ['robson-drive', 14, true],
    ];
    try {
      for (let i = 0; i < cases.length; i++) {
        const [next, hour, drive] = cases[i];
        select(next);
        e.setClock({ hour, running: false });
        status.textContent = `Suite ${i + 1}/${cases.length}: settling ${next} / ${hour}h / 12s`;
        await new Promise<void>((resolve, reject) => {
          const start = performance.now();
          const tick = (now: number) => {
            if (document.hidden || e.disposed || e.contextLost) {
              reject(new Error('Pilot suite interrupted or hidden'));
              return;
            }
            if (now - start >= 12000) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await capture(drive);
        if (!status.textContent?.startsWith('Saved'))
          throw new Error(status.textContent ?? 'Pilot capture failed');
      }
      status.textContent = `Suite complete: ${cases.length} saved windows; each has 12s settling + 12s visible capture`;
    } catch (error) {
      status.textContent = String(error);
    } finally {
      e.navigation?.keys.clear();
      suiteRunning = false;
    }
  }
  section.appendChild(output);
}
