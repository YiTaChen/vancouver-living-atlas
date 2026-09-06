# Time-driven sky effects

Original procedural sun/moon, stars, aurora curtains and meteors; no external assets, ephemeris service or texture downloads.

- Time panel → **Sky effects** contains independent Sun, Moon, Stars, Aurora and Meteors visibility, a ten-entry phase selector (Auto + eight phases + eclipse preview), Auto/Every-night aurora schedule, and four percentage sliders for star density, aurora intensity, aurora density and meteor frequency. All five existing UI languages are covered. Reset restores the effect settings, not clock time or session night history.
- The first encountered night after a page load is always a quarter moon and an aurora in default Auto mode. The same night continues across midnight. Later nights use one seeded, stable 1-in-3 draw, so repeated rendering or time scrubbing within the same night does not reroll. Explicit visibility/phase overrides take precedence.
- The clock now counts naturally elapsed simulated calendar days, including multi-day ticks. Manual hour changes do not invent elapsed days. Automatic lunar illumination starts at first quarter and advances over a 29.53059-simulated-day period. This and the display orbit are an illustrative scene cycle, not an exact Vancouver ephemeris. Lunar eclipse is a manual red-moon artistic preview rather than an automatically forecast event.
- Day/night movement follows the existing scene sun arc, with the moon on a separate opposing display arc. The standard Sky object's built-in solar disc is disabled to prevent duplicates and to make the Sun visibility switch effective. Hiding celestial objects does not disable daylight lighting.
- Night effects fade through twilight. Stars are faint and bounded at 3,200 points (slider zero hides all); curtains use a fixed six-iteration shader, with density controlling active layers. Aurora and meteor motion use real elapsed animation time, independent of the 300× scene clock. Meteor frequency zero disables events; the nonzero slider maps to approximately one event per 100–3 real seconds. An individual meteor is visible for 1.1 seconds and may occur outside the current view.
- Sky is camera-centred and depth-tested behind the city/mountains. No new shadow casters. Two draw calls maximum, fixed dome geometry and a fixed star buffer; no per-frame geometry construction or remote requests. The existing renderer disposal traversal owns all resources.

## Verification scope

351 automated tests and TypeScript pass. New regressions cover first-night guarantees (including loads after midnight), stable per-night events, a 3,000-night deterministic probability sample, clock midnight/multi-day transitions, range clamping and independent settings. Existing camera tests now supply the new sky/clock dependencies in their frame harness.

Local QA has three sky viewpoints plus a meteor capture at a fixed shader time. The fixed meteor time is restricted to the opt-in QA build: it renders the real meteor shader for reproducibility and is not a generated image or a production time behavior. Measurement records identify the fixed time and current manual settings. Public builds remove these QA controls.
