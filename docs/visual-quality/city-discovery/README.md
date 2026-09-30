# City discovery and canopy refinement — 2026-09-30

This milestone responds to the Taipei GTA comparison with a connected exploration loop and a bounded improvement to city-wide vegetation. It preserves Vancouver's source geometry, navigation, traffic and existing visual-quality tiers.

## What the comparison establishes

We opened [Taipei GTA](https://taipei-gta.vercel.app/) in desktop Chrome on 2026-09-30. Its opening mission immediately supplies a named companion, a destination marker and distance, dialogue and a next action. The street view combines sidewalk paving, individual shop signs, planted medians, textured tree crowns, pedestrians and vehicles. Its pause screen explains the active task and retains recent dialogue.

The live Statistics screen reported **69 tasks** (15 main, 39 side, 6 cultural, 4 races and 5 jobs) and **30 collectible cats**. This is a point-in-time UI observation, not a playthrough of those tasks. The [September 30 Marie Claire article](https://www.marieclaire.com.tw/lifestyle/news/96226) reports 93 missions and game-adjusted geography; the count does not match the version we observed. The [first-person Dcard post](https://www.dcard.tw/f/game/p/262215230/b/1) describes an expanding browser game and recommends desktop play. We have not verified the author's asset pipeline, source code, claimed token spending, or AI-model attribution.

The difference is therefore more than city choice. Taipei GTA concentrates authored street identity and guides players through repeated objectives and interactions. Vancouver already has five travel modes, traffic, touch controls and traversable public interiors, but these features have mostly been independent tools. Vancouver also preserves surveyed footprints and heights over a large area; that data supplies geography, not automatically the authored storefronts, local props, characters and activities visible in the reference.

## Delivered scope

- Original **City field notes**: three short exploration trails in Gastown and along Robson Street, nine ordered observation stops, contextual collection actions, three completion stamps, and browser-local saved progress.
- An explicit start/rejoin action, a compact current-objective card, walking eligibility, distance guidance and resumable progress. Changing camera/travel mode or placing the player cannot award a stop by itself.
- A reusable, depth-tested world destination marker and a matching minimap diamond/off-map bearing arrow. These are destination indications, not a turn-by-turn route solver.
- Original asymmetric broadleaf silhouettes and uneven conifer tiers replace the old city-wide spherical/conical fallbacks. Existing nearby textured trees, tree locations, instancing, LOD distances and compatible rendering remain in use.

The trails use subdivisions of the previously tested Water Street and Robson navigation corridors. They are **in-game exploration paths on road centerlines**, not surveyed sidewalk itineraries or real-world walking directions. No collision bypass or automatic travel between stops is introduced.

## Rendering cost

| Fallback crown | Previous triangles | New triangles |
| --- | ---: | ---: |
| Broadleaf, medium | 240 | 240 |
| Broadleaf, distant | 60 | 60 |
| Conifer | 42 | 40 |

The more faceted 12-lobe and UV-sphere candidates were rejected after matched renders. The selected broadleaf uses three smoothly shaded, asymmetrically deformed masses; this is subtle fallback refinement, not individual-leaf realism. Source-height normalization also reduces the change in silhouette when switching to the existing detailed trees.

Matched standalone renders: [day](canopy-day.png) and [night](canopy-night.png), left to right: old broadleaf, new broadleaf, old conifer, new conifer. Same source height input, palette, camera and lighting.

Tree instance groups and material counts are unchanged; baked vertex color supplies restrained crown shading without additional textures or shader passes. The active destination has two small unlit meshes, 56 triangles total, no texture, no light, and no shadow pass. The minimap retains its 10 Hz upper repaint limit.

## Verification

TypeScript, all **488 tests**, the production Firebase build and its emitted-worker verification pass. The production page was re-opened successfully, retained all three Gastown notes and its stamp, rendered the Traditional Chinese journal, and exposed no QA panel or diagnostic movement button. [Production passport](production-passport-zh.jpg). The 11 new discovery tests cover corrupted/versioned saves, ordered/idempotent collection, resume/replay, mode and height eligibility, hidden-tab displacement, teleports and obstructed-route preflight. The existing camera first-frame test was made deterministic by fixing its clock during the extracted production animation call; a concurrent build had exposed wall-clock scheduling sensitivity (an 18 mm simulated advance), not the original 28 m camera jump.

Early Chrome testing completed the first two Gastown stops (57 m and 90 m accepted walking before collection). During later reloads Chrome lost the WebGL context and then reported `Web page caused context loss and was blocked`; subsequent context creation failed, including compatible mode. We did not change browser security/graphics settings or restart unrelated user tabs. The underlying cause remains unproven. Independent Chromium-based in-app browser testing uses the same Radeon Pro 560X and successfully loaded the final build, collected a note, reloaded, restored it and rejoined the route.

Final live evidence uses source fingerprint `1810c5cfdad53db6e2e6667cb5c549af0798d443e7aa628263f03dde75d80ede`; its parent revision is d66a249, not the yet-uncommitted implementation. Tests and documentation do not change that visual-source fingerprint. The final Gastown flow collected all three stops and earned one stamp. Its first note survived a page reload and explicit rejoin. Robson and West End both passed live start/preflight; they were not walked end-to-end again in this milestone. Portrait 390×844 and landscape 844×390 checks verified the objective, collection control, joystick, pause, journal and route switching. This is responsive desktop emulation, not a real-phone performance result. The in-app browser reported no warnings/errors during the completed flow.

Evidence: [completed trail](trail-complete.jpg), [desktop progress](desktop-progress.jpg), [phone portrait](mobile-portrait.jpg), [phone landscape](mobile-landscape.jpg), [validation record](browser-checks.json). The diagnostic forward-walk control drives actual navigation input; it never assigns position or awards notes, and it is removed from production builds.

This milestone does not claim a Taipei-scale story campaign, photorealistic parity, a Chrome reliability fix, or stable 60 FPS.

## Next priorities

1. Connect existing public interiors to distinct activities (e.g. a waterfront/Science World observation circuit), after auditing their approach surfaces and vertical eligibility.
2. Add selected original Vancouver street identities: legible original shopfront signs, local street furniture and authored activity characters, concentrated where players actually walk.
3. Improve repeated building facades and ground/yard transitions with matched captures and controlled asset budgets.
4. Profile long frames before increasing population, lights or asset density across the whole city. Prior long-walk measurements of 16–22 FPS still constrain this work.

No competitor code, models, textures, branding or dialogue was copied into the product.
