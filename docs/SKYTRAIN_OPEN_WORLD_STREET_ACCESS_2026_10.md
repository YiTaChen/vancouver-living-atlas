# Street-connected SkyTrain stations — 2026-10-22

The seven regional stations are retained as geographic owners, constructed
across bounded turns. A passenger enters by walking through an entrance threshold,
then follows actual connected floor and stair triangles to a platform. Changing
the active ride does not replace another station's architecture. All owners and
their GPU resources are released by the station manager on disposal.

## Source and accuracy

The complete July 2026 TransLink station-map PDF pixels were inspected for
[Waterfront](https://infomaps.translink.ca/system_maps/skytrain_station_maps/waterfront_station.pdf),
[Burrard](https://infomaps.translink.ca/system_maps/skytrain_station_maps/burrard_station.pdf),
[Granville / Vancouver City Centre](https://infomaps.translink.ca/system_maps/skytrain_station_maps/granville_vancouver_city_centre_station.pdf),
[Stadium–Chinatown](https://infomaps.translink.ca/system_maps/skytrain_station_maps/stadium_chinatown_station.pdf),
[Main Street–Science World](https://infomaps.translink.ca/system_maps/skytrain_station_maps/main_street_station.pdf), and
[Yaletown–Roundhouse](https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf).

These diagrams identify approach streets and entrances. Their street-side
positions were hand interpreted against the retained City street and building
footprint packets, including facade-normal registration where a coarse building
polygon extends across a doorway. They are approximate geographic entrance
placements, not surveyed door coordinates. Switchback dimensions, passage
lengths, platform depths and architectural details remain representative game
geometry. The maps do not establish measured interior floor plans. No map
artwork, downloaded photograph or source texture is redistributed.

The [source receipt](qa/skytrain-travel-20261022/street-access-source-receipt.json)
records the inspected PDFs' SHA-256 hashes, City geometry packet hashes,
approach coordinates, original runtime packet/source hashes, derived world
portals, route lengths and geometry counts. Original station JSON files, GLBs,
platform/door frames and source packets remain unchanged. Existing geographic
and GTFS provenance is documented separately in
[the regional references](SKYTRAIN_STATION_REFERENCES_2026_10.md).

| Station | Public geographic approaches in this implementation |
| --- | --- |
| Waterfront | Cordova heritage lobby interface; Granville Canada Line entrance |
| Burrard | Burrard / Dunsmuir plaza pavilion |
| Granville | Granville Street; Dunsmuir accessible entrance approach; Seymour Street |
| Stadium–Chinatown | Upper Beatty Street; lower Pacific / Expo Boulevard |
| Main Street–Science World | Terminal Avenue east stationhouse |
| Vancouver City Centre | Granville / West Georgia street entrance |
| Yaletown–Roundhouse | Davie / Mainland pavilion |

Waterfront has a common pedestrian concourse and separate line descents. The
Expo route retains Burrard's and Granville's distinct stacked platforms.
Granville retains three visible escalator banks and long representative flights.
Main Street climbs beyond the east platform end before entering an elevated
level gallery. Its ground passage first turns inside the stationhouse and passes
beside the entrance apron before reaching the stair, preserving station walking
ownership until a deliberate return through the street doorway. Granville and
Vancouver City Centre remain separate stations.
This implementation exposes Main Street's east access only, consistent with the
existing neighboring-podium clearance limitation; it does not represent a real
closure of the west stationhouse. Elevators and full mall interiors are not
represented as new functional routes by this street-access overlay.

## Physical ownership and terrain openings

The origin and train/platform frames retain the existing terrain datum. A
separate `streetHeightAt` callback samples the actual rendered walking support
for entrance aprons, including a pre-existing public lobby floor. This avoids
snapping a person standing on the Waterfront lobby floor down to bare terrain.
Entrance grids include the threshold and outward handoff points exactly.

Ownership preserves current world X/Z, height and heading. Entry accepts only
the bounded doorway apron and a maximum 22 cm height difference. Exit returns
the current world foot position through the same doorway, including equivalent
coplanar corridor polygons. It does not move the passenger to a selected floor.
Where an access passage overlaps an actual platform at the same supported
height, walking adopts the platform's surface identity without moving the foot
or changing heading. Boarding therefore recognizes the physical platform.
`boardingDoors` exposes every authored carriage door with its carriage index,
rendered carriage-local door vector and supported nearby waiting foot point.
Its station-local `threshold` retains the source sill for a physical door prompt
anchor; interaction proximity continues to use the supported waiting foot.
The protected Expo station packet places outer doors at +/-5.5 m, while the
retained cabin GLB and exterior openings are at +/-4.9 m. The runtime adapter
corrects those doors by 0.6 m, translating the waiting point, threshold and edge through
the authored carriage and platform rotations before resolving safe support.
`sourceCarDoor` preserves the unmodified packet vector. Canada doors retain
their source coordinates. The same runtime index/vector identifies an alighting
point. Static support is cached; returned values are isolated copies. Legacy
default door APIs remain unchanged. Source-authored left/right labels must not
be inferred from X sign.

Stair risers are at most 16 cm. Swept walking checks the actual tread triangles,
body support, track exclusions, platform obstacles and rendered centre-bank
handrails. Parallel flights use separate lanes and level turning landings.
Overlapping coplanar floor primitives share physical walking support; this does
not connect stacked levels or grant vehicle access.

`applySkyTrainWorldOpenings` chains existing material hooks and cache keys. It
cuts only bounded world-space entrance and stair volumes in selected terrain,
road, generic building and landmark roots. Seven coarse station bounds reject
unrelated pixels before detailed aperture tests. The current seven-station
bare-terrain receipt has 50 precise volumes; the bounded capacity is 96. The
helper has an explicit `refresh()` for newly introduced materials and restores
previous hooks on disposal. It does not hide entire terrain or building groups.

## Focused verification

`tests/skytrain-street-access.test.mjs` verifies all 11 entrance handoffs, all 17
entrance-to-distinct-platform paths in both directions with no street-exit
handoff before the final outward doorway crossing, Waterfront line transfer,
normal ground approach through the production GIS collision method, rendered
lobby support independent of train datum, retained proximity loading, bounded
material apertures, late material refresh and solid handrails.
Directional boarding checks walk from platform access to all 16 selected door
waiting points, using safe crossovers between the retained furniture rows.
The original 21 station tests continue to verify unchanged source geometry and
provenance.
The complete 156-door directional inventory is also checked in both legacy and
world owners, including source side/vector provenance, the explicit Expo 0.6 m
rendered-door correction, safe support, unchanged default selection, mutation
isolation and disposal.

The ordinary ground approach test uses actual City land, generic buildings and
reserved landmark footprint polygons. Runtime street furniture, public lobby
height selection, native keyboard/touch input, lighting and camera behavior also
require the separate browser integration checks. Tests do not establish survey
accuracy or present-day live service status.
