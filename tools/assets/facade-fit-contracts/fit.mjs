/** Fail-closed offline adapter. No scene imports, placements or new population. */
import fs from 'node:fs';
import { cityModule } from '../../../tests/helpers/city-modules.mjs';
const { streetBayThreshold } = await import(
  cityModule('streetscape-placement')
);
const { windowBounds, fitBays } = await import(cityModule('facade-profile'));
const { roofBoxFits } = await import(cityModule('architecture-plan'));
export const manifest = JSON.parse(
  fs.readFileSync(new URL('manifest.json', import.meta.url), 'utf8'),
);
export const contracts = new Map(
  manifest.moduleContracts.map((c) => [c.id, c]),
);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const positive = (v) => finite(v) && v > 0;
const EPS = 1e-6;
const reject = (reason) => ({
  compatible: false,
  reason,
  fallback: 'retain-existing-procedural-or-shader-detail',
  runtimeStatus: 'runtime_pending_webgl',
});
const accept = (details) => ({
  compatible: true,
  reason: null,
  status: 'offline-compatible-only',
  runtimeStatus: 'runtime_pending_webgl',
  ...details,
});

function sourceCheck(input) {
  const s = input?.source;
  if (
    !s ||
    !['structureId', 'featureId', 'edgeKey'].every(
      (k) => typeof s[k] === 'string' && s[k].length,
    )
  )
    return reject('source-reference-missing');
  if (!input.existingSlotId || input.existingSlotId === 'new')
    return reject('existing-slot-required');
  if (
    input.wallTopM !== undefined &&
    (!finite(input.wallTopM) ||
      input.wallTopM > input.heightM ||
      input.wallTopM <= input.minHeightM)
  )
    return reject('invalid-dimensions');
  if (
    !positive(s.edgeLengthM) ||
    !finite(s.alongM) ||
    !positive(input.heightM) ||
    !finite(input.minHeightM) ||
    input.minHeightM < 0 ||
    input.minHeightM >= input.heightM
  )
    return reject('invalid-dimensions');
  return null;
}

/** Caller must supply actual sidewalk samples. Test fixtures are labelled as
 * such in evidence; the string here never certifies where heights came from. */
export function groundThreshold(input) {
  if (input.minHeightM !== 0) return reject('elevated-source-part');
  if (!finite(input.foundationM) || !positive(input.heightM))
    return reject('invalid-dimensions');
  if (input.pavement?.basis !== 'rendered-surface-triangles')
    return reject('pavement-provenance-required');
  const samples = input.pavement.samples;
  if (
    !Array.isArray(samples) ||
    samples.length < 3 ||
    samples.some(
      (s) =>
        !finite(s?.heightM) ||
        !finite(s?.alongM) ||
        typeof s?.sampleId !== 'string' ||
        !s.sampleId,
    )
  )
    return reject('pavement-samples-missing');
  if (new Set(samples.map((s) => s.sampleId)).size !== samples.length)
    return reject('pavement-samples-missing');
  const span = input.widthM ?? input.slot?.widthM;
  const along = input.source?.alongM;
  if (
    !positive(span) ||
    !finite(along) ||
    new Set(samples.map((s) => s.alongM)).size < 3 ||
    Math.min(...samples.map((s) => s.alongM)) > along - span / 2 + EPS ||
    Math.max(...samples.map((s) => s.alongM)) < along + span / 2 - EPS ||
    !samples.some((s) => Math.abs(s.alongM - along) < 0.001)
  )
    return reject('pavement-samples-missing');
  const heights = samples.map((s) => s.heightM);
  // Keep exact existing threshold comparison, including its floating-point
  // boundary behavior. Do not secretly loosen 0.14 to another slope limit.
  if (Math.max(...heights) - Math.min(...heights) > 0.14)
    return reject('pavement-grade-exceeded');
  const thresholdM = Math.max(...heights) + 0.02;
  if (thresholdM < input.foundationM)
    return reject('threshold-below-foundation');
  return accept({
    thresholdM,
    thresholdAboveFoundationM: thresholdM - input.foundationM,
  });
}

function windowCeiling(input, domesticDoor) {
  const p = input.profile;
  const row = domesticDoor ? 1 : 0;
  if (domesticDoor && input.row0SuppressedByExistingDoor !== true) return null;
  if (
    !p ||
    !positive(p.storeyM) ||
    !finite(p.groundStoreyM) ||
    !Array.isArray(p.pane) ||
    p.pane.length !== 4 ||
    !p.pane.every(finite)
  )
    return null;
  const grid = fitBays(p, input.source.edgeLengthM);
  if (!grid.count) return null;
  const bounds = windowBounds(p, grid, 0, row);
  return bounds.bottom - (p.kind === 'heritage-brick' ? 0.19 : 0.15);
}

