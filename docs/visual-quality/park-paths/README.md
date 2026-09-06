# park-paths measurements

Actual local application renders. Viewports: [(1280, 720)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| lees-trail | high | 44.4 | 33.7 | 34.2 | 66.3 | 0 | [Image](high-lees-trail.jpg) |
| lovers-walk | high | 44.9 | 33.7 | 34.3 | 66.7 | 0 | [Image](high-lovers-walk.jpg) |


Visual checks (not performance samples):

- [high / rawlings-trail-14p00h](high-rawlings-trail-14p00h.jpg)

## Grounded Stanley Park trails — September 6, 2026

The generic ribbon renderer placed paths 1.5 m above a separately sampled elevation surface. On the park's triangular ground mesh this produced visible air gaps, especially on slopes. Eligible Stanley Park trail footprints are now clipped into the actual terrain triangles, with each resulting face 0.045 m above its supporting face to avoid depth flicker. This preserves the mapped route while following the rendered ground, including terrain creases. The terrain itself is not reshaped.

577 path parts are eligible. The CPU audit inspected 35,417 supported triangle centroids; 28,894 (81.6%) have the exact nominal clearance within 5 mm, and the minimum measured clearance is about 44.9 mm. The remainder principally covers transitions to preserved geometry. Some approach gaps remain as large as about 3.95 m in this sample; this is not a claim that every Stanley Park path is fully grounded. Three path parts had no valid supported sample and retain their existing unsupported geometry rather than inventing ground.

Source-marked bridges, tunnels, steps, the existing coastal replacement paths and validated Causeway floor/connector sources are preserved. Nearby source vertices keep their existing elevation for 4 m, blending to the terrain over the next 20 m. This conservative transition avoids changing validated bridge and underpass connectivity; it can retain raised portions near those interfaces. A lower original floor never pulls the new surface into the terrain.

All paths remain in the existing merged mesh and the same walkable-floor index. The extra subdivisions are constructed once during loading, with spatial bins for ground and connector lookups; there are no new draw calls or per-frame draping queries. Nearby tree clearance is unchanged by this height fix.

Actual first-person checks covered Rawlings Trail, Lovers Walk and Lees Trail. The last two measured 44.9 and 44.4 FPS in High at a 1280×720 viewport (1600×900 render), with no >100 ms intervals in their eight-second stationary samples. These are diagnostic measurements, not a before/after FPS comparison or a long walking benchmark. Path edges meet the surrounding grass in the reviewed views, and the browser console had no errors/warnings.

Validation: TypeScript and all 346 regression tests passed. Two new tests sample interior points across a non-planar terrain crease, preserve path area and terrain bytes, and check retained connector/unsupported geometry. The canonical CPU fixture now uses the same park-path preparation as production; all 58 Causeway/bridge movement checks and geometry-clearance checks pass. The protected beach-coast data are unchanged. Normal Firebase build verification passes and excludes the QA panel.

Reproduce geometry checks with `node tools/audit-park-paths.mjs --output /tmp/park-path-audit.json` and `node tools/audit-causeway.mjs --output /tmp/causeway-audit.json`. The saved results are terrain-audit.json and causeway-audit.json. The local QA build adds rawlings-trail, lovers-walk and lees-trail to the existing fixed-view buttons.
