# buses-clock measurements

Actual local application renders. Viewports: [(1280, 720), (1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| clock-300x-2 | high | 58.6 | 18.5 | 33.5 | 35.3 | 0 | [Image](high-clock-300x-2.jpg) |
| clock-300x-3 | high | 58.4 | 18.5 | 33.5 | 34.8 | 0 | [Image](high-clock-300x-3.jpg) |
| clock-30x-1 | high | 59.2 | 18.0 | 32.6 | 83.3 | 0 | [Image](high-clock-30x-1.jpg) |
| clock-30x-4 | high | 59.0 | 17.8 | 33.3 | 50.9 | 0 | [Image](high-clock-30x-4.jpg) |
| clock-300x-2 | ultra | 35.2 | 34.0 | 34.3 | 50.2 | 0 | [Image](ultra-clock-300x-2.jpg) |
| clock-300x-3 | ultra | 35.1 | 34.1 | 34.3 | 50.0 | 0 | [Image](ultra-clock-300x-3.jpg) |
| clock-30x-1 | ultra | 35.4 | 34.0 | 34.2 | 49.0 | 0 | [Image](ultra-clock-30x-1.jpg) |
| clock-30x-4 | ultra | 35.2 | 34.0 | 34.3 | 50.1 | 0 | [Image](ultra-clock-30x-4.jpg) |


Visual checks (not performance samples):

- [high / buses-14p00h](high-buses-14p00h.jpg)
- [ultra / canada-sails-14p00h](ultra-canada-sails-14p00h.jpg)
