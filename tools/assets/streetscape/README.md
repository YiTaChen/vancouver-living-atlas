# Vancouver Original Streetscape Kit

Original reusable near-street assets created for Vancouver Living Atlas. They express local architectural **types**, not surveyed replicas of particular buildings. No third-party mesh, photograph, texture or Spiderbench content is included.

## Generate

For the shared city material workflow and independently editable per-LOD Blender
sources, use [the city PBR library](../city-materials/README.md). The shipped v3
bays are saved before baking under `source/heritage-shop-bay.lod{0,1}.blend` and
`source/modern-lobby-bay.lod{0,1}.blend`. `--from-source DIRECTORY` re-exports
those edited sources without regenerating their shape or UVs. The shared catalog
controls physical texture scale; bay UVs are reprojected after the compact shape
is finalized. Glass remains a separate PBR material.

Requires Blender 4.5 or newer (including its bundled NumPy). Paths are portable; no package installs or network requests occur.

```sh
blender --background --python tools/assets/streetscape/generate_streetscape.py -- --output work/streetscape-source
```

Add `--skip-render` to export only, or `--quick-preview` to render just the compact bays. Generation is deterministic (seed 928). The generator emits two GLBs per module, PNG material maps, a statistics/placement manifest, a source `.blend`, and three preview PNGs. Texture maps are generated from mathematical brick bond, noise and wood-grain functions, not sourced imagery. The two 3.2 m bay modules and shelter bake color-only basecolor, tangent normals, and roughness/metallic to 1024 px LOD0 / 512 px LOD1 UV atlases. Atlas ORM red is 1, green is roughness, blue is metallic; no lighting or shadows are painted into the basecolor.

## Runtime coordinates

GLB uses metres, **Y up**, and **+Z toward the street**. The pivot of facade modules is the centre of the frontage at ground level, with the compact bay relief extending only in +Z. Large optional facade interiors extend in -Z. Furniture pivots are at ground level. Blender's authoring coordinates convert automatically during glTF export: `(x, y, z) → (x, z, -y)`.

Place facade modules on a compatible outer building edge and suppress overlapping procedural windows/walls in the same frontage. Compact bays are at most 3.2 m high, with lower door geometry retained at human scale and an authored compact transom/sign/crown. This accounts for the sidewalk-to-foundation datum offset before the first upper window. The compact bay interiors are authored as 0.28 m surface relief in front of the uncut GIS facade, preserving metre-scale width and height. Their canopies extend over the sidewalk; their entries do not add walkable openings or alter collision. Preserve dimensions of entries, seats and lamps; avoid nonuniform scale. Baked bay textures use a single UV0 atlas; source materials use metre-based UVs before baking.

All geometry within a GLB is joined into one mesh with shared materials. No camera, runtime light, animation or non-mesh node is exported. The loader can flatten its glTF transform then instance the primitives/material groups. Do not accidentally flatten the axis conversion twice.

Core bay modules and shelter have at most three materials: baked opaque PBR, glass and emissive diffuser. Furniture and optional large hero facades use globally shared semantic source materials. Glass is conventional alpha blend, without expensive transmission. Emissive lantern glass does not illuminate surrounding objects; choose runtime illumination separately. Use bounding dimensions and clearance in `manifest.json` for placement.

LOD0 includes edge bevels, fine interior details and smooth profiles; LOD1 preserves primary shape while removing small contents, most bevels and reducing curved-segment counts. Suggested initial switches are 60 m and 150 m; tune to projected size, device and actual runtime measurements.

## Architectural references

Read only for general design knowledge; no images or geometry copied:

- [City of Vancouver Gastown Heritage Management Plan](https://vancouver.ca/files/cov/gastown-heritage-management-plan-2001.pdf): tall open shopfronts, masonry upper walls, punched windows, crown cornice.
- [Gastown HA-2 Design Guidelines](https://vancouver.ca/files/cov/gastown-ha2-design-guidelines.pdf): sign bands, window surrounds, moulded cornices, masonry character.
- [Central Area Pedestrian Weather Protection](https://guidelines.vancouver.ca/guidelines-central-area-pedestrian-weather-protection.pdf): rain canopies and sheltered storefronts.

"Harbour & Pine" is fictional decorative lettering. The generic transit shelter is not an official TransLink product or a surveyed stop. The names and forms should not be used as factual POI identifiers.

## License

Original geometry, generated textures and generator inherit the repository’s Vancouver Living Atlas Noncommercial Research and Attribution License 1.0 (`LicenseRef-Vancouver-Living-Atlas-NC-1.0`). See the repository root `LICENSE`; no additional license grant is introduced. Reference documents retain their own terms and are not distributed in the kit.

## Shipping scope

Only the compact heritage and modern bays are loaded in the app. Optional furniture and the large facade modules are generated for future authored scenes; their GLBs are not included in the production bundle. The shipping manifest is `public/models/streetscape/manifest.json`.

Validate shipping GLBs with `python3 tools/assets/streetscape/validate_streetscape.py`. Validate a full source build with `python3 tools/assets/streetscape/validate_streetscape.py --root work/streetscape-source`.

Runtime caps are High: 4 cells, 24 bays, 6 LOD0; Ultra: 6 cells, 36 bays, 10 LOD0. Remaining visible modules use LOD1. Cache is limited to 12 cells, and one cell is assembled per frame. Only the exact upgraded ground-frontage instances are suppressed; all upper windows and cap-excluded shops remain.
