export type RocketView = 'first' | 'chase';
export interface RocketSnapshot {
  exists: boolean;
  active: boolean;
  placing: boolean;
  kind: 'small' | 'large';
  phase:
    | 'building'
    | 'ready'
    | 'countdown'
    | 'ignition'
    | 'flight'
    | 'space'
    | 'sinking'
    | 'crashed'
    | 'aborted';
  buildProgress: number;
  loaded: boolean;
  loadError: boolean;
  countdown: number;
  altitude: number;
  speed: number;
  fuel: number;
  throttle: number;
  tilt: number;
  pitch: number;
  roll: number;
  verticalSpeed: number;
  wind: number;
  auto: boolean;
  stabilize: boolean;
  support: string;
  supportIntegrity: number;
  warning: string;
  view: RocketView;
  damaged: number;
  burning: number;
  debris: number;
}
export const EMPTY_ROCKET: RocketSnapshot = {
  exists: false,
  active: false,
  placing: false,
  kind: 'small',
  phase: 'building',
  buildProgress: 0,
  loaded: false,
  loadError: false,
  countdown: 0,
  altitude: 0,
  speed: 0,
  fuel: 1,
  throttle: 0,
  tilt: 0,
  pitch: 0,
  roll: 0,
  verticalSpeed: 0,
  wind: 0,
  auto: true,
  stabilize: true,
  support: 'ground',
  supportIntegrity: 1,
  warning: '',
  view: 'chase',
  damaged: 0,
  burning: 0,
  debris: 0,
};
