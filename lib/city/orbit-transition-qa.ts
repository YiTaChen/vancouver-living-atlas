/** Explicit local visual-QA only. Observes frames; never grants motion permission. */
import type { CityEngine } from './engine';
import { qualityPixelRatio } from './quality';

const CAPACITY = 480;
const installed = new WeakMap<CityEngine, () => void>();
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown error';

interface Frame {
  index: number;
  nowMs: number;
  camera: number[];
  quaternion: number[];
  up: number[];
  target: number[];
  near: number;
  far: number;
  quality: string;
  qualityMode: string;
  resolutionScale: number;
  pixelRatio: number;
  render: number[];
  transition: boolean;
  hour: number;
  trees: boolean;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}
type RenderFrame = Frame & { renderSceneCpuMs: number; error?: string };

const loopback = () =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    globalThis.location?.hostname ?? '',
  );

export function installOrbitTransitionQA(e: CityEngine, panel: HTMLElement) {
  if (
    (process.env.VANCOUVER_VISUAL_QA !== '1' &&
      process.env.VANCOUVER_ORBIT_QA !== '1') ||
    !loopback()
  )
    return;
  return installIntoPanel(e, panel);
}

/** Standalone instrumentation avoids loading the other visual-QA modules. */
export function installStandaloneOrbitTransitionQA(e: CityEngine) {
  if (process.env.VANCOUVER_ORBIT_QA !== '1' || !loopback()) return;
  const panel = document.createElement('aside'),
    hide = document.createElement('button'),
    show = document.createElement('button');
  panel.id = 'standalone-orbit-transition-qa';
  panel.setAttribute('aria-label', 'Standalone orbit transition QA');
  panel.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:min(310px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:8px;background:#10272e;color:#e4f2f3;border:1px solid #709598;font:12px sans-serif';
  hide.type = show.type = 'button';
  hide.textContent = 'Orbit QA: Hide';
  show.textContent = 'Orbit QA: Show';
  hide.style.cssText = 'min-height:48px;padding:7px;cursor:pointer';
  show.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;min-height:48px;padding:7px;cursor:pointer;display:none';
  show.style.display = 'none';
  show.setAttribute('aria-controls', panel.id);
  hide.onclick = () => {
    panel.style.display = 'none';
    show.style.display = 'block';
  };
  show.onclick = () => {
    panel.style.display = 'block';
    show.style.display = 'none';
  };
  const dispose = installIntoPanel(e, panel, () => {
    hide.onclick = show.onclick = null;
    panel.remove();
    show.remove();
  });
  panel.appendChild(hide);
  document.body.appendChild(panel);
  document.body.appendChild(show);
  return dispose;
}

function installIntoPanel(
  e: CityEngine,
  panel: HTMLElement,
  onDispose?: () => void,
) {
  installed.get(e)?.();
  const section = document.createElement('section'),
    status = document.createElement('p');
  section.id = 'orbit-transition-qa';
  section.setAttribute('aria-label', 'Orbit transition QA');
  status.textContent = 'Orbit transition QA ready — Normal';
  // oxlint-disable-next-line typescript/unbound-method -- Preserve exact owner identity; wrappers invoke it with .call(this).
  const originalFly = e.fly;
  // oxlint-disable-next-line typescript/unbound-method -- Preserve exact owner identity; wrappers invoke it with .call(this).
  const originalRender = e.renderScene;
  // oxlint-disable-next-line typescript/unbound-method -- Preserve exact owner identity; wrappers invoke it with .call(this).
  const originalDestroy = e.destroy;
  const canvas = e.renderer.domElement,
    frames: (RenderFrame | undefined)[] = Array.from(
      { length: CAPACITY },
      () => undefined,
    ),
    installedAt = new Date().toISOString();
  let active = true,
    lost = false,
    mode: 'normal' | 'instant' = 'normal',
    index = 0,
    count = 0,
    sequence = 0,
    latestPreframe: Frame | null = null,
    lastFly: {
      id: string;
      requestedAnimate: boolean;
      effectiveAnimate: boolean;
      nowMs: number;
    } | null = null;
  const snapshot = (): Frame => {
    const width = Math.max(1, e.container.clientWidth),
      height = Math.max(1, e.container.clientHeight),
      rawRatio = qualityPixelRatio(
        e.settings.quality,
        width,
        height,
        globalThis.devicePixelRatio || 1,
      ),
      baseRatio = e.compatibleGraphics
        ? Math.min(rawRatio, 1, Math.sqrt(1_000_000 / (width * height)))
        : rawRatio,
      pixelRatio = e.renderer.getPixelRatio();
    return {
      index,
      nowMs: performance.now(),
      camera: e.camera.position.toArray(),
      quaternion: e.camera.quaternion.toArray(),
      up: e.camera.up.toArray(),
      target: e.controls.target.toArray(),
      near: e.camera.near,
      far: e.camera.far,
      quality: e.settings.quality,
      qualityMode: e.settings.qualityMode ?? 'manual',
      resolutionScale: pixelRatio / baseRatio,
      pixelRatio,
      render: [canvas.width, canvas.height],
      transition: !!e.transition,
      hour: e.clock.hour,
      trees: e.settings.trees,
      calls: e.renderer.info.render.calls,
      triangles: e.renderer.info.render.triangles,
      geometries: e.renderer.info.memory.geometries,
      textures: e.renderer.info.memory.textures,
    };
  };
  const ordered = () =>
    Array.from(
      { length: count },
      (_, i) => frames[(index - count + i) % CAPACITY]!,
    );
  const save = async (reason: 'manual' | 'context-lost', message = '') => {
    const capturedAt = new Date().toISOString(),
      name = `orbit-${reason}-${capturedAt.toLowerCase().replace(/[^a-z0-9]/g, '')}-${String(++sequence).padStart(3, '0')}`,
      row = {
        kind: 'city-orbit-transition-trace-v1',
        localOptIn: true,
        installedAt,
        capturedAt,
        reason,
        message,
        animation: mode,
        lastFly,
        capacity: CAPACITY,
        frameCount: index,
        droppedFrames: Math.max(0, index - count),
        latestPreframe,
        frames: ordered(),
      };
    // No screenshot/GL query: context loss may immediately destroy the engine.
    const response = await fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, row }),
    });
    if (!response.ok)
      throw new Error(`Orbit QA trace save failed ${response.status}`);
    status.textContent = `Saved ${name} (${row.frames.length} exact render frames)`;
  };
  function fly(
    this: CityEngine,
    view: Parameters<CityEngine['fly']>[0],
    animate = true,
  ) {
    const effective = active && mode === 'instant' ? false : animate;
    if (active)
      lastFly = {
        id: view.id,
        requestedAnimate: animate,
        effectiveAnimate: effective,
        nowMs: performance.now(),
      };
    return originalFly.call(this, view, effective);
  }
  function render(this: CityEngine) {
    if (!active || lost) return originalRender.call(this);
    latestPreframe = snapshot();
    const started = performance.now();
    let error: unknown;
    try {
      return originalRender.call(this);
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      if (active && !lost) {
        const renderSceneCpuMs = performance.now() - started;
        frames[index % CAPACITY] = {
          ...snapshot(),
          renderSceneCpuMs,
          ...(error ? { error: errorText(error) } : {}),
        };
        index++;
        count = Math.min(CAPACITY, count + 1);
      }
    }
  }
  const contextLost = (event: Event) => {
    if (!active || lost) return;
    lost = true;
    // Capture listener runs before Engine's bubble listener destroys its GL state.
    void save(
      'context-lost',
      (event as Event & { statusMessage?: string }).statusMessage ?? '',
    ).catch((error: unknown) => {
      status.textContent = String(error);
    });
  };
  function destroy(this: CityEngine) {
    dispose();
    return originalDestroy.call(this);
  }
  const buttons = new Map<string, HTMLButtonElement>();
  const button = (text: string, action: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText =
      'min-height:48px;padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = action;
    buttons.set(text, b);
    section.appendChild(b);
  };
  const choose = (value: typeof mode) => {
    if (!active) return;
    mode = value;
    buttons
      .get('Orbit QA: Normal')!
      .setAttribute('aria-pressed', String(mode === 'normal'));
    buttons
      .get('Orbit QA: Instant')!
      .setAttribute('aria-pressed', String(mode === 'instant'));
    status.textContent = `Orbit transition QA: next public Go uses ${mode}`;
  };
  button('Orbit QA: Normal', () => choose('normal'));
  button('Orbit QA: Instant', () => choose('instant'));
  button('Orbit QA: Save trace', () => {
    if (active)
      void save('manual').catch((error: unknown) => {
        status.textContent = String(error);
      });
  });
  section.appendChild(status);
  panel.appendChild(section);
  choose('normal');
  function dispose() {
    if (!active) return;
    active = false;
    if (e.fly === fly) e.fly = originalFly;
    if (e.renderScene === render) e.renderScene = originalRender;
    if (e.destroy === destroy) e.destroy = originalDestroy;
    canvas.removeEventListener('webglcontextlost', contextLost, true);
    globalThis.removeEventListener?.('pagehide', dispose);
    if (installed.get(e) === dispose) installed.delete(e);
    section.remove();
    onDispose?.();
  }
  e.fly = fly;
  e.renderScene = render;
  e.destroy = destroy;
  canvas.addEventListener('webglcontextlost', contextLost, true);
  globalThis.addEventListener?.('pagehide', dispose);
  installed.set(e, dispose);
  return dispose;
}
