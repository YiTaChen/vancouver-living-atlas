import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from '../../../tests/helpers/city-modules.mjs';
import {
  contracts,
  manifest,
  fitModule,
  fitBay,
  groundThreshold,
} from './fit.mjs';
import { sourceExamples } from './source_examples.mjs';
const { facadeTemplates } = await import(cityModule('facade-profile'));
const { streetBayThreshold } = await import(
  cityModule('streetscape-placement')
);
const clone = (v) => structuredClone(v);
function profile(kind) {
  return {
    ...clone(facadeTemplates.find((p) => p.kind === kind)),
    seed: 1,
    wallColor: 0xffffff,
  };
}
function pavement(values = [0, 0, 0]) {
  return {
    basis: 'rendered-surface-triangles',
    samples: values.map((heightM, i) => ({
      sampleId: `synthetic-unit-fixture:${i}`,
      alongM: 3.5 + i * 2.5,
      heightM,
    })),
  };
}
function fixture(id) {
  const c = contracts.get(id),
    b = c.lodReferences[0].measurements.boundsM;
  return {
    source: {
      structureId: 'synthetic-unit-fixture',
      featureId: 'fixture-only',
      edgeKey: 'fixture:left|right',
      edgeLengthM: 12,
      alongM: 6,
    },
    existingSlotId: 'synthetic-existing-slot',
    profile: profile(c.profiles[0]),
    heightM: 12,
    minHeightM: 0,
    foundationM: 0,
    windowRow: 1,
    row0SuppressedByExistingDoor: true,
    entryExclusions: [],
    pavement: pavement(),
    slot: {
      widthM: b.size[0],
      heightM: b.size[1],
      depthM: b.size[2],
      datumYAboveFoundationM: c.constraints.requiresPavement ? 0.02 : 5,
      datumIdentity: c.attachmentDatum.yIdentity,
      authoringDatumOffsetM: 0,
    },
    ...(c.opening && ['window', 'door'].includes(c.opening.kind)
      ? {
          targetOpening: {
            widthM: c.opening.widthM,
            heightM: c.opening.heightM,
          },
        }
      : {}),
    ...(c.constraints.minimumEntryClearanceM
      ? { targetOpening: { widthM: 1.04, heightM: 2.3 } }
      : {}),
    corner: {
      secondEdgeKey: 'fixture:right|return',
      secondEdgeLengthM: 12,
      turn: 'exterior',
      angleDegrees: 90,
      handedness: 'positive-x-return',
      mirror: false,
    },
    roof: {
      kind: 'flat',
      exposed: true,
      polygonM: [
        [
          [-6, -6],
          [6, -6],
          [6, 6],
          [-6, 6],
        ],
      ],
      exclusionsM: [],
      centerXM: 0,
      centerZM: 0,
      yaw: 0,
      wallSection: { zMinM: 0.06, zMaxM: 0.44, heightM: 0.1 },
    },
  };
}
for (const id of contracts.keys())
  test(`${id}: exact-size synthetic slot is offline-compatible at both LODs`, () => {
    for (const lod of [0, 1]) {
      const r = fitModule(id, fixture(id), { lod });
      assert.equal(r.compatible, true, JSON.stringify(r));
      assert.deepEqual(r.scale.slice(1), [1, 1]);
      assert.equal(r.runtimeStatus, 'runtime_pending_webgl');
      assert.equal(r.noNewWorldPlacement, true);
    }
  });
