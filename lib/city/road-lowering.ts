/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). A local, downward-only repair of existing ground asphalt.
 * Upper decks and source paths remain untouched. The correction is zero with
 * zero derivative at its six-metre perimeter. Path footprint boundaries are
 * explicit triangle cuts, so a fine grid cannot miss a narrow source path.
 */
import {
  visibilityGeometry as G,
  type Bounds,
  type GroundCover,
  type Point,
  type TerrainInput,
  type Triangle,
} from './ground-visibility';
interface Constraint {
  sourceId: string;
  path: Triangle;
  active: Point[];
  bounds: Bounds;
}
export interface RoadLoweringPlan {
  bounds: Bounds;
  blendM: number;
  gapM: number;
  gridM: number;
  constraints: Constraint[];
  sourceAreasM2: Record<string, number>;
  protectedSkipped: number;
}
export interface RoadLoweringResult {
  positions: number[];
  attributes: Record<string, { array: number[]; itemSize: number }>;
  changedTriangles: number[];
  statistics: {
    inputTriangles: number;
    outputTriangles: number;
    changedTriangles: number;
    maximumLoweringM: number;
    maximumUpwardChangeM: number;
    inputPlanAreaM2: number;
    outputPlanAreaM2: number;
    maximumSharedVertexYDifferenceM: number;
    conformingEdgeInsertions: number;
  };
}
const EPS = 1e-8;
const extend = (b: Bounds, p: number): Bounds => [
  b[0] - p,
  b[1] - p,
  b[2] + p,
  b[3] + p,
];
function distance(p: Point, polygon: Point[]) {
  const sign = Math.sign(G.signedArea(polygon));
  let inside = true,
    d2 = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (sign * G.cross(a, b, p) < -EPS) inside = false;
    const x = b[0] - a[0],
      z = b[1] - a[1],
      n = x * x + z * z;
    const u = n
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / n))
      : 0;
    d2 = Math.min(d2, (p[0] - a[0] - u * x) ** 2 + (p[1] - a[1] - u * z) ** 2);
  }
  return inside ? 0 : Math.sqrt(d2);
}
/** Compute the active correction from actual road/path triangle intersections,
 * never a buffered source centreline. Prepare once across all asphalt chunks,
 * then use this same plan for every chunk to share the blend field at seams.
 */
