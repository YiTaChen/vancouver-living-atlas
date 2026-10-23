# Robson / Burrard visual pilot — round one

This is a spatially limited pilot, not approval to restyle all Vancouver. The
owner requested the pilot on 2026-10-23, with staged commits, pushes and merges
to main. Evaluate its appearance, cost and regressions before expanding it.

## Baseline and matched evidence

- Baseline application: `28b3bb55af6f266b0b44e7b5c06a1d6d61c960c1`.
- Use Node 24.22.1, the locked existing dependencies, instrumented static builds.
- Serve baseline and candidate separately with `tools/serve-visual-qa.mjs`.
- The gated `street-pilot-qa.ts` controls provide source-backed Robson drive,
  Burrard eye and intersection observer poses, clear 14:00 / 23:00, manual High,
  and a fixed 1280×720 drawing buffer. They exist only in local QA builds.
- Capture raw visible RAF intervals over 12 seconds, median/max submitted calls
  and triangles, actual camera/route/settings, memory counts, pedestrians and
  optional CPU/GPU recorder evidence. A fixed corner observer isolates street
  changes; the driving pose also evaluates the deliberately changed chase view.
- Wait for scene selection/asset preparation separately. Retain cold-start and
  first-use observations, but do not mix them into a warmed still-window result.
- Repeat paired baseline/candidate runs with build/tests and other 3D tabs
  stopped. No inferred GPU time from CPU subtraction; unsupported timer queries
  are unavailable, never zero. A desktop narrow viewport is not a phone test.

## Stages

1. Record the unchanged baseline and reproducible local QA protocol.
2. Integrate the local street art, material response, grounded frontage details,
   chase-camera framing and safely distributed sidewalk activity. Preserve the
   underlying measured footprints, collision surfaces and public interiors.
3. Apply measured, state-preserving performance improvements; compare both
   ground and overview behavior rather than minimizing one counter in isolation.
4. Run regression/build checks and actual browser acceptance, then publish the
   before/after images, timing results and limits with the final source revision.

## Preservation requirements

The pilot must retain ordinary movement/zoom/cockpit/collision; boat, floatplane,
helicopter, Tesla and rocket controls; damage/repair; source identity; public
interiors; bus/rail clocks, boarding/transfers and station routes; language/touch
controls; outside-pilot appearance. New storefront cues are representative art,
not assertions about real tenants or newly traversable building entrances.

Use shared geometry/materials, explicit local detail caps, cached selection and
bounded work. Preserve third-party notices. No new remote telemetry or external
asset service is part of this upgrade.

## Implementation

The appearance envelope follows the existing source arterial segments, with a
32 m core and an 85 m smooth outer fade. It is not a rectangular city-wide theme.

- `street-quality-profile.ts` shares the exact CPU/GLSL envelope and detail caps.
- `robson-burrard-details.ts` fits representative ground-floor displays, frames,
  plinths, canopy clearances and generic trade labels to unchanged footprint edges.
  It uses five shared box pools and one sign pool, up to 100 visible bays / 1,800
  boxes. These are appearance-only; picking, camera collision and travel
  occlusion ignore them. Existing interior/public-landmark geometry is excluded.
- `architecture-material.ts` strengthens the existing pane recesses and material
  separation within the pilot, reusing the current metre-based facade layout.
- `street-pilot-lighting.ts` redistributes cached atmosphere fill/reflection for
  near-ground pilot cameras, restoring the original light on exit and excluding
  public interiors, transit cabins and flight. These are scene-light scalars,
  so all geometry visible from an active pilot camera shares that light.
- Vehicle/crowd finishing reuses original geometry and animation. Aircraft carry
  two normalized surface-role bytes per vertex; paint, glass, rubber, metal and
  fabric retain distinct responses. The existing car shadow gets a local soft
  edge without another draw, map or pass. Mobile surfaces restore their original
  finish outside the pilot and fade back above 150–300 m world height.
- The local driving chase is lower and closer; zoom/cockpit/collision thresholds
  remain unchanged. Pedestrians recover only individually proven source sidewalk
  intervals and keep the existing actor/route/work caps.

Traffic simulation and night-light visitors still process every actor. Final
render-camera frustum packing uses cached exact poses after every camera owner
has updated, so turns and teleports cannot cull from an earlier camera. The
asphalt ground index alone opts into exact cached edge tolerances: 9,037,752 bytes
(8.62 MiB) on the full source road replay. Other floor/navigation indices allocate
no such cache. Its query microbenchmark is separate from end-to-end frame time.

Original asset provenance and archived offline fixtures remain immutable. The
new material-consumer review receipt accepts only the explicitly reviewed source
deltas before the original whole-file checks; mutated or duplicate deltas fail.
