/** Shared, bounded road-tyre oversteer. Body heading and travel heading remain
 * separate; callers must sweep the real body pose along the requested travel.
 * This module never changes floor permissions or supplies propulsion. */
export type VehicleDriftProfile = 'classic' | 'roadster' | 'tesla';
export type VehicleDriftState = {
  /** Travel yaw relative to the body: opposite the initiating turn. */
  slipAngle: number;
  engagement: number;
  active: boolean;
};
export type VehicleDriftInput = {
  dt: number;
  /** Actual signed travel speed, not its projection on the body forward axis. */
  speed: number;
  steer: number;
  held: boolean;
  /** Road contact only: airborne, roof and wall modes must pass false. */
  grounded: boolean;
  brake?: boolean;
  normalYawDelta?: number;
  profile?: VehicleDriftProfile;
};
export type VehicleDriftStep = {
  yawScale: number;
  yawDelta: number;
  travelYawOffset: number;
  speed: number;
  intensity: number;
  active: boolean;
};

export const VEHICLE_DRIFT_LIMITS = {
  entrySpeedMps: 6.2,
  exitSpeedMps: 3.2,
  maximumSlipRadians: (32 * Math.PI) / 180,
  maximumFrameS: 0.1,
} as const;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function createVehicleDrift(): VehicleDriftState {
  return { slipAngle: 0, engagement: 0, active: false };
}

export function resetVehicleDrift(state: VehicleDriftState) {
  state.slipAngle = 0;
  state.engagement = 0;
  state.active = false;
}

/** Read-only FX/HUD signal. Residual slip can remain while grip recovers. */
export function vehicleDriftIntensity(
  state: VehicleDriftState,
  speed: number,
  profile?: VehicleDriftProfile,
) {
  if (
    !Number.isFinite(speed) ||
    speed < VEHICLE_DRIFT_LIMITS.exitSpeedMps ||
    !Number.isFinite(state.slipAngle) ||
    !Number.isFinite(state.engagement)
  )
    return 0;
  const maxSlip =
    profile === 'classic'
      ? (24 * Math.PI) / 180
      : VEHICLE_DRIFT_LIMITS.maximumSlipRadians;
  return clamp(
    (Math.abs(state.slipAngle) / (maxSlip * 0.6)) *
      clamp(state.engagement, 0, 1) *
      clamp((speed - VEHICLE_DRIFT_LIMITS.exitSpeedMps) / 18, 0, 1),
    0,
    1,
  );
}

export function stepVehicleDrift(
  state: VehicleDriftState,
  input: VehicleDriftInput,
): VehicleDriftStep {
  const speed = Number.isFinite(input.speed) ? input.speed : 0;
  const normalYawDelta = Number.isFinite(input.normalYawDelta)
    ? input.normalYawDelta!
    : 0;
  const neutral = (): VehicleDriftStep => ({
    yawScale: 1,
    yawDelta: normalYawDelta,
    travelYawOffset: 0,
    speed,
    intensity: 0,
    active: false,
  });
  if (
    !Number.isFinite(state.slipAngle) ||
    !Number.isFinite(state.engagement) ||
    !Number.isFinite(input.dt) ||
    input.dt <= 0 ||
    !input.grounded ||
    input.brake ||
    speed < VEHICLE_DRIFT_LIMITS.exitSpeedMps
  ) {
    resetVehicleDrift(state);
    return neutral();
  }
  const steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
  // Ordinary steering stays bit-for-bit unchanged until an actual initiation.
  if (
    state.slipAngle === 0 &&
    state.engagement === 0 &&
    (!input.held ||
      Math.abs(steer) < 0.12 ||
      speed < VEHICLE_DRIFT_LIMITS.entrySpeedMps)
  ) {
    state.active = false;
    return neutral();
  }

  const dt = Math.min(input.dt, VEHICLE_DRIFT_LIMITS.maximumFrameS);
  const maxSlip =
    input.profile === 'classic'
      ? (24 * Math.PI) / 180
      : VEHICLE_DRIFT_LIMITS.maximumSlipRadians;
  const oldSlip = clamp(state.slipAngle, -maxSlip, maxSlip);
  const oldEngagement = clamp(state.engagement, 0, 1);
  const threshold =
    state.active || oldEngagement > 0.05
      ? VEHICLE_DRIFT_LIMITS.exitSpeedMps
      : VEHICLE_DRIFT_LIMITS.entrySpeedMps;
  const held = input.held && speed >= threshold;
  state.active = held && (Math.abs(steer) >= 0.12 || Math.abs(oldSlip) > 0.025);
  const targetEngagement = state.active ? 1 : 0;
  const speedBlend = clamp(
    (speed - VEHICLE_DRIFT_LIMITS.exitSpeedMps) / 18,
    0,
    1,
  );
  // Countersteering first catches the slide, rather than instantly reversing
  // lateral velocity into a second full-strength drift.
  const countersteering = Math.abs(oldSlip) > 0.04 && oldSlip * steer > 0;
  const slipGain =
    state.active && !countersteering
      ? -steer * maxSlip * (0.25 + 0.75 * speedBlend)
      : 0;
  const engagementRate = targetEngagement ? 8 : 6;
  const gripRate = countersteering || !held ? 10 : 6;
  const engageDecay = Math.exp(-engagementRate * dt);
  const gripDecay = Math.exp(-gripRate * dt);
  const response =
    Math.abs(gripRate - engagementRate) < 1e-8
      ? gripRate * dt * gripDecay
      : (gripRate * (engageDecay - gripDecay)) / (gripRate - engagementRate);
  // Exact coupled exponential response for constant input. Integrating a
  // frame's newly blended engagement as a constant would depend on frame rate.
  state.slipAngle = clamp(
    oldSlip * gripDecay +
      slipGain *
        (targetEngagement * (1 - gripDecay) +
          (oldEngagement - targetEngagement) * response),
    -maxSlip,
    maxSlip,
  );
  state.engagement = clamp(
    targetEngagement + (oldEngagement - targetEngagement) * engageDecay,
    0,
    1,
  );
  if (Math.abs(state.slipAngle) < 1e-5 && state.engagement < 1e-5) {
    resetVehicleDrift(state);
    return neutral();
  }
  const averageEngagement =
    targetEngagement +
    ((oldEngagement - targetEngagement) * (1 - engageDecay)) /
      (engagementRate * dt);
  const yawScale =
    1 + (countersteering ? 0.12 : 0.28) * averageEngagement * speedBlend;
  const drag =
    (0.12 *
      (Math.abs(oldSlip) * oldEngagement +
        Math.abs(state.slipAngle) * state.engagement)) /
    (2 * maxSlip);
  const driftedSpeed = speed * Math.exp(-drag * dt);
  const intensity = vehicleDriftIntensity(state, driftedSpeed, input.profile);
  return {
    yawScale,
    yawDelta: normalYawDelta * yawScale,
    travelYawOffset: state.slipAngle,
    speed: driftedSpeed,
    intensity,
    active: state.active && intensity > 0.025,
  };
}
