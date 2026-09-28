# September 2026 city quality upgrade

Approved scope: improve the existing Vancouver atlas in stages, validate each result, commit/push and merge each accepted stage to `main`. Preserve real geography, navigation and the mobile-compatible path. Original assets and independently written code only.

| Stage | Deliverable | Status |
| --- | --- | --- |
| P0 | Matched-resolution aerial, roof, street and citizen baseline | Complete: [8 captures](upgrade-baseline/README.md) |
| P1 | Ordinary-building materials, roofs and low-rise architecture | Complete: [8 captures](upgrade-architecture/README.md) |
| P2 | Original Blender streetscape GLBs and rigged citizen | Complete: [8 captures and motion](upgrade-assets/README.md) |
| P3 | Bounded visible detail, asset lifecycle and rendering calibration | Pending |
| P4 | Expand reusable architecture across the existing city and validate travel | Pending |

## Matched evidence

Build the existing opt-in QA variant with `VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build`; serve it with `node tools/serve-visual-qa.mjs upgrade-baseline` (use a new label for a new stage). In a visible desktop browser, use **Upgrade matched high** and **Upgrade matched ultra**. Each suite saves four actual canvas PNGs and metadata, at a fixed 1920×1080 drawing-buffer resolution, fixed camera placement and 14:00. It records an 8-second visible sample; this is a diagnostic, not a long-session guarantee. Baseline and candidate comparisons must use the same device and these same controls.

P0 used a fixed 5-second warmup. From P1, warmup lasts at least 5 seconds and waits for the selected architecture cells to finish, up to 30 seconds. `settleMs`, `architectureAtSettle`, and `detailReady` preserve the streaming wait separately from warm frame-time. A timeout or a hidden page during either warmup or sampling invalidates the capture. This comparison therefore measures warmed rendering; it does not imply identical first-use latency. Changing views and moving through new streets must also be reviewed for streaming pauses.

The matched drawing buffer intentionally decouples pixel count from quality; normal High/Ultra presets remain unchanged. Use **Restore normal render size** or reload after measurements. Existing release controls remain available for 60-second travel and cold transitions. Always rebuild normally before publishing; production verification rejects QA markers.

## Acceptance

Baseline on the local Radeon Pro 560X is approximately 18–24 FPS at a matched 1080p, with occasional long frames. Heavy Blender generation was paused for these final samples. This is an existing performance constraint, so visual upgrades must be evaluated against frame times as well as screenshots. PNGs are original renderer outputs, without resampling.

Review ordinary roofs and street buildings, not just landmarks. Preserve silhouette at all distances, coherent window/door metre scales, ground contact and stable detail transitions. Inspect day, dusk and night, desktop and compatible graphics. Measure load/first-use pauses separately from warm frame-time. Budget by visible geometry, draw calls, materials and texture footprint; a spatial split alone is not assumed to improve performance.

Archive source fingerprint, device, render size and actual screenshots with each stage. Automated geometry, navigation, lifecycle and build tests complement visual review; they do not replace it.

## P1 implementation

Ordinary source envelopes retain their measured footprints, heights, foundations and collision volumes. The shared building material now distinguishes mineral/membrane roofs from walls and adds metre-scale roof seams, low-contrast weathering, window reveals and view-dependent illustrative interiors. These shader details reuse the existing building draw and brick textures; interiors are an appearance effect.

Nearby original geometry adds parapets, coping, cornices, roof equipment/louvres/ducts and lowrise window surrounds. Roof placement rejects courtyard holes, concave notches and higher source parts. Existing heritage streetfronts and high-rise facade details remain responsible for their respective wall surrounds. The former permanently scheduled roof boxes are replaced by camera-selected, instanced cells. The compatible graphics path bypasses this geometry entirely.

At High, at most 16 roof cells and 7 street cells are selected; Ultra uses 20 and 10. Each cell has at most 650 roof instances or 1,800 street instances, grouped into at most two materials; the cache holds at most 38 records. Preparation yields after 96 planning steps or 1.25 ms, with at most one completed cell attached per frame. These are limits on added architecture, not total scene limits. Geometry generation and attachment timings, selected/ready cells and instance counts are exposed through the QA record.

Validation: TypeScript, all 408 repository tests and the normal Firebase build passed. The new tests cover conservative roof placement, metre-grid alignment, finite deterministic geometry, detail budgets, travel eviction and disposal. Chrome reported no runtime warnings or errors; all eight matched captures have complete selected detail. Original PNGs confirm roof materials/coping/equipment and window depth. High measured 19.4–25.4 FPS and Ultra 19.3–23.8 FPS; the results are mixed relative to baseline, not a general speed increase. Warmup reached 15.62 seconds for the coldest Ultra view. Remaining work includes fairer roof-budget distribution, contact-shadow calibration and street assets; this stage is a material/geometry improvement, not a completed photorealistic city.

## P2 implementation

Original Blender-authored heritage shop and modern lobby bays add bevelled frames, compact sign/transom/crown assemblies, rain canopies, door hardware and shallow display interiors. They are representative architectural types, not surveyed building replicas. They use metre units, two geometric LODs, baked basecolor/normal/ORM atlases and at most three materials. Four shipping GLBs total 4,388,192 bytes. Their 3.2 m height accommodates the actual sidewalk-to-foundation datum; placement also checks the underside of the existing upper-window sill. The opaque GIS wall, source footprint and collision envelope remain intact; these are surface-mounted entries rather than newly traversable interiors.

High limits the kit to 24 bays across four nearby cells, including at most six detailed LOD0 bays. Ultra permits 36 bays, six cells and ten LOD0 bays. One cell is assembled per frame and at most 12 are cached. Only the replaced ground-frontage instances are hidden; older upper windows and excluded shops remain. Balanced/compatible graphics, failed loads and distant views retain the procedural path. Owned geometry, materials, textures and decoded image bitmaps are released on teardown, including asynchronous completion after disposal.

The original citizen is a privately owned skinned GLB: 37,799 triangles, 22 joints, one material and idle/walk/run clips. Its 6,668,168-byte file includes 2048 px PBR maps (approximately 64 MiB decoded texture storage including mipmaps). This is a desktop asset; compatible graphics keeps the original walker. Actual travelled distance drives animation phase and existing navigation owns ground contact, movement and collision. Existing movement speeds remain unchanged: the normal 4 m/s input selects the run clip. Missing/corrupt assets retain the usable original character. The citizen is not a shared mutable skeleton and is explicitly disposed when navigation ends.

Both generators, manifests, licensing and geometry/lifecycle tests are checked in. No third-party model, texture or reference-project code is included. Asset readiness is now part of the matched street/citizen warmup; captures record actual selected/visible kit counts and citizen state. `Upgrade citizen motion 8s` records three real movement snapshots using existing navigation input rather than moving the mesh independently.

P2 validation: TypeScript, all 428 tests and the normal Firebase build passed. Eight final matched images and three actual moving-citizen captures share one source fingerprint. Chrome reported no warnings/errors. High measured 18.9–25.7 FPS and Ultra 16.2–22.1 FPS; several Ultra samples are slower than P1, so this is a content-quality gain rather than a claimed rendering speedup. The source-data placement audit accepts 108 heritage and 13 modern bays before range/LOD budgets; it does not imply every frontage is upgraded. Original coat/denim weight discontinuity, a neck attachment gap and physical sill clearance were corrected before acceptance.
