import { RuntimeGpuTiming, type RuntimeGpuSample } from './runtime-gpu-timing';

/** Local, explicitly enabled diagnostics. CPU spans include driver waits, not GPU execution. */
export interface RuntimeFrameContext {
  visible: boolean;
  mode: string;
  quality: string;
}
type RenderContext = Pick<RuntimeFrameContext, 'mode' | 'quality'>;

interface CpuSpan {
  calls: number;
  totalMs: number;
  maxMs: number;
}
interface Frame {
  id: number;
  rafAtMs: number;
  /** The interval BEFORE this frame's callback; current CPU work occurs afterward. */
  rafIntervalMs: number | null;
  cpuStartMs: number;
  cpuEndMs: number;
  cpuFrameMs: number;
  mode: string;
  quality: string;
  startContext: RenderContext;
  renderContext: RenderContext | null;
  spans: Record<string, CpuSpan>;
}
interface Hitch {
  frameId: number;
  intervalStartMs: number;
  intervalEndMs: number;
  rafIntervalMs: number;
  precedingFrame: Frame | null;
  cause: 'unattributed';
}
interface BrowserEvent {
  type: string;
  startMs: number;
  durationMs: number;
}
interface Entry {
  entryType: string;
  startTime: number;
  duration: number;
}
interface Observer {
  observe(options: { type: string; buffered: boolean }): void;
  disconnect(): void;
}
interface ObserverClass {
  new (callback: (list: { getEntries(): Entry[] }) => void): Observer;
  readonly supportedEntryTypes?: readonly string[];
}
interface TracePerformance {
  mark(
    name: string,
    options?: { startTime?: number; detail?: unknown },
  ): unknown;
  measure(
    name: string,
    options: { start: number; end: number; detail?: unknown },
  ): unknown;
  clearMarks(name: string): void;
  clearMeasures(name: string): void;
}
export interface RuntimePerformanceOptions {
  enabled?: boolean;
  trace?: boolean;
  /** Pass only when GPU timing was explicitly requested. */
  gpuContext?: WebGL2RenderingContext | null;
  now?: () => number;
  observerClass?: ObserverClass | null;
  performance?: TracePerformance | null;
}

// Includes the street pilot wrapper and late explicit landmark-detail spans.
// This allowance exists only in the explicitly enabled diagnostics recorder.
const MAX_LABELS = 48;

/** Fixed-capacity storage, including captures left recording for a long session. */
class Ring<T> {
  private values: T[] = [];
  private cursor = 0;
  dropped = 0;
  constructor(readonly capacity: number) {}
  push(value: T) {
    if (this.values.length < this.capacity) this.values.push(value);
    else {
      this.values[this.cursor] = value;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.dropped++;
    }
  }
  snapshot(): T[] {
    return this.cursor
      ? [
          ...this.values.slice(this.cursor),
          ...this.values.slice(0, this.cursor),
        ]
      : this.values.slice();
  }
}

export function runtimePerformanceFlags(search: string) {
  const query = new URLSearchParams(search);
  const enabled = query.get('runtimePerf') === '1';
  return {
    enabled,
    trace: enabled && query.get('runtimePerfTrace') === '1',
    gpu: enabled && query.get('runtimePerfGpu') === '1',
  };
}

/** The disabled path creates no observers, timers, wrappers, or per-frame allocations. */
export function createRuntimePerformanceDiagnostics(
  options: RuntimePerformanceOptions = {},
) {
  return options.enabled ? new RuntimePerformanceDiagnostics(options) : null;
}

