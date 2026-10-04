# Final transit dependency refresh workflow

The final bus and metro batching revisions were refreshed and verified on 2026-10-03. The package is `offline_complete` with `runtime_pending_webgl`. The steps below are retained for future dependency updates; wait for stable dependency output hashes before running them.

Run from repository root:

```sh
# Refresh both dependency manifest snapshots and measured station exports/layout.
python tools/assets/transit-station-spaces/contract.py
python tools/assets/transit-station-spaces/validate.py > tools/assets/transit-station-spaces/qa/tests.log

# Actual exported bus/metro geometry, all14 unique door alignments, open-door and closed-door controls,
# actual floor support and separately measured doorway/cabin clearances.
blender -b -t 2 --python tools/assets/transit-station-spaces/audit_thresholds.py > tools/assets/transit-station-spaces/qa/threshold-validation.log 2>&1

# Refresh only the five images using changed transit GLBs; preserve eight independent module images.
# The renderer merges these entries into index.json and records current actual GLB hashes.
blender -b -t 2 --python tools/assets/transit-station-spaces/render_previews.py -- bus-island-alignment.png bus-threshold-deployed.png four-car-platform-74m.png platform-human-scale.png metro-threshold-deployed.png > tools/assets/transit-station-spaces/qa/previews/render-refresh.log 2>&1

# Inspect new images; then require all current source/GLB/preview/dependency hashes and tests.
python tools/assets/transit-station-spaces/finalize.py
python tools/assets/transit-station-spaces/validate.py > tools/assets/transit-station-spaces/qa/tests.log
```

Blender can return exit code0 even when a Python assertion throws. Inspect logs for `Traceback` and require fresh `qa/threshold-validation.json` with status pass. `finalize.py` checks input GLB hashes, ten source-roundtrip hashes,14 preview entries and all three dependency manifest snapshots; it refuses stale inputs. Do not bypass that assertion.

Station source meshes were not changed during transit batching, so `audit_blender.py` does not need a second run unless source files change. Full optional reproducibility command:

```sh
blender -b -t 2 --python tools/assets/transit-station-spaces/audit_blender.py > tools/assets/transit-station-spaces/qa/blender-validation.log 2>&1
```

Useful expected numbers:

- 5 assets, 10 GLBs, 267,052 total GLB bytes, 907,628 compressed editable-source bytes, zero textures
- 74 m × 4 m platform, 71.5 m consist, 1.25 m margin at each end
- Raised research floors bus 0.36 m / metro 0.95 m; actual ground/entry connections unresolved
- Deployed-deck doorway clearance bus 2.084 m / metro 2.034 m (door target≥2.0m)
- Cabin floor-to-overhead bus 2.24 m / metro 2.16 m (cabin target≥2.05m)
- Two portable deck models, 16 layout instances, 15 mm rise with 20 cm tapered ends, 7.5% grade
- Portable plate relocation path and D06 activation remain disabled; no automatic mechanism, accessibility certification or real route claimed

Only `tools/assets/transit-station-spaces/` belongs to this worker. No public/runtime/old-package edits or commit were made. Parent owns full build and production-isolation evidence.

## Station static export update

If station .blend or export code changes, also export an unbatched audit reference and run `audit_batch.py /tmp/station-unbatched` before finalization. All original component geometry remains recoverable through `extras.componentRanges`; named source meshes become zero-draw anchors. The platform is now 3/2 primitives per LOD0/1 module.
