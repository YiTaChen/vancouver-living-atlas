/** Original analytic shore grading, in metres (x east, z south, y up).
 *
 * This is a surface sampler, not a second sand plane. The terrain renderer,
 * navigation and water collision must consume this same field and land mask.
 * Source geometry is OSM MHWS; heights/depths are illustrative grading, not
 * bathymetry or a tidal model. seaLevel is a display datum, not a tide control.
 */
export type XZ = [number, number];
export type Polygon = XZ[][];
export type MultiPolygon = Polygon[];
export interface BeachDefinition {
  id: string;
  name: string;
  /** Original sand footprint, including mapped intertidal sand. */
  polygons: MultiPolygon;
  /** Original footprint + small grading collar; does not expand sand. */
  profilePolygons: MultiPolygon;
  /** profilePolygons ∩ closed, unsimplified OSM MHWS land. */
  dryPolygons: MultiPolygon;
  /** Original sand polygon ∩ OSM land, for export/diagnostics. */
  drySandPolygons?: MultiPolygon;
  /** Land-side outer boundary of the grading domain (not the MHWS line). */
  backshoreEdges: XZ[][];
  coastlines: { sourceId: number; coordinates: XZ[] }[];
  params: {
    maxSubmergedDepth: number;
    submergedScaleMetres: number;
    wetBandMetres: number;
    edgeFeatherMetres: number;
    gradingCollarMetres?: number;
    /** Illustrative upper sandy grade, not a surveyed beach measurement. */
    maxSandGrade: number;
    toeEaseMetres: number;
  };
}
export interface BeachFixture {
  seaLevel: number;
  beaches: BeachDefinition[];
}
export interface BeachSample {
  id: string;
  /** Final world y: do NOT add the old +1.6m sand or +0.65m park offsets. */
  height: number;
  /** Positive on OSM's land side; negative on its water side. */
  shoreDistance: number;
  /** Strictly landward of MHWS. Shoreline itself belongs to water. */
  isLand: boolean;
  /** Geometric shore obstacle, before a vessel-specific draft test. */
  boatBlocked: boolean;
  depth: number;
  /** No sand outside the original polygon. Blend within its edge only. */
  sandWeight: number;
  wetness: number;
}
type Segment = [number, number, number, number, number]; // ax, az, dx, dz, length²
type Bounds = [number, number, number, number];
type Indexed = {
  definition: BeachDefinition;
  bounds: Bounds;
  coast: Segment[];
  back: Segment[];
  sandEdges: Segment[];
};
const EPS = 1e-7;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function makeSegments(lines: XZ[][]): Segment[] {
  const out: Segment[] = [];
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1],
        dx = line[i][0] - ax,
        dz = line[i][1] - az;
      const length2 = dx * dx + dz * dz;
      if (![ax, az, dx, dz].every(Number.isFinite))
        throw new Error('Non-finite beach geometry');
      if (length2 > EPS * EPS) out.push([ax, az, dx, dz, length2]);
    }
  return out;
}
function segmentDistance2(x: number, z: number, s: Segment): number {
  const t = clamp01(((x - s[0]) * s[2] + (z - s[1]) * s[3]) / s[4]);
  return (x - s[0] - t * s[2]) ** 2 + (z - s[1] - t * s[3]) ** 2;
}
function distance(x: number, z: number, lines: Segment[]): number {
  let best = Infinity;
  for (const s of lines) best = Math.min(best, segmentDistance2(x, z, s));
  return Math.sqrt(best);
}
/** 0 outside, 1 inside, 2 exactly on boundary. Holes retain their topology. */
function ringState(x: number, z: number, ring: XZ[]): 0 | 1 | 2 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0],
      az = ring[j][1],
      bx = ring[i][0],
      bz = ring[i][1];
    const dx = bx - ax,
      dz = bz - az,
      n2 = dx * dx + dz * dz;
    if (n2 > 0 && segmentDistance2(x, z, [ax, az, dx, dz, n2]) < EPS * EPS)
      return 2;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside ? 1 : 0;
}
function contains(x: number, z: number, polygons: MultiPolygon): boolean {
  for (const polygon of polygons) {
    if (!polygon.length || ringState(x, z, polygon[0]) === 0) continue;
    // A hole, including its own boundary, is excluded from the surface.
    if (polygon.slice(1).some((r) => ringState(x, z, r) !== 0)) continue;
    return true;
  }
  return false;
}
function bounds(polygons: MultiPolygon): Bounds {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const [x, z] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(z))
          throw new Error('Non-finite beach polygon');
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
  if (!Number.isFinite(x0)) throw new Error('Empty beach profile');
  return [x0, z0, x1, z1];
}

