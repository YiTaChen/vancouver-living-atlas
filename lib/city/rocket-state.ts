/**
 * Deterministic, renderer-independent rocket game simulation.
 *
 * Units: metres, seconds, kilograms and radians. +y is up; +x/+z are horizontal.
 * position is the nozzle/base, not the centre. pitch leans towards +z, roll
 * towards +x. altitude is height gained from the original launch surface.
 * This is deliberately a playable ascent, not an orbital flight predictor.
 * Call stepRocket at a fixed timestep (1/60 recommended). It returns a new
 * snapshot and never mutates its arguments. Delays > 0.25s are capped to avoid
 * a background-tab pause teleporting a rocket through the city.
 */

export type RocketKind = 'small' | 'large' | 'super-heavy';
export type RocketMode = 'auto' | 'manual';
export type RocketStage =
  | 'strap-on'
  | 'strap-separating'
  | 'boost'
  | 'separating'
  | 'upper'
  | 'coast';
export type RocketFailureStage =
  | 'none'
  | 'support-collapse'
  | 'freefall'
  | 'wreckage';
export type RocketDestructionCause = 'impact' | 'fire' | 'aerodynamic';
export interface RocketWreckage {
  /** Actual destruction pose and incoming momentum, never zeroed by settling. */
  time: number;
  position: RocketVector;
  velocity: RocketVector;
  attitude: RocketAttitude;
  angularVelocity: RocketAttitude;
  cause: RocketDestructionCause;
  exploded: boolean;
  /** Delay from impact to an eligible fuel explosion; null means no explosion. */
  explosionDelay: number | null;
  /** Actual explosion timestamp; null until the event has happened. */
  explosionTime: number | null;
}
export interface RocketStageConfig {
  dryMass: number;
  fuelMass: number;
  maxThrust: number;
  fuelPerSecond: number;
}
export interface RocketSeparation {
  time: number;
  flightTime: number;
  position: RocketVector;
  velocity: RocketVector;
  attitude: RocketAttitude;
}
export type RocketPhase =
  | 'building'
  | 'ready'
  | 'countdown'
  | 'ignition'
  | 'flight'
  | 'space'
  | 'sinking'
  | 'falling'
  | 'crashed'
  | 'aborted';
export type RocketSupportKind =
  | 'ground'
  | 'platform'
  | 'roof-small'
  | 'roof-large'
  | 'ocean'
  | 'river'
  | 'lake';
export interface RocketVector {
  x: number;
  y: number;
  z: number;
}
export interface RocketAttitude {
  pitch: number;
  roll: number;
}
export interface RocketSupport {
  kind: RocketSupportKind;
  /** Optional structural capacity, 0..1; a reinforced platform is 1. */
  strength?: number;
  /** Ground collision height below a roof; defaults to the placement height. */
  groundY?: number;
  /** Stable numeric seed, if replaying a placement. Otherwise derived from x/z. */
  seed?: number;
}
export interface RocketConfig {
  label: string;
  height: number;
  radius: number;
  /** Physical closed fins/side boosters; aerodynamic reference stays radius. */
  footprintRadius: number;
  upperFootprintRadius: number;
  dryMass: number;
  fuelMass: number;
  maxThrust: number;
  fuelPerSecond: number;
  stages: Readonly<Record<'boost' | 'upper', Readonly<RocketStageConfig>>>;
  /** Optional aggregate mass, fuel and thrust of four external boosters. */
  strapOns?: Readonly<RocketStageConfig>;
  strapSeparationDuration?: number;
  separationDuration: number;
  upperIgnitionDuration: number;
  stageCutFraction: number;
  upperNozzleFraction: number;
  buildDuration: number;
  countdownDuration: number;
  ignitionDuration: number;
  dragCoefficient: number;
  angularAcceleration: number;
  angularDamping: number;
  windTorque: number;
  blastRadius: number;
  heatRadius: number;
  /** Local pressure/heat strength; does not inflate the configured radii. */
  effectStrength: number;
  cameraDistance: number;
}
export const ROCKET_CONFIGS: Readonly<
  Record<RocketKind, Readonly<RocketConfig>>
> = {
  small: {
    label: 'Scout',
    height: 18,
    radius: 1.1,
    footprintRadius: 2.22,
    upperFootprintRadius: 1.15,
    dryMass: 7_000,
    fuelMass: 20_000,
    maxThrust: 1_600_000,
    fuelPerSecond: 16_000 / 24,
    stages: {
      boost: {
        dryMass: 5_000,
        fuelMass: 16_000,
        maxThrust: 1_600_000,
        fuelPerSecond: 16_000 / 24,
      },
      upper: {
        dryMass: 2_000,
        fuelMass: 4_000,
        maxThrust: 220_000,
        fuelPerSecond: 80,
      },
    },
    separationDuration: 0.6,
    upperIgnitionDuration: 0.4,
    stageCutFraction: 0.46,
    upperNozzleFraction: 0.418,
    // Preserve the original loading window independently of flight pacing.
    buildDuration: 6,
    countdownDuration: 5,
    ignitionDuration: 0.8,
    dragCoefficient: 0.42,
    angularAcceleration: 1.35,
    angularDamping: 0.32,
    windTorque: 0.055,
    blastRadius: 35,
    heatRadius: 17,
    effectStrength: 1,
    cameraDistance: 48,
  },
  large: {
    label: 'Atlas',
    height: 48,
    radius: 3.5,
    footprintRadius: 9.8,
    upperFootprintRadius: 4.9,
    dryMass: 100_000,
    fuelMass: 310_000,
    maxThrust: 21_000_000,
    fuelPerSecond: 10_000,
    stages: {
      boost: {
        dryMass: 75_000,
        fuelMass: 250_000,
        maxThrust: 21_000_000,
        fuelPerSecond: 10_000,
      },
      upper: {
        dryMass: 25_000,
        fuelMass: 60_000,
        maxThrust: 3_000_000,
        fuelPerSecond: 1_200,
      },
    },
    separationDuration: 0.6,
    upperIgnitionDuration: 0.4,
    stageCutFraction: 0.46,
    upperNozzleFraction: 0.418,
    buildDuration: 10,
    countdownDuration: 5,
    ignitionDuration: 1.2,
    dragCoefficient: 0.38,
    angularAcceleration: 0.46,
    angularDamping: 0.62,
    windTorque: 0.012,
    blastRadius: 100,
    heatRadius: 45,
    effectStrength: 1,
    cameraDistance: 110,
  },
  'super-heavy': {
    label: 'Titan',
    height: 110,
    radius: 6.3,
    footprintRadius: 14.1,
    upperFootprintRadius: 10.1,
    dryMass: 460_000,
    fuelMass: 1_426_000,
    maxThrust: 93_000_000,
    fuelPerSecond: 500_000 / 12 + 650_000 / 25,
    strapOns: {
      dryMass: 140_000,
      fuelMass: 500_000,
      maxThrust: 43_000_000,
      fuelPerSecond: 500_000 / 12,
    },
    strapSeparationDuration: 0.8,
    stages: {
      boost: {
        dryMass: 205_000,
        fuelMass: 650_000,
        maxThrust: 50_000_000,
        fuelPerSecond: 650_000 / 25,
      },
      upper: {
        dryMass: 115_000,
        fuelMass: 276_000,
        maxThrust: 13_100_000,
        fuelPerSecond: 5_520,
      },
    },
    separationDuration: 0.6,
    upperIgnitionDuration: 0.4,
    stageCutFraction: 0.46,
    upperNozzleFraction: 0.418,
    buildDuration: 16,
    countdownDuration: 5,
    ignitionDuration: 2,
    dragCoefficient: 0.34,
    angularAcceleration: 0.24,
    angularDamping: 0.78,
    windTorque: 0.006,
    blastRadius: 220,
    heatRadius: 105,
    effectStrength: 2.2,
    cameraDistance: 245,
  },
};

