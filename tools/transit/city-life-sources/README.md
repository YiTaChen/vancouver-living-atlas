# City Life & Transit: offline official-source extraction

This is a bounded source-data package for `docs/CITY_LIFE_TRANSIT_SPEC.md` phase A and the D01–D06 contracts. It is **not an operating transit runtime, completed station-layout package, or geographic boarding acceptance**. No production scene, package dependency, camera range, illumination or existing city geometry is changed here.

Base revision: `401569193ccda73e8f6a6fd96e4bdb144ef5a4c6` (merged PR #5 offline assets). The spec's older `5574d557` inventory is not treated as current code. Existing vehicle contracts remain `low-floor-bus-12m` and `expo-metro-17m`; Canada has a separately named, explicitly unresolved profile and cannot borrow Expo's dimensions or door positions.

## Files and evidence

- `import_gtfs.py`: Python standard-library importer, pure projection/calendar tests, source validator, and separate fail-closed ride-readiness gate
- `transit-source-snapshot.json`: stable Atlas IDs, official source IDs, ordered stops, planar source shapes, cumulative path stations, source-block continuity evidence and unresolved physical contracts
- `gtfs-selection-evidence.json`: compact verbatim source rows for the selected routes/trips/core stops, selected service calendar, pattern selection counts/alternatives shape hashes and all active trip endpoints in the example bus blocks
- `../../../tests/city-life-transit-sources.test.mjs`: fixture joins, scope, source provenance, continuity and negative readiness tests

The complete approximately 16 MB ZIP is intentionally not committed. `shapes.txt` is not copied wholesale. All 212 vertices of the four selected full bus shapes are retained. Rail retains 204 core vertices/cut endpoints. Only first/last rail endpoints are interpolated; intermediate vertices are never simplified or replaced with two-stop straight lines. Full selected shape row hashes provide additional replay evidence when the ZIP is available.

## Source and dates

Official download: <https://gtfs-static.translink.ca/gtfs/google_transit.zip>

- Retrieved: **2026-10-07 17:48:16 UTC**
- Archive bytes: **16,145,585**
- Archive SHA-256: `67fe970456c4640e030f7c991012e720f0b0e7d7af58a7ca3457b4ecd0650682`
- Actual `feed_version`: **26SEP_20261002**, still matching the spec's named snapshot
- Actual schedule effective interval: **2026-09-07 through 2027-01-03**
- HTTP Last-Modified: **Fri, 02 Oct 2026 13:35:51 GMT**
- Selection service day: **2026-10-07, America/Vancouver**

The retrieval time, HTTP modification time and version's date token are distinct from effective schedule dates. `feedPublishedDate` is null because this package did not independently authenticate a publication date. The importer checks the selection date against feed effective bounds, evaluates `calendar.txt` and `calendar_dates.txt`, and handles GTFS times after 24:00. Times in evidence are static source evidence, not a runtime clock or live arrivals.

The [official GTFS terms](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data) were inspected on the retrieval date. Download/use is subject to their implicit terms. Section 4 requires the exact prominently displayed data legend; a future consumer must place the current official legend alongside its data/attribution UI. This package has no runtime presentation and does not claim that placement is completed. The feed's rights remain with TransLink; the repository license does not relicense it, and use of data does not grant official-logo/trademark rights.

## Selected scope

For each selected route/direction, the importer chooses the most frequent active full stop-pattern/shape on the selection day, breaks ties lexically by source shape ID, then selects the first representative departure at or after 10:00 service-day time. The evidence lists other patterns; short workings are not silently merged into the chosen route. Every stop of each chosen bus trip is in core and retained. Runtime labels must remain “區域內模擬服務”; the full source rail headsign describes an external destination only as source context.

| Atlas service | GTFS route | Direction | Shape | Representative trip | Retained stops |
| --- | --- | --- | --- | --- | ---: |
| bus-5:eastbound | 6615 | 0 | 321184 | 15441837 | 14 |
| bus-5:westbound | 6615 | 1 | 321187 | 15441967 | 14 |
| bus-6:eastbound | 6616 | 0 | 321189 | 15442508 | 13 |
| bus-6:westbound | 6616 | 1 | 321191 | 15442638 | 14 |
| expo:eastbound | 30053 | 0 | 322353 | 15521997 | 5 |
| expo:westbound | 30053 | 1 | 322371 | 15522504 | 5 |
| canada:northbound | 13686 | 0 | 322331 | 15501198 | 3 |
| canada:southbound | 13686 | 1 | 322336 | 15501510 | 3 |

Core is longitude **−123.165…−123.095**, latitude **49.267…49.315**. Every retained shape coordinate and service stop passes this check. Rail is cut to its first and last in-core scheduled-stop projections, excluding out-of-core track and stops.

Expo station order is Waterfront → Burrard → Granville → Stadium–Chinatown → Main Street–Science World (reverse for westbound). Canada order is Waterfront → Vancouver City Centre → Yaletown–Roundhouse (reverse for northbound). There are **7 station entities, 8 station×line entities, 16 directional rail platform records**, plus **55 bus stop occurrences**. SeaBus, WCE, Millennium, Olympic Village and VCC–Clark are excluded. Waterfront's shared source parent does not bring other routes' children into the fixture: route/trip/stop_times membership selects the line.

`sourceStopId` and `stopCode` are separate strings. Burrard Bay 1 is source stop **8535**, public code **50043**, Atlas service stop `bus-5:westbound:burrard-station-bay-1`. Source ID changes do not directly change the Atlas ID; a changed stop name still requires reviewed identity migration. Waterfront's Expo and Canada station-line IDs are `waterfront:expo` and `waterfront:canada`. Canada uses **P5 / stop 11303 northbound** and **P4 / stop 11302 southbound**; Expo uses P1/P2. These platform labels establish a GTFS service identity, not a measured door side or floor height.

## Real block continuity; no invented turn

The importer examines **all active trips in affected bus blocks**, including other routes/patterns, before selecting adjacent pairs. Filtering only routes 5/6 first could falsely make nonadjacent trips consecutive. It finds these exact source-backed cycles:

1. 5 eastbound → 6 westbound → 5 eastbound, sharing stops 81 and 613
2. 6 eastbound → 5 westbound → 6 eastbound, sharing stops 10591 and 639

There are 109, 112, 111 and 119 adjacent active trip pairs supporting those edges respectively. One real block/trip/time example per edge is retained; this is **not a claim that a particular live bus is currently running**.

### Critical shape-tail rule

The full source bus shapes extend **35–141 m beyond the first/last scheduled stop projections**. Their raw shape endpoints are **151–180 m apart** across these transitions. Simply concatenating those raw endpoints is invalid.

Each service supplies `servicePathIntervalM = [firstScheduledStopProjection, lastScheduledStopProjection]`. Traverse that interval, preserving the full source shape only as evidence. The four scheduled-stop seams have **0 m projected position gap and 0° source segment heading difference**, so trimming overlapping tails produces two continuous *planar source* cycles without drawing a new connector or inventing a Davie/Denman U-turn. `planarJoinAtScheduledStop` records the exact intervals and projections.

This is still not a legal, collision-tested runtime lane connector. Road-side offsets, continuous ground elevation, lane identity, stop occupancy, curb alignment and traffic control remain unverified. `runtimeContinuationEnabled` and `boardingEnabled` are false, and the ride-readiness gate rejects their use. Preserve vehicle and passenger identity across any eventual 5↔6 destination/service change. If validation is not ready, the vehicle must stop and wait; occupied vehicles may never disappear, teleport or recycle.

No rail crossover or reverse-direction connector is inferred. `returnTrackCrossover` is null for both lines. A regional boundary is not asserted to be a true operating terminus. At the boundary, hold for valid unloading; reclaim only an empty, unseen vehicle with no pending handoffs unless a separately validated return track/block contract exists.

## Exact approximations and unresolved work

Planar geometry uses an explicitly recorded local equirectangular metric (mean Earth radius 6,371,008.8 m, reference latitude 49.281°) solely for offline cumulative stations and nearest monotonic stop projection. It is not Atlas world XYZ or a survey. The largest stop-to-shape offset is approximately **25.45 m** for rail and **10.54 m** for bus; this alone rules out treating the GTFS stop point as a vehicle doorway.

All of the following remain null/not_run/unresolved, never measured zero:

- Road/rail elevation, bridge/ground identity, tunnel depths, gradients and Expo's vertically stacked Dunsmuir guideways
- Actual road lanes, right-of-way, junction control, curb poses and stopping envelopes
- Door side, opening alignment, platform dimensions, track exclusion, boarding/alighting regions and local-to-world station transforms
- Station street entrances, floor layers, stairs/elevators, accessible paths and Waterfront's physical walking transfer
- Distinct Canada vehicle dimensions, consist, door spacing and platform interface
- Regional rail return track/block/crossover strategy; no passenger return is implied
- Mesh/collision/environment openings, terrain masking, runtime station layouts and camera/vehicle/occupancy handoffs
- Geographic scene integration, WebGL screenshots, human scale, input/touch paths and repeated journeys

The [City of Vancouver station API](https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/rapid-transit-stations/records?limit=100) and [line API](https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/rapid-transit-lines/records?limit=100) were **not fetched/verified for this delivery**: the attempted optional read's approval was cancelled before a decision, and it was not retried. Station GIS verification stays `not_run`. Official station-map URLs from the supplied spec are retained per station but their PDF contents/layouts were **not inspected** here. They are follow-on references, not evidence that entrances or interior dimensions have been built or checked. GTFS parent anchors are explicitly labeled as parent station points, not entrances or precise platform centers.

## Reproduce and validate

Requires Python 3.10+ and Node 22.13+ (repository baseline). No Python packages, Node packages, browser or network are required for the checked-in tests.

To reproduce using the original downloaded ZIP, from the repository root:

```sh
python3 tools/transit/city-life-sources/import_gtfs.py \
  --gtfs /tmp/vancouver-transit-source/google_transit.zip \
  --out /tmp/city-life-transit-replay \
  --service-date 2026-10-07 \
  --retrieved-at 2026-10-07T17:48:16Z \
  --http-last-modified 'Fri, 02 Oct 2026 13:35:51 GMT' \
  --expect-sha256 67fe970456c4640e030f7c991012e720f0b0e7d7af58a7ca3457b4ecd0650682
cmp tools/transit/city-life-sources/transit-source-snapshot.json /tmp/city-life-transit-replay/transit-source-snapshot.json
cmp tools/transit/city-life-sources/gtfs-selection-evidence.json /tmp/city-life-transit-replay/gtfs-selection-evidence.json
```

The official URL rotates. If fetching now, use `--download --gtfs /tmp/google_transit.zip`; this records the real retrieval timestamp/HTTP header. Specify a service date in that actual feed, review the new source/version/hash, and regenerate deliberately. A new download cannot claim the old hash or retrieval time. `--expect-sha256` fails rather than silently accepting a new feed. Keep the archive outside the checkout.

```sh
node --test tests/city-life-transit-sources.test.mjs
python3 tools/transit/city-life-sources/import_gtfs.py --self-test
python3 tools/transit/city-life-sources/import_gtfs.py \
  --validate tools/transit/city-life-sources/transit-source-snapshot.json
```

The source validation is expected to pass. **The next command must always exit 1 for this source-only schema**. Ride readiness requires a separately implemented and reviewed runtime-package validator that checks actual geometry/profile/frame/connector bindings; it cannot be enabled by filling placeholders or flipping status flags:

```sh
python3 tools/transit/city-life-sources/import_gtfs.py \
  --validate tools/transit/city-life-sources/transit-source-snapshot.json \
  --require-ride-ready
```

The rejection is tested independently, including a negative test that flips unrelated boarding/profile/geometry flags but leaves bus continuations unresolved. Source validation passing is never a synonym for ride readiness. The future runtime consumer must honor this separation; there is no production consumer in this package.

Independent review found and fixed a flag-only readiness bypass: setting every status to passed could previously promote invalid placeholder data. The source schema now categorically refuses ride readiness, even when every flag is forged. An adversarial test covers empty identities, invalid elevation and door side, and unchanged planar path geometry.
