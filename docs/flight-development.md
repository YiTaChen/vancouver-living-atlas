# Flight exploration implementation plan

Branch: `feature/flight-exploration`, based on main `05da6b0`. Stage commits stay on this branch; no production deployment during development.

## Controls and evidence

- GeoFS controls: https://www.geo-fs.com/pages/instructions.php — distinct pitch/roll and throttle; cockpit, unobstructed and follow views; helicopter collective.
- FAA Helicopter Flying Handbook: https://www.faa.gov/sites/faa.gov/files/helicopter_flying_handbook.pdf — cyclic tilts rotor thrust, collective changes lift, pedals yaw. Engine RPM is governed, so our lift slider is labelled collective, not RPM.
- Infinite Flight touch controls: https://infiniteflight.com/guide/getting-started-guide/pilot-user-interface/flight-controls — separate mobile power and flight controls.
- TSB DHC-2 report: https://www.tsb.gc.ca/eng/rapports-reports/aviation/2015/a15q0120/a15q0120.html — stall speed context. Our assisted flight constants are deliberately approximate.

Keyboard: W/up pushes nose down, S/down pulls nose up; A/D banks; Q/E rudder/yaw; R/F increases/decreases throttle or collective; X helicopter descent; H helicopter hover; C cruise. Touch: left cyclic/stick, separate power slider and yaw/hover/descent controls; dragging scenery looks around and pinch zooms. Inputs clear on blur/cancel. Flight time uses real delta, independent of the accelerated day/night clock.

## Detailed stages and acceptance

1. Foundation: pure fixed-step aircraft state, separate floatplane and helicopter response; throttle/collective, stall/sink and hover. Tests at multiple frame rates and invalid inputs. Keep ground navigation separate.
2. World integration: one owned flight session; water/road placement with room for floats/rotors; geographic surface heights; 3D broad-phase building collision and swept bridge obstacles. Unknown water outside supported geography cannot masquerade as a launch site.
3. Models and camera: original aircraft exteriors; prop/rotor animation; two cockpits with instruments; interior/unobstructed first person and third person; smooth zoom and camera entry; no city-wide new shadow/light passes.
4. Pilot UI: fifth Fly mode selects type from launch surface, compact placement hint/cancel; persistent power slider; desktop key help, mobile joystick/yaw/descent/hover; altitude, airspeed, stall and cruise status; ten-language messages; minimap tracks pilot position. Hide HUD retains essential movement controls.
5. Autopilot/session: bounded steering joins a city/Stanley Park loop without teleporting, climbs safely, then circles. Zooming beyond aircraft chase range enters local Orbit and enables cruise. Orbit pan/rotation/viewpoint navigation retains aircraft and separate Return to aircraft button. Selecting walk/drive/boat or a new flight removes old session. Explicit cruise leaves camera freelook available.
6. Landings/accidents: touchdown impulse uses vertical speed; gentle water/ground contact has little shake. Helicopter water and floatplane ordinary land are invalid; sand permits high-drag beach contact and difficult relaunch (gameplay allowance). Bridge/building impacts trigger one explosion; after 8 active seconds return to local Orbit; fire/smoke disappear at 20 seconds. Session replacement cancels the old camera transition; existing smoke finishes its own 20-second lifetime. No page timers cause a removed aircraft to reclaim camera.
7. Verification: pure simulation/lifecycle tests, regressions for prior modes, type/build checks, browser desktop/mobile controls and all camera views, live scene performance/draw calls and cleanup. Document results and limitations. Push stage commits; leave main and Firebase untouched until requested.

## Implementation decisions

Use a standalone flight controller that ticks in Orbit too. Existing ground TravelReturn intentionally invalidates on map pan and is unsuitable for flight. Use a separate return action tied to one live aircraft instance. Substep motion and sweep obstacle intersections to avoid tunnelling. Assisted physics prioritizes plausible distinct feel, not certified aerodynamics. Safeguard altitude and map bounds with visible guidance; autopilot never freezes a floatplane in midair. Collision data is prepared when beginning placement; aircraft models are built when starting the selected flight, not in the initial city startup.

## Progress

- [x] Branch, architecture and controls research.
- [x] Dynamics and lifecycle.
- [x] World integration and placement.
- [x] Aircraft assets, cockpits and views.
- [x] Desktop/mobile controls and localization.
- [x] Cruise, landing and accident integration.
- [x] Browser/regression/performance verification.

## Implementation and review record

