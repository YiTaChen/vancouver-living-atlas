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

Floor offsets and riser heights remain representative. The longer map-backed horizontal runs are not a claim that a measured vertical survey exists. The main lift cabin footprint is also representative: its location is beside the photographed access bank, with its walking clearances kept outside the stair and escalator lanes. The model connects the three authored public levels; it does not claim a complete all-stops elevator inventory. An uncorroborated four-floor enthusiast report is not used to invent staff-level or Expo-exit stops.

Physical acceptance executes the actual runtime pedestrian capsule through every flight in both directions, and every public entrance to the platform and back. Flat-room navigation also executes real walker steps around gates and walls; no elevator teleport is used to satisfy the walking routes. Stairwells have solid visible risers/supports and separate collision hulls below the tread envelope, so the capsule can climb while the structure remains closed.

### Photo-corroborated vertical scale in revision 3

The official Beatty photograph shows approximately **27 treads** in the main flight. The project's city-terrain sampler gives 15.4729 m and 10.9838 m at the mapped upper-flight ends, a 4.4891 m terrain difference. Those independent observations support a representative **4.5 m** stair rise with 27 risers of approximately 0.167 m. The previous 2.5 m/15-riser main flight understated the photographed staircase.

The revised local floor offsets are street `0`, main concourse `-4.5`, regular island `-8`, and Expo doorway `-12.85` m. The lower stair retains its mapped 7.97 m horizontal run and has a representative 3.5 m rise. The east stair route descends 4.85 m from the island to the Expo exit. These floor elevations are an inference to reproduce the observed proportions; terrain interpolation and photographs do not constitute an interior level survey. In particular, a terrain sample under a bridge does not measure its walking surface.

The island's vertical move is rigid: platform floors, train stop poses, rails, tactile strips, station-space sill/edge/waiting points, track-exclusion heights, and stored/deployed threshold geometry all shift together by the same amount. Carriage-local geometry remains unchanged. Tests explicitly require 27 main-flight treads, correct rises, unchanged carriage-local fields, consistent exclusions/threshold heights and clear boarding points.

### Keefer Place is a raised entrance

The [official accessible-entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf) explicitly draws an elevator/ramp approach from Keefer Place to the station entrance. The mapped station doorway is tagged level 3; the Beatty doorway is level 4, while the regular platform and spare platform are associated with the next lower level. The concourse doorway must therefore be attached to the raised pedestrian structure, rather than forced down onto raw terrain.

Using the project's sampled Beatty-door terrain of 17.047 m as a comparison datum, the model concourse is near 12.547 m. Terrain beneath the mapped Keefer doorway is approximately 7.5479 m, about **5 m below** that representative concourse floor. This is evidence of a missing bridge/surface attachment in a terrain-only adapter, not evidence that the whole concourse should be lowered another 5 m. Relevant mapped approaches include the [Keefer footway 367513830](https://www.openstreetmap.org/way/367513830), [20-step approach 367513829](https://www.openstreetmap.org/way/367513829), and [17-step bridge approach 367513823](https://www.openstreetmap.org/way/367513823). The official map also shows a separate accessible elevator/ramp route farther east.

The station source retains a level concourse-to-Keefer doorway and identifies it as a raised bridge attachment. Correct city integration should first bind that doorway to the existing rendered pedestrian deck, or author the evidenced bridge/approach from its mapped footprint and appropriate deck height. It must not manufacture a direct ramp through the station wall, or silently snap this raised entrance to the ground DEM. The exact public-deck elevation and relationship to the residential-development elevator remain unmeasured.

The staged city-access patch follows the actual mapped western pedestrian approach: the 20-step flight runs from `-123.1097920,49.2799124` to `-123.1097145,49.2798668`, then way 367513830 turns through the mapped concrete footway to the Keefer doorway. The city ground samples at these two stair endpoints are 14.3758 and 11.6754 m. The final station deck is approximately 12.547 m under the photo-corroborated station-level inference. The resulting residual 0.872 m rise is distributed along the mapped concrete approach (approximately 18 m), consistent with the official map's ramp provision; its exact slope and deck elevation remain **unmeasured**. This is an explicit representative interpretation of the evidenced route, rather than a claim to have surveyed the bridge.

The street ownership threshold is at that external stairhead, on actual city ground. The station's named Keefer door remains at its mapped coordinate on the raised concourse. A passenger below the door on the raw DEM cannot warp onto the deck. The external route has twenty solid tread surfaces, a separate bottom landing, concrete slab support, parapets and handrails, and stays open to the sky. The separate 17-step/eastern residential elevator approach is not inferred from this western route; its complete elevations and structural dimensions remain to be verified before authoring.

Staged integration verification uses the production open-world station owner with the actual city terrain: all three entrances reach the regular island and return to a street handoff; walking rises stay within 0.221 m per small input step. A separate regression cuts a real opening in the Beatty floor triangle mesh and verifies that the adapter does not treat its bounding box as a supporting slab. Before the staged patch is applied, these checks are stored with `tools/station-interiors/stadium-street-access.patch`, avoiding any premature change to published station data.

