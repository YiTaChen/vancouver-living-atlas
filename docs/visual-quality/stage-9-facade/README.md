# stage-9-facade measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |

## Cold transitions and continuous travel

Observer starts before the cold transition, with no discarded warm-up. Travel uses actual forward input after 2.5 seconds of setup. FPS below is the measured frame count divided by elapsed wall time; simulation time is recorded separately.

| Case | Quality | Wall s | FPS | p95 ms | Max ms | >100 ms | Result | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| robson-drive-release-travel-60s-14p00h | high | 60.0 | 36.0 | 30.6 | 142.0 | 3 | 1228.9 m / 59.8 simulated s | [Image](high-robson-drive-release-travel-60s-14p00h.jpg) |
