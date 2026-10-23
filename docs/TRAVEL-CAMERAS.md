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


## Open-world camera and placement update — 2026-10-23

Moving Overview to another location invalidates the previous trip. Selecting Walk,
Drive, Boat or Fly then opens placement at the current map, including when the old
walker was in a station or riding SkyTrain. Existing street Walk ↔ Drive switching
in place is retained. Tesla searches only the current map's local safe spawn area;
an invalid location reports failure instead of jumping to Robson Street.

A SkyTrain Overview can resume its existing passenger only while its horizontal
map target stays within 2 m of its original anchor. Moving farther permanently
invalidates that return, even when panning back. Repeated Overview selections do
not recenter the camera. Releasing passenger ownership for placement leaves the
geographic stations and autonomous service running. Cancelling placement does not
revive an old trip. Two-finger mobile gestures distinguish zoom from map movement.

Street and station third-person cameras retain the requested heading, pitch and
rear chase direction. Geometry never searches for an alternative front/side view
or shortens a walking camera. Station walking uses the same raised chase angle and
body pivot as street walking. Cabin/station forward input adopts the visible free
look heading, including joystick input. Sitting and standing preserve the viewed
heading while the seated body still follows its chair. First-person ±88° look is
retained.

`TravelOcclusion` now makes an entire obstructing wall, roof or logical building
part fully invisible. It does not open a circular hole or leave a dithered outline
around the avatar. Individual instances and disconnected geometry pieces are
classified separately; the measured GIS batch uses its existing per-building
vertex spans, so one obstruction cannot erase the whole city. Rendered ground at
the player's feet stays visible. Geometry, physical collision, shadows, material
opacity and transparent sorting stay intact. The same piece classification in the
normal/depth pass keeps SSAO consistent and preserves the avatar. First-person and
Overview clear the effect. Boardable bus cabins register alongside stations and
train cabins, including children such as accessibility ramps added afterward.

Piece bounds are prepared during registration. The GPU checks them against the
bounded camera-to-avatar sightline and removes all fragments of the selected
piece, rather than masking a region of screen pixels. This adds no draw calls or
lights. The sightline is at most 32 m; the station chase boom is at most 14 m.
Per-frame work updates fixed uniforms; scene traversal happens on initial
registration and streamed child events. Existing night, geographic-entrance and
deformation hooks are chained, and disposal restores owned hooks/listeners.
Bounds metadata has weak resource ownership. Inert uploaded attributes remain
available until the source geometry owner disposes them, so Three can free their
GPU buffers before a deferred, guarded restoration of the original attributes.
Detached warmup registrations are
released on success, cancellation and failure; watched city parents re-enroll
successfully attached geometry. Cancelled decoded night receivers are never
registered, and a dynamic train root releases its listeners when removed even
from an unwatched scene parent. No performance claim is inferred from
CPU tests; GPU appearance is checked separately in the built browser application.

Scene shader preparation now snapshots native program handles through public Three
and WebGL APIs. Deleting a streamed material during parallel compilation cannot
leave Three r185's material-based readiness timer unresolved. Abort, context loss,
link failures and a bounded timeout settle the preparation promise. QA street spawn
waits for the first real frame rather than changing modes during initial compilation.


Validation for this update: the initial complete local suite passed 2,083/2,083.
Subsequent focused regressions cover all 17 authored physical stair routes, actual
Expo/Canada cabins and seats, pointer/joystick heading, rendered mode bindings,
instance-safe cutaway and normal/depth lifecycle, and deleted-program warmup.
TypeScript and the production Firebase build pass. The existing large UI/engine
files retain repository lint debt; comparison against the base introduces no new
diagnostics, and new modules pass strict targeted lint.

Native acceptance used the built WebGL app at 1280×720 and 390×844. Holding W or
the mobile joystick descended the Waterfront stairs on supported surfaces with
unchanged camera heading. Mouse look followed by W preserved that heading and
moved along it. Unmoved Overview resumed the same passenger; moving to Stanley
Park opened new Walk placement and Start here placed the walker at the new
49.30200, -123.14500 location. Mobile Downtown selection opened fresh Drive and Fly
placement while releasing the previous station. The cutaway reported zero shader
hook failures. These responsive checks use a desktop browser, not a physical
phone GPU or an all-device performance benchmark. Final exact-head CI and deployed
asset verification are recorded with the pull request/release.
