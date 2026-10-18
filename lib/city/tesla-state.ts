/** Original Tesla game vehicle simulation. Metres, seconds, +Y up, +Z front.
 * LicenseRef-Vancouver-Living-Atlas-NC-1.0; see LICENSE.
 * The pose is the chassis collision centre, not the model's tyre-plane origin.
 */
import {
  TESLA_FORWARD,
  TESLA_UP,
  teslaAdd,
  teslaAxisRotation,
  teslaDot,
  teslaFrame,
  teslaLength,
  teslaLimit,
  teslaNormalizeQuaternion,
  teslaRotate,
  teslaScale,
  teslaSlerp,
  teslaSubtract,
  teslaTransportForward,
  teslaUnit,
} from './tesla-math';
import { createTeslaRoadsterShape } from './tesla-shape';

export type TeslaVec3 = readonly [number, number, number];
export type TeslaQuaternion = readonly [number, number, number, number];
export interface TeslaPose {
  position: TeslaVec3;
  quaternion: TeslaQuaternion;
}
export interface TeslaShape {
  halfExtents: TeslaVec3;
  clearance: number;
  /** Authored tyre contacts and conservative body datum, in chassis-local metres. */
  groundSupport?: {
    wheelContacts: readonly [TeslaVec3, TeslaVec3, TeslaVec3, TeslaVec3];
    /** Minimum non-tyre body clearance above the tyre contact plane. */
    chassisClearance: number;
    /** Bounded game suspension policy, never a vehicle specification. */
    suspensionTravel: number;
    /** Model-proved ordinary-ground body envelopes; tyre-plane clearances. */
    bodySections?: readonly {
      minZ: number;
      maxZ: number;
      clearance: number;
    }[];
  };
}
export interface TeslaContact {
  surfaceId: string;
  kind: 'ground' | 'roof' | 'wall' | 'obstacle';
  /** Physical plane point; normal points out of the solid toward the vehicle. */
  point: TeslaVec3;
  normal: TeslaVec3;
  adherable: boolean;
}
export interface TeslaSweepHit extends TeslaContact {
  /** First obstructed fraction of the entire translation and rotation. */
  fraction: number;
}
export interface TeslaSweepQuery {
  from: TeslaPose;
  to: TeslaPose;
  shape: TeslaShape;
  /** Ordinary model-backed ground: proof identity; that face still checks the
   * actual body. Roof/wall/legacy: one exact support face, never its solid. */
  ignoreSurfaceId?: string;
}
export interface TeslaGroundDepartureQuery extends TeslaSweepQuery {
  /** Freshly re-proved ordinary-ground origin, never an arbitrary air pose. */
  origin: TeslaPose;
  sourceSurfaceId: string;
}
export interface TeslaSupportQuery {
  pose: TeslaPose;
  shape: TeslaShape;
  maxDistance: number;
  preferredSurfaceId?: string;
  adhesion: boolean;
}
export interface TeslaGroundFitQuery {
  pose: TeslaPose;
  shape: TeslaShape;
  /** A current physical ordinary-ground face, never a roof/wall permission. */
  preferredSurfaceId: string;
  /** Maximum translation of the proposed pose from the requested pose. */
  maxAdjustmentM: number;
}
export interface TeslaGroundFit {
  /** Separately proved driving pose fitted to actual ordinary-ground geometry. */
  pose: TeslaPose;
  /** Actual claimed triangle point/normal; these remain physical surface data. */
  contact: TeslaContact;
}
export interface TeslaWorld {
  sweep(query: TeslaSweepQuery): TeslaSweepHit | null;
  /** Must prove the complete footprint against actual same-floor geometry. */
  support(query: TeslaSupportQuery): TeslaContact | null;
  /** Optional ordinary-ground driving fit; legacy planar worlds need not implement it. */
  fitGround?(query: TeslaGroundFitQuery): TeslaGroundFit | null;
  /** Fixed-orientation, same-XZ upward withdrawal within 35cm of a proved origin. */
  sweepGroundDeparture?(query: TeslaGroundDepartureQuery): TeslaSweepHit | null;
}

/** Shared authored-model metadata, including the actual tyre contact datum. */
export const TESLA_DEFAULT_SHAPE: TeslaShape = createTeslaRoadsterShape();

export interface TeslaInput {
  /** Forward/reverse; positive steer rotates +Z toward +X about vehicle up. */
  throttle: number;
  steer: number;
  /** World-vertical assisted flight, independent of the current wall normal. */
  lift: number;
  pitch: number;
  roll: number;
  boost: boolean;
  brake: boolean;
  jump: boolean;
  flightToggle: boolean;
  adhesionToggle: boolean;
  park: boolean;
}
interface TeslaButtons {
  jump: boolean;
  flightToggle: boolean;
  adhesionToggle: boolean;
  park: boolean;
}
export interface TeslaAttachment {
  contact: TeslaContact;
  waypoints: TeslaPose[];
  ignoreSurfaceIds: (string | undefined)[];
  index: number;
  resumeSpeed: number;
  parkOnArrival: boolean;
  /** Only the first fixed-XZ upward leg may use this freshly proved origin. */
  groundDeparture?: { origin: TeslaPose; surfaceId: string };
}
export interface TeslaState extends TeslaPose {
  velocity: TeslaVec3;
  /** Stable horizontal yaw, retained when vehicle forward becomes vertical. */
  heading: number;
  mode: 'ground' | 'air' | 'wall';
  contact: TeslaContact | null;
  flightAssist: boolean;
  adhesionArmed: boolean;
  parked: boolean;
  /** Automatic wall rest, released by driving/steering; distinct from P parking. */
  wallHolding: boolean;
  timeS: number;
  impact: number;
  collisionSurfaceId: string | null;
  lastSafePose: TeslaPose;
  detachRemainingS: number;
  /** One exact former contact face while clearing the body after launch. */
  departureContact: TeslaContact | null;
  /** A bounded, freshly proved tyre-model withdrawal before free-air movement. */
  groundDeparture: {
    origin: TeslaPose;
    surfaceId: string;
    resumeVelocity: TeslaVec3;
    returning: boolean;
  } | null;
  held: TeslaButtons;
  /** Swept, speed-limited magnetic corner manoeuvre; not a teleport. */
  attachment: TeslaAttachment | null;
}
export interface TeslaStepReport {
  simulatedS: number;
  droppedS: number;
  /** Actual fixed integration steps; a freshly proved stationary frame uses 0. */
  substeps: number;
  collisions: number;
  transitions: number;
  environmentFailures: number;
}
export const TESLA_LIMITS = Object.freeze({
  maxStepS: 1 / 120,
  maxElapsedS: 0.25,
  groundSpeedMps: 74,
  boostedGroundSpeedMps: 100,
  reverseSpeedMps: 18,
  airSpeedMps: 70,
  boostedAirSpeedMps: 140,
  maxSpeedMps: 160,
  liftSpeedMps: 20,
  attachmentSpeedMps: 12,
  attachmentRadiansPerS: 2.8,
});
const EMPTY_BUTTONS: TeslaButtons = {
  jump: false,
  flightToggle: false,
  adhesionToggle: false,
  park: false,
};
const EPS = 1e-7;
const finiteVector = (v: readonly number[], size: number) =>
  v.length === size && v.every(Number.isFinite);
