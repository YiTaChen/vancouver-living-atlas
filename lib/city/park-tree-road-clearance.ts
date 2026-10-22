/** Static reconciliation with ordinary asphalt and explicitly tagged Prospect
 * Park Drive decks. Survey data stays untouched; retained candidates keep their
 * exact object identity and XY. Only Stanley Park candidates are considered. */
export type TreeRoadPoint = readonly [number, number];
export type TreeRoadPolygon = readonly (readonly TreeRoadPoint[])[];
export interface RoadTreeCandidate {
  x: number;
  z: number;
  h: number;
  seed: number;
}
export interface TreeRoadSurface {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number> | null;
  /** Interleaved attributes are supported without copying their source data. */
  stride?: number;
  offset?: number;
  vertexCount?: number;
  matrix?: ArrayLike<number>;
  start?: number;
  count?: number;
  asphaltSurface: boolean;
  protectedSurface?: boolean;
  /** Explicit opt-in for the new Prospect Park Drive deck only. Existing
   * Causeway/Lions bridges retain their previous tree policy. */
  parkTreeClearance?: boolean;
}
export interface ExcludedRoadTree {
  candidateIndex: number;
  source: 'municipal' | 'generated';
  sourceIndex: number | null;
  seed: number;
  x: number;
  z: number;
  height: number;
  trunkHalfExtent: number;
  reason:
    | 'stanley-ordinary-asphalt-trunk-overlap'
    | 'stanley-prospect-asphalt-trunk-overlap';
  groundY?: number;
  roadHeightRange?: readonly [number, number];
}
interface Triangle {
  x: [number, number, number];
  z: [number, number, number];
  /** Present only for explicitly tagged protected Park Drive asphalt. */
  y?: [number, number, number];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const CELL = 32;
/** Construction caps fail closed: an incomplete index never hides any tree. */
export const PARK_TREE_ROAD_LIMITS = Object.freeze({
  triangles: 200_000,
  cellReferences: 2_000_000,
  cellsPerTriangle: 16_384,
  maximumTrunkHalfExtent: 4,
});
const EPSILON = 1e-7;
/** Conservative envelope covers ordinary Drive's road offset and roof, as well
 * as Tesla's lower body. This is game collision clearance, not bridge design. */
export const PARK_TREE_DECK_CLEARANCE = Object.freeze({
  belowRoadM: 0.05,
  aboveRoadM: 1.6,
});
interface TreeRoadOverlap {
  kind: 'ordinary' | 'prospect';
  groundY?: number;
  roadHeightRange?: readonly [number, number];
}

/** Exact ring crossing with a static horizontal-edge index. A dense park outline
 * does not require scanning every shoreline vertex for each forest candidate. */
class ScopeRing {
  private minX = Infinity;
  private maxX = -Infinity;
  private minZ = Infinity;
  private maxZ = -Infinity;
  private readonly step: number;
  private readonly buckets: number[][];
  constructor(private readonly ring: readonly TreeRoadPoint[]) {
    for (const [x, z] of ring) {
      this.minX = Math.min(this.minX, x);
      this.maxX = Math.max(this.maxX, x);
      this.minZ = Math.min(this.minZ, z);
      this.maxZ = Math.max(this.maxZ, z);
    }
    this.step = Math.max(64, (this.maxZ - this.minZ) / 128);
    this.buckets = Array.from(
      {
        length: ring.length
          ? Math.floor((this.maxZ - this.minZ) / this.step) + 1
          : 0,
      },
      () => [],
    );
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j];
      if (a[1] === b[1]) continue;
      const low = Math.floor((Math.min(a[1], b[1]) - this.minZ) / this.step),
        high = Math.floor((Math.max(a[1], b[1]) - this.minZ) / this.step);
      for (let k = low; k <= high; k++) this.buckets[k].push(i, j);
    }
  }
  contains(x: number, z: number) {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ)
      return false;
    const edges = this.buckets[Math.floor((z - this.minZ) / this.step)];
    if (!edges) return false;
    let inside = false;
    for (let i = 0; i < edges.length; i += 2) {
      const a = this.ring[edges[i]],
        b = this.ring[edges[i + 1]];
      if (
        a[1] > z !== b[1] > z &&
        x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  }
}
function inScope(
  x: number,
  z: number,
  polygons: readonly (readonly ScopeRing[])[],
) {
  for (const polygon of polygons) {
    if (!polygon[0]?.contains(x, z)) continue;
    let hole = false;
    for (let i = 1; i < polygon.length; i++)
      if (polygon[i].contains(x, z)) {
        hole = true;
        break;
      }
    if (!hole) return true;
  }
  return false;
}
/** The collider uses an axis-aligned trunk box, rather than the canopy radius.
 * The extra 15 cm avoids a visible trunk grazing a moving vehicle at the road
 * edge while retaining canopies that simply overhang the pavement. */
