# Vancouver geographic source data

Prepared 2026-09-04 for the Vancouver browser reconstruction. No third-party city model, finished visualization, Google map tile or imagery is embedded. Assets derive from open vector records. Original project code is now offered under the noncommercial research and attribution terms in [LICENSE](LICENSE); prior MIT grants remain valid. Source geographic records retain the licenses below.

## Coordinate system and extent

All GeoJSON coordinates are longitude, latitude in EPSG:4326 (WGS84). Detailed core study bounds are `[-123.165,49.267,-123.095,49.315]`. Retain rings/holes in polygons and multi-geometries. This encloses Stanley Park, the entire downtown peninsula, Science World, False Creek, Granville Island and adjoining south-shore sections. The separate bridge route extends beyond the core to include the full Lions Gate crossing. Regional context bounds are `[-123.26,49.22,-122.97,49.44]`. The western/southern study edges clip Kitsilano and south Vancouver.

For local rendering with origin `[-123.128,49.286]`, approximate `x=(lon+123.128)*72600`, `z=-(lat-49.286)*111320` in metres. Exact projection is available with EPSG:26910 or pyproj. Building height and ground/base values are metres.

## City of Vancouver — Open Government Licence – Vancouver

Attribution to display and retain:

> Contains information licensed under the Open Government Licence – Vancouver.

License: https://opendata.vancouver.ca/pages/licence/

The provider allows copying, adapting, publishing and distributing with attribution. City marks/logos are not licensed by this data license. All `meta-*.json` scratch files preserve original dataset metadata and provider accuracy notes.

The table describes source preparation; files identified as intermediates are not distributed in `public/data`. The final published inventory is listed below.

