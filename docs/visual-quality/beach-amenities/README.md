# beach-amenities measurements

Actual local application renders. Viewports: [(1280, 720)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| english-beach-eye | high | 36.3 | 34.0 | 49.3 | 65.8 | 0 | [Image](high-english-beach-eye.jpg) |
| kits-beach-eye | high | 30.9 | 34.2 | 49.8 | 67.3 | 0 | [Image](high-kits-beach-eye.jpg) |


## Result and limits

Two basketball courts, eight volleyball courts (two English Bay / six representative Kitsilano nets), and 21 weathered logs. Total added geometry: 41,944 triangles in two opaque spatial batches; remote views cull both at 1,400 m. [References, coordinate provenance and scope](REFERENCES.md).

The saved `eye` case names are **low orbit** camera views (actual camera heights approximately 8–10 m), not first-person walking measurements. These stationary 8-second tests measured approximately 31–36 FPS, p95 <=34.2 ms and no frame >100 ms on this machine at High (1280×720 viewport, physical render 1600×900). They are not an isolated before/after comparison or a promise of zero stutter during travel. Existing tree crowns obscure parts of the Kitsilano courts from some angles; their surveyed positions are retained.

Visual checks: court paint is flat rather than raised cylinders; four backboards/hoops, net strands/posts, sand boundary cords and logs are visible. No new floating court slab, missing geometry or browser error was observed. The geometric floor regression verifies that props follow rendered sand height rather than a lower DEM and that source terrain remains unchanged. All 347 tests passed; after the final paint change the targeted geometry regression and TypeScript check passed again.

Reproduce: `VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build`, then `node tools/serve-visual-qa.mjs beach-amenities`; open localhost:3100 and select the English/Kits beach QA viewpoints followed by Measure selected High. QA controls are excluded from `npm run build:firebase`.
