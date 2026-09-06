/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) pure 2D pavement prototype. Coordinates use the RoadGraph's local metres. */
import type { Point, RoadEdge, RoadGraph } from './road-graph';

export interface Polygon2D {
  points: Point[];
  level: string;
  kind: 'road' | 'junction' | 'sidewalk';
}
export interface IndexedTriangles2D {
  vertices: Point[];
  /** Corresponds to vertices; do not weld different topology levels in a height pass. */
  levels: string[];
  indices: number[];
}
export interface CurbSegment {
  a: Point;
  b: Point;
  level: string;
}
export interface PavementOptions {
  /** Reviewed replacement footprints; remove old asphalt, paint support and curbs together. Convex rings. */
  exclusions?: { points: Point[]; level: string }[];
  /** Connected curb extensions; subtract their footprints from road surfaces. */
  sidewalkExtensions?: { points: Point[]; level: string }[];
  sidewalkWidth?: (edge: RoadEdge) => number;
  gridMeters?: number;
  maxPiecesPerCandidate?: number;
  maxVertices?: number;
  maxTriangles?: number;
  maxCurbSegments?: number;
  maxCurbLength?: number;
}
export interface PavementResult {
  asphalt: IndexedTriangles2D;
  sidewalks: IndexedTriangles2D;
  curbs: CurbSegment[];
  /** Useful for pure geometry validation/debug overlays; rendering uses indexed triangles. */
  asphaltPolygons: Polygon2D[];
  sidewalkPolygons: Polygon2D[];
  junctionPatches: Polygon2D[];
  stats: {
    roadMasks: number;
    sidewalkCandidates: number;
    asphaltFragments: number;
    sidewalkFragments: number;
    candidateSubtractions: number;
  };
}
const EPS = 1e-8,
  MIN_AREA = 1e-5;
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Point, n: number): Point => [a[0] * n, a[1] * n];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a: Point, b: Point, t: number) => add(a, mul(sub(b, a), t));
const pointKey = (p: Point) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const area = (p: readonly Point[]) =>
  p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]), 0) / 2;

