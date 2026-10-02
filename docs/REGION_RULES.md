# Named region and street-selection rules

Phase B compatibility migration, 2026-10-02. The baseline is repository commit
[`a1364e9`](https://github.com/YiTaChen/vancouver-living-atlas/commit/a1364e932195e7c7e0dce093e40e1c94ecb94bcb).

The rules in [`region-rules.ts`](../lib/city/region-rules.ts) now own the Gastown
appearance envelope, its two deliberately different boundary/height policies,
and the Water Street paving-name policy. This is a selection refactor: source
building/road geometry, foundations, navigation and collision are unchanged.
The legacy envelope remains an authored compatibility region, **not an official
Gastown or HA-2 boundary, a survey, or a classification of individual buildings**.
Replacing that envelope with a municipal polygon would be a separate visual and
source-data change requiring a newly reviewed baseline.

## Rule inventory and provenance

| Named rule / consumer                                      | Purpose and exact selection                                                                                                                                                                                                                                                       | Current match count                                                                                                               | Exclusions and remaining gates                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gastown-legacy-appearance-envelope` / `facade-profile.ts` | Representative heritage appearance. Structure representative centre in strict local bounds `700 < x < 1850`, `-70 < z < 540`, with maximum structure height `<48 m`.                                                                                                              | **155 of 3,370 prepared structures**, covering **547 polygon parts**.                                                             | Boundary points, exterior neighbours, and height `>=48 m` are excluded. **30** prepared structures inside the inclusive envelope fail the height gate. Existing body preparation still rejects invalid/overheight parts and custom-landmark replacements before grouping.       |
| Same named region / `streetfronts.ts`                      | Representative physical heritage relief and storefront candidates. Per-part centre in inclusive bounds `700 <= x <=1850`, `-70 <=z <=540`; source part height `7–34 m` inclusive, source `minHeight <=0`; accepted structure must already have a heritage profile and foundation. | **341 candidate polygon parts across 134 structures**. These are selection candidates, **not a count of rendered shops or bays**. | Custom-landmark replacements, elevated/too short/too tall parts, exterior neighbours, missing foundation or non-heritage structure. Existing 9–75 m edge eligibility, real sidewalk/jamb samples, water/obstruction and entrance/bay clearance remain downstream and unchanged. |
| `water-street-ground-paving` / `heritage-paving.ts`        | Exact normalized `WATER ST`, optionally preceded by one civic number/range. Initial graph node level `ground`, edge length `>0.1 m`; treatment follows the existing road/sidewalk corridor frame.                                                                                 | **7 of 4,060 graph edges**, from **6 source line parts**.                                                                         | Cordova/Alexander/Powell and other streets, substring lookalikes, extra suffixes, bridge/tunnel start levels, and degenerate edges. Street-graph preparation keeps its existing bridge/causeway/bikeway filters. No bounding rectangle is used to select paving.                |

Sources and qualifications:

- Buildings are the existing reconciled City of Vancouver 2009 / OSM published
  inventory, with `structureId ?? buildingId ?? id` identity precedence. The
  source data and reconciliation are documented in [DATA_SOURCES.md](../DATA_SOURCES.md).
- The authored envelope and thresholds come from the baseline's
  [`facade-profile.ts`](https://github.com/YiTaChen/vancouver-living-atlas/blob/a1364e932195e7c7e0dce093e40e1c94ecb94bcb/lib/city/facade-profile.ts)
  and [`streetfronts.ts`](https://github.com/YiTaChen/vancouver-living-atlas/blob/a1364e932195e7c7e0dce093e40e1c94ecb94bcb/lib/city/streetfronts.ts).
  Coordinates use the existing [local projection](../lib/city/geo.ts), in metres
  east/south of `[-123.128,49.286]`. These authored limits are preserved, not
  attributed to an official municipal boundary.
- The existing [Gastown typology references](../tools/assets/streetscape/README.md)
  support representative shopfront/cornice/masonry proportions. They do not
  certify that every selected source structure has a particular heritage status.
- Paving derives from published `roads.geojson` names and the existing
  `cityRoadGraph(roads, trees)` preparation. Current selected source line IDs are
  `29:0`, `673:0`, `846:0`, `1465:0`, `1896:0`, `1928:0`; source labels are
  `WATER ST` and `200-300 WATER ST`. Graph edge IDs are
  `745,746,2436,2475,2973,3543,3794`. These IDs identify the pinned snapshot;
  the current graph uses feature-array-position IDs, which are **not stable IDs
  across a reordered or refreshed road file**.

The complete matched structure IDs, storefront source-part IDs and upstream
source IDs, facade height exclusions, and SHA-256 fingerprints of buildings,
roads and trees are in
[`region-rule-baseline.json`](../tests/fixtures/region-rule-baseline.json).
Feature counts, polygon-part counts, structures and graph edges are deliberately
reported separately. The audit uses the raw published road graph with tree
clearance and no optional landmark trim map; trims can change runtime graph
edge counts, but both old and centralized paving predicates receive the same
graph. No current IDs are silently promoted to a survey-based classification.

## Configuration and source identities

`CITY_REGION_RULES` is the single configuration. `createRegionSelectors(rules)`
compiles a copy of its scalar values and any source-ID include/exclude lists
once. Defaults retain the exact prior coordinate/name policy; the source-ID
inventory is an audit contract rather than an enforced allowlist. Consequently,
an unreviewed data refresh can still change matches, but the pinned fingerprint
and cohort tests fail to expose that change.

Each building selector accepts an optional `sources.include` / `sources.exclude`
list of **structure keys**, not polygon-array positions. The road selector accepts
the supplied graph's `edge.sourceIds`. An omitted include list preserves all
identities; an empty include list matches none. Exclusions win, and an identity
match never bypasses geometry, height, name or level constraints. For an edge
merged from multiple source lines, an excluded source rejects the whole edge;
the selector never cuts or rewrites its geometry. Positional road IDs should only
be used with the fingerprinted source snapshot, or replaced with stable upstream
identity in a separately reviewed graph migration.

Region selection is performed during existing building/profile, streetfront and
road-surface preparation. There is no runtime city dataset import, fetch, timer,
update hook or per-frame city scan in the rule module. Source-ID sets are built
once, and each predicate inspects only the structure, part or edge it is given.
The source inventory/audit helper is test-only and is not shipped to the browser.

## Verification and a future data refresh

Run:

```sh
node --test tests/region-rules.test.mjs tests/facade-profile.test.mjs \
  tests/heritage-paving.test.mjs tests/streetscape-coverage.test.mjs \
  tests/streetscape-placement.test.mjs
```

These **34 tests** passed for the migration, including eight new region tests:

- Independent frozen legacy predicates versus every current prepared structure,
  storefront candidate and selected road frame; exact width/frame preservation.
- Full facade profile and candidate-ID equality after deterministic feature and
  polygon-part shuffling; no mutation of source or graph data.
- Every side/corner boundary, exterior-neighbour points, distinct strict/inclusive
  semantics and height thresholds; exact civic-block names and false positives.
- Include/exclude configuration, unchanged compiled selectors after caller edits,
  and no source-ID override escaping the region or named street.
- Shuffled raw road features still select identical paving geometry, compared
  independently of positional IDs and frame orientation at micrometre precision.

Retain independent legacy predicates in
[`region-rule-audit.mjs`](../tests/helpers/region-rule-audit.mjs). To inspect a
prospective baseline without overwriting the checked-in contract:

```sh
node --input-type=module -e \
  "import { inventory } from './tests/helpers/region-rule-audit.mjs'; console.log(JSON.stringify(inventory(), null, 2))" \
  > /tmp/region-rule-candidate.json
```

Review the fingerprint change, added/removed structure/source IDs, neighbouring
regions, source heights and road corridor frames. Update the baseline and these
counts only after an intentional source/selection change is reviewed; do not
regenerate merely to make a failing test green. Rerun the full repository tests,
typecheck and production build after any integration changes. This focused
report does not claim a new visual/performance benchmark or a deployment.
