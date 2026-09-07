import type { AircraftKind } from './flight-state';
export interface FlightSnapshot {
  exists: boolean;
  attached: boolean;
  placing: boolean;
  kind: AircraftKind | null;
  phase: string;
  power: number;
  altitude: number;
  speed: number;
  cruise: boolean;
  hover: boolean;
  join: boolean;
  view: 'cockpit' | 'clear' | 'chase';
  stalled: boolean;
  crashSeconds: number;
  warning: string;
  preview: {
    screen: [number, number];
    valid: boolean;
    kind: AircraftKind | null;
  } | null;
}
export const EMPTY_FLIGHT: FlightSnapshot = {
  exists: false,
  attached: false,
  placing: false,
  kind: null,
  phase: 'grounded',
  power: 0,
  altitude: 0,
  speed: 0,
  cruise: false,
  hover: false,
  join: false,
  view: 'chase',
  stalled: false,
  crashSeconds: 0,
  warning: '',
  preview: null,
};
