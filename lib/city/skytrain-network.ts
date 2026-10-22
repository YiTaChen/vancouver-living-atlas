/** Source-backed regional station order; the service clock is deliberately an
 * offline simulation, not TransLink's live service or timetable. See
 * docs/SKYTRAIN_STATION_REFERENCES_2026_10.md for source and modelling limits. */
export type StationId =
  | 'waterfront'
  | 'burrard'
  | 'granville'
  | 'stadium-chinatown'
  | 'main-street-science-world'
  | 'vancouver-city-centre'
  | 'yaletown-roundhouse';
export type LineId = 'expo' | 'canada';
export type SkyTrainDirection =
  | 'eastbound'
  | 'westbound'
  | 'northbound'
  | 'southbound';

export interface SkyTrainStation {
  readonly id: StationId;
  readonly name: string;
  readonly lonLat: readonly [number, number];
  readonly lines: readonly LineId[];
  readonly signature: string;
  readonly description: string;
}
const station = (
  id: StationId,
  name: string,
  lonLat: [number, number],
  lines: LineId[],
  signature: string,
  description: string,
): SkyTrainStation =>
  Object.freeze({
    id,
    name,
    lonLat: Object.freeze(lonLat),
    lines: Object.freeze(lines),
    signature,
    description,
  });

/** City of Vancouver geographic selection anchors, not surveyed door positions. */
export const SKYTRAIN_STATIONS: readonly SkyTrainStation[] = Object.freeze([
  station(
    'waterfront',
    'Waterfront',
    [-123.11173815504947, 49.286075484422376],
    ['expo', 'canada'],
    'heritage-transfer',
    'Heritage railway concourse with separate Expo and Canada Line platforms.',
  ),
  station(
    'burrard',
    'Burrard',
    [-123.11997233644202, 49.28586014917365],
    ['expo'],
    'stacked-underground',
    'Burrard and Dunsmuir street entrance, escalator hall and stacked underground platforms.',
  ),
  station(
    'granville',
    'Granville',
    [-123.11640402719512, 49.28363768680059],
    ['expo'],
    'deep-stacked-underground',
    'Deep Dunsmuir Tunnel platforms reached through a long escalator sequence.',
  ),
  station(
    'stadium-chinatown',
    'Stadium–Chinatown',
    [-123.10956479630316, 49.279441691877636],
    ['expo'],
    'beatty-pacific-levels',
    'Beatty Street upper entrance, lower Pacific Boulevard access and an open trackside platform.',
  ),
  station(
    'main-street-science-world',
    'Main Street–Science World',
    [-123.10060690768856, 49.27317791187965],
    ['expo'],
    'elevated-island',
    'Elevated island platform with east and west stationhouses at Main Street and Terminal Avenue.',
  ),
  station(
    'vancouver-city-centre',
    'Vancouver City Centre',
    [-123.11928408921445, 49.28173470745285],
    ['canada'],
    'underground-mall-concourse',
    'Granville and West Georgia entrance with underground mall connections and an island platform.',
  ),
  station(
    'yaletown-roundhouse',
    'Yaletown–Roundhouse',
    [-123.1218903777964, 49.2743622548375],
    ['canada'],
    'brick-pavilion-deep-platform',
    'Davie and Mainland entrance pavilion, escalators and a deep underground platform.',
  ),
]);

export interface SkyTrainLine {
  readonly id: LineId;
  readonly name: string;
  readonly color: string;
  /** Regional coverage, ordered away from Waterfront. */
  readonly stations: readonly StationId[];
}
export const SKYTRAIN_LINES: Readonly<Record<LineId, SkyTrainLine>> =
  Object.freeze({
    expo: Object.freeze({
      id: 'expo',
      name: 'Expo Line',
      color: '#005daa',
      stations: Object.freeze<StationId[]>([
        'waterfront',
        'burrard',
        'granville',
        'stadium-chinatown',
        'main-street-science-world',
      ]),
    }),
    canada: Object.freeze({
      id: 'canada',
      name: 'Canada Line',
      color: '#009ac7',
      stations: Object.freeze<StationId[]>([
        'waterfront',
        'vancouver-city-centre',
        'yaletown-roundhouse',
      ]),
    }),
  });
