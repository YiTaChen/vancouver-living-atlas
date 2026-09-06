# Portable Vancouver asset tools

These are path-portable versions of the release's original generators. Application/build code is LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). City vector data remain OGL-Vancouver, OSM-derived data remain ODbL1.0, and Terrarium elevation sources retain the licenses recorded in their metadata.

Python3.13 was used for the checked release. Install dependencies in an isolated environment:

```sh
python3 -m venv .venv-data
. .venv-data/bin/activate
pip install -r tools/requirements.txt
```

The commands below assume these scripts were copied into `tools/` and are run from the repository root. Any working directory is supported when explicit paths are supplied. All output directories are staging directories; review generated artifacts before copying them into `public`.

## Original inputs

The release included prepared runtime vectors, not every raw source snapshot. `release-input-manifest.json` records hashes and timestamps of the five raw snapshots used. `fetch_sources.py` can acquire equivalent source categories without credentials:

```sh
python tools/fetch_sources.py --out-dir work/raw
```

The live result can differ from the historical release. Optional `--only contours` or `--only osm-buildings --osm-date 2026-09-04T20:02:06Z` limits downloads or requests historical OSM geometry. City endpoints have no historical date option here. Existing cached files are preserved unless `--overwrite` is given. Keep the raw inputs, manifest and tile cache if exact historical reproduction matters.

## Building solids

```sh
python tools/prepare_building_inputs.py --city-raw work/raw/raw-building-footprints-2009.geojson --osm-raw work/raw/osm-features.json --out-dir work/rebuild/building-inputs
python tools/reconcile_buildings.py --city work/rebuild/building-inputs/city-buildings.geojson --osm work/rebuild/building-inputs/buildings-osm-all.geojson --out-dir work/rebuild/buildings
```

The original City input is **not** the already-combined `public/data/buildings.geojson`. Output `buildings-combined.geojson` maps to published `data/buildings.geojson`; `reconciliation-report.json` keeps its name. Auxiliary landmark exclusions, modern-only slabs and grouping envelopes are inspection artifacts. Render each stored solid over `[base+minHeight, base+height]`; see the application documentation for its terrain anchoring.

## Detailed terrain

```sh
python tools/build_elevation.py --contours work/raw/raw-elevation-contour-lines-1-metre-contours.geojson --land public/data/land.geojson --source-date 2026-09-04 --out-dir work/rebuild/terrain
```

Use the actual acquisition date of the supplied source snapshot. Outputs `terrain.json` and `terrain-metadata.json` use the application's filenames. The core land mask must be a Polygon; the regional MultiPolygon is a different layer.

## Regional terrain and coast

```sh
python tools/build_context.py --out-dir work/rebuild/context --cache-dir work/raw/terrarium-tiles
python tools/prepare_context_land.py --coastline work/raw/osm-context-coastline.json --out-dir work/rebuild/context
```

Use `build_context.py --offline` with a complete PNG/JSON tile cache to prevent network downloads. The context mask covers marine land only; inland lake overlays are separate. Fixed Vancouver extents and15m coastline simplification are intentional project settings.

## Bridges

```sh
python tools/make_bridge_routes.py --roads public/data/roads.geojson --osm-paths work/raw/osm-stanley-paths.json --out-dir work/rebuild/bridges
```

Output `bridges.json` matches the runtime filename. Split anchors and widths/deck elevations are Vancouver-specific source/model decisions. Material source changes require inspecting the new bridge geometry; the script raises an error rather than silently constructing a new alignment.

## Procedural textures

```sh
python tools/generate_textures.py --out-dir work/rebuild/textures
```

No input photographs or downloaded artwork. Optional `--font /path/to/font.ttf` affects only the diagnostic contact sheet. The generator creates16 PNG maps for5 materials, metadata and a preview; the current release uses only7 maps. Do not describe every generated map as a currently loaded runtime material.

## Rebuild scope and versioning

These tools rebuild the existing derived artifacts using raw snapshots plus the published core land and road vectors. They do not yet regenerate every published park/tree/road/context vector from raw records in a single command. Source-query responses and numerical library versions can affect exact ordering or encoding; compare semantic geometry and manifests alongside hashes. `requirements.txt` captures the numerical versions used in the portability check.
