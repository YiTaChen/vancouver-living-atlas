# Lions Gate Bridge pedestrian railing correction

Reference: user-supplied Google Street View exterior screenshot, 2026-09-06 (green dense vertical pickets, continuous top/bottom members, heavier posts and road-side concrete barrier). The image itself is not redistributed. Dimensions/color are display approximations, not an engineering survey.

The previous generic path railing had one horizontal bar and posts 3 m apart. Each segment depended on a shoulder-triangle hit at both endpoints; if an edge lookup failed the whole segment was omitted. It also generated rails on both sides of the bridge footway, duplicating the inner road barrier.

`buildLionsRailings` now consumes the actual mitered, elevation-baked walkway edge sections of OSM sources 70954668 and 70954672. It chooses the edge away from the road, emits continuous top/bottom beams, 0.16 m picket spacing and 2.4 m main-post spacing. No triangle-edge resampling, terrain change, road-width change or navigation datum change. The existing two west tower openings remain, trimmed exactly at bridge stations 184–190 m and 656–662 m; the entrance fan's road-barrier gap also remains.

Road-side barriers retain their existing centerline, gain a narrow tapered concrete profile and a concrete color. The base remains outside the asphalt. Original bridge towers, hangers and cables are retained.

## Geometric verification

`node tools/audit-lions-railings.mjs --output /tmp/lions-railings.json` uses the canonical full scene CPU fixture. It verifies continuous coverage and zero endpoint mismatch outside the two intentional tower openings. East coverage is 1,525.804 m; west 1,520.715 m plus two approximately 6 m openings. The full OSM walk sources extend beyond the central suspension span.

New outer railings total 268,284 triangles in five spatially culled batches, not one draw per bar. There are no per-frame geometry generation or ground queries. The fine pickets can still alias at long distances; they are real opaque geometry rather than a transparent fence texture.

TypeScript and 348 tests pass. All 58 canonical Causeway movement/geometry checks pass; `causeway-audit.json` preserves that result. The new regression checks continuous sloping/mitered rails and exact tower openings without modifying input geometry. Railing collision behavior is unchanged.
