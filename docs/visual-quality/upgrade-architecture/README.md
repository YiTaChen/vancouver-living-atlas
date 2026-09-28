# upgrade-architecture

Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for at least 5 seconds, then waits for selected architecture cells to finish, up to 30 seconds. The table records the actual settle time and detail readiness separately from the following 8-second visible-browser RAF sample. A hidden warmup or detail timeout invalidates a capture. Comparisons to the fixed 5-second P0 warmup measure warmed rendering, not identical first-use latency. These short samples are diagnostic, not a universal FPS or long-session guarantee.

Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Parent revision: `0f0b2a40603908e53e2bd0e2d1ab8f1655e56a50`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.

| Quality | View | FPS | p95 ms | Max ms | >100 ms | Settle s | Detail ready | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| high | atlas-aerial | 21.7 | 83.4 | 199.9 | 3 | 5.05 | Yes | [PNG](high-atlas-aerial.png) |
| high | citizen | 19.4 | 84.1 | 232.9 | 6 | 5.03 | Yes | [PNG](high-citizen.png) |
| high | gastown-roofs | 25.4 | 51.1 | 184.3 | 3 | 7.69 | Yes | [PNG](high-gastown-roofs.png) |
| high | gastown-street | 19.9 | 99.6 | 233.5 | 5 | 5.04 | Yes | [PNG](high-gastown-street.png) |
| ultra | atlas-aerial | 19.3 | 101.0 | 200.3 | 9 | 15.62 | Yes | [PNG](ultra-atlas-aerial.png) |
| ultra | citizen | 19.7 | 100.1 | 150.1 | 8 | 5.05 | Yes | [PNG](ultra-citizen.png) |
| ultra | gastown-roofs | 23.8 | 82.9 | 200.0 | 6 | 7.60 | Yes | [PNG](ultra-gastown-roofs.png) |
| ultra | gastown-street | 21.5 | 83.7 | 117.2 | 2 | 5.00 | Yes | [PNG](ultra-gastown-street.png) |
