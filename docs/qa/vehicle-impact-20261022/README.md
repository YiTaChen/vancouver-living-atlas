# Vehicle impact acceptance — 2026-10-22

The captured build contains the final product sources, including the Tesla
sparse-trim dent fix and narrow-screen condition-panel fix. `revision` in raw
captures is the clean parent commit, because acceptance preceded the feature
commit. The server hashed the actual working sources and assets:
`9c75e5dd821feceb11016476bf113c304074a7dee1e0852215a78ea637d07dce`.
[verification.json](verification.json) records critical source hashes and PNG
hashes. [capabilities.json](capabilities.json) records the actual browser/GPU.

## Checks

- Complete suite: **1,496 passed, zero failed**, 217.98 seconds, using
  `node --test --test-concurrency=4 tests/*.test.mjs` on local Node 26.
- Whole-repository TypeScript check and strict lint of the new modules/tests:
  passed. The repository's pre-existing global lint backlog is not claimed clean.
- Renderer/UI focused suite: 19 passed, including the actual native Tesla trim
  point in all three LODs, material attributes/groups/draw range, closed edges,
  source geometry preservation, face inversion protection and hard budgets.
- Independent physics, rendering and research/document reviews: passed.
- The earlier unrestricted parallel run encountered the existing close-up bus
  Python validator's 230-second timeout under concurrent build/browser load.
  No assertion or timeout was relaxed; the entire bounded run then passed.
- Normal production build and QA-isolation results are recorded in
  `verification.json` after the final Firebase build.

## Native input and observed results

The local QA buttons choose real registered props and call public navigation
entry points. They do not inject speed, breakage, damage or an impact response.
The car reaches the prop through native keyboard/touch input. Armed capture
saves two animation frames after the actual feedback event. Native input timing
does not establish continuous collision safety or a frame-rate benchmark;
the deterministic geometry/integration tests cover those motion guarantees.

| Capture                                                                                      | Native action and observed result                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Drive tree burst](drive-tree-burst.png) / [data](drive-tree-burst.json)                     | W, then Space brake. Actual tree 17263 breaks; front damage 4.803%, 273 dented vertices, clipped scratches and active particles.                                                                                                                                                                                                            |
| [Stopped audio](drive-tree-stopped-audio.json)                                               | Explicit condition-panel audio gesture allocates/enables audio.                                                                                                                                                                                                                                                                             |
| [Drive repair](drive-repaired.png) / [data](drive-repaired.json)                             | Stopped native Repair action resets marks/dents/damage; tree 17263 remains broken.                                                                                                                                                                                                                                                          |
| [Low-speed lamp](drive-lamp-low-speed.json)                                                  | Lamp 183 survives the first lower-speed hit; localized damage and one bounded audio voice are recorded.                                                                                                                                                                                                                                     |
| [Lamp break](drive-lamp-break.png) / [data](drive-lamp-break.json)                           | A second real approach with longer held acceleration breaks lamp 183; particles/audio and front damage are recorded.                                                                                                                                                                                                                        |
| [Fallen lamp](drive-lamp-fallen.png) / [data](drive-lamp-fallen.json)                        | Settled pole remains visible. CPU lifecycle/light-field tests separately prove pole/head hiding and local warm-field removal.                                                                                                                                                                                                               |
| [Guardrail burst](drive-guardrail-burst.json) / [stopped](drive-guardrail-stopped.png)       | Real Lions Gate concrete barrier approach; car stays on the bridge, driver's-left damage reaches 20.004%, with local scratches/dents. The native endpoint is not claimed as proof of continuous sliding; shallow-angle redirection is checked by the solver/integration tests.                                                              |
| [Tesla tree burst](tesla-tree-burst.png) / [data](tesla-tree-burst.json)                     | Ground acceleration reaches an existing curb/ground impediment. Native short Space hop, W and B then cause an **airborne trunk hit** on tree 9639; tree breaks, front damage 3.869%, 24 dented vertices and 28 scratch triangles. This is not a native ground-traversal claim; actual ground collision is covered by CPU integration tests. |
| [Tesla High](tesla-high-front.png) / [Low](tesla-low-front.png)                              | Native camera drag and public detail selector preserve damage and the same 24 affected vertices. Local added geometry across the cached tiers remains within caps.                                                                                                                                                                          |
| [Portrait](mobile-portrait.png) / [data](mobile-portrait.json)                               | 320×568 responsive viewport; expanded condition panel has client/scroll widths 222/222px and all three action buttons at least 44×44px. Its bounds are x13/y284/w224/h218.5, without horizontal scrolling.                                                                                                                                  |
| [Landscape repaired](mobile-landscape-repaired.png) / [data](mobile-landscape-repaired.json) | Native joystick hold shows 67km/h, held touch brake shows 0km/h. At 844×390 the panel occupies x314/y206/w216/h174, with scrollable actions; native Repair resets car damage/owned geometry while all broken props remain. Audio is switched off afterward.                                                                                 |

Raw PNGs are renderer captures, so they contain the city/car rather than DOM
controls. Panel bounds, visible screenshots and native controls were separately
checked through the browser. No screenshot was edited or composited.

The final healthy tab reported no captured warning/error messages. Two temporary
pages needed recovery during the heavily contended load; a fresh default-graphics
page completed acceptance. This is responsive Chromium functional verification,
not an actual phone/GPU performance result. Viewport overrides were reset,
healthy test tabs closed and the local instrumented server stopped afterward.

See [design and tuning](../../VEHICLE_IMPACT_DAMAGE_2026_10.md) for research,
resource caps, gameplay choices and simulation limits.
