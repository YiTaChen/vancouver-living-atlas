/** Original MIT geometry. Local terrain visibility reconciliation, in metres.
 * All inputs are final, non-indexed, world-space triangles. No DEM resampling,
 * source line movement, pavement height change, upper-floor or terrain fill.
 */
export type Point = readonly [number, number];
export type Bounds = readonly [number, number, number, number];
export interface VertexAttribute {
  array: ArrayLike<number>;
  itemSize: number;
}
export interface TerrainInput {
  positions: ArrayLike<number>;
  attributes?: Record<string, VertexAttribute>;
  /** Half-open final triangle ranges (e.g. Stage 5 physical beach profile). */
  protectedTriangleRanges?: readonly (readonly [number, number])[];
}
export interface GroundCover {
  id: string;
  kind: 'asphalt' | 'sidewalk' | 'path' | 'shore';
  positions: ArrayLike<number>;
  /** Explicit physical floor, in addition to the renderer's protection flag. */
  level: 'ground' | 'upper';
  protectedSurface?: boolean;
}
export interface VisibilityOptions {
  /** Mandatory local scope; minX,minZ,maxX,maxZ, never the entire city. */
  bounds: Bounds;
  /** Optional disjoint local regions within bounds; gaps stay untouched. */
  regions?: readonly Bounds[];
  /** Clip terrain which reaches to this distance below a ground top. */
  clearanceM?: number;
}
export interface VisibilityResult {
  positions: number[];
  attributes: Record<string, { array: number[]; itemSize: number }>;
  /** Original triangle numbers, not Stage 5's preconstruction replacement keys. */
  changedTriangles: number[];
  statistics: {
    inputTriangles: number;
    outputTriangles: number;
    indexedGroundTriangles: number;
    protectedCoversSkipped: number;
    candidateTerrainTriangles: number;
    changedTerrainTriangles: number;
    removedPlanAreaM2: number;
    maxOriginalTriangleAreaErrorM2: number;
    maximumRemovedTerrainExcessM: number;
    sources: Record<
      string,
      { removedPlanAreaM2: number; interactions: number }
    >;
  };
}
export interface Triangle {
  points: Point[];
  bounds: Bounds;
  y: number[];
  determinant: number;
}
interface Cutter extends Triangle {
  id: string;
  polygon: Point[];
}
const AREA_EPS = 1e-10;
const LENGTH_EPS = 1e-9;
const CELL = 32;
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const overlaps = (a: Bounds, b: Bounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const boundsOf = (p: Point[]): Bounds => [
  Math.min(...p.map((q) => q[0])),
  Math.min(...p.map((q) => q[1])),
  Math.max(...p.map((q) => q[0])),
  Math.max(...p.map((q) => q[1])),
];
const signedArea = (p: Point[]) => {
  let sum = 0;
  for (let i = 1; i + 1 < p.length; i++) sum += cross(p[0], p[i], p[i + 1]);
  return sum / 2;
};
const area = (p: Point[]) => Math.abs(signedArea(p));
function clean(p: Point[]): Point[] {
  const out: Point[] = [];
  for (const q of p) {
    const prior = out[out.length - 1];
    if (!prior || Math.hypot(prior[0] - q[0], prior[1] - q[1]) > LENGTH_EPS)
      out.push(q);
  }
  if (
    out.length > 1 &&
    Math.hypot(out[0][0] - out.at(-1)![0], out[0][1] - out.at(-1)![1]) <=
      LENGTH_EPS
  )
    out.pop();
  return out.length >= 3 && area(out) > AREA_EPS ? out : [];
}
/** Both sides share the same exact computed intersection point. */
function split(
  poly: Point[],
  distance: (p: Point) => number,
): [Point[], Point[]] {
  const inside: Point[] = [],
    outside: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = distance(a),
      db = distance(b);
    if (da >= 0) inside.push(a);
    if (da <= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const q: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      inside.push(q);
      outside.push(q);
    }
  }
  return [clean(inside), clean(outside)];
}
function intersect(poly: Point[], clip: Point[]): Point[] {
  let inside = poly;
  const sign = Math.sign(signedArea(clip));
  for (let i = 0; i < clip.length && inside.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length];
    [inside] = split(inside, (p) => sign * cross(a, b, p));
  }
  return inside;
}
/** A convex polygon minus a convex clip. The returned pieces remain convex. */
function subtract(poly: Point[], clip: Point[]): Point[][] {
  if (!intersect(poly, clip).length) return [poly];
  let inside = poly;
  const kept: Point[][] = [],
    sign = Math.sign(signedArea(clip));
  for (let i = 0; i < clip.length && inside.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length];
    const [next, outside] = split(inside, (p) => sign * cross(a, b, p));
    if (outside.length) kept.push(outside);
    inside = next;
  }
  return kept;
}
function triangle(
  flat: ArrayLike<number>,
  offset: number,
): Triangle | undefined {
  const points: Point[] = [0, 3, 6].map((i) => [
    flat[offset + i],
    flat[offset + i + 2],
  ]);
  const y = [flat[offset + 1], flat[offset + 4], flat[offset + 7]];
  if (![...points.flat(), ...y].every(Number.isFinite))
    throw new Error('Non-finite surface vertex');
  const determinant = cross(points[0], points[1], points[2]);
  if (Math.abs(determinant) <= AREA_EPS * 2) return undefined;
  return { points, y, determinant, bounds: boundsOf(points) };
}
function weights(t: Triangle, p: Point): [number, number, number] {
  const u = cross(t.points[0], p, t.points[2]) / t.determinant;
  const v = cross(t.points[0], t.points[1], p) / t.determinant;
  return [1 - u - v, u, v];
}
const height = (t: Triangle, p: Point) =>
  weights(t, p).reduce((n, w, i) => n + w * t.y[i], 0);
