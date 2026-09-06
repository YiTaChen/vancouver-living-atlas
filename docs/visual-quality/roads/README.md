# Stage 2: connected roads and street frontage space

The ground-road renderer now builds one endpoint topology, de-duplicates repeated edges, partitions intersecting asphalt, and subtracts that union from sidewalks. Local bevel patches connect bends without long miter spikes. Lane/private/non-city access surfaces remain in the asphalt mask but do not receive invented zebra crossings or new sidewalks.

Paint follows cumulative path length instead of restarting at every source microsegment. Crossings require at least three non-minor outgoing directions; close or unsafe proposals are omitted. Their positions are illustrative because the input does not contain a crossing/lane-control survey. The known bridge/Causeway corridors remain separately layered.

Asphalt, sidewalks, road-facing 13cm curb edges and paint share a 12m piecewise-planar relief field. Geometry is cut at its cell boundaries and fixed diagonals, including paint quads and curb segments. This avoids independently sampled edges opening height seams. Walking uses rendered surface triangles; driving and ambient cars follow the new road surface. An existing original asphalt normal texture is now used in linear colour space. Static geometry shares materials and is batched into 600m cells for frustum culling; it is created once.

## Water Street and Robson Street

The old 18m arterial width was a display-class estimate, not a measured curb width or right of way. Existing tree coordinates demonstrate that it covered some tree rows. On these two streets only, bilateral rows (at least three distinct trees on each side, spanning at least 35% of a source path) constrain asphalt width. Unsupported or noisy blocks retain their original width. The complete old 22m display corridor is preserved: recovered asphalt becomes connected sidewalk. No tree or centreline coordinate moves. [Ten affected segments](tree-clearance.json) have asphalt widths of 7.7–12.9m; these are display constraints, not surveyed lane plans.

The two fragments explicitly named **200–300 WATER ST** are assessed as one 163.16m block, keeping every source coordinate. Together they have sufficient bilateral evidence for 8.4m asphalt and 6.8m sidewalks on each side; individually their tree samples were incomplete. This brings the affected source segments to twelve. [Numbered-block evidence](numbered-block-clearance.json). Plain street names are never merged into a whole-street width estimate.

One Water Street tree outside the robust row fit has a small original tapered curb extension connected to the sidewalk. It keeps approximately 6.89m of asphalt open. Narrow-street ambient vehicle offsets are adjusted to stay clear of its nose. The extension is illustrative street furniture geometry.

The City study describes a roughly 20.1m existing Water Street right of way, but its proposed streetcar lane dimensions are not used as present-day measurements: [City study, printed p32](https://vancouver.ca/files/cov/2019-401-release1.pdf). The [Bute–Robson construction design](https://syc.vancouver.ca/projects/bute-greenway/bute-robson-plaza-construction-design-update-2024.pdf) also distinguishes carriageway, wider sidewalk and tree areas; no all-street width is inferred from that local project. Original geographic data attribution remains City of Vancouver Open Government Licence / OpenStreetMap ODbL as applicable.

## Validation

Pure geometry checks cover real junction topology, reversed duplicates, curves, private accesses, short/acute crossing rejection, sidewalk/asphalt separation, height-plane seams, tree-row evidence and the connected curb extension. Browser checks and measured comparisons are recorded with this stage's captures.

The first baseline's two travel cases did not reapply the normal street-mode shadow frustum after their direct named-street setup. An isolated copy of baseline source `76f2992` was rebuilt with that QA setup corrected. The corrected Water Street and Robson measurements must be used for street comparisons; the original eight overview/fixed-camera definitions and all original evidence remain available. This QA correction does not change production controls.

[Final actual captures and measurements](../stage-2-roads/README.md) use the corrected setup. High Robson drives approximately 141m at 37.2 FPS (before 38.1), p95 34.6ms, with no >50ms frames. High downtown is 38.7 FPS with no >50ms frames. Water Street is heavier: High 27.7 FPS (before 30.2), p95 49.9ms, with one 132.6ms interval; Ultra 19.1 FPS (before 20.0). Ultra Robson is 22.9 FPS (before 23.7). The new pavement remains usable, but Water Street is below the roughly 30 FPS High goal and its spike remains a stage 6/9 follow-up; this is not a claim of hitch-free travel. [Corrected before samples](../baseline-street-corrected/README.md).

All 150 regression tests and the TypeScript check pass. Browser logs contain no rendering errors or warnings; reviewed captures show complete downtown geometry, continuous driving pavement and Water Street trees on the recovered sidewalk. Source revision in the measurement JSON is the parent commit plus this stage's working changes, captured before committing. The normal Firebase build also verifies that diagnostic controls are excluded.
