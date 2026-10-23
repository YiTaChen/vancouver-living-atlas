import type { LineId, StationId } from './skytrain-network';

/** Public state shared by the city controller and its desktop/mobile controls. */
export interface SkyTrainTravelSnapshot {
  phase: 'idle' | 'loading' | 'station' | 'riding' | 'error';
  stationId: StationId | null;
  lineId: LineId | null;
  plannedLineId: LineId | null;
  destinationId: StationId;
  nextStationId: StationId | null;
  level: 'concourse' | 'platform';
  doorsOpen: boolean;
  canBoard: boolean;
  canAlight: boolean;
  canExit: boolean;
  canChangeLevel: boolean;
  canLeave?: boolean;
  speedMps: number;
  travelProgress: number;
  error: string | null;
  busy?: boolean;
  seated?: boolean;
  canWalkCabin?: boolean;
  transferAt?: StationId | null;
  availableLines?: readonly LineId[];
  headsign?: string;
  nextStopName?: string;
  atStop?: StationId | null;
  hint?:
    | 'approach-access'
    | 'approach-door'
    | 'board'
    | 'alight'
    | 'choose-destination'
    | 'wait'
    | 'transfer';
}

export const EMPTY_SKYTRAIN_TRAVEL: Readonly<SkyTrainTravelSnapshot> =
  Object.freeze({
    phase: 'idle',
    stationId: null,
    lineId: null,
    plannedLineId: null,
    destinationId: 'waterfront',
    nextStationId: null,
    level: 'concourse',
    doorsOpen: false,
    canBoard: false,
    canAlight: false,
    canExit: false,
    canChangeLevel: false,
    speedMps: 0,
    travelProgress: 0,
    error: null,
  });