const axis = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value!)) : 0;
const toward = (current: number, target: number, delta: number) =>
  current +
  Math.sign(target - current) * Math.min(delta, Math.abs(target - current));
const copyPose = (pose: TeslaPose): TeslaPose => ({
  position: [...pose.position],
  quaternion: [...pose.quaternion],
});
const bodyUp = (s: TeslaPose) => teslaRotate(s.quaternion, TESLA_UP);
const bodyForward = (s: TeslaPose) => teslaRotate(s.quaternion, TESLA_FORWARD);
const contactHeight = (shape: TeslaShape) =>
  shape.halfExtents[1] + shape.clearance;
function validShape(shape: TeslaShape) {
  const ground = shape.groundSupport;
  const sections = ground?.bodySections;
  const validSections =
    !sections ||
    (sections.length > 0 &&
      sections.length <= 8 &&
      Math.abs(sections[0].minZ + shape.halfExtents[2]) <= EPS &&
      Math.abs(sections[sections.length - 1].maxZ - shape.halfExtents[2]) <=
        EPS &&
      sections.every(
        (section, index) =>
          [section.minZ, section.maxZ, section.clearance].every(
            Number.isFinite,
          ) &&
          section.minZ < section.maxZ &&
          section.clearance >= ground!.chassisClearance &&
          section.clearance < 2 * shape.halfExtents[1] &&
          (index === 0 ||
            Math.abs(section.minZ - sections[index - 1].maxZ) <= EPS),
      ));
  return (
    finiteVector(shape.halfExtents, 3) &&
    shape.halfExtents.every((v) => v > 0 && v <= 8) &&
    Number.isFinite(shape.clearance) &&
    shape.clearance >= 0 &&
    shape.clearance <= 1 &&
    (!ground ||
      (ground.wheelContacts.length === 4 &&
        ground.wheelContacts.every(
          (p) =>
            finiteVector(p, 3) &&
            Math.abs(p[0]) <= shape.halfExtents[0] + shape.clearance &&
            Math.abs(p[2]) <= shape.halfExtents[2] + shape.clearance &&
            p[1] < 0 &&
            -p[1] <= contactHeight(shape) + 0.001,
        ) &&
        Number.isFinite(ground.chassisClearance) &&
        ground.chassisClearance >= 0 &&
        ground.chassisClearance < shape.halfExtents[1] &&
        Number.isFinite(ground.suspensionTravel) &&
        ground.suspensionTravel >= 0 &&
        ground.suspensionTravel <= 0.2 &&
        validSections))
  );
}
function contactCopy(contact: TeslaContact): TeslaContact | null {
  if (
    !contact ||
    !contact.surfaceId ||
    !['ground', 'roof', 'wall', 'obstacle'].includes(contact.kind) ||
    !finiteVector(contact.point, 3) ||
    !finiteVector(contact.normal, 3) ||
    teslaLength(contact.normal) < EPS ||
    typeof contact.adherable !== 'boolean'
  )
    return null;
  return {
    ...contact,
    point: [...contact.point],
    normal: teslaUnit(contact.normal),
  };
}
function admissible(s: TeslaState, contact: TeslaContact) {
  return (
    contact.kind !== 'obstacle' &&
    (contact.kind === 'wall'
      ? s.adhesionArmed &&
        contact.adherable &&
        Math.abs(contact.normal[1]) < 0.75
      : contact.normal[1] > 0.35)
  );
}

export function createTesla(
  position: TeslaVec3,
  heading = 0,
  contact: TeslaContact | null = null,
): TeslaState {
  if (!finiteVector(position, 3) || !Number.isFinite(heading))
    throw new Error('Invalid Tesla placement');
  const proof = contact ? contactCopy(contact) : null;
  if (
    contact &&
    (!proof ||
      proof.kind === 'obstacle' ||
      (proof.kind === 'wall'
        ? !proof.adherable || Math.abs(proof.normal[1]) >= 0.75
        : proof.normal[1] <= 0.35))
  )
    throw new Error('Invalid Tesla support');
  const yaw = Math.atan2(Math.sin(heading), Math.cos(heading));
  const normal = proof?.normal ?? TESLA_UP;
  const forward = teslaTransportForward(TESLA_UP, normal, [
    Math.sin(yaw),
    0,
    Math.cos(yaw),
  ]);
  const pose = {
    position: [...position] as TeslaVec3,
    quaternion: teslaFrame(normal, forward).quaternion,
  };
  return {
    ...pose,
    velocity: [0, 0, 0],
    heading: yaw,
    mode: proof ? (proof.kind === 'wall' ? 'wall' : 'ground') : 'air',
    contact: proof,
    flightAssist: !proof,
    adhesionArmed: true,
    parked: false,
    wallHolding: false,
    timeS: 0,
    impact: 0,
    collisionSurfaceId: null,
    lastSafePose: copyPose(pose),
    detachRemainingS: 0,
    departureContact: null,
    groundDeparture: null,
    held: { ...EMPTY_BUTTONS },
    attachment: null,
  };
}

export function placeTesla(
  contact: TeslaContact,
  heading = 0,
  shape = TESLA_DEFAULT_SHAPE,
) {
  const proof = contactCopy(contact);
  if (!proof || !validShape(shape))
    throw new Error('Invalid Tesla support placement');
  return createTesla(
    teslaAdd(proof.point, teslaScale(proof.normal, contactHeight(shape))),
    heading,
    proof,
  );
}

/** Camera adapters use chaseForward/chaseUp for the upright view and the full
 * quaternion for cockpit orientation. No camera state changes simulation. */
