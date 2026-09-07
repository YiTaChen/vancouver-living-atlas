# Vancouver · Living Atlas

**One city. Five ways to explore: orbit, walk, drive, boat and fly.**

Vancouver Living Atlas is an interactive 3D Vancouver that runs in your browser. Wander the streets, drive a red roadster, cross the harbour by boat, or take off in a floatplane or helicopter. Explore Downtown, Stanley Park, English Bay, Kitsilano Beach and False Creek through Science World as daylight gives way to city lights and aurora.

**[Open the live demo →](https://vancouver-living-atlas-yita.web.app/)** · [Watch the film](#watch-vancouver-3d-city) · [Controls](#controls) · [Run locally](#run-locally) · [AI agent policy](AI_AGENT_POLICY.md)

**Built with GPT-6 Astra, TypeScript and Three.js.** Original procedural models sit on public geographic data, with real terrain relief, ten interface languages and desktop/touch controls. All five modes, including pilotable aircraft, are available in `main` and the live demo.

**Source-available with noncommercial and attribution conditions.** Commercial use and reuse outside the granted scope require written permission; AI agents have no special exemption. [License and existing rights](#license).

<a id="explore-vancouver-in-30-seconds"></a>

## Watch Vancouver 3D City

https://github.com/user-attachments/assets/8892839c-6e26-437d-84ae-fad6fc2333b6

**58.8 seconds of the actual running application.** The film travels from the peninsula to Science World's **exterior** changing from day to night, a rotating aurora panorama, walking, the red roadster, boating, floatplane takeoff in cockpit and chase views, helicopter flight, and a speeding stop ending with the officer beside the car.

| README video | Resolution | Duration | Format | Size |
| --- | --- | --- | --- | --- |
| [Download Vancouver-3D-City-readme.mp4](docs/videos/2026-09-07/Vancouver-3D-City-readme.mp4?raw=true) | 1280 × 720 · 16:9 | 58.8 s · 30 fps | H.264 MP4 | **7.85 MB** |

The complete edit is retained at **90.48% less file size** than the 82.5 MB 1080p master, below GitHub's 10 MB free-plan video attachment limit. Real WebGL frames, English titles and captions; no generated video, unrelated footage, narration or music. [Film details, compression recipe and validation](docs/videos/2026-09-07/README.md).

Recorded September 6–7, 2026. The film's **“FLIGHT PREVIEW”** captions describe its pre-merge recording snapshot; those aircraft are now released. The latest mobile layout refinements postdate the recording. The [earlier September 5 film](docs/videos/2026-09-05/README.md) remains archived.

## Explore the city

| Experience | In the live demo |
| --- | --- |
| **A city with real relief** | Downtown slopes, Stanley Park's higher ground, the Seawall, lakes, beaches and four major bridges. **15 viewpoints**, map labels and an automatic city tour help you find your way. |
| **Landmarks, outside and inside** | Science World, Canada Place, Waterfront Station, BC Place, Harbour Centre, Marine Building, Convention Centre West and Vancouver House. Walk into three modeled public interiors, follow Waterfront's SeaBus connection, or inspect a close overhead cutaway. |
| **Walk, drive and boat** | Choose your own starting point. Zoom between first-person, character, chase and cabin views, with a local minimap that follows position and heading. Boats have momentum, shoreline contact and a calmer feel on lakes than in the bay. |
| **Floatplane and helicopter** | Two different flight models, original cockpits, water/road launches, landing feedback and a sightseeing cruise around Downtown and Stanley Park. Leave the aircraft cruising while exploring the map, then return to it. |
| **Streets and beaches** | Improved road surfaces, markings, building façades and Stanley Park paths; continuous Lions Gate railings; beach logs, volleyball nets and Kitsilano basketball courts. |
| **A moving city** | Cars and Vancouver-style buses, electric SkyTrains, a fictional steam train with white chimney steam, harbour aircraft, cruise ships and moving boats. Private boats remain moored. |
| **Day, night and sky** | Flowing time, city lights, a moving sun and moon, lunar phases, stars, aurora and meteors—with manual controls. |
| **Phone and tablet controls** | A continuous thumbstick, touch look/zoom, optional map/settings panels and a hide-interface button. Flying keeps the power lever at lower right with Auto cruise directly above it. |

**Try an interior:** open **Layers** and choose the Science World, Canada Place or Waterfront Station entrance. Walk through the doors; follow the station's SeaBus signs through the glazed SkyWalk to its boarding lounge. Close overhead views reveal floors and furnishings. These are representative public spaces, not complete surveyed interiors; boarding SeaBus is not implemented. [Interior scope and references](docs/interiors.md).

**Try the roadster:** Drive starts with an original red convertible and a left-hand-drive cockpit. The original Classic car remains selectable without relocating. The roadster can exceed 200 km/h; sustaining more than 100 km/h in Downtown for five seconds triggers a scripted police stop and safety reminder. [Vehicle design and references](docs/vehicles/red-roadster.md).

**Try the sky:** choose Science World for a medium exterior view, disable the interior cutaway in Layers if needed, then change the time. Return to a city panorama for the aurora. Time and sky controls work independently of vehicle movement.

## Fly above Vancouver

Choose **Fly**, then place an aircraft on a suitable launch surface. The marker shows the aircraft type and a check/cross before launch; zoom in to place more precisely.

- **Floatplane:** launch on open water, accelerate with throttle, then pitch up to take off. Forward airspeed matters; it cannot hover. Water landings and beach contact have different drag and impact responses.
- **Helicopter:** launch on a clear road, raise collective to lift off, or use hover to hold position. Lower collective or use the desktop descent control to descend. Helicopters cannot land on water.
- **Three camera views:** cockpit, unobstructed first person and chase, connected by zoom. Auto cruise leaves the camera free to look around.
- **Auto cruise** joins a circuit around Downtown and Stanley Park. Zoom out to explore the map while the aircraft continues flying; a separate **Return to aircraft** button brings you back even after panning. Starting another vehicle or flight replaces the previous aircraft.
- **Landing and collision feedback:** harder touchdowns shake the camera more. Invalid landings or impacts with buildings/bridges trigger fire and smoke, return to a local overview after eight simulation seconds, and clear the effect after twenty.

Desktop controls display their keyboard shortcuts; **R / F** and **WASD** keep working after adjusting the power slider. Mobile pilots use the left stick and a separate throttle/collective lever, with tap/hold +/− controls.

This is assisted sightseeing flight with approximate physics. [Development plan, controls, validation and known limits](docs/flight-development.md).

## Controls

| Mode | Desktop | Phone / tablet |
| --- | --- | --- |
| **Orbit** | Drag to rotate; right-drag to pan; scroll or **+ / −** to zoom. | Drag to orbit; pinch to zoom. |
| **Walk** | **W / S** forward/back, **A / D** turn, **Shift** faster; drag to look. | Left stick moves and strafes; drag the scene to look. |
| **Drive** | **W / S** throttle/reverse, **A / D** steer, **Space** brake. | Left stick controls throttle/reverse and steering. |
| **Boat** | **W / S** throttle/reverse, **A / D** rudder, **Space** neutral. | Left stick controls propulsion and steering. |
| **Fly** | **W / S** nose down/up, **A / D** bank, **Q / E** yaw, **R / F** power, **C** cruise; helicopter **H** hover, **X** descend. | Flight stick; lower-right throttle/collective lever with +/− buttons and Auto cruise above it. Camera and other flight settings open from the toolbar. |

**Choose a starting point.** Select Walk, Drive or Boat, then click a suitable place—or drag its icon onto the map. Zoom in for precision. Roads snap to valid driving positions; boats need room clear of shores and docks. On mobile, tap a valid location to start; placement keeps only the Cancel control over the map.

**Change your view.** Scroll, pinch or use **+ / −** while travelling. Walk zooms between first person and an animated character; Drive and Boat zoom into their interiors, with an unobstructed first-person option. Vehicle and cabin selectors are in the camera panel, or **Travel options** on mobile.

**Look around and return.** Zoom beyond a ground/water travel view to a local aerial map. Rotate, then zoom back in to resume the same mode and position. Panning to another coordinate cancels that return. Walk ↔ Drive switches in place; boat/land transitions require a suitable new start. Aircraft use the separate persistent **Return to aircraft** action described above.

**Find yourself.** The local minimap follows your actual position with a heading arrow, nearby roads, shores, building footprints and a distance scale. Its zoom is independent of the 3D camera. Capture exports the rendered view as a PNG.

## Designed for phone and tablet

Move with the **lower-left thumbstick** while dragging the scenery to look and pinching to zoom. Placement leaves only Cancel over the map so the launch location stays visible.

- Open the minimap and travel/flight settings when needed. The large flight information card is absent from the default touch view; camera selection, new flight, helicopter hover and help live in the optional settings panel.
- In flight, the **lower-right power lever** has +/− buttons and an independent **Auto cruise** toggle immediately above it. There is no separate mobile Q/E arrow row; the flight stick handles turning.
- **Hide interface** clears auxiliary panels while keeping the mode selector, joystick, player/vehicle and essential flight power/cruise controls. The GitHub source link is the first entry in **Information**.

Portrait, landscape and tablet layouts have been checked in the browser. The compatible renderer addresses the mobile black-canvas issue, with successful user phone feedback; viewport checks alone are not a physical-device performance guarantee.

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

The recorded startup experiment measured median page-to-interactive times of **18.13 → 15.75 s on desktop** and **15.68 → 15.07 s in a phone-sized compatible profile**, across three local runs per version/profile. These are dated measurements, not a benchmark of every later feature: ranges overlap, and the phone profile used desktop Chrome rather than iPhone hardware. First-use pauses remain possible; the results do not establish universal FPS, memory or battery savings. [Measurements](docs/performance/progressive-startup.md) · [Accepted and rejected experiments](docs/performance/experiment-decisions.md) · [Rendering budgets](docs/visual-quality/README.md).

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

**Stack:** TypeScript, React, Three.js and vinext/Vite. The separate `npm run build` / `npm start` path builds and previews the Worker-based version.

| Area | Source |
| --- | --- |
| Interface, responsive layout and controls | [`app/`](app/) · [`components/`](components/) |
| Rendering, geometry, travel and flight simulation | [`lib/city/`](lib/city/) |
| Ten interface locales | [`lib/i18n/`](lib/i18n/) |
| Geographic assets and source preparation | [`public/data/`](public/data/) · [`tools/README.md`](tools/README.md) |
| Simulation and regression checks | [`tests/`](tests/) |
| Showcase compression and media checks | [`tools/encode-city-readme-video.py`](tools/encode-city-readme-video.py) · [film records](docs/videos/2026-09-07/README.md) |

### Firebase Hosting

`npm run build:firebase` exports `dist/client` with geographic assets, textures and local fonts. Its verifier checks the English initial page, ten-language support, key assets and emitted landmark worker. Hosting is static; no Cloud Functions are required.

For an authorized deployment to **your own** Firebase project, build first, authenticate with the Firebase CLI, then run:

```sh
firebase deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
```

The checked-in `.firebaserc` names the owner's project; use an explicit project ID for your own permitted copy. Building locally does not deploy.

## Development and evidence

This project is developed with GPT-6 Astra through a manager loop: **implement → independent review → inspect the running browser → correct → validate → commit**. The public history and records document both successful changes and rejected experiments.

[Development record](docs/PROGRESS.md) · [Ten-stage city upgrade](docs/visual-quality/UPGRADE_TASKS.md) · [Interior checks](docs/interiors.md) · [Startup experiment log](docs/performance/experiment-decisions.md) · [Flight development and validation](docs/flight-development.md)

Reports are dated snapshots with their own test counts, hardware and release state. Desktop/mobile viewport checks are recorded separately from physical-device feedback.

## License

Original material uses the **Vancouver Living Atlas Noncommercial Research and Attribution License 1.0**. This is source-available, not OSI-approved open source. [Full terms](LICENSE).

- **Permitted:** noncommercial academic research, teaching, personal learning and attributed hobby demonstrations.
- **Requires written permission:** commercial products/services, client work, monetization and commercial repackaging. Attribution alone does not authorize commercial use.
- **Credit required:** clearly identify **Vancouver Living Atlas by YiTaChen** and link to [this repository](https://github.com/YiTaChen/vancouver-living-atlas). Preserve the license, identify modifications, and place credit prominently in repositories, demo interfaces, publications and media as specified in LICENSE.
- **No plagiarism or uncredited copies:** do not claim the original material as your own, hide its source or redistribute outside the license conditions.
- **AI agents:** the same limits apply to automated extraction, copying, adaptation and redistribution. An agent cannot authorize itself or erase provenance by rewriting the material. AI-assisted work already permitted by this license remains permitted. [AI agent policy](AI_AGENT_POLICY.md) · [LICENSE section 9](LICENSE).

**中文摘要：** 允許非商用學術研究、教學與個人學習；商用須事先取得書面許可。個人引用、改作或展示亦須明顯註明本 repo 與作者出處。AI agent 不得在沒有合法授權的情況下挪用、散布內容或移除出處；合法研究中的 AI 輔助仍須遵守完整英文 LICENSE。

**Earlier MIT releases retain their grants.** The September 6 license change cannot revoke permissions for material released through [`e380869`](https://github.com/YiTaChen/vancouver-living-atlas/tree/e380869). The [historical MIT notice](docs/licensing/MIT-before-2026-09-06.txt) applies to those releases, not as an alternative license for later additions.

Third-party data, software and fonts retain their own terms, including **Open Government Licence – Vancouver** and **ODbL 1.0**; these are not relicensed by the project's custom terms. See [data attribution](DATA_SOURCES.md). Contact YiTaChen through this repository for permission requests.
