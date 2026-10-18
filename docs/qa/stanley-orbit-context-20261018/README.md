# Stanley Park Orbit context-loss observations — 2026-10-18

The Tesla uneven-ground repair is released in [PR19](https://github.com/YiTaChen/vancouver-living-atlas/pull/19), main `2b30f719ec7c31d0f087ea7d42dd0390b4fad810`. Its park driving acceptance is recorded in `../tesla-park-ground-20261018/verification.json`.

A separate intermittent WebGL context-loss occurred during public Orbit navigation to Stanley Park, including on the parent revision before that repair. This diagnostic branch adds local observation controls; it does not claim a production rendering fix. Do not merge it as a resolution of context loss.

## Evidence and limits

`observations.json` retains failed hosted observations and subsequent successful local isolation runs. Three captures retain their original server metadata and source fingerprints. Each capture executes then-uncommitted instrumented sources on parent revision `2b30f71`; its revision field is not a claim that main includes the instrumentation. The first capture missed the transition because the bounded ring had rolled over; the latter two contain actual transition frames.

The normal-startup ORBIT-only rerun succeeded but includes a 99.7 ms CPU render hitch. It ran around 19:00 simulated time, whereas hosted failures began around 10:00. These are not identical atmosphere conditions. CPU timings wrap `renderScene` only, exclude earlier animation/lighting work, and are not GPU timings or physical-phone benchmarks. No failed hosted per-frame trace was available. No specific geometry, tree, shader, or driver cause is established.

The test environment reported ANGLE Metal with AMD Radeon Pro 560X. After repeated losses the browser temporarily refused new WebGL contexts. No security, context-loss-block, or driver settings were weakened. Recovery happened through the normal application/browser path.

## Reproduce the local diagnostic build

```sh
VANCOUVER_STATIC_EXPORT=1 VANCOUVER_ORBIT_QA=1 npm run build
node tools/serve-visual-qa.mjs stanley-orbit-followup
```

Open the server URL on localhost. Keep `Orbit QA: Normal` selected; use the public Stanley Park sidebar button, then save the trace immediately to preserve its frames. Context loss attempts automatic trace saving before engine disposal. `Instant` is an explicit comparison control that changes only the public fly call's animation argument; it is not a production workaround. The recorder retains 480 frames and removes its wrappers/listeners on destruction. A full `VANCOUVER_VISUAL_QA=1` build also provides these controls but loads additional instrumentation, which can alter timing.

The recorder requires an explicit build flag and a loopback hostname. Normal `npm run build:firebase` must exclude all diagnostic code, labels and module assets; the verifier and isolation tests enforce this. The separate diagnostic branch has no changes to Tesla support/collision rules, trees, lighting, quality policy, or production transition behaviour.
