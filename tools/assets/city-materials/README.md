# Shared city PBR material library

The editable catalog is the source of the eight original material families used by GIS-derived architecture, street surfaces and authored frontage modules. They are representative architectural finishes, not scanned or surveyed Vancouver materials. No downloaded texture, photograph or baked illumination is included. Repository licensing applies.

| Slot | Surface | Physical repeat, metres | Intended role |
| --- | --- | --- | --- |
| 0 | `heritage-brick` | 1.728 × 1.728 | Heritage masonry walls and frontage piers |
| 1 | `sandstone` | 1.2 × 1.2 | Sills, surrounds, cornices and thresholds |
| 2 | `concrete` | 1.5 × 1.5 | Contemporary walls and mineral surfaces |
| 3 | `cedar` | 1.52 × 1.52 | Residential cladding and interior timber |
| 4 | `roof-shingle` | 1.8 × 1.92 | Pitched residential roofs |
| 5 | `street-brick` | 1.92 × 1.92 | Water Street paving |
| 6 | `painted-metal` | 0.8 × 0.8 | Frontage trim, doors and rain protection |
| 7 | `asphalt` | 3 × 3 | Road surface material family |

The slot list is an integration contract. Changing it requires updating runtime surface assignments, catalog, generated manifest and validation together. A catalog entry does not imply every eligible surface has already been converted: inspect the runtime consumers when expanding placement.

## Author once, integrate by surface role

`catalog.json` controls scale, relief, roughness, metalness and the source palette. `generate_city_materials.py` creates periodic mathematical fields in Blender's bundled NumPy, constructs named Blender materials, packs all 24 source images into an editable library, and renders a material board. The eight materials and their explicit node graphs are retained in `source/city-material-library.blend`. Source PNGs remain available under `source/textures` for rebaking or external inspection.

Two packaging paths share those definitions:

- GIS geometry samples a shared 1024 × 512 atlas through `lib/city/material-library.ts`. Each 256-pixel slot contains 240 useful pixels plus eight wrapped pixels on each edge. The source images are 480 × 480. Slot row zero is the lower UV row; PNG files store top scanlines and the texture loader handles the vertical conversion. Metre UVs are divided by the catalog repeat dimensions before sampling. Footprint filtering fades to the measured slot average before distant mipmaps mix neighboring materials.
- Detailed frontage GLBs reuse the same source PNGs and physical repeat dimensions. Their dimensioned, joined meshes are saved **before** atlas baking as four separate `ID.lod0.blend` / `ID.lod1.blend` files. Reproject metre UVs after the compact-bay geometric deformation; pre-deformation UVs would stretch material scale. The `--from-source DIRECTORY` path rebakes these edited meshes without repeating their geometric deformation or discarding their authored UVs. The generator then bakes one opaque atlas per LOD, retaining separate glass and diffuser materials. LOD0 uses 1024 × 1024 maps; LOD1 uses 512 × 512. These per-object atlases are distinct from the eight-slot GIS atlas.

Base color is encoded **sRGB**. Normal and ORM are **non-color data**. Normal maps use **OpenGL +Y tangent space**. ORM channels are R=1 (neutral occlusion), G=roughness and B=metalness. Blender connects the ORM channels independently. glTF carries base color, normal and metallic/roughness through their standard texture fields; it does not need an extra color-space extension.

The runtime facade loader remains responsible for placement, source footprint alignment, sidewalk elevation, clearance, collision preservation and LOD caps. The material pipeline does not reposition GIS buildings or authorize arbitrary landmark replacement. Use the surface role consistently across a complete street segment before introducing local finish variants.

## Rebuild and inspect

Use Blender 4.5+ with its bundled Python/NumPy. The system validator needs only Python's standard library. On macOS, the Blender executable may be `/Applications/Blender.app/Contents/MacOS/Blender`.

```sh
blender --background --factory-startup --python tools/assets/city-materials/generate_city_materials.py -- --output public/materials/city --source tools/assets/city-materials/source

blender --background --factory-startup --python tools/assets/streetscape/generate_streetscape.py -- --output work/city-streetscape --shared-materials tools/assets/city-materials/source/textures --only-shipping --quick-preview

python3 tools/assets/city-materials/validate_city_materials.py --streetscape-source work/city-streetscape/source --streetscape-root work/city-streetscape --report work/city-material-validation.json

python3 tools/assets/streetscape/validate_streetscape.py --root work/city-streetscape

# Re-export the independently edited per-LOD sources without regenerating their geometry.
blender --background --factory-startup --python tools/assets/streetscape/generate_streetscape.py -- --output work/city-streetscape-rebaked --from-source work/city-streetscape/source --shared-materials tools/assets/city-materials/source/textures --only-shipping --quick-preview
```

