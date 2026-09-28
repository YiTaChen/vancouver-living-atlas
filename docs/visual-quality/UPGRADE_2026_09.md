# September 2026 city quality upgrade

Approved scope: improve the existing Vancouver atlas in stages, validate each result, commit/push and merge each accepted stage to `main`. Preserve real geography, navigation and the mobile-compatible path. Original assets and independently written code only.

| Stage | Deliverable | Status |
| --- | --- | --- |
| P0 | Matched-resolution aerial, roof, street and citizen baseline | Complete: [8 captures](upgrade-baseline/README.md) |
| P1 | Ordinary-building materials, roofs and low-rise architecture | Pending |
| P2 | Original Blender streetscape GLBs and rigged citizen | Pending |
| P3 | Bounded visible detail, asset lifecycle and rendering calibration | Pending |
| P4 | Expand reusable architecture across the existing city and validate travel | Pending |

## Matched evidence

Build the existing opt-in QA variant with `VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build`; serve it with `node tools/serve-visual-qa.mjs upgrade-baseline`. In a visible desktop browser, use **Upgrade matched high** and **Upgrade matched ultra**. Each suite saves four actual canvas PNGs and metadata, at a fixed 1920×1080 drawing-buffer resolution, fixed camera placement and 14:00. It records 8 seconds after 5 seconds settling; this is a diagnostic, not a long-session guarantee. A hidden page is invalid. Baseline and candidate comparisons must use the same device and these same controls.

The matched drawing buffer intentionally decouples pixel count from quality; normal High/Ultra presets remain unchanged. Use **Restore normal render size** or reload after measurements. Existing release controls remain available for 60-second travel and cold transitions. Always rebuild normally before publishing; production verification rejects QA markers.

## Acceptance

Baseline on the local Radeon Pro 560X is approximately 18–24 FPS at a matched 1080p, with occasional long frames. Heavy Blender generation was paused for these final samples. This is an existing performance constraint, so visual upgrades must be evaluated against frame times as well as screenshots. PNGs are original renderer outputs, without resampling.

Review ordinary roofs and street buildings, not just landmarks. Preserve silhouette at all distances, coherent window/door metre scales, ground contact and stable detail transitions. Inspect day, dusk and night, desktop and compatible graphics. Measure load/first-use pauses separately from warm frame-time. Budget by visible geometry, draw calls, materials and texture footprint; a spatial split alone is not assumed to improve performance.

Archive source fingerprint, device, render size and actual screenshots with each stage. Automated geometry, navigation, lifecycle and build tests complement visual review; they do not replace it.
