# Autonomous full-route SkyTrain service

`public/data/transit/skytrain-world-routes.json` is an additive export from the
official [TransLink GTFS archive](https://gtfs-static.translink.ca/gtfs/google_transit.zip).
The downloaded archive is ignored under `work/open-world-transit/`; the previous
regional source packet and `public/models/skytrain-routes.json` remain unchanged.

The supplied archive is 16,152,668 bytes, feed `26SEP_20261016`, SHA-256
`0d73f848750b2a48f227916568764f51124fd9314d59eb1e2acb3dd342aed8f8`.
The feed declares 2026-09-07 through 2027-01-03; active trip selection uses
2026-10-22. Feed-version tokens are not independently authenticated publication
dates. The export includes TransLink's required legend and
[data terms](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data).

The selected complete trips cover Waterfront–King George (20 stops each way)
and Waterfront–Richmond-Brighouse (14 stops each way, including Capstan).
Both directions retain their own source trip, stop/platform IDs and shape.
Main Street–Science World and Yaletown–Roundhouse remain intermediate stations.
The airport and Production Way branches are outside this service selection.

```sh
python3 tools/transit/import_skytrain_world.py \
  --feed work/open-world-transit/google_transit.zip
python3 tools/transit/import_skytrain_world.py \
  --feed work/open-world-transit/google_transit.zip --check
```

The generator selects the most frequent complete active stop/shape pattern for
each direction, then a deterministic trip departing after 10:00 when available.
It projects scheduled stops monotonically onto that trip's shape and partitions
the shape at those projections. Every interior source vertex survives; only
partition endpoints are interpolated. Per-route hashes cover selected trip,
stop-time, stop and shape rows. The export also records projection offsets and
retained-vertex counts/hashes. No geographic clipping creates a downtown terminal.

`WorldSkyTrainRun` is a renderer-independent analytic round trip. Its state
depends on elapsed simulation seconds and a fixed initial offset. Passenger
presence, controls, proximity, visibility and detail loading cannot hold its
clock. Each source stop has 0.65 s door opening, 18 s dwell and 0.65 s closing.
Travel uses quintic distance easing, an illustrative mean speed at most 11.5 m/s,
peak speed at most 22 m/s and acceleration at most 1.4 m/s². The actual terminals
have a separate 45 s physical crossover phase. This timing and spacing are an
offline simulation, not published schedules or live arrivals.

`SkyTrainMotionPath` lets the original authored core paths and the new full-route
paths drive the same articulated GLB cars. Full-route legs keep source bends and
exact provided station poses; vertical terrain offsets remain representative.
`SkyTrainTerminalPath` uses a straight platform lead, a gentle parallel-track
crossover, clear tail track, a full stop, and reverse travel to the other origin.
Its normalized input is linear terminal phase time. It eases each half itself;
car sampling switches branch only after the whole consist clears the crossover.
The same car frame continues across reversal without a spin or endpoint warp.

`SkyTrainWorldExteriors` supplies separate exterior-only city stock without
loading the cabin assets. Its representative dimensions and three paired-door
centres per side follow the already reviewed Mark V/Canada source packages.
Rounded shells, raked observation ends, silver/blue/gold livery, separate window
bays, bogies, roof equipment, gangways and directional lamps are merged into
shared car geometries. Four Expo cars use ten draws; two Canada cars use six.
Forty instances still share fourteen geometries and four materials. Cabin detail
can take over nearby without making Orbit allocate interior textures or lamps.

CPU verification covers full-route source identity/order and regeneration,
autonomous clocks through all off-map stops, bounded speed/acceleration,
real GLB articulation across the downtown edges and the actual Waterfront
terminal frames. Camera tests additionally sweep real Waterfront roof geometry
and verify standing/seated avatars remain framed beneath a ceiling.
