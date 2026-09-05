import { project, unproject, rings, inPolygon } from './geo';
import type { FeatureCollection } from './types';
export interface WaterSurface {
  id: string;
  name: string;
  kind: 'sea' | 'lake';
  level: number;
  polygon?: number[][][];
  navigable: boolean;
}
interface Edge {
  a: number[];
  b: number[];
}
const segmentDistance = (p: number[], a: number[], b: number[]) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    l = dx * dx + dz * dz;
  const t = l
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
};
const cross = (a: number[], b: number[], c: number[]) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function edgeDistance(a: number[], b: number[], c: number[], d: number[]) {
  if (
    cross(a, b, c) * cross(a, b, d) < 0 &&
    cross(c, d, a) * cross(c, d, b) < 0
  )
    return 0;
  return Math.min(
    segmentDistance(a, c, d),
    segmentDistance(b, c, d),
    segmentDistance(c, a, b),
    segmentDistance(d, a, b),
  );
}
export function lakeSurfaces(
  context: FeatureCollection,
  elevation: (x: number, z: number) => number,
): WaterSurface[] {
  return context.features
    .filter((f) => f.properties.class === 'water')
    .flatMap((f) =>
      rings(f).map((p, i) => {
        const polygon = p.map((r) => r.map(project)),
          boundary = polygon[0];
        const heights = boundary
          .map((v) => elevation(v[0], v[1]))
          .sort((a, b) => a - b);
        const area =
          Math.abs(
            boundary.reduce((sum, a, i) => {
              const b = boundary[(i + 1) % boundary.length];
              return sum + a[0] * b[1] - b[0] * a[1];
            }, 0),
          ) / 2;
        return {
          id: `lake-${f.properties.id}-${i}`,
          name: String(f.properties.name || 'Lake'),
          kind: 'lake' as const,
          polygon,
          level: heights[Math.floor(heights.length * 0.22)] + 1.2,
          navigable:
            ['lake', 'lagoon'].includes(f.properties.water) && area > 4000,
        };
      }),
    );
}
export class WaterWorld {
  sea: WaterSurface = {
    id: 'sea',
    name: 'Burrard Inlet / False Creek',
    kind: 'sea',
    level: 0.1,
    navigable: true,
  };
  surfaces: WaterSurface[];
  edges = new Map<string, Edge[]>();
  obstacles = new Map<string, number[][][][]>();
  regional: number[][][][];
  constructor(
    public core: number[][][][],
    regionalData: FeatureCollection,
    surfaces: WaterSurface[],
    buildings: FeatureCollection,
    landmarks: FeatureCollection,
  ) {
    this.surfaces = surfaces;
    this.regional = regionalData.features.flatMap((f) =>
      rings(f).map((p) => p.map((r) => r.map(project))),
    );
    for (const p of core) this.index(p, 'core');
    for (const p of this.regional) this.index(p, 'regional');
    this.indexSeams();
    const lo = project([-123.23, 49.337]),
      hi = project([-123.087, 49.258]);
    this.index([
      [
        [lo[0], lo[1]],
        [hi[0], lo[1]],
        [hi[0], hi[1]],
        [lo[0], hi[1]],
        [lo[0], lo[1]],
      ],
    ]);
    for (const s of surfaces) if (s.polygon) this.index(s.polygon);
    for (const f of [...buildings.features, ...landmarks.features]) {
      // Grounded footprint obstacles include over-water terminal/pier massings.
      if (Number(f.properties.minHeight || 0) > 3) continue;
      for (const p of rings(f)) this.addObstacle(p.map((r) => r.map(project)));
    }
  }
  indexSeams() {
    const low = project([-123.165, 49.315]),
      high = project([-123.095, 49.267]);
    for (const axis of [0, 1])
      for (const boundary of [low[axis], high[axis]]) {
        const other = 1 - axis,
          cuts = [low[other], high[other]];
        for (const polygon of [...this.core, ...this.regional])
          for (const ring of polygon)
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i],
                b = ring[(i + 1) % ring.length];
              if (a[axis] === b[axis]) continue;
              const t = (boundary - a[axis]) / (b[axis] - a[axis]);
              if (t < 0 || t > 1) continue;
              const value = a[other] + t * (b[other] - a[other]);
              if (value > low[other] && value < high[other]) cuts.push(value);
            }
        cuts.sort((a, b) => a - b);
        for (let i = 1; i < cuts.length; i++) {
          if (cuts[i] - cuts[i - 1] < 0.001) continue;
          const a = [0, 0],
            b = [0, 0];
          a[axis] = boundary;
          b[axis] = boundary;
          a[other] = cuts[i - 1];
          b[other] = cuts[i];
          const p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
            q = [...p];
          p[axis] -= 0.01;
          q[axis] += 0.01;
          // Retain only actual water/land discontinuities, never all study borders.
          if (Boolean(this.at(p[0], p[1])) !== Boolean(this.at(q[0], q[1])))
            this.index([[a, b]]);
        }
      }
  }
  index(poly: number[][][], mask?: 'core' | 'regional') {
    const low = project([-123.165, 49.315]),
      high = project([-123.095, 49.267]);
    for (const ring of poly)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          cuts = [0, 1];
        if (mask) {
          for (const axis of [0, 1])
            for (const bound of [low[axis], high[axis]]) {
              const t = (bound - a[axis]) / (b[axis] - a[axis]);
              if (t > 0 && t < 1) cuts.push(t);
            }
        }
        cuts.sort((a, b) => a - b);
        for (let j = 1; j < cuts.length; j++) {
          const t0 = cuts[j - 1],
            t1 = cuts[j],
            mid = (t0 + t1) / 2,
            m = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
          if (mask) {
            // Dataset clipping edges are not physical seawalls.
            if (
              [0, 1].some((axis) =>
                [low[axis], high[axis]].some(
                  (bound) =>
                    Math.abs(a[axis] - bound) < 0.01 &&
                    Math.abs(b[axis] - bound) < 0.01,
                ),
              )
            )
              continue;
            const inside =
              m[0] >= low[0] &&
              m[0] <= high[0] &&
              m[1] >= low[1] &&
              m[1] <= high[1];
            if (inside !== (mask === 'core')) continue;
          }
          const edge = {
            a: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0],
            b: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1],
          };
          if (Math.hypot(edge.a[0] - edge.b[0], edge.a[1] - edge.b[1]) < 1e-6)
            continue;
          for (
            let x = Math.floor(Math.min(edge.a[0], edge.b[0]) / 40);
            x <= Math.floor(Math.max(edge.a[0], edge.b[0]) / 40);
            x++
          )
            for (
              let z = Math.floor(Math.min(edge.a[1], edge.b[1]) / 40);
              z <= Math.floor(Math.max(edge.a[1], edge.b[1]) / 40);
              z++
            ) {
              const key = x + ',' + z;
              if (!this.edges.has(key)) this.edges.set(key, []);
              this.edges.get(key)!.push(edge);
            }
        }
      }
  }
  addObstacle(poly: number[][][]) {
    const xs = poly[0].map((p) => p[0]),
      zs = poly[0].map((p) => p[1]);
    for (
      let x = Math.floor(Math.min(...xs) / 40);
      x <= Math.floor(Math.max(...xs) / 40);
      x++
    )
      for (
        let z = Math.floor(Math.min(...zs) / 40);
        z <= Math.floor(Math.max(...zs) / 40);
        z++
      ) {
        const key = x + ',' + z;
        if (!this.obstacles.has(key)) this.obstacles.set(key, []);
        this.obstacles.get(key)!.push(poly);
      }
    this.index(poly);
  }
  at(x: number, z: number): WaterSurface | null {
    if (!Number.isFinite(x + z)) return null;
    const [lon, lat] = unproject(x, z);
    // Stay in the mapped harbour/context region, not an infinite ocean plane.
    if (lon < -123.23 || lon > -123.087 || lat < 49.258 || lat > 49.337)
      return null;
    const lake = this.surfaces.find(
      (s) => s.polygon && inPolygon([x, z], s.polygon),
    );
    if (lake) return lake.navigable ? lake : null;
    const core =
      lon >= -123.165 && lon <= -123.095 && lat >= 49.267 && lat <= 49.315;
    if ((core ? this.core : this.regional).some((p) => inPolygon([x, z], p)))
      return null;
    return this.sea;
  }
  canOccupy(
    x: number,
    z: number,
    yaw: number,
    id?: string,
    halfLength = 3.5,
    radius = 1.35,
  ) {
    const surface = this.at(x, z);
    if (!surface || (id && surface.id !== id)) return false;
    const inner = Math.max(0, halfLength - radius),
      dx = Math.sin(yaw) * inner,
      dz = Math.cos(yaw) * inner;
    const a = [x - dx, z - dz],
      b = [x + dx, z + dz];
    for (const p of [a, b, [x, z]]) {
      if (this.at(p[0], p[1])?.id !== surface.id) return false;
      if (
        (
          this.obstacles.get(
            Math.floor(p[0] / 40) + ',' + Math.floor(p[1] / 40),
          ) || []
        ).some((poly) => inPolygon(p, poly))
      )
        return false;
    }
    const checked = new Set<Edge>();
    for (
      let gx = Math.floor((x - halfLength - radius) / 40);
      gx <= Math.floor((x + halfLength + radius) / 40);
      gx++
    )
      for (
        let gz = Math.floor((z - halfLength - radius) / 40);
        gz <= Math.floor((z + halfLength + radius) / 40);
        gz++
      )
        for (const edge of this.edges.get(gx + ',' + gz) || []) {
          if (checked.has(edge)) continue;
          checked.add(edge);
          if (edgeDistance(a, b, edge.a, edge.b) <= radius + 0.25) return false;
        }
    return true;
  }
  start(id: string) {
    const seaPoints: Record<string, number[]> = {
      'coal-harbour': [-123.125, 49.295],
      'false-creek': [-123.133, 49.273],
    };
    if (seaPoints[id]) {
      const [x, z] = project(seaPoints[id]);
      if (this.canOccupy(x, z, 0, 'sea')) return { x, z, surface: this.sea };
      return null;
    }
    const surface = this.surfaces.find(
      (s) =>
        s.navigable &&
        s.name
          .toLowerCase()
          .includes(id === 'beaver' ? 'beaver' : 'lost lagoon'),
    );
    if (!surface?.polygon) return null;
    const ring = surface.polygon[0],
      xs = ring.map((p) => p[0]),
      zs = ring.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (let radius = 0; radius < 300; radius += 8)
      for (let angle = 0; angle < Math.PI * 2; angle += 0.4) {
        const x = cx + Math.sin(angle) * radius,
          z = cz + Math.cos(angle) * radius;
        if (this.canOccupy(x, z, 0, surface.id)) return { x, z, surface };
      }
    return null;
  }
}
export function waveHeight(
  kind: 'sea' | 'lake',
  x: number,
  z: number,
  time: number,
) {
  if (kind === 'lake')
    return (
      0.013 * Math.sin(x * 0.15 + time * 0.8) +
      0.008 * Math.cos(z * 0.19 - time * 0.6)
    );
  return (
    0.24 * Math.sin(x * 0.14 + z * 0.09 - time * 1.15) +
    0.13 * Math.sin(z * 0.29 - x * 0.11 - time * 1.65) +
    0.045 * Math.sin(x * 0.64 + z * 0.3 - time * 2.4)
  );
}
