import type { LineId } from './skytrain-network';

/** Maintained service consist geometry. Car centres are the same authored
 * frames used by SkyTrainRideTrain, rather than one rigid whole-train shell.
 * Expo's rendered service shell is 17 m; Canada's source vehicle contract is
 * tools/assets/canada-line-stage2/manifest.json (20.5 m body, 1.1 m floor;
 * the loaded end-car coupler reaches 10.5 m from its car frame).
 * Roof bounds include a margin above the current rendered shell/GLB roof. */
export const SKYTRAIN_SERVICE_STOCK = {
  expo: {
    carOffsetsM: [26.85, 8.95, -8.95, -26.85],
    carHalfLengthM: 8.5,
    floorAboveRailM: 0.95,
    roofAboveRailM: 3.65,
  },
  canada: {
    carOffsetsM: [10.5, -10.5],
    carHalfLengthM: 10.5,
    floorAboveRailM: 1.1,
    roofAboveRailM: 3.85,
  },
} as const satisfies Record<
  LineId,
  {
    carOffsetsM: readonly number[];
    carHalfLengthM: number;
    floorAboveRailM: number;
    roofAboveRailM: number;
  }
>;
