import type { SurfaceIdentity } from '../surface-reachability';

export const TRANSIT_PARAMETERS = Object.freeze({
  stoppedSpeedMps: 0.05,
  stoppedSeconds: 0.5,
  interactionDistanceM: 2,
  dwellSeconds: 10,
  transferTimeoutSeconds: 15,
  maxTickSeconds: 0.2,
});
export type DoorSide = 'left' | 'right';
export type ServicePhase =
  | 'moving'
  | 'approaching'
  | 'stopped'
  | 'opening'
  | 'dwell'
  | 'closing'
  | 'departing'
  | 'terminal';
export interface ServiceStop extends SurfaceIdentity {
  stopId: string;
  stationId: string;
  platformId: string;
  pathStationM: number;
  doorSide: DoorSide;
}
export interface ServicePlan {
  serviceId: string;
  lineId: string;
  directionId: string;
  vehicleProfileId: string;
  pathId: string;
  pathLengthM: number;
  stops: readonly ServiceStop[];
  speedLimitMps: number;
  accelerationMps2: number;
  brakingMps2: number;
  /** No implicit reversal or modulo wrapping. A subsequent verified plan is a separate dispatch. */
  endpoint: 'hold-for-alighting';
}
export interface ServiceInput {
  /** Verified occupancy/stop-line distance; Infinity means no obstruction. */
  clearDistanceM: number;
  doorsClosed: boolean;
  platformDoorsOpen: boolean;
  alignmentValid: boolean;
  /** Authoritative transaction count from PassengerTransfers, not camera/LOD. */
  pendingTransfers: number;
}
export interface ServiceSnapshot {
  vehicleId: string;
  serviceId: string;
  pathId: string;
  phase: ServicePhase;
  pathStationM: number;
  speedMps: number;
  stopIndex: number;
  stopId: string;
  doorSide: DoorSide | null;
  bellRequested: boolean;
}
function validatePlan(plan: ServicePlan) {
  if (
    !plan.serviceId ||
    !plan.lineId ||
    !plan.directionId ||
    !plan.vehicleProfileId ||
    !plan.pathId ||
    plan.endpoint !== 'hold-for-alighting' ||
    !Number.isFinite(plan.pathLengthM) ||
    plan.pathLengthM <= 0 ||
    !plan.stops.length ||
    ![plan.speedLimitMps, plan.accelerationMps2, plan.brakingMps2].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    throw new Error('Invalid service plan');
  let previous = -1;
  const ids = new Set<string>();
  for (const stop of plan.stops) {
    if (
      !stop.stopId ||
      ids.has(stop.stopId) ||
      !stop.stationId ||
      !stop.platformId ||
      !stop.surfaceId ||
      !Number.isFinite(stop.layer) ||
      !Number.isFinite(stop.pathStationM) ||
      stop.pathStationM < 0 ||
      stop.pathStationM <= previous ||
      stop.pathStationM > plan.pathLengthM ||
      !['left', 'right'].includes(stop.doorSide)
    )
      throw new Error('Invalid ordered service stop');
    previous = stop.pathStationM;
    ids.add(stop.stopId);
  }
}
/** Pure controller, intentionally not attached to existing decorative buses/railway.
 * One authority survives camera/representation changes. All selected stops are served. */
export class TransitService {
  readonly plan: ServicePlan;
  private state: ServiceSnapshot;
  private stoppedTime = 0;
  private dwellTime = 0;
  constructor(
    readonly vehicleId: string,
    plan: ServicePlan,
  ) {
    validatePlan(plan);
    if (!vehicleId) throw new Error('Missing vehicle identity');
    this.plan = structuredClone(plan);
    for (const stop of this.plan.stops) Object.freeze(stop);
    Object.freeze(this.plan.stops);
    Object.freeze(this.plan);
    this.state = {
      vehicleId,
      serviceId: plan.serviceId,
      pathId: plan.pathId,
      phase: 'moving',
      pathStationM: 0,
      speedMps: 0,
      stopIndex: 0,
      stopId: plan.stops[0].stopId,
      doorSide: null,
      bellRequested: false,
    };
  }
  snapshot(): ServiceSnapshot {
    return { ...this.state };
  }
  requestStop() {
    this.state.bellRequested = true;
  }
  update(dt: number, input: ServiceInput) {
    if (!Number.isFinite(dt) || dt <= 0) return this.snapshot();
    if (
      Number.isNaN(input.clearDistanceM) ||
      input.clearDistanceM < 0 ||
      !Number.isInteger(input.pendingTransfers) ||
      input.pendingTransfers < 0
    )
      throw new Error('Invalid service observation');
    dt = Math.min(dt, TRANSIT_PARAMETERS.maxTickSeconds);
    const s = this.state,
      stop = this.plan.stops[s.stopIndex];
    if (
      s.phase === 'moving' ||
      s.phase === 'approaching' ||
      s.phase === 'departing'
    ) {
      if (!input.doorsClosed || input.pendingTransfers > 0) {
        s.speedMps = 0;
        return this.snapshot();
      }
      const remaining = Math.max(0, stop.pathStationM - s.pathStationM);
      const allowed = Math.min(remaining, input.clearDistanceM);
      const target = Math.min(
        this.plan.speedLimitMps,
        Math.sqrt(2 * this.plan.brakingMps2 * allowed),
      );
      const speed =
        s.speedMps < target
          ? Math.min(target, s.speedMps + this.plan.accelerationMps2 * dt)
          : Math.max(target, s.speedMps - this.plan.brakingMps2 * dt);
      // Conservative occupancy clamp never crosses a blocked stop line on a coarse tick.
      const movement = Math.min(allowed, (s.speedMps + speed) * 0.5 * dt);
      s.pathStationM += movement;
      s.speedMps = movement >= allowed - 1e-9 ? 0 : speed;
      s.phase =
        remaining <
        Math.max(
          15,
          (s.speedMps * s.speedMps) / (2 * this.plan.brakingMps2) + 2,
        )
          ? 'approaching'
          : 'moving';
      if (stop.pathStationM - s.pathStationM < 1e-6) {
        s.pathStationM = stop.pathStationM;
        s.speedMps = 0;
        s.phase = 'stopped';
        this.stoppedTime = 0;
      }
    } else if (s.phase === 'stopped') {
      this.stoppedTime =
        s.speedMps <= TRANSIT_PARAMETERS.stoppedSpeedMps
          ? this.stoppedTime + dt
          : 0;
      if (
        this.stoppedTime + 1e-9 >= TRANSIT_PARAMETERS.stoppedSeconds &&
        input.alignmentValid
      ) {
        s.phase = 'opening';
        s.doorSide = stop.doorSide;
      }
    } else if (s.phase === 'opening') {
      if (input.platformDoorsOpen && input.alignmentValid) {
        s.phase = 'dwell';
        this.dwellTime = 0;
        s.bellRequested = false;
      }
    } else if (s.phase === 'dwell') {
      this.dwellTime += dt;
      if (s.stopIndex === this.plan.stops.length - 1) s.phase = 'terminal';
      else if (
        this.dwellTime + 1e-9 >= TRANSIT_PARAMETERS.dwellSeconds &&
        input.pendingTransfers === 0 &&
        input.alignmentValid
      )
        s.phase = 'closing';
    } else if (s.phase === 'closing') {
      if (input.pendingTransfers > 0) {
        s.phase = 'opening';
      } else if (input.doorsClosed) {
        s.doorSide = null;
        s.stopIndex++;
        s.stopId = this.plan.stops[s.stopIndex].stopId;
        s.phase = 'departing';
      }
    }
    // Terminal intentionally holds open. No false crossover, teleport or loaded despawn.
    return this.snapshot();
  }
  canRecycle(
    passengerCount: number,
    pendingTransfers: number,
    visible: boolean,
  ) {
    return (
      this.state.phase === 'terminal' &&
      passengerCount === 0 &&
      pendingTransfers === 0 &&
      !visible
    );
  }
}
