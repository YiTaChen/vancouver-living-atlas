# stage-10-final measurements

Actual local application renders. Viewports: [(1920, 1080)]. JPEG review images are resized copies of the saved canvas PNGs. See measurements.json for device, source revision, physical render size, camera poses and movement. Standard samples are 8 seconds after 2.5 seconds of warm-up; `-long` samples are 60 seconds with a one-second travel trace. These are short diagnostic samples, not a guarantee of long-session performance.

| Case | Quality | FPS | p95 ms | p99 ms | Max ms | >100 ms | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| robson-drive | ultra | 19.2 | 66.7 | 84.9 | 85.3 | 0 | [Image](ultra-robson-drive.jpg) |

## Cold transitions and continuous travel

Observer starts before the cold transition, with no discarded warm-up. Travel uses actual forward input after 2.5 seconds of setup. FPS below is the measured frame count divided by elapsed wall time; simulation time is recorded separately.

| Case | Quality | Wall s | FPS | p95 ms | Max ms | >100 ms | Result | Capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| open-harbour-boat-release-travel-60s-19p00h | high | 60.0 | 59.6 | 19.0 | 28.7 | 0 | 372.7 m / 60.0 simulated s | [Image](high-open-harbour-boat-release-travel-60s-19p00h.jpg) |
| robson-drive-release-travel-60s-14p00h | high | 60.0 | 33.5 | 34.7 | 135.3 | 1 | 1231.6 m / 59.9 simulated s | [Image](high-robson-drive-release-travel-60s-14p00h.jpg) |
| robson-walk-release-travel-60s-14p00h | high | 60.0 | 32.8 | 34.9 | 49.3 | 0 | 240.1 m / 60.0 simulated s | [Image](high-robson-walk-release-travel-60s-14p00h.jpg) |
| canada-sails-cold-ultra-8s-23p00h | ultra | 8.0 | 32.8 | 42.2 | 531.8 | 3 | 1 Ultra arrivals; apply 71.4 ms | [Image](ultra-canada-sails-cold-ultra-8s-23p00h.jpg) |
| robson-drive-release-travel-60s-14p00h | ultra | 60.0 | 20.4 | 59.1 | 140.4 | 3 | 1193.6 m / 58.1 simulated s | [Image](ultra-robson-drive-release-travel-60s-14p00h.jpg) |

Visual checks (not performance samples):

- [high / causeway-south-release-14h](high-causeway-south-release-14h.jpg)
- [high / causeway-south-release-19h](high-causeway-south-release-19h.jpg)
- [high / causeway-south-release-23h](high-causeway-south-release-23h.jpg)
- [high / second-beach-release-14h](high-second-beach-release-14h.jpg)
- [high / second-beach-release-19h](high-second-beach-release-19h.jpg)
- [high / second-beach-release-23h](high-second-beach-release-23h.jpg)
- [high / third-beach-release-14h](high-third-beach-release-14h.jpg)
- [high / third-beach-release-19h](high-third-beach-release-19h.jpg)
- [high / third-beach-release-23h](high-third-beach-release-23h.jpg)
- [ultra / bc-envelope-release-14h](ultra-bc-envelope-release-14h.jpg)
- [ultra / bc-envelope-release-19h](ultra-bc-envelope-release-19h.jpg)
- [ultra / bc-envelope-release-23h](ultra-bc-envelope-release-23h.jpg)
- [ultra / canada-sails-release-14h](ultra-canada-sails-release-14h.jpg)
- [ultra / canada-sails-release-19h](ultra-canada-sails-release-19h.jpg)
- [ultra / canada-sails-release-23h](ultra-canada-sails-release-23h.jpg)
- [ultra / convention-roof-release-14h](ultra-convention-roof-release-14h.jpg)
- [ultra / convention-roof-release-19h](ultra-convention-roof-release-19h.jpg)
- [ultra / convention-roof-release-23h](ultra-convention-roof-release-23h.jpg)
- [ultra / harbour-tower-release-14h](ultra-harbour-tower-release-14h.jpg)
- [ultra / harbour-tower-release-19h](ultra-harbour-tower-release-19h.jpg)
- [ultra / harbour-tower-release-23h](ultra-harbour-tower-release-23h.jpg)
- [ultra / house-balconies-release-14h](ultra-house-balconies-release-14h.jpg)
- [ultra / house-balconies-release-19h](ultra-house-balconies-release-19h.jpg)
- [ultra / house-balconies-release-23h](ultra-house-balconies-release-23h.jpg)
- [ultra / marine-entry-release-14h](ultra-marine-entry-release-14h.jpg)
- [ultra / marine-entry-release-19h](ultra-marine-entry-release-19h.jpg)
- [ultra / marine-entry-release-23h](ultra-marine-entry-release-23h.jpg)
- [ultra / science-entry-release-14h](ultra-science-entry-release-14h.jpg)
- [ultra / science-entry-release-19h](ultra-science-entry-release-19h.jpg)
- [ultra / science-entry-release-23h](ultra-science-entry-release-23h.jpg)

