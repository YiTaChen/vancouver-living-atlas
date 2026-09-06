# Vancouver · Living Atlas

An original, explorable browser reconstruction of Vancouver: the entire Downtown peninsula, Stanley Park, English Bay and False Creek through Science World. The city follows public coastlines, street geometry and actual terrain relief, with original procedural architecture and landscape detail.

**Live demo (Firebase): [vancouver-living-atlas-yita.web.app](https://vancouver-living-atlas-yita.web.app/)**

**License: noncommercial research/personal learning only · prominent repo attribution required · commercial use requires written permission.** [Full terms](LICENSE)

[Data and accuracy](DATA_SOURCES.md) · [Manager-loop development record](docs/PROGRESS.md)

The five-language application is publicly hosted on Firebase Hosting. This repository is public, and the application can also run locally.

## Explore Vancouver in 30 seconds

https://github.com/user-attachments/assets/e5bf31c6-9eef-4c7f-827b-ef1349b9461c

Recorded on September 5, before the latest road, landmark and bus upgrades: detailed landmarks, walking, a left-hand-drive cockpit, sailing, local-map zoom and day-to-night lighting. All footage comes from the running 3D application.

**Compact preview:** 960 × 540 · 30 fps · 3.6 MB (93% smaller). [Download preview](docs/videos/2026-09-05/project-intro-readme.mp4?raw=true) · [Full 1080p film](docs/videos/2026-09-05/project-intro.mp4?raw=true) · [Reproduce the film](docs/videos/2026-09-05/README.md)

## Languages

English is the default for a first visit. The header language menu also offers Français, Español, 中文（繁體） and 中文（简体）. A selection updates the interface and map labels without resetting the scene, and is remembered on that browser.

## Explore / 操作

**Phone / tablet:** the left thumbstick moves continuously (walk: forward/back and strafe; drive/boat: throttle/reverse and steering). Drag the scene to look and pinch to zoom. Map, travel settings and tools open from compact buttons; the local map can stay open while moving. Placement shows only a Cancel button—tap a valid ground/road/water location to start. Vehicle selection and cockpit options live in Travel options.

- **鳥瞰 / Orbit:** drag to rotate, wheel or +/− to zoom, right-drag to pan. Fourteen city, park, landmark, harbour and railway viewpoints, north-up reset, a clickable minimap and an automatic city tour are included.
- **步行 / Walk:** drag the person in the mode bar onto the main map, or select Walk and click an open ground location. Zoom in before dropping for greater precision. W/S move, A/D turn, drag to look, Shift moves faster.
- **駕車 / Drive:** drag the car onto the map, or select Drive and click near a road. The preview shows the actual snapped road position before starting; distant roads, water and building interiors are rejected. W/S throttle/reverse, A/D steer, Space brakes. Bridge decks and ground-level underpasses remain separate. While driving, use **Classic / Roadster** in the upper-right camera card to switch between the original car and an open-top two-seat sports car without resetting your location, speed or zoom.
- **開船 / Boat:** drag the boat onto open water, or choose Coal Harbour, False Creek or Lost Lagoon. W/S control throttle and reverse, A/D steer the rudder, Space selects neutral. The boat coasts with momentum, responds to sea waves or calmer lake water, and stops at shores and docks.
- **重新放置 / Choose a new start:** use the button in street controls to return to a nearby aerial view and place again. Esc cancels placement. Mouse/touch map drags adjust the view without dropping; a tap places. Keyboard users can select a mode, focus the map and press Enter to start at its centre, or activate Start here for the previewed point. Gastown, Robson and Beach Avenue remain explicit quick starts.
- **City buses:** original Vancouver-style blue/yellow low-floor buses join major-road traffic, with passenger doors, roof equipment and slope-following movement. One shared instanced model, capped fleet and distance culling keep the addition bounded. Service patterns are illustrative.
- **時間 / Time:** the separate clock button shows the current scene time. Time flows by default at 300× (one real minute is five city hours; a full day takes 4 minutes 48 seconds). Choose 1×, 10×, 30×, 60×, 120× or 300×, set any minute of the day, or turn off “Let time flow” to fix the light at that moment. Walking, driving, traffic and water animation retain their normal speed. Scene time pauses while the tab is hidden. “Hide time” hides the toolbar’s numeric time while keeping the clock button and panel available; time is shown by default.
- **天空 / Sky effects:** open Time → Sky effects for a moving sun and moon, eight lunar phases plus an eclipse preview, faint adjustable stars, aurora curtains and meteors. The first night after each page load defaults to a half moon and aurora; subsequent simulated nights have a stable 1-in-3 aurora chance. Visibility, star density, aurora strength/density and meteor frequency are adjustable in all five languages. Sky cycles are illustrative, not live astronomical or aurora forecasts. [Implementation and visual checks](docs/visual-quality/sky-effects-final/README.md).
- **圖層 / Layers:** control trees, buildings, traffic, trains, harbour aircraft and boats, and labels. Choose Balanced, High detail or Ultra detail.
- **列車 / Trains:** a locomotive, coal tender and four coaches travel the Waterfront–Gastown railway with rising white chimney steam. Two four-car electric SkyTrains travel in opposite directions on the Expo elevated tracks near Science World. Open Layers and choose “Find steam train” or “Find SkyTrain” for a close view; trains are visible by default. Their speed is independent of the day/night clock.
- **風景 / Capture:** export the current rendered view as PNG, or hide the interface for an immersive view. Esc restores controls and returns street modes to orbit.

## What is built

- **7,630 geographic building solids**, rendered as **7,800 polygon parts**, including measured 2009 City geometry and reconciled OSM tower heights.
- A **257 × 273 terrain grid** (roughly 20 m), interpolated from official 2002 contours. Stanley Park reaches about **76 m**, with real Downtown relief rather than a flat base.
- Actual coastlines, park boundaries, lakes, beaches and street lines; 810 park trail features and regional North Shore landforms.
- **36,041 rendered trees** from public street-tree positions plus original forest infill; spatially chunked canopy detail changes with viewing distance.
- Original Science World, Canada Place, BC Place, Harbour Centre, Marine Building, Vancouver Convention Centre West and Vancouver House models; Burrard, Granville, Cambie and Lions Gate bridge structures.
- Original façade patterns, Gastown shopfronts and steam clock, rooftop equipment, cars, ferries, sailboats, original moving train models and simulated night lighting.

No Unreal Engine, finished third-party city model, Google imagery or copied reference-project code is used.

## Accuracy and scope

This is a geographic visualization, not a photographic reconstruction or a certified digital twin. Source dates differ: core contours and shoreline date to 2002, measured building parts to 2009, supplemented by OSM records retrieved in September 2026. Terrain interpolation, procedural façades, representative signs, tree canopy, bridge heights and road widths are visual approximations. Buildings are seated on the displayed terrain; stored source base elevations remain available in the data. Outer North Shore and south-shore terrain provides coarse regional context.

Rail plan geometry comes from OpenStreetMap: approximately 1.12 km of waterfront railway and 855/894 m of each elevated Expo direction. Station canopies, building passages and tunnels are excluded. Heights, trains and repeated passes are illustrative; the steam service is fictional. Entire trains fade out at the cropped ends before a new pass starts.

Street navigation is an exploration feature: simplified collision and vehicle motion are included, rather than a full traffic or driving simulation. Frame rates depend on GPU, viewport and settings. The [ten-stage upgrade and acceptance record](docs/visual-quality/UPGRADE_TASKS.md) covers roads, beaches, landmark detail and loading. See the [loading and rendering measurements](docs/visual-quality/performance/README.md) and [300× clock comparison](docs/visual-quality/clock-1080/README.md). Ultra remains more demanding, and first-time detail loading can still cause a visible pause. See [source provenance and qualifications](DATA_SOURCES.md).

## Local minimap

While walking, driving or boating, the minimap follows your actual position with a cyan heading arrow and north at the top. Use its **+ / −** buttons, scroll over the map, or focus the map and press **+ / −** to zoom independently of the 3D camera. Nearby roads, building footprints, shores, lakes and a distance scale provide context. The selected zoom is retained when switching travel modes; Orbit retains the clickable peninsula overview. The local minimap is also available on phones.

## Travel cameras

Scroll, pinch or use **+ / −** to change camera distance while walking, driving or sailing.

- **Walk:** zoom from first person to a third-person view with an animated character.
- **Drive and boat:** zoom into the vehicle interior, then use the upper-right controls to choose the cabin view or an unobstructed first-person view. The car has a left-hand-drive interior; drag to look around independently of steering.
- **Look around and return:** zoom farther out to a local map at your current position. Rotate the map to inspect nearby scenery, then zoom back in to resume the same travel mode, position and heading. Panning to a different coordinate cancels this return; choose a new starting point to re-enter.

Switching **Walk ↔ Drive** keeps you in the scene. Switching between a boat and a land mode opens placement for the appropriate surface. The local minimap follows your position and zooms independently of the 3D camera.

## Graphics quality

Open **Layers → Visual quality** to choose **Balanced**, **High detail** (default), or **Ultra detail**. Ultra adds close landmark structure, textured branching trees, facade geometry and a higher physical rendering resolution. New viewpoints make the stadium, lookout and Marine Building easy to inspect. High and Balanced remain available for lower GPU load. See [graphics budgets, original asset provenance and validation](docs/visual-quality/README.md).

## Run locally

Requires Node.js **22.13+**, npm, and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. The application serves its own geographic assets; no map API key is required. A web server is necessary because the app loads geographic files with HTTP requests.

```sh
npm run check   # TypeScript
npm test        # geography, height intervals, coast classification and bridge continuity
npm run build   # production Worker and client assets
npm start      # local production preview through Wrangler
```

The renderer is in `lib/city/`; geographic data are in `public/data/`; original surface textures are in `public/textures/`. `tools/README.md` describes source-data preparation and the raw inputs needed to rebuild datasets.

## Manager loop

Implementation → independent geographic/architecture review → browser inspection → correction → validation → commit and push. Each stage is preserved in public Git history, with findings in [docs/PROGRESS.md](docs/PROGRESS.md). The reference attachments are visual benchmarks only and are not included in the repository.

## License

Original material is now offered under the custom **Vancouver Living Atlas Noncommercial Research and Attribution License 1.0**, see [LICENSE](LICENSE). This is source-available, not OSI-approved open source.

- **Allowed:** noncommercial academic research, teaching, personal learning and attributed hobby demonstrations.
- **Not allowed without written permission:** commercial products/services, client work, monetization, sales or commercial repackaging. Crediting this repo does not make commercial use permissible.
- **Attribution required:** personal as well as academic reuse must clearly credit **Vancouver Living Atlas by YiTaChen** and link to **https://github.com/YiTaChen/vancouver-living-atlas**. Put credit near the beginning of a fork's README, visibly in a demo's main interface, and in videos/images or their captions as specified in LICENSE. Include the license; identify modifications.
- **No plagiarism or unauthorized copies:** do not claim the original project as your own, remove/hide credits, or share clones outside the license conditions.

**中文摘要：** 允許非商用學術研究、教學與個人學習；未經書面許可禁止商用。個人引用、改作、展示、影片或轉載也必須明顯註明「出自 Vancouver Living Atlas／YiTaChen」並附本 repo 連結。不得冒稱原創、移除出處或違規重製散布。完整英文 LICENSE 為準。

**Earlier MIT releases:** this change starts with the 2026-09-06 license-change commit. It cannot revoke rights already granted for material released through [`e380869`](https://github.com/YiTaChen/vancouver-living-atlas/tree/e380869), including MIT commercial permissions. The [historical MIT notice](docs/licensing/MIT-before-2026-09-06.txt) is retained for those releases, not offered as an alternative for future additions.

Geographic data and third-party dependencies keep their own terms, including **Open Government Licence – Vancouver**, **Open Database License 1.0**, Canadian/USGS terrain terms and individual software/font licenses. The combined geographic database remains ODbL with City attribution; the new restrictions do not relicense those sources. See [DATA_SOURCES.md](DATA_SOURCES.md).

For commercial permission or other exceptions, contact **YiTaChen through this repository**. A request alone is not authorization.

## Firebase Hosting

The Firebase build exports a static site, including the geographic data, textures and locally bundled fonts. It does not require Cloud Functions or a server runtime.

```sh
npm ci
npm run check
npm test
npm run build:firebase
firebase deploy --only hosting --project vancouver-living-atlas-yita
```

`firebase.json` publishes only `dist/client`. The build verifier checks English initial HTML, all five locale bundles and the main geographic assets. `.firebaserc` selects the owner's dedicated `vancouver-living-atlas-yita` project. To publish your own copy, pass your own project ID explicitly. The existing `npm run build` still builds the Sites-compatible version.

### Explore the harbour

Choose **Boat** to the right of Drive, then drag the boat icon onto open water (zoom in for a precise launch). Use **W/S** for throttle/reverse, **A/D** for the rudder, and **Space** for neutral. Release the throttle to coast; drag to look around. Touch controls use press-and-hold. Coal Harbour, False Creek and Lost Lagoon are available as quick starts. Sea waves and boat inertia differ from calm lake motion; the whole hull stops at shores and docks.

The Layers panel contains a **Harbour** switch and **Find floatplane / helicopter / cruise ship** controls. Aircraft and cruises follow original local demonstration paths based on verified service destinations; this is not live traffic or a navigation chart. Private boats remain moored. [Harbour sources and precision](docs/HARBOUR_SOURCES.md).
