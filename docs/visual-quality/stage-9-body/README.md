# stage-9-body measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| bc-entry-body-cells | high | 53.1 | 33.3 | 33.8 | 34.3 | 0 | [Image](high-bc-entry-body-cells.jpg) |
| bc-entry-body-whole | high | 51.0 | 33.7 | 34.3 | 82.6 | 0 | [Image](high-bc-entry-body-whole.jpg) |
| convention-entry-body-cells | high | 39.1 | 34.9 | 35.2 | 35.4 | 0 | [Image](high-convention-entry-body-cells.jpg) |
| convention-entry-body-whole | high | 39.4 | 34.3 | 35.2 | 116.8 | 2 | [Image](high-convention-entry-body-whole.jpg) |
| harbour-entry-body-cells | high | 38.0 | 35.1 | 35.4 | 35.5 | 0 | [Image](high-harbour-entry-body-cells.jpg) |
| harbour-entry-body-whole | high | 37.2 | 35.0 | 35.3 | 66.3 | 0 | [Image](high-harbour-entry-body-whole.jpg) |
| house-balconies-body-cells | high | 30.8 | 34.7 | 35.4 | 50.1 | 0 | [Image](high-house-balconies-body-cells.jpg) |
| house-balconies-body-whole | high | 30.2 | 35.3 | 48.4 | 50.9 | 0 | [Image](high-house-balconies-body-whole.jpg) |
| bc-entry-body-cells | ultra | 30.8 | 35.0 | 35.4 | 50.1 | 0 | [Image](ultra-bc-entry-body-cells.jpg) |
| bc-entry-body-whole | ultra | 30.6 | 35.2 | 49.2 | 50.8 | 0 | [Image](ultra-bc-entry-body-whole.jpg) |
| convention-entry-body-cells | ultra | 24.0 | 51.0 | 51.3 | 52.0 | 0 | [Image](ultra-convention-entry-body-cells.jpg) |
| convention-entry-body-whole | ultra | 24.6 | 51.0 | 51.8 | 51.9 | 0 | [Image](ultra-convention-entry-body-whole.jpg) |
| harbour-entry-body-cells | ultra | 23.0 | 51.3 | 51.9 | 51.9 | 0 | [Image](ultra-harbour-entry-body-cells.jpg) |
| harbour-entry-body-whole | ultra | 22.8 | 51.2 | 51.8 | 52.0 | 0 | [Image](ultra-harbour-entry-body-whole.jpg) |
| house-balconies-body-cells | ultra | 19.9 | 51.7 | 65.3 | 66.0 | 0 | [Image](ultra-house-balconies-body-cells.jpg) |
| house-balconies-body-whole | ultra | 19.6 | 64.9 | 66.4 | 66.9 | 0 | [Image](ultra-house-balconies-body-whole.jpg) |


Visual checks (not performance samples):

- [ultra / convention-entry-14p00h-ao-blur4-body-whole](ultra-convention-entry-14p00h-ao-blur4-body-whole.jpg)
- [ultra / convention-entry-14p00h-ao-combined-body-whole](ultra-convention-entry-14p00h-ao-combined-body-whole.jpg)
- [ultra / convention-entry-14p00h-ao-direction-body-whole](ultra-convention-entry-14p00h-ao-direction-body-whole.jpg)
- [ultra / convention-entry-14p00h-ao-off-body-whole](ultra-convention-entry-14p00h-ao-off-body-whole.jpg)
- [ultra / convention-entry-14p00h-ao-original-body-whole](ultra-convention-entry-14p00h-ao-original-body-whole.jpg)
- [ultra / science-entry-14p00h-ao-blur4-body-whole](ultra-science-entry-14p00h-ao-blur4-body-whole.jpg)
- [ultra / science-entry-14p00h-ao-original-body-whole](ultra-science-entry-14p00h-ao-original-body-whole.jpg)

## Decision

The 500 m indexed-body candidate is **not retained**. Eight paired fixed views show only small, mixed average-FPS changes: Convention Centre Ultra is 24.0 with cells versus 24.6 with the whole mesh. Cells reduce submitted triangles but increase draw calls and add 2,096,340 index bytes. The same-engine switch isolates rendering; both representations were allocated, so it does not establish startup or memory savings. The normal whole-body renderer remains in production. The independent visible-roof picking correction is retained.

At fixed Convention Centre and Science World Ultra views, the 16-tap centred 4×4 AO blur removes the fine repeating grid visible on the pavement while retaining contact shading. Only this blur candidate is selected; kernel, radius and random-direction texture remain unchanged. AO-off and alternate-direction images are diagnostic comparisons, not public rendering modes. Captures report actual engine quality (Ultra), irrespective of the React settings panel selection.
