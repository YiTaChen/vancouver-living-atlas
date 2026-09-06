import * as THREE from 'three';
type Point = [number, number];
type Triangle = { p: number[]; bounds: number[] };
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function clip(poly: Point[], a: Point, b: Point, sign: number) {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length],
      dp = cross(a, b, p) * sign,
      dq = cross(a, b, q) * sign;
    if (dp >= -1e-8) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
function height(p: number[], x: number, z: number) {
  const a: Point = [p[0], p[2]],
    b: Point = [p[3], p[5]],
    c: Point = [p[6], p[8]],
    q: Point = [x, z];
  const area = cross(a, b, c),
    u = cross(q, b, c) / area,
    v = cross(a, q, c) / area;
  return u * p[1] + v * p[4] + (1 - u - v) * p[7];
}
/** Clip a path footprint into actual terrain triangles, rather than sampling a
 * different DEM surface. Every unblended output triangle is parallel to its
 * supporting ground face. Built once; no per-frame queries or extra draw calls.
 */
export class TerrainPathDraper {
  private cells = new Map<string, Triangle[]>();
  private connectors = new Map<string, Point[]>();
  constructor(geometry: THREE.BufferGeometry, connectors: Point[] = []) {
    for (const p of connectors) {
      const key = `${Math.floor(p[0] / 32)},${Math.floor(p[1] / 32)}`;
      const cell = this.connectors.get(key);
      if (cell) cell.push(p);
      else this.connectors.set(key, [p]);
    }
    const pos = geometry.getAttribute('position'),
      idx = geometry.index;
    for (let i = 0; i < (idx?.count ?? pos.count); i += 3) {
      const p: number[] = [];
      for (let j = 0; j < 3; j++) {
        const n = idx ? idx.getX(i + j) : i + j;
        p.push(pos.getX(n), pos.getY(n), pos.getZ(n));
      }
      if (Math.abs(cross([p[0], p[2]], [p[3], p[5]], [p[6], p[8]])) < 1e-8)
        continue;
      const bounds = [
        Math.min(p[0], p[3], p[6]),
        Math.min(p[2], p[5], p[8]),
        Math.max(p[0], p[3], p[6]),
        Math.max(p[2], p[5], p[8]),
      ];
      const tri = { p, bounds };
      for (
        let x = Math.floor(bounds[0] / 32);
        x <= Math.floor(bounds[2] / 32);
        x++
      )
        for (
          let z = Math.floor(bounds[1] / 32);
          z <= Math.floor(bounds[3] / 32);
          z++
        ) {
          const key = `${x},${z}`,
            cell = this.cells.get(key);
          if (cell) cell.push(tri);
          else this.cells.set(key, [tri]);
        }
    }
  }
  drape(source: THREE.BufferGeometry) {
    const src = source.getAttribute('position'),
      result: number[] = [];
    for (let i = 0; i < src.count; i += 3) {
      const p: number[] = [];
      for (let j = 0; j < 3; j++)
        p.push(src.getX(i + j), src.getY(i + j), src.getZ(i + j));
      const footprint: Point[] = [
        [p[0], p[2]],
        [p[3], p[5]],
        [p[6], p[8]],
      ];
      if (Math.abs(cross(...(footprint as [Point, Point, Point]))) < 1e-8)
        continue;
      const xmin = Math.min(p[0], p[3], p[6]),
        xmax = Math.max(p[0], p[3], p[6]),
        zmin = Math.min(p[2], p[5], p[8]),
        zmax = Math.max(p[2], p[5], p[8]);
      const candidates = new Set<Triangle>();
      for (let x = Math.floor(xmin / 32); x <= Math.floor(xmax / 32); x++)
        for (let z = Math.floor(zmin / 32); z <= Math.floor(zmax / 32); z++)
          for (const t of this.cells.get(`${x},${z}`) || []) candidates.add(t);
      const before = result.length;
      for (const t of candidates) {
        if (
          t.bounds[0] > xmax ||
          t.bounds[2] < xmin ||
          t.bounds[1] > zmax ||
          t.bounds[3] < zmin
        )
          continue;
        const v: Point[] = [
            [t.p[0], t.p[2]],
            [t.p[3], t.p[5]],
            [t.p[6], t.p[8]],
          ],
          sign = Math.sign(cross(v[0], v[1], v[2]));
        let poly = footprint;
        for (let k = 0; k < 3 && poly.length; k++)
          poly = clip(poly, v[k], v[(k + 1) % 3], sign);
        for (let k = 1; k < poly.length - 1; k++) {
          const verts = [poly[0], poly[k], poly[k + 1]];
          if (Math.abs(cross(verts[0], verts[1], verts[2])) < 1e-8) continue;
          for (const [x, z] of verts) {
            const ground = height(t.p, x, z) + 0.045;
            // Preserve shared endpoints with source-owned bridge/coast paths.
            let distance = Infinity;
            const cx = Math.floor(x / 32),
              cz = Math.floor(z / 32);
            for (let ix = cx - 1; ix <= cx + 1; ix++)
              for (let iz = cz - 1; iz <= cz + 1; iz++)
                for (const c of this.connectors.get(`${ix},${iz}`) || [])
                  distance = Math.min(distance, Math.hypot(x - c[0], z - c[1]));
            const u = THREE.MathUtils.clamp((distance - 4) / 20, 0, 1),
              blend = u * u * (3 - 2 * u);
            result.push(
              x,
              THREE.MathUtils.lerp(
                Math.max(height(p, x, z), ground),
                ground,
                blend,
              ),
              z,
            );
          }
        }
      }
      // Keep unsupported geometry unchanged; never invent land over water.
      if (result.length === before) result.push(...p);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(result, 3),
    );
    geometry.computeVertexNormals();
    return geometry;
  }
}
