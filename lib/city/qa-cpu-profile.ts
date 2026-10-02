/** LOCAL VISUAL QA: CPU submission timings, never GPU completion timings. */
export class QACPUProfile {
  private samples = new Map<string, number[]>();
  private restores: (() => void)[] = [];
  private stopped = false;
  constructor(private now: () => number = () => performance.now()) {}

  wrap<T extends object, K extends keyof T>(target: T, key: K, label: string) {
    const original = target[key];
    if (this.stopped || typeof original !== 'function') return;
    const own = Object.getOwnPropertyDescriptor(target, key);
    const samples: number[] = [];
    this.samples.set(label, samples);
    const now = this.now;
    const wrapped = function (this: T, ...args: unknown[]) {
      const start = now();
      try {
        return Reflect.apply(original, this, args);
      } finally {
        // Bound diagnostics even if a recording is interrupted or forgotten.
        if (samples.length < 20_000) samples.push(Math.max(0, now() - start));
      }
    };
    target[key] = wrapped as T[K];
    this.restores.push(() => {
      // Do not overwrite a newer owner installed while a recording was active.
      if (target[key] !== wrapped) return;
      if (own) Object.defineProperty(target, key, own);
      else delete target[key];
    });
  }

  stop() {
    if (!this.stopped) {
      this.stopped = true;
      for (const restore of this.restores.reverse()) restore();
      this.restores.length = 0;
    }
    return {
      kind: 'cpu-submission-profile-v1',
      note: 'Inclusive main-thread method durations; nested categories overlap. Renderer timing is CPU submission/driver wait, not GPU elapsed time. Instrumentation adds overhead; compare separately from uninstrumented frame samples.',
      methods: Object.fromEntries([...this.samples].map(([label, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
        return [label, {
          calls: values.length,
          totalMs: values.reduce((a, b) => a + b, 0),
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          maxMs: sorted.at(-1) ?? 0,
          capped: values.length === 20_000,
        }];
      })),
    };
  }
}
