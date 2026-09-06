/** Representative SkyWalk axis fitted to the local CoV/OSM corridor and terminal footprints.
 * Coordinates are metres in Waterfront Station's existing local frame. */
export const SKY_WALK: [number, number][] = [
  [-6, -16],
  [-6, -43],
  [9, -140],
  [10, -146],
  [19, -172],
  [27, -192],
  [29, -197],
];
export const SEABUS_TERMINAL = {
  x: 35,
  z: -220,
  width: 72,
  depth: 56,
  worldFloor: 4.5,
};
export const SEABUS_REPLACED_IDS = new Set([
  '165024',
  '162990',
  '160876',
  '162524',
]);
export function corridorQuad(
  a: number[],
  b: number[],
  width = 6,
): [number, number][] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]),
    x = ((-(b[1] - a[1]) / length) * width) / 2,
    z = (((b[0] - a[0]) / length) * width) / 2;
  return [
    [a[0] + x, a[1] + z],
    [b[0] + x, b[1] + z],
    [b[0] - x, b[1] - z],
    [a[0] - x, a[1] - z],
  ];
}
