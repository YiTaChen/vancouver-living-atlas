# Railway scene

The scene adds original moving stock to selected OpenStreetMap rail alignments. `public/data/railways.json` preserves source way/relation IDs, ordered original coordinates, source timestamps, bridge/tunnel tags, trimming notes and license terms. Geographic data remain ODbL; the original TypeScript models and animation are MIT.

| Corridor | Open-air length | Original vertices | OSM ways in traversal order |
| --- | ---: | ---: | --- |
| Waterfront–Gastown ground railway | 1,119.04 m | 25 | 85214016, 764843622, 949249832 (source directions reversed) |
| Expo eastbound toward Science World | 855.20 m | 100 | 809550055, 923573507, 923573505, 1044143593 |
| Expo westbound toward Stadium | 893.61 m | 90 | 1044143594, 923573502, 923573506, 379689170 |

Snapshot: 2026-09-04 23:22:30 UTC. The waterfront Cascade Subdivision line appears in [West Coast Express relation 1861617](https://www.openstreetmap.org/relation/1861617); the Expo alignments appear in [eastbound relation 5881297](https://www.openstreetmap.org/relation/5881297) and [westbound relation 207813](https://www.openstreetmap.org/relation/207813). [TransLink describes West Coast Express](https://www.translink.ca/schedules-and-maps/west-coast-express) as its Vancouver–Mission commuter service. The green steam locomotive, tender, four coaches and chimney steam are a fictional heritage demonstration, not a current scheduled service or a West Coast Express vehicle. The two four-car SkyTrain sets are electric and emit no smoke; [TransLink explains the system's power rail and linear induction motor](https://buzzer.translink.ca/2024/05/how-were-connecting-skytrain-to-the-new-maintenance-centre-explained/).

## Geographic scope

The selected source lines stop before station canopy massings, Dunsmuir tunnel and the building passage approaching Main Street–Science World. They do not include station stops or a timetable. Ground endpoints are `[-123.1099598,49.2853487]` and `[-123.0952953,49.2854051]`. Eastbound endpoints are `[-123.108073,49.2785359]` and `[-123.1015802,49.2733165]`; westbound endpoints are `[-123.101562,49.2734021]` and `[-123.1084426,49.2788993]`.

No bridge elevation survey is available in this source. Track grade is a display estimate from existing terrain, constrained to gentle slopes without burying the rails. Elevated alignments start from terrain plus 9.65 m, including the rail/bed offset; piers support the guideway. OSM `layer` is retained as stacking metadata, not interpreted as a measurement. The ground alignment retains the source polyline; dense SkyTrain coordinates use small centripetal-curve interpolation.

## Motion and presentation

All cars share one continuous distance along their route. Car offsets preserve coupler spacing; each wheel axle independently samples rail position and direction. The original model includes wheel spokes, windows, roof equipment, locomotive boiler, chimney, tender and coach details. Speeds are illustrative (11 m/s steam, 14 m/s electric) and use elapsed frame time, independently of the day/night clock. Long background gaps are capped rather than fast-forwarding a train across the scene.

The source paths are open. Cars fade at the cropped route limits; the entire consist exits before the next pass enters. No artificial return track joins the endpoints. The explicit Find action can bring the next service into view during an interval when the entire train is off-scene. Trains are on by default and have a separate Layers switch.

White chimney puffs use a fixed 96-instance pool and one transparent draw call. Each puff remains in world space, rises, drifts, expands and fades over 5.5 seconds; it is emitted only from a moving visible steam locomotive. No sprites, textures, stock models or third-party finished scene were downloaded. Cached city shadows exclude moving train casters; static tracks cast/receive shadows and cars retain ambient occlusion. Fading vehicles and smoke do not write depth or create solid AO silhouettes.

## Validation and reproduction

Ten railway code-level tests cover source topology, heights, grades, metre-based sampling, consist endpoints, frame-rate independence, background gaps, bounded smoke, resource reuse, focus actions, axle/gauge alignment and fade depth behavior. Existing clock, walking, driving, placement, geography and localization checks also pass. No browser interaction, screenshot or GPU performance review was performed for this update.

[Clearance checks](railway-clearance-qa.json) execute the final runtime paths against 7,630 building solids and five custom-landmark footprints. Three 5 m-wide track corridors have no footprint overlap. A conservative 3.3 × 20.8 m body sampled every metre has no intersections in 2,804 poses. The final SkyTrain curves deviate at most 0.0856/0.0878 m from source XY. [Height checks](railway-height-qa.json) use the actual shared terrain foundation rule and find no remaining SkyTrain body-envelope overlap. These checks are approximate scene envelopes, not certified clearances or triangle-level contact.

The [Overpass query](../tools/railways-query.overpass) records source acquisition from `https://overpass-api.de/api/interpreter`. Route source IDs, segment direction, retained endpoint vertices and resulting coordinates are self-contained in the published JSON. Raw Overpass responses and preparation intermediates are not runtime dependencies and are not included. Re-querying evolving OSM records can change results.

Map data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); retain [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).
