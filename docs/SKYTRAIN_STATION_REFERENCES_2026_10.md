# Regional SkyTrain station references — 2026-10-22

## Network and station identities

The regional passenger network includes seven distinct stations. The user’s
six requested places map to the official names below; Vancouver City Centre is
included so a Canada Line journey does not skip an intermediate station.

| Line | Included stations, away from Waterfront |
| --- | --- |
| Expo Line | Waterfront → Burrard → Granville → Stadium–Chinatown → Main Street–Science World |
| Canada Line | Waterfront → Vancouver City Centre → Yaletown–Roundhouse |

The order and the Waterfront interchange follow the [official SkyTrain network
map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/transit-system-maps/system-maps/skytrain_network_map.pdf)
and [TransLink’s station and entrance descriptions](https://www.translink.ca/schedules-and-maps/skytrain).
Granville and Vancouver City Centre remain separate stations. A journey between
the two simulated lines changes trains at Waterfront rather than inventing an
underground paid-area connection between Granville and Vancouver City Centre.

The Expo outward headsign describes King George / Production Way–University;
the Canada outward headsign describes YVR–Airport / Richmond–Brighouse. The
regional coverage limit does not rename Main Street or Yaletown as the real
network terminus. Return headsigns read Waterfront.

`lib/city/skytrain-network.ts` stores the station identities and selection
anchors. These anchors match the existing City of Vancouver station points in
`tools/assets/skytrain-stations-stage2/station-layout.json`; they are not
surveyed entrance, platform or train-door coordinates.

Main Street–Science World’s elevated runtime frame uses the midpoint of its
two retained directional GTFS platform anchors. That point is about 17.6 m
from the City selection anchor and keeps the representative platform and full
train clear of the neighbouring measured podium. Its selected passenger access
uses the authored east stationhouse and east stairs. The other six runtime
origins, original local station geometry and source hashes remain unchanged.
The retained western source layout intersects a neighbouring podium, so its
access connections are excluded from this implementation’s public walking
graph and an in-game barrier directs passengers east. This does not describe
a closure of the real station’s west entrance.
The [footprint audit](qa/skytrain-travel-20261022/station-footprint-audit.json)
records the source identities and sampled clearance; GTFS anchors still do not
establish surveyed platform or door positions.

## Distinguishing architectural references

| Station | Source-backed reference for the model |
| --- | --- |
| Waterfront | The Cordova heritage station provides access to the rail interchange. Expo and Canada Line have separate access routes and platforms; the common station does not imply one shared track. See the [station map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/waterfront_station.pdf) and [accessible entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/waterfront_station_elevator_map.pdf). |
| Burrard | Entrance and plaza at Burrard and Dunsmuir; underground Dunsmuir Tunnel platforms. The existing station package distinguishes stacked levels. See the [station map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/burrard_station.pdf) and the [historical TransLink-hosted SkyTrain engineering account](https://buzzer.translink.ca/wp-content/uploads/2010/07/skytrainmagazine01.pdf), which describes the tunnel’s two-level conversion. |
| Granville | Deep underground platforms and a pronounced escalator descent. TransLink describes the approximately 25 m descent and long escalators in its [2020 escalator upgrade report](https://buzzer.translink.ca/2020/07/translink-completes-granville-station-upgrades/). The [Granville / City Centre area map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/granville_vancouver_city_centre_station.pdf) places their separate entrances. |
| Stadium–Chinatown | Upper Beatty Street and lower Pacific Boulevard access, with a trackside station rather than another generic deep station. See the [station map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/stadium_chinatown_station.pdf) and TransLink’s [station description](https://www.translink.ca/schedules-and-maps/skytrain). Its historical extra platform is explained in [TransLink’s account](https://buzzer.translink.ca/2017/08/this-is-why-theres-an-unused-third-platform-at-stadium-chinatown-skytrain-station/); that is not an extra public line or a new ride destination. |
| Main Street–Science World | Elevated station, east and west stationhouses, stairs, escalators and elevator access. The [station map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/main_street_station.pdf), [east stationhouse opening](https://buzzer.translink.ca/2014/05/main-street-science-worlds-new-east-stationhouse-opens-today/) and [completed renovation description](https://www.translink.ca/news/2016/february/major%20upgrades%20begin%20at%20joyce%20collingwood%20skytrain%20station) support those distinctions. |
| Vancouver City Centre | Underground Canada Line station at Granville and West Georgia, with shopping-centre interfaces. See the [operator’s guide](https://thecanadaline.com/station-guides/vancouver-city-centre/) and [TransLink entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/vancouver_city_centre_station_elevator_map.pdf). The limited mall interface does not recreate the entire shopping complex. |
| Yaletown–Roundhouse | Street entrance at Davie and Mainland, leading to the underground station. See the [operator’s guide](https://thecanadaline.com/station-guides/yaletown-roundhouse/) and [station map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf). The existing package uses a pavilion, vertical circulation and a separate platform level. |

These sources establish station names, broad topology, approach streets and
recognizable design differences. Station maps are entrance diagrams, not
measured architectural floor plans. The existing offline assets explicitly
classify their dimensions, depths, local offsets and headings as representative.
Neither the model’s interior dimensions nor every material or fitting is a
survey-certified reconstruction. Historical articles describe completed or
historical work, not current construction status. No web photographs, videos,
operator floor-plan artwork or source textures are redistributed by this change.

During implementation, the station-model agent viewed the photograph on
TransLink’s [Granville upgrade report](https://buzzer.translink.ca/2020/07/translink-completes-granville-station-upgrades/).
The observed reference shows three parallel long escalators, dark rubber
handrails, white wall panels, a ribbed curved passage and fluorescent strips.
Original, low-cost runtime geometry recalls these features without copying the
photograph. This visual check did not inspect fresh station-map PDF pixels or
establish surveyed dimensions.

## Existing geographic and GTFS source packet

The repository already contains:

- `tools/transit/city-life-sources/transit-source-snapshot.json`: selected
  TransLink GTFS services, line-specific platform stops, projected shapes and
  source identities.
- `tools/assets/skytrain-stations-stage2/station-layout.json`: seven station
  layouts, line-specific platform identities, representative floor heights,
  approach/transfer structure and declared limits.
- `tools/assets/skytrain-stations-stage2/references/city-rapid-transit-stations.json`:
  the City of Vancouver station selection points. City attribution remains
  separate from TransLink’s route data.

The GTFS packet was retrieved on 2026-10-07 from [TransLink’s static
feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip), version
`26SEP_20261002`, with recorded effective dates 2026-09-07 through 2027-01-03.
It is an offline source snapshot. GTFS stop locations and shape projections do
not prove door alignment, boarding clearance, platform height or collision
safety; the runtime adapter must establish those independently.

The shipped route packet identifies this provenance as
`translink-gtfs-26SEP_20261002-regional-skytrain`. That logical release ID maps
to the local source file
`tools/transit/city-life-sources/transit-source-snapshot.json` above, with its
complete SHA-256 retained in `sourceSha256`. The source-only filesystem path is
kept in tooling, tests and documentation rather than shipped runtime data or
client code.

The network module’s default adjacent-stop lengths use the selected eastbound
Expo and southbound Canada cumulative shape distances from that packet:

| Line | Cumulative metres, in the station order above |
| --- | --- |
| Expo | 0; 958.398490; 1348.097375; 1997.277173; 3045.967091 |
| Canada | 0; 419.627991; 1578.753352 |

These interval differences are reused symmetrically by the pure default timing
policy. The city route adapter may use each direction’s actual source shape
and its adjusted rendered curve; the two directional GTFS shapes differ slightly.
The [machine-readable source summary](qa/skytrain-travel-20261022/network-source-summary.json)
records source hashes and selected service identities without changing the
offline source packet’s historical validation flags.

## Pure passenger lifecycle

`SkyTrainJourney` plans all same-line intermediate stops and, where needed, an
explicit Waterfront transfer. The clock progresses only through bounded live
updates; a hidden-tab-sized delta cannot skip a station or a boarding action.

1. Wait for a train; boarding becomes available with doors open.
2. Explicit boarding closes the doors before departure.
3. A continuous eased segment joins adjacent stations; boarding, cancellation
   and alighting are rejected while the passenger is aboard a moving train.
4. Every intermediate station opens the doors and permits alighting. A passenger
   who remains aboard continues after the dwell.
5. At a line transfer or destination, the train holds until explicit alighting.
   A transfer then needs a new boarding action, with the city adapter enforcing
   the physical station and platform route.

Default wait, boarding/door-closing and intermediate dwell are 4, 2 and 7 game
seconds. Default travel duration is the source segment length divided by 11.8
m/s, bounded to 30–150 seconds. Quintic easing has a 1.875 peak factor, keeping
these default source-length segments at or below approximately 80 km/h.
The city adapter can set duration from its actual curve length. This is a
playable offline service, not a live timetable, scheduled headway or guarantee
that present-day real service is operating.

## Focused verification

Supported Node 24.22.1: **20 / 20 pure network/lifecycle tests passed**.
Coverage includes all 42 ordered distinct origin/destination combinations,
reverse travel, the intermediate Canada Line stop, every Expo stop, continuous
arrival poses, stationary door closure before departure, explicit Waterfront transfer, intermediate alighting/reboarding,
terminal holds, timing validation, immutable metadata and invalid/large deltas.
The two owned files also pass strict oxlint and isolated strict TypeScript
checking. City geometry, UI, actual boarding proofs and browser acceptance are
separate integration checks owned by the city adapter.
