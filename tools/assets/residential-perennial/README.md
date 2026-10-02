# Bounded Blender perennial sample and Phase D assessment

Status: **QA-only opt-in integrated and CPU parity tested; browser/render-device performance gates pending**.
This is a representative first vegetation batch, not completion of Phase D or a whole-city vegetation replacement.

The production build keeps the legacy garden geometry. The guarded candidate below is available only for explicit QA comparison; matched browser/device gates are required before any production rollout.

## QA-only opt-in integration

The shipping production branch still uses the original perennial geometry. The Blender candidate is available only when `VANCOUVER_VISUAL_QA=1` is compiled, and only with explicit URL `?qaPerennial=blender`. A QA build with no parameter keeps the legacy geometry. `?qaPerennial=baseline` keeps legacy geometry and records matching diagnostics. Unknown, differently cased or repeated values are rejected. Reload to change the selected variant; there is no hot-swap lifecycle, global asset cache, extra fetch, listener or timer.

On an opted-in QA build, `e.data.residentialPerennialQA` records source IDs, actual accepted bed positions, plant centers/seeds and batch vertex slots. Existing `e.data.residentialGround` remains unchanged. Evidence is local to the engine build and replaced/cleared on a subsequent build; it contains plain data, not GPU resources.

The compile guard surrounds all candidate use. A bundle test verifies the candidate module/data contributes zero production bytes, and the production verifier rejects the QA marker, query control or evidence key if present. The previous standalone `integration.patch` is superseded by the guarded implementation and removed to prevent accidental production rollout.

`qa-parity.json` comes from `tools/audit-residential-perennial.mjs`, using canonical measured terrain, actual roads/paths/harmonization, actual building-body profile construction and the unchanged runtime garden selector. **Both variants accepted the same 500 source plots, 977 beds and 1,954 plants**, in the same order and at the same centers. Both have 20,174 total garden triangles, 140 batches, one material and 2,178,792 vertex-attribute bytes. These are CPU geometry/resource accounting, not measured GPU memory. The report includes accepted IDs, positions, all source hashes and explicit limitations.

All non-plant world vertices and bed colors are unchanged. LOD distances/hysteresis/batch centers and material roles are identical. Terrain, roads, building input/profiles and navigation source registry are unchanged. The CPU audit explicitly deduplicates and disposes 140 geometries and one shared material per variant. This proves the existing resource ownership footprint and CPU disposability; it does not execute real engine teardown, context loss or GPU release. The pre-existing engine teardown may call dispose on the shared material for each mesh; this change does not alter that behavior. Candidate perimeter ground-height error is below 0.05 mm in the actual-source CPU fixture; world Float32 placement quantization is covered by the 0.2 mm radial comparison tolerance. No plant density, walking floor or collision geometry is added.

Run the measured-source comparison with:

```sh
node tools/audit-residential-perennial.mjs --output tools/assets/residential-perennial/qa-parity.json
node --test tests/residential-ground.test.mjs tests/residential-perennial.test.mjs tests/residential-perennial-qa.test.mjs
```

The five additional QA tests cover opt-in validation, production/default byte-identical legacy buffers, 500-plot placement/budget parity, explicit CPU resource disposal and per-engine evidence isolation, and compile-time stripping. This does not substitute for clear/overcast/dusk/night city views, continuous LOD screenshots or device/GPU measurements and repeated engine/context-loss lifecycle checks.

## Completed sample

The existing source-selected domestic foundation gardens use seven triangles per low perennial. The previous generator computed one radius per face and used it for both outer corners, so adjacent faces did not share the same perimeter position. `source/before.png` shows the resulting open radial seams. The editable Blender mesh in `source/perennial.blend` joins those seven radial edges, uses an irregular bounded perimeter and slightly offset tip, and carries subtle non-directional intrinsic color variation. `source/perennial.png` is the matched after render.

Blender 4.3.2 actually authored, saved, reopened, exported and CPU-rendered these meshes. `source/before.blend` preserves the prior face-dependent-radius construction; `source/perennial.blend` is the independently editable final mesh, UV layer and color-attribute material graph. The GLBs are actual exports, not metadata placeholders. `--blend` reads edited mesh/UV/color data directly without reconstructing the mesh. A reopen/export produced byte-identical runtime TS data. Source hashes and export hashes are in `source/validation.json`.

Runtime integration is the exported `lib/city/assets/residential-perennial-data.ts` plus `residential-perennial.ts`. The GLB is a review/export artifact, deliberately not an extra browser fetch: the existing garden batch consumes source-derived vertices/colors directly. This preserves a single shared vertex-color roughness-1 material and existing batches. UVs stay in the editable source/export for future authoring; the current untextured runtime needs no UV buffer or texture. No new architectural atlas slot is introduced.

Budget contract:
- Exactly 7 triangles, 21 rendered corners per plant, before and after
- Two existing plants per accepted bed; existing 500-plot cap unchanged
- Maximum radial footprint 0.286 m; seeded height 0.19–0.256 m unchanged
- Existing terrain draping, footprint/road exclusion and entry clearance retained
- Seven shared perimeter samples instead of fourteen duplicate face-corner samples
- Existing spatial cells, shared material, receiving shadows, and 650 m empty LOD unchanged
- No new collision/walk floor, shadow caster, alpha/depth shader, texture or dynamic draw
- Tiny static exported data module; browser/GPU memory and frame-time measurements still required

The lower ring is intentionally open underneath and ground-following, just as before. “Joined” refers to the internal radial mesh edges; it is not a closed-volume/manifold claim. The seven-face silhouette remains an inexpensive illustrative perennial rather than a high-detail botanical model.

