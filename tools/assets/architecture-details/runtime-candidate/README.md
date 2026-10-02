# QA-only Blender sill integration candidate

This is a **working opt-in runtime candidate**, not a production expansion or a
passed visual/performance milestone. The city's normal build retains existing
box details. The candidate's loader, controls and two GLBs are excluded from a
normal Firebase build, which verifies that exclusion explicitly.

## Source-selected, already-emitted frontage

The candidate replaces the complete upper-storey lower-sill rows of two nearby
Robson Street facades. These are original representative finishes on unchanged
source buildings, not surveyed reconstructions of the buildings' window details.

| Structure / source feature | Source edge key in the existing metre projection | Existing replaced sills | Full-city planner positions |
| --- | --- | ---: | --- |
| 153090 / 132886 | `-564.925,-658.545|-576.282,-669.010` | 32 | 142–266 |
| 153102 / 132843 | `-580.273,-672.830|-591.064,-683.035` | 24 | 1108–1200 |

Both frontages are in architecture cell `-3,-4`; all **56** sills are already
emitted before that cell's unchanged 1,800-instance cap. The original proposal
of sources 153175/153184 was rejected during full-city review because those
otherwise eligible boxes fell beyond the cap. **No planner reordering or cap
increase was used to make the replacement visible.**

Selection requires a named source ID, the exact source edge, the original lower
sill kind/size, an upper-storey clearance and the full placement key. A QA-only
WeakMap also verifies the exact source-part object of each emitted box, preventing
a coincident box from another source being replaced. Selection is intersected
with the actual capped production planner prefix at startup. Changed or missing
source data therefore reduces/skips replacement rather than fabricating coverage.

`full-city-audit.json` records dataset hashes, complete cell populations and all
56 retained planner indices. Its **20 m foundation is a synthetic vertical test
datum**. It validates source ordering/counts, not surveyed terrain or slopes.
Runtime uses the existing engine foundations without changing them. Tests check
all actual exported vertices against the inherited, oriented original volumes.
A replay against pre-candidate revision `26a2ae5` compares every default instance
matrix/color buffer byte-for-byte: **19,312 instances match**, and all 56
candidate transforms already exist in those baseline buffers.

## Physical and resource contract

- Two independently editable fitted `.blend` sources and two real GLBs are under
  `source/` and `assets/`. Blender 4.3.2 opens and validates them independently.
- The original sandstone sill is refined offline from 0.18 m to **0.16 m high**;
  metre UVs are reprojected before export. Original artist inputs remain byte-for-
  byte unchanged. The fitted section is 0.22 m deep and remains wholly inside
  the pre-existing 0.31 m sill envelope. Runtime Y/Z scale is **1**; only the
  linear X span follows the existing sill width.
- Centre, source elevation and parent population are preserved. The authored
  street-facing profile is oriented by the source ring's outward normal, including
  reversed winding. All actual GLB vertices fit inside each original sill box,
  so this candidate introduces no additional door/window/ground encroachment.
  It adds no collision shape, walkable floor, entry opening or source footprint.
- LOD0 is 32 triangles and LOD1 is 16; the replaced box was 12. At all 56 selected
  instances this is **+1,120 / +224 single-pass triangles**, not a reduction or a
  measured frame-rate claim. The candidate-only ceiling is 64 instances / +1,280
  triangles. Original cell, cache, construction and population caps are unchanged.
- One candidate instanced batch is added for the affected cell while the same
  selected instances are removed from its original box batch. This is a planned
  single-pass draw increase of one, not a measurement of the renderer's multipass
  GPU work. Both LOD templates are pooled; cached batch copies are disposed.
- Candidate rendering uses the existing shared city atlas and sandstone slot.
  The ordinary GLTFLoader **does transiently decode embedded preview maps**.
  Those maps/materials and their ImageBitmaps are disposed before attachment;
  no private texture maps remain on candidate materials. The engine retains
  ownership of its three shared atlas textures. Snapshot evidence distinguishes
  retained private textures from these transient allocations.
- Automatic near/far switches use **60 m / 150 m with 10 m hysteresis**. Tiny
  threshold oscillations do not discard/rebuild cells. Only affected source cells
  are invalidated, retaining unrelated roof/street caches and normal per-frame
  construction budgets. Explicit LOD controls are available for matched QA.
- Both LODs must load and validate before replacing anything. Missing/malformed
  GLBs retain complete box fallback. Compatible graphics performs no candidate
  GLB loads. Disabled candidates restore the original counts and release private
  resources. Late results after disable, re-enable or engine disposal are released
  without attaching or interfering with a newer candidate.

## Build and replay

```sh
# Rebuild the independent fitted asset sources from the original artist inputs.
blender --background --factory-startup --threads 2 --python-exit-code 1 \
  --python tools/assets/architecture-details/build_runtime_candidate.py
python3 tools/assets/architecture-details/validate_runtime_candidate.py \
  --report tools/assets/architecture-details/runtime-candidate/validation.json
node tools/audit-architecture-module-candidate.mjs --baseline 26a2ae5 \
  --report tools/assets/architecture-details/runtime-candidate/full-city-audit.json

# Explicit local diagnostic build; never deploy this output.
VANCOUVER_STATIC_EXPORT=1 VANCOUVER_VISUAL_QA=1 npm run build
node tools/serve-visual-qa.mjs architecture-candidate
```

On the QA server open:

- `/?architectureModules=robson-sills&architectureLOD=0`
- `/?architectureModules=robson-sills&architectureLOD=1`
- `/?architectureModules=robson-sills` for distance-driven LOD
- `/?graphics=compatible&architectureModules=robson-sills` for no-load fallback

The flag enables the candidate and frames the two source frontages at 1920 × 1080,
14:00, clear weather. The control group allows toggling the exact box baseline,
forcing a LOD and reframing. Captures include candidate evidence in the existing
upgrade scene report. Existing capture leases prevent candidate controls from
mutating an in-progress QA capture. Status refreshes after cell attachment.

For valid comparisons, wait for both templates, shared atlas readiness, completed
architecture preparation and **56 allocated/visible replacements**. Compare the
same pose, resolution and settings with the checkbox off, LOD0 and LOD1. Re-run
High and Ultra; then clear/overcast/dusk/night and compatible fallback. Record
readiness, camera/target, version, source hashes, renderer, draw/triangle/texture
counts, cold/warm startup and repeated median/p95/max frame gaps. Inspect actual
LOD transitions and source clearance on target hardware.

```sh
node --test tests/architecture-module-candidate.test.mjs \
  tests/architecture-details.test.mjs tests/upgrade-qa-lease.test.mjs
npm test
npm run check
# Replaces the diagnostic output and asserts no candidate controls/code/GLBs ship.
npm run build:firebase
```

## Evidence and remaining gate

The automated suite exercises the **full source population**, real capped cell
plans, source reordering, exact provenance, every GLB vertex's envelope, LOD and
quality transitions, hysteresis, selective invalidation, exact baseline restore,
shared atlas identity, compatible no-load behavior, one-LOD failure, malformed
geometry, late loading, disable/re-enable and production guards. The Blender
validator opens actual fitted sources and verifies packed materials and metre UVs.

The QA and production builds can be verified without graphics. **No browser
visual capture, GPU frame-time improvement or real-device acceptance is claimed**:
this environment's browser execution/access gate remains blocked. Those checks
remain mandatory before production integration or broader Phase C completion.
