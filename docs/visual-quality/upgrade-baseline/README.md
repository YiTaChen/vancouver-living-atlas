# upgrade-baseline

Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for 5 seconds before an 8-second visible-browser RAF sample. These short samples are diagnostic, not a universal FPS or long-session guarantee.

Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Parent revision: `cc661eba9582f87358d2c8440f071aa63281e69f`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.

| Quality | View | FPS | p95 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| high | atlas-aerial | 19.9 | 100.0 | 299.8 | 6 | [PNG](high-atlas-aerial.png) |
| high | citizen | 21.7 | 99.8 | 134.2 | 4 | [PNG](high-citizen.png) |
| high | gastown-roofs | 17.7 | 116.6 | 399.9 | 10 | [PNG](high-gastown-roofs.png) |
| high | gastown-street | 20.5 | 99.7 | 116.9 | 3 | [PNG](high-gastown-street.png) |
| ultra | atlas-aerial | 21.0 | 83.9 | 250.2 | 5 | [PNG](ultra-atlas-aerial.png) |
| ultra | citizen | 18.9 | 100.3 | 166.3 | 11 | [PNG](ultra-citizen.png) |
| ultra | gastown-roofs | 24.3 | 66.8 | 249.9 | 4 | [PNG](ultra-gastown-roofs.png) |
| ultra | gastown-street | 22.5 | 67.4 | 100.7 | 1 | [PNG](ultra-gastown-street.png) |