export function teslaVehicleFrame(state: TeslaState) {
  return {
    ...copyPose(state),
    up: bodyUp(state),
    forward: bodyForward(state),
    chaseForward: [
      Math.sin(state.heading),
      0,
      Math.cos(state.heading),
    ] as TeslaVec3,
    chaseUp: [...TESLA_UP] as TeslaVec3,
  };
}

function querySupport(
  world: TeslaWorld,
  pose: TeslaPose,
  shape: TeslaShape,
  preferredSurfaceId: string | undefined,
  adhesion: boolean,
  report: TeslaStepReport,
) {
  try {
    const result = world.support({
      pose: copyPose(pose),
      shape,
      maxDistance: contactHeight(shape) + 0.35,
      preferredSurfaceId,
      adhesion,
    });
    if (!result) return null;
    const valid = contactCopy(result);
    if (!valid) report.environmentFailures++;
    return valid;
  } catch {
    report.environmentFailures++;
    return null;
  }
}
function querySweep(
  world: TeslaWorld,
  from: TeslaPose,
  to: TeslaPose,
  shape: TeslaShape,
  ignoreSurfaceId: string | undefined,
  report: TeslaStepReport,
): TeslaSweepHit | null {
  try {
    const hit = world.sweep({
      from: copyPose(from),
      to: copyPose(to),
      shape,
      ignoreSurfaceId,
    });
    if (!hit) return null;
    const contact = contactCopy(hit);
    if (
      contact &&
      Number.isFinite(hit.fraction) &&
      hit.fraction >= 0 &&
      hit.fraction <= 1
    )
      return { ...contact, fraction: hit.fraction };
  } catch {
    /* A failed collision query is blocked, never treated as clear. */
  }
  report.environmentFailures++;
  return {
    fraction: 0,
    kind: 'obstacle',
    surfaceId: 'invalid-tesla-world-query',
    point: [...from.position],
    normal: teslaScale(bodyForward(from), -1),
    adherable: false,
  };
}

interface GroundFitBudget {
  translationM: number;
  radians: number;
}
function fitGroundPose(
  state: TeslaState,
  world: TeslaWorld,
  shape: TeslaShape,
  budget: GroundFitBudget,
  report: TeslaStepReport,
  requested: TeslaPose = state,
) {
  if (
    state.mode !== 'ground' ||
    state.contact?.kind !== 'ground' ||
    state.parked ||
    !shape.groundSupport ||
    !world.fitGround
  )
    return false;
  const priorContact = state.contact;
  const maximum = 0.35;
  let proposal: TeslaGroundFit | null;
  try {
    proposal = world.fitGround({
      pose: copyPose(requested),
      shape,
      preferredSurfaceId: priorContact.surfaceId,
      maxAdjustmentM: maximum,
    });
    if (!proposal) return false;
    const contact = contactCopy(proposal.contact);
    if (
      !contact ||
      contact.kind !== 'ground' ||
      !contact.adherable ||
      contact.normal[1] <= 0.92 ||
      !proposal.pose ||
      !finiteVector(proposal.pose.position, 3) ||
      !finiteVector(proposal.pose.quaternion, 4) ||
      Math.hypot(...proposal.pose.quaternion) < EPS ||
      teslaLength(teslaSubtract(proposal.pose.position, requested.position)) >
        maximum + EPS
    )
      throw new Error('Invalid Tesla ground fit');
    proposal = {
      contact,
      pose: {
        position: [...proposal.pose.position],
        quaternion: teslaNormalizeQuaternion(proposal.pose.quaternion),
      },
    };
    const fittedUp = bodyUp(proposal.pose),
      currentForward = bodyForward(requested),
      fittedForward = bodyForward(proposal.pose);
    if (
      fittedUp[1] < 0.92 ||
      teslaDot(
        teslaUnit([currentForward[0], 0, currentForward[2]]),
        teslaUnit([fittedForward[0], 0, fittedForward[2]]),
      ) < 0.98
    )
      throw new Error('Invalid Tesla driving frame');
  } catch {
    report.environmentFailures++;
    return false;
  }
  const difference = teslaSubtract(proposal.pose.position, requested.position),
    distance = teslaLength(difference),
    dot = Math.min(
      1,
      Math.abs(
        requested.quaternion.reduce(
          (sum, v, i) => sum + v * proposal!.pose.quaternion[i],
          0,
        ),
      ),
    ),
    angle = 2 * Math.acos(dot),
    fraction = Math.min(
      1,
      distance > EPS ? budget.translationM / distance : 1,
      angle > EPS ? budget.radians / angle : 1,
    ),
    next = {
      position: teslaAdd(requested.position, teslaScale(difference, fraction)),
      quaternion: teslaSlerp(
        requested.quaternion,
        proposal.pose.quaternion,
        fraction,
      ),
    };
  // A fitted proposal is not proof for an intermediate, speed-limited pose.
  // Validate this exact pose and sweep the full body before changing authority.
  const proof = querySupport(
    world,
    next,
    shape,
    proposal.contact.surfaceId,
    state.adhesionArmed,
    report,
  );
  if (
    !proof ||
    proof.kind !== 'ground' ||
    (proof.surfaceId !== priorContact.surfaceId &&
      proof.surfaceId !== proposal.contact.surfaceId) ||
    !admissible(state, proof) ||
    querySweep(world, state, next, shape, priorContact.surfaceId, report)
  )
    return false;
  state.position = next.position;
  state.quaternion = next.quaternion;
  budget.translationM = Math.max(0, budget.translationM - distance * fraction);
  budget.radians = Math.max(0, budget.radians - angle * fraction);
  setContact(state, proof, report);
  remember(state);
  return true;
}
function remember(state: TeslaState) {
  state.quaternion = teslaNormalizeQuaternion(state.quaternion);
  state.lastSafePose = copyPose(state);
  const forward = bodyForward(state);
  if (
    (state.mode !== 'air' || state.attachment) &&
    Math.hypot(forward[0], forward[2]) > 0.1
  )
    state.heading = Math.atan2(forward[0], forward[2]);
}
function leaveSurface(
  state: TeslaState,
  assisted: boolean,
  impulse: number,
  report?: TeslaStepReport,
  groundOrigin?: { origin: TeslaPose; surfaceId: string },
) {
  state.departureContact = state.contact
    ? contactCopy(state.contact)
    : state.attachment
      ? contactCopy(state.attachment.contact)
      : null;
  if (state.mode !== 'air' || state.attachment) {
    if (report) report.transitions++;
  }
  const normal = state.contact?.normal ?? bodyUp(state);
  const release =
    impulse > 0 &&
    (state.mode === 'wall' || state.attachment?.contact.kind === 'wall')
      ? Math.max(10, impulse)
      : impulse;
  state.velocity = teslaLimit(
    teslaAdd(state.velocity, teslaScale(normal, release)),
    TESLA_LIMITS.maxSpeedMps,
  );
  state.groundDeparture = groundOrigin
    ? { ...groundOrigin, resumeVelocity: [...state.velocity], returning: false }
    : null;
  state.mode = 'air';
  state.contact = null;
  state.attachment = null;
  state.flightAssist = assisted;
  state.parked = false;
  state.wallHolding = false;
  state.detachRemainingS = 0.4;
}
function setContact(
  state: TeslaState,
  contact: TeslaContact,
  report: TeslaStepReport,
) {
  if (state.mode === 'air' || state.contact?.surfaceId !== contact.surfaceId)
    report.transitions++;
  state.contact = contact;
  state.mode = contact.kind === 'wall' ? 'wall' : 'ground';
  if (state.mode !== 'wall') state.wallHolding = false;
  state.flightAssist = false;
  state.attachment = null;
  state.departureContact = null;
  state.groundDeparture = null;
}

