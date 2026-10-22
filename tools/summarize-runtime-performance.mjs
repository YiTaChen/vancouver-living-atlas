import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const finiteDuration = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const summary = (values) => {
  const sorted = values.filter(finiteDuration).sort((a, b) => a - b);
  const percentile = (p) =>
    sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return {
    count: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
    over100Ms: sorted.filter((value) => value > 100).length,
  };
};

/** Describes retained evidence; never diagnoses the cause of a long interval. */
export function summarizeRuntimePerformance(input) {
  const source = input.runtimePerformance
    ? input
    : input.measurement?.runtimePerformance
      ? input.measurement
      : { runtimePerformance: input };
  const report = source.runtimePerformance;
  if (
    report?.kind !== 'opt-in-runtime-performance' ||
    report.schemaVersion !== 1
  )
    throw new Error('Expected a version 1 opt-in runtime timing report');
  const window = source.runtimeWindow;
  const inWindow = (at) =>
    !window || (at >= window.startMs && at <= window.endMs);
  const events = (report.browserEvents ?? []).filter(
    (event) =>
      finiteDuration(event.startMs) && finiteDuration(event.durationMs),
  );
  const gpu = new Map(
    (report.gpu?.samples ?? [])
      .filter((sample) => finiteDuration(sample.gpuElapsedMs))
      .map((sample) => [sample.frameId, sample.gpuElapsedMs]),
  );
  const retainedHitches = (report.hitches ?? []).filter(
    (hitch) =>
      finiteDuration(hitch.rafIntervalMs) &&
      hitch.rafIntervalMs > 100 &&
      finiteDuration(hitch.intervalStartMs) &&
      finiteDuration(hitch.intervalEndMs) &&
      hitch.intervalEndMs >= hitch.intervalStartMs &&
      inWindow(hitch.intervalEndMs),
  );
  const largestIntervals = [...retainedHitches]
    .sort((a, b) => b.rafIntervalMs - a.rafIntervalMs)
    .slice(0, 10)
    .map((hitch) => ({
      frameId: hitch.frameId,
      intervalStartMs: hitch.intervalStartMs,
      intervalEndMs: hitch.intervalEndMs,
      rafIntervalMs: hitch.rafIntervalMs,
      precedingFrameId: hitch.precedingFrame?.id ?? null,
      precedingCpuFrameMs: finiteDuration(hitch.precedingFrame?.cpuFrameMs)
        ? hitch.precedingFrame.cpuFrameMs
        : null,
      precedingInclusiveCpuSpans: Object.entries(
        hitch.precedingFrame?.spans ?? {},
      )
        .filter(([, span]) => finiteDuration(span.totalMs))
        .sort(([, a], [, b]) => b.totalMs - a.totalMs)
        .slice(0, 8)
        .map(([label, span]) => ({ label, ...span })),
      precedingRenderGpuMs: gpu.get(hitch.precedingFrame?.id) ?? null,
      overlappingBrowserEvents: events.filter(
        (event) =>
          event.startMs < hitch.intervalEndMs &&
          event.startMs + event.durationMs > hitch.intervalStartMs,
      ),
      cause: 'unattributed',
    }));
  return {
    schemaVersion: 1,
    kind: 'runtime-performance-evidence-summary',
    scope:
      window ??
      'Retained rings only; lifetime counters can cover a longer period.',
    interpretation:
      'RAF intervals precede current-frame CPU spans. Preceding inclusive CPU categories overlap; do not add them. Browser events overlapping an interval are correlation, not causal attribution. A missing GPU/browser event result means unavailable, unsupported or evicted, never zero work. Instrumented samples are not an uninstrumented benchmark.',
    retainedFrameIntervals: summary(
      (report.frames ?? [])
        .filter((frame) => inWindow(frame.rafAtMs))
        .map((frame) => frame.rafIntervalMs),
    ),
    retainedHitchCount: retainedHitches.length,
    lifetimeCounters: report.stats ?? null,
    dropped: report.dropped ?? null,
    observerSupport: report.observerSupport ?? null,
    gpuStatus: report.gpu?.status ?? 'unknown',
    trace: report.trace ?? null,
    largestIntervals,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = process.argv.slice(2);
  if (!files.length)
    throw new Error(
      'Usage: node tools/summarize-runtime-performance.mjs report.json [report2.json]',
    );
  for (const file of files) {
    const input = JSON.parse(await readFile(file, 'utf8'));
    console.log(
      JSON.stringify({ file, ...summarizeRuntimePerformance(input) }, null, 2),
    );
  }
}