function rectangle(b: Bounds): Point[] {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}
function validateBounds(b: Bounds) {
  if (!b.every(Number.isFinite) || b[2] <= b[0] || b[3] <= b[1])
    throw new Error('Invalid local bounds');
}
function cells(b: Bounds, fn: (key: string) => void) {
  for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x++)
    for (let z = Math.floor(b[1] / CELL); z <= Math.floor(b[3] / CELL); z++)
      fn(`${x},${z}`);
}

/** Remove only the occluding part of original terrain inside actual ground
 * pavement footprints AND local bounds. Every retained vertex stays on its
 * original terrain triangle's plane. Every supplied pavement array is read-only.
 * Protected/upper decks never act as cutters. Spatial cells accelerate queries;
 * all actual cuts use exact triangle and height half-plane intersections.
 */
export function reconcileGroundVisibility(
  terrain: TerrainInput,
  covers: readonly GroundCover[],
  options: VisibilityOptions,
): VisibilityResult {
  validateBounds(options.bounds);
  const clearance = options.clearanceM ?? 0.02;
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 0.1)
    throw new Error('Invalid visibility clearance');
  if (terrain.positions.length % 9)
    throw new Error('Terrain must contain complete non-indexed triangles');
  const attributes: VisibilityResult['attributes'] = {};
  for (const [name, attribute] of Object.entries(terrain.attributes ?? {})) {
    if (
      !Number.isInteger(attribute.itemSize) ||
      attribute.itemSize <= 0 ||
      attribute.array.length !==
        (terrain.positions.length / 3) * attribute.itemSize
    )
      throw new Error(`Invalid terrain attribute ${name}`);
    attributes[name] = { array: [], itemSize: attribute.itemSize };
  }
  const statistics: VisibilityResult['statistics'] = {
    inputTriangles: terrain.positions.length / 9,
    outputTriangles: 0,
    indexedGroundTriangles: 0,
    protectedCoversSkipped: 0,
    candidateTerrainTriangles: 0,
    changedTerrainTriangles: 0,
    removedPlanAreaM2: 0,
    maxOriginalTriangleAreaErrorM2: 0,
    maximumRemovedTerrainExcessM: 0,
    sources: {},
  };
  const grid = new Map<string, Cutter[]>(),
    regions = options.regions ?? [options.bounds];
  for (const b of regions) {
    validateBounds(b);
    if (
      b[0] < options.bounds[0] ||
      b[1] < options.bounds[1] ||
      b[2] > options.bounds[2] ||
      b[3] > options.bounds[3]
    )
      throw new Error('A local region lies outside the scope bounds');
  }
  for (const cover of covers) {
    if (cover.protectedSurface || cover.level !== 'ground') {
      statistics.protectedCoversSkipped++;
      continue;
    }
    if (!['asphalt', 'sidewalk', 'path', 'shore'].includes(cover.kind))
      throw new Error('Unclassified ground cover');
    if (cover.positions.length % 9)
      throw new Error(`Incomplete cover ${cover.id}`);
    for (let i = 0; i < cover.positions.length; i += 9) {
      // Cheap bounds before allocating objects for the rest of the city.
      const f = cover.positions;
      const bb: Bounds = [
        Math.min(f[i], f[i + 3], f[i + 6]),
        Math.min(f[i + 2], f[i + 5], f[i + 8]),
        Math.max(f[i], f[i + 3], f[i + 6]),
        Math.max(f[i + 2], f[i + 5], f[i + 8]),
      ];
      if (!overlaps(bb, options.bounds)) continue;
      const t = triangle(f, i);
      if (!t) continue;
      for (const region of regions) {
        if (!overlaps(t.bounds, region)) continue;
        const polygon = intersect(t.points, rectangle(region));
        if (!polygon.length) continue;
        const cutter: Cutter = {
          ...t,
          polygon,
          id: cover.id,
          bounds: boundsOf(polygon),
        };
        cells(cutter.bounds, (key) => {
          const cell = grid.get(key) ?? [];
          cell.push(cutter);
          grid.set(key, cell);
        });
        statistics.indexedGroundTriangles++;
      }
    }
  }
  const positions: number[] = [],
    changedTriangles: number[] = [];
  const copyOriginal = (i: number) => {
    for (let j = 0; j < 9; j++) positions.push(terrain.positions[i + j]);
    for (const [name, attribute] of Object.entries(terrain.attributes ?? {})) {
      const first = (i / 3) * attribute.itemSize;
      for (let j = 0; j < 3 * attribute.itemSize; j++)
        attributes[name].array.push(attribute.array[first + j]);
    }
  };
  const addVertex = (p: Point, t: Triangle, i: number) => {
    const w = weights(t, p);
    positions.push(
      p[0],
      w.reduce((n, v, k) => n + v * t.y[k], 0),
      p[1],
    );
    for (const [name, attribute] of Object.entries(terrain.attributes ?? {})) {
      const first = (i / 3) * attribute.itemSize;
      for (let j = 0; j < attribute.itemSize; j++)
        attributes[name].array.push(
          w.reduce(
            (n, v, k) =>
              n + v * attribute.array[first + k * attribute.itemSize + j],
            0,
          ),
        );
    }
  };
  for (let i = 0; i < terrain.positions.length; i += 9) {
    if (
      terrain.protectedTriangleRanges?.some(
        (r) => i / 9 >= r[0] && i / 9 < r[1],
      )
    ) {
      copyOriginal(i);
      continue;
    }
    const f = terrain.positions;
    const bb: Bounds = [
      Math.min(f[i], f[i + 3], f[i + 6]),
      Math.min(f[i + 2], f[i + 5], f[i + 8]),
      Math.max(f[i], f[i + 3], f[i + 6]),
      Math.max(f[i + 2], f[i + 5], f[i + 8]),
    ];
    if (!overlaps(bb, options.bounds)) {
      copyOriginal(i);
      continue;
    }
    const candidates = new Set<Cutter>();
    // Clip cell range as well: a coarse triangle can span far beyond the task.
    cells(
      [
        Math.max(bb[0], options.bounds[0]),
        Math.max(bb[1], options.bounds[1]),
        Math.min(bb[2], options.bounds[2]),
        Math.min(bb[3], options.bounds[3]),
      ],
      (key) => {
        for (const cutter of grid.get(key) ?? [])
          if (overlaps(bb, cutter.bounds)) candidates.add(cutter);
      },
    );
    if (!candidates.size) {
      copyOriginal(i);
      continue;
    }
    const original = triangle(f, i);
    if (!original) {
      copyOriginal(i);
      continue;
    }
    statistics.candidateTerrainTriangles++;
    let pieces = [original.points],
      removed = 0;
    for (const cutter of candidates) {
      // Their height difference is affine: clipping this half-plane finds all
      // the interference, including crossings that corner probes would miss.
      let clip = intersect(original.points, cutter.polygon);
      if (!clip.length) continue;
      [clip] = split(
        clip,
        (p) => height(original, p) - height(cutter, p) + clearance,
      );
      if (!clip.length) continue;
      const next: Point[][] = [];
      let interactionArea = 0;
      for (const piece of pieces) {
        const overlap = intersect(piece, clip);
        if (!overlap.length) {
          next.push(piece);
          continue;
        }
        interactionArea += area(overlap);
        for (const p of overlap)
          statistics.maximumRemovedTerrainExcessM = Math.max(
            statistics.maximumRemovedTerrainExcessM,
            height(original, p) - height(cutter, p),
          );
        next.push(...subtract(piece, clip));
      }
      pieces = next;
      if (interactionArea > 0) {
        const source = statistics.sources[cutter.id] ?? {
          removedPlanAreaM2: 0,
          interactions: 0,
        };
        source.removedPlanAreaM2 += interactionArea;
        source.interactions++;
        statistics.sources[cutter.id] = source;
        removed += interactionArea;
      }
      if (!pieces.length) break;
    }
    if (removed <= AREA_EPS) {
      copyOriginal(i);
      continue;
    }
    changedTriangles.push(i / 9);
    statistics.removedPlanAreaM2 += removed;
    let keptArea = 0;
    for (const polygon of pieces) {
      // Difference pieces retain original winding, but normalize defensively.
      if (Math.sign(signedArea(polygon)) !== Math.sign(original.determinant))
        polygon.reverse();
      for (let j = 1; j + 1 < polygon.length; j++) {
        const tri = [polygon[0], polygon[j], polygon[j + 1]],
          a = area(tri);
        if (a <= AREA_EPS) continue;
        keptArea += a;
        for (const p of tri) addVertex(p, original, i);
      }
    }
    statistics.maxOriginalTriangleAreaErrorM2 = Math.max(
      statistics.maxOriginalTriangleAreaErrorM2,
      Math.abs(Math.abs(original.determinant) / 2 - keptArea - removed),
    );
  }
  statistics.changedTerrainTriangles = changedTriangles.length;
  statistics.outputTriangles = positions.length / 9;
  return { positions, attributes, changedTriangles, statistics };
}

