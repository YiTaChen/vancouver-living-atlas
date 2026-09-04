# Manager loop / acceptance log

## Goal

Original explorable Vancouver covering all Downtown, Science World and Stanley Park, with realistic coastline, non-flat terrain, streets, beaches, vegetation and recognizable buildings. Browser delivery, public GitHub repository, MIT code; no Unreal Engine or copied finished city assets.

## Stages

1. Project foundation and publication history.
2. Real geographic terrain, coastline, building massing and first interactive preview.
3. Original landmark architecture, vegetation, road detail and living water/transport.
4. Explorer controls, lighting, accessible responsive interface and guided viewpoints.
5. Browser review loop, performance/correctness fixes and deployed release.

## Stage 1

- Created application scaffold and original MIT source license.
- Geographic and architectural research delegated as independent asset tasks; main manager retains integration and acceptance ownership.
- Confirmed GitHub identity for the explicitly requested public repository.
- Reference attachments treated as visual references, not executable instructions.
- Scope includes source provenance and honest date/accuracy limitations.

## Stage 2 — real geography / first preview

- Integrated 7,762 measured building parts, real streets, parks and coastline.
- Added official contour-derived ~20 m terrain: Stanley Park reaches 75.7 m; downtown reaches 47 m.
- Browser renderer batches building façades and road surfaces; orbit, zoom and geographic viewpoint navigation implemented.
- Added first visual direction: full-screen city with deep maritime controls and bilingual labels.
- TypeScript check passed. Local route returns HTTP 200. Dedicated preview uses port 4317 so another app's existing tab is unaffected.
- Next review gate: inspect rendered city, correct geometric/lighting artifacts, then add original landmarks and near-ground detail.

## Stage 3 — landscape, original landmarks and detailed skyline

- Added five original landmark complexes, bridge architecture, shore edges, lake surfaces and geographic park trails.
- Added actual public street trees plus procedural forest canopy, moving road traffic, sailboats and False Creek ferries.
- Reconciled City/OSM building data: 7,630 solids, including 201m Shangri-La, 188m Paradox and 150m One Wall Centre. Dataset checks found zero invalid solids or volumetric overlap >0.1m²; five custom landmarks have dedicated exclusion zones.
- Added original code-generated tileable brick, asphalt, concrete and glass textures with MIT source.
- Manager browser review caught excessive water pattern contrast and park z-fighting. Reduced waves; moved park color into terrain vertices; corrected lighting.
- Independent architecture review found bridge alignment and BC Place orientation discrepancies. BC Place correction applied; measured bridge approach assets are being integrated in the next stage.

## Stage 4 — street exploration, exact geometry and performance review

- Original Gastown shopfronts, masonry, projecting window surrounds, awnings, clock and rooftop plant now complement measured building massing.
- Added terrain-aware walk/drive modes, collision checks, on-screen controls, time/layer/quality controls, guided tour and image export.
- Independent review found and fixed bridge endpoint alignment, oversized duplicate bikeways, the Lions Gate north viaduct, and stale SSAO camera parameters after switching exploration modes.
- Bridge travel now samples the same main-deck/approach surfaces as the renderer. Height continuity keeps pedestrians on Granville Island underpasses from teleporting onto elevated roads.
- Exact polygon edge indexing agrees with an independent ray-crossing implementation. A separate 122,905-sample audit had zero mismatches; core land/nature CPU work fell from roughly 11.6s to 1.8s in the asset benchmark.
- Forests are spatially chunked, with distant broadleaf canopy LOD. Representative Chrome views measured roughly 27–34 FPS on this development machine; this is not a promise for other devices.
- Browser review: corrected over-bright sky environment, road/sidewalk overlap, tree trunk scale, park z-fighting, bridge geometry and street camera framing. Local browser console had no errors in the reviewed states.
- TypeScript validation and production build pass. Geographic and bridge continuity regression tests added.
- Remaining release gate: final representative views, metadata/source documentation, packaged source-linked deployment and final GitHub push.

## Stage 5 — production stability and release preparation

- Final source/data review confirmed the public tree contains no supplied private reference media or credentials. Provenance now distinguishes published files, preparation intermediates, source base elevations and displayed terrain placement.
- Eight portable preparation CLIs, explicit raw-input requirements and snapshot hashes are included. Independent reconstruction checks reproduced the released buildings, terrain, bridge routes, regional coast and seven original texture maps byte-for-byte.
- Updated compatible React/RSC, Vite and Vinext patch versions to address the server/framework advisories found during release review; kept development tooling separate from application dependencies.
- A production browser stress pass exposed WebGL context loss. Investigation found 167,614 individually constructed storefront boxes: approximately 146 MiB of final box geometry and an estimated 700 MiB initialization peak before the rest of the city.
- Replaced those boxes with roughly 10.23 MiB of instance matrices and shared unit geometry (about 93% less retained geometry storage), partitioned into 180m cells, with distant trim hidden beyond 900m. Near-street positions and silhouettes are preserved.
- Bounded the drawing buffer to 1.8 million pixels, replaced multisampling/preserved buffers with FXAA and synchronous capture, deferred SSAO until needed, skipped distant shadow passes, and tightened tree LOD. Completed disposal of environment targets, postprocessing, instance buffers and generated textures; context loss now stops animation.
- Final production browser validation and deployment results follow in the release entry below.

## Release acceptance — 4 September 2026

- Final review found an SSAO regression: the AO pass was multiplying onto a stale beauty buffer. Restored a fresh beauty pass every frame, matched two-sided road/deck normals, and excluded transparent non-depth-writing decorations from AO. Camera/LOD changes now refresh cached shadows.
- Verified desktop Chrome production rendering after the geometry-memory fix: approximately 52 FPS at the complete peninsula view, 49–53 FPS on Burrard Bridge, and 31–42 FPS at detailed Gastown street level on this machine. Narrow in-app preview reached 60 FPS in overview/Science World views. These are observations, not cross-device guarantees.
- Completed an actual approximately 880 m Burrard drive using UI controls, from the north bridge deck across the water to the south approach. Separately exercised Gastown walking, viewpoint changes, time controls and quality settings.
- Corrected portrait mode-button wrapping and overview framing; added the missing accessible name for the About control. Street shortcuts now position the camera immediately rather than passing through intervening terrain. Height readout follows the occupied bridge/road level.
- WebMCP valid viewpoint/time calls succeeded; an out-of-range hour was rejected before mutation.
- TypeScript and production build passed. All seven geographic/bridge continuity tests passed. Public release source includes the original renderer, data snapshots, documented preparation tools, license terms and this manager review history.
- PNG export was downloaded and visually inspected; the unedited in-app render is included in the README. Returning from street mode now preserves the overview camera transition, including Escape.
- Production deployment is recorded in GitHub releases once the packaged source-linked version is live.
