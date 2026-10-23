import * as THREE from 'three';

// Leave a small horizontal component so lookAt never crosses its vertical pole.
export const TRAVEL_PITCH_LIMIT = Math.PI / 2 - 0.035;
export function clampTravelPitch(pitch: number) {
  return THREE.MathUtils.clamp(
    Number.isFinite(pitch) ? pitch : 0,
    -TRAVEL_PITCH_LIMIT,
    TRAVEL_PITCH_LIMIT,
  );
}
/** Yaw zero faces +Z; pitch is an actual elevation angle, positive upwards. */
export function travelLookDirection(
  yaw: number,
  pitch: number,
  target = new THREE.Vector3(),
) {
  const angle = clampTravelPitch(pitch),
    c = Math.cos(angle);
  return target.set(Math.sin(yaw) * c, Math.sin(angle), Math.cos(yaw) * c);
}

const CELL = 16;
interface GeometryIndex {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  index: THREE.BufferAttribute | null;
  cells: Map<string, number[]>;
  large: number[];
  start: number;
  end: number;
  version: number;
  indexVersion: number;
}
const geometryIndices = new WeakMap<THREE.BufferGeometry, GeometryIndex>();
function geometryIndex(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    index = geometry.index;
  if (!position) return undefined;
  const available = index?.count ?? position.count;
  const start = Math.max(0, geometry.drawRange.start),
    end = Math.min(available, start + geometry.drawRange.count);
  const version =
    position instanceof THREE.InterleavedBufferAttribute
      ? position.data.version
      : position.version;
  let cached = geometryIndices.get(geometry);
  if (
    cached &&
    cached.position === position &&
    cached.index === index &&
    cached.version === version &&
    cached.indexVersion === (index?.version ?? 0) &&
    cached.start === start &&
    cached.end === end
  )
    return cached;
  cached = {
    position,
    index,
    cells: new Map(),
    large: [],
    start,
    end,
    version,
    indexVersion: index?.version ?? 0,
  };
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let offset = start; offset + 2 < end; offset += 3) {
    a.fromBufferAttribute(position, index ? index.getX(offset) : offset);
    b.fromBufferAttribute(
      position,
      index ? index.getX(offset + 1) : offset + 1,
    );
    c.fromBufferAttribute(
      position,
      index ? index.getX(offset + 2) : offset + 2,
    );
    const x0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL),
      x1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL),
      z0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL),
      z1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL);
    if (![x0, x1, z0, z1].every(Number.isSafeInteger)) continue;
    // A regional plane must not allocate millions of cells.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) {
      cached.large.push(offset);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`,
          cell = cached.cells.get(key);
        if (cell) cell.push(offset);
        else cached.cells.set(key, [offset]);
      }
  }
  geometryIndices.set(geometry, cached);
  return cached;
}

/** Earliest sphere contact with a two-sided triangle, including its edges. */
function sphereTriangleFraction(
  origin: THREE.Vector3,
  delta: THREE.Vector3,
  radius: number,
  triangle: THREE.Triangle,
) {
  const nearest = new THREE.Vector3();
  if (
    triangle.closestPointToPoint(origin, nearest).distanceToSquared(origin) <=
    radius * radius
  )
    return 0;
  let fraction = 1;
  const normal = triangle.getNormal(new THREE.Vector3()),
    distance = origin.clone().sub(triangle.a).dot(normal),
    speed = delta.dot(normal);
  if (Math.abs(speed) > 1e-12)
    for (const side of [-1, 1]) {
      const t = (side * radius - distance) / speed;
      if (t < 0 || t > fraction) continue;
      nearest
        .copy(origin)
        .addScaledVector(delta, t)
        .addScaledVector(normal, -side * radius);
      if (triangle.containsPoint(nearest)) fraction = t;
    }
  const delta2 = delta.lengthSq();
  if (delta2 < 1e-16) return fraction;
  for (const vertex of [triangle.a, triangle.b, triangle.c]) {
    const offset = origin.clone().sub(vertex),
      b = offset.dot(delta),
      c = offset.lengthSq() - radius * radius,
      discriminant = b * b - delta2 * c;
    if (discriminant < 0) continue;
    const t = (-b - Math.sqrt(discriminant)) / delta2;
    if (t >= 0 && t < fraction) fraction = t;
  }
  for (const [a, b] of [
    [triangle.a, triangle.b],
    [triangle.b, triangle.c],
    [triangle.c, triangle.a],
  ]) {
    const edge = b.clone().sub(a),
      offset = origin.clone().sub(a),
      edge2 = edge.lengthSq(),
      along = edge.dot(delta),
      start = edge.dot(offset),
      aa = edge2 * delta2 - along * along,
      bb = edge2 * offset.dot(delta) - start * along,
      cc = edge2 * (offset.lengthSq() - radius * radius) - start * start,
      discriminant = bb * bb - aa * cc;
    if (aa < 1e-16 || discriminant < 0) continue;
    const t = (-bb - Math.sqrt(discriminant)) / aa,
      y = start + t * along;
    if (t >= 0 && t < fraction && y >= 0 && y <= edge2) fraction = t;
  }
  return fraction;
}

/** Camera-only collision: never moves the walker or changes building materials.
 * Indices share source vertices and are weakly owned. Even the merged city body
 * tests only triangles in the local boom's cells, rather than all city faces.
 */
export class TravelCameraCollision {
  resolve(
    pivot: THREE.Vector3,
    desired: THREE.Vector3,
    roots: readonly THREE.Object3D[],
    radius = 0.18,
    target = new THREE.Vector3(),
  ) {
    if (
      ![...pivot.toArray(), ...desired.toArray(), radius].every(
        Number.isFinite,
      ) ||
      radius < 0
    )
      return target.copy(pivot);
    const length = pivot.distanceTo(desired);
    if (length < 1e-8) return target.copy(pivot);
    let fraction = 1;
    const inverse = new THREE.Matrix4(),
      origin = new THREE.Vector3(),
      end = new THREE.Vector3(),
      delta = new THREE.Vector3(),
      scale = new THREE.Vector3(),
      region = new THREE.Box3(),
      triangle = new THREE.Triangle();
    const inspect = (mesh: THREE.Mesh, matrix: THREE.Matrix4) => {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      if (
        !materials.some(
          (m) => m.visible && (!m.transparent || m.opacity >= 0.65),
        )
      )
        return;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      inverse.copy(matrix).invert();
      // Station cutaways clip only above the occupied level. Apply that same
      // plane to camera triangles so hidden ceilings cannot shorten the boom,
      // while all remaining lower walls retain their physical camera boundary.
      const stationPlane = mesh.userData.stationCutawayPlane as
          | THREE.Plane
          | undefined,
        activeClip =
          stationPlane && stationPlane.constant !== 1e7
            ? stationPlane
            : undefined,
        contactOrigin = stationPlane ? pivot : origin,
        contactDelta = stationPlane ? desired.clone().sub(pivot) : delta;
      origin.copy(pivot).applyMatrix4(inverse);
      end.copy(desired).applyMatrix4(inverse);
      delta.copy(end).sub(origin);
      scale.setFromMatrixScale(inverse);
      const localRadius = radius * Math.max(scale.x, scale.y, scale.z);
      region.setFromPoints([origin, end]).expandByScalar(localRadius);
      if (!geometry.boundingBox?.intersectsBox(region)) return;
      const data = geometryIndex(geometry);
      if (!data) return;
      const candidates = new Set(data.large),
        x0 = Math.floor(region.min.x / CELL),
        x1 = Math.floor(region.max.x / CELL),
        z0 = Math.floor(region.min.z / CELL),
        z1 = Math.floor(region.max.z / CELL);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) {
        for (let i = data.start; i + 2 < data.end; i += 3) candidates.add(i);
      } else
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++)
            for (const offset of data.cells.get(`${x},${z}`) ?? [])
              candidates.add(offset);
      for (const offset of candidates) {
        triangle.a.fromBufferAttribute(
          data.position,
          data.index ? data.index.getX(offset) : offset,
        );
        triangle.b.fromBufferAttribute(
          data.position,
          data.index ? data.index.getX(offset + 1) : offset + 1,
        );
        triangle.c.fromBufferAttribute(
          data.position,
          data.index ? data.index.getX(offset + 2) : offset + 2,
        );
        const minY = Math.min(triangle.a.y, triangle.b.y, triangle.c.y),
          maxY = Math.max(triangle.a.y, triangle.b.y, triangle.c.y);
        if (minY > region.max.y || maxY < region.min.y) continue;
        // Authored station boxes use nonuniform instance scales. A sphere
        // expanded by the largest inverse scale is useful for broad phase, but
        // using it for contact would turn a thin wall into a huge camera block.
        // Test the few nearby station triangles in world metres instead.
        if (stationPlane) {
          triangle.a.applyMatrix4(matrix);
          triangle.b.applyMatrix4(matrix);
          triangle.c.applyMatrix4(matrix);
        }
        const contactRadius = stationPlane ? radius : localRadius;
        if (activeClip) {
          const vertices = [triangle.a, triangle.b, triangle.c],
            polygon: THREE.Vector3[] = [];
          for (let i = 0; i < vertices.length; i++) {
            const current = vertices[i],
              previous = vertices[(i + vertices.length - 1) % vertices.length],
              currentDistance = activeClip.distanceToPoint(current),
              previousDistance = activeClip.distanceToPoint(previous);
            if (currentDistance >= 0 !== previousDistance >= 0)
              polygon.push(
                previous
                  .clone()
                  .lerp(
                    current,
                    previousDistance / (previousDistance - currentDistance),
                  ),
              );
            if (currentDistance >= 0) polygon.push(current.clone());
          }
          for (let i = 1; i + 1 < polygon.length; i++) {
            triangle.set(polygon[0], polygon[i], polygon[i + 1]);
            fraction = Math.min(
              fraction,
              sphereTriangleFraction(
                contactOrigin,
                contactDelta,
                contactRadius,
                triangle,
              ),
            );
          }
        } else
          fraction = Math.min(
            fraction,
            sphereTriangleFraction(
              contactOrigin,
              contactDelta,
              contactRadius,
              triangle,
            ),
          );
      }
    };
    const instance = new THREE.Matrix4(),
      world = new THREE.Matrix4();
    for (const root of roots) {
      // A hidden ancestor (such as a disabled city layer) also disables collision.
      let parent: THREE.Object3D | null = root;
      while (parent?.visible) parent = parent.parent;
      if (parent) continue;
      root.updateWorldMatrix(true, true);
      root.traverseVisible((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          object.userData.cameraCollision === false ||
          object instanceof THREE.SkinnedMesh
        )
          return;
        if (object instanceof THREE.InstancedMesh) {
          for (let i = 0; i < object.count; i++) {
            object.getMatrixAt(i, instance);
            inspect(
              object,
              world.multiplyMatrices(object.matrixWorld, instance),
            );
          }
        } else inspect(object, object.matrixWorld);
      });
    }
    // A centimetre of separation prevents an exactly tangent near plane flicker.
    return target.lerpVectors(
      pivot,
      desired,
      fraction < 1 ? Math.max(0, fraction - 0.01 / length) : 1,
    );
  }
}
