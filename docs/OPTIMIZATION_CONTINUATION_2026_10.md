# Gated integration continuation — 2026-10-02

This continues the [published checkpoint](PUBLICATION_2026_10.md). It is not a
claim that all roadmap stages or physical-device performance gates are complete.

## Implemented and locally validated

- Phase C: default-off, explicit QA integration of56 existing upper sills from
  two genuinely emitted Robson source frontages, with real fitted Blender LODs,
  shared atlas, selective invalidation, hysteresis and failure/disposal recovery.
  Full-source planning stays within the unchanged1,800-per-cell limit; default
  instance matrices/colors match the original26a2ae5 across19,312 instances.
  Costs and the synthetic20m CPU-fixture datum are documented in the
  [candidate report](../tools/assets/architecture-details/runtime-candidate/README.md).
- Phase D: default-off `qaPerennial` comparison uses the actual Blender-derived
  joined-edge perennial. Full real terrain/building/road/path initialization
  preserves500 plots,977 beds,1,954 plants,20,174 triangles,140 batches and one
  material. Source/bed/plant placement, nonplant vertices, navigation surfaces
  and flight collision volumes match. Manual resource disposal is CPU ownership
  evidence, not a GPU leak or context-loss measurement.
- A direct Vite import in a test expanded the inferred JavaScript lint graph.
  Moving unchanged bundle assertions into a typechecked subprocess tool fixed
  the coupling without disabling rules or editing legacy test registrations.
- Renderer acquisition failures now have typed WebGL-unavailable guidance in
  all ten locales. Ordinary asset errors and existing context-loss behavior stay
  distinct. Renderer settings and destruction behavior are unchanged.

The integrated checkout passed **625/625 tests**, TypeScript and the verified
Firebase production build. Candidate C/D code, controls and assets are excluded
from that production output. Lint still fails:189 diagnostics versus190 at the
original baseline, with no added normalized diagnostics. This is not a clean
lint claim. Independent reviews cleared the integration and browser-harness
changes within their tested scopes.

## Browser evidence and remaining gate

The initial hosted normal-Chrome smoke
[run36975023214](https://github.com/YiTaChen/vancouver-living-atlas/actions/runs/36975023214)
started Chrome154 with its sandbox intact but failed the WebGL2 capability
probe. No app capture or frame-time result was accepted. Standard validation
on the same commit succeeded. The dot cloud browser independently reported
disabled graphics when opening the deployed baseline; neither result proves
Firebase is unavailable to a graphics-capable user browser.

A single distinct Mesa software-renderer feasibility profile is prepared using
documented ANGLE OpenGL selection and Mesa llvmpipe. It keeps sandbox, blocklist
and GPU watchdog protections intact, removes unsafe Playwright defaults before
launch, and requires actual llvmpipe identification plus pixel readback before
app work. Its hosted result must be recorded after execution; preparation and
unit tests are not that result. Original failed-default evidence remains separate.

Both C/D candidates remain default-off. Their actual-city lighting/LOD visuals,
repeated browser teardown, GPU/frame-time and physical-device acceptance remain
pending. The historical citizen149.7ms p95 root cause is still unproven. The
other architectural/material batches and optional Phase F have not been
misrepresented as complete.

## Deployment boundary

The owner's latest main54cd62b Firebase workflow and credential-file ignore
entry were incorporated into the feature branch without modification. It uses
the production environment and deploys on main pushes after its checks. Main
was not written, merged into or deployed by this optimization continuation.
Any future merge to main therefore needs to be treated as a production release.
