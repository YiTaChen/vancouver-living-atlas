import type { SurfaceIdentity } from '../surface-reachability';
export type ActorActivity = 'walk' | 'wait' | 'look' | 'yield';
export interface ActorRoute extends SurfaceIdentity {
  routeId: string;
  lengthM: number;
  loop: boolean;
  validated: boolean;
}
export interface ActorState extends SurfaceIdentity {
  actorId: string;
  routeId: string;
  stationM: number;
  animationPhase: number;
  activity: ActorActivity;
}
/** Identity-only state, with no Navigator/mixer/render slot. Caller samples the
 * validated sidewalk route; road centerlines and unverified crossings are rejected upstream. */
export class PathActor {
  private state: ActorState;
  private remaining = 0;
  private lastEvent: string | null = null;
  private cooldownUntil = 0;
  readonly route: ActorRoute;
  constructor(
    actorId: string,
    route: ActorRoute,
    stationM = 0,
    animationPhase = 0,
  ) {
    if (
      !actorId ||
      !route.routeId ||
      !route.surfaceId ||
      !Number.isFinite(route.layer) ||
      !Number.isFinite(route.lengthM) ||
      route.lengthM <= 0 ||
      !route.validated ||
      !Number.isFinite(stationM) ||
      stationM < 0 ||
      stationM > route.lengthM ||
      !Number.isFinite(animationPhase)
    )
      throw new Error('Invalid pedestrian route');
    this.route = Object.freeze({ ...route });
    this.state = {
      actorId,
      routeId: route.routeId,
      surfaceId: route.surfaceId,
      layer: route.layer,
      stationM,
      animationPhase: ((animationPhase % 1) + 1) % 1,
      activity: 'walk',
    };
  }
  react(
    eventId: string,
    activity: Exclude<ActorActivity, 'walk'>,
    duration: number,
    now: number,
    surface: SurfaceIdentity,
  ) {
    if (
      !['wait', 'look', 'yield'].includes(activity) ||
      !eventId ||
      !Number.isFinite(now) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 10 ||
      surface.surfaceId !== this.state.surfaceId ||
      surface.layer !== this.state.layer ||
      now < this.cooldownUntil ||
      eventId === this.lastEvent
    )
      return false;
    this.lastEvent = eventId;
    this.cooldownUntil = now + duration + 1;
    this.remaining = duration;
    this.state.activity = activity;
    return true;
  }
  update(dt: number, speedMps: number, safeDistanceM: number) {
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      !Number.isFinite(speedMps) ||
      speedMps < 0 ||
      speedMps > 3 ||
      Number.isNaN(safeDistanceM) ||
      safeDistanceM < 0
    )
      return this.snapshot();
    // Far actors can tick at 1Hz, but hidden-tab debt must be discarded by SimulationClock.
    dt = Math.min(dt, 1);
    if (this.remaining > 0) {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining === 0) this.state.activity = 'walk';
      return this.snapshot();
    }
    if (safeDistanceM === 0) {
      this.state.activity = 'wait';
      return this.snapshot();
    }
    this.state.activity = 'walk';
    const movement = Math.min(
        speedMps * dt,
        safeDistanceM,
        this.route.loop ? Infinity : this.route.lengthM - this.state.stationM,
      ),
      next = this.state.stationM + movement;
    this.state.stationM = this.route.loop
      ? next % this.route.lengthM
      : Math.min(this.route.lengthM, next);
    this.state.animationPhase =
      (this.state.animationPhase + movement / 1.4) % 1;
    if (!this.route.loop && this.state.stationM === this.route.lengthM)
      this.state.activity = 'wait';
    return this.snapshot();
  }
  snapshot(): ActorState {
    return { ...this.state };
  }
}
