import * as THREE from 'three';
import {
  reconcileGroundVisibility,
  type GroundCover,
  type VisibilityOptions,
} from './ground-visibility';
import { prepareRoadLowering, lowerRoadSurface } from './road-lowering';

export interface GroundMesh {
  mesh: THREE.Mesh;
  kind: GroundCover['kind'];
  id: string;
}
function flatWorld(mesh: THREE.Mesh): number[] {
  const p = mesh.geometry.getAttribute('position'),
    index = mesh.geometry.index,
    out: number[] = [],
    v = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < (index?.count ?? p.count); i++) {
    v.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(
      mesh.matrixWorld,
    );
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/** Call exactly once, after makeLand, makeRoads and createNature; before any
 * GroundSurfaceIndex/StreetNavigation construction. Mutates only the supplied
 * first terrain mesh's geometry. It remains the same mesh, in the same child
 * slot, with the same material/userData/shadow state. No extra draw calls.
 * Stage 5 has already appended its beach triangles, so its replacement keys
 * and coastal elevation/land/water state remain untouched.
 */
export function applyGroundVisibility(
  terrain: THREE.Mesh,
  groundMeshes: readonly GroundMesh[],
  options: VisibilityOptions,
  protectedTriangleRanges: readonly (readonly [number, number])[] = [],
) {
  if (terrain.userData.protectedSurface)
    throw new Error('Cannot clip protected terrain');
  if (terrain.userData.groundVisibilityApplied)
    throw new Error('Ground visibility already applied');
  const previous = terrain.geometry;
  if (
    previous.index ||
    previous.groups.length ||
    previous.drawRange.start !== 0 ||
    previous.drawRange.count !== Infinity
  )
    throw new Error('Expected complete ungrouped non-indexed terrain');
  const attributes: Record<string, { array: number[]; itemSize: number }> = {};
  for (const [name, attribute] of Object.entries(previous.attributes)) {
    if (name === 'position') continue;
    const array: number[] = [];
    for (let i = 0; i < attribute.count; i++)
      for (let j = 0; j < attribute.itemSize; j++)
        array.push(attribute.getComponent(i, j));
    attributes[name] = { array, itemSize: attribute.itemSize };
  }
  const result = reconcileGroundVisibility(
    { positions: flatWorld(terrain), attributes, protectedTriangleRanges },
    groundMeshes.map(
      ({ mesh, kind, id }): GroundCover => ({
        id,
        kind,
        // A second guard prevents accidental upper-floor selection in the caller.
        protectedSurface: !!mesh.userData.protectedSurface,
        level: mesh.userData.protectedSurface ? 'upper' : 'ground',
        positions: mesh.userData.protectedSurface ? [] : flatWorld(mesh),
      }),
    ),
    options,
  );
  if (result.changedTriangles.length) {
    const inverse = terrain.matrixWorld.clone().invert(),
      v = new THREE.Vector3(),
      positions = result.positions;
    for (let i = 0; i < positions.length; i += 3) {
      v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(
        inverse,
      );
      positions[i] = v.x;
      positions[i + 1] = v.y;
      positions[i + 2] = v.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    for (const [name, attribute] of Object.entries(result.attributes))
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize),
      );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    terrain.geometry = geometry;
    previous.dispose();
  }
  terrain.userData.groundVisibilityApplied = true;
  terrain.userData.groundVisibility = result.statistics;
  return result.statistics;
}

/** Apply the common downward blend plan to the existing asphalt chunks. Paths
 * are read-only snapshots of their actual final triangles, including Stage 5
 * replacements. The chunks, source axes, materials and draw-call count stay.
 * Run before applyGroundVisibility and before ground navigation/paint indices.
 */
export function applyRoadLowering(
  asphaltMeshes: readonly THREE.Mesh[],
  lowerPaths: readonly GroundCover[],
  options: Parameters<typeof prepareRoadLowering>[2],
) {
  const sources: GroundCover[] = asphaltMeshes.map((mesh) => ({
    id: mesh.name,
    kind: 'asphalt',
    positions: flatWorld(mesh),
    level: mesh.userData.protectedSurface ? 'upper' : 'ground',
    protectedSurface: !!mesh.userData.protectedSurface,
  }));
  const plan = prepareRoadLowering(sources, lowerPaths, options),
    changes = [];
  for (let i = 0; i < asphaltMeshes.length; i++) {
    const mesh = asphaltMeshes[i];
    if (mesh.userData.protectedSurface) continue;
    const previous = mesh.geometry;
    if (!previous.boundingBox) previous.computeBoundingBox();
    const box = previous.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    if (
      !plan.constraints.some(
        (c) =>
          box.min.x <= c.bounds[2] &&
          box.max.x >= c.bounds[0] &&
          box.min.z <= c.bounds[3] &&
          box.max.z >= c.bounds[1],
      )
    )
      continue;
    if (
      previous.index ||
      previous.groups.length ||
      previous.drawRange.start !== 0 ||
      previous.drawRange.count !== Infinity
    )
      throw new Error('Expected complete ungrouped City asphalt');
    const attributes: Record<string, { array: number[]; itemSize: number }> =
      {};
    for (const [name, a] of Object.entries(previous.attributes)) {
      if (name === 'position' || name === 'normal') continue;
      const array: number[] = [];
      for (let k = 0; k < a.count; k++)
        for (let j = 0; j < a.itemSize; j++) array.push(a.getComponent(k, j));
      attributes[name] = { array, itemSize: a.itemSize };
    }
    const result = lowerRoadSurface(
      { positions: sources[i].positions, attributes },
      plan,
    );
    if (!result.changedTriangles.length) continue;
    const inverse = mesh.matrixWorld.clone().invert(),
      v = new THREE.Vector3();
    for (let j = 0; j < result.positions.length; j += 3) {
      v.set(
        result.positions[j],
        result.positions[j + 1],
        result.positions[j + 2],
      ).applyMatrix4(inverse);
      result.positions[j] = v.x;
      result.positions[j + 1] = v.y;
      result.positions[j + 2] = v.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(result.positions, 3),
    );
    for (const [name, a] of Object.entries(result.attributes))
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(a.array, a.itemSize),
      );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
    previous.dispose();
    changes.push({ mesh: mesh.name, ...result.statistics });
  }
  return {
    constraints: plan.constraints.length,
    sourceAreasM2: plan.sourceAreasM2,
    blendM: plan.blendM,
    changes,
  };
}
