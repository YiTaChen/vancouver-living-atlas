# Progressive startup — local validation

Branch: `perf/progressive-city-startup`, based on `7443b95`. No Firebase release or merge into main.

## Changes and invariants

- Required geographic requests run concurrently instead of one GeoJSON batch followed by sequential JSON fetches. Network failure behavior is preserved.
- Shared terrain vertices reuse exact elevation/park samples in a temporary cache; no coordinate rounding or lower-resolution geometry.
- Building foundations retain the first source part, now found through a map instead of repeated linear scans.
- Road-lowering broad phases preserve source order and exact bounds arithmetic. Distant chunks are excluded before allocating expanded world-space arrays; lowering includes the entire blend margin.
- Optional rooftop equipment is built after entry in generator steps: 1.5 ms budget in overview, 0.5 ms during travel/transitions, at most 64 steps per frame. This is a cooperative budget, not a hard guarantee for every individual operation. Temporary meshes are disposed when cancelled.
- Balanced/compatible graphics skips optional rooftop equipment. High/Ultra build it once and retain it. Existing facade/Ultra preparation queues remain intact.
- Walking, car and boat actors, controls, placement, physical ground, bridge surfaces, water collision and landmark interiors remain ready before interactive entry. No mode-selection downloads, loading modal or camera transition changes.
- Cockpits are deliberately still immediately available: their startup cost is small compared with roads/ground. Introducing another asynchronous transition here had little prospective benefit.

## Rejected experiments

Full precomputed 3D roads added about 24 MB gzip. A smaller 2D road plan added about 3 MB gzip and did not reliably improve total startup. A one-shot road worker (including transferable result buffers) also failed to produce reliable net gains. None of these assets, worker modules or dependencies ships in this branch.

## Reproduction and limits

Build locally with `VANCOUVER_STATIC_EXPORT=1 VANCOUVER_VISUAL_QA=1 npx vinext build`; run `node tools/serve-visual-qa.mjs <label>`. In Chrome, use “Save startup timing” after each new page load, preserve each report under a distinct name, and navigate to about:blank between loads. No builds/tests ran concurrently with the final browser measurements. Use `node tools/summarize-startup.mjs docs/performance/baseline docs/performance/candidate` to summarize committed raw reports.

Page-to-interactive = `measurement.originPerformanceMs` + `ui.interactive-eligible.elapsedMs`. This includes page startup before Engine construction. The local HTTP server uses `no-store`; the GPU driver/shader cache is not cleared. Desktop shader compilation and system scheduling vary. These are repeated local page loads, not a cellular-network simulation or proof of identical gains on every device.

Mobile-profile runs use 390×844 and `?graphics=compatible` in desktop Chrome. Desktop runs use 1920×1080 and the default High profile. **Mobile results are not iPhone CPU/GPU measurements.** Earlier IAB experiments were excluded because repeated-load memory pressure and unresponsiveness also affected the baseline.

`node tools/verify-startup-geometry.mjs --root /path/to/baseline` and the same command without `--root` compare physical terrain/road buffers. Both produced 1,014 meshes, 115,305,684 attribute bytes and SHA-256 `5eef2c9b4dbe685d294e851a10e4dfd31e7d30e4d110944fdfd56d427668deb4`. This verifies exact physical geometry, not an FPS measurement. Source-only optimization adds no geographic download assets.

## Resource interpretation

Startup CPU work, wall-clock load time, steady GPU cost, resident memory and download bytes are different metrics. Full city geometry and rendering resolution remain unchanged; no general FPS, battery or RAM percentage is claimed. Distant road snapshots avoid temporary allocation; terrain sampling adds a short-lived cache. Balanced skips two rooftop instanced meshes; High/Ultra retain the original eventual scene content.

For a performance-oriented device profile, skipping unnecessary fine decoration is better than continuously preparing it. High/Ultra still benefit from scheduling because even a fast GPU cannot make long synchronous JavaScript work disappear. The queue reduces its budget during travel rather than rebuilding detail whenever the camera moves.

## Validation and measurements

TypeScript and 375 automated tests pass. Final matched browser measurements and travel results follow below.

| Profile | Baseline median (range) | Candidate median (range) | Observed median reduction | Main-thread construction median |
| --- | --- | --- | --- | --- |
| desktop | 18.13 s (16.49–20.05) | 15.75 s (15.47–20.16) | 2.38 s | 14.00 → 13.54 s |
| mobile-profile | 15.68 s (15.59–15.74) | 15.07 s (14.84–16.22) | 0.61 s | 13.97 → 13.38 s |

Three samples per profile/version. Observed startup median changes are 13.1% desktop and 3.9% mobile-profile; main-thread construction medians improve about 3.2% and 4.2% respectively. **Ranges overlap, and sample size is small: these are preliminary local observations, not statistically established speedups.** No guaranteed number of seconds is claimed for production or real phones. CPU percentages are construction wall-time changes, not total device utilization. Steady-state GPU/RAM savings were not established.

### Travel smoke tests

Chrome at 390×844 with the compatible renderer, using the existing QA High-detail travel cases (not an iPhone benchmark): all three modes changed position and displayed the expected scene/actor. Walk: 60.0 FPS, p95 18.2 ms, maximum 18.7 ms; boat: 60.0 FPS, p95 18.1 ms, maximum 18.8 ms. Initial drive: 55.7 FPS, p95 17.3 ms, **one maximum 567 ms frame**. A repeat of the same warmed drive reached 60.0 FPS, p95 18.0 ms, maximum 18.7 ms. This does not establish that every first visit or mode transition is hitch-free; the first-drive stall needs a separate trace before any such claim. Original reports are retained in `travel/`.

The new rooftop queue completed 11,025 steps, with maximum pump observations of 1.2–1.4 ms in the three desktop startup samples and no failures. The three compatible-profile starts scheduled zero steps. After High/Ultra has already built optional roofs, switching to Balanced retains those existing meshes; this change avoids fresh scheduling rather than promising immediate reclamation of all warmed detail.

No remote deployment was performed. Production output must be rebuilt without `VANCOUVER_VISUAL_QA`; `npm run build:firebase` verifies this and does not deploy.
