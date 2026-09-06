# Street, architecture and coast upgrade

Approved scope (2026-09-05): finish each stage in order, validate it, then commit and push it. Improve medium-detail roads and ordinary buildings first; prioritize Stanley Park's central road and surrounding beaches; subsequently refine the listed landmarks. Keep the complete city usable throughout.

| Stage | Status | Deliverable |
| --- | --- | --- |
| 1 | Complete | [16 fixed-view/driving samples and actual captures](baseline/README.md) |
| 2 | Complete | [Connected pavement, markings, terrain-aligned curbs and tree-row clearance](roads/README.md) |
| 3 | Complete | [Shared facade types, aligned windows, ground-level entries and materials](buildings/README.md) |
| 4 | Complete | [Connected Causeway, complete separated paths, source-floor navigation and actual QA](causeway/README.md) |
| 5 | Complete | [Shared Second/Third Beach terrain, walking/boat boundaries and actual QA](beaches/README.md) |
| 6 | Complete | [Bounded ground reconciliation, foliage cleanup, public controls and 60-second samples](integration/README.md) |
| 7 | Complete | [Marine Building, Canada Place and Science World detail](landmarks-primary/README.md) |
| 8 | Complete | [Convention Centre, BC Place, Harbour Centre and Vancouver House detail](landmarks-secondary/README.md) |
| 9 | Complete | [Worker landmarks, bounded facade uploads, tree selection and measured startup/stall reduction](performance/README.md) |
| 10 | Complete | [30 day/dusk/night captures, four continuous-travel runs and final release evidence](stage-10-final/README.md) |

## Baseline procedure

A separate opt-in **local QA build** uses the production compiler and the normal renderer. Its controls are only included when `VANCOUVER_VISUAL_QA=1`; the Firebase verification script rejects any bundle containing the QA laboratory marker.

```sh
VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build
node tools/serve-visual-qa.mjs baseline
```

Open the printed local URL, set the test viewport to 1920 × 1080, then use **Run High baseline** and **Run Ultra baseline**. Keep the browser visible. Each selected fixed case warms for 2.5 seconds, then measures eight seconds of actual requestAnimationFrame intervals. The Robson case uses the existing driving controller with forward input. Scene time is fixed at 14:00; city traffic remains enabled. Save reports and actual canvas images under ignored `work/visual-qa/baseline`.

The report records the physical render size and actual browser/device renderer, average FPS, p50/p95/p99/max frame intervals, >50ms and >100ms counts, position and camera. Any sample with a hidden document is invalid. Timing includes browser scheduling; it is not an isolated GPU timing query. The renderer disables info.autoReset and resets once before its composer: `calls`/`triangles` include that sampled frame's beauty, AO-normal and any shadow passes. They are not unique scene geometry counts or averages across the sample.

The server binds only to loopback, accepts bounded reports with simple filenames, and serves only `dist/client`. It is not a production server. After QA, **rebuild normally** with `npm run build:firebase` before deployment.

Archive review-sized captures and measurements with `python tools/archive-visual-qa.py baseline` (Pillow required). Full-resolution PNGs stay in ignored `work`; Git contains the measured JSON and 960 × 540 review JPEGs.

## Stage 1 findings

The baseline uses source revision `0459e6e` plus the opt-in measurement hooks. The GPU is ANGLE Metal on an AMD Radeon Pro 560X. At a 1920 × 1080 viewport, High renders 1788 × 1006 and Ultra renders 2560 × 1440 under the existing pixel budgets. Both remain selectable; Ultra is already substantially more expensive on this device.

High Water Street measures 29.3 FPS (p95 48.1 ms), while the Robson driving sample measures 38.4 FPS (p95 34.8 ms, no >100 ms frames). The car moves approximately 141 m during that sample. Ultra ranges from 20.0 to 31.8 FPS across these scenes. Downtown and Water Street each have one >100 ms interval in High; subsequent work must inspect spikes rather than relying on average FPS alone.

Actual captures identify repeated crossings at source microsegment ends, sidewalk overlap at intersections, misaligned facade frames, a Causeway/bridge height mismatch, and flat beach overlays with visible terrain seams. These are the first-pass targets. The short samples do not certify loading smoothness or all travel routes; longer travel acceptance is reserved for stages 6, 9 and 10.

Validation: TypeScript check passed; all 103 regression tests passed in an isolated rerun. One initial run concurrent with a build failed the existing first-frame wall-clock test; its isolated six-test suite and the full rerun passed without production or threshold changes. Normal Firebase build verification confirms the local QA controls are excluded.

## Acceptance

- Preserve terrain/bridge layers, water boundaries and existing travel controls.
- Target usable 1080p High performance on the recorded test device; measure frame-time spikes as well as averages.
- Bound nearby geometry and textures from the start; defer broad performance tuning until there is measured evidence.
- Compare the same camera, time, viewport and quality, using real application captures.
- Do not represent inferred lane/facade details as surveyed conditions.

## Additional requested work

- [Vancouver-style buses](buses/README.md): complete and pushed as `3b265e8`.
- [Measured 300× default time flow](clock-1080/README.md): complete and pushed as `970e786`.
- Stage 10 records remaining first-use Ultra pauses and lower Ultra driving FPS; completion does not mean zero stutter on every GPU. High remains the default quality.