export function roadTreeTrunkHalfExtent(height: number) {
  return Math.max(0.18, height * 0.035) + 0.15;
}

/** Exact 2D triangle / trunk-box SAT. Median holes and finite road endpoints
 * remain holes/endpoints; no centerline ribbon or enclosing road AABB is used. */
function intersects(t: Triangle, x: number, z: number, r: number) {
  if (
    x + r < t.minX - EPSILON ||
    x - r > t.maxX + EPSILON ||
    z + r < t.minZ - EPSILON ||
    z - r > t.maxZ + EPSILON
  )
    return false;
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3,
      nx = t.z[j] - t.z[i],
      nz = t.x[i] - t.x[j],
      a = nx * (t.x[0] - x) + nz * (t.z[0] - z),
      b = nx * (t.x[1] - x) + nz * (t.z[1] - z),
      c = nx * (t.x[2] - x) + nz * (t.z[2] - z),
      extent = r * (Math.abs(nx) + Math.abs(nz)) + EPSILON;
    if (Math.min(a, b, c) > extent || Math.max(a, b, c) < -extent) return false;
  }
  return true;
}

/** Clip the actual 3D road triangle to the trunk's XZ box. Using only a whole
 * sloping triangle's height bounds could hide a tree that actually clears the
 * bridge at its own XY. Four convex cuts give the exact local height range. */
function clippedRoadHeight(t: Triangle, x: number, z: number, r: number) {
  let polygon: number[][] = [0, 1, 2].map((i) => [t.x[i], t.y![i], t.z[i]]);
  for (const [axis, boundary, sign] of [
    [0, x - r - EPSILON, 1],
    [0, x + r + EPSILON, -1],
    [2, z - r - EPSILON, 1],
    [2, z + r + EPSILON, -1],
  ]) {
    const clipped: number[][] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j],
        b = polygon[i],
        da = (a[axis] - boundary) * sign,
        db = (b[axis] - boundary) * sign;
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db);
        clipped.push([
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
        ]);
      }
      if (db >= 0) clipped.push(b);
    }
    if (!clipped.length) return undefined;
    polygon = clipped;
  }
  let low = Infinity,
    high = -Infinity;
  for (const p of polygon) {
    low = Math.min(low, p[1]);
    high = Math.max(high, p[1]);
  }
  return [low, high] as const;
}

class ParkAsphaltIndex {
  readonly triangles: Triangle[] = [];
  readonly cells = new Map<string, number[]>();
  complete = true;
  cellReferences = 0;
  testedTriangles = 0;
  queries = 0;
  heightAwareTriangles = 0;
  heightAwareTests = 0;
  private readonly visited: Uint32Array;
  private stamp = 0;

