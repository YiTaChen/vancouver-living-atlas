# Generated comparison evidence

Baseline: 53bb3c619a160627cb9b4394e9876f36c6f2323a (53bb3c619a160627cb9b4394e9876f36c6f2323a). Candidate: working tree at 53bb3c619a160627cb9b4394e9876f36c6f2323a.

| Model     | Quality | Triangles | Meshes | Geometry batches | Geometry bytes |
| --------- | ------- | --------: | -----: | ---------------: | -------------: |
| baseline  | low     |     10590 |     35 |               35 |         762480 |
| baseline  | medium  |     27140 |     35 |               35 |        1954080 |
| baseline  | high    |     58922 |     35 |               35 |        4242384 |
| candidate | low     |     10777 |     35 |               35 |         443445 |
| candidate | medium  |     28516 |     35 |               35 |         967434 |
| candidate | high    |     54249 |     35 |               35 |        1567062 |

These are CPU geometry/resource counts, not FPS or GPU timing. Geometry bytes cover active unique BufferGeometry attribute/index arrays; shared materials, textures, JavaScript objects and cached inactive tiers are excluded. Full hashes, anchors, dimensions, bounds, fixed camera presets and 640x720 framing proof are in evidence.json. Browser render counters additionally include the floor and both views in split mode.

## Startup representation audit

| Model     | TS/JSON source bytes | Independently gzipped source bytes | JSON dependencies (raw / gzip bytes)                                                                    |
| --------- | -------------------: | ---------------------------------: | ------------------------------------------------------------------------------------------------------- |
| baseline  |                42952 |                              13512 | none                                                                                                    |
| candidate |              2231606 |                             991428 | tesla-roadster-detailed-metrics.json: 14292 / 2054; tesla-roadster-detailed-data.json: 2194905 / 981500 |

Source bytes/gzip are measured on these individual TS/JSON files, not the production minified bundle or an observed network transfer. Candidate JSON is statically imported: all packed LOD strings are parsed with its containing city chunk, and only the selected tier is synchronously decoded into typed arrays on first use. Later tier visits reuse cached geometry. Baseline has smaller procedural source and no equivalent JSON payload. No browser startup latency, GPU timings or FPS were measured by this tool.
