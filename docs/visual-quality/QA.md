# Local visual upgrade QA — 2026-09-05

The feature is on the local `feature/ultra-landmarks` branch. No remote push or deployment was performed for this upgrade.

## Checks

- `npm run check`: passed.
- `npm test`: 75 tests passed, including existing walking, driving, boating, terrain, placement, clock, rail and localization coverage.
- `npm run build:firebase`: passed. Static English entrypoint, all five languages and geographic assets verified. This command builds locally; it does not deploy.
- No development `__atlas` hook is present in the production JavaScript.
- Targeted lint for new rendering modules and the new visual-quality test: passed. Full-repository lint still reports existing issues in legacy React components and tests; it is not a passing release check.
- Independent review covered pool restoration, lazy geometry allocation, shared facade foundations, material/shadow updates, collision footprints and resource disposal. Review findings were fixed before final validation.

## Actual browser validation

The final static production output was served locally and inspected in the visible browser. English remains the default. The graphics selector and its description were checked in English, French, Spanish, Traditional Chinese and Simplified Chinese. Ultra changed the physical canvas resolution; High and Balanced restored their lower budgets. The panel fits the narrow browser viewport.

Gastown's on-screen forward control visibly advanced both walking and driving. Switching Walk → Drive → Walk retained the street location without reopening placement. Movement was repeated after enabling Ultra. Daylight geometry, close trees, individual landmarks and Science World's night lighting were inspected through real WebGL captures. The automated benchmark finished with no browser errors.

## Measured GPU performance

Chrome WebGL 2 / ANGLE Metal on AMD Radeon Pro 560X. Viewport 1920 × 1080, device scale factor 1, fixed 14:00 clock, labels and auto-rotation off. Each setting warmed up for 2.3 seconds; four in-app FPS readings were collected 850 ms apart. Values below are their means, not a hardware-independent promise or a frame-time percentile benchmark.

| Fixed view | Balanced FPS | High FPS | Ultra FPS |
| --- | ---: | ---: | ---: |
| Science World | 60.0 | 53.5 | 32.5 |
| Canada Place | 60.0 | 49.5 | 34.8 |
| Marine Building | 57.8 | 44.0 | 26.5 |
| Stanley Park overview | 60.0 | 51.3 | 34.5 |

Balanced and High rendered at 1788 × 1006; Ultra rendered at 2560 × 1440. The Marine Building Ultra view activated 643 nearby trees. The Stanley Park overview correctly used the inexpensive distant forest at every quality setting. Cached facade cells remained bounded and switching to Balanced restored all distant tree instances.

The original measurements, camera poses and actual-scene PNGs are retained in the sibling `outputs/visual-upgrade` delivery directory. Benchmark orchestration and capture scripts remain in `work/ultra-qa`. Source geometry, image prompts and geometry tests are versioned here so the asset generation is inspectable.

## Scope of fidelity

The six landmarks follow documented silhouettes, proportions and structural features. Models are original parametric interpretations, not photogrammetry. Generic facades and tree species details are representative. The generated images provide foliage and bark materials on actual 3D geometry; they do not replace the scene with a generated city image. See the adjacent architectural reference and image-prompt documents for provenance.
