import * as THREE from 'three';

/** Same explicit floor set for walking and map placement. Elevated routes are
 * picked through their source-owned proxies, never through this ground list. */
export function walkableGroundMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.userData.walkSurface &&
      !object.userData.protectedSurface
    )
      meshes.push(object);
  });
  return meshes;
}

/** Static, explicitly selected ground meshes; world metres, Y up.
 * Build after their transforms are final. Bridge decks should use their own
 * surface logic. Vertex positions are shared; cells contain triangle IDs only.
 */
export class GroundSurfaceIndex {
  private static readonly CELL = 64;
  private readonly vertices: Float64Array;
  private readonly triangles: Uint32Array;
  private readonly inverseAreas: Float64Array;
  private readonly cells = new Map<string, number[]>();

  constructor(meshes: THREE.Mesh[], obstructionMeshes: THREE.Mesh[] = []) {
    // De-duplicate references so shared scene traversal results do not double
    // every road. Separate meshes sharing a geometry still have own transforms.
    // The second explicit source set participates in volume queries only, even
    // if a curb strip includes a sloped or horizontal cap.
    const sampleable = new Set(meshes);
    const usable = [...new Set([...meshes, ...obstructionMeshes])].filter((m) =>
      m.geometry?.getAttribute('position'),
    );
    const vertexCount = usable.reduce(
      (n, m) => n + m.geometry.getAttribute('position').count,
      0,
    );
    this.vertices = new Float64Array(vertexCount * 3);
    const triangleIndices: number[] = [],
      inverseAreas: number[] = [];
    const p = new THREE.Vector3();
    let vertexOffset = 0;
    for (const mesh of usable) {
      mesh.updateWorldMatrix(true, false);
      const geometry = mesh.geometry,
        position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        const offset = (vertexOffset + i) * 3;
        this.vertices[offset] = p.x;
        this.vertices[offset + 1] = p.y;
        this.vertices[offset + 2] = p.z;
      }
      const index = geometry.index,
        available = index?.count ?? position.count;
      const first = Math.max(0, Math.trunc(geometry.drawRange.start));
      const count = geometry.drawRange.count;
      const end = Math.min(
        available,
        count === Infinity ? available : first + Math.max(0, Math.trunc(count)),
      );
      for (let i = first; i + 2 < end; i += 3) {
        const local = index
          ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
          : [i, i + 1, i + 2];
        if (
          local.some(
            (v) => !Number.isInteger(v) || v < 0 || v >= position.count,
          )
        )
          continue;
        const ids = local.map((v) => v + vertexOffset),
          a = ids[0] * 3,
          b = ids[1] * 3,
          c = ids[2] * 3;
        const v = this.vertices;
        const ax = v[a],
          ay = v[a + 1],
          az = v[a + 2];
        const bx = v[b],
          by = v[b + 1],
          bz = v[b + 2];
        const cx = v[c],
          cy = v[c + 1],
          cz = v[c + 2];
        if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite))
          continue;
        const ux = bx - ax,
          uy = by - ay,
          uz = bz - az;
        const vx = cx - ax,
          vy = cy - ay,
          vz = cz - az;
        const area = ux * vz - uz * vx;
        const nx = uy * vz - uz * vy,
          nz = ux * vy - uy * vx;
        const normalLength = Math.hypot(nx, area, nz);
        // Keep real vertical faces for volume queries such as ramp/curb sweeps.
        // They cannot supply a height at XZ, so a zero inverse marks them for
        // sample() to skip without removing their collision geometry.
        if (!Number.isFinite(normalLength) || normalLength === 0) continue;
        const inverseArea =
          sampleable.has(mesh) &&
          Math.abs(area) > normalLength * 1e-6 &&
          Number.isFinite(1 / area)
            ? 1 / area
            : 0;
        const x0 = Math.floor(
          (Math.min(ax, bx, cx) - 0.0005) / GroundSurfaceIndex.CELL,
        );
        const x1 = Math.floor(
          (Math.max(ax, bx, cx) + 0.0005) / GroundSurfaceIndex.CELL,
        );
        const z0 = Math.floor(
          (Math.min(az, bz, cz) - 0.0005) / GroundSurfaceIndex.CELL,
        );
        const z1 = Math.floor(
          (Math.max(az, bz, cz) + 0.0005) / GroundSurfaceIndex.CELL,
        );
        // Unsafe integer cell coordinates cannot be advanced reliably by x++.
        if (![x0, x1, z0, z1].every(Number.isSafeInteger)) continue;
        const id = inverseAreas.length;
        triangleIndices.push(...ids);
        inverseAreas.push(inverseArea);
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const key = `${x},${z}`,
              cell = this.cells.get(key);
            if (cell) cell.push(id);
            else this.cells.set(key, [id]);
          }
      }
      vertexOffset += position.count;
    }
    this.triangles = new Uint32Array(triangleIndices);
    this.inverseAreas = new Float64Array(inverseAreas);
  }

  /** Highest triangle height at XZ within anchorY ±4m, or undefined.
   * Only candidates in the queried 64m cell are examined; no raycast/all-city scan.
   */
  sample(x: number, z: number, anchorY: number): number | undefined {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(anchorY))
      return undefined;
    const cell = this.cells.get(
      `${Math.floor(x / GroundSurfaceIndex.CELL)},${Math.floor(z / GroundSurfaceIndex.CELL)}`,
    );
    if (!cell) return undefined;
    let highest: number | undefined;
    const vertices = this.vertices;
    for (const id of cell) {
      const inverse = this.inverseAreas[id];
      if (inverse === 0) continue;
      const t = id * 3,
        a = this.triangles[t] * 3,
        b = this.triangles[t + 1] * 3,
        c = this.triangles[t + 2] * 3;
      const ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2];
      const bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2];
      const cx = vertices[c],
        cy = vertices[c + 1],
        cz = vertices[c + 2];
      const dx = x - ax,
        dz = z - az;
      const u = (dx * (cz - az) - dz * (cx - ax)) * inverse;
      const v = ((bx - ax) * dz - (bz - az) * dx) * inverse;
      // Half a millimetre in world XZ resolves independently rounded Float32
      // path caps at shared source nodes. It never widens the height window.
      const eps = 0.0005 * Math.abs(inverse);
      if (
        u < -eps * Math.hypot(cx - ax, cz - az) ||
        v < -eps * Math.hypot(bx - ax, bz - az) ||
        u + v > 1 + eps * Math.hypot(cx - bx, cz - bz)
      )
        continue;
      const y = ay + u * (by - ay) + v * (cy - ay);
      if (
        Number.isFinite(y) &&
        Math.abs(y - anchorY) <= 4 &&
        (highest === undefined || y > highest)
      )
        highest = y;
    }
    return highest;
  }

  /** World-space candidate triangles whose AABBs intersect bounds, including
   * vertical curb faces. Only overlapping grid cells are read; spanning faces
   * are returned once. Vectors are independent copies, safe for caller transforms.
   * The caller performs its exact triangle/volume test on these candidates.
   */
  trianglesInBounds(
    bounds: THREE.Box3,
  ): [THREE.Vector3, THREE.Vector3, THREE.Vector3][] {
    const lo = bounds.min,
      hi = bounds.max;
    if (
      bounds.isEmpty() ||
      ![lo.x, lo.y, lo.z, hi.x, hi.y, hi.z].every(Number.isFinite)
    )
      return [];
    const x0 = Math.floor(lo.x / GroundSurfaceIndex.CELL),
      x1 = Math.floor(hi.x / GroundSurfaceIndex.CELL),
      z0 = Math.floor(lo.z / GroundSurfaceIndex.CELL),
      z1 = Math.floor(hi.z / GroundSurfaceIndex.CELL);
    if (![x0, x1, z0, z1].every(Number.isSafeInteger)) return [];
    const result: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [],
      seen = new Set<number>(),
      vertices = this.vertices;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const cell = this.cells.get(`${x},${z}`);
        if (!cell) continue;
        for (const id of cell) {
          if (seen.has(id)) continue;
          seen.add(id);
          const t = id * 3,
            a = this.triangles[t] * 3,
            b = this.triangles[t + 1] * 3,
            c = this.triangles[t + 2] * 3;
          if (
            Math.max(vertices[a], vertices[b], vertices[c]) < lo.x ||
            Math.min(vertices[a], vertices[b], vertices[c]) > hi.x ||
            Math.max(vertices[a + 1], vertices[b + 1], vertices[c + 1]) <
              lo.y ||
            Math.min(vertices[a + 1], vertices[b + 1], vertices[c + 1]) >
              hi.y ||
            Math.max(vertices[a + 2], vertices[b + 2], vertices[c + 2]) <
              lo.z ||
            Math.min(vertices[a + 2], vertices[b + 2], vertices[c + 2]) > hi.z
          )
            continue;
          result.push([
            new THREE.Vector3(vertices[a], vertices[a + 1], vertices[a + 2]),
            new THREE.Vector3(vertices[b], vertices[b + 1], vertices[b + 2]),
            new THREE.Vector3(vertices[c], vertices[c + 1], vertices[c + 2]),
          ]);
        }
      }
    return result;
  }

  /** Exact triangle-union coverage of a local XZ segment, within a height
   * window. Uses the same 0.5mm source-edge tolerance as sample; it never joins
   * geometry outside the caller's height window or sample past a missing strip.
   * Queries are bounded
   * to 16m, 16 cells and 16,384 candidate triangles and otherwise fail closed. */
  coversSegment(
    from: readonly [number, number],
    to: readonly [number, number],
    anchorY: number,
    maxHeightDeltaM = 4,
  ): boolean {
    if (
      ![...from, ...to, anchorY, maxHeightDeltaM].every(Number.isFinite) ||
      maxHeightDeltaM < 0 ||
      maxHeightDeltaM > 4 ||
      Math.hypot(to[0] - from[0], to[1] - from[1]) > 16
    )
      return false;
    const x0 = Math.floor(
        (Math.min(from[0], to[0]) - 0.0005) / GroundSurfaceIndex.CELL,
      ),
      x1 = Math.floor(
        (Math.max(from[0], to[0]) + 0.0005) / GroundSurfaceIndex.CELL,
      ),
      z0 = Math.floor(
        (Math.min(from[1], to[1]) - 0.0005) / GroundSurfaceIndex.CELL,
      ),
      z1 = Math.floor(
        (Math.max(from[1], to[1]) + 0.0005) / GroundSurfaceIndex.CELL,
      );
    if (
      ![x0, x1, z0, z1].every(Number.isSafeInteger) ||
      (x1 - x0 + 1) * (z1 - z0 + 1) > 16
    )
      return false;
    const ids = new Set<number>();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (const id of this.cells.get(`${x},${z}`) || []) {
          ids.add(id);
          if (ids.size > 16_384) return false;
        }
    const intervals: [number, number][] = [],
      vertices = this.vertices;
    const dx = to[0] - from[0],
      dz = to[1] - from[1];
    for (const id of ids) {
      // Retained curb faces participate in volume queries, never floor coverage.
      if (this.inverseAreas[id] === 0) continue;
      const ti = id * 3,
        a = this.triangles[ti] * 3,
        b = this.triangles[ti + 1] * 3,
        c = this.triangles[ti + 2] * 3;
      const ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2],
        bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2],
        cx = vertices[c],
        cy = vertices[c + 1],
        cz = vertices[c + 2];
      const inverse = this.inverseAreas[id],
        px = from[0] - ax,
        pz = from[1] - az;
      const u = (px * (cz - az) - pz * (cx - ax)) * inverse,
        v = ((bx - ax) * pz - (bz - az) * px) * inverse,
        du = (dx * (cz - az) - dz * (cx - ax)) * inverse,
        dv = ((bx - ax) * dz - (bz - az) * dx) * inverse;
      const eps = 0.0005 * Math.abs(inverse),
        height = ay + u * (by - ay) + v * (cy - ay),
        heightDelta = du * (by - ay) + dv * (cy - ay);
      let low = 0,
        high = 1;
      const clip = (value: number, slope: number) => {
        if (!Number.isFinite(value) || !Number.isFinite(slope)) return false;
        if (Math.abs(slope) < 1e-14) return value >= -1e-12;
        const t = -value / slope;
        if (slope > 0) low = Math.max(low, t);
        else high = Math.min(high, t);
        return low <= high + 1e-12;
      };
      if (
        clip(u + eps * Math.hypot(cx - ax, cz - az), du) &&
        clip(v + eps * Math.hypot(bx - ax, bz - az), dv) &&
        clip(1 - u - v + eps * Math.hypot(cx - bx, cz - bz), -du - dv) &&
        clip(height - anchorY + maxHeightDeltaM, heightDelta) &&
        clip(anchorY + maxHeightDeltaM - height, -heightDelta)
      )
        intervals.push([Math.max(0, low), Math.min(1, high)]);
    }
    intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let covered = 0;
    for (const [low, high] of intervals) {
      if (low > covered + 1e-8) return false;
      covered = Math.max(covered, high);
      if (covered >= 1 - 1e-8) return true;
    }
    return false;
  }
}
