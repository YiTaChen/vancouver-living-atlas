# Tesla Roadster Rocket — October 2026 integration

A separate player vehicle and travel button, alongside Orbit / Walk / Drive / Boat / Fly. It does not replace the existing roadster, aircraft, traffic, buses or trains.

## Reference and scope

The reference is the redesigned white, sharply faceted Roadster revealed in October 2026, including copper/gold glazing, raised fenders, concealed lamps, full-width rear light, yoke cabin, active aero and perimeter thrusters.

Primary references:

- [Tesla Roadster](https://www.tesla.com/roadster)
- [Tesla event replay](https://www.youtube.com/watch?v=qt5p-_tE8d0)
- [Tesla — The Ramp](https://www.youtube.com/watch?v=7p5LxFdc-Qg)
- [Tesla — The Kickflip](https://www.youtube.com/watch?v=r5vsHHPVhJg)

The independent [Tesla Roadster simulator](https://github.com/eduardmur/tesla-roadster-simulator) was also inspected for its compact body rendering and bounded thrust effects. No code, mesh, image or audio from that project was copied into this integration.

The mesh is original editable TypeScript geometry, authored against public visual references. There is no imported proprietary CAD, downloaded fan model, official texture or claimed Tesla endorsement. Dimensions, collision envelope and cockpit eye position are visual modelling estimates, not surveyed measurements. The source records uncertain hidden mechanical details. This is a reference-based game representation, not an exact CAD reproduction.

Unlimited sustained flight and wall parking throughout Vancouver are requested game mechanics; they are not claims about the production car's flight endurance, range or wall-driving certification.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Drive / steer | W/S or arrows; A/D | Left joystick |
| Jump, then climb | Space; hold to climb | Hold upward thrust |
| Descend | Q (Ctrl also accepted) | Hold downward thrust |
| Boost | Shift | Hold boost |
| Brake | B | Hold brake |
| Arm / release wall grip | E | Grip toggle |
| Park / release | P | Park toggle |
| Flight assist | F | Flight assist toggle |
| Chase / cockpit | C | Camera button |
| Look | Drag scene | Drag scene with another finger |
| Chase distance / enter cockpit | Wheel / zoom | Pinch |
| Recover to a verified road | R | Recovery in options |

Grip starts armed. Approach a supported facade with it enabled; the vehicle checks a swept full-body transition rather than snapping its rear through the pavement. P can queue parking during that transition. Space or releasing grip detaches from a wall. Third-person camera retains world up; the cockpit uses the full body orientation. Collision checks keep the chase camera outside buildings.

Desktop controls include a compact HUD and optional help. Touch controls support independent pointer capture so steering and thrust can be held together. Mobile options contain camera, recovery and car quality. Opening an obstructing panel suspends this player's physics and clears held inputs. Closing it requires a fresh key press; old OS repeat events cannot resume acceleration.

## Quality and resource bounds

Car geometry has its own Low / Medium / High / Auto selection. A manual selection remains forced independently of the city's rendering quality.

| Tier | Visible model triangles | Beauty meshes |
| --- | ---: | ---: |
| Low | 10,590 | 35 |
| Medium | 27,140 | 35 |
| High | 58,922 | 35 |

The ten-port gas effect adds one draw and 160 triangles when visible. All three cached tiers plus the effect retain 6,959,616 bytes of typed geometry buffers, 13 shared material objects and zero textures in the CPU inventory. This excludes Three.js object overhead and driver allocations; it is not a whole-city GPU-memory claim.

Auto chooses Low on the compatible renderer or during sustained fast travel, Medium for ordinary street use, and High for cockpit detail where the city budget permits. A candidate must remain stable for 2.2 seconds before an automatic change. At most three geometry tiers are retained; only one is visible. Shared materials and a fixed-size gas effect avoid per-frame mesh, material or particle allocation. Geometry, animation state and simulation are separate, so a tier change does not reset vehicle motion.

The existing city Auto controller receives actual Tesla speed and a ground/flight context. It continues to own city pixel resolution and scenery admission. Car quality does not disable the existing city Auto/manual setting.

## Physical world and lifecycle

- Continuous oriented-body sweeps with bounded angular substeps; support tests cover the whole footprint.
- Actual rendered asphalt, ordinary sidewalks and terrain triangles. A 13 cm paving step is represented as physical geometry; tyre fitting does not grant permission to pass a curb that overlaps the conservative body envelope.
- Ordinary-road driving fits the car to four authored tyre contacts across the actual triangle mesh. The fitted chassis pose is separate from the physical contact face, so a triangle's real normal and identity are never overwritten. Pose corrections remain bounded and collision swept. Three conservative underside sections retain 8 / 12 / 15 cm rear / centre / front clearance; clipping every non-wheel triangle against the section boundaries verifies these bounds across all three LODs. The separate 5 cm wheel-fit allowance cannot enlarge body clearance. These are authored model/game data, not a claim about the real vehicle's suspension. Walls, roofs, protected floors and other obstacles retain the full body envelope.
- At a road crease, a bounded vertical chassis adjustment may use the remaining wheel-fit allowance to clear the conservative underside collision envelope; the source triangles and body clearances remain unchanged. Launch first clears the proven road vertically with fixed orientation and horizontal position, then resumes flight motion once the full envelope is clear. This short departure revalidates its original road support and preserves overhead and other obstacles.
- Building footprints, holes, heights and pitched roof triangles come from the city data. Landmarks are obstacles rather than invented flat roofs.
- Protected deck identities/layers and drive permissions remain explicit. Recovery/spawn uses verified asphalt or a drive-approved protected floor, never an arbitrary terrain height.
- Water barriers follow actual sea/pond footprints and levels; narrow trunks and elevated crowns preserve real clearance under broadleaf street trees.
- Local 32 m collision tiles use bounded caches. Broad terrain/water sources are indexed lazily; the full city's triangles are not generated at mode entry.
- Collision tiles also use height bands, so a high-altitude query does not prepare road/tree triangles far below the car. Ordinary connected road grades have a bounded suspension envelope; protected decks and wall/roof support retain strict geometry checks.
- No fuel, pressure-tank or stamina counter. A 1,800 m altitude ceiling retains camera/query margin within a 2,000 m world envelope. Recovery returns to a verified road.
- Vehicle input, camera and mode ownership are released before placement, aircraft, bus visits, landmark focus or Orbit. Disposal releases all cached tiers, materials and listeners.

## Verification

Local release validation: **1,256 / 1,256 tests passed**, TypeScript check passed, the architecture contract audit (`--skip-blender`) passed, and the normal Firebase production build plus QA-isolation gate passed. Strict lint on all new Tesla source, tests and tools passed. Repository-wide lint remains a separate inherited diagnostic backlog and is not the CI passing gate.

CPU regressions cover model bounds and driver visibility, simulation transitions, exact parked pose, curved/holed support, water/terrain, touch/keyboard source clearing, mode handoffs, delayed bus loading, camera orientation, Auto hysteresis and bounded LOD reuse.

Local opt-in visual QA is installed only through `visual-qa.ts`; normal Firebase output rejects its marker strings and module payload. The helper drives public controller inputs after a verified actual-road spawn. It does not assign wall mode, contact or orientation to manufacture a successful climb. Captures include source fingerprint, actual state, camera frame, model/world stats and bounded trace.

The [browser verification record](qa/tesla-roadster-20261017/browser-verification.json) links the final WebGL captures and travel frame records. All final browser evidence has source fingerprint `591b0b2e3c7903e25c4c7af440379c593014bfd2934dde4be2a12cdbfda049b0`. Its `revision` field identifies the parent checkout; the separate fingerprint identifies the executed, then-uncommitted visual sources and data. It is not a claim that the parent commit contains this implementation.

The [actual-city CPU replay](qa/tesla-roadster-20261017/cpu-world.json) records canonical road/terrain sources and executed source hashes. A 240-frame, four-second replay measured physics mean 5.434 ms / p95 8.730 ms and physics plus camera mean 5.528 ms / p95 8.810 ms. A separate ten-second full-throttle replay travelled 615.852 m without collisions or environment failures. The constructor took 379.407 ms locally. These CPU figures include local JIT/GC effects and exclude GPU rendering, medium landmark meshes and asynchronous furniture. They are not FPS or device guarantees.

Actual city travel was tested in the in-app Chromium browser on an AMD Radeon Pro 560X / Metal renderer, at a 1280 × 720 viewport. City Auto settled at Balanced with a 0.65 resolution scale (832 × 468 render buffer). Frame statistics below include only recorded frames moving faster than 5 m/s; recording stopped before saving screenshots.

| Run | Moving frames | Aggregate FPS | p95 frame time | Maximum | Frames over 100 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| [General ground](qa/tesla-roadster-20261017/ground-travel.json) | 385 | 34.57 | 44.5 ms | 167.0 ms | 2 |
| [General flight](qa/tesla-roadster-20261017/flight-travel.json) | 1,648 | 53.65 | 26.6 ms | 73.5 ms | 0 |
| [Compatible ground](qa/tesla-roadster-20261017/compatible-ground-travel.json) | 336 | 30.12 | 57.8 ms | 163.8 ms | 3 |

These are short local observations, not controlled comparative benchmarks. The compatible run had labels enabled; the general recordings did not. Auto's 45 FPS target is a budget goal, and ground travel still has occasional city preparation hitches. The high-detail showcase uses a separate manual High city setting and is not a performance benchmark.

At the actual far-curb standby location, the fresh-support stationary path skips unnecessary 120 Hz integration while still checking current support identity, permissions and collision geometry each frame. The local HUD rose from roughly 14–17 FPS before that optimisation to roughly 49 FPS afterward. The [curb classification](qa/tesla-roadster-20261017/far9619-curb-classification.json) documents why forward motion can still be blocked there: a real 13 cm sidewalk overlaps the conservative collision sections during the sweep. This proves envelope overlap, not exact visual triangle-mesh contact. Reversing or jumping remains available. No automatic curb lift or global collision skin increase was added.

Browser smoke tests also verified all five mode handoffs, recovery to verified asphalt, modal input suspension, manual Low/Medium/High overriding Auto, three-tier cache reuse, sustained unlimited flight, wall attachment and exact parked pose. Third-person wall captures retain camera up `[0, 1, 0]`; the cockpit follows the body rotation. The wall scenario uses ordinary public vehicle inputs against an actual building facade.

Responsive checks at 390 × 780, 320 × 568, 844 × 390 and 390 × 844 kept all eight Tesla controls and all six mode buttons inside the viewport. Tesla touch targets are at least 48 px tall. Landscape mode pills are 40 px tall; portrait mode pills are at least 44 px tall. Native pointer holds verified climb, joystick travel, braking, options, camera, recovery and quality overrides. These are responsive browser checks, not real-phone GPU benchmarks. No warning/error console entries were observed in the completed general/mobile runs or the successful compatible run. The first compatible initialization showed the existing map-load failure UI; one normal reload succeeded, without a captured console error identifying its cause.

Selected evidence: [flight](qa/tesla-roadster-20261017/flight-high.png), [wall chase](qa/tesla-roadster-20261017/wall-chase.png), [wall cockpit](qa/tesla-roadster-20261017/wall-cockpit.png), [wall edge release](qa/tesla-roadster-20261017/wall-edge-release.json), [wall jump](qa/tesla-roadster-20261017/wall-jump.json), [compatible cockpit](qa/tesla-roadster-20261017/compatible-flight.json).

The previously failing real road captures are frozen in a small canonical-triangle regression fixture. Jump plus held lift gains 57.48 m in three seconds, the actual facade transition completes with bounded swept motion, and eight seconds of wall parking preserves the exact pose. A ceiling added to the same fixture blocks departure. Departing a sloped road re-proves the original contact, clears its bounded contact skin, and retains all other obstacles.

At a facade edge, or after Space releases a wall, a short swept outward withdrawal keeps the vehicle's wall orientation until its full rotation envelope is clear. Braking or pressing park cannot cancel that clearance halfway. The vehicle then levels into flight. Exact initial roof-edge contact separating outward is permitted; inward movement, real overlap and rotation into the roof remain blocked. Actual-city regressions cover wall-edge W → B → P, parked Space → B/P and an exterior obstacle that must still block departure.