/** Structural loads are independent from the pilot's fixed-step control clock. */
const SUPPORT_LOADS: Readonly<
  Record<
    RocketKind,
    {
      minimumStrength: number;
      roofOverload: number;
      referenceThrust: number;
      lakeFatigue: number;
      lakeThrust: number;
      lakeWobble: number;
    }
  >
> = {
  small: {
    minimumStrength: 0.28,
    roofOverload: 1.3,
    referenceThrust: 470_000,
    lakeFatigue: 0.009,
    lakeThrust: 0.44,
    lakeWobble: 0.5,
  },
  large: {
    minimumStrength: 0.93,
    roofOverload: 5,
    referenceThrust: 6_800_000,
    lakeFatigue: 0.018,
    lakeThrust: 1.25,
    lakeWobble: 0.9,
  },
  'super-heavy': {
    minimumStrength: 0.995,
    roofOverload: 6.5,
    referenceThrust: 6_800_000,
    lakeFatigue: 0.035,
    lakeThrust: 1.6,
    lakeWobble: 1.05,
  },
};
const EXHAUST_RESPONSE: Readonly<
  Record<RocketKind, { impulse: number; shake: number }>
> = {
  small: { impulse: 18, shake: 0.4 },
  large: { impulse: 48, shake: 1 },
  'super-heavy': { impulse: 48, shake: 1 },
};
export const SPACE_ALTITUDE = 100_000;
export const ROCKET_FIXED_STEP = 1 / 60;
/** The structure visibly sags before its remaining supports let go. */
export const ROCKET_SUPPORT_RELEASE_DELAY = 1.5;
export const ROCKET_SUPPORT_STRENGTH: Readonly<
  Record<RocketSupportKind, number>
> = {
  ground: 1,
  platform: 1,
  'roof-small': 0.38,
  'roof-large': 0.8,
  ocean: 0,
  river: 0,
  lake: 0.22,
};
export type RocketEventType =
  | 'ready'
  | 'countdown'
  | 'ignition'
  | 'liftoff'
  | 'support-collapsed'
  | 'support-lost'
  | 'strap-on-burnout'
  | 'strap-on-separation'
  | 'core-ignition'
  | 'core-only'
  | 'vehicle-ignited'
  | 'vehicle-extinguished'
  | 'ruptured'
  | 'exploded'
  | 'booster-burnout'
  | 'stage-separation'
  | 'upper-ignition'
  | 'upper-burnout'
  | 'fuel-empty'
  | 'mission-complete'
  | 'impact'
  | 'abort'
  | 'sinking';
