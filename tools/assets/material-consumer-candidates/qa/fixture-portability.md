# Reviewed source compatibility

The 2026-10-22 waterfront change moves `hullPolygon` and `addDocks` from
`lib/city/harbour.ts` into `lib/city/harbour-docks.ts`. The material consumer
audit reconstructs only these exact removed bytes and imports in memory, then
requires the original harbour SHA-256 (`b5c18dd4208a88be3a206a8e1b3a78df6e734b90be97e38adea895698428c1ab`).
The extracted module is independently pinned in `adapters/harbour-dock-source-review.json`.
Changed imports, exports, callers, collision code, materials, or any other byte in
that module fail the compatibility guard. The new marina materials are outside
this offline candidate inventory; compatibility does not mean material adoption.
No source or geometry fixture was re-recorded.

# One-coordinate floating-point portability

After the source guard passed, the unchanged Science World footprint fixture
showed one numeric difference on macOS arm64 with Node **24.22.1**:

| Fixture path | Computed | Stored | Absolute difference |
| --- | --- | --- | --- |
| `interiors.0.polys.0.36.1` | `-12.13106480597334` | `-12.131064805973342` | `1.7763568394002505e-15 m` |

Re-running the validator with the complete original `HEAD:lib/city/harbour.ts`
substituted in memory produced exactly the same single difference. The runtime
interior source, generated geometry hashes, and every other fixture value were
unchanged. This establishes that the difference predates the dock extraction;
the trigonometric footprint coordinate is sensitive to floating-point rounding.

`assertPortableGeometryFixture` permits at most **1e-12 m** rounding at that
single documented numeric coordinate, only when the site ID remains `science`.
It does not change either input, runtime geometry, or the stored fixture. All
other coordinates, geometry digests, source hashes, array order, topology, and
metadata still use strict deep equality. All numeric values must be finite
before the validator's existing JSON serialization; NaN and Infinity are
rejected rather than converted to null. JSON's existing `-0` to `0` fixture
representation is retained; no new signed-zero exception is introduced.

Negative tests reject a **1e-11 m** change at that coordinate, a **1e-6 m**
change, a **1e-13 m** change at another coordinate, reordered or missing polygon
vertices, changed IDs/hashes, non-finite values, and numeric-to-null changes.