export class RuntimePerformanceDiagnostics {
  private readonly now: () => number;
  private readonly performance: TracePerformance | null;
  private readonly gpu: RuntimeGpuTiming | null;
  private readonly frames = new Ring<Frame>(300);
  private readonly hitches = new Ring<Hitch>(40);
  private readonly events = new Ring<BrowserEvent>(100);
  private readonly gpuSamples = new Ring<RuntimeGpuSample>(120);
  private readonly resets = new Ring<{ atMs: number; reason: string }>(30);
  private readonly observers: Observer[] = [];
  private readonly restores: (() => void)[] = [];
  private readonly labels = new Set<string>();
  private readonly observerStatus: Record<string, string> = {};
  private current: Frame | null = null;
  private previous: Frame | null = null;
  private lastRaf: number | null = null;
  private visible = true;
  private stopped = false;
  private sequence = 0;
  private trace: boolean;
  private traceFailed = false;
  private readonly createdAtMs: number;
  private eventFloorMs: number;
  private readonly stats = {
    frames: 0,
    hitches: 0,
    resets: 0,
    rejectedEntries: 0,
    labelLimit: 0,
  };

  constructor(options: RuntimePerformanceOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.createdAtMs = this.now();
    this.eventFloorMs = this.createdAtMs;
    this.performance =
      options.performance === undefined
        ? typeof performance === 'undefined'
          ? null
          : performance
        : options.performance;
    this.trace = !!options.trace && !!this.performance;
    this.gpu = options.gpuContext
      ? new RuntimeGpuTiming(options.gpuContext)
      : null;
    const ObserverType =
      options.observerClass === undefined
        ? typeof PerformanceObserver === 'undefined'
          ? null
          : PerformanceObserver
        : options.observerClass;
    for (const type of ['longtask', 'gc']) {
      this.observerStatus[type] = 'unsupported';
      if (!ObserverType?.supportedEntryTypes?.includes(type)) continue;
      let observer: Observer | null = null;
      try {
        observer = new ObserverType((list) => {
          if (this.stopped) return;
          for (const entry of list.getEntries()) {
            if (
              !this.visible ||
              (typeof document !== 'undefined' && document.hidden) ||
              entry.entryType !== type ||
              !Number.isFinite(entry.startTime) ||
              !Number.isFinite(entry.duration) ||
              entry.startTime < this.eventFloorMs ||
              entry.duration < 0
            ) {
              this.stats.rejectedEntries++;
              continue;
            }
            this.events.push({
              type,
              startMs: entry.startTime,
              durationMs: entry.duration,
            });
          }
        });
        observer.observe({ type, buffered: false });
        this.observers.push(observer);
        this.observerStatus[type] = 'observing';
      } catch {
        try {
          observer?.disconnect();
        } catch {
          /* Unsupported observer cleanup. */
        }
        this.observerStatus[type] = 'failed';
      }
    }
  }

  beginFrame(rafAtMs: number, context: RuntimeFrameContext) {
    if (this.stopped) return false;
    const cpuStartMs = this.now();
    if (!context.visible) {
      this.visible = false;
      if (this.lastRaf !== null || this.current) this.reset('hidden');
      return false;
    }
    this.visible = true;
    if (!Number.isFinite(rafAtMs) || rafAtMs < 0) {
      this.reset('invalid-clock');
      return false;
    }
    if (this.current) this.reset('unfinished-frame');
    if (this.lastRaf !== null && rafAtMs <= this.lastRaf)
      this.reset('clock-discontinuity');
    // A foreground gap is retained, including very long hitches. Hidden/page gaps
    // are excluded only through explicit visibility/lifecycle reset, never duration.
    const interval = this.lastRaf === null ? null : rafAtMs - this.lastRaf;
    const id = ++this.sequence;
    if (interval !== null && interval > 100) {
      this.hitches.push({
        frameId: id,
        intervalStartMs: this.lastRaf!,
        intervalEndMs: rafAtMs,
        rafIntervalMs: interval,
        precedingFrame: this.previous ? cloneFrame(this.previous) : null,
        cause: 'unattributed',
      });
      this.stats.hitches++;
      this.traceMark('hitch', rafAtMs, {
        frameId: id,
        rafIntervalMs: interval,
      });
    }
    this.lastRaf = rafAtMs;
    if (this.gpu)
      for (const sample of this.gpu.poll()) this.gpuSamples.push(sample);
    this.current = {
      id,
      rafAtMs,
      rafIntervalMs: interval,
      cpuStartMs,
      cpuEndMs: cpuStartMs,
      cpuFrameMs: 0,
      mode: context.mode.slice(0, 32),
      quality: context.quality.slice(0, 32),
      startContext: {
        mode: context.mode.slice(0, 32),
        quality: context.quality.slice(0, 32),
      },
      renderContext: null,
      spans: Object.create(null) as Record<string, CpuSpan>,
    };
    return true;
  }

