# Stanley Park Drive acceptance evidence — 2026-10-22

The native captures use ordinary **Drive**, not Tesla. Each PNG is the unaltered
WebGL screenshot paired with the recorder's raw JSON. The baseline was compiled
from main `b051ea7214482760e9ed7084121dcefdc8435c2d` with loopback QA controls;
its actual instrumented source fingerprint is included in every record.

## Native baseline interpretation

| Capture | Observed result | Interpretation |
| --- | --- | --- |
| `before-east-shore-tree` | Source `1705:0`; 2.54 m travel, trunk `tree:20463`, speed falls to zero, 16.34% right damage | A trunk visibly occupies the displayed asphalt; a reproducible placement fault. |
| `before-ramp-rail` | Source `1585:0`; stops against `guardrail:6:face:1993` after approximately 5.6 m, 34.09% front damage | The approximate City ramp alignment crosses the Causeway incorrectly. OSM confirms this is an off-ramp, not the location of the Park Drive overpass. |
| `before-northwest-straight` | Source `1612:0`; maximum observed within the selected straight's station/lane bounds is 205.40 km/h | A positive high-speed road case. Continued unsteered travel overshot the 110 m straight and hit forest off-road. The final crash is not counted as a paved-road stall. Existing right-side damage was carried into this run. |

The station/lane analysis of the last row uses the straight's finite chord and
a 1 m half-width car margin. It does not assert a complete human-driven circuit,
nor a triangle-by-triangle asphalt proof. Native key durations are functional
input tests; they are not an FPS or physical-device performance benchmark.

## Source interpretation

The initial City graph contains approximately 16.3 km of features named Stanley
Park Drive, including historical rights of way, branches and access links. The
actual one-way motor-road mainline reconstructed from OSM is approximately
8.47 km. These are different datasets; failure counts on the former cannot be
presented as a failure rate for the latter.

The historical official overpass reports establish grade ordering, not an exact
bridge coordinate. Primary OSM way `41998497` locates the real bridge; ways
`877408902` / `41998501` locate the east exit. Corrected scene geometry must
retain that distinction. No capture from the discarded exploratory bridge
placement is release evidence.

## After-test boundaries

The local selector exposes actual source-owned road polylines. `southEntry`
retains the entire approximately 171 m legal ramp and mainline continuation for
CPU replay. `southRail` is a shorter native-input reproduction beginning on the
same polyline near the previously blocked rail, not a replacement for that
complete test. Each record states its entry coordinates and full source IDs.

Steering replays and native-input runs are reported separately. A CPU replay
uses the production movement and collision path with deterministic steering;
a browser run accelerates/brakes through real controls. Neither a route label
nor a high maximum speed by itself proves a complete 8.47 km human-driven lap.
Tree counts in the native recorder are bounded runtime statistics, allowing a
check that the actual rendered scene used the reconciled tree array.

## Native after results

All nine recorded runs are valid, begin with zero damage and no broken props,
end with zero damage, and record no police stop. The final runtime contains
35,535 retained trees, matching the reconciled shared tree population.
Source fingerprint: `bafaa528807b90c1efc373b16b9b851ac3ac4fea2574a38af2aa875722de0268`.

| Capture | Maximum observed speed | Displacement | Scope |
| --- | ---: | ---: | --- |
| `after-east-shore-tree` | 207.35 km/h | 118.78 m | Same stationary entry as the baseline trunk fault; remains on the 159 m straight. |
| `after-northwest-straight` | 155.58 km/h | 68.09 m | Brakes inside the 110 m straight. |
| `after-prospect-bridge` | 80.26 km/h | 20.30 m | Actual upper bridge, source1599. |
| `after-east-off-ramp` | 124.84 km/h | 46.04 m | Corrected actual off-ramp; crosses the green cycle crossing. |
| `after-causeway-underpass` | 143.07 km/h | 58.32 m | Lower road underneath the actual bridge. |
| `after-south-ramp-rail` | 63.37 km/h | 13.68 m | Crosses the original rail obstruction near route station116m. |
| `after-retail-curve` | 73.94 km/h | 17.85 m | Local shop-side fault reproduction, before the sharp curve. |
| `after-north-entry-short` | 54.52 km/h | 10.47 m | Initial short gate test; braking limits the run. |
| `after-north-entry` | 89.22 km/h | 27.61 m | Extends the same entry across the finite ground-to-ramp gate; recorded `ground → lions:road`. |

Maximum speed and displacement are direct recorder observations; straight-line
input does not assert complete curved-ramp traversal. Full source routes are
covered separately by deterministic controller/CCD tests. The native runs use
manual balanced graphics to keep comparisons consistent, without changing the
public Auto option. No mobile hardware or frame-rate benchmark is claimed.

## Local release gates

The official Node24.22.1 build completes **1,625/1,625 tests**, with zero failures
or skips. TypeScript, focused strict lint, architectural contracts and the
production Firebase build/diagnostic-exclusion check pass. The latest audit
finishes1,224/1,224 cases with zero damage; invalid tiny-step parameters now
fail the frame budget rather than reporting an incomplete replay as complete.
`verification.json` records commands, log digests, artifact digests and limits.
Repository-wide lint is not claimed as clean.

Exploratory Node26.0.0 full-suite runs remain inconsistent: one frozen run
fails four Prospect cases, another instrumented run passes those cases but
fails twelve north-exit/south-ramp cases. The same three implicated test files
pass28/28 together. Actual child source hashes and canonical data agree; the
root cause is unresolved. Node26 is outside the declared engines. These runs
are not recorded as passes; formal local and CI acceptance use24.22.1.
