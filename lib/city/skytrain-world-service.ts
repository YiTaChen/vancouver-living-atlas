import type { LineId, SkyTrainDirection, StationId } from './skytrain-network';

export interface WorldSkyTrainStop {
  id: string;
  stationId: StationId | null;
  name: string;
  lonLat: [number, number];
}
export interface WorldSkyTrainSegment {
  coordinates: [number, number][];
  lengthM: number;
  fromStopId: string;
  toStopId: string;
}
export interface WorldSkyTrainRoute {
  lineId: LineId;
  direction: SkyTrainDirection;
  headsign: string;
  sourceTripId: string;
  sourceShapeId: string;
  stops: WorldSkyTrainStop[];
  segments: WorldSkyTrainSegment[];
}
export interface WorldSkyTrainData {
  schema: 1;
  source: {
    provider: string;
    url: string;
    feedVersion: string;
    zipSha256: string;
    zipBytes: number;
    selectionDate: string;
    [key: string]: unknown;
  };
  routes: WorldSkyTrainRoute[];
}
export const WORLD_SKYTRAIN_SERVICE = Object.freeze({
  averageSpeedMps: 11.5,
  maxSpeedMps: 22,
  maxAccelerationMps2: 1.4,
  openingSeconds: 0.65,
  dwellSeconds: 18,
  closingSeconds: 0.65,
  turnbackSeconds: 45,
});
export type WorldSkyTrainPhase =
  | 'opening'
  | 'dwell'
  | 'closing'
  | 'moving'
  | 'turnback';
export interface WorldSkyTrainRunSnapshot {
  route: WorldSkyTrainRoute;
  routeIndex: 0 | 1;
  stopIndex: number;
  nextStopIndex: number;
  segmentIndex: number;
  phase: WorldSkyTrainPhase;
  progress: number;
  speedMps: number;
  doorsOpen: boolean;
  doorProgress: number;
  phaseElapsed: number;
  phaseDuration: number;
  elapsed: number;
  turnbackProgress: number;
  terminalFromRoute: WorldSkyTrainRoute | null;
  terminalToRoute: WorldSkyTrainRoute | null;
}
const quintic = (t: number) => t * t * t * (10 + t * (-15 + 6 * t));
const quinticVelocity = (t: number) => 30 * t * t * (1 - t) * (1 - t);
export function worldSkyTrainSegmentDuration(lengthM: number) {
  if (!Number.isFinite(lengthM) || lengthM <= 0)
    throw new Error('Invalid SkyTrain segment length');
  return Math.max(
    8,
    lengthM / WORLD_SKYTRAIN_SERVICE.averageSpeedMps,
    (1.875 * lengthM) / WORLD_SKYTRAIN_SERVICE.maxSpeedMps,
    Math.sqrt(
      ((10 / Math.sqrt(3)) * lengthM) /
        WORLD_SKYTRAIN_SERVICE.maxAccelerationMps2,
    ),
  );
}
interface PhaseSpan {
  start: number;
  duration: number;
  routeIndex: 0 | 1;
  stopIndex: number;
  phase: WorldSkyTrainPhase;
}
const stationName = (name: string) => name.split(' @ ')[0];
function validateRoute(route: WorldSkyTrainRoute) {
  if (
    !['expo', 'canada'].includes(route.lineId) ||
    route.stops.length < 2 ||
    route.segments.length !== route.stops.length - 1 ||
    new Set(route.stops.map((stop) => stop.id)).size !== route.stops.length
  )
    throw new Error('Invalid complete SkyTrain route');
  for (const [index, segment] of route.segments.entries()) {
    if (
      segment.fromStopId !== route.stops[index].id ||
      segment.toStopId !== route.stops[index + 1].id ||
      !Number.isFinite(segment.lengthM) ||
      segment.lengthM <= 0 ||
      segment.coordinates.length < 2 ||
      segment.coordinates.some(
        (point) => point.length !== 2 || !point.every(Number.isFinite),
      )
    )
      throw new Error('Invalid ordered SkyTrain segment');
  }
}

/** Independent, analytic service time. Passenger state and renderer visibility
 * never enter this clock. Every off-map stop remains in the same full cycle;
 * only real source terminals switch direction, through an explicit crossover.
 */
