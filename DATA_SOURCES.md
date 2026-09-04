# Vancouver geographic source data

Prepared 2026-09-04 for the Vancouver browser reconstruction. No third-party city model, finished visualization, Google map tile or imagery is embedded. Assets derive from open vector records. Project code can be MIT licensed; source geographic records retain the licenses below.

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

Display credit `© OpenStreetMap contributors` linked to https://www.openstreetmap.org/copyright . Distributed OSM-derived vector data in `context.geojson`, `paths.geojson`, `buildings.geojson`, `context-land.geojson`, and OSM-derived bridge routes remains available under the Open Database License: https://opendatacommons.org/licenses/odbl/1-0/ . These data files are not relicensed as MIT.

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

The combined geographic database includes OSM-derived data and is distributed under ODbL1.0 with City of Vancouver attribution retained. This does not change the application's MIT code license. `reconcile_buildings.py` reproduces the transformation from the prepared source vectors.

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

Metadata and reconciliation reports are also distributed. Data records are not counts of unique buildings, streets or all trees in Vancouver. The current renderer creates 36,201 trees after source filtering and procedural forest infill.

Portable preparation tools, explicit input requirements and snapshot hashes are in [tools/README.md](tools/README.md). Raw snapshots and all intermediate files are not included. Re-fetching evolving upstream sources may change results. The portable tools were checked against the original preparation snapshots: detailed/context terrain, buildings, bridge routes, regional coast and seven published texture maps reproduced the release bytes.

The Lions Gate model distinguishes the 472m main span, 187m side spans and northern viaduct following [Parks Canada's description](https://www.canada.ca/en/news/archive/2010/05/lions-gate-bridge-national-historic-site.html). Deck elevations remain display estimates, and source road lengths include connecting approaches.
