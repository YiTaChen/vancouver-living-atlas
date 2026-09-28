/** LOCAL VISUAL QA: matched-resolution city, street and character evidence. */
import type { CityEngine } from './engine';
import type { VisualQuality } from './quality';
import { project } from './geo';

const VIEWS = [
  'atlas-aerial',
  'gastown-roofs',
  'gastown-street',
  'citizen',
] as const;
type View = (typeof VIEWS)[number];
const WIDTH = 1920,
  HEIGHT = 1080;

export function installUpgradeQA(e: CityEngine, parent: HTMLElement) {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'City quality upgrade checks');
  section.style.cssText = 'border:1px solid #b6cd85;padding:8px;margin:8px 0';
  const status = document.createElement('p');
  status.id = 'upgrade-qa-status';
  status.textContent = 'Matched 1920 × 1080 · 14:00 · four scales';
  section.appendChild(status);
  parent.insertBefore(section, parent.firstChild);
  let busy = false;
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
  }
  async function collect(duration: number) {
    const gaps: number[] = [];
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
          gaps.push(now - last);
          last = now;
          if (e.disposed || now - start >= duration) resolve();
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
      valid: !hidden && !e.disposed,
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
    if (busy) return;
    busy = true;
    try {
      for (const view of VIEWS) {
        status.textContent = `Preparing ${view} / ${quality}`;
        select(view, quality);
        await collect(5000);
        fixedResolution();
        status.textContent = `Measuring ${view} / ${quality}`;
        const sample = await collect(8000);
        const gl = e.renderer.getContext();
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const row = {
          kind: 'upgrade-matched-v1',
          id: view,
          quality,
          ...sample,
          valid:
            sample.valid &&
            e.renderer.domElement.width === WIDTH &&
            e.renderer.domElement.height === HEIGHT,
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
          renderer: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER),
          protocol:
            'Fixed 1920x1080 drawing buffer; 14h; 5s warm-up, 8s visible RAF sample. Render counters include multipass work, not unique geometry.',
        };
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${quality}-${view}`,
            row,
            screenshot: e.screenshot(),
          }),
        });
        if (!response.ok) throw new Error(`Capture failed: ${response.status}`);
      }
      status.textContent = `Completed matched ${quality}: 4 views`;
    } catch (error) {
      status.textContent = `Upgrade check failed: ${error}`;
    } finally {
      busy = false;
    }
  }
  for (const quality of ['high', 'ultra'] as const) {
    const button = document.createElement('button');
    button.textContent = `Upgrade matched ${quality}`;
    button.style.cssText = 'padding:8px;margin:3px;border:1px solid #b6cd85';
    button.onclick = () => void suite(quality);
    section.appendChild(button);
  }
  const restore = document.createElement('button');
  restore.textContent = 'Restore normal render size';
  restore.onclick = () => {
    if (busy) return;
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
