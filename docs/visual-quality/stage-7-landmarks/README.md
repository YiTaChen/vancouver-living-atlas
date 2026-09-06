# stage-7-landmarks measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| canada-gallery | high | 34.5 | 34.9 | 35.4 | 99.2 | 0 | [Image](high-canada-gallery.jpg) |
| marine-entry | high | 31.7 | 34.8 | 35.3 | 50.0 | 0 | [Image](high-marine-entry.jpg) |
| open-harbour-boat-long | high | 60.0 | 17.9 | 18.4 | 18.8 | 0 | [Image](high-open-harbour-boat-long.jpg) |
| open-harbour-boat | high | 60.0 | 17.6 | 17.9 | 33.5 | 0 | [Image](high-open-harbour-boat.jpg) |
| science-entry | high | 53.1 | 33.2 | 33.9 | 34.6 | 0 | [Image](high-science-entry.jpg) |
| canada-gallery | ultra | 23.5 | 51.3 | 52.0 | 52.1 | 0 | [Image](ultra-canada-gallery.jpg) |
| marine-entry | ultra | 19.9 | 65.3 | 65.9 | 66.8 | 0 | [Image](ultra-marine-entry.jpg) |
| science-entry | ultra | 31.2 | 34.9 | 49.3 | 49.5 | 0 | [Image](ultra-science-entry.jpg) |

Visual checks (not performance samples):

- [high / canada-gallery-14p00h](high-canada-gallery-14p00h.jpg)
- [high / marine-entry-14p00h](high-marine-entry-14p00h.jpg)
- [high / science-entry-14p00h](high-science-entry-14p00h.jpg)
- [ultra / canada-gallery-23p00h](ultra-canada-gallery-23p00h.jpg)
- [ultra / canada-pier-14p00h](ultra-canada-pier-14p00h.jpg)
- [ultra / canada-sails-14p00h](ultra-canada-sails-14p00h.jpg)
- [ultra / canada-sails-19p00h](ultra-canada-sails-19p00h.jpg)
- [ultra / marine-entry-23p00h](ultra-marine-entry-23p00h.jpg)
- [ultra / science-entry-23p00h](ultra-science-entry-23p00h.jpg)
