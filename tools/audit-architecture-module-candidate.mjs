/** CPU/source audit only. This does not render or claim a visual/GPU gate. */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from '../tests/helpers/city-modules.mjs';
import {
  data,
  fingerprints,
  prepareParts,
  summarizeStructures,
  createProfile,
} from '../tests/helpers/region-rule-audit.mjs';
const { ArchitecturalDetails, ARCHITECTURE_BUDGET } = await import(
  cityModule('architecture-details')
);
const {
  ArchitectureModuleCandidate,
  ARCHITECTURE_MODULE_CANDIDATE,
  architectureBoxKey,
} = await import(cityModule('architecture-module-candidate'));
const { architectureWork } = await import(cityModule('architecture-plan'));
const structures = summarizeStructures(prepareParts(data.buildings.features));
const profiles = new Map(
  [...structures].map(([key, value]) => [key, createProfile(value)]),
);
const e = {
  data: {
    buildings: data.buildings,
    buildingProfiles: profiles,
    buildingFoundations: new Map(
      [...structures.keys()].map((key) => [key, 20]),
    ),
  },
  buildings: new THREE.Group(),
  camera: new THREE.PerspectiveCamera(),
  settings: { buildings: true, quality: 'high' },
  renderer: { shadowMap: { needsUpdate: false } },
};
const details = new ArchitecturalDetails(e);
const library = {
  color: new THREE.Texture(),
  normal: new THREE.Texture(),
  orm: new THREE.Texture(),
  ready: { value: 0 },
};
const candidate = new ArchitectureModuleCandidate(
  {
    details,
    library,
    camera: e.camera,
    compatibleGraphics: false,
    settings: () => e.settings,
  },
  async () => {
    throw new Error('Source audit does not load graphics');
  },
);
const cohorts = [];
for (const cell of details.cells) {
  if (!candidate.affectedCells.has(cell.id)) continue;
  let index = 0;
  const selected = [];
  capped: for (const part of cell.parts)
    for (const box of architectureWork([part], 'street')) {
      if (!box) continue;
      if (++index > ARCHITECTURE_BUDGET.streetInstancesPerCell) break capped;
      const match = candidate.selected.get(architectureBoxKey(box));
      if (match?.part === part)
        selected.push({
          sourceKey: part.key,
          edgeKey: match.edgeKey,
          plannerIndex: index,
        });
    }
  cohorts.push({
    cellId: cell.id,
    allSourcePartsInCell: cell.parts.length,
    emittedCellCap: ARCHITECTURE_BUDGET.streetInstancesPerCell,
    selected,
  });
}
const count = candidate.selected.size;
const report = {
  id: ARCHITECTURE_MODULE_CANDIDATE.id,
  kind: 'full-real-data CPU placement audit',
  fingerprints,
  allCitySourceFeatures: data.buildings.features.length,
  groundFixtureMetres: 20,
  groundNote:
    'Uniform test datum isolates source ordering. Runtime uses unchanged engine foundations; actual GLB containment tests cover the inherited oriented volumes, not surveyed sidewalk validation.',
  maximumReplacementInstances: ARCHITECTURE_MODULE_CANDIDATE.maximumInstances,
  cohorts,
  selectedExistingInstances: count,
  populationDelta: 0,
  productionPlannerOrderChanged: false,
  sourceInstances: Object.fromEntries(
    ARCHITECTURE_MODULE_CANDIDATE.sources.map((source) => [
      source.sourceKey,
      [...candidate.selected.values()].filter(
        (item) => item.sourceKey === source.sourceKey,
      ).length,
    ]),
  ),
  plannedSinglePassTriangles: {
    baseline: count * 12,
    lod0: count * 32,
    lod1: count * 16,
    lod0Delta: count * 20,
    lod1Delta: count * 4,
  },
  maximumCandidateTriangleDelta:
    ARCHITECTURE_MODULE_CANDIDATE.maximumExtraTriangles,
  retainedPrivateTextureObjects: 0,
  transientTextureNote:
    'Standard GLTFLoader decodes embedded source maps, then immediately disposes them before geometry is attached with the shared city atlas.',
  productionCodeAndAssetExclusion:
    'Requires separately executed normal Firebase build verification',
  visualGpuAndDeviceGate: 'unverified',
};
const baselineArgument = process.argv.indexOf('--baseline');
if (baselineArgument >= 0) {
  const revision = process.argv[baselineArgument + 1];
  const source = execFileSync(
    'git',
    ['show', `${revision}:lib/city/architecture-details.ts`],
    { encoding: 'utf8' },
  );
  let code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  code = code.replace(
    /from ['"]([^'"]+)['"]/g,
    (_, id) =>
      `from '${
        id === 'three' || id.startsWith('three/')
          ? import.meta.resolve(id)
          : cityModule(id)
      }'`,
  );
  const { ArchitecturalDetails: Baseline } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  );
  const baselineHost = {
    ...e,
    camera: new THREE.PerspectiveCamera(),
    buildings: new THREE.Group(),
  };
  baselineHost.camera.position.set(-540, 37, -715);
  e.camera.position.copy(baselineHost.camera.position);
  const baseline = new Baseline(baselineHost);
  const priorQA = process.env.VANCOUVER_VISUAL_QA;
  process.env.VANCOUVER_VISUAL_QA = '1';
  const pump = (layer) => {
    for (let i = 0; i < 2000; i++) {
      layer.update(i === 0);
      if (i > 2 && layer.stats.pendingCells === 0) return;
    }
    throw new Error('Architecture source audit did not settle');
  };
  pump(baseline);
  pump(details);
  const matrixKeys = new Set();
  const batches = (layer, collect = false) => {
    const rows = [];
    layer.root.traverse((mesh) => {
      if (!(mesh instanceof THREE.InstancedMesh)) return;
      const hash = (array) =>
        createHash('sha256')
          .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
          .digest('hex');
      rows.push([
        mesh.name,
        mesh.count,
        hash(mesh.instanceMatrix.array),
        hash(mesh.instanceColor.array),
      ]);
      if (collect)
        for (let i = 0; i < mesh.count; i++)
          matrixKeys.add(
            mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16).join(','),
          );
    });
    return rows.sort((a, b) => a[0].localeCompare(b[0]));
  };
  const oldRows = batches(baseline, true),
    newRows = batches(details);
  assert.deepEqual(
    newRows,
    oldRows,
    'Default matrix/color instance buffers must match baseline exactly',
  );
  let matching = 0;
  for (const { box } of candidate.selected.values()) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(box.x, box.y, box.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        box.yaw,
      ),
      new THREE.Vector3(box.width, box.height, box.depth),
    );
    assert(
      matrixKeys.has(new Float32Array(matrix.elements).join(',')),
      'Candidate must replace a baseline instance',
    );
    matching++;
  }
  report.baselineComparison = {
    revision,
    fullDefaultBuffersEqual: true,
    baselineInstances: baseline.stats.allocatedInstances,
    currentDefaultInstances: details.stats.allocatedInstances,
    candidateTransformsPresentInBaseline: matching,
    batchMatrixColorHashes: newRows,
  };
  baseline.dispose();
  if (priorQA === undefined) delete process.env.VANCOUVER_VISUAL_QA;
  else process.env.VANCOUVER_VISUAL_QA = priorQA;
}
const text = JSON.stringify(report, null, 2) + '\n';
const index = process.argv.indexOf('--report');
if (index >= 0) writeFileSync(process.argv[index + 1], text);
console.log(text);
candidate.dispose();
details.dispose();
for (const key of ['color', 'normal', 'orm']) library[key].dispose();
