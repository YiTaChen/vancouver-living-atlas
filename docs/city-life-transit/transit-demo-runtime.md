# Boardable bus runtime / local WebGL QA

Based on Vancouver Living Atlas by YiTaChen  
Source: https://github.com/YiTaChen/vancouver-living-atlas  
License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0

This integration consumes the PR6 `21007a0` original bus source package without changing its manifest, GLBs, validators or provenance. The package remains an offline asset delivery; this adapter is a separate runtime consumer. The scene is an original **three-stop local research lane**, not route 5/6, not a surveyed curb, and not a seven-station SkyTrain implementation.

## Mount and asset dependency

`components/city-life-transit-qa.tsx` default-exports `CityLifeTransitQa({ assetBaseUrl?, onClose? })`. The host mounts it only through its local QA gate. The default base is `/__offline-assets/boardable-bus`; the local server must explicitly allow the following exact source files:

- `tools/assets/boardable-bus/manifest.json`
- `tools/assets/boardable-bus/exports/city-bus-12m-exterior.lod0.glb`
- `tools/assets/boardable-bus/exports/city-bus-12m-interior.lod0.glb`

No public asset copy, production route or main-city engine hook is introduced by this component. Production stripping and the local allowlist are host responsibilities. LOD0 exterior + interior cost is 6,070 triangles, 28 declared primitives, 515,700 GLB bytes, zero embedded textures. These are asset costs, not measured GPU draw calls. QA renders a small additional research environment and a simple datum marker for the passenger.

## Adapter API

```ts
const demo = await createTransitDemo({ assetBaseUrl, signal });
scene.add(demo.root);
demo.update(realElapsedSeconds);
demo.snapshot();
demo.board('seat-09'); // or 'main-aisle', another manifest anchor
// The host may switch camera to Orbit without changing passenger state.
demo.riderCameraPose();
demo.requestStop();
demo.alight();
demo.setPaused(document.hidden);
demo.dispose();
```

`TransitDemoRuntime` may also be constructed with already loaded `GLTF` exterior/interior objects. `createResearchTransitLayout()` exposes the local path and declared surfaces for inspection. `advanceToNextOpenStop()` is an explicit QA time-step command: it runs the same clock/controller/door animation to the next open stop; it does not move the bus by resetting its pose. It reaches a hold-open terminal after the third stop.

The independent component starts in **step mode** to make browser QA reproducible. The renderer remains active, but simulation time changes only on the step button. Switch to real-time playback to observe the full one-second plug/slide animation and continuous curved movement. Hidden-tab and manual pauses still freeze the actual simulation and reject boarding/alighting commands. Camera switching does not mutate `PassengerTransfers`.

For a future source-backed city service, inject `layout`, `validateTransfer` and `clearDistanceM`, and disable the research environment. The adapter refuses a `verified-source-service` classification without both live observation callbacks. That interface is preparation, **not certification that a real city route is ready**. The host must provide:

1. A source-backed continuous lane chain with turn connectors and exact road surface/level. GTFS XY alone is insufficient.
2. Legal stop transforms and a connected curb/threshold/ramp surface. The new tyre-contact root uses the actual road top; the old `ground + 1.08` body offset must not be applied. Door sill is bus-root Y=0.36. The research islands deliberately match that height, and are not actual road curbs.
3. Fresh surface, clearance and line-of-sight checks at reserve and commit. The existing city surface/navigation index should provide exact current surfaces, not a global geometry scan or a nearest GTFS-point guess.
4. Authoritative traffic occupancy clearance and a safe terminal/dispatch policy. This sample holds its final stop; it has no 5↔6 dispatch or occupied endpoint recycle.

Do not parent `demo.root` under an extra unaccounted world transform: layout/path/transfer observations are expressed in the adapter's world coordinate frame. A host that needs another world frame must convert all source floors/observations consistently.

## Actual doors, passenger datum and interaction

The adapter validates the current passenger-capable manifest with `passengerContractFromManifest`, then loads and evaluates the **actual four GLTF animation clips** using `AnimationMixer`. Blender's current export begins at frame 1 (1/24 s) and ends at 25/24 s. The adapter normalizes the actual track interval to the declared one-second duration, retaining the authored outward plug and slide. It does not rewrite the asset or substitute a metadata-only door mesh.

Open-state validation compares actual animated node pivots against the manifest open pose. The research transfer proof also checks the actual declared curb rectangle and rays through the **animated GLTF aperture** at shoulder-width offsets and two body heights. These bounded QA rays concern one vehicle; they are not complete city/capsule collision or free vehicle-interior walking.

Ten manifest seats use their `pelvisPointM` and exact `cameraEyePointM`. Two standing anchors use `feetPointM`; a seat pelvis is never treated as a standing character root. One stable passenger/vehicle/car identity survives the entire trip and Orbit/rider switches. Boarding/alighting uses reserve → preload → freshly validate → commit. The scene uses fixed anchors, not free walking, seat changes while riding, or a navigation controller swap.

The bell records a request and clears at the next serviced stop; the sample still serves every selected stop. The final stop holds open and keeps an occupied bus. An explicit scene reset is enabled only after the player is walking and there is no pending transfer.

## Browser verification and state

`output#city-life-transit-state[data-testid="transit-state"]` exposes readable JSON, updated every 150 ms and immediately after commands: phase, stop, station/speed, actual door state, boarding/alighting eligibility, passenger anchor/floor, occupancy/pending counts, bell, local anchor error, simulation time, pause, view and step mode.

Suggested browser sequence:

1. Step to stop A; inspect actual open door and `canBoard=true`.
2. Select a seat, board, inspect the interior/rider eye.
3. Press bell; switch to Orbit then return to rider and verify the same identity/local anchor.
4. Step to B, or switch real-time playback and observe the turn toward C.
5. At C verify terminal hold with occupant; alight through the rear door and verify the floor identity/count.
6. Reset while walking, board `main-aisle`, and repeat for standing datum.
7. Pause/resume manually and hide/restore the browser tab: no accumulated wall-clock debt or occupied reset.
8. Mount/unmount to verify loader abort and geometry/material/mixer/renderer cleanup.

“儲存搭乘驗證截圖” forces a fresh render, immediately encodes the canvas PNG in the same task, and posts the PNG plus snapshot/UI/GPU/viewport/camera data to the local `/__visual-qa` endpoint. Names are fixed safe identifiers such as `bus-seat09-stop2-orbit-dwell`; capture bytes are never logged to chat. The endpoint must confirm `{saved:true}` before the UI reports success.

The component additionally displays actual `renderer.info` draw/triangle counts from this QA scene. Those observations must be recorded with the actual browser/device before being called performance results.

## Verification completed by the adapter author

`node --test tests/city-life-transit-demo.test.mjs`: 4 tests pass, loading the shipped GLBs with Three's `GLTFLoader`:

- Actual clip plug/slide poses, closed/intermediate boarding rejection, and a clear open aperture.
- Manifest seat pelvis/camera eye, bell, curved motion, fixed local anchor, occupied terminal hold and valid rear-door alighting.
- Standing feet, 300-second hidden pause without state/time debt, bounded recovery, and idempotent dispose.
- Missing city observations and invalid fresh floors fail closed.

These tests exercise actual GLTF geometry/animations and service/transfers without a WebGL renderer. **Browser visuals, transparency sorting, live GPU cost and production integration remain host QA tasks.** No Metro vehicle movement/boarding, Canada profile, real GTFS route, full station interior or seven-station network is implemented by this bus demonstration.
