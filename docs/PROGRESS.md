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

## Language release / Firebase preparation

- Added English (default), Canadian French, Spanish, Traditional Chinese and Simplified Chinese. Each locale contains the same 110 messages and placeholders.
- Localized controls, viewpoint names/descriptions, in-scene labels, notifications, loading/errors, About content, accessible names, document language/title/description and numeric readouts. The language selector preserves camera and exploration state; an explicit selection is remembered locally.
- Reused the existing Select component and adapted long translated labels to compact layouts. Original street names, branding and source-license names remain proper nouns.
- Added a Firebase static-export build that ships only browser assets. No Functions, database, server credentials or billing-dependent runtime is required by this app.
- TypeScript, eleven geography/localization tests, static export and HTTP checks for the entrypoint and its ten linked assets pass. The user explicitly approved creating and deploying to the dedicated Firebase project `vancouver-living-atlas-yita`, which has been created successfully.
- Deployed publicly to https://vancouver-living-atlas-yita.web.app on 2026-09-04 (Hosting version `aa770ce472d9d9cc`). The live English entrypoint returned HTTP 200, and all 49 published HTML, JavaScript, CSS, geographic-data, image and font files matched the verified build by SHA-256.
- Independent code review found no material issues in language persistence, asynchronous label updates, scene preservation or static-export localization. No browser interaction or screenshot review was performed for this language-only release.

## Precise walk / drive placement

- Integrated drag handles into the existing Walk/Drive mode choices. Users can drag a figure onto the main map, or choose a mode, adjust/zoom the view and click a starting point. A preview marker, coordinates, ground/deck height and road-snap distance precede entry. Existing named quick starts remain explicit options; street controls can reopen placement near the current location.
- Picking uses camera rays against the rendered terrain and a separate bridge-deck mesh. Walking preserves ground coordinates; driving uses nearest points on complete road segments (including short segments), with a 4–30 m snap radius that tightens as the map is enlarged. Invalid placement leaves navigation unchanged.
- Added inland-lake and conservative landmark-footprint exclusion to ground navigation, retaining source IDs and the original OSM-derived footprint attribution. The landmark masks have the documented 2 m source buffer; this is still simplified navigation, not a pedestrian-access or drivable-lane survey.
- Independent review identified and prompted fixes for multi-touch figure drops and old bridge-height state influencing new starts. Surface identity now survives placement and idle frames; new road quick starts are validated independently of the old position.
- TypeScript and 24 geography, localization, ray-picking, pointer-gesture and navigation tests pass. Tests exercise the actual placement/navigation methods with Three.js camera math and in-memory event surfaces, including keyboard activation without accidental driving input; no browser interaction or screenshot review was performed for this update.
- Published to the existing Firebase URL https://vancouver-living-atlas-yita.web.app (Hosting version `0562538285a12acb`). All 49 published static files match the final verified build by SHA-256. Source and review fixes were committed and pushed in separate stages.

## Street movement input regression fix

- Reproduced the reported failure: the previous keyboard guard suppressed every movement key when an ordinary button/link or mode radio retained focus. A new regression test failed before the fix with zero walking distance after a HUD click.
- Narrowed the guard to preserve text-entry, dialog and selector interactions, button Space activation and browser shortcuts while allowing WASD after ordinary HUD interaction. Canvas pointer input and on-screen movement buttons restore map focus. Movement uses physical key codes, with a key fallback, so an active input method does not turn WASD into unrecognized `Process` keys.
- All 28 automated tests and TypeScript pass. Independent execution with the full geographic data verified six street/mode combinations with button-focused W, six with canvas-focused W, six on-screen movement actions, eight bridge/mode combinations and 326 valid dropped starts. Every sampled valid start could move. These are code-level movement checks with actual geographic data, not browser UI checks.
- Deployed to the existing Firebase URL as Hosting version `44dd760def13a676`. All 49 published static files matched the final verified build. The input fix and its deployment record were committed and pushed separately.

## Independent flowing time

