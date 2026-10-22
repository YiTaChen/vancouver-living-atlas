# Opt-in long-frame evidence

The runtime recorder is available only in an explicitly instrumented local QA build. Normal production builds must exclude it. It records evidence for investigating startup and travel stalls; adding the recorder does not establish the cause of any historical hitch or demonstrate a performance improvement.

```sh
VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build
VISUAL_QA_PORT=3196 node tools/serve-visual-qa.mjs runtime-check
```

Open `http://localhost:3196/?runtimePerf=1`. `VISUAL_QA_PORT` is optional and defaults to 3100; choose an unused port from 1 to 65535 when another local task already uses it. The server binds only to `127.0.0.1` and accepts report origins from exactly `localhost` or `127.0.0.1` on that port. After repeating the travel action, use **Save runtime timing** in the local QA panel. The server writes `work/visual-qa/runtime-check/runtime-timing.json` with the source fingerprint and parent Git revision. Each save overwrites that filename; use a distinct server label for each run or copy the first report before repeating. **Save startup timing** and release measurement buttons also include the optional runtime snapshot. Run:

```sh
node tools/summarize-runtime-performance.mjs work/visual-qa/runtime-check/runtime-timing.json
```

The summary lists the ten largest retained intervals, the preceding frame's inclusive CPU spans and any overlapping browser events. It does not subtract CPU from RAF to invent GPU time or label a shader, GC, geometry or browser cause. Release measurements include an explicit `runtimeWindow`; their runtime rings may contain older records or have evicted part of that window. Lifetime counts are not counts of the retained sample window.

## Chrome trace

Use `?runtimePerf=1&runtimePerfTrace=1`. In Chrome DevTools **Performance**, start a recording, reproduce one bounded action, then stop and export the trace. To include startup, start the trace with the reload action. Inspect the `atlas.runtime.*` User Timing entries beside the browser's main-thread, rendering and available GPU tracks. The recorder clears only its own User Timing buffer entries to keep memory bounded; captured trace events remain in the browser recording. Trace and DevTools overhead change timing, so keep a separate capture without tracing and an uninstrumented comparison.

The recorder stores successive RAF timestamp intervals and CPU spans for the current callback separately. RAF timestamps are not the `performance.now()` time when a callback starts. A long interval normally includes work from the preceding callback plus browser scheduling. Hitch records preserve the preceding frame even after it leaves the ordinary frame ring. Each frame retains its start context and the actual render mode/quality captured after controller and automatic-quality updates. Nested subsystem spans are inclusive and overlap; their totals must not be added together. A synchronous submission can include a graphics-driver wait and is not isolated GPU execution time.

## Optional GPU and browser events

Add `runtimePerfGpu=1` only when investigating GPU work. WebGL2 `EXT_disjoint_timer_query_webgl2` availability is reported, not assumed. Queries cover only the explicitly instrumented render region, are polled asynchronously without waiting and keep at most four pending queries. Disjoint, lost-context, invalid and unavailable results never become zero-time GPU samples. The recorder respects a timer query owned by another caller; nested recorder scopes share the outer query. A lost GPU context requires a fresh page for a new complete capture.

`PerformanceObserver` subscribes to `longtask` and `gc` only when the browser advertises support. Browser GC entries are commonly unavailable. Absence of a GC event does not demonstrate absence of GC. Event overlap indicates correlation, not causation. No network requests or remote telemetry are sent by the recorder; saving uses the existing local QA endpoint.

## Bounds and reproduction

The in-memory limits are 300 frames, 40 hitch records, 100 browser events, 120 GPU samples, 30 lifecycle resets and 32 CPU labels/wrappers. Reports expose eviction counts. Hidden-tab/page/context resets begin a fresh interval anchor and reject stale observer events; a long foreground interval is retained regardless of duration. Save soon after the action so relevant trace and GPU evidence remains available. Recording is opt-in and adds overhead; disabled creation allocates no observers, timer queries or frame records.

For a useful comparison, record the exact source fingerprint, browser/GPU, viewport and drawing buffer, quality, clock/weather, route/action, cold or warm asset state, and whether tracing/GPU timing is enabled. Keep first-use stalls. Repeat paired runs on the same device with builds/tests and other 3D scenes stopped. Include real phone/tablet captures separately from desktop viewport profiles. The new automated tests verify instrumentation contracts and bounded storage; they do not measure end-user FPS, battery, memory or prove an old long-frame cause.
