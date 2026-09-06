# Travel cameras and returning from the local map

The car has an original generic left-hand-drive cabin. The driver eye is about 0.45 m to vehicle left, aligned with its wheel and instruments; the centre console and passenger dashboard extend to the right. These are authored proportions for the project car, not manufacturer measurements. The cabin is attached to the vehicle in world space, so dragging to look around does not steer or rotate the interior with the head. Small damped acceleration/braking/turning movements use vehicle axes, including when looking sideways. The clear view uses the same driver position.

Left input rotates both car and boat steering wheels counterclockwise as seen by the driver; right input rotates them clockwise. Keyboard/held controls and the existing click pulses feed the same animation. Boat dynamics, waves and cabin geometry are retained.

Zooming beyond 96 m leaves travel for a 200 m local map at the player's exact position. While the map centre is unchanged, zooming back within 110 m resumes the previous mode, heading, look direction, camera distance, interior choice and ground/bridge/water layer. The player resumes at rest. A short camera transition makes the return continuous.

Rotation keeps this one-use return available. Any horizontal map-centre movement cancels it, including moving away and back. Viewpoints, minimap navigation, actor focus and new placement cancel it explicitly. Manual Orbit/Escape remains an explicit exit. A five-language hint shows when zoom return is available. Two-finger pinch and pan are separated so pinch does not accidentally cancel the return; after a pinch, one remaining finger can continue rotating the map.

## Validation

Run `npm run check`, `npm test`, and `npm run build:firebase` (the latter only builds and verifies static output). The camera/placement tests cover the actual navigation controller and Three.js OrbitControls: all three return modes, bridge and elevated-lake coordinates, panning away/back, explicit placement, pending gestures, steering signs, driver eye coordinates, vehicle-fixed interior, and bounded head movement.

The original car interior has 6,070 triangles, 15 meshes and 8 materials. Geometry checks cover finite attributes, degeneracy and central sightlines. Existing boat geometry remains 5,048 triangles. No photographic textures or copied vehicle models are included.

## Browser review (2026-09-05)

The static build was exercised in the Chromium-based in-app browser at 1440×900 and the default narrow viewport. Verified the asymmetric car cockpit and left-turn wheel animation, car free look, wheel/button zoom exits and returns for Walk/Drive/Boat, unchanged displayed coordinates after returning, rotation preserving the return hint, and choosing another viewpoint clearing it. The narrow layout keeps the camera choices, minimap, return hint and movement buttons operable. The reviewed browser session had no console errors; stable views generally reported 35–60 FPS on this machine. Automated checks: 103 tests passed, TypeScript passed, and Firebase static export verification passed. No deployment is part of this change.

## Official layout references


Reviewed 2026-09-05:

- [Volvo XC60 official left-hand-drive instruments and controls overview](https://www.volvocars.com/uk/support/car/xc60/17w46/article/5b78d70bc7e244b1c0a81f6f7b69c865/ecc939608857f819c0a801517402894a/): distinguishes the wheel/driver-display assembly, right-side centre/tunnel console, driver's left door controls and roof/mirror console. Its linked [LHD control diagram](https://www.volvocars.com/media/support-content/imgaf3e659c02f2391bc0a801522582dda2_2_--_--_VOICEpnghigh.png) is a layout reference, not a source texture.
- [Volvo Cars USA XC60 interior design](https://www.volvocars.com/us/cars/xc60-hybrid/interior-design/): the official interior imagery shows the driver wheel and separate central display/console with the passenger dashboard extending beyond it. [Official gallery image](https://www.volvocars.com/images/cs/v3/assets/blt0feaa88e629251fc/bltb187d6242f83c113/669818193ee3ba9caaef4255/xc60-hybrid-gallery-1-4x5.jpg) is cited for spatial arrangement only.
- [Toyota official Corolla interior and driving-position description](https://newsroom.toyota.eu/2019-the-toyota-corolla/): supports the distinct driver cockpit, lower dashboard for forward visibility and a wider centre console within driver reach. No OEM measurements were transferred into this model.

The chosen eye offset, wheel distance, pillar depth, camera FOV and dashboard dimensions are authored visual approximations for this project's generic car, not manufacturer specifications. Reference images were not included or redistributed.