function wallDepartureDistance(state: TeslaState, shape: TeslaShape) {
  const contact = state.departureContact;
  if (contact?.kind !== 'wall') return 0;
  // Retain the wall frame until every possible orientation fits outside its
  // plane. A timer alone cannot prove this when braking immediately on exit.
  const radius = Math.hypot(...shape.halfExtents) + shape.clearance + 0.03;
  return Math.max(
    0,
    radius -
      teslaDot(teslaSubtract(state.position, contact.point), contact.normal),
  );
}

function queryGroundDeparture(
  world: TeslaWorld,
  from: TeslaPose,
  to: TeslaPose,
  origin: TeslaPose,
  surfaceId: string,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  return querySweep(
    {
      support: (query) => world.support(query),
      sweep: (query) =>
        world.sweepGroundDeparture!({
          ...query,
          origin: copyPose(origin),
          sourceSurfaceId: surfaceId,
        }),
    },
    from,
    to,
    shape,
    undefined,
    report,
  );
}

function advanceGroundDeparture(
  state: TeslaState,
  input: TeslaInput,
  h: number,
  world: TeslaWorld,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  const departure = state.groundDeparture;
  if (!departure) return false;
  if (!shape.groundSupport || !world.sweepGroundDeparture) {
    state.groundDeparture = null;
    return false;
  }
  const finishIfClear = () => {
    if (querySweep(world, state, state, shape, undefined, report)) return false;
    state.velocity = [...departure.resumeVelocity];
    state.groundDeparture = null;
    state.departureContact = null;
    return true;
  };
  if (input.brake || input.park) departure.resumeVelocity = [0, 0, 0];
  if (input.lift < -0.05) departure.returning = true;
  if (!departure.returning && finishIfClear()) return false;
  const returnToOrigin = () => {
    const proof = querySupport(
      world,
      state,
      shape,
      departure.surfaceId,
      state.adhesionArmed,
      report,
    );
    state.velocity = [0, 0, 0];
    if (
      proof?.surfaceId === departure.surfaceId &&
      proof.kind === 'ground' &&
      admissible(state, proof) &&
      !querySweep(world, state, state, shape, proof.surfaceId, report)
    ) {
      setContact(state, proof, report);
      state.detachRemainingS = 0;
      remember(state);
    } else {
      state.groundDeparture = null;
      state.departureContact = null;
    }
  };
  const remaining = departure.returning
      ? state.position[1] - departure.origin.position[1]
      : departure.origin.position[1] + 0.35 - state.position[1],
    distance = Math.min(Math.max(0, remaining), 12 * h);
  state.detachRemainingS = Math.max(state.detachRemainingS, h * 2);
  if (distance <= EPS) {
    state.velocity = [0, 0, 0];
    if (departure.returning) returnToOrigin();
    return true;
  }
  const next: TeslaPose = {
    position: [
      departure.origin.position[0],
      state.position[1] + (departure.returning ? -distance : distance),
      departure.origin.position[2],
    ],
    quaternion: [...departure.origin.quaternion],
  };
  const hit = queryGroundDeparture(
    world,
    departure.returning ? next : state,
    departure.returning ? state : next,
    departure.origin,
    departure.surfaceId,
    shape,
    report,
  );
  if (hit) {
    report.collisions++;
    state.collisionSurfaceId = hit.surfaceId;
    state.impact = Math.min(1, teslaLength(state.velocity) / 35);
    state.velocity = [0, 0, 0];
    if (
      hit.surfaceId === 'tesla:invalid-query' ||
      hit.surfaceId === 'invalid-tesla-world-query'
    ) {
      state.groundDeparture = null;
      state.departureContact = null;
    }
    return true;
  }
  state.position = next.position;
  state.quaternion = next.quaternion;
  state.velocity = [0, (departure.returning ? -distance : distance) / h, 0];
  remember(state);
  if (departure.returning) {
    if (state.position[1] <= departure.origin.position[1] + EPS)
      returnToOrigin();
  } else finishIfClear();
  return true;
}

