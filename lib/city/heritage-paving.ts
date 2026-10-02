import { CITY_REGION_SELECTORS } from './region-rules';
import type { RoadGraph, Point } from './road-graph';

/** Source-selected Water Street material treatment; no change to source surface shape
 * or topology. Brick sizes and patterns are representative, not a paving survey. */
export interface HeritageFrame {
  origin: Point;
  tangent: Point;
  length: number;
  roadHalf: number;
  sidewalkHalf: number;
}
export function heritageFrames(graph: RoadGraph): HeritageFrame[] {
  return graph.edges
    .filter((edge) =>
      CITY_REGION_SELECTORS.waterStreetPaving(edge, graph.nodes[edge.a].level),
    )
    .map((edge) => {
      const a = graph.nodes[edge.a].point,
        b = graph.nodes[edge.b].point;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return {
        origin: a,
        tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
        length,
        roadHalf: edge.width / 2,
        sidewalkHalf: edge.corridorWidth / 2,
      };
    });
}
export function frameCoordinate(frame: HeritageFrame, x: number, z: number) {
  const dx = x - frame.origin[0],
    dz = z - frame.origin[1];
  return [
    dx * frame.tangent[0] + dz * frame.tangent[1],
    -dx * frame.tangent[1] + dz * frame.tangent[0],
  ] as const;
}
export function nearestHeritageFrame(
  frames: HeritageFrame[],
  x: number,
  z: number,
) {
  let best: HeritageFrame | null = null,
    distance = Infinity;
  for (const frame of frames) {
    const [u, v] = frameCoordinate(frame, x, z);
    const d = Math.hypot(Math.max(0, -u, u - frame.length), v);
    if (d < distance) {
      best = frame;
      distance = d;
    }
  }
  return { frame: best, distance };
}
export function pavingCoverage(
  u: number,
  v: number,
  length: number,
  halfWidth: number,
) {
  return u >= 0 && u <= length && Math.abs(v) <= halfWidth;
}
interface Surface {
  positions: number[];
  uv: number[];
  paving: number[];
}
type Vertex = readonly [number, number, number, number, number];
type Bounds = readonly [number, number, number, number];
interface PreparedFrame {
  frame: HeritageFrame;
  width: number;
  bounds: Bounds;
  // Signed distances in local metres: dx * nx + dz * nz - minimum.
  planes: readonly (readonly [number, number, number])[];
}
const FRAME_CELL = 64;
const MAX_FRAME_CELLS = 4096;
const overlaps = (a: Bounds, b: Bounds) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function prepare(frame: HeritageFrame, sidewalk: boolean): PreparedFrame {
  const width = sidewalk ? frame.sidewalkHalf : frame.roadHalf,
    [x, z] = frame.origin,
    [tx, tz] = frame.tangent,
    endX = x + tx * frame.length,
    endZ = z + tz * frame.length,
    padX = Math.abs(tz * width),
    padZ = Math.abs(tx * width);
  return {
    frame,
    width,
    bounds: [
      Math.min(x, endX) - padX,
      Math.min(z, endZ) - padZ,
      Math.max(x, endX) + padX,
      Math.max(z, endZ) + padZ,
    ],
    planes: [
      [tx, tz, 0],
      [-tx, -tz, -frame.length],
      [-tz, tx, -width],
      [tz, -tx, -width],
    ],
  };
}
function boundsOf(polygon: readonly Vertex[]): Bounds {
  return [
    Math.min(...polygon.map((v) => v[0])),
    Math.min(...polygon.map((v) => v[2])),
    Math.max(...polygon.map((v) => v[0])),
    Math.max(...polygon.map((v) => v[2])),
  ];
}
function cellBounds(bounds: Bounds) {
  return bounds.map((v) => Math.floor(v / FRAME_CELL)) as [
    number,
    number,
    number,
    number,
  ];
}
function cellCount(bounds: readonly number[]) {
  return (bounds[2] - bounds[0] + 1) * (bounds[3] - bounds[1] + 1);
}
/** Index only source corridor rectangles. Large inputs fall back to a bounded
 * frame list instead of enumerating arbitrarily many empty spatial cells. */
function frameIndex(frames: PreparedFrame[]) {
  const cells = new Map<string, number[]>(),
    large: number[] = [];
  const unionBounds: Bounds = [
    Math.min(...frames.map((f) => f.bounds[0])),
    Math.min(...frames.map((f) => f.bounds[1])),
    Math.max(...frames.map((f) => f.bounds[2])),
    Math.max(...frames.map((f) => f.bounds[3])),
  ];
  frames.forEach((frame, index) => {
    const b = cellBounds(frame.bounds);
    if (cellCount(b) > MAX_FRAME_CELLS) {
      large.push(index);
      return;
    }
    for (let x = b[0]; x <= b[2]; x++)
      for (let z = b[1]; z <= b[3]; z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(index);
      }
  });
  return (bounds: Bounds) => {
    if (!overlaps(bounds, unionBounds)) return [];
    const b = cellBounds(bounds);
    if (cellCount(b) > MAX_FRAME_CELLS)
      return frames.filter((f) => overlaps(bounds, f.bounds));
    const candidates = new Set(large);
    for (let x = b[0]; x <= b[2]; x++)
      for (let z = b[1]; z <= b[3]; z++)
        for (const index of cells.get(`${x},${z}`) ?? []) candidates.add(index);
    return [...candidates]
      .sort((a, b) => a - b)
      .map((i) => frames[i])
      .filter((f) => overlaps(bounds, f.bounds));
  };
}
function pushDistinct(polygon: Vertex[], vertex: Vertex) {
  if (polygon.at(-1) !== vertex) polygon.push(vertex);
}
/** Both half-polygons share the identical intersection vertex, interpolating
 * source height AND texture UV along the same edge. No terrain resampling. */
