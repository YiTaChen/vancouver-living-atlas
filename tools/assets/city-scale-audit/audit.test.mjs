import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, load, jsonFile } from './cpu-modules.mjs';
import {
  PACKAGE,
  runAudit,
  auditBuildings,
  checkPolygon,
  isContiguousSubsequence,
  measureGlb,
  serialize,
  digest,
  readAuditInput,
  measureAuditInput,
} from './audit.mjs';
const artifacts = await runAudit(),
  report = artifacts['report.json'],
  rules = jsonFile(`${PACKAGE}/source-rules.json`);
const square = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
];
function feature(id = 'test-1', changes = {}) {
  return {
    type: 'Feature',
    properties: {
      id,
      height: 4,
      base: 10,
      minHeight: 0,
      roof: 'Flat',
      source: 'test',
      ...changes,
    },
    geometry: { type: 'Polygon', coordinates: square },
  };
}
test('all 7,630 source solids remain uniquely traceable and exclusions are explicit', () => {
  assert.equal(report.A01.sourceFeatures, 7630);
  assert.equal(report.A01.sourcePolygonParts, 7806);
  assert.equal(report.A01.sourceHoles, 261);
  assert.equal(report.A01.uniqueFeatureIds, 7630);
  assert.equal(report.A01.acceptedPolygonParts, 7794);
  assert.equal(artifacts['buildings.jsonl'].length, 7794);
  assert.equal(report.A01.roofGeometry['representative-gable'], 676);
});
test('input data stays unchanged during audit; source volume never uses 2m render clamp', () => {
  const data = { features: [feature('low', { height: 0.5 })] },
    before = JSON.stringify(data);
  const audited = auditBuildings(data, () => 8, rules);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(audited.records[0].sourceVolumeY, [10, 10.5]);
  assert.deepEqual(audited.records[0].displayVolumeY, [7.6, 9.6]);
  assert.equal(audited.records[0].displayHeightM, 2);
  assert.equal(audited.summary.heightClampExamples.length, 1);
});
test('malformed source rings and missing finite coordinates are rejected', () => {
  assert.throws(() =>
    checkPolygon([
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ]),
  );
  assert.throws(() =>
    checkPolygon([
      [
        [0, 0],
        [1, NaN],
        [1, 1],
        [0, 0],
      ],
    ]),
  );
  assert.doesNotThrow(() => checkPolygon(square));
});
test('duplicate IDs and invalid source vertical intervals fail rather than invent replacement data', () => {
  assert.throws(
    () => auditBuildings({ features: [feature(), feature()] }, () => 8, rules),
    /duplicate/,
  );
  assert.throws(
    () =>
      auditBuildings(
        { features: [feature('bad', { minHeight: 5 })] },
        () => 8,
        rules,
      ),
    /interval/,
  );
  assert.throws(
    () =>
      auditBuildings(
        { features: [feature('bad', { height: NaN })] },
        () => 8,
        rules,
      ),
    /interval/,
  );
});
test('real foundation order sensitivity and source clamps remain visible, not silently fixed', () => {
  assert.equal(report.A01.datumOrderSensitivity.count, 1121);
  assert.equal(report.A01.heightClampExamples.length, 32);
  assert.ok(
    report.A01.datumOrderSensitivity.records.every(
      (r) => Math.abs(r.deltaM) > 0,
    ),
  );
  assert.deepEqual(report.A01.sourceRoofMaterialFields, []);
});
test('source roof tags cannot grow a ridge above the inherited building height', () => {
  const { planPitchedRoof, pitchedRoofTriangles } = load(
    'lib/city/building-roof.ts',
  );
  const p = [
    [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
  ];
  const roof = planPitchedRoof(p, 7, 0, 'Pitched', 'cov-2009', 1);
  assert.equal(roof.sourceEpoch, 2009);
  assert.equal(
    Math.max(
      ...pitchedRoofTriangles(roof, 3).flatMap((t) =>
        t.vertices.map((v) => v[1]),
      ),
    ),
    10,
  );
  for (const [h, min, tag, parts] of [
    [13, 0, 'Pitched', 1],
    [7, 1, 'Pitched', 1],
    [7, 0, 'hipped', 1],
    [7, 0, 'Pitched', 2],
  ])
    assert.equal(planPitchedRoof(p, h, min, tag, 'cov-2009', parts), null);
});
test('3 actual slope GLBs preserve transformed Y-up bounds, physical UV, sampler and cost distinction', () => {
  for (const c of report.A02.existingCoupons) {
    assert.deepEqual(c.boundsM.size, [2, 0.1, 2]);
    assert.deepEqual(c.uvBounds, [0, 0, 1, 1]);
    assert.equal(c.geometryAndContainerBytes + c.embeddedImageBytes, c.bytes);
  }
  const fresh = measureGlb(rules.ground.existingSlope);
  assert.equal(fresh.sha256, report.A02.existingCoupons[0].sha256);
  assert.equal(report.A02.status, 'partial');
  assert.equal(report.A02.renders.status, 'not_run');
});
test('clock rates and paused clock do not change actual bus, train or wave calculations', () => {
  const [a, b, c] = report.A03.movement;
  assert.notEqual(a.cityHour, b.cityHour);
  assert.equal(c.cityHour, 10);
  for (const v of [b, c]) {
    assert.deepEqual(v.busPositionM, a.busPositionM);
    assert.equal(v.trainHeadDistanceM, a.trainHeadDistanceM);
    assert.equal(v.waveHeightM, a.waveHeightM);
  }
  assert.equal(report.A03.firstNightAurora.status, 'pass');
  assert.equal(report.A03.timeline[2].cityHour, 20.5);
});
test('CoV subsequence proof rejects invented/skipped vertices and accepts reversed original paths', () => {
  const line = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ];
  assert.ok(
    isContiguousSubsequence(
      [
        [1, 0],
        [2, 0],
      ],
      line,
    ),
  );
  assert.ok(
    isContiguousSubsequence(
      [
        [2, 0],
        [1, 0],
      ],
      line,
    ),
  );
  assert.equal(
    isContiguousSubsequence(
      [
        [0, 0],
        [2, 0],
      ],
      line,
    ),
    false,
  );
  assert.equal(
    isContiguousSubsequence(
      [
        [1, 0],
        [2, 0.001],
      ],
      line,
    ),
    false,
  );
  assert.deepEqual(report.A04.bridgeSourceChecks, { not_run: 21, pass: 24 });
});
test('rail source attribution and actual generated grade remain valid without claiming surveyed height', () => {
  assert.equal(report.A04.railRecords.length, 3);
  for (const r of report.A04.railRecords) {
    assert.ok(r.maximumGrade <= r.gradeCap + 1e-8);
    assert.ok(r.minimumGeneratedClearanceM >= r.clearanceM + 0.65 - 1e-8);
    assert.equal(r.rawOsmGeometryReverification, 'not_run');
  }
  assert.deepEqual(report.A04.namedCloseStructureProposals, []);
});
test('recorded runtime hashes use immutable base blobs while other measured inputs remain current', () => {
  for (const input of artifacts['source-hashes.json'].files)
    assert.equal(
      digest(readAuditInput(input.file, rules.baseRevision)),
      input.sha256,
      input.file,
    );
  for (const [name, value] of Object.entries(artifacts))
    assert.equal(
      fs.readFileSync(path.join(ROOT, PACKAGE, 'qa', name), 'utf8'),
      serialize(name, value),
      name,
    );
});
test('historical hash corruption and current GIS/model drift both fail closed', () => {
  const historical = Buffer.from('recorded runtime'), current = Buffer.from('current GIS');
  const readCurrent = (file) => { assert(['public/data/buildings.geojson', 'lib/city/landmark-footprints.json'].includes(file)); return current; };
  const readHistorical = (file, revision) => { assert.equal(file, 'lib/city/engine.ts'); assert.equal(revision, rules.baseRevision); return historical; };
  assert.equal(measureAuditInput('lib/city/engine.ts', rules.baseRevision, digest(historical), readCurrent, readHistorical).sha256, digest(historical));
  assert.throws(() => measureAuditInput('lib/city/engine.ts', rules.baseRevision, digest(current), readCurrent, readHistorical), /hash differs/);
  assert.equal(measureAuditInput('public/data/buildings.geojson', rules.baseRevision, digest(current), readCurrent, readHistorical).sha256, digest(current));
  assert.throws(() => measureAuditInput('public/data/buildings.geojson', rules.baseRevision, digest(historical), readCurrent, readHistorical), /hash differs/);
  assert.equal(measureAuditInput('lib/city/landmark-footprints.json', rules.baseRevision, digest(current), readCurrent, readHistorical).sha256, digest(current));
  assert.throws(() => measureAuditInput('lib/city/landmark-footprints.json', rules.baseRevision, digest(historical), readCurrent, readHistorical), /hash differs/);
  assert.throws(() => readAuditInput('lib/city/engine.ts', '0'.repeat(40)), /Fetch repository history/);
  assert.throws(() => readAuditInput('../secret', rules.baseRevision), /Invalid audit input path/);
});
test('research completion never promotes new materials, geometry or WebGL acceptance', () => {
  assert.equal(report.status, 'partial');
  assert.equal(report.runtimeChecks.status, 'not_run');
  assert.equal(artifacts['handoff.json'].taskStatus.A02.status, 'partial');
  assert.deepEqual(artifacts['handoff.json'].replaces, []);
  assert.equal(
    artifacts['handoff.json'].integrationStatus,
    'runtime_pending_webgl',
  );
});
