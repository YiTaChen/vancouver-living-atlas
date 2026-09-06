/** Shared by main and the module worker; no DOM or Engine imports. */
export const LANDMARK_WORKER_VERSION = 'vancouver-landmarks-2026-09-06-v1';
export type LandmarkId =
  | 'science'
  | 'canada'
  | 'marine'
  | 'bc-place'
  | 'harbour'
  | 'convention'
  | 'vancouver-house';
export interface ResolvedGroundPlanBase {
  schema: 1;
  kind: LandmarkId;
  sourceRevision: string;
  placement: { lon: number; lat: number; yaw: number; baseY: number };
}
export interface LandmarkJob<
  P extends ResolvedGroundPlanBase = ResolvedGroundPlanBase,
> {
  version: typeof LANDMARK_WORKER_VERSION;
  session: string;
  job: number;
  landmark: LandmarkId;
  plan: P;
}
export type LandmarkWorkerResult<Packet = unknown> = {
  version: typeof LANDMARK_WORKER_VERSION;
  session: string;
  job: number;
} & (
  | { ok: true; packet: Packet; factoryMs: number; geometryBytes: number }
  | { ok: false; error: string }
);

/** Fail on unsupported data instead of silently losing callbacks or inventing Y. */
export function assertResolvedPlan(
  plan: ResolvedGroundPlanBase,
  landmark: LandmarkId,
) {
  if (
    !plan ||
    plan.schema !== 1 ||
    plan.kind !== landmark ||
    !plan.sourceRevision
  )
    throw new Error('Missing or incompatible resolved landmark ground plan');
  const p = plan.placement;
  if (!p || ![p.lon, p.lat, p.yaw, p.baseY].every(Number.isFinite))
    throw new Error('Resolved plan requires a finite, preserved placement');
  const visit = (value: unknown): void => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Nonfinite ground value');
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (
      typeof value !== 'object' ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      throw new Error(
        'Ground plan must contain resolved plain data, never callbacks',
      );
    Object.values(value).forEach(visit);
  };
  visit(plan);
}
