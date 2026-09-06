import * as THREE from 'three';
import { GroundSurfaceIndex } from './ground-surface';

export interface GroundRegion {
  x: number;
  z: number;
  radius: number;
}
/** Snapshot a few landmark sites AFTER final terrain/roads/Nature/clipping.
 * Uses only explicitly ground-walkable roots. No buildings, piers, water, roofs,
 * protected bridges, or hidden LOD copies may be passed as ground candidates.
 * Triangle XY/Y and world transforms are retained exactly; no DEM + curb guess.
 * This index is independent of later landmark additions, avoiding self-sampling.
 */
export function createLandmarkGroundSampler(
  roots: readonly THREE.Object3D[],
  regions: readonly GroundRegion[],
  elevation: (x: number, z: number) => number,
) {
  const positions: number[] = [],
    seen = new Set<THREE.Mesh>();
  const points = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const intersects = (minX: number, minZ: number, maxX: number, maxZ: number) =>
    regions.some(
      (r) =>
        maxX >= r.x - r.radius &&
        minX <= r.x + r.radius &&
        maxZ >= r.z - r.radius &&
        minZ <= r.z + r.radius,
    );
  let sourceMeshes = 0,
    triangles = 0;
  for (const root of roots)
    root.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        seen.has(object) ||
        !object.userData.walkSurface ||
        object.userData.protectedSurface
      )
        return;
      seen.add(object);
      const geometry = object.geometry,
        p = geometry.getAttribute('position');
      if (!p) return;
      object.updateWorldMatrix(true, false);
      const bounds = new THREE.Box3()
        .setFromBufferAttribute(p)
        .applyMatrix4(object.matrixWorld);
      if (!intersects(bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z))
        return;
      sourceMeshes++;
      const index = geometry.index,
        available = index?.count ?? p.count,
        first = Math.max(0, Math.trunc(geometry.drawRange.start));
      const end = Math.min(
        available,
        geometry.drawRange.count === Infinity
          ? available
          : first + Math.max(0, Math.trunc(geometry.drawRange.count)),
      );
      for (let i = first; i + 2 < end; i += 3) {
        for (let j = 0; j < 3; j++)
          points[j]
            .fromBufferAttribute(p, index ? index.getX(i + j) : i + j)
            .applyMatrix4(object.matrixWorld);
        if (
          !intersects(
            Math.min(...points.map((p) => p.x)),
            Math.min(...points.map((p) => p.z)),
            Math.max(...points.map((p) => p.x)),
            Math.max(...points.map((p) => p.z)),
          )
        )
          continue;
        for (const point of points) positions.push(point.x, point.y, point.z);
        triangles++;
      }
    });
  // Float64 avoids introducing a second world-space Float32 rounding step for
  // translated/rotated input meshes. This CPU-only mesh is never scene-attached.
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.BufferAttribute(new Float64Array(positions), 3),
  );
  const material = new THREE.MeshBasicMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    index = new GroundSurfaceIndex([mesh]);
  geometry.dispose();
  material.dispose();
  return {
    sourceMeshes,
    triangles,
    /** Same narrow height window as ordinary walking; excluded protected decks
     * can never enter this sampler even if they happen to lie within ±4 m. */
    sample(x: number, z: number) {
      return index.sample(x, z, elevation(x, z) + 1.25);
    },
  };
}

/** Three's +Y rotation: worldX=cos*x+sin*z; worldZ=-sin*x+cos*z. */
export function landmarkLocalXZ(
  origin: readonly number[],
  yaw: number,
  x: number,
  z: number,
): [number, number] {
  return [
    origin[0] + Math.cos(yaw) * x + Math.sin(yaw) * z,
    origin[1] - Math.sin(yaw) * x + Math.cos(yaw) * z,
  ];
}
