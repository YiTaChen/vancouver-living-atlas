# English Bay / Kitsilano beach amenities — 2026-09-06

Original procedural meshes, informed by exterior photographs. No reference images, third-party models, logos or textures are shipped.

## References and placement

- [City of Vancouver: English Bay Beach](https://vancouver.ca/parks-recreation-culture/english-bay-beach.aspx): two sand volleyball courts. No basketball court is listed here, so none is added.
- [English Bay exterior photograph](https://stanleyparkvan.com/photos2/stanley-park-van-900477-english-bay-beach-volleyball.jpg): wooden net posts, blue/white net binding, weathered seating logs at the rear of the sand. Visually inspected in browser.
- [City of Vancouver: Kitsilano Beach](https://vancouver.ca/parks-recreation-culture/kitsilano-beach.aspx) and [Park Finder](https://covapp.vancouver.ca/parkfinder/ParkDetail.aspx?InParkId=112): basketball and beach sports facilities; two basketball courts.
- [City's May 2026 basketball court renewal](https://vancouver.ca/news-calendar/pb-unveils-kits-beach-basketball-courts-may-2026.aspx) and [official overhead photograph](https://vancouver.ca/images/cov/feature/basketball-courts-at-kits-beach-fb.jpg): two adjacent blue courts, light-blue end areas, orange keys, pale lines and four hoops. Visually inspected; the modeled color blocks simplify the curved paint design and omit branding.
- [City volleyball information](https://vancouver.ca/parks-recreation-culture/volleyball.aspx).
- OpenStreetMap footprints queried 2026-09-06 through Overpass within `(49.27,-123.158,49.291,-123.139)` for sports `basketball|beachvolleyball|volleyball`. `lib/city/beach-layout.json` records source IDs and four geographic corners. Basketball ways [83335594](https://www.openstreetmap.org/way/83335594) and [1286168737](https://www.openstreetmap.org/way/1286168737) retain their mapped positions and orientation. Six representative Kitsilano volleyball courts (three pairs) retain mapped footprints; the full set of seasonal nets is intentionally not reproduced.

English Bay's two court positions are illustrative placements within the app's existing reconciled sand polygon, not surveyed coordinates. Driftwood positions and shapes are also illustrative, sparse and deterministic. The actual distribution changes over time. These are static visual amenities, not playable sports simulations.

## Geometry and runtime

- Surface height samples the final **rendered ground and sand triangles**, after ground harmonization. No modification to the DEM, coastline, Stanley Park paths or protected approaches.
- Court patches subdivide to <=0.8 m; paint samples <=0.6 m, a small offset above the visible floor. Posts have embedded feet; segmented logs partly sink into sand and follow the local slope.
- Truncated weathered logs include taper, broken branches, longitudinal grooves and end-grain rings. They are checked against sand and expanded selected playing footprints.
- One merged vertex-colored mesh per beach, opaque material, no downloaded textures or per-frame geometry/terrain queries. Each beach uses a 1,400 m LOD cutoff with hysteresis. Standard frustum culling remains enabled.
- The procedural geometry is MIT. OSM-derived court coordinates remain subject to [ODbL](https://www.openstreetmap.org/copyright), consistent with the app's existing visible attribution; MIT does not relicense external geographic data.
