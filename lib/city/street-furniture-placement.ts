import {
  createCrossings,
  measurePath,
  sampleAt,
  sampleStations,
  type Point,
  type RoadEdge,
  type RoadGraph,
  type RoadPath,
} from './road-graph';

export type FurnitureKind = 'cedar-bench' | 'garbage-bin' | 'bicycle-rack';
export interface FurniturePlacement {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  z: number;
  /** Standard Three.js rotation around +Y; unit scale, local +Z faces the footway. */
  yaw: number;
  sourceIds: string[];
  streetNames: string[];
}
/** Source GLB footprint union over both LODs. The bench back extends farther
 * than its front, so its centre is intentionally 5 cm behind the root pivot. */
export const FURNITURE_FOOTPRINTS: Record<
  FurnitureKind,
  { halfX: number; halfZ: number; centerZ: number }
> = {
  'cedar-bench': { halfX: 1.011, halfZ: 0.351, centerZ: -0.05 },
  'garbage-bin': { halfX: 0.291, halfZ: 0.291, centerZ: 0 },
  'bicycle-rack': { halfX: 0.486, halfZ: 0.086, centerZ: 0 },
};
export interface StreetFurniturePlanOptions {
  graph: RoadGraph;
  /** Actual rendered ground footways only; undefined rejects, with no terrain fallback. */
  sidewalkAt: (x: number, z: number) => number | undefined;
  allowed: (x: number, z: number) => boolean;
  /** Root-owned building/entrance, tree, lamp, protected surface and transit exclusions. */
  blocked: (x: number, z: number, radius: number) => boolean;
}
export interface StreetFurniturePlanStats {
  paths: number;
  candidates: number;
  accepted: number;
  rejected: Record<string, number>;
  byKind: Record<FurnitureKind, number>;
  cap: number;
}

interface Footprint {
  x: number;
  z: number;
  yaw: number;
  halfX: number;
  halfZ: number;
}
const CELL_M = 16;
const MAX_COORDINATE_M = 10_000_000;
const PLAN_CAP = 256;
const validCoordinate = (v: number) =>
  Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE_M;

/** Bounded local broadphase; no city traversal on collision queries. */
class FootprintGrid {
  private readonly bins = new Map<string, Footprint[]>();
  add(footprint: Footprint) {
    const radius = Math.hypot(footprint.halfX, footprint.halfZ);
    if (
      ![footprint.x, footprint.z].every(validCoordinate) ||
      ![footprint.yaw, footprint.halfX, footprint.halfZ].every(
        Number.isFinite,
      ) ||
      footprint.halfX < 0 ||
      footprint.halfZ < 0 ||
      radius > 96
    )
      throw new Error('Invalid street furniture footprint');
    for (
      let x = Math.floor((footprint.x - radius) / CELL_M);
      x <= Math.floor((footprint.x + radius) / CELL_M);
      x++
    )
      for (
        let z = Math.floor((footprint.z - radius) / CELL_M);
        z <= Math.floor((footprint.z + radius) / CELL_M);
        z++
      ) {
        const key = `${x},${z}`;
        const values = this.bins.get(key) ?? [];
        values.push(footprint);
        this.bins.set(key, values);
      }
  }
  blocked(x: number, z: number, radius = 0): boolean {
    if (
      ![x, z].every(validCoordinate) ||
      !Number.isFinite(radius) ||
      radius < 0 ||
      radius > 16
    )
      return true;
    for (
      let xx = Math.floor((x - radius) / CELL_M);
      xx <= Math.floor((x + radius) / CELL_M);
      xx++
    )
      for (
        let zz = Math.floor((z - radius) / CELL_M);
        zz <= Math.floor((z + radius) / CELL_M);
        zz++
      )
        for (const footprint of this.bins.get(`${xx},${zz}`) ?? []) {
          const dx = x - footprint.x;
          const dz = z - footprint.z;
          const cos = Math.cos(footprint.yaw);
          const sin = Math.sin(footprint.yaw);
          const localX = cos * dx - sin * dz;
          const localZ = sin * dx + cos * dz;
          const gapX = Math.max(0, Math.abs(localX) - footprint.halfX);
          const gapZ = Math.max(0, Math.abs(localZ) - footprint.halfZ);
          if (gapX * gapX + gapZ * gapZ <= radius * radius + 1e-10) return true;
        }
    return false;
  }
}
function placementFootprint(placement: FurniturePlacement): Footprint {
  const shape = FURNITURE_FOOTPRINTS[placement.kind];
  if (!shape) throw new Error('Invalid street furniture kind');
  return {
    x: placement.x + Math.sin(placement.yaw) * shape.centerZ,
    z: placement.z + Math.cos(placement.yaw) * shape.centerZ,
    yaw: placement.yaw,
    halfX: shape.halfX,
    halfZ: shape.halfZ,
  };
}
/** Physical occupancy does not depend on quality, visibility or the selected LOD. */
export class StreetFurnitureBlockers {
  private readonly grid = new FootprintGrid();
  constructor(placements: readonly FurniturePlacement[]) {
    for (const placement of placements)
      this.grid.add(placementFootprint(placement));
  }
  blocked(x: number, z: number, radius = 0) {
    return this.grid.blocked(x, z, radius);
  }
}