function requestAttachment(
  state: TeslaState,
  contact: TeslaContact,
  world: TeslaWorld,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  if (state.detachRemainingS > 0 || !admissible(state, contact)) return false;
  const normal = contact.normal;
  const forward = teslaTransportForward(
    bodyUp(state),
    normal,
    bodyForward(state),
  );
  const quaternion = teslaFrame(normal, forward).quaternion;
  const distance = teslaDot(
    teslaSubtract(state.position, contact.point),
    normal,
  );
  const target = {
    position: teslaAdd(
      state.position,
      teslaScale(normal, contactHeight(shape) - distance),
    ),
    quaternion,
  };
  const baseCorner = state.mode === 'ground' && contact.kind === 'wall';
  if (baseCorner)
    target.position = teslaAdd(target.position, [
      0,
      shape.halfExtents[2] + shape.clearance,
      0,
    ]);
  const proof = querySupport(
    world,
    target,
    shape,
    contact.surfaceId,
    state.adhesionArmed,
    report,
  );
  if (
    !proof ||
    proof.surfaceId !== contact.surfaceId ||
    !admissible(state, proof) ||
    teslaDot(proof.normal, normal) < 0.98
  )
    return false;
  const dot = Math.abs(
    state.quaternion.reduce((sum, v, i) => sum + v * quaternion[i], 0),
  );
  const aligned = dot > 0.99995;
  const waypoints: TeslaPose[] = [];
  const ignoreSurfaceIds: (string | undefined)[] = [];
  let groundDeparture: TeslaAttachment['groundDeparture'];
  if (baseCorner && state.contact) {
    // A legal road pose can use the world's bounded suspension skin over
    // adjacent graded triangles. Clear it while both endpoints still have a
    // freshly proven floor, before the unsupported tall corner manoeuvre.
    // Cancel any component toward the wall so a sloped road's normal cannot
    // push the bumper through the facade during this short departure.
    const floor = querySupport(
      world,
      state,
      shape,
      state.contact.surfaceId,
      state.adhesionArmed,
      report,
    );
    if (!floor || floor.surfaceId !== state.contact.surfaceId) return false;
    let cleared: TeslaPose | null = !querySweep(
      world,
      state,
      state,
      shape,
      undefined,
      report,
    )
      ? copyPose(state)
      : null;
    const fittedDeparture =
      !cleared && !!shape.groundSupport && !!world.sweepGroundDeparture;
    const heights = cleared
      ? []
      : fittedDeparture
        ? [0.05, 0.1, 0.15, 0.195, 0.25, 0.35]
        : [0.05, 0.1, 0.15, 0.195];
    for (const height of heights) {
      const offset = fittedDeparture
        ? ([0, height, 0] as TeslaVec3)
        : teslaScale(floor.normal, height);
      const intoWall = teslaDot(offset, normal);
      const pose = {
        position: teslaAdd(
          state.position,
          !fittedDeparture && intoWall < 0
            ? teslaSubtract(offset, teslaScale(normal, intoWall))
            : offset,
        ),
        quaternion: state.quaternion,
      };
      const blocked = fittedDeparture
        ? queryGroundDeparture(
            world,
            state,
            pose,
            state,
            floor.surfaceId,
            shape,
            report,
          )
        : (() => {
            const supported = querySupport(
              world,
              pose,
              shape,
              floor.surfaceId,
              state.adhesionArmed,
              report,
            );
            return (
              !supported ||
              supported.surfaceId !== floor.surfaceId ||
              querySweep(world, state, pose, shape, floor.surfaceId, report)
            );
          })();
      if (blocked || querySweep(world, pose, pose, shape, undefined, report))
        continue;
      cleared = pose;
      if (fittedDeparture)
        groundDeparture = {
          origin: copyPose(state),
          surfaceId: floor.surfaceId,
        };
      break;
    }
    if (!cleared) return false;
    waypoints.push(cleared);
    ignoreSurfaceIds.push(floor.surfaceId);
  }
  if (!aligned) {
    const radius = Math.hypot(...shape.halfExtents) + shape.clearance + 0.03;
    const withdrawn = teslaAdd(
      state.position,
      teslaScale(normal, Math.max(0, radius - distance)),
    );
    const raised = baseCorner
      ? teslaAdd(withdrawn, [0, shape.halfExtents[2] + shape.clearance, 0])
      : withdrawn;
    waypoints.push(
      { position: raised, quaternion: state.quaternion },
      { position: raised, quaternion },
    );
    ignoreSurfaceIds.push(state.contact?.surfaceId, undefined);
  }
  waypoints.push(target);
  // Final approach is parallel to the proven normal with the footprint already
  // aligned. Its endpoint is the legal clearance plane, never inside the face.
  ignoreSurfaceIds.push(proof.surfaceId);
  // Plan before changing authority. Every actual partial step is swept again.
  let previous = copyPose(state);
  for (const [index, waypoint] of waypoints.entries()) {
    if (
      groundDeparture && index === 0
        ? queryGroundDeparture(
            world,
            previous,
            waypoint,
            groundDeparture.origin,
            groundDeparture.surfaceId,
            shape,
            report,
          )
        : querySweep(
            world,
            previous,
            waypoint,
            shape,
            ignoreSurfaceIds[index],
            report,
          )
    )
      return false;
    previous = waypoint;
  }
  const resumeSpeed = teslaDot(
    state.velocity,
    contact.kind === 'wall' ? bodyForward(state) : forward,
  );
  state.attachment = {
    contact: proof,
    waypoints,
    ignoreSurfaceIds,
    index: 0,
    resumeSpeed: Math.max(
      -TESLA_LIMITS.reverseSpeedMps,
      Math.min(30, resumeSpeed),
    ),
    parkOnArrival: state.parked,
    groundDeparture,
  };
  state.contact = null;
  state.mode = 'air';
  state.flightAssist = true;
  state.parked = false;
  state.wallHolding = false;
  return true;
}

function advanceAttachment(
  state: TeslaState,
  h: number,
  input: TeslaInput,
  world: TeslaWorld,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  const attachment = state.attachment!;
  const target = attachment.waypoints[attachment.index];
  const difference = teslaSubtract(target.position, state.position);
  const distance = teslaLength(difference);
  const dot = Math.min(
    1,
    Math.abs(
      state.quaternion.reduce((sum, v, i) => sum + v * target.quaternion[i], 0),
    ),
  );
  const angle = 2 * Math.acos(dot);
  const fraction = Math.min(
    1,
    distance > EPS ? (TESLA_LIMITS.attachmentSpeedMps * h) / distance : 1,
    angle > EPS ? (TESLA_LIMITS.attachmentRadiansPerS * h) / angle : 1,
  );
  const next = {
    position: teslaAdd(state.position, teslaScale(difference, fraction)),
    quaternion: teslaSlerp(state.quaternion, target.quaternion, fraction),
  };
  if (
    attachment.groundDeparture && attachment.index === 0
      ? queryGroundDeparture(
          world,
          state,
          next,
          attachment.groundDeparture.origin,
          attachment.groundDeparture.surfaceId,
          shape,
          report,
        )
      : querySweep(
          world,
          state,
          next,
          shape,
          attachment.ignoreSurfaceIds[attachment.index],
          report,
        )
  ) {
    state.attachment = null;
    state.velocity = [0, 0, 0];
    return;
  }
  state.velocity = teslaScale(
    teslaSubtract(next.position, state.position),
    1 / h,
  );
  state.position = next.position;
  state.quaternion = next.quaternion;
  remember(state);
  if (input.brake) attachment.resumeSpeed = 0;
  else if (
    attachment.contact.kind === 'wall' &&
    !input.throttle &&
    !input.boost
  )
    attachment.resumeSpeed = toward(attachment.resumeSpeed, 0, 5 * h);
  if (fraction < 1 - EPS) return;
  attachment.index++;
  if (attachment.index < attachment.waypoints.length) return;
  const proof = querySupport(
    world,
    state,
    shape,
    attachment.contact.surfaceId,
    state.adhesionArmed,
    report,
  );
  if (
    !proof ||
    proof.surfaceId !== attachment.contact.surfaceId ||
    !admissible(state, proof)
  ) {
    state.attachment = null;
    state.velocity = [0, 0, 0];
    return;
  }
  setContact(state, proof, report);
  state.parked = attachment.parkOnArrival;
  state.velocity = teslaScale(
    bodyForward(state),
    state.parked ? 0 : attachment.resumeSpeed,
  );
}

