# Phase 2 acceptance: Burrard and Granville

Reviewed 2026-10-23 using Node 24.22.1 and the reproducible phase 2 export at
`.cache/phase2-review`. This review covers the Burrard/Granville reconstruction
and its shared runtime changes. It excludes future unstaged Waterfront and
Stadium–Chinatown/Yaletown template changes.

## Verified CPU and build results

| Check                                                                                                                                                            | Result                                                                                                     | Evidence                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Source geometry, mapped entrances, accessible circulation, lift enclosures and quaternion transfer                                                               | **28/28 pass**                                                                                             | `/tmp/station-phase2-final-source-mapped-review.log`                                                  |
| Rendered station geometry, train-door approaches, native lift interaction, camera clearance and bounded city apertures                                           | **44/44 pass**                                                                                             | `/tmp/station-phase2-final-runtime-camera-review.log`                                                 |
| Native street routes, boarding alignment and authored circulation                                                                                                | Initial run **22/23 pass**; the remaining case passes **1/1** after correcting the public-interior fixture | `/tmp/station-phase2-final-native-review.log`, `/tmp/station-phase2-final-native-fixture-recheck.log` |
| Exact mapped thresholds, Park's first stair and return, raised Dunsmuir apron exit/return, and protection against falling through a higher hall to a lower apron | **6/6 pass**                                                                                               | `/tmp/station-phase2-export-apron-review.log`                                                         |
| Short-window native city handoff, input/bus/street-seat guards                                                                                                   | **2/2 pass**, both exact export and working copy                                                           | `tests/world-transit-integration.test.mjs`                                                            |
| Legacy construction portals and authored visible/lower apron separation                                                                                          | **12/12 pass**                                                                                             | `/tmp/station-phase2-export-apron-final-unique.log`                                                   |
| TypeScript                                                                                                                                                       | **Pass**, exit 0                                                                                           | `/tmp/station-phase2-final-types-review-confirm.log`                                                  |
| Static production build and Firebase output verification                                                                                                         | **Pass**                                                                                                   | `/tmp/station-phase2-build-final.log` (`npm run build:firebase`)                                      |

The native route run includes all public entrances returning from both platform
levels, body-supported stairs/escalators, all 156 directional carriage doors,
and same-height platform walking. The corrected street-approach fixture
constructs the production public interiors and uses their actual ground height;
it does not weaken building collision or the station's step-height limits.

The complete repository gate is **green** on reviewed head
`ce4e38feacb95103a4d46190f2b24cd7514d8a32`:
[Validate city run 117](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/39948647790).
It includes TypeScript, the complete `npm test` suite, architectural GLB contracts
and the verified Firebase production build. [PR 41](https://github.com/YiTaChen/vancouver-living-atlas/pull/41)
was merged as `78f897f852d1486f34fa0782de79b01552aa8efe` after this gate passed.

Legacy compatibility is explicit: templates opt into completed elevator cabins,
and unrendered construction aprons retain nearest-height vestibule selection.
Those corrections keep unfinished legacy displays separate from the rendered
physical floors used by the reconstructed stations.

## Provenance and geometry review

[The station evidence register and photo-to-capture table](burrard-granville-references.md#photo-to-capture-review-map)
pair the actual photographs with the corresponding game views. The same document
distinguishes mapped OSM doors, approximate platform centres, Seymour's
photo-supported inferred facade, representative underground dimensions and the
inferred Burrard depth correction.

The independent alignment review retains carriage-local transforms while moving
station-facing rails, platforms, train-door anchors, bridges and exclusions
together. Tests check actual rendered vault clearance, supported train-door
waiting positions, real tread/handrail collision and enclosed lift portals.
Camera cutaway visibility does not remove those physical barriers.

[The runtime pin](phase2-runtime-pin.json) records SHA-256 hashes of the four
actual reviewed export runtime files and both generated station packets, plus
the source-packet hash. It was calculated from the export, not from future root
working-tree files. Final acceptance should additionally record the resulting
commit or staged-tree identity.

## Full-game GPU acceptance

The final full-city reports both pass with the pinned source packet and GPU client checkpoint. The pin separately records the subsequent legacy-only guard; it leaves the authored station branch used by these captures unchanged.

| Station                                  | Native public entrance exit/reentry | Actual F/touch lift trips | Reviewed game captures | Browser errors / failed HTTP / lost context |
| ---------------------------------------- | ----------------------------------- | ------------------------- | ---------------------- | ------------------------------------------- |
| [Burrard](game-burrard-browser.json)     | 3/3 in both directions              | 6                         | 26                     | 0 / 0 / no                                  |
| [Granville](game-granville-browser.json) | 3/3 in both directions              | 4                         | 25                     | 0 / 0 / no                                  |

Review includes both Granville triple banks, enclosed inter-platform stairs,
Seymour's right-turn entry, Burrard's 27 park steps, both stacked platforms,
open lift landings and third-person ceiling cutaways with the real skinned avatar.
The first-person lift views face the actual open doorway. These are geometric
reconstructions; material detail and inferred underground dimensions are not
presented as photogrammetry or an as-built survey.

The pin records the reviewed code tree before evidence files were added;
its explicit file hashes identify the runtime independently of later QA text.

Interior inspect screenshots establish the visible enclosure and reference
comparison. Continuous CPU walker routes and native full-game street/lift
operations supply separate evidence that those views are connected and usable.
