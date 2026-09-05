# Vancouver Convention Centre West — original procedural asset

`convention-centre.ts` exports only `createConventionCentre(detail: boolean): THREE.Group`. The returned group is at local origin; units are metres and +Y is up. It has no renderer, DOM, texture download, engine, or light dependency. All geometry and fittings were authored for this project. No third-party 3D asset was used. Research photographs are not included, mapped onto the model, or redistributed.

## Integration

Read `group.userData.placement`: `{lon:-123.1159678, lat:49.2890752, yaw:-0.403, baseY:4}`. Translate through the app's existing projection, apply the yaw, and use baseY as the global Y translation. Do not rescale to the former 200×138m box. The roof wings extend farther north than that box.

The metadata interface matches the primary landmark assets:

- `nightMaterials`: five `{material, intensity}` references. Emissive intensity starts at zero; the app supplies its night multiplier. There are no PointLights. Material `userData.nightIntensity` also records the target.
- `solidFootprints`: one closed local XZ ring for the podium. Transform it with the same yaw and translation before collision use.
- `bounds`, `triangleCount`, `meshCount`, `detail`, `originalProceduralGeometry`.
- `replacementBuildingKeys: ['152366']` and `replacementFeatureIds: [160690,162308,162309]`. The former model overlaps the COV 2009 features for this entire building. Filter `String(properties.structureId ?? properties.buildingId ?? properties.id) === '152366'` from generic rendering; preserve nearby Rogers Tower and Fairmont Pacific Rim.

Dispose each mesh geometry and material when removing the group. All twelve meshes use separate material batches, with no shared resources between calls. Preserve the wood underside material's DoubleSide setting. Glass is intentionally opaque PBR with tinted panes and night emission, so it works with the project's SSAO pipeline without alpha sorting. This is an exterior model; no interior access is represented.

## Sources and measurement decisions

Sources were reviewed 2026-09-05. Source images served only as visual references.

| Source | Model decisions supported |
| --- | --- |
| [LMN Architects project](https://lmnarchitects.com/project/vancouver-convention-centre-west) and its [aerial photograph](https://lmnarchitects.com/wp-content/uploads/2021/10/VCCW_2-2000x1500.jpg) | Four asymmetric planted roof folds, a narrow recessed service court, drainage divisions, perimeter promenade, and the relation to the waterfront. The published roof area is six acres. |
| [LMN exterior photograph](https://lmnarchitects.com/wp-content/uploads/2021/09/WSCCS_Image-Page3-2000x800.jpg) | Roof cantilevers, thin dark fascia, wood-coloured soffits, outward-leaning curtain walls, concrete supports and warm night appearance. |
| [DA Architects project](https://www.da-architects.ca/projects/vancouver-convention-centre-west/) | Sloped timber ceilings, angular roof forms and glazing; architect-confirmed material character. |
| [LMN waterfront research](https://lmnarchitects.com/lmn-research/how-vancouver-greened-its-waterfront) | Public perimeter circulation, planted roofs without general public access, and a five-tier marine habitat skirt. |
| [Operator sustainability](https://www.vancouverconventioncentre.com/about-us/sustainability) and [annual roof trim](https://www.vancouverconventioncentre.com/news/living-roof-gets-its-annual-trim) | Roof planting is a natural meadow, not a mown lawn. The visual model uses sparse deterministic grass clumps; it does not reproduce every real plant. |
| [CISC structural project](https://www.cisc-icca.ca/projects/vancouver-convention-center/) | Irregular sloping roof construction and steel support structure. The asset is a visual exterior, not a structural engineering model. |
| [City of Vancouver 2009 building footprints](https://opendata.vancouver.ca/explore/dataset/building-footprints-2009/information/) | Building ID 152366: northern roof extrema and maximum source elevation. Feature 160690 reports base 9.50m plus height 24.68m, giving approximately 34.18m datum. Features 162308/162309 are associated north-side parts. The resulting model maximum is approximately 34.39m datum, including roof coping. |
| [OSM main outline](https://www.openstreetmap.org/way/85240507), roof parts [1526189023](https://www.openstreetmap.org/way/1526189023), [1526189024](https://www.openstreetmap.org/way/1526189024), [1526189025](https://www.openstreetmap.org/way/1526189025), [1526189026](https://www.openstreetmap.org/way/1526189026), [1526189027](https://www.openstreetmap.org/way/1526189027) | Interior fold boundaries and four skillion roof directions (220°,40°,220°,290°) plus the flat central court. Coordinates were locally projected and rounded to centimetres for compact readable source, which does not imply survey precision. |
| [OSM roof direction semantics](https://wiki.openstreetmap.org/wiki/Key:roof:direction) | The direction describes downhill runoff, used to orient opposite roof pitches. |

The main OSM enclosure is about 22,234m² and roughly 202×141m in this local frame. City 2009 roof extrema extend farther north, producing a roof envelope roughly 207×165m before minor coping; these mapped northern wings are combined with the OSM internal fold edges. The full model, including promenade and marine shelves, spans approximately 220×174m. This avoids copying the previous overly rectangular footprint.

Roof slopes, individual eave elevations, mullion spacing, columns, light positions, rooflights and service fittings are **visual approximations**. Only the global scale, mapped roof outline and topological fold arrangement are tied to the listed geographic sources. Ground podium, basement floor and sea-level skirt are adapted to the app's fixed baseY=4. They are not a surveyed finished-floor or tidal datum model. The asset omits adjacent Jack Poole Plaza, Cactus Club, Fairmont/Rogers towers and the Canada Place connector rather than occupying their real footprints.

## Validation

Run `node validate.mjs /absolute/path/to/vancouver-twin`. It uses only that checkout's already installed TypeScript and Three.js packages, reads the checkout without writing it, and saves `validation.json` beside this document. It performs strict TypeScript checking, constructs both LODs, measures triangles/draws/buffer bytes, checks matching finite position/normal/UV attributes and rejects degenerate triangles. Limits are medium≤20,000 triangles, detail≤65,000 triangles and ≤12 meshes each.

This validation does not claim a rendered browser or lighting review. The integrating parent task performs the scene-level visual and performance review. Both levels preserve the same silhouette, mapped extent and material count; Ultra increases glass bays, roof grass and timber rib density.

Original source code belongs under the parent project's MIT license. Geographic inputs retain [City of Vancouver Open Government Licence](https://opendata.vancouver.ca/pages/licence/) and [OpenStreetMap ODbL attribution](https://www.openstreetmap.org/copyright). Architecture reference photographs retain their authors' copyright and are not part of the asset.
