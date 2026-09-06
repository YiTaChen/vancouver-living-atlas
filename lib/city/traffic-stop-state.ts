import { inPolygon, unproject } from './geo';
export const ROADSTER_ACCELERATION = 16;
export const ROADSTER_TOP_SPEED = 72; // m/s = 259.2 km/h
const downtown = [
  [-123.15, 49.292],
  [-123.133, 49.3],
  [-123.1, 49.289],
  [-123.098, 49.272],
  [-123.121, 49.269],
  [-123.146, 49.282],
];
export function inSpeedEnforcementArea(x: number, z: number) {
  return inPolygon(unproject(x, z), [downtown]);
}
export type StopPhase =
  | 'idle'
  | 'braking'
  | 'exit'
  | 'approach'
  | 'talk'
  | 'return'
  | 'enter'
  | 'depart';
const sequence: StopPhase[] = [
  'exit',
  'approach',
  'talk',
  'return',
  'enter',
  'depart',
];
export const STOP_DURATIONS: Partial<Record<StopPhase, number>> = {
  exit: 1.2,
  approach: 5,
  talk: 3,
  return: 5,
  enter: 1.2,
  depart: 5,
};
/** Simulation seconds, independent of the 300x day/night clock. */
export class TrafficStopState {
  phase: StopPhase = 'idle';
  elapsed = 0;
  speeding = 0;
  get active() {
    return this.phase !== 'idle';
  }
  cancel() {
    this.phase = 'idle';
    this.elapsed = 0;
    this.speeding = 0;
  }
  update(dt: number, speed: number, eligible: boolean) {
    const h = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    if (this.phase === 'idle') {
      this.speeding = eligible && speed * 3.6 > 100 ? this.speeding + h : 0;
      if (this.speeding >= 5 - 1e-8) {
        this.phase = 'braking';
        this.elapsed = 0;
      }
    } else if (this.phase === 'braking') {
      if (Math.abs(speed) < 0.1) {
        this.phase = 'exit';
        this.elapsed = 0;
      }
    } else {
      this.elapsed += h;
      if (this.elapsed >= STOP_DURATIONS[this.phase]!) {
        const next = sequence[sequence.indexOf(this.phase) + 1];
        if (next) {
          this.phase = next;
          this.elapsed = 0;
        } else this.cancel();
      }
    }
  }
}
