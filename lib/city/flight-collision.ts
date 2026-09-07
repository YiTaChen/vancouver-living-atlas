import * as THREE from 'three';

/** Cached CPU triangles; no extra GPU geometry or per-frame scene traversal. */
export function collisionTriangles(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const count = index?.count ?? position.count;
  const points = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(
      mesh.matrixWorld,
    );
    p.toArray(points, i * 3);
  }
  return points;
}

/** Open facades/floors cannot define an inside. Weld by position, not normals. */
export function isClosedCollisionMesh(points: Float32Array) {
  const edges = new Map<string, number>();
  let volume6 = 0;
  const origin = new THREE.Vector3().fromArray(points),
    a3 = new THREE.Vector3(),
    b3 = new THREE.Vector3(),
    c3 = new THREE.Vector3();
  const vertex = (i: number) =>
    `${Math.round(points[i] * 10000)},${Math.round(points[i + 1] * 10000)},${Math.round(points[i + 2] * 10000)}`;
  for (let i = 0; i < points.length; i += 9) {
    const a = vertex(i),
      b = vertex(i + 3),
      c = vertex(i + 6);
    if (a === b || b === c || c === a) continue;
    a3.fromArray(points, i).sub(origin);
    b3.fromArray(points, i + 3).sub(origin);
    c3.fromArray(points, i + 6).sub(origin);
    volume6 += a3.dot(b3.cross(c3));
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return (
    edges.size > 0 &&
    Math.abs(volume6) > 1e-6 &&
    [...edges.values()].every((count) => count === 2)
  );
}

/** A capsule against triangles, including stationary launch clearance. */
export function hitTriangles(
  points: Float32Array,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  closed = false,
) {
  const delta = b.clone().sub(a),
    length = delta.length(),
    r2 = radius * radius;
  const ray = new THREE.Ray(
    a,
    length > 1e-8 ? delta.divideScalar(length) : new THREE.Vector3(1, 0, 0),
  );
  const triangle = new THREE.Triangle(),
    nearest = new THREE.Vector3(),
    onRay = new THREE.Vector3();
  const edge = new THREE.Line3(),
    bounds = new THREE.Box3();
  const sweep = new THREE.Box3().setFromPoints([a, b]).expandByScalar(radius);
  // A non-axis-aligned parity ray also rejects a launch wholly inside a closed
  // volume. Dedup shared-edge intersections so triangulated faces count once.
  const insideRay = new THREE.Ray(
    a,
    new THREE.Vector3(1, 0.371, 0.217).normalize(),
  );
  const crossings: number[] = [];
  for (let i = 0; i < points.length; i += 9) {
    triangle.a.fromArray(points, i);
    triangle.b.fromArray(points, i + 3);
    triangle.c.fromArray(points, i + 6);
    if (
      closed &&
      length < 1e-8 &&
      insideRay.intersectTriangle(
        triangle.a,
        triangle.b,
        triangle.c,
        false,
        nearest,
      )
    )
      crossings.push(nearest.distanceTo(a));
    bounds.setFromPoints([triangle.a, triangle.b, triangle.c]);
    if (!bounds.intersectsBox(sweep)) continue;
    if (
      triangle.closestPointToPoint(a, nearest).distanceToSquared(a) <= r2 ||
      triangle.closestPointToPoint(b, nearest).distanceToSquared(b) <= r2
    )
      return true;
    if (length < 1e-8) continue;
    const intersection = ray.intersectTriangle(
      triangle.a,
      triangle.b,
      triangle.c,
      false,
      nearest,
    );
    if (intersection && intersection.distanceTo(a) <= length) return true;
    for (const [start, end] of [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ]) {
      const d2 = ray.distanceSqToSegment(start, end, onRay, nearest);
      if (onRay.distanceToSquared(a) <= length * length) {
        if (d2 <= r2) return true;
      } else {
        edge.set(start, end).closestPointToPoint(b, true, nearest);
        if (nearest.distanceToSquared(b) <= r2) return true;
      }
    }
  }
  crossings.sort((x, y) => x - y);
  return (
    crossings.filter(
      (distance, i) => i === 0 || distance - crossings[i - 1] > 1e-4,
    ).length %
      2 ===
    1
  );
}