  /** Capture the actual render settings after controllers/adaptive quality run. */
  setRenderContext(context: RenderContext) {
    if (this.stopped || !this.current) return;
    const renderContext = {
      mode: context.mode.slice(0, 32),
      quality: context.quality.slice(0, 32),
    };
    this.current.renderContext = renderContext;
    this.current.mode = renderContext.mode;
    this.current.quality = renderContext.quality;
  }

  /** Optional fallback when the caller has no explicit render-region hook. */
  endFrame(context?: RenderContext) {
    const frame = this.current;
    if (this.stopped || !frame) return;
    if (context && !frame.renderContext) this.setRenderContext(context);
    this.endGpu();
    frame.cpuEndMs = this.now();
    frame.cpuFrameMs = Math.max(0, frame.cpuEndMs - frame.cpuStartMs);
    this.traceMeasure('frame', frame.cpuStartMs, frame.cpuEndMs, {
      frameId: frame.id,
    });
    this.frames.push(frame);
    this.previous = frame;
    this.current = null;
    this.stats.frames++;
  }

  measure<T>(label: string, work: () => T): T {
    const frame = this.current;
    if (this.stopped || !frame || !this.admitLabel(label)) return work();
    const start = this.now();
    try {
      return work();
    } finally {
      const end = this.now(),
        duration = Math.max(0, end - start);
      // An explicit lifecycle reset during the method invalidates its old frame.
      if (this.current === frame) {
        const span = (frame.spans[label] ??= {
          calls: 0,
          totalMs: 0,
          maxMs: 0,
        });
        span.calls++;
        span.totalMs += duration;
        span.maxMs = Math.max(span.maxMs, duration);
        this.traceMeasure(label, start, end, { frameId: frame.id });
      }
    }
  }

  wrap<T extends object, K extends keyof T>(target: T, key: K, label: string) {
    const original = target[key];
    if (
      this.stopped ||
      typeof original !== 'function' ||
      this.restores.length >= 32 ||
      !this.admitLabel(label)
    )
      return;
    const own = Object.getOwnPropertyDescriptor(target, key),
      measure = this.measure.bind(this);
    const wrapped = function (this: T, ...args: unknown[]) {
      return measure(label, () => Reflect.apply(original, this, args));
    };
    try {
      target[key] = wrapped as T[K];
    } catch {
      return;
    }
    this.restores.push(() => {
      if (target[key] !== wrapped) return;
      if (own) Object.defineProperty(target, key, own);
      else delete target[key];
    });
  }

  beginGpu() {
    if (!this.stopped && this.current) this.gpu?.begin(this.current.id);
  }
  endGpu() {
    if (!this.stopped) this.gpu?.end();
  }

  setVisible(visible: boolean) {
    if (this.stopped || visible === this.visible) return;
    this.visible = visible;
    this.reset(visible ? 'visible' : 'hidden');
  }

  /** Call on visibility change, pagehide/pageshow and context loss/restoration. */
  reset(reason = 'lifecycle') {
    if (this.stopped) return;
    this.current = null;
    this.previous = null;
    this.lastRaf = null;
    this.gpu?.reset();
    this.eventFloorMs = this.now();
    this.resets.push({ atMs: this.eventFloorMs, reason: reason.slice(0, 64) });
    this.stats.resets++;
  }

