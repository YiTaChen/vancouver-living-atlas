# Stage 7 — Marine Building, Science World and Canada Place

Three original procedural landmark refinements improve near views while retaining their mapped placement, collision footprints and characteristic roof/tower forms. No downloaded model or photographic production texture is used. High and Ultra share the same resolved ground facts; Ultra adds geometric detail rather than moving the building.

| Landmark | Visible changes | High / Ultra triangles | Material meshes |
| --- | --- | ---: | ---: |
| Marine Building | Terracotta arch bands, bronze transom/grille, recessed doors and a real opening through the former solid base shell | 9,692 / 45,480 | 12 / 13 |
| Science World | Recessed glazing, steel canopy beams/connections, ground-seated footplates, drainage pipes and painted-panel joints | 20,930 / 82,122 | 17 / 20 |
| Canada Place | Recessed gallery/atrium glazing, deeper frames and soffits; restrained membrane weave, seam tape and backlighting | 18,396 / 68,782 | 13 / 15 |

Counts describe model geometry before shadow/AO/beauty passes. The Marine Ultra model exceeds the earlier 40k tower target; its original upper architecture is retained. No extra postprocessing pass is introduced. Opaque PBR glazing depicts the exterior; these visual doorway recesses do not add navigable building interiors.

## Actual ground and retained datums

Landmark creation now follows Nature and Stage 6 ground harmonization. A small ground index samples only explicit, unprotected terrain/road walk surfaces; it excludes buildings, roofs, water and bridge decks. Structured-cloneable plans capture the final heights once for both levels of detail and the later worker integration.

Marine retains base Y14.22 and yaw .77. Three actual samples across its 5.10 m doorway set the threshold to local1.84268/world16.06268 m, 15 mm above the highest edge. An earlier DEM-plus-sidewalk estimate would have floated about1.67 m above the actual centre. There is no rendered sidewalk at the exact opening, and ground falls0.362 m across it; the retained flat threshold consequently has a step on its lower side. This pass adds no unverified access ramp or claim of an accessible entrance.

Science retains base3.4, the existing podium top4.4 world, threshold4.42 and canopy soffit7.55. Its four support feet and two pipes sample actual final triangles, rather than a guessed sidewalk height. The entrance remains on the existing raised podium. Its steelwork is an architectural interpretation, not a relocation of the separately documented west addition.

Canada retains base3.5, yaw−1.073 and pier deck4.8 world. No terrain sample is used over water. The original concrete pier, piles, five sails, cables, seam paths and solid water footprints remain. The membrane shader changes lighting/normal/roughness only, never geometry displacement; its inexpensive back-light approximation is not a physical transmission solver.

The Marine tower, Science dome and Canada sail heights remain; newly added details change Marine max Z by about2.6cm and retract the Science canopy min Z by about2.6cm. These are not claims that every vertex or complete bound stays identical.

## Sources and interpretation

Marine's material and entrance language follow the [City facade-conservation attachment](https://council.vancouver.ca/20250506/documents/r6.pdf), [Vancouver Heritage Foundation inventory](https://www.heritagesitefinder.ca/location/355-385-burrard-st-vancouver-bc) and the [SEABC/IABSE structural guide](https://seabc.ca/wordpress/files/notable_structures/Vancouver_Notable_Structures_IABSE_SEABC_2017.pdf). Arch dimensions, relief motifs and precise doorway offset are original interpretations, not restoration drawings.

Science World's steel/glass treatment draws on the [structural engineer's renewal account](https://www.bushbohlman.com/projects/science-world-renewal/) and the same structural guide. Canada Place's membrane category follows [Birdair](https://www.birdair.com/birdair-inc-selected-to-retrofit-canada-places-iconic-sail-roof/) and [Geiger Engineers](https://www.geigerengineers.com/project/1532566774373/canada-place-roof-replacement). Source photographs remain research references outside production assets. New glazing depths, fixtures and panel sizes are interpreted within the original envelopes.


## Validation

All 260 canonical regression tests pass, including portable tests of transformed ground sampling, finite/complete plans, original placements/footprints/roof heights, Marine aperture rays through the former eight-metre seam, deterministic serialization and night/LOD registration. The existing harbour collision fixture now provides explicit small test-only ground planes for entry resolution; these are not real terrain evidence. Both modified material hooks compiled in the actual WebGL renderer without warnings or errors. Formal frame-time samples and day/night captures are archived separately below.

The captured actual-ground plan evidence was made before the geographically disjoint Stage 6 repairs; runtime always resolves the final scene again. The three recorded anchors are outside those repairs. The initial close-view captures and subsequent timing run differ only in local QA camera cases (the pier camera was moved outside the deck and an open-water travel case added); each JSON retains its exact source fingerprint. No production geometry changed between those captures.


| Fixed close view | High FPS / p95 ms | Ultra FPS / p95 ms |
| --- | ---: | ---: |
| Marine entry | 31.7 / 34.8 | 19.9 / 65.3 |
| Science entry | 53.1 / 33.2 | 31.2 / 34.9 |
| Canada gallery | 34.5 / 34.9 | 23.5 / 51.3 |

Each sample uses eight seconds after a 2.5-second warm-up at the same 1920 × 1080 viewport on AMD Radeon Pro 560X. Physical render sizes are 1788 × 1006 High and 2560 × 1440 Ultra. None of these six samples has a frame above100ms. These are warm-view timings; they do not prove that the existing synchronous first-Ultra build is smooth. That transition is a separate Stage 9 target. Existing screen-space ambient occlusion also leaves a visible grid pattern on some light surfaces; the Stage 9 comparison will isolate that effect before changing it.


A separate 60-second open-harbour run uses the actual boat controller with forward input from longitude −123.120, latitude 49.296, heading east. It travels 372.8 m, with a 61-point position trace, averaging 60.0 FPS (p95 17.9 ms, maximum 18.8 ms; no frames over 50 ms). This route avoids the existing Coal Harbour dock collision seen in Stage 6. It demonstrates sustained open-water movement, not passage through docks or land.

[Actual captures and measurements](../stage-7-landmarks/README.md) retain render dimensions and visibility validity. Browser DPR is 1 in this session; the renderer's physical pixel budgets remain the same as earlier measurements. Normal Firebase build verification confirms the QA laboratory is excluded.
