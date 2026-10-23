# Stadium–Chinatown guideway and portal evidence

Research date: 2026-10-23. This reference record supports the revision 4 Stadium
source reconstruction. An initial clearance diagnostic used the old street
registry; the later corrected-Beatty-frame check independently confirmed missing
rendered rail support northwest of the retained station trackbeds. Original OSM
versions, timestamps, tags and coordinates are retained in
[the guideway evidence packet](../../../tools/station-interiors/references/stadium-northwest-guideways-20261023.json).

## Photographed existing structure

[Tim Adams' approaching-train photograph, 6 October 2013](https://commons.wikimedia.org/wiki/File:TransLink_SkyTrain_approaches_Stadium-Chinatown_station_in_Vancouver,_British_Columbia,_Canada.png)
was viewed at full size. It shows the station in the background and the
continuous elevated concrete guideways curving toward it from the southeast.
The track-support slabs, outer maintenance walkways, parapets/rails and concrete
piers continue well beyond the station canopy. The tracks are open to the sky;
this is evidence for a guideway, not a roof over the approach. The photograph is
the author's own work under CC BY 3.0. Its [original image](https://upload.wikimedia.org/wikipedia/commons/1/1f/TransLink_SkyTrain_approaches_Stadium-Chinatown_station_in_Vancouver%2C_British_Columbia%2C_Canada.png)
is the full-size reference, not an asset embedded in the game.

The [Existing Platform Configuration drawing credited to TransLink](https://images.squarespace-cdn.com/content/v1/61fc64deb670127bdc81c770/84f2520c-87d8-4dc8-b9f5-65a1b37138ea/existing+plan.png),
published in [Ian Bryane's station study](https://www.ianbryane.com/samples/stadium-chinatown-station),
was also viewed. It labels the inbound, outbound and storage-track guideways,
their service walks, the eastern Expo Boulevard crossing and the storage-track
merge beyond that crossing. It depicts continuous supports beyond the boarding
platforms. Other drawings on the portfolio page describe proposed upgrades and
must not be substituted for this existing-condition reference. The drawing does
not provide usable surveyed elevations or slab thicknesses.

## Original mapped rail boundaries

The original node coordinates below are retained from the [OSM area extract](https://www.openstreetmap.org/api/0.6/map?bbox=-123.111,49.2787,-123.108,49.2804)
retrieved during authoring. OSM ways include their complete node lists even when
they leave the extract rectangle. The comparison X/Z grid uses the mapped
Beatty doorway `[-123.1101080,49.2798687]` as `[0,0]`, the project's geographic
projection and a 45.8078° station bearing. Values are rounded to millimetres for
reproducibility, not to claim that map accuracy. This grid has its origin at the
mapped doorway; the authored entrance point's local 0.2 m Z offset must be
accounted for when comparing a runtime rebase.

| Boundary or feature | Original node; longitude, latitude | Comparison local X/Z m | Interpretation |
| --- | --- | --- | --- |
| Northeast/main-track tunnel mouth | [7569445029](https://www.openstreetmap.org/node/7569445029); `-123.1097795,49.2797682` | `[8.606,24.901]` | Endpoint of [tunnel way 379898651](https://www.openstreetmap.org/way/379898651), tagged `tunnel=yes`, Dunsmuir Tunnel. |
| Northeast track viaduct start | [7569445026](https://www.openstreetmap.org/node/7569445026); `-123.1096496,49.2796794` | `[8.093,38.555]` | Endpoint of [viaduct way 379689170](https://www.openstreetmap.org/way/379689170), connected to the tunnel by [short transition 809550057](https://www.openstreetmap.org/way/809550057). |
| Southwest/main-track tunnel mouth | [7569445027](https://www.openstreetmap.org/node/7569445027); `-123.1098750,49.2797016` | `[-1.544,25.097]` | Endpoint of [tunnel way 551763179](https://www.openstreetmap.org/way/551763179), tagged `tunnel=yes`, Dunsmuir Tunnel. |
| Southwest track viaduct start | [7569445024](https://www.openstreetmap.org/node/7569445024); `-123.1097388,49.2796145` | `[-1.602,38.947]` | Endpoint of [viaduct way 809550055](https://www.openstreetmap.org/way/809550055), connected to the tunnel by [short transition 809550058](https://www.openstreetmap.org/way/809550058). |
| Storage-track tunnel mouth | [7569445028](https://www.openstreetmap.org/node/7569445028); `-123.1098901,49.2796922` | `[-3.059,25.041]` | Endpoint of [siding tunnel 379689302](https://www.openstreetmap.org/way/379689302). |
| Storage-track bridge start | [7569445025](https://www.openstreetmap.org/node/7569445025); `-123.1097757,49.2796001` | `[-4.619,38.143]` | [Bridge siding 809550056](https://www.openstreetmap.org/way/809550056), connected through [transition 809550059](https://www.openstreetmap.org/way/809550059). |
| Northeast viaduct by Expo exit | [7569446252](https://www.openstreetmap.org/node/7569446252); `-123.1084426,49.2788993` | `[6.921,161.929]` | Main-track viaduct continues beyond the 74 m active boarding island. |
| Northeast viaduct farther southeast | [3830176088](https://www.openstreetmap.org/node/3830176088); `-123.1079448,49.2785679` | `[5.666,213.562]` | Same continuous viaduct way; it does not end at the station exit. |
| Storage siding east bend | [3830171100](https://www.openstreetmap.org/node/3830171100); `-123.1084920,49.2787582` | `[-6.842,170.306]` | Siding is still separate beyond the station. |
| Storage siding merges with southwest main track | [3830171104](https://www.openstreetmap.org/node/3830171104); `-123.1080730,49.2785359` | `[-3.377,209.371]` | Shared node of the siding and main viaduct ways. |

The two main viaduct ways are tagged `bridge=viaduct`, `layer=2`. The siding is
tagged `bridge=yes`, `layer=2`, `service=siding`. Their short northwest transition
ways are tagged as railway but have neither a bridge nor tunnel tag; that gap in
tagging does not establish a missing physical support or a precise retaining-wall
boundary. Their approximately 14 m mapped runs connect the tunnel and viaduct
endpoints. The tunnel boundary coordinates are map evidence, not photographs of
individual portal faces.

## Modeling limits

The existing 86 m station trackbeds are local station components, rather than a
surveyed limit of the actual guideway. The evidence supports continuous elevated
rail structure southeast of the station and connected tunnel approaches to its
northwest. It does not establish exact deck top levels, thicknesses, pier spacing,
parapet heights or retaining-wall extents. Any later addition must use the real
mapped rail alignment and photographed structural type, with inferred dimensions
identified explicitly. A fictitious roof or an arbitrary slab added solely to
satisfy a terrain test is not supported by these references.

## Revision 4 authored extent and passenger separation

The source joins both maintained main-track beds through three concrete
sections: tunnel `Z=14…25`, portal transition `25…39`, and viaduct `39…53.25`.
The last section overlaps the existing bed beginning at `Z=53.2`. The short
visible lining ends at the mapped mouth; the transition and viaduct remain open
to the sky. Steel running rails retain the existing 1.435 m gauge and stop-centre
alignment. Each open segment has a concrete outer service walk, parapet and
metal handrail. No public walking graph is added onto maintenance walks.

The retained rail centres are `X=-2.23` and `X=7.77`. The approximate mapped
tunnel-mouth centres differ by 0.69 and 0.84 m respectively. The model preserves
its coherent train, running rails, island edges and door interfaces instead of
moving rails sideways while trains continue on the old alignment. The mapped
longitudinal boundaries remain the evidence for the new section. Slab thickness
0.4 m, service-walk width 0.85 m and the rectangular lining shape are explicit
representative dimensions. The lining's underside is 4.05 m above the local rail
datum, clearing the conservative 3.65 m train roof by 0.40 m.

The original main-lift coordinate is [OSM node 5476795075](https://www.openstreetmap.org/node/5476795075),
`-123.1098663,49.2797654`, which projects to `X=3.9887,Z=20.5995`. The source
relocates the previously guessed `X=7.1` core to this mapped location. The upper
bypass connects laterally to the cabin; the lower bypass runs along the left side
of the enclosed access bank, inside the two running tracks. The lower passage is
6.2 m wide and centred on the island. The lower staircase is modeled 2.6 m wide
inside a 5.1 m combined shaft; its concrete underslab stays clear of the adjacent
car body. The upper escalator's lateral lane is offset to clear the mapped lift
core. These clear widths and cabin footprint are inferred; the point map is not
an equipment footprint survey. The 27-tread main stair, mapped horizontal runs,
three public lift levels and all street doorway coordinates remain unchanged.

Source tests verify the bounded visible structure and aligned rails, rebuilding
without duplicate components, three supported mapped-core lift landings, and
actual capsule travel from Beatty/Keefer through the two lift legs and lower
bypass in both directions. The separate full station QA walks all stair flights
in both directions, checks every door and seat, and verifies the world-frame
transforms. Real articulated-car clearance remains a separate integration check;
source tests do not substitute a floor graph for that rendered geometry check.

Final in-memory integration at the corrected Beatty and Cordova anchors passes
all 24 actual articulated-car approaches, underground cabin/occupied-eye checks,
all 12 emitted-tube terrain checks and bounded-envelope negative guards. The
Stadium portal retains a 0.40 m conservative roof margin. These formal checks
use the actual rendered beds/lining and no terrain-free fallback.
