# Vancouver · Living Atlas

**Explore Vancouver from the skyline, the street and the water—in your browser.**

An interactive 3D city covering Downtown, Stanley Park, English Bay, Kitsilano Beach and False Creek through Science World. Public geographic data provide the streets, coastlines and terrain; original procedural models bring the landmarks, interiors, vegetation and moving city to life.

**[Open the live demo →](https://vancouver-living-atlas-yita.web.app/)** · [Watch the film](#explore-vancouver-in-30-seconds) · [Run locally](#run-locally) · [Data & accuracy](DATA_SOURCES.md)

**Source-available, noncommercial use only.** Research, learning and permitted demonstrations require prominent source attribution. Commercial use requires written permission. [License and earlier MIT releases](#license).

## Explore Vancouver in 30 seconds

https://github.com/user-attachments/assets/e5bf31c6-9eef-4c7f-827b-ef1349b9461c

Real footage from the running application: an aerial tour, landmark detail, walking, cockpit driving, boating and changing daylight. Recorded **September 5, 2026**, before the subsequent city-detail, mobile, sky and flight updates.

| Video | Resolution | Duration / frame rate | Size |
| --- | --- | --- | --- |
| [Compact MP4](docs/videos/2026-09-05/project-intro-readme.mp4?raw=true) | 960 × 540 | 30 s · 30 fps | 3.6 MB |
| [Full-quality MP4](docs/videos/2026-09-05/project-intro.mp4?raw=true) | 1920 × 1080 | 30 s · 30 fps | ~49 MB |

Both are H.264 MP4s. The compact version is about 93% smaller. [Recording, editing and reproduction files](docs/videos/2026-09-05/README.md).

## What you can explore

| Experience | In the live demo |
| --- | --- |
| **A city with real relief** | Downtown slopes, Stanley Park's higher ground, the Seawall, lakes, beaches and four major bridges. **15 viewpoints**, map labels and an automatic city tour help you find your way. |
| **Landmarks, outside and inside** | Detailed Science World, Canada Place, Waterfront Station, BC Place, Harbour Centre, Marine Building, Convention Centre West and Vancouver House. Enter three public interiors on foot or reveal them with a close aerial cutaway. |
| **Walk, drive and boat** | Place your starting point on the map, then move through the city. First-person, character, chase and cabin views share smooth camera zoom. A local minimap follows your position and heading. |
| **Fly above Vancouver** | Pilot a floatplane or helicopter, explore both cockpits, take off and land, or join a sightseeing cruise around Downtown and Stanley Park. |
| **Streets and beaches** | Improved road surfaces, markings, building façades and Stanley Park paths; continuous Lions Gate railings; beach logs, volleyball nets and Kitsilano basketball courts. |
| **A moving city** | Cars and Vancouver-style buses, electric SkyTrains, a fictional steam train with white chimney steam, harbour aircraft, cruise ships and moving boats. Private boats remain moored. |
| **Day, night and sky** | Flowing time, city lights, a moving sun and moon, lunar phases, stars, aurora and meteors—with manual controls. |
| **Phone and tablet controls** | A continuous thumbstick, touch look/zoom, compact panels and a hide-interface button that keeps movement controls available. |

**Try an interior:** open **Layers** and choose the Science World, Canada Place or Waterfront Station entrance. Walk through the doors; follow the station's SeaBus signs through the glazed SkyWalk to its boarding lounge. Close overhead views reveal floors and furnishings. These are representative public spaces, not complete surveyed interiors; boarding SeaBus is not implemented. [Interior scope and references](docs/interiors.md).

**Try the roadster:** Drive starts with an original red convertible and a left-hand-drive cockpit. The original Classic car remains selectable without relocating. The roadster can exceed 200 km/h; sustaining more than 100 km/h in Downtown for five seconds triggers a scripted police stop and safety reminder. [Vehicle design and references](docs/vehicles/red-roadster.md).

## Fly above Vancouver

**Choose Fly in the [live demo](https://vancouver-living-atlas-yita.web.app/) to pilot a floatplane or helicopter.** Pilotable aircraft are included in `main`, alongside the harbour's ambient air traffic.

- Place on a clear road to launch a **helicopter**, or on open water for a **floatplane**. Original exteriors and cockpits support cabin, unobstructed first-person and chase views.
- Distinct handling: helicopter collective, hover and descent; floatplane throttle, water takeoff and stall response. Landings produce impact-dependent camera shake; invalid surfaces and collisions trigger temporary fire/smoke effects.
- **Auto cruise** joins a circuit around Downtown and Stanley Park. Zoom out to explore the map while the aircraft continues flying; a separate **Return to aircraft** button brings you back even after panning. Starting another vehicle or flight replaces the previous aircraft.
- Desktop pitch/roll/yaw and power controls, mobile stick and power lever, a following minimap and all ten interface languages are included.

This is assisted sightseeing flight with approximate physics. [Development plan, controls, validation and known limits](docs/flight-development.md).

## Controls

| Mode | Desktop | Phone / tablet |
| --- | --- | --- |
| **Orbit** | Drag to rotate; right-drag to pan; scroll or **+ / −** to zoom. | Drag to orbit; pinch to zoom. |
| **Walk** | **W / S** forward/back, **A / D** turn, **Shift** faster; drag to look. | Left stick moves and strafes; drag the scene to look. |
| **Drive** | **W / S** throttle/reverse, **A / D** steer, **Space** brake. | Left stick controls throttle/reverse and steering. |
| **Boat** | **W / S** throttle/reverse, **A / D** rudder, **Space** neutral. | Left stick controls propulsion and steering. |
| **Fly** | **W / S** nose down/up, **A / D** bank, **Q / E** yaw, **R / F** power, **C** cruise; helicopter **H** hover, **X** descend. | Flight stick, separate throttle/collective lever, yaw and helicopter controls. |

**Choose a starting point.** Select Walk, Drive or Boat, then click a suitable place—or drag its icon onto the map. Zoom in for precision. Roads snap to valid driving positions; boats need room clear of shores and docks. On mobile, tap a valid location to start; placement keeps only the Cancel control over the map.

**Change your view.** Scroll, pinch or use **+ / −** while travelling. Walk zooms between first person and an animated character; Drive and Boat zoom into their interiors, with an unobstructed first-person option. Vehicle and cabin selectors are in the camera panel, or **Travel options** on mobile.

**Look around and return.** Zoom beyond a ground/water travel view to a local aerial map. Rotate, then zoom back in to resume the same mode and position. Panning to another coordinate cancels that return. Walk ↔ Drive switches in place; boat/land transitions require a suitable new start. The aircraft preview has its own persistent return behavior described above.

**Find yourself.** The local minimap follows your actual position with a heading arrow, nearby roads, shores, building footprints and a distance scale. Its zoom is independent of the 3D camera. Mobile panels can be collapsed; hiding the interface retains the joystick and your character or vehicle. The GitHub link is in **Information** on mobile. Capture exports the rendered view as a PNG.

## Time, sky and languages

The **Time** button controls the scene clock. Time flows at **300× by default**: a full day takes 4 minutes 48 seconds. Adjust the speed, set a time directly, freeze it, or hide the toolbar's numeric time. Movement and traffic retain their normal speed; the clock pauses while the tab is hidden.

Under **Time → Sky effects**, toggle the sun, moon, stars, aurora and meteors; adjust star density, aurora strength/density and meteor frequency. There are eight lunar phases plus an eclipse preview. The first simulated night after a page load starts with a half moon and aurora; later nights have a one-in-three aurora chance. These cycles are illustrative, not astronomical predictions or live forecasts. [Sky implementation and visual checks](docs/visual-quality/sky-effects-final/README.md).

**Ten languages:** English (first-visit default), Français, Español, 中文（繁體）, 中文（简体）, Deutsch, 日本語, 한국어, Українська and Русский. Changing language updates controls and map labels without resetting the scene; the browser remembers the selection.

## Rendering and startup

Choose quality under **Layers → Visual quality**:

| Setting | Intended experience |
| --- | --- |
| **Balanced** | Reduced decoration and rendering cost; the default geometry profile on mobile. |
| **High detail** | Desktop default, with nearby façade and tree detail. |
| **Ultra detail** | Richer nearby landmarks, trees and façades, with higher resolution on supported renderers. |

Phones and tablets also use a **compatible rendering path** that avoids the HDR post-processing chain and caps physical rendering resolution. Desktop can force it with `?graphics=compatible`. [Mobile rendering changes and validation](docs/visual-quality/mobile-compatible/README.md).

Startup now shows a **stage-estimated percentage plus an animated activity bar**. Required geographic requests run concurrently, repeated terrain calculations are cached, and road processing skips irrelevant regions. Small rooftop details are built in bounded background steps; existing façade, tree and Ultra-landmark detail is prepared according to distance and quality. Walk, Drive and Boat resources remain ready before entry, preserving their camera transitions. This is incremental detail preparation, not full-city geographic streaming.

In three local runs per version/profile, median page-to-interactive time changed from **18.13 → 15.75 s on desktop** and **15.68 → 15.07 s in a phone-sized compatible profile**. Sample ranges overlap; the latter is desktop Chrome, not iPhone hardware. First-use pauses remain possible, and these results do not establish universal FPS, memory or battery savings. [Measurements](docs/performance/progressive-startup.md) · [Accepted and rejected experiments](docs/performance/experiment-decisions.md) · [Rendering budgets](docs/visual-quality/README.md).

## Built from geography, with original models

- About **7,800 building polygon parts**, derived from City of Vancouver geometry and reconciled OpenStreetMap heights. Parts are not a count of unique buildings.
- A **257 × 273 terrain grid**, roughly 20 m spacing, interpolated from public contours; Stanley Park reaches about 76 m.
- **36,041 rendered trees**, combining public street-tree positions and original forest infill, with distance-based canopy detail.
- Original procedural landmarks, interiors, bridges, façades, vehicles and environmental effects. No Unreal Engine or finished third-party city model is used; reference photographs are not bundled as city textures.

Source dates differ: core terrain/shoreline data date to 2002 and measured buildings to 2009, supplemented by OSM. Façades, interiors, bridge elevations and vehicle behavior are approximations. Rail and harbour routes are demonstration paths; the steam service is fictional, and traffic is not live. This is a geographic visualization, not a photographic reconstruction or certified digital twin. [Data provenance](DATA_SOURCES.md) · [Harbour references](docs/HARBOUR_SOURCES.md).

## Run locally

Requires **Node.js 22.13+**, npm and a browser with **WebGL 2**. The app serves its own geographic assets; no map API key is required.

```sh
git clone https://github.com/YiTaChen/vancouver-living-atlas.git
cd vancouver-living-atlas
npm ci
npm run dev
```

Open the URL printed in the terminal. All five exploration modes are available from `main`.

```sh
npm run check           # TypeScript
npm test                # Geometry, navigation, simulation and lifecycle checks
npm run build:firebase  # Static production build plus asset/locale verification
```

**Stack:** TypeScript, React, Three.js and vinext/Vite. Renderer and simulation: [`lib/city/`](lib/city/); geographic assets: [`public/data/`](public/data/); source preparation: [`tools/README.md`](tools/README.md). The separate `npm run build` / `npm start` path builds and previews the Worker-based version.

### Firebase Hosting

`npm run build:firebase` exports `dist/client` with geographic assets, textures and local fonts. Its verifier checks the English initial page, ten-language support, key assets and emitted landmark worker. Hosting is static; no Cloud Functions are required.

For an authorized deployment to **your own** Firebase project, build first, authenticate with the Firebase CLI, then run:

```sh
firebase deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

The checked-in `.firebaserc` names the owner's project; use an explicit project ID for your own permitted copy. Building locally does not deploy.

## Development and evidence

This project is developed with GPT-6 Astra through a manager loop: **implement → independent review → inspect the running browser → correct → validate → commit**. The public history and records document both successful changes and rejected experiments.

[Development record](docs/PROGRESS.md) · [Ten-stage city upgrade](docs/visual-quality/UPGRADE_TASKS.md) · [Interior checks](docs/interiors.md) · [Startup experiment log](docs/performance/experiment-decisions.md) · [Flight branch validation](https://github.com/YiTaChen/vancouver-living-atlas/blob/feature/flight-exploration/docs/flight-development.md)

Reports are dated snapshots with their own test counts, hardware and release state. Desktop/mobile viewport checks are recorded separately from physical-device feedback.

## License

Original material uses the **Vancouver Living Atlas Noncommercial Research and Attribution License 1.0**. This is source-available, not OSI-approved open source. [Full terms](LICENSE).

- **Permitted:** noncommercial academic research, teaching, personal learning and attributed hobby demonstrations.
- **Requires written permission:** commercial products/services, client work, monetization and commercial repackaging. Attribution alone does not authorize commercial use.
- **Credit required:** clearly identify **Vancouver Living Atlas by YiTaChen** and link to [this repository](https://github.com/YiTaChen/vancouver-living-atlas). Preserve the license, identify modifications, and place credit prominently in repositories, demo interfaces, publications and media as specified in LICENSE.
- **No plagiarism or uncredited copies:** do not claim the original material as your own, hide its source or redistribute outside the license conditions.

**中文摘要：** 允許非商用學術研究、教學與個人學習；商用須事先取得書面許可。個人引用、改作或展示亦須明顯註明本 repo 與作者出處，並遵守完整英文 LICENSE。

**Earlier MIT releases retain their grants.** The September 6 license change cannot revoke permissions for material released through [`e380869`](https://github.com/YiTaChen/vancouver-living-atlas/tree/e380869). The [historical MIT notice](docs/licensing/MIT-before-2026-09-06.txt) applies to those releases, not as an alternative license for later additions.

Third-party data, software and fonts retain their own terms, including **Open Government Licence – Vancouver** and **ODbL 1.0**; these are not relicensed by the project's custom terms. See [data attribution](DATA_SOURCES.md). Contact YiTaChen through this repository for permission requests.
