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

/** Static, explicitly selected walkable meshes; world metres, Y up.
 * Build after their transforms are final. Bridge decks should use their own
 * surface logic. Vertex positions are shared; cells contain triangle IDs only.
 */
export class GroundSurfaceIndex {
  private static readonly CELL = 64;
  private readonly vertices: Float64Array;
  private readonly triangles: Uint32Array;
  private readonly inverseAreas: Float64Array;
  private readonly cells = new Map<string, number[]>();

  constructor(meshes: THREE.Mesh[]) {
    // De-duplicate references so shared scene traversal results do not double
    // every road. Separate meshes sharing a geometry still have own transforms.
    const usable = [...new Set(meshes)].filter((m) =>
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
        // Reject zero-area, vertical and numerically vertical triangles.
        if (
          !Number.isFinite(normalLength) ||
          normalLength === 0 ||
          Math.abs(area) <= normalLength * 1e-6 ||
          !Number.isFinite(1 / area)
        )
          continue;
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
        inverseAreas.push(1 / area);
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
        dz = z - az,
        inverse = this.inverseAreas[id];
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
}
