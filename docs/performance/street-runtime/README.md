# SSAO visibility CPU audit

The existing event-maintained `SSAOExclusions` owner already hides points, lines, foliage and non-depth-writing transparent meshes before the SSAO draw. Three r185's `SSAOPass` then performed another whole-scene traversal to hide points and lines again. `lib/city/ssao-visibility.ts` suppresses only those redundant private visibility hooks during the owned draw. It retains all normal/depth, AO, blur and compositing submissions, scene-matrix updates, shaders and geometry.

The adapter requires Three revision 185, stock hook identities, an empty visibility cache and an isolated behavioral-contract probe. Unsupported contracts and later hook/cache changes retain the upstream traversal. Hooks, visibility and scene override are restored on a thrown draw; disposal restores the original render method. Tests cover late additions/removal/reparenting, vehicle fading, hidden objects, upstream fallback and a later render wrapper retaining an uninstalled callback.

## Reproducible isolated result

Run from the repository root:

```sh
node tools/benchmark-ssao-visibility.mjs > ssao-visibility-cpu.json
```

Optional `--iterations=2000 --rounds=12` controls retain the default experiment. The tool uses the actual Three `SSAOPass`, with a renderer whose draw, clear and render-target methods perform no GPU work. A synthetic 27-group scene matches the archived final citizen capture's 2,701 watched objects, 177 exclusion candidates and 61 hidden candidates. It does not reconstruct the city's topology, meshes or materials. Scene-visit counting runs separately from the timing loop.

After 1,000 warm-up baseline/candidate pairs, 12 rounds each time 2,000 invocations per variant, alternating variant order. [Raw samples and environment](ssao-visibility-cpu.json) record Node v24.19.0, Three 185 and AMD EPYC 9V74 80-Core Processor.

- Redundant scene visits per mocked AO frame: 2,701 → 0
- Render submissions per mocked AO frame: 4 → 4
- Median baseline CPU time: 0.128304 ms
- Median candidate CPU time: 0.002436 ms
- Median difference: 0.125868 ms

These are medians of per-round average CPU durations in one process. They are not browser frame intervals, GPU timings, app FPS, or statistical evidence across machines. Host load was not isolated, so absolute timing is illustrative; the removed traversal count is deterministic.

## Limits and required follow-up

This audit does **not** diagnose or establish a fix for the recorded citizen 149.7 ms p95 or street long frames. The isolated saving is much smaller than that regression. Browser/GPU paired profiling was unavailable in this executor: Chromium could not create its local runtime socket under the sandbox policy, and the cloud browser could not access the localhost test server. No new screenshot, visual pixel comparison, or actual-city frame-time improvement is claimed here.

Portable tests compare actual normal-pass visibility and all four pass submissions before/after, including failure and lifecycle paths. End-user performance and visual acceptance still require repeated same-device citizen/street captures at identical camera, time/weather, quality, 1920 × 1080 drawing buffer and settled assets. Record CPU method spans and shadow-refresh/streaming activity alongside frame intervals before attributing the long-frame cause.