  constructor(
    surfaces: Iterable<TreeRoadSurface>,
    scope: readonly TreeRoadPolygon[],
  ) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of scope)
      for (const ring of p)
        for (const [x, z] of ring) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
    const pad = PARK_TREE_ROAD_LIMITS.maximumTrunkHalfExtent;
    minX -= pad;
    maxX += pad;
    minZ -= pad;
    maxZ += pad;
    outer: for (const surface of surfaces) {
      if (
        !surface.asphaltSurface ||
        (surface.protectedSurface && !surface.parkTreeClearance)
      )
        continue;
      const heightAware = !!(
        surface.protectedSurface && surface.parkTreeClearance
      );
      const p = surface.positions,
        stride = surface.stride ?? 3,
        offset = surface.offset ?? 0,
        vertexCount = surface.vertexCount ?? Math.floor(p.length / stride),
        index = surface.indices,
        available = index?.length ?? vertexCount,
        first = Math.max(0, Math.trunc(surface.start ?? 0)),
        count = surface.count ?? Infinity,
        end = Math.min(available, first + Math.max(0, count));
      const point = (id: number) => {
        const i = id * stride + offset,
          x = p[i],
          y = p[i + 1],
          z = p[i + 2],
          m = surface.matrix;
        return m
          ? [
              m[0] * x + m[4] * y + m[8] * z + m[12],
              m[2] * x + m[6] * y + m[10] * z + m[14],
              m[1] * x + m[5] * y + m[9] * z + m[13],
            ]
          : [x, z, y];
      };
      for (let i = first; i + 2 < end; i += 3) {
        const ids = index
          ? [index[i], index[i + 1], index[i + 2]]
          : [i, i + 1, i + 2];
        if (
          ids.some((id) => !Number.isInteger(id) || id < 0 || id >= vertexCount)
        )
          continue;
        const a = point(ids[0]),
          b = point(ids[1]),
          c = point(ids[2]);
        if (![...a, ...b, ...c].every(Number.isFinite)) continue;
        const area =
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(area) <= EPSILON) continue;
        const t: Triangle = {
          x: [a[0], b[0], c[0]],
          z: [a[1], b[1], c[1]],
          ...(heightAware
            ? { y: [a[2], b[2], c[2]] as [number, number, number] }
            : {}),
          minX: Math.min(a[0], b[0], c[0]),
          maxX: Math.max(a[0], b[0], c[0]),
          minZ: Math.min(a[1], b[1], c[1]),
          maxZ: Math.max(a[1], b[1], c[1]),
        };
        if (t.maxX < minX || t.minX > maxX || t.maxZ < minZ || t.minZ > maxZ)
          continue;
        const x0 = Math.floor(Math.max(t.minX, minX) / CELL),
          x1 = Math.floor(Math.min(t.maxX, maxX) / CELL),
          z0 = Math.floor(Math.max(t.minZ, minZ) / CELL),
          z1 = Math.floor(Math.min(t.maxZ, maxZ) / CELL),
          refs = (x1 - x0 + 1) * (z1 - z0 + 1);
        if (
          this.triangles.length >= PARK_TREE_ROAD_LIMITS.triangles ||
          refs > PARK_TREE_ROAD_LIMITS.cellsPerTriangle ||
          this.cellReferences + refs > PARK_TREE_ROAD_LIMITS.cellReferences
        ) {
          this.complete = false;
          break outer;
        }
        const id = this.triangles.length;
        this.triangles.push(t);
        if (heightAware) this.heightAwareTriangles++;
        this.cellReferences += refs;
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const key = `${x},${z}`;
            const cell = this.cells.get(key);
            if (cell) cell.push(id);
            else this.cells.set(key, [id]);
          }
      }
    }
    this.visited = new Uint32Array(this.triangles.length);
  }

  overlaps(
    tree: RoadTreeCandidate,
    r: number,
    groundHeight?: (x: number, z: number) => number,
  ): TreeRoadOverlap | undefined {
    if (!this.complete) return undefined;
    const { x, z } = tree;
    let groundY: number | undefined;
    this.queries++;
    if (++this.stamp >= 0xffff_ffff) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    for (
      let ix = Math.floor((x - r) / CELL);
      ix <= Math.floor((x + r) / CELL);
      ix++
    )
      for (
        let iz = Math.floor((z - r) / CELL);
        iz <= Math.floor((z + r) / CELL);
        iz++
      ) {
        const cell = this.cells.get(`${ix},${iz}`);
        if (!cell) continue;
        for (const id of cell) {
          if (this.visited[id] === this.stamp) continue;
          this.visited[id] = this.stamp;
          this.testedTriangles++;
          const triangle = this.triangles[id];
          if (!intersects(triangle, x, z, r)) continue;
          if (!triangle.y) return { kind: 'ordinary' };
          this.heightAwareTests++;
          groundY ??= groundHeight?.(x, z);
          // Unknown ground elevation must never erase a below-deck tree.
          if (groundY === undefined || !Number.isFinite(groundY)) continue;
          const road = clippedRoadHeight(triangle, x, z, r);
          if (
            road &&
            groundY + tree.h >= road[0] - PARK_TREE_DECK_CLEARANCE.belowRoadM &&
            groundY <= road[1] + PARK_TREE_DECK_CLEARANCE.aboveRoadM
          )
            return { kind: 'prospect', groundY, roadHeightRange: road };
        }
      }
    return undefined;
  }
}

