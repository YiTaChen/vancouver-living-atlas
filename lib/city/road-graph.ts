/**
 * Original pure planar road geometry prototype. MIT.
 * Coordinates are local metres, [east, south]; no Engine/Three/DOM dependencies.
 * Crossings are conservative illustrative proposals, never surveyed traffic data.
 */
export type Point = readonly [number, number];
export interface RoadInput {
  id: string;
  name: string;
  roadClass: string;
  width: number;
  /** Full display envelope, including connected sidewalks. Not surveyed ROW. */
  corridorWidth?: number;
  points: readonly Point[];
  /** Explicit topology layer: geometrically crossing different levels never join. */
  level?: string;
  crossingEligible?: boolean;
}
export interface RoadNode {
  id: number;
  point: Point;
  level: string;
  edgeIds: number[];
}
export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  width: number;
  corridorWidth: number;
  sourceIds: string[];
  names: string[];
  classes: string[];
  crossingEligible: boolean;
}
export interface Approach {
  id: string;
  nodeId: number;
  edgeIds: number[];
  direction: Point;
  width: number;
  crossingEligible: boolean;
}
export interface Junction {
  nodeId: number;
  approaches: Approach[];
}
export interface MeasuredPath {
  points: Point[];
  cumulative: number[];
  length: number;
}
export interface RoadPath extends MeasuredPath {
  id: number;
  nodeIds: number[];
  edgeIds: number[];
  widths: number[];
  closed: boolean;
}
export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  junctions: Junction[];
  paths: RoadPath[];
  directionMergeDegrees: number;
  stats: {
    inputSegments: number;
    candidatePairs: number;
    splitSegments: number;
    duplicates: number;
    collapsed: number;
  };
}
export interface GraphOptions {
  snapMeters?: number;
  directionMergeDegrees?: number;
  /** true splits same-level segment intersections and endpoint-on-segment T joints. */
  nodeIntersections?: boolean;
  gridMeters?: number;
}
type Segment = { a: Point; b: Point; road: RoadInput; cuts: number[] };
const EPS = 1e-7;
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const scale = (p: Point, n: number): Point => [p[0] * n, p[1] * n];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (p: Point): Point => scale(p, 1 / Math.hypot(...p));
const lerp = (a: Point, b: Point, t: number): Point =>
  add(a, scale(sub(b, a), t));
const clamp = (t: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, t));
const unique = (a: string[]) => [...new Set(a)].sort();
const coordinateKey = (p: Point, level: string) =>
  `${level}:${p[0].toFixed(8)},${p[1].toFixed(8)}`;

function gridKeys(a: Point, b: Point, cell: number, pad = 0): string[] {
  const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / cell);
  const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / cell);
  const z0 = Math.floor((Math.min(a[1], b[1]) - pad) / cell);
  const z1 = Math.floor((Math.max(a[1], b[1]) + pad) / cell);
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > 100000)
    throw new Error('Segment exceeds safe planar grid extent');
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) keys.push(`${x},${z}`);
  return keys;
}
function addCut(s: Segment, t: number) {
  if (t > EPS && t < 1 - EPS) s.cuts.push(t);
}
function cutPair(a: Segment, b: Segment, tolerance: number) {
  const r = sub(a.b, a.a),
    s = sub(b.b, b.a),
    qp = sub(b.a, a.a);
  const denominator = cross(r, s);
  if (Math.abs(denominator) > EPS) {
    const t = cross(qp, s) / denominator,
      u = cross(qp, r) / denominator;
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
      addCut(a, clamp(t));
      addCut(b, clamp(u));
    }
  }
  // Includes T-joints with a small survey mismatch, and partial collinear overlaps.
  for (const [point, segment] of [
    [a.a, b],
    [a.b, b],
    [b.a, a],
    [b.b, a],
  ] as [Point, Segment][]) {
    const d = sub(segment.b, segment.a),
      t = dot(sub(point, segment.a), d) / dot(d, d);
    if (
      t > EPS &&
      t < 1 - EPS &&
      distance(point, lerp(segment.a, segment.b, t)) <= tolerance
    )
      addCut(segment, t);
  }
}

