export type VisualQuality = 'balanced' | 'high' | 'ultra';

/** Physical-pixel budgets also bound the full-screen postprocessing targets. */
export const QUALITY = {
  balanced: {
    maxDpr: 1,
    minDpr: 1,
    pixels: 1_800_000,
    shadowSize: 2048,
    landmarkDistance: 0,
    treeDistance: 0,
  },
  high: {
    maxDpr: 1.25,
    minDpr: 1,
    pixels: 1_800_000,
    shadowSize: 2048,
    landmarkDistance: 0,
    treeDistance: 170,
  },
  ultra: {
    maxDpr: 2,
    minDpr: 1.5,
    pixels: 3_686_400,
    shadowSize: 4096,
    landmarkDistance: 1700,
    treeDistance: 450,
  },
} as const;

export function qualityPixelRatio(
  quality: VisualQuality,
  width: number,
  height: number,
  deviceDpr: number,
) {
  const p = QUALITY[quality];
  const w = Math.max(1, width),
    h = Math.max(1, height);
  return Math.min(
    Math.max(p.minDpr, deviceDpr || 1),
    p.maxDpr,
    Math.sqrt(p.pixels / (w * h)),
    4096 / Math.max(w, h),
  );
}
