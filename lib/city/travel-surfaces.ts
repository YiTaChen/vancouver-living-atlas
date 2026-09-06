import type { SurfaceHit, SurfaceIdentity } from './surface-reachability';

export interface TravelSurface extends SurfaceIdentity {
  routeId: string;
  allowedModes: readonly ('walk' | 'drive')[];
  /** Non-indexed world-space physical top triangles, identical to rendered vertices. */
  triangles: readonly number[];
}
interface Triangle {
  p: readonly number[];
  inverse: number;
  owner: TravelSurface;
}
/** Spatially indexed physical floors. Y proximity NEVER selects a floor. */
export class TravelSurfaceIndex {
  private cells = new Map<string, Triangle[]>();
  readonly surfaceIds = new Set<string>();
  constructor(readonly surfaces: readonly TravelSurface[]) {
    for (const owner of surfaces) {
      this.surfaceIds.add(owner.surfaceId);
      if (owner.triangles.length % 9)
        throw new Error('Incomplete travel surface triangle');
      for (let i = 0; i < owner.triangles.length; i += 9) {
        const p = owner.triangles.slice(i, i + 9);
        if (!p.every(Number.isFinite))
          throw new Error('Non-finite travel surface');
        const area =
          (p[3] - p[0]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[6] - p[0]);
        if (Math.abs(area) < 1e-10) continue;
        const triangle = { p, inverse: 1 / area, owner };
        const minX = Math.floor((Math.min(p[0], p[3], p[6]) - 0.0005) / 64),
          maxX = Math.floor((Math.max(p[0], p[3], p[6]) + 0.0005) / 64);
        const minZ = Math.floor((Math.min(p[2], p[5], p[8]) - 0.0005) / 64),
          maxZ = Math.floor((Math.max(p[2], p[5], p[8]) + 0.0005) / 64);
        for (let x = minX; x <= maxX; x++)
          for (let z = minZ; z <= maxZ; z++) {
            const key = `${x},${z}`,
              cell = this.cells.get(key) || [];
            cell.push(triangle);
            this.cells.set(key, cell);
          }
      }
    }
  }
  /** Conservative horizontal canopy/road clearance for procedural vegetation. */
  overlapsDisk(x: number, z: number, radius: number) {
    const radius2 = radius * radius;
    for (
      let cx = Math.floor((x - radius) / 64);
      cx <= Math.floor((x + radius) / 64);
      cx++
    )
      for (
        let cz = Math.floor((z - radius) / 64);
        cz <= Math.floor((z + radius) / 64);
        cz++
      )
        for (const { p, inverse } of this.cells.get(`${cx},${cz}`) || []) {
          const dx = x - p[0],
            dz = z - p[2];
          const u = (dx * (p[8] - p[2]) - dz * (p[6] - p[0])) * inverse;
          const v = ((p[3] - p[0]) * dz - (p[5] - p[2]) * dx) * inverse;
          if (u >= 0 && v >= 0 && u + v <= 1) return true;
          for (const [a, b] of [
            [0, 3],
            [3, 6],
            [6, 0],
          ]) {
            const ex = p[b] - p[a],
              ez = p[b + 2] - p[a + 2];
            const t = Math.max(
              0,
              Math.min(
                1,
                ((x - p[a]) * ex + (z - p[a + 2]) * ez) / (ex * ex + ez * ez),
              ),
            );
            if (
              (x - p[a] - ex * t) ** 2 + (z - p[a + 2] - ez * t) ** 2 <=
              radius2
            )
              return true;
          }
        }
    return false;
  }
  lookup = (x: number, z: number): SurfaceHit[] => {
    const hits = new Map<string, SurfaceHit>();
    for (const { p, inverse, owner } of this.cells.get(
      `${Math.floor(x / 64)},${Math.floor(z / 64)}`,
    ) || []) {
      const dx = x - p[0],
        dz = z - p[2];
      const u = (dx * (p[8] - p[2]) - dz * (p[6] - p[0])) * inverse;
      const v = ((p[3] - p[0]) * dz - (p[5] - p[2]) * dx) * inverse;
      // At most half a millimetre for Float32 world-vertex rounding. This is
      // geometric edge tolerance, never a bridge/ground height tolerance.
      const scale = 0.0005 * Math.abs(inverse);
      if (
        u < -scale * Math.hypot(p[6] - p[0], p[8] - p[2]) ||
        v < -scale * Math.hypot(p[3] - p[0], p[5] - p[2]) ||
        u + v > 1 + scale * Math.hypot(p[6] - p[3], p[8] - p[5])
      )
        continue;
      const y = p[1] + u * (p[4] - p[1]) + v * (p[7] - p[1]);
      const key = `${owner.surfaceId}|${owner.layer}|${owner.allowedModes.join(',')}`,
        previous = hits.get(key);
      if (!previous || y > previous.y)
        hits.set(key, {
          surfaceId: owner.surfaceId,
          layer: owner.layer,
          y,
          routeId: owner.routeId,
          allowedModes: owner.allowedModes,
          legacySurface: 'bridge',
        });
    }
    return [...hits.values()];
  };
}
