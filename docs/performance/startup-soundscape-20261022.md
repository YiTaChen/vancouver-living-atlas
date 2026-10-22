# Startup data measurement and regional terrain preparation — 2026-10-22

This change separates startup data wait/decode/parse evidence and removes repeated work in regional terrain preparation. It keeps the existing 17 concurrent startup data requests and the city systems required before entry. The focused measurements below concern one CPU-side workload; they do not establish a change in complete browser startup time.

For the other work in this update, see [city soundscape](../CITY_SOUNDSCAPE_2026_10.md) and [opt-in runtime diagnostics](runtime-diagnostics.md).

## Startup measurements

`lib/city/startup-data.ts` accepts the existing optional `StartupQA` recorder. With no recorder, successful responses retain the normal `Response.json()` path. An instrumented load uses `Response.text()` followed by `JSON.parse()` so the phases have actual boundaries:

| Span suffix  | What it measures                               | Interpretation                                                                                                            |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `headers`    | Fetch invocation until the `Response` resolves | Async elapsed wall time, including cache/network/server/browser scheduling as applicable; not pure network transfer time. |
| `body-read`  | Waiting for `Response.text()`                  | Async body read and text decoding wall time, including scheduling; not a separate download-only duration.                 |
| `json-parse` | The synchronous `JSON.parse(text)` call        | Main-thread elapsed wall time, which can include runtime pauses; not process CPU utilization or GPU execution.            |

Names include the dataset label and a request sequence, for example `data.buildings.1.json-parse`, so concurrent or repeated labels do not collide. Completion marks include HTTP status, elapsed phase values and `textCodeUnits`. Code units are not bytes. Actual `transferSize`, `encodedBodySize` and `decodedBodySize` remain the browser's Resource Timing fields in `StartupQA.dataResources`; cached or unavailable values must not be interpreted as a measured cellular download.

Instrumentation defaults to at most 32 requests per loader and has a hard configuration cap of 128. The engine currently makes 17 requests. Required HTTP failures preserve their original messages, optional non-success responses remain optional, and the same load `AbortSignal` reaches every request. Fetch, body and parse failures close their active span before propagating. Diagnostic mode changes the decode path and can affect allocation and timing, so compare runs with matching instrumentation flags and retain an uninstrumented reference.

The existing outer startup phases still distinguish geographic masks, water/land/context geometry, roads, buildings, nature, harmonization, landmarks, collision, traffic, railway, harbour, controllers, composer setup, shader compilation and composer warmup. The new spans sit inside `load.data.fetch-and-decode`; concurrent request durations overlap and must not be summed to obtain total startup time. `compileAsync` is asynchronous wall time. A first submitted city frame is not a GPU presentation fence, and the interactive mark means the existing DOM/controller eligibility checks passed.