export function buildRoadGraph(
  inputs: readonly RoadInput[],
  options: GraphOptions = {},
): RoadGraph {
  const snap = options.snapMeters ?? 0.75,
    grid = options.gridMeters ?? 64;
  const angle = options.directionMergeDegrees ?? 10;
  if (
    !(
      snap > 0 &&
      Number.isFinite(snap) &&
      grid > 0 &&
      Number.isFinite(grid) &&
      angle > 0 &&
      angle < 45
    )
  )
    throw new Error('Invalid graph options');
  const segments: Segment[] = [];
  const sorted = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  for (const road of sorted) {
    if (!(road.width > 0 && Number.isFinite(road.width)))
      throw new Error(`Invalid width: ${road.id}`);
    if (road.points.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
      throw new Error(`Invalid point: ${road.id}`);
    for (let i = 1; i < road.points.length; i++) {
      if (distance(road.points[i - 1], road.points[i]) <= EPS) continue;
      segments.push({
        a: road.points[i - 1],
        b: road.points[i],
        road,
        cuts: [0, 1],
      });
    }
  }
  let candidatePairs = 0;
  if (options.nodeIntersections !== false) {
    const buckets = new Map<string, number[]>(),
      pairs = new Set<string>();
    segments.forEach((s, i) => {
      for (const key of gridKeys(s.a, s.b, grid, snap)) {
        const k = `${s.road.level ?? 'ground'}:${key}`,
          bucket = buckets.get(k) ?? [];
        for (const j of bucket) {
          const pair = `${j}:${i}`;
          if (pairs.has(pair)) continue;
          pairs.add(pair);
          candidatePairs++;
          cutPair(segments[j], s, snap);
        }
        bucket.push(i);
        buckets.set(k, bucket);
      }
    });
  }
  const pieces: { a: Point; b: Point; road: RoadInput }[] = [];
  for (const s of segments) {
    const cuts = s.cuts
      .sort((a, b) => a - b)
      .filter((v, i, a) => i === 0 || v - a[i - 1] > EPS);
    for (let i = 1; i < cuts.length; i++)
      pieces.push({
        a: lerp(s.a, s.b, cuts[i - 1]),
        b: lerp(s.a, s.b, cuts[i]),
        road: s.road,
      });
  }
  // Sorted coordinate representatives make snapping independent of input feature order.
  const rawPoints = new Map<string, { point: Point; level: string }>();
  for (const s of pieces)
    for (const point of [s.a, s.b]) {
      const level = s.road.level ?? 'ground';
      rawPoints.set(coordinateKey(point, level), { point, level });
    }
  const nodes: RoadNode[] = [],
    nodeByCoordinate = new Map<string, number>(),
    buckets = new Map<string, number[]>();
  const records = [...rawPoints.entries()].sort(
    (a, b) =>
      a[1].level.localeCompare(b[1].level) ||
      a[1].point[0] - b[1].point[0] ||
      a[1].point[1] - b[1].point[1],
  );
  for (const [key, { point, level }] of records) {
    const x = Math.floor(point[0] / snap),
      z = Math.floor(point[1] / snap);
    let closest = -1,
      best = snap + EPS;
    for (let xx = x - 1; xx <= x + 1; xx++)
      for (let zz = z - 1; zz <= z + 1; zz++) {
        for (const id of buckets.get(`${level}:${xx},${zz}`) ?? []) {
          const d = distance(point, nodes[id].point);
          if (d < best) {
            closest = id;
            best = d;
          }
        }
      }
    if (closest < 0) {
      closest = nodes.length;
      nodes.push({ id: closest, point, level, edgeIds: [] });
      const k = `${level}:${x},${z}`,
        bucket = buckets.get(k) ?? [];
      bucket.push(closest);
      buckets.set(k, bucket);
    }
    nodeByCoordinate.set(key, closest);
  }
  const edges: RoadEdge[] = [],
    edgeByNodes = new Map<string, RoadEdge>();
  let duplicates = 0,
    collapsed = 0;
  for (const p of pieces) {
    const level = p.road.level ?? 'ground';
    const a = nodeByCoordinate.get(coordinateKey(p.a, level))!,
      b = nodeByCoordinate.get(coordinateKey(p.b, level))!;
    if (a === b) {
      collapsed++;
      continue;
    }
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`,
      existing = edgeByNodes.get(key);
    const eligible = p.road.crossingEligible ?? p.road.width >= 12;
    if (existing) {
      duplicates++;
      existing.width = Math.max(existing.width, p.road.width);
      existing.corridorWidth = Math.max(
        existing.corridorWidth,
        p.road.corridorWidth ?? p.road.width + 4,
      );
      existing.sourceIds = unique([...existing.sourceIds, p.road.id]);
      existing.names = unique([...existing.names, p.road.name]);
      existing.classes = unique([...existing.classes, p.road.roadClass]);
      existing.crossingEligible ||= eligible;
    } else {
      const edge: RoadEdge = {
        id: edges.length,
        a: Math.min(a, b),
        b: Math.max(a, b),
        length: distance(nodes[a].point, nodes[b].point),
        width: p.road.width,
        corridorWidth: p.road.corridorWidth ?? p.road.width + 4,
        sourceIds: [p.road.id],
        names: [p.road.name],
        classes: [p.road.roadClass],
        crossingEligible: eligible,
      };
      edges.push(edge);
      edgeByNodes.set(key, edge);
      nodes[a].edgeIds.push(edge.id);
      nodes[b].edgeIds.push(edge.id);
    }
  }
  const graph: RoadGraph = {
    nodes,
    edges,
    junctions: [],
    paths: [],
    directionMergeDegrees: angle,
    stats: {
      inputSegments: segments.length,
      candidatePairs,
      splitSegments: pieces.length,
      duplicates,
      collapsed,
    },
  };
  for (const node of nodes) {
    const approaches = directionsAt(graph, node.id);
    if (approaches.length >= 3)
      graph.junctions.push({ nodeId: node.id, approaches });
  }
  graph.paths = continuousPaths(graph);
  return graph;
}

/** Opposite directions remain separate; nearby outgoing bearings form one approach. */
export function directionsAt(graph: RoadGraph, nodeId: number): Approach[] {
  const node = graph.nodes[nodeId],
    cos = Math.cos((graph.directionMergeDegrees * Math.PI) / 180);
  const rays = node.edgeIds
    .map((edgeId) => {
      const e = graph.edges[edgeId],
        other = e.a === nodeId ? e.b : e.a;
      return {
        edgeId,
        direction: unit(sub(graph.nodes[other].point, node.point)),
        width: e.width,
      };
    })
    .sort(
      (a, b) =>
        b.width - a.width ||
        graph.edges[b.edgeId].length - graph.edges[a.edgeId].length ||
        a.edgeId - b.edgeId,
    );
  const groups: (typeof rays)[] = [];
  for (const ray of rays) {
    // Complete-link comparison prevents a chain of 9-degree rays from swallowing a broad fork.
    const group = groups.find((g) =>
      g.every((r) => dot(r.direction, ray.direction) >= cos),
    );
    if (group) group.push(ray);
    else groups.push([ray]);
  }
  return groups
    .map((g) => ({
      id: `${nodeId}:${g
        .map((r) => r.edgeId)
        .sort((a, b) => a - b)
        .join('-')}`,
      nodeId,
      edgeIds: g.map((r) => r.edgeId),
      direction: g[0].direction,
      width: Math.max(...g.map((r) => r.width)),
      crossingEligible: g.some((r) => graph.edges[r.edgeId].crossingEligible),
    }))
    .sort(
      (a, b) =>
        Math.atan2(a.direction[1], a.direction[0]) -
        Math.atan2(b.direction[1], b.direction[0]),
    );
}

export function measurePath(input: readonly Point[]): MeasuredPath {
  const points: Point[] = [],
    cumulative: number[] = [];
  let length = 0;
  for (const point of input) {
    if (point.length !== 2 || !point.every(Number.isFinite))
      throw new Error('Invalid path point');
    if (points.length) {
      const d = distance(point, points.at(-1)!);
      if (d <= EPS) continue;
      length += d;
    }
    points.push(point);
    cumulative.push(length);
  }
  return { points, cumulative, length };
}
export function sampleAt(path: MeasuredPath, station: number) {
  if (!Number.isFinite(station) || path.points.length < 2 || path.length <= EPS)
    return null;
  const d = clamp(station, 0, path.length);
  let lo = 0,
    hi = path.cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.cumulative[mid] <= d) lo = mid;
    else hi = mid;
  }
  const a = path.points[lo],
    b = path.points[hi],
    t = (d - path.cumulative[lo]) / (path.cumulative[hi] - path.cumulative[lo]);
  return {
    distance: d,
    point: lerp(a, b, t),
    tangent: unit(sub(b, a)),
    segment: lo,
  };
}
/** A stable phase follows the whole polyline; no restart at a source vertex. */
export function sampleStations(
  path: MeasuredPath,
  spacing: number,
  phase = 0,
  start = 0,
  end = path.length,
) {
  if (
    !(spacing > 0 && Number.isFinite(spacing)) ||
    ![phase, start, end].every(Number.isFinite)
  )
    throw new Error('Invalid station options');
  const lo = Math.max(0, start),
    hi = Math.min(path.length, end),
    result = [];
  phase = ((phase % spacing) + spacing) % spacing;
  const first = phase + Math.ceil((lo - phase) / spacing) * spacing;
  if ((hi - first) / spacing > 100000) throw new Error('Too many stations');
  for (let d = first; d <= hi + EPS; d += spacing) {
    const p = sampleAt(path, d);
    if (p) result.push(p);
  }
  return result;
}

function continuousPaths(graph: RoadGraph): RoadPath[] {
  const paths: RoadPath[] = [],
    used = new Set<number>();
  const walk = (start: number, first: number) => {
    const nodeIds = [start],
      edgeIds: number[] = [];
    let nodeId = start,
      edgeId = first;
    while (!used.has(edgeId)) {
      const edge = graph.edges[edgeId];
      used.add(edgeId);
      edgeIds.push(edgeId);
      nodeId = edge.a === nodeId ? edge.b : edge.a;
      nodeIds.push(nodeId);
      const next = graph.nodes[nodeId];
      if (nodeId === start || next.edgeIds.length !== 2) break;
      edgeId = next.edgeIds.find((id) => id !== edgeId)!;
    }
    paths.push({
      ...measurePath(nodeIds.map((id) => graph.nodes[id].point)),
      id: paths.length,
      nodeIds,
      edgeIds,
      widths: edgeIds.map((id) => graph.edges[id].width),
      closed: nodeIds.at(-1) === start,
    });
  };
  for (const n of graph.nodes)
    if (n.edgeIds.length !== 2)
      for (const edgeId of n.edgeIds) if (!used.has(edgeId)) walk(n.id, edgeId);
  for (const e of graph.edges) if (!used.has(e.id)) walk(e.a, e.id);
  return paths;
}

/** Follow actual intermediate vertices, stopping at the next raw branch/end, not first tiny segment. */
export function traceApproach(
  graph: RoadGraph,
  approach: Approach,
): MeasuredPath & { edgeIds: number[]; widths: number[] } {
  const points = [graph.nodes[approach.nodeId].point],
    seen = new Set<number>(),
    edgeIds: number[] = [],
    widths: number[] = [];
  let nodeId = approach.nodeId,
    edgeId = approach.edgeIds[0];
  while (!seen.has(edgeId)) {
    seen.add(edgeId);
    const edge = graph.edges[edgeId];
    edgeIds.push(edgeId);
    widths.push(edge.width);
    nodeId = edge.a === nodeId ? edge.b : edge.a;
    points.push(graph.nodes[nodeId].point);
    const node = graph.nodes[nodeId];
    if (nodeId === approach.nodeId || node.edgeIds.length !== 2) break;
    edgeId = node.edgeIds.find((id) => id !== edgeId)!;
  }
  return { ...measurePath(points), edgeIds, widths };
}
export interface CrossingOptions {
  depth?: number;
  clearance?: number;
  endClearance?: number;
  maxSetback?: number;
  maxTurnDegrees?: number;
  parallelDegrees?: number;
}
export interface Crossing {
  id: string;
  nodeId: number;
  approachId: string;
  center: Point;
  tangent: Point;
  width: number;
  depth: number;
  setback: number;
  corners: Point[];
  edgeIds: number[];
}
/** Centre station required to keep all four crossing corners out of each turning road corridor. */
export function junctionSetback(
  approach: Approach,
  approaches: readonly Approach[],
  options: CrossingOptions = {},
): number {
  const depth = options.depth ?? 3.3,
    clearance = options.clearance ?? 1.25;
  let result = depth / 2 + clearance;
  for (const other of approaches) {
    if (other.id === approach.id) continue;
    const sin = Math.abs(cross(approach.direction, other.direction)),
      cos = Math.abs(dot(approach.direction, other.direction));
    if (sin < Math.sin(((options.parallelDegrees ?? 10) * Math.PI) / 180))
      continue; // near-parallel same/opposite continuations
    result = Math.max(
      result,
      depth / 2 +
        (other.width / 2 + clearance + (approach.width / 2) * cos) / sin,
    );
  }
  return result;
}
function corners(
  center: Point,
  tangent: Point,
  width: number,
  depth: number,
): Point[] {
  const side: Point = [-tangent[1], tangent[0]];
  return [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ].map(([a, b]) =>
    add(
      center,
      add(scale(tangent, (a * depth) / 2), scale(side, (b * width) / 2)),
    ),
  );
}
function overlap(a: Crossing, b: Crossing): boolean {
  for (const c of [a, b])
    for (const axis of [c.tangent, [-c.tangent[1], c.tangent[0]]] as Point[]) {
      const aa = a.corners.map((p) => dot(p, axis)),
        bb = b.corners.map((p) => dot(p, axis));
      if (
        Math.min(...aa) >= Math.max(...bb) - EPS ||
        Math.min(...bb) >= Math.max(...aa) - EPS
      )
        return false;
    }
  return true;
}
export function createCrossings(
  graph: RoadGraph,
  options: CrossingOptions = {},
) {
  options = { parallelDegrees: graph.directionMergeDegrees, ...options };
  const depth = options.depth ?? 3.3,
    maxSetback = options.maxSetback ?? 35;
  const endClearance = options.endClearance ?? 1,
    turnCos = Math.cos(((options.maxTurnDegrees ?? 10) * Math.PI) / 180);
  if (
    ![depth, maxSetback, endClearance, options.clearance ?? 1.25].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    depth === 0 ||
    !Number.isFinite(turnCos) ||
    !(options.parallelDegrees! > 0 && options.parallelDegrees! < 45)
  )
    throw new Error('Invalid crossing options');
  const candidates: Crossing[] = [],
    rejected: { id: string; reason: string }[] = [];
  for (const junction of graph.junctions)
    for (const a of junction.approaches) {
      if (!a.crossingEligible) continue;
      const id = `crossing:${a.id}`,
        setback = junctionSetback(a, junction.approaches, options),
        path = traceApproach(graph, a);
      if (setback > maxSetback) {
        rejected.push({ id, reason: 'acute-junction' });
        continue;
      }
      if (setback + depth / 2 + endClearance > path.length) {
        rejected.push({ id, reason: 'short-approach' });
        continue;
      }
      const p = sampleAt(path, setback)!,
        front = sampleAt(path, setback - depth / 2)!,
        back = sampleAt(path, setback + depth / 2)!;
      if ([front, p, back].some((s) => dot(s.tangent, a.direction) < turnCos)) {
        rejected.push({ id, reason: 'curved-approach' });
        continue;
      }
      if (
        path.widths
          .slice(0, back.segment + 1)
          .some((w) => Math.abs(w - a.width) > 0.5)
      ) {
        rejected.push({ id, reason: 'width-transition' });
        continue;
      }
      const width = Math.max(1, a.width - 2),
        rectangle = corners(p.point, p.tangent, width, depth);
      // A gentle curve or snapped survey point can offset the centre despite similar tangents.
      // Recheck all corners against turning corridors instead of relying solely on straight-line formula.
      const origin = graph.nodes[a.nodeId].point,
        margin = options.clearance ?? 1.25;
      const clear = junction.approaches.every((other) => {
        if (
          other.id === a.id ||
          Math.abs(cross(a.direction, other.direction)) <
            Math.sin((options.parallelDegrees! * Math.PI) / 180)
        )
          return true;
        const signed = rectangle.map((point) =>
          cross(other.direction, sub(point, origin)),
        );
        const limit = other.width / 2 + margin;
        return (
          Math.min(...signed) >= limit - EPS ||
          Math.max(...signed) <= -limit + EPS
        );
      });
      if (!clear) {
        rejected.push({ id, reason: 'junction-clearance' });
        continue;
      }
      candidates.push({
        id,
        nodeId: a.nodeId,
        approachId: a.id,
        center: p.point,
        tangent: p.tangent,
        width,
        depth,
        setback,
        corners: rectangle,
        edgeIds: path.edgeIds,
      });
    }
  // Adjacent intersections can be very close: drop both overlapping proposals, never stack paint.
  const blocked = new Set<number>(),
    buckets = new Map<string, number[]>(),
    pairs = new Set<string>();
  candidates.forEach((c, i) => {
    const min: Point = [
      Math.min(...c.corners.map((p) => p[0])),
      Math.min(...c.corners.map((p) => p[1])),
    ];
    const max: Point = [
      Math.max(...c.corners.map((p) => p[0])),
      Math.max(...c.corners.map((p) => p[1])),
    ];
    for (const key of gridKeys(min, max, 32)) {
      const bucket = buckets.get(key) ?? [];
      for (const j of bucket) {
        const pair = `${j}:${i}`;
        if (pairs.has(pair)) continue;
        pairs.add(pair);
        if (
          graph.nodes[c.nodeId].level ===
            graph.nodes[candidates[j].nodeId].level &&
          overlap(c, candidates[j])
        ) {
          blocked.add(i);
          blocked.add(j);
        }
      }
      bucket.push(i);
      buckets.set(key, bucket);
    }
  });
  for (const i of blocked)
    rejected.push({ id: candidates[i].id, reason: 'overlapping-proposals' });
  return { crossings: candidates.filter((_, i) => !blocked.has(i)), rejected };
}
