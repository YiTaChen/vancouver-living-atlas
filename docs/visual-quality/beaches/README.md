# Second Beach and Third Beach: shared coastal terrain

Stage 5 replaces the raised flat sand overlays with a local graded surface shared by rendering, walking, map placement and boat draft collision. The original city terrain remains outside the affected source triangles. Both beaches retain their original source polygons; wet and dry sand follow the same mapped shore used by the water boundary.

## Scope

The height/grading domain is the two source beach polygons plus a 12 m blending collar, approximately 99,061 m². The original City land outline extended seaward beyond those sand profiles. To avoid leaving dry terrain beyond submerged sand, the update removes one complete connected City-minus-OSM shoreline difference component, approximately 272,680 m², reconnecting at source intersections. This also corrects part of Stanley Park's coast and English Bay; it adds no land and overlaps no source building footprint.

The wider correction preserves the existing elevated bridges. Eighteen actual ground-pavement footprints that overhang the reconciled northern coast remain solid boat obstacles. Coastal source disagreements at those ground roads are visible in the QA views; they are not silently removed or treated as navigable water.

The first terrain mesh now contains the final sand triangles, so existing map placement can pick the beach. Thirty-four affected source paths are clipped to dry land, draped to the actual sand plane and blended back to the unchanged distant paths. Original Second/Third Beach overlays and their raised grey shoreline strips are removed. Other beaches retain their existing display style, clipped to the reconciled land where relevant.

## Movement and validation

The [CPU travel report](travel-audit.json) replays the actual walking controller and boat physics. Walking stops at the shared wet boundary with feet 2 cm above the rendered surface. Boats approaching the two beaches stop while their whole hull remains in permitted water; a centre-only test would miss shallow ground touching the vessel's sides. These results use the existing momentum and steering simulation, not a special beach movement animation.

`node tools/audit-beaches.mjs --output /tmp/beach-travel.json` reproduces those cases. The [geometry report](geometry-report.json) covers terrain replacement, path seams and shore-strip separation. `node --test tests/beach-integration.test.mjs` verifies independent GEOS land/water samples, source hashes, real Three triangle raycasts and full-hull depth checks. The unchanged Causeway is also checked with its complete 58-case navigation audit after coastal integration.

The [offline preparation scripts](../../../tools/beaches/README.md) rebuild the 4,966,687-byte asset byte-for-byte. Gzip size is approximately 719 KB. Terrain increases from 39,098 to 63,511 triangles; replacement paths contain 7,436 triangles in the existing merged path mesh. There are no extra terrain/path draw calls or runtime polygon-boolean dependencies.

Nine [actual browser captures and measurements](../stage-5-beaches/README.md) cover both aerial views, both walking views, a moving boat, three northern coastal source conflicts and Ultra Second Beach. At the recorded 1920 × 1080 viewport, High beach views measured 49.3–60.1 FPS; the approaching boat measured 32.6 FPS (p95 35.0 ms). Ultra Second Beach measured 29.1 FPS. No sample had a >100 ms interval; these short samples do not certify first-load or long-travel smoothness. The minimap clips park and sand fills to the same dry coastline. Browser warning/error logs were empty.

Validation: TypeScript passed, all 224 regression tests passed, the four actual beach travel cases passed and all 58 Causeway CPU travel cases still passed. Two test-only Engine method extractors were updated to include the new `rawElevation` dependency. The release build passed the Firebase QA-exclusion verifier.

The northern coast captures deliberately retain two unresolved first-pass defects for stage 6: City asphalt and OSM path planes intersect, and nearby fir crowns sample an excessively dark atlas pixel. These are visible defects, not shoreline accuracy claims. The 4 m sand mesh also retains a medium-detail colour transition at its inland edge.

## Sources and display assumptions

The beach footprints are [Third Beach way 86340253](https://www.openstreetmap.org/way/86340253) and [Second Beach way 86340255](https://www.openstreetmap.org/way/86340255). The shoreline reconciliation uses the [OSM coastline convention](https://wiki.openstreetmap.org/wiki/Tag:natural%3Dcoastline) and the project's [City shoreline dataset](https://opendata.vancouver.ca/explore/dataset/shoreline-2002/). Geographic derivatives retain © OpenStreetMap contributors / ODbL and City of Vancouver OGL; original geometry code is MIT.

The fixed 0.1 m sea level, sand grades, submerged profile and vessel draft allowance are illustrative display parameters, not measured tides, bathymetry or navigation guidance. Existing ocean water is opaque; this stage does not add underwater visibility or a tidal simulation. Source steps remain graded paths rather than individual stair treads. Sand and shoreline edge positions are geographic, but their materials remain a medium-detail representation.