export function skyTrainStation(id: StationId): SkyTrainStation {
  const result = SKYTRAIN_STATIONS.find((value) => value.id === id);
  if (!result) throw new RangeError('Unknown regional SkyTrain station');
  return result;
}
export interface SkyTrainJourneyLeg {
  readonly lineId: LineId;
  readonly from: StationId;
  readonly to: StationId;
  readonly stops: readonly StationId[];
  readonly direction: 1 | -1;
  readonly directionName: SkyTrainDirection;
  readonly headsign: string;
}
export interface SkyTrainItinerary {
  readonly from: StationId;
  readonly to: StationId;
  readonly legs: readonly SkyTrainJourneyLeg[];
  readonly stops: readonly StationId[];
  readonly transferStation: 'waterfront' | null;
}
function leg(
  lineId: LineId,
  from: StationId,
  to: StationId,
): SkyTrainJourneyLeg {
  const line = SKYTRAIN_LINES[lineId],
    a = line.stations.indexOf(from),
    b = line.stations.indexOf(to);
  if (a < 0 || b < 0 || a === b)
    throw new RangeError('Invalid SkyTrain line leg');
  const direction = b > a ? 1 : -1;
  const stops =
    direction === 1
      ? line.stations.slice(a, b + 1)
      : line.stations.slice(b, a + 1).reverse();
  return Object.freeze({
    lineId,
    from,
    to,
    stops: Object.freeze(stops),
    direction,
    directionName:
      lineId === 'expo'
        ? direction === 1
          ? 'eastbound'
          : 'westbound'
        : direction === 1
          ? 'southbound'
          : 'northbound',
    // These are the real outward network destinations, not fabricated new
    // terminals at the edge of this regional simulation.
    headsign:
      direction === -1
        ? 'Waterfront'
        : lineId === 'expo'
          ? 'King George / Production Way–University'
          : 'YVR–Airport / Richmond–Brighouse',
  });
}
export function planSkyTrainJourney(
  from: StationId,
  to: StationId,
): SkyTrainItinerary {
  const source = skyTrainStation(from),
    destination = skyTrainStation(to);
  if (from === to)
    return Object.freeze({
      from,
      to,
      legs: Object.freeze([]),
      stops: Object.freeze([from]),
      transferStation: null,
    });
  const shared = source.lines.find((lineId) =>
    destination.lines.includes(lineId),
  );
  const legs = shared
    ? [leg(shared, from, to)]
    : [
        leg(source.lines[0], from, 'waterfront'),
        leg(destination.lines[0], 'waterfront', to),
      ];
  const stops = legs.flatMap((value, index) =>
    index ? value.stops.slice(1) : value.stops,
  );
  return Object.freeze({
    from,
    to,
    legs: Object.freeze(legs),
    stops: Object.freeze(stops),
    transferStation: shared ? null : 'waterfront',
  });
}

