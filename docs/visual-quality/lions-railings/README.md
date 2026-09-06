# lions-railings measurements

Actual local application renders. Viewports: [(1280, 720)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| lions-east-rail | high | 60.1 | 17.6 | 17.7 | 17.8 | 0 | [Image](high-lions-east-rail.jpg) |
| lions-west-rail | high | 52.3 | 33.4 | 34.2 | 50.5 | 0 | [Image](high-lions-west-rail.jpg) |


## Acceptance

Both saved views use actual Walk mode on the source-owned east/west bridge floor, with the camera approximately 1.88 m above the walking surface. They are stationary 8-second samples, not a continuous traversal or an isolated before/after benchmark. Both had zero frames over 100 ms. Actual screenshots show continuous green top/bottom rails, dense vertical pickets and a tapered concrete road barrier. No browser errors were reported.

[Implementation, user-provided reference and geometry audit](NOTES.md). All 348 tests and TypeScript pass; the canonical Causeway audit passes all 58 checks. `geometry-audit.json` records complete east coverage and west coverage excluding only the two intentional tower openings, with zero shared-endpoint error.

To reproduce: build with `VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build`; run `node tools/serve-visual-qa.mjs lions-railings`; choose `lions-east-rail` and `lions-west-rail`, then Measure selected High. The separate CLI audit is `node tools/audit-lions-railings.mjs`. The public Firebase build excludes these controls.
