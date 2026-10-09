import type { RoadEdge, RoadGraph } from '../road-graph';
import type { Point3 } from './population';

export interface SidewalkRoute {
  routeId: string;
  surfaceId: 'ground';
  layer: 0;
  validated: true;
  loop: true;
  /** An out-and-back on one footway; never a fabricated intersection crossing. */
  lengthM: number;
  offsetFromCurbM: number;
  sourceWindow: number;
  sourceStartM: number;
  sourceEndM: number;
  points: Point3[];
  cumulative: number[];
}
export interface FloorProof {
  y: number;
  surfaceId: string;
  layer: number;
  protectedSurface?: boolean;
}
export type FloorProbe = (x: number, z: number) => FloorProof | undefined;

/** Actual source-world tree centres, indexed once on first street activation.
 * The conservative trunk radius is at least .6m, plus .35m for arms/body.
 * Segment distance avoids missing a trunk between two .75m floor samples. */
export class TrunkClearanceIndex {
  private bins = new Map<string, { x: number; z: number; radiusM: number }[]>();
  private maxRadius = 0.6;
  readonly count: number;
  constructor(trees: readonly { x: number; z: number; radiusM?: number }[]) {
    let count = 0;
    for (const tree of trees) {
      const radiusM = Math.max(0.6, tree.radiusM ?? 0.6);
      if (
        ![tree.x, tree.z, radiusM].every(Number.isFinite) ||
        radiusM > 10 ||
        !Number.isSafeInteger(Math.floor(tree.x / 16)) ||
        !Number.isSafeInteger(Math.floor(tree.z / 16))
      )
        throw new Error('Invalid source tree clearance');
      const key = `${Math.floor(tree.x / 16)},${Math.floor(tree.z / 16)}`;
      const bucket = this.bins.get(key) ?? [];
      bucket.push({ x: tree.x, z: tree.z, radiusM });
      this.bins.set(key, bucket);
      this.maxRadius = Math.max(this.maxRadius, radiusM);
      count++;
    }
    this.count = count;
  }
  clearSegment(a: Point3, b: Point3) {
    if (
      ![...a, ...b].every(Number.isFinite) ||
      ![a[0], a[2], b[0], b[2]].every((v) =>
        Number.isSafeInteger(Math.floor(v / 16)),
      )
    )
      return false;
    const pad = this.maxRadius + 0.35,
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      length2 = dx * dx + dz * dz;
    if (
      (Math.floor((Math.max(a[0], b[0]) + pad) / 16) -
        Math.floor((Math.min(a[0], b[0]) - pad) / 16) +
        1) *
        (Math.floor((Math.max(a[2], b[2]) + pad) / 16) -
          Math.floor((Math.min(a[2], b[2]) - pad) / 16) +
          1) >
      64
    )
      return false;
    for (
      let x = Math.floor((Math.min(a[0], b[0]) - pad) / 16);
      x <= Math.floor((Math.max(a[0], b[0]) + pad) / 16);
      x++
    )
      for (
        let z = Math.floor((Math.min(a[2], b[2]) - pad) / 16);
        z <= Math.floor((Math.max(a[2], b[2]) + pad) / 16);
        z++
      )
        for (const tree of this.bins.get(`${x},${z}`) ?? []) {
          const t = length2
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((tree.x - a[0]) * dx + (tree.z - a[2]) * dz) / length2,
                ),
              )
            : 0;
          if (
            Math.hypot(tree.x - a[0] - dx * t, tree.z - a[2] - dz * t) <=
            tree.radiusM + 0.35
          )
            return false;
        }
    return true;
  }
}

export interface SidewalkRouteOptions {
  offsetFromCurbM?: number;
  /** Fixed source station window; never a camera-relative moving route. */
  windowIndex?: number;
  clearSegment?: (a: Point3, b: Point3) => boolean;
}

export const SIDEWALK_WINDOW_M = 80;
export const SIDEWALK_MAX_WINDOWS_PER_EDGE = 512;
export interface SidewalkStationWindow {
  windowIndex: number;
  startM: number;
  endM: number;
  a: readonly [number, number];
  b: readonly [number, number];
}

/** Cover the actual source segment with stable, bounded station runs. Only the
 * source junctions receive a 10m trim; interior windows are not fake junctions.
 * Invalid/unreasonably large sources fail closed instead of expanding a grid. */
export function sidewalkStationWindow(
  graph: RoadGraph,
  edge: RoadEdge,
  windowIndex: number,
): SidewalkStationWindow | null {
  if (
    !sidewalkEdgeEligible(graph, edge) ||
    !Number.isSafeInteger(windowIndex) ||
    windowIndex < 0 ||
    windowIndex >= SIDEWALK_MAX_WINDOWS_PER_EDGE
  )
    return null;
  const a = graph.nodes[edge.a].point,
    b = graph.nodes[edge.b].point,
    dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = Math.hypot(dx, dz);
  if (
    !Number.isFinite(length) ||
    length < 28 ||
    length > SIDEWALK_WINDOW_M * SIDEWALK_MAX_WINDOWS_PER_EDGE + 20 ||
    ![...a, ...b].every((v) => Number.isSafeInteger(Math.floor(v / 100)))
  )
    return null;
  const startM = 10 + windowIndex * SIDEWALK_WINDOW_M,
    endM = Math.min(length - 10, startM + SIDEWALK_WINDOW_M);
  // Preserve the minimum useful run from the original 28m edge requirement.
  // A final shorter fragment remains empty rather than fabricating a tiny loop.
  if (endM - startM < 8) return null;
  return {
    windowIndex,
    startM,
    endM,
    a: [a[0] + (dx / length) * startM, a[1] + (dz / length) * startM],
    b: [a[0] + (dx / length) * endM, a[1] + (dz / length) * endM],
  };
}

