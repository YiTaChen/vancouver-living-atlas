import type { FacadeKind } from './facade-profile';

export type FlatRoofFinishIndex = 0 | 1 | 2;
export type FlatRoofFinish = Readonly<{
  id: 'asphalt' | 'mineral-gravel' | 'coated-membrane';
  /** Authored sRGB values; convert once to linear RGB for shader uniforms. */
  colorSRGB: readonly [number, number, number];
  roughness: number;
}>;

/**
 * Representative flat-roof appearances, not surveyed roof-material assignments:
 * the building source does not supply roof materials. Asphalt retains the atlas
 * manifest's average colour. The other finishes reuse its normalized grain, so
 * all buildings share three uniforms without extra textures or materials.
 * Pitched roofs keep their independently selected shingle surface.
 */
export const FLAT_ROOF_FINISHES: readonly [
  FlatRoofFinish,
  FlatRoofFinish,
  FlatRoofFinish,
] = Object.freeze([
  Object.freeze({
    id: 'asphalt',
    colorSRGB: Object.freeze([0.259805, 0.279812, 0.279812] as const),
    roughness: 0.93,
  }),
  Object.freeze({
    id: 'mineral-gravel',
    colorSRGB: Object.freeze([147 / 255, 152 / 255, 142 / 255] as const),
    roughness: 0.88,
  }),
  Object.freeze({
    id: 'coated-membrane',
    colorSRGB: Object.freeze([185 / 255, 192 / 255, 187 / 255] as const),
    roughness: 0.82,
  }),
]);

/**
 * Select with the existing nonnegative integer profile seed, without rehashing
 * geometry or depending on iteration order. The twenty-slot art-direction mix
 * retains dark roofs on older families and favours coated roofs on modern ones;
 * it does not claim measured material prevalence in Vancouver. Returns only a
 * bounded scalar index in constant time, with no per-building allocations.
 */
export function selectFlatRoofFinish(
  kind: FacadeKind,
  seed: number,
): FlatRoofFinishIndex {
  if (!Number.isSafeInteger(seed) || seed < 0) return 1;
  const slot = seed % 20;
  switch (kind) {
    case 'heritage-brick':
    case 'lowrise-masonry':
      // 40% asphalt, 60% mineral.
      return slot < 8 ? 0 : 1;
    case 'midrise-grid':
    case 'balcony-slab':
    case 'curtain-wall':
      // 30% mineral, 70% coated.
      return slot < 6 ? 1 : 2;
    case 'domestic-cladding':
      // Flat domestic roofs also retain a mix: 20% / 40% / 40%.
      return slot < 4 ? 0 : slot < 12 ? 1 : 2;
    default:
      return 1;
  }
}
