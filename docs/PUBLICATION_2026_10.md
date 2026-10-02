# Publication record — 2026-10-02

The initial GitHub write restriction was resolved after the repository owner
updated access. The verified checkpoint is now published on
[`perf/street-runtime-and-region-rules`](https://github.com/YiTaChen/vancouver-living-atlas/tree/perf/street-runtime-and-region-rules)
in [draft PR #1](https://github.com/YiTaChen/vancouver-living-atlas/pull/1).

Checkpoint remote commit: `dff8dcf740169cf45f46444c610e159b0222d64a`.
Base main: `a1364e932195e7c7e0dce093e40e1c94ecb94bcb`.

Publication used authenticated Git Data API writes. API-generated author/time
metadata produces different commit IDs from the earlier local bundle. Every
stage's complete tree was checked against its local counterpart. All uploaded
binary blob hashes were checked individually, then the remote branch was fetched
back and its full tree compared with the tested local checkpoint. The diff was
empty, including Blender sources, GLBs and images.

| Local verified commit | Published commit | Identical tree |
| --- | --- | --- |
| e50b817 | d27de2e37674fdc2c5e3901a8630cd32db1b4c37 | bfa3b122d39635787416536b80cc95ceff71fadd |
| 9e69073 | 4d88b168547e764f80b179e6bf086cc7538e0d3c | f5e7d7f9696ac3a6c0349e9e2eefb19d4b7953c9 |
| 96b91af | fa50d2344580fec2b2c08d97b61275df3747a689 | 88e7e065b827d65935ec61d1ef7c73f8a0598b4e |
| b6b6998 | aaf54b415132ce6f70dd486d6c5ade9d642a2f94 | 85cbb8cfe517b63665e80783e24fa9b404039903 |
| 26a2ae5 | dff8dcf740169cf45f46444c610e159b0222d64a | 5ddd62974b2e5339ccab289c8aedad212f307834 |

At the publication check, this exact remote commit had zero GitHub check runs,
zero status checks and zero Actions runs. The checkout has no `.github/workflows`
directory. This is **no configured CI evidence**, not a passing CI result. The
585-test, typecheck, production build and Blender evidence remains the recorded
local validation. No merge or deployment was performed; main was unchanged.

Earlier bundle/validation files retain the original failed-publication checkpoint
as historical evidence. Their GitHub blocker is superseded by this record. The
browser/GPU restriction is not resolved by GitHub access: C/D remain integration
candidates, E's historical long-frame root cause remains unverified, and F is
still gated. Continued bounded QA-only integration is tracked separately from
this five-stage checkpoint.
