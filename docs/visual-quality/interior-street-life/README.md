# Interior activity, shop identity and browser lifecycle — 2026-09-30

This milestone continues the Taipei GTA comparison with one original interior activity and more distinct existing streetfronts. It does not change source building footprints, navigation clearance, street placement or quality-tier population budgets.

## Delivered changes

**Science World light lab.** A physical display replaces the generic decoration on an existing demonstration island. Players walk through the representative annex and dome, adjust three light channels, test three target mixtures, read their discoveries and earn a permanent local stamp. The scene screen updates with the same beam levels as the accessible controls. This is an original Atlas activity, not a reproduction of an official museum exhibit. [Activity, spatial rules and science references](../light-lab/README.md).

**Six original shop identities.** ALDER & STEAM, PAPER TIDE, MOSS & CLAY, TIDELINE, CEDAR STUDIO and NORTH WINDOW each have their own fascia, display art and door card. These are fictional scene dressing, not claims about businesses occupying these Vancouver addresses. Stable source-based assignment carries across the immediate procedural fallback and both detailed Blender bay LODs. Reused glass and physical shelves remain in front of the original display artwork.

**Failure and page-return handling.** Failed renderer construction cleans up acquired resources without retaining global listeners. Failed loading or a lost graphics context cancels the 17 city-data requests and releases the engine before presenting the existing reload action. A persisted pagehide now retains and suspends the city for the browser's back/forward cache; pageshow clears held inputs and resets the clock/frame timebase before resuming. Returning from a cached page previously restored a React interface whose city had already been destroyed.

Three r185 lacks a complete public gesture-cancellation API. The small `orbit-lifecycle.ts` adapter uses public disconnect/connect and clears version-specific pointer bookkeeping while preserving camera state. Tests exercise the actual installed OrbitControls, including ended pointer IDs, live capture, stale moves and a fresh drag. A revision assertion requires review when upgrading Three. This is explicit dependency coupling, not a generic browser workaround.

## Resource budget

| Change | Bound |
| --- | --- |
| Shop atlas | One 1024² texture replaces six 512×96 sign textures; approximately 3.83 MiB more uncompressed RGBA+mips |
| Detailed shop artwork | Six triangles per selected heritage bay; at most 144 in High / 216 in Ultra; one artwork draw per active cell |
| Fallback artwork | Shared atlas reduces the former six sign-material variants to one per cell |
| Light lab screen | One 512×256 texture, two triangles, one unlit draw, repainted only when beam levels change |
| Lab physical support | Merged into existing structure; previous torus/cylinder decoration removed; unchanged obstacle footprint |
| Added real-time lights / shadow passes | None |

The shop atlas trades a small bounded memory increase for visible content. It is not a texture-memory reduction. The lab screen does not illuminate nearby geometry; it is a display surface.

## Verification boundaries

The complete **511-test suite** passed before the final interior sign-height adjustment; all **17 related interior/lab tests** passed again after that adjustment. Coverage includes the original interior circulation tests, ten light-lab behavior tests, two physical-screen checks, shop identity/streaming coverage and seven lifecycle regressions. Final TypeScript and `npm run build:firebase` pass; the production worker and exclusion of QA controls are verified.

The four matched High captures use the same Radeon Pro 560X, 1920×1080 drawing buffer, 14:00 clock, camera poses and warmed eight-second RAF protocol as the baseline. All captures passed pose/readiness/visibility validation.

| View | Before FPS | After FPS |
| --- | ---: | ---: |
| City aerial | 22.8 | 24.4 |
| Gastown roofs | 29.0 | 27.5 |
| Gastown street | 21.7 | 21.1 |
| Citizen / street | 23.7 | 22.7 |

These short samples do **not** establish an FPS improvement or statistical equivalence. The street view's multipass draw count changed from 1,454 to 1,385 and texture objects from 58 to 53, while the atlas's estimated memory increased as described above. The city remains well below 60 FPS in this protocol. [Before](street-before.png), [after](street-after.png), [baseline metrics](baseline-metrics.json), [final metrics](final-metrics.json).

Matched city/street capture source fingerprint: `69b78ee8429a2d960ffdb2008b02dfbd21f7946071c78da2064ec7da2d602394`. The parent revision is `801564f`; captures precede the implementation commits. Documentation and test changes do not alter this visual-source fingerprint. A subsequent interior-only sightline adjustment raises the pre-existing hanging wayfinding sign above the third-person camera; final lab validation uses fingerprint `18d7952345627251e7a617d512d9b9fcd93139aa41ad0cb7c293d253dcd2188a`. The four comparison metrics above were not rerun for that interior-only adjustment.

The Node lifecycle tests cover constructor failures, late rejected loads, context loss, abort signals and persisted hide/show cycles. They do not prove that a particular browser chose to retain a page in BFCache. The historical Chrome WebGL context-loss cause remains unproven; the lifecycle fixes must not be described as its root-cause fix.

Mobile captures are desktop responsive emulation, not measurements from an actual phone. The deterministic movement controls exist only in the opt-in QA build and hold normal navigation input; they do not assign positions or award progress. The production verifier rejects those diagnostic strings.

Matched visual results and the final live-browser record are stored alongside this document. All images are direct WebGL or browser captures, with no image enhancement.

## Browser checks

The lab was walked through all four gates using normal navigation and collision handling. A wrong all-zero mixture was rejected without awarding progress; yellow, cyan and white recipes completed the three experiments and earned the stamp. Reloading retained experiment progress while requiring a fresh physical visit. Switching back to the Robson trail removed the lab HUD and restored the normal walking objective.

The final responsive layout was operated at 390×844 portrait and 844×390 landscape. The landscape mixer exposes both previews, all three sliders and the test/close actions without scrolling; explanatory notes remain below. [Portrait](mobile-lab-portrait.png), [landscape](mobile-lab-landscape.png), [completed stamp](lab-stamp.png). These captures use the matched-capture source fingerprint above.

The final source also passed another complete four-gate visit and all three recipes. Its third-person view confirms that the raised hanging sign no longer blocks the physical RGB screen. [Final physical exhibit](lab-exhibit.png). Browser warning/error logs were empty for that run. A fresh production-export page loaded the city, restored all three completed experiments and the permanent stamp, and contained no QA controls; its warning/error log was also empty. [Production passport](production-passport.png), [validation record](validation.json).

## Next work

Continue concentrating authored street detail and interactions in playable corridors. Next candidates are a distinct Waterfront/SeaBus activity, more varied facade and ground transitions, and local character interactions. Existing short street-frame measurements remain well below 60 FPS, so profile CPU and multipass render cost before adding city-wide population or lighting.
