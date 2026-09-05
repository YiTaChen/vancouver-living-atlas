# Original Science World and Canada Place geometry

Prepared 2026-09-05. `primary-landmarks.ts` is the original source snapshot for these two models. The module exports only `createScienceWorld(detail: boolean)` and `createCanadaPlace(detail: boolean)`, each returning a new `THREE.Group` at local position/rotation zero. No browser or Site checkout was modified during asset production.

Source SHA-256: `841efc674ada6a31a0b27e3d676de228477067cba76a2060fb9deb3b149a57e3`.

The geometry is authored here in TypeScript, including the geodesic shell, triangle fittings, curved pavilion walls, stairs, anticlastic sail surfaces, mast/cable systems and hotel. No downloaded 3D assets, photo textures, generated images, fonts, WebGL renderer, engine, or DOM are required. Research photos were viewed and then removed from the asset directory; none are distributed as artwork.

## Placement and geometry budget

Local units are metres, +Y up. The `placement` fields are advisory; the generator does not apply them.

| Model | Longitude, latitude | Parent Y / yaw | Medium | Detail |
|---|---|---|---|---|
| Science World | −123.1039114, 49.2733499 | 3.4 m / 0 | 12 meshes, 19,510 triangles | 15 meshes, 79,190 triangles |
| Canada Place | −123.111352, 49.2886214 | 3.5 m / −1.073 radians | 9 meshes, 14,052 triangles | 11 meshes, 51,316 triangles |

Detailed local bounds, including small fittings and below-water piles:

- Science World: min `[-37.40, -5.30, -61.24]`, max `[69.00, 48.42, 37.40]`.
- Canada Place: min `[-46.42, -5.10, -282.42]`, max `[61.42, 81.44, 230.42]`.

Each mesh has one standard PBR material and retained `position`, `normal`, and `uv` attributes. Dome panels have local triangle UV charts; fabric uses a continuous 0–1 chart within each sail; standard cylinders, boxes and extrusions retain their own UVs. There are no `PointLight`, `SpotLight`, `Points`, `Line` or transparent meshes. Fabric alone is `DoubleSide`, to show the underside. Glass is an opaque reflective visual treatment, avoiding transmission passes and alpha-sorting problems.

Detail geometry uses approximately 7.60 MB of vertex buffers for Science World and 4.93 MB for Canada Place. `validation.json` records strict TypeScript checking plus actual generated counts, finite attributes, zero degenerate triangles and bounds for both levels. Local construction took approximately 290 ms / 134 ms for the detailed models in one Node run; this is not a browser FPS claim. Both sites stay below 20 meshes and 100,000 triangles individually.

## Science World references and interpretation