function moveSwept(
  state: TeslaState,
  next: TeslaPose,
  world: TeslaWorld,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  let ignoredSupport = state.contact?.surfaceId;
  const departure = state.departureContact;
  if (
    !ignoredSupport &&
    departure &&
    state.detachRemainingS > 0 &&
    teslaDot(teslaSubtract(next.position, state.position), departure.normal) >
      EPS
  ) {
    const proof = querySupport(
      world,
      state,
      shape,
      departure.surfaceId,
      state.adhesionArmed,
      report,
    );
    if (
      proof?.surfaceId === departure.surfaceId &&
      teslaDot(proof.normal, departure.normal) > 0.98
    )
      ignoredSupport = departure.surfaceId;
  }
  let hit = querySweep(world, state, next, shape, ignoredSupport, report);
  if (
    !ignoredSupport &&
    departure?.kind === 'wall' &&
    state.detachRemainingS > 0 &&
    hit?.surfaceId === departure.surfaceId &&
    hit.kind === 'wall' &&
    hit.fraction <= EPS &&
    teslaDot(hit.normal, departure.normal) > 0.999 &&
    Math.abs(
      teslaDot(teslaSubtract(hit.point, departure.point), departure.normal),
    ) < 0.01 &&
    Math.abs(
      state.quaternion.reduce((sum, v, i) => sum + v * next.quaternion[i], 0),
    ) >
      1 - 1e-10 &&
    teslaDot(teslaSubtract(next.position, state.position), departure.normal) >
      EPS
  ) {
    const distance = teslaDot(
      teslaSubtract(state.position, departure.point),
      departure.normal,
    );
    // At a wall edge a complete footprint no longer exists, but the live sweep
    // still identifies the same physical contact plane. Permit only its tiny
    // existing contact skin to move strictly outward without rotation; every
    // other face, including the adjacent roof, remains in the actual sweep.
    if (
      distance >= contactHeight(shape) - 0.01 &&
      distance <= contactHeight(shape) + 0.02
    )
      hit = querySweep(world, state, next, shape, departure.surfaceId, report);
  }
  if (!hit) {
    state.position = next.position;
    state.quaternion = next.quaternion;
    remember(state);
    return;
  }
  report.collisions++;
  state.collisionSurfaceId = hit.surfaceId;
  const travel = teslaLength(teslaSubtract(next.position, state.position));
  const fraction = Math.max(
    0,
    hit.fraction - (travel > EPS ? 0.001 / travel : 0.001),
  );
  state.position = teslaAdd(
    state.position,
    teslaScale(teslaSubtract(next.position, state.position), fraction),
  );
  state.quaternion = teslaSlerp(state.quaternion, next.quaternion, fraction);
  const closing = -teslaDot(state.velocity, hit.normal);
  state.impact = Math.max(state.impact, Math.min(1, closing / 35));
  remember(state);
  if (closing >= -0.05 && requestAttachment(state, hit, world, shape, report))
    return;
  // Sliding only removes velocity into the obstacle. The next substep sweeps
  // the remaining tangent movement instead of teleporting through a corner.
  state.velocity =
    closing > 0
      ? teslaAdd(state.velocity, teslaScale(hit.normal, closing))
      : [0, 0, 0];
  if (teslaLength(state.velocity) < 0.04) state.velocity = [0, 0, 0];
}

function airOrientation(state: TeslaState, input: TeslaInput, h: number) {
  // Clear the full body from a wall before re-levelling its long axis.
  if (state.detachRemainingS > 0) return state.quaternion;
  const frame = teslaFrame(TESLA_UP, [
    Math.sin(state.heading),
    0,
    Math.cos(state.heading),
  ]);
  const pitch = input.pitch * 0.6 + input.lift * 0.12;
  const forward = teslaRotate(
    teslaAxisRotation(frame.right, -pitch),
    frame.forward,
  );
  const up = teslaRotate(
    teslaAxisRotation(forward, -(input.roll * 0.6 + input.steer * 0.2)),
    teslaRotate(teslaAxisRotation(frame.right, -pitch), frame.up),
  );
  return teslaSlerp(
    state.quaternion,
    teslaFrame(up, forward).quaternion,
    1 - Math.exp(-4 * h),
  );
}

