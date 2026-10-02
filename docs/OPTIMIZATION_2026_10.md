# Optimization checkpoint — 2026-10-02

Base: `a1364e932195e7c7e0dce093e40e1c94ecb94bcb` (main). This checkpoint separates
implemented code, offline candidate assets, runtime acceptance and publication.
It does not mark all roadmap stages complete.

## Stage status

| Stage | Delivered | Acceptance still required |
| --- | --- | --- |
| B: region rules | Named compatibility-region rules, exact Water Street selection, optional source-ID filters and pinned current-data audit. Full-input and shuffled-input parity preserve current footprints, selections and ordering. See [rule audit](REGION_RULES.md). | No new region coverage was enabled; intentional future cohort changes require fixture/source review. |
| C: architectural modules | Eight original Blender-authored components, sixteen independent LOD source/GLB pairs, metre UV/material/clearance/budget validation and offline preview. See [kit](../tools/assets/architecture-details/README.md). | Source-edge runtime replacement, slope/entrance and High/Ultra/compatible scene comparisons remain gated. Assets are outside public/ and do not expand production content. |
| D: vegetation/materials | Blender-authored joined-edge seven-triangle perennial, before/after source and GLB exports, source-derived runtime geometry, tests and an unapplied integration patch. See [candidate and wider inventory](../tools/assets/residential-perennial/README.md). | Accepted-plot equality, actual-city visuals and GPU/device performance. Leaf/bark, soil/grass, landmark and other material work is assessed, not declared complete. Production gardens are unchanged. |
| E: performance | Removed one provably redundant SSAO scene traversal, preserving every render submission and visibility behavior; compatibility fallback and lifecycle regression tests. Optional local-QA CPU-method profiler now distinguishes submission spans from frame intervals. See [isolated benchmark](performance/street-runtime/README.md). | The historical citizen 149.7 ms p95 regression is **not diagnosed or fixed**. Actual-device repeated frame-time, cold/warm start, memory and multi-pass/GPU evidence remains required. No wider population/coverage rollout. |
| F: optional activity | Not started. | Visual and performance prerequisites have not passed. |

## Validation and environment boundaries

- Node v24.19.0, Three r185, Blender 4.3.2 in the cloud executor.
- Clean original base independently passes all 563 tests.
- See `performance/street-runtime/validation.json` for final checkpoint checks and counts.
- Baseline full lint is already failing. Compare normalized diagnostics with the
  same base; do not report scoped lint success as a clean repository lint pass.
- Local QA and production Firebase builds are distinct. The production verifier
  checks the absence of QA markers and validates the emitted landmark worker.
- No changes to public geographical data, collision surfaces or asset population.
- Browser acceptance could not run: CUA rejected localhost navigation, and a
  same-command Chromium test harness failed creating its required local socket,
  including an approved escalated attempt with Chromium's normal sandbox. The
  same-command HTTP server returned 200; this was not an application HTTP failure.
  No browser security restrictions were disabled. Offline Blender renders are
  asset previews, not screenshots of the integrated city or mobile-device tests.
- GitHub publication was attempted but blocked: the CLI had no configured write
  credential and the connected Git tree write returned HTTP 403, “Resource not
  accessible by integration.” Local commits/bundle are not a pushed branch, PR,
  merge or Hosting deployment. Later publication must be verified separately.

## Repeatable browser acceptance once a browser can reach the app

1. Use separate clean baseline and candidate checkouts with the locked packages.
   Build each with `VANCOUVER_STATIC_EXPORT=1 VANCOUVER_VISUAL_QA=1 npx vinext build`.
   Start `node tools/serve-visual-qa.mjs <unique-run-label>` for each run. Keep
   each label distinct because a suite overwrites the same view filenames within
   its label. Never run builds, tests or Blender during timing.
2. Keep the same browser/GPU, 1280×720 viewport, High quality, clear 14:00 and the
   existing fixed 1920×1080 drawing-buffer suite. Run at least three interleaved
   baseline/candidate repetitions using “Upgrade matched high”, initially with
   CPU recording unchecked. Preserve original slow samples. Repeat Ultra and
   compatible scenarios separately, not pooled with High.
3. Require visible foreground, stable camera, matching asset readiness and
   source fingerprint. Compare citizen and Gastown street p50/p95/max frame gaps,
   draw/triangle/texture counts, readiness latency and raw samples. Do not infer
   GPU time from CPU measurements or FPS from a removed JavaScript traversal.
4. For diagnosis, check “Record CPU method timings (instrumented)” and rerun the
   same suite. Files have a `-cpu` suffix and `instrumented: true`; they never
   replace uninstrumented results. Inclusive method timings overlap, so do not
   sum categories. `renderer.render` includes CPU submission/driver waits, not
   GPU completion. Correlate expensive render, navigation and detail updates
   with a browser performance/GPU trace before selecting a further optimization.
5. Apply candidate asset integration only in a validation branch. Compare
   accepted source IDs, placement/clearance, LOD transitions and ground contact;
   inspect clear/overcast at 14:00, 19:00, 19:48 and 23:00. Repeat actual walking,
   mode/quality changes and bounded cache/resource observations. Revert a failed
   batch instead of expanding coverage. Real phones still need real-device tests.
6. Rebuild normal `npm run build:firebase` after all QA. Commit exact evidence,
   verify the remote revision after publishing, and treat merge/deploy separately.
