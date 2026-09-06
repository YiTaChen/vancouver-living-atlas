# Stage 8 — Convention Centre, BC Place, Harbour Centre and Vancouver House

Original procedural exterior refinements retain source placement, roof/tower heights, collision footprints and the surrounding terrain. Shared resolved plans use actual final ground once for High and Ultra. No third-party model, photograph texture or new interior-navigation feature is added.

| Landmark | Refinement | High / Ultra triangles | Material meshes |
| --- | --- | ---: | ---: |
| Convention Centre West | Deeper timber/glass interfaces, recessed promenade doors, soffit damper panels | 18,208 / 52,231 | 12 / 12 |
| BC Place | Saddle-shaped ETFE facade, frit/joints, recessed supported entry bays | 21,756 / 60,036 | 10 / 10 |
| Harbour Centre | Recessed masonry windows and supported doorways in the historic podium | 16,974 / 46,946 | 8 / 8 |
| Vancouver House | Layered white balcony frames, recessed glazing and muted copper-colour linings | 19,872 / 40,810 | 6 / 7 |

These are geometry counts, not total rendered triangles across beauty, shadow and AO passes. Vancouver House replaces the previous inline model rather than duplicating it. It retains the original 49-floor envelope, 156.85 m model height and approximate rectangular podium; its real triangular base is not claimed to have been reconstructed in this pass.

## Ground and preserved form

BC Place opens eight of 24 model candidates (2 and 12–18). A 3 × 3 sample grid checks the complete 6.6 m opening and 2.02 m recess, rejecting missing support, excess relief/intrusion/drop or insufficient headroom. Sixteen candidates remain solid. These are model candidates, not surveyed public gate locations or accessible-route promises. Roof sectors, masts, cables and the field retain their geometry.

Harbour opens two of three candidate bays only after actual six-point ground support; the rejected bay retains its lower wall. Its original 17.964776 m model base and 177 m height remain. Revised trims contract the X/Z bound by 2.5 cm at High and at most 14 cm at Ultra within the existing footprint.

Convention doors use the exact original lower platform top at world Y4.8 m, with threshold Y4.82 m. The separate upper slab and underwater habitat shelves never serve as entrance ground. Original concrete, roof meadow/gravel/LED geometry and all 12 material batches remain. Four doorway candidates receive recesses; the platform is not regraded.

The archived actual-ground audit predates the geographically disjoint Stage 6 repairs. Runtime always samples the final scene; no audit JSON is used as permanently baked ground truth. Missing ground retains a closed facade. Medium and Ultra reuse the same placement and ground plan.

## References and limits

- [LMN Architects](https://lmnarchitects.com/lmn-research/how-vancouver-greened-its-waterfront) supports the Convention Centre timber, operable facade, soffit and habitat-skirt language.
- [Structural membrane engineering paper](https://doi.org/10.1016/j.proeng.2016.08.007) describes BC Place's single-layer saddle-shaped ETFE facade; [ETS](https://ets-na.com/projects/bc-place-stadium/) distinguishes its roof fabric and perimeter closure. The facade is not modeled as inflated cushions.
- [RDH's Spencer Building rehabilitation](https://www.rdh.com/our-case-studies/the-spencer-building/) supplies the masonry, cast-stone and sash language for the Harbour podium. Decorative dimensions remain interpretations.
- [BIG](https://big.dk/projects/vancouver-house-missing-pictures-7130), [DIALOG](https://dialogdesign.ca/projects/vancouver-house/) and [Westbank](https://westbankcorp.com/body-of-work/vancouver-house) inform Vancouver House's staggered balconies and constrained tower form. Recess dimensions and lining colours are interpreted within the existing model envelope.

Research imagery remains outside production assets. These improvements increase recognizable depth and material differentiation; they are not surveyed reconstruction drawings.

## Validation and measured transition baseline

All 268 canonical regression tests and the TypeScript check pass. Tests cover actual aperture raycasts, conservative support/headroom rejection, finite geometry, retained placement/envelope/roof contracts, deterministic resolved plans, and material/night/LOD lifecycle. The local build records final runtime ground plans in its capabilities report, separately from the earlier CPU audit.

The first two near cameras were obstructed by neighbouring buildings. They were moved along the exterior street and rerun; final same-name captures replace those unsuitable camera samples. Convention and House retain their original QA poses. Source fingerprints identify the specific QA build; production landmark geometry is unchanged between the two camera passes.

A fresh-engine BC entry cold-Ultra sample starts the observer before the quality change, without a discarded warm-up. It records a **1,669.9 ms first frame gap**. All seven Ultra factories execute synchronously (about 53–251 ms each), while two Ultra models actually submit rendering in this view. This is a reproducible Stage 9 performance defect, not a claim that the transition is smooth. Frame submission does not prove pixels are unobscured, so the separate captured view is also reviewed.

One visible fresh-engine startup reaches the next frame opportunity after interactive eligibility in 18.49 s. Major synchronous wall-time spans: bridge approaches 6.12 s, roads 3.32 s, ground harmonization 1.87 s, initial city frame 1.02 s. These are CPU-facing elapsed times that may include driver waits, not isolated GPU durations; fresh engine does not imply an empty HTTP or shader cache.

| Fixed near view | High FPS / p95 ms | Ultra FPS / p95 ms |
| --- | ---: | ---: |
| BC entry | 50.9 / 33.4 | 30.5 / 35.1 |
| Harbour entry | 37.5 / 34.4 | 23.0 / 51.3 |
| Convention entry | 38.9 / 33.8 | 24.6 / 50.9 |
| House balconies | 30.4 / 34.4 | 19.7 / 65.0 |

Eight-second samples follow 2.5 seconds of setup, on AMD Radeon Pro 560X, 1920 × 1080 viewport, DPR 1. High renders 1788 × 1006; Ultra renders 2560 × 1440. BC High records one 100.4 ms frame, and Convention Ultra one 150.2 ms frame; all other warm samples have no >100 ms frames. This preserves observed spikes instead of hiding them behind average FPS.

Day, dusk and night captures show the BC membrane/roof, Convention timber/glazing, Harbour recessed bays and House balcony/lining materials. No browser warning or error was logged. The ordinary neighbouring buildings remain in the views; camera framing does not delete them. The House podium remains the explicitly documented approximation.

[Actual captures, cold transition, startup and frame measurements](../stage-8-landmarks/README.md). The normal Firebase build is verified separately; no local QA controls or timing recorder is included in the production bundle.
