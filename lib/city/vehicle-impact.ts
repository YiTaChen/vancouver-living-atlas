/** Shared, deterministic game collision response. Metres, seconds and joules.
 * These are gameplay estimates, not crash-test ratings or real driving advice.
 * Contact queries and scene mutations stay with the caller; this module is pure
 * except for the explicit, bounded per-vehicle damage accumulator below.
 */
export type Vec3 = readonly [number, number, number];
export type ImpactVec3 = Vec3;
export type ImpactObstacleKind =
  | 'tree'
  | 'foliage'
  | 'lamp'
  | 'guardrail'
  | 'rigid';
export interface ImpactObstacle {
  id: string;
  kind: ImpactObstacleKind;
  /** Rendered/game trunk or pole diameter, never an inferred measured DBH. */
  diameterM?: number;
  /** False keeps a pole/tree rigid regardless of impact energy. */
  breakaway?: boolean;
  material?: 'wood' | 'metal' | 'steel' | 'concrete';
  /** Optional explicit game work override, still gated by breakaway and kind. */
  breakWorkJ?: number;
}
export interface VehicleImpactQuery {
  velocity: Vec3;
  /** Outward obstacle normal, pointing toward the car; need not be unit length. */
  normal: Vec3;
  massKg: number;
  obstacle: ImpactObstacle;
}
export interface VehicleImpactResult {
  valid: boolean;
  velocity: Vec3;
  normalEnergyJ: number;
  absorbedEnergyJ: number;
  breakWorkJ: number;
  broken: boolean;
  /** Foliage can yield without destroying the independent trunk. */
  passThrough: boolean;
  severity: number;
  closingMps: number;
  tangentMps: number;
  scrape: number;
  friction: number;
  restitution: number;
}
export const VEHICLE_IMPACT_TUNING = {
  treeWorkPerCubicMetreJ: 2_000_000,
  breakawayLampWorkJ: 6_000,
  lampReferenceDiameterM: 0.16,
  maximumFoliageWorkJ: 500,
  damageReferenceDeltaMps: 20,
  recentEventLimit: 32,
} as const;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const finiteVector = (v: Vec3 | undefined): v is Vec3 =>
  !!v &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Math.abs(n) <= 100_000);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (v: Vec3) => Math.hypot(...v);
const kinds = new Set<ImpactObstacleKind>([
  'tree',
  'foliage',
  'lamp',
  'guardrail',
  'rigid',
]);
function emptyResult(
  velocity: Vec3 = [0, 0, 0],
  valid = false,
): VehicleImpactResult {
  return {
    valid,
    velocity: [...velocity],
    normalEnergyJ: 0,
    absorbedEnergyJ: 0,
    breakWorkJ: 0,
    broken: false,
    passThrough: false,
    severity: 0,
    closingMps: 0,
    tangentMps: 0,
    scrape: 0,
    friction: 0,
    restitution: 0,
  };
}
/** Resolve one new closing contact. Only normal energy can break a trunk or
 * pole: a fast glancing side scrape is not a high-energy head-on tree impact.
 * A caller that removes a broken source must sweep the remaining path afresh.
 */
