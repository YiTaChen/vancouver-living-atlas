# stage-2-roads measurements

Actual local application renders, 1920 × 1080 viewport, DPR [2]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Each sample is 8 seconds after 2.5 seconds of warm-up. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| downtown | high | 38.7 | 34.8 | 35.3 | 35.5 | 0 | [Image](high-downtown.jpg) |
| robson-drive | high | 37.2 | 34.6 | 35.2 | 35.4 | 0 | [Image](high-robson-drive.jpg) |
| water-street | high | 27.7 | 49.9 | 51.3 | 132.6 | 1 | [Image](high-water-street.jpg) |
| robson-drive | ultra | 22.9 | 51.2 | 52.1 | 134.1 | 1 | [Image](ultra-robson-drive.jpg) |
| water-street | ultra | 19.1 | 66.5 | 67.6 | 117.1 | 1 | [Image](ultra-water-street.jpg) |