- Split the clock into its own toolbar button and panel, with a live HH:mm readout, time-flow switch, minute-resolution time selection, existing daypart presets and 1×/10×/30×/60×/120×/300× rates. The default is running at 30× from 16:00: a full cycle takes 48 real minutes. All five UI languages include the new controls.
- The engine-owned monotonic clock is separate from navigation/layer settings. Pausing, speed changes and explicit seeks are partial commands; switching modes, layers or language cannot reset time. Hidden tabs suspend scene time without catching up on return. Midnight solar direction is continuous.
- Lighting updates at most ten times per second; solar shadow refresh requires at least two simulated minutes of movement and 750 ms between refreshes. This avoids resizing render targets or resetting navigation on clock ticks. Walking, driving, traffic and water keep their real-time animation rates.
- Time and language selector popups restore canvas focus in street mode, using the installed Base UI finalFocus API. Text entry and open selectors keep normal keyboard behavior.
- TypeScript and all 40 automated checks pass, including default flow, all rates, midnight, fix/resume, manual seek, hidden tabs, stale/out-of-order timestamps, scene-mode independence, shadow anchoring and throttling, and the existing movement/placement regressions. Independent code review covered clock state, lighting and focus integration. No browser interaction or screenshot review was performed for this update.
- Deployed to the existing Firebase URL as Hosting version `1c2bf3877cd50892`. All 49 published static files matched the final verified build by SHA-256. The feature and deployment record were committed and pushed separately.

## Optional toolbar time display

- Added a “Hide time” switch to the Time panel in all five languages. It starts off, so the toolbar time remains visible by default. Enabling it hides the numeric time and time-bearing tooltip while keeping the clock button available to reopen the panel and restore the display.
- Visibility is UI-only state: changing it leaves time flow, fixed time, speed, navigation and the panel’s editable time readout unchanged. The icon-only button uses the existing toolbar size on desktop and mobile.
- TypeScript and all 40 existing automated checks pass; no new tests were added for this small presentation preference. No browser interaction or screenshot review was performed.
- Independent static review found no material issues. The production build passed and was deployed as Firebase Hosting version `4db5bc51999fad58`; all 49 published files matched the verified build by SHA-256. Source and deployment history were committed and pushed in separate stages.

## Moving railways and white steam

- Added three original train sets on source-mapped routes: a steam locomotive with tender and four coaches along 1.12 km of Waterfront–Gastown railway, and two opposing four-car electric SkyTrains on 855/894 m of elevated Expo track. Original rail, sleeper, ballast and pier meshes follow the same route sampling as the stock.
- Kept steam emissions distinct from electric SkyTrain. A bounded 96-instance world-space plume rises, drifts, expands and fades; time-of-day controls do not accelerate or stop trains. Cars maintain metre-based offsets, axles follow bends/grades, and complete consists leave the cropped open route before re-entry.
- Added default-on Trains layer, two railway viewpoints and Find buttons in all five languages. Find exits street placement safely and can reveal the next service if the entire consist is outside the displayed route.
- Independent review prompted dynamic depth/AO exclusion during endpoint fading, corrected wheel alignment, and off-scene focus handling. Source review trimmed station canopies and building passages instead of modifying buildings or lifting trains above them. All 2,804 sampled conservative body poses clear the final building footprints; SkyTrain envelope checks using actual rendered heights also pass.
- TypeScript and 50 automated checks pass, including ten rail-specific checks plus the existing movement, placement, clock, geographic and locale coverage. No browser interaction, screenshot or GPU benchmark was performed. Original train models and app code remain MIT; geographic rail records retain ODbL attribution.
- Published to the existing Firebase URL as Hosting version `3f4c54b4f7c7533c`. All 50 published static files matched the final verified build by SHA-256. Source data, implementation, ten-viewpoint localization and deployment records were committed and pushed in separate stages.

## Harbour traffic and boat navigation