export class BeachSurfaceIndex {
  readonly seaLevel: number;
  readonly definitions: readonly BeachDefinition[];
  private readonly indexed: Indexed[];
  constructor(data: BeachFixture) {
    if (!Number.isFinite(data.seaLevel))
      throw new Error('Invalid sea display datum');
    this.seaLevel = data.seaLevel;
    this.definitions = data.beaches;
    this.indexed = data.beaches.map((definition) => {
      const { params } = definition;
      for (const key of [
        'maxSubmergedDepth',
        'submergedScaleMetres',
        'wetBandMetres',
        'edgeFeatherMetres',
        'maxSandGrade',
        'toeEaseMetres',
      ] as const) {
        if (!Number.isFinite(params[key]) || params[key] <= 0)
          throw new Error(`Invalid ${key}`);
      }
      const coast = makeSegments(
        definition.coastlines.map((q) => q.coordinates),
      );
      const back = makeSegments(definition.backshoreEdges);
      if (!coast.length || !back.length)
        throw new Error(`Incomplete coastline/backshore for ${definition.id}`);
      return {
        definition,
        bounds: bounds(definition.profilePolygons),
        coast,
        back,
        sandEdges: makeSegments(definition.polygons.flatMap((p) => p)),
      };
    });
  }
  /**
   * rawTerrainY must be the original DEM, BEFORE this beach correction. No
   * Three.js state, hidden cache, time or mutation is used. Two target beaches
   * use cheap AABB rejection then their small precomputed segment arrays.
   */
  sample(x: number, z: number, rawTerrainY: number): BeachSample | undefined {
    if (![x, z, rawTerrainY].every(Number.isFinite)) return undefined;
    for (const item of this.indexed) {
      const [x0, z0, x1, z1] = item.bounds;
      if (x < x0 - EPS || x > x1 + EPS || z < z0 - EPS || z > z1 + EPS)
        continue;
      const b = item.definition;
      if (!contains(x, z, b.profilePolygons)) continue;
      const d = distance(x, z, item.coast);
      const landward = contains(x, z, b.dryPolygons);
      const insideSand = contains(x, z, b.polygons);
      const sandBoundaryDistance = distance(x, z, item.sandEdges);
      let height: number;
      if (landward) {
        const inland = distance(x, z, item.back);
        // Zero slope at MHWS and backshore. The ratio uses local real geometry
        // to accommodate varying beach width instead of a level sand shelf.
        const t = d + inland > EPS ? d / (d + inland) : 0;
        const demProfile =
          this.seaLevel + (rawTerrainY - this.seaLevel) * smooth(t);
        // A coarse coastal DEM includes the park bank and can otherwise make
        // dry sand climb 25–35%. Limit the sandy part to a gentle original
        // profile; recover the DEM smoothly through the non-sandy collar.
        const toe = b.params.toeEaseMetres;
        const rise = b.params.maxSandGrade * (d + toe * Math.expm1(-d / toe));
        const capped = Math.min(demProfile, this.seaLevel + rise);
        const collarT = insideSand
          ? 0
          : sandBoundaryDistance / Math.max(EPS, sandBoundaryDistance + inland);
        height = capped + (demProfile - capped) * smooth(collarT);
      } else {
        const u = d / b.params.submergedScaleMetres;
        // The derivative is zero at d=0 on both sides of the shoreline.
        // expm1 preserves precision for queries centimetres from the coast.
        height =
          this.seaLevel + b.params.maxSubmergedDepth * Math.expm1(-u * u);
      }
      const isLand = landward && d > EPS && height > this.seaLevel;
      return {
        id: b.id,
        height,
        shoreDistance: landward ? d : -d,
        isLand,
        boatBlocked: isLand,
        depth: Math.max(0, this.seaLevel - height),
        sandWeight: insideSand
          ? smooth(sandBoundaryDistance / b.params.edgeFeatherMetres)
          : 0,
        wetness: landward ? 1 - smooth(d / b.params.wetBandMetres) : 1,
      };
    }
    return undefined;
  }
  /** Point depth test only. The production boat must still test its entire
   * capsule and rebuild its shoreline edge index from the same dryPolygons. */
  allowsBoat(
    x: number,
    z: number,
    rawTerrainY: number,
    draft = 0.6,
    clearance = 0.2,
  ): boolean | undefined {
    if (
      ![draft, clearance].every(Number.isFinite) ||
      draft < 0 ||
      clearance < 0
    )
      return false;
    const s = this.sample(x, z, rawTerrainY);
    return s ? !s.boatBlocked && s.depth >= draft + clearance : undefined;
  }
}
