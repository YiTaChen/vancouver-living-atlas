# Stadium–Chinatown and Yaletown–Roundhouse interior references

Research date: 2026-10-23. The source models use station-local metres. The passenger topology and visible architectural features below are supported by photographs; dimensions, shaft extents and exact geographic alignment remain representative, not a measured interior survey.

## Stadium–Chinatown

### Passenger topology to preserve

- Regular Expo Line trains use the two sides of **one island platform**. A separate side platform and a third track are fenced off and must not be exposed as a normal public boarding route.
- The main west entrance is on **upper Beatty Street**. The lower concourse also serves the **Keefer Place** entrance. Stairs/escalator and elevator connect the main entrance, concourse and platform circulation.
- The east **Expo Boulevard** exit is a separate stair route down from the regular island. The spare platform is not reached through that public exit.
- The station is at the **Dunsmuir Tunnel portal**, with daylight over the platform area, rather than a fully enclosed underground cavern. White transverse steel trusses and pale curved platform canopies are distinctive.

### Reference register

| Source | Evidence and usage | Confidence |
| --- | --- | --- |
| [TransLink: Stadium–Chinatown accessible entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf) | Official street entrance relationship: Beatty Street, Keefer Place and Expo Boulevard / Dunsmuir Viaduct. This is an entrance map, not a dimensioned interior plan. | High for street access; no interior dimensions. |
| [TransLink: why the third platform exists](https://buzzer.translink.ca/2017/08/this-is-why-theres-an-unused-third-platform-at-stadium-chinatown-skytrain-station/) | Official photographs and description identify the spare platform behind a fence; its dedicated stair-only access is outside the normal station compound. Keep its geometry visible but disconnected from public navigation. | High. |
| [TransLink: station circulation during the 2010 Olympics](https://buzzer.translink.ca/2010/02/stadium-chinatown-station-how-it-works-for-the-olympic-period/) | Official diagrams and street photo establish distinct Beatty entry, Expo exit and Keefer entrance. Historical crowd routing is not a permanent one-way requirement. | High for entrance identities; historical operating pattern only. |
| [TransLink: elevator and escalator replacement](https://www.translink.ca/plans-and-projects/projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement) | The official station staircase photograph shows broad gray stairs with bright yellow nosings, red handrails, an adjacent escalator, full-height exposed concrete walls, a wood-toned slatted ceiling, high windows, and an elevator to the right. | High for photographed architecture. |
| [Direct official staircase photograph](https://www.translink.ca/-/media/translink/images/plans-and-projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement/ct_stadium_chinatown_station.avif?extension=avif&hash=53D7E156AA52173EB92796641B69F0E5) | Viewed during authoring. Use as the primary enclosure/handrail/stair finish comparison. | High. |
| [Emma0mb: Stadium Chinatown from above, 2020](https://commons.wikimedia.org/wiki/File:Stadium_Chinatown_from_above.jpg) | Original photograph, CC BY 4.0. Viewed during authoring: public island, additional fenced track/platform, white open trusses and curved canopy; solid concrete sidewalls and orange-red rails at the stairwell. | High for visible relationships. |
| [Ian Bryane / omb: station study](https://www.ianbryane.com/samples/stadium-chinatown-station) — [existing plan credited to TransLink](https://images.squarespace-cdn.com/content/v1/61fc64deb670127bdc81c770/84f2520c-87d8-4dc8-b9f5-65a1b37138ea/existing+plan.png) | The **Existing Platform Configuration** drawing records the public island, separate storage-track platform, end stairs and nearby pedestrian approaches. The site section distinguishes Beatty, Keefer, platform and Expo levels. Other renderings and plans on this portfolio page are **proposed** and were not used as existing construction. | High for existing-plan relationships; no surveyed numeric elevation. |

### Limits and acceptance

Do not interpret “three platforms” as three independent public side platforms. Do not invent escalators at the Expo Boulevard exit. The playable station should have enclosing retaining walls around descending stairs even when roof/soffit meshes fade for the overhead camera. Photo-backed details should be compared at the main entrance stair, island centre and east stair exit. Individual wall lengths and exact equipment locations require a measured plan or a new complete walkthrough to certify.

### Street anchor correction

The previously configured Beatty and “Pacific” coordinates were farther from the building than the named doors. The official entrance-map image was checked against the named `railway=subway_entrance` nodes in the [OpenStreetMap area API](https://www.openstreetmap.org/api/0.6/map?bbox=-123.111,49.2787,-123.108,49.2804), retrieved 2026-10-23. These are mapped coordinates rather than surveyed thresholds:

| Entrance | Longitude, latitude | Original mapped node |
| --- | --- | --- |
| Beatty Street | `-123.1101080, 49.2798687` | [3714304769](https://www.openstreetmap.org/node/3714304769) |
| Keefer Place | `-123.1096980, 49.2797570` | [3714304773](https://www.openstreetmap.org/node/3714304773) |
| Expo Boulevard | `-123.1084900, 49.2788731` | [3830176079](https://www.openstreetmap.org/node/3830176079) |

The corrected Beatty–Expo separation is approximately 161 m in the project's local projection. The station-model dimensions are still representative; the street attachment must preserve those named endpoints without replacing the authored internal circulation with a generic staircase.

### Mapped geometry incorporated in revision 2

The Stadium rebuild uses the mapped Beatty doorway as its horizontal origin and the runtime track bearing of 45.8078° in project X/Z coordinates. It no longer compresses the entrance route into two arbitrary 5 m staircases. Horizontal features were projected from the actual OSM node coordinates:

| Feature | Local X/Z metres | Evidence |
| --- | --- | --- |
| Main upper stair | `(0.50, 7.70)` → `(1.41, 20.74)`; run ≈13.07 m | [Stair way 569211454](https://www.openstreetmap.org/way/569211454), with parallel [escalator way 569478479](https://www.openstreetmap.org/way/569478479). |
| Lower concourse-to-platform stair | `(2.16, 32.87)` → `(2.44, 40.83)`; run ≈7.97 m | [Stair way 569211456](https://www.openstreetmap.org/way/569211456), with parallel [escalator way 569478482](https://www.openstreetmap.org/way/569478482). |
| Keefer doorway | `(11.84, 30.01)` | Named entrance node above. |
| Expo doorway | `(2.43, 161.49)` | Named entrance node above. |
| Restricted platform | West of the public island; mapped extent roughly `Z=56.3…136.2`, centre near `(-7.2, 96.2)` | [Platform 3 polygon 87222779](https://www.openstreetmap.org/way/87222779), explicitly tagged no public access. |

The regular island retains the existing 74 m boarding profile and is translated to `X=2.77, Z=96.2`, aligning its longitudinal centre with the mapped spare platform. All station-space train stop poses, sill points, waiting points, rails, tactile strips, exclusions and stored/deployed threshold geometry move together. Carriage-local door vectors and train dimensions remain unchanged. The exact public platform polygon was not available in this OSM extract; its centring is an inference from the photographed side-by-side platforms and the mapped spare polygon. This is explicitly recorded in model provenance.

Floor offsets and riser heights remain representative. The longer map-backed horizontal runs are not a claim that a measured vertical survey exists. The main lift cabin footprint is also representative: its location is beside the photographed access bank, with its walking clearances kept outside the stair and escalator lanes.

Physical acceptance executes the actual runtime pedestrian capsule through every flight in both directions, and every public entrance to the platform and back. Flat-room navigation also executes real walker steps around gates and walls; no elevator teleport is used to satisfy the walking routes. Stairwells have solid visible risers/supports and separate collision hulls below the tread envelope, so the capsule can climb while the structure remains closed.

### Photo-corroborated vertical scale in revision 3

The official Beatty photograph shows approximately **27 treads** in the main flight. The project's city-terrain sampler gives 15.4729 m and 10.9838 m at the mapped upper-flight ends, a 4.4891 m terrain difference. Those independent observations support a representative **4.5 m** stair rise with 27 risers of approximately 0.167 m. The previous 2.5 m/15-riser main flight understated the photographed staircase.

The revised local floor offsets are street `0`, main concourse `-4.5`, regular island `-8`, and Expo doorway `-12.85` m. The lower stair retains its mapped 7.97 m horizontal run and has a representative 3.5 m rise. The east stair route descends 4.85 m from the island to the Expo exit. These floor elevations are an inference to reproduce the observed proportions; terrain interpolation and photographs do not constitute an interior level survey. In particular, a terrain sample under a bridge does not measure its walking surface.

The island's vertical move is rigid: platform floors, train stop poses, rails, tactile strips, station-space sill/edge/waiting points, track-exclusion heights, and stored/deployed threshold geometry all shift together by the same amount. Carriage-local geometry remains unchanged. Tests explicitly require 27 main-flight treads, correct rises, unchanged carriage-local fields, consistent exclusions/threshold heights and clear boarding points.

### Keefer Place is a raised entrance

The [official accessible-entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf) explicitly draws an elevator/ramp approach from Keefer Place to the station entrance. The mapped station doorway is tagged level 3; the Beatty doorway is level 4, while the regular platform and spare platform are associated with the next lower level. The concourse doorway must therefore be attached to the raised pedestrian structure, rather than forced down onto raw terrain.

Using the project's sampled Beatty-door terrain of 17.047 m as a comparison datum, the model concourse is near 12.547 m. Terrain beneath the mapped Keefer doorway is approximately 7.5479 m, about **5 m below** that representative concourse floor. This is evidence of a missing bridge/surface attachment in a terrain-only adapter, not evidence that the whole concourse should be lowered another 5 m. Relevant mapped approaches include the [Keefer footway 367513830](https://www.openstreetmap.org/way/367513830), [20-step approach 367513829](https://www.openstreetmap.org/way/367513829), and [17-step bridge approach 367513823](https://www.openstreetmap.org/way/367513823). The official map also shows a separate accessible elevator/ramp route farther east.

The station source retains a level concourse-to-Keefer doorway and identifies it as a raised bridge attachment. Correct city integration should first bind that doorway to the existing rendered pedestrian deck, or author the evidenced bridge/approach from its mapped footprint and appropriate deck height. It must not manufacture a direct ramp through the station wall, or silently snap this raised entrance to the ground DEM. The exact public-deck elevation and relationship to the residential-development elevator remain unmeasured.

### Passenger seating

Both station templates provide metal waiting benches in the central island furniture zone, outside the stair wells and train-door waiting positions. The [Yaletown passenger photograph](https://ir.4sqi.net/img/general/original/174611_73o49VH6umvjxvneKUFlUXkdZoYj6QgvGvhuadEeeAI.jpg), reached through the station's [photo gallery](https://www.mapquest.com/ca/british-columbia/yaletown-roundhouse-skytrain-station-456477532), visibly shows pale metal seating against the island spine. Exact bench offsets, lengths and counts remain representative; the existing source photographs do not provide a furniture survey. The capsule circulation and all boarding points are rechecked after adding the solid bench bodies.

## Yaletown–Roundhouse

### Passenger topology to preserve

- There is **one underground island platform** between two Canada Line tracks, with a central service/circulation spine and walkways along both track edges.
- The single glass station house is at **Davie Street and Mainland Street**. Its street-to-concourse route is a **two-flight switchback staircase with an intermediate landing**, accompanied by escalator provision, inside a full-height concrete shaft.
- The concourse is a distinct ticket/fare-gate level. A separate stair/escalator bank descends through the island's central spine to the platforms; a lift provides step-free access between levels.
- Modern gates must reflect the June 2026 change to **five gates, including two accessible gates**. Opening-era photographs predate those gates and the added 2019 platform escalator.

### Reference register

| Source | Evidence and usage | Confidence |
| --- | --- | --- |
| [TransLink: Yaletown construction photo tour](https://buzzer.translink.ca/2008/12/canada-line-photos-yaletown-station-construction/) | Official photo captions explicitly describe two stair flights between the entrance and concourse, the intermediate landing, precast concrete platform stairs, brushed stainless escalator finishes, and a roughly 15 m-deep platform during construction. | High for topology; construction-era depth is approximate. |
| [Official lower entrance flight photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/05-yaletown-station.jpg) | Viewed during authoring: stairs and adjacent escalator shaft, tall solid concrete walls. | High for structural relationship. |
| [Official intermediate landing photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/07-yaletown-station.jpg) | Viewed during authoring: reversed second stair flight across the landing and concrete upper-flight structure. Confirms switchback circulation rather than a continuous straight entrance descent. | High. |
| [Official upper entrance flight photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/08-yaletown-station.jpg) | Viewed during authoring: upper staircase and separate escalator opening rise to the glass station house level. | High. |
| [Tafyrn & Seamora: opening-era station walkthrough photographs](https://canadalinephotos.blogspot.com/search/label/Yaletown%20-%20Roundhouse) | Original photography, CC BY 2.5. Platform stair, escalator, concourse, intermediate landing and station plan photographed in sequence. Viewed contact sheet during authoring. | High for visible architecture; 2009 equipment count is superseded. |
| [Platform photo 07](https://commons.wikimedia.org/wiki/File:Yaletown%E2%80%93Roundhouse_station_07.jpg) | Original opening-era photograph viewed at full size: gray rectangular floor tiles, yellow tactile strip, charcoal wall across the track with framed advertisement panels, angled white ceiling panels, blue/white striped square columns and long linear lights. | High for finishes. |
| [Platform photo 08](https://commons.wikimedia.org/wiki/File:Yaletown%E2%80%93Roundhouse_station_08.jpg) | Original photograph viewed at full size confirms bored circular tunnel at platform end and the central circulation structure behind the platform walkway. | High. |
| [TransLink: June 2026 fare-gate expansion](https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility) | Official current gate count: five total, including a second accessible gate. | High/current. |
| [TransLink: new platform escalator opens, August 2019](https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/) | Official article confirms the new platform-to-concourse escalator is an up escalator and both lower escalators operate up. Do not label the new lane as a down escalator. | High. |
| [TransLink: station entrance map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf) | Official geographic context and single station entrance relationship to Davie/Mainland. This is not an interior construction plan. | High for location, not interior dimensions. |

### Limits and acceptance

The exact shaft and island dimensions are not certified by the available maps. A photograph of a track-facing platform walkway can look like a separate side platform because the island's central stair/service block blocks the opposite edge; retain the correct island relationship. The source should expose complete walls, landing slabs, balustrades and a ceiling shell around the entrance route. Camera cutaway may fade those overhead meshes, but physical enclosure must remain modeled. Acceptance views should include the street headhouse, switchback landing, concourse gates, lower stair/escalator bank, and both track-edge walkways.
