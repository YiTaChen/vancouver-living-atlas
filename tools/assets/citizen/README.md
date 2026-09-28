# Original Vancouver citizen — integration

All geometry, textures and animation are original output of `build_citizen.py`, created for Vancouver Living Atlas. No reference-project code or external asset was reused. Source and generated assets remain under the repository's LICENSE.

## Files to integrate

- `vancouver-citizen.glb` → `public/models/citizen/vancouver-citizen.glb`.
- `metadata.json` → `public/models/citizen/metadata.json`.
- `build_citizen.py` → `tools/assets/citizen/build_citizen.py`.
- `lib/city/citizen.ts` → same repository path.
- `tests/citizen-runtime.test.mjs`, `tests/citizen-asset.test.mjs` → same paths.
- Selected unmodified PNG previews belong in the visual-quality documentation.
- The editable `.blend` and intermediate texture PNGs can stay in local work; the generator reproduces them and the distributable embeds its images.

## Navigation edits (root integrates)

1. Replace navigation's `makeWalker` import with `makeCitizen` from `./citizen`; set `walker = makeCitizen()`. Leave TrafficStop's `makeWalker` usage intact.
2. Pass `walkingDistance, walked > 0.0001, dt, dt > 0 ? walked / dt : 0` to `walker.update` in walk mode.
3. Call `this.walker.dispose()` from `StreetNavigation.destroy()` before engine scene traversal. This also disposes the navigator's attached contact shadows.
4. Existing navigation speeds stay unchanged in this phase. The adapter accepts the older two-argument update API and selects its run clip above 2.4 m/s. A later movement tuning pass can separately consider natural 1.8 m/s walking and 4.5 m/s running.

## Runtime contract

Metres, +Y up, +Z forward, sole Y ≈ 0.003 m. Height 1.805 m. 37,799 triangles, 22 bones, one skinned mesh and one material. Three embedded 2048 px PBR images; GLB about 6.4 MiB. No lights or ground.

`makeCitizen()` returns `{group, update(distance,moving,dt?,speed?), dispose}`. Its stable root owns a procedural fallback immediately. The original GLB is requested once, on the first walk update. Success swaps only the child model; failure leaves navigation usable. Async completion after disposal releases the incoming asset without attaching it.

Each navigator owns its own loader result, including skeleton and textures; there is no shared mutable animation or global GPU cache. Navigation creates one citizen. A later crowd system should introduce a reference-counted asset cache and SkeletonUtils clones, rather than reusing the live navigator rig.

Clips: idle 2 s, walk 1 s/1 m stride, run 0.8 s/1.9 m stride. Mixer action times are sampled from walked distance; weights ease on start/stop and above 2.4 m/s. Movement is owned by navigation. Loaded meshes explicitly disable castShadow, enable receiveShadow, and keep the existing inexpensive contact shadows.

The officer keeps its procedural recoloring/cap/badge contract. Do not recolor the citizen's atlas as a uniform: it also includes skin and clothing.

## Validation

- Runtime tests exercise stable root/contact shadows, distance-driven gait, failed loading, late completion after disposal, invalid clip fallback, and deduplicated ImageBitmap cleanup.
- Actual GLB tests parse geometry, skin and all clip transforms in Three.js, checking bounds, normalized weights, forward direction, foot contact and shin-to-ankle reach across 40 time samples per clip. A layered pelvis-weight regression detects the incompatible coat/denim deformation that previously appeared during browser motion.
- `inspect_glb.py` independently verifies GLB2 structure, triangle budget, embedded PBR channels and skin weights.
- `preview-exported-front.png` is a fresh re-import of the distributable GLB, not a source-only rendering. Final browser QA still needs the real city light.
- The corrected distributable was also re-imported and inspected from behind at run phases 0.70, 0.775858 (the reported browser distance 14.774130 m), and 0.85, plus a front view. The separate neck extends into the compressed lower head so their surfaces overlap.

Rebuild: Blender 4.5.12 LTS with `blender --background --factory-startup --python tools/assets/citizen/build_citizen.py -- --out public/models/citizen --atlas-size 2048 --samples 16`.
