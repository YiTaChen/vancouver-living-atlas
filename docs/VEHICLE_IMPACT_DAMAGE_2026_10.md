# Vehicle impacts, destruction and racing feedback — 2026-10-22

Drive and the independent Tesla share a deterministic impact response and
per-vehicle damage. The goal is readable racing-game feedback: a light scrape,
a yielding pole and a head-on mature-tree collision must feel different. This
is a bounded game model, not a structural crash or occupant-injury simulator.

## Reference findings and design decisions

- [Bucsuházy et al., PLOS ONE (2022)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0248171)
  identifies impact speed and trunk diameter among significant variables in
  real tree-crash injury severity. It does not supply a universal tree-breaking
  speed. Tree species, decay, roots and soil are not modelled here.
- [FHWA Lighting Handbook §7.5](https://highways.dot.gov/safety/other/visibility/fhwa-lighting-handbook-august-2012/7-lighting-application)
  distinguishes breakaway pole bases and discusses pedestrian-area exceptions
  and electrical disconnects. Existing rendered slender lamps are assigned a
  **game breakaway class**; this is not a claim about actual Vancouver bases.
- [FHWA Guardrail 101](https://highways.fhwa.dot.gov/safety/rwd/reduce-crash-severity/guardrail-101)
  distinguishes a redirecting guardrail face from an energy-absorbing terminal.
  The shipped Lions Gate/causeway geometry is concrete barrier and pedestrian
  railing. It is not reclassified as a tested W-beam or crushable terminal.
- [FHWA terminal crash analysis](https://www.fhwa.dot.gov/guardrailsafety/safetyanalysis/)
  explains the role of mass, speed, angle and posture and the limits of test
  conditions. No game setting is presented as a certified safe impact speed.

## Speed and breakage tuning

For obstacle outward unit normal `n`, closing speed is `max(0,-dot(v,n))`.
Only its energy `0.5*m*closingSpeed²` can break a prop. Tangential motion has
bounded friction loss. Successful breakage consumes work, then the residual
normal speed is calculated from the remaining energy; there is no added energy.
An unbroken object removes most inward speed and permits a small rebound.

Initial game values (metres, seconds, joules):

| Class                 | Strength/response              | Example: 40 km/h perpendicular impact, 1,550 kg game car |
| --------------------- | ------------------------------ | -------------------------------------------------------- |
| 20 cm trunk           | `2,000,000*diameter³` = 16 kJ  | Breaks; approximately 36.5 km/h remains                  |
| 30 cm trunk           | 54 kJ                          | Breaks; approximately 26.4 km/h remains                  |
| 60 cm trunk           | 432 kJ                         | Survives; car nearly stops with slight rebound           |
| 16 cm breakaway lamp  | 6 kJ                           | Breaks; approximately 38.7 km/h remains                  |
| Fixed/heavy pole      | `breakaway:false`              | Remains solid regardless of energy                       |
| Steel railing side    | Friction .12, restitution .04  | Preserves much of a shallow tangential slide             |
| Concrete barrier side | Friction .30, restitution .015 | More sliding loss; no hole or break-through              |

These are deliberate game tuning examples, not measured real vehicle results.
Drive uses 1,550 kg and Tesla 2,000 kg game mass estimates. Tree strength
diameter is separately estimated from authored height (`.038h` broadleaf,
`.042h` conifer; minimum 8 cm), not municipal DBH. The existing conservative
trunk/branch collision radius `max(.18,.035h)` remains distinct from strength.
The rectangular foliage envelope no longer acts as a solid wall; the trunk
and branch envelope remains physical during ground travel and flight.

## Contact and motion guarantees

- Damage and breakage are committed only after a real motion hit, never during
  camera sweeps, spawn clearance or speculative ground-fit/roof-route queries.
- A shared prop ID disables both its source and already-cached triangles.
  Every accepted broken-prop route is swept again; another tree, wall, roof,
  protected floor, water boundary or invalid query is never waived.
- A fixed Tesla substep / Drive movement handles at most four distinct props.
  The unresolved remainder stays blocked. Lost speed shortens the remaining
  travel. Incorrect pass-through claims do not repeatedly charge one prop.
- Coincident obstacle box faces choose the opposed normal while preserving the
  earliest fraction. This avoids a tangent face incorrectly reporting zero
  energy for a head-on hit. Ground/roof identity selection is unchanged.
- Guardrail alignment requires a fresh full rotating-body sweep. Tesla also
  requires fresh wheel support. A head-on rebound reverses velocity rather than
  instantly rotating the car body 180 degrees.
- Original Drive surface/building permissions remain authoritative. Its legacy
  building fallback records local wall damage on a rejected ground step; this
  release does not replace all building/interior navigation with rigid-body CCD.

## Damage, feedback and repair

Damage is stored in car-local coordinates: front, rear, driver's left (+X),
right (-X) and roof. Impacts clone only affected player body geometries, push
vertices inward, and clip scratches/paint loss to actual facing body triangles.
Shared original geometry/materials and ambient traffic assets are unchanged.
Marks are replayed onto the visible body when its model/LOD changes; cockpit
visibility and wall-climbing orientation do not clear damage.

Sparse panels inside a dense merged Tesla body are refined only around a real
hit. Interior triangle fans preserve the original boundary edges, interpolated
attributes, material groups and draw ranges. Matching seams and both faces of
thin trim share displacement; the complete displacement field is reduced if it
would invert or collapse a triangle. Repair restores original geometry identity.

Per-zone mechanical damage is bounded. At maximum relevant panel damage,
acceleration retains at least 55%, top speed 65%, steering response 70%, braking 85%;
steering pull is at most 3.5% input. Tesla ground driving uses these factors,
including ground boost; airborne/wall thrust and unlimited jet duration remain.
Light scrapes primarily affect appearance. A resting contact is one episode,
not a fresh crash every frame. A new scrape segment requires 35 cm travel, and a
renewed stronger hit is distinct. Contact episode bookkeeping is capped at 64.

The compact ten-language condition panel works with native keyboard/touch
controls. Expand it to see affected zones and **stop at or below 0.5 m/s to repair**.
Repair restores the current car's appearance and handling, not the world props.
Optional synthetic thud/scrape audio starts off and only creates an AudioContext
after an explicit user action. Impact shake is small and transient; woodchips,
dust and metal sparks have different presentation.

## Destruction lifecycle and performance

- A broken tree disappears from far instances, procedural near pools and mature
  LODs. Quality/movement/late asset completion never resurrects it. Broken poles
  and lamp heads disappear, and the corresponding warm-light contribution is
  removed locally while overlapping lamps and road fill remain.
- Nearby replacement tree/pole falls settle in 1.6 s. Settled trunk/pole geometry
  becomes a low non-adherable obstacle, independently swept for Drive/Tesla.
  This is a simplified fall/log proxy, not a free rigid-body pile or fracture
  simulation. Foliage/debris particles are cosmetic.
- At most 48 fallen objects own meshes/colliders; retiring an old visual also
  retires its debris collider while its intact prop stays broken. Tombstones
  can only reference the finite registered city props; unknown IDs are rejected.
- Each player damage overlay retains 16 marks (module hard limit 24), at most 18
  cloned panels and one scratch draw with at most 4,096 triangles. Idle updates
  do not traverse the city or rebuild car geometry.
- Local sparse-panel refinement adds at most 384 triangles / 1,152 vertices per
  owned mesh and 2,048 triangles / 6,144 vertices per car. Its history tracking
  follows the same capped mark history; repeated refreshes do not keep refining.
- Shared feedback uses one Points draw and fixed 7,680-byte particle buffers:
  128 particles, reduced to 64 in balanced/low rendering; optional audio ≤4 voices.
  No shadow-casting particle lights or full-city rigid bodies are added.
- The night field retains its original texture and adds a fixed 1 MiB warm-light
  accumulator plus 16 bytes/source; lamp removal only updates a local raster.
- Session breakage is reset by reloading the city. Save games, NPC rerouting
  around fallen logs, airbags, glass fracture and full soft-body crumpling are
  outside this implementation.

## Validation

Pure solver, local-surface damage, particle/audio lifecycle, all-LOD destruction,
actual Drive/Tesla integration, guarded sweeps, second-obstacle and invalid-query
tests live in `tests/vehicle-*.test.mjs`, with additional lighting/tree regressions.
Local browser entries in `vehicle-impact-qa.ts` choose actual clear approaches
and use public navigation; native acceleration/braking causes the impact.
No damage, speed or prop-break flag is injected. These diagnostics are stripped
and checked absent from ordinary Firebase builds.

Release results and native capture limits are recorded under
`docs/qa/vehicle-impact-20261022/` after acceptance.
