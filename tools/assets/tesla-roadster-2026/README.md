# Detailed 2026 Roadster for Vancouver Living Atlas

This package derives three city LODs from the original high-detail October 2026
Roadster Rocket reconstruction. The full editable Rocket and two-seat Thrust
references remain in `source/reference/`; they are not imported by the city.
The existing independent Tesla driving/flight controller consumes the compact
synchronous JSON instead of downloading a hero GLB during a manoeuvre.

| City quality | Triangles | Mesh parts | Editable source | Inspection GLB |
| --- | ---: | ---: | --- | --- |
| high | 54,201 | 34 | `source/tesla-roadster-2026.lod0.blend` | `exports/tesla-roadster-2026.lod0.glb` |
| medium | 28,484 | 34 | `source/tesla-roadster-2026.lod1.blend` | `exports/tesla-roadster-2026.lod1.glb` |
| low | 10,753 | 34 | `source/tesla-roadster-2026.lod2.blend` | `exports/tesla-roadster-2026.lod2.glb` |

Each door ambient strip retains its own emissive `accent` part. The inspection GLB
also preserves the donor red emissive factor, since glTF vertex colors tint only
base color.

The city payload is `exports/tesla-roadster-detailed-data.json`, copied byte for
byte into `lib/city/assets/tesla-roadster-detailed-data.json`. It is 2,194,905 bytes
before transport compression. The manifest records all payload/source hashes.
The donor Rocket has 561,694 exported triangles, 1,033 mesh primitives and a
11,970,040-byte GLB. Its finer stitches, tyre lettering, drilled-rotor mouths,
small fasteners and dense panel tessellation are simplified for the city.

## Coordinate and data contract

Every derived mesh and rig node uses metres, +X driver left, +Y up, +Z forward.
Blender donor coordinates map as `(Y, Z + 0.0005, X)`. The 0.5 mm datum adjustment
removes the donor tyre's small ground-plane overlap. Derived `.blend` files store
the same Y-up authoring coordinates as their GLBs and runtime JSON deliberately;
the original full-detail reference `.blend` files retain ordinary Blender Z-up.

Version 1 JSON positions are little-endian signed Int16, multiplied by 0.0001 m;
normals are signed Int8 divided by 127 and normalized by the decoder. Colors are
absolute linear RGB Uint8 values divided by 255, with white-base role materials.
Indices are little-endian Uint16. Each part's positions are local to its
`assembly`; rig node positions are parent-local. Parent rotations start identity.
Every array is base64 encoded. Meshes are batched by role within an independently
moving assembly, rather than joining the whole car or its fixed brake calipers.

The 34 parts leave room for the runtime's one shared pair of inferred front yaw
port meshes and one bounded instanced cold-gas jet mesh. Those yaw ports belong
to the existing Atlas interpretation and are not asserted to be measured Tesla
engineering. The donor supplies four rear nozzles and four downward nozzles.

## Rig and retained features

- Four wheel roll roots spin about local X; front steering parents rotate Y.
  Fixed calipers stay on steering parents. Wheel centers are at X ±0.84 m,
  Y 0.3505 m, Z ±1.35 m. Quantized wheel radii are conservatively bounded to avoid
  penetration during arbitrary wheel spin. Continuous closed tyres follow the
  donor sidewall widths/profile with the 0.3505 m tread crest; they use 48/64/80
  circumferential segments instead of collapse decimation. A 0.1 mm inward
  quantization allowance keeps the rounded tyre surface above the ground.
- Four independent `rear-suction-fan-N` rotors spin about local Z, inside their
  static rear ducts. Fans are separate from the four rear cold-gas nozzles.
- `active-rear-wing` pivots at `[0, 0.84, -2.205]`; the city adds up to 0.24 m
  lift and −0.28 rad X pitch around this representative foil-center pivot.
- Butterfly door pivots, normalized hinge axes and the removable roof remain
  available as rig metadata. The current city integration does not add door UI.
- The donor driver seat, yoke, displays, visible rear pressure vessel, cabin
  structure, shaped body, white/copper canopy and rear hardware remain visible.
  Rocket's inferred passenger-bay equipment is labelled as an interpretation in
  the preserved source. The two-seat Thrust reference remains independently
  editable and is not combined into the single-seat Rocket city asset.

Runtime copper glazing is one outward-facing source surface with an inexpensive
tinted material. The donor's Solidify inner glass layers and refractive optical
lenses are omitted. This preserves a clear outward cockpit view without a
transmission pass. Surface roughness/metalness are shared by semantic role;
vertex colors preserve the donor's opaque trim and upholstery colors.

## Rebuild and checks

With Blender 4.5, from the repository root:

```sh
blender --background --python tools/assets/tesla-roadster-2026/build.py
python3 tools/assets/tesla-roadster-2026/validate_exports.py
node tools/assets/tesla-roadster-2026/audit.mjs
node --test tests/tesla-detailed-assets.test.mjs
```

`build.py` preserves the full-detail references, evaluates the Rocket, removes
tiny decorative components, strips glass thickness, collapses connected surface
tessellation, clamps collapsed vertices to each original source batch's bounds,
sets hard-edge normals, quantizes the data and removes triangles
that collapse to zero area after quantization. The exact decoded geometry is
then saved to each editable derived `.blend` and GLB. No render or network access
is needed. `qa/extraction.json` lists the intentionally removed object names;
the independent `qa/geometry-audit.json` checks decoded arrays, rig transforms,
animated envelopes, ground support and the source/export hashes.
`qa/tyre-repair.json` proves every non-rubber encoded part was preserved during
the controlled tyre replacement. `qa/decimation-bounds.json` records the per-batch corrections; the GLB validator
allows only the 0.051 mm rounding tolerance outside those source bounds.

Reference: [Tesla Roadster](https://www.tesla.com/roadster?redirect=no), with official
October 2026 reveal images and videos recorded in the preserved original source
generators. All body dimensions, concealed structures and the Rocket passenger
equipment arrangement are image-based modelling estimates, not Tesla CAD.
No third-party vehicle model, Tesla texture or proprietary font is distributed.
Use follows the repository's existing license and attribution terms.
