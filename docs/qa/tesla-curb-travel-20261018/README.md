# Tesla low-curb travel — 2026-10-18

The previous ground solver sampled only below the wheel axles. It could hold a valid road pose beside a 13cm footway yet repeatedly reject forward motion because the wheel height changed abruptly only after crossing the edge. The new authored 35cm circular tread begins contact before the axle reaches that finite edge, allowing normal pitch/heave while keeping the existing 5cm suspension range.

The original three-section rear proxy was 5mm lower than needed for the actual mesh. Its floor is now 8.5cm; all three LODs have a measured minimum of 8.76735449cm, retaining 2.6735mm conservative margin. The mesh is unchanged. The archived animated-ground-bound report also uses analytic full-rotation vertex-orbit lower bounds for wing, yoke and fan parts. Actual body routes still use the complete translating/rotating collision solver and unchanged collision epsilon.

A minimum static fit can graze a curb during rotation. Only after that ordinary route is rejected does state request one route-aware retry. OLS and fixed-frame fallback share at most 12 height candidates inside the same physical wheel-travel and adjustment intervals. Each candidate separately re-proves support, the stationary body and the full original continuous sweep; unresolved searches remain blocked. These candidate choices are not sampled collision permission.

## Validation

The 28 curb tests include 18 full-platform routes: 5/10/13cm steps with actual vertical risers, straight and ±25degree approaches, 2/8m/s, 60/30Hz and 67ms partitions, both axles, descent, braking/parking and restart. Negatives retain a 1mm interior/tyre hole, disabled/excluded/nonadherable/roof/protected surfaces, a 45cm curb, an overhead obstruction, invalid/overlapping route origins and a real wall. The nine pure tread tests verify finite triangle edges, analytic extrema, pitched grades and input bounds. Existing park/grade/launch/wall/roof tests remain part of full regression.

The frozen canonical source fixture is not modified. Its footway is only about 2m wide and cannot contain the 2.78m wheelbase. The actual-city acceptance proves front-axle climb, exact stop and reverse back to the road. Its separate far-side 1.38m drop remains rejected. Full-car traversal is tested on a complete 8m platform, not invented beyond the finite city footway. The fixture excludes medium landmarks and runtime furniture; browser runs include the real runtime scene.

## Browser evidence

Five local opt-in captures retain their parent revision and one source fingerprint. They execute then-uncommitted release sources; the parent commit is not a claim that it contains this repair. All entries use public StreetNavigation.startAt and Tesla.enter, with an actual 4.097cm spawn offset; no contact, pose or quaternion is forced. Native keyboard and joystick/button input operate the vehicle.

The desktop front-axle checkpoint is 2.564m from the approach, followed by reverse back to asphalt. Portrait 320×568 and landscape 844×390 checkpoints show front tyres on the footway and zero-speed stable ground poses. Their longer native approaches reach the same separate far-edge safety boundary. These endpoint captures do not establish zero collisions over the entire native action or full-car passage across the narrow footway; continuous collision-free full-platform routes are verified by CPU tests. Native input hold values are automation parameters, not exact simulation-time measurements.

High/Low/Auto vehicle detail switches retained the exact parked pose. Portrait idle retained exact position/quaternion. Console warnings/errors were empty; the joystick was released after operation. These are functional responsive Chromium tests, not physical-phone, FPS or input-latency benchmarks. The test tab was closed, viewport reset and local server stopped.

`verification.json` lists source hashes, final validation results, selected capture metadata and limitations. `actual-source-extents.json` records why the city platform is finite. Other diagnostic reports preserve intermediate geometry/height experiments; their explicit virtual shape variants are not extra production permissions. The previous QA records remain historical observations of their original solver.
