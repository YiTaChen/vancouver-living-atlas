# Burrard shared street-bank floor boundary

The original atrium floor continued through the structural cheeks between the street staircase and escalator lanes. Independent full-body probes found 24 supported flat-floor positions whose visible inclined slab stood up to 0.522 m above the walking surface.

The source now removes the atrium triangles beneath the complete shared underslab wherever its actual underside has less than 2 m standing clearance. The cut uses the retained part's quaternion, dimensions and underside plane: X −10.3 to +0.3 m, beginning at the existing lower landing Z −105 m and ending at the computed clearance boundary near Z −100.48 m. The high underpass remains available. The slab, retaining walls, handrails, all stair treads, landing endpoints, platforms and boarding fields are retained.

These are the model's existing proportional dimensions, not a new survey claim. This correction reconciles the physical and visible geometry within the photo-backed shared bank; the primary architectural references remain in [the Dunsmuir reference record](burrard-granville-references.md).

`tests/burrard-shared-bank-headroom.test.mjs` checks the exact structural bounds, removed invalid origins, retained high underpass, emitted mesh heights, native movement through the lower landing in both directions and the unchanged 32-call limit. At the exact landing seam, the lowest escalator tread projects 1 mm beyond the bank and rises 0.1667 m: it remains an intentional, traversable first step. This narrow tread condition does not exempt structural floor faces.

Independent verification in `.cache/review-burrard-carve-proof.mjs` sampled all 17 Burrard floors at 2,520 barycentric points. Every complete-capsule-clear sample had a visible floor at its walking height; all 24 original invalid atrium samples lost flat-floor support. The shared underslab remained byte-for-byte equal to its prior source part. This is a CPU geometry check; final game pixels are reviewed separately after regeneration.

## Glazed entrances above the shared bank

The full-game review also exposed an enclosing gable sheet through the street staircase and escalator. At front plane Z −97.9 m, both flights stand near Y −2.83 m while the original glass began at Y −4 m. Transparency allowed the walker to pass through the modeled wall; it was not a real entrance opening.

The front gable now has an actual portal across the retained shared-bank width, X −10.3 to +0.3 m. Its glass and mullions begin above Y −0.6667 m: the highest actual tread within a body radius of the glass plane is Y −2.6667 m, with 2 m standing clearance. Narrow lower glass returns, an existing-width steel header and jambs frame the opening. Original upper pane edges, the back gable, side glass and the complete pitched roof remain. Public west/east side-door posts also stop at the existing 2.5 m masonry wall head instead of extending into the flat doorway or the first main-bank step. These opening dimensions follow the reconstructed bank and wall geometry; they are not surveyed door dimensions.

Every retained vertical side pane, gable pane, mullion and portal frame now has an exact matching physical box. This also rejects the original supported outer-wall probe beside the post at X −12, Z −101.5 m. Roof glazing and trusses retain their ceiling behavior; this does not apply a blanket collision rule to the glass roof.

`tests/burrard-glazing-portal.test.mjs` tests complete standing capsules and eye volumes against actual emitted glass/framing instances, including both street lanes and side doors. It preserves all floor surfaces, connections, platforms and upper roof/glazing boundaries. Closed-glass and low-post negative fixtures restore only the visible geometry, so they must fail independently of the unmodified collision inventory. The test also sweeps supported, full-body-clear tread positions across the remaining Burrard flights and checks every vertical part's exact collider. Native B/G circulation and all five stations' accessible routes passed alongside these checks (16 tests). Final regenerated game pixels require a separate review.
