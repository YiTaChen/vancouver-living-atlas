# sky-effects-final measurements

Actual local application renders. Viewports: [(1280, 720)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| sky-aurora | high | 60.1 | 17.5 | 17.7 | 17.8 | 0 | [Image](high-sky-aurora.jpg) |
| sky-night | high | 58.5 | 17.6 | 17.7 | 166.2 | 1 | [Image](high-sky-night.jpg) |


Visual checks (not performance samples):

- [high / sky-day-9p00h-auto](high-sky-day-9p00h-auto.jpg)
- [high / sky-meteor-23p00h-auto](high-sky-meteor-23p00h-auto.jpg)
- [high / sky-night-23p00h-eclipse](high-sky-night-23p00h-eclipse.jpg)
- [high / sky-night-23p00h-full](high-sky-night-23p00h-full.jpg)

## Acceptance and limits

Actual WebGL captures cover the solar disc, automatic first-night half moon, manually selected full moon and red eclipse preview, faint stars, animated northern aurora and the real meteor shader at a fixed QA-only time. The Moon/Stars/Aurora switches were switched off together and the sky cleared; the Sun switch removed its disc while retaining daylight. Star/aurora sliders accepted their endpoints, and meteor frequency zero was verified in the controls. Reset restored defaults. Five-language label parity and all 351 tests passed; final targeted clock/sky/camera/i18n checks (25 tests) and TypeScript also passed.

The two stationary High samples measured 58.5 and 60.1 FPS, p95 <=17.6 ms at a 1280×720 viewport / 1600×900 physical render. The half-moon sample includes one 166.2 ms frame; the aurora sample has none above 100 ms. These are not isolated before/after or continuous-travel measurements, and do not establish zero-stutter behavior. Captures from successive QA builds record their own source fingerprints; the final refinements brighten the Sun and correct measurement time metadata, without changing the lunar/eclipse or meteor rendering in those earlier captures.

[Implementation, night-cycle semantics and controls](NOTES.md). To inspect these effects in normal use, point the camera toward the sky; the effects are located in the 3D sky and are not fixed HUD icons. Low views and looking up while walking make them easier to see.
