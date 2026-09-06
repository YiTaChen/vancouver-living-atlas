# stage-9-final measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| bc-entry | high | 48.6 | 33.6 | 34.5 | 117.3 | 1 | [Image](high-bc-entry.jpg) |
| convention-entry | high | 36.8 | 34.3 | 35.1 | 49.8 | 0 | [Image](high-convention-entry.jpg) |
| harbour-entry | high | 36.2 | 34.5 | 35.3 | 51.6 | 0 | [Image](high-harbour-entry.jpg) |
| house-balconies | high | 28.9 | 49.5 | 50.3 | 51.8 | 0 | [Image](high-house-balconies.jpg) |
| bc-entry | ultra | 29.5 | 48.8 | 50.7 | 51.8 | 0 | [Image](ultra-bc-entry.jpg) |
| convention-entry | ultra | 24.5 | 50.9 | 51.8 | 151.0 | 1 | [Image](ultra-convention-entry.jpg) |
| harbour-entry | ultra | 21.4 | 51.8 | 65.4 | 65.6 | 0 | [Image](ultra-harbour-entry.jpg) |
| house-balconies | ultra | 19.0 | 66.1 | 66.7 | 68.3 | 0 | [Image](ultra-house-balconies.jpg) |

## Cold transitions and continuous travel

Observer starts before the cold transition, with no discarded warm-up. Travel uses actual forward input after 2.5 seconds of setup. FPS below is the measured frame count divided by elapsed wall time; simulation time is recorded separately.

| Case | Quality | Wall s | FPS | p95 ms | Max ms | >100 ms | Result | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| robson-drive-release-travel-60s-14p00h | high | 60.0 | 34.5 | 31.7 | 131.6 | 1 | 1231.7 m / 59.9 simulated s | [Image](high-robson-drive-release-travel-60s-14p00h.jpg) |
| bc-entry-cold-ultra-8s-14p00h | ultra | 8.0 | 28.4 | 48.1 | 142.9 | 2 | 2 Ultra arrivals; apply 96.5 ms | [Image](ultra-bc-entry-cold-ultra-8s-14p00h.jpg) |
