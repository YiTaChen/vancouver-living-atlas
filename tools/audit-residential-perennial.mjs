/** Canonical CPU comparison using measured source terrain/roads and actual runtime selectors.
 * No browser/GPU claims. Invoke: node tools/audit-residential-perennial.mjs --output FILE
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixture, load, sourceHashes, THREE } from './causeway-cpu.mjs';
const at = process.argv.indexOf('--output');
if (at < 0 || !process.argv[at + 1]) throw new Error('--output FILE required');
const output = process.argv[at + 1],
  started = performance.now();
const oldFlag = process.env.VANCOUVER_VISUAL_QA,
  oldWindow = globalThis.window;
const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { e } = createFixture();
e.buildings = new THREE.Group();
// Actual profile/body code, stubbing image fetches only. Geometry/selection are real.
const textureLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
try {
  load('lib/city/building-bodies.ts').createBuildingBodies(e);
} finally {
  THREE.TextureLoader.prototype.load = textureLoad;
}
const body = e.buildings;
const ground = new (load('lib/city/ground-surface.ts').GroundSurfaceIndex)([
  e.terrain.children[0],
]);
const { createResidentialGround } = load('lib/city/residential-ground.ts');
const protectedState = () =>
  digest({
    inputs: e.data.buildings,
    terrain: e.terrain.children.map((m) =>
      m.geometry ? [...m.geometry.getAttribute('position').array] : [],
    ),
    roads: e.roads.children.map((m) =>
      m.geometry ? [...m.geometry.getAttribute('position').array] : [],
    ),
    profiles: [...e.data.buildingProfiles],
    travel: e.data.travelSurfaces.surfaces,
    flightBuildingVolumes: e.data.flightBuildingVolumes,
  });
const beforeState = protectedState();
function capture(variant) {
  e.buildings = new THREE.Group();
  process.env.VANCOUVER_VISUAL_QA = '1';
  globalThis.window.location = { search: `?qaPerennial=${variant}` };
  const started = performance.now();
  createResidentialGround(e);
  const groups = new Map(),
    geometries = new Set(),
    materials = new Set();
  for (const lod of e.buildings.children) {
    const mesh = lod.levels[0].object,
      geometry = mesh.geometry;
    const world = [...geometry.getAttribute('position').array].map(
      (v, i) => v + lod.position.getComponent(i % 3),
    );
    for (const name of ['position', 'normal', 'color'])
      assert.ok(geometry.getAttribute(name).array.every(Number.isFinite));
    groups.set(mesh.name.replace('Residential foundation gardens ', ''), {
      positions: world,
      colors: [...geometry.getAttribute('color').array],
      bytes: Object.values(geometry.attributes).reduce(
        (n, a) => n + a.array.byteLength,
        0,
      ),
      vertices: geometry.getAttribute('position').count,
      center: lod.position.toArray(),
      lod: lod.levels.map((l) => ({
        distance: l.distance,
        hysteresis: l.hysteresis,
      })),
      emptyFar: lod.levels[1].object.children.length === 0,
      groups: geometry.groups.length,
      material: {
        type: mesh.material.type,
        roughness: mesh.material.roughness,
        vertexColors: mesh.material.vertexColors,
        map: mesh.material.map,
        side: mesh.material.side,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        walkSurface: mesh.userData.walkSurface ?? false,
      },
    });
    geometries.add(geometry);
    materials.add(mesh.material);
  }
  const evidence = structuredClone(e.data.residentialPerennialQA),
    report = structuredClone(e.data.residentialGround);
  const disposal = [];
  for (const resource of [...geometries, ...materials]) {
    let calls = 0;
    resource.addEventListener('dispose', () => calls++);
    resource.dispose();
    disposal.push(calls);
  }
  e.buildings.clear();
  assert.ok(disposal.every((v) => v === 1));
  return {
    groups,
    evidence,
    report,
    materialCount: materials.size,
    geometryCount: geometries.size,
    elapsedMs: performance.now() - started,
    disposedResources: disposal.length,
  };
}
try {
  const baseline = capture('baseline'),
    candidate = capture('blender');
  assert.ok(
    baseline.report.plots > 0,
    'actual measured-source fixture must accept plots',
  );
  assert.deepEqual(candidate.report, baseline.report);
  assert.deepEqual(candidate.evidence.beds, baseline.evidence.beds);
  assert.deepEqual(candidate.evidence.plants, baseline.evidence.plants);
  assert.equal(candidate.materialCount, baseline.materialCount);
  assert.equal(candidate.geometryCount, baseline.geometryCount);
  assert.equal(
    protectedState(),
    beforeState,
    'measured terrain, roads, building input/profiles and navigation registry unchanged',
  );
  let maxUnchangedPositionDelta = 0,
    maxPlantRadius = 0,
    maxRingGroundError = 0,
    changedPlantVertices = 0,
    attributeBytes = 0;
  const plantsByCell = new Map();
  for (const p of candidate.evidence.plants) {
    const entries = plantsByCell.get(p.cell) ?? [];
    entries.push(p);
    plantsByCell.set(p.cell, entries);
  }
  for (const [cell, now] of candidate.groups) {
    const old = baseline.groups.get(cell);
    assert.ok(old);
    assert.equal(now.vertices, old.vertices);
    assert.equal(now.bytes, old.bytes);
    attributeBytes += now.bytes;
    assert.deepEqual(now.lod, old.lod);
    assert.deepEqual(now.center, old.center);
    assert.deepEqual(now.material, old.material);
    assert.equal(now.groups, 0);
    assert.equal(now.emptyFar, true);
    const plantVertices = new Set();
    for (const p of plantsByCell.get(cell) ?? []) {
      const [x, base, z] = p.center;
      for (let k = 0; k < 21; k++) {
        const vertex = p.firstVertex + k;
        plantVertices.add(vertex);
        const [px, py, pz] = now.positions.slice(vertex * 3, vertex * 3 + 3);
        maxPlantRadius = Math.max(maxPlantRadius, Math.hypot(px - x, pz - z));
        assert.ok(Math.hypot(px - x, pz - z) < 0.2862);
        if (k % 3 === 0)
          assert.ok(
            Math.abs(py - (base + 0.19 + (p.seed % 4) * 0.022)) < 0.0002,
          );
        else {
          const error = Math.abs(py - (ground.sample(px, pz, base) + 0.025));
          maxRingGroundError = Math.max(maxRingGroundError, error);
          assert.ok(error < 0.0003);
        }
        if (
          now.positions
            .slice(vertex * 3, vertex * 3 + 3)
            .some((v, i) => Math.abs(v - old.positions[vertex * 3 + i]) > 1e-5)
        )
          changedPlantVertices++;
      }
    }
    for (let vertex = 0; vertex < now.vertices; vertex++)
      if (!plantVertices.has(vertex))
        for (let axis = 0; axis < 3; axis++) {
          const delta = Math.abs(
            now.positions[vertex * 3 + axis] - old.positions[vertex * 3 + axis],
          );
          maxUnchangedPositionDelta = Math.max(
            maxUnchangedPositionDelta,
            delta,
          );
          assert.ok(delta < 0.0002);
          assert.equal(
            now.colors[vertex * 3 + axis],
            old.colors[vertex * 3 + axis],
          );
        }
  }
  assert.ok(
    changedPlantVertices > 0,
    'candidate must actually replace the plant source geometry',
  );
  const report = {
    version: 1,
    status:
      'CPU source-selection/geometry parity passed; browser lighting/LOD/GPU/device acceptance pending',
    variant: 'QA-only explicit opt-in',
    sourceHashes: sourceHashes(),
    accepted: baseline.report,
    placementSha256: digest(baseline.evidence),
    plantPlacementSha256: digest(baseline.evidence.plants),
    bedPlacementSha256: digest(baseline.evidence.beds),
    invariants: {
      sourceIds: true,
      acceptedBeds: true,
      plantCentersSeedsAndBatchSlots: true,
      terrainRoadBuildingNavigationUnchanged: true,
      oneForOneVertices: true,
      attributeBytes,
      materialCount: candidate.materialCount,
      batches: candidate.geometryCount,
      lodAndBatchCenters: true,
      maxUnchangedPositionDelta,
      maxPlantRadius,
      maxRingGroundError,
      changedPlantVertices,
      baselineDisposedResources: baseline.disposedResources,
      candidateDisposedResources: candidate.disposedResources,
    },
    diagnosticOnlyCPUms: {
      baseline: baseline.elapsedMs,
      candidate: candidate.elapsedMs,
      total: performance.now() - started,
    },
    limitations: [
      'CPU times are single-run diagnostics, not frame-time/GPU performance evidence.',
      'Image loading stubbed; browser shader/color-space/lighting not exercised.',
      'Disposal is explicit deduplicated CPU cleanup; real engine teardown, context loss and GPU release remain untested.',
      'Canonical ground fixture covers actual source terrain, roads, paths and harmonization, but is not a complete rendered city.',
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output,
        acceptedPlots: report.accepted.plots,
        plants: report.accepted.plants,
        triangles: report.accepted.triangles,
        ...report.invariants,
      },
      null,
      2,
    ),
  );
} finally {
  if (oldFlag === undefined) delete process.env.VANCOUVER_VISUAL_QA;
  else process.env.VANCOUVER_VISUAL_QA = oldFlag;
  globalThis.window = oldWindow;
  e.facadeDetails?.dispose();
  const seen = new Set();
  for (const root of [body, e.buildings, e.terrain, e.roads])
    root.traverse((o) => {
      for (const r of [o.geometry, o.material])
        if (r?.dispose && !seen.has(r)) {
          seen.add(r);
          r.dispose();
        }
    });
  for (const texture of e.extraTextures) texture.dispose();
}