- `6e8ef16`: plan and control research; `e22755f`: distinct dynamics, surface and obstacle foundations; `9cb0faa`: original aircraft/cockpit models, engine ownership, desktop/touch controls and cruise. Final hardening follows as a separate stage commit.
- The aircraft model convention is nose along local −Z, heading zero north. The camera and minimap convert this explicitly; the ground navigation heading convention is preserved.
- Interior near clipping is 0.06 m. Camera-relative cabin rotation follows the aircraft orientation while permitting head movement. Returning from a distant map resets an out-of-range chase zoom to 28 m.
- Helicopter cruise initially climbs vertically to clear city towers. A low floatplane evaluates nearby climb headings before joining the loop. Both types join by steering; no aircraft teleport is used.
- Building prisms and individual bridge members use an 80 m spatial grid. Nearby landmark meshes cache CPU triangles lazily and use capsule/triangle contact, including stationary rotor clearance. A whole landmark bounding box is not treated as solid; courtyards and bridge underpasses remain open.
- Review fixes: Orbit cancels pending aircraft placement; New flight from a cockpit first frames a local overhead view; map-boundary recovery remains active despite held controls until 120 m inside the supported map; opening a blocking mobile panel releases joystick/yaw/descent input. Opening Time, tools or the local map temporarily hides the overlapping flight information card.
- Rejected collision approaches: a centre ray alone missed stationary rotor clearance and parallel wingtip contact. Unrestricted ray parity falsely treated open landmark facades as solid; this was caught by an immediate Harbour Road helicopter crash in browser QA. Parity is now restricted to meshes with two uses per welded edge and nonzero enclosed volume; all open meshes still receive surface-distance collision. A simple “even edge count” check was also rejected because duplicated window planes could pass it. Regression cases preserve both open courtyards and real wall contact.
- Placement and flight now share the same body/wing/rotor/tail probes. Land height also samples the existing road-surface index so helicopter skids start on the visible road rather than below it.
- Crash visuals have independent ownership. Switching to another mode removes the old aircraft immediately, keeps its smoke only until expiry and cannot later force the user's camera back.

## Validation (2026-09-06)

- Full suite: **396 passed, 0 failed**, including 18 flight tests. Coverage includes water takeoff/stall, helicopter hover/descent, pitch sign, sand drag/relaunch, 30/60 fps consistency, landing impacts, swept walls/roofs/bridge cables, courtyard openings, duplicated open facades, stationary landmark/tail clearance, persistent boundary recovery, local map return, replacement and the 8/20-second accident lifecycle.
- TypeScript check and lint of the new flight modules: passed. Static Firebase-compatible production build and emitted landmark worker verification: passed. This is a local build, not a deployment.
- Desktop 1280 × 800, compatible graphics: both aircraft launched and reached the city/Stanley Park circuit. Helicopter stabilized near 410 m and 78 kn; floatplane near 417 m and 152 kn. Both also completed 600-second pure simulation cruise checks.
- Browser observed roughly 46 FPS in overview and 49–60 FPS in the exercised helicopter/floatplane views on this machine. These are observed samples, not a before/after GPU benchmark or an iPhone hardware result.
- Zoomed out from a flying helicopter, moved the map to Stanley Park, then returned to the same aircraft using the separate return control. Cockpit, clear first-person and chase views were exercised.
- A floatplane deliberately continued its water run into the North Shore. The browser showed the damaged-aircraft state, then a local Orbit view with rising smoke, followed by removal. Exact 8/20-second timing is covered by fixed-step controller tests.
- Phone-size 390 × 844: actual joystick drag took over from cruise. Hiding the interface retained the stick, throttle/collective and yaw controls. Landscape 844 × 390 review found the flight panel overlapping the mode selector and central aircraft view; the final compact panel sits at the bottom between the stick and power/yaw controls. Screenshot verification passed.
- Final browser regression: the corrected Harbour Road helicopter launched and rejoined cruise at 410 m / 78 kn, observed at 60 FPS. Opening Time and the local map hid the competing flight card. Switching separately to Walk, Drive and Boat removed the old aircraft return button in all three cases.

## Scope and performance limits

This is assisted sightseeing flight, with approximate aerodynamic constants and representative original floatplane/helicopter cockpits. It does not model individual switches, engine-start checklists, avionics navigation or certified aircraft behavior. Beach relaunch is a deliberate gameplay allowance, not operational advice. Rotor/body collision uses a set of swept probes, not a full deformable airframe.

There is one player-owned aircraft session. Flight collision structures are prepared at placement, and aircraft geometry at launch; none is added to the city scene at initial load. Each aircraft's original exterior and cockpit together are about 12,000 triangles, with shared geometry/materials, no extra scene-wide shadow pass and a 36-particle crash effect. World collision only visits nearby grid cells. UI telemetry publishes about eight times per second rather than on every physics step.

Physics uses fixed 1/60-second substeps and is independent of the 300× city clock. Very long frames are capped for stability, so flight/accident time pauses while the page is suspended rather than advancing invisibly in the background. Actual iPhone/iPad Safari hardware performance and low-memory tab recovery still require device feedback; viewport testing is not equivalent to hardware emulation.
