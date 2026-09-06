# Open roadster and car selection — 2026-09-06

Original procedural two-seat convertible: tapered body sections, flared wheel arches, transparent raked windshield, tan seats, rollover hoops, a seated driver, mirrors, LED strips, deck vents, exhausts and spinning/steering wheels. No downloaded vehicle or brand model. The original classic remains the default and is preserved.

Driving UI: the existing upper-right travel-camera card has Classic/Roadster buttons in both first- and third-person views, above Interior/Clear view. Five languages; touch buttons at least 44px tall. Mobile minimap is repositioned beneath the expanded card. Switching reuses cached variants under the same navigation root, preserving pose, speed, distance and local-map return state. No downloads on selection. Roadster eye height is 1.20m; classic remains 1.45m. Both retain the existing left-hand driver offset and steering/instruments. Roadster cockpit adds an open passenger seat and rollbar.

The new exterior is 19 mesh draws and 5,658 triangles, including wheels (20 draws with the existing shared contact-shadow plane). Hidden variants do not render. Vehicle movement/collision behavior is shared with the existing car; this is a visual car choice, not a new racing physics mode.

Verification:
- 357 tests passed, including open-cabin downward ray, finite geometry/footprint/draw budget, wheel animation, cockpit resources and 20 repeated switches preserving state.
- Browser-tested actual app in compatible rendering: selected Classic and Roadster through public controls, moved forward, zoomed into the roadster cockpit, inspected visible map/car/interior and no logged browser errors.
- Geometry batching was finalized after visual inspection; the automated geometry checks cover the final merged wheel batches.
- Mobile renderer validation and physical-device limitation: see ../mobile-compatible/README.md.
