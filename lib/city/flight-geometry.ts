/** Metre-space airframe probes shared by placement and swept flight collision. */
export const AIRFRAME_RADIUS = 0.85;
export const AIRFRAME_PROBES: Record<
  'seaplane' | 'helicopter',
  [number, number, number][]
> = {
  seaplane: [
    [0, 1.6, 0],
    [0, 1.7, -4],
    [7.1, 3, 0],
    [-7.1, 3, 0],
    [0, 2, 4],
  ],
  helicopter: [
    [0, 1.8, 0],
    [5, 3.5, 0],
    [-5, 3.5, 0],
    [0, 3.5, -5],
    [0, 3.5, 5],
    [0, 2, 6.4],
  ],
};
