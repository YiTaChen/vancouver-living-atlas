/** Original, dependency-free facade layout prototype. All distances are metres.
 * Styles are representative geometry, not classifications of actual building use.
 * This module never changes geographic footprints, foundation, or source heights.
 */
export type FacadeKind =
  | 'heritage-brick'
  | 'lowrise-masonry'
  | 'midrise-grid'
  | 'balcony-slab'
  | 'curtain-wall';
export type Identity = {
  structureId?: string | number;
  buildingId?: string | number;
  id?: string | number;
};
export type Part = Identity & {
  geometryKey?: string;
  heightM: number;
  minHeightM: number;
  footprintAreaM2: number;
  center: readonly [number, number];
};
export type Structure = {
  key: string;
  heightM: number;
  footprintAreaM2: number;
  center: readonly [number, number];
};
export type Profile = Readonly<{
  kind: FacadeKind;
  styleIndex: number;
  targetBayM: number;
  storeyM: number;
  groundStoreyM: number;
  edgeMarginM: number;
  pane: readonly [left: number, right: number, bottom: number, top: number];
  wallRoughness: number;
  glassRoughness: number;
  brickNormalScale: number;
  brickTileM: number;
  frameWidthM: number;
  frameDepthM: number;
  balconies: boolean;
  wallColor: number;
  seed: number;
}>;
type Template = Omit<Profile, 'wallColor' | 'seed'> & {
  colors: readonly number[];
};
export const facadeTemplates: readonly Template[] = [
  {
    kind: 'heritage-brick',
    styleIndex: 0,
    targetBayM: 3.1,
    storeyM: 3.25,
    groundStoreyM: 4.35,
    edgeMarginM: 0.4,
    pane: [0.15, 0.85, 0.2, 0.84],
    wallRoughness: 0.86,
    glassRoughness: 0.3,
    brickNormalScale: 0.25,
    brickTileM: 1.728,
    frameWidthM: 0.13,
    frameDepthM: 0.16,
    balconies: false,
    colors: [0xa6816d, 0x91877c, 0xac8977],
  },
  {
    kind: 'lowrise-masonry',
    styleIndex: 1,
    targetBayM: 3.3,
    storeyM: 3.1,
    groundStoreyM: 4.25,
    edgeMarginM: 0.45,
    pane: [0.16, 0.84, 0.23, 0.83],
    wallRoughness: 0.84,
    glassRoughness: 0.32,
    brickNormalScale: 0.18,
    brickTileM: 1.728,
    frameWidthM: 0.1,
    frameDepthM: 0.09,
    balconies: false,
    colors: [0xb5ab98, 0xb0ada0, 0xa19786],
  },
  {
    kind: 'midrise-grid',
    styleIndex: 2,
    targetBayM: 3.4,
    storeyM: 3.35,
    groundStoreyM: 4.25,
    edgeMarginM: 0.3,
    pane: [0.1, 0.9, 0.19, 0.86],
    wallRoughness: 0.78,
    glassRoughness: 0.28,
    brickNormalScale: 0,
    brickTileM: 1.728,
    frameWidthM: 0.1,
    frameDepthM: 0.1,
    balconies: false,
    colors: [0xafb6b1, 0xabb6b8, 0xb5b3a5],
  },
  {
    kind: 'balcony-slab',
    styleIndex: 3,
    targetBayM: 3.4,
    storeyM: 3.1,
    groundStoreyM: 4.35,
    edgeMarginM: 0.3,
    pane: [0.1, 0.9, 0.16, 0.87],
    wallRoughness: 0.76,
    glassRoughness: 0.27,
    brickNormalScale: 0,
    brickTileM: 1.728,
    frameWidthM: 0.08,
    frameDepthM: 0.08,
    balconies: true,
    colors: [0x9faba7, 0xb7b9ab, 0x9eadaf],
  },
  {
    kind: 'curtain-wall',
    styleIndex: 4,
    targetBayM: 2.8,
    storeyM: 3.65,
    groundStoreyM: 4.5,
    edgeMarginM: 0.15,
    pane: [0.04, 0.96, 0.13, 0.9],
    wallRoughness: 0.63,
    glassRoughness: 0.23,
    brickNormalScale: 0,
    brickTileM: 1.728,
    frameWidthM: 0.065,
    frameDepthM: 0.075,
    balconies: false,
    colors: [0x96acaf, 0x8d9fa5, 0xa1b1b0],
  },
];
function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
export function hashId(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++)
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function structureKey(identity: Identity, geometryKey?: string): string {
  const id = identity.structureId ?? identity.buildingId ?? identity.id;
  if (id !== undefined && id !== null && String(id).length) return String(id);
  // Caller may canonicalize a quantized footprint for missing source IDs. Never use array order.
  if (geometryKey) return `geometry:${geometryKey}`;
  throw new Error('A stable source ID or canonical geometry key is required');
}
/** Pick a deterministic representative footprint; do not sum overlapping building parts. */
export function summarizeStructures(
  parts: readonly Part[],
): Map<string, Structure> {
  const groups = new Map<string, Part[]>();
  for (const part of parts) {
    if (
      !(
        finite(part.heightM, 'height') > finite(part.minHeightM, 'minHeight')
      ) ||
      part.minHeightM < 0
    )
      throw new Error('A building part must have 0 <= minHeight < height');
    finite(part.footprintAreaM2, 'footprint area');
    part.center.forEach((n) => finite(n, 'center'));
    const key = structureKey(part, part.geometryKey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(part);
  }
  const result = new Map<string, Structure>();
  for (const [key, list] of groups) {
    const ground = list.filter((p) => p.minHeightM === 0);
    const selected = [...(ground.length ? ground : list)].sort(
      (a, b) =>
        b.footprintAreaM2 - a.footprintAreaM2 ||
        a.center[0] - b.center[0] ||
        a.center[1] - b.center[1],
    )[0];
    result.set(key, {
      key,
      heightM: Math.max(...list.map((p) => p.heightM)),
      footprintAreaM2: Math.max(0, selected.footprintAreaM2),
      center: [...selected.center],
    });
  }
  return result;
}
export function createProfile(structure: Structure): Profile {
  const {
    key,
    heightM: h,
    footprintAreaM2: area,
    center: [x, z],
  } = structure;
  [h, area, x, z].forEach((n) => finite(n, 'structure'));
  const hash = hashId(key),
    heritage = h < 48 && x > 700 && x < 1850 && z > -70 && z < 540;
  const index = heritage
    ? 0
    : h < 18
      ? 1
      : h < 48
        ? 2
        : h < 180 && area < 1800 && hash % 100 < 55
          ? 3
          : 4;
  const { colors, ...template } = facadeTemplates[index];
  return Object.freeze({
    ...template,
    wallColor: colors[hash % colors.length],
    seed: hash % 4096,
  });
}
export type BayGrid = {
  count: number;
  pitchM: number;
  originM: number;
  endM: number;
};
/** Symmetric margins make physical pane positions invariant under an edge reversal. */
export function fitBays(profile: Profile, lengthM: number): BayGrid {
  finite(lengthM, 'edge length');
  const span = lengthM - 2 * profile.edgeMarginM;
  if (span < profile.targetBayM * 0.65)
    return {
      count: 0,
      pitchM: profile.targetBayM,
      originM: lengthM / 2,
      endM: lengthM / 2,
    };
  const count = Math.max(1, Math.round(span / profile.targetBayM));
  return {
    count,
    pitchM: span / count,
    originM: profile.edgeMarginM,
    endM: lengthM - profile.edgeMarginM,
  };
}
export type Extent = { minHeightM: number; heightM: number };
export type WindowBounds = {
  bay: number;
  row: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
};
export function windowBounds(
  profile: Profile,
  grid: BayGrid,
  bay: number,
  row: number,
): WindowBounds {
  const [left, right, bottom, top] = profile.pane;
  return {
    bay,
    row,
    left: grid.originM + (bay + left) * grid.pitchM,
    right: grid.originM + (bay + right) * grid.pitchM,
    bottom: profile.groundStoreyM + (row + bottom) * profile.storeyM,
    top: profile.groundStoreyM + (row + top) * profile.storeyM,
  };
}
/** All parts use the structure's phase, while partial windows at part bounds are omitted. */
export function windowRows(profile: Profile, extent: Extent): number[] {
  const start = Math.max(
    0,
    Math.ceil(
      (extent.minHeightM - profile.groundStoreyM) / profile.storeyM -
        profile.pane[2] -
        1e-9,
    ),
  );
  const end = Math.floor(
    (extent.heightM - profile.groundStoreyM) / profile.storeyM -
      profile.pane[3] +
      1e-9,
  );
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, i) => start + i,
  );
}
/** Wall UV must be physical foundation-relative height, including elevated parts. */
export function wallV(extent: Extent, fraction: number): number {
  return extent.minHeightM + fraction * (extent.heightM - extent.minHeightM);
}
/** Hard-edged CPU equivalent of the single shader mask (shader adds fwidth AA once).
 * Reuse this one mask for albedo, roughness, emissive, and brick-normal exclusion.
 */
