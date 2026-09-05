# Landmark and vegetation detail

The new **Ultra detail** option is under **Layers → Visual quality**. High detail remains the default. All options and new landmark viewpoints are translated into English, French, Spanish, Traditional Chinese and Simplified Chinese.

| Setting | Rendering budget | Nearby architecture | Nearby trees |
| --- | --- | --- | --- |
| Balanced | 1.8 million physical pixels, DPR ≤ 1 | Reconstructed landmark silhouettes; simple facades | Existing inexpensive forest instances |
| High detail (default) | 1.8 million physical pixels, DPR ≤ 1.25 | Reconstructed landmarks; facade reveals within 160 m | Up to 450 detailed trees within 170 m |
| Ultra detail | 3.6864 million physical pixels, DPR ≤ 2 | Extra landmark structure within 1,700 m; facade geometry within 550 m | Up to 1,080 trees within 450 m, including up to 480 highest-detail trees within 220 m |

At a 1920 × 1080 viewport, DPR 1, High renders at 1788 × 1006 and Ultra renders at 2560 × 1440 before displaying on the same viewport. Very large viewports are additionally capped at 4096 pixels per dimension. This is an actual render-resolution change as well as a model-detail change, not a promise of 4K on every device.

Ultra increases the directional shadow map from 2048 to 4096 pixels and focuses its coverage around close orbit views. Ambient contact shading uses half-resolution targets in both shaded modes; the city colour render retains the selected full resolution. Balanced disables these shadow and contact-shading passes.

## Original models

Science World, Canada Place, BC Place, Harbour Centre, Marine Building and the Convention Centre west building were authored as original, metre-scale parametric models from mapped outlines and architectural references. Medium models improve their silhouette and main structural features for all graphics settings. Ultra models add structural cables, mullions, frames, panel joints, seating, balcony/terrace details and ornament according to each building.

The new models replace earlier geometry. Marine Building's three generic building parts and generic rooftop equipment are excluded from the beauty geometry; the original geographic source data remain available to navigation. The Convention Centre's three legacy parts (`buildingId 152366`) are likewise replaced as one measured structure. Water-level decks supply explicit, transformed collision footprints to the existing water registry.

Higher-detail landmark geometry is constructed once, on first approaching that landmark in Ultra. Switching away hides it and restores the medium model. Materials, geometry and textures are released with the scene. The two versions are never rendered simultaneously. Night emissive materials are registered when each model is created, including models first visited after sunset.

Science World's frame nodes gain a batched, additive night glow with a small original radial texture. This is one point draw per visible model, with no individual point lights, and follows the same day/night and detail visibility rules.

Ordinary buildings gain anti-aliased window patterns, sill shading, different glazing roughness, some closed blinds, and nearby geometric mullions/balconies. Facade cells reuse the exact foundation of the city building body, are constructed only near the camera, and have a limit of 24 active / 32 cached cells with geometry disposal on eviction. These are representative architecture, **not surveyed facades**. Original terrain, building footprint and height data are preserved.

## Generated tree artwork

`public/textures/trees/leaf-atlas.png` and `bark-albedo.png` are original images generated with the built-in image generator for this project. Full prompts are in [tree-image-prompts.json](tree-image-prompts.json). No photographic asset, finished tree model or finished city model was downloaded into the application.

The requested transparent leaf atlas was returned with a neutral checker background embedded in RGB, including after a correction attempt. The source image is retained unchanged. The material decodes coverage from the original sampled RGB brightness in the colour and shadow passes; the application does not present it as a transparent PNG. Solid internal leaf clusters carry an explicit `aSolid` attribute and sample checked green-leaf UV positions. Bark also provides a subtle bump signal.

Six original species/shape combinations have medium and ultra geometry. Trunks taper, fork and vary in silhouette; foliage combines overlapping volumes and leaf-bearing branch surfaces. Existing tree locations, heights and species classification are retained. Medium trees use 500–558 triangles, ultra 2,838–3,486 triangles.

A bounded, instanced pool replaces only nearby trees. A far-tree matrix is hidden only after its replacement is available and successfully assigned. Leaving the radius, disabling trees, changing graphics mode, or an atlas load failure restores the original matrix. Pool overflow also leaves the original tree visible. Low-detail leaf LODs share the same matrix buffer, so replacements cannot leave a duplicate canopy behind.

## Reproducible validation

`npm run check`, `npm test` and `npm run build:firebase` are the release checks. `tests/visual-quality.test.mjs` verifies pixel budgets, finite geometry, closed collision rings, relative model costs, bounded tree instance pools and far-instance restoration through repeated quality changes. Existing navigation and harbour tests also instantiate the new landmark collision geometry.

Browser screenshots and measured timings are captured from the actual local WebGL scene, with a fixed clock and fixed camera for comparisons. Hardware, view positions and measurements are recorded with the QA artifacts. The local `?inspect=1` engine hook is available only in development and is removed by the production build.

See [the completed local QA record](QA.md) for measured frame rates, checks and browser interactions.

Architectural proportions and source precision are documented in [primary landmarks](PRIMARY_LANDMARKS.md) and [secondary landmarks](SECONDARY_LANDMARKS.md). This remains an original geographic visualization, not photogrammetry or a survey-grade digital twin.

Convention Centre sources and mapped roof interpretation: [CONVENTION_CENTRE.md](CONVENTION_CENTRE.md).
