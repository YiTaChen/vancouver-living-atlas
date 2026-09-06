/** LOCAL VISUAL QA STARTUP v1 — must be absent from normal Firebase bundles.
 * Synchronous spans are elapsed main-thread wall time, NOT CPU process time or
 * GPU time. compileAsync/resource spans are asynchronous wall time.
 */
import type { CityEngine } from './engine';

type SpanKind = 'sync-main-thread-wall' | 'async-wall';
type Detail = Record<string, unknown>;
interface Span {
  name: string;
  kind: SpanKind;
  start: number;
  end: number | null;
  interrupted?: boolean;
}
interface Mark {
  name: string;
  at: number;
  detail?: Detail;
}

export class StartupQA {
  readonly marker = 'LOCAL VISUAL QA STARTUP v1';
  readonly createdAt = new Date().toISOString();
  private readonly spans: Span[] = [];
  private readonly marks: Mark[] = [];
  private readonly active = new Map<string, Span>();
  private currentPhase: string | null = null;
  private raf = 0;
  private stopped = false;
  private interactivePending = false;
  private firstFrame = false;
  private readyCommit = false;
  private hidden = document.hidden;
  private status: 'recording' | 'interactive' | 'failed' | 'disposed' =
    'recording';
  private capabilityData: Detail = {};
  private error: string | null = null;
  private finishedAt: number | null = null;
  private readonly visibility = () => {
    this.hidden ||= document.hidden;
  };

