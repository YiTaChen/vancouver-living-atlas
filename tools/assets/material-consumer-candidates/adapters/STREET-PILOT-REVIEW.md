# Robson/Burrard pilot compatibility review

The original source fixture hashes and original QA files remain unchanged.
`reviewed-street-pilot.json` records the exact delta from revision
`28b3bb55af6f266b0b44e7b5c06a1d6d61c960c1`: vehicle surface hooks, the
aircraft finish attribute, the existing contact-shadow material hook, and the
geographically gated driver chase function.
No vertex positions, normals, indices, wheel transforms, collision, movement
rules or seating contracts are removed by this projection.

The consumer validators continue to execute current constructors and the exact
current `clearGround` method. Only the source-byte comparison subtracts each
complete reviewed snippet, once, before the existing seating/camera projections
and original whole-file SHA checks. Missing or duplicated snippets fail closed;
every remaining byte must still match the original fixture. Earlier valid
fixtures remain acceptable. The new negative cases also reject changed material
roles, finish packing, vehicle dimensions, pilot masks and chase parameters.

This is CPU source/geometry compatibility evidence. It does not replace runtime
WebGL, appearance, placement or performance acceptance.