## Source selection and provenance

Original geometry, based on Vancouver Living Atlas by YiTaChen. Source: https://github.com/YiTaChen/vancouver-living-atlas. Repository license: Vancouver Living Atlas Noncommercial Research and Attribution 1.0. No downloaded plant model, photo, species survey or parcel landscaping claim is introduced.

The production selector is unchanged in `lib/city/residential-ground.ts`: existing `domestic-cladding` profiles, single source structure part, ground level, 3.5–12 m height, deterministic source-key/hash ordering, then road/building/previous-bed overlap and terrain checks. The first 500 accepted plots remain the bound. `source-cohort.json` records actual building-input SHA256 and pre-clearance candidate IDs using current profile functions. These are **candidates**, not invented accepted runtime IDs. The newer `qa-parity.json` additionally records actual accepted IDs/counts/positions from the canonical CPU ground fixture; browser capture of the complete rendered city remains blocked.

## Rebuild and verify

From repository root:

```sh
blender --background --factory-startup --threads 2 --python-exit-code 1 --python tools/assets/residential-perennial/build_perennial.py -- --output /tmp/perennial-rebuild
blender --background --factory-startup --threads 1 --python-exit-code 1 --python tools/assets/residential-perennial/build_perennial.py -- --blend tools/assets/residential-perennial/source/perennial.blend --output /tmp/perennial-reexport
node --test tests/residential-perennial.test.mjs tests/residential-ground.test.mjs
python3 tools/assets/residential-perennial/audit_vegetation.py --repo . --output /tmp/vegetation-audit.json
node tools/assets/residential-perennial/audit_source_cohort.mjs
```

To render the matched original and refined meshes, use `--render` with the source output directory containing both `.blend` files. Two CPU threads, 640×480, 48 samples, denoising disabled because this Blender build lacks OpenImageDenoise. The resulting matched renders are offline visual evidence, not city screenshots or four-lighting-condition acceptance.

The exporter rejects triangle-budget, material-count, UV, color and radius/height violations. Tests inspect GLB triangle/material/UV/color contracts, connected edges, terrain continuity, all 84 seeded height/orientation combinations, and existing garden placement/population/LOD tests. 16 focused tests pass; the full 590-test suite, TypeScript check, targeted lint and production Firebase build/verifier also pass. Production pruning is tested explicitly; final browser acceptance remains a separate gate.

## Phase D category assessment and remaining gates

| Category | Verified current implementation | Decision and remaining work |
| --- | --- | --- |
| Leaf sources | 1254² RGB atlas, four species cells, existing measured solid UV samples; `detailed-trees.ts` performs neutral-matte removal | Keep pixels/UVs unchanged. `vegetation-audit.json` records hashes and per-cell decoded base-texel coverage. A source replacement needs matched crown silhouette, mip/alpha/depth and all-lighting evidence before shipping. Source atlas is not falsely relabeled as Blender-authored. |
| Bark sources | 1254² RGB map, repeating longitudinal branch UVs, sRGB base map reused for bump at 0.045, roughness 1 | Keep unchanged. A separately authored bark height/normal source may improve coherence, but introduces an additional map or sampling tradeoff; must measure memory and near-camera value first. Both current maps are approximately 16 MiB combined RGBA8+mip estimate, not a measured GPU allocation. |
| Canopy transparency | `aSolid` protects interior volumes; color/depth use the same neutral-matte decoding and alphaTest 0.4; DoubleSide | Do not replace the specialized shader with opaque atlas material. Base-level pixel acceptance is not projected coverage. Test thin branches, bright backgrounds, shadow silhouette and LOD transitions in browser before changing it. Existing tree budgets/population unaffected. |
| Soil/grass boundary | Measured terrain and ground-harmonization visibility remain the base; residential beds are draped, road/neighbor/entry excluded | Perennial seam repair is the completed near-ground sample. Soil/grass feathering and broader ground-source refinement remain pending: a visual treatment must not cover walkable geometry or add unbounded overlay layers. Validate grazing angles and sloped beds before any such integration. |
| Landmark materials | Primary landmark model batches own named color/roughness/metalness and night materials; Science World/Canada Place have specialized detail functions | Audit identifies separate systems; no material replacement shipped. Select a named/source-supported landmark surface, preserve apertures and emissive/night roles, then compare reuse of suitable opaque city slots. Do not force membranes, lighting or glass into the eight opaque slots. |
| Car paint and tires | Roadster paint roughness 0.25/metalness 0.38; rubber roughness 0.9; distinct glass, leather and metal | Existing deliberate roles are coherent enough to defer a speculative atlas migration. Future paint-clearcoat/roughness refinement needs driver/chase views and reflection/device measurements. Tires should remain distinct rubber. |
| Interiors | Vertex-color roughness 0.75 with dedicated colored ambient/emission shader; separate glass/light materials | Preserve specialized shader, readable interiors, public apertures and navigation. Requires night/day doorway transition checks before changing material graphs. |
| Character materials | Existing editable citizen Blender source, skinned GLB, three 2048² maps, private per-navigator lifecycle | No character map replacement. Evaluate memory savings and close-view benefit separately, preserving animation/skin weights and readable character colors. Shared city atlas is not an appropriate automatic replacement. |

Required acceptance remains: clear/overcast/dusk/night city views, continuous LOD transitions with no abrupt recolor/deformation, unchanged accepted source cohort/counts/placement, and measured frame-time/GPU/memory/device budgets. The verified browser sandbox/socket restriction prevented these runtime checks. Offline evidence does not waive any gate. Keep this candidate QA-only until the lead can verify the full browser/device integration; Phase D is **partially implemented, not accepted or complete**.