export class WorldSkyTrainRun {
  readonly routes: readonly [WorldSkyTrainRoute, WorldSkyTrainRoute];
  readonly cycleDurationSeconds: number;
  private elapsedSeconds: number;
  private readonly spans: PhaseSpan[] = [];
  constructor(
    outward: WorldSkyTrainRoute,
    returning: WorldSkyTrainRoute,
    phaseOffsetSeconds = 0,
  ) {
    validateRoute(outward);
    validateRoute(returning);
    if (
      !Number.isFinite(phaseOffsetSeconds) ||
      phaseOffsetSeconds < 0 ||
      outward.lineId !== returning.lineId ||
      outward.direction === returning.direction ||
      stationName(outward.stops[0].name) !==
        stationName(returning.stops.at(-1)!.name) ||
      stationName(outward.stops.at(-1)!.name) !==
        stationName(returning.stops[0].name)
    )
      throw new Error(
        'SkyTrain return service must connect the same physical terminals',
      );
    this.routes = [outward, returning];
    this.elapsedSeconds = phaseOffsetSeconds;
    let start = 0;
    const add = (
      routeIndex: 0 | 1,
      stopIndex: number,
      phase: WorldSkyTrainPhase,
      duration: number,
    ) => {
      this.spans.push({ start, duration, routeIndex, stopIndex, phase });
      start += duration;
    };
    for (const routeIndex of [0, 1] as const) {
      const route = this.routes[routeIndex];
      for (let stopIndex = 0; stopIndex < route.stops.length; stopIndex++) {
        add(
          routeIndex,
          stopIndex,
          'opening',
          WORLD_SKYTRAIN_SERVICE.openingSeconds,
        );
        add(
          routeIndex,
          stopIndex,
          'dwell',
          WORLD_SKYTRAIN_SERVICE.dwellSeconds,
        );
        add(
          routeIndex,
          stopIndex,
          'closing',
          WORLD_SKYTRAIN_SERVICE.closingSeconds,
        );
        if (stopIndex < route.segments.length)
          add(
            routeIndex,
            stopIndex,
            'moving',
            worldSkyTrainSegmentDuration(route.segments[stopIndex].lengthM),
          );
      }
      add(
        routeIndex,
        route.stops.length - 1,
        'turnback',
        WORLD_SKYTRAIN_SERVICE.turnbackSeconds,
      );
    }
    this.cycleDurationSeconds = start;
  }
  advance(dtSeconds: number) {
    if (
      !Number.isFinite(dtSeconds) ||
      dtSeconds < 0 ||
      !Number.isFinite(this.elapsedSeconds + dtSeconds)
    )
      throw new Error('Invalid SkyTrain service time');
    this.elapsedSeconds += dtSeconds;
    return this.snapshot();
  }
  snapshot(): WorldSkyTrainRunSnapshot {
    const time = this.elapsedSeconds % this.cycleDurationSeconds;
    // Bounded binary search: advancing hours costs the same as one frame.
    let lo = 0,
      hi = this.spans.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.spans[mid].start <= time) lo = mid;
      else hi = mid - 1;
    }
    const span = this.spans[lo],
      route = this.routes[span.routeIndex],
      elapsed = Math.max(0, time - span.start),
      t = Math.min(1, elapsed / span.duration),
      moving = span.phase === 'moving',
      turnback = span.phase === 'turnback',
      segmentIndex = Math.min(span.stopIndex, route.segments.length - 1);
    return {
      route,
      routeIndex: span.routeIndex,
      stopIndex: span.stopIndex,
      nextStopIndex: moving
        ? span.stopIndex + 1
        : Math.min(span.stopIndex + 1, route.stops.length - 1),
      segmentIndex,
      phase: span.phase,
      progress: moving ? quintic(t) : 0,
      speedMps: moving
        ? (route.segments[segmentIndex].lengthM * quinticVelocity(t)) /
          span.duration
        : 0,
      doorsOpen: span.phase === 'dwell',
      doorProgress:
        span.phase === 'opening'
          ? t
          : span.phase === 'dwell'
            ? 1
            : span.phase === 'closing'
              ? 1 - t
              : 0,
      phaseElapsed: elapsed,
      phaseDuration: span.duration,
      elapsed: this.elapsedSeconds,
      turnbackProgress: turnback ? quintic(t) : 0,
      terminalFromRoute: turnback ? route : null,
      terminalToRoute: turnback
        ? this.routes[span.routeIndex === 0 ? 1 : 0]
        : null,
    };
  }
}
