# Final five-station acceptance

Reviewed 2026-10-23. This report covers Waterfront, Burrard, Granville,
Stadium–Chinatown and Yaletown–Roundhouse. The final browser run uses one frozen
client, `.cache/phase4-browser`, served on port 3205. The
[runtime and published-packet pin](final-runtime-pin.json) records its actual
bytes; earlier phase reports and screenshots retain their own historical pins.

**All five final image reviews pass:** 234 captures, 15 public doorway
exit/reentry sequences and 28 actual F/touch lift trips from the same frozen
client. Every report records zero JavaScript errors, warnings, failed HTTP
requests and lost WebGL contexts. The complete capture inventory was reviewed;
all 116 walking third-person frames and five overviews were inspected at full
resolution, alongside 53 selected first-person views including the key
photo comparisons and structural seams. This does not claim full-resolution
inspection of every first-person frame. Walking views show the actual skinned avatar without opaque scenery
between it and the camera. Overview preserves the production orbit mode with
its hidden walker, with partial-overview limits recorded below. Inspect
placements establish visible geometry; continuous body-walker routes and native street/lift actions separately
establish circulation.

## Final runtime record

| Station             | Public doorway exit/reentry | Actual lift trips | Captures | Final report                                                                         |
| ------------------- | --------------------------- | ----------------- | -------- | ------------------------------------------------------------------------------------ |
| Waterfront          | **4/4**                     | **10/10**         | **123**  | [Accepted mechanical and manual review](final/game-waterfront-browser.json)          |
| Burrard             | **3/3**                     | **6/6**           | **28**   | [Accepted mechanical and manual review](final/game-burrard-browser.json)             |
| Granville           | **3/3**                     | **4/4**           | **27**   | [Accepted mechanical and manual review](final/game-granville-browser.json)           |
| Stadium–Chinatown   | **3/3**                     | **4/4**           | **29**   | [Accepted mechanical and manual review](final/game-stadium-chinatown-browser.json)   |
| Yaletown–Roundhouse | **2/2**                     | **4/4**           | **27**   | [Accepted mechanical and manual review](final/game-yaletown-roundhouse-browser.json) |

Each accepted report must identify port 3205 and the same shared source-layout
SHA-256. Each station has its own distinct served JSON packet SHA-256, which
must be verified both before and after capture, and the report must
record every door's native release to city navigation followed by automatic
reentry. A successful inspect placement or an explicit station-entry fallback
does not replace that native doorway evidence.

Yaletown’s final 27-image review includes all 12 walking third-person views
and the supported lowest-platform overview at full resolution, plus four key
photo-comparison first-person views. The former gray peephole and inland water
sheet are absent; the switchback, separate lift cores, divided 41-riser stair
and independent escalator bank remain readable. Its report records zero
JavaScript errors, warnings, failed HTTP requests or lost contexts.

Stadium’s 29 final images were all inspected at full resolution: 16 walking
third-person views, one platform overview and 12 first-person views. The actual
stair and overhead photographs and official accessible map support the red
central divider, active island, restricted spare platform and raised Keefer
route. Its three native public doors and four lift trips pass with zero
JavaScript errors, warnings, failed HTTP requests or lost contexts.

Burrard’s 28-image inventory includes all 15 walking third-person views and
the overview at full resolution, plus six key first-person photo comparisons.
The overview remains a partial geographic cutaway dominated by the exterior
façade; it is not evidence of the complete station section. The clear upper
and lower platform views and enclosed bank views establish the stacked
circulation. The glass atrium, real bank opening and park retaining walls are
readable without glazing or signs crossing the walking path. Its three native
door roundtrips and six lift trips pass with zero runtime or HTTP warnings.

Granville’s 27-image inventory includes all 14 walking third-person views,
the overview and seven key photo-comparison first-person views at full
resolution. The overview is a partial geographic strip, not a complete
stacked-platform section. Teal excavation background remains outside the
authored Dunsmuir/Seymour pads, without covering station geometry or the
walking avatar. The actual original hall, separate banks and platform views
provide the architectural comparison. Its three native doors and four lift
trips pass without runtime or HTTP errors or warnings.

Waterfront’s final 123-image review includes every walking third-person view
and the overview at full resolution, plus 24 first-person photo and seam
comparisons. Two independent reviewers additionally cross-checked the same 60
third-person/overview PNGs. The enclosed Howe banks, five-lane paid boundary,
heritage hall, three graded under-Cordova sections and both islands are
readable, with no former roof slits or projecting floor beams. Its overview is
a partial geographic cutaway, not proof of the complete two-line section;
the dedicated hall, bank and platform views supply that evidence. Four native
door roundtrips and ten lift trips pass. The retained SeaBus SkyWalk also passes
native release and reentry, with a maximum sampled foot-height step of 0.02 m.