function integrate(
  state: TeslaState,
  input: TeslaInput,
  h: number,
  world: TeslaWorld,
  shape: TeslaShape,
  report: TeslaStepReport,
) {
  state.timeS += h;
  state.detachRemainingS = Math.max(0, state.detachRemainingS - h);
  if (wallDepartureDistance(state, shape) > EPS)
    state.detachRemainingS = Math.max(state.detachRemainingS, h * 2);
  else if (!state.detachRemainingS) state.departureContact = null;
  state.impact = Math.max(0, state.impact - h * 2);
  if (
    state.mode === 'air' &&
    advanceGroundDeparture(state, input, h, world, shape, report)
  )
    return;
  if (state.attachment) {
    advanceAttachment(state, h, input, world, shape, report);
    return;
  }
  const fitBudget: GroundFitBudget = {
    translationM: TESLA_LIMITS.attachmentSpeedMps * h,
    radians: TESLA_LIMITS.attachmentRadiansPerS * h,
  };
  const fittedCurrent = fitGroundPose(state, world, shape, fitBudget, report);
  state.wallHolding = false;
  if (state.contact) {
    const proof = querySupport(
      world,
      state,
      shape,
      state.contact.surfaceId,
      state.adhesionArmed,
      report,
    );
    if (
      !proof ||
      !admissible(state, proof) ||
      teslaDot(proof.normal, state.contact.normal) < 0.98
    )
      leaveSurface(
        state,
        state.mode === 'wall',
        state.mode === 'wall' ? 8 : 0,
        report,
      );
    else {
      state.contact = proof;
      if (state.parked) {
        state.velocity = [0, 0, 0];
        return;
      }
      if (
        state.mode === 'wall' &&
        state.adhesionArmed &&
        state.velocity.every((value) => value === 0) &&
        (input.brake || (!input.throttle && !input.steer && !input.boost)) &&
        Math.abs(
          teslaDot(teslaSubtract(state.position, proof.point), proof.normal) -
            contactHeight(shape),
        ) <= EPS &&
        teslaDot(bodyUp(state), proof.normal) > 1 - 1e-10 &&
        !querySweep(world, state, state, shape, proof.surfaceId, report)
      ) {
        // Revalidate the actual wall and the complete resting body every
        // substep. No historical hold flag grants support after geometry or
        // permissions change, and no surface correction can drift this pose.
        state.velocity = [0, 0, 0];
        state.wallHolding = true;
        return;
      }
    }
  }
  const throttle = input.throttle || (input.boost ? 1 : 0);
  if (state.mode !== 'air' && state.contact) {
    const fittedSurfaceId = fittedCurrent ? state.contact.surfaceId : null;
    const up = fittedCurrent ? bodyUp(state) : state.contact.normal;
    let speed = teslaDot(state.velocity, bodyForward(state));
    speed += throttle * (input.boost ? 38 : 22) * h;
    if (input.brake) speed = toward(speed, 0, 55 * h);
    else if (!throttle) speed = toward(speed, 0, 5 * h);
    speed = Math.max(
      -TESLA_LIMITS.reverseSpeedMps,
      Math.min(
        input.boost
          ? TESLA_LIMITS.boostedGroundSpeedMps
          : TESLA_LIMITS.groundSpeedMps,
        speed,
      ),
    );
    if (Math.abs(speed) < 0.03 && !throttle) speed = 0;
    const turn =
      input.steer *
      1.5 *
      Math.min(1, Math.abs(speed) / 4) *
      Math.sign(speed) *
      h;
    const forward = teslaRotate(
      teslaAxisRotation(up, turn),
      bodyForward(state),
    );
    const quaternion = teslaFrame(up, forward).quaternion;
    state.velocity = teslaScale(forward, speed);
    const requested = {
      position: teslaAdd(state.position, teslaScale(state.velocity, h)),
      quaternion,
    };
    // Fit the destination before moving: at motorway speed the front wheels
    // can cross a grade within one substep, outside a source-plane tyre skin.
    const fittedDestination = fitGroundPose(
      state,
      world,
      shape,
      fitBudget,
      report,
      requested,
    );
    if (fittedDestination)
      state.velocity = teslaScale(bodyForward(state), speed);
    else moveSwept(state, requested, world, shape, report);
    if (!state.contact || state.attachment) return;
    const support = querySupport(
      world,
      state,
      shape,
      state.contact.surfaceId,
      state.adhesionArmed,
      report,
    );
    if (!support || !admissible(state, support)) {
      leaveSurface(
        state,
        state.mode === 'wall',
        state.mode === 'wall' ? 8 : 0,
        report,
      );
      return;
    }
    if (
      fittedDestination ||
      (fittedCurrent && support.surfaceId === fittedSurfaceId)
    ) {
      // The actual wheel/union proof owns the fitted ride height and attitude.
      // Re-projecting it onto contact.normal would recreate the single-plane
      // constraint at an otherwise continuous ordinary-ground crease.
      setContact(state, support, report);
      remember(state);
      return;
    }
    const distance = teslaDot(
      teslaSubtract(state.position, support.point),
      support.normal,
    );
    const correction = contactHeight(shape) - distance;
    if (Math.abs(correction) > fitBudget.translationM + 0.001) {
      leaveSurface(state, false, 0, report);
      return;
    }
    const corrected = {
      position: teslaAdd(
        state.position,
        teslaScale(support.normal, correction),
      ),
      quaternion: state.quaternion,
    };
    if (
      !querySweep(world, state, corrected, shape, support.surfaceId, report)
    ) {
      state.position = corrected.position;
      setContact(state, support, report);
      remember(state);
    }
  } else {
    state.heading = Math.atan2(
      Math.sin(state.heading + input.steer * 1.4 * h),
      Math.cos(state.heading + input.steer * 1.4 * h),
    );
    if (Math.abs(input.lift) > 0.01 || input.brake) state.flightAssist = true;
    const forward: TeslaVec3 = [
      Math.sin(state.heading),
      0,
      Math.cos(state.heading),
    ];
    const target = teslaScale(
      forward,
      throttle *
        (input.boost
          ? TESLA_LIMITS.boostedAirSpeedMps
          : TESLA_LIMITS.airSpeedMps),
    );
    const horizontal: TeslaVec3 = [state.velocity[0], 0, state.velocity[2]];
    const acceleration = input.brake
      ? 80
      : input.boost
        ? 45
        : throttle
          ? 28
          : 12;
    const desiredHorizontal = input.brake ? ([0, 0, 0] as TeslaVec3) : target;
    const changed =
      state.detachRemainingS > 0 && !input.brake
        ? horizontal
        : teslaAdd(
            horizontal,
            teslaLimit(
              teslaSubtract(desiredHorizontal, horizontal),
              acceleration * h,
            ),
          );
    const vertical = state.flightAssist
      ? toward(
          state.velocity[1],
          input.brake
            ? 0
            : input.lift * (input.boost ? 32 : TESLA_LIMITS.liftSpeedMps),
          28 * h,
        )
      : Math.max(-70, state.velocity[1] - 12 * h);
    state.velocity = teslaLimit(
      [changed[0], vertical, changed[2]],
      TESLA_LIMITS.maxSpeedMps,
    );
    const wallClearance = wallDepartureDistance(state, shape);
    if (wallClearance > EPS) {
      // Finish a short swept normal withdrawal before accepting hover/brake or
      // re-levelling. Tangential climbing cannot push into an overhanging roof
      // during this clearance phase, and no input can cancel it half-way.
      state.velocity = teslaScale(
        state.departureContact!.normal,
        Math.min(10, wallClearance / h),
      );
    }
    if (
      state.flightAssist &&
      teslaLength(state.velocity) < 0.03 &&
      !throttle &&
      !input.lift
    )
      state.velocity = [0, 0, 0];
    moveSwept(
      state,
      {
        position: teslaAdd(state.position, teslaScale(state.velocity, h)),
        quaternion: airOrientation(state, input, h),
      },
      world,
      shape,
      report,
    );
    if (
      !state.attachment &&
      state.detachRemainingS <= 0 &&
      state.velocity[1] <= 0.1
    ) {
      const proof = querySupport(
        world,
        state,
        shape,
        undefined,
        state.adhesionArmed,
        report,
      );
      if (proof && admissible(state, proof)) {
        const distance = teslaDot(
          teslaSubtract(state.position, proof.point),
          proof.normal,
        );
        if (
          distance >= contactHeight(shape) - 0.01 &&
          distance <= contactHeight(shape) + 0.025
        )
          requestAttachment(state, proof, world, shape, report);
      }
    }
  }
}

