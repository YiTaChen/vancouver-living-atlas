/** LOCAL VISUAL QA release controls. Import only from the existing gated visual-qa module. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';
import { measureReleaseWindow } from './release-qa-observer';

type UI = {
  button: (label: string, callback: () => void) => void;
  apply: (id: string, quality: VisualQuality) => void;
  selectedCase: () => string;
  isColdCase: (id: string) => boolean;
  begin: () => boolean;
  end: () => void;
  panel: HTMLElement;
  status: HTMLElement;
  output: HTMLTextAreaElement;
};
const routes: Record<string, 'drive' | 'walk' | 'boat'> = {
  'robson-drive': 'drive',
  'burrard-drive': 'drive',
  'robson-walk': 'walk',
  'open-harbour-boat': 'boat',
};
const hourId = (hour: number) => hour.toFixed(2).replace('.', 'p') + 'h';

export function installReleaseQAControls(e: CityEngine, ui: UI) {
  const save = async (
    row: Record<string, unknown>,
    id: string,
    quality: VisualQuality,
  ) => {
    ui.output.value = JSON.stringify(row, null, 2);
    let screenshot: string;
    const visibility = ui.panel.style.visibility;
    try {
      ui.panel.style.visibility = 'hidden';
      screenshot = e.screenshot();
    } finally {
      ui.panel.style.visibility = visibility;
    }
    // Screenshot encoding and POST happen after measureReleaseWindow has restored hooks.
    const response = await fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${quality}-${id}`, row, screenshot }),
    });
    if (!response.ok)
      throw new Error(`Release QA save failed: ${response.status}`);
  };
  const settle = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const start = performance.now();
      const frame = () => {
        if (document.hidden || e.disposed) {
          reject(new Error('QA setup hidden/disposed'));
          return;
        }
        if (performance.now() - start >= ms) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  async function cold() {
    if (!ui.begin()) return;
    try {
      const selected = ui.selectedCase(),
        hour = e.clock.hour;
      if (!ui.isColdCase(selected))
        throw new Error('Select a landmark/view case for cold Ultra.');
      if (
        e.settings.quality !== 'high' ||
        e.landmarkDetails.some((d) => !!d.ultra)
      )
        throw new Error(
          'Cold test requires a fresh High page with no Ultra models already cached.',
        );
      const id = `${selected}-cold-ultra-8s-${hourId(hour)}`;
      ui.status.textContent = `Cold Ultra / ${selected} / ${hourId(hour)} / 8s, no warm-up`;
      const report = await measureReleaseWindow(e, {
        durationMs: 8000,
        expectedMode: 'orbit',
        action: () => {
          ui.apply(selected, 'ultra');
          // apply() currently forces 14:00. Retain the selected hour for this fixed-time QA window.
          e.setClock({ hour, running: false });
        },
      });
      const arrived = report.landmarks.filter(
        (l) => !l.ultraPresentInitially && l.firstSubmittedMs !== null,
      );
      const row = {
        kind: 'release-cold-detail-v1',
        id,
        quality: 'ultra',
        hour,
        valid: report.valid && arrived.length > 0,
        environmentValid: report.valid,
        arrivalCount: arrived.length,
        measurement: report,
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        render: [e.renderer.domElement.width, e.renderer.domElement.height],
        camera: e.camera.position.toArray(),
        target: e.controls.target.toArray(),
        protocol:
          '8 wall seconds, observer starts before apply; no discarded warm-up. First submission is not pixel verification.',
      };
      await save(row, id, 'ultra');
      ui.status.textContent = `Saved cold ${selected}: ${row.valid ? 'PASS' : 'CHECK FAILURE'}; ${arrived.length} Ultra arrivals`;
    } catch (error) {
      ui.status.textContent = String(error);
    } finally {
      e.navigation?.keys.clear();
      ui.end();
    }
  }
  async function travel() {
    if (!ui.begin()) return;
    try {
      const selected = ui.selectedCase(),
        mode = routes[selected],
        quality = e.settings.quality,
        hour = e.clock.hour;
      if (!mode)
        throw new Error(
          'Select Robson drive/walk, Burrard drive, or open-harbour-east-boat.',
        );
      ui.apply(selected, quality);
      e.setClock({ hour, running: false });
      await settle(2500);
      const start = e.navigation!.position.toArray();
      if (e.navigation!.mode !== mode)
        throw new Error('Release route setup did not enter its expected mode.');
      const id = `${selected}-release-travel-60s-${hourId(hour)}`;
      ui.status.textContent = `Release travel / ${selected} / ${quality} / 60s`;
      const report = await measureReleaseWindow(e, {
        durationMs: 60000,
        expectedMode: mode,
        action: () => e.navigation!.keys.add('w'),
      });
      e.navigation!.keys.clear();
      const traces = report.trace as {
        elapsedMs: number;
        windowMs: number;
        windowMeters: number;
        heldKeys: string[];
        quality: VisualQuality;
      }[];
      const inputsHeld = traces.every((t) => t.heldKeys.includes('w'));
      const qualityStable = traces.every((t) => t.quality === quality);
      const stalled = traces.some(
        (t, i) =>
          i > 0 &&
          t.elapsedMs > 5000 &&
          t.windowMeters + traces[i - 1].windowMeters < 0.5 &&
          t.windowMs + traces[i - 1].windowMs >= 1800,
      );
      const enoughTrace = traces.length >= 30 && report.submittedFrames > 1;
      const continuous =
        enoughTrace &&
        inputsHeld &&
        qualityStable &&
        !stalled &&
        report.collisionFrames === 0;
      const row = {
        kind: 'release-travel-v1',
        id,
        quality,
        hour,
        valid: report.valid && continuous,
        environmentValid: report.valid,
        continuity: {
          continuous,
          enoughTrace,
          inputsHeld,
          qualityStable,
          stalled,
        },
        measurement: report,
        viewport: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        render: [e.renderer.domElement.width, e.renderer.domElement.height],
        start,
        end: e.navigation!.position.toArray(),
        camera: e.camera.position.toArray(),
        target: e.controls.target.toArray(),
        mode: e.navigation!.mode,
        protocol:
          '60 wall seconds after 2.5s setup; only W input; actual nav.update dt cap recorded as simulationSeconds. No position or heading replay.',
      };
      await save(row, id, quality);
      ui.status.textContent = `Saved ${selected}: ${row.valid ? 'PASS' : 'CHECK FAILURE'}; ${report.traveledMeters.toFixed(1)}m / ${report.travelSimulationSeconds.toFixed(1)} simulated s`;
    } catch (error) {
      ui.status.textContent = String(error);
    } finally {
      e.navigation?.keys.clear();
      ui.end();
    }
  }
  ui.button('Measure cold Ultra 8s', () => void cold());
  ui.button('Measure release travel 60s', () => void travel());
}
