# Travel cameras

Walk, Drive and Boat accept the main view's mouse wheel, two-finger pinch and + / − buttons. The minimap retains its own independent zoom.

- Walk starts at eye level. Zooming out reveals the original animated 1.75 m character, including face, jacket, backpack and articulated limbs.
- Drive and Boat start with their existing chase distances. Zooming in enters the vehicle. The upper-right Interior / Clear view buttons toggle the visible dashboard without changing position, speed or movement input. Each vehicle remembers its own preference.
- Zooming past 96 m exits travel to a 200 m orbit centered on the exact player position, including bridge or lake height. The 550 ms transition eases both position and orientation. Remaining wheel inertia and active pinch pointers cannot carry the same gesture into an accidental city-wide zoom.
- Orbit and Escape also exit at the current location. Explicit overview/viewpoint actions retain their existing destinations. Walk ↔ Drive still switch in place; switching to or from Boat retains placement.
- Each travel mode remembers its zoom for the current session. First-person exteriors are hidden to avoid rendering solid cabins through the eye. Boat camera motion retains wave response and checks its entire chase line against the same water body at steps no larger than 2 m.

The character and both interiors are original procedural geometry. The character is approximately 3,100 triangles; each interior is approximately 5,000. Interiors render only in their selected view. The character uses a small contact shadow instead of triggering whole-city shadow updates for every step. A lazy spatial index samples explicitly marked rendered ground, road, sidewalk, beach and path triangles so the character's feet match the visible surface without changing navigation physics. Bridge feet continue to use the selected deck surface.

All camera controls and hints are translated into the existing five languages. These changes add no dependencies or external services.

Validation: `npm test`, `npm run check`, targeted lint for the new modules, and `npm run build:firebase` (static build only). CPU regressions include actual OrbitControls constraints and the production animation method, navigation/input preservation, local-map exit, pinch continuation, and surface-height interpolation. Browser QA uses the built app, including the main and minimap zoom controls, all three travel modes, vehicle view toggles, and narrow layout.