function edgeEligible(graph: RoadGraph, edge: RoadEdge | undefined) {
  return (
    !!edge &&
    graph.nodes[edge.a]?.level === 'ground' &&
    graph.nodes[edge.b]?.level === 'ground' &&
    [edge.width, edge.corridorWidth].every(Number.isFinite) &&
    edge.width > 0 &&
    edge.width <= 60 &&
    edge.corridorWidth <= 100 &&
    (edge.corridorWidth - edge.width) / 2 >= 3.8 &&
    edge.sourceIds.length > 0 &&
    edge.sourceIds.every((id) => id.length > 0) &&
    edge.classes.length > 0 &&
    edge.names.some((name) => name.length > 0) &&
    !edge.classes.some((c) =>
      /lane|private|non.city|bikeway|motorway|freeway|bridge|causeway/i.test(c),
    ) &&
    !edge.names.some((n) => /bridge|causeway|viaduct/i.test(n))
  );
}
const pointKey = (p: Point) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
function canonicalPath(graph: RoadGraph, path: RoadPath) {
  if (
    path.closed ||
    path.points.length < 2 ||
    path.points.length > 65_536 ||
    path.points.some((p) => !p.every(validCoordinate)) ||
    path.edgeIds.length !== path.points.length - 1
  )
    return null;
  const start = path.points[0];
  const end = path.points.at(-1)!;
  const reverse =
    start[0] > end[0] || (start[0] === end[0] && start[1] > end[1]);
  const points = reverse ? [...path.points].reverse() : path.points;
  const edges = reverse ? [...path.edgeIds].reverse() : path.edgeIds;
  const measured = measurePath(points);
  if (
    !Number.isFinite(measured.length) ||
    measured.length < 44 ||
    measured.length > 50_000
  )
    return null;
  const sources = [
    ...new Set(edges.flatMap((id) => graph.edges[id]?.sourceIds ?? [])),
  ].sort();
  if (!sources.length) return null;
  return {
    ...measured,
    edges,
    sources,
    key: `${sources.join('|')}@${pointKey(points[0])}:${pointKey(points.at(-1)!)}`,
    priority: edges.some((id) =>
      graph.edges[id]?.names.some((n) =>
        /^(?:\d+(?:-\d+)?\s+)?(?:ROBSON|WATER) ST$/i.test(n),
      ),
    )
      ? 0
      : 1,
  };
}

/** One preparation pass over stable source-road stations. Coordinates below are
 * local measured offsets, never geographic prop-location claims. Only genuinely
 * wide footways accept new representative props; no sidewalk is widened here. */
