/** Autonomous offline bus service. Path stations are geographic metres; doors,
 * dwell, acceleration and braking advance without a passenger or UI action. */
export interface WorldBusStop {
  id: string;
  sourceStopId: string;
  stopCode: string;
  name: string;
  lonLat: number[];
  stationM: number;
  sourceServiceId: string;
  headsign: string;
}
export interface WorldBusRoute {
  id: string;
  /** x, z, cumulative planar metres, retaining original GTFS vertices. */
  points: [number, number, number][];
  stops: WorldBusStop[];
  legs: {
    sourceServiceId: string;
    sourceShapeId: string;
    headsign: string;
    fromM: number;
    toM: number;
  }[];
  lengthM: number;
}
export interface WorldBusPacket {
  schemaVersion: number;
  sourcePacketSha256: string;
  source: {
    provider: string;
    feedVersion: string;
    retrievedAtUtc: string;
    url: string;
  };
  legend: string;
  termsUrl: string;
  simulation: string;
  routes: WorldBusRoute[];
}
export type WorldBusPhase = 'moving' | 'opening' | 'dwell' | 'closing';
export interface WorldBusFrame {
  vehicleId: string;
  routeId: string;
  sourceServiceId: string;
  headsign: string;
  x: number;
  z: number;
  yaw: number;
  stationM: number;
  speedMps: number;
  phase: WorldBusPhase;
  doorProgress: number;
  stoppedSeconds: number;
  stop: WorldBusStop | null;
  /** Increases at each arrival; captured prompts cannot survive another stop. */
  stopVisit: number;
  progress: number;
}
const modulo = (value: number, length: number) =>
  ((value % length) + length) % length;
function centerline(route: WorldBusRoute, station: number) {
  const s = modulo(station, route.lengthM),
    points = route.points;
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (points[mid][2] > s) high = mid;
    else low = mid;
  }
  const a = points[low],
    b = points[high];
  const t = (s - a[2]) / (b[2] - a[2]);
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t };
}
/** A fixed right-hand lane offset, with a continuous heading around retained
 * vertices. Stops keep their real GTFS along-route location. This is an
 * illustrative lane datum, validated against world ground before movement. */
