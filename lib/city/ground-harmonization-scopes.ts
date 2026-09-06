import type { Bounds } from './ground-visibility';
/** Source IDs select actual merged-path buffers, not independently draped lines. */
export function groundHarmonizationScopes(
  project: (coord: readonly number[]) => [number, number],
) {
  const view = (coord: readonly number[], radius: number): Bounds => {
    const [x, z] = project(coord);
    return [x - radius, z - radius, x + radius, z + radius];
  };
  return [
    {
      id: 'causeway-lower',
      pathSourceIds: [
        'OSM:44032491',
        'OSM:74267973',
        'OSM:115939816',
        'OSM:363686270',
        'OSM:648864806',
      ],
      bounds: [
        -706.459716796875, -1326.8353271484375, -558.3389282226562,
        -920.0067138671875,
      ] as Bounds,
      focusBounds: [
        -706.459716796875, -1326.8353271484375, -558.3389282226562,
        -920.0067138671875,
      ] as Bounds,
    },
    {
      id: 'north-coast',
      pathSourceIds: ['OSM:381179591', 'OSM:863811845'],
      bounds: view([-123.147165, 49.313101], 160),
      focusBounds: view([-123.147165, 49.313101], 120),
    },
    {
      id: 'northwest-coast',
      pathSourceIds: ['coastal-paths'],
      bounds: view([-123.156028, 49.306809], 160),
      focusBounds: view([-123.156028, 49.306809], 120),
    },
  ];
}
