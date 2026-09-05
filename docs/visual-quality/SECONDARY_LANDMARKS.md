# Original secondary landmark assets

Prepared 2026-09-05. `landmarks-secondary.ts` contains original procedural Three.js geometry. It imports only `three` and its `mergeGeometries` addon. No downloaded mesh, source-photo texture, logo, or copied ornamental artwork is included. Source photographs were viewed for architectural reference, not redistributed.

## API and integration

```ts
createBCPlace(detail: boolean): THREE.Group
createHarbourCentre(detail: boolean): THREE.Group
createMarineBuilding(detail: boolean): THREE.Group
setSecondaryLandmarkNight(group: THREE.Group, factor: number): void
SECONDARY_LANDMARK_PLACEMENTS
```

All models have local origin at ground datum, metres, +Y up. They do **not** position or rotate themselves. Use the atlas `project([lon, lat])` for horizontal position, `placement.baseY` / `placement.base` when provided, and `rotation.y = placement.yaw`. Harbour Centre deliberately leaves its ground datum unset: sample terrain at its anchor once. Factory coordinates assume the atlas projection scale `111320 * cos(49.286°)` in longitude and `111320` in latitude.

| Model | Anchor lon, lat | Local yaw | Ground datum | Local extent |
|---|---|---:|---:|---|
| BC Place | -123.1120067, 49.2766985 | 0.677 rad | 5 m | about 231.79 × 190.40 m; top 65.64 m above datum |
| Harbour Centre | -123.1120903, 49.2847656 | -0.8 rad | sample terrain | about 79.90 × 81.71 m podium; top 177 m |
| Marine Building | -123.117146, 49.287449 | 0.77 rad | 14.22 m | about 64.84 × 44.08 m; top 98 m |

`group.userData` also includes:

- `nightMaterials`: `{ material: THREE.MeshStandardMaterial, intensity: number }[]`; all start at emissive intensity zero. Root may register these with its existing lighting engine. Optional `setSecondaryLandmarkNight` clamps the factor to [0, 1]. It changes emissive intensity only.
- `solidFootprints`: arrays of **closed local XZ rings**, matching the primary landmark assets. Transform using the same group translation/yaw before registering water obstructions. These are footprint approximations, not public-access boundaries.
- `bounds`: exact local `min` and `max` arrays, computed from the generated mesh.
- `triangles`, `drawCalls`, `detail`, `units`, `originalProceduralAsset`.

No LOD, camera, renderer, shadow, animation loop, or global engine state is modified by these factories. Root controls when to create detail variants. Materials are opaque; dark glazing does not require transparency sorting. Small recessed window planes use a shallow outward offset plus material polygon offset to reduce distance-dependent depth interference.

### Replacing existing geometry safely

BC Place and Harbour Centre replace their existing `Builder` sections; do not add both generators. Their full generated geometry, including above-ground mast/disc positions and facade projections, was tested against the exact existing `work/geodata/landmarks-excluded.geojson` reserved polygons.

Marine Building is currently a general-data building, **not** an existing special landmark. Before adding this factory, omit the following from both general facades and generated roof details:

```text
structureId: osm-structure-19
building IDs: osm-structure-19-0
              osm-structure-19-1
              osm-structure-19-2
```

Leave the original source feature available to navigation, search and data inspection. This model's source is the parent footprint `osm-125579375` and eight explicit building parts, not the erroneous full-height silhouette of the reconciled union. Base datum 14.22 m matches those reconciled source features. Every generated vertex was checked against the original parent footprint, with zero outside vertices.

The original footprint is inset by 2.5% around the crown anchor before adding shallow terracotta projections. The north-west thin wing from the raw source is retained. Heights 8, 26, 40, 68, 74, 80 and 88 m drive the terraces; an original eight-sided lantern/hipped copper crown and finial complete the silhouette at 98 m. Raw building parts can be inspected in `work/geodata/buildings-osm-explicit-heights.geojson`.

## Architectural evidence

### BC Place

