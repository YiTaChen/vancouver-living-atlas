/** Reproducible actual source-edge examples; no browser/live-ground claim. */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cityModule } from '../../../tests/helpers/city-modules.mjs';
import {
  data,
  prepareParts,
  summarizeStructures,
  createProfile,
  project,
  rings,
} from '../../../tests/helpers/region-rule-audit.mjs';
import { contracts, manifest, fitModule } from './fit.mjs';
const { selectArchitectureCandidateSills } = await import(
  cityModule('architecture-module-candidate')
);
const { planPitchedRoof } = await import(cityModule('building-roof'));
const { fitBays, windowBounds } = await import(cityModule('facade-profile'));

export function sourceExamples() {
  const prepared = prepareParts(data.buildings.features);
  const structures = summarizeStructures(prepared);
  const profiles = new Map(
    [...structures].map(([key, value]) => [key, createProfile(value)]),
  );
  const count = new Map();
  for (const p of prepared) count.set(p.key, (count.get(p.key) ?? 0) + 1);
  const parts = prepared.map((p) => {
    const raw = rings(p.feature)[Number(p.partId.split('#').at(-1))];
    const polygon = raw.map((r) => r.slice(0, -1).map(project));
    const roof = planPitchedRoof(
      polygon,
      p.heightM,
      p.minHeightM,
      p.feature.properties.roof,
      p.feature.properties.source,
      count.get(p.key),
    );
    return {
      key: p.key,
      polygon,
      ground: 0,
      height: p.heightM,
      minHeight: p.minHeightM,
      profile: profiles.get(p.key),
      roof: true,
      ...(roof ? { roofEaveHeight: roof.eaveHeight } : {}),
      featureId: String(p.feature.properties.id),
    };
  });
  const results = [];
  for (const [variant, id] of [
    ['robson-sills', 'sandstone-sill'],
    ['modern-sills', 'modern-sill-drip'],
    ['cedar-sills', 'residential-cedar-sill'],
  ]) {
    const selected = selectArchitectureCandidateSills(parts, variant);
    for (const [index, item] of [...selected.values()].entries()) {
      const { part, box, sourceKey, edgeKey } = item;
      const edge = part.polygon[0]
        .map((a, i, ring) => [a, ring[(i + 1) % ring.length]])
        .find(
          ([a, b]) =>
            [a, b]
              .map((p) => p.map((n) => n.toFixed(3)).join(','))
              .sort((x, y) => x.localeCompare(y))
              .join('|') === edgeKey,
        );
      if (!edge)
        throw new Error('Selected edge did not resolve in its source polygon');
      const [a, b] = edge,
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      const c = contracts.get(id);
      const chosen =
        variant === 'robson-sills'
          ? manifest.existingVariantReferences[0].lodReferences[0]
          : c.lodReferences[0];
      const bounds = chosen.measurements.boundsM;
      const sourceNormalOffset =
        (box.x - a[0]) * (dz / length) - (box.z - a[1]) * (dx / length);
      const signedArea = part.polygon[0].reduce((sum, p, i, ring) => {
        const q = ring[(i + 1) % ring.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0);
      const outwardOffset = sourceNormalOffset * (signedArea > 0 ? 1 : -1);
      const input = {
        source: {
          structureId: sourceKey,
          featureId: part.featureId,
          edgeKey,
          edgeLengthM: length,
          alongM: ((box.x - a[0]) * dx + (box.z - a[1]) * dz) / length,
        },
        existingSlotId: `${variant}:existing-planner-sill:${index}`,
        profile: part.profile,
        heightM: part.height,
        wallTopM: part.roofEaveHeight ?? part.height,
        minHeightM: part.minHeight,
        windowRow: Math.round(
          (box.y +
            0.035 -
            part.profile.groundStoreyM -
            part.profile.pane[2] * part.profile.storeyM) /
            part.profile.storeyM,
        ),
        entryExclusions: [],
        slot: {
          widthM: box.width,
          heightM: box.height,
          depthM: box.depth,
          datumYAboveFoundationM: box.y - (bounds.min[1] + bounds.max[1]) / 2,
          datumIdentity: 'component-bottom',
          datumOffsetFromSourceWallM:
            outwardOffset - (bounds.min[2] + bounds.max[2]) / 2,
          alignmentBasis:
            'same root placement as current candidate: existing box center minus authored bounds center',
        },
      };
      const options =
        variant === 'robson-sills'
          ? { existingVariantId: 'robson-sill-blender-candidate-v1' }
          : {};
      results.push({
        kind: 'source-selected-existing-upper-sill',
        variant,
        moduleId: id,
        input,
        result: fitModule(id, input, options),
        ...(variant === 'robson-sills'
          ? { originalUnfittedResult: fitModule(id, input) }
          : {}),
        provenance: {
          selector:
            'lib/city/architecture-module-candidate.ts:selectArchitectureCandidateSills',
          sourceDataset: 'public/data/buildings.geojson',
          planner: 'lib/city/architecture-plan.ts:architectureWork',
          ground:
            'foundation normalized to zero for scalar fit; no pavement/world Y accepted',
          gateLimit:
            'Source selector only. Production cell-cap admission, rendered pavement and visual acceptance are NOT evaluated.',
        },
      });
    }
  }
  // A modelled opening cannot be resized to the actual source shader's opening.
  // Show source-derived rejected matches instead of inventing successful frames.
  for (const [key, id] of [
    ['145639', 'modern-recessed-window-surround'],
    ['145755', 'residential-cedar-window-surround'],
  ]) {
    const sample = results.find((r) => r.input.source.structureId === key);
    if (!sample) throw new Error(`Missing existing source sample ${key}`);
    const input = structuredClone(sample.input);
    const c = contracts.get(id),
      b = c.lodReferences[0].measurements.boundsM;
    const grid = fitBays(input.profile, input.source.edgeLengthM);
    const opening = windowBounds(input.profile, grid, 0, 1);
    input.existingSlotId = `${key}:source-window-assembly:row1:bay0`;
    input.source.alongM = (opening.left + opening.right) / 2;
    input.windowRow = 1;
    input.targetOpening = {
      widthM: opening.right - opening.left,
      heightM: opening.top - opening.bottom,
    };
    input.slot = {
      widthM: b.size[0],
      heightM: b.size[1],
      depthM: b.size[2],
      datumYAboveFoundationM: opening.bottom - c.opening.boundsM.min[1],
      datumIdentity: 'component-bottom',
    };
    results.push({
      kind: 'source-opening-dimension-check',
      moduleId: id,
      input,
      result: fitModule(id, input),
      provenance: {
        sourceDataset: 'public/data/buildings.geojson',
        opening: 'lib/city/facade-profile.ts:fitBays/windowBounds, bay=0,row=1',
        gateLimit:
          'Dimension comparison only. Single-source geometry replacement/merging is still unimplemented.',
      },
    });
  }
  return {
    status: 'pass',
    scope:
      'Deterministic source selection and local scalar fit only; no placement or runtime acceptance',
    counts: {
      total: results.length,
      compatible: results.filter((r) => r.result.compatible).length,
      rejected: results.filter((r) => !r.result.compatible).length,
      byVariant: Object.fromEntries(
        ['robson-sills', 'modern-sills', 'cedar-sills'].map((v) => [
          v,
          results.filter((r) => r.variant === v).length,
        ]),
      ),
    },
    results,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = sourceExamples();
  if (process.argv.includes('--write'))
    fs.writeFileSync(
      new URL('qa/source-examples.json', import.meta.url),
      JSON.stringify(report, null, 2) + '\n',
    );
  console.log(
    JSON.stringify(
      process.argv.includes('--summary') ? report.counts : report,
      null,
      2,
    ),
  );
}
