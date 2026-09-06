import type { WaterWorld, WaterSurface } from './water-world';
export interface BoatState {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  throttle: number;
  rudder: number;
  yawRate: number;
  speed: number;
  collided: boolean;
  surfaceId: string;
}
export interface BoatInput {
  thrust: number;
  turn: number;
  neutral: boolean;
}
export const initialBoatState = (): BoatState => ({
  x: 0,
  z: 0,
  yaw: 0,
  vx: 0,
  vz: 0,
  throttle: 0,
  rudder: 0,
  yawRate: 0,
  speed: 0,
  collided: false,
  surfaceId: 'sea',
});
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
/** Small fixed substeps: momentum, lateral drag and speed-dependent rudder authority. */
export function advanceBoat(
  state: BoatState,
  input: BoatInput,
  delta: number,
  world: Pick<WaterWorld, 'canOccupy' | 'at'>,
) {
  const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.1) : 0,
    steps = Math.max(1, Math.ceil(dt * 120)),
    h = dt / steps;
  state.collided = false;
  for (let i = 0; i < steps; i++) {
    const thrust = input.neutral ? 0 : clamp(input.thrust, -1, 1);
    state.throttle += (thrust - state.throttle) * (1 - Math.exp(-h / 0.6));
    state.rudder +=
      (clamp(input.turn, -1, 1) - state.rudder) * (1 - Math.exp(-h / 0.4));
    const fx = Math.sin(state.yaw),
      fz = Math.cos(state.yaw),
      rx = Math.cos(state.yaw),
      rz = -Math.sin(state.yaw);
    const forward = state.vx * fx + state.vz * fz,
      side = state.vx * rx + state.vz * rz;
    // Double the longitudinal response, retaining the same equilibrium cruise speed.
    const acceleration =
      2 *
      (state.throttle * (state.throttle >= 0 ? 1.65 : 0.9) -
        forward * 0.065 -
        forward * Math.abs(forward) * 0.028);
    state.vx += (fx * acceleration - rx * side * 1.35) * h;
    state.vz += (fz * acceleration - rz * side * 1.35) * h;
    const authority = clamp(forward, -2.7, 7.8);
    state.yawRate +=
      (state.rudder * authority * 0.05 - state.yawRate) *
      (1 - Math.exp(-h / 1.1));
    const yaw = state.yaw + state.yawRate * h,
      x = state.x + state.vx * h,
      z = state.z + state.vz * h;
    if (world.canOccupy(x, z, yaw, state.surfaceId)) {
      state.x = x;
      state.z = z;
      state.yaw = yaw;
    } else {
      state.vx = 0;
      state.vz = 0;
      state.yawRate = 0;
      state.throttle = 0;
      state.collided = true;
      break;
    }
  }
  state.speed = state.vx * Math.sin(state.yaw) + state.vz * Math.cos(state.yaw);
  return world.at(state.x, state.z) as WaterSurface;
}
