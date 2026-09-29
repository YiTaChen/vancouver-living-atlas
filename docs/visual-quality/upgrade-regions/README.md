# upgrade-regions

Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for at least 5 seconds, then waits for selected architecture cells and applicable street/citizen assets to finish, up to 30 seconds. The table records the actual settle time and detail readiness separately from the following 8-second visible-browser RAF sample. A hidden warmup or detail timeout invalidates a capture. Comparisons to the fixed 5-second P0 warmup measure warmed rendering, not identical first-use latency. These short samples are diagnostic, not a universal FPS or long-session guarantee.

Device: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version). Parent revision: `cfbe34853e06940b58626d1f72d911ac16c00b74`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.

| Quality | View | FPS | p95 ms | Max ms | >100 ms | Settle s | Detail ready | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| high | atlas-aerial | 20.0 | 85.3 | 134.2 | 4 | 5.52 | Yes | [PNG](high-atlas-aerial.png) |
| high | citizen | 19.3 | 100.0 | 117.4 | 7 | 5.04 | Yes | [PNG](high-citizen.png) |
| high | gastown-roofs | 26.7 | 51.1 | 83.2 | 0 | 8.77 | Yes | [PNG](high-gastown-roofs.png) |
| high | gastown-street | 19.2 | 100.1 | 200.0 | 8 | 5.21 | Yes | [PNG](high-gastown-street.png) |
| ultra | atlas-aerial | 20.3 | 99.7 | 101.5 | 5 | 18.00 | Yes | [PNG](ultra-atlas-aerial.png) |
| ultra | citizen | 20.0 | 99.2 | 100.2 | 4 | 5.03 | Yes | [PNG](ultra-citizen.png) |
| ultra | gastown-roofs | 24.1 | 66.7 | 85.2 | 0 | 7.62 | Yes | [PNG](ultra-gastown-roofs.png) |
| ultra | gastown-street | 20.6 | 99.4 | 101.9 | 5 | 7.03 | Yes | [PNG](ultra-gastown-street.png) |

## Additional regional coverage

These four fixed 1080p High views are separate from the eight matched performance samples. Source identity, ground minimum, applicable visible model primitives and readiness are recorded in [regional.json](regional.json). All four passed the continuous 5 cm camera/target drift limit. Nearby-building counts are geographic counts, not pixel-visibility measurements.

- [Kitsilano source-tagged gables](high-regional-kitsilano-gables.png)
- [West End source-tagged gables](high-regional-west-end-gables.png)
- [West End modern entrance](high-regional-west-end-modern-bay.png)
- [Yaletown modern entrance](high-regional-yaletown-modern-bay.png)

Actual source audits: [building families and conservative gables](source-building-audit.json), [accepted original streetscape placements](source-streetscape-audit.json), [connected eight-block Robson corridor](source-robson-audit.json).

## Lighting checks

Six additional High captures use the same source fingerprint and fixed-pose validation. [Lighting metadata](lighting.json).

- Roofs: [14:00](high-lighting-gastown-roofs-14h.png), [19:00](high-lighting-gastown-roofs-19h.png), [23:00](high-lighting-gastown-roofs-23h.png).
- Street: [14:00](high-lighting-gastown-street-14h.png), [19:00](high-lighting-gastown-street-19h.png), [23:00](high-lighting-gastown-street-23h.png).

All eighteen captures share a source fingerprint. All eight matched camera and target positions agree with P0 within 2 cm; warmup and sampling reject any frame drifting over 5 cm. These captures validate representative source-based content, not surveyed replicas or photorealistic parity.

## Connected eight-block Robson traversal

[Raw actual-browser report](high-robson-corridor-8-blocks.json) and [final renderer image](high-robson-corridor-8-blocks.png). High at its normal 1625×840 drawing buffer (1300×672 viewport), fixed 14:00. This resolution differs from matched screenshots.

PASS: one initial placement, then 1,346.987 m of observed normal W movement in 379.053 seconds. All nine source crossings from Burrard through Denman were observed, completing eight intervals. There were zero blocked moves, ground rejections or protected-surface rejections. The existing capped controller advanced 336.747 simulation seconds; this is why wall time exceeds distance / 4 m/s. No speed or timestep was changed.

The 78 resource observations kept architecture cells at 38/38 and streetscape cells between 7 and 8/12. Geometry counts ranged 851–890 and finished at 883; textures ranged 65–66. JS heap varied 726.6–802.7 MB and ended 12.2 MB above its initial observation; garbage collection and existing scene content make this an observation, not proof of no memory leaks. Average observed RAF rate was 21.36 FPS, p95 84 ms, max 317.2 ms. Continuous movement passed, but this is not smooth 30/60 FPS.

## Compatible graphics

[Original canvas image](compatible-water-street.png), [raw capture metadata](compatible-water-street.json), and [inspection protocol](compatible-check.json). Desktop Chrome with `?graphics=compatible` retained Balanced settings and the original 3,104-triangle procedural citizen; the QA inspection did not expose desktop architecture/kit instances. The new shared body shader rendered without browser warnings/errors. This is a functional fallback check, not testing a physical phone or measuring mobile FPS.

## Initial repeated-route failure retained

The first full ten-minute run completed all ten legs and kept architecture/streetscape caches at 38/8, but failed the strict continuous-motion requirement: the generic Water Street preset continued west past its short road segment and reached Harbour Centre's preserved collision footprint at 153.7 m. There were 257 ground rejections across the five Water legs; all five Robson legs were clear. [Unmodified failed report](high-route-endurance-10m-initial-blocked.json) and [last actual image](high-route-endurance-10m-initial-blocked.png). Collision behavior is correct and remains unchanged. The test fixture must choose a sufficiently long source-backed segment before repeating this endurance check.

## Corrected ten-minute repeated-route result

PASS: [complete raw report](high-route-endurance-10m.json) and [final image](high-route-endurance-10m.png). Ten real 60 s walking legs completed 600.944 s of observed walking, 1,960.250 m of movement, and 490.062 s of existing capped controller simulation. Wall time including between-leg setup was 627.491 s. All legs had zero blocked moves and zero stalled five-second windows; all five Water initial placements passed 456 live ground/protected-surface samples before walking.

Across 131 resource observations, architecture cache grew from 23 to its 38-cell limit and streetscape cache grew from 3 to 6 (limit 12). Geometry counts grew 642→753 during repeated loading; textures stayed 58. JS heap varied 650.3–698.4 MB and finished 16.6 MB above the initial observation. These bounded cell observations do not establish the absence of all memory leaks. Each leg averaged 16.2–22.0 FPS, with a worst observed frame of 599.6 ms. Navigation continuity passed; smooth 30/60 FPS did not become a claim.

The source-backed Water correction and preserved collision reason are documented in [source-water-corridor-audit.json](source-water-corridor-audit.json). [QA fixture provenance](qa-fixture-revision.json) records the two source fingerprints and verifies that only the opt-in endurance QA module changed; production rendering, navigation, collisions, models and datasets are byte-identical. The original failed result remains above. Both long runs used normal High 1625×840 rendering and 14:00. They test selected routes, not all city navigation. Chrome reported no runtime warnings/errors.
