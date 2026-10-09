# Mark V SkyTrain interior: independent offline candidate

溫哥華最新 Mark V／Expo Line 車內重建候選。這是獨立的 A 型端車視覺模型，不替換或改名既有 Canada Line 資產；尚未整合 runtime，也不宣稱可以上車、跨車廂行走或與月台相容。

## What is delivered

- Original editable high-detail `source/mark-v-a-car-study.blend`, with independently selectable sculpted upholstery, molded shells, open seat grips, continuous swept rails, rounded window/door reveals, glass dividers, ceiling coves, fittings, observation salon and an open rear gangway with gray accordion bellows and a level bridge.
- Two editable reduced sources and their real exported GLBs: `mark-v-a-car-interior.lod0` and `.lod1`. Geometry budgets and static-material batches are measured from the delivered binary, not source estimates.
- 22 reference seat anchors in each LOD, reconciled to the official A-car diagram's regional counts, three paired doorway positions per side and two staggered two-pad end-car flex bays. Exact dimensions, seat facings and spacing remain representative.
- Original embedded fabric, floor and information textures. The maker is `make_textures.py`; LOD1 uses reduced versions of the same original art. Official photographic pixels, advertisements and protected divider artwork are not included.
- Actual GLB reimport previews, source reopen/edit/reexport evidence, PBR/texture inventory and conservative static clearance checks in `qa/`.

## Preview views

[Open connection into adjacent QA cabin](qa/previews/06-open-gangway-continuity.png) · [Open gangway looking into car](qa/previews/04-gangway-return.png) · [Seat and door detail](qa/previews/02-seats-door-detail.png) · [Isolated A-car aisle](qa/previews/01-aisle-toward-gangway.png) · [Isolated A-car LOD1](qa/previews/05-aisle-lod1.png)

Each image comes from the final exported GLB at a recorded human eye height. The isolated aisle views intentionally end at the neutral QA world beyond the short open connector; that background is not a door or endwall. The continuity view imports the same A-car GLB a second time, rotated 180° and translated Z=-17.07 m so the two bridge edges meet. This is an explicitly labeled QA adjacency mock-up, not a C-car reconstruction or a full five-car profile; neither copy is clipped, remeshed or altered. `verify_context.py` checks actual transformed triangles from that same renderer setup: zero triangles intersect the 1.2 m wide connecting prism, and 387 floor probes cross the paired bridges without a gap. See `qa/previews/index.json` for the input hashes and renderer settings, and `qa/visual-review.json` for observations and limits.

## Measured budgets

The constrained LOD0 is 11,016 triangles and 1,179,164 bytes, under 12,000 triangles / 1.5 MiB. LOD1 is 2,976 triangles and 306,220 bytes, under 3,000 triangles / 384 KiB. Both use ten static material primitives. Texture residency across the distinct delivered maps stays below 16 MiB assuming uncompressed RGBA8 with full mip chains.

The separately named high-detail study deliberately exceeds the runtime cabin limits. It is an editable visual source and must never be enabled as the regular runtime representation. Its measured costs are separate in `qa/measurements.json`. Ten primitives is a main-pass geometry submission estimate, not a WebGL draw-call or frame-time measurement.

The reduced sources preserve the same gross openings, seating and rail placement, with editable per-component reduction modifiers. Tiny fasteners, vent perforations, most auxiliary mountings and straps are omitted. Rounded seat/rail shapes have lower tessellation, and LOD1 is intentionally coarse. The high-detail master retains those details for further art editing.

## Scope and coordinates

One glTF unit is one metre: +Y up, +Z toward the observation end. The floor top is Y=0; this is an interior floor datum, not a surveyed rail/wheel datum. The body module is an assumed 15.6 m long, with 2.49 m wall-to-wall interior and 2.265 m central ceiling. The short rear gangway makes the total modeled envelope approximately 16.335 m. The official 84.8 m, five-car consist does not establish these individual car measurements.

Exterior boarding doors are static and closed. The inter-car gangway is open and has no door leaves, glazing closure or endwall across the passage. The six door-reference anchors are not advertised as functioning portals. There is no exterior dependency, door animation, wheel/bogie geometry, platform-height binding, train coupling or full five-car engineering profile. `CanadaLine3m` and the older four-car Expo profile are explicitly incompatible until a new profile is designed and validated.

