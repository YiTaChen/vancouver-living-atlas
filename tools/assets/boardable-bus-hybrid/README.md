# Boardable TransLink hybrid exterior

This package fits film-inspired silver/navy/yellow TransLink livery and exterior detail to the existing Atlas low-floor body. The canonical vehicle frame, 6.2 m axle spacing, 0.36 m floor, actual door apertures, door translations, wheel roots and anchors remain unchanged. The accepted Atlas V2/closeup interior remains the runtime cabin; no film interior or sealed film body is attached.

`manifest.json` is the authoritative authoring record. The public manifest is an exact copy. A LOD's `file` is its runtime basename, `export` is its authoring-relative GLB path, `url` is its public path, and `source` is its editable Blender scene. Sources and exports have recorded SHA-256 and byte costs. `baseVehicleContract` references the existing contract rather than duplicating its vehicle/navigation records.

| LOD | Evaluated GLB triangles | Bytes | Primitives | Shared surfaces | Boarding |
| --- | ---: | ---: | ---: | ---: | --- |
| 0 | 8,864 | 486,460 | 21 | 4 | Four door clips + ramp |
| 1 | 4,920 | 285,112 | 21 | 4 | Four door clips + ramp |
| 2 | 302 | 30,704 | 8 | 4 | Closed distant fallback |

The four roles use the existing `automotive-paint`, `rubber`, `transit-glass` and `transit-lights` shared IDs. Paint is a single white-base material: silver, navy, yellow, lettering and detail colors live in `COLOR_0`. No raster textures are required. Each LOD uses identical PBR factors for each shared role. Two-material door panels and independent wheel child meshes account for the primitives; there are only four distinct shared surfaces.

## Editing and reproducibility

- `source/city-bus-12m-exterior.lodN.blend`: editable, neutral canonical exterior sources. No QA ground, cameras, lights or interior is exported.
- `exports/city-bus-12m-exterior.lodN.glb`: runtime payload, byte-identical to the matching public files.
- `build.py`: procedural authoring on `../boardable-bus/build.py` and `door_layout.py`; regenerates sources, exports and daylight previews.
- `export.py`: reopens the saved sources and exports without regenerating geometry. Actual reopening/re-export passed byte-identity for all three files; see `qa/source-reexport.json`.
- `finalize.py`: refreshes metadata from saved source/export bytes.
- `validate.py`: standard-library actual-binary audit, with no Blender/GPU dependency.

Run from the repository root:

```sh
blender --background --python tools/assets/boardable-bus-hybrid/export.py
python3 tools/assets/boardable-bus-hybrid/finalize.py
python3 tools/assets/boardable-bus-hybrid/validate.py
```

Regenerating the entire package and preview suite uses `blender --background --python tools/assets/boardable-bus-hybrid/build.py`, then the metadata/validation commands above. Run a single Blender process at a time.

## Boarding ramp and kneeling

Runtime axes are +Y up, +Z forward, -X right. `boarding-ramp` is a neutral identity child of `vehicle`, hinged at `[-1.25, .36, 4.6]`. Its deck extends +X 1.12 m while stowed, is .86 m wide along Z, and has top Y=0 with .018 m thickness below. The outer landing tip tapers to zero thickness. Deployment rotates around local +Z through π plus the measured downward angle; wheel nodes remain independent and receive no kneel keys in the four existing door clips.

The full-width panel is offset -.15 m along Z relative to its hinge, so its actual vehicle Z extent is 4.02..4.88 m. Use **Z=4.45** as the ramp's landing/path center, rather than hinge Z=4.6. A .30 m radius capsule then has .13 m side margin. The unchanged fare pedestal and reader body begin at Z=4.92 (40 mm separation). The small reader screen projects to Z=4.902 (22 mm separation). These bounds are measured from actual closeup GLB component vertices, and the fold sweep preserves Z.

The retained interior has a fixed visual ramp cassette with top Y=.368 and yellow edge finish to Y=.3705 over the stowed deck. This thin support finish is intentional stow contact; the controller must permit that narrowly bounded near-floor contact while keeping above-floor cabin obstacles strict. No cabin geometry was removed to hide a collision. Actual controller triangle-sweep and measured-ground checks are reported separately from the package geometry audit.

`kneelDropM=.0762` is a representative 3-inch body drop from the December 2014 Nova specification's 14.6-inch normal and 11.6-inch kneeled stop height. It is **not a claim about exact vehicle 7416 or a certified accessible installation**. Runtime uses sampled ground for deployment reach and operates the doors/vehicle in the required sequence.

Primary sources:

- [Nova December 2014 typical technical specifications, page 2](https://novabus.com/wp-content/uploads/2017/09/2014_Technical-Specifications-EN-LR.pdf): representative kneel heights.
- [TransLink CMBC Operator Policy & Procedures Manual, section 2.53.4](https://www.translink.ca/-/media/translink/documents/about-translink/freedom-of-information/cmbc-operator-policy--procedures-manual.pdf): kneel before ramp deployment.
- [TransLink bus stops adjacent to cycling design guide, pages 52–53](https://www.translink.ca/-/media/translink/documents/plans-and-projects/roads-bridges-and-goods-movement/design_guide_bus_stops_adjacent_to_cycling.pdf): typical 1.12 m ramp reach and stop geometry.
- [New Flyer SmartRider](https://www.newflyer.com/accessibility-options/smartrider/): background on optional variable kneeling, not attributed to this model/fleet.

## Film donor and fair comparison

`reference/film_bus_reference.py` is derived from the film workspace's `production/bus_model_v2.py`, with stunt thruster hardware and external Arial font loading removed. It uses built-in Blender Bfont and mesh text. `reference/film-bus-upright-reference.blend` contains the complete neutral donor bus, without arena, gas, particles or stunt thrusters; it is reference only, never a runtime attachment. The compressed reference scene is 341,842 bytes but evaluates to 176,242 triangles across 416 mesh/text objects (422 descendants), illustrating why compressed Blender bytes are not runtime geometry costs.

The unmodified original film model independently evaluates to 197,610 triangles / 432 mesh-text objects / 438 descendants, including thruster hardware (`qa/original-film-metrics.json`). The isolated reference above excludes that hardware.

The film donor has a strong night-show exterior silhouette, rounded panels, detailed wheels, lighting and 34 simpler seats. Its 0.75 m main floor, 1.07 m rear floor, sealed door/body geometry and noncanonical axles make whole-shell reuse unsuitable for the Atlas boarding contract. The retained Atlas closeup interior has 24 active seats and 278,528 triangles, with richer cab, seat, handrail and floor detail. It remains the better close interior and is unchanged; this package improves the exterior while respecting that composition.

Neutral daylight comparison images are in `qa/previews/`:

- `atlas-baseline-daylight-front.png`, `hybrid-daylight-front.png`, `film-reference-daylight-front.png`.
- `atlas-baseline-daylight-right.png`, `hybrid-daylight-right.png`.
- `hybrid-doors-open-with-retained-interior.png`, `hybrid-kneel-ramp-deployed.png`.
- `hybrid-retained-Atlas-interior-aisle.png`, `film-reference-interior-aisle.png`: matched 1.60 m eye height above each actual floor and 24 mm lens. These show the same cabin region, without claiming identical incompatible body dimensions.

`qa/geometry-validation.json` contains actual GLB measurements, unit-normal/nondegenerate-triangle checks, all canonical sampled door clip values, 70 open-door hole rays per boarding LOD, independent wheel/anchor checks, ramp tip/winding and fare-component bounds. Rendering is visual evidence, not a replacement for runtime navigation and measured-ground acceptance.
