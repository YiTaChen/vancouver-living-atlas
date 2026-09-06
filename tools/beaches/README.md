# Reproduce the coastal geometry

The checked-in output is `public/data/beach-coast.json`. Original preparation code is MIT; source geometry in `inputs/` retains © OpenStreetMap contributors / ODbL and City of Vancouver OGL attribution. These are geographic source derivatives, not downloaded 3D models.

Requirements: the project's Node dependencies, Python 3 with numpy and Shapely 2.1+. From the repository root, using the Python executable with those packages:

```sh
mkdir -p work/beach-build
node tools/beaches/export-base.mjs
node tools/beaches/export-ground-pavement.mjs
python tools/beaches/prepare.py
node tools/beaches/finalize.mjs
python tools/beaches/prepare-paths.py
python tools/beaches/finish-data.py
```

All generated files stay in ignored `work/beach-build/`; source inputs and production data are not overwritten. Review the geometry report, compare the regenerated `beach-coast.json`, then deliberately copy it into `public/data/` when changing the coast. The current output was reproduced byte-for-byte with SHA-256 `47b787f94717fd489ddcdf0c91fc30a81eee65cce7d4fa6e2eea9763b6023459`.

`node --test tests/beach-integration.test.mjs` checks pinned source hashes, independent GEOS dry/wet samples, actual Three raycasts, whole-boat draft checks, original boat physics, and path clearance. `tests/fixtures/beach-independent-checks.json` is the independent classifier output of `prepare.py`; regenerate it only when intentionally updating the geographic input.

The offline preparation preserves original 32 m Delaunator triangle IDs and original planar heights outside the local patch. Rebuild after changing terrain tessellation, source land, paths or the pavement graph. The two source beach polygons and the reconciled coast are included under `inputs/`; heights/depths and fixed sea level are display assumptions, not bathymetry, measured tides or navigation guidance.
