import type { VisualQuality } from './quality';

export type CabinDisplayQuality = 'city' | 'light' | 'detailed';
export interface CabinQualityPolicy {
  quality: VisualQuality;
  compatible: boolean;
  pixelRatio: number;
  displayQuality: CabinDisplayQuality;
}
export function cabinLOD(policy: CabinQualityPolicy): 0 | 1 {
  return policy.compatible ||
    policy.displayQuality === 'light' ||
    (policy.displayQuality === 'city' && policy.quality === 'balanced')
    ? 1
    : 0;
}
/** Inherit the city's actual adaptive/manual resolution, with an independent
 * physical-pixel ceiling for this bounded display canvas. */
export function cabinPixelRatio(
  policy: CabinQualityPolicy,
  width: number,
  height: number,
) {
  const ratio = Number.isFinite(policy.pixelRatio) ? policy.pixelRatio : 1;
  return Math.min(
    Math.max(0.5, ratio),
    policy.compatible || policy.displayQuality === 'light' ? 1 : 2,
    Math.sqrt(1_800_000 / Math.max(1, width * height)),
    4096 / Math.max(1, width, height),
  );
}
