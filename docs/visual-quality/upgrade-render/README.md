# upgrade-render

Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for at least 5 seconds, then waits for selected architecture cells and applicable street/citizen assets to finish, up to 30 seconds. The table records the actual settle time and detail readiness separately from the following 8-second visible-browser RAF sample. A hidden warmup or detail timeout invalidates a capture. Comparisons to the fixed 5-second P0 warmup measure warmed rendering, not identical first-use latency. These short samples are diagnostic, not a universal FPS or long-session guarantee.

Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Parent revision: `6fb1140ccdfe32c7a56a72e4826d6ec17068ef5d`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.

| Quality | View | FPS | p95 ms | Max ms | >100 ms | Settle s | Detail ready | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| high | atlas-aerial | 23.6 | 67.6 | 100.7 | 1 | 5.02 | Yes | [PNG](high-atlas-aerial.png) |
| high | citizen | 21.6 | 67.0 | 84.8 | 0 | 5.03 | Yes | [PNG](high-citizen.png) |
| high | gastown-roofs | 26.2 | 51.6 | 84.9 | 0 | 5.05 | Yes | [PNG](high-gastown-roofs.png) |
| high | gastown-street | 20.1 | 83.4 | 267.0 | 3 | 5.00 | Yes | [PNG](high-gastown-street.png) |
| ultra | atlas-aerial | 22.8 | 66.6 | 133.9 | 2 | 15.03 | Yes | [PNG](ultra-atlas-aerial.png) |
| ultra | citizen | 21.3 | 68.5 | 85.1 | 0 | 5.06 | Yes | [PNG](ultra-citizen.png) |
| ultra | gastown-roofs | 25.2 | 52.0 | 85.3 | 0 | 8.02 | Yes | [PNG](ultra-gastown-roofs.png) |
| ultra | gastown-street | 21.2 | 83.4 | 101.4 | 1 | 6.02 | Yes | [PNG](ultra-gastown-street.png) |

Six additional fixed-pose High lighting renders use the same source fingerprint: [metadata](lighting.json). These are visual checks, not performance samples.

- gastown-roofs: [14:00](high-lighting-gastown-roofs-14h.png), [19:00](high-lighting-gastown-roofs-19h.png), [23:00](high-lighting-gastown-roofs-23h.png).
- gastown-street: [14:00](high-lighting-gastown-street-14h.png), [19:00](high-lighting-gastown-street-19h.png), [23:00](high-lighting-gastown-street-23h.png).

All matched poses agree with P0 within 2 cm; continuous per-frame camera/target drift stayed below 5 cm. Chrome reported no runtime warnings or errors. The low-sun sweep confirmed removal of the roof shadow bands found during calibration.