/** Run once before either far/near tree visuals or colliders are registered.
 * The returned diagnostic contains no scene/geometry references. */
export function clearParkAsphaltTrees<T extends RoadTreeCandidate>(
  candidates: readonly T[],
  surfaces: Iterable<TreeRoadSurface>,
  stanleyPolygons: readonly TreeRoadPolygon[],
  municipalSourceCount = 0,
  groundHeight?: (x: number, z: number) => number,
) {
  const index = new ParkAsphaltIndex(surfaces, stanleyPolygons),
    scopes = stanleyPolygons.map((p) => p.map((r) => new ScopeRing(r))),
    retained: T[] = [],
    excluded: ExcludedRoadTree[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const tree = candidates[i],
      r = roadTreeTrunkHalfExtent(tree.h);
    const overlap =
      Number.isFinite(r) &&
      r <= PARK_TREE_ROAD_LIMITS.maximumTrunkHalfExtent &&
      inScope(tree.x, tree.z, scopes)
        ? index.overlaps(tree, r, groundHeight)
        : undefined;
    if (!overlap) {
      retained.push(tree);
      continue;
    }
    const municipal =
      Number.isInteger(tree.seed) &&
      tree.seed >= 0 &&
      tree.seed < municipalSourceCount;
    excluded.push({
      candidateIndex: i,
      source: municipal ? 'municipal' : 'generated',
      sourceIndex: municipal ? tree.seed : null,
      seed: tree.seed,
      x: tree.x,
      z: tree.z,
      height: tree.h,
      trunkHalfExtent: r,
      reason:
        overlap.kind === 'prospect'
          ? 'stanley-prospect-asphalt-trunk-overlap'
          : 'stanley-ordinary-asphalt-trunk-overlap',
      ...(overlap.kind === 'prospect'
        ? { groundY: overlap.groundY, roadHeightRange: overlap.roadHeightRange }
        : {}),
    });
  }
  return {
    retained,
    excluded,
    stats: {
      complete: index.complete,
      candidates: candidates.length,
      retained: retained.length,
      excluded: excluded.length,
      municipalExcluded: excluded.filter((t) => t.source === 'municipal')
        .length,
      generatedExcluded: excluded.filter((t) => t.source === 'generated')
        .length,
      triangles: index.triangles.length,
      heightAwareTriangles: index.heightAwareTriangles,
      heightAwareTests: index.heightAwareTests,
      prospectExcluded: excluded.filter(
        (t) => t.reason === 'stanley-prospect-asphalt-trunk-overlap',
      ).length,
      cells: index.cells.size,
      cellReferences: index.cellReferences,
      queries: index.queries,
      testedTriangles: index.testedTriangles,
    },
  };
}
