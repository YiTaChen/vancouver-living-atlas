import { inPolygon, project } from './geo';

// Authored display envelope for the downtown peninsula, not a civic boundary.
// Parks, woods and water are explicitly subtracted from the receiver mask.
const downtown = [
  [
    [-123.1525, 49.2876],
    [-123.1411, 49.2948],
    [-123.132, 49.2942],
    [-123.114, 49.2898],
    [-123.096, 49.2852],
    [-123.0975, 49.276],
    [-123.1078, 49.2733],
    [-123.12, 49.2732],
    [-123.138, 49.2743],
    [-123.1495, 49.28],
  ].map(project),
];
export const DOWNTOWN_NIGHT_BOUNDS = {
  minX: -1900,
  maxX: 2400,
  minZ: -1100,
  maxZ: 1500,
};
export type NightExcludedPolygon = number[][][];

export function createDowntownNightPolicy(
  excluded: readonly NightExcludedPolygon[],
  onLand: (x: number, z: number) => boolean,
) {
  const masks = excluded
    .filter((poly) => poly[0]?.length)
    .map((poly) => {
      const ring = poly[0];
      return {
        poly,
        minX: Math.min(...ring.map((p) => p[0])),
        maxX: Math.max(...ring.map((p) => p[0])),
        minZ: Math.min(...ring.map((p) => p[1])),
        maxZ: Math.max(...ring.map((p) => p[1])),
      };
    });
  return (x: number, z: number) => {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !inPolygon([x, z], downtown) ||
      !onLand(x, z)
    )
      return false;
    return !masks.some(
      (mask) =>
        x >= mask.minX &&
        x <= mask.maxX &&
        z >= mask.minZ &&
        z <= mask.maxZ &&
        inPolygon([x, z], mask.poly),
    );
  };
}

/** The pole lies on the +X local roadside. Put its arm/head toward the road,
 * at local -X, rather than floating the luminous cap above the pole itself. */
export function streetLampHead(
  x: number,
  z: number,
  yaw: number,
  baseY: number,
) {
  return {
    x: x - Math.cos(yaw) * 1.55,
    y: baseY + 7.85,
    z: z + Math.sin(yaw) * 1.55,
  };
}