export interface RocketEvent {
  id: number;
  type: RocketEventType;
  time: number;
  position: RocketVector;
  /** Speed for impact/rupture, separated mass, or normalized thermal severity. */
  magnitude: number;
}
export interface RocketState {
  kind: RocketKind;
  mode: RocketMode;
  stabilize: boolean;
  phase: RocketPhase;
  stage: RocketStage;
  stageElapsed: number;
  strapFuel: number;
  strapAttached: boolean;
  strapSeparation: RocketSeparation | null;
  boosterFuel: number;
  upperFuel: number;
  boosterAttached: boolean;
  mass: number;
  stageThrust: number;
  /** Immutable launch-world snapshot; position remains a continuous virtual base. */
  separation: RocketSeparation | null;
  position: RocketVector;
  velocity: RocketVector;
  origin: RocketVector;
  attitude: RocketAttitude;
  angularVelocity: RocketAttitude;
  support: RocketSupport;
  supportIntegrity: number;
  supportCollapsed: boolean;
  failureStage: RocketFailureStage;
  /** Seconds since structural collapse began, including the initial sag. */
  supportCollapseElapsed: number;
  /** External heating and onboard fire are distinct from exhaust effects. */
  heat: number;
  fireIntensity: number;
  fireElapsed: number;
  fireDamage: number;
  /** Seeded material/propellant vulnerability, 0..1. */
  fireSusceptibility: number;
  wreckage: RocketWreckage | null;
  fuel: number;
  throttle: number;
  targetThrottle: number;
  integrity: number;
  elapsed: number;
  phaseElapsed: number;
  flightElapsed: number;
  buildProgress: number;
  countdown: number;
  altitude: number;
  maxAltitude: number;
  speed: number;
  acceleration: RocketVector;
  dynamicPressure: number;
  wind: RocketVector;
  seed: number;
  /** A bounded persistent event log; consume IDs, so render-rate gaps lose none. */
  events: RocketEvent[];
  nextEventId: number;
  failureReason: string | null;
}
export type RocketSnapshot = RocketState;
export interface RocketInput {
  mode?: RocketMode;
  auto?: boolean;
  /** Absolute throttle command 0..1. Auto supplies its own command. */
  throttle?: number;
  /** Manual gimbal commands -1..1; release to stop applying torque. */
  pitch?: number;
  roll?: number;
  /** Physical rate damping assist, available in manual mode without steering. */
  stabilize?: boolean;
  /** Multiplier for deterministic gusts, defaults to 1 (0 disables wind). */
  windScale?: number;
  /** Nearby vegetation/vehicle fire heat reaching the body, 0..1. */
  fireExposure?: number;
  launch?: boolean;
  /** Engine shutdown. Vehicle continues falling until it hits the ground. */
  abort?: boolean;
}
export interface RocketEnvironmentEffects {
  nozzle: RocketVector;
  direction: RocketVector;
  /** Engine power, 0..1, independent of the nozzle's altitude. */
  engine: number;
  /** Ground exposure includes plume height/direction falloff, 0..1. */
  groundExposure: number;
  blastRadius: number;
  heatRadius: number;
  /** Radius and heat are game-scaled city effects, not engineering estimates. */
  debrisImpulse: number;
  shake: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const finite = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const length = (v: RocketVector) => Math.hypot(v.x, v.y, v.z);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const isRoof = (kind: RocketSupportKind) =>
  kind === 'roof-small' || kind === 'roof-large';
const seeded = (seed: number, salt: number) => {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};
function stageMaximumThrust(s: RocketState): number {
  const config = ROCKET_CONFIGS[s.kind];
  let maximum = 0;
  if (s.stage === 'strap-on' && s.strapAttached && s.strapFuel > 0)
    maximum += config.strapOns?.maxThrust ?? 0;
  if (
    (s.stage === 'strap-on' ||
      s.stage === 'strap-separating' ||
      s.stage === 'boost') &&
    s.boosterAttached &&
    s.boosterFuel > 0
  )
    maximum += config.stages.boost.maxThrust;
  if (s.stage === 'upper' && s.upperFuel > 0)
    maximum += config.stages.upper.maxThrust;
  return maximum;
}
const hasEngine = (s: RocketState) =>
  (s.phase === 'ignition' || s.phase === 'flight') && stageMaximumThrust(s) > 0;

export function rocketMass(s: RocketState): number {
  const { stages, strapOns } = ROCKET_CONFIGS[s.kind];
  return (
    stages.upper.dryMass +
    s.upperFuel +
    (s.boosterAttached ? stages.boost.dryMass + s.boosterFuel : 0) +
    (s.strapAttached && strapOns ? strapOns.dryMass + s.strapFuel : 0)
  );
}

export function rocketDirection(attitude: RocketAttitude): RocketVector {
  return {
    x: Math.sin(attitude.roll) * Math.cos(attitude.pitch),
    y: Math.cos(attitude.roll) * Math.cos(attitude.pitch),
    z: Math.sin(attitude.pitch),
  };
}

function addEvent(s: RocketState, type: RocketEventType, magnitude = 0) {
  s.events.push({
    id: s.nextEventId++,
    type,
    time: s.elapsed,
    position: { ...s.position },
    magnitude,
  });
  if (s.events.length > 32) s.events.shift();
}
function setPhase(s: RocketState, phase: RocketPhase, event?: RocketEventType) {
  s.phase = phase;
  s.phaseElapsed = 0;
  if (event) addEvent(s, event);
}
function setStage(s: RocketState, stage: RocketStage, event?: RocketEventType) {
  s.stage = stage;
  s.stageElapsed = 0;
  if (event) addEvent(s, event);
}
function cloneState(s: RocketState): RocketState {
  return {
    ...s,
    position: { ...s.position },
    velocity: { ...s.velocity },
    origin: { ...s.origin },
    attitude: { ...s.attitude },
    angularVelocity: { ...s.angularVelocity },
    support: { ...s.support },
    acceleration: { ...s.acceleration },
    wind: { ...s.wind },
    events: [...s.events],
    strapSeparation: s.strapSeparation
      ? {
          ...s.strapSeparation,
          position: { ...s.strapSeparation.position },
          velocity: { ...s.strapSeparation.velocity },
          attitude: { ...s.strapSeparation.attitude },
        }
      : null,
    wreckage: s.wreckage
      ? {
          ...s.wreckage,
          position: { ...s.wreckage.position },
          velocity: { ...s.wreckage.velocity },
          attitude: { ...s.wreckage.attitude },
          angularVelocity: { ...s.wreckage.angularVelocity },
        }
      : null,
    separation: s.separation
      ? {
          ...s.separation,
          position: { ...s.separation.position },
          velocity: { ...s.separation.velocity },
          attitude: { ...s.separation.attitude },
        }
      : null,
  };
}
export function createRocket(
  kind: RocketKind,
  x: number,
  y: number,
  z: number,
  support: RocketSupport = { kind: 'ground' },
): RocketState {
  const config = ROCKET_CONFIGS[kind];
  const position = { x: finite(x, 0), y: finite(y, 0), z: finite(z, 0) };
  const groundY = finite(
    support.groundY,
    isRoof(support.kind)
      ? position.y - (support.kind === 'roof-small' ? 8 : 30)
      : position.y,
  );
  const seed = finite(
    support.seed,
    Math.abs(Math.sin(position.x * 0.017 + position.z * 0.039)) * 10_000,
  );
  const state: RocketState = {
    kind,
    mode: 'auto',
    stabilize: false,
    phase: 'building',
    stage: config.strapOns ? 'strap-on' : 'boost',
    stageElapsed: 0,
    strapFuel: config.strapOns?.fuelMass ?? 0,
    strapAttached: !!config.strapOns,
    strapSeparation: null,
    boosterFuel: config.stages.boost.fuelMass,
    upperFuel: config.stages.upper.fuelMass,
    boosterAttached: true,
    mass: config.dryMass + config.fuelMass,
    stageThrust: 0,
    separation: null,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    origin: { ...position },
    attitude: { pitch: 0, roll: 0 },
    angularVelocity: { pitch: 0, roll: 0 },
    support: {
      ...support,
      groundY,
      strength: clamp(
        finite(support.strength, ROCKET_SUPPORT_STRENGTH[support.kind]),
        0,
        1,
      ),
    },
    supportIntegrity: 1,
    supportCollapsed: false,
    failureStage: 'none',
    supportCollapseElapsed: 0,
    heat: 0,
    fireIntensity: 0,
    fireElapsed: 0,
    fireDamage: 0,
    fireSusceptibility: seeded(seed, 1),
    wreckage: null,
    fuel: config.fuelMass,
    throttle: 0,
    targetThrottle: 1,
    integrity: 1,
    elapsed: 0,
    phaseElapsed: 0,
    flightElapsed: 0,
    buildProgress: 0,
    countdown: config.countdownDuration,
    altitude: 0,
    maxAltitude: 0,
    speed: 0,
    acceleration: { x: 0, y: 0, z: 0 },
    dynamicPressure: 0,
    wind: { x: 0, y: 0, z: 0 },
    seed,
    events: [],
    nextEventId: 1,
    failureReason: null,
  };
  if (support.kind === 'ocean' || support.kind === 'river') {
    state.failureReason = 'Water cannot support a launch vehicle.';
    setPhase(state, 'sinking', 'sinking');
  }
  return state;
}

/** Request launch when construction has finished. Unsafe placement is allowed. */
export function launchRocket(
  state: RocketState,
  mode: RocketMode = state.mode,
): RocketState {
  const s = cloneState(state);
  if (s.phase !== 'ready') return s;
  s.mode = mode;
  s.targetThrottle = 1;
  setPhase(s, 'countdown', 'countdown');
  return s;
}

/** Deterministic wind: no Math.random, so identical inputs produce replayable flights. */
function sampleWind(s: RocketState, scale: number): RocketVector {
  const time = s.elapsed;
  const seed = s.seed;
  const altitude = Math.max(0, s.position.y - s.origin.y);
  const jetStream = 1 + 1.4 * Math.exp(-(((altitude - 11_000) / 5_000) ** 2));
  const taper = Math.exp(-altitude / 35_000);
  return {
    x:
      scale *
      taper *
      jetStream *
      (7 +
        5 * Math.sin(time * 0.71 + seed) +
        3 * Math.sin(time * 1.91 + seed * 0.4)),
    y: 0,
    z:
      scale *
      taper *
      jetStream *
      (5 * Math.cos(time * 0.49 + seed * 0.7) +
        4 * Math.sin(time * 1.37 + seed)),
  };
}

function updateSupport(s: RocketState, dt: number) {
  if (s.supportCollapsed || s.position.y - s.origin.y > 12) return;
  const config = ROCKET_CONFIGS[s.kind];
  const load = SUPPORT_LOADS[s.kind];
  const strength = s.support.strength ?? 1;
  const thrustExposure =
    s.throttle *
    Math.exp(-Math.max(0, s.position.y - s.origin.y) / config.heatRadius);
  const overload = Math.max(0, load.minimumStrength - strength);
  // Roof damage happens while the engine spools up: a small roof fails under a
  // large rocket before lift-off, but supports a small rocket long enough to go.
  let damage = isRoof(s.support.kind)
    ? thrustExposure * (0.06 + overload * load.roofOverload)
    : thrustExposure * overload * 0.6;
  // Faster ascent uses more powerful engines, not a faster clock. Structural
  // exposure follows that actual thrust increase so an unsafe roof stays unsafe.
  const thrustScale =
    (stageMaximumThrust(s) || config.maxThrust) / load.referenceThrust;
  damage *= thrustScale;
  if (s.support.kind === 'lake') {
    damage += load.lakeFatigue + thrustExposure * load.lakeThrust * thrustScale;
    const wobble = (1 - s.supportIntegrity) * load.lakeWobble;
    s.attitude.pitch += Math.sin(s.elapsed * 0.8 + s.seed) * wobble * dt;
    s.attitude.roll += Math.cos(s.elapsed * 0.7 + s.seed) * wobble * dt;
  }
  s.supportIntegrity = clamp(s.supportIntegrity - damage * dt, 0, 1);
  if (s.supportIntegrity > 0) return;
  s.supportCollapsed = true;
  s.failureReason =
    s.support.kind === 'lake'
      ? 'The lake bed gave way.'
      : 'The launch structure collapsed under the exhaust.';
  // The failing roof first sags, then releases the vehicle into real freefall.
  // Engine shutdown prevents the enormous booster thrust from concealing the
  // structural failure by launching out of the collapsing building.
  s.failureStage = 'support-collapse';
  s.supportCollapseElapsed = 0;
  s.throttle = 0;
  s.stageThrust = 0;
  s.targetThrottle = 0;
  s.velocity.y = Math.min(0, s.velocity.y);
  s.acceleration = { x: 0, y: 0, z: 0 };
  setStage(s, 'coast');
  addEvent(s, 'support-collapsed');
  setPhase(s, 'falling');
}

function updateAttitude(
  s: RocketState,
  input: RocketInput,
  densityRatio: number,
  dt: number,
) {
  const config = ROCKET_CONFIGS[s.kind];
  let pitchCommand: number;
  let rollCommand: number;
  if (s.mode === 'auto') {
    // A gentle, time-varying gravity turn visibly curves the ascent. The
    // autopilot uses the same bounded gimbal torque as manual steering.
    const turn = clamp(s.altitude / 14_000, 0, 1);
    const targetPitch =
      turn * (0.055 + Math.sin(s.flightElapsed * 0.035) * 0.025);
    const targetRoll =
      turn * Math.sin(s.flightElapsed * 0.047 + s.seed) * 0.035;
    const proportional = s.kind === 'small' ? 3.6 : 2.8;
    const damping = s.kind === 'small' ? 3.2 : 3.6;
    pitchCommand = clamp(
      wrapAngle(targetPitch - s.attitude.pitch) * proportional -
        s.angularVelocity.pitch * damping,
      -1,
      1,
    );
    rollCommand = clamp(
      wrapAngle(targetRoll - s.attitude.roll) * proportional -
        s.angularVelocity.roll * damping,
      -1,
      1,
    );
  } else {
    pitchCommand = clamp(finite(input.pitch, 0), -1, 1);
    rollCommand = clamp(finite(input.roll, 0), -1, 1);
    if (s.stabilize) {
      pitchCommand = clamp(pitchCommand - s.angularVelocity.pitch * 2.5, -1, 1);
      rollCommand = clamp(rollCommand - s.angularVelocity.roll * 2.5, -1, 1);
    }
  }
  const engineAuthority = hasEngine(s) ? s.throttle : 0;
  const damp = config.angularDamping * (0.25 + densityRatio * 0.75);
  const gust = config.windTorque * densityRatio;
  s.angularVelocity.pitch +=
    (pitchCommand * config.angularAcceleration * engineAuthority +
      (s.wind.z / 10) * gust -
      s.angularVelocity.pitch * damp) *
    dt;
  s.angularVelocity.roll +=
    (rollCommand * config.angularAcceleration * engineAuthority +
      (s.wind.x / 10) * gust -
      s.angularVelocity.roll * damp) *
    dt;
  s.attitude.pitch = wrapAngle(s.attitude.pitch + s.angularVelocity.pitch * dt);
  s.attitude.roll = wrapAngle(s.attitude.roll + s.angularVelocity.roll * dt);
}

function crash(
  s: RocketState,
  impactSpeed: number,
  reason: string,
  grounded = true,
  cause: RocketDestructionCause = 'impact',
) {
  if (grounded) s.position.y = s.support.groundY ?? s.origin.y;
  const fuelFraction = s.fuel / ROCKET_CONFIGS[s.kind].fuelMass;
  const explosionChance = clamp(
    0.25 + fuelFraction * 0.55 + Math.min(impactSpeed / 100, 1) * 0.15,
    0,
    0.95,
  );
  const delayedExplosion =
    cause !== 'fire' &&
    fuelFraction > 0.08 &&
    impactSpeed > 6 &&
    seeded(s.seed, 2) < explosionChance;
  const immediateExplosion = cause === 'fire' && fuelFraction > 0.02;
  s.wreckage = {
    time: s.elapsed,
    position: { ...s.position },
    velocity: { ...s.velocity },
    attitude: { ...s.attitude },
    angularVelocity: { ...s.angularVelocity },
    cause,
    exploded: immediateExplosion,
    explosionDelay: delayedExplosion ? 0.65 + seeded(s.seed, 3) * 0.25 : null,
    explosionTime: immediateExplosion ? s.elapsed : null,
  };
  s.velocity = { x: 0, y: 0, z: 0 };
  s.throttle = 0;
  s.stageThrust = 0;
  s.targetThrottle = 0;
  s.integrity = 0;
  s.failureStage = 'wreckage';
  s.failureReason = reason;
  setPhase(s, 'crashed');
  if (cause === 'impact') addEvent(s, 'impact', impactSpeed);
  addEvent(s, 'ruptured', impactSpeed);
  if (immediateExplosion) addEvent(s, 'exploded', fuelFraction);
}

/** Heat reaches the rocket only through the caller's external exposure sample. */
function updateThermal(s: RocketState, input: RocketInput, dt: number) {
  const exposure = clamp(finite(input.fireExposure, 0), 0, 1);
  const vulnerability = s.fireSusceptibility;
  const airflow = Math.min(s.speed / 120, 1.5);
  const engine = hasEngine(s) ? s.throttle : 0;
  const cooling =
    (1 - exposure) * (0.055 + airflow * 0.045 + (engine > 0.1 ? 0 : 0.025));
  const incoming = exposure * (0.11 + vulnerability * 0.17);
  // An already burning tank is aggravated by a running engine; nearby exhaust
  // alone cannot ignite an intact rocket because it is not external exposure.
  const combustion =
    s.fireIntensity *
    (0.025 +
      vulnerability * 0.045 +
      engine * 0.04 +
      // A badly heated propellant system can keep burning internally after it
      // leaves the trees. Fresh surface fire remains below this runaway band.
      Math.max(0, s.heat - 0.82) * engine * vulnerability * 1.6);
  s.heat = clamp(s.heat + (incoming + combustion - cooling) * dt, 0, 1);
  const ignitionThreshold = 0.6 + (1 - vulnerability) * 0.3;
  if (
    s.fireIntensity === 0 &&
    vulnerability > 0.2 &&
    s.heat >= ignitionThreshold
  ) {
    s.fireIntensity = 0.12;
    s.fireElapsed = 0;
    addEvent(s, 'vehicle-ignited', vulnerability);
  }
  if (s.fireIntensity <= 0) return;
  s.fireElapsed += dt;
  const targetFire = clamp((s.heat - 0.28) / 0.65, 0, 1);
  s.fireIntensity += clamp(targetFire - s.fireIntensity, -dt * 0.3, dt * 0.35);
  if (s.heat < 0.3 && s.fireIntensity < 0.03) {
    s.fireIntensity = 0;
    addEvent(s, 'vehicle-extinguished');
    return;
  }
  const damage =
    s.fireIntensity *
    (0.012 + vulnerability * 0.018) *
    (0.65 + engine * 0.65) *
    dt;
  s.fireDamage = clamp(s.fireDamage + damage, 0, 1);
  s.integrity = clamp(s.integrity - damage, 0, 1);
  // A visible onboard fire precedes a possible pressure/tank failure. Leaving
  // the forest, cutting power and airflow cooling can arrest it before this.
  if (
    (s.heat >= 0.985 &&
      s.fireElapsed >= 3 + (1 - vulnerability) * 3 &&
      s.fuel / ROCKET_CONFIGS[s.kind].fuelMass > 0.08) ||
    s.integrity <= 0
  )
    crash(s, s.speed, 'Fire ruptured the propellant tanks.', false, 'fire');
}

function updateWreckage(s: RocketState, dt: number) {
  const wreckage = s.wreckage;
  if (!wreckage) return;
  // The building can keep settling after the vehicle hits a low roof/floor.
  // Its structural clock is independent from the immutable impact snapshot.
  if (s.supportCollapsed) s.supportCollapseElapsed += dt;
  s.fireIntensity = Math.max(0, s.fireIntensity - dt * 0.015);
  s.heat = Math.max(0, s.heat - dt * 0.01);
  if (
    !wreckage.exploded &&
    wreckage.explosionDelay !== null &&
    s.elapsed - wreckage.time >= wreckage.explosionDelay
  ) {
    wreckage.exploded = true;
    wreckage.explosionTime = s.elapsed;
    s.fireIntensity = Math.max(s.fireIntensity, 0.8);
    addEvent(s, 'exploded', s.fuel / ROCKET_CONFIGS[s.kind].fuelMass);
  }
}

/** Returns true while the collapsing structure is still carrying the rocket. */
function updateCollapse(s: RocketState, dt: number): boolean {
  s.supportCollapseElapsed += dt;
  if (s.supportCollapseElapsed < ROCKET_SUPPORT_RELEASE_DELAY) {
    // Remaining columns slowly yield; this is supported sag, not slowed time.
    s.velocity.y = -0.3;
    s.position.y += s.velocity.y * dt;
    s.attitude.roll += (Math.sin(s.seed + 0.5) < 0 ? -1 : 1) * dt * 0.045;
    s.attitude.pitch += dt * 0.025;
    s.speed = length(s.velocity);
    return true;
  }
  if (s.failureStage !== 'freefall') {
    s.failureStage = 'freefall';
    const sign = Math.sin(s.seed + 0.5) < 0 ? -1 : 1;
    s.angularVelocity.roll += sign * 0.36;
    s.angularVelocity.pitch += 0.2;
    s.velocity.x += sign * 0.8;
    addEvent(s, 'support-lost');
  }
  return false;
}

/** External swept city/body collision, preserving the actual impact location. */
export function crashRocket(
  state: RocketState,
  reason = 'The rocket collided with the city.',
): RocketState {
  const s = cloneState(state);
  if (s.phase === 'crashed' || s.phase === 'space' || s.phase === 'sinking')
    return s;
  crash(s, length(s.velocity), reason, false);
  return s;
}

function substep(s: RocketState, input: RocketInput, dt: number) {
  const config = ROCKET_CONFIGS[s.kind];
  s.elapsed += dt;
  s.phaseElapsed += dt;
  if (s.phase === 'crashed') {
    updateWreckage(s, dt);
    return;
  }
  if (s.phase === 'space') {
    // Success cuts the engine without deleting momentum. Gravity transitions
    // gently into a continuing observation coast; returning to Earth is outside
    // this mission. The first seconds retain the real post-cutoff trajectory.
    s.stageElapsed += dt;
    const gravity = 9.80665 * (6_371_000 / (6_371_000 + s.altitude)) ** 2;
    s.acceleration = {
      x: 0,
      y: -gravity * Math.exp(-s.phaseElapsed / 12),
      z: 0,
    };
    s.velocity.y += s.acceleration.y * dt;
    s.position.x += s.velocity.x * dt;
    s.position.y += s.velocity.y * dt;
    s.position.z += s.velocity.z * dt;
    s.altitude = Math.max(0, s.position.y - s.origin.y);
    s.maxAltitude = Math.max(s.maxAltitude, s.altitude);
    s.speed = length(s.velocity);
    return;
  }
  if (s.phase === 'sinking') {
    s.velocity.y = -Math.min(4.5, 0.4 + s.phaseElapsed * 0.8);
    s.position.y = Math.max(
      s.origin.y - config.height * 1.4,
      s.position.y + s.velocity.y * dt,
    );
    s.attitude.roll = Math.min(0.6, s.phaseElapsed * 0.035);
    s.attitude.pitch = Math.min(0.25, s.phaseElapsed * 0.017);
    s.speed = Math.abs(s.velocity.y);
    return;
  }
  updateThermal(s, input, dt);
  if (s.wreckage) return;
  if (s.phase === 'falling' && updateCollapse(s, dt)) return;
  if (input.mode) s.mode = input.mode;
  if (input.auto !== undefined) s.mode = input.auto ? 'auto' : 'manual';
  if (input.stabilize !== undefined) s.stabilize = input.stabilize;
  if (input.abort && s.phase !== 'aborted' && s.phase !== 'falling') {
    s.targetThrottle = 0;
    s.throttle = 0;
    s.stageThrust = 0;
    setStage(s, 'coast');
    s.failureReason = 'Flight aborted: engines shut down.';
    setPhase(s, 'aborted', 'abort');
  }
  if (s.phase === 'aborted' && s.flightElapsed === 0 && !s.supportCollapsed)
    return;
  if (s.phase === 'building') {
    s.buildProgress = clamp(s.phaseElapsed / config.buildDuration, 0, 1);
    updateSupport(s, dt);
    if (s.phase === 'building' && s.buildProgress >= 1)
      setPhase(s, 'ready', 'ready');
    return;
  }
  if (s.phase === 'ready') {
    updateSupport(s, dt);
    if (s.phase === 'ready' && input.launch) {
      s.targetThrottle = 1;
      setPhase(s, 'countdown', 'countdown');
    }
    return;
  }
  if (s.phase === 'countdown') {
    s.countdown = Math.max(0, config.countdownDuration - s.phaseElapsed);
    updateSupport(s, dt);
    if (s.phase === 'countdown' && s.phaseElapsed >= config.countdownDuration) {
      setPhase(s, 'ignition', 'ignition');
      if (config.strapOns) addEvent(s, 'core-ignition');
    }
    return;
  }
  const densityRatio = Math.exp(-Math.max(0, s.altitude) / 8_500);
  const density = 1.225 * densityRatio;
  s.wind = sampleWind(s, clamp(finite(input.windScale, 1), 0, 5));
  if (s.mode === 'manual' && input.throttle !== undefined) {
    s.targetThrottle = clamp(finite(input.throttle, s.targetThrottle), 0, 1);
  } else if (s.mode === 'auto') {
    s.targetThrottle = 1;
  }
  if (s.phase === 'aborted' || s.phase === 'falling') s.targetThrottle = 0;
  s.stageElapsed += dt;
  if (
    s.stage === 'strap-separating' &&
    s.phase !== 'aborted' &&
    s.stageElapsed >= (config.strapSeparationDuration ?? 0.8)
  ) {
    setStage(s, 'boost', 'core-only');
  }
  if (
    s.stage === 'separating' &&
    s.phase !== 'aborted' &&
    s.stageElapsed >= config.separationDuration
  ) {
    setStage(s, 'upper', 'upper-ignition');
  }
  if (s.phase === 'ignition') {
    // Hold-down bolts restrain a safe pad during the spool-up sequence.
    s.throttle =
      clamp(s.phaseElapsed / config.ignitionDuration, 0, 1) * s.targetThrottle;
  } else if (s.stage === 'separating' || s.stage === 'coast') {
    s.throttle = 0;
  } else if (
    s.stage === 'upper' &&
    s.stageElapsed < config.upperIgnitionDuration
  ) {
    s.throttle =
      clamp(s.stageElapsed / config.upperIgnitionDuration, 0, 1) *
      s.targetThrottle;
  } else {
    s.throttle += clamp(s.targetThrottle - s.throttle, -dt * 1.8, dt * 0.9);
  }
  const previousFuel = s.fuel;
  let justSeparated = false;
  let justStrapSeparated = false;
  // Capture the active stage before changing it: the core and four external
  // boosters burn together, and core propulsion continues through strap release.
  const initialStage = s.stage;
  if (initialStage === 'strap-on' && config.strapOns && s.phase !== 'aborted') {
    s.strapFuel = Math.max(
      0,
      s.strapFuel -
        Math.min(s.strapFuel, config.strapOns.fuelPerSecond * s.throttle * dt),
    );
    if (s.strapFuel < 1e-7) {
      s.strapFuel = 0;
      addEvent(s, 'strap-on-burnout');
      s.strapSeparation = {
        time: s.elapsed,
        flightTime: s.flightElapsed,
        position: { ...s.position },
        velocity: { ...s.velocity },
        attitude: { ...s.attitude },
      };
      s.strapAttached = false;
      justStrapSeparated = true;
      setStage(s, 'strap-separating');
      addEvent(s, 'strap-on-separation', config.strapOns.dryMass);
    }
  }
  const burningCore =
    initialStage === 'boost' ||
    initialStage === 'strap-on' ||
    initialStage === 'strap-separating';
  const activeConfig = burningCore
    ? config.stages.boost
    : initialStage === 'upper'
      ? config.stages.upper
      : null;
  if (activeConfig && s.phase !== 'aborted') {
    const remaining = burningCore ? s.boosterFuel : s.upperFuel;
    const used = Math.min(
      remaining,
      activeConfig.fuelPerSecond * s.throttle * dt,
    );
    if (burningCore) s.boosterFuel = Math.max(0, s.boosterFuel - used);
    else s.upperFuel = Math.max(0, s.upperFuel - used);
    if (burningCore && s.boosterFuel < 1e-7) {
      s.boosterFuel = 0;
      addEvent(s, 'booster-burnout');
      s.separation = {
        time: s.elapsed,
        flightTime: s.flightElapsed,
        position: { ...s.position },
        velocity: { ...s.velocity },
        attitude: { ...s.attitude },
      };
      s.boosterAttached = false;
      justSeparated = true;
      setStage(s, 'separating');
      s.throttle = 0;
      addEvent(s, 'stage-separation', config.stages.boost.dryMass);
    } else if (s.stage === 'upper' && s.upperFuel < 1e-7) {
      s.upperFuel = 0;
      setStage(s, 'coast', 'upper-burnout');
      s.throttle = 0;
    }
  }
  s.fuel = s.strapFuel + s.boosterFuel + s.upperFuel;
  if (s.fuel <= 0) s.throttle = 0;
  if (previousFuel > 0 && s.fuel <= 0) addEvent(s, 'fuel-empty');
  s.mass = rocketMass(s);
  const mass = s.mass;
  s.stageThrust = hasEngine(s)
    ? stageMaximumThrust(s) * s.throttle * (1 + (1 - densityRatio) * 0.08)
    : 0;
  updateSupport(s, dt);
  if (s.phase === 'falling' && s.failureStage === 'support-collapse') return;
  if (s.phase === 'ignition') {
    if (s.phaseElapsed < config.ignitionDuration) return;
    setPhase(s, 'flight', 'liftoff');
  }
  s.flightElapsed += dt;
  updateAttitude(s, input, densityRatio, dt);
  const direction = rocketDirection(s.attitude);
  const relative = {
    x: s.velocity.x - s.wind.x,
    y: s.velocity.y,
    z: s.velocity.z - s.wind.z,
  };
  const airspeed = length(relative);
  s.dynamicPressure = 0.5 * density * airspeed * airspeed;
  const forwardFraction =
    airspeed > 1
      ? Math.abs(
          (relative.x * direction.x +
            relative.y * direction.y +
            relative.z * direction.z) /
            airspeed,
        )
      : 1;
  const sideFraction = Math.sqrt(
    Math.max(0, 1 - forwardFraction * forwardFraction),
  );
  const area =
    Math.PI * config.radius ** 2 +
    sideFraction *
      config.height *
      (s.boosterAttached ? 1 : 1 - config.stageCutFraction) *
      config.radius *
      2;
  const dragFactor =
    airspeed > 0
      ? (0.5 * density * config.dragCoefficient * area * airspeed) / mass
      : 0;
  const thrust = s.stageThrust / mass;
  const gravity =
    9.80665 * (6_371_000 / (6_371_000 + Math.max(0, s.altitude))) ** 2;
  s.acceleration = {
    x: direction.x * thrust - relative.x * dragFactor,
    y: direction.y * thrust - gravity - relative.y * dragFactor,
    z: direction.z * thrust - relative.z * dragFactor,
  };
  s.velocity.x += s.acceleration.x * dt;
  s.velocity.y += s.acceleration.y * dt;
  s.velocity.z += s.acceleration.z * dt;
  s.position.x += s.velocity.x * dt;
  s.position.y += s.velocity.y * dt;
  s.position.z += s.velocity.z * dt;
  const released = justStrapSeparated
    ? s.strapSeparation
    : justSeparated
      ? s.separation
      : null;
  if (released) {
    // Time, pose and momentum describe the same instant. Capturing the prior
    // frame's position here would visibly snap a fast booster backwards.
    released.position = { ...s.position };
    released.velocity = { ...s.velocity };
    released.attitude = { ...s.attitude };
    released.flightTime = s.flightElapsed;
    for (const event of s.events.slice(-2)) {
      if (
        event.time === s.elapsed &&
        (event.type === 'booster-burnout' ||
          event.type === 'stage-separation' ||
          event.type === 'strap-on-burnout' ||
          event.type === 'strap-on-separation')
      )
        event.position = { ...s.position };
    }
  }
  s.altitude = Math.max(0, s.position.y - s.origin.y);
  s.maxAltitude = Math.max(s.maxAltitude, s.altitude);
  s.speed = length(s.velocity);
  // Tumbling broadside through dense air damages the vehicle. Ordinary ascent
  // and a recoverable steering mistake are below this threshold.
  s.integrity = clamp(
    s.integrity -
      (Math.max(0, s.dynamicPressure - 85_000) / 800_000) *
        Math.max(0, sideFraction - 0.2) ** 2 *
        dt,
    0,
    1,
  );
  if (s.integrity <= 0) {
    crash(
      s,
      s.speed,
      'Aerodynamic loads destroyed the vehicle.',
      false,
      'aerodynamic',
    );
    return;
  }
  // A lake bed yields below the placement surface rather than treating the
  // vanished support plane as a solid impact surface on the very next frame.
  const groundY =
    (s.support.groundY ?? s.origin.y) -
    (s.supportCollapsed && s.support.kind === 'lake'
      ? Math.min(3, config.height * 0.16)
      : 0);
  const remainingBottom = config.height * config.upperNozzleFraction;
  const groundContactY = s.boosterAttached
    ? s.position.y
    : Math.min(
        s.position.y + direction.y * remainingBottom,
        s.position.y + direction.y * config.height,
      );
  if (
    groundContactY <= groundY &&
    (s.velocity.y < 0 || s.supportCollapsed || !s.boosterAttached)
  ) {
    if (!s.boosterAttached) {
      // The reference base remains below the upper stage after separation.
      // Resolve its actual lowest surviving end instead of a ghost booster.
      s.position.y += groundY - groundContactY;
      s.altitude = Math.max(0, s.position.y - s.origin.y);
    }
    crash(
      s,
      s.speed,
      s.supportCollapsed
        ? 'The falling rocket struck the ground after the platform collapsed.'
        : 'The rocket struck the ground.',
      s.boosterAttached && s.support.kind !== 'lake',
    );
    return;
  }
  if (
    s.altitude >= SPACE_ALTITUDE &&
    s.phase !== 'aborted' &&
    s.phase !== 'falling'
  ) {
    s.throttle = 0;
    s.targetThrottle = 0;
    s.stageThrust = 0;
    setStage(s, 'coast');
    setPhase(s, 'space', 'mission-complete');
  }
}

export function stepRocket(
  state: RocketState,
  input: RocketInput = {},
  dt = ROCKET_FIXED_STEP,
): RocketState {
  const s = cloneState(state);
  let remaining = clamp(finite(dt, 0), 0, 0.25);
  while (remaining > 1e-9) {
    const step = Math.min(ROCKET_FIXED_STEP, remaining);
    substep(s, input, step);
    remaining -= step;
  }
  return s;
}

/** Sample every simulation step to accumulate irreversible city damage. */
export function sampleRocketEffects(s: RocketState): RocketEnvironmentEffects {
  const config = ROCKET_CONFIGS[s.kind];
  const response = EXHAUST_RESPONSE[s.kind];
  const direction = rocketDirection(s.attitude);
  const engine = hasEngine(s)
    ? s.throttle *
      (config.strapOns ? stageMaximumThrust(s) / config.maxThrust : 1)
    : 0;
  const nozzleOffset = s.boosterAttached
    ? 0
    : config.height * config.upperNozzleFraction;
  const nozzle = {
    x: s.position.x + direction.x * nozzleOffset,
    y: s.position.y + direction.y * nozzleOffset,
    z: s.position.z + direction.z * nozzleOffset,
  };
  const nozzleHeight = Math.max(
    0,
    nozzle.y - (s.support.groundY ?? s.origin.y),
  );
  const downwardFraction = Math.max(0, direction.y);
  const groundExposure =
    engine *
    downwardFraction *
    Math.exp(-nozzleHeight / (config.heatRadius * 1.8));
  return {
    nozzle,
    direction: { x: -direction.x, y: -direction.y, z: -direction.z },
    engine,
    groundExposure,
    blastRadius: config.blastRadius * Math.sqrt(groundExposure),
    heatRadius: config.heatRadius * Math.sqrt(groundExposure),
    debrisImpulse: groundExposure * response.impulse * config.effectStrength,
    shake: groundExposure * response.shake * config.effectStrength,
  };
}
