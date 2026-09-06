# Stage 9: measured loading and rendering

The road/bridge geometry, final ground plans and landmark factories remain unchanged. Work targets the measured main-thread construction and first-detail upload stalls.

## Accepted changes

- An ordered spatial bounds index replaces two repeated whole-plan scans in Causeway geometry. Exact ordered result/Float32 checks are recorded in [the paired audit](causeway-exact-output.json); [58 movement/geometry checks](causeway-regression.json) pass after integration.
- Nearby facade accents use bounded construction pages, a single active builder and a capped cache. GPU preparation borrows one page at a time from the shared post-render queue. A complete cell replaces its previous version atomically; cancellation and upload failure retain existing geometry.
- Ultra landmark factories run in a module worker. Medium models remain visible during background construction and one-mesh-per-frame GPU preparation. One completed landmark is attached per frame.
- Tree selection uses a spatial index and bounded stable nearest selection. Geometry/material appearance is unchanged; High avoids allocating unused Ultra pools.
- A centred 4×4 AO blur removes the visible repeating noise grid without changing the kernel, radius or noise direction texture.

## Measurements so far

On the same AMD Radeon Pro 560X, 1920×1080 viewport, High renders 1788×1006 and Ultra 2560×1440. These are browser wall-clock frame intervals, not isolated GPU timings. Fresh engine startup is not an empty HTTP or driver shader cache.

The facade/Causeway intermediate build reaches interactive eligibility in 13.506 seconds versus 18.490 seconds in Stage 8. Its bridge-approach phase is 1.031 seconds versus 6.119 seconds. Other phases differ slightly, so do not attribute the complete total-time difference solely to that one phase. [Intermediate capture](../stage-9-facade/README.md).

A 60-second High Robson drive covers 1228.9 metres over 59.8 simulated seconds with no collision or stalled interval. It measures 36.0 FPS, p95 30.6 ms, maximum 142.0 ms and three intervals over 100 ms. This CPU-page-only intermediate still has upload spikes; the final combined candidate requires its own cold-transition and travel checks.

## Rejected experiment

The 500 m shared-attribute indexed building body candidate reduces submitted triangles but raises draw calls and adds about 2 MiB of indices. Eight paired views show small mixed frame-rate changes. It is removed; the original whole-body renderer remains. [Actual A/B and shading captures](../stage-9-body/README.md).

## Cold Ultra result

After correcting a vinext-inherited client `typeof window` definition in the worker environment, all seven model jobs complete and attach within 3.587 seconds. The two landmarks inside the BC entry camera's submitted passes are actually submitted at 1.371 and 1.690 seconds; off-camera attachment is not claimed as visible pixels. The screenshot confirms the expected BC geometry. Worker decode takes 0.3–2.0 ms per model; factory time runs on the worker.

The first 8-second Ultra transition includes the triggering action and no warm-up discard. Maximum interval decreases from Stage 8's 1669.9 ms to 142.9 ms; two >100 ms intervals remain. Initial quality-change action is 96.5 ms. This is substantial stall reduction, **not** a zero-stall guarantee or faster completion of every model. Models deliberately arrive progressively. The final queue has 24 ready facade cells, 46 prepared pages, 39,567,360 cache bytes, no pending pages and no errors; maximum facade pump is 2.3 ms. Preparation wall duration includes FIFO waiting, not only GPU work.

An earlier integration test correctly failed with zero Ultra arrivals because the compiled worker referenced `window` without its original guard. That failed result was not accepted as a performance improvement. The final Firebase build verification now executes the emitted worker in a realm without Window/DOM and checks protocol handling in addition to the browser arrival test.

## Final fixed views

The final combined build reaches interactive eligibility in 13.672 seconds in this recorded fresh-engine run. Eight fixed samples cover BC Place, Harbour Centre, Convention Centre and Vancouver House at both qualities. High is 28.9–48.6 FPS and Ultra 19.0–29.5 FPS on this device. Some views are slightly slower than Stage 8, so this is not claimed as a general FPS increase. One High BC interval and one Ultra Convention interval exceed 100 ms. The measured benefit is shorter startup and removal of the long synchronous Ultra factory stall; dense views remain GPU-limited.

The added loading draw occurs while the loading screen is present. This can increase startup relative to the CPU-only intermediate, but avoids presenting the UI before that first pipeline work. Exact first-frame and warmup spans are retained in the startup JSON.

## Validation and remaining limits

Final fresh High Robson drive: 60 seconds, 1231.7 metres / 59.947 simulated seconds, 34.5 FPS, p95 31.7 ms and maximum 131.6 ms; one interval exceeds 100 ms. No collision, stalled period, runtime warning/error, pending facade job or failed preparation is observed. The facade-only intermediate has a slightly higher average but three >100 ms intervals. This is a measured responsiveness tradeoff, not a universal frame-rate improvement. [Final captures and raw measurements](../stage-9-final/README.md).

All 342 portable regression tests and TypeScript checking pass, including real Node-worker transport, cancellation/ownership, exact geometry, SSAO cleanup, tree loading failure, facade preparation and the existing travel controls. Causeway retains its 58 movement/clearance checks. The normal Firebase build additionally rejects QA bundles and executes its final emitted worker without Window/DOM before it can be deployed.

Progressive details may take several seconds to arrive; existing medium/base geometry remains visible. A synchronous GPU driver compile/upload can still exceed the frame budget. Ultra remains substantially more expensive than High on the recorded AMD GPU. Full day/dusk/night, public controls and additional long routes follow in Stage 10.
