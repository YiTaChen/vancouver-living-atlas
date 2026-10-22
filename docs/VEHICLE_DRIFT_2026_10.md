# Player vehicle drifting — 2026-10-22

The ordinary Drive mode's classic car and roadster, and the independent Tesla
mode, share a controlled ground-tyre slide. Holding the drift control while
steering separates the direction of travel from the bonnet direction. Release
restores grip smoothly; countersteering catches the slide. NPC vehicles retain
their autonomous traffic behaviour.

## Controls and coverage

| Vehicle | Desktop | Mobile | Road contact |
| --- | --- | --- | --- |
| Drive: classic | Hold **X** and steer with A/D or arrows; the panel also has a hold button | Hold **Drift** with a second finger while steering/accelerating with the joystick | Existing ground driving and its permitted protected road connections |
| Drive: roadster | Same controls | Same controls | Same permissions as the classic car |
| Independent Tesla | Hold **X** and steer; the action panel also has a hold button | Hold **Drift** in the right action cluster while using the left joystick | Supported ground contact with normal Y > 0.92; roof, wall, air, parking and stunt states disarm drift |

The existing brakes remain **Space** for ordinary Drive and **B** for Tesla.
Tesla's Space jump/rise, Shift boost, R safe-road recovery and V Vortex Jump
retain their existing roles. Ten languages include the drift label and release
instructions. The mobile control is at least 48 pixels tall and uses its own
pointer capture. The Tesla cluster has ten controls: five rows in portrait,
three rows in the existing compact landscape layout.

Release, pointer cancellation, lost capture, page hiding, window blur, control
unmount, blocked panels and mode/model changes release or reset drift as
appropriate. Text entry and modifier shortcuts cannot activate X. An ignored
held key cannot re-arm through an auto-repeat after a blocked context. The
mini-map may remain open while driving; movement-blocking panels disarm drift.
Focused hold buttons support Space/Enter, while assistive clicks use a bounded
pulse rather than a latch.

## Shared handling and collision

[`vehicle-drift.ts`](../lib/city/vehicle-drift.ts) supplies the shared scalar
handling state. Entry requires forward speed of at least **6.2 m/s** (22.32
km/h) and meaningful steering. The lower **3.2 m/s** exit threshold prevents
rapid toggling during a slowing slide. Reverse, loss of road support and braking
clear the slide. The classic profile caps slip at 24 degrees; the two sports-car
profiles cap it at 32 degrees. These are arcade handling parameters.

Grip and engagement use bounded exponential responses, including the coupled
engagement contribution across each time step. Drift adds drag rather than
propulsion. Without drift input or residual slip, the original steering and
speed path remains unchanged. The normal driving camera follows body orientation
while lateral motion follows the accepted travel direction.

Ordinary navigation submits that direction to the existing complete-body sweep,
building checks and protected-floor resolver. Tesla uses its actual ground
frame and accepted wheel support, including the existing swept body fit. Its
ground departure, wall/roof attachment, jump and flight logic retain their
separate states. Impact responses receive the actual lateral travel direction;
an impact or rejected movement clears residual drift where necessary. Drift
grants no new road, water, building, bridge or pedestrian-floor permissions.

## Tyre smoke, skid ribbons and budgets

[`vehicle-drift-effects.ts`](../lib/city/vehicle-drift-effects.ts) reads the
accepted vehicle pose and rear-wheel contacts. Each ribbon endpoint resolves
the current motor-road floor and layer. A segment also needs continuous asphalt
or sampled support on the same protected road identity. Departed roads, a
teleport, a model/floor change or a large frame gap start a new ribbon.

The effect uses two fixed geometry/material objects: one mesh for skid ribbons
and one point buffer for soft smoke. There are at most **two draw calls** and
384 ribbon segments / 96 smoke particles. The typed-array storage reported by
`stats()` is **62,208 bytes**; this excludes Three.js objects and driver storage.
Ribbons and smoke fade, and full buffers overwrite or reject additional work.

| Effective world quality | Ribbon budget | Smoke budget | Maximum ribbon fade | Emission interval |
| --- | ---: | ---: | ---: | ---: |
| Balanced | 96 | 24 | 8 s | 0.10 s |
| High | 192 | 48 | 12 s | 0.065 s |
| Ultra | 384 | 96 | 18 s | 0.045 s |
| Compatible graphics | 48 | 12 | 8 s | 0.10 s |

The existing world Auto controller selects the effective world quality, so these
budgets adapt with it. Tesla's separate model-detail selector retains its
existing purpose. Long continuous slides can overwrite older ribbons before
their fade limit. Night smoke uses a darker shade, distant effects fade, and
reduced-motion preference suppresses smoke while retaining the ground trail.
Effects do not change simulation state and are disposed with the city engine.
These capacity limits are not a measured frame-rate guarantee.

## Verification and release record

Use the repository's supported **Node 24.22.1** runtime. Focused checks cover
shared response stability and energy loss, ordinary and Tesla collision paths,
input cancellation, ten-language controls, complete floor identities, missing
asphalt, fixed buffer capacities, quality changes and disposal.

