/** Original game stunt: a jet-assisted vault with one forward-axis barrel roll.
 * This module proposes motion only. The simulation must sweep every pose against
 * the real world and retain its ordinary launch/departure and landing proofs.
 */
import type { TeslaPose, TeslaVec3 } from './tesla-state';
import {
  TESLA_UP,
  teslaAxisRotation,
  teslaFrame,
  teslaRotate,
} from './tesla-math';

export const TESLA_VORTEX_LIMITS = Object.freeze({
  durationS: 1.4,
  liftS: 0.18,
  rollEndS: 1.22,
  minForwardSpeedMps: 30,
  maxForwardSpeedMps: 64,
  initialLiftMps: 14,
  gravityMps2: 20,
  /** A launch floor with normal.y > .92 has an absolute tangent grade < .426. */
  maxGradeMPerM: 0.43,
});

export interface TeslaVortexMotion {
  elapsedS: number;
  heading: number;
  forwardSpeedMps: number;
  /** Restore the prior flight choice; a ground vault finishes in natural descent. */
  restoreFlightAssist: boolean;
  /** Captured launch-floor tangent, never a continuing terrain/heightmap query. */
  gradeMPerM: number;
}

interface VortexCandidate extends TeslaPose {
  mode: 'ground' | 'wall' | 'air';
  velocity: TeslaVec3;
  heading: number;
  detachRemainingS: number;
  vortex?: TeslaVortexMotion | null;
  attachment?: unknown;
  groundDeparture?: unknown;
  departureContact?: unknown;
}

/** Shared UI/simulation eligibility. World support/clearance is proved separately. */
export function canStartTeslaVortex(state: VortexCandidate | null | undefined) {
  return !!(
    state &&
    ['ground', 'wall', 'air'].includes(state.mode) &&
    state.position.length === 3 &&
    state.position.every(Number.isFinite) &&
    state.velocity.length === 3 &&
    state.velocity.every(Number.isFinite) &&
    state.quaternion.length === 4 &&
    state.quaternion.every(Number.isFinite) &&
    Math.hypot(...state.quaternion) > 1e-9 &&
    Number.isFinite(state.heading) &&
    Number.isFinite(state.detachRemainingS) &&
    state.detachRemainingS <= 0 &&
    !state.vortex &&
    !state.attachment &&
    !state.groundDeparture &&
    !state.departureContact
  );
}

export function createTeslaVortex(
  heading: number,
  forwardSpeedMps = 0,
  restoreFlightAssist = false,
  gradeMPerM = 0,
): TeslaVortexMotion {
  if (
    !Number.isFinite(heading) ||
    !Number.isFinite(forwardSpeedMps) ||
    !Number.isFinite(gradeMPerM)
  )
    throw new RangeError('Invalid Tesla vortex launch');
  return {
    elapsedS: 0,
    heading: Math.atan2(Math.sin(heading), Math.cos(heading)),
    forwardSpeedMps: Math.max(
      TESLA_VORTEX_LIMITS.minForwardSpeedMps,
      Math.min(
        TESLA_VORTEX_LIMITS.maxForwardSpeedMps,
        Math.abs(forwardSpeedMps),
      ),
    ),
    restoreFlightAssist,
    gradeMPerM: Math.max(
      -TESLA_VORTEX_LIMITS.maxGradeMPerM,
      Math.min(TESLA_VORTEX_LIMITS.maxGradeMPerM, gradeMPerM),
    ),
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smoothstep = (n: number) => n * n * (3 - 2 * n);
const smootherstep = (n: number) => n * n * n * (n * (6 * n - 15) + 10);

/** Continuous rate/orientation samples; elapsed advances only after safe release.
 * Upright lift and settling windows leave room for tyres and upright landing.
 * Adjacent small samples, rather than a 0→360 endpoint sweep, prove the roll.
 */
export function sampleTeslaVortex(
  motion: TeslaVortexMotion,
  elapsedS = motion.elapsedS,
) {
  if (
    !Number.isFinite(elapsedS) ||
    elapsedS < 0 ||
    !Number.isFinite(motion.heading) ||
    !Number.isFinite(motion.forwardSpeedMps) ||
    !Number.isFinite(motion.gradeMPerM) ||
    Math.abs(motion.gradeMPerM) > TESLA_VORTEX_LIMITS.maxGradeMPerM ||
    motion.forwardSpeedMps < TESLA_VORTEX_LIMITS.minForwardSpeedMps ||
    motion.forwardSpeedMps > TESLA_VORTEX_LIMITS.maxForwardSpeedMps
  )
    throw new RangeError('Invalid Tesla vortex sample');
  const limits = TESLA_VORTEX_LIMITS,
    time = Math.min(elapsedS, limits.durationS),
    progress = time / limits.durationS,
    phase =
      time >= limits.durationS
        ? 'done'
        : time < limits.liftS
          ? 'lift'
          : time < limits.rollEndS
            ? 'roll'
            : 'settle',
    rollProgress = clamp01(
      (time - limits.liftS) / (limits.rollEndS - limits.liftS),
    ),
    rollRadians = Math.PI * 2 * smootherstep(rollProgress),
    forward: TeslaVec3 = [
      Math.sin(motion.heading),
      0,
      Math.cos(motion.heading),
    ],
    speed = motion.forwardSpeedMps * smoothstep(clamp01(time / limits.liftS)),
    up =
      phase === 'roll'
        ? teslaRotate(teslaAxisRotation(forward, rollRadians), TESLA_UP)
        : TESLA_UP,
    velocity: TeslaVec3 = [
      forward[0] * speed,
      limits.initialLiftMps -
        limits.gravityMps2 * time +
        motion.gradeMPerM * speed,
      forward[2] * speed,
    ],
    thrust =
      phase === 'done'
        ? 0
        : phase === 'lift'
          ? 1
          : phase === 'roll'
            ? 0.65 + 0.35 * Math.sin(rollProgress * Math.PI * 4) ** 2
            : 0.35 *
              (1 -
                clamp01(
                  (time - limits.rollEndS) /
                    (limits.durationS - limits.rollEndS),
                ));
  return {
    phase,
    progress,
    velocity,
    quaternion: teslaFrame(up, forward).quaternion,
    rollRadians,
    thrust,
  };
}
