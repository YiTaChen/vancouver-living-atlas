/** Positive steering is left. Reverse travel reverses body yaw, not the wheel input.
 * Use actual speed so braking while still rolling forward keeps forward steering. */
export function drivingYawDelta(turn: number, speed: number, dt: number) {
  return turn * dt * (0.55 + Math.min(30, Math.abs(speed)) * 0.026) *
    (speed < 0 ? -1 : 1);
}
