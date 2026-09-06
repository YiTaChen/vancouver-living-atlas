/** Plain structured-cloneable Stage 7 DTO. No Three/engine/DOM imports. */
export interface LandmarkPlacement {
  lon: number;
  lat: number;
  yaw: number;
  baseY: number;
}
interface PlanBase {
  schema: 1;
  sourceRevision: string;
  placement: LandmarkPlacement;
}
export type ResolvedGroundPlan =
  | (PlanBase & {
      kind: 'marine';
      thresholdY: number;
      approachSamples: {
        u: number;
        d: number;
        localXZ: [number, number];
        worldSurfaceY: number;
      }[];
    })
  | (PlanBase & {
      kind: 'science';
      thresholdY: number;
      canopySoffitY: number;
      footings: { id: string; localXZ: [number, number]; surfaceY: number }[];
    })
  | (PlanBase & { kind: 'canada'; deckTopY: number });
export type GroundPlanResult =
  | { status: 'ready'; plan: ResolvedGroundPlan }
  | { status: 'unavailable'; kind: ResolvedGroundPlan['kind']; reason: string };
