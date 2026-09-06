# clock-1080 measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| clock-300x-2 | high | 53.3 | 33.3 | 34.0 | 35.4 | 0 | [Image](high-clock-300x-2.jpg) |
| clock-300x-3 | high | 52.4 | 33.4 | 34.6 | 35.4 | 0 | [Image](high-clock-300x-3.jpg) |
| clock-30x-1 | high | 55.9 | 32.6 | 33.7 | 49.9 | 0 | [Image](high-clock-30x-1.jpg) |
| clock-30x-4 | high | 53.3 | 33.3 | 34.6 | 35.4 | 0 | [Image](high-clock-30x-4.jpg) |
| clock-300x-2 | ultra | 35.8 | 34.5 | 35.2 | 49.1 | 0 | [Image](ultra-clock-300x-2.jpg) |
| clock-300x-3 | ultra | 35.9 | 34.3 | 35.0 | 52.0 | 0 | [Image](ultra-clock-300x-3.jpg) |
| clock-30x-1 | ultra | 35.8 | 34.4 | 35.1 | 35.4 | 0 | [Image](ultra-clock-30x-1.jpg) |
| clock-30x-4 | ultra | 35.7 | 34.3 | 35.0 | 50.1 | 0 | [Image](ultra-clock-30x-4.jpg) |


## Decision: default 300×

Actual running application, AMD Radeon Pro 560X through ANGLE Metal, visible 1920×1080 viewport. High renders 1788×1006 and Ultra 2560×1440. Same Canada Place camera, traffic enabled; each 30-second window starts at 18:00 with a running clock. Order 30/300/300/30 controls some warming/order effects, with six seconds settling on each quality. This compares the actual dusk-to-night workload: at 300× the window reaches about 20:30; at 30× it reaches 18:15. It is not a GPU-only timer or a guarantee for all routes/devices.

| Quality | Rate | Mean FPS (two windows) | Worst p95 ms | Max ms | >100 ms |
| --- | --- | ---: | ---: | ---: | ---: |
| high | 30× | 54.61 | 33.3 | 49.9 | 0 |
| high | 300× | 52.84 | 33.4 | 35.4 | 0 |
| ultra | 30× | 35.73 | 34.4 | 50.1 | 0 |
| ultra | 300× | 35.88 | 34.5 | 52.0 | 0 |

The small High difference and essentially unchanged Ultra result support making 300× the default. All eight windows remained visible and had no >100 ms frame intervals. The preliminary [1280×720 comparison](../buses-clock/README.md) is retained separately and is not described as a 1080p test.

Clock advancement is one multiplication per tick; lighting updates are limited to 10 Hz and solar shadow invalidation to at most once every 750 ms. The rate changes the value, not a loop of 300 simulation steps. Faster shadow refresh can still add work, and different night scenes may have different costs. Navigation, ordinary traffic, buses, rails and water use their own real-time updates. No additional throttle or reduction in image quality was introduced for this comparison.

Default scene time now flows at 300×, with a 4 minute 48 second day. Existing 1/10/30/60/120/300× choices, manual time, fixed time and hidden-tab pause remain. Five-language default badges and day-length hints derive from DEFAULT_CLOCK, so remain consistent. Clock regression tests cover default frame-rate independence, pause/resume, midnight, visibility, invalid input and real engine lighting behavior.