function split(polygon: Vertex[], signedDistance: (v: Vertex) => number) {
  const inside: Vertex[] = [],
    outside: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = signedDistance(a),
      db = signedDistance(b);
    pushDistinct(da >= 0 ? inside : outside, a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      const intersection: Vertex =
        t === 0
          ? a
          : t === 1
            ? b
            : [
                a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t,
                a[2] + (b[2] - a[2]) * t,
                a[3] + (b[3] - a[3]) * t,
                a[4] + (b[4] - a[4]) * t,
              ];
      pushDistinct(inside, intersection);
      pushDistinct(outside, intersection);
    }
  }
  for (const result of [inside, outside])
    if (result.length > 1 && result[0] === result.at(-1)) result.pop();
  return { inside, outside };
}
function emit(surface: Surface, polygon: Vertex[], selected?: PreparedFrame) {
  // Clipping a convex triangle by half-planes retains convex pieces and winding.
  for (let i = 1; i + 1 < polygon.length; i++) {
    const a = polygon[0],
      b = polygon[i],
      c = polygon[i + 1];
    const twiceArea =
      (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (twiceArea === 0) continue;
    for (const vertex of [a, b, c]) {
      surface.positions.push(vertex[0], vertex[1], vertex[2]);
      surface.uv.push(vertex[3], vertex[4]);
      if (selected) {
        const [u, v] = frameCoordinate(selected.frame, vertex[0], vertex[2]);
        surface.paving.push(u, v, selected.frame.length, selected.width);
      }
    }
  }
}
/** Partition existing draped triangles against the UNION of source rectangles.
 * Intersections are assigned once; only their disjoint remainders are considered
 * by subsequent frames, including overlaps and bends. New boundary vertices
 * preserve the original triangle's plane, source UVs and winding. Distant and
 * wholly outside triangles retain their original arrays byte-for-byte.
 *
 * Heritage geometry is already clipped: material shaders must not fade it at
 * frame endpoints, which are internal joins rather than asphalt boundaries.
 */
export function partitionHeritagePaving(
  positions: number[],
  uv: number[],
  frames: HeritageFrame[],
  sidewalk: boolean,
) {
  const plain: Surface = { positions: [], uv: [], paving: [] },
    heritage: Surface = { positions: [], uv: [], paving: [] },
    nearby = frameIndex(frames.map((frame) => prepare(frame, sidewalk)));
  for (let i = 0; i < positions.length; i += 9) {
    const candidates = nearby([
      Math.min(positions[i], positions[i + 3], positions[i + 6]),
      Math.min(positions[i + 2], positions[i + 5], positions[i + 8]),
      Math.max(positions[i], positions[i + 3], positions[i + 6]),
      Math.max(positions[i + 2], positions[i + 5], positions[i + 8]),
    ]);
    if (!candidates.length) {
      plain.positions.push(...positions.slice(i, i + 9));
      plain.uv.push(...uv.slice((i / 3) * 2, (i / 3) * 2 + 6));
      continue;
    }
    const triangle: Vertex[] = [0, 3, 6].map((j) => [
      positions[i + j],
      positions[i + j + 1],
      positions[i + j + 2],
      uv[((i + j) / 3) * 2],
      uv[((i + j) / 3) * 2 + 1],
    ]);
    let remainders = [triangle],
      touched = false;
    for (const selected of candidates) {
      const next: Vertex[][] = [];
      for (const polygon of remainders) {
        if (!overlaps(boundsOf(polygon), selected.bounds)) {
          next.push(polygon);
          continue;
        }
        let intersection = polygon;
        const outside: Vertex[][] = [];
        for (const [nx, nz, minimum] of selected.planes) {
          const pieces = split(
            intersection,
            (vertex) =>
              (vertex[0] - selected.frame.origin[0]) * nx +
              (vertex[2] - selected.frame.origin[1]) * nz -
              minimum,
          );
          if (pieces.outside.length >= 3) outside.push(pieces.outside);
          intersection = pieces.inside;
          if (intersection.length < 3) break;
        }
        if (intersection.length >= 3) {
          const previous = heritage.positions.length;
          emit(heritage, intersection, selected);
          touched ||= heritage.positions.length > previous;
          next.push(...outside);
        } else {
          // No area enters this frame: preserve the original polygon rather
          // than keeping subdivisions from failed rectangle intersections.
          next.push(polygon);
        }
      }
      remainders = next;
      if (!remainders.length) break;
    }
    if (touched) {
      for (const polygon of remainders) emit(plain, polygon);
    } else {
      plain.positions.push(...positions.slice(i, i + 9));
      plain.uv.push(...uv.slice((i / 3) * 2, (i / 3) * 2 + 6));
    }
  }
  return { plain, heritage };
}
