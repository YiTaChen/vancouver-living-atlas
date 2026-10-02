import {
  visibilityGeometry as g,
  type Bounds,
  type Point,
  type Triangle,
} from './ground-visibility';

export const RESIDENTIAL_GROUND_LIMITS = {
  plots: 500,
  cellM: 160,
  showDistanceM: 650,
  wallGapM: 0.18,
  depthM: 0.88,
  entryHalfGapM: 1.45,
  maxBedLengthM: 4.6,
  maxBedTriangles: 24,
  surfaceOffsetM: 0.012,
} as const;

/** A small exact-footprint broad phase. The grid never decides clearance. */
export class ResidentialSpatialIndex<T extends { bounds: Bounds }> {
  private cells = new Map<string, T[]>();
  constructor(
    items: readonly T[],
    private cell = 32,
  ) {
    for (const item of items)
      this.visit(item.bounds, (key) => {
        const list = this.cells.get(key) ?? [];
        list.push(item);
        this.cells.set(key, list);
      });
  }
  private visit(bounds: Bounds, apply: (key: string) => void) {
    for (
      let x = Math.floor(bounds[0] / this.cell);
      x <= Math.floor(bounds[2] / this.cell);
      x++
    )
      for (
        let z = Math.floor(bounds[1] / this.cell);
        z <= Math.floor(bounds[3] / this.cell);
        z++
      )
        apply(`${x},${z}`);
  }
  query(bounds: Bounds): T[] {
    const found = new Set<T>();
    this.visit(bounds, (key) => {
      for (const item of this.cells.get(key) ?? [])
        if (g.overlaps(item.bounds, bounds)) found.add(item);
    });
    return [...found];
  }
}

function inside(p: Point, polygon: readonly Point[]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
function segmentTouches(a: Point, b: Point, c: Point, d: Point) {
  const epsilon = 1e-8;
  const abC = g.cross(a, b, c),
    abD = g.cross(a, b, d),
    cdA = g.cross(c, d, a),
    cdB = g.cross(c, d, b);
  if (
    ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
    ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
  )
    return true;
  const on = (p: Point, u: Point, v: Point, cross: number) =>
    Math.abs(cross) <= epsilon &&
    p[0] >= Math.min(u[0], v[0]) - epsilon &&
    p[0] <= Math.max(u[0], v[0]) + epsilon &&
    p[1] >= Math.min(u[1], v[1]) - epsilon &&
    p[1] <= Math.max(u[1], v[1]) + epsilon;
  return (
    on(c, a, b, abC) || on(d, a, b, abD) || on(a, c, d, cdA) || on(b, c, d, cdB)
  );
}
/** Includes edge-only crossings and containment; vertex sampling alone misses both. */
export function residentialOverlap(
  a: readonly Point[],
  b: readonly Point[],
): boolean {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (
        segmentTouches(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
      )
        return true;
  return false;
}

/** One pair of representative beds, always outside a CCW source facade. The
 * broad central gap is retained on every candidate edge, including door edges. */
export function residentialBeds(
  a: Point,
  b: Point,
  entryU?: number,
): Point[][] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!Number.isFinite(length) || length < 7 || length > 26) return [];
  const dx = (b[0] - a[0]) / length,
    dz = (b[1] - a[1]) / length;
  const at = (u: number, v: number): Point => [
    a[0] + dx * u + dz * v,
    a[1] + dz * u - dx * v,
  ];
  const half = RESIDENTIAL_GROUND_LIMITS.entryHalfGapM;
  const entry = entryU ?? length / 2;
  if (!Number.isFinite(entry) || entry < 0 || entry > length) return [];
  const spans = [
    [
      Math.max(0.65, entry - half - RESIDENTIAL_GROUND_LIMITS.maxBedLengthM),
      entry - half,
    ],
    [
      entry + half,
      Math.min(
        length - 0.65,
        entry + half + RESIDENTIAL_GROUND_LIMITS.maxBedLengthM,
      ),
    ],
  ];
  return spans
    .filter(([u, v]) => v - u >= 1.35)
    .map(([u, v]) => {
      const near = RESIDENTIAL_GROUND_LIMITS.wallGapM,
        far = near + RESIDENTIAL_GROUND_LIMITS.depthM,
        corner = 0.15;
      return [
        at(u + corner, near),
        at(v - corner, near),
        at(v, near + corner),
        at(v, far - corner),
        at(v - corner, far),
        at(u + corner, far),
        at(u, far - corner),
        at(u, near + corner),
      ];
    });
}

/** Exact clipping at the terrain's triangle boundaries. A corner-only drape
 * would bridge or bury a planting bed across a hill's interpolation diagonal. */
export function drapeResidentialBed(
  polygon: Point[],
  terrain: ResidentialSpatialIndex<Triangle>,
  anchorY: number,
) {
  const positions: number[] = [];
  let covered = 0,
    low = Infinity,
    high = -Infinity;
  for (const triangle of terrain.query(g.boundsOf(polygon))) {
    const clipped = g.intersect(polygon, triangle.points);
    if (!clipped.length) continue;
    const heights = clipped.map((p) => g.height(triangle, p));
    if (
      heights.some((y) => !Number.isFinite(y) || Math.abs(y - anchorY) > 0.45)
    )
      return null;
    low = Math.min(low, ...heights);
    high = Math.max(high, ...heights);
    covered += g.area(clipped);
    if (g.signedArea(clipped) > 0) clipped.reverse();
    for (let i = 1; i + 1 < clipped.length; i++)
      for (const p of [clipped[0], clipped[i], clipped[i + 1]])
        positions.push(
          p[0],
          g.height(triangle, p) + RESIDENTIAL_GROUND_LIMITS.surfaceOffsetM,
          p[1],
        );
  }
  const area = g.area(polygon);
  if (
    !positions.length ||
    positions.length / 9 > RESIDENTIAL_GROUND_LIMITS.maxBedTriangles ||
    high - low > 0.5 ||
    Math.abs(covered - area) > Math.max(1e-5, area * 1e-5)
  )
    return null;
  return positions;
}
