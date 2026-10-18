import type * as THREE from 'three';

export type TeslaModelQuality = 'low' | 'medium' | 'high';
export type TeslaPoint = readonly [number, number, number];

/** Image-based modelling estimates, not Tesla CAD or published dimensions. */
export const TESLA_ROADSTER_DIMENSIONS = Object.freeze({
  length: 4.6,
  width: 2.04,
  height: 1.24,
  wheelbase: 2.78,
  wheelRadius: 0.35,
  contactToCenter: 0.62,
  /** Conservative envelope includes steered tyres, hubs and rear nozzle lips. */
  halfExtents: [1.14, 0.62, 2.34] as TeslaPoint,
});

/** Measured from this authored mesh, not Tesla engineering or suspension data.
 * Wheel contacts use the model's tyre-plane origin. The simulation adapter must
 * subtract its model-to-chassis Y offset before passing them to ground fitting.
 * The analytic tyre circle stays stable across the three faceted visual LODs. */
export const TESLA_ROADSTER_GROUND_SUPPORT = Object.freeze({
  wheelContacts: Object.freeze([
    Object.freeze([-0.896, 0, 1.39]) as TeslaPoint,
    Object.freeze([0.896, 0, 1.39]) as TeslaPoint,
    Object.freeze([-0.896, 0, -1.39]) as TeslaPoint,
    Object.freeze([0.896, 0, -1.39]) as TeslaPoint,
  ] as const),
  track: 1.792,
  /** Conservative lower bound: the lowest non-wheel body vertex is 0.0876735m.
   * This clears the body's ground collision envelope; it never raises the car. */
  chassisClearance: 0.08,
  /** Non-wheel triangle minima after clipping at these local Z boundaries.
   * Separate front and rear overhangs: a low rear diffuser cannot lower the
   * front bumper's collision envelope. Every bound rounds down from the mesh. */
  bodySections: Object.freeze([
    // All LODs measure 0.0876735m here; retain over 2.6mm of conservative room.
    Object.freeze({ minZ: -2.34, maxZ: -1.39, clearance: 0.085 }),
    Object.freeze({ minZ: -1.39, maxZ: 1.39, clearance: 0.12 }),
    Object.freeze({ minZ: 1.39, maxZ: 2.34, clearance: 0.15 }),
  ]),
  /** Existing bounded game ground-fit tolerance, not measured wheel travel.
   * Wheels remain rigid in this visual model; no unrestricted suspension. */
  suspensionTravel: 0.05,
  measured: Object.freeze({
    minimumBodyY: 0.08767354488372803,
    frontBumperMinimumY: 0.18449999392032623,
    rearDiffuserMinimumY: 0.08767354488372803,
    centralFanMinimumY: 0.1249999988079071,
    undertrayMinimumY: 0.2325,
    /** Same rear/centre/front order as bodySections, for authored-mesh QA. */
    bodySectionMinimumY: Object.freeze([
      0.08767354488372803, 0.1249999988079071, 0.15549999475479126,
    ]),
    /** Conservative outward rounding of the all-LOD body bounds beyond axles. */
    frontOverhang: 0.9422,
    rearOverhang: 0.9395,
  }),
});

/** Local metres; +Y up, +Z forward, +X driver's left; root is tyre contact Y=0. */
export const TESLA_ROADSTER_ANCHORS = Object.freeze({
  driverEye: [0.39, 1.025, -0.45] as TeslaPoint,
  driverLookAt: [0.39, 0.96, 3] as TeslaPoint,
  seatPelvis: [0.39, 0.49, -0.39] as TeslaPoint,
  steeringWheel: [0.39, 0.8, 0.3] as TeslaPoint,
  frontChase: [0, 1.6, 5.8] as TeslaPoint,
  rearChase: [0, 1.8, -6.2] as TeslaPoint,
  chaseTarget: [0, 0.65, 0.3] as TeslaPoint,
});

/** Counts/directions follow Tesla's reveal and Moravy's on-camera walkthrough.
 * Positions/radii remain image-based modelling estimates, not engineering CAD. */
export const TESLA_ROADSTER_THRUSTERS: readonly {
  kind: 'rear' | 'lift' | 'yaw';
  position: TeslaPoint;
  direction: TeslaPoint;
  radius: number;
}[] = [
  ...[-0.51, -0.17, 0.17, 0.51].map((x) => ({
    kind: 'rear' as const,
    position: [x, 0.343, -2.27] as TeslaPoint,
    direction: [0, 0, -1] as TeslaPoint,
    radius: 0.085,
  })),
  ...[-1, 1].flatMap((sign) =>
    [0.88, -1.86].map((z) => ({
      kind: 'lift' as const,
      position: [sign * 0.71, 0.19, z] as TeslaPoint,
      direction: [0, -1, 0] as TeslaPoint,
      radius: 0.066,
    })),
  ),
  ...[-1, 1].map((sign) => ({
    kind: 'yaw' as const,
    position: [sign * 0.94, 0.44, 1.78] as TeslaPoint,
    direction: [sign, 0, 0] as TeslaPoint,
    radius: 0.025,
  })),
];

/** Four rear suction fans; the exact duct/blade layout is illustrative. */
export const TESLA_ROADSTER_FANS: readonly TeslaPoint[] = [
  [-0.365, 0.155, -0.65],
  [0.365, 0.155, -0.65],
  [-0.365, 0.155, -1.22],
  [0.365, 0.155, -1.22],
];

export interface TeslaRoadsterVisualState {
  steeringRad?: number;
  wheelSpinRad?: number;
  fanSpinRad?: number;
  /** Cold-gas visual effect only, normalized 0..1. */
  thrust?: number;
  /** Vortex Jump pulse, visual only; reuses the ten fixed cold-gas instances. */
  vortexThrust?: number;
  brake?: number;
  night?: boolean;
  wingDeploy?: number;
}

export interface TeslaRoadsterModel {
  readonly group: THREE.Group;
  readonly anchors: typeof TESLA_ROADSTER_ANCHORS;
  readonly dimensions: typeof TESLA_ROADSTER_DIMENSIONS;
  /** Geometry tier is separate from the city's existing VisualQuality. */
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