1. **Diameter:** Science World's [May 2026 official release](https://www.scienceworld.ca/wp-content/uploads/2026/05/Science-World_FNL_05-May-2026-A-1.pdf) identifies a 40-metre-diameter dome. The outer geodesic cage uses radius 20 m; lamp housings project slightly outside it. The temporary 2026 football wrap is intentionally not included; the model shows the familiar unwrapped architectural form.
2. **External frame, red band, cladding, glazing and stairs:** The project's structural engineer, [Bush, Bohlman & Partners](https://www.bushbohlman.com/projects/science-world-renewal/), documents the renewal, marine structure and exhibition addition. Its [waterfront photograph](https://www.bushbohlman.com/app/uploads/2020/10/bbp-science-world_HERO-resized.jpg) clearly separates the white external cage from the reflective triangular skin. Its [aerial photograph](https://www.bushbohlman.com/app/uploads/2020/10/bbp-science-world-2-resized.jpg) shows the crescent pavilion, roof ribs, red inset walls and glass entry. Both images were inspected directly.
3. **Lights:** [Science World's official lighting page](https://www.scienceworld.ca/light-up-science-world/) and its [2023 lighting release](https://www.scienceworld.ca/wp-content/uploads/Science-World-Press-Release-Dome-Lights-August-2023-FINAL.pdf) document 651 LEDs. Detail has 651 emissive fittings; medium samples 326. Their locations are reconstructed deterministically, not a surveyed fixture plan.
4. **Geography:** The existing project OSM snapshot `37084312` supplies the pavilion's plan context and sphere-centre placement. The crescent annex is approximated within that outline. The 40 m cage diameter is factual; pavilion heights, cylinder centre height, support members, panel layout, stair counts, colours and material values are authored visual estimates. The frequency-7 triangulation is not claimed to reproduce the exact original panel inventory.

The detailed model adds inset dark seams, rolled metal panel edges, external nodes and spacers, external switchback stairs, façade joints and colour accents. The two quality levels share the same dome panel topology, so switching detail does not change the geodesic pattern.

## Canada Place references and interpretation

1. **Architecture:** [DA Architects + Planners](https://www.da-architects.ca/projects/canada-place-pan-pacific-hotel/) confirms the five sails, hotel and public waterfront uses. [Zeidler](https://zeidler.com/projects/canada-place/) describes the diagonal roof spans, undulating ridges and multi-level promenades.
2. **Actual membrane and structure:** The original roof supplier [Birdair](https://www.birdair.com/birdair-portfolio/canada-place/) documents the 2011 PTFE-fibreglass replacement matching the five-sail design. Three supplier photos were directly inspected: [membrane and ridge connections](https://www.birdair.com/wp-content/uploads/2020/01/960x560_2-77.jpg), [two mast rows and transverse catenaries](https://www.birdair.com/wp-content/uploads/2020/01/960x560_4-45.jpg), and [glass promenade, terrace and hotel](https://www.birdair.com/wp-content/uploads/2020/01/960x560_6-7.jpg). The same supplier group provides [roof specifications](https://taiyo-europe.com/?taiyo-portfolio=canada-place).
3. **Height reference:** The City's [Central Waterfront Port Lands policy statement](https://guidelines.vancouver.ca/policy-statement-central-waterfront-port-lands.pdf), section 5, describes approximately 48 m at the sails and 80 m at the hotel. The model mast tips are local 44.5 m plus the recommended 3.5 m base. The stepped hotel/cupola remains an approximate massing; vertical datums and all minor details are display estimates, not a survey certificate.
4. **Plan geometry:** Existing OSM records `1216968939`, `1216968940`, `1216968941`, `1216968942`, `1216968944` describe the five sail bands. In the recommended local frame their width is about 53 m, and the east/west ends are staggered about 49 m. The bands occupy roughly local Z −80 to +73 m. They are **diagonal strips**, not five roof tents orthogonal to the pier. These OSM roof tags are simplified mapping; only the footprint alignment is used. The actual smooth, opposing-curvature surfaces are newly authored.
5. **Pier and hotel:** OSM `223635729` supplies the tapering pier envelope; `143682542` indicates the low northern pavilion, and `1216968929` locates the hotel's small roof cupola. The new pier has a tapered northern extension. Its full length is still about 512 m in this local frame; the major dimensional correction from the prior scene is the smaller, correctly staggered sail zone, not shortening the whole pier.

The model uses five adjoining anticlastic patches, leaning HSS masts, multiple stays and anchors, inter-mast cables, low boundary seams and fine membrane seams. Local mast/anchor radii, material parameters, floor heights, hotel setbacks, planters, windows and lighting intensities are visual estimates. This is an original interpretive reconstruction, not an exact fabrication model.

## Integration contract

```ts
const model = createScienceWorld(true); // false for medium
const p = model.userData.placement;
const [x, z] = project([p.lon, p.lat]);
model.position.set(x, p.baseY, z);
model.rotation.y = p.yaw;
scene.add(model);

// Compatible with the existing engine's nightMaterials array:
engine.data.nightMaterials.push(...model.userData.nightMaterials);
```

`userData.nightMaterials` contains `{ material, intensity }` entries; set `material.emissiveIntensity = nightFactor * intensity`. All start at zero emission. Each relevant material also has `material.userData.nightIntensity` for traversal-based integration. Do not register both mechanisms twice. Neither quality level creates a light or requires a per-frame update.

`userData.solidFootprints` supplies closed local XZ rings for the supported deck/pavilion footprint. Transform them using the group's translation and yaw before registering water obstructions. They are collision approximations, not permission-to-access boundaries. The existing ground placement landmark masks may remain separate.

On replacement, remove the old group's night-material entries and dispose its mesh geometries/materials. Instances do not share materials or geometry, so there is no cross-model cache to preserve. Rebuilding on every camera frame is unnecessary; use the root's existing distance/quality policy to swap only at the chosen detail threshold. Let the new meshes cast shadows, and refresh the cached shadow map after a swap. The engine's existing double-sided SSAO normal pass should be retained for the fabric underside.

To recheck the original source, run `node validate.mjs /path/to/vancouver-twin` from this folder. This reads Three.js/TypeScript from that checkout but writes only the local `validation.json`. It does not initialize the scene or use a browser.

Original generator code is intended for the project's MIT code licence. Geographic references retain the project's [OpenStreetMap attribution and ODbL terms](https://www.openstreetmap.org/copyright); City sources retain their existing attribution. Reference photographs remain their owners' works and are not bundled or used as textures.