  private admitLabel(label: string) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(label)) return false;
    if (this.labels.has(label)) return true;
    if (this.labels.size >= MAX_LABELS) {
      this.stats.labelLimit++;
      return false;
    }
    this.labels.add(label);
    return true;
  }

  private traceMark(label: string, atMs: number, detail: unknown) {
    if (!this.trace || !this.performance) return;
    const name = `atlas.runtime.${label}`;
    try {
      this.performance.mark(name, { startTime: atMs, detail });
      this.performance.clearMarks(name);
    } catch {
      this.trace = false;
      this.traceFailed = true;
    }
  }

  private traceMeasure(
    label: string,
    start: number,
    end: number,
    detail: unknown,
  ) {
    if (!this.trace || !this.performance) return;
    const name = `atlas.runtime.${label}`;
    try {
      this.performance.measure(name, { start, end, detail });
      // Clear only owned entries. Browser trace events survive timeline cleanup.
      this.performance.clearMeasures(name);
    } catch {
      this.trace = false;
      this.traceFailed = true;
    }
  }

  snapshot() {
    return {
      schemaVersion: 1,
      kind: 'opt-in-runtime-performance',
      createdAtMs: this.createdAtMs,
      capturedAtMs: this.now(),
      stopped: this.stopped,
      interpretation: {
        rafInterval:
          'Successive foreground RAF timestamps, not performance.now callback starts; the interval precedes current CPU work and includes preceding work/browser scheduling.',
        cpu: 'Measured current callback region and inclusive subsystem spans; nested spans overlap and may include driver waits. Includes recorder overhead within that region. Not CPU utilization or GPU elapsed time.',
        gpu: 'Optional asynchronous disjoint timer result for the explicit render region only. Unsupported, pending and disjoint results are never substituted with CPU time.',
        attribution:
          'Long intervals remain unattributed. Browser longtask/GC overlap is correlation, not proof of cause. No inferred GPU time or browser/GC/shader diagnosis.',
        overhead:
          'Opt-in instrumentation and observers add overhead; compare separately with an uninstrumented capture.',
      },
      limits: {
        frames: 300,
        hitches: 40,
        browserEvents: 100,
        gpuSamples: 120,
        resets: 30,
        labels: MAX_LABELS,
        wrappers: 32,
      },
      stats: { ...this.stats },
      dropped: {
        frames: this.frames.dropped,
        hitches: this.hitches.dropped,
        browserEvents: this.events.dropped,
        gpuSamples: this.gpuSamples.dropped,
        resets: this.resets.dropped,
      },
      trace: { enabled: this.trace, failed: this.traceFailed },
      observerSupport: { ...this.observerStatus },
      frames: this.frames.snapshot().map(cloneFrame),
      hitches: this.hitches.snapshot().map((h) => ({
        ...h,
        precedingFrame: h.precedingFrame ? cloneFrame(h.precedingFrame) : null,
      })),
      browserEvents: this.events.snapshot().map((event) => ({ ...event })),
      gpu: {
        ...(this.gpu?.snapshot() ?? { status: 'disabled' }),
        samples: this.gpuSamples.snapshot().map((sample) => ({ ...sample })),
      },
      resets: this.resets.snapshot().map((reset) => ({ ...reset })),
    };
  }

  dispose() {
    if (this.stopped) return;
    this.reset('dispose');
    this.stopped = true;
    for (const observer of this.observers) {
      try {
        observer.disconnect();
      } catch {
        /* Best-effort instrumentation cleanup. */
      }
    }
    this.observers.length = 0;
    this.gpu?.dispose();
    for (const restore of this.restores.reverse()) {
      try {
        restore();
      } catch {
        /* A frozen/changed owner retains its method. */
      }
    }
    this.restores.length = 0;
  }
}

function cloneFrame(frame: Frame): Frame {
  return {
    ...frame,
    startContext: { ...frame.startContext },
    renderContext: frame.renderContext ? { ...frame.renderContext } : null,
    spans: Object.fromEntries(
      Object.entries(frame.spans).map(([key, value]) => [key, { ...value }]),
    ),
  };
}