export function fitModule(id, input, options = {}) {
  const c = contracts.get(id);
  if (!c) throw new Error(`Unknown module contract: ${id}`);
  const badSource = sourceCheck(input);
  if (badSource) return badSource;
  if (!c.profiles.includes(input.profile?.kind))
    return reject('profile-incompatible');
  if (
    ['sill', 'window-frame'].includes(c.role) &&
    (!Number.isInteger(input.windowRow) || input.windowRow < 0)
  )
    return reject('invalid-dimensions');
  const lod = options.lod ?? 0;
  let ref = c.lodReferences.find((l) => l.level === lod);
  let widthFit = c.widthFit;
  if (options.existingVariantId !== undefined) {
    const variant = manifest.existingVariantReferences.find(
      (v) => v.id === options.existingVariantId && v.moduleId === id,
    );
    if (!variant) return reject('source-reference-missing');
    ref = variant.lodReferences.find((l) => l.level === lod);
    widthFit = {
      ...widthFit,
      minM: variant.widthRangeM[0],
      maxM: variant.widthRangeM[1],
    };
  }
  if (!ref) return reject('invalid-dimensions');
  const b = ref.measurements.boundsM;
  const slot = input.slot;
  if (
    !slot ||
    !['widthM', 'heightM', 'depthM'].every((k) => positive(slot[k])) ||
    !finite(slot.datumYAboveFoundationM)
  )
    return reject('invalid-dimensions');
  if (
    slot.datumIdentity !== c.attachmentDatum.yIdentity ||
    (c.constraints.requiresPavement && slot.authoringDatumOffsetM !== 0)
  )
    return reject('ground-datum-rebased');
  if (slot.widthM < widthFit.minM - EPS || slot.widthM > widthFit.maxM + EPS)
    return reject('width-out-of-range');
  const along = input.source.alongM;
  const left = c.role === 'corner' ? along + b.min[0] : along - slot.widthM / 2;
  const right =
    c.role === 'corner' ? along + b.max[0] : along + slot.widthM / 2;
  if (left < -EPS || right > input.source.edgeLengthM + EPS)
    return reject('source-edge-too-short');
  if (
    b.size[1] > slot.heightM + widthFit.dimensionToleranceM ||
    b.size[2] > slot.depthM + widthFit.dimensionToleranceM
  )
    return reject('cross-section-exceeds-slot');
  if (
    input.profile.kind === 'domestic-cladding' &&
    input.windowRow === 0 &&
    !c.constraints.domesticGroundPaneAllowed
  )
    return reject('domestic-ground-pane-reserved');
  if (['window', 'door'].includes(c.opening?.kind)) {
    if (
      !input.targetOpening ||
      !positive(input.targetOpening.widthM) ||
      !positive(input.targetOpening.heightM) ||
      Math.abs(input.targetOpening.widthM - c.opening.widthM) > 0.0001 ||
      Math.abs(input.targetOpening.heightM - c.opening.heightM) > 0.0001
    )
      return reject(
        c.opening.kind === 'door'
          ? 'entry-clearance-mismatch'
          : 'opening-mismatch',
      );
  }
  if (input.requiresPhysicalGlassStop && !c.glazing.stopByLOD[String(lod)])
    return reject('glass-stop-unavailable');
  if (c.role === 'corner') {
    const corner = input.corner;
    if (
      !corner ||
      !positive(corner.secondEdgeLengthM) ||
      corner.secondEdgeLengthM < b.max[2] - EPS ||
      !corner.secondEdgeKey ||
      corner.secondEdgeKey === input.source.edgeKey ||
      corner.turn !== 'exterior' ||
      !finite(corner.angleDegrees) ||
      Math.abs(corner.angleDegrees - 90) > c.handedness.angleToleranceDegrees
    )
      return reject('corner-frame-required');
    if (corner.handedness !== c.handedness.mode || corner.mirror === true)
      return reject('corner-handedness-mismatch');
  }
  if (c.role === 'parapet') {
    const roof = input.roof;
    if (
      !roof ||
      roof.kind !== 'flat' ||
      roof.exposed !== true ||
      input.profile.kind === 'domestic-cladding' ||
      roof.roofEaveHeight !== undefined ||
      !Array.isArray(roof.polygonM) ||
      !Array.isArray(roof.exclusionsM) ||
      ![roof.centerXM, roof.centerZM, roof.yaw].every(finite)
    )
      return reject('roof-incompatible');
    try {
      if (
        !roofBoxFits(
          roof.polygonM,
          roof.centerXM,
          roof.centerZM,
          slot.widthM,
          b.size[2],
          roof.yaw,
          roof.exclusionsM,
        )
      )
        return reject('roof-incompatible');
    } catch {
      return reject('roof-incompatible');
    }
    const insert = c.constraints.parapetInsert;
    const section = roof.wallSection;
    if (
      !section ||
      ![section.zMinM, section.zMaxM, section.heightM].every(finite) ||
      section.zMaxM <= section.zMinM ||
      section.heightM <= 0 ||
      section.zMinM < insert.zMinM - EPS ||
      section.zMaxM > insert.zMaxM + EPS ||
      section.heightM > insert.maxHeightM + EPS
    )
      return reject('parapet-insert-mismatch');
  }
  let y = slot.datumYAboveFoundationM;
  let threshold = null;
  if (c.constraints.requiresPavement) {
    threshold = groundThreshold(input);
    if (!threshold.compatible) return threshold;
    y = threshold.thresholdAboveFoundationM;
    if (Math.abs(y - slot.datumYAboveFoundationM) > 0.0001)
      return reject('ground-datum-rebased');
    const domesticDoor =
      input.profile.kind === 'domestic-cladding' &&
      ['entrance', 'awning'].includes(c.role);
    const ceiling = windowCeiling(input, domesticDoor);
    if (ceiling === null || y + b.max[1] > ceiling + EPS)
      return reject('upper-window-conflict');
    if (y + b.max[1] > input.heightM - 0.3 + EPS)
      return reject('roof-height-conflict');
    if (c.constraints.minimumEntryClearanceM) {
      const opening = input.targetOpening;
      if (
        !opening ||
        !finite(opening.widthM) ||
        !finite(opening.heightM) ||
        opening.widthM < 1.04 - EPS ||
        opening.heightM < 2.3 - EPS
      )
        return reject('entry-clearance-mismatch');
    }
  }
  if (
    c.role !== 'parapet' &&
    (y + b.min[1] < input.minHeightM - EPS ||
      y + b.max[1] > (input.wallTopM ?? input.heightM) + EPS)
  )
    return reject('source-part-height-conflict');
  if (!Array.isArray(input.entryExclusions))
    return reject('entry-exclusion-overlap');
  for (const exclusion of input.entryExclusions) {
    if (
      !['leftM', 'rightM', 'bottomM', 'topM'].every((k) =>
        finite(exclusion[k]),
      ) ||
      exclusion.leftM >= exclusion.rightM ||
      exclusion.bottomM >= exclusion.topM
    )
      return reject('entry-exclusion-overlap');
    if (
      left < exclusion.rightM - EPS &&
      right > exclusion.leftM + EPS &&
      y + b.min[1] < exclusion.topM - EPS &&
      y + b.max[1] > exclusion.bottomM + EPS
    )
      return reject('entry-exclusion-overlap');
  }
  return accept({
    moduleId: id,
    source: input.source,
    lod,
    glbSha256: ref.glb.sha256,
    scale: [widthFit.mode === 'fixed' ? 1 : slot.widthM / b.size[0], 1, 1],
    attachmentDatum: c.attachmentDatum,
    ...(threshold
      ? { thresholdAboveFoundationM: threshold.thresholdAboveFoundationM }
      : {}),
    noNewWorldPlacement: true,
  });
}