export function worldBusRoutePose(
  route: WorldBusRoute,
  station: number,
  laneOffsetM = 1.8,
) {
  const p = centerline(route, station),
    before = centerline(route, station - 3),
    after = centerline(route, station + 3);
  const yaw = Math.atan2(after.x - before.x, after.z - before.z);
  return {
    x: p.x - Math.cos(yaw) * laneOffsetM,
    z: p.z + Math.sin(yaw) * laneOffsetM,
    yaw,
  };
}
export function validateWorldBusPacket(value: unknown): WorldBusPacket {
  const packet = value as WorldBusPacket;
  if (
    !packet ||
    packet.schemaVersion !== 1 ||
    !packet.sourcePacketSha256 ||
    !packet.source?.feedVersion ||
    !Array.isArray(packet.routes) ||
    !packet.routes.length
  )
    throw Error('Invalid source-backed bus routes');
  for (const route of packet.routes) {
    if (
      !route.id ||
      !(route.lengthM > 100) ||
      route.points.length < 3 ||
      route.stops.length < 2 ||
      !route.legs.length
    )
      throw Error('Incomplete bus route');
    if (
      route.points.some(
        (p, i) =>
          p.length !== 3 ||
          !p.every(Number.isFinite) ||
          (i > 0 && p[2] <= route.points[i - 1][2]),
      )
    )
      throw Error('Invalid bus path stations');
    const a = route.points[0],
      b = route.points.at(-1)!;
    if (
      Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.05 ||
      Math.abs(b[2] - route.lengthM) > 0.05
    )
      throw Error('Bus route cannot wrap across a gap');
    if (
      route.stops.some(
        (s) =>
          !s.id ||
          !Number.isFinite(s.stationM) ||
          s.stationM < 0 ||
          s.stationM >= route.lengthM,
      )
    )
      throw Error('Invalid bus stop station');
  }
  return packet;
}
export class BusRouteRuntime {
  readonly vehicleId: string;
  readonly route: WorldBusRoute;
  private station: number;
  private speed = 0;
  private phase: WorldBusPhase = 'opening';
  private phaseTime = 0;
  private stopped = 0;
  private door = 0;
  private stopIndex: number;
  private stopVisit = 1;
  private stops: { stop: WorldBusStop; station: number }[];
  readonly dwellSeconds = 10;
  constructor(route: WorldBusRoute, vehicleId: string, initialStopIndex = 0) {
    this.route = route;
    this.vehicleId = vehicleId;
    // Source stop is the front-door station, rather than the bus centre.
    this.stops = route.stops
      .map((stop) => ({
        stop,
        station: modulo(stop.stationM - 4.6, route.lengthM),
      }))
      .sort((a, b) => a.station - b.station);
    this.stopIndex = modulo(initialStopIndex, this.stops.length);
    this.station = this.stops[this.stopIndex].station;
  }
  frame(): WorldBusFrame {
    const route = this.route,
      pose = worldBusRoutePose(route, this.station);
    const leg =
      route.legs.find((l) => this.station >= l.fromM && this.station < l.toM) ??
      route.legs[0];
    return {
      vehicleId: this.vehicleId,
      routeId: route.id,
      sourceServiceId: leg.sourceServiceId,
      headsign: leg.headsign,
      ...pose,
      stationM: this.station,
      speedMps: this.speed,
      phase: this.phase,
      doorProgress: this.door,
      stoppedSeconds: this.stopped,
      stop: this.phase === 'moving' ? null : this.stops[this.stopIndex].stop,
      stopVisit: this.stopVisit,
      progress: this.station / route.lengthM,
    };
  }
  /** dt is simulation time. The host explicitly freezes this while hidden. */
  update(
    dt: number,
    canMove: (frame: WorldBusFrame) => boolean = () => true,
    canDepart = true,
  ) {
    let remaining = Number.isFinite(dt) ? Math.max(0, Math.min(1, dt)) : 0;
    while (remaining > 1e-8) {
      const h = Math.min(0.05, remaining);
      remaining -= h;
      if (this.phase !== 'moving') {
        this.stopped += h;
        this.phaseTime += h;
        if (this.phase === 'opening') {
          this.door = Math.min(1, this.phaseTime);
          if (this.door === 1) {
            this.phase = 'dwell';
            this.phaseTime = 0;
          }
        } else if (this.phase === 'dwell') {
          if (this.phaseTime >= this.dwellSeconds && canDepart) {
            this.phase = 'closing';
            this.phaseTime = 0;
          }
        } else {
          this.door = Math.max(0, 1 - this.phaseTime);
          if (this.door === 0 && canDepart) {
            this.phase = 'moving';
            this.phaseTime = 0;
            this.stopped = 0;
            this.stopIndex = (this.stopIndex + 1) % this.stops.length;
          }
        }
        continue;
      }
      const target = this.stops[this.stopIndex].station;
      const distance = modulo(target - this.station, this.route.lengthM);
      const desired = Math.min(7.5, Math.sqrt(2 * 1.8 * distance));
      const speed = Math.max(
        0,
        this.speed +
          Math.max(-1.8 * h, Math.min(1.25 * h, desired - this.speed)),
      );
      const step = Math.min(distance, speed * h);
      const previous = this.station;
      this.station = modulo(this.station + step, this.route.lengthM);
      if (!canMove(this.frame())) {
        this.station = previous;
        this.speed = 0;
        continue;
      }
      this.speed = speed;
      if (distance - step < 0.02) {
        this.station = target;
        this.speed = 0;
        this.phase = 'opening';
        this.phaseTime = this.stopped = this.door = 0;
        this.stopVisit++;
      }
    }
    return this.frame();
  }
}
