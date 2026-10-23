# Phase 3 acceptance: Stadium–Chinatown and Yaletown–Roundhouse

Reviewed 2026-10-23. The browser client is the frozen
`.cache/phase3-browser` tree served on port 3204. [Its runtime pin](phase3-runtime-pin.json)
hashes those actual files, including the published station packets. It excludes
the root working tree's future Waterfront/paging work. Waterfront remains its
previous published packet in this phase; its mapped reconstruction is phase 4.

## Delivered circulation

Yaletown follows the photographed installed evacuation plan: the upper entrance
switches back across the island axis, a long paid hall connects **two separate
lift cores**, and a broad **41-riser staircase** descends through an opening
separate from the **two up escalators**. The street and lift doors retain their
independent mapped positions. The two lower escalators reflect the 2019 addition;
the five-gate arrangement reflects TransLink's June 2026 update. The upper
57-riser total is divided into 28/29 flights as an explicit inference.

Stadium has **one active public island**, a visible fenced spare platform with
no public boarding route, and separate Beatty, Keefer and Expo access. Keefer's
raised doorway connects to the real mapped **20-step** external approach and
open-air concrete passage. A person beneath that deck cannot snap up from raw
terrain. The station's daylight canopy, tunnel portal and continuing concrete
guideways follow existing photographs and mapped rail boundaries; a fabricated
roof does not substitute for missing rail support.

The shared native controller supports all **16 registered public doors**,
preserves held keyboard/touch movement when the city hands ownership to the
station, and returns it to city navigation on exit. Rendered-apron entry and
release distances provide hysteresis against immediate exit/reentry ping-pong.
The full-game reports below specifically exercise the five public doors of
these two stations; they do not claim GPU inspection of all 16 doors.

The [source/reference register](chinatown-yaletown-references.md),
[Yaletown installed-plan interpretation](yaletown-opening-plan.md), and
[Stadium guideway record](stadium-guideway-evidence.md) distinguish current
equipment, mapped positions, approximate polygons and inferred dimensions.
Shaft widths, floor elevations, hidden offsets and exact furniture positions
remain proportional reconstructions, **not a measured interior survey**.

## Validation record

| Check                                                       | Recorded result                                                                                    | Scope / evidence                                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published-packet articulated rail geometry                  | **25/25 pass**                                                                                     | Actual generated station packets, real train approaches, rendered rail support and roof clearance, raw-terrain tunnel checks and negative guards; `/tmp/station-phase3-published-rail-tests.log`.                         |
| Stadium/Yaletown source, step-free and physical circulation | **10/10 pass**                                                                                     | Real passenger support through stairs, landing portals, separate lift cores, platform doors and return routes. `/tmp/station-phase3-source-specific-final.log` (Stadium guideway and Yaletown plan/physical door checks). |
| Native street/controller integration                        | **29/29 pass**, as recorded by the runtime owner                                                   | Actual ownership handoff/return and retained movement; `.cache/station-probes/yaletown-full-street-final.log` and `yaletown-native-threshold-regression.log`.                                                             |
| Yaletown full-game GPU                                      | **Pass: 27 captures, two public doorway exit/reentry sequences, four lift trips across two cores** | [Final browser report](game-yaletown-roundhouse-browser.json), captured from port 3204. Served packet hash matches the frozen pin before and after capture.                                                               |
| Stadium full-game GPU                                       | **Pass: 29 captures, three doorway exit/reentry sequences, four lift trips**                       | The final port-3204 rerun has zero JS errors, failed HTTP requests or lost context. [Report destination](game-stadium-chinatown-browser.json).                                                                            |
| Complete world/station regression set                       | **42/42 pass**                                                                                     | `.cache/station-probes/phase3-world-transit-final.log`; all native route, carriage and held-input cases.                                                                                                                  |
| Complete committed repository suite and production gate    | **CI pass**                                                                                        | [Validate city run 39951996922](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/39951996922), exact PR head `6880daa3f6a42da675b23cd067a256db70492054`; includes the complete suite, typecheck, GLB audit and Firebase production build. |
| Staged-index typecheck and production build                 | **Pass**                                                                                           | `/tmp/station-phase3-index-typecheck.log`, `/tmp/station-phase3-index-build.log`.                                                                                                                                         |