| Prepared file | Source dataset | Content and qualification |
|---|---|---|
| `lib/city/stanley-lighting-source.json` | [Street lighting poles](https://opendata.vancouver.ca/explore/dataset/street-lighting-poles/) | Engineering Services inventory retrieved 2026-10-23: 103 records intersect the current Stanley Park polygon, 102 deduplicated positions, 101 fixtures admitted by the runtime land mask. Exact response bytes, metadata, license and hashes are retained in `tools/sources/stanley-lighting/`; S2:26 remains recorded but is not rendered because it falls outside the current coast. Positions do not certify fixture type, wattage, live operation or complete Park Board coverage. See [scenery notes](docs/STANLEY_PARK_SCENERY_2026_10.md). |
| City 2009 building input (intermediate) | https://opendata.vancouver.ca/explore/dataset/building-footprints-2009/ | 7,762 actual LiDAR-derived building parts; original `hgt_agl` becomes `height`, `baseelev_m` becomes `base`; contains rooftop parts and podiums. 2009 snapshot, approximate, not contemporary as-built survey. |
| `footprints-2015.geojson` (intermediate) | https://opendata.vancouver.ca/explore/dataset/building-footprints-2015/ | 4,660 actual 2015 outer footprints; no vertical measurements. Optional comparison layer. |
| `land.geojson`, `shoreline.geojson` | https://opendata.vancouver.ca/explore/dataset/shoreline-2002/ | Actual approximate shoreline digitized from 2002 orthophotos; land polygon constructed by polygonizing clipped shore plus study-box boundary, selecting downtown land. Shore does not include small isolated islands and has age-dependent reclamation differences. |
| `parks.geojson` | https://opendata.vancouver.ca/explore/dataset/parks-polygon-representation/ | 60 park boundary polygons, including Stanley Park. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/public-streets/ | Public road centrelines plus the following layers, total 2,953 segments. Display widths are chosen by class; they are not survey pavement widths. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/non-city-streets/ | Private and other non-city roads. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/lanes/ | Lane centrelines. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/bikeways/ | Active bicycle infrastructure; sometimes coincident with roads. A bikeway overlay should not create a second full-width vehicle roadway. |
| `trees.json` | https://opendata.vancouver.ca/explore/dataset/public-trees/ | 20,545 real public tree positions and supplied heights/diameters/species. Missing heights use 6m; missing diameter uses15cm. Private trees and unrecorded forest trees are absent. Current published inventory downloaded 2026-09-04. |
| `terrain.json` source contours | https://opendata.vancouver.ca/explore/dataset/elevation-contour-lines-1-metre-contours/ | 1,103 contour features intersecting study bounds, `elevation` in metres. Approximate 2002 contours are the actual detailed terrain source: interpolated to a 257 × 273 grid (70,161 samples, about 20m). Range 0–75.7m; grid spacing is not a survey accuracy claim. |

City API retrieval pattern (the query returns intersecting features; preparation clips them):

`https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset}/exports/geojson?where=intersects(geom,geom'POLYGON((-123.165 49.267,-123.095 49.267,-123.095 49.315,-123.165 49.315,-123.165 49.267))')`

## OpenStreetMap contributors — ODbL 1.0

Display credit `© OpenStreetMap contributors` linked to https://www.openstreetmap.org/copyright . Distributed OSM-derived vector data in `context.geojson`, `paths.geojson`, `buildings.geojson`, `context-land.geojson`, and OSM-derived bridge routes remains available under the Open Database License: https://opendatacommons.org/licenses/odbl/1-0/ . These data files are not relicensed under the application license.

Retrieved from https://overpass-api.de/api/interpreter on 2026-09-04 with direct Overpass queries for `natural=water|beach|wood`, `building`, `building:part` and Stanley Park `highway` features. These are source map records, not a third-party city model. OSM is community maintained; tagged heights are not guaranteed measured or complete.

Separate water/beach/wood and raw OSM building files in this preparation table are intermediates. Their combined published files are `context.geojson` and `buildings.geojson`.

| Prepared file | Records | Notes |
|---|---:|---|
| `water.geojson` |65|Includes exact Lost Lagoon relation with interior islands, Beaver Lake, other ponds/pools. Lake surface height should use local elevation, not blanket sea level. |
| `beaches.geojson` |57|Real beach geometries including English Bay, Sunset, Second and Third Beach and adjacent shore fragments. |
| `woods.geojson` |93|Mapped forest polygons; useful for procedural forest infill between real public-tree records. |
| `context.geojson` |215|The previous three layers combined; `class` is `water`, `beach`, or `wood`. |
| `paths.geojson` |810|Stanley Park footways, paths, cycleways, tracks and stairs. Chosen render widths are approximate. |
| `buildings-osm-explicit-heights.geojson` |1,400|Current OSM footprint parts carrying numeric explicit `height` tags. `base:null` requests the local terrain surface. `minHeight` is height above ground. Building outlines and parts may overlap. Useful for supplemental newer towers, but do not naively stack all records over2009 geometry. |
| `buildings-osm-all.geojson` |6,744|All current OSM building and part polygons, often incomplete height data. `levels` can be available; derive estimated heights only with an explicit display qualification. |
| `osm-landmarks.json` (raw)|Named objects|Exact source geometry for independently authored landmark models. Some names identify podiums, entrances or unrelated objects, so inspect shapes/addresses rather than trusting names alone. |

## Prepared schemas

All GeoJSON files are standard FeatureCollections.

- Buildings: `properties={id,buildingId,height,base,roof,area,source}`. `height` and `base` metres; 2009 values are preserved to2decimal places. Footprints preserve holes and multipolygons.
- Roads: `{name,class,width,source}`, geometry LineString or MultiLineString. Width metres is display estimate. Classes include `Arterial`, `Secondary Arterial`, `Residential`, `Private`, `Other Non-City`, `Lane`, `Bikeway`.
- Parks: `{name,class,source}`, polygons.
- Context: `{id,name,class,water,source}`, polygons. `water` is optional OSM water type.
- Trees: `{"schema":["lon","lat","height_m","diameter_cm","species"],"source":"City of Vancouver public trees","trees":[[lon,lat,height,diameter,species],...]}`.
- OSM buildings: `{id,name,height,levels,minHeight,base,part,roof,roofColor,building,source}`. `height` is the top above ground, so a part with `minHeight>0` occupies `[minHeight,height]` above ground.

## QA and limitations

The private preparation artifact `geography-qa.png` is a generated overhead plot used to visually inspect alignment. Coastline, real road grid, footprints, lakes, forest polygons and trails agree spatially. Downtown and Stanley Park lie in the land mask. Science World's overwater pavilion lies seaward of the coast and needs its real supported platform. Reference imagery confirms its circular dome is not the centroid of the entire pavilion.

Source years differ. This is an original interpretive reconstruction from geographic records, not a certified digital twin. Surfaces, facade appearance, vegetation canopy form, bridge deck elevations and road widths require separately authored visual interpretation. Source licenses and age qualifiers should be present in the published application's data/about panel and repository.

## Reconciled building inventory

`public/data/buildings.geojson` is the published rendering inventory: 7,630 valid solids, comprising6,505 retained/clipped City solids and1,125 reconciled OSM slabs across538 structures. The intermediate `buildings-modern-reconciled.geojson` contains only the OSM slabs; `buildings-structure-envelopes.geojson` contains structure grouping envelopes for inspection, not extrusion.

Reconciliation uses declared source topology, not a rule selecting whichever building is tallest. Full OSM envelopes with at least70% footprint coverage by their own declared building parts are omitted (29 envelopes). Numeric intervals with `height<=minHeight` are rejected (5 records). Overlapping explicit parts are unioned within each declared vertical interval, preserving stepped podiums, tower crowns and rotated Paradox tower sections. Contiguous intervals with the same footprint are merged. Shared ground values are weighted median nearby City measured base elevations and are marked `baseSource`; they remain an approximation for source dates which differ.

Grounded OSM structures replace City roof parts whose centroid is covered or whose overlap is at least50%. Remaining overlapping edges are geometrically clipped. Elevated-only OSM parts use three-dimensional interval subtraction, retaining their supporting City mass below. Of7,762 input City parts,1,266 are removed,247 have footprint edges clipped, and8 require vertical interval cuts.

All output features preserve `id`, `name`, `height`, `minHeight`, `base`, `roof`, `source`. Additional `sourceIds`, `structureId`, `baseSource` and `reconciliation` fields document derived OSM solids. Stored source solids occupy `base+minHeight` to `base+height`. The browser instead seats each structure on the displayed terrain, sampling a shared foundation minus 0.4m; it preserves the `minHeight` and `height` offsets. Thus source-volume QA does not certify every final terrain-anchored display surface.

The intermediate `landmarks-excluded.geojson` reserves exact OSM source outlines with2m seam clearance for original custom models of Science World, BC Place, Canada Place, Harbour Centre and the true Vancouver House site. All combined geometry is cleared from these footprints. This excludes the Canada Place complex, including its entire mapped building outline, and Harbour Centre's base/podium area; the custom models must supply those elements. The unrelated7m commercial building also named Vancouver House near Georgia Street is not mistaken for the157m residential tower.

Source-geometry verification confirms Living Shangri-La201m (7 vertical slabs), Paradox Vancouver188m (14 vertical slabs with rotated sections), and One Wall Centre150m. These heights are source OSM tags rather than newly measured survey claims. All five reserved custom-landmark central points are absent from generic massing.

`reconciliation-report.json` records counts, discarded parents, invalid input intervals, tall-structure details and QA. Tests against the serialized final GeoJSON report zero invalid polygons/height intervals, zero positive-volume overlap pairs with horizontal area above0.1m², and zero generic-massing overlap above0.1m² with reserved landmark envelopes. Touching faces/adjacent vertical intervals are intentional.

The combined geographic database includes OSM-derived data and is distributed under ODbL1.0 with City of Vancouver attribution retained. This does not change the application's separate code license. `reconcile_buildings.py` reproduces the transformation from the prepared source vectors.

## Regional context land mask

`context-land.geojson` is a22KB valid EPSG:4326 MultiPolygon covering `[-123.26,49.22,-122.97,49.44]`. It contains7 land polygons and846 perimeter vertices, with15m topology-preserving simplification. Source:129 `natural=coastline` ways retrieved2026-09-04 directly from the OpenStreetMap Overpass API. License ODbL1.0; credit OpenStreetMap contributors as above.

`prepare_context_land.py` clips source coastlines to the study box, nodes shared endpoints with its boundary, polygonizes closed cells, and classifies land using OpenStreetMap's directed coastline convention (land on the left). Each candidate cell receives coastline-length weighted left/right votes. All7 selected land cells have zero water-side votes. This retains North/West Vancouver and the mountain mainland, south Vancouver/Point Grey, the downtown peninsula/Stanley Park and small islands while leaving the inlet open. It is independent of the DEM sea-level estimate, so coarse zero-height terrain cells cannot generate artificial broad foreshores.

`context-land-report.json` records geometry and twelve named sample checks. Eight land samples are covered; four water samples (English Bay, Burrard Inlet, False Creek and Coal Harbour) are excluded. The intermediate `context-land-qa.png` is the visual inspection plot; the pale rectangle marks the detailed core study area. This layer describes marine coastline only; use the separate water polygons for inland lakes. For the detailed core, prefer the higher-resolution core coast layer already provided.

## Distant regional terrain

`public/data/context-terrain.json` is a ~100 m grid surrounding the detailed study. It is derived from public Mapzen/AWS Terrarium elevation tiles. Tile metadata identifies USGS NED (public domain) and Natural Resources Canada CDEM (Open Government Licence–Canada). Contains information licensed under the Open Government Licence – Canada. See https://registry.opendata.aws/terrain-tiles/ and https://open.canada.ca/en/open-government-licence-canada . It provides contextual North Shore landforms, not the core city surface. Water boundaries use OpenStreetMap regional coastline. Resolution, time periods and shore-edge interpolation limit accuracy.

## Original architectural and surface work

Science World, Canada Place, BC Place, Harbour Centre and Vancouver House meshes are generated by this project's original TypeScript. The 40 m Science World dome diameter is supported by https://www.scienceworld.ca/wp-content/uploads/2026/05/Science-World_FNL_05-May-2026-A-1.pdf . Five Canada Place sails are documented by the architect at https://www.da-architects.ca/projects/canada-place-pan-pacific-hotel/ . BC Place's 36 roof masts and central opening are documented by the roof designer at https://www.tonyhoggdesign.co.uk/site/projects_58.asp?catID=94 . Shapes simplify architecture and do not reproduce every façade.

Road and bridge centreline positions are geographic data. Road widths, bridge deck heights and connecting profiles are explicit visual estimates; bridge route metadata carries this distinction. They are not navigation, engineering or surveying data.

Forest canopy placement, moving vehicles, ferries, sailboats, street furniture, window arrangements and original procedural surface textures are illustrative. Street-tree positions come from City inventory. No Google map tiles, copyrighted aerial imagery, photogrammetry city assets or third-party finished 3D city are distributed.


## Published inventory and reproduction

| File in `public/data` | Record count / resolution |
|---|---:|
| `buildings.geojson` | 7,630 solids / 7,806 polygon parts; 6,505 City + 1,125 OSM |
| `roads.geojson` | 2,953 source features; widths are estimates; coincident bikeways are not extruded as extra vehicle roads |
| `parks.geojson` | 60 features / 67 polygon parts |
| `paths.geojson` | 810 features |
| `context.geojson` | 65 water + 57 beach + 93 woodland features |
| `trees.json` | 20,545 public-tree source records; procedural forest adds further rendered trees |
| `bridges.json` | 45 main/approach/causeway features / 50 shared nodes |
| `land.geojson`, `shoreline.geojson` | detailed core polygon and clipped shoreline |
| `context-land.geojson` | 7 regional land parts / 846 vertices |
| `terrain.json` | 257 × 273 contour-derived samples, approximately 20m |
| `context-terrain.json` | 211 × 246 regional DEM samples, approximately 100m |

Metadata and reconciliation reports are also distributed. Data records are not counts of unique buildings, streets or all trees in Vancouver. The current renderer creates 36,041 trees after source filtering and procedural forest infill.

Portable preparation tools, explicit input requirements and snapshot hashes are in [tools/README.md](tools/README.md). Raw snapshots and all intermediate files are not included. Re-fetching evolving upstream sources may change results. The portable tools were checked against the original preparation snapshots: detailed/context terrain, buildings, bridge routes, regional coast and seven published texture maps reproduced the release bytes.

The Lions Gate model distinguishes the 472m main span, 187m side spans and northern viaduct following [Parks Canada's description](https://www.canada.ca/en/news/archive/2010/05/lions-gate-bridge-national-historic-site.html). Deck elevations remain display estimates, and source road lengths include connecting approaches.

The placement feature also includes [five landmark collision masks](lib/city/landmark-footprints.json), derived from the same OpenStreetMap snapshot used to reserve space for the original landmark models. Source OSM IDs are retained in each feature. These geographic records remain under ODbL, including when bundled with the browser code. Their 2m buffer is deliberately conservative: a blocked point is not a claim about legal pedestrian access. The existing inland-water polygons exclude lakes from ground placement, and display-estimated bridge surfaces determine the selected deck height.

## Rail alignments and original rolling stock

`public/data/railways.json` adds three OSM-derived open-air alignments: 1,119.04 m of Waterfront–Gastown ground railway and 855.20/893.61 m of the two Expo SkyTrain directions near Science World. Source snapshot: 2026-09-04 23:22:30 UTC, retrieved with [the recorded Overpass query](tools/railways-query.overpass). Source way/relation IDs and original bridge/tunnel/stacking tags are retained. These geographic records remain under ODbL 1.0 with © OpenStreetMap contributors attribution; they are not relicensed under the application license.

The steam locomotive, tender, coaches, electric trains, tracks, guideway and smoke are original scene code. Steam service is fictional, SkyTrain is electric, and neither operating patterns nor rail heights claim surveyed or live accuracy. Routes omit underground sections and stop short of station canopy/building passages. [Railway scope, direct sources and clearance checks](docs/RAILWAYS.md) explain the source geometry and display estimates.

## Harbour aviation, cruising and marinas (September 2026)

See [verified operators, geometry and precision notes](docs/HARBOUR_SOURCES.md). `public/data/harbour-sites.json`, `harbour-piers.json` and `harbour-routes.json` combine OSM facility geometry (© OpenStreetMap contributors, ODbL 1.0) with explicitly marked original illustrative berth occupancy and local animation paths. Helijet and Harbour Air list Victoria/Nanaimo services; the cruise demonstration uses the First Narrows exit toward Alaska/Inside Passage. Timings and flight tracks are illustrative, not live departures. No operator imagery or existing 3D assets were reused.

The original helicopter, floatplane, cruise ship, motorboat and yacht models in `lib/city/harbour-models.ts` are now offered under [LICENSE](LICENSE), subject to prior MIT grants. Curved hulls, windows, cabins, rotors, balconies, lifeboats and decks are generated from original geometry. Data licenses remain separate from the application license.

## Vancouver-style city buses (September 2026)

The original procedural low-floor bus in `lib/city/city-buses.ts` uses blue bodywork, yellow waist/sill accents, dark window bands, two right-side passenger doors, roof equipment and a rear grille. Exterior reference: [TransLink's LFSe+ introduction and official photograph](https://buzzer.translink.ca/2023/02/translink-begins-new-era-of-bus-electrification/). The photograph was viewed as a reference; no photograph, logo texture or third-party 3D model is distributed.

The model is an approximation, not a manufacturer CAD model. Its generic amber destination board and movement on selected major-road segments are illustrative: they are not live locations, actual route assignments or a transit timetable. Up to 28 buses replace ordinary-car slots on eligible segments, sharing one instanced geometry and material. Buses farther than 1 km from the camera are omitted; ground height and vehicle pitch follow the road relief.

## Prospect Point bridge and east exit (22 October 2026)

The bounded [source record](lib/city/prospect-point-source.json) retains original OSM node coordinates, way versions, timestamps and exact API URLs for the actual Park Drive bridge (41998497), east Causeway off-ramp (877408902 / 41998501), marked cycle crossing (1252160599), and main-road approaches (41998494 / 120254680). The locally relocated north approach follows 1044497045 / 363404510 / 887923788 and the first 100 m of 1299847009 before a 60 m transition to retained City geometry; this replaces the obsolete approximate hairpin without redrawing the whole park circuit. Approximate City right-of-way geometry is corrected locally; a shared name or an XY intersection does not establish motor access or grade order. Geographic derivatives retain © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0, separately from the application licence. Vertical profiles, widths and clearances are gameplay estimates rather than surveyed engineering data.

## Stanley Park motor access and local ROW corrections (22 October 2026)

The [South motor-ramp source record](lib/city/stanley-south-ramp-source.json) retains the direct OSM API snapshot, node coordinates, versions, timestamps and exact per-way API URLs for the legal North Lagoon–southbound Causeway chain 42000574 version19 / 116061627 version15 / 604336387 version7 / 116061617 version16. A 4.5 m gameplay width fills only this missing local motor-road footprint. Its terminal source-owned shoulder/curb and barrier opening follows the mapped final ramp way; unchanged Causeway asphalt planes determine the merge, with no regional elevation change. Width and blending remain illustrative estimates.

The separate [ordinary-road correction record](lib/city/stanley-drive-corrections-source.json) stores way363404509 version22 and its original coordinates, node IDs, timestamp and [direct API URL](https://api.openstreetmap.org/api/0.6/way/363404509/full.json). A bounded interval corrects City1593 and its immediate1834 continuation around retained retail building223882642, with one shared junction and a finite endpoint blend for connected City1786. Exterior City nodes and the original public dataset remain intact. City1760 is excluded only from the runtime motor-road copy because its straight approximate private ROW cuts through retained retail223882645 and does not match an existing motor route. Original OSM footways120629380 version3 /363572755 version2 and parking ways271046244 version4 /271046240 version4 provide local classification evidence; their source coordinates, tags, timestamps and exact API URLs are recorded, and those existing features are not rewritten. Both building evidence records retain the original primary footprints. These geographic derivatives remain © OpenStreetMap contributors under ODbL 1.0, separately from the application licence.

The [bounded road-access record](lib/city/stanley-road-access-source.json) distinguishes approximate ground ROWs from the existing protected Lions Gate motor bridge4755915, motor-prohibited cycle bridge70954672, Seawall footway1224865632, current parking ways43537896 /368958751 /271046240, main1044497059, Avison Way1375876258 and a mapped park pond1170395077. Verified nonmotor ground proxies1700 /1605 /1782 are suppressed from the runtime road copy; City1581 retains its verified original parking vertices0–3. Fourteen additional unlayered, offset Causeway/main-exit proxies (1580 /1603 /1763 /1618 /1619 /1625 /1809 /1660 /1719 /1766 /1708 /1591 /1595 /1608) are removed only from that runtime car-road copy after source-owned protected decks and complete paved southbound/northbound access routes were verified with those copies absent. Their exact original geometry and matching primary motor-way records remain in the same pinned source record. Original public sources, actual bridge floors, path geometry and neighbouring parking roads remain intact. Per-way primary coordinates, versions, timestamps and API URLs in that record retain © OpenStreetMap contributors / ODbL 1.0 attribution.

The [West motor-exit source record](lib/city/stanley-west-ramp-source.json) retains the current legal chain41998502 version16 /877408900 version3 /256879277 version11, the exact original City1713 proxy and original OSM nodes/coordinates, timestamps and API URLs. This access road remains distinct from the relocated main route: its approximately294.75m alignment joins the unchanged lower Causeway to the upper Park Drive approach. Only its actual terminal corridors open the corresponding shoulders and barriers. The marked green crossing1074018477 version4 shares the motor-road top; other cycle and pedestrian routes retain their existing access. Road width and the vertical transition are gameplay estimates, not survey measurements. Geographic source records and derivatives remain © OpenStreetMap contributors under ODbL 1.0, separately from the application licence.

The [northbound exit continuation record](lib/city/stanley-northbound-exit-source.json) preserves the actual363693717 /156891517 /604336388 /1299818249 /116061634 /1299818248 motor chain and its primary versions, coordinates and source URLs. Approximately132.4m of missing ordinary asphalt continues beyond the unchanged existing protected road and `park-access-city` gate; the 6m width and finite grade blend are explicit gameplay estimates. It adds paving without removing the existing road, changing the gate or introducing a collision exemption. The geographic derivative retains © OpenStreetMap contributors / ODbL 1.0 attribution.

The [northbound on-ramp record](lib/city/stanley-northbound-ramp-source.json) preserves the legal Park Drive–Causeway chain41998500 version18 /877408904 version3, original City1693 geometry, the actual shared Park main-road node3672582085, Causeway node30353347 and green cycle crossing1252160597 version4. The [Prospect source record](lib/city/prospect-point-source.json) also records the bounded City1812 /1784 shared-junction correction along primary41998494, preserving the exterior1784 endpoint with a finite40m transition. The motor ramp follows the primary source XY; only its source-owned physical merge corridor opens existing protection, and adjacent cycleways keep their existing access. Width and vertical blending remain game estimates. Original coordinates, versions, timestamps and exact source URLs retain © OpenStreetMap contributors / ODbL 1.0 attribution.

The [northbound exit crossing record](lib/city/stanley-northbound-crossing-source.json) preserves primary cycle crossing918813454 version7, its shared motor-road node3678410852 and the original bundled path geometry. It is tagged as an uncontrolled zebra/cycle crossing without bridge, tunnel or separate layer. The same record also pins adjacent cycleways363686510 version8 and116061622 version9 and their original bundled paths. Only these sources' actual overlaps with the northbound exit asphalt adopt the motor road's physical triangle planes, including the finite removal of the363686510 shoulder and curb across the motor corridor. Walk-only identities, other sources and the outer path planes remain intact. Primary coordinates, timestamps, URLs and the geographic derivative retain © OpenStreetMap contributors / ODbL 1.0 attribution.
