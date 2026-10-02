// Offline-only audit. No city dataset or audit inventory is imported by runtime.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cityModule } from './city-modules.mjs';
export const { project, rings } = await import(cityModule('geo'));
export const { replacedBuilding } = await import(
  cityModule('replaced-buildings')
);
export const { structureKey, summarizeStructures, createProfile } =
  await import(cityModule('facade-profile'));
export const { cityRoadGraph } = await import(cityModule('street-layout'));
export const { heritageFrames } = await import(cityModule('heritage-paving'));
export const {
  CITY_REGION_RULES,
  CITY_REGION_SELECTORS,
  createRegionSelectors,
} = await import(cityModule('region-rules'));
export const data = {};
export const fingerprints = {};
for (const [name, path] of Object.entries({
  buildings: 'buildings.geojson',
  roads: 'roads.geojson',
  trees: 'trees.json',
})) {
  const bytes = readFileSync(
    new URL(`../../public/data/${path}`, import.meta.url),
  );
  data[name] = JSON.parse(bytes);
  fingerprints[`public/data/${path}`] = createHash('sha256')
    .update(bytes)
    .digest('hex');
}
// Frozen legacy predicates: keep independent of production rules/configuration.
export const legacyFacade = ({ center: [x, z], heightM }) =>
  heightM < 48 && x > 700 && x < 1850 && z > -70 && z < 540;
export const legacyFrontHeight = (height, minHeight) =>
  !(minHeight > 0 || height < 7 || height > 34);
export const legacyFrontRegion = ([x, z]) =>
  !(x < 700 || x > 1850 || z < -70 || z > 540);
export const legacyPaving = (edge, level) =>
  edge.names.some((name) =>
    /^(?:\d+(?:-\d+)? )?WATER ST$/i.test(
      name
        .trim()
        .replace(/[–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' '),
    ),
  ) &&
  level === 'ground' &&
  edge.length > 0.1;

// Mirrors only the existing source-part preparation contract, before body geometry
// and collision creation. Retains every polygon part and the original centroids.
export function prepareParts(features) {
  const parts = [];
  for (const feature of features) {
    const p = feature.properties,
      heightM = Math.max(2, Number(p.height ?? p.hgt_agl ?? 8)),
      minHeightM = Math.max(0, Number(p.minHeight) || 0);
    if (
      !Number.isFinite(heightM) ||
      heightM > 350 ||
      minHeightM >= heightM ||
      replacedBuilding(p)
    )
      continue;
    rings(feature).forEach((polygon, index) => {
      const ring = polygon[0].slice(0, -1).map(project);
      if (ring.length < 3) return;
      const center = [
        ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
        ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
      ];
      const footprintAreaM2 =
        Math.abs(
          ring.reduce((sum, a, i) => {
            const b = ring[(i + 1) % ring.length];
            return sum + a[0] * b[1] - b[0] * a[1];
          }, 0),
        ) / 2;
      const key = structureKey(
        p,
        ring
          .map((q) => q.map((n) => n.toFixed(3)).join(','))
          .sort()
          .join(';'),
      );
      parts.push({
        structureId: key,
        key,
        heightM,
        minHeightM,
        footprintAreaM2,
        center,
        feature,
        partId: `${String(p.id)}#${index}`,
      });
    });
  }
  return parts;
}
export function streetfrontCandidates(
  features,
  structures,
  selectors = CITY_REGION_SELECTORS,
) {
  const found = [];
  for (const feature of features) {
    const p = feature.properties;
    if (
      replacedBuilding(p) ||
      !selectors.heritageStreetfrontHeight(p.height, p.minHeight)
    )
      continue;
    const key = String(p.structureId ?? p.buildingId ?? p.id);
    for (const [index, polygon] of rings(feature).entries()) {
      const ring = polygon[0].slice(0, -1).map(project),
        center = ring.reduce(
          (a, point) => [
            a[0] + point[0] / ring.length,
            a[1] + point[1] / ring.length,
          ],
          [0, 0],
        );
      if (!selectors.heritageStreetfrontRegion(center, key)) continue;
      const structure = structures.get(key);
      if (!structure || !selectors.heritageFacade(structure)) continue;
      found.push({ partId: `${String(p.id)}#${index}`, key });
    }
  }
  return found.sort((a, b) => a.partId.localeCompare(b.partId));
}
export const sorted = (values) =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
export function inventory() {
  const parts = prepareParts(data.buildings.features),
    structures = summarizeStructures(parts),
    legacy = {
      heritageFacade: legacyFacade,
      heritageStreetfrontHeight: legacyFrontHeight,
      heritageStreetfrontRegion: legacyFrontRegion,
    },
    facades = [...structures.values()].filter(legacyFacade),
    fronts = streetfrontCandidates(data.buildings.features, structures, legacy),
    graph = cityRoadGraph(data.roads, data.trees.trees),
    edges = graph.edges.filter((edge) =>
      legacyPaving(edge, graph.nodes[edge.a].level),
    );
  const byId = new Map(
    data.buildings.features.map((f) => [String(f.properties.id), f]),
  );
  return {
    sourceCommit: 'a1364e932195e7c7e0dce093e40e1c94ecb94bcb',
    fingerprints,
    facade: {
      evaluatedStructures: structures.size,
      matchedStructures: facades.length,
      matchedPolygonParts: parts.filter((p) =>
        legacyFacade(structures.get(p.key)),
      ).length,
      structureIds: sorted(facades.map((s) => s.key)),
      heightExcludedInsideEnvelope: sorted(
        [...structures.values()]
          .filter((s) => legacyFrontRegion(s.center) && s.heightM >= 48)
          .map((s) => s.key),
      ),
    },
    streetfront: {
      matchedCandidatePolygonParts: fronts.length,
      matchedCandidateStructures: sorted(fronts.map((f) => f.key)).length,
      partIds: fronts.map((f) => f.partId),
      structureIds: sorted(fronts.map((f) => f.key)),
      upstreamSourceIds: sorted(
        fronts.flatMap((f) => {
          const p = byId.get(f.partId.split('#')[0]).properties;
          return p.sourceIds ?? [String(p.id)];
        }),
      ),
    },
    paving: {
      evaluatedGraphEdges: graph.edges.length,
      matchedGraphEdges: edges.length,
      sourceIds: sorted(edges.flatMap((e) => e.sourceIds)),
      sourceNames: sorted(edges.flatMap((e) => e.names)),
      edgeIds: edges.map((e) => e.id),
    },
  };
}