## Release acceptance — September 6, 2026

The accepted source includes buses (`3b265e8`) and the measured 300× default (`970e786`), plus the opt-in release capture controls. Captures use a visible 1920×1080 viewport on ANGLE Metal / AMD Radeon Pro 560X. High renders 1788×1006 and Ultra 2560×1440. These are actual scene captures, not generated promotional images.

- Reviewed 30 captures: seven refined landmarks in Ultra and the Stanley Causeway entrance, Second Beach and Third Beach in High, each at 14:00, 19:00 and 23:00. No missing landmark load, worker error or black render was observed. Night glazing and Science World glow appear; surrounding buildings naturally occlude part of the Convention Centre view.
- High continuous travel: Robson walk 240.1 m / 60.0 simulated seconds; Robson drive 1,231.6 m / 59.9 seconds; harbour boat 372.7 m / 60.0 seconds. Ultra Robson drive: 1,193.6 m / 58.1 simulated seconds in 60 wall seconds. All four retained their mode and forward input with zero collision frames and no two-second motion stall. The simulation's existing frame-delta cap explains reduced Ultra distance; it is not a faster/slower route claim.
- High walk/drive/boat averaged 32.8 / 33.5 / 59.6 FPS. High driving had one 135.3 ms frame; walking and boating had no >100 ms gaps. Ultra driving averaged 20.4 FPS, p95 59.1 ms, max 140.4 ms and three >100 ms gaps. Ultra is usable for detail inspection but remains visibly less fluid on this GPU; High stays the default.
- Nighttime cold High→Ultra at Canada Place succeeded, with Canada Place first submitted after about 2.25 seconds. The medium model remained available while detail prepared. The 8-second window includes all transition cost, averaging about 32.8 FPS, with a 531.8 ms maximum and three >100 ms gaps. This residual first-use rendering/driver pause is a known limitation; stage 9 did not eliminate all stalls. Off-camera model attachment is not counted as proof of visible pixels.
- Fresh engine startup reached interactive eligibility in 17.52 seconds, including initial scene compilation and compositor warm-up. This is not an empty browser/driver-cache test, and startup varies between runs. The raw timings and source fingerprint are retained.
- TypeScript, all 344 regression tests and the normal Firebase build passed. The emitted landmark worker initializes without Window/DOM; production verification rejects the local QA marker and checks English HTML, all five languages and public assets. No per-frame geometry factory or paid external service was added.

Reproduction: build with `VANCOUVER_VISUAL_QA=1 VANCOUVER_STATIC_EXPORT=1 npm run build`, serve with `node tools/serve-visual-qa.mjs stage-10-final`, and set the existing tab viewport to 1920×1080. On a fresh High page, select canada-sails → 23:00 → Measure cold Ultra 8s. Run release visual suite for all 30 stills. Select the listed travel case and quality, then Measure release travel 60s. Finally rebuild with `npm run build:firebase`; never publish the QA build.

Public normal-build checks: English, French, Spanish, Traditional Chinese and Simplified Chinese selectors work. The Time panel shows 300× · Default and 4.8 real minutes per day; Set time is above Hide time. Hide time removes the numeric toolbar time, fixing and Afternoon seek produce 15:00, and running time can be restored. The local QA panel is absent and the browser console has no error/warning entries.

Published to [the existing Firebase Demo](https://vancouver-living-atlas-yita.web.app/) from application revision `8527b39`. All 58 deployed static files were fetched and matched the verified local build byte-for-byte by SHA-256; see deployment.json. The live browser loaded the full 3D scene, showed 300× · Default with time flowing, and recorded no console errors/warnings.
