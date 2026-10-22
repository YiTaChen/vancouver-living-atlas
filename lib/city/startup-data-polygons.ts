import { project, rings } from './geo';
import type { FeatureCollection } from './types';

/** Preserve every source ring and coordinate in the regional terrain mask.
 * The caller owns this result, without a global cache or coordinate rounding.
 */
export function projectStartupPolygons(
  data: FeatureCollection,
): number[][][][] {
  return data.features.flatMap((feature) =>
    rings(feature).map((polygon) => polygon.map((ring) => ring.map(project))),
  );
}