The aisle test samples a 1.95 m high, 0.25 m radius standing envelope at X=0.33 m, around the center stanchions, from Z=-7.4 to +5.35 m. Three central gangway samples are checked separately. An additional full-volume exclusion checks an unobstructed 1.2 m wide passage from Z=-8.535 to -7.60 m, from Y=0.035 to 2.05 m. This catches panels between sample points and off-center obstructions. Ninety-nine actual-triangle floor probes across that connection confirm support; folded-side regression checks prevent replacement with flat door-like slabs. These checks cover all three delivered variants. Actual triangle intersections also verify the aisle floor at Y=0 and the gangway bridge at Y=0.0025 m; the reduced LOD preserves these planar support meshes. The gangway uses visibly folded gray flexible side surfaces. The gangway header was raised 60 mm in all editable sources; its underside is approximately 2.075 m, above the 2.05 m target. Conservative gangway checks use that 2.05 m reference. The method is conservative component bounds reconstructed from actual exported vertex/index ranges. It is not a continuous capsule sweep, full navigation mesh, front-salon free-walk test, accessibility certification or moving-collision acceptance. Seated ingress and egress remain untested.

## Review and reproduction

From the repository root:

```sh
# Preserves artist edits: opens current .blend sources, never invokes the builder.
blender -b -t 4 --python tools/assets/skytrain-mark-v-interior/export.py -- --output /tmp/mark-v-reexport

# Recompute hashes/geometry metadata after intentionally replacing exports.
python tools/assets/skytrain-mark-v-interior/metadata.py
python tools/assets/skytrain-mark-v-interior/validate.py
python tools/assets/skytrain-mark-v-interior/test_package.py
python tools/assets/skytrain-mark-v-interior/verify_previews.py

# Reopen sources, save an edited COPY, reopen, export and verify its changed geometry.
blender -b -t 2 --python tools/assets/skytrain-mark-v-interior/qa_blender.py -- --sources

# Actual world-space triangles of both GLB instances in the QA continuity view.
blender -b -t 2 --python-exit-code 1 --python tools/assets/skytrain-mark-v-interior/verify_context.py
# Reject the previous ignored-quaternion-rotation failure using actual triangles.
blender -b -t 2 --python-exit-code 1 --python tools/assets/skytrain-mark-v-interior/verify_context.py -- --negative-quaternion-mode

# Actual delivered GLB reimport, human-height CPU preview.
blender -b -t 8 --python tools/assets/skytrain-mark-v-interior/qa_blender.py -- --view all
```

`build.py` reconstructs the starting high-detail model only into a new output location and refuses to overwrite existing sources. Subsequent documented source-edit scripts reconciled the A-car salon and produced the bounded LODs. They are archived one-off edits, are not idempotent, and must not be rerun over the delivered sources; they are not part of ordinary re-export. Treat the delivered `.blend` files as the editable source of truth.

Export temporarily evaluates artist modifiers, triangulates and removes sub-micron degenerate bevel faces without saving those destructive edits into the source. Material batching preserves the actual geometry. Exact source-component index/vertex ranges are retained in hash-paired `.components.json` offline provenance files to avoid shipping hundreds of unused component anchors in the runtime GLB. Those sidecars are not a new passenger/runtime contract. Meaningful seat/door/camera/floor reference anchors remain in the GLB.

`open_gangway.py` records the idempotent open-connection correction: flat black side blocks are replaced with accordion geometry, and the overhead connector lining reuses the existing gray shell material. The floor bridge, shoulders, header, seats, anchors and exterior boarding doors are preserved. No cabin material is recolored.

CPU lighting is QA-only. No camera/light nodes or emissive night-light feature are exported. The installed Blender build has no compiled denoiser; inspection renders use explicitly recorded sample counts and may retain some grain. No generated-image stand-ins, source-only materials or geometry removal are used in the preview pipeline.

## Acceptance boundary

Passed stages are listed individually in the QA reports. Runtime/WebGL, desktop and touch boarding, service behavior, camera handoff, dynamic doors, moving gangway collision, platform interfaces, cache lifecycle and frame-time checks are all `not_run`. Visual improvement and offline geometry completion are not runtime acceptance.

[Reference review and approximation register](REFERENCES.md) · [Manifest](manifest.json) · [Measurements](qa/measurements.json) · [Validation](qa/validation.json)

Based on Vancouver Living Atlas by YiTaChen. Source: https://github.com/YiTaChen/vancouver-living-atlas. License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0.
