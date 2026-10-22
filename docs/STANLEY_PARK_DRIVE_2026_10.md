# Stanley Park Drive: high-speed obstruction fixes — 2026-10-22

This work exercises ordinary **Drive** mode, including the existing roadster,
on Stanley Park Drive. It corrects obstructions in the rendered road and floor
selection rather than weakening the shared vehicle impact model.

## Reproduced faults

1. Both surveyed municipal tree candidates and procedural forest candidates
   could put solid trunks inside the displayed asphalt. Native acceleration on
   the east shore, source `1705:0`, travelled only 2.54 m before a trunk stopped
   the car. This was a placement error, not a mature tree's intended resistance.
2. A pedestrian-only Causeway entrance gate crossed an otherwise continuous
   ordinary road in plan view. Its floor-selection priority rejected a car that
   was staying on the road. The generic protected-floor resolver remains strict.
3. Near Prospect Point, source `1585:0`, a native Drive replay stopped against
   the Causeway rail after approximately 5.6 m. Precise source verification
   identified an approximate City right-of-way alignment crossing the Causeway
   where the actual east off-ramp stays beside it.
4. A separate, legal southbound Causeway on-ramp from North Lagoon Drive
   reached a solid rail after approximately 116 m from a clear ground entrance.
   Replaying the actual OSM motor-road chain reproduced it without placing the
   car underneath a protected floor. The northbound exit passed its existing explicit floor gate but then
   drove across an unpaved gap. Both collision and visible asphalt are required
   for acceptance; its missing ground continuation is now added.
5. Near Ferguson Point, approximate source `1593` puts asphalt through the
   collision footprint of an existing shop. Primary OSM confirms that the
   building still exists and the actual motor-road centreline is about 8.5 m
   beside the failing location. The building must remain solid.

