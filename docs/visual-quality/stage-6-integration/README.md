# stage-6-integration measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| causeway-underpass | high | 46.7 | 33.9 | 34.4 | 34.6 | 0 | [Image](high-causeway-underpass.jpg) |
| coal-harbour-boat-long | high | 59.8 | 18.3 | 18.6 | 82.4 | 0 | [Image](high-coal-harbour-boat-long.jpg) |
| north-coast-trail | high | 54.3 | 33.0 | 33.6 | 34.3 | 0 | [Image](high-north-coast-trail.jpg) |
| northwest-coast-trail | high | 51.0 | 33.7 | 34.1 | 34.5 | 0 | [Image](high-northwest-coast-trail.jpg) |
| robson-drive-long | high | 35.2 | 35.0 | 35.3 | 99.8 | 0 | [Image](high-robson-drive-long.jpg) |
| robson-walk-long | high | 34.0 | 35.0 | 35.3 | 83.4 | 0 | [Image](high-robson-walk-long.jpg) |
| north-coast-road | ultra | 21.5 | 51.4 | 51.9 | 65.3 | 0 | [Image](ultra-north-coast-road.jpg) |

Visual checks (not performance samples):

- [ultra / north-coast-road-23p00h](ultra-north-coast-road-23p00h.jpg)
