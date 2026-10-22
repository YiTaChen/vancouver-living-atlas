/** CPU-only sound policy. Distances are game metres, time is performance.now ms.
 * It never reads meshes, creates audio nodes or infers movement from a camera. */
export type SoundscapePoint = readonly [number, number, number];
export type FootstepSurface = 'pavement' | 'grass' | 'sand' | 'wood' | 'metal';
export interface SoundscapeTrain {
  id: string;
  position: SoundscapePoint;
  speedMps: number;
  aboard?: boolean;
}
export interface SoundscapeFrame {
  now: number;
  listener: SoundscapePoint;
  /** Camera world Y rotation: yaw zero looks toward -Z, right is +X. */
  yaw: number;
  interior: boolean;
  shoreDistanceM: number;
  greenery: number;
  harbourDistanceM: number;
  trains: readonly SoundscapeTrain[];
  footsteps?: {
    /** World position outdoors; carriage-local position while aboard. */
    position: SoundscapePoint;
    /** Change when placing, changing modes, entering or changing a carriage. */
    space: string;
    surface: FootstepSurface;
    active: boolean;
  };
}
export const SOUNDSCAPE_TRAIN_LIMIT = 3;
export const SOUNDSCAPE_VOICE_LIMIT = 8;
export const soundClamp = (value: number, lo = 0, hi = 1) =>
  Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : lo;
export const finiteSoundPoint = (point: SoundscapePoint) =>
  point?.length === 3 && point.every(Number.isFinite);

/** Smooth finite-radius rolloff; a missing source is silent, never full volume. */
export function soundDistanceGain(distance: number, near: number, far: number) {
  if (!Number.isFinite(distance) || distance < 0 || far <= near) return 0;
  const t = soundClamp((distance - near) / (far - near));
  return 1 - t * t * (3 - 2 * t);
}
export function soundPan(
  listener: SoundscapePoint,
  source: SoundscapePoint,
  yaw: number,
) {
  // Camera +X right vector is (cos(yaw), 0, -sin(yaw)).
  if (
    !finiteSoundPoint(listener) ||
    !finiteSoundPoint(source) ||
    !Number.isFinite(yaw)
  )
    return 0;
  const dx = source[0] - listener[0],
    dz = source[2] - listener[2];
  const length = Math.hypot(dx, dz);
  return length < 0.01
    ? 0
    : soundClamp((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length, -1, 1);
}
export function soundscapeMix(frame: SoundscapeFrame) {
  const valid = finiteSoundPoint(frame.listener) && Number.isFinite(frame.now);
  const outside = frame.interior ? 0.07 : 1;
  const coast = valid ? soundDistanceGain(frame.shoreDistanceM, 8, 180) : 0;
  const trains = valid
    ? frame.trains
        .filter(
          (train) =>
            train.id &&
            finiteSoundPoint(train.position) &&
            Number.isFinite(train.speedMps),
        )
        .map((train) => {
          const distance = Math.hypot(
            ...train.position.map((v, i) => v - frame.listener[i]),
          );
          const motion = soundClamp(Math.abs(train.speedMps) / 18);
          return {
            id: train.id,
            gain:
              (train.aboard
                ? 0.09
                : 0.16 * soundDistanceGain(distance, 10, 150) * outside) *
              (0.12 + 0.88 * motion),
            pan: train.aboard
              ? 0
              : soundPan(frame.listener, train.position, frame.yaw),
            frequency: 90 + motion * 520,
          };
        })
        .sort((a, b) => b.gain - a.gain || a.id.localeCompare(b.id))
        .slice(0, SOUNDSCAPE_TRAIN_LIMIT)
    : [];
  return {
    waves: coast * outside * 0.16,
    gulls: coast * outside * 0.15,
    birds: valid ? soundClamp(frame.greenery) * outside * 0.13 : 0,
    harbour: valid
      ? soundDistanceGain(frame.harbourDistanceM, 45, 650) * outside * 0.055
      : 0,
    trains,
  };
}
export interface FootstepEvent {
  surface: FootstepSurface;
  gain: number;
}

/** Cadence follows accepted displacement, with no hidden-tab or long-frame catch-up. */
export class FootstepTracker {
  private previous: {
    point: SoundscapePoint;
    space: string;
    now: number;
  } | null = null;
  private distance = 0;
  private lastStep = -Infinity;
  reset() {
    this.previous = null;
    this.distance = 0;
    this.lastStep = -Infinity;
  }
  sample(frame: SoundscapeFrame): FootstepEvent | null {
    const step = frame.footsteps;
    if (
      !step?.active ||
      !step.space ||
      !finiteSoundPoint(step.position) ||
      !Number.isFinite(frame.now)
    ) {
      this.reset();
      return null;
    }
    const before = this.previous;
    this.previous = {
      point: [...step.position],
      space: step.space,
      now: frame.now,
    };
    if (!before || before.space !== step.space) {
      this.distance = 0;
      return null;
    }
    const dt = (frame.now - before.now) / 1000;
    const moved = Math.hypot(
      ...step.position.map((v, i) => v - before.point[i]),
    );
    // 14 m/s allows the existing 12 m/s run; reject placements and long gaps.
    if (dt <= 0 || dt > 0.5 || moved > dt * 14 + 0.25) {
      this.distance = 0;
      return null;
    }
    if (moved < 0.002) return null;
    this.distance += moved;
    const speed = moved / dt;
    const stride = soundClamp(0.7 + speed * 0.07, 0.75, 1.5);
    if (this.distance < stride || frame.now - this.lastStep < 140) return null;
    this.distance %= stride;
    this.lastStep = frame.now;
    return {
      surface: step.surface,
      gain: soundClamp(0.025 + speed * 0.006, 0.025, 0.085),
    };
  }
}