- [BC Place official FAQ](https://www.bcplace.com/faqs/): the retractable central opening is approximately 100 × 85 m. That aperture size is used directly (50 × 42.5 m half axes), rather than a generic small circular opening.
- [Stantec — BC Place Stadium Renovation](https://www.stantec.com/en/projects/canada-projects/b/b-c-place-stadium-renovation): the 2011 renovation, cable-supported retractable roof, exterior lighting, centre-hung scoreboard and collaborators provide the architectural context.
- [ECCON — BC Place retractable roof](https://eccon.biz/case-study/bc-place/): the roof mechanism and aerial photographs show the 36 tension-cable arrangement and central aperture.
- [ETS — BC Place Stadium](https://ets-na.com/projects/bc-place-stadium/): inner and outer fixed fabric roof panels, PTFE membrane and nighttime illumination.
- [CISC — BC Place Roof Revitalization Project](https://www.cisc-icca.ca/projects/bc-place-roof-revitalization-project/): the 36 perimeter masts and structural compression-beam arrangement.

Implementation: 36 leaning perimeter masts, radial suspension chords, secondary roof ribs, inner and outer compression/tension rings, analytic doubly curved white membrane gores, illuminated clerestory, hollow concrete bowl, stepped red/charcoal seating with aisles, a marked pitch and original unbranded centre scoreboard. The roof is represented in an open state. This is a static architectural interpretation; roof machinery is not simulated.

The stadium's outer width and yaw retain the existing source-based reservation. A source-measured roof aperture is combined with approximate structural heights/sections within that footprint; this is not a structural engineering or as-built model.

### Harbour Centre

- [Harbour Centre owner](https://harbourcentre.com/): present-day building imagery and the office/historic podium context. The owner photograph `IMG_1958-copy-scaled-1-768x1198.jpg` was inspected to distinguish the two glazed lookout/restaurant levels, tapered underside, wide white roof/floor fascias, mast and regular office window grid.
- [Vancouver Lookout — About](https://vancouverlookout.com/about/): the 1977 tower and historic Spencer Building context, and the WZMH architectural attribution.

Implementation: footprint-constrained Spencer-style cream podium, 28 rows of square office apertures and concrete mullions, exterior elevator ribbon, neck and radial support corbels, two distinct glazed round decks with fine steel uprights and horizontal rails, broad stepped roof, guyed antenna base and multiple antenna collars.

The model preserves the atlas's previous 177 m local top and existing tower/observation anchor positions. Official visitor elevations are not treated as identical to the height of every architectural finial. The precise local lookout offset is `[0.28761196, 0, 12.90171558]`, derived from its separate old longitude/latitude anchor. The 19.2 m maximum disc radius stays within the existing reserved footprint. The historic podium uses a safe simplified polygon within the source outline, rather than the previous centred rectangle that projected across its western notch.

### Marine Building

- [Vancouver Heritage Foundation — Marine Building](https://www.heritagesitefinder.ca/location/355-385-burrard-st-vancouver-bc): McCarter & Nairne, 1929–1930, Art Deco stepped massing, brick and terracotta. Its present-day photo was inspected for the tall pale piers, paired window rhythm, stepped cornices and verdigris hipped crown.
- [City of Vancouver — 2025 Marine Building conservation report](https://council.vancouver.ca/20250506/documents/r6.pdf): the conservation record describes grey granite at the base, variegated brown brick and polychrome terracotta. The PDF is large; indexed document text was used as corroboration, not an as-built geometry source.
- [VHF West Hastings architectural guide](https://www.vancouverheritagefoundation.org/wp-content/uploads/2020/12/VHF-West-Hastings-map-guide-2016-FINAL-web.pdf): historic architectural context.

Implementation: original source-part-based stepped prisms, warm variegated brick colours, long terracotta piers, inset paired-looking windows, thin metal mullions, projecting sills and cornices, abstract stepped chevron relief, dark terrace roofs, a light eight-sided lantern and green hipped crown. Fine maritime sculptures, entrance mosaics and carvings are deliberately not represented as exact replicas. No archival drawing is traced into ornamental geometry.

## Provenance and licensing

The procedural software and original decorative design are offered under MIT with the project. Embedded plan coordinates and height references originate from OpenStreetMap building footprints/parts; keep the project's OpenStreetMap contributor attribution and ODbL source-data notice. The model does not relabel source geodata or source photographs as MIT. Official/architectural photographs are reference-only and are not shipped.

## Validation

Strict TypeScript checked with the checkout's TypeScript 5.9.3 and Three.js / types 0.185. The module was transpiled and imported in memory; the Site checkout was not changed. Both `detail=false` and `detail=true` were instantiated and all position, normal and colour components checked for finite numbers, all triangle areas checked for degeneracy, all generated vertices checked against the correct source/reserved polygon, and the night material setter exercised at factor 0.7.

Final per-model counts and bounds are in each returned group's `userData`; the tested Ultra ceiling is 100,000 triangles for BC Place, 40,000 per tower, 20 material meshes per site. No point lights or textures are allocated. All intermediate primitive geometries are disposed after merging. Root owns browser/WebGL inspection and integration testing.
