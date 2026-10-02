# Repository validation workflow

`.github/workflows/validate.yml` runs on pull requests targeting main and pushes
to main, with a manual trigger available once the workflow is on the default
branch. It uses the standard `ubuntu-24.04` hosted runner and Node 24. Dependency
versions remain fixed by `package-lock.json` and `npm ci`.

The only reusable actions are official [checkout](https://github.com/actions/checkout)
and [setup-node](https://github.com/actions/setup-node), pinned to full commit SHAs
resolved from their v6 tags on 2026-10-02. Workflow token permission is
`contents: read`; checkout does not persist credentials. There are no repository
secrets, deployments, publishing steps or merge actions. Automatic package cache
is disabled. A 20-minute job timeout and per-ref cancellation bound duplicate
work.

Checks are TypeScript, the Node regression suite (including standard-library
Python asset tests), a GLB contract audit, and the production Firebase build
verifier. The hosted runner's Python is sufficient; no Python packages or
Blender installation are requested.

This is not a browser/GPU performance test, a Blender source/re-export audit, or
a deployment. Those checks keep their separate evidence and gates. The existing
190 lint diagnostics are not silently labeled passing: lint is intentionally not
a CI success gate until that pre-existing debt is addressed. See the original
checkpoint comparison in `docs/performance/street-runtime/validation.json`.

Workflow publication and an actual successful run must be verified before
claiming remote CI passes. Adding this file alone is not that evidence.
