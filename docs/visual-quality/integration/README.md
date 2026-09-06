# Stage 6 — first-pass integration acceptance

This pass reconciles three bounded ground-layer conflicts visible in the Stage 5 captures, corrects foliage colour/white edge contamination, and checks actual public travel controls and sustained movement. It does not remodel the entire Stanley Park forest.

## Ground surfaces

City pavement is lowered only where it intersects an existing geographic path, with a 6 m smooth blend and 20 mm clearance beneath the unchanged path. The original seawall/rock strips receive the same downward-only repair in the two coastal scopes. Their original sea-facing XY and material remain. Coarse terrain is clipped only where it occludes a final ground surface in the three finite scopes. All Stage 5 physical beach-profile triangles, source path buffers, Causeway profiles, protected bridge decks and five ground gates remain unchanged.

The same final ground meshes now feed placement and walking. A terrain-only placement ray could otherwise miss a pavement after the grass underneath it was removed. Existing mesh objects/materials are retained; geometry is replaced and disposed before navigation indices are built. The correction adds no draw calls.

## Foliage

The Douglas fir solid-needle UV now samples green foliage from the original texture, instead of a nearly black patch. Leaf cards subtract the neutral matte from their RGB sample and use the estimated coverage for transparency; the depth material uses matching coverage. This removes the visible white needle fringe in actual day/night checks. It is an approximate cleanup of the existing RGB source, not a claim to recover its original alpha. The original tree geometry and texture images remain.

## Public-control checks

In the actual browser, Robson Drive and Walk moved and switched at the same coordinates. Zooming out revealed the walking avatar; zooming into Drive displayed the left-hand cockpit and Clear view control. The local minimap followed the actual position and its independent zoom worked. Exiting to the local map, then zooming back in without panning, resumed Drive at the identical coordinate (49.28405, -123.12397). Switching to Boat correctly required a water launch. These UI checks are separate from the instrumented controller samples.

## Validation and limitations

See the archived actual renderer captures/measurements and the portable ground audit below. Standard render measurements use eight seconds; the three sustained travel cases use sixty seconds of the real controller with forward input and record a position trace every second. Straight input may meet a road/shore obstacle; distance and collisions must be read from the trace, not described as a complete city tour.

A small pre-existing private-road outer edge beneath the south bridge has only 1.609 m of headroom at approximately [-123.136545, 49.297100]. It is outside the five verified lower crossings; this work does not invent a new underpass or excavate that edge. The five established crossings retain their validated clearance. Beach colour transitions still expose the existing 4 m terrain sampling, and Ultra remains more expensive than High on the test GPU. Broader loading/rendering work is Stage 9.


The seaward dark pavement still visible beside the beige coastal paths is preserved City geometry outside their coverage. City road polygons and OSM walking/cycling axes have different source widths; this pass removes vertical interference, not source-backed adjacent pavement. Material boundaries are illustrative, not surveyed. See [ground contract](GROUND.md).


## Measured result

[Seven timed samples and the Ultra night capture](../stage-6-integration/README.md) use the AMD Radeon Pro 560X at 1920 × 1080 viewport, DPR 2. High renders 1788 × 1006; Ultra renders 2560 × 1440.

| Actual sample | Travel | FPS | p95 / max frame ms | >100 ms |
| --- | ---: | ---: | ---: | ---: |
| Robson Drive, 60 s | 1,232.3 m | 35.2 | 35.0 / 99.8 | 0 |
| Robson Walk, 60 s | 240.0 m | 34.0 | 35.0 / 83.4 | 0 |
| Coal Harbour boat, 60 s | 7.44 m, then dock stop | 59.8 | 18.3 / 82.4 | 0 |
| North coast trail, High | Fixed | 54.4 | 33.0 / 34.3 | 0 |
| Northwest coast trail, High | Fixed | 51.0 | 33.7 / 34.5 | 0 |
| South underpass, High | Fixed | 46.7 | 33.9 / 34.6 | 0 |
| North coast trees, Ultra | Fixed | 21.5 | 51.4 / 65.3 | 0 |

The boat meets the existing dock after approximately four seconds. Its sixty-second sample confirms stopping/continued rendering, **not sixty seconds of unobstructed cruising**; release acceptance must use an additional open-water route. The public boat arrow is held for throttle, whereas a quick pointer click only provides input during the down/up interval. No boat-physics change was required here.

All 252 regression tests passed; the subsequently added overlapping-height shoreline regression passed too (253 cases now defined). TypeScript and the normal static Firebase build pass. The real canonical Causeway audit passes all 58 cases; beach walking/boat stopping passes all four cases. The [portable local-ground audit](ground-audit.json) verifies the three repairs and twenty lower-path/gate traversals. Day/Ultra/night browser logs contain no errors or warnings. These measurements support usable High on this device; the 21.5 FPS forest Ultra result remains a Stage 9 performance target.

Reproduce the CPU ground audit with `node tools/audit-ground-harmonization.mjs --output docs/visual-quality/integration/ground-audit.json`. The local QA procedure and build isolation are documented in [the task list](../UPGRADE_TASKS.md).