/** Bay height test delegates to the current production pure function, rather
 * than copying a more permissive version. Complete bay depth remains distinct. */
export function fitBay(id, input) {
  const bay = manifest.bayReferences.find((b) => b.id === id);
  if (!bay) throw new Error(`Unknown bay ${id}`);
  const badSource = sourceCheck(input);
  if (badSource) return badSource;
  const heritage = id === 'heritage-shop-bay';
  if (
    heritage
      ? input.profile?.kind !== 'heritage-brick'
      : ![
          'lowrise-masonry',
          'midrise-grid',
          'curtain-wall',
          'balcony-slab',
        ].includes(input.profile?.kind)
  )
    return reject('profile-incompatible');
  if (
    !Array.isArray(input.profile.pane) ||
    input.profile.pane.length !== 4 ||
    !input.profile.pane.every(finite) ||
    !positive(input.profile.storeyM) ||
    !finite(input.profile.groundStoreyM)
  )
    return reject('invalid-dimensions');
  const bounds = bay.lodReferences[0].measurements.boundsM;
  if (
    !positive(input.widthM) ||
    Math.abs(input.widthM - bounds.size[0]) > 0.0001
  )
    return reject('width-out-of-range');
  if (
    input.source.alongM - bounds.size[0] / 2 < 0 ||
    input.source.alongM + bounds.size[0] / 2 > input.source.edgeLengthM
  )
    return reject('source-edge-too-short');
  const ground = groundThreshold(input);
  if (!ground.compatible) return ground;
  const threshold = streetBayThreshold(
    input.profile,
    input.heightM,
    input.minHeightM,
    input.foundationM,
    input.pavement.samples.map((s) => s.heightM),
  );
  if (threshold === null) {
    if (ground.thresholdAboveFoundationM + 3.2 > input.heightM - 0.3)
      return reject('roof-height-conflict');
    return reject('upper-window-conflict');
  }
  return accept({
    bayId: id,
    checksScope:
      'fixed width and current streetBayThreshold only; source-eligibility and canopy-tip gates pending',
    thresholdM: threshold,
    scale: [1, 1, 1],
    completeDepthM: bounds.size[2],
    walkableInterior: false,
  });
}
