import type { TeslaModelQuality } from './assets/tesla-roadster-contract';
import type { TeslaQualityPreference } from './tesla-quality';
import type { TeslaView } from './tesla-camera';

export interface TeslaSnapshot {
  active: boolean;
  mode: 'ground' | 'wall' | 'air';
  transitioning: boolean;
  drifting: boolean;
  driftIntensity: number;
  speedKph: number;
  altitudeM: number;
  parked: boolean;
  wallHolding: boolean;
  surfaceHolding: boolean;
  onRoof: boolean;
  vortexActive: boolean;
  vortexProgress: number;
  vortexAvailable: boolean;
  adhesion: boolean;
  flightAssist: boolean;
  view: TeslaView;
  quality: TeslaQualityPreference;
  effectiveQuality: TeslaModelQuality;
  warning: 'no-spawn' | 'recovered' | 'boundary' | '';
}

export const EMPTY_TESLA: TeslaSnapshot = {
  active: false,
  mode: 'ground',
  transitioning: false,
  drifting: false,
  driftIntensity: 0,
  speedKph: 0,
  altitudeM: 0,
  parked: false,
  wallHolding: false,
  surfaceHolding: false,
  onRoof: false,
  vortexActive: false,
  vortexProgress: 0,
  vortexAvailable: false,
  adhesion: true,
  flightAssist: true,
  view: 'chase',
  quality: 'auto',
  effectiveQuality: 'medium',
  warning: '',
};
