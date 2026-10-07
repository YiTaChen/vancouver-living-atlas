/** Explicit local visual QA only; imported exclusively from the stripped QA entry. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';

export function installAutoQualityQA(
  e: CityEngine,
  panel: HTMLElement,
  lease: { isRunning(): boolean; begin(): boolean; end(): void },
) {
  let name = 'initial',
    recording = false,
    startedAt = 0,
    previousAt = 0;
  const frames: {
    elapsedMs: number;
    frameMs: number;
    quality: VisualQuality;
    scale: number;
    mode: string;
    speedMps: number;
    altitudeM: number;
    position: number[];
    triangles: number;
    calls: number;
    geometries: number;
    detailWorkMs: number;
    overruns: number;
  }[] = [];
  const report = document.createElement('p');
  report.id = 'auto-quality-qa-status';
  report.textContent = 'Auto travel QA ready';
  panel.appendChild(report);
  const renderScene = e.renderScene.bind(e);
  e.renderScene = () => {
    renderScene();
    if (!recording || document.hidden || e.pageSuspended || e.transition) {
      previousAt = 0;
      return;
    }
    const now = performance.now();
    if (!startedAt) startedAt = now;
    if (previousAt)
      frames.push({
        elapsedMs: now - startedAt,
        frameMs: now - previousAt,
        quality: e.settings.quality,
        scale:
          e.settings.qualityMode === 'auto'
            ? e.autoQuality.snapshot().resolutionScale
            : 1,
        mode: e.settings.mode,
        speedMps: e.sceneryMotion?.speedMps ?? 0,
        altitudeM: e.sceneryMotion?.altitudeM ?? 0,
        position: e.camera.position.toArray(),
        triangles: e.renderer.info.render.triangles,
        calls: e.renderer.info.render.calls,
        geometries: e.renderer.info.memory.geometries,
        detailWorkMs: e.detailWorkBudget?.stats.usedMs ?? 0,
        overruns: e.detailWorkBudget?.stats.overruns ?? 0,
      });
    previousAt = now;
    if (frames.length >= 2400 || now - startedAt >= 60_000) {
      recording = false;
      report.textContent = `Captured ${name}: ${frames.length} foreground frames`;
    }
  };
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = () => {
      if (!lease.isRunning()) action();
    };
    panel.appendChild(b);
  };
  const record = (id: string) => {
    name = id;
    frames.length = 0;
    startedAt = previousAt = 0;
    recording = true;
    report.textContent = `Recording ${name}`;
  };
  const select = (quality: VisualQuality | null) => {
    e.applySettings({
      ...e.settings,
      qualityMode: quality ? 'manual' : 'auto',
      ...(quality ? { quality } : {}),
      autoRotate: false,
      labels: false,
    });
  };
  button('Auto: use automatic quality', () => {
    select(null);
    record(`${e.settings.mode}-auto`);
  });
  for (const quality of ['balanced', 'high', 'ultra'] as const)
    button(`Auto: force ${quality}`, () => {
      select(quality);
      record(`${e.settings.mode}-manual-${quality}`);
    });
  const street = (mode: 'walk' | 'drive') => {
    e.flight?.clear();
    e.navigation?.blur();
    e.setClock({ hour: 14, running: false });
    e.applySettings({ ...e.settings, mode, autoRotate: false, labels: false });
    e.navigation?.setMode(mode, 'ROBSON ST');
    if (e.navigation?.mode !== mode)
      throw new Error('Travel QA placement failed');
    e.onTravelResume(mode);
    e.navigation!.cameraDistances[mode] = mode === 'drive' ? 10 : 0;
    e.navigation!.snapCamera = true;
    e.navigation!.update(0);
    e.navigation!.keys.add('w');
    record(`${mode}-${e.settings.qualityMode}-${e.settings.quality}`);
  };
  button('Auto: walk Robson', () => street('walk'));
  button('Auto: drive Robson', () => street('drive'));
  button('Auto: helicopter cruise', () => {
    e.navigation?.blur();
    e.setClock({ hour: 14, running: false });
    e.flight!.quick('helicopter');
    e.flight!.enableCruise(true);
    record(`flight-${e.settings.qualityMode}-${e.settings.quality}`);
  });
  button('Auto: stop travel', () => {
    e.navigation?.blur();
    if (e.flight?.state?.kind === 'helicopter' && !e.flight.state.hover)
      e.flight.hover();
    recording = false;
    report.textContent = `Stopped ${name}`;
  });
  button('Auto: record current travel', () =>
    record(
      `${e.settings.mode}-${e.settings.qualityMode}-${e.settings.quality}-cruise`,
    ),
  );
  button('Auto: save checkpoint', () => {
    if (!lease.begin()) return;
    const visible = !document.hidden && !e.disposed && !e.pageSuspended;
    const row = {
      kind: 'auto-quality-travel',
      name,
      valid: visible,
      settings: { ...e.settings },
      auto: e.autoQuality.snapshot(),
      motion: e.sceneryMotion,
      detailWork: e.detailWorkBudget?.stats,
      viewport: [innerWidth, innerHeight],
      render: [e.renderer.domElement.width, e.renderer.domElement.height],
      pixelRatio: e.renderer.getPixelRatio(),
      flight: e.flight?.state ? { ...e.flight.state } : null,
      navigation: {
        mode: e.navigation?.mode,
        speed: e.navigation?.speed,
        position: e.navigation?.position.toArray(),
      },
      pedestrians: e.pedestrians?.stats(),
      frames: [...frames],
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `auto-${name}`,
        row,
        screenshot: e.screenshot(),
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`QA save failed ${r.status}`);
        report.textContent = `Saved ${name}: ${frames.length} frames`;
      })
      .catch((err) => {
        report.textContent = String(err);
      })
      .finally(() => lease.end());
  });
}
