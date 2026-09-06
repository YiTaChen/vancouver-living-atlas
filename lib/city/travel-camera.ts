import type { TravelMode } from './placement-geometry';

export type InteriorView = 'interior' | 'clear';
export type TravelView = {
  mode: 'orbit' | TravelMode;
  perspective: 'first' | 'third';
  interior: InteriorView;
};
export const TRAVEL_DEFAULT_DISTANCE = { walk: 0, drive: 14, boat: 18 };
export const TRAVEL_MAP_THRESHOLD = 96;
export const LOCAL_MAP_DISTANCE = 200;

/** The lift makes zoom reversible even at a zero-distance eye position. */
export function zoomTravel(distance: number, factor: number) {
  const current = Number.isFinite(distance)
    ? Math.max(0, Math.min(TRAVEL_MAP_THRESHOLD, distance))
    : 0;
  if (!Number.isFinite(factor) || factor <= 0)
    return { distance: current, exit: false };
  const next = Math.max(0, (current + 2) * factor - 2);
  return {
    distance: Math.min(TRAVEL_MAP_THRESHOLD, next),
    exit: next > TRAVEL_MAP_THRESHOLD,
  };
}

export function firstPerson(mode: TravelMode, distance: number) {
  return mode === 'walk' ? distance < 2 : distance <= 2.4;
}

/** A nearby map pose relative to the full player position, including deck height. */
export function localMapOffset(yaw: number) {
  const angle = 0.76;
  return {
    x: -Math.sin(yaw) * Math.cos(angle) * LOCAL_MAP_DISTANCE,
    y: Math.sin(angle) * LOCAL_MAP_DISTANCE,
    z: -Math.cos(yaw) * Math.cos(angle) * LOCAL_MAP_DISTANCE,
  };
}
