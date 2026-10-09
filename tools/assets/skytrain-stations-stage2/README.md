# SkyTrain station supplement, Stage 2

Original offline assets for **Vancouver Living Atlas by YiTaChen**. Source: https://github.com/YiTaChen/vancouver-living-atlas. Repository licence: Vancouver Living Atlas Noncommercial Research and Attribution 1.0. This package is an authored research/gameplay proposal, not a measured reproduction or an operating-station accessibility certificate.

## Delivered geometry

- Seven independently positioned editable station `.blend` sources and seven real GLBs: Waterfront, Burrard, Granville, Stadium–Chinatown, Main Street–Science World, Vancouver City Centre and Yaletown–Roundhouse.
- Two shared, editable, tapered threshold-bridge modules and two corresponding GLBs. Station files preserve named, transformable stored bridge instances with linked/shared mesh data.
- 16 directional stop interfaces, 167 connected walk surfaces, 156 door alignments and threshold instances, 184 station/door/stop anchors. Stair tread geometry and individual tread surface metadata are included; elevators are shaft/landing/stop prototypes, with cabin mechanics and runtime movement still pending.
- Actual GLB reimport daylight cutaway and platform previews for every station, plus close stored/deployed Expo and Canada bridge views with actual matching train GLBs.

`station-layout.json` extends the existing D01/D04/D05 metre-scale contract. `manifest.json` uses the unchanged common package schema. Source meshes remain individually editable; exports batch static geometry by role/material, retain walk surfaces and dynamic plate nodes, and share identical plate mesh data within each station. No textures, copied photos, logos, external fonts or night lighting are included.

## Distinctions and limits

| Station | Actual difference in this model | Source/precision boundary |
|---|---|---|
| Waterfront | Separate 74 m Expo and 44 m Canada platforms, different heights and perpendicular local frames; connected representative lobby route | Official map shows separate alignments; historical TransLink text supports transfer via lobby. Path dimensions and offsets are illustrative; no SeaBus corridor reused. |
| Burrard | Vertically stacked single-sided platform decks at local −9/−15 m, opposite-end access banks | Ground location source-backed; section/depths unsurveyed. |
| Granville | Deep stacked decks at −20/−26 m, longer multistage stairs and intermediate lift stops | Distinct from nearby Canada Line station. No invented same-platform transfer. Depths and access bank geometry are illustrative. |
| Stadium–Chinatown | Platform at −5 m; upper Beatty street datum 0 and lower Pacific entry −9 m | Official station description confirms different street levels. Actual operational third track and precise side-platform configuration are outside this representative island coupon. |
| Main Street–Science World | Elevated +8 m platform, underside piers and independent east/west stationhouses | Official map and historical upgrade rendering inspected. Elevation and structure sizes are proposals, not survey. |
| Vancouver City Centre | Underground −9 m deck with connected −3 m mall-interface spur, capped at package boundary | Entrance map and historical TransLink mall relationship inspected. No full mall or Granville connection. |
| Yaletown–Roundhouse | Deeper −15 m deck, distinct brick/wood pavilion and multilevel access | Historical official source reports about 15 m depth. Exact datum and pavilion proportions are illustrative. |

## Geography and world placement

The City of Vancouver `rapid-transit-stations` response is retained with Open Government Licence – Vancouver attribution. All seven names fall within the source core boundary. Both Waterfront City records are retained; the City does not assign line IDs to them. GTFS parent IDs/anchors and discrepancies from City points are recorded instead of silently substituting one for another.

`localToWorld` uses the actual projection from `lib/city/geo.ts`: origin [−123.128, 49.286], X east and Z south. The numeric horizontal proposals are reproducible. Station points are **not** surveyed entrance/platform centres; yaw is map-inspired, absolute world Y is unresolved, and exterior sidewalk/terrain attachment is not accepted. `worldPlacementReady` and `rideReady` remain false.

## Threshold hardware is an Atlas proposal

The 156 plates are **representative Atlas gameplay hardware**, not a claim that real Vancouver stations have these devices. Expo uses the existing measured 71.5 m four-car contract and a 74 m platform. Canada reads the sibling manifest's measured 41.512 m two-car envelope, plus 1 m stopping allowance at each end, and uses a 44 m platform. Canada car 02 retains its π-yaw and reverses local door sides correctly.

