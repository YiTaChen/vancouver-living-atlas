# Vancouver geographic source data

Prepared 2026-09-04 for the Vancouver browser reconstruction. No third-party city model, finished visualization, Google map tile or imagery is embedded. Assets derive from open vector records. Project code can be MIT licensed; source geographic records retain the licenses below.

## Coordinate system and extent

All GeoJSON coordinates are longitude, latitude in EPSG:4326 (WGS84). Study bounds are `[-123.165,49.267,-123.095,49.315]`. Retain rings/holes in polygons and multi-geometries. This encloses Stanley Park, the entire downtown peninsula, Science World, False Creek, Granville Island and adjoining south-shore sections. The north edge clips Lions Gate Bridge before its north end. The western/southern study edges clip Kitsilano and south Vancouver.

For local rendering with origin `[-123.128,49.286]`, approximate `x=(lon+123.128)*72600`, `z=-(lat-49.286)*111320` in metres. Exact projection is available with EPSG:26910 or pyproj. Building height and ground/base values are metres.

## City of Vancouver — Open Government Licence – Vancouver

Attribution to display and retain:

> Contains information licensed under the Open Government Licence – Vancouver.

License: https://opendata.vancouver.ca/pages/licence/

The provider allows copying, adapting, publishing and distributing with attribution. City marks/logos are not licensed by this data license. All `meta-*.json` scratch files preserve original dataset metadata and provider accuracy notes.

| Prepared file | Source dataset | Content and qualification |
|---|---|---|
| `buildings.geojson` | https://opendata.vancouver.ca/explore/dataset/building-footprints-2009/ | 7,762 actual LiDAR-derived building parts; original `hgt_agl` becomes `height`, `baseelev_m` becomes `base`; contains rooftop parts and podiums. 2009 snapshot, approximate, not contemporary as-built survey. |
| `footprints-2015.geojson` | https://opendata.vancouver.ca/explore/dataset/building-footprints-2015/ | 4,660 actual 2015 outer footprints; no vertical measurements. Optional comparison layer. |
| `land.geojson`, `shoreline.geojson` | https://opendata.vancouver.ca/explore/dataset/shoreline-2002/ | Actual approximate shoreline digitized from 2002 orthophotos; land polygon constructed by polygonizing clipped shore plus study-box boundary, selecting downtown land. Shore does not include small isolated islands and has age-dependent reclamation differences. |
| `parks.geojson` | https://opendata.vancouver.ca/explore/dataset/parks-polygon-representation/ | 60 park boundary polygons, including Stanley Park. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/public-streets/ | Public road centrelines plus the following layers, total 2,953 segments. Display widths are chosen by class; they are not survey pavement widths. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/non-city-streets/ | Private and other non-city roads. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/lanes/ | Lane centrelines. |
| `roads.geojson` | https://opendata.vancouver.ca/explore/dataset/bikeways/ | Active bicycle infrastructure; sometimes coincident with roads. A bikeway overlay should not create a second full-width vehicle roadway. |
| `trees.json` | https://opendata.vancouver.ca/explore/dataset/public-trees/ | 20,545 real public tree positions and supplied heights/diameters/species. Missing heights use 6m; missing diameter uses15cm. Private trees and unrecorded forest trees are absent. Current published inventory downloaded 2026-09-04. |
| Raw contours only | https://opendata.vancouver.ca/explore/dataset/elevation-contour-lines-1-metre-contours/ | 1,103 contour features intersecting study bounds, `elevation` in metres. Digitized2002 orthophoto approximations; downloaded as optional fallback terrain source. |

City API retrieval pattern (the query returns intersecting features; preparation clips them):

`https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{dataset}/exports/geojson?where=intersects(geom,geom'POLYGON((-123.165 49.267,-123.095 49.267,-123.095 49.315,-123.165 49.315,-123.165 49.267))')`

## OpenStreetMap contributors — ODbL 1.0

Display credit `© OpenStreetMap contributors` linked to https://www.openstreetmap.org/copyright . Distributed OSM-derived vector data in `context.geojson`, `water.geojson`, `beaches.geojson`, `woods.geojson`, `paths.geojson`, `buildings-osm-*.geojson` remains available under the Open Database License: https://opendatacommons.org/licenses/odbl/1-0/ . These data files are not relicensed as MIT.

Retrieved from https://overpass-api.de/api/interpreter on 2026-09-04 with direct Overpass queries for `natural=water|beach|wood`, `building`, `building:part` and Stanley Park `highway` features. These are source map records, not a third-party city model. OSM is community maintained; tagged heights are not guaranteed measured or complete.

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

`geography-qa.png` is a generated overhead plot used to visually inspect alignment. Coastline, real road grid, footprints, lakes, forest polygons and trails agree spatially. Downtown and Stanley Park lie in the land mask. Science World's overwater pavilion lies seaward of the coast and needs its real supported platform. Reference imagery confirms its circular dome is not the centroid of the entire pavilion.

Source years differ. This is an original interpretive reconstruction from geographic records, not a certified digital twin. Surfaces, facade appearance, vegetation canopy form, bridge deck elevations and road widths require separately authored visual interpretation. Source licenses and age qualifiers should be present in the published application's data/about panel and repository.