export function prepareRoadLowering(
  asphalt: readonly GroundCover[],
  paths: readonly GroundCover[],
  options: {
    bounds: Bounds;
    focusBounds?: Bounds;
    blendM?: number;
    gapM?: number;
    gridM?: number;
  },
): RoadLoweringPlan {
  G.validateBounds(options.bounds);
  const blendM = options.blendM ?? 6,
    gapM = options.gapM ?? 0.02,
    gridM = options.gridM ?? 0.75;
  if (
    !(
      blendM >= 2 &&
      blendM <= 10 &&
      gapM >= 0.005 &&
      gapM <= 0.05 &&
      gridM >= 0.25 &&
      gridM <= 1
    )
  )
    throw new Error('Unsafe local road lowering options');
  const plan: RoadLoweringPlan = {
    ...options,
    blendM,
    gapM,
    gridM,
    constraints: [],
    sourceAreasM2: {},
    protectedSkipped: 0,
  };
  const pathTriangles: { id: string; triangle: Triangle }[] = [];
  for (const source of paths) {
    if (source.level !== 'ground' || source.protectedSurface) {
      plan.protectedSkipped++;
      continue;
    }
    if (source.kind !== 'path')
      throw new Error('A lower path constraint must be a source path');
    for (let i = 0; i < source.positions.length; i += 9) {
      const t = G.triangle(source.positions, i);
      if (t && G.overlaps(t.bounds, options.bounds))
        pathTriangles.push({ id: source.id, triangle: t });
    }
  }
  const focus = options.focusBounds ?? options.bounds;
  G.validateBounds(focus);
  if (
    focus[0] < options.bounds[0] ||
    focus[1] < options.bounds[1] ||
    focus[2] > options.bounds[2] ||
    focus[3] > options.bounds[3]
  )
    throw new Error('Focus bounds outside the authorised local scope');
  for (const source of asphalt) {
    if (source.level !== 'ground' || source.protectedSurface) {
      plan.protectedSkipped++;
      continue;
    }
    if (source.kind !== 'asphalt')
      throw new Error('Only ground asphalt may be lowered');
    for (let i = 0; i < source.positions.length; i += 9) {
      const f = source.positions;
      if (
        Math.max(f[i], f[i + 3], f[i + 6]) < options.bounds[0] ||
        Math.min(f[i], f[i + 3], f[i + 6]) > options.bounds[2] ||
        Math.max(f[i + 2], f[i + 5], f[i + 8]) < options.bounds[1] ||
        Math.min(f[i + 2], f[i + 5], f[i + 8]) > options.bounds[3]
      )
        continue;
      const t = G.triangle(source.positions, i);
      if (!t) continue;
      for (const { id, triangle: path } of pathTriangles) {
        if (!G.overlaps(t.bounds, path.bounds)) continue;
        let active = G.intersect(t.points, path.points);
        if (!active.length) continue;
        [active] = G.split(
          active,
          (p) => G.height(t, p) - G.height(path, p) + gapM,
        );
        if (!active.length || G.area(active) < 1e-7) continue;
        // Include a whole small triangle-overlap island if it touches focus;
        // never cut an active correction at an arbitrary photo-view rectangle.
        if (!G.intersect(active, G.rectangle(focus)).length) continue;
        const b = extend(G.boundsOf(active), blendM);
        // A hard task-scope cut through a live blend would create a new seam.
        if (
          b[0] < options.bounds[0] ||
          b[1] < options.bounds[1] ||
          b[2] > options.bounds[2] ||
          b[3] > options.bounds[3]
        )
          throw new Error(
            `Local bounds truncate the blend for ${id}; enlarge explicit task scope`,
          );
        plan.constraints.push({ sourceId: id, path, active, bounds: b });
        plan.sourceAreasM2[id] = (plan.sourceAreasM2[id] ?? 0) + G.area(active);
      }
    }
  }
  return plan;
}
/** The original road plane is authoritative outside the finite correction.
 * Smoothstep has zero derivative at both endpoints; min/max only ever lower.
 */
export function roadLoweringAt(
  plan: RoadLoweringPlan,
  point: Point,
  originalY: number,
): number {
  let correction = 0;
  for (const c of plan.constraints) {
    if (
      point[0] < c.bounds[0] ||
      point[0] > c.bounds[2] ||
      point[1] < c.bounds[1] ||
      point[1] > c.bounds[3]
    )
      continue;
    const d = distance(point, c.active);
    if (d >= plan.blendM) continue;
    const u = 1 - d / plan.blendM,
      weight = u * u * (3 - 2 * u);
    correction = Math.max(
      correction,
      Math.max(0, originalY - G.height(c.path, point) + plan.gapM) * weight,
    );
  }
  return originalY - correction;
}
interface PatchTriangle {
  points: Point[];
  original: Triangle;
  offset: number;
}
/** Tessellate only original asphalt triangles touched by an active blend.
 * A global 0.75m grid bounds curvature error. Additional exact source-path
 * partitions guarantee all triangles inside a path lie below that path plane.
 * Shared-edge vertices are inserted into both sides before final emission;
 * this prevents T-junction height cracks from independent clipping orders.
 */