function clean(input: readonly Point[]): Point[] {
  let p = input.filter((q, i) => i === 0 || dist(q, input[i - 1]) > EPS);
  if (p.length > 1 && dist(p[0], p.at(-1)!) < EPS) p.pop();
  if (p.length < 3 || Math.abs(area(p)) < MIN_AREA) return [];
  // Retain collinear cut vertices: later curb classification may need their stations.
  if (area(p) < 0) p = p.reverse();
  return p;
}
function hull(input: readonly Point[]): Point[] {
  const points = [...new Map(input.map((p) => [pointKey(p), p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (points.length < 3) return [];
  const half = (ps: Point[]) => {
    const result: Point[] = [];
    for (const p of ps) {
      while (
        result.length > 1 &&
        cross(sub(result.at(-1)!, result.at(-2)!), sub(p, result.at(-1)!)) <=
          EPS
      )
        result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return clean([...half(points), ...half([...points].reverse())]);
}
function halfPlane(
  polygon: readonly Point[],
  a: Point,
  b: Point,
  inside: boolean,
): Point[] {
  const result: Point[] = [],
    edge = sub(b, a),
    sign = inside ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length];
    const dp = sign * cross(edge, sub(p, a)),
      dq = sign * cross(edge, sub(q, a));
    const pin = dp >= -EPS,
      qin = dq >= -EPS;
    if (pin) result.push(p);
    if (pin !== qin && Math.abs(dp - dq) > EPS)
      result.push(lerp(p, q, Math.max(0, Math.min(1, dp / (dp - dq)))));
  }
  return clean(result);
}
/** Disjoint convex pieces of subject minus convex cutter; no triangulation/CSG dependency. */
function subtract(subject: Point[], cutter: Point[]): Point[][] {
  let inside = subject;
  const outside: Point[][] = [];
  for (let i = 0; i < cutter.length && inside.length; i++) {
    const a = cutter[i],
      b = cutter[(i + 1) % cutter.length];
    const piece = halfPlane(inside, a, b, false);
    if (piece.length) outside.push(piece);
    inside = halfPlane(inside, a, b, true);
  }
  return outside;
}
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
function bounds(p: readonly Point[], pad = 0): Bounds {
  return {
    minX: Math.min(...p.map((p) => p[0])) - pad,
    minY: Math.min(...p.map((p) => p[1])) - pad,
    maxX: Math.max(...p.map((p) => p[0])) + pad,
    maxY: Math.max(...p.map((p) => p[1])) + pad,
  };
}
function overlaps(a: Bounds, b: Bounds) {
  return (
    a.maxX >= b.minX - EPS &&
    a.minX <= b.maxX + EPS &&
    a.maxY >= b.minY - EPS &&
    a.minY <= b.maxY + EPS
  );
}
class PolygonIndex {
  polygons: Polygon2D[] = [];
  bounds: Bounds[] = [];
  buckets = new Map<string, number[]>();
  cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  keys(level: string, box: Bounds): string[] {
    const loX = Math.floor(box.minX / this.cell),
      hiX = Math.floor(box.maxX / this.cell);
    const loY = Math.floor(box.minY / this.cell),
      hiY = Math.floor(box.maxY / this.cell);
    if ((hiX - loX + 1) * (hiY - loY + 1) > 100000)
      throw new Error('Pavement exceeds safe spatial grid extent');
    const result = [];
    for (let x = loX; x <= hiX; x++)
      for (let y = loY; y <= hiY; y++) result.push(`${level}:${x},${y}`);
    return result;
  }
  add(p: Polygon2D) {
    const id = this.polygons.length,
      b = bounds(p.points);
    this.polygons.push(p);
    this.bounds.push(b);
    for (const key of this.keys(p.level, b)) {
      const ids = this.buckets.get(key) ?? [];
      ids.push(id);
      this.buckets.set(key, ids);
    }
  }
  query(level: string, box: Bounds): Polygon2D[] {
    const ids = new Set<number>();
    for (const key of this.keys(level, box))
      for (const id of this.buckets.get(key) ?? [])
        if (overlaps(this.bounds[id], box)) ids.add(id);
    return [...ids].map((id) => this.polygons[id]);
  }
  contains(level: string, p: Point): boolean {
    return this.query(level, bounds([p])).some((poly) =>
      poly.points.every(
        (a, i) =>
          cross(sub(poly.points[(i + 1) % poly.points.length], a), sub(p, a)) >=
          -EPS,
      ),
    );
  }
}
function strip(a: Point, b: Point, lo: number, hi: number): Point[] {
  const d = sub(b, a),
    len = Math.hypot(...d);
  if (len < EPS || hi - lo < EPS) return [];
  const n: Point = [-d[1] / len, d[0] / len];
  return clean([
    add(a, mul(n, lo)),
    add(b, mul(n, lo)),
    add(b, mul(n, hi)),
    add(a, mul(n, hi)),
  ]);
}
function triangulate(
  polys: Polygon2D[],
  maxVertices: number,
  maxTriangles: number,
): IndexedTriangles2D {
  const mesh: IndexedTriangles2D = { vertices: [], levels: [], indices: [] },
    ids = new Map<string, number>();
  const vertex = (p: Point, level: string) => {
    const key = `${level}:${pointKey(p)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = mesh.vertices.length;
      ids.set(key, id);
      mesh.vertices.push(p);
      mesh.levels.push(level);
      if (mesh.vertices.length > maxVertices)
        throw new Error('Pavement vertex budget exceeded');
    }
    return id;
  };
  for (const p of polys) {
    for (let i = 1; i < p.points.length - 1; i++) {
      if (
        Math.abs(
          cross(
            sub(p.points[i], p.points[0]),
            sub(p.points[i + 1], p.points[0]),
          ),
        ) <
        MIN_AREA * 2
      )
        continue;
      const a = vertex(p.points[0], p.level),
        b = vertex(p.points[i], p.level),
        c = vertex(p.points[i + 1], p.level);
      if (a === b || b === c || a === c) continue;
      mesh.indices.push(a, b, c);
      if (mesh.indices.length / 3 > maxTriangles)
        throw new Error('Pavement triangle budget exceeded');
    }
  }
  return mesh;
}
function cutStations(a: Point, b: Point, polygon: Point[], output: number[]) {
  const d = sub(b, a),
    length2 = dot(d, d);
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length],
      e = sub(q, p),
      denominator = cross(d, e);
    if (Math.abs(denominator) > EPS) {
      const t = cross(sub(p, a), e) / denominator,
        u = cross(sub(p, a), d) / denominator;
      if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) output.push(t);
    } else if (Math.abs(cross(d, sub(p, a))) < EPS) {
      for (const v of [p, q]) {
        const t = dot(sub(v, a), d) / length2;
        if (t > EPS && t < 1 - EPS) output.push(t);
      }
    }
  }
}
function curbSegments(
  pavement: PolygonIndex,
  asphalt: PolygonIndex,
  maxLength: number,
  maxSegments: number,
): CurbSegment[] {
  const result: CurbSegment[] = [],
    seen = new Set<string>();
  for (const poly of pavement.polygons)
    for (let i = 0; i < poly.points.length; i++) {
      const a = poly.points[i],
        b = poly.points[(i + 1) % poly.points.length],
        length = dist(a, b);
      if (length < 0.02) continue;
      const box = bounds([a, b], 0.025),
        cutters = [
          ...asphalt.query(poly.level, box),
          ...pavement.query(poly.level, box),
        ];
      const cuts = [0, 1];
      for (const p of cutters) cutStations(a, b, p.points, cuts);
      cuts.sort((a, b) => a - b);
      const stations = cuts.filter(
        (t, i) => i === 0 || (t - cuts[i - 1]) * length > 1e-5,
      );
      const d = sub(b, a),
        normal: Point = [-d[1] / length, d[0] / length];
      for (let j = 1; j < stations.length; j++) {
        const t0 = stations[j - 1],
          t1 = stations[j],
          span = (t1 - t0) * length;
        if (span < 0.02) continue;
        const mid = lerp(a, b, (t0 + t1) / 2),
          probe = Math.min(0.02, span * 0.1);
        const left = add(mid, mul(normal, probe)),
          right = add(mid, mul(normal, -probe));
        if (
          !pavement.contains(poly.level, left) ||
          pavement.contains(poly.level, right) ||
          asphalt.contains(poly.level, left) ||
          !asphalt.contains(poly.level, right)
        )
          continue;
        for (let n = 0, count = Math.ceil(span / maxLength); n < count; n++) {
          const p = lerp(a, b, t0 + ((t1 - t0) * n) / count),
            q = lerp(a, b, t0 + ((t1 - t0) * (n + 1)) / count);
          const key = `${poly.level}:${[pointKey(p), pointKey(q)].sort().join(':')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ a: p, b: q, level: poly.level });
          if (result.length > maxSegments)
            throw new Error('Curb segment budget exceeded');
        }
      }
    }
  return result;
}

/**
 * All road surfaces participate in the asphalt mask, including lane/private edges.
 * Defaults deliberately add no new sidewalks to those minor surfaces themselves.
 */
export function buildPavement(
  graph: RoadGraph,
  options: PavementOptions = {},
): PavementResult {
  const cell = options.gridMeters ?? 64,
    maxPieces = options.maxPiecesPerCandidate ?? 512;
  const maxVertices = options.maxVertices ?? 250000,
    maxTriangles = options.maxTriangles ?? 300000;
  const maxCurbs = options.maxCurbSegments ?? 100000,
    maxCurbLength = options.maxCurbLength ?? 12;
  if (
    ![
      cell,
      maxPieces,
      maxVertices,
      maxTriangles,
      maxCurbs,
      maxCurbLength,
    ].every((n) => Number.isFinite(n) && n > 0)
  )
    throw new Error('Invalid pavement budget');
  const sidewalkWidth =
    options.sidewalkWidth ??
    ((e: RoadEdge) =>
      e.classes.every((c) => /lane|private|non.city|bikeway/i.test(c)) ? 0 : 2);
  const widths = graph.edges.map((e) => sidewalkWidth(e));
  if (widths.some((n) => !Number.isFinite(n) || n < 0 || n > 20))
    throw new Error('Invalid sidewalk width');
  const masks = new PolygonIndex(cell),
    sidewalkCandidates: Polygon2D[] = [],
    junctionPatches: Polygon2D[] = [];
  const extensions = (options.sidewalkExtensions || [])
    .map((p) => ({
      points: clean(p.points),
      level: p.level,
      kind: 'sidewalk' as const,
    }))
    .filter((p) => p.points.length >= 3);
  const exclusions = new PolygonIndex(cell);
  for (const p of options.exclusions || []) {
    const points = clean(p.points);
    if (points.length >= 3)
      exclusions.add({ points, level: p.level, kind: 'road' });
  }
  const addRoad = (road: Polygon2D) => {
    let pieces = [road.points];
    for (const extension of [
      ...extensions,
      ...exclusions.query(road.level, bounds(road.points)),
    ])
      if (
        extension.level === road.level &&
        overlaps(bounds(road.points), bounds(extension.points))
      )
        pieces = pieces.flatMap((p) => subtract(p, extension.points));
    for (const points of pieces) masks.add({ ...road, points });
  };
  sidewalkCandidates.push(...extensions);
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a],
      b = graph.nodes[edge.b],
      w = edge.width / 2,
      sw = widths[edge.id];
    const road = strip(a.point, b.point, -w, w);
    if (road.length) addRoad({ points: road, level: a.level, kind: 'road' });
    if (sw > 0)
      for (const [lo, hi] of [
        [w, w + sw],
        [-w - sw, -w],
      ]) {
        const points = strip(a.point, b.point, lo, hi);
        if (points.length)
          sidewalkCandidates.push({ points, level: a.level, kind: 'sidewalk' });
      }
  }
  for (const node of graph.nodes) {
    if (node.edgeIds.length < 2) continue;
    const inner: Point[] = [],
      outer: Point[] = [];
    let hasPavement = false;
    for (const id of node.edgeIds) {
      const e = graph.edges[id],
        other = graph.nodes[e.a === node.id ? e.b : e.a];
      const delta = sub(other.point, node.point),
        length = Math.hypot(...delta),
        d = mul(delta, 1 / length),
        n: Point = [-d[1], d[0]];
      const half = e.width / 2,
        sw = widths[id];
      hasPavement ||= sw > 0;
      // Only local cross-section endpoints enter the asphalt hull: no arbitrary circle,
      // long miter or extension farther than the widest incident half-width.
      for (const sign of [-1, 1]) {
        inner.push(add(node.point, mul(n, half * sign)));
        outer.push(add(node.point, mul(n, (half + sw) * sign)));
        // Short shoulder stubs also connect different-width straight road sidewalks.
        outer.push(
          add(
            add(node.point, mul(d, Math.min(2, length / 2))),
            mul(n, (half + sw) * sign),
          ),
        );
      }
    }
    const patch = hull(inner);
    if (patch.length) {
      const p: Polygon2D = {
        points: patch,
        level: node.level,
        kind: 'junction',
      };
      addRoad(p);
      junctionPatches.push(p);
    }
    const pavement = hasPavement ? hull(outer) : [];
    if (pavement.length)
      sidewalkCandidates.push({
        points: pavement,
        level: node.level,
        kind: 'sidewalk',
      });
  }
  let candidateSubtractions = 0;
  const difference = (candidate: Polygon2D, cutters: Polygon2D[]) => {
    let pieces = [candidate.points];
    for (const cutter of cutters) {
      if (!pieces.length) break;
      const box = bounds(cutter.points),
        next: Point[][] = [];
      for (const piece of pieces) {
        if (!overlaps(bounds(piece), box)) next.push(piece);
        else {
          candidateSubtractions++;
          next.push(...subtract(piece, cutter.points));
        }
      }
      if (next.length > maxPieces)
        throw new Error('Pavement clipping-fragment budget exceeded');
      pieces = next;
    }
    return pieces.map((points) => ({ ...candidate, points }));
  };
  // Partition asphalt union into non-overlapping convex pieces before triangulation.
  const asphalt = new PolygonIndex(cell);
  for (const mask of masks.polygons) {
    for (const p of difference(
      mask,
      asphalt.query(mask.level, bounds(mask.points)),
    ))
      asphalt.add(p);
  }
  const sidewalk = new PolygonIndex(cell);
  for (const candidate of sidewalkCandidates) {
    const withoutRoad = difference(candidate, [
      ...masks.query(candidate.level, bounds(candidate.points)),
      ...exclusions.query(candidate.level, bounds(candidate.points)),
    ]);
    for (const fragment of withoutRoad)
      for (const p of difference(
        fragment,
        sidewalk.query(fragment.level, bounds(fragment.points)),
      ))
        sidewalk.add(p);
  }
  return {
    asphalt: triangulate(asphalt.polygons, maxVertices, maxTriangles),
    sidewalks: triangulate(sidewalk.polygons, maxVertices, maxTriangles),
    curbs: curbSegments(sidewalk, masks, maxCurbLength, maxCurbs),
    asphaltPolygons: asphalt.polygons,
    sidewalkPolygons: sidewalk.polygons,
    junctionPatches,
    stats: {
      roadMasks: masks.polygons.length,
      sidewalkCandidates: sidewalkCandidates.length,
      asphaltFragments: asphalt.polygons.length,
      sidewalkFragments: sidewalk.polygons.length,
      candidateSubtractions,
    },
  };
}
