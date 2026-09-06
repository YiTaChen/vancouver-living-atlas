# Red roadster — September 6, 2026

Driving now starts in the red open roadster. Classic remains selectable and switching preserves driving position, speed and camera distance. The roadster's lower driver eye height and left-hand cockpit are selected together at initialization. Cockpit trim matches the red exterior and dark seats.

The original procedural model now uses smooth longitudinal body sections, a pinched waist, raised wheel shoulders, real wheel openings with recessed liners, tapered rear seat fairings, a low ducktail, inset side blades, swept lamps and thin-spoke wheels. Cabin openings remain geometric openings. No downloaded vehicle model, brand badge or reference photograph is included in the scene.

Appearance references:
- [Porsche 718 Spyder RS official side profile](https://www.porsche.com/stories/mobility/six-things-porsche-718-spyder-rs/): low proportions, rear fairings and integrated aerodynamic elements.
- [Porsche body and aerodynamics](https://newsroom.porsche.com/en/press-kits/718-Spyder-RS/Karosserie-und-Aerodynamik.html).
- [Mazda MX-5 official exterior](https://www.mazdausa.com/vehicles/mx-5-miata): compact open-cabin proportions and flowing surfaces.

The model remains 19 material/wheel draws (20 including the shared contact shadow), below the existing 20,000-triangle geometry budget. No textures, additional realtime lights, post-processing or external model loads were added. Only the selected user-driven car uses this model; ordinary traffic is unchanged.

Validation includes finite geometry, footprint and triangle/draw limits, open-cabin ray checks, red material, default exterior/cockpit pairing, left-hand eye position and resource-preserving Classic/Roadster switching. A local review tool reproduces front/rear/side model views: `node tools/preview-roadster.mjs`, then serve `work/roadster-review` locally. It is not included in Firebase assets.