- Added original helicopter, floatplane, cruise ship and 48 moored private yachts at source-mapped facilities near Canada Place, Coal Harbour and Bayshore. Three original near-port paths represent verified Victoria/Nanaimo air services and an Alaska/Inside Passage cruise exit through First Narrows. The on-screen note identifies paths and timing as illustrative. Aircraft animate rotors/propellers; departing craft fade at the displayed route boundary and return along the local demonstration path.
- Replaced the old arbitrary boat circles with harbour launches whose complete loops clear the mapped shoreline and piers. Source pier meshes, grounded landmark decks and bridge columns share collision footprints with water navigation. Moving models avoid stale cached shadows. A default-on harbour layer, close-range detail thresholds, a harbour viewpoint and three Find controls are translated into all five languages.
- Added Boat immediately after Drive. Drag its icon to visible sea/lake water or select a precise water point; invalid land, docks and occluded points are rejected. Quick starts include Coal Harbour, False Creek and Lost Lagoon. WASD and held on-screen controls operate throttle/reverse and speed-dependent rudder; releasing throttle coasts, Space selects neutral, and drag-look moves the camera independently of the helm. The camera shortens its chase distance at banks, including regional shores.
- Boat motion uses bounded 120 Hz substeps, longitudinal momentum, lateral drag, delayed throttle/rudder response, a complete hull capsule and stable water-body IDs. A bounded subdivided sea patch shares its wave function/time with hull heave, pitch and roll; lake ripples are much smaller. Foam wakes fade astern. Original application code/models remain MIT; mapped facilities retain ODbL attribution.
- Independent review verified 32,309 clear hull positions with zero perimeter leaks after fixing mixed-resolution coastline seams. The original 260 × 42 m cruise sweep clears all source piers, land and Canada Place deck; runtime interpolation also clears the rendered grounded landmark/bridge footprints. Tests cover physics at 30/60/120 FPS, coasting/reverse, complete-hull collisions, water-only placement and occlusion, mobile helm, calm lakes, moving actors, LOD, camera banks, wave uniforms and Find controls, alongside previous movement/time/rail tests. Browser interaction, screenshots and GPU benchmarking were not performed.
- TypeScript and all 65 automated checks passed for the five-language integration; the seven new simulation/control modules also pass targeted lint.
- Published as Firebase Hosting version `744cf38bf564f68c`. All 54 public files match the verified build by SHA-256. The canonical homepage now responds with `Cache-Control: no-cache`, while versioned assets retain long-lived caching. Research/assets, feature integration and hosting changes were committed and pushed separately.

## Walk / Drive switching in place

- Walk and Drive now switch directly at the current scene position, preserving heading, look pitch, ground/bridge layer and height. Switching clears held movement and speed, toggles the car, and uses the normal close street camera. It does not search for a road or enter orbit placement.
- Pointer/touch and keyboard mode selection share the same actual-navigation-state guard. Orbit entry, Boat transitions and an already active placement flow still require placement. Explicit street shortcuts and the Change location button keep their existing relocation behavior. In-scene Walk/Drive buttons no longer advertise dragging. Pointer selection restores canvas focus; keyboard radio selection keeps focus so successive arrows cannot inadvertently steer. Existing translations supply labels in all five languages.
- Regression coverage checks exact ground/bridge poses, Boat exclusions and both UI event paths, in addition to the previous 65 checks. No browser interaction or screenshot review was performed.
- TypeScript and all 68 automated checks pass, including pointer/keyboard routing and keyboard-focus preservation.
- Published as Firebase Hosting version `b30e3278ab5b98e4`; all 54 public files matched the verified build by SHA-256. Implementation and deployment records were committed and pushed.

## Landmark, tree and Ultra graphics upgrade — local, 2026-09-05

- Reconstructed Science World, Canada Place, BC Place, Harbour Centre, Marine Building and Convention Centre West using original, reference-informed geometry. All modes receive improved silhouettes; nearby Ultra adds structure, facade frames, roof details and night illumination. Duplicate generic building parts and rooftop equipment are excluded together.
- Added original generated foliage/bark images to branching 3D trees. Bounded instance pools replace nearby trees after texture readiness and restore the original distant instances when hidden, out of range, over capacity or on texture failure. Generic buildings gain better glazing and lazy, bounded nearby facade geometry using their original foundations.
- Added a five-language Ultra detail option under Layers → Visual quality, with actual render dimensions and FPS. High remains the default. Pixel budgets, shadow resolution and distance-based geometry provide explicit performance choices.
- TypeScript, all 75 automated tests and the local Firebase static build pass. Independent reviews prompted fixes for eager facade allocation, inconsistent foundations, shadow invalidation and tree coverage. Targeted lint passes; legacy full-repository lint findings remain outside this change.
- Real WebGL captures cover landmarks, trees and night lighting. The visible production browser passed five-language selection, Ultra switching, street movement and Walk/Drive switching in place. Four fixed 1080p viewport views measured High at 44–54 FPS and Ultra at 27–35 FPS on the local Radeon Pro 560X, with Ultra physically rendering at 2560 × 1440. Details and measurement limits are in `docs/visual-quality/QA.md`.
- Kept this upgrade on local branch `feature/ultra-landmarks`. No push, remote-main change or deployment was performed. Prior project-intro video artifacts were preserved.