The source-packet SHA-256 is
`e51e9f7d7a220ecd04f9f178966763a98e1ab35ead5aa85d9cab27558bc1231f`.
The runtime pin records both final frozen-client reports. [PR 42](https://github.com/YiTaChen/vancouver-living-atlas/pull/42) merged as `a2eb6d463530341f27928e1a321683f617e9305d` after the complete CI gate passed.
The merged main commit also passed [Validate city](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/39953161035) and [Firebase deployment](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/39953160875).
Runtime hashes come from the frozen browser tree, so later root changes cannot
silently relabel these captures as testing a different client.

The complete local suite exposed four phase-boundary/API cases. The phase-3
lift tests now cover the four completed templates, leaving the earlier Waterfront
display to phase 4. Rail negatives use the actual shallow Stadium packet, without
substituting a future Waterfront template. The platform API now prefers a clear
inset floor over its last-tread boundary, preserving native line-transfer ownership
and the carved Yaletown well. The affected scopes pass **14/14** and **2/2**;
the complete commit is gated again in CI. GPU pin fields retain the exact capture
checkpoint and separately identify this final platform-API correction.

## Photograph-to-game comparisons

| Existing reference                                                                                                                                                                                                                                                                                                                        | Corresponding game view                                                                                                                                                                                                                       | What to compare                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Yaletown official landing](https://buzzer.translink.ca/wp-content/uploads/2008/12/07-yaletown-station.jpg) and [upper flight](https://buzzer.translink.ca/wp-content/uploads/2008/12/08-yaletown-station.jpg)                                                                                                                            | [Upper switchback](game-yaletown-roundhouse-upper-entry-switchback-firstperson.png), [lower entrance flight](game-yaletown-roundhouse-yaletown-lower-entry-stair-overhead-thirdperson.png)                                                    | Reversing entrance flights across the platform axis, intermediate landing, enclosing concrete walls and separate escalator opening. |
| [Installed lower-concourse plan IMG_1084](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1084.jpg)                                                                                                                                                                                                                          | [Long paid hall](game-yaletown-roundhouse-long-lower-concourse-firstperson.png), [street lift](game-yaletown-roundhouse-elevator-core-1-call-firstperson.png), [platform lift](game-yaletown-roundhouse-elevator-core-2-call-firstperson.png) | Lateral entrance branch, long hall and two distinct lift cores, with the paid route between them.                                   |
| [Standalone stair IMG_1074](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1074.jpg)                                                                                                                                                                                                                                        | [Platform staircase](game-yaletown-roundhouse-yaletown-platform-stair-firstperson.png)                                                                                                                                                        | Broad independent staircase; its 41 risers follow the first-hand 2024 count, while width is inferred.                               |
| [Separate escalator IMG_1075](http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1075.jpg) and [TransLink's 2019 update](https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/)                                                                                                  | [Separate two-escalator bank](game-yaletown-roundhouse-separate-two-escalator-bank-from-top.png)                                                                                                                                              | Escalators occupy a separate longitudinal opening; the current two lanes operate up.                                                |
| [TransLink's June 2026 gate update](https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility)                                                                                                                                 | [Current gate line](game-yaletown-roundhouse-2026-gates-firstperson.png)                                                                                                                                                                      | Five gates including two accessible lanes, with clear body-width approaches.                                                        |
| [Official Stadium stair photograph](https://www.translink.ca/-/media/translink/images/plans-and-projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement/ct_stadium_chinatown_station.avif?extension=avif&hash=53D7E156AA52173EB92796641B69F0E5)                                                         | [Beatty main stair](game-stadium-chinatown-stadium-beatty-main-stair-firstperson.png), [overhead view](game-stadium-chinatown-stadium-beatty-main-stair-overhead-thirdperson.png)                                                             | Broad concrete stair, yellow nosings, red rails, full walls, adjacent escalator and covered landing.                                |
| [Emma0mb's actual station overview](https://commons.wikimedia.org/wiki/File:Stadium_Chinatown_from_above.jpg)                                                                                                                                                                                                                             | [Daylight island](game-stadium-chinatown-daylight-island-firstperson.png), [spare-platform fence](game-stadium-chinatown-west-spare-platform-fence-firstperson.png)                                                                           | One public island, separate restricted platform, open trusses and curved canopy.                                                    |
| [Official entrance map](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf) and [mapped 20-step approach](https://www.openstreetmap.org/way/367513829)                                                                                  | [Keefer approach stair](game-stadium-chinatown-stadium-chinatown-keefer-place-mapped-approach-stair-firstperson.png), [raised passage](game-stadium-chinatown-keefer-raised-passage-firstperson.png)                                          | External stairhead on real ground, twenty steps, raised open-air passage and concourse doorway; no ground-to-deck warp.             |
| [Actual guideway photograph](https://commons.wikimedia.org/wiki/File:TransLink_SkyTrain_approaches_Stadium-Chinatown_station_in_Vancouver,_British_Columbia,_Canada.png) and [existing configuration plan](https://images.squarespace-cdn.com/content/v1/61fc64deb670127bdc81c770/84f2520c-87d8-4dc8-b9f5-65a1b37138ea/existing+plan.png) | [Station overview](game-stadium-chinatown-overview-cutaway.png) and the separate published-packet rail checks                                                                                                                                 | Continuous concrete rail support, open viaduct and bounded tunnel portal; exact structural dimensions remain inferred.              |

Interior viewpoints are explicitly labelled supported-floor inspect placements.
They establish visible structure and reference comparisons. Continuous capsule
routes and the native street/lift operations provide separate evidence that
those viewpoints are connected; a sequence of inspect screenshots alone does
not prove an uninterrupted walk.
