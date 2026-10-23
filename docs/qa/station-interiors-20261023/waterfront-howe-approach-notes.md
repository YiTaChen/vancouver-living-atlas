# Waterfront — Howe Street approach evidence

Research date: 2026-10-23. These notes support an additional western Expo entrance. No proposed Waterfront redevelopment drawing is treated as existing station construction. Interior floor elevations and exact widths remain unmeasured.

## Actual upper bank photograph

The [TransLink report of 9 April 2021](https://buzzer.translink.ca/2021/04/links-tidbits-new-escalators-at-waterfront-transit-priority-signal-at-metrotown-and-more/) includes an [original full-size Howe Street photograph](https://buzzer.translink.ca/wp-content/uploads/2021/04/New-escalators-at-Waterfront-Stations-Howe-Street-entrance-1.jpg), downloaded and viewed at `/tmp/howe-entrance-escalators.jpg` during research. It shows:

- A central gray concrete staircase flanked by **one escalator on each side**. Stainless steel skirts/balustrades and black handrails enclose the complete bank.
- A low cream/beige panel ceiling over the lower landing, with circular recessed lights and black trim.
- Gray and muted pink/brown square floor tiles across the landing, with metal escalator approach plates.
- Overhead wayfinding sends passengers forward/up to Howe Street, Canada Place and the Convention Centre; a separate arrow points **left** to Waterfront Centre and Sinclair Centre. That branch belongs beside the upper bank's lower landing, not at the bottom of the platform stair.

The [May 2020 maintenance report](https://buzzer.translink.ca/2020/05/why-are-escalators-at-skytrain-stations-out-of-service-so-often/) independently describes two escalators at Howe. It distinguishes that route from the Expo east-end bank leading toward the heritage station, SeaBus and West Coast Express. The [June 2020 east-bank closure notice](https://buzzer.translink.ca/2020/06/waterfronts-expo-line-eastern-entrance-to-temporarily-close/) says the remaining Expo access was via Howe and there was no elevator route during that closure. Do not add a fictional Howe elevator or merge this entrance into the Cordova eastern access bank.

## Geographic and mapped horizontal chain

The [GTFS specification's Waterfront example](https://gtfs.org/documentation/schedule/examples/pathways/) places Howe entrance node 94 at longitude/latitude `-123.113367,49.286898` and marks it inaccessible for wheelchair boarding. This is an educational example rather than a fresh station survey. The actual mapped [OSM entrance node 3633792226](https://www.openstreetmap.org/node/3633792226) at `-123.1133920,49.2868766` corroborates the location within a few metres.

The OSM geometry below was read from the current station area extract. Runs are calculated in the project's own geographic projection, not estimated from camera perspective:

| Segment                                                                             | Mapped coordinates, longitude/latitude                                                          | Projected horizontal length                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Upper staircase, way 379737506](https://www.openstreetmap.org/way/379737506)       | Howe `(-123.1133920,49.2868766)` → lower bank landing `(-123.1135157,49.2867838)`               | 13.689 m                                                      |
| [Landing passage, way 379897377](https://www.openstreetmap.org/way/379897377)       | Lower bank landing → junction `(-123.1135943,49.2867245)`                                       | 8.726 m                                                       |
| [Passage to lower bank, way 358462240](https://www.openstreetmap.org/way/358462240) | Junction → lower stair top `(-123.1135007,49.2866809)`                                          | 8.352 m                                                       |
| [Lower staircase, way 689601479](https://www.openstreetmap.org/way/689601479)       | Lower stair top → platform end `(-123.1133299,49.2866170)`                                      | 14.297 m                                                      |
| [Commercial passage, way 567734054](https://www.openstreetmap.org/way/567734054)    | From the junction toward the northwest, through the Waterfront Centre/Convention Centre complex | Mapped covered corridor; complete branch not dimensioned here |

The supported topology is therefore: **Howe street → central stair/two flanking escalators → lower landing and passage junction → platform access passage → lower stair/escalator bank → Expo island west end**, with the commercial corridor branching from the intermediate junction. The upper and lower access flights have different horizontal directions; they should not be compressed into a single straight staircase. The [official December 2020 BCRTC Q3 report, page 2](https://www.translink.ca/-/media/translink/documents/about-translink/governance-and-board/board-of-directors/board-minutes-and-reports/2020/december/2020_12_17_public_board_meeting_agenda.pdf) explicitly identifies one up escalator between the Expo platform and the Howe street bank, alongside the two east-end units and two Howe street units. The lower escalator count is therefore official evidence; its precise side beside the lower stairs still needs a clear current photograph before detailed equipment registration is claimed.

The city's terrain samples at these five OSM points are approximately 15.30, 15.33, 15.50, 15.25 and 14.74 m. These describe ground/building context, **not** the underground landing and platform elevations. They must not flatten the two descending access levels onto the terrain surface. Set a representative interior section from stair/photo evidence and align its street threshold to actual ground.

## Existing fare boundary photograph

[The first-hand Kenneth Chan / Daily Hive photograph, July 2018](https://images-dh-production-baselayer.dailyhive.com/uploads/2018/07/expo-line-waterfront-station-fare-gates.jpg)
was downloaded and inspected at full available resolution. It shows five lanes,
six housings, a wider end lane, perforated acoustic side panels, a low flat
ceiling and exit signage for Howe Street, Waterfront Centre and Sinclair Centre.
This establishes an existing fare boundary, rather than a proposal.

The exact gate coordinate is not mapped. The reconstruction places the boundary
on the middle-level route **after** the unpaid mall T-junction and **before** the
lower platform bank; exact offset and width remain representative. This preserves
public mall access without fare validation and requires every Howe-to-platform
route to cross the five-lane boundary. The dedicated test physically traverses
all lanes, rejects outer-wall bypasses, and walks the unpaid mall return route.
It does not claim that the photograph measures the hidden lower-bank side.

## Remaining acceptance needs

- Verify a complete present-day lower-bank photograph or walkthrough, including the exact stairs/escalator relationship, the distance from the separately photographed fare boundary, and the platform opening.
- Preserve an unpaid commercial branch at the photographed junction. Commercial opening hours and the complete internal mall path are unverified.
- Author full enclosing stair walls, intermediate floors and ceilings. Camera cutaway can fade the ceiling; walls and support geometry remain physical.
- Check street → upper bank → junction → lower bank → Expo island and the reverse using the actual capsule walker, including the commercial branch portal. No elevator shortcut can satisfy the Howe walking route.

## Final Cordova datum correction

The phase4 primary anchor is the [survey-tagged Cordova door OSM1692226746](https://www.openstreetmap.org/node/1692226746), `[-123.1120035,49.2856425]`, rather than the old repository-only point. Howe's source X/Z stays `[-64.79375356,92.21254299]`: changing the primary source point and geographic anchor together preserves Howe's true world location. The complete station-frame Y rebase is −0.04462962285 m, so Howe's source street Y is now approximately +2.14727 while its world street height remains 15.29747 m. See the [phase4 section and datum record](waterfront-mapped-phase4.md).
