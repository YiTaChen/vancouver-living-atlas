# Stage 6: bounded ground visibility and ground-plane reconciliation

Original procedural TypeScript; MIT. The final helpers are integrated in lib/city. This document records their bounded geometric contract and CPU evidence; browser evidence is archived separately.

The five runtime modules are frozen: `ground-visibility.ts`, `road-lowering.ts`, `ground-visibility-mesh.ts`, `ground-harmonization-scopes.ts`, and `shore-lowering.ts`. The latter uses the canonical source IDs **`OSM:{id}`** and **`coastal-paths`**. It selects three finite regions, without changing the coast, raw elevation, City source axes or upper-floor profiles.

## Runtime order and exact inputs

1. Complete Stage 5's `makeLand()`, City roads and `createNature()` first. The first terrain mesh must already include its original coarse land, reconciled coast outside fragments, and final physical beach profile.
2. Select only unprotected, actual City asphalt meshes for `applyRoadLowering`. Supply `e.data.groundPathSources` snapshots made **from the final Float32 geometries**, including the Stage 5 `pathPositions` prefix. Do not regenerate path corners from the DEM.
3. For each `groundHarmonizationScopes(project)` entry, select `groundPathSources` by exact `pathSourceIds` and call `applyRoadLowering(asphaltMeshes, selectedSources, scope)`. All selected source IDs must exist; an empty source selection should be a load error, not a silent success. All City chunks share one correction plan within each scope, preventing independent chunk seams.
4. After all City repairs, run `applyShoreLowering` for the two coastal scopes on exactly the two original Nature strip meshes. At their construction site mark `groundShoreSource = "measured-shoreline-strip"`, `groundShoreKind = "seawall" | "rock"`; the explicit `kind:"shore"` API rejects water, terrain, sand, asphalt and protected upper meshes. Append only `shoreGroundMeshes(validatedStripDescriptors)` to the final ground-cover list. Run `applyGroundVisibility` exactly once after all road and shore repairs. Pass only the City asphalt/sidewalk meshes and merged actual ground-path mesh from `e.roads`, with `walkSurface && !protectedSurface`. Do not pass the first terrain mesh itself, building tops, unmarked shoreline meshes, arbitrary sand overlays or protected bridge decks as cutters. The two guarded final Nature strips are explicitly allowed after the shore increment.
5. Set `options.regions = scopes.map(s => s.bounds)` and `options.bounds` to their overall bounding rectangle. Only the three regions can change; the large gaps between them remain identical.
6. Protect the physical beach profile's final triangle range. Before clipping, let `total = firstTerrain.geometry.getAttribute('position').count / 3`, `count = e.data.beachCoast.profilePositions.length / 9`; pass `[[total-count, total]]` as the fourth `applyGroundVisibility` argument. In current Stage 5 construction the physical profile is the last appended range. This does not use, change or invalidate the earlier `replaceTriangles` source keys.
7. Only then construct `roadSurface`, navigation's ground index, placement's ground pick set, street decoration and other caches. Root's `walkableGroundMeshes` selection includes actual visible ground meshes for placement; a terrain-only raycast would miss pavement after the grass underneath is clipped.

The adapter preserves each mesh object, material, user data, shadow settings and scene position. It disposes replaced geometry, retains UV/color interpolation, recomputes lowered pavement normals and geometry bounds, and adds **zero draw calls**. Terrain remains the first child.

## Geometric contract

The repair first finds exact City-road/path triangle intersections where asphalt reaches above `path Y - 0.02m`. Only these small intersections seed a correction. A six-metre, downward-only smoothstep blend rejoins the original road plane; its height change and derivative are zero at the perimeter. The correction never raises a source path or increases a ground ceiling.

A global 0.75m grid controls the blend tessellation. Exact source-path triangle boundaries partition that grid, so narrow paths cannot fall between sample points. Shared edge vertices are inserted into both sides before emission. Every triangle inside a path footprint is at or below its path plane minus the reserve; the post-Float32 actual audit minimum reserve is 0.0199485m. No road polygons, source centerlines or corridor widths are deleted.

Terrain clipping then subtracts only the original terrain portion which interferes with an actual final ground top. All retained terrain vertices interpolate on their original triangle planes, including their color/UV attributes. The original pavement geometry fills the clipped footprint. All upper surfaces are excluded twice: physical `level` and renderer `protectedSurface`.

The `focusBounds` of the two photo scopes select complete, small overlap islands. Their outer bounds leave room for the six-metre blend, avoiding a hard cut through an active correction. The helper throws if those bounds would truncate a blend.

## Verified CPU evidence

`ground-visibility.test.mjs`, `road-lowering.test.mjs` and `shore-lowering.test.mjs`: **28/28 pass** (14 + 9 + 5). Tests cover exact area conservation, upward winding, attribute interpolation, original outside vertices, overlapping cutters, finite task regions, protected beach/upper floors, no height increase, exact path clearance, zero perimeter derivative, conforming shared-edge heights, shoreline-only source guards, geographic scope guards and overlapping original shoreline planes. The shared-vertex key includes original plane height, so two shoreline sheets which overlap in XY cannot be accidentally welded upward. `strict-check.mjs` passes under the project's strict TypeScript options via a virtual source overlay; it never writes the checkout.

The portable **`audit-ground-harmonization.mjs`** installs in the canonical `tools/` directory beside `causeway-cpu.mjs` and `causeway-geometry-audit.mjs`. Run:

```sh
node tools/audit-ground-harmonization.mjs --output docs/ground-harmonization-cpu.json
```

`--output` is mandatory; only that explicit JSON is written and its parent directory must already exist. Optional `--root` selects a canonical checkout. The audit has no `work/` imports, prototype loader, outside snapshot or remote dependency. It uses `createFixture({harmonize:false})`, the canonical helpers, the fixture's two existing marked shoreline strips (never a second copy), and the same repair order as runtime. It validates actual geometry and real `StreetNavigation.move`, then exits nonzero on failure.

