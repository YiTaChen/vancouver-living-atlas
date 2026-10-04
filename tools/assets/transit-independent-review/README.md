# Independent transit handoff audit

This folder is a reproducible audit/reference record for the D01–D05 offline
handoff. It is **not a model package**, a replacement manifest, or runtime
acceptance. It owns no asset sources and changes none of the three reviewed
packages: `boardable-bus`, `boardable-metro`, `transit-station-spaces`.

## Reproduce

From the repository root, with Python 3 and NumPy installed:

```sh
PYTHONDONTWRITEBYTECODE=1 python tools/assets/transit-independent-review/audit.py
```

The command writes only `report.json` in this folder. A failed assertion exits
nonzero and does not overwrite the last successful report. Read the recorded
input hashes before treating an older report as current. The audit snapshots
inputs before and after execution and fails if they change during the run.
No Blender or browser is required. The package regression tests use temporary
files outside the packages; package validator report writes are diverted to
memory and Python bytecode writes are disabled.

## What is independently checked

The probe reader implements ordinary GLB parsing, scene hierarchy transforms,
indexed-triangle extraction, two-sided ray intersections and point-to-triangle
distance itself. It does not import an asset generator or reuse its geometric
validation helpers.

- Both boarding LODs of the bus and lead/middle/tail metro: 17 × 17 rays across
  every full doorway, 3 mm inside its declared edges; the open-door geometry
  must admit each ray from outside into the interior.
- Actual seat top geometry and human-scale dimensions; each authored seat/head
  point is checked against exterior and interior triangles together with a
  0.12 m head sphere centred 0.07 m above the camera-eye anchor.
- Wheel centres, actual wheel contact at Y=0 and wheel diameter; floor-surface
  triangle-centroid support; cabin headroom samples against the ≥2.05 m target.
- Batched geometry is read from real vertex/index ranges. Original zero-draw
  component anchors are checked as provenance and never treated as floor/seat
  geometry. Existing package regressions additionally exercise corrupt ranges.
- Both GLB LODs at all 16 deployed and stored deck placements: the three walkable
  panels match real triangles; stored geometry reaches the floor and stays
  within the declared storage footprint; runtime activation remains disabled.
- All 26 source/GLB pairs, current manifests, station layout, referenced shelter
  source/GLBs, package code and cited QA JSON are hash-recorded. The three station
  dependency hashes and existing Blender roundtrip/threshold-audit hashes must
  match current files. Station export-only batching uses the explicit hash chain
  from raw Blender export through lossless per-component batch evidence to the
  final GLB. The common validators and bus/metro/station regressions
  run separately, with their outputs identified in the report.

The previously observed stored-plate hover (bus 0.05 m; metro 0.07 m) is resolved:
station storage now derives Y from measured rotated bounds. This audit checks
actual transformed triangles for both LODs, rather than trusting that formula.

## Results and limits

`report.json` contains the exact checked inputs, command, environment, measured
per-seat/per-wheel/per-vehicle/per-bridge results, supplementary validator output,
and the resolved storage observation. A pass covers the offline handoff only.

Research-only stop IDs and unplaced station layouts are explicitly allowed by
the backlog when source data is missing. True geographic/walk/rail attachment,
D06 service/passenger states, moving collision, manual bridge relocation,
transparency, lifecycle/disposal and GPU costs remain untested. Metro inter-car
traversal stays disabled pending its 0.30 m floor gap and moving-joint solution.
LOD2 remains closed and nonboarding. Neither sampled rays nor head spheres are a
continuous collision solver, full rig fit, or accessibility certification.

The platform's 37 LOD0 modules originally represented 1,184 primitive instances.
The later export-only batching revision reduces that to 111 (3 per module);
the command independently recomputes both LOD costs from the current GLBs. These
are primitive-instance counts before runtime instancing, not GPU draw counts or FPS.
Existing source-edit/roundtrip evidence is hash-verified; Blender is not rerun by
this audit. No WebGL pass is inferred from offline images or successful tests.

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