/** The source graph's ground tag does not grant protected route access. */
export function sidewalkEdgeEligible(graph: RoadGraph, edge: RoadEdge) {
  const a = graph.nodes[edge.a],
    b = graph.nodes[edge.b];
  return (
    !!a &&
    !!b &&
    a.level === 'ground' &&
    b.level === 'ground' &&
    a.point.every(Number.isFinite) &&
    b.point.every(Number.isFinite) &&
    !edge.classes.some((c) =>
      /lane|private|non.city|bikeway|motorway|freeway|bridge|causeway/i.test(c),
    ) &&
    !edge.names.some((n) => /bridge|causeway|viaduct/i.test(n)) &&
    Number.isFinite(edge.width) &&
    edge.width > 0 &&
    Number.isFinite(edge.corridorWidth) &&
    edge.corridorWidth - edge.width >= 3.5
  );
}

/** Probe the actual rendered footway every <=0.75m, including both endpoints.
 * A road centreline provides direction only; it is never accepted as a floor.
 * Missing/clipped paving, building collisions, grade, and layer gaps reject a run.
 */
export function validatedSidewalkRoute(
  graph: RoadGraph,
  edge: RoadEdge,
  side: -1 | 1,
  probe: FloorProbe,
  options: SidewalkRouteOptions = {},
): SidewalkRoute | null {
  const a = graph.nodes[edge.a],
    b = graph.nodes[edge.b];
  const windowIndex = options.windowIndex ?? 0;
  const window = sidewalkStationWindow(graph, edge, windowIndex);
  if (!window || (side !== -1 && side !== 1)) return null;
  const dx = b.point[0] - a.point[0],
    dz = b.point[1] - a.point[1];
  const length = Math.hypot(dx, dz);
  const start = window.startM,
    end = window.endM;
  const offsetFromCurbM = options.offsetFromCurbM ?? 1;
  if (
    !Number.isFinite(offsetFromCurbM) ||
    offsetFromCurbM < 0.35 ||
    offsetFromCurbM + 0.35 > (edge.corridorWidth - edge.width) / 2
  )
    return null;
  const offset = edge.width / 2 + offsetFromCurbM;
  const count = Math.ceil((end - start) / 0.75),
    points: Point3[] = [];
  const cumulative = [0];
  for (let i = 0; i <= count; i++) {
    const along = start + ((end - start) * i) / count;
    const x =
      a.point[0] + (dx / length) * along - (dz / length) * offset * side;
    const z =
      a.point[1] + (dz / length) * along + (dx / length) * offset * side;
    const floor = probe(x, z);
    if (
      !floor ||
      floor.surfaceId !== 'ground' ||
      floor.layer !== 0 ||
      floor.protectedSurface ||
      !Number.isFinite(floor.y)
    )
      return null;
    // Prove the body/arms remain on real same-layer paving, including the
    // inner edge; a narrow clipped strip is not permission to walk on asphalt.
    for (const lateral of [-0.35, 0.35]) {
      const margin = probe(
        x - (dz / length) * lateral,
        z + (dx / length) * lateral,
      );
      if (
        !margin ||
        margin.surfaceId !== 'ground' ||
        margin.layer !== 0 ||
        margin.protectedSurface ||
        !Number.isFinite(margin.y) ||
        Math.abs(margin.y - floor.y) > 0.1
      )
        return null;
    }
    const point: Point3 = [x, floor.y + 0.015, z];
    const previous = points.at(-1);
    if (options.clearSegment && !options.clearSegment(previous ?? point, point))
      return null;
    if (previous) {
      const horizontal = Math.hypot(x - previous[0], z - previous[2]);
      if (Math.abs(point[1] - previous[1]) > horizontal * 0.2 + 0.001)
        return null;
      cumulative.push(
        cumulative.at(-1)! +
          Math.hypot(x - previous[0], point[1] - previous[1], z - previous[2]),
      );
    }
    points.push(point);
  }
  return {
    routeId: `footway:${edge.id}:${side}:run${windowIndex}`,
    surfaceId: 'ground',
    layer: 0,
    validated: true,
    loop: true,
    lengthM: cumulative.at(-1)! * 2,
    offsetFromCurbM,
    sourceWindow: windowIndex,
    sourceStartM: start,
    sourceEndM: end,
    points,
    cumulative,
  };
}

export function sampleSidewalkRoute(route: SidewalkRoute, stationM: number) {
  if (
    !Number.isFinite(stationM) ||
    !Number.isFinite(route.lengthM) ||
    route.lengthM <= 0
  )
    throw new Error('Invalid sidewalk station');
  const half = route.lengthM / 2;
  const cycle = ((stationM % route.lengthM) + route.lengthM) % route.lengthM;
  const reverse = cycle > half,
    distance = reverse ? route.lengthM - cycle : cycle;
  let low = 0,
    high = route.cumulative.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (route.cumulative[middle] <= distance) low = middle;
    else high = middle;
  }
  const a = route.points[low],
    b = route.points[high];
  const t = Math.min(
    1,
    (distance - route.cumulative[low]) /
      (route.cumulative[high] - route.cumulative[low]),
  );
  const position: Point3 = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  return {
    position,
    yawRadians: Math.atan2(b[0] - a[0], b[2] - a[2]) + (reverse ? Math.PI : 0),
  };
}