export function skyTrainStationDistance(from: StationId, to: StationId) {
  const [ax, ay] = skyTrainStation(from).lonLat,
    [bx, by] = skyTrainStation(to).lonLat;
  const r = Math.PI / 180,
    dLat = (by - ay) * r,
    dLon = (bx - ax) * r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(ay * r) * Math.cos(by * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/** Cumulative planar metres in the repository's selected GTFS shape snapshot,
 * in each line's away-from-Waterfront order. These are route distances rather
 * than a straight line drawn between station selection anchors. */
const SOURCE_ROUTE_STATIONS: Readonly<Record<LineId, readonly number[]>> =
  Object.freeze({
    expo: Object.freeze([0, 958.39849, 1348.097375, 1997.277173, 3045.967091]),
    canada: Object.freeze([0, 419.627991, 1578.753352]),
  });
export function skyTrainSegmentLength(
  from: StationId,
  to: StationId,
  lineId: LineId,
) {
  const line = SKYTRAIN_LINES[lineId];
  if (!line) throw new RangeError('Unknown regional SkyTrain line');
  const a = line.stations.indexOf(from),
    b = line.stations.indexOf(to);
  if (a < 0 || b < 0 || Math.abs(a - b) !== 1)
    throw new RangeError(
      'SkyTrain segment must join adjacent stations on one line',
    );
  return Math.abs(
    SOURCE_ROUTE_STATIONS[lineId][b] - SOURCE_ROUTE_STATIONS[lineId][a],
  );
}

export type SkyTrainJourneyPhase =
  | 'waiting'
  | 'boarding'
  | 'riding'
  | 'arrived'
  | 'complete'
  | 'cancelled';
export interface SkyTrainJourneyOptions {
  /** Offline game seconds. Defaults are 4, 2 and 7 respectively. */
  waitSeconds?: number;
  boardingSeconds?: number;
  dwellSeconds?: number;
  /** Adjacent-station travel only. Defaults to source length/11.8, clamped
   * 30..150 s, keeping quintic peak speed around the real train's 80 km/h. */
  segmentSeconds?: (from: StationId, to: StationId, lineId: LineId) => number;
}
export interface SkyTrainJourneySnapshot {
  readonly phase: SkyTrainJourneyPhase;
  readonly source: StationId;
  readonly destination: StationId;
  readonly currentStation: StationId;
  readonly nextStation: StationId | null;
  readonly lineId: LineId;
  readonly direction: 1 | -1;
  readonly directionName: SkyTrainDirection;
  readonly headsign: string;
  readonly aboard: boolean;
  readonly doorsOpen: boolean;
  readonly canBoard: boolean;
  readonly canAlight: boolean;
  readonly transferRequired: boolean;
  readonly legIndex: number;
  readonly stopIndex: number;
  readonly segmentFromStation: StationId;
  readonly segmentToStation: StationId;
  /** Smooth accepted segment fraction; endpoint poses remain stable on arrival. */
  readonly progress: number;
  readonly linearProgress: number;
  readonly segmentSeconds: number;
  readonly speedMps: number;
  readonly waitSeconds: number;
  readonly dwellRemainingSeconds: number;
  readonly itinerary: SkyTrainItinerary;
}
const smooth = (t: number) => t * t * t * (10 + t * (-15 + 6 * t));
const positive = (value: number | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0 || value > 300)
    throw new RangeError('Invalid SkyTrain gameplay timing');
  return value;
};

/** One passenger journey. This class grants no station, floor or boarding
 * permission: the city adapter still proves the occupied platform, door and
 * physical transfer route before invoking board()/alight(). */
export class SkyTrainJourney {
  readonly itinerary: SkyTrainItinerary;
  private phase: SkyTrainJourneyPhase = 'waiting';
  private aboard = false;
  private legIndex = 0;
  private stopIndex = 0;
  private elapsed = 0;
  private segmentFromStation: StationId;
  private segmentToStation: StationId;
  private duration = 0;
  private fraction = 0;
  private readonly waitDuration: number;
  private readonly boardingDuration: number;
  private readonly dwellDuration: number;
  private readonly segmentDurations = new Map<string, number>();
  constructor(
    readonly source: StationId,
    readonly destination: StationId,
    options: SkyTrainJourneyOptions = {},
  ) {
    this.itinerary = planSkyTrainJourney(source, destination);
    this.waitDuration = positive(options.waitSeconds, 4);
    this.boardingDuration = positive(options.boardingSeconds, 2);
    this.dwellDuration = positive(options.dwellSeconds, 7);
    const segmentDuration =
      options.segmentSeconds ??
      ((from: StationId, to: StationId, lineId: LineId) =>
        Math.max(
          30,
          Math.min(150, skyTrainSegmentLength(from, to, lineId) / 11.8),
        ));
    for (const routeLeg of this.itinerary.legs) {
      for (let i = 0; i < routeLeg.stops.length - 1; i++) {
        const from = routeLeg.stops[i],
          to = routeLeg.stops[i + 1];
        const value = segmentDuration(from, to, routeLeg.lineId);
        if (!Number.isFinite(value) || value <= 0 || value > 3600)
          throw new RangeError('Invalid SkyTrain segment timing');
        this.segmentDurations.set(`${routeLeg.lineId}:${from}:${to}`, value);
      }
    }
    this.segmentFromStation = source;
    this.segmentToStation = this.itinerary.legs[0]?.stops[1] ?? source;
    if (!this.itinerary.legs.length) this.phase = 'complete';
    else
      this.duration = this.validDuration(
        this.segmentFromStation,
        this.segmentToStation,
      );
  }
  private get currentLeg() {
    return this.itinerary.legs[this.legIndex];
  }
  private validDuration(from: StationId, to: StationId) {
    const value = this.segmentDurations.get(
      `${this.currentLeg.lineId}:${from}:${to}`,
    );
    if (value === undefined)
      throw new RangeError('Missing SkyTrain segment timing');
    return value;
  }
  private get atLegEnd() {
    return (
      !this.currentLeg || this.stopIndex === this.currentLeg.stops.length - 1
    );
  }
  private prepareSegment() {
    const leg = this.currentLeg;
    this.segmentFromStation = leg.stops[this.stopIndex];
    this.segmentToStation = leg.stops[this.stopIndex + 1];
    this.duration = this.validDuration(
      this.segmentFromStation,
      this.segmentToStation,
    );
    this.fraction = 0;
    this.elapsed = 0;
  }
  snapshot(): SkyTrainJourneySnapshot {
    const leg = this.currentLeg;
    const currentStation = leg?.stops[this.stopIndex] ?? this.source;
    const lineId = leg?.lineId ?? skyTrainStation(this.source).lines[0];
    const direction = leg?.direction ?? 1;
    const moving = this.phase === 'riding';
    const doorsOpen =
      (this.phase === 'boarding' && !this.aboard) || this.phase === 'arrived';
    return {
      phase: this.phase,
      source: this.source,
      destination: this.destination,
      currentStation,
      nextStation: leg?.stops[this.stopIndex + 1] ?? null,
      lineId,
      direction,
      directionName:
        leg?.directionName ?? (lineId === 'expo' ? 'eastbound' : 'southbound'),
      headsign: leg?.headsign ?? skyTrainStation(this.source).name,
      aboard: this.aboard,
      doorsOpen,
      canBoard: this.phase === 'boarding' && !this.aboard,
      canAlight: this.phase === 'arrived' && this.aboard,
      transferRequired:
        this.phase === 'arrived' &&
        this.atLegEnd &&
        this.legIndex < this.itinerary.legs.length - 1,
      legIndex: this.legIndex,
      stopIndex: this.stopIndex,
      segmentFromStation: this.segmentFromStation,
      segmentToStation: this.segmentToStation,
      progress: smooth(this.fraction),
      linearProgress: this.fraction,
      segmentSeconds: this.duration,
      // Derivative of the quintic smoothstep using the source GTFS shape length.
      // A city adapter may use its adjusted physical curve length for rendering.
      speedMps: moving
        ? (skyTrainSegmentLength(
            this.segmentFromStation,
            this.segmentToStation,
            lineId,
          ) /
            this.duration) *
          30 *
          this.fraction ** 2 *
          (1 - this.fraction) ** 2
        : 0,
      waitSeconds:
        this.phase === 'waiting'
          ? Math.max(0, this.waitDuration - this.elapsed)
          : 0,
      dwellRemainingSeconds:
        this.phase === 'arrived' && !this.atLegEnd
          ? Math.max(0, this.dwellDuration - this.elapsed)
          : 0,
      itinerary: this.itinerary,
    };
  }
  board() {
    if (this.phase !== 'boarding' || this.aboard) return false;
    this.aboard = true;
    this.elapsed = 0;
    return true;
  }
  alight() {
    if (this.phase !== 'arrived' || !this.aboard) return false;
    this.aboard = false;
    this.elapsed = 0;
    if (this.atLegEnd) {
      if (this.legIndex === this.itinerary.legs.length - 1) {
        this.phase = 'complete';
        return true;
      }
      this.legIndex++;
      this.stopIndex = 0;
    }
    this.prepareSegment();
    this.phase = 'waiting';
    return true;
  }
  cancel() {
    if (this.aboard || this.phase === 'complete' || this.phase === 'cancelled')
      return false;
    this.phase = 'cancelled';
    this.elapsed = 0;
    return true;
  }
  update(dt: number): SkyTrainJourneySnapshot {
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      this.phase === 'complete' ||
      this.phase === 'cancelled'
    )
      return this.snapshot();
    // Hidden/resumed tabs cannot skip stations or advance a full journey. The
    // adapter pauses hidden updates; a single coarse tick accepts at most 0.2 s.
    let remaining = Math.min(dt, 0.2);
    while (remaining > 1e-9) {
      const step = Math.min(remaining, 0.025);
      this.tick(step);
      remaining -= step;
    }
    return this.snapshot();
  }
  private tick(dt: number) {
    if (this.phase === 'waiting') {
      this.elapsed += dt;
      if (this.elapsed + 1e-9 >= this.waitDuration) {
        this.phase = 'boarding';
        this.elapsed = 0;
      }
    } else if (this.phase === 'boarding' && this.aboard) {
      this.elapsed += dt;
      if (this.elapsed + 1e-9 >= this.boardingDuration) {
        this.prepareSegment();
        this.phase = 'riding';
      }
    } else if (this.phase === 'riding') {
      this.elapsed = Math.min(this.duration, this.elapsed + dt);
      this.fraction = Math.min(1, this.elapsed / this.duration);
      if (this.fraction + 1e-9 >= 1) {
        this.fraction = 1;
        this.stopIndex++;
        this.phase = 'arrived';
        this.elapsed = 0;
      }
    } else if (this.phase === 'arrived' && this.aboard && !this.atLegEnd) {
      this.elapsed += dt;
      if (this.elapsed + 1e-9 >= this.dwellDuration) {
        this.prepareSegment();
        this.phase = 'boarding';
      }
    }
  }
}
