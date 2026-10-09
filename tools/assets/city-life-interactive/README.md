# Near-interactive pedestrian source pack

Reconstructed 2026-10-09 from the original project silhouettes and the preserved city-life/transit specification. These are new artifacts, not recovered byte-identical copies of the previously unpublished Stage 2 package.

Four original silhouettes (commuter, raincoat, runner, tote), each one opaque vertex-color mesh, one 14-bone skin and six clips: idle, walk, look, yield, guide, sit. Exact triangle, vertex, byte and rest-bound measurements are in manifest.json. No image textures. Each clone requires its own skeleton and mixer; geometry, material and immutable animation clips are shared. Runtime capability limits remain 2/3/4 near skeletons within the global population budget, not additional actors.

## Files and reproduction

- build.py rebuilds original parameterized sources; do not use it to re-export manual edits.
- source/*.blend are editable authoring scenes.
- export.py opens these sources and exports without regenerating geometry.
- exports/*.glb are skin/animation payloads, outside public/ and not adopted by production.
- preview.py renders actual GLB reimports using Blender Cycles CPU.
- validate.py independently checks actual GLB accessors, nondegenerate triangles, skin joints/weights, actual limb influences, six clips, normalized quaternions, finite data, dimensions and hashes.
- test_contract.py rejects eleven deliberately damaged fixtures.
- qa/source-roundtrip.json records actual source-preserving re-export hashes.
- qa/previews/*.png show rest, walk, guide and representative seated pose. CPU images are not WebGL acceptance.

Commands from repository root:

    blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-interactive/build.py
    blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-interactive/export.py -- --output /tmp/interactive-reexport
    blender -b -t 2 --python-exit-code 1 --python tools/assets/city-life-interactive/preview.py
    python3 tools/assets/city-life-interactive/finalize.py
    python3 tools/assets/city-life-interactive/validate.py
    python3 tools/assets/city-life-interactive/test_contract.py
    node --test tests/city-life-interactive-stage2.test.mjs

## Coordinate and ownership contract

1 unit = 1 metre. Blender +Z up, -Y forward exports once to glTF +Y up, +Z forward. Rest foot-sole datum y=0. Skeleton includes pelvis, spine, neck, head, two upper arms/forearms, two thighs/shins/feet. Sit is a simplified seated pose; consumers must align the actual pelvis bone with the vehicle's pelvis anchor, not place the root at the seat height. Do not nonuniformly resize characters to pass door clearance.

lib/city/city-life/interactive-renderer-candidate.ts is deliberately unmounted. It accepts an already-selected bounded set of stable actor IDs and caller-owned phase. It clones skeletons with SkeletonUtils, rejects silhouette changes and invalid inputs before mutations, disposes only clone-owned skeleton state, and leaves shared geometries/materials/textures to the template lease owner. It does not independently create population or run AI. The at-most-four selected skins disable frustum culling until an animated-envelope integration is validated, avoiding stale rest-sphere clipping. It is not a completed city consumer.

## Limits

Offline skin data, source roundtrip and CPU preview inspection completed. Gait is intentionally simple, without IK or foot-contact solving; raincoat hem and tote interactions need near-camera review. Dynamic self-contact, seat upholstery/body fit, real bus door passage, custom normal/depth passes, shadow behavior, touch, hidden-tab and GPU performance remain untested. No player rig replacement, runtime scene integration, public asset adoption, deployment, city visibility change or night-lighting work is included.

License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0. No third-party character mesh or texture is copied.