- Expo plate spans vehicle-distance X 1.30–1.52 m; the vehicle floor ends at 1.325 m and the platform begins at 1.50 m.
- Canada plate spans X 1.48–1.72 m; floor ends at 1.50 m and platform begins at 1.70 m.
- Each plate is 1.30 m along-train, 15 mm thick, with 20 mm tapered end transitions. Bottom bearing rests on the actual sill/platform; the central top rises 15 mm. There is **no hidden solid-slab overlap**.
- Stored plates sit vertically in the physical gap, at least 20 mm below the sill, outside the full vehicle width and platform slab. They are not hidden inside uncut slabs.
- Explicit deployment is raise vertically in the gap, rotate above both floors, translate over the bearing ends, then lower. Reverse before door movement. These are representative controlled poses, not a claim of a surveyed mechanism.
- Geometry checks require the correct stopped consist and both paired leaves fully open. Actual GLB top-face support rays cover all 156 interfaces, including source train floor and platform. Conservative sampled triangle-AABB checks cover all four movement stages and reversal, with support contact allowed and positive-volume overlap rejected.
- Over the15mm plate, minimum doorway clearance is2.035m Expo and2.115m Canada, clearing the1.95m reference person. These doorway values are separate from cabin headroom.
- Dynamic interlocks, continuous-time collision, passenger transactions and actual gameplay remain D06 integration work. No runtime app, dependency, workflow or old asset package was changed.

## Reproduce and validate

Run from repository root with Python 3 and Blender available:

```sh
python tools/assets/skytrain-stations-stage2/layout.py
blender -b -t 2 --python tools/assets/skytrain-stations-stage2/build.py
blender -b -t 2 --python tools/assets/skytrain-stations-stage2/export.py
python tools/assets/skytrain-stations-stage2/finalize.py
python tools/assets/skytrain-stations-stage2/validate.py
python tools/assets/skytrain-stations-stage2/audit_sweeps.py
python tools/assets/package-contract/validate.py tools/assets/skytrain-stations-stage2
blender -b -t 2 --python tools/assets/skytrain-stations-stage2/render_previews.py
blender -b -t 2 --python tools/assets/skytrain-stations-stage2/render_thresholds.py
```

To prove editable-source roundtrip, re-export with `-- --output tools/assets/skytrain-stations-stage2/qa/reexport` and compare SHA-256 with the nine original GLBs. `qa/source-roundtrip.json` records the actual result. Metadata regeneration uses neighbouring train manifests and the City JSON. When the research-only PDFs are absent, regeneration reuses the previously inspected source hashes from `qa/source-audit.json`; retrieving maps is necessary only to refresh that source audit.

Key reports: `qa/measurements.json`, `qa/validation.json`, `qa/threshold-validation.json`, `qa/threshold-sweep-validation.json`, `qa/source-roundtrip.json`, `qa/source-audit.json`, `qa/visual-review.json`, and both preview index files. Common validation measures real exported buffers and transforms; custom negative fixtures reject corrupted geometry contracts. CPU image evidence is explicitly not browser/WebGL acceptance.

## Source rights and release contents

Official TransLink PDFs, article pages and photos were downloaded, rasterized and inspected locally. Their pixels were not incorporated in the authored models. Full publisher reference bytes are excluded by `references/.gitignore`; publish only their URLs, hashes and concise observations. City data uses its separately verified licence at https://opendata.vancouver.ca/pages/licence/ (metadata snapshot retained). Include authored `.blend`, `.glb`, JSON, scripts, this README and original CPU previews; exclude cache directories, `.blend1`, and duplicate `qa/reexport/` products.

## Still unverified

- Surveyed interiors, exact entrance coordinates, depths, orientation and absolute terrain/rail heights
- Faithful station enclosure/façade detail, precise historical/as-built correspondence and Stadium's third track
- Working elevator cabin/doors and all accessible navigation, rail routes, live operations and service continuity
- Browser/WebGL appearance, runtime boarding, camera collision, lifecycle disposal and performance
- Continuous collision throughout threshold motion and interaction with moving passengers

Night lighting, SeaBus, WCE, Millennium Line and out-of-core stations are excluded.