/** Finite fixed-size substeps consume the actual frame duration up to 250ms.
 * A hidden-tab gap is reported as dropped time instead of advancing unchecked.
 * Fuel/stamina are deliberately absent: assisted flight and boost are unlimited.
 */
export function stepTesla(
  state: TeslaState,
  raw: Partial<TeslaInput>,
  dtSeconds: number,
  world: TeslaWorld,
  shape = TESLA_DEFAULT_SHAPE,
): TeslaStepReport {
  if (
    !Number.isFinite(dtSeconds) ||
    dtSeconds < 0 ||
    !validShape(shape) ||
    !finiteVector(state.position, 3) ||
    !finiteVector(state.velocity, 3) ||
    !finiteVector(state.quaternion, 4) ||
    !Number.isFinite(state.heading)
  )
    throw new Error('Invalid Tesla simulation step');
  const simulatedS = Math.min(TESLA_LIMITS.maxElapsedS, dtSeconds);
  const report: TeslaStepReport = {
    simulatedS,
    droppedS: dtSeconds - simulatedS,
    substeps: 0,
    collisions: 0,
    transitions: 0,
    environmentFailures: 0,
  };
  if (!simulatedS) return report;
  const givenQuaternion = state.quaternion;
  state.quaternion = teslaNormalizeQuaternion(state.quaternion);
  const input: TeslaInput = {
    throttle: axis(raw.throttle),
    steer: axis(raw.steer),
    lift: axis(raw.lift),
    pitch: axis(raw.pitch),
    roll: axis(raw.roll),
    boost: raw.boost === true,
    brake: raw.brake === true,
    jump: raw.jump === true,
    flightToggle: raw.flightToggle === true,
    adhesionToggle: raw.adhesionToggle === true,
    park: raw.park === true,
  };
  const edge = {
    jump: input.jump && !state.held.jump,
    flightToggle: input.flightToggle && !state.held.flightToggle,
    adhesionToggle: input.adhesionToggle && !state.held.adhesionToggle,
    park: input.park && !state.held.park,
  };
  state.held = {
    jump: input.jump,
    flightToggle: input.flightToggle,
    adhesionToggle: input.adhesionToggle,
    park: input.park,
  };
  let launchGroundOrigin: { origin: TeslaPose; surfaceId: string } | undefined;
  if (
    (edge.jump || edge.flightToggle) &&
    state.mode === 'ground' &&
    state.contact?.kind === 'ground' &&
    shape.groundSupport &&
    world.sweepGroundDeparture
  ) {
    // Re-sample the current physical floor before preserving its identity. A
    // higher overlapping paving triangle can own the same legal wheel pose.
    const proof = querySupport(
      world,
      state,
      shape,
      state.contact.surfaceId,
      state.adhesionArmed,
      report,
    );
    if (
      proof?.kind === 'ground' &&
      admissible(state, proof) &&
      !querySweep(world, state, state, shape, proof.surfaceId, report)
    ) {
      state.contact = proof;
      launchGroundOrigin = {
        origin: copyPose(state),
        surfaceId: proof.surfaceId,
      };
    }
  }
  if (edge.adhesionToggle) {
    state.adhesionArmed = !state.adhesionArmed;
    if (
      !state.adhesionArmed &&
      (state.mode === 'wall' || state.attachment?.contact.kind === 'wall')
    )
      leaveSurface(state, true, 2, report);
  }
  if (edge.flightToggle) {
    if (state.mode !== 'air' || state.attachment)
      leaveSurface(state, true, 5, report, launchGroundOrigin);
    else state.flightAssist = !state.flightAssist;
  }
  if (edge.jump && (state.mode !== 'air' || state.attachment))
    leaveSurface(state, true, 8, report, launchGroundOrigin);
  if (edge.park) {
    state.wallHolding = false;
    if (state.attachment)
      state.attachment.parkOnArrival = !state.attachment.parkOnArrival;
    else if (state.contact) {
      state.parked = !state.parked;
      state.velocity = [0, 0, 0];
    } else {
      state.flightAssist = true;
      state.velocity = [0, 0, 0];
    }
  }
  if (state.parked && (Math.abs(input.throttle) > 0.05 || input.boost))
    state.parked = false;
  if (
    state.mode === 'ground' &&
    state.contact?.kind === 'ground' &&
    Math.abs(Math.hypot(...givenQuaternion) - 1) <= 1e-12 &&
    state.velocity.every((value) => value === 0) &&
    !state.attachment &&
    !state.groundDeparture &&
    !state.departureContact &&
    [raw.throttle, raw.steer, raw.lift, raw.pitch, raw.roll].every(
      (value) => value === undefined || value === 0,
    ) &&
    !input.boost &&
    !input.jump &&
    !input.flightToggle &&
    !input.adhesionToggle &&
    !input.park
  ) {
    // Re-prove this exact stationary pose on every render step. Its wheel and
    // actual-body permission is never carried across frames. No fitting or
    // zero-motion 120Hz integration is needed while that proof remains valid.
    const pose: TeslaPose = {
        position: [...state.position],
        quaternion: [...givenQuaternion],
      },
      proof = querySupport(
        world,
        pose,
        shape,
        state.contact.surfaceId,
        state.adhesionArmed,
        report,
      );
    if (
      proof?.surfaceId === state.contact.surfaceId &&
      proof.kind === 'ground' &&
      admissible(state, proof) &&
      teslaDot(proof.normal, state.contact.normal) >= 0.98 &&
      !querySweep(world, pose, pose, shape, proof.surfaceId, report)
    ) {
      state.quaternion = givenQuaternion;
      state.contact = proof;
      state.timeS += simulatedS;
      state.detachRemainingS = Math.max(0, state.detachRemainingS - simulatedS);
      state.impact = Math.max(0, state.impact - simulatedS * 2);
      return report;
    }
  }
  let remaining = simulatedS;
  while (remaining > 1e-9) {
    const h = Math.min(TESLA_LIMITS.maxStepS, remaining);
    integrate(state, input, h, world, shape, report);
    state.velocity = teslaLimit(state.velocity, TESLA_LIMITS.maxSpeedMps);
    remaining -= h;
    report.substeps++;
  }
  return report;
}
