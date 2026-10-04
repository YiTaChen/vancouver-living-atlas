import { inPolygon } from './geo';
import {
  fitBays,
  hashId,
  windowBounds,
  windowRows,
  type Profile,
} from './facade-profile';

/** Original, metre-scale appearance rules. Source envelopes and navigation stay unchanged. */
export type ArchitecturePart = {
  key: string;
  polygon: number[][][];
  ground: number;
  height: number;
  minHeight: number;
  profile: Profile;
  /** Exposed roof; higher source parts remain clear of decorative equipment. */
  roof: boolean;
  /** Actual body roof descriptor, never inferred again by the detail layer. */
  roofEaveHeight?: number;
  roofExclusions?: number[][][][];
};
/** One original HVAC assembly; all emitted boxes share this source-owned datum. */
export type ArchitectureRoofUnit = {
  sourceKey: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  boxCount: number;
};
export type ArchitectureBox = {
  roofUnit?: ArchitectureRoofUnit;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  color: number;
  surface: 'masonry' | 'metal';
  kind:
    | 'parapet'
    | 'coping'
    | 'equipment'
    | 'vent'
    | 'duct'
    | 'screen'
    | 'cornice'
    | 'sill'
    | 'jamb'
    | 'pier'
    | 'canopy';
};
export type ArchitectureTier = 'roof' | 'street';

const STONE = [0xb8ad98, 0xc3baa8, 0x9b9d94, 0xafa392];
const METAL = [0x677777, 0x777f7d, 0x536563, 0x8b8e85];

function signedArea(r: number[][]) {
  return (
    r.reduce((sum, a, i) => {
      const b = r[(i + 1) % r.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2
  );
}

/** Corners + edges + centre must fit, including holes, before a roof object exists. */
export function roofBoxFits(
  polygon: number[][][],
  x: number,
  z: number,
  width: number,
  depth: number,
  yaw: number,
  exclusions: number[][][][] = [],
) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const rectangle = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([u, v]) => [
    x + u * width * c + v * depth * s,
    z - u * width * s + v * depth * c,
  ]);
  for (const u of [-0.5, 0, 0.5])
    for (const v of [-0.5, 0, 0.5]) {
      const px = x + u * width * c + v * depth * s;
      const pz = z - u * width * s + v * depth * c;
      if (!inPolygon([px, pz], polygon)) return false;
      if (exclusions.some((p) => inPolygon([px, pz], p))) return false;
    }
  const orient = (a: number[], b: number[], p: number[]) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const crosses = (a: number[], b: number[], p: number[], q: number[]) =>
    orient(a, b, p) * orient(a, b, q) < -1e-10 &&
    orient(p, q, a) * orient(p, q, b) < -1e-10;
  // Samples alone miss a narrow concave notch or an entire courtyard enclosed
  // by the rectangle. Boundary tests make roof containment conservative.
  for (const source of [polygon, ...exclusions])
    for (const ring of source) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        if (inPolygon(a, [rectangle])) return false;
        for (let j = 0; j < 4; j++)
          if (crosses(a, b, rectangle[j], rectangle[(j + 1) % 4])) return false;
      }
    }
  return true;
}