The portable test ran from a separate local test directory against canonical tools and passed with **63 source SHA256 records**, including actual source data and the current Nature strip constructor. No browser, WebGL, GPU, remote API or new package is required. `portable-report.json` is the frozen verified report; earlier `lowering-report.json` / `audit-lowering.mjs` are development artifacts and need not ship.

Latest actual results:

| Region | Triggering positive-overlap area | Largest local drop | Original triangles refined | Additional road triangles |
|---|---:|---:|---:|---:|
| Causeway lower crossings | 0.917m² (`648864806`) | 0.483491m | 45 | 354 |
| North coast | 75.252m² (`381179591`) + 29.428m² (`863811845`) | 0.628390m | 45 across two chunks | 4,413 |
| Northwest coast | 95.080m² (final Stage 5 paths) | 0.463883m | 53 | 4,104 |

All four affected City chunks retain their exact original plan area. Before Float32 quantization their largest shared-vertex height discrepancy is less than 4e-9m. The final terrain operation, including the guarded shore increment, changes 107 original triangles, removes 1,927.467m² of actual occlusion, and changes 63,511 terrain triangles to 65,403. City pavement adds 8,871 triangles, shoreline strips add 12,155, and terrain adds 1,892: **22,918 additional triangles total**, with no extra materials, meshes or draw calls.

The second exact cut audit of final Float32 output finds 0.016427m² of total residual edge slivers across the three regions. Looking only at the maximum height at such a tiny rounded overlap would be misleading: these are very thin quantization edges. The double-precision cut itself conserves each original triangle's area within 2.18e-9m².

All supplied source path buffers and protected upper meshes hash identically before/after. Causeway road/path profiles hash identically. All five explicit ground gate heights have exactly zero difference. Lower paths both directions and all gates both directions pass **20/20 actual movement checks**. Visible-ground sampling at path centroids has no floor below the path (numerical error less than 1e-14m). The retained Stage 5 physical beach-profile buffer is bit-identical.

The exact existing road-slab minimum above the five verified lower crossings remains **3.0362968426285235m**, and the path-slab minimum remains **3.328525406971907m**. This is model geometry evidence, not survey certification.

## Paint, traffic, and navigation

The actual generated `streetPaint()` rectangles have **zero bounding-envelope overlap** with the correction. The actual traffic-source filter yields **zero source segment overlaps**. These affected Stanley source roads are private roads, excluded from lane paint/crossing eligibility and traffic generation. The current old `roadRelief + 1.075` paint callback and `roadRelief + 1.8` car-body callback therefore do not float over this particular correction.

Do not generalize that conclusion to other roads. If the scope later reaches a public road, paint vertices must sample the final asphalt plane plus the original 0.025m paint offset, and traffic body height must sample final asphalt plus 0.75m. `roadRelief` should remain the unchanged original source field used to prepare the Causeway, rather than being globally overwritten by this local repair.

Navigation's `roadHeight()` already uses `e.data.roadSurface.sample(...) + 0.2`; building that index after repair makes Drive follow the final actual City mesh. Walk uses the highest actual unprotected ground mesh. This repair changes no upper IDs, gate geometry, allowed modes or navigation tolerances.

## Explicit retained limitations / follow-up evidence

The original grey shoreline conflict is now handled. The north seawall strip previously rose 0.442675m above `381179591`; the northwest rock strip previously rose 0.494985m above the final coastal paths. The exact positive-overlap seeds are 22.166m² and 98.023m² respectively. Both now lie at least 0.019956m below their real path planes after Float32 conversion.

| Shore scope | Original triangles refined | Triangle count before → after | Largest downward change | Upward change |
|---|---:|---:|---:|---:|
| North seawall | 18 | 8,606 → 13,350 | 0.568887m | 0 |
| Northwest rock strip | 17 | 304 → 7,715 | 0.755322m | 0 |

The shared-vertex height discrepancy is below 7e-13m. The source shoreline footprint/plan area is preserved, and the sea, original path buffers, Stage 5 physical beach profile, Causeway upper floors and all five ground gates remain unchanged. Both strips participate in the final guarded coarse-ground clipping so lowering them does not expose a new green triangle.

The final screenshot still shows dark City asphalt on the seaward side outside the beige path coverage. This is retained source geometry, not evidence that asphalt again penetrates the verified path plane. Nearby City feature 1790 is STANLEY PARK DRIVE / Private / width 6m, and feature 1829 is WALKWAY / Other Non-City / width 6m. OSM `381179591` is a 3m footway and `863811845` a 4m cycleway; their axes and widths differ from the City data. Both OSM surfaces are actually tagged **asphalt**; beige is the atlas's common path display color. The remaining adjacent dark/grey material boundaries outside the path footprint are not claimed to be a surveyed material map. They are retained rather than deleting source-backed pavement to make an artificial continuous beige band.

A separate existing small City-road-edge/bridge-slab projection has lower headroom outside the five guaranteed lower crossings. The road minimum 1.609245m occurs at `[-123.13654497255321,49.297100498561925]`, on the outer edge of City feature **1625**, Private / STANLEY PARK DRIVE / width 6m. Nearby source axes are attached path `70954677` and approach `363686510`, approximately 3.8m away. The path-slab minimum 1.817815m is at `[-123.13652471681509,49.2971057622388]`. The root explicitly requested retaining this source geometry and recording the limitation instead of inventing a new underpass or deep excavation.

Browser acceptance remains root-owned: compare the three fixed viewpoints and Walk/Drive starts after the final canonical build. This document reports CPU geometry/movement evidence only.
