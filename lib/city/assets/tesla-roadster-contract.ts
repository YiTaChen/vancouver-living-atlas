import type * as THREE from 'three';
import measured from './tesla-roadster-detailed-metrics.json';

export type TeslaModelQuality = 'low' | 'medium' | 'high';
export type TeslaPoint = readonly [number, number, number];
const point = (value: readonly number[]) =>
  Object.freeze([...value]) as unknown as TeslaPoint;

/** These are measurements of the derived meshes, not Tesla factory dimensions.
 * The enclosing hull includes full wheel/fan rotation, steering and active aero. */
export const TESLA_ROADSTER_DIMENSIONS = Object.freeze({
  ...measured.dimensions,
  halfExtents: point(measured.dimensions.halfExtents),
});
const levels = Object.fromEntries(
  Object.entries(measured.levels).map(([name, value]) => [
    name,
    Object.freeze({
      ...value,
      bodySectionMinimumY: Object.freeze([...value.bodySectionMinimumY]),
    }),
  ]),
) as Readonly<typeof measured.levels>;

/** Stable physics support across all visual tiers. Section clearances round
 * down from actual clipped decoded triangles; per-tier evidence stays exact. */
export const TESLA_ROADSTER_GROUND_SUPPORT = Object.freeze({
  ...measured.groundSupport,
  wheelContacts: Object.freeze(measured.groundSupport.wheelContacts.map(point)),
  bodySections: Object.freeze(
    measured.groundSupport.bodySections.map((section) =>
      Object.freeze({ ...section }),
    ),
  ),
  measured: Object.freeze({
    ...measured.groundSupport.measured,
    bodySectionMinimumY: Object.freeze([
      ...measured.groundSupport.measured.bodySectionMinimumY,
    ]),
    levels,
  }),
});

/** Atlas metres: +Y up, +Z forward, +X driver's left; tyre-plane origin Y=0.
 * seatPelvis is an artist's seat marker, not a fitted humanoid skeleton datum. */
export const TESLA_ROADSTER_ANCHORS = Object.freeze({
  driverEye: point(measured.anchors.driverEye),
  driverLookAt: point(measured.anchors.driverLookAt),
  seatPelvis: point(measured.anchors.seatPelvis),
  steeringWheel: point(measured.anchors.steeringWheel),
  frontChase: point(measured.anchors.frontChase),
  rearChase: point(measured.anchors.rearChase),
  chaseTarget: point(measured.anchors.chaseTarget),
});
export const TESLA_ROADSTER_THRUSTERS: readonly {
  kind: 'rear' | 'lift' | 'yaw';
  position: TeslaPoint;
  direction: TeslaPoint;
  radius: number;
}[] = [
  ...measured.thrusters.map((port) => ({
    kind: port.kind as 'rear' | 'lift',
    position: point(port.position),
    direction: point(port.direction),
    radius: port.radius,
  })),
  // Retain Atlas's two bounded yaw effects. This hidden packaging is inferred.
  ...[-1, 1].map((sign) => ({
    kind: 'yaw' as const,
    position: point([sign * 0.99, 0.44, 1.78]),
    direction: point([sign, 0, 0]),
    radius: 0.025,
  })),
];
/** Four separate rear-facing fan cells, distinct from cold-gas propulsion. */
export const TESLA_ROADSTER_FANS: readonly TeslaPoint[] =
  measured.fans.map(point);

export interface TeslaRoadsterVisualState {
  steeringRad?: number;
  wheelSpinRad?: number;
  fanSpinRad?: number;
  thrust?: number;
  vortexThrust?: number;
  brake?: number;
  night?: boolean;
  wingDeploy?: number;
  /** Isolated/parked asset inspection; the driving controller keeps these zero. */
  doorsOpen?: number;
  roofLift?: number;
}
export interface TeslaRoadsterModel {
  readonly group: THREE.Group;
  readonly anchors: typeof TESLA_ROADSTER_ANCHORS;
  readonly dimensions: typeof TESLA_ROADSTER_DIMENSIONS;
  setQuality(quality: TeslaModelQuality): void;
  update(state: TeslaRoadsterVisualState): void;
  stats(): {
    quality: TeslaModelQuality;
    triangles: number;
    meshes: number;
    materials: number;
    cachedLevels: number;
    disposed: boolean;
  };
  dispose(): void;
}