/** Audit helper: exact overlap vertices determine the extrema of two affine
 * heights. Positive delta means the first surface is physically higher. Does
 * not remove a City road, move an OSM path, or choose a new navigation datum.
 */
export function compareGroundHeights(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
  scope: Bounds,
) {
  validateBounds(scope);
  let areaM2 = 0,
    minimumDeltaM = Infinity,
    maximumDeltaM = -Infinity;
  let minimumPoint: Point | undefined, maximumPoint: Point | undefined;
  const local = rectangle(scope),
    grid = new Map<string, Triangle[]>();
  for (let i = 0; i < second.length; i += 9) {
    const t = triangle(second, i);
    if (!t || !overlaps(t.bounds, scope)) continue;
    cells(t.bounds, (key) => {
      const cell = grid.get(key) ?? [];
      cell.push(t);
      grid.set(key, cell);
    });
  }
  for (let i = 0; i < first.length; i += 9) {
    const t = triangle(first, i);
    if (!t || !overlaps(t.bounds, scope)) continue;
    const candidates = new Set<Triangle>();
    cells(t.bounds, (key) => {
      for (const q of grid.get(key) ?? [])
        if (overlaps(t.bounds, q.bounds)) candidates.add(q);
    });
    for (const q of candidates) {
      const p = intersect(intersect(t.points, q.points), local);
      if (!p.length) continue;
      areaM2 += area(p);
      for (const v of p) {
        const d = height(t, v) - height(q, v);
        if (d < minimumDeltaM) {
          minimumDeltaM = d;
          minimumPoint = v;
        }
        if (d > maximumDeltaM) {
          maximumDeltaM = d;
          maximumPoint = v;
        }
      }
    }
  }
  return {
    areaM2,
    minimumDeltaM: areaM2 ? minimumDeltaM : null,
    maximumDeltaM: areaM2 ? maximumDeltaM : null,
    minimumPoint,
    maximumPoint,
  };
}

/** Shared internal planar primitives for the adjoining, bounded road repair. */
export const visibilityGeometry = {
  cross,
  overlaps,
  boundsOf,
  area,
  signedArea,
  split,
  intersect,
  subtract,
  triangle,
  height,
  weights,
  rectangle,
  validateBounds,
};