### Passenger seating

Both station templates provide metal waiting benches in the central island furniture zone, outside the stair wells and train-door waiting positions. The [Yaletown passenger photograph](https://ir.4sqi.net/img/general/original/174611_73o49VH6umvjxvneKUFlUXkdZoYj6QgvGvhuadEeeAI.jpg), reached through the station's [photo gallery](https://www.mapquest.com/ca/british-columbia/yaletown-roundhouse-skytrain-station-456477532), visibly shows pale metal seating against the island spine. Exact bench offsets, lengths and counts remain representative; the existing source photographs do not provide a furniture survey. The capsule circulation and all boarding points are rechecked after adding the solid bench bodies.

## Yaletown–Roundhouse

### Passenger topology to preserve

- There is **one underground island platform** between two Canada Line tracks, with a central service/circulation spine and walkways along both track edges.
- The glass station house is at **Davie Street and Mainland Street**, with independently mapped stairs and street-lift doors. The street-to-concourse route is a **two-flight switchback across the platform axis**, accompanied by escalators, inside a full-height concrete shaft.
- The lower concourse is a long hall above and parallel to the island, reached through a lateral unpaid entrance branch and fare gates. A **broad standalone staircase and a separate, longitudinally offset two-escalator bank** descend along the platform axis. The staircase is not squeezed between the two escalators.
- **Two separate lift cores** provide street-to-concourse and concourse-to-platform access. The street lift lands in the entrance branch; the platform lift is at the other end of the paid hall. A single shaft serving three floors does not match the installed evacuation plan.
- Modern gates must reflect the June 2026 change to **five gates, including two accessible gates**. Opening-era photographs predate those gates and the added 2019 platform escalator.

### Reference register

| Source | Evidence and usage | Confidence |
| --- | --- | --- |
| [TransLink: Yaletown construction photo tour](https://buzzer.translink.ca/2008/12/canada-line-photos-yaletown-station-construction/) | Official photo captions explicitly describe two stair flights between the entrance and concourse, the intermediate landing, precast concrete platform stairs, brushed stainless escalator finishes, and a roughly 15 m-deep platform during construction. | High for topology; construction-era depth is approximate. |
| [Official lower entrance flight photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/05-yaletown-station.jpg) | Viewed during authoring: stairs and adjacent escalator shaft, tall solid concrete walls. | High for structural relationship. |
| [Official intermediate landing photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/07-yaletown-station.jpg) | Viewed during authoring: reversed second stair flight across the landing and concrete upper-flight structure. Confirms switchback circulation rather than a continuous straight entrance descent. | High. |
| [Official upper entrance flight photograph](https://buzzer.translink.ca/wp-content/uploads/2008/12/08-yaletown-station.jpg) | Viewed during authoring: upper staircase and separate escalator opening rise to the glass station house level. | High. |
| [Tafyrn & Seamora: 18 August 2009 opening walkthrough](https://canadalinephotos.blogspot.com/2009/08/2009-08-18-yaletown-roundhouse-station.html) | Original photography, CC BY 2.5 Canada. The sequence records the existing station, including its installed evacuation plan, broad platform stair, separate escalator opening, concourse and entrance landing. Full-size reference images were viewed during authoring. | High for existing topology and visible architecture; 2009 equipment count is superseded. |
| [Installed Lower Concourse Level evacuation plan, IMG_1084](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1084.jpg) | The photographed existing plan establishes the lateral entrance branch, long paid hall, two distinct lift cores, transverse upper switchback and separate longitudinal platform access openings. The photographed compass and mapped geometry constrain orientation. See the [plan interpretation record](yaletown-opening-plan.md). This is an installed station plan, not a proposal. | High for topology and orientation; not a dimensioned survey. |
| [Standalone platform staircase, IMG_1074](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1074.jpg), [escalator IMG_1075](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1075.jpg) and [IMG_1077](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1077.jpg) | The actual photographs distinguish the broad lower stair from the separate escalator bank. Combined with the installed plan, they rule out the earlier narrow central stair flanked by two escalators. | High for visible placement and separation; 2019 adds the second lower escalator. |
| [Platform photo 07](https://commons.wikimedia.org/wiki/File:Yaletown%E2%80%93Roundhouse_station_07.jpg) | Original opening-era photograph viewed at full size: gray rectangular floor tiles, yellow tactile strip, charcoal wall across the track with framed advertisement panels, angled white ceiling panels, blue/white striped square columns and long linear lights. | High for finishes. |
| [Platform photo 08](https://commons.wikimedia.org/wiki/File:Yaletown%E2%80%93Roundhouse_station_08.jpg) | Original photograph viewed at full size confirms bored circular tunnel at platform end and the central circulation structure behind the platform walkway. | High. |
| [TransLink: June 2026 fare-gate expansion](https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility) | Official current gate count: five total, including a second accessible gate. | High/current. |
| [TransLink: new platform escalator opens, August 2019](https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/) | Official article confirms the new platform-to-concourse escalator is an up escalator and both lower escalators operate up. Do not label the new lane as a down escalator. | High. |
| [TransLink: station entrance map](https://infomaps.translink.ca/system_maps/skytrain_station_maps/yaletown_roundhouse_station.pdf) | Official geographic context and single station entrance relationship to Davie/Mainland. This is not an interior construction plan. | High for location, not interior dimensions. |
| [Nathan Davidowicz: first-hand walking audit, autumn 2024](https://cityhallwatch.wordpress.com/2024/12/03/walking-audit-all-canada-line-stations-davidowicz/) — also reproduced in the [Richmond Public Works and Transportation Committee agenda, 18 December 2024](https://citycouncil.richmond.ca/agendafiles/Open_PWT_12-18-2024.pdf) | The author reports walking and counting 57 stairs from street to concourse and 41 from concourse to platform. Used to constrain stair proportions. This is a first-hand count, not a level survey or an official equipment inventory. Its escalator totals conflict with the official construction photographs and later escalator report, so those totals were not adopted. | Moderate/high for counted totals; no measured riser heights. |
| [City of Vancouver: Development Permit Board, 17 July 2006](https://vancouver.ca/files/cov/development-permit-board-jul-17-06.pdf) | Item 3, 287 Davie Street / DE410450, records the existing project application for an at-grade entrance and below-grade platforms/guideway and discusses two means of egress from the concourse. These minutes do not contain a dimensioned current interior plan. | High for recorded application discussion, insufficient for precise interior orientation. |

### Limits and acceptance

The installed evacuation plan establishes circulation relationships but does not certify shaft widths or island dimensions. A photograph of a track-facing platform walkway can look like a separate side platform because the island's central stair/service block blocks the opposite edge; retain the correct island relationship. The source includes complete walls, landing slabs, balustrades and a ceiling shell around the entrance route. Camera cutaway may fade overhead meshes, while the physical enclosure remains modeled. Acceptance views should include the street headhouse, transverse switchback landing, concourse gates, both distinct lower access banks, both lift cores and both track-edge walkways.

### Plan- and count-constrained reconstruction in revision 3

The `yaletown-opening-plan-v3` template follows the installed plan: its upper switchback runs along local X, across the platform axis. A long paid concourse runs along local Z above the island, with circulation aisles around the separate lower openings. The lower **41-riser stair is modeled 2.9 m wide**; the two escalators occupy a different longitudinal opening. The width and exact offsets are representative interpretations of the broad staircase and plan, not measured dimensions. The lower escalators both operate up, following TransLink's 2019 report.

The 57-step upper-route count is represented as **28 and 29 risers**, separated by the photographed reversing landing. The division is inferred; the source does not independently count each flight. Their representative rises are 4.65 and 4.75 m, placing the concourse at `Y=-9.4`. The 41-step lower stair rises 6.8 m, placing the island at `Y=-16.2`. The construction technician's approximately 15 m description and other approximate published depths do not establish surveyed slab levels. The model records its vertical scale as an inference from first-hand stair totals and plausible riser proportions.

The two lift cores each have clear, supported portals at their own endpoints: street/unpaid concourse and paid concourse/island. The step-free route crosses the fare line and travels through the paid hall between the cores; it does not cross a track at platform level. The main staircase entrance remains beside the independent street-lift entrance.

Platform registration and vertical changes move the complete boarding assembly together: rail, trackbed and tactile parts; platform floors; train poses; station-space door sill, edge and waiting points; waiting-region polygons; retained vehicle anchors; exclusions; and all stored/deployed/animated threshold geometry. Carriage-local geometry remains unchanged. Rebuilding an already rebuilt station does not accumulate another move. Physical acceptance walks the stair flights and entrance/platform return routes, verifies both lift cores and their landing portals, checks seating clearances and rechecks the original boarding interfaces.

### Mapped horizontal registration and remaining limits

The stairs door is [OSM node 2383770178](https://www.openstreetmap.org/node/2383770178), `-123.1219470,49.2745277`; the independent lift/pavilion door is [node 9133604358](https://www.openstreetmap.org/node/9133604358), `-123.1218820,49.2745181`. The [approximate island polygon 923500678](https://www.openstreetmap.org/way/923500678) constrains the platform's centre and axis. With the island centred at local `[0,-16.2,0]`, the stairs door is `[10.9830,0,-11.2459]` and the lift door is `[13.5312,0,-7.1318]`. These independent geographic references replace the earlier generic entrance/platform alignment; they are mapped coordinates rather than surveyed thresholds.

The installed plan's compass, the [mapped indoor passage 229833347](https://www.openstreetmap.org/way/229833347) and the two street doors support the transverse upper switchback and lateral entrance branch. The footway includes halls and vertical circulation, so its segment lengths are not direct measurements of individual stair runs. Room lengths, shaft footprints, clear widths, intermediate-floor depths and exact active-platform boundaries remain proportional reconstructions. The 2006 permit minutes provide project history, not the current as-built plan. The installed 2009 plan establishes existing topology; documented 2019 escalator and 2026 fare-gate changes are applied separately. A current measured plan or complete walkthrough remains necessary to certify exact dimensions and later alterations.