export function sampleFacade(
  profile: Profile,
  grid: BayGrid,
  extent: Extent,
  u: number,
  v: number,
  isWall = true,
) {
  let pane = 0;
  if (isWall && grid.count > 0 && u >= grid.originM && u <= grid.endM) {
    const bay = Math.min(
      grid.count - 1,
      Math.floor((u - grid.originM) / grid.pitchM),
    );
    const row = Math.floor((v - profile.groundStoreyM) / profile.storeyM);
    const b = windowBounds(profile, grid, bay, row);
    pane = Number(
      row >= 0 &&
        b.bottom >= extent.minHeightM - 1e-9 &&
        b.top <= extent.heightM + 1e-9 &&
        u >= b.left &&
        u <= b.right &&
        v >= b.bottom &&
        v <= b.top,
    );
  }
  return {
    pane,
    roughness: isWall
      ? profile.wallRoughness * (1 - pane) + profile.glassRoughness * pane
      : 0.86,
    brickNormalWeight: isWall ? profile.brickNormalScale * (1 - pane) : 0,
  };
}
export type Entrance = { thresholdY: number; headY: number; heightM: number };
/** Representative ground-floor glazing, not an entrance or walkable opening.
 * Conservative maximum frontage grade keeps windows above a sloping pavement.
 * Heritage shopfronts instead use separately validated, physical entrances. */
