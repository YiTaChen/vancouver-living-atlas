# Independent driver/cockpit handoff audit

This is a reproducible offline audit/reference record. It owns no character or
cockpit assets and activates no runtime consumer. It reads the two sibling
packages `citizen-character-variants` and `roadster-driver-fit` without changing
their files.

## Reproduce

Use a local full-history checkout containing baseline commit
`aef5e31d4eb8d5d3f832d0931373bf6583227033`, Git, and the installed Node dependencies.
The exact baseline is required for byte comparisons. A shallow checkout that
lacks it fails nonzero; the audit never fetches history or weakens that check.
This history-dependent reference audit is not a root CI requirement. From the
repository root:

```sh
node tools/assets/driver-independent-review/audit.mjs
```

The command writes only this folder's `report.json`, and only on success. It
snapshots reviewed inputs before and after execution and rejects a changing
payload. Package test reports are reproduced in temporary files, compared with
the current published evidence, and removed. A stale/missing report or failed
assertion exits nonzero without replacing the last successful audit. Inspect the
recorded exact hashes before treating an existing audit as current.

## Coverage

- All three actual natural-driver GLBs: every posed triangle corner from the
  contact kernel is compared with Three.js `SkinnedMesh.getVertexPosition()` then
  world transform. This verifies active morph → skin → world evaluation.
- DriverGrip loads at 0; driver-seated sets it to 1. Each LOD must restore 0 when
  seated is stopped, or fades over 0.2 seconds, into idle, walk and run.
- Twelve current source/canonical-GLB pairs, their manifest hashes, and the
  nine-original/three-natural partitioned export records must agree. Historical
  pre-cleanup exports cannot stand in for current sanitized GLBs.
- Character CPU, contact-kernel, source-adapter, limb/unit-scale, shell-envelope and all-LOD fit
  regressions rerun with output writes redirected away from the source packages.
  Final fit must include both hand reach and the 3 mm sampled penetration gate.
- Original public/runtime/optimization trees remain byte-identical to the
  declared baseline; the cockpit audit checks exact source-callsite suppression,
  unchanged world triangles, rigid seat translation and wheel update samples.
- Render input hashes and Blender source/reimport hash bindings must be current.
  Blender itself is not rerun here.

## Scope and limits

The vertex/transition probe uses Three.js as an independent reference. Contact
and adapter checks reproduce their reviewed package algorithms; this is not a
second independently implemented collision solver. Hands allow up to 3 mm of
finite sampled penetration. It is not a continuous maximum-depth guarantee.

Fit is one full-scale static seated pose, with the optional cockpit and the
explicit placement [0.44, 0, -0.06]. Standing rest pose remains standing. A future
consumer must play driver-seated, then stop/fade it on exit so DriverGrip returns
to zero. There is no runtime activation or camera migration.

The open vehicle shell is treated as surfaces. Eight inherited seat/door-shoulder
source-triangle joins remain in the LOD0 assembly envelope; they are disclosed,
not labelled clear. Cushion clearance is about 4.95 mm, and sampled posterior
coat/backrest normal clearance is about 22.5 mm minimum / 42.9 mm median. These
are rigid visual-support approximations, not physical support or comfort tests.
Pedals, belts, entry/exit, dynamic steering, gameplay, WebGL, GPU performance and
ergonomic acceptance remain outside this audit.

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0