The [City's Prospect Point Bridge report](https://council.vancouver.ca/000725/tt3.htm)
and [Park Board Causeway report](https://parkboardmeetings.vancouver.ca/2000/000724/causerpt.pdf)
identify Park Drive's **overpass**, separately from Pipeline Road's underpass.
They do not establish that the misaligned off-ramp is itself a bridge. Precise
[OSM bridge way 41998497](https://www.openstreetmap.org/way/41998497) locates the
actual Park Drive bridge farther north, while
[way 41998501](https://www.openstreetmap.org/way/41998501) identifies the east
off-ramp. Ramp alignment and bridge grade must be corrected separately.
Historical options to lower the Causeway are not measurements of modern bridge
clearance.

The [municipal Non-City Streets dataset](https://opendata.vancouver.ca/explore/dataset/non-city-streets/table/)
contains approximate right-of-way centrelines. A named graph edge is not proof
of a currently paved through-route. Water-covered branches, cliff dead ends,
buildings, real rails and roadside forest remain blocking where appropriate.

## Tree placement

`reconcileParkRoadTrees` runs once, before any far/near tree instances or impact
sources are registered. It tests conservative trunk boxes against actual
ordinary asphalt triangles, scoped to Stanley Park polygons and their holes.
It supports transformed/indexed/interleaved geometry and finite draw ranges;
pedestrian-only surfaces and existing protected bridges are excluded. Explicitly
tagged Park Drive bridge asphalt has a separate height-aware check that retains
trees genuinely clear underneath its deck.

The horizontal half extent is `max(0.18, 0.035*height) + 0.15` metres. This follows
the physical trunk proxy with a small road-edge margin, rather than removing
every tree whose canopy overhangs a road. Municipal source files, retained tree
objects and their coordinates remain unchanged. The filtered array is shared
by every visual LOD and the vehicle collision registry.

The final candidate array has 35,989 trees; 454 road-trunk overlaps are
excluded (246 municipal and 208 generated), leaving 35,535 retained trees.
Correct protected-road masks already prevent 37 other generated candidates
before this reconciliation. The source fingerprint and raw counts are recorded
in the acceptance manifest. Its temporary triangle index is released after
construction; no tree-road reconciliation runs per frame. Node construction
timings are not phone startup benchmarks. Hard construction limits fail closed by retaining trees rather than
using a partial clearance index.

## Ordinary road / pedestrian gate continuation

Only an actually crossed, walk-only ground entrance is eligible for a local
Drive continuation check. The car must already have the ordinary ground
identity. Fifteen support tracks span the 4.8 m by 2 m car; ground permissions,
asphalt height and continuous triangle coverage must agree along the bounded
motion leg. Exact interval coverage catches narrow cracks between height probes.

This does not grant a different floor, bypass a Drive-enabled gate, or weaken
water, building, interior, bridge or prop collision checks. Existing protected
surface identities retain their explicit connections and mode permissions.

## Prospect Point geometry

The bounded correction uses versioned OSM ways and node coordinates recorded in
`lib/city/prospect-point-source.json`, with attribution in `DATA_SOURCES.md`.
It corrects runtime copies of the relevant City source features; original files
in `public/data/` remain unchanged. The north connection follows the relocated
motor-road alignment instead of the obsolete hairpin. This is a local correction,
not a replacement of all approximate City road data across the park.

The real bridge has the explicit `park:prospect-overpass`, layer 2 identity;
the Causeway and its east exit retain `lions:road`, layer 1. Ground transitions
and the ramp junction use explicit physical connections. The lower Causeway's
existing datum remains authoritative. Road width, 5.2 m headroom allowance,
0.5 m slab and approach elevations are game estimates. They are not modern
surveyed or certified engineering dimensions.

Rail openings must match actual motor-road junctions and at-grade crossings.
Other rail geometry remains solid. The upper deck and its physical underside
remain separate from the lower road. Internal source boundaries do not receive
terrain-entry tapers; this avoids warping the deck at an artificial data seam.

## North Lagoon southbound entrance

The legal motor-road chain `42000574 → 116061627 → 604336387 → 116061617`
was missing approximately 151 m of connected asphalt. The added ground-level
lane follows these versioned primary coordinates. Its 4.5 m width is a game
estimate, not a surveyed dimension. The last branch blends to the existing
Causeway elevation and uses a finite, Drive-enabled floor connection.

Only rails and shoulder fragments belonging to the actual intersected source
segments can be trimmed within the motor-ramp corridor. Adjacent barriers and
other roads retain their physical geometry. Mainline cars passing beside the
entrance do not change floor merely because a gate is nearby.

## Tesla compatibility

Ordinary Drive is the requested acceptance target. Changes to protected road
geometry also receive Tesla checks, because its full vehicle body previously
treated a small change of road grade as a solid obstacle. Only explicitly
authored model-road groups use the four wheel contact points and bounded
suspension fit. Other protected floors, roofs, obstacles and the full body
collision sweep remain strict. Actual bridge slab faces replace internal
per-segment closed boxes, so invisible internal caps cannot hit a car driving
over a continuous deck. The physical underside still blocks aircraft and
vehicles approaching from below. A finite road connection must agree with the
actual source surfaces, permissions and height; it cannot join unrelated
floors or cover a missing wheel-support gap.

The ordinary Drive acceptance and Tesla source-route checks have separate
boundaries. Diagnostic controls also retain pre-existing Tesla failures on
legacy protected/ordinary road sections outside the new authored transitions,
including the northbound exit's original protected entry and its original
protected-to-ground endpoint seam. These controls are
not relabelled as passes by moving their starting coordinates or weakening
all Causeway collision. This release does not establish a complete-city Tesla
terrain guarantee.

## Ferguson Point road alignment and a phantom right of way

The local correction follows primary motor-road way `363404509`. A shared City
road node also needs to move, because preserving that original node leaves the
car in the shop's collision footprint. The connected main-road and parking
approach are adjusted locally with the same shared coordinate and bounded
transitions. Original outer connections and building footprints remain intact.

Separate City source `1760` is an approximate private right of way through a
different existing shop, not the current mainline or a mapped parking aisle.
Only its runtime road copy is excluded from pavement, the driving graph and
the minimap. Source collection indices and original public data are preserved;
nearby actual paths and parking-road sources are unchanged. Versioned primary
road/building evidence is retained in `stanley-drive-corrections-source.json`.

## Correct motor access around the bridge and pond

Source `1700` follows the Lions Gate bicycle/footway corridor; primary way
`70954672` explicitly prohibits motor vehicles. Its ordinary ground-road copy
was incorrectly named Stanley Park Drive and led toward the shoreline under
the actual elevated bridge. That car-road copy is excluded. The separately
modelled motor bridge, separated protected walking/bicycle decks and Seawall
paths remain intact.

Sources `1605` and `1782` are inaccurate private ROWs across a mapped park pond
and pedestrian area. Their car-road copies are excluded. Source `1581` retains
its original first four vertices, which match the existing parking approach;
only its tail toward the pond is removed. All eight existing Avison Way features
remain unchanged. The pond, shoreline, buildings and physical barriers retain
their collision rules. Exact source guards and the primary road/pond records
are in `stanley-road-access-source.json`. No global motor-access filter or water
exception is introduced.

The west Causeway exit is different: primary ways `41998502 → 877408900 →
256879277` explicitly allow motor traffic. Its complete approximately 295 m
alignment connects the lower Causeway to the upper Park Drive approach. It
receives an actual road, finite source-owned rail openings and a floor
connection, including the mapped green cycle crossing `1074018477` at the
vehicle-road height. It must not be removed with the non-car ROWs.

## Remaining legal Causeway access and duplicate ground rows

The real northbound on-ramp follows `41998500 → 877408904`, including the
at-grade cycle crossing `1252160597`. It connects the corrected Park Drive
junction to the unchanged lower Causeway with one finite ground entry.
Source `1693` is a legal motor ramp and is retained with corrected geometry.
Its initial distance blend created an artificial 24.18% crest. A source-chainage
Hermite profile retains the ground entry and actual main-road datum while
reducing the authored section grade to below 10%; a permanent whole-source
regression enforces a maximum 14% grade and real vehicle breakover clearance.

The northbound exit follows `363693717 → 156891517 → 604336388 →
1299818249 → 116061634 → 1299818248`. Its original protected approach and
`park-access-city` floor gate remain intact. The final 132 m now have visible
asphalt, conforming to the actual endpoint plane and ground relief. Its 6 m
width is a game estimate. Tests cover the complete 262 m route in both
directions, at 50, 120 and 205 km/h, with tyre support on actual triangles.
The mapped zebra/cycle crossing `918813454` and connected cycleways
`363686510` / `116061622` stood approximately 0.3–0.47 m above this road.
Only their actual asphalt overlaps adopt the road triangle planes; a finite
source-owned shoulder/curb opening clears the motor corridor. Their outer
planes, walk-only identities and unrelated paths retain their original geometry.
A 2,025-point whole-lane sweep of the new 132 m continuation finds no raised
walk surface over 0.2 m at the centre and tyre-track samples.

Fourteen approximate, unlayered City rows duplicate the authoritative
Causeway or its corrected exits. They are excluded only after replaying the
complete southbound exit, northbound exit and Georgia-to-northbound connection
with the copies absent. All three retain collision clearance and full ground
asphalt. Exact source guards and primary motor-road evidence are retained in
`stanley-road-access-source.json`; raw public data and collection indices stay
intact. A ground-road graph edge must not be added for an elevated ramp: the
current graph drives traffic/spawn placement and ordinary pavement, while the
player uses explicit surface identities and gates. New source-owned routes
retain separate metadata and QA paths rather than creating duplicate ground
pavement under a protected deck.

## Verification method

Run `node tools/audit-stanley-drive.mjs --output work/stanley-drive-current.json`
to reproduce the complete current-road sweep. The canonical CPU fixture builds
the actual terrain, pavement, protected surfaces, retained tree colliders and
production `StreetNavigation.moveDrive` path. Its street-lamp population is
empty; native browser runs use the complete runtime scene.
The final current ordinary graph sweep completed all 1,224 cases over 68 road
chains of at least 12 m, with no skipped entry, collision stall or vehicle damage. Sweeps cover
50, 120 and 205 km/h, both directions and centre/±1.5 m offset lanes. The total
220.2 km is accumulated replay distance, not unique park-road length. Protected
source ramps and their ground connections have separate complete-route tests.
These are deterministic steering replays, not a claim that a human drove a
complete circuit at 205 km/h.

Native browser cases use the real Drive controls and public placement. The
loopback-only `Stanley Drive QA` selector places a stationary car once and then
records native acceleration/braking, position, floor identity, damage and real
collision queries. It injects neither speed nor obstacle breakage and never
teleports a car during a run. Entries record existing damage/breakage so a prior
crash cannot be mistaken for a clean comparison. Tesla activation and hidden
pages are excluded from the recorder. These diagnostics are stripped from, and
checked absent in, ordinary Firebase production builds.

Raw before/after captures, hashes, route results and final release checks are
recorded in `docs/qa/stanley-drive-20261022/`.