## Following local minimap — local, 2026-09-05

- Replaced the one-time overview canvas in Walk, Drive and Boat with a north-up local map centred on the actual player position. A cyan arrow shows player/vehicle heading; boat free look and wave bobbing do not alter it. Orbit keeps the clickable peninsula overview and now marks the orbit target. Coordinate readouts use the player rather than the camera's look-ahead point.
- Added independent plus/minus controls, wheel zoom and focused-canvas plus/minus keys. The default map width is 800 m, with six levels from 200 m to 6.4 km. Zoom persists through travel-mode changes, never moves the player or 3D camera, and preserves browser Ctrl/Cmd shortcuts.
- Reused existing mapped roads, building footprints, park/beach polygons, inland water, regional coastline and solid piers. The core coastline overrides the regional map on the same boundary used by boat navigation. Named landmarks and lakes, street labels and a metric scale provide local context. Generic unnamed water features do not receive cluttering labels.
- Paths are projected once, clipped/culled to the viewport and redrawn at most ten times a second. Stationary or hidden maps skip drawing. The overlay shares the existing engine lifecycle; it adds no second WebGL renderer or animation loop. Canvas backing dimensions follow CSS size at 2× so mobile labels and button exclusions retain their intended size.
- Independent review prompted fixes for browser zoom shortcuts, clean-mode CSS precedence and mobile canvas sizing. Actual Chrome checks covered walking and driving position changes, in-place switching, wheel zoom without position changes, boat free look, movement and lake relocation, plus phone layouts and clean-mode hiding. English, French, Spanish and both Chinese dictionaries include the controls.
- TypeScript, all 81 automated tests and the local Firebase static build pass. Six minimap tests cover heading conventions, true player/boat coordinates, zoom bounds, browser shortcuts, regional positions, coordinate inverse transforms, water holes, throttling, hidden-map recovery and responsive backing sizes. No push or deployment was performed; the work remains on the local feature branch.

## Street, architecture and coast release acceptance — 2026-09-06

Stages 1–9 were completed and pushed sequentially through `950a272`; their source references and capture reports are indexed in `docs/visual-quality/UPGRADE_TASKS.md`. Added original instanced Vancouver-style buses (`3b265e8`), then adopted the measured 300× default clock (`970e786`). The full 1080p comparison found High roughly 3.2% slower, Ultra essentially unchanged, with no >100 ms gaps in its eight windows.

Stage 10 reviewed 30 actual day/dusk/night captures and four actual 60-second walk/drive/boat runs. Continuous movement and geometry loading passed, with measured limits preserved: a 531.8 ms cold Ultra night pause and 20.4 FPS Ultra driving on the tested Radeon Pro 560X. This is not a zero-stutter certification. Public five-language and Time controls work; TypeScript, all 344 regression tests and normal static Firebase verification passed, including emitted worker initialization without Window/DOM and QA exclusion. README scene counts and the historical video description were updated. Full evidence: `docs/visual-quality/stage-10-final/README.md`.

Published the accepted application (`8527b39`) to the existing `vancouver-living-atlas-yita` Firebase Hosting site. All 58 public files matched the local verified build by SHA-256; online 3D loading and the 300× default were confirmed. The deployment record contains only public file paths, sizes and hashes.

## Stanley Park floating trail correction — 2026-09-06

Replaced the generic 1.5 m elevation offset for 577 eligible park trail parts with faces clipped against the actual terrain triangulation, using a 45 mm display clearance. Known bridges/coastal paths and source-owned Causeway connectors are preserved with conservative approach blending; raised portions can remain near those interfaces. There are no additional draws or per-frame ground queries. Actual walking-height captures, supported-floor statistics and the remaining limits are in `docs/visual-quality/park-paths/README.md`. TypeScript, all 346 tests and all 58 canonical Causeway movement checks passed.
