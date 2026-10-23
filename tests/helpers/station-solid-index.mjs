import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';

/** Index actual station draw geometry in the owner's local frame. Authored floor
 * batches carry triangle provenance, so their exact mitres/holes are tested as
 * drawn rather than replaced by enclosing boxes or silently skipped. */
export function stationSolidIndex(group) {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert(),
    boxes = [],
    triangleParts = new Map();
  group.traverse((mesh) => {
    if (
      !(mesh instanceof THREE.Mesh) ||
      mesh.name === 'conditional-passenger-threshold'
    )
      return;
    const relative = inverse.clone().multiply(mesh.matrixWorld);
    if (mesh instanceof THREE.InstancedMesh) {
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i++) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        matrix.premultiply(relative);
        boxes.push({
          box: new OBB()
            .fromBox3(mesh.geometry.boundingBox)
            .applyMatrix4(matrix),
          id: mesh.userData.stationPartIds?.[i] ?? `${mesh.name}:${i}`,
        });
      }
      return;
    }
    const provenance = mesh.userData.stationTrianglePartIds;
    if (!provenance) return;
    const positions = mesh.geometry.getAttribute('position'),
      indices = mesh.geometry.index,
      count = indices ? indices.count : positions.count;
    if (count % 3 !== 0 || provenance.length !== count / 3)
      throw new Error(`${mesh.name}: missing rendered triangle provenance`);
    for (let offset = 0; offset < count; offset += 3) {
      const id = provenance[offset / 3];
      if (typeof id !== 'string' || !id)
        throw new Error(`${mesh.name}: invalid rendered triangle source`);
      const points = [0, 1, 2].map((j) =>
        new THREE.Vector3()
          .fromBufferAttribute(
            positions,
            indices ? indices.getX(offset + j) : offset + j,
          )
          .applyMatrix4(relative),
      );
      let part = triangleParts.get(id);
      if (!part) {
        part = { id, bounds: new THREE.Box3(), triangles: [] };
        triangleParts.set(id, part);
      }
      for (const point of points) part.bounds.expandByPoint(point);
      part.triangles.push(new THREE.Triangle(...points));
    }
  });
  const parts = [...triangleParts.values()],
    aabb = new THREE.Box3(),
    point = new THREE.Vector3(),
    transpose = new THREE.Matrix3(),
    local = new THREE.Triangle(),
    axisAligned = new THREE.Box3(),
    ray = new THREE.Ray(),
    direction = new THREE.Vector3(0.923, 0.314, 0.218).normalize(),
    hit = new THREE.Vector3();
  return {
    boxes,
    triangleParts: parts,
    firstIntersection(obb) {
      for (const part of boxes) if (part.box.intersectsOBB(obb)) return part.id;
      aabb.makeEmpty();
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1])
            aabb.expandByPoint(
              point
                .set(x, y, z)
                .multiply(obb.halfSize)
                .applyMatrix3(obb.rotation)
                .add(obb.center),
            );
      transpose.copy(obb.rotation).transpose();
      axisAligned.min.copy(obb.halfSize).negate();
      axisAligned.max.copy(obb.halfSize);
      for (const part of parts) {
        if (!part.bounds.intersectsBox(aabb)) continue;
        for (const triangle of part.triangles) {
          local.a.copy(triangle.a).sub(obb.center).applyMatrix3(transpose);
          local.b.copy(triangle.b).sub(obb.center).applyMatrix3(transpose);
          local.c.copy(triangle.c).sub(obb.center).applyMatrix3(transpose);
          if (axisAligned.intersectsTriangle(local)) return part.id;
        }
        // A small occupied-eye box could sit wholly inside a thick closed
        // slab without crossing any of its faces. Preserve the old solid-box
        // guard using actual closed draw triangles and unique ray crossings.
        if (part.bounds.containsPoint(obb.center)) {
          ray.set(obb.center, direction);
          const crossings = [];
          for (const triangle of part.triangles) {
            if (
              !ray.intersectTriangle(
                triangle.a,
                triangle.b,
                triangle.c,
                false,
                hit,
              )
            )
              continue;
            const distance = hit.distanceTo(obb.center);
            if (!crossings.some((prior) => Math.abs(prior - distance) < 1e-7))
              crossings.push(distance);
          }
          if (crossings.length % 2 === 1) return part.id;
        }
      }
      return null;
    },
  };
}
