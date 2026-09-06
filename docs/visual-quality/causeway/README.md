# Stanley Park Causeway and Lions Gate approaches

Stage 4 connects the park road, five southern overpasses, the northern rise and Lions Gate's road and separated pathways. Original geographic centre lines remain in place. The visual mesh, map placement and movement now share the same physical top triangles and explicit floor identities.

## Changes

- Replaced the northern approach's roughly 13.2 m step with a continuous profile reaching the existing 65.95 m bridge asphalt. Its maximum fitted grade is 4.79%; the central terrain-following section remains unchanged outside its first 99.56 m southern joining window.
- Solved the southern approach graph with shared junction heights, continuous slopes capped at 6%, and open bridge slabs above existing lower paths. Trimmed only eight identified overlapping City source lines; surviving road fragments have unique graph IDs.
- Replaced the old 17 m main-bridge asphalt with an approximately 10.61–10.80 m display envelope derived from the original adjacent sidewalk coordinates. The original road axis, bridge body, towers and suspension cables remain. Removed duplicated tower crossmembers that previously cut through road height.
- Completed the east/west source paths, southern pedestrian entry and western bridge entry. East shared paths and designated main-bridge sidewalks support walking. The mapped west cycling-only Causeway remains visible but does not become an ordinary walking or driving surface.
- Added six sparse concrete columns beneath the western entry. The candidate over lower path 975314386 is deliberately omitted; no earth-fill wall blocks the lower paths.
- Protected upper floors use explicit ground gates and mapped shared-node connections. An underpass cannot jump to an upper road based on height proximity. Placement, local minimap and walking/driving transitions use the same routes and floor identities.
- Procedural forest fill keeps its full crown clear of the new road/path triangles. Municipal tree coordinates remain unchanged.

## Evidence and reproduction

`node tools/audit-causeway.mjs --output /tmp/causeway-audit.json` reproduces 58 bidirectional movement and connection checks using the canonical navigation controller, actual land/pavement/path meshes and exact slab/pylon geometry. It requires Node 24 and the project dependencies, and records source SHA-256 hashes; no external snapshot or browser automation is needed. The [final CPU report](navigation-and-geometry-audit.json) separates this from browser/FPS evidence.

`npm test` exercises the source/profile contracts, complete City road graph, pavement cuts, real triangle floor sampling and strict floor transitions. `npm run check` verifies TypeScript. The opt-in local QA build adds **Audit Causeway travel**, which replays source polylines through the real `StreetNavigation.move` collision controller; this is a geometry/movement diagnostic, not a realtime driving performance claim.

The [actual canonical triangle audit](canonical-path-mesh-report.json) verifies a minimum **3.3285 m** clearance between the new footbridge slab and unchanged lower-path triangles, and no main-sidewalk/rail intersection with the four bridge pylon boxes. The [support report](west-walk-support-proposal.json) records six 1 m diameter columns and the omitted lower-path crossing. Earlier profile-solving reports are retained alongside these final mesh checks and explicitly identify their assumptions.

Ground triangle lookup allows at most 0.5 mm of horizontal Float32 edge rounding at shared path caps. Floor identity and existing height tolerances are not relaxed. This addresses the western ground-entry source node falling into a submillimetre gap between independently rounded path triangles.

## References and limits

The Province's [2016 Causeway completion notice](https://news.gov.bc.ca/releases/2016TRAN0035-000287) and the [Park Board design report](https://parkboardmeetings.vancouver.ca/2015/20150323/REPORT_StanleyParkCausewaySafetyImprovements-2015-03-23.pdf) support the east/west pathway distinction. Darryl Matson's [TAC bridge engineering paper](https://www.tac-atc.ca/wp-content/uploads/Matson.pdf) documents the three traffic lanes and nominal/clear sidewalk dimensions.

Heights, fitted gradients, lane paint, slab thickness and support arrangement are display interpretations fitted to this project's terrain and source geometry, **not surveyed as-built engineering**. The centre terrain-following Causeway still includes steeper source terrain; this update does not certify a uniform grade along the whole route. Northern sidewalk terminals stop at the supplied source endpoints instead of inventing a connection to off-map ground.

New code is original MIT. City data retains the [Open Government Licence](https://opendata.vancouver.ca/pages/licence/); geographic derivatives retain [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Source node IDs, tags and provenance accompany the compact JSON files.

## Final browser sample

[Seven actual captures and frame-time reports](../stage-4-causeway/README.md) use the same 1920 × 1080 High/Ultra presets as earlier stages. High Causeway views measure 43.2–49.7 FPS, the open main bridge 60.0 FPS, and the Robson driving regression 34.2 FPS; none of these short samples has a >100 ms interval. Ultra Causeway remains 20.1 FPS and is not presented as a smooth High-equivalent mode. Reports include the actual visual-source fingerprint as well as the parent Git revision.

The public Robson quick start and Drive → Walk switch were also checked through the UI: the local minimap stayed at 49.28395, −123.12381, without re-placement. These checks do not certify every possible drag/drop location.

Known integration follow-ups for stage 6: coarse land triangles locally cut into lower ground pavement, and existing conifer card materials reveal dark rectangles in the western-entry view. Neither is concealed by the archived captures; the protected bridge surfaces and lower route heights remain independently validated.

Validation: all **214** project tests and TypeScript pass; the portable CPU audit passes all **58** movement cases, geometry and permission checks. The final instrumented browser audit passes and reports no new warning/error logs.
