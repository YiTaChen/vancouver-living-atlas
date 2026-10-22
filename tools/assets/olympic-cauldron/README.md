# Olympic Cauldron: original runtime mesh and editable Blender source

The runtime source is `lib/city/assets/olympic-cauldron.ts`. It returns three opaque, texture-free THREE meshes with independently owned geometries and materials. There is no engine dependency or animation callback. `Y=0` is the contact plane; the asset does not contain a plaza, reflecting pool, flame, lamp, or navigation surface. Normal engine traversal can dispose its resources, or isolated previews can call the idempotent `disposeOlympicCauldron(group)` helper.

The finished mesh is 10m high and approximately 12.003m across X/Z, with four 1.2m chamfered-square arms. Each arm extends from a ground-level corner across the centre to an opposite elevated burner. A fifth, central crystal reaches 10m. Recessed dark wells represent the five unlit mouths in the everyday state. Glass is represented by opaque frosted blue-white facet colors, raised steel edges and transverse joints to keep city transparency and draw-call costs predictable.

## References and interpretation limits

- [Vancouver Convention Centre: Olympic Legacy](https://www.vancouverconventioncentre.com/about-us/our-story/olympic-legacy) publishes the 10m height and permanent Jack Poole Plaza location.
- [Glotman Simpson: Olympic Cauldron](https://glotmansimpson.com/project/olympic-cauldron-at-vancouver-convention-centre/) publishes 10m height, 12m width and four 16.5m × 1.2m arms, with polycarbonate/furnace-glass cladding over steel and parabolic mirrors.
- Complete unlit views from [Destination Vancouver](https://www.destinationvancouver.com/things-to-do/listings/2010-olympic-cauldron-jack-poole-plaza) and the official Convention Centre page were checked visually, including the arms continuing beyond their intersection and the five burner openings.

This is an original visual interpretation, not surveyed fabrication geometry. Arm endpoints, cross-section corner bevels, joint spacing and the central crystal profile are photo-based estimates. The visible centreline span used here is about 13.907m; the published 16.5m arm length is not asserted to be the visible above-ground span. Actual underground structure and exact connection engineering are not modeled. No source image is included or used as a texture.

## Rebuild and verify

Run from the repository root, with the repository's Node dependencies installed:

```sh
node tools/assets/olympic-cauldron/export-runtime-mesh.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/assets/olympic-cauldron/build_blender.py -- --mesh work/olympic-cauldron/runtime-mesh.json --blend tools/assets/olympic-cauldron/olympic-cauldron.blend --preview work/olympic-cauldron/preview.png
/Applications/Blender.app/Contents/MacOS/Blender --background tools/assets/olympic-cauldron/olympic-cauldron.blend --python-exit-code 1 --python tools/assets/olympic-cauldron/validate_blender.py -- --mesh work/olympic-cauldron/runtime-mesh.json
node --test tests/olympic-cauldron.test.mjs
```

The exporter executes the actual runtime factory and writes its exact Float32 position, normal and linear vertex-color attributes into an ignored work file. Blender imports those vertices and triangles with a reversible `(x,y,z) → (x,-z,y)` axis conversion; it does not independently rebuild an approximation. Three editable material meshes each contain named vertex groups for the four arms and central crystal. A separate studio collection provides a camera, floor and lighting for the offline preview only. The saved file is independently reopened and validated against the fresh runtime export, including byte-exact Float32 positions and vertex colors, triangle counts, material settings and all fifteen selection groups.

`manifest.json` records source/mesh hashes and actual resource costs. `.blend`, generator scripts and manifest stay under `tools/assets/`; they are authoring sources and are not requested by the browser or deployed as runtime models. Preview PNG and intermediate JSON stay under ignored `work/olympic-cauldron/`.