export function planStreetFurniture(options: StreetFurniturePlanOptions) {
  const { graph, sidewalkAt, allowed, blocked } = options;
  const placements: FurniturePlacement[] = [];
  const stats: StreetFurniturePlanStats = {
    paths: 0,
    candidates: 0,
    accepted: 0,
    rejected: {},
    cap: PLAN_CAP,
    byKind: { 'cedar-bench': 0, 'garbage-bin': 0, 'bicycle-rack': 0 },
  };
  const reject = (reason: string) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  };
  const occupied = new FootprintGrid();
  const spacing = new FootprintGrid();
  const roadExclusions = new FootprintGrid();
  for (const junction of graph.junctions) {
    const point = graph.nodes[junction.nodeId]?.point;
    const half =
      Math.max(4, ...junction.approaches.map((a) => a.width / 2)) + 7;
    if (point?.every(validCoordinate) && Number.isFinite(half) && half <= 60)
      roadExclusions.add({
        x: point[0],
        z: point[1],
        yaw: 0,
        halfX: half,
        halfZ: half,
      });
  }
  for (const crossing of createCrossings(graph).crossings)
    roadExclusions.add({
      x: crossing.center[0],
      z: crossing.center[1],
      yaw: Math.atan2(-crossing.tangent[1], crossing.tangent[0]),
      halfX: crossing.depth / 2 + 2,
      halfZ: crossing.width / 2 + 2,
    });
  const paths = graph.paths
    .map((path) => canonicalPath(graph, path))
    .filter(
      (path): path is NonNullable<ReturnType<typeof canonicalPath>> =>
        path !== null,
    )
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  const ids = new Set<string>();
  for (const path of paths) {
    stats.paths++;
    for (const station of sampleStations(path, 48, 24, 20, path.length - 20)) {
      const edge = graph.edges[path.edges[station.segment]];
      if (!edgeEligible(graph, edge)) continue;
      const before = sampleAt(path, station.distance - 4);
      const after = sampleAt(path, station.distance + 4);
      if (
        !before ||
        !after ||
        before.tangent[0] * after.tangent[0] +
          before.tangent[1] * after.tangent[1] <
          0.995
      ) {
        reject('bend');
        continue;
      }
      for (const side of [-1, 1] as const) {
        stats.candidates++;
        if (placements.length >= PLAN_CAP) {
          reject('capacity');
          continue;
        }
        const ordinal = Math.round((station.distance - 24) / 48);
        const kinds: readonly FurnitureKind[] = [
          'cedar-bench',
          'garbage-bin',
          'bicycle-rack',
        ];
        const kind = kinds[(((ordinal + (side === 1 ? 1 : 0)) % 3) + 3) % 3];
        const id = `street-furniture:${path.key}:${station.distance}:${side}`;
        if (ids.has(id)) continue;
        const [dx, dz] = station.tangent;
        const nx = -dz * side;
        const nz = dx * side;
        const curb = edge.width / 2;
        const x = station.point[0] + nx * (curb + 1.4);
        const z = station.point[1] + nz * (curb + 1.4);
        const yaw = Math.atan2(-dz * side, dx * side);
        const shape = FURNITURE_FOOTPRINTS[kind];
        const radius =
          Math.hypot(shape.halfX, shape.halfZ) + Math.abs(shape.centerZ);
        if (!allowed(x, z)) {
          reject('outside-region');
          continue;
        }
        if (roadExclusions.blocked(x, z, radius + 0.3)) {
          reject('junction-crossing');
          continue;
        }
        if (
          blocked(x, z, radius + 0.25) ||
          occupied.blocked(x, z, radius + 0.3) ||
          spacing.blocked(x, z, 6)
        ) {
          reject('occupied');
          continue;
        }
        const heights: number[] = [];
        const walkHeights: number[] = [];
        let failure = '';
        const prove = (
          xx: number,
          zz: number,
          clearance: number,
          footprint: boolean,
        ) => {
          if (failure) return;
          if (
            !allowed(xx, zz) ||
            blocked(xx, zz, clearance) ||
            occupied.blocked(xx, zz, clearance)
          ) {
            failure = 'clearance';
            return;
          }
          const y = sidewalkAt(xx, zz);
          if (y === undefined || !Number.isFinite(y)) {
            failure = 'missing-pavement';
            return;
          }
          if (footprint) heights.push(y);
          else walkHeights.push(y);
        };
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        // Sample the complete measured footprint at <=.35m, corners included.
        const countX = Math.max(2, 2 * Math.ceil(shape.halfX / 0.35));
        const countZ = Math.max(2, 2 * Math.ceil(shape.halfZ / 0.35));
        for (let i = 0; i <= countX; i++)
          for (let j = 0; j <= countZ; j++) {
            const localX = -shape.halfX + (shape.halfX * 2 * i) / countX;
            const localZ =
              shape.centerZ - shape.halfZ + (shape.halfZ * 2 * j) / countZ;
            prove(
              x + cos * localX + sin * localZ,
              z - sin * localX + cos * localZ,
              0.06,
              true,
            );
          }
        // A continuous 1.8m strip behind the furnishing, with a .10m gap, is
        // measured through its whole longitudinal approach, not just one width.
        const walkStart = 1.4 + shape.centerZ + shape.halfZ + 0.1;
        const halfRun = shape.halfX + 2;
        const alongCount = 2 * Math.ceil(halfRun / 0.4);
        const acrossCount = 5;
        for (let i = 0; i <= alongCount; i++)
          for (let j = 0; j <= acrossCount; j++) {
            const along = -halfRun + (halfRun * 2 * i) / alongCount;
            const offset = curb + walkStart + (1.8 * j) / acrossCount;
            const xx = station.point[0] + dx * along + nx * offset;
            const zz = station.point[1] + dz * along + nz * offset;
            prove(xx, zz, 0.06, false);
          }
        if (failure) {
          reject(failure);
          continue;
        }
        if (
          Math.max(...heights) - Math.min(...heights) > 0.14 + 1e-8 ||
          Math.max(...walkHeights) - Math.min(...walkHeights) > 0.3 + 1e-8
        ) {
          reject('slope');
          continue;
        }
        const placement: FurniturePlacement = {
          id,
          kind,
          x,
          y: Math.max(...heights) + 0.008,
          z,
          yaw,
          sourceIds: [...new Set(edge.sourceIds)].sort(),
          streetNames: [...new Set(edge.names)].sort(),
        };
        placements.push(placement);
        ids.add(id);
        occupied.add(placementFootprint(placement));
        spacing.add({ x, z, yaw: 0, halfX: 0, halfZ: 0 });
        stats.accepted++;
        stats.byKind[kind]++;
      }
    }
  }
  return { placements, stats };
}