```sh
node --test tests/vehicle-drift.test.mjs tests/vehicle-drift-navigation.test.mjs tests/tesla-drift.test.mjs tests/vehicle-drift-effects.test.mjs tests/vehicle-drift-ui.test.mjs tests/tesla-controls.test.mjs tests/i18n.test.mjs
node --test --test-concurrency=4 tests/*.test.mjs
npm run check
npm run build:firebase
```

The loopback-only Drift QA observer records public input and accepted movement
at 20 Hz, plus model, initial damage, broken props, body/travel direction,
surface, quality, effects and screenshot. It does not place, accelerate, repair
or move a vehicle. After selecting **record native input**, explicitly focus
the canvas before keyboard driving: Space on a focused HTML button belongs to
that button. Production build verification excludes the observer and its UI.

| Acceptance | Result |
| --- | --- |
| Shared handling / ordinary navigation and placement | 73 passed, 0 failed; includes the 29 shared handling / navigation checks |
| Tesla drift and existing driving / stunt regressions | 125 passed, 0 failed |
| UI, independent input cancellation and ten-language controls | 22 passed, 0 failed |
| Effects, floor continuity, capacities and disposal | 5 passed, 0 failed |
| Full regression suite | 1,673 passed, 0 failed, 0 skipped; 330.4 s |
| Native desktop controls / visible drift and recovery | Recorded classic, roadster and Tesla through public controls; details below |
| Responsive mobile layouts and drift hold | Portrait 390 × 844 and landscape 844 × 390 captured; classic and Tesla pointer holds recorded; independent multi-pointer cancellation covered by component event tests |
| Changed-file lint comparison | 55 inherited diagnostics versus 59 on the base revision; zero new diagnostics. New drift modules/tests pass strict lint. [Audit](qa/vehicle-drift-20261022/lint-comparison.json). |
| TypeScript check | Passed; `work/drift-check-final.log` |
| Production Firebase build and QA exclusion | Passed; `work/drift-production-build.log`; verifier confirms drift recorder markers and QA modules are absent from public output |
| GitHub merge and deployment | Required final gates: PR validation, then main validation and Firebase deployment for the merge commit. Results are linked from the task and GitHub Actions. |

The final full-suite result is recorded in `work/drift-full-tests-final.log`.
Focused logs are `work/vehicle-drift-dynamics-placement-final-tests.log`,
`work/tesla-drift-focused-final.log`, `work/drift-ui-focused-tests.log` and
`work/drift-fx-tests-final.log`; these groups overlap the full suite.

### Recorded native browser input

The [native summary](qa/vehicle-drift-20261022/native-input-summary.json) contains
**eight valid checkpoints**, including slide/release checkpoints from the same
recording, across the three player models. Runs used the ChatGPT in-app browser
and public mode/model controls. The observer supplied no speed, input, pose,
repair or prop removal. The public repair UI was used before the classic desktop
entry. One initial unarmed capture and exploratory coasting attempts were
excluded from this summary.

| Run / checkpoints | Peak speed | Peak model slip | Maximum ribbons / smoke | Damage result |
| --- | ---: | ---: | ---: | --- |
| Classic desktop slide; later brake with roadside contact (2) | 48.48 km/h | 13.50° | 4 / 5 | Slide checkpoint remained at 0. The narrow Stanley Park road was then oversteered; a roadside collision during braking increased damage to 0.1761. This continuation is not collision-free acceptance. |
| Roadster desktop slide and release (2) | 53.55 km/h | 17.00° | 10 / 12 | Pre-existing damage 0.1761; no increase. Final slip 0. |
| Tesla desktop slide and release (2) | 64.73 km/h | 9.65° | 6 / 8 | Initial and final damage 0; final slip 0. |
| Classic responsive mobile pointer hold (1) | 37.47 km/h | 9.65° | 8 / 10 | Pre-existing damage 0.1761; no increase. Eleven sampled touch-drift holds; final slip 0. |
| Tesla responsive mobile pointer hold (1) | 54.30 km/h | 14.76° | 4 / 7 | Initial and final damage 0; final slip 0. |

The slip column reports the model's internal slip angle, rather than equating it
to a camera impression or the finite-difference travel estimate. The raw JSON
also retains observed travel direction, key state, surface, effects and damage.
All retained records have source fingerprint
`ff844894a6e9b3bf45ecfb3803a37baa950b5cf7a9ab42b5c2e8000397735fae`
against base revision `5d801579738fd43121cdf03669f22c43423508e1`; the summary
lists each raw capture and screenshot SHA-256. No browser console errors were
reported after these runs.

Representative captures: [roadster slide](qa/vehicle-drift-20261022/roadster-desktop-slide.png),
[Tesla slide](qa/vehicle-drift-20261022/tesla-desktop-slide.png),
[classic mobile landscape](qa/vehicle-drift-20261022/mobile-classic-landscape.jpg)
and [Tesla mobile portrait](qa/vehicle-drift-20261022/mobile-tesla-portrait.jpg).

Responsive browser runs validate layout and the real Drift pointer handlers.
The recorded pointer cases held the mobile Drift button while a keyboard key
steered; simultaneous independent joystick/drift pointers and cancellation were
exercised by component event tests. These are not physical-phone multi-touch or
GPU / frame-rate measurements. No claim of physical-device performance or a
collision-free full Stanley Park lap is made.