test('reference schema is distinct from an exported model package', () => {
  assert.equal(manifest.schemaVersion, 'vancouver-facade-fit-reference/v1');
  assert.equal(
    manifest.deliverableKind,
    'source-reference-adaptation-contract',
  );
  assert.equal(manifest.assets, undefined);
  assert.equal(contracts.size, 16);
});
test('no unknown, missing or new source slot gains a placement', () => {
  const f = fixture('modern-sill-drip');
  delete f.source.edgeKey;
  assert.equal(
    fitModule('modern-sill-drip', f).reason,
    'source-reference-missing',
  );
  assert.equal(
    fitModule('modern-sill-drip', {
      ...fixture('modern-sill-drip'),
      existingSlotId: 'new',
    }).reason,
    'existing-slot-required',
  );
  assert.throws(
    () => fitModule('not-a-model', fixture('modern-sill-drip')),
    /Unknown module/,
  );
});
test('every type rejects incompatible profiles, malformed dimensions and absent exclusion evidence', () => {
  for (const id of contracts.keys()) {
    const f = fixture(id);
    f.profile.kind = 'unknown-profile';
    assert.equal(fitModule(id, f).reason, 'profile-incompatible');
    const d = fixture(id);
    d.slot.widthM = NaN;
    assert.equal(fitModule(id, d).reason, 'invalid-dimensions');
    const e = fixture(id);
    delete e.entryExclusions;
    assert.equal(fitModule(id, e).reason, 'entry-exclusion-overlap');
  }
});
test('linear width limits are inclusive; cross-section does not stretch', () => {
  for (const id of [
    'modern-sill-drip',
    'heritage-cornice',
    'concrete-shadow-plinth',
  ]) {
    const c = contracts.get(id);
    for (const width of [c.widthFit.minM, c.widthFit.maxM]) {
      const f = fixture(id);
      f.slot.widthM = width;
      const r = fitModule(id, f);
      assert.equal(r.compatible, true);
      assert.deepEqual(r.scale.slice(1), [1, 1]);
    }
    const f = fixture(id);
    f.slot.widthM = c.widthFit.maxM + 0.001;
    assert.equal(fitModule(id, f).reason, 'width-out-of-range');
    const h = fixture(id);
    h.slot.heightM -= 0.005;
    assert.equal(fitModule(id, h).reason, 'cross-section-exceeds-slot');
  }
});
test('original sandstone 0.18 m is rejected, existing fitted 0.16 m variant fits', () => {
  const f = fixture('sandstone-sill');
  f.slot.heightM = 0.16;
  assert.equal(
    fitModule('sandstone-sill', f).reason,
    'cross-section-exceeds-slot',
  );
  assert.equal(
    fitModule('sandstone-sill', f, {
      existingVariantId: 'robson-sill-blender-candidate-v1',
    }).compatible,
    true,
  );
});
test('windows compare clear aperture dimensions, not outer dimensions', () => {
  for (const id of [
    'heritage-window-frame',
    'modern-recessed-window-surround',
    'residential-cedar-window-surround',
  ]) {
    const f = fixture(id);
    f.targetOpening.widthM = f.slot.widthM;
    assert.equal(fitModule(id, f).reason, 'opening-mismatch');
    const g = fixture(id);
    g.slot.widthM *= 1.1;
    assert.equal(fitModule(id, g).reason, 'width-out-of-range');
  }
});
test('physical glass-stop requirements match actual per-LOD geometry', () => {
  const legacy = fixture('heritage-window-frame');
  legacy.requiresPhysicalGlassStop = true;
  assert.equal(
    fitModule('heritage-window-frame', legacy).reason,
    'glass-stop-unavailable',
  );
  const modern = fixture('modern-recessed-window-surround');
  modern.requiresPhysicalGlassStop = true;
  for (const lod of [0, 1])
    assert.equal(
      fitModule('modern-recessed-window-surround', modern, { lod }).compatible,
      true,
    );
  const cedar = fixture('residential-cedar-window-surround');
  cedar.requiresPhysicalGlassStop = true;
  assert.equal(
    fitModule('residential-cedar-window-surround', cedar, { lod: 0 })
      .compatible,
    true,
  );
  assert.equal(
    fitModule('residential-cedar-window-surround', cedar, { lod: 1 }).reason,
    'glass-stop-unavailable',
  );
});
test('corner needs exterior right-angle adjacent edge and authored handedness', () => {
  for (const id of ['sandstone-corner', 'concrete-chamfer-corner']) {
    const atVertex = fixture(id);
    atVertex.source.alongM = 0;
    assert.equal(fitModule(id, atVertex).compatible, true);
    const shortReturn = fixture(id);
    shortReturn.corner.secondEdgeLengthM = 0.1;
    assert.equal(fitModule(id, shortReturn).reason, 'corner-frame-required');
    const f = fixture(id);
    f.corner.angleDegrees = 60;
    assert.equal(fitModule(id, f).reason, 'corner-frame-required');
    const g = fixture(id);
    g.corner.turn = 'concave';
    assert.equal(fitModule(id, g).reason, 'corner-frame-required');
    const h = fixture(id);
    h.corner.handedness = 'negative-x-return';
    assert.equal(fitModule(id, h).reason, 'corner-handedness-mismatch');
    const j = fixture(id);
    j.corner.mirror = true;
    assert.equal(fitModule(id, j).reason, 'corner-handedness-mismatch');
  }
});
test('parapet requires flat exposed roof, fitting insert and actual polygon/hole clearance', () => {
  const id = 'modern-parapet-cap';
  for (const mutate of [
    (f) => {
      f.roof.kind = 'pitched';
    },
    (f) => {
      f.roof.exposed = false;
    },
    (f) => {
      f.roof.roofEaveHeight = 10;
    },
    (f) => {
      f.roof.exclusionsM = [
        [
          [
            [-0.1, -0.1],
            [0.1, -0.1],
            [0.1, 0.1],
            [-0.1, 0.1],
          ],
        ],
      ];
    },
    (f) => {
      f.roof.polygonM.push([
        [-0.1, -0.1],
        [0.1, -0.1],
        [0.1, 0.1],
        [-0.1, 0.1],
      ]);
    },
  ]) {
    const f = fixture(id);
    mutate(f);
    assert.equal(fitModule(id, f).reason, 'roof-incompatible');
  }
  const f = fixture(id);
  f.roof.wallSection.zMaxM = 0.46;
  assert.equal(fitModule(id, f).reason, 'parapet-insert-mismatch');
});
test('entry exclusions and short source edges cannot be bypassed', () => {
  const f = fixture('modern-sill-drip');
  f.entryExclusions = [{ leftM: 5, rightM: 7, bottomM: 4, topM: 6 }];
  assert.equal(
    fitModule('modern-sill-drip', f).reason,
    'entry-exclusion-overlap',
  );
  const g = fixture('modern-sill-drip');
  g.source.alongM = 0.1;
  assert.equal(
    fitModule('modern-sill-drip', g).reason,
    'source-edge-too-short',
  );
});
test('source part and eave height interval is preserved', () => {
  const invalidPart = fixture('modern-parapet-cap');
  invalidPart.minHeightM = 20;
  assert.equal(
    fitModule('modern-parapet-cap', invalidPart).reason,
    'invalid-dimensions',
  );
  const noRow = fixture('residential-cedar-sill');
  delete noRow.windowRow;
  assert.equal(
    fitModule('residential-cedar-sill', noRow).reason,
    'invalid-dimensions',
  );
  const f = fixture('modern-sill-drip');
  f.minHeightM = 6;
  assert.equal(
    fitModule('modern-sill-drip', f).reason,
    'source-part-height-conflict',
  );
  const g = fixture('modern-sill-drip');
  g.wallTopM = 5.1;
  assert.equal(
    fitModule('modern-sill-drip', g).reason,
    'source-part-height-conflict',
  );
  const h = fixture('modern-sill-drip');
  h.wallTopM = Infinity;
  assert.equal(fitModule('modern-sill-drip', h).reason, 'invalid-dimensions');
});
test('domestic ground windows stay reserved for existing door shader', () => {
  const f = fixture('residential-cedar-sill');
  f.windowRow = 0;
  assert.equal(
    fitModule('residential-cedar-sill', f).reason,
    'domestic-ground-pane-reserved',
  );
});
test('actual pavement basis and three distinct finite sample IDs are required', () => {
  const f = fixture('residential-entry-surround');
  for (const values of [
    [0, 0],
    [0, null, 0],
    [0, Infinity, 0],
  ])
    assert.equal(
      groundThreshold({ ...f, pavement: pavement(values) }).reason,
      'pavement-samples-missing',
    );
  const duplicate = pavement();
  duplicate.samples[1].sampleId = duplicate.samples[0].sampleId;
  assert.equal(
    groundThreshold({ ...f, pavement: duplicate }).reason,
    'pavement-samples-missing',
  );
  const coincident = pavement();
  coincident.samples.forEach((s) => {
    s.alongM = 6;
  });
  assert.equal(
    groundThreshold({ ...f, pavement: coincident }).reason,
    'pavement-samples-missing',
  );
  const narrow = pavement();
  narrow.samples.forEach((s, i) => {
    s.alongM = 5.9 + i * 0.1;
  });
  assert.equal(
    groundThreshold({ ...f, pavement: narrow }).reason,
    'pavement-samples-missing',
  );
  assert.equal(
    groundThreshold({
      ...f,
      pavement: { ...pavement(), basis: 'raw-elevation' },
    }).reason,
    'pavement-provenance-required',
  );
});
test('0.14 m grade boundary and highest-sample +0.02 m threshold match current source', () => {
  const f = fixture('residential-entry-surround');
  assert.equal(
    groundThreshold({ ...f, pavement: pavement([0, 0.07, 0.14]) }).thresholdM,
    0.16,
  );
  assert.equal(
    groundThreshold({ ...f, pavement: pavement([0, 0.07, 0.140001]) }).reason,
    'pavement-grade-exceeded',
  );
  assert.equal(
    groundThreshold({ ...f, foundationM: 1 }).reason,
    'threshold-below-foundation',
  );
  assert.equal(
    groundThreshold({ ...f, minHeightM: 2 }).reason,
    'elevated-source-part',
  );
});
test('residential surround preserves 1.04 x 2.30 m clear opening', () => {
  const f = fixture('residential-entry-surround');
  f.targetOpening.heightM = 2.25;
  assert.equal(
    fitModule('residential-entry-surround', f).reason,
    'entry-clearance-mismatch',
  );
  const c = contracts.get('residential-entry-surround');
  assert.equal(c.opening.widthM, 1.04);
  assert.equal(c.opening.heightM, 2.3);
});
test('cedar canopy retains 2.36–3.10 ground datum, upper windows, roof and entry clearance', () => {
  const id = 'residential-gabled-entry-canopy',
    c = contracts.get(id);
  assert.deepEqual(c.constraints.preservedYRangeM, [2.36, 3.1]);
  const f = fixture(id);
  f.slot.authoringDatumOffsetM = -2.36;
  assert.equal(fitModule(id, f).reason, 'ground-datum-rebased');
  const g = fixture(id);
  g.row0SuppressedByExistingDoor = false;
  assert.equal(fitModule(id, g).reason, 'upper-window-conflict');
  const h = fixture(id);
  h.profile.groundStoreyM = -2;
  assert.equal(fitModule(id, h).reason, 'upper-window-conflict');
  const r = fixture(id);
  r.heightM = 3.3;
  assert.equal(fitModule(id, r).reason, 'roof-height-conflict');
  const e = fixture(id);
  e.targetOpening.heightM = 2.2;
  assert.equal(fitModule(id, e).reason, 'entry-clearance-mismatch');
});
function bayFixture(id) {
  const c = manifest.bayReferences.find((b) => b.id === id);
  const f = fixture('flat-metal-awning');
  return {
    ...f,
    profile: profile(
      id.startsWith('heritage') ? 'heritage-brick' : 'midrise-grid',
    ),
    widthM: c.lodReferences[0].measurements.boundsM.size[0],
  };
}
test('heritage/modern bay depth remains different and neither is walkable interior', () => {
  const h = fitBay('heritage-shop-bay', bayFixture('heritage-shop-bay'));
  const m = fitBay('modern-lobby-bay', bayFixture('modern-lobby-bay'));
  assert.equal(h.compatible, true);
  assert.equal(m.compatible, true);
  assert.ok(Math.abs(h.completeDepthM - 1.2207) < 0.0001);
  assert.ok(Math.abs(m.completeDepthM - 1.703) < 0.0001);
  assert.equal(h.walkableInterior, false);
  assert.equal(m.walkableInterior, false);
});
test('bay fit delegates current 3-point, slope and first-upper-window limit behavior', () => {
  for (const id of ['heritage-shop-bay', 'modern-lobby-bay']) {
    for (const values of [
      [0, 0, 0],
      [0, 0.07, 0.14],
      [0, 0.1, 0.140001],
      [2, 2, 2],
      [0, null, 0],
    ]) {
      const f = bayFixture(id);
      f.pavement = pavement(values);
      const original = streetBayThreshold(
        f.profile,
        f.heightM,
        0,
        f.foundationM,
        values,
      );
      const actual = fitBay(id, f);
      assert.equal(
        actual.compatible,
        original !== null,
        JSON.stringify({ id, values, actual, original }),
      );
      if (original !== null) assert.equal(actual.thresholdM, original);
    }
    const f = bayFixture(id);
    f.heightM = 3.3;
    assert.equal(fitBay(id, f).reason, 'roof-height-conflict');
  }
});
test('actual source examples are deterministic, valid selections, and honest about rejected window sizes', () => {
  const a = sourceExamples(),
    b = sourceExamples();
  assert.deepEqual(a, b);
  assert.deepEqual(a.counts, {
    total: 90,
    compatible: 88,
    rejected: 2,
    byVariant: { 'robson-sills': 56, 'modern-sills': 24, 'cedar-sills': 8 },
  });
  for (const r of a.results.filter(
    (r) => r.kind === 'source-selected-existing-upper-sill',
  )) {
    assert.equal(r.result.compatible, true);
    assert.ok(!('x' in r.input) && !('y' in r.input) && !('z' in r.input));
    if (r.originalUnfittedResult)
      assert.equal(
        r.originalUnfittedResult.reason,
        'cross-section-exceeds-slot',
      );
  }
  for (const r of a.results.filter(
    (r) => r.kind === 'source-opening-dimension-check',
  ))
    assert.equal(r.result.reason, 'opening-mismatch');
});
