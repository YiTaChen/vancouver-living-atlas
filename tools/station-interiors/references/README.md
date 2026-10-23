# Station reference geometry

`street-map-20261023.json` retains the specific OpenStreetMap entrance, stair,
passage and platform records used to calibrate the interiors. Node/way IDs,
versions, timestamps, source tags and coordinates are retained so the review
can be reproduced even if the live map changes.

These records supplement TransLink entrance diagrams and the photographs in
`docs/qa/station-interiors-20261023/`. OpenStreetMap's `fixme=location approximate`
platform polygons are not a survey. Indoor `level` tags establish relationships,
not metre elevations; a mapped steps line may include its landing or represent
an escalator bank. Measured equipment lengths and observed stair counts take
precedence when choosing the representative interior section.

Temporary operational closures are documented in the source tags. The game
models permanent architecture and does not act as a live service-alert feed.

Map data © OpenStreetMap contributors, ODbL 1.0. Linked photographs remain with
their respective creators and are not copied into game textures.

The Seymour street mouth is a separately typed `interpreted-entrance`, supported
by Whitfield's 2013 on-site photograph (Figure 59). Its northwest entry and
northeast stair turn are visible; the 7 m setback from the mapped stairhead is
an inference to meet the city building edge. It is not presented as an OSM
entrance node or a surveyed door coordinate.