export function lowerRoadSurface(
  input: TerrainInput,
  plan: RoadLoweringPlan,
): RoadLoweringResult {
  if (input.positions.length % 9)
    throw new Error('Incomplete asphalt triangles');
  for (const [name, a] of Object.entries(input.attributes ?? {}))
    if (a.array.length !== (input.positions.length / 3) * a.itemSize)
      throw new Error(`Invalid asphalt attribute ${name}`);
  const attributes: RoadLoweringResult['attributes'] = {};
  for (const [name, a] of Object.entries(input.attributes ?? {}))
    attributes[name] = { array: [], itemSize: a.itemSize };
  const result: RoadLoweringResult = {
    positions: [],
    attributes,
    changedTriangles: [],
    statistics: {
      inputTriangles: input.positions.length / 9,
      outputTriangles: 0,
      changedTriangles: 0,
      maximumLoweringM: 0,
      maximumUpwardChangeM: 0,
      inputPlanAreaM2: 0,
      outputPlanAreaM2: 0,
      maximumSharedVertexYDifferenceM: 0,
      conformingEdgeInsertions: 0,
    },
  };
  const patches = new Map<number, PatchTriangle[]>(),
    all: PatchTriangle[] = [];
  for (let i = 0; i < input.positions.length; i += 9) {
    const t = G.triangle(input.positions, i);
    if (!t) continue;
    result.statistics.inputPlanAreaM2 += G.area(t.points);
    const nearby = plan.constraints.filter((c) =>
      G.overlaps(t.bounds, c.bounds),
    );
    if (!nearby.length) continue;
    const parts: PatchTriangle[] = [];
    for (
      let x = Math.floor(t.bounds[0] / plan.gridM);
      x <= Math.floor(t.bounds[2] / plan.gridM);
      x++
    )
      for (
        let z = Math.floor(t.bounds[1] / plan.gridM);
        z <= Math.floor(t.bounds[3] / plan.gridM);
        z++
      ) {
        let pieces = [
          G.intersect(
            t.points,
            G.rectangle([
              x * plan.gridM,
              z * plan.gridM,
              (x + 1) * plan.gridM,
              (z + 1) * plan.gridM,
            ]),
          ),
        ].filter((p) => p.length);
        for (const c of nearby) {
          const next: Point[][] = [];
          for (const p of pieces) {
            const inner = G.intersect(p, c.path.points);
            if (!inner.length) next.push(p);
            else next.push(inner, ...G.subtract(p, c.path.points));
          }
          pieces = next;
        }
        for (const p of pieces)
          for (let j = 1; j + 1 < p.length; j++) {
            const points = [p[0], p[j], p[j + 1]];
            if (G.area(points) > 1e-10)
              parts.push({ points, original: t, offset: i });
          }
      }
    const changes = parts.some((p) =>
      p.points.some(
        (q) => G.height(t, q) - roadLoweringAt(plan, q, G.height(t, q)) > 1e-9,
      ),
    );
    if (changes) {
      patches.set(i, parts);
      all.push(...parts);
      result.changedTriangles.push(i / 9);
    }
  }
  // Local geometry only: a vertex hash plus metre cells for edge conformity.
  const vertices = new Map<string, { point: Point; y: number }>(),
    cellVertices = new Map<string, { point: Point; originalY: number }[]>();
  // Original shoreline ribbons may overlap in XY on different planes. Weld
  // genuine shared sheet edges, never two independent overlapping floors.
  const key = (p: Point, original: Triangle) =>
    `${p[0].toFixed(7)},${p[1].toFixed(7)},${G.height(original, p).toFixed(6)}`;
  for (const t of all)
    for (const p of t.points) {
      const originalY = G.height(t.original, p),
        y = roadLoweringAt(plan, p, originalY),
        id = key(p, t.original),
        old = vertices.get(id);
      if (old) {
        result.statistics.maximumSharedVertexYDifferenceM = Math.max(
          result.statistics.maximumSharedVertexYDifferenceM,
          Math.abs(old.y - y),
        );
        old.y = Math.min(old.y, y);
      } else {
        vertices.set(id, { point: p, y });
        const k = `${Math.floor(p[0])},${Math.floor(p[1])}`,
          cell = cellVertices.get(k) ?? [];
        cell.push({ point: p, originalY });
        cellVertices.set(k, cell);
      }
    }
  const vertex = (p: Point, t: PatchTriangle) => {
    const oldY = G.height(t.original, p),
      sampledY = roadLoweringAt(plan, p, oldY);
    const y = Math.min(
      oldY,
      sampledY,
      vertices.get(key(p, t.original))?.y ?? sampledY,
    );
    result.statistics.maximumLoweringM = Math.max(
      result.statistics.maximumLoweringM,
      oldY - y,
    );
    result.statistics.maximumUpwardChangeM = Math.max(
      result.statistics.maximumUpwardChangeM,
      y - oldY,
    );
    result.positions.push(p[0], y, p[1]);
    const w = G.weights(t.original, p);
    for (const [name, a] of Object.entries(input.attributes ?? {}))
      for (let j = 0; j < a.itemSize; j++)
        attributes[name].array.push(
          w.reduce(
            (sum, k, v) =>
              sum +
              k * a.array[(t.offset / 3) * a.itemSize + v * a.itemSize + j],
            0,
          ),
        );
  };
  const emit = (p: Point[], t: PatchTriangle) => {
    if (G.area(p) < 1e-10) return;
    if (Math.sign(G.signedArea(p)) !== Math.sign(t.original.determinant))
      [p[1], p[2]] = [p[2], p[1]];
    result.statistics.outputPlanAreaM2 += G.area(p);
    for (const q of p) vertex(q, t);
  };
  for (let i = 0; i < input.positions.length; i += 9) {
    const parts = patches.get(i);
    if (!parts) {
      for (let j = 0; j < 9; j++) result.positions.push(input.positions[i + j]);
      for (const [name, a] of Object.entries(input.attributes ?? {}))
        for (let j = 0; j < 3 * a.itemSize; j++)
          attributes[name].array.push(a.array[(i / 3) * a.itemSize + j]);
      const t = G.triangle(input.positions, i);
      if (t) result.statistics.outputPlanAreaM2 += G.area(t.points);
      continue;
    }
    for (const t of parts) {
      const boundary: Point[] = [];
      let inserted = false;
      for (let j = 0; j < 3; j++) {
        const a = t.points[j],
          b = t.points[(j + 1) % 3],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          length2 = dx * dx + dz * dz;
        boundary.push(a);
        const extra: { point: Point; u: number }[] = [],
          seen = new Set<string>();
        for (
          let x = Math.floor(Math.min(a[0], b[0]) - EPS);
          x <= Math.floor(Math.max(a[0], b[0]) + EPS);
          x++
        )
          for (
            let z = Math.floor(Math.min(a[1], b[1]) - EPS);
            z <= Math.floor(Math.max(a[1], b[1]) + EPS);
            z++
          )
            for (const candidate of cellVertices.get(`${x},${z}`) ?? []) {
              const q = candidate.point;
              if (
                Math.abs(G.height(t.original, q) - candidate.originalY) > 1e-6
              )
                continue;
              const u = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / length2;
              if (
                u <= 1e-7 ||
                u >= 1 - 1e-7 ||
                Math.abs(dx * (q[1] - a[1]) - dz * (q[0] - a[0])) /
                  Math.sqrt(length2) >
                  1e-7 ||
                seen.has(key(q, t.original))
              )
                continue;
              seen.add(key(q, t.original));
              extra.push({ point: q, u });
            }
        extra.sort((p, q) => p.u - q.u);
        if (extra.length) {
          inserted = true;
          result.statistics.conformingEdgeInsertions += extra.length;
          boundary.push(...extra.map((e) => e.point));
        }
      }
      if (!inserted) emit(t.points.slice(), t);
      else {
        const center: Point = [
          boundary.reduce((n, p) => n + p[0], 0) / boundary.length,
          boundary.reduce((n, p) => n + p[1], 0) / boundary.length,
        ];
        for (let j = 0; j < boundary.length; j++)
          emit([center, boundary[j], boundary[(j + 1) % boundary.length]], t);
      }
    }
  }
  result.statistics.outputTriangles = result.positions.length / 9;
  result.statistics.changedTriangles = result.changedTriangles.length;
  return result;
}