Build with `VANCOUVER_VISUAL_QA=1` and use **Save startup timing** in the local visual QA panel, as described in [the existing startup reproduction workflow](progressive-startup.md#reproduction-and-limits). This recorder remains a local QA facility. Production builds retain the existing QA-exclusion gate. The historical browser results in that document are earlier measurements and are not results for this update.

## Removed repeated work

`projectStartupPolygons()` prepares the regional terrain mask, preserving ring order, holes and every coordinate without rounding or a global cache. The current data contains seven polygons and 846 coordinates. `WaterWorld` retains its original source and its own regional preparation, keeping the existing strict material-consumer and historical-audit contracts intact.

The larger change is in `makeContext()`:

- Reuse three working/base/high `THREE.Color` objects instead of constructing two for every emitted vertex.
- Calculate the unchanged base colour and shade coefficient once per retained grid cell.
- Project the cell centre once before testing regional polygons.

The current regional terrain emits **249,678 vertices** in **41,613 cells**. The two explicit per-vertex colour constructions totalled **499,356**; the replacement uses **3** explicit colour constructions for the whole method, eliminating **499,353** such constructions. This is a count of those explicit constructions, not a heap-size, GC-duration, total allocation or memory-usage measurement. Terrain vertex count, elevations, colour arithmetic, triangle order and source data remain the same. A redundant `resizeQuality()` call immediately before `applySettings()` was also removed; `applySettings()` still performs the quality resize.

Harbour data was not deferred: piers and moored hulls contribute collision obstacles during initialization. No new geographic download assets, lower-resolution terrain, simplified coastline or delayed collision readiness are introduced here.

## Focused before/after result

The Node benchmark loads the real regional terrain and land data, uses the same deterministic seam callbacks, constructs regional position/colour arrays and indexes the regional mask. It deliberately omits normal generation, buffer upload, rendering, network, full city building/beach collision inputs and real phone hardware. Fingerprinting/serialization and an explicit GC request occur outside each measured sample; any allocation/GC or scheduling pause inside a sample remains included.

The baseline is `lib/city/context.ts` from parent revision `bb26294067dade837738be62a6cc0faa8a4d9712`, with source SHA-256 `c1c130745a078a4d3f90302ef960c1d864c7c57057fc9ce2c93fe342cb043941`. Both variants prepare their regional terrain mask and independently construct the unchanged `WaterWorld` regional index inside the timed workload. There is one warmup per variant, followed by five paired samples in alternating order. The measured runtime was Node **24.22.1**, macOS/arm64, with explicit GC between samples.

| Focused CPU-side elapsed wall time | Baseline         | Candidate       |
| ---------------------------------- | ---------------- | --------------- |
| Median                             | 124.93 ms        | 67.91 ms        |
| Minimum–maximum                    | 115.58–130.29 ms | 53.37–128.00 ms |

The observed median difference is **57.03 ms (45.65%)** for this focused workload. Ranges overlap, there are only five samples per variant, and other local activity can affect wall time. These numbers are not a full-startup, FPS, GPU, battery, RAM or mobile-device claim.

Every measured baseline/candidate run produced the same complete position/colour SHA-256:

```text
2c04c1cc578ac3f55e52e3c7d95589c60bf168743959eef5b6cccb1c356dd99b
```

The regression test also checks this original-output fingerprint and verifies the prepared regional mask preserves all original source rings and coordinates. This is exact array evidence for the regional terrain fixture, not an image comparison or validation of every city surface.

## Reproduce the focused benchmark

From the repository root, with the supported project Node runtime and dependencies installed:

```sh
mkdir -p work/startup-benchmark
git show bb26294067dade837738be62a6cc0faa8a4d9712:lib/city/context.ts > work/startup-benchmark/context-before.ts
node --expose-gc tools/benchmark-startup-data.mjs \
  --baseline-context=work/startup-benchmark/context-before.ts \
  --iterations=5 > work/startup-benchmark/result.json
node --test tests/startup-data.test.mjs tests/startup-data-polygons.test.mjs
```

The raw local result for the table is retained internally at `work/startup-benchmark/result-node24.22.1.json`. The benchmark validates matching output before emitting its JSON report. Run paired measurements without concurrent builds, tests or other 3D scenes for a quieter comparison, and use a separate matched browser capture to assess page-to-interactive behavior.

The seven focused tests cover the normal JSON path, phase boundaries and classifications, HTTP/cancellation/parse failures, bounded concurrent instrumentation and exact regional masks/terrain arrays. Full repository validation and browser measurements belong to the integrated validation record.
# Integrated validation

The final implementation passed `npm run check`, normal `npm run build:firebase`
(including asset, CSP and no-QA-code verification), and the instrumented local
static build. The final focused regression run passed 73 tests across startup,
runtime/GPU diagnostics, soundscape, world adapter, UI, engine lifecycle, release
observations, production isolation and local-server policy.

The complete suite initially ran 1,924 tests. Historical Git inputs and a missing
sparse-checkout utility were restored, the lifecycle extraction harness was
updated to import the real new modules, and the loopback test was rerun with
local socket access. Those affected groups passed on rerun. One unchanged
material-consumer golden comparison remains platform-sensitive: the Science
World circle coordinate is `-12.13106480597334` instead of
`-12.131064805973342` (absolute difference `1.7763568394002505e-15`). All sixteen
protected geometry sources match the parent revision and every other fixture
value is identical. The exact comparison and stored fixture were not relaxed or
rewritten. This limitation prevents describing the entire suite as passing.

The production browser smoke confirmed startup, the default-off sound switch,
explicit enable/disable, volume UI and Traditional Chinese localization. This
does not establish subjective audio quality, real-phone performance or the cause
of a historical SkyTrain hitch.