export function resolveVehicleImpact(
  query: VehicleImpactQuery,
): VehicleImpactResult {
  if (
    !query ||
    !finiteVector(query.velocity) ||
    !finiteVector(query.normal) ||
    !Number.isFinite(query.massKg) ||
    query.massKg <= 0 ||
    query.massKg > 100_000 ||
    !query.obstacle ||
    typeof query.obstacle.id !== 'string' ||
    !query.obstacle.id ||
    !kinds.has(query.obstacle.kind) ||
    (query.obstacle.diameterM !== undefined &&
      (!Number.isFinite(query.obstacle.diameterM) ||
        query.obstacle.diameterM <= 0 ||
        query.obstacle.diameterM > 10)) ||
    (query.obstacle.breakWorkJ !== undefined &&
      (!Number.isFinite(query.obstacle.breakWorkJ) ||
        query.obstacle.breakWorkJ <= 0 ||
        query.obstacle.breakWorkJ > 1e9))
  )
    return emptyResult();
  const length = magnitude(query.normal);
  if (length < 1e-9) return emptyResult();
  const normal: Vec3 = query.normal.map((v) => v / length) as unknown as Vec3;
  const closingMps = -dot(query.velocity, normal);
  if (closingMps <= 1e-7) return emptyResult(query.velocity, true);
  const tangent: Vec3 = query.velocity.map(
    (v, i) => v + closingMps * normal[i],
  ) as unknown as Vec3;
  const tangentMps = magnitude(tangent),
    normalEnergyJ = 0.5 * query.massKg * closingMps ** 2,
    kind = query.obstacle.kind,
    diameter = query.obstacle.diameterM ?? (kind === 'tree' ? 0.3 : 0.16),
    canBreak = query.obstacle.breakaway !== false;
  let breakWorkJ = 0,
    broken = false,
    passThrough = kind === 'foliage',
    friction =
      kind === 'guardrail'
        ? query.obstacle.material === 'concrete'
          ? 0.3
          : 0.12
        : kind === 'rigid'
          ? 0.25
          : 0.18,
    restitution =
      kind === 'guardrail'
        ? query.obstacle.material === 'concrete'
          ? 0.015
          : 0.04
        : 0.02,
    outwardMps = closingMps * restitution;
  if (kind === 'tree' && canBreak)
    breakWorkJ = VEHICLE_IMPACT_TUNING.treeWorkPerCubicMetreJ * diameter ** 3;
  if (kind === 'lamp' && canBreak)
    breakWorkJ =
      VEHICLE_IMPACT_TUNING.breakawayLampWorkJ *
      (diameter / VEHICLE_IMPACT_TUNING.lampReferenceDiameterM) ** 2;
  if (
    (kind === 'tree' || kind === 'lamp') &&
    canBreak &&
    query.obstacle.breakWorkJ !== undefined
  )
    breakWorkJ = query.obstacle.breakWorkJ;
  if (breakWorkJ > 0 && normalEnergyJ >= breakWorkJ) {
    broken = true;
    passThrough = true;
    outwardMps = -Math.sqrt(
      Math.max(0, closingMps ** 2 - (2 * breakWorkJ) / query.massKg),
    );
    friction = kind === 'lamp' ? 0.025 : 0.045;
    restitution = 0;
  } else if (kind === 'foliage') {
    breakWorkJ = Math.min(
      VEHICLE_IMPACT_TUNING.maximumFoliageWorkJ,
      normalEnergyJ * 0.15,
    );
    outwardMps = -Math.sqrt(
      Math.max(0, closingMps ** 2 - (2 * breakWorkJ) / query.massKg),
    );
    friction = 0.015;
    restitution = 0;
  }
  // Coulomb-style loss uses the actual normal impulse. Once an obstacle yields,
  // only the consumed normal momentum contributes to the tangential loss.
  const impulsePerMass = Math.max(0, closingMps + outwardMps),
    tangentLoss = Math.min(tangentMps, friction * impulsePerMass),
    tangentScale =
      tangentMps > 1e-9 ? (tangentMps - tangentLoss) / tangentMps : 0;
  const velocity = tangent.map(
    (v, i) => v * tangentScale + outwardMps * normal[i],
  ) as unknown as Vec3;
  const initialEnergy =
      0.5 * query.massKg * dot(query.velocity, query.velocity),
    finalEnergy = 0.5 * query.massKg * dot(velocity, velocity),
    absorbedEnergyJ = Math.max(0, initialEnergy - finalEnergy),
    severity = clamp01(
      Math.sqrt((2 * absorbedEnergyJ) / query.massKg) /
        VEHICLE_IMPACT_TUNING.damageReferenceDeltaMps,
    ),
    scrape =
      tangentMps > 0.5 && closingMps > 0.05
        ? clamp01(
            tangentLoss / 4 +
              Math.min(tangentMps / 35, 1) * Math.min(closingMps / 3, 1) * 0.15,
          )
        : 0;
  return {
    valid: true,
    velocity,
    normalEnergyJ,
    absorbedEnergyJ,
    breakWorkJ,
    broken,
    passThrough,
    severity,
    closingMps,
    tangentMps,
    scrape,
    friction,
    restitution,
  };
}

export type VehicleDamageZone = 'front' | 'rear' | 'left' | 'right' | 'roof';
export const VEHICLE_DAMAGE_ZONES: readonly VehicleDamageZone[] = [
  'front',
  'rear',
  'left',
  'right',
  'roof',
];
export interface VehicleDamageHit {
  zone: VehicleDamageZone;
  localPoint: Vec3;
  amount: number;
  scrape: number;
}
export interface VehicleDamageState {
  zones: Record<VehicleDamageZone, number>;
  scratches: Record<VehicleDamageZone, number>;
  /** Maximum panel damage, normalized 0 pristine .. 1 fully damaged. */
  overall: number;
  severity: number;
  revision: number;
  lastHit: VehicleDamageHit | null;
  /** Bounded contact-episode IDs; idempotence is optional for independent callers. */
  recentEventIds: string[];
}
const emptyZones = (): Record<VehicleDamageZone, number> => ({
  front: 0,
  rear: 0,
  left: 0,
  right: 0,
  roof: 0,
});
export function createVehicleDamage(): VehicleDamageState {
  return {
    zones: emptyZones(),
    scratches: emptyZones(),
    overall: 0,
    severity: 0,
    revision: 0,
    lastHit: null,
    recentEventIds: [],
  };
}
export function resetVehicleDamage(state: VehicleDamageState): void {
  state.zones = emptyZones();
  state.scratches = emptyZones();
  state.severity = 0;
  state.overall = 0;
  state.revision++;
  state.lastHit = null;
  state.recentEventIds = [];
}
export interface VehicleDamageQuery {
  localPoint: Vec3;
  localNormal?: Vec3;
  halfExtents?: Vec3;
  impact: VehicleImpactResult;
  eventId?: string;
}
/** Classify in vehicle space (+Z front, +Y roof, +X driver's left). A top contact must
 * actually be high on the shell; a high vertical wall is still a side impact.
 */
