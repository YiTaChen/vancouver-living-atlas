# upgrade-assets

Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for at least 5 seconds, then waits for selected architecture cells and applicable street/citizen assets to finish, up to 30 seconds. The table records the actual settle time and detail readiness separately from the following 8-second visible-browser RAF sample. A hidden warmup or detail timeout invalidates a capture. Comparisons to the fixed 5-second P0 warmup measure warmed rendering, not identical first-use latency. These short samples are diagnostic, not a universal FPS or long-session guarantee.

Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Parent revision: `d5248edab00610b9cfaf3d8f2cff33e02ad76193`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.

| Quality | View | FPS | p95 ms | Max ms | >100 ms | Settle s | Detail ready | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| high | atlas-aerial | 23.5 | 67.9 | 98.7 | 0 | 5.00 | Yes | [PNG](high-atlas-aerial.png) |
| high | citizen | 20.6 | 83.0 | 116.0 | 1 | 5.01 | Yes | [PNG](high-citizen.png) |
| high | gastown-roofs | 25.7 | 51.7 | 100.1 | 1 | 5.05 | Yes | [PNG](high-gastown-roofs.png) |
| high | gastown-street | 18.9 | 83.6 | 250.2 | 5 | 5.02 | Yes | [PNG](high-gastown-street.png) |
| ultra | atlas-aerial | 20.9 | 83.4 | 100.7 | 4 | 16.32 | Yes | [PNG](ultra-atlas-aerial.png) |
| ultra | citizen | 16.2 | 133.6 | 233.1 | 20 | 5.02 | Yes | [PNG](ultra-citizen.png) |
| ultra | gastown-roofs | 22.1 | 83.6 | 249.9 | 5 | 7.55 | Yes | [PNG](ultra-gastown-roofs.png) |
| ultra | gastown-street | 16.4 | 132.7 | 200.0 | 13 | 6.27 | Yes | [PNG](ultra-gastown-street.png) |

## Moving citizen

Three actual navigation snapshots: [2 seconds](high-citizen-motion-2s.png), [4 seconds](high-citizen-motion-4s.png), [8 seconds](high-citizen-motion-8s.png). The associated JSON records travelled distance and the same source fingerprint. These are running poses under the existing 4 m/s controls; the geometry tests also sample the slower walk clip. The browser review found and corrected coat/denim skin-weight discontinuity and a small neck attachment gap before these final captures.

High measured 18.9–25.7 FPS and Ultra 16.2–22.1 FPS in the final short samples on this device. Some Ultra views are slower than P1; visual gains do not establish a speedup. Heavy asset generation/tests were paused during sampling. Street views had fully loaded bays and the new citizen, and Chrome reported no runtime errors or warnings.
