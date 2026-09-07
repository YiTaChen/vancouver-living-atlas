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
6. Landings/accidents: touchdown impulse uses vertical speed; gentle water/ground contact has little shake. Helicopter water and floatplane ordinary land are invalid; sand permits high-drag beach contact and difficult relaunch (gameplay allowance). Bridge/building impacts trigger one explosion; after 8 real seconds return to local Orbit; fire/smoke disappear at 20 seconds. Session replacement cancels stale timers/effects. No page timers cause a removed aircraft to reclaim camera.
7. Verification: pure simulation/lifecycle tests, regressions for prior modes, type/build checks, browser desktop/mobile controls and all camera views, live scene performance/draw calls and cleanup. Document results and limitations. Push stage commits; leave main and Firebase untouched until requested.

## Implementation decisions

Use a standalone flight controller that ticks in Orbit too. Existing ground TravelReturn intentionally invalidates on map pan and is unsuitable for flight. Use a separate return action tied to one live aircraft instance. Substep motion and sweep obstacle intersections to avoid tunnelling. Assisted physics prioritizes plausible distinct feel, not certified aerodynamics. Safeguard altitude and map bounds with visible guidance; autopilot never freezes a floatplane in midair. Aircraft details are built only when beginning placement, not in the initial city startup.

## Progress

- [x] Branch, architecture and controls research.
- [ ] Dynamics and lifecycle.
- [ ] World integration and placement.
- [ ] Aircraft assets, cockpits and views.
- [ ] Desktop/mobile controls and localization.
- [ ] Cruise, landing and accident integration.
- [ ] Browser/regression/performance verification.
