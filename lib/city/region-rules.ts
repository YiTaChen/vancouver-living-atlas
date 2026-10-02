/** Named, source-audited display rules. These select appearance only; they never
 * edit source footprints, road topology, heights, foundations or collision.
 * The compatibility envelope is NOT an official Gastown/HA-2 boundary.
 * Provenance, exact source-ID cohorts and counts: docs/REGION_RULES.md.
 */
type Point = readonly [number, number];
type Bounds = readonly [minX: number, minZ: number, maxX: number, maxZ: number];
export interface SourceSelection {
  /** When omitted, retain the spatial/name selector for every source identity.
   * An empty allowlist intentionally matches nothing. IDs never bypass bounds. */
  include?: readonly string[];
  exclude?: readonly string[];
}
export interface RegionRules {
  gastown: {
    id: string;
    bounds: Bounds;
    facade: { maxHeightExclusive: number; sources?: SourceSelection };
    streetfront: {
      minHeightInclusive: number;
      maxHeightInclusive: number;
      maxMinHeightInclusive: number;
      sources?: SourceSelection;
    };
  };
  waterStreet: {
    id: string;
    name: string;
    allowCivicBlock: boolean;
    level: string;
    minLengthExclusive: number;
    sources?: SourceSelection;
  };
}
/** Empty source overrides are deliberate: this change preserves all legacy
 * selectors, including unknown future IDs. Audited source IDs are a regression
 * contract, not a claim of a surveyed heritage classification. */
export const CITY_REGION_RULES: RegionRules = {
  gastown: {
    id: 'gastown-legacy-appearance-envelope',
    bounds: [700, -70, 1850, 540],
    facade: { maxHeightExclusive: 48 },
    streetfront: {
      minHeightInclusive: 7,
      maxHeightInclusive: 34,
      maxMinHeightInclusive: 0,
    },
  },
  waterStreet: {
    id: 'water-street-ground-paving',
    name: 'WATER ST',
    allowCivicBlock: true,
    level: 'ground',
    minLengthExclusive: 0.1,
  },
};
export function normalizeRegionStreetName(name: string): string {
  return name
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}
function sourceSelector(selection?: SourceSelection) {
  const included = selection?.include && new Set(selection.include),
    excluded = new Set(selection?.exclude);
  return (ids: readonly string[]) =>
    !ids.some((id) => excluded.has(id)) &&
    (!included || ids.some((id) => included.has(id)));
}
/** Compile overrides once during preparation, never in an update/frame loop.
 * Only the supplied structure, polygon part or edge is inspected. */
export function createRegionSelectors(rules: RegionRules = CITY_REGION_RULES) {
  // Copy scalar configuration so later caller mutation cannot partially alter a
  // live selector; source-ID sets are likewise built once, without city scans.
  const [minX, minZ, maxX, maxZ] = rules.gastown.bounds,
    facadeMax = rules.gastown.facade.maxHeightExclusive,
    frontMin = rules.gastown.streetfront.minHeightInclusive,
    frontMax = rules.gastown.streetfront.maxHeightInclusive,
    frontBaseMax = rules.gastown.streetfront.maxMinHeightInclusive,
    facadeSource = sourceSelector(rules.gastown.facade.sources),
    frontSource = sourceSelector(rules.gastown.streetfront.sources),
    roadSource = sourceSelector(rules.waterStreet.sources),
    streetName = normalizeRegionStreetName(rules.waterStreet.name),
    allowBlock = rules.waterStreet.allowCivicBlock,
    level = rules.waterStreet.level,
    minLength = rules.waterStreet.minLengthExclusive;
  return {
    heritageFacade(structure: { key: string; center: Point; heightM: number }) {
      const [x, z] = structure.center;
      // Preserve the original strict facade boundary and height threshold.
      return (
        structure.heightM < facadeMax &&
        x > minX &&
        x < maxX &&
        z > minZ &&
        z < maxZ &&
        facadeSource([structure.key])
      );
    },
    heritageStreetfrontHeight(height: number, minHeight: number) {
      return !(
        minHeight > frontBaseMax ||
        height < frontMin ||
        height > frontMax
      );
    },
    heritageStreetfrontRegion(center: Point, sourceId: string) {
      const [x, z] = center;
      // The legacy polygon-part prefilter includes its boundary. The separate
      // structure profile remains authoritative before a storefront is built.
      return (
        !(x < minX || x > maxX || z < minZ || z > maxZ) &&
        frontSource([sourceId])
      );
    },
    waterStreetPaving(
      edge: {
        names: readonly string[];
        sourceIds?: readonly string[];
        length: number;
      },
      startLevel: string,
    ) {
      return (
        startLevel === level &&
        edge.length > minLength &&
        edge.names.some((name) => {
          const normalized = normalizeRegionStreetName(name),
            base = allowBlock
              ? normalized.replace(/^\d+(?:-\d+)? /, '')
              : normalized;
          return base === streetName;
        }) &&
        roadSource(edge.sourceIds ?? [])
      );
    },
  };
}
export const CITY_REGION_SELECTORS = createRegionSelectors();
