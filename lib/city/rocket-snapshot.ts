export type RocketView = 'first' | 'chase';
export type RocketSpaceFocus = 'rocket' | 'earth' | 'sun' | 'moon';
export interface RocketSnapshot {
  missionId: number;
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
    | 'falling'
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
  stage: 'boost' | 'separating' | 'upper' | 'coast';
  stageFuel: number;
  spaceFocus: RocketSpaceFocus;
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
  failureStage: 'none' | 'support-collapse' | 'freefall' | 'wreckage';
  failureAge: number;
  failureCause: 'impact' | 'fire' | 'aerodynamic' | '';
  vehicleFire: number;
  vehicleHeat: number;
  warning: string;
  view: RocketView;
  damaged: number;
  burning: number;
  debris: number;
}
export const EMPTY_ROCKET: RocketSnapshot = {
  missionId: 0,
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
  stage: 'boost',
  stageFuel: 1,
  spaceFocus: 'rocket',
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
  failureStage: 'none',
  failureAge: 0,
  failureCause: '',
  vehicleFire: 0,
  vehicleHeat: 0,
  warning: '',
  view: 'chase',
  damaged: 0,
  burning: 0,
  debris: 0,
};