The intermediate `606cdbe3…` Waterfront candidate passed automatic input and
runtime checks but was rejected manually for visible roof/jamb gaps and
occluded third-person images. Its 123 images and rejection record are preserved
in `.cache/waterfront-review606`; they are excluded from this final table and
the accepted-report pin.

The later `d67462dd…` candidate also completed 123 captures, but its manual
review found the rectangular graded floor beams projecting above or below the
actual mitered walking triangles. It is preserved separately in
`.cache/waterfront-rejected-d674` and is also excluded. The corrected render
uses opaque floor prisms built directly from the walking triangles. A separate
bounded source correction keeps the arrival-room overlap level until its real
portal, then begins the inferred ramp. The lift crossing also excludes the
small exact slice of its inclined retaining plinth; its centre route, links,
original outer bounds and structural concrete remain.

The `59ebad01…` captures are also unaccepted historical evidence. Full-size
review found Waterfront roof seams and weak wide-hall framing; Burrard glass,
vault and signage crossing real paths; Stadium's lift bypass, nonphysical
centre divider and delayed city-roof enrollment; and Yaletown signage, missing
divider, incomplete flight aperture and water occlusion. Those findings were
corrected and physically retested in the replacement source/client batch;
its manual image acceptance is recorded in the final runtime table.

The source `31701d5f…` passed its physical checks, but its first Yaletown runtime
capture still showed foreground gray ground and water outside the vertical
aperture footprints. That unaccepted client, frontend `38061439…`, is preserved
in `.cache/yaletown-vertical-aperture-review-31701`. Its photographs are excluded
from the final table. The camera-ray correction is accepted in final frontend
`9141adf8…`, retaining the same verified source packets.

## Source-to-image review checklist

The links below pair photographs or installed plans with the corresponding
final game views. All paired views have been reviewed within the manual scopes
and reconstruction limits recorded here. Source photographs are references,
not game textures.