`--skip-render` skips only the preview render. Keep the source catalog, generator, library `.blend`, separate module `.blend` files, manifests and final maps together when publishing an asset milestone. The preview-stage `streetscape-source.blend` contains imported baked GLBs; it is useful for inspection but **does not replace the separate pre-bake sources**.

The material validator checks PNG integrity/CRC/filter decoding, dimensions, runtime hashes, all eight slots, every wrap-padding texel, encoded average colors, normal vectors and ORM ranges. It opens the actual `.blend` files read-only in Blender to verify packed images against the source PNGs, physical UV scales, color spaces and channel wiring. Optional module inspection checks that UVs match the final metre geometry. Optional GLB inspection checks embedded PBR images, LOD dimensions, neutral material factors, bounded UV0 and covered tangent-normal data. Run the existing streetscape validator as well for mesh counts, bounds and primitive budgets. `--skip-blender` explicitly reports source inspection as skipped; it is not a complete source validation.

Generated reports include catalog/generator/source hashes. Deterministic mathematical fields allow image comparisons across clean rebuilds with the same tool versions; a report's hashes establish the inspected inputs, not a claim that Blender container bytes are stable across versions. Before shipping, inspect the material board and GLBs, then verify the integrated city in clear, overcast, dusk and night views. Atlas integrity alone does not establish correct lighting, placement or frame rate.

## Export hand-edited material nodes

The catalog generator is a clean rebuild of the original mathematical materials. It does **not** read artist edits from a `.blend`. To retain those edits, save a separate working copy of `source/city-material-library.blend`, edit the material node graphs, and run the independent exporter:

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/assets/city-materials/export_material_library.py -- --blend work/material-edit/city-material-library.blend --output work/material-edit-export --source work/material-edit-source
```

Both destination directories must be new or empty, separate from one another and from the input `.blend` directory. The exporter refuses destinations inside `public/`; it never publishes or replaces the shipping maps. It copies the input `.blend` byte for byte into the requested source directory and checks that the original hash remains unchanged. All bake planes and temporary material changes exist only in the Blender process. City geometry and the artist's source geometry are unchanged.

Keep the eight materials' `surface_id` custom properties and the catalog's physical repeat dimensions. Each material must have one active opaque Principled BSDF connected to its material output. Edit the node graphs driving Base Color, Roughness, Metallic and Normal, including texture, color adjustment, math, normal-map and bump nodes. Metre coordinates come from `UVMap`: one physical tile covers the catalog's width and height, and the existing mapping nodes convert metres to the desired repeat. Keep repeating patterns seamless. Use **File → External Data → Pack Resources** before saving added image textures so the copied source is self-contained.

The exporter evaluates each graph on a temporary tile with metre source UVs and a separate normalized bake UV layer. Cycles emission passes capture unlit base color and ORM; the tangent-normal pass captures normal/bump edits. It writes all 24 source maps at 480 × 480, then area-filters linear color and data to 240 × 240, renormalizes filtered normals, and adds the same eight-pixel wrapped padding used by the runtime. Base color receives the sRGB transfer function exactly once; normals and ORM remain non-color data, with OpenGL +Y normals and neutral occlusion R=1. `--samples 8` is the default CPU bake setting.

The output `manifest.json` retains the runtime slot contract and records the exported color, roughness and metallic means for distant/failure fallbacks. It includes map hashes and input `.blend`, catalog and exporter hashes. `bake-report.json` records source-map hashes and numeric checks. The copied `.blend` is the **editable node graph snapshot**, while `source/textures` contains its **evaluated bake results**; those output PNGs intentionally need not match the graph's packed input textures. Point the existing streetscape generator's `--shared-materials` argument at the exported `source/textures` when preparing corresponding frontage assets in a separate work directory.

This format supports opaque color/normal/roughness/metallic surfaces only. Glass/transmission, alpha, layered shader mixtures, displacement, emission, subsurface, coat, sheen, anisotropy, custom IOR/specular response and view-dependent materials require separate runtime support and are rejected. Images must be packed single images; animated and UDIM textures are not supported. Tangent normals and metre `UVMap` are required. This is a material bake on a flat tile, not a way to transfer arbitrary sculpture or add geometry. Generated/object-coordinate patterns are evaluated on that tile; use metre UVs when placement-independent architectural scale matters.

Review the exported maps, tiling boundaries and rendered materials before integration. The existing catalog validator deliberately checks the original generator's node wiring and narrow roughness/metalness rules; it is **not** a validator for arbitrary edited node graphs. The exporter's numeric report does not replace visual, browser shader, GIS-placement or frame-rate checks. After those checks, integrate the complete set of maps, manifest and corresponding source snapshot together; do not rerun the catalog generator over the edited export.