/** Every yield bounds work in the streaming manager, including rejected shapes. */
export function* architectureWork(
  parts: readonly ArchitecturePart[],
  tier: ArchitectureTier,
): Generator<ArchitectureBox | null> {
  for (const part of parts) {
    const { polygon, ground, height: h, minHeight: min, profile } = part;
    const ring = polygon[0];
    yield null;
    if (!ring || ring.length < 3 || h < 5 || h > 300) continue;
    const seed = hashId(part.key),
      heritage = profile.kind === 'heritage-brick',
      domestic = profile.kind === 'domestic-cladding',
      wallTop = part.roofEaveHeight ?? h;
    const stone = STONE[seed % STONE.length],
      metal = METAL[(seed >>> 3) % METAL.length];
    const sign = signedArea(ring) > 0 ? 1 : -1;
    const edges = ring
      .map((a, i) => {
        const b = ring[(i + 1) % ring.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1];
        const length = Math.hypot(dx, dz);
        return {
          a,
          dx,
          dz,
          length,
          nx: (sign * dz) / length,
          nz: (-sign * dx) / length,
          yaw: -Math.atan2(dz, dx),
        };
      })
      .filter((e) => e.length > 0.5);
    const edgeBox = (
      edge: (typeof edges)[number],
      width: number,
      bh: number,
      depth: number,
      u: number,
      y: number,
      offset: number,
      kind: ArchitectureBox['kind'],
      color = stone,
      surface: ArchitectureBox['surface'] = 'masonry',
    ): ArchitectureBox => ({
      x: edge.a[0] + edge.dx * u + edge.nx * offset,
      z: edge.a[1] + edge.dz * u + edge.nz * offset,
      y: ground + y,
      width,
      height: bh,
      depth,
      yaw: edge.yaw,
      kind,
      color,
      surface,
    });

    if (tier === 'roof') {
      if (part.roofEaveHeight !== undefined || domestic) {
        // Sloped roofs and small domestic flat roofs never receive the large
        // commercial HVAC/parapet kit. Inset eaves stay inside the source envelope.
        for (const edge of edges) {
          yield null;
          if (edge.length < 2 || edge.length > 50) continue;
          const trim = edgeBox(
            edge,
            Math.max(0.1, edge.length - 0.12),
            0.1,
            0.15,
            0.5,
            wallTop - 0.075,
            -0.08,
            'cornice',
            0xb0b2a7,
          );
          if (
            roofBoxFits(
              polygon,
              trim.x,
              trim.z,
              trim.width,
              trim.depth,
              trim.yaw,
              part.roofExclusions,
            )
          )
            yield trim;
        }
        continue;
      }
      // Thin coping and shadow lines read at district scale without altering measured massing.
      for (const edge of edges) {
        yield null;
        if (edge.length < 2 || edge.length > 180) continue;
        const roofMid = [
          edge.a[0] + edge.dx * 0.5 - edge.nx * 0.3,
          edge.a[1] + edge.dz * 0.5 - edge.nz * 0.3,
        ];
        if (part.roofExclusions?.some((p) => inPolygon(roofMid, p))) continue;
        if (part.roof) {
          const parapet = h < 36 ? 0.48 : 0.68;
          yield edgeBox(
            edge,
            Math.max(0.1, edge.length - 0.2),
            parapet,
            0.24,
            0.5,
            h + parapet / 2,
            -0.19,
            'parapet',
            profile.wallColor,
          );
          yield edgeBox(
            edge,
            edge.length + 0.08,
            0.105,
            0.43,
            0.5,
            h + parapet + 0.03,
            -0.14,
            'coping',
            stone,
          );
        }
        // A podium/crown band gives stepped source parts a deliberate termination.
        if (h - min > 3 && (h < 36 || part.roof)) {
          yield edgeBox(
            edge,
            edge.length + 0.06,
            heritage ? 0.34 : 0.19,
            heritage ? 0.5 : 0.29,
            0.5,
            h - 0.3,
            0.085,
            'cornice',
            stone,
          );
        }
      }
      if (!part.roof) continue;
      const longest = [...edges].sort((a, b) => b.length - a.length)[0];
      if (!longest) continue;
      const yaw = longest.yaw,
        c = Math.cos(yaw),
        s = Math.sin(yaw);
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      const xmin = Math.min(...xs),
        xmax = Math.max(...xs),
        zmin = Math.min(...zs),
        zmax = Math.max(...zs);
      // Search a bounded set of interior positions, rather than trusting a concave centroid.
      const candidates: [number, number][] = [];
      for (const [u, v] of [
        [0.5, 0.5],
        [0.32, 0.4],
        [0.67, 0.6],
        [0.35, 0.7],
        [0.7, 0.3],
      ]) {
        candidates.push([xmin + (xmax - xmin) * u, zmin + (zmax - zmin) * v]);
      }
      let placed = 0;
      const accepted: { x: number; z: number; radius: number }[] = [];
      for (const [x, z] of candidates) {
        yield null;
        const width = 2.2 + (seed % 4) * 0.47,
          depth = 1.65 + ((seed >>> 4) % 3) * 0.4;
        if (
          !roofBoxFits(
            polygon,
            x,
            z,
            width + 2,
            depth + 2,
            yaw,
            part.roofExclusions,
          )
        )
          continue;
        const radius = Math.hypot(width, depth) / 2 + 0.8;
        if (
          accepted.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + radius)
        )
          continue;
        accepted.push({ x, z, radius });
        const bh =
          placed === 0 && h > 50 ? 2.5 : 0.9 + ((seed >>> placed) % 3) * 0.25;
        const roofUnit: ArchitectureRoofUnit = {
          sourceKey: part.key,
          x,
          y: ground + h,
          z,
          width,
          height: bh,
          depth,
          yaw,
          boxCount: placed === 0 ? 7 : 6,
        };
        const unit = (
          w: number,
          hh: number,
          d: number,
          xx: number,
          yy: number,
          zz: number,
          kind: ArchitectureBox['kind'],
          color: number,
          surface: ArchitectureBox['surface'] = 'metal',
        ): ArchitectureBox => ({
          roofUnit,
          x: xx,
          y: ground + h + yy,
          z: zz,
          width: w,
          height: hh,
          depth: d,
          yaw,
          kind,
          color,
          surface,
        });
        yield unit(
          width + 0.25,
          0.15,
          depth + 0.25,
          x,
          0.075,
          z,
          'equipment',
          0x626763,
        );
        yield unit(width, bh, depth, x, 0.15 + bh / 2, z, 'equipment', metal);
        // Shaded louvre stack breaks the equipment silhouette at a low instance cost.
        for (let j = 0; j < 3; j++) {
          yield unit(
            width * 0.83,
            0.075,
            0.1,
            x + s * (depth / 2 + 0.015),
            0.36 + j * Math.min(0.26, bh / 4),
            z + c * (depth / 2 + 0.015),
            'vent',
            0x344445,
          );
        }
        yield unit(
          width * 0.55,
          0.15,
          depth * 0.58,
          x,
          bh + 0.24,
          z,
          'vent',
          0x354744,
        );
        // A small, grounded service duct; never extends outside its checked roof rectangle.
        if (placed === 0)
          yield unit(
            0.5,
            0.35,
            depth + 0.9,
            x - c * width * 0.35,
            0.26,
            z + s * width * 0.35,
            'duct',
            0xabb3a9,
          );
        placed++;
        if (placed >= (h > 30 ? 3 : 2)) break;
      }
      continue;
    }

    // The existing high-rise system supplies tall curtain walls and balconies.
    // This layer targets the missing lowrise and podium street architecture.
    if (h >= 36 || h - min < 4) continue;
    for (const edge of edges) {
      yield null;
      if (edge.length < 4 || edge.length > 100) continue;
      const grid = fitBays(profile, edge.length);
      const rows = windowRows(profile, { minHeightM: min, heightM: wallTop });
      // Gastown already has its own verified storefronts/surrounds. Its new roof
      // is useful, but double-stacking those frames would create z-fighting.
      if (!heritage) {
        for (const row of rows) {
          // Domestic ground openings use shader trim so the representative door
          // can replace one pane without a physical sill crossing the door.
          if (domestic && row === 0) continue;
          for (let bay = 0; bay < Math.min(grid.count, 22); bay++) {
            const w = windowBounds(profile, grid, bay, row),
              mid = (w.left + w.right) / 2;
            const paneWidth = w.right - w.left,
              paneHeight = w.top - w.bottom;
            yield edgeBox(
              edge,
              paneWidth + 0.34,
              0.16,
              0.31,
              mid / edge.length,
              w.bottom - 0.035,
              0.085,
              'sill',
            );
            yield edgeBox(
              edge,
              paneWidth + 0.25,
              0.12,
              0.24,
              mid / edge.length,
              w.top + 0.035,
              0.07,
              'sill',
            );
            for (const side of [-1, 1])
              yield edgeBox(
                edge,
                0.105,
                paneHeight + 0.11,
                0.22,
                (mid + side * (paneWidth / 2 + 0.04)) / edge.length,
                (w.bottom + w.top) / 2,
                0.055,
                'jamb',
                profile.wallColor,
              );
          }
          yield null;
        }
        if (min < 0.1 && !domestic) {
          // Storey datum stays aligned with the ground-window shader. Decorative
          // canopy remains above pedestrian clearance; it is not a new doorway.
          for (let bay = 0; bay <= grid.count; bay++) {
            const u = (grid.originM + bay * grid.pitchM) / edge.length;
            if (u <= 0 || u >= 1) continue;
            yield edgeBox(
              edge,
              0.24,
              Math.max(0.2, profile.groundStoreyM - 1.2),
              0.25,
              u,
              (profile.groundStoreyM + 1.2) / 2,
              0.07,
              'pier',
              stone,
            );
          }
          yield edgeBox(
            edge,
            edge.length,
            0.22,
            0.38,
            0.5,
            profile.groundStoreyM - 0.1,
            0.15,
            'cornice',
            stone,
          );
        }
      }
    }
  }
}