  constructor() {
    this.mark('engine.field-initialization.begin');
    document.addEventListener('visibilitychange', this.visibility);
  }
  mark(name: string, detail?: Detail) {
    this.markAt(name, performance.now(), detail);
  }
  /** Accept backfilled page import/new timestamps without changing load order. */
  markAt(name: string, at: number, detail?: Detail) {
    if (this.stopped || !Number.isFinite(at)) return;
    this.marks.push({ name, at, ...(detail ? { detail } : {}) });
  }
  begin(name: string, kind: SpanKind = 'sync-main-thread-wall') {
    if (this.stopped) return;
    if (this.active.has(name))
      throw new Error(`Startup phase already active: ${name}`);
    const span = { name, kind, start: performance.now(), end: null };
    this.spans.push(span);
    this.active.set(name, span);
  }
  end(name: string) {
    const span = this.active.get(name);
    if (!span) return;
    span.end = performance.now();
    this.active.delete(name);
  }
  /** Sequential load phase boundary. Nested constructor spans remain separate. */
  phase(name: string, kind: SpanKind = 'sync-main-thread-wall') {
    this.endPhase();
    this.currentPhase = name;
    this.begin(name, kind);
  }
  endPhase() {
    if (this.currentPhase) this.end(this.currentPhase);
    this.currentPhase = null;
  }
  capabilities(e: CityEngine) {
    const c = e.renderer.capabilities;
    this.capabilityData = {
      quality: e.settings.quality,
      viewport: [e.container.clientWidth, e.container.clientHeight],
      devicePixelRatio: window.devicePixelRatio,
      renderPixelRatio: e.renderer.getPixelRatio(),
      canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
      maxTextureSize: c.maxTextureSize,
      maxSamples: c.maxSamples,
      maxAttributes: c.maxAttributes,
      maxVaryings: c.maxVaryings,
      precision: c.precision,
      parallelShaderCompile: e.renderer.extensions.has(
        'KHR_parallel_shader_compile',
      ),
      gpuTimerQueryAvailable: e.renderer.extensions.has(
        'EXT_disjoint_timer_query_webgl2',
      ),
      gpuTimerQueryUsed: false,
    };
  }
  frameSubmitted(e: CityEngine) {
    if (this.firstFrame || this.stopped) return;
    this.firstFrame = true;
    this.mark('city.first-frame.submitted', {
      calls: e.renderer.info.render.calls,
      triangles: e.renderer.info.render.triangles,
      canvas: [e.renderer.domElement.width, e.renderer.domElement.height],
    });
    this.tryInteractive(e);
  }
  reactCommitted(e: CityEngine) {
    if (this.readyCommit || this.stopped) return;
    this.readyCommit = true;
    this.mark('react.ready-effect.committed');
    this.tryInteractive(e);
  }
  private tryInteractive(e: CityEngine) {
    if (
      !this.firstFrame ||
      !this.readyCommit ||
      this.interactivePending ||
      this.stopped
    )
      return;
    this.interactivePending = true;
    this.raf = requestAnimationFrame(() => {
      if (this.stopped) return;
      const canvas = e.renderer.domElement;
      const loading = e.container
        .closest('main')
        ?.querySelector('.loading-overlay');
      const eligible =
        !e.disposed &&
        !e.contextLost &&
        !document.hidden &&
        canvas.isConnected &&
        canvas.clientWidth > 0 &&
        canvas.clientHeight > 0 &&
        !loading &&
        !!e.navigation &&
        !!e.placement;
      this.mark('ui.interactive-eligibility.checked', {
        eligible,
        navigation: !!e.navigation,
        placement: !!e.placement,
        loadingOverlay: !!loading,
      });
      if (!eligible) {
        this.interactivePending = false;
        return;
      }
      this.mark('ui.interactive-eligible');
      // One more browser frame opportunity; deliberately not called GPU-presented.
      this.raf = requestAnimationFrame(() => {
        if (this.stopped) return;
        this.hidden ||= document.hidden;
        this.mark('ui.next-frame-opportunity');
        this.capabilities(e);
        this.status = 'interactive';
        this.finish();
      });
    });
  }
  fail(error: unknown) {
    if (this.stopped) return;
    this.error = String(error instanceof Error ? error.message : error);
    this.status = 'failed';
    this.mark('engine.failed', { message: this.error });
    this.finish();
  }
  dispose() {
    if (!this.stopped) {
      this.status = 'disposed';
      this.mark('engine.disposed-before-interactive');
      this.finish();
    }
  }
  private finish() {
    for (const [name, span] of this.active) {
      span.interrupted = true;
      this.end(name);
    }
    this.currentPhase = null;
    this.stopped = true;
    this.finishedAt = performance.now();
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.visibility);
  }
  snapshot() {
    const starts = [
      ...this.marks.map((m) => m.at),
      ...this.spans.map((s) => s.start),
    ];
    const origin = Math.min(...starts);
    const now = this.finishedAt ?? performance.now();
    const resourceTiming = performance
      .getEntriesByType('resource')
      .filter((entry) => {
        try {
          return (
            entry.startTime <= now &&
            new URL(entry.name).origin === location.origin &&
            new URL(entry.name).pathname.startsWith('/data/')
          );
        } catch {
          return false;
        }
      })
      .map((entry) => {
        const r = entry as PerformanceResourceTiming;
        return {
          path: new URL(r.name).pathname,
          startMs: r.startTime - origin,
          wallMs: r.duration,
          requestStartMs: r.requestStart - origin,
          responseStartMs: r.responseStart - origin,
          responseEndMs: r.responseEnd - origin,
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize,
          decodedBodySize: r.decodedBodySize,
        };
      });
    return {
      schema: 'local-startup-wall-v1',
      marker: this.marker,
      createdAt: this.createdAt,
      originPerformanceMs: origin,
      performanceTimeOrigin: performance.timeOrigin,
      status: this.status,
      valid: this.status === 'interactive' && !this.hidden,
      error: this.error,
      hiddenDuringMeasurement: this.hidden,
      capabilities: this.capabilityData,
      spans: this.spans.map((s) => ({
        name: s.name,
        kind: s.kind,
        startMs: s.start - origin,
        endMs: s.end === null ? null : s.end - origin,
        wallMs: (s.end ?? now) - s.start,
        complete: s.end !== null && !s.interrupted,
        interrupted: !!s.interrupted,
      })),
      marks: [...this.marks]
        .sort((a, b) => a.at - b.at)
        .map((m) => ({
          name: m.name,
          elapsedMs: m.at - origin,
          ...(m.detail ? { detail: m.detail } : {}),
        })),
      dataResources: resourceTiming,
      navigationTiming: performance
        .getEntriesByType('navigation')
        .map((entry) => {
          const n = entry as PerformanceNavigationTiming;
          return {
            type: n.type,
            startTime: n.startTime,
            domInteractive: n.domInteractive,
            domContentLoadedEventEnd: n.domContentLoadedEventEnd,
            loadEventEnd: n.loadEventEnd,
            responseEnd: n.responseEnd,
            transferSize: n.transferSize,
          };
        }),
      gpuTimeMeasured: false,
      interpretation:
        'Synchronous elapsed time may include driver waits. Async compile/fetch wall time is not CPU or GPU duration. First city frame submitted is not a presentation fence. Interactive eligibility is DOM/controller readiness, not a successful user gesture.',
    };
  }
}

export function createStartupQA() {
  return new StartupQA();
}