export function groundGlazing(
  profile: Profile,
  extent: Extent,
  foundationY: number,
  frontageGrades: readonly number[],
): readonly [number, number] {
  if (
    profile.kind === 'heritage-brick' ||
    extent.minHeightM > 0 ||
    !frontageGrades.length ||
    !Number.isFinite(foundationY) ||
    frontageGrades.some((n) => !Number.isFinite(n))
  )
    return [0, 0];
  const bottom = Math.max(
      0.5,
      Math.max(...frontageGrades) - foundationY + 0.25,
    ),
    top = Math.min(profile.groundStoreyM - 0.35, extent.heightM - 0.4);
  return top - bottom >= 1.2 ? [bottom, top] : [0, 0];
}
/** Surface samples MUST be actual sidewalk at both door jambs and center, in world Y.
 * Caller rejects party walls / non-street-facing faces before calling this helper.
 * It does not fabricate stairs or move the building to make an entrance fit.
 */
export function fitEntrance(
  profile: Profile,
  extent: Extent,
  foundationY: number,
  sidewalkY: readonly [number | null, number | null, number | null],
): Entrance | null {
  if (
    extent.minHeightM > 0 ||
    !Number.isFinite(foundationY) ||
    sidewalkY.some((y) => y === null || !Number.isFinite(y))
  )
    return null;
  const values = sidewalkY as readonly number[],
    low = Math.min(...values),
    high = Math.max(...values);
  if (high - low > 0.18) return null;
  const thresholdY = high + 0.02;
  if (thresholdY < foundationY) return null;
  const firstUpperPane =
    foundationY + profile.groundStoreyM + profile.pane[2] * profile.storeyM;
  const headLimit = Math.min(
    firstUpperPane - 0.25,
    foundationY + extent.heightM - 0.3,
  );
  const heightM = Math.min(2.65, headLimit - thresholdY);
  if (heightM < 2.1) return null;
  return { thresholdY, headY: thresholdY + heightM, heightM };
}
