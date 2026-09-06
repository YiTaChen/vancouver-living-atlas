# stage-8-landmarks measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| bc-entry | high | 50.9 | 33.4 | 34.2 | 100.4 | 1 | [Image](high-bc-entry.jpg) |
| convention-entry | high | 38.9 | 33.8 | 34.3 | 35.3 | 0 | [Image](high-convention-entry.jpg) |
| harbour-entry | high | 37.5 | 34.4 | 35.1 | 35.4 | 0 | [Image](high-harbour-entry.jpg) |
| house-balconies | high | 30.4 | 34.4 | 49.7 | 50.1 | 0 | [Image](high-house-balconies.jpg) |
| bc-entry | ultra | 30.5 | 35.1 | 49.9 | 50.0 | 0 | [Image](ultra-bc-entry.jpg) |
| convention-entry | ultra | 24.6 | 50.9 | 66.6 | 150.2 | 1 | [Image](ultra-convention-entry.jpg) |
| harbour-entry | ultra | 23.0 | 51.3 | 51.6 | 52.0 | 0 | [Image](ultra-harbour-entry.jpg) |
| house-balconies | ultra | 19.7 | 65.0 | 66.5 | 66.6 | 0 | [Image](ultra-house-balconies.jpg) |

## Cold transitions and continuous travel

Observer starts before the cold transition, with no discarded warm-up. Travel uses actual forward input after 2.5 seconds of setup. FPS below is the measured frame count divided by elapsed wall time; simulation time is recorded separately.

| Case | Quality | Wall s | FPS | p95 ms | Max ms | >100 ms | Result | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| bc-entry-cold-ultra-8s-14p00h | ultra | 8.0 | 24.3 | 34.8 | 1669.9 | 1 | 2 Ultra arrivals; apply 83.7 ms | [Image](ultra-bc-entry-cold-ultra-8s-14p00h.jpg) |

Visual checks (not performance samples):

- [high / bc-envelope-14p00h](high-bc-envelope-14p00h.jpg)
- [high / convention-roof-14p00h](high-convention-roof-14p00h.jpg)
- [high / harbour-tower-14p00h](high-harbour-tower-14p00h.jpg)
- [ultra / bc-envelope-14p00h](ultra-bc-envelope-14p00h.jpg)
- [ultra / bc-envelope-19p00h](ultra-bc-envelope-19p00h.jpg)
- [ultra / bc-envelope-23p00h](ultra-bc-envelope-23p00h.jpg)
- [ultra / convention-entry-23p00h](ultra-convention-entry-23p00h.jpg)
- [ultra / harbour-entry-23p00h](ultra-harbour-entry-23p00h.jpg)
- [ultra / house-balconies-23p00h](ultra-house-balconies-23p00h.jpg)
- [ultra / house-podium-14p00h](ultra-house-podium-14p00h.jpg)
