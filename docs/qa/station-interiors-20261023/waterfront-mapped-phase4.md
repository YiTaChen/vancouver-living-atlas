# Waterfront mapped circulation, phase 4

Authoring date: 2026-10-23. The source template is `tools/station-interiors/waterfront.mjs`. This phase repositions the two complete train-facing assemblies using present mapped platform geometry, adds the actual Howe western access chain, corrects the Granville street threshold and adds its separate public elevator entrance. It does not use a redevelopment proposal as the existing station.

## Evidence inspected and resulting topology

| Evidence                                                                                                                                                                                                                                                                                                                                       | Supported existing feature                                                                                                                                                    | Implementation and limits                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TransLink accessible entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/waterfront_station_elevator_map.pdf)                                                                                                                                                             | Cordova heritage hall serves both lines; Howe serves Expo; Granville serves Canada Line.                                                                                      | Distinct paid concourses and the public heritage-hall transfer remain explicit.                                                                                                                                              |
| [TransLink Howe report and photograph, April 2021](https://buzzer.translink.ca/2021/04/links-tidbits-new-escalators-at-waterfront-transit-priority-signal-at-metrotown-and-more/) and [original full-size photograph](https://buzzer.translink.ca/wp-content/uploads/2021/04/New-escalators-at-Waterfront-Stations-Howe-Street-entrance-1.jpg) | Central gray stair, one escalator on each side, low beige ceiling with recessed lights, steel skirts/black rails, and a left branch signed Waterfront Centre/Sinclair Centre. | Three parallel upper lanes, enclosed middle landing and a separate commercial branch mouth. The commercial complex beyond the mapped mouth is outside this reconstruction.                                                   |
| [TransLink east-bank closure, June 2020](https://buzzer.translink.ca/2020/06/waterfronts-expo-line-eastern-entrance-to-temporarily-close/)                                                                                                                                                                                                     | Howe was the alternate Expo access, with no elevator route through Howe. The heritage east bank is a different entrance.                                                      | No fictional Howe elevator. The east bank is a direct stairs/two-escalator descent, separate from the west route.                                                                                                            |
| [TransLink escalator explanation, May 2020](https://buzzer.translink.ca/2020/05/why-are-escalators-at-skytrain-stations-out-of-service-so-often/)                                                                                                                                                                                              | Two upper Howe escalators and separate east-side equipment.                                                                                                                   | Exact lower Howe escalator side remains representative until a clear present lower-bank photograph is available.                                                                                                             |
| [Official December 2020 board report, BCRTC Q3 page 2](https://www.translink.ca/-/media/translink/documents/about-translink/governance-and-board/board-of-directors/board-minutes-and-reports/2020/december/2020_12_17_public_board_meeting_agenda.pdf)                                                                                        | Explicitly locates two east-platform escalators, the two Howe street escalators and one up escalator between the platform and the Howe bank.                                  | Confirms the complete 2 + 2 + 1 equipment topology. Lower-bank side placement is still unmeasured.                                                                                                                           |
| [Installed station diagram photographed by Oran Viriyincy, 2009](https://www.flickr.com/photos/viriyincy/4000151862)                                                                                                                                                                                                                           | Independent roughly perpendicular Expo and Canada islands, heritage-hall interchange, north and Granville Canada approaches.                                                  | Architecture only: old service labels do not override present operations.                                                                                                                                                    |
| [TransLink construction photographs, 2008](https://buzzer.translink.ca/2008/12/canada-line-photos-waterfront-station/) and [operator tour, 2009](https://buzzer.translink.ca/2009/07/the-buzzer-rides-the-canada-line/)                                                                                                                        | Heritage southwest bank descends before the long under-Cordova connection; Canada concourse and platform are different floors.                                                | Retains the visible initial descent, the actual mapped bends and separate platform descents.                                                                                                                                 |
| [First-hand Canada Line stair audit, 2024](https://cityhallwatch.wordpress.com/2024/12/03/walking-audit-all-canada-line-stations-davidowicz/)                                                                                                                                                                                                  | Waterfront upper flight 42 risers and lower flight 24.                                                                                                                        | 7 m and 4 m representative rises yield the 42/24 Granville-route risers. North-bank 24 risers reuse the representative section; that separate bank was not independently counted. The audit is not a floor-elevation survey. |
| [Actual Expo platform photograph](https://commons.wikimedia.org/wiki/File:Expo_Line_platform_of_Waterfront_station.jpg) and [Canada platform photograph, 2025](https://commons.wikimedia.org/wiki/File:Waterfront_Station_Canada_Line_Platform_2025.JPG)                                                                                       | Cream columns, low metal soffit/long lights and warm Expo tiles; charcoal Canada walls, pale ceiling grid and rectangular tiles.                                              | Existing detail rhythm, original neutral poster panels, seating, walls below rail level and tunnel backing move with the platforms. Photographs are references, not copied game textures.                                    |

The Howe photo was downloaded and inspected full-size. The installed diagram was also inspected at 1024 px. Those local research copies live in temporary files, not bundled assets.

## Mapped horizontal basis

The station frame now anchors the [survey-tagged OSM Cordova entrance 1692226746](https://www.openstreetmap.org/node/1692226746), longitude/latitude `[-123.1120035,49.2856425]`, at source `[-1.0818052808,0,-65.8353703579]`, with runtime group yaw `-121.770113891°`. The previous repository-only point `[-123.111986,49.285624]` / source `[0,0,-68]` was neither that OSM door nor the GTFS teaching example's Cordova node 93. Only the primary door changes in X/Z; geographic rebasing preserves all other street doors and both train assemblies in place. Every coordinate uses the repository's own `MX/MZ` projection.

| Map feature                                                                                                                                       | Source or map coordinates                                                                                                    | Treatment                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cordova node 1692226746](https://www.openstreetmap.org/node/1692226746)                                                                          | `[-123.1120035,49.2856425]` → source `[-1.0818052808,-65.8353703579]`                                                        | Tagged `source=survey`, `entrance=yes`, `wheelchair=yes`. The maintained heritage front floor and doorway wall meet this new threshold; the internal stairs and other doors stay put.                                                                                                                                                                                                        |
| [Howe entrance node 3633792226](https://www.openstreetmap.org/node/3633792226)                                                                    | `[-123.1133920,49.2868766]` → source `[-64.79375356,92.21254299]`                                                            | Exact horizontal public threshold. It lies at the stair lip, so body support is checked by walking onto the first tread rather than assuming a long flat vestibule.                                                                                                                                                                                                                          |
| [Howe upper stairs 379737506](https://www.openstreetmap.org/way/379737506)                                                                        | 13.689 m run to source `[-51.28189882,94.40972386]`                                                                          | Central stair and two side escalators use the mapped bank direction.                                                                                                                                                                                                                                                                                                                         |
| [Landing passage 379897377](https://www.openstreetmap.org/way/379897377) and [turn 358462240](https://www.openstreetmap.org/way/358462240)        | 8.726 m to junction `[-42.66473407,95.78624779]`; then 8.352 m to lower bank `[-42.11684546,87.45262666]`                    | A real L-turn/T-junction. Room widths and where the wider junction absorbs each centreline segment are representative.                                                                                                                                                                                                                                                                       |
| [Lower Howe stairs 689601479](https://www.openstreetmap.org/way/689601479)                                                                        | 14.297 m to source `[-42.59920296,73.16344279]`                                                                              | Lower stairs plus one escalator; no collapsed single flight.                                                                                                                                                                                                                                                                                                                                 |
| [Howe platform tunnel 379737505](https://www.openstreetmap.org/way/379737505)                                                                     | About 29.93 m from lower bank to mapped island west tip `[-43.5679,43.2466]`                                                 | Enclosed, supported level tunnel, with representative 6.0 m clear width and a 5.4 m lower stair/escalator bank kept between the train envelopes. This is mapped circulation, not an invented connection to compensate for a wrongly placed island.                                                                                                                                           |
| [Mall passage 567734054](https://www.openstreetmap.org/way/567734054)                                                                             | Junction → first mapped bend `[-43.6253,106.5192]`                                                                           | Models only this access mouth, with the photographed left-branch sign.                                                                                                                                                                                                                                                                                                                       |
| [Expo edge 1, way 783525511](https://www.openstreetmap.org/way/783525511), and [edge 2, way 87223387](https://www.openstreetmap.org/way/87223387) | Public island mapped length about 79.9 m, centre near source `[-43.45,3.3]`, approximate polygon longitudinal yaw `-0.1683°` | The source boarding assembly retains yaw `0°` and the established GTFS tangent so the complete station geographic frame remains fixed; the approximate map-axis difference is only 0.168°, about 23 cm over 80 m. Retains the validated 74 m active boarding profile in that outline, with short physical end landings. Both trains, rails and every door datum receive the same rigid edit. |
| [Canada station box 379828985](https://www.openstreetmap.org/way/379828985)                                                                       | About 85.4 m mapped polygon, long axis about `-13.145°` in source Y rotation                                                 | The validated 44 m active boarding profile is placed toward the Hastings/Granville end, centre `[87.4,27.6]`. The precise active/reserved boundary within the longer mapped box is inferred. The entire 85 m polygon is not presented as an active platform.                                                                                                                                 |
| [Under-Cordova walkway 358464785](https://www.openstreetmap.org/way/358464785)                                                                    | Source `[-15.0192,-39.2253]` → `[-22.5990,-5.4577]` → `[-2.2789,6.7181]` → `[25.1028,14.8196]`                               | About 86.85 m of real mapped bends. Its final station-box approach joins the north concourse without crossing tracks at platform level.                                                                                                                                                                                                                                                      |
| Granville stairs, [official GTFS pathway example node 90](https://gtfs.org/documentation/schedule/examples/pathways/)                             | `[-123.114375,49.285054]` → source `[145.27957733,46.07056249]`                                                              | Exact public threshold; the GTFS page is an educational example, corroborated by the nearby mapped escalator entrance. The stair lane's offset from that escalator is representative.                                                                                                                                                                                                        |
| [Granville escalator entrance node 3633801257](https://www.openstreetmap.org/node/3633801257) / way 1205887378                                    | Escalator top source `[142.4791,45.8405]` → bottom `[128.2250,42.3180]`                                                      | Uses the mapped run and orientation, with a separate adjacent 42-riser stair lane.                                                                                                                                                                                                                                                                                                           |
| [Separate Granville lift node 13864937287](https://www.openstreetmap.org/node/13864937287)                                                        | `[-123.1141964,49.285239]` → source `[120.94296098,45.88823269]`                                                             | Independent public elevator doorway. It is not incorrectly merged into the stair pavilion roughly 24 m away. Cabin dimensions and lower portal direction remain representative.                                                                                                                                                                                                              |
| [Expo lift node 3633846398](https://www.openstreetmap.org/node/3633846398)                                                                        | Source `[-40.203,-54.222]`                                                                                                   | Separate lift beside the heritage east bank; a narrow lower aisle stays beside the island access and avoids a flat crossing of either track.                                                                                                                                                                                                                                                 |

## Cordova doorway normal and heritage-hall footprint

The surveyed door's position does not by itself establish its inward direction.
[Outside footway364284185](https://www.openstreetmap.org/way/364284185) approaches
from `[-123.1120325,49.2856245]`; [indoor public footway1446762153](https://www.openstreetmap.org/way/1446762153)
continues from the door to `[-123.1119318,49.2856900]`. After the real station
adapter and owner transform, that interior direction is source
`[-0.975205627,0,-0.221300667]`, world `[0.701600487,0,-0.712570527]`, or
**44.555553° northeast**. The rail frame's source `+Z` instead points northwest,
301.770114°, and is not the public doorway normal. Merely making a walker pass
through that old aperture did not establish geographic fidelity.

The reconstructed nave now follows the long axis of the actual
[heritage building footprint78393326](https://www.openstreetmap.org/way/78393326).
With the true door as the origin, `u` runs inward northeast and `v` runs left
northwest. The representative inner nave occupies `u=2.8..28 m`,
`v=−50..20.5 m`; the street vestibule occupies `u=0..2.8 m`, `v=−2.4..2.4 m`.
Its floor boundary and front portal meet the real street threshold. The inner
wall offsets, columns and vestibule dimensions remain representative, while
all nave/vestibule floor corners remain within 15 cm of the actual footprint.

After entering northeast, passengers turn left northwest to the retained Canada
bank and lift. A short enclosed rear vestibule connects the nave to the Expo
paid annex and its independently mapped descent/lift. The original stair banks,
all four geographic entrance points and both complete boarding assemblies stay
fixed. The main nave floor stops before the first Canada tread; the Expo annex
floor stops at its own stair lip. Neither substitutes a flat slab over the
visible descending steps. The representative Expo gate line is set back from
the fixed lift portal, leaving at least 1.65 m of directly walkable cabin-exit
space. The nave connection reaches the gate's unpaid face; visible solid side
barriers close the remaining wall spans. Each retained gate gap and both outer
barriers are tested with the actual body walker. Exact gate offsets remain
representative rather than surveyed. The dedicated test executes the mapped northeast
entry, continues left to Canada, and returns using the production body walker,
in addition to the complete entrance/platform routes.

## Howe fare boundary and unpaid commercial branch

[Kenneth Chan's first-hand Howe fare-hall photograph, published July 2018](https://images-dh-production-baselayer.dailyhive.com/uploads/2018/07/expo-line-waterfront-station-fare-gates.jpg)
shows five gate lanes formed by six reader housings, a wider outer lane,
perforated side panels and a low flat ceiling. Exit signage names Howe Street,
Waterfront Centre and Sinclair Centre. The source reproduces that configuration
with five physically passable open lanes and solid reader housings connected to
the enclosing side walls.

The current mapped indoor ways do not contain a surveyed faregate coordinate.
Its exact metre offset therefore remains **inferred**. The gate boundary belongs
after the unpaid commercial T-junction and before the lower platform flight;
placing it between the upper street bank and that junction would incorrectly
put the public mall branch inside the paid area. The source splits
`waterfront-howe-middle-north-0` (unpaid) from
`waterfront-howe-paid-hall-0` at connection `howe-fare-boundary`. The upper bank
still has two escalators and the lower bank one.

The dedicated physical test walks all five lanes in both directions, tests the
end housings/sidewalls against a complete passenger capsule, follows the street
route to the commercial mouth and back without crossing the gate boundary, and
verifies that the platform route cannot bypass that boundary through the mall.
Reader spacing, panels and the exact paid-hall length are representative
reconstruction dimensions; the photograph is not copied into a game texture.

## Vertical section and explicit inference

The city DEM samples are street/terrain elevations, not basement-floor measurements. The representative section integrates those samples, observed stair counts and photographs:

- Survey-tagged Cordova threshold: city ground `13.1502384 m`, source street `Y=0`.
- The former repository datum sampled `13.1056088 m`. Every station-frame floor, visible slab, obstacle, tread, rail, stop, station-side door vector, bridge, anchor, level and lift-landing record shifts rigidly by **−0.04462962285 m**. All world heights and verified flight rises remain unchanged. Carriage-local positions and quaternions do not change.
- The retained inferred heritage hall slab is `Y=−0.0446296`, leaving a traversable 44.6 mm threshold below the new street sample. This is explicit uncertainty at the street/slab join, not an invented extra flight or an interior elevation survey. The hall's front edge now meets the new horizontal doorway, while its southern access banks stay in place.
- Howe: city ground `15.2975 m`, source street `Y≈+2.14727`; middle landing `Y≈−2.24463`; Expo island `Y≈−7.04463`.
- Granville stairs: city ground `20.3569 m`, source street `Y≈+7.20667`; 42 risers descend approximately `7 m` to Canada concourse `Y≈+0.20667`; 24 risers descend approximately `4 m` to Canada island `Y≈−3.79363`.
- Separate Granville lift: city ground `19.851039 m`, source street `Y≈+6.70080`, about 0.506 m below the stair doorway. Its independent landing follows its own ground sample; the underground concourse remains shared.
- The photographed heritage Canada bank still descends `3 m` from the retained hall slab to `Y≈−3.04463`. The mapped 86.85 m under-Cordova route rises `3.251 m`, a **3.74% mean grade**, to meet the inferred Canada concourse section. Its first 2.28 m overlaps the arrival room at the same level; the ramp begins at that room's actual modeled portal. The remaining first leg is approximately **4.01%**. These are reconstruction sections, not measured local grades.

The under-Cordova route uses real sloped walking triangles and opaque concrete prisms with exactly matching top triangles, continuous enclosing sidewalls, handrails and soffits. The level prefix also has a matching level ceiling; enclosing sidewalls begin at the room portal rather than crossing its floor. The grade is explicitly an inference; no source establishes surveyed passage-floor elevations. A surveyed section could supersede it without changing mapped horizontal topology or the 42/24 visible riser counts.

## Physical and rendering acceptance

`tests/waterfront-mapped-circulation.test.mjs` rebuilds in memory and drives `SkyTrainStationOwner` with open-world walking disabled, so unrelated surfaces cannot mask missing authored graph links. It executes each flight both directions, every public walking entrance to both islands and back, every waiting door and seat, entrance/step-count/grade contracts, rigid boarding transforms and idempotence. It also checks all four adapted entrance positions against their real longitude/latitude references to within 25 cm, and physically walks the Cordova lift bypasses to both lines. The separate public Granville lift is checked using its actual elevator connection and open cabin portals rather than an invented walking path.

`tests/station-elevator-enclosures.test.mjs` additionally walks outward and back through all elevator portals and verifies solid rear walls. The actual-GLB approach fixture found a 5 cm clash from the original unmeasured 6.8 m Howe tunnel wall width. The mapped centreline is retained; the width is now 6.0 m and the lower bank 5.4 m, keeping solid walls and the full walking lanes outside the carriage sweep. Full-city rail terrain/underground camera and final screenshots use the same generated source after phase 4 is integrated; in-memory source checks do not claim that those final captures have already happened.

The fixed Waterfront westbound stop buffer includes an existing covered platform point at `[-123.11206716,49.28619197]` whose coarse city DEM is `6.7533 m`, below the authored roof. The actual carriage roof is `8.6556 m` and the existing platform-ceiling underside is `9.6156 m` (0.96 m real model clearance); the generic conservative tunnel crown is `10.0556 m`. The final integration derives a bounded rail envelope from the actual rendered bed and overhead structure. Outside that exact structure, the raw terrain requirement remains strict. No station-depth change or fabricated cover box is used to hide the disagreement.

With the surveyed Cordova anchor corrected in the combined in-memory fixture, **25 formal integration checks pass**: all 24 actual articulated-car station approaches, occupied eyes and underground cabins inside the actual emitted tubes, independent articulated-car terrain samples, all 12 directions' actual tube vertices below raw terrain, and negative checks for missing/displaced beds or a physically low roof. These final checks use no terrain-free fallback. Earlier diagnostic runs and the intermediate combined fixture using the old Cordova registry are not the final evidence. Generated phase4 assets and final browser captures remain a separate delivery step.

## Primary-reference correction and staged integration

OSM Cordova node 1692226746 is explicitly tagged `source=survey`; the station-area extract records version 8, 27 August 2026. The [official GTFS pathway teaching example](https://gtfs.org/documentation/schedule/examples/pathways/) instead places Cordova node 93 at `[-123.111993,49.285607]`. Those are distinct references, and the former unreferenced repository point is not presented as either one. The survey-tagged current doorway is the phase4 primary anchor.

Granville has different physical access components. GTFS teaching-example node 90 is the stairs doorway at `[-123.114375,49.285054]`; [OSM node 3633801257](https://www.openstreetmap.org/node/3633801257) explicitly describes an **escalator entrance** at `[-123.1143520,49.2850743]`, about 2.81 m away. GTFS node 91 is yet another teaching-example escalator coordinate `[-123.114395,49.285061]`. The template retains the GTFS90 stairs reference for the main walking doorway, uses the current mapped escalator run separately, and does not relabel either as a surveyed common portal. The independent lift uses OSM13864937287.

The focused mapped-door test explicitly replays the staged new Cordova registry anchor until phase4 assets and runtime registry switch together. The live old registry is not mutated by the test. All four staged door coordinates remain within 25 cm of their independent references, and each door follows its own street-height sample. A before/after diagnostic checked 2,325 unchanged geometry, stop, door and anchor world points: maximum drift `2.35×10⁻¹¹ m`. The 42/24 riser counts, physical routes, carriage-local contracts and bridge rises remain unchanged. The earlier in-memory station/lift suite passed 14 tests after that datum correction. The separate northeast doorway/footprint and five-lane paid-boundary regressions below were added afterward; that earlier count is not the final integration run.

The staged [Waterfront street registry patch](../../../tools/station-interiors/waterfront-street-access.patch)
replaces only the `waterfront` array. `git apply --check` passes against the
unmodified live registry. Source entrance IDs remain unchanged and map one to one
to these four records. Inward bearings are calculated from each source doorway's
direction after the full `-121.770113891°` world rotation:

| Registry/source entrance ID | Inward compass bearing | Coordinate reference                                  |
| --------------------------- | ---------------------- | ----------------------------------------------------- |
| `cordova-lobby`             | `44.555553°`           | OSM1692226746 plus its public outside/inside footways |
| `howe-expo`                 | `221.006215°`          | OSM3633792226                                         |
| `granville-canada`          | `45.651265°`           | GTFS teaching-example stop90, stairs                  |
| `granville-canada-lift`     | `121.770114°`          | OSM13864937287                                        |

The retained [street-map evidence packet](../../../tools/station-interiors/references/street-map-20261023.json)
adds the survey-tagged Cordova node, the separate Granville escalator node and
GTFS90. All pre-existing records, OSM versions, attribution and other stations'
data are preserved. The GTFS record is explicitly a documentation example, not a
survey or a current feed, and is not assigned an OSM version.

An in-memory registry integration instantiates the real open-world station owner
against the actual city terrain. All **four geographic thresholds, three-dimensional
heights and inward bearings** pass; the **six walking entrance/island routes** and
their street exits pass; and **four step-free combinations** (Cordova or independent
Granville lift to either island and back) pass through supported real lift-cabin
endpoints. Walking is executed by the production capsule, including the explicit
44.6 mm heritage threshold; no street-height teleport satisfies a route. The
earlier balanced-owner checkpoint reported 31 draw calls, 2,192 instances and
26,428 triangles, before the heritage details and enclosure finishing were
added. The final browser report records the delivered model's current budget. The
staged script and log are `.cache/waterfront-phase4/verify-street.mjs` and
`.cache/waterfront-phase4/street-qa.log`; they do not alter the live runtime file.

## Heritage character and the retained SeaBus connection

[Daderot's own interior photograph, June 2015](https://commons.wikimedia.org/wiki/File:Waterfront_Station_interior_-_Vancouver,_Canada_-_DSC00053.JPG)
was inspected at 1280 pixels. The authored hall retains round cream shafts and
capitals, deep cream ceiling coffers with blue-gray recesses, the rose upper
frieze and the round end-clock style. These are original geometric interpretations
in the corrected hall frame. Column dimensions and spacing, coffer counts,
frieze panel spacing, paired clock placement and clock time are representative;
that single photograph does not independently establish the two-clock layout. Neutral framed panels
indicate the upper decorative rhythm; they do not reproduce the historic
landscape paintings. No photograph is embedded as a game texture.

The superseded public-interior hall previously placed a second floor above the
new stair openings and an opaque facade across the mapped Cordova doorway.
The completed authored hall replaces that legacy hall's visual and ground
participation. The heritage exterior, SeaBus SkyWalk and terminal remain separate
physical geometry. The replacement is installed during owner construction,
rather than during metadata-only prefetch, with rollback when construction fails
or the owner is disposed.

A covered, continuously graded connector leaves the nave through a separate rear
aperture. It meets the existing SkyWalk at legacy local `[-6,-22]`, world
`[1185.8731315121431,13.669589794058577,12.311953836759416]` in the repository's
projection. In the corrected hall basis, the join is inward
`36.65620213165932 m`, left `1.9452906719721303 m`. The inferred nave-to-bridge
rise is `0.5639810169114025 m` over about `9.2562 m` (about 6.1%); a further
0.8 m of flat, rendered overlap permits native ownership transfer. The retained
bridge endpoint is exact relative to the existing model; the short connector's
shape and grade are an integration inference, not a surveyed historic passage.
Its floor triangles and visible slab follow the same grade. The old overlapping
first bridge deck is removed, rather than covering the ramp with another flat
floor. This public-interior continuation does not add a fictional fifth street
entrance to Waterfront.

## Physical finishing review after full-city rendering

The `606cdbe3…` candidate completed its automatic browser route checks and
123 image captures, but was **rejected in manual review**. Mechanical route
success did not establish complete visible enclosure. The preserved candidate
and rejection record are in `.cache/waterfront-review606`; those images are
diagnostic evidence and are not final acceptance images.

The complete first-person view review identified three bounded finishing
repairs. These are inferred construction details at existing joins, rather
than new claims about surveyed station dimensions:

- The new SeaBus connector has a 4.2 m ceiling and the retained SkyWalk a
  3.62 m soffit. A solid cream fascia closes that 0.58 m roof step at their
  shared end plane. Neither walkway height nor the declared native transfer
  edge moves.
- At the Howe unpaid junction, the incoming passage and commercial mouth now
  overlap the room sufficiently to close the angled jamb wedges. The junction
  opening matches the modeled 4.2 m commercial passage. Its far end has an
  opaque physical scope boundary. This is an explicitly inferred end to the
  model, **not evidence that the real Waterfront Centre/Sinclair Centre
  passage terminates or has a door there**. The documented public branch
  remains reachable without crossing the fare boundary.
- The heritage-to-Canada bank has full-width upper and lower landings behind
  its three staggered lane ends, plus a solid sidewall return to the arrival
  room. The upper landing stops before every first tread; the lower landing
  starts after every last tread. This closes the spaces between the narrow
  individual lane landings without laying a flat floor over live stairs or
  obstructing the separate lift approach.

The dedicated source regression drives the real capsule across both full-bank
landings, checks their separation from all live flight endpoints, and casts
rays against actual rendered instance triangles across the roof step, mall
backing and arrival return. The return must also physically join both adjacent
walls. These checks supplement the complete flight and entrance return tests;
they do not substitute for the next frozen-client visual review.

The city-surface aperture also follows each rectangular passage's actual
rotated footprint and end plane. Using its axis-aligned bounds would remove a
triangular portion of the retained SkyWalk roof beyond the connector even when
the new roof and fascia both physically existed. The regression samples the
real roof height on both sides of the declared end plane and checks the same
predicate encoded in the GPU aperture texture. The retained side stays solid;
the authored passage headspace stays clear. Nonrectangular and carved-floor
fallbacks retain their prior bounded behavior.

The subsequent `d67462dd…` 123-image candidate exposed a different issue:
overlapping rectangular beams at the graded passage bends stood up to 0.181 m
above the real walking triangles and left other miter areas about 0.132 m
below them. That candidate was also rejected. Explicit `renderFloorSurfaceId`
metadata now renders the existing floor's exact top triangles, a reversed
bottom 0.3 m lower, and opaque boundary sides. It does not change foot support,
floor levels or mapped passage points. The floor material still uses one
shared draw batch with the ordinary slabs. Existing `floorSurfaceId` cut-piece
ownership metadata is a separate concept and does not enable this rendering.

The flat lift crossing beside the heritage Canada bank retains its original
outer bounds, height, walking links and structural retaining slab. Its narrow
notch is derived from the actual inclined slab's six oriented-box planes at
the crossing-floor height. Only that real solid slice is subtracted; no
body-radius margin or guessed clearance dimension is added. The landing's
visible prism follows the same concave triangles, while the 0.2 m retaining
slab remains visible and physical. A regression probes both the removed solid
slice and the surrounding retained floor, then walks the original centre route
both directions. This is a correction to the modeled foundation overlap, not
evidence of a surveyed notch in the real station.

The later full-size first-person review exposed a narrow sky strip at an
under-Cordova roof turn. Floor-centre roof probes alone had missed it: the
ceiling boxes stopped at the centreline while the floor and walls extended to
their mitered corners. Roof-end laps now follow the actual boundary-corner
projections. Their physical thickness starts at the original 0.18 m and adds
the vertical warp produced by the inferred grade at those ends. This is a derived structural lap,
not a surveyed ceiling construction detail or a visibility mask. No floor,
walking link or mapped anchor moves. The regression covers the full perimeter
of all 20 covered passage floors, including corners too close to walls for a
standing capsule, and the actual first-person rays through the former sky
strip. Standing headroom remains at least 2.5 m at those probes.

Third-person views of the rejected candidate also exposed opaque terrain
between the requested chase camera and the avatar. An avatar mesh's
`visible` flag alone does not establish an unobstructed rendered view. Final
acceptance therefore separately requires the complete first- and third-person
image review after the bounded camera/terrain correction.

In production chase and overview views, a camera ray reveals the active
authored owner through its original three-dimensional opening volumes.
Foreground city fragments yield only when that ray enters an actual source
volume behind them. The permanent vertical openings retain their original Y
bounds: extending every room column to a high overview camera could erase a
road even when the ray missed the station, exposing the global sea underneath.
Explicitly enrolled water alone also yields behind a positively crossed source
volume, within that projected silhouette; an inside-volume camera does not
receive an all-direction water mask. No source bounds are enlarged.

The normal and color passes share the same aperture data and surface markers.
Unregistered station geometry and avatars stay protected; first-person and
ordinary city views retain their fixed apertures. This render-only change does
not move the camera, alter any floor or wall collision, or grant underground
city walking support. A separate bounded sight corridor covers nearby terrain
between the chase camera and a footprint's edge.

The platform-end train-tunnel walls now have exact matching physical colliders;
walkable triangles beside a visible wall do not authorize walking through it.
This exposed the original north Canada lift corridor's centreline inside the
inboard tunnel wall. The corrected representative passage stays on the island
side: Canada-local X2–10, centre Z11.5, with 0.9 m between actual sidewall faces
Z11.05 and Z11.95. The northbound rail remains Z14 and its exclusion remains
fixed. Only this inferred passage section and its two walking anchors change;
the lift cabin, landing, mapped points and boarding assembly remain. Complete
accessible routes, actual emitted body volumes and actual articulated trains
check the section independently. These dimensions describe the reconstruction,
not a measured accessible-passage survey.