| Station / observed feature                                        | Actual reference                                                                                                                                                                                                                                                                                                                                                                                                                                           | Final game comparison                                                                                                                                                                                                                                                                                                                                            | Acceptance criterion                                                                                                                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waterfront heritage entry and Canada branch                       | [TransLink's actual heritage Canada entrance, 2009](https://buzzer.translink.ca/wp-content/uploads/2009/07/img_2659.jpg), [mapped Cordova door](https://www.openstreetmap.org/node/1692226746) and its connected public footways                                                                                                                                                                                                                           | [Northeast doorway](final/game-waterfront-cordova-true-northeast-doorway-into-heritage-nave-firstperson.png), [left/NW Canada direction](final/game-waterfront-heritage-nave-left-northwest-canada-line-direction-firstperson.png), [retained nave columns](final/game-waterfront-heritage-nave-retained-columns-and-high-ceiling-firstperson.png)               | Enter northeast into the actual heritage footprint; turn left/northwest toward Canada; retain columns, substantial walls and high ceiling.                                                |
| Waterfront Howe upper bank and unpaid commercial junction         | [TransLink's full-size April 2021 photograph](https://buzzer.translink.ca/wp-content/uploads/2021/04/New-escalators-at-Waterfront-Stations-Howe-Street-entrance-1.jpg)                                                                                                                                                                                                                                                                                     | [Upper stair and two escalators](final/game-waterfront-howe-upper-central-stair-and-two-escalators-firstperson.png), [commercial junction](final/game-waterfront-howe-low-ceiling-junction-and-left-mall-branch-firstperson.png)                                                                                                                                 | Central stair with one escalator on each side, low enclosing ceiling, and unpaid Waterfront Centre/Sinclair Centre branch.                                                                |
| Waterfront Howe paid boundary and lower bank                      | [Kenneth Chan's actual Howe fare-hall photograph](https://images-dh-production-baselayer.dailyhive.com/uploads/2018/07/expo-line-waterfront-station-fare-gates.jpg), [TransLink's 2020 board report](https://www.translink.ca/-/media/translink/documents/about-translink/governance-and-board/board-of-directors/board-minutes-and-reports/2020/december/2020_12_17_public_board_meeting_agenda.pdf)                                                      | [Five-lane fare boundary](final/game-waterfront-howe-unpaid-mall-side-five-gate-boundary-firstperson.png), [lower stair and single escalator](final/game-waterfront-howe-lower-stair-and-single-escalator-firstperson.png)                                                                                                                                       | Five lanes/six visible housings after the unpaid junction; no outside-edge bypass; one lower escalator, not a duplicate upper three-lane bank.                                            |
| Waterfront Granville independent access components                | [Installed 2009 diagram](https://www.flickr.com/photos/viriyincy/4000151862), [independent mapped elevator](https://www.openstreetmap.org/node/13864937287)                                                                                                                                                                                                                                                                                                | [42-riser entrance bank](final/game-waterfront-granville-42-riser-stair-and-escalator-firstperson.png), [separate street lift](final/game-waterfront-granville-independent-public-street-lift-firstperson.png), [24-riser platform bank](final/game-waterfront-canada-granville-24-riser-platform-bank-firstperson.png)                                          | Independent street lift and stairs meet the shared concourse; bent enclosed passages connect to Canada island without moving the calibrated boarding assembly.                            |
| Burrard sunken glass atrium and street stair                      | [Wpcpey concourse photograph](https://commons.wikimedia.org/wiki/File:Burrard_Station_Concourse_2018.jpg), [TransLink street stair photograph](https://buzzer.translink.ca/wp-content/uploads/2022/10/The-escalators-and-stairs-to-street-level-at-Burrard-Station.jpg)                                                                                                                                                                                    | [Atrium interior](final/game-burrard-ticket-atrium-glass-trusses-and-machines-firstperson.png), [atrium cutaway](final/game-burrard-ticket-atrium-glass-trusses-and-machines-thirdperson.png), [street stair](final/game-burrard-burrard-street-stairs-firstperson.png)                                                                                          | Shared unpaid glass/truss atrium, ticket machines, broad retaining-walled stair and adjacent escalator; main fare boundary remains below the atrium.                                      |
| Burrard Park and lower platform routes                            | [VPSN's first-hand park visit and photographs](https://vancouverpublicspace.ca/2018/01/29/art-phillips-park-a-small-space-in-a-pivotal-location/), [actual platform photograph](https://commons.wikimedia.org/wiki/File:Burrard_Station_platforms.jpg)                                                                                                                                                                                                     | [Park stair](final/game-burrard-burrard-park-stairs-1-firstperson.png), [main three-lane bank](final/game-burrard-burrard-main-escalator-bank-three-lanes-from-top.png), [lower platform](final/game-burrard-lower-platform-firstperson.png)                                                                                                                     | Twenty-seven mapped park steps reach the same-level rear atrium door; enclosed main bank, stacked single-track platforms and short inter-platform connector remain physically continuous. |
| Granville original concourse and Big 3                            | [Actual original ticket hall](https://commons.wikimedia.org/wiki/File:Granville_Station_Granville_Street_Concourse_2026.JPG), [actual long-bank photograph](https://commons.wikimedia.org/wiki/File:Granville_Station_escalator_2026.JPG), [TransLink's 35 m escalator specification](https://www.translink.ca/news/2018/may/granville%20station%20escalators)                                                                                             | [Original hall interior](final/game-granville-original-ticket-hall-round-column-and-grid-firstperson.png), [hall cutaway](final/game-granville-original-ticket-hall-round-column-and-grid-thirdperson.png), [Big 3](final/game-granville-granville-big-three-three-lanes-from-top.png)                                                                           | Round stainless concourse supports, low grid ceiling, three 35 m escalators in an enclosing acoustic vault, and the photographed platform-level split.                                    |
| Granville Dunsmuir and Seymour branches                           | [TransLink's three-lane Dunsmuir photograph](https://buzzer.translink.ca/wp-content/uploads/2023/11/Artwork-Look-For-Us-In-The-Whirlwind-by-Adeyemi-Adegbesan-at-Granville-Station-scaled.jpg), [Whitfield 2013 Figure 59](https://digital.lib.washington.edu/server/api/core/bitstreams/e7c27087-87fd-476e-ab80-87d30d24c2ac/content#page=73)                                                                                                             | [Dunsmuir triple bank](final/game-granville-granville-dunsmuir-main-triple-three-lanes-from-top.png), [Seymour street mouth](final/game-granville-entrance-seymour-street-outside-thirdperson.png), [Seymour stairs](final/game-granville-granville-seymour-stairs-firstperson.png)                                                                              | Separate tiled shaft, square concourse columns and lower gate line; Dunsmuir preserves a step-free lift route. Seymour enters northwest then turns right/northeast down the mapped stair. |
| Stadium main stair, daylight island and restricted spare          | [TransLink stair photograph](https://www.translink.ca/-/media/translink/images/plans-and-projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement/ct_stadium_chinatown_station.avif?extension=avif&hash=53D7E156AA52173EB92796641B69F0E5), [actual overhead photograph](https://commons.wikimedia.org/wiki/File:Stadium_Chinatown_from_above.jpg)                                                                         | [Beatty main stair](final/game-stadium-chinatown-stadium-beatty-main-stair-firstperson.png), [daylight island](final/game-stadium-chinatown-daylight-island-firstperson.png), [spare-platform fence](final/game-stadium-chinatown-west-spare-platform-fence-firstperson.png)                                                                                     | Broad walled stair with red rails, canopy/trusses and one active public island; the spare platform has no public boarding path.                                                           |
| Stadium Keefer approach and real guideway                         | [Official entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf), [mapped 20-step approach](https://www.openstreetmap.org/way/367513829), [first-hand guideway photograph](https://commons.wikimedia.org/wiki/File:TransLink_SkyTrain_approaches_Stadium-Chinatown_station_in_Vancouver,_British_Columbia,_Canada.png)                        | [Keefer external stair](final/game-stadium-chinatown-stadium-chinatown-keefer-place-mapped-approach-stair-firstperson.png), [raised passage](final/game-stadium-chinatown-keefer-raised-passage-firstperson.png), [overview](final/game-stadium-chinatown-overview-cutaway.png)                                                                                  | Real stairhead-to-raised-deck route without terrain snapping; continuous visible concrete rail support and bounded portal.                                                                |
| Yaletown entrance switchback and two separate lift cores          | [Official upper landing](https://buzzer.translink.ca/wp-content/uploads/2008/12/07-yaletown-station.jpg), [upper flight](https://buzzer.translink.ca/wp-content/uploads/2008/12/08-yaletown-station.jpg), [installed lower-concourse plan](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1084.jpg)                                                                                                                                          | [Upper switchback](final/game-yaletown-roundhouse-upper-entry-switchback-firstperson.png), [long lower concourse](final/game-yaletown-roundhouse-long-lower-concourse-firstperson.png), [street lift](final/game-yaletown-roundhouse-elevator-core-1-call-firstperson.png), [platform lift](final/game-yaletown-roundhouse-elevator-core-2-call-firstperson.png) | Reversing entrance flights across the island axis, long paid hall, and two distinct lift cores with a supported route through the gate line.                                              |
| Yaletown independent platform stair, escalators and current gates | [Actual standalone platform stair](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1074.jpg), [TransLink's 2019 second-escalator update](https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/), [June 2026 gate update](https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility) | [41-riser staircase](final/game-yaletown-roundhouse-yaletown-platform-stair-firstperson.png), [separate two-escalator bank](final/game-yaletown-roundhouse-separate-two-escalator-bank-from-top.png), [five-gate line](final/game-yaletown-roundhouse-2026-gates-firstperson.png)                                                                                | Independent broad stair and separate two-up-escalator opening; five current gates including accessible lanes, with no platform or carriage obstruction.                                   |

The heritage-character comparison additionally uses
[Daderot's actual 2015 interior photograph](https://commons.wikimedia.org/wiki/File:Waterfront_Station_interior_-_Vancouver,_Canada_-_DSC00053.JPG)
against the final [nave columns and ceiling view](final/game-waterfront-heritage-nave-retained-columns-and-high-ceiling-firstperson.png):
round cream shafts, capital details, deep ceiling coffers with blue-gray
recesses, rose upper panels and the round clock-face style. Spacing, dimensions
and the second end-clock placement are inferred; a reflected clock face does
not independently establish a second installed clock. The short [graded SeaBus connection](final/game-waterfront-heritage-rear-covered-grade-to-retained-seabus-skywalk-firstperson.png)
joins the existing physical SkyWalk; its 6.1% grade and 0.8 m flat overlap are
explicit reconstruction dimensions rather than a surveyed section.

## Physical and publication checks

The final source/public consistency review compares all seven generated runtime
packets against the source compiler output and verifies manifest byte lengths
and SHA-256 values. Waterfront's station-facing boarding, rail, stop, door,
exclusion and threshold-bridge assembly is retained rigidly; carriage-local
vectors and poses remain exact. Rebuilding the template permits only floating
point roundoff, rather than silently shifting a doorway or rail.

The physical regression scopes exercise actual rendered train bodies and all
24 approaches, floor support beyond tread centre lines, enclosed elevator
portals, accessible walk/elevator paths, complete street return, camera
clearance, and bounded terrain/building openings. Roof cutaways change
visibility; they do not remove passenger collision walls. The following results distinguish local verification from the separate
publication history.

Stair handrails and escalator glass use the same oriented boxes for rendering
and collision. Positions near a tread edge that place the body through those
barriers are rejected. Where a photographed stair has a central divider, its
representative connection endpoints follow a real side lane using
`walkLaneOffsetM`; the physical stair axis, treads, widths and divider stay
fixed. The divided centre is correctly rejected, and the side lane remains
traversable in both directions. Unpartitioned stairs retain their original
walking axis. These intentional walking-lane changes are separate from the
floor-prism and roof repairs, which retain their floor and navigation data.

Active chase/overview cutaways also remove enrolled city ground in front of an
actual source opening when the camera ray reaches that opening behind the
fragment. The test uses the opening's original three-dimensional bounds,
rather than a larger circular reveal or an enlarged horizontal footprint.
Station walls, floors and avatars stay protected. Ordinary city surfaces
behind the source opening retain their prior behavior. Explicitly enrolled
water alone also yields where that original source volume projects in front of
the water, preventing the global sea sheet from filling the inland cutaway.
Water outside that projected silhouette, first-person and ordinary city views
retain their prior behavior. No source bounds or floor depths are enlarged,
and color and SSAO-normal passes must agree. This runtime fix requires a fresh
full-game image review even though the station source is unchanged.

The completed Waterfront owner replaces the obsolete overlapping public hall.
The previous generic floor, furniture and columns no longer participate in
rendering, public ground sampling or collision. A real aperture is cut at the
mapped Cordova doorway while adjacent brick, header, portico, exterior roof,
SkyWalk and SeaBus terminal remain. The navigation ground index is invalidated
when its source triangles change; hidden legacy geometry cannot continue to
raise a street or stair. A bounded, same-height triangle union supports the
public bridge seam, while the new passage's solid sidewalls still block bodies.
Metadata-only prefetch, incomplete legacy packets, failed construction and
disposal retain or restore the fallback public interior.

| Final gate                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All seven source/public/manifest contracts                                              | Current source `31701d5f…`: **7/7 exact**, including compiled packets, manifest bytes and hashes. Waterfront boarding rebuild differs only by numerical roundoff, at most `9.24 × 10⁻¹³ m`. Both physical and manual image gates pass.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Public interior authority, real aperture, ground cache, SeaBus seam and legacy fallback | Included in the complete passing local suite. The earlier **14/14** scope includes public-interior and Light Lab checks; final GPU evidence additionally covers native SeaBus release and return.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Published floor/tread rendering, body/eye and actual carriage clearance                 | Source `31701d5f…`: **30/30 pass**; 12,960 source-floor and 5,868 tread-width probes, with every complete-capsule-clear sample meeting its rendered support within 1 cm. All raw rays find rendered geometry; the 15 raw floor mismatches are structural-bank points already rejected for a full capsule. Accepted paths clear emitted walls, glass, rails and signs. Includes all 24 articulated approaches, all 10 underground directions and merged-triangle negative fixtures; `/tmp/station-final-published-all-gates.log`. The retained lower lift landing additionally clears actual GLB meshes over 902 Canada approach poses. |
| All seven packets' provenance, budgets and disposal                                     | Source `31701d5f…`: **2/2 pass**; station draw calls are Waterfront 32, Burrard 24, Granville 23, Stadium 17 and Yaletown 19. `/tmp/station-final-published-budget-provenance-31701.log`. These are CPU checks, not image acceptance.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Source, mapped doors, accessibility and native circulation                              | Scoped source traversal **66/66**, additional aisle emitted-body regression **1/1**, and dedicated B/G hall/geometry scope **9/9** pass; all are included in the complete passing local suite.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Protected offline material consumers                                                    | **15/15** contract tests and both geometry/furniture validators pass. The reviewed authority-source receipt and exact geometry digest remain unchanged; no guard was relaxed for the new station source.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Bounded projected cutaway and water                                                     | **69/69** scoped shader, camera, lifecycle and negative tests pass. The actual Yaletown GPU upload contains 198 rows in eight pages; Float32 rays remove the two observed inland water pixels while retaining off-silhouette water and the formerly over-cut road. Color/SSAO parity is checked through shared shader logic and tests; a separate GPU normal-pass uniform capture is not claimed. Final images are independently accepted above.                                                                                                                                                                                       |
| TypeScript and verified production build                                                | **Pass, exit 0** for `tsc --noEmit --incremental false` and `build:firebase` under Node **24.22.1**. Commands, log byte lengths and SHA-256 values are in the [exact local validation receipt](final/cpu-validation.json).                                                                                                                                                                                                                                                                                                                                                                                                             |
| Complete local repository suite                                                         | Node **24.22.1**: **2,573 tests, 2,572 pass, 0 fail, 1 skip**, completed in 683.016 s. The skip is optional official-archive generator reproduction because the local ZIP is absent. Actual station source, public packets and browser client are unchanged.                                                                                                                                                                                                                                                                                                                                                                           |

The [exact local validation receipt](final/cpu-validation.json) records the
same before/after input seal over 2,071 code, source, public, configuration and
asset files:
`38bc2b3c42d2e657443ba9c676b15f8eba7d71c87aa70c51745c3dc5b6324c79`.
Prose and generated QA outputs are excluded from that test-input seal. Its
accepted browser-pin SHA-256 matches the committed runtime-pin bytes. Exact
publication identities are recorded by the pull request, GitHub workflow
histories and final delivery, avoiding a self-referential commit hash here.

The final fixture corrections retain the source and rendered physical checks.
Exact station rotations use sign-invariant normalized-component agreement at
`1 × 10⁻¹²`, with raw source endpoint arrays still compared exactly. This avoids
`THREE.Quaternion.angleTo(q, q)` reporting a false nonzero angle for a serialized
quaternion a few floating-point units from unit length; a genuine heading
change remains a failing negative case. Native fixtures follow the real clear
side lane around physical dividers and load the actual camera/shader methods.
No station geometry or accepted browser input was changed to obtain these
results.

## Reconstruction limits

These are source-supported geometric reconstructions, **not photogrammetry or
an as-built survey**. Actual photographs establish visible bank groupings,
walls, finishes, branch relationships and installed equipment. Mapped public
doors and indoor ways constrain horizontal topology; platform polygons marked
approximate do not certify underground dimensions. Hidden corridor lengths,
widths, ceiling heights, floor sections, shaft offsets and furniture positions
remain explicit proportional inferences.

- Waterfront's Howe lower escalator count is documented; its exact side remains
  uncertain. The five-lane paid-boundary position follows verified topology and
  the actual photograph, while its metre offset is inferred. The 42/24 Granville
  risers are evidenced; the other 24-riser bank is a shared representative
  section. The initial heritage descent and 3.74% mean under-Cordova passage
  grade reconcile the section without claiming measured basement elevations.
  A 2.28 m level overlap meets the arrival-room portal before the inferred
  4.01% first ramp; these local sections are not survey measurements. The
  heritage Canada lift's exact cabin centre remains uncertain.
- Burrard's Park route has 27 mapped steps. Its split into three flights and
  the selected atrium/platform depths are proportional inferences; the coarse
  terrain model does not resolve the landscaped grotto. Underground Royal
  Centre/Melville waypoints are not labelled as fabricated street doors.
- Granville's original 35 m specification is escalator length, not horizontal
  run. Seymour's street-facing mouth is inferred from the actual entrance photo
  and building edge, separately from the mapped stairhead. Hidden turns and
  intermediate depths are not represented as surveyed measurements.
- Stadium's Keefer approach has 20 mapped steps and a raised public passage.
  Residual grades and guideway dimensions are inferred. Unverified residential
  access is not fabricated into a public station route. The authored lift
  serves three public levels; this is not a complete inventory of every
  existing station lift stop.
- Yaletown's 41-riser lower stair and separate cores follow first-hand evidence
  and the installed plan. Stair width, hidden depths and the 28/29 division of
  the upper 57-riser total remain inferred.

Detailed evidence and qualifications remain in the
[Burrard/Granville reference register](burrard-granville-references.md),
[Granville ticket-hall ceiling](granville-ticket-ceiling.md),
[Burrard shared-bank headroom](burrard-shared-bank-headroom.md),
[Stadium/Yaletown register](chinatown-yaletown-references.md),
[Yaletown plan interpretation](yaletown-opening-plan.md),
[Stadium guideway evidence](stadium-guideway-evidence.md), and
[Waterfront mapped reconstruction](waterfront-mapped-phase4.md).
