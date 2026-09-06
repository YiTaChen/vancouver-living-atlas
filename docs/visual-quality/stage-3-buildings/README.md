# stage-3-buildings measurements

Actual local application renders, 1920 × 1080 viewport, DPR [2]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Each sample is 8 seconds after 2.5 seconds of warm-up. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| downtown | high | 39.9 | 34.4 | 35.2 | 35.3 | 0 | [Image](high-downtown.jpg) |
| robson-drive | high | 36.4 | 34.8 | 35.3 | 35.4 | 0 | [Image](high-robson-drive.jpg) |
| water-street | high | 28.4 | 50.0 | 50.4 | 85.1 | 0 | [Image](high-water-street.jpg) |
| robson-drive | ultra | 22.5 | 51.5 | 66.3 | 148.3 | 1 | [Image](ultra-robson-drive.jpg) |
| water-street | ultra | 19.1 | 65.9 | 66.8 | 66.8 | 0 | [Image](ultra-water-street.jpg) |
