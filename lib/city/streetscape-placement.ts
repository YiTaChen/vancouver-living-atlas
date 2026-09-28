import type { Profile } from './facade-profile';

export type StreetBayAsset = 'heritage-shop-bay' | 'modern-lobby-bay';
/** Maximum height in the generated compact-bay manifest; metres, no scaling. */
export const STREET_BAY_HEIGHT_M = 3.2;
export type StreetBayPlacement = {
  asset: StreetBayAsset;
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export function streetBayCell(x: number, z: number): string {
  return `${Math.floor(x / 180)},${Math.floor(z / 180)}`;
}

/** Human-scale bays sit on actual pavement and below the first upper pane.
 * fitEntrance describes the older 2.65 m shop opening, so its head is deliberately
 * not used as the limit of this 3.2 m facade assembly. No GIS height is changed. */
export function streetBayThreshold(
  profile: Profile,
  height: number,
  minHeight: number,
  foundation: number,
  pavement: readonly (number | null)[],
): number | null {
  if (
    minHeight !== 0 ||
    !Number.isFinite(foundation) ||
    !Number.isFinite(height) ||
    pavement.length < 3 ||
    pavement.some((y) => y === null || !Number.isFinite(y))
  )
    return null;
  const samples = pavement as readonly number[];
  const low = Math.min(...samples),
    high = Math.max(...samples);
  if (high - low > 0.14) return null;
  const threshold = high + 0.02;
  if (threshold < foundation) return null;
  const firstPane =
    foundation + profile.groundStoreyM + profile.pane[2] * profile.storeyM;
  // Legacy heritage sills are centered 0.07 m below the pane and 0.20 m
  // thick: their physical bottom is pane - 0.17 m. Keep another 0.02 m
  // clear so the bay crown cannot intersect that preserved window mesh.
  const upperClearance = profile.kind === 'heritage-brick' ? 0.19 : 0.15;
  const ceiling = Math.min(
    firstPane - upperClearance,
    foundation + height - 0.3,
  );
  return threshold + STREET_BAY_HEIGHT_M <= ceiling ? threshold : null;
}
