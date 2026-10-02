# Preserved citizen runtime reference

`vancouver-citizen-2048.glb` is the original production character before the accepted 1024-pixel LOD0 texture optimization. It is retained outside `public/` and outside the immutable offline handoff inventory, under the repository LICENSE.

- SHA-256: `1df2fce2764e996f8067d154ff82964425e82f6338ba74f3109b487331eb0840`
- 6,668,168 bytes; 37,799 triangles; 29,048 exported vertices; one material; 22 bones; three 2048-pixel PNG maps.
- The accepted production file remains `public/models/citizen/vancouver-citizen.glb`; runtime loads it with `?v=14d66fabe097` to avoid a cached prior atlas. Its provenance is recorded in the adjacent `metadata.json`.
- The gated local QA server exposes this reference at `/__offline-assets/citizen/runtime-reference/vancouver-citizen-2048.glb`. Production does not fetch it.

Run `node --test tests/citizen-candidate.test.mjs` to compare the preserved source with the actual production file. Run `CITIZEN_ASSET_PATH=tools/assets/citizen/runtime-reference/vancouver-citizen-2048.glb node --test tests/citizen-asset.test.mjs` to check the old asset independently.

The original `optimization/` handoff documents and scripts are historical, hash-pinned source evidence. Its original production-source path now contains the accepted 1024 asset. Use the current comparison test above; do not rerun handoff authoring or report-generating scripts against that path and overwrite the preserved inventory.