export function vehicleDamageZone(
  query: Pick<VehicleDamageQuery, 'localPoint' | 'localNormal' | 'halfExtents'>,
): VehicleDamageZone {
  const p = query.localPoint,
    h = query.halfExtents ?? [1, 0.7, 2.3],
    x = Math.abs(p[0]) / h[0],
    z = Math.abs(p[2]) / h[2];
  if (
    p[1] / h[1] >= 0.65 &&
    p[1] / h[1] > Math.max(x, z) &&
    (!query.localNormal ||
      Math.abs(query.localNormal[1]) >=
        Math.max(
          Math.abs(query.localNormal[0]),
          Math.abs(query.localNormal[2]),
        ))
  )
    return 'roof';
  return z >= x ? (p[2] >= 0 ? 'front' : 'rear') : p[0] >= 0 ? 'left' : 'right';
}
/** Accumulate a contact once per optional episode ID. Touching a parked car or
 * repeatedly solving a resting contact adds no damage. Per-zone dent/scratches
 * are independent so a long shallow guardrail scrape remains visible.
 */
export function applyVehicleDamage(
  state: VehicleDamageState,
  query: VehicleDamageQuery,
): VehicleDamageHit | null {
  const impact = query?.impact;
  if (
    !state ||
    !query ||
    !finiteVector(query.localPoint) ||
    (query.localNormal !== undefined && !finiteVector(query.localNormal)) ||
    (query.halfExtents !== undefined &&
      (!finiteVector(query.halfExtents) ||
        query.halfExtents.some((v) => v <= 0))) ||
    !impact?.valid ||
    ![
      impact.severity,
      impact.scrape,
      impact.closingMps,
      impact.absorbedEnergyJ,
    ].every(Number.isFinite) ||
    impact.closingMps <= 0.15 ||
    impact.absorbedEnergyJ < 50 ||
    (query.eventId !== undefined &&
      state.recentEventIds.includes(query.eventId))
  )
    return null;
  const amount = clamp01(impact.severity ** 1.7 * 0.68),
    scrape = clamp01(impact.scrape * 0.45 + impact.severity * 0.1);
  if (amount < 0.0005 && scrape < 0.001) return null;
  const zone = vehicleDamageZone(query);
  state.zones[zone] = 1 - (1 - state.zones[zone]) * (1 - amount);
  state.scratches[zone] = 1 - (1 - state.scratches[zone]) * (1 - scrape);
  state.severity = Math.max(
    ...VEHICLE_DAMAGE_ZONES.map((key) => state.zones[key]),
  );
  state.overall = state.severity;
  state.revision++;
  const hit: VehicleDamageHit = {
    zone,
    localPoint: [...query.localPoint],
    amount,
    scrape,
  };
  state.lastHit = hit;
  if (query.eventId !== undefined) {
    state.recentEventIds.push(query.eventId);
    if (state.recentEventIds.length > VEHICLE_IMPACT_TUNING.recentEventLimit)
      state.recentEventIds.splice(
        0,
        state.recentEventIds.length - VEHICLE_IMPACT_TUNING.recentEventLimit,
      );
  }
  return hit;
}
/** Bounded handling consequences; damage cannot invert steering or create a
 * permanent soft lock. The caller supplies repair/recovery controls.
 */
export function vehicleDamagePerformance(state: VehicleDamageState) {
  const front = clamp01(state.zones.front),
    rear = clamp01(state.zones.rear),
    sides = Math.max(clamp01(state.zones.left), clamp01(state.zones.right)),
    mechanical = Math.max(front, rear * 0.75);
  return {
    acceleration: 1 - mechanical * 0.45,
    topSpeed: 1 - mechanical * 0.35,
    steering: 1 - Math.max(front * 0.75, sides) * 0.3,
    braking: 1 - Math.max(front, sides) * 0.15,
    /** Signed fraction of full steering input; slight pull, never inversion. */
    steeringBias:
      (clamp01(state.zones.left) - clamp01(state.zones.right)) * 0.035,
  };
}
