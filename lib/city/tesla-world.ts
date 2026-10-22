import * as THREE from 'three';
import { teslaTyreSupportHeight } from './tesla-tyre-support';
import type {
  TeslaContact,
  TeslaGroundDepartureQuery,
  TeslaGroundFit,
  TeslaGroundFitQuery,
  TeslaPose,
  TeslaShape,
  TeslaSupportQuery,
  TeslaSweepHit,
  TeslaSweepQuery,
  TeslaVec3,
  TeslaWallToRoofPlan,
  TeslaWallToRoofQuery,
  TeslaWorld as TeslaWorldContract,
} from './tesla-state';

export interface TeslaFace extends TeslaContact {
  bounds?: THREE.Box3;
  enabled?: () => boolean;
  triangle: readonly [TeslaVec3, TeslaVec3, TeslaVec3];
  /** Shared physical floor/face, never permission to join different layers. */
  supportGroup: string;
  triangleId: string;
}
export interface TeslaGeometrySource {
  id: string;
  bounds: THREE.Box3;
  /** Load only actual triangles intersecting this local XZ tile. No GPU copy. */
  load: (region: THREE.Box3) => TeslaFace[];
  /** Solid interior test, distinct from surface contact and support. */
  inside?: (point: TeslaVec3) => boolean;
  enabled?: () => boolean;
}
export interface TeslaWorldOptions {
  sources: readonly TeslaGeometrySource[];
  validPosition?: (position: TeslaVec3) => boolean;
  maxCachedTiles?: number;
  /** Explicit physical road groups with authored four-wheel suspension. Each
   * group keeps its own layer/union; unrelated decks, roofs and walls stay strict. */
  modelGroundGroups?: readonly string[];
  /** Default-off, source-gate-validated physical peers for this exact tyre
   * footprint. This never changes a contact's travel identity or layer. */
  modelGroundConnections?: (
    pose: TeslaPose,
    shape: TeslaShape,
  ) => readonly (readonly [string, string])[];
}
const CELL = 32;
const HEIGHT_BAND = 128;
const HEIGHT_ORIGIN = -32;
const EPS = 1e-7;
// Adjacent rendered Float32 road triangles can differ by tens of micrometres.
// Only ordinary-ground union proof gets this bounded source seam tolerance;
// protected decks, roofs/walls and caller surface permissions remain strict.
const GROUND_SEAM_EPS = 5e-5;
const asVector = (p: TeslaVec3) => new THREE.Vector3(...p);
const tuple = (p: THREE.Vector3): [number, number, number] => [
  p.x || 0,
  p.y || 0,
  p.z || 0,
];
const finitePose = (p: TeslaPose) =>
  [...p.position, ...p.quaternion].every(Number.isFinite) &&
  p.position.every((value) => Math.abs(value) <= 10_000_000) &&
  Math.hypot(...p.quaternion) > 0.5 &&
  Math.hypot(...p.quaternion) < 1.5;
function validShape(shape: TeslaShape) {
  const ground = shape.groundSupport;
  let sectionsValid = true;
  if (ground && ground.bodySections !== undefined) {
    const sections = ground.bodySections;
    sectionsValid =
      Array.isArray(sections) && sections.length > 0 && sections.length <= 8;
    let covered = -shape.halfExtents[2];
    if (sectionsValid)
      for (const section of sections) {
        if (
          !section ||
          !Number.isFinite(section.minZ) ||
          !Number.isFinite(section.maxZ) ||
          !Number.isFinite(section.clearance) ||
          Math.abs(section.minZ - covered) > EPS ||
          section.maxZ <= section.minZ ||
          section.maxZ > shape.halfExtents[2] + EPS ||
          section.clearance < ground.chassisClearance ||
          section.clearance >= 2 * shape.halfExtents[1]
        ) {
          sectionsValid = false;
          break;
        }
        covered = section.maxZ;
      }
    sectionsValid &&= Math.abs(covered - shape.halfExtents[2]) <= EPS;
  }
  return (
    sectionsValid &&
    shape.halfExtents.every((v) => Number.isFinite(v) && v > 0 && v <= 8) &&
    Number.isFinite(shape.clearance) &&
    shape.clearance >= 0 &&
    shape.clearance <= 1 &&
    (!ground ||
      (Array.isArray(ground.wheelContacts) &&
        ground.wheelContacts.length === 4 &&
        ground.wheelContacts.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 3 &&
            p.every((value) => Number.isFinite(value) && Math.abs(value) <= 8),
        ) &&
        Number.isFinite(ground.chassisClearance) &&
        ground.chassisClearance >= 0 &&
        ground.chassisClearance < 2 * shape.halfExtents[1] &&
        Number.isFinite(ground.suspensionTravel) &&
        ground.suspensionTravel >= 0 &&
        ground.suspensionTravel <= 0.05 &&
        (ground.wheelRadius === undefined ||
          (Number.isFinite(ground.wheelRadius) &&
            ground.wheelRadius > 0 &&
            ground.wheelRadius <=
              Math.min(1, shape.halfExtents[1] + shape.clearance)))))
  );
}
function basis(pose: TeslaPose) {
  const q = new THREE.Quaternion(...pose.quaternion).normalize();
  return [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ].map((a) => a.applyQuaternion(q));
}
function extent(
  axis: THREE.Vector3,
  axes: THREE.Vector3[],
  shape: TeslaShape,
  padding = 0,
) {
  return axes.reduce(
    (n, a, i) => n + Math.abs(axis.dot(a)) * shape.halfExtents[i],
    shape.clearance + padding,
  );
}
interface FaceGeometry {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  triangle: THREE.Triangle;
  normal: THREE.Vector3;
  rawNormal: THREE.Vector3;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  edges: THREE.Vector3[];
  xyzKeys: string[];
  xzKeys: string[];
}
// Source geometry is final when a face is registered. Cache only that immutable
// geometry; enabled/adherable/kind/groups/accepts remain live on every query.
// Weak ownership releases these vectors with the bounded tile-cache faces.
const geometryCache = new WeakMap<TeslaFace, FaceGeometry>();
function faceGeometry(face: TeslaFace): FaceGeometry {
  let geometry = geometryCache.get(face);
  if (geometry) return geometry;
  const vertices = face.triangle.map(asVector) as [
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
  ];
  const rawNormal = asVector(face.normal),
    keys3 = face.triangle.map(vertexKey),
    keys2 = face.triangle.map(
      (p) => `${Math.round(p[0] * 1000)},${Math.round(p[2] * 1000)}`,
    );
  const edgesFor = (keys: string[]) =>
    keys.map((a, i) => {
      const b = keys[(i + 1) % 3];
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    });
  geometry = {
    vertices,
    triangle: new THREE.Triangle(...vertices),
    rawNormal,
    normal: rawNormal.clone().normalize(),
    minX: Math.min(vertices[0].x, vertices[1].x, vertices[2].x),
    maxX: Math.max(vertices[0].x, vertices[1].x, vertices[2].x),
    minZ: Math.min(vertices[0].z, vertices[1].z, vertices[2].z),
    maxZ: Math.max(vertices[0].z, vertices[1].z, vertices[2].z),
    edges: [
      vertices[1].clone().sub(vertices[0]),
      vertices[2].clone().sub(vertices[1]),
      vertices[0].clone().sub(vertices[2]),
    ],
    xyzKeys: edgesFor(keys3),
    xzKeys: edgesFor(keys2),
  };
  geometryCache.set(face, geometry);
  return geometry;
}
function faceBounds(face: TeslaFace) {
  return (face.bounds ??= new THREE.Box3().setFromPoints(
    faceGeometry(face).vertices,
  ));
}
function groundHeightAt(
  faces: readonly TeslaFace[],
  x: number,
  z: number,
  minY: number,
  maxY: number,
) {
  let height = -Infinity;
  const scratch = new THREE.Vector3(),
    closest = new THREE.Vector3();
  for (const face of faces) {
    const geometry = faceGeometry(face);
    // A point within the unchanged 3D closest-point threshold must also lie
    // inside these source-vertex XZ bounds expanded by that same distance.
    // This rejects irrelevant triangles without caching any floor permission.
    if (
      x < geometry.minX - GROUND_SEAM_EPS ||
      x > geometry.maxX + GROUND_SEAM_EPS ||
      z < geometry.minZ - GROUND_SEAM_EPS ||
      z > geometry.maxZ + GROUND_SEAM_EPS
    )
      continue;
    const n = geometry.normal,
      a = geometry.vertices[0],
      y = a.y - (n.x * (x - a.x) + n.z * (z - a.z)) / n.y;
    if (y > maxY || y < minY || y <= height) continue;
    scratch.set(x, y, z);
    if (
      geometry.triangle
        .closestPointToPoint(scratch, closest)
        .distanceToSquared(scratch) <=
      GROUND_SEAM_EPS ** 2
    )
      height = y;
  }
  return Number.isFinite(height) ? height : null;
}
/** A circular tread may meet a finite curb edge before the axle crosses it.
 * A real floor directly below the tyre datum remains mandatory; this does not
 * bridge holes or replace the separate continuous floor/body-route proofs. */
function tyreHeightAt(
  faces: readonly TeslaFace[],
  triangles: readonly TeslaFace['triangle'][],
  x: number,
  z: number,
  forward: THREE.Vector3,
  shape: TeslaShape,
  minY: number,
  maxY: number,
) {
  const baseHeight = groundHeightAt(faces, x, z, minY, maxY),
    radius = shape.groundSupport?.wheelRadius;
  if (baseHeight === null || radius === undefined) return baseHeight;
  const horizontal = Math.hypot(forward.x, forward.z);
  if (horizontal < 0.92) return null;
  return (
    teslaTyreSupportHeight({
      triangles,
      positionXZ: [x, z],
      headingXZ: [forward.x / horizontal, forward.z / horizontal],
      radius,
      minY,
      maxY,
      baseHeight,
      longitudinalGrade: forward.y / horizontal,
    }) ?? baseHeight
  ); // Keep only the already-proved point's existing Float32 seam tolerance.
}
function connectedGroundFaces(start: TeslaFace, faces: readonly TeslaFace[]) {
  const owners = new Map<string, { face: TeslaFace; edge: number }[]>();
  for (const face of faces)
    if (
      face.kind === 'ground' &&
      face.adherable &&
      face.supportGroup === start.supportGroup
    )
      for (let edge = 0; edge < 3; edge++) {
        const key = faceGeometry(face).xyzKeys[edge],
          bucket = owners.get(key) ?? [];
        bucket.push({ face, edge });
        owners.set(key, bucket);
      }
  const connected = new Set([start.surfaceId]),
    pending = [start];
  const equal = (a: TeslaVec3, b: TeslaVec3) =>
    a.every((value, i) => value === b[i]);
  while (pending.length) {
    const face = pending.pop()!;
    for (let edge = 0; edge < 3; edge++) {
      const a = face.triangle[edge],
        b = face.triangle[(edge + 1) % 3];
      for (const peer of owners.get(faceGeometry(face).xyzKeys[edge]) ?? []) {
        const c = peer.face.triangle[peer.edge],
          d = peer.face.triangle[(peer.edge + 1) % 3];
        // Quantized keys only narrow the search; grade permission requires
        // the exact same XYZ endpoints, not a nearby raised or cracked edge.
        if (
          !connected.has(peer.face.surfaceId) &&
          ((equal(a, c) && equal(b, d)) || (equal(a, d) && equal(b, c)))
        ) {
          connected.add(peer.face.surfaceId);
          pending.push(peer.face);
        }
      }
    }
  }
  return connected;
}
interface SweepFrame {
  axes: THREE.Vector3[];
  start: THREE.Vector3;
  delta: THREE.Vector3;
  rotation: THREE.Quaternion | null;
  rotationAxis: THREE.Vector3 | null;
  /** Keep the original linear chassis path for an offset proxy's exact arc. */
  rotationOrigin?: {
    start: THREE.Vector3;
    delta: THREE.Vector3;
    offset: THREE.Vector3;
  };
  projectionArc?: {
    angle: number;
    axis: THREE.Vector3;
    corners: THREE.Vector3[];
  };
}
function sweepFrame(
  from: TeslaPose,
  to: TeslaPose,
  angularPadding: number,
  axes = basis(from),
): SweepFrame {
  const start = asVector(from.position),
    delta = asVector(to.position).sub(start);
  // Translation is the common road step. Its face tests need no relative
  // quaternion; angular substeps prepare it once for every candidate face.
  const rotation =
    angularPadding < EPS
      ? null
      : new THREE.Quaternion(...to.quaternion)
          .normalize()
          .multiply(
            new THREE.Quaternion(...from.quaternion).normalize().invert(),
          );
  return {
    axes,
    start,
    delta,
    rotation,
    rotationAxis: rotation
      ? new THREE.Vector3(rotation.x, rotation.y, rotation.z)
      : null,
  };
}
function groundBodyFrame(
  frame: SweepFrame,
  endAxes: THREE.Vector3[],
  shape: TeslaShape,
  minZ: number,
  maxZ: number,
  bottomLift: number,
) {
  const y = bottomLift / 2,
    z = (minZ + maxZ) / 2;
  return {
    shape: {
      ...shape,
      halfExtents: [
        shape.halfExtents[0],
        Math.max(0.01, shape.halfExtents[1] - y),
        (maxZ - minZ) / 2,
      ] as TeslaVec3,
    },
    frame: {
      ...frame,
      projectionArc: undefined,
      rotationOrigin: {
        start: frame.start,
        delta: frame.delta,
        offset: frame.axes[1]
          .clone()
          .multiplyScalar(y)
          .addScaledVector(frame.axes[2], z),
      },
      start: frame.start
        .clone()
        .addScaledVector(frame.axes[1], y)
        .addScaledVector(frame.axes[2], z),
      delta: frame.delta
        .clone()
        .addScaledVector(endAxes[1], y)
        .addScaledVector(frame.axes[1], -y)
        .addScaledVector(endAxes[2], z)
        .addScaledVector(frame.axes[2], -z),
    },
  };
}
function modelGroundBodies(
  frame: SweepFrame,
  endAxes: THREE.Vector3[],
  shape: TeslaShape,
) {
  const support = shape.groundSupport!;
  return (
    support.bodySections ?? [
      {
        minZ: -shape.halfExtents[2],
        maxZ: shape.halfExtents[2],
        clearance: support.chassisClearance,
      },
    ]
  ).map((section) =>
    groundBodyFrame(
      frame,
      endAxes,
      shape,
      section.minZ,
      section.maxZ,
      section.clearance,
    ),
  );
}
/** Exact forbidden world-Y interval for a fixed-orientation body and triangle. */
function verticalCollisionInterval(
  body: { frame: SweepFrame; shape: TeslaShape },
  face: TeslaFace,
  maximum: number,
) {
  const { vertices, edges, normal } = faceGeometry(face),
    { axes, start } = body.frame;
  const tested = [
    ...axes,
    normal,
    ...edges.flatMap((edge) => axes.map((axis) => edge.clone().cross(axis))),
  ];
  let enter = 0,
    leave = maximum;
  for (const raw of tested) {
    if (raw.lengthSq() < 1e-14) continue;
    const axis = raw.clone().normalize(),
      projections = vertices.map((p) => p.dot(axis)),
      radius = extent(axis, axes, body.shape),
      low = Math.min(...projections) - radius,
      high = Math.max(...projections) + radius,
      position = start.dot(axis),
      speed = axis.y;
    if (Math.abs(speed) < 1e-12) {
      if (position <= low + EPS || position >= high - EPS) return null;
      continue;
    }
    let lo = (low - position) / speed,
      hi = (high - position) / speed;
    if (lo > hi) [lo, hi] = [hi, lo];
    enter = Math.max(enter, lo);
    leave = Math.min(leave, hi);
    if (enter > leave) return null;
  }
  return leave > enter + EPS ? ([enter, leave] as [number, number]) : null;
}
/** Exact largest normal projection of all eight rotating hull corners. This
 * proves plane separation without the spherical angular pad's false floor hits. */
function rotatingExtent(
  normal: THREE.Vector3,
  axes: THREE.Vector3[],
  shape: TeslaShape,
  rotation: THREE.Quaternion,
  offset?: THREE.Vector3,
) {
  if (rotation.w < 0)
    rotation = new THREE.Quaternion(
      -rotation.x,
      -rotation.y,
      -rotation.z,
      -rotation.w,
    );
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(rotation.w, -1, 1));
  const axis = new THREE.Vector3(
    rotation.x,
    rotation.y,
    rotation.z,
  ).normalize();
  let maximum = -Infinity;
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const corner = axes[0]
          .clone()
          .multiplyScalar(x * shape.halfExtents[0])
          .addScaledVector(axes[1], y * shape.halfExtents[1])
          .addScaledVector(axes[2], z * shape.halfExtents[2]);
        // A centred box is symmetric. For an offset section the extent toward
        // the plane is -n·R(offset+corner), hence use corner-offset here.
        if (offset) corner.sub(offset);
        const constant = normal.dot(axis) * corner.dot(axis),
          a = normal.dot(corner) - constant,
          b = normal.dot(axis.clone().cross(corner));
        maximum = Math.max(
          maximum,
          constant + a,
          constant + a * Math.cos(angle) + b * Math.sin(angle),
        );
        let peak = Math.atan2(b, a);
        if (peak < 0) peak += 2 * Math.PI;
        if (peak <= angle)
          maximum = Math.max(maximum, constant + Math.hypot(a, b));
      }
  return maximum + shape.clearance;
}
/** Exact swept projection onto one fixed SAT axis. Translation and rotation
 * share time, including every interior critical point of linear+sin/cos. */
function rotatingProjectionRange(
  frame: SweepFrame,
  shape: TeslaShape,
  normal: THREE.Vector3,
  fromTime = 0,
  toTime = 1,
) {
  if (!frame.projectionArc) {
    const rotation = frame.rotation!,
      sign = rotation.w < 0 ? -1 : 1,
      angle = 2 * Math.acos(THREE.MathUtils.clamp(sign * rotation.w, -1, 1)),
      axis = new THREE.Vector3(
        sign * rotation.x,
        sign * rotation.y,
        sign * rotation.z,
      ).normalize(),
      corners: THREE.Vector3[] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          corners.push(
            frame.axes[0]
              .clone()
              .multiplyScalar(x * shape.halfExtents[0])
              .addScaledVector(frame.axes[1], y * shape.halfExtents[1])
              .addScaledVector(frame.axes[2], z * shape.halfExtents[2])
              .add(frame.rotationOrigin?.offset ?? new THREE.Vector3()),
          );
    frame.projectionArc = { angle, axis, corners };
  }
  const { angle, axis, corners } = frame.projectionArc,
    origin = frame.rotationOrigin,
    base = normal.dot(origin?.start ?? frame.start),
    speed = normal.dot(origin?.delta ?? frame.delta);
  let minimum = Infinity,
    maximum = -Infinity;
  for (const corner of corners) {
    const constant = normal.dot(axis) * corner.dot(axis),
      a = normal.dot(corner) - constant,
      b =
        normal.x * (axis.y * corner.z - axis.z * corner.y) +
        normal.y * (axis.z * corner.x - axis.x * corner.z) +
        normal.z * (axis.x * corner.y - axis.y * corner.x),
      radius = Math.hypot(a, b),
      samples = [fromTime, toTime];
    if (angle > 1e-12 && radius > 1e-12 && Math.abs(speed) < angle * radius) {
      const phase = Math.atan2(a, b),
        critical = Math.acos(
          THREE.MathUtils.clamp(-speed / (angle * radius), -1, 1),
        );
      for (const sign of [-1, 1]) {
        const u =
          (((sign * critical - phase) % (2 * Math.PI)) + 2 * Math.PI) %
          (2 * Math.PI);
        const t = Math.min(1, u / angle);
        if (u <= angle + 1e-12 && t >= fromTime && t <= toTime) samples.push(t);
      }
    }
    for (const t of samples) {
      const value =
        base +
        speed * t +
        constant +
        a * Math.cos(angle * t) +
        b * Math.sin(angle * t);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return [minimum - shape.clearance, maximum + shape.clearance];
}
/** Continuous separating-axis test for a translating OBB and a physical triangle.
 * Angular substeps expand by the maximum arc any body vertex can travel, so even
 * thin walls cannot be skipped between two sampled orientations. */
function triangleSweep(
  frame: SweepFrame,
  shape: TeslaShape,
  face: TeslaFace,
  angularPadding: number,
): number | null {
  const { axes, start: a, delta, rotation, rotationAxis } = frame;
  const { vertices, edges, normal } = faceGeometry(face);
  const signed = a.clone().sub(vertices[0]).dot(normal);
  const planeExtentInvariant =
    !rotationAxis ||
    rotationAxis.lengthSq() < 1e-18 ||
    rotationAxis.clone().cross(normal).lengthSq() <=
      rotationAxis.lengthSq() * 1e-12;
  // Exact resting/tangential contact is not a collision. This also permits
  // continuous travel across coplanar road triangles without ignoring a floor.
  if (
    (angularPadding < EPS || planeExtentInvariant) &&
    signed >= extent(normal, axes, shape) - 1e-5 &&
    delta.dot(normal) >= -EPS
  )
    return null;
  const origin = frame.rotationOrigin,
    originSigned = origin
      ? origin.start.clone().sub(vertices[0]).dot(normal)
      : signed,
    minimumSigned = Math.min(
      originSigned,
      originSigned + (origin?.delta ?? delta).dot(normal),
    );
  if (
    angularPadding >= EPS &&
    !planeExtentInvariant &&
    minimumSigned >=
      extent(normal, axes, shape) - (origin?.offset.dot(normal) ?? 0) - 1e-5 &&
    minimumSigned >=
      rotatingExtent(normal, axes, shape, rotation!, origin?.offset) - 1e-5
  )
    return null;
  let enter = 0,
    leave = 1;
  const exactAxes: { axis: THREE.Vector3; low: number; high: number }[] | null =
    frame.rotationOrigin && angularPadding >= EPS ? [] : null;
  // Preserve body axes, face normal, then edge×body order. Most disjoint
  // triangles exit on an early axis; do not construct their unused cross axes.
  const firstCrossAxis = axes.length + 1;
  for (
    let index = 0;
    index < firstCrossAxis + edges.length * axes.length;
    index++
  ) {
    const crossIndex = index - firstCrossAxis;
    const raw =
      index < axes.length
        ? axes[index]
        : index === axes.length
          ? normal
          : edges[Math.floor(crossIndex / axes.length)]
              .clone()
              .cross(axes[crossIndex % axes.length]);
    if (raw.lengthSq() < 1e-14) continue;
    const axis = raw.clone().normalize();
    const projections = vertices.map((p) => p.dot(axis));
    exactAxes?.push({
      axis,
      low: Math.min(...projections),
      high: Math.max(...projections),
    });
    const radius = extent(axis, axes, shape, angularPadding);
    const low = Math.min(...projections) - radius,
      high = Math.max(...projections) + radius;
    const start = a.dot(axis),
      speed = delta.dot(axis);
    if (Math.abs(speed) < EPS) {
      if (start < low - EPS || start > high + EPS) return null;
      if (angularPadding < EPS && (start <= low + EPS || start >= high - EPS))
        return null;
      continue;
    }
    // A fixed hull touching a triangle edge and moving away is separated for
    // every positive time. The interval epsilon below must not turn its t=0
    // contact (or a tiny negative leave caused by roundoff) into penetration.
    // Rotating hulls retain their conservative angular envelope; an actual
    // initial overlap beyond the same spatial epsilon still blocks departure.
    if (
      angularPadding < EPS &&
      ((speed < 0 && start <= low + EPS) || (speed > 0 && start >= high - EPS))
    )
      return null;
    let t0 = (low - start) / speed,
      t1 = (high - start) / speed;
    if (t0 > t1) [t0, t1] = [t1, t0];
    enter = Math.max(enter, t0);
    leave = Math.min(leave, t1);
    if (enter > leave + EPS) return null;
  }
  // Angular padding is a safe broad envelope, but can overlap a finite road
  // triangle even when an offset body section stays outside one of its edges.
  // Prove an axis clear over the entire physical arc before dismissing it.
  if (
    exactAxes?.some(({ axis, low, high }) => {
      const [minimum, maximum] = rotatingProjectionRange(frame, shape, axis);
      return maximum <= low + EPS || minimum >= high - EPS;
    })
  )
    return null;
  if (exactAxes) {
    // A rotating section may remain separated from a finite triangle by
    // different axes at different times. Prove every bounded time interval
    // with the exact corner arc, rather than treating angular padding as a
    // physical intersection. An unproved interval remains a collision.
    let remaining = 127;
    const separated = (from: number, to: number, depth: number): boolean => {
      if (!remaining--) return false;
      const middle = (from + to) / 2;
      if (
        exactAxes.some(({ axis, low, high }) => {
          const [minimum, maximum] = rotatingProjectionRange(
            frame,
            shape,
            axis,
            from,
            to,
          );
          return maximum <= low + EPS || minimum >= high - EPS;
        })
      )
        return true;
      const orientation = new THREE.Quaternion().slerpQuaternions(
          new THREE.Quaternion(),
          rotation!,
          middle,
        ),
        middleAxes = axes.map((axis) =>
          axis.clone().applyQuaternion(orientation),
        );
      for (
        let index = 0;
        index < middleAxes.length * (edges.length + 1);
        index++
      ) {
        const raw =
          index < middleAxes.length
            ? middleAxes[index]
            : edges[Math.floor((index - middleAxes.length) / middleAxes.length)]
                .clone()
                .cross(
                  middleAxes[(index - middleAxes.length) % middleAxes.length],
                );
        if (raw.lengthSq() < 1e-14) continue;
        const axis = raw.clone().normalize(),
          projected = vertices.map((point) => point.dot(axis)),
          [minimum, maximum] = rotatingProjectionRange(
            frame,
            shape,
            axis,
            from,
            to,
          );
        if (
          maximum <= Math.min(...projected) + EPS ||
          minimum >= Math.max(...projected) - EPS
        )
          return true;
      }
      if (!depth) return false;
      return (
        separated(from, middle, depth - 1) && separated(middle, to, depth - 1)
      );
    };
    if (separated(0, 1, 6)) return null;
  }
  return enter >= -EPS && enter <= 1 + EPS
    ? Math.min(1, Math.max(0, enter))
    : null;
}
function interpolated(a: TeslaPose, b: TeslaPose, t: number): TeslaPose {
  const q = new THREE.Quaternion(...a.quaternion)
    .normalize()
    .slerp(new THREE.Quaternion(...b.quaternion).normalize(), t);
  return {
    position: [
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    ],
    quaternion: [q.x, q.y, q.z, q.w],
  };
}
function rectangleInterval(
  a: [number, number],
  b: [number, number],
  halfX: number,
  halfZ: number,
) {
  let enter = 0,
    leave = 1;
  for (const [axis, half] of [
    [0, halfX],
    [1, halfZ],
  ]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < EPS) {
      if (Math.abs(a[axis]) > half + 1e-5) return null;
      continue;
    }
    let lo = (-half - a[axis]) / delta,
      hi = (half - a[axis]) / delta;
    if (lo > hi) [lo, hi] = [hi, lo];
    enter = Math.max(enter, lo);
    leave = Math.min(leave, hi);
    if (enter > leave + EPS) return null;
  }
  return [enter, leave] as [number, number];
}
type Point2 = [number, number];
function triangleInterval(
  a: Point2,
  b: Point2,
  triangle: readonly Point2[],
  margin = 0,
) {
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = Math.sign(cross(triangle[0], triangle[1], triangle[2]));
  if (!sign) return null;
  let enter = 0,
    leave = 1;
  for (let i = 0; i < 3; i++) {
    const p = triangle[i],
      q = triangle[(i + 1) % 3];
    const start =
        sign * cross(p, q, a) + margin * Math.hypot(q[0] - p[0], q[1] - p[1]),
      delta =
        sign * ((q[0] - p[0]) * (b[1] - a[1]) - (q[1] - p[1]) * (b[0] - a[0]));
    if (Math.abs(delta) < 1e-12) {
      if (start < -1e-9) return null;
    } else if (delta > 0) enter = Math.max(enter, -start / delta);
    else leave = Math.min(leave, -start / delta);
    if (enter > leave + 1e-9) return null;
  }
  return [enter, leave] as [number, number];
}
const vertexKey = (p: TeslaVec3) =>
  p.map((v) => Math.round(v * 1000)).join(',');

/** One source broadphase plus a bounded local triangle cache. Building metadata
 * stays city-wide; actual road/landmark triangles are read only near this car. */
export class TeslaWorld implements TeslaWorldContract {
  private readonly sources = new Map<string, TeslaGeometrySource[]>();
  /** Whole-land meshes stay as a handful of bounds, never city-wide tile entries. */
  private readonly broadSources: TeslaGeometrySource[] = [];
  private readonly cache = new Map<
    string,
    { faces: TeslaFace[]; stamp: number }
  >();
  private stamp = 0;
  private loads = 0;
  private queries = 0;
  private readonly maximum: number;
  private readonly sourceCount: number;
  private positionAllowed: TeslaWorldOptions['validPosition'];
  private readonly modelGroundGroups: ReadonlySet<string>;
  private readonly groundConnections: TeslaWorldOptions['modelGroundConnections'];
  private disposed = false;
  constructor(options: TeslaWorldOptions) {
    this.sourceCount = options.sources.length;
    this.groundConnections = options.modelGroundConnections;
    this.positionAllowed = options.validPosition;
    this.modelGroundGroups = new Set(
      (options.modelGroundGroups ?? []).filter(
        (group) => typeof group === 'string' && group.length > 0,
      ),
    );
    const requested = options.maxCachedTiles ?? 48;
    this.maximum = Number.isSafeInteger(requested)
      ? Math.max(4, Math.min(128, requested))
      : 48;
    for (const source of options.sources) {
      const b = source.bounds;
      if (
        !source.id ||
        ![b.min.x, b.min.z, b.max.x, b.max.z].every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 10_000_000,
        ) ||
        b.isEmpty()
      )
        continue;
      const minX = Math.floor(b.min.x / CELL),
        maxX = Math.floor(b.max.x / CELL),
        minZ = Math.floor(b.min.z / CELL),
        maxZ = Math.floor(b.max.z / CELL);
      if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) {
        this.broadSources.push(source);
        continue;
      }
      for (let x = minX; x <= maxX; x++)
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${z}`,
            values = this.sources.get(key) ?? [];
          values.push(source);
          this.sources.set(key, values);
        }
    }
  }
  private modelConnections(pose: TeslaPose, shape: TeslaShape) {
    if (!shape.groundSupport || !this.groundConnections) return [];
    try {
      const pairs = this.groundConnections(pose, shape);
      if (!Array.isArray(pairs) || pairs.length > 4) return [];
      if (
        pairs.some(
          (pair) =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            pair.some((group) => typeof group !== 'string' || !group) ||
            !pair.some(
              (group) =>
                group === 'ground:0' || this.modelGroundGroups.has(group),
            ),
        )
      )
        return [];
      return pairs;
    } catch {
      return [];
    }
  }
  private modelPeers(
    group: string,
    pairs: readonly (readonly [string, string])[],
  ) {
    const peers = new Set([group]);
    for (const [a, b] of pairs) {
      if (a === group) peers.add(b);
      if (b === group) peers.add(a);
    }
    return peers;
  }
  private modelGround(
    face: TeslaFace,
    shape: TeslaShape,
    pairs: readonly (readonly [string, string])[] = [],
  ) {
    return (
      face.kind === 'ground' &&
      (face.supportGroup === 'ground:0' ||
        (!!shape.groundSupport &&
          (this.modelGroundGroups.has(face.supportGroup) ||
            pairs.some((pair) => pair.includes(face.supportGroup)))))
    );
  }
  private nearby(bounds: THREE.Box3) {
    const minX = Math.floor(bounds.min.x / CELL),
      maxX = Math.floor(bounds.max.x / CELL),
      minZ = Math.floor(bounds.min.z / CELL),
      maxZ = Math.floor(bounds.max.z / CELL),
      minY = Math.floor((bounds.min.y - HEIGHT_ORIGIN) / HEIGHT_BAND),
      maxY = Math.floor((bounds.max.y - HEIGHT_ORIGIN) / HEIGHT_BAND);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) * (maxY - minY + 1) > 256)
      return null;
    const faces = new Map<string, TeslaFace>(),
      solids = new Set<TeslaGeometrySource>();
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        for (let y = minY; y <= maxY; y++) {
          const sourceKey = `${x},${z}`,
            key = `${sourceKey},${y}`;
          const region = new THREE.Box3(
            new THREE.Vector3(
              x * CELL - 0.001,
              HEIGHT_ORIGIN + y * HEIGHT_BAND - 0.001,
              z * CELL - 0.001,
            ),
            new THREE.Vector3(
              (x + 1) * CELL + 0.001,
              HEIGHT_ORIGIN + (y + 1) * HEIGHT_BAND + 0.001,
              (z + 1) * CELL + 0.001,
            ),
          );
          const candidates = [
            ...(this.sources.get(sourceKey) ?? []),
            ...this.broadSources,
          ].filter((source) => source.bounds.intersectsBox(region));
          if (!candidates.length) continue;
          let tile = this.cache.get(key);
          if (!tile) {
            const loaded: TeslaFace[] = [];
            for (const source of candidates)
              loaded.push(...source.load(region));
            tile = { faces: loaded, stamp: ++this.stamp };
            this.cache.set(key, tile);
            this.loads++;
          }
          tile.stamp = ++this.stamp;
          for (const face of tile.faces)
            if (
              face.enabled?.() !== false &&
              faceBounds(face).intersectsBox(bounds)
            )
              faces.set(face.triangleId, face);
          for (const source of candidates)
            if (
              source.inside &&
              source.enabled?.() !== false &&
              source.bounds.intersectsBox(bounds)
            )
              solids.add(source);
        }
    while (this.cache.size > this.maximum) {
      const oldest = [...this.cache].sort((a, b) => a[1].stamp - b[1].stamp)[0];
      this.cache.delete(oldest[0]);
    }
    return { faces: [...faces.values()], solids: [...solids] };
  }
  private invalid(position: TeslaVec3): TeslaSweepHit {
    return {
      surfaceId: 'tesla:invalid-query',
      kind: 'obstacle',
      point: position,
      normal: [0, 1, 0],
      adherable: false,
      fraction: 0,
    };
  }
  sweep(query: TeslaSweepQuery): TeslaSweepHit | null {
    return this.sweepBody(query);
  }
  /** A convex-edge route derived only from this facade and its actual roof.
   * Every chord includes the complete rotating hull; a plan never authorizes
   * later motion without fresh source/support and partial-sweep revalidation. */
  planWallToRoof(query: TeslaWallToRoofQuery): TeslaWallToRoofPlan | null {
    if (
      this.disposed ||
      !finitePose(query.pose) ||
      !validShape(query.shape) ||
      !query.sourceSurfaceId.includes(':wall:')
    )
      return null;
    const { pose, shape, sourceSurfaceId } = query;
    const height = shape.halfExtents[1] + shape.clearance,
      radius = Math.hypot(...shape.halfExtents) + shape.clearance + 0.06,
      axes = basis(pose),
      source = this.support(
        {
          pose,
          shape,
          maxDistance: height + 0.02,
          preferredSurfaceId: sourceSurfaceId,
          adhesion: true,
        },
        (face) => face.kind === 'wall' && face.surfaceId === sourceSurfaceId,
      );
    if (
      source?.surfaceId !== sourceSurfaceId ||
      !source.adherable ||
      Math.abs(source.normal[1]) > 0.01 ||
      axes[2].y < 0.7 ||
      axes[1].dot(asVector(source.normal)) < 1 - 1e-8 ||
      Math.abs(
        asVector(pose.position)
          .sub(asVector(source.point))
          .dot(asVector(source.normal)) - height,
      ) > 1e-5 ||
      asVector(pose.position)
        .sub(asVector(source.point))
        .dot(asVector(source.normal)) <
        extent(asVector(source.normal), axes, shape) - EPS ||
      this.sweep({
        from: pose,
        to: pose,
        shape,
        ignoreSurfaceId: sourceSurfaceId,
      })
    )
      return null;
    const center = asVector(pose.position),
      normal = asVector(source.normal).normalize(),
      building = sourceSurfaceId.slice(0, sourceSurfaceId.indexOf(':wall:')),
      nearby = this.nearby(
        new THREE.Box3()
          .setFromCenterAndSize(center, new THREE.Vector3(1, 1, 1))
          .expandByScalar(12),
      );
    if (!nearby) return null;
    const walls = nearby.faces.filter(
        (face) => face.kind === 'wall' && face.surfaceId === sourceSurfaceId,
      ),
      wallTop = Math.max(
        ...walls.flatMap((face) => face.triangle.map((p) => p[1])),
      ),
      distanceToTop = wallTop - center.y;
    // Ask while the complete wall footprint still exists, just before its
    // front reaches the top. An unrelated upper plane is never a new roof.
    if (
      !Number.isFinite(wallTop) ||
      distanceToTop < shape.halfExtents[2] + shape.clearance - 0.012 ||
      distanceToTop > shape.halfExtents[2] + shape.clearance + 1.5
    )
      return null;
    const roofs = nearby.faces.filter(
      (face) =>
        face.kind === 'roof' &&
        face.adherable &&
        face.normal[1] > 0.92 &&
        face.surfaceId.startsWith(`${building}:roof`),
    );
    const q0 = new THREE.Quaternion(...pose.quaternion).normalize();
    for (const roof of roofs) {
      const roofNormal = asVector(roof.normal).normalize(),
        geometry = faceGeometry(roof),
        edgePoint = center.clone().addScaledVector(normal, -height);
      edgePoint.y =
        geometry.vertices[0].y -
        (roofNormal.x * (edgePoint.x - geometry.vertices[0].x) +
          roofNormal.z * (edgePoint.z - geometry.vertices[0].z)) /
          roofNormal.y;
      if (Math.abs(edgePoint.y - wallTop) > 0.012) continue;
      const joinsWall = geometry.vertices.some((a, i) => {
        const b = geometry.vertices[(i + 1) % 3];
        if (
          [a, b].some(
            (p) =>
              Math.abs(p.clone().sub(asVector(source.point)).dot(normal)) >
                1e-5 ||
              !walls.some(
                (wall) =>
                  faceGeometry(wall)
                    .triangle.closestPointToPoint(p, new THREE.Vector3())
                    .distanceToSquared(p) < 1e-10,
              ),
          )
        )
          return false;
        return (
          new THREE.Line3(a, b)
            .closestPointToPoint(edgePoint, true, new THREE.Vector3())
            .distanceToSquared(edgePoint) < 1e-8
        );
      });
      if (!joinsWall) continue;
      const inward = normal
          .clone()
          .negate()
          .addScaledVector(roofNormal, normal.dot(roofNormal))
          .normalize(),
        // Carry the facade tangent heading through the normal change rather
        // than flattening a diagonal climb into an unrelated roof heading.
        transported = axes[2]
          .clone()
          .applyQuaternion(
            new THREE.Quaternion().setFromUnitVectors(normal, roofNormal),
          )
          .normalize(),
        forward = transported
          .clone()
          .addScaledVector(roofNormal, -transported.dot(roofNormal))
          .normalize(),
        right = roofNormal.clone().cross(forward).normalize(),
        q1 = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(right, roofNormal, forward),
        );
      const quaternion: TeslaPose['quaternion'] = [q1.x, q1.y, q1.z, q1.w];
      for (const inset of [
        shape.halfExtents[2] + shape.clearance + 0.12,
        shape.halfExtents[2] + shape.clearance + 0.62,
        shape.halfExtents[2] + shape.clearance + 1.12,
      ]) {
        const floorPoint = edgePoint.clone().addScaledVector(inward, inset),
          target: TeslaPose = {
            position: tuple(floorPoint.addScaledVector(roofNormal, height)),
            quaternion,
          },
          contact = this.support(
            {
              pose: target,
              shape,
              maxDistance: height + 0.015,
              preferredSurfaceId: roof.surfaceId,
              adhesion: true,
            },
            (face) => face.kind === 'roof' && face.surfaceId === roof.surfaceId,
          );
        if (
          contact?.surfaceId !== roof.surfaceId ||
          this.sweep({
            from: target,
            to: target,
            shape,
            ignoreSurfaceId: contact.surfaceId,
          })
        )
          continue;
        const waypoints: TeslaPose[] = [
          {
            position: tuple(
              center.clone().addScaledVector(normal, radius - height),
            ),
            quaternion: pose.quaternion,
          },
          {
            position: tuple(edgePoint.clone().addScaledVector(normal, radius)),
            quaternion: pose.quaternion,
          },
        ];
        // Three conservative arc chords round the actual convex edge. The
        // rotating SAT proves the entire chord, not just sampled endpoints.
        for (const fraction of [1 / 3, 2 / 3, 1]) {
          const angle = (Math.PI / 2) * fraction,
            position = edgePoint
              .clone()
              .addScaledVector(normal, radius * Math.cos(angle))
              .addScaledVector(roofNormal, radius * Math.sin(angle)),
            q = q0.clone().slerp(q1, fraction);
          waypoints.push({
            position: tuple(position),
            quaternion: [q.x, q.y, q.z, q.w],
          });
        }
        waypoints.push(
          {
            position: tuple(
              asVector(target.position).addScaledVector(
                roofNormal,
                radius - height,
              ),
            ),
            quaternion,
          },
          target,
        );
        const ignoreSurfaceIds = waypoints.map((_, index) =>
          index === 0
            ? sourceSurfaceId
            : index === waypoints.length - 1
              ? contact.surfaceId
              : undefined,
        );
        let previous = pose,
          blocked = false;
        for (const [index, waypoint] of waypoints.entries()) {
          if (
            center.distanceTo(asVector(waypoint.position)) > 16 ||
            asVector(previous.position).distanceTo(
              asVector(waypoint.position),
            ) > 12 ||
            this.sweep({
              from: previous,
              to: waypoint,
              shape,
              ignoreSurfaceId: ignoreSurfaceIds[index],
            })
          ) {
            blocked = true;
            break;
          }
          previous = waypoint;
        }
        if (!blocked)
          return { sourceSurfaceId, contact, waypoints, ignoreSurfaceIds };
      }
    }
    return null;
  }
  /** Strict, short normal withdrawal from a freshly proven ordinary-ground
   * driving pose. This never ignores a face: only the authored non-wheel body
   * is used against ordinary ground while the tyre contacts leave that floor. */
  sweepGroundDeparture(query: TeslaGroundDepartureQuery): TeslaSweepHit | null {
    this.queries++;
    if (
      this.disposed ||
      !finitePose(query.origin) ||
      !finitePose(query.from) ||
      !finitePose(query.to) ||
      !validShape(query.shape) ||
      !query.shape.groundSupport ||
      !query.sourceSurfaceId ||
      [query.origin, query.from, query.to].some(
        (pose) => this.positionAllowed?.(pose.position) === false,
      )
    )
      return this.invalid(query.from.position);
    const originQuaternion = new THREE.Quaternion(
      ...query.origin.quaternion,
    ).normalize();
    for (const pose of [query.from, query.to]) {
      const sameQuaternion = Math.abs(
        originQuaternion.dot(
          new THREE.Quaternion(...pose.quaternion).normalize(),
        ),
      );
      if (
        Math.abs(pose.position[0] - query.origin.position[0]) > EPS ||
        Math.abs(pose.position[2] - query.origin.position[2]) > EPS ||
        pose.position[1] < query.origin.position[1] - EPS ||
        pose.position[1] > query.origin.position[1] + 0.35 + EPS ||
        sameQuaternion < 1 - 1e-12
      )
        return this.invalid(query.from.position);
    }
    if (query.to.position[1] < query.from.position[1] - EPS)
      return this.invalid(query.from.position);
    const radius =
      Math.hypot(...query.shape.halfExtents) + query.shape.clearance;
    const nearby = this.nearby(
      new THREE.Box3()
        .setFromCenterAndSize(
          asVector(query.origin.position),
          new THREE.Vector3(1, 1, 1),
        )
        .expandByScalar(radius + 0.36),
    );
    if (!nearby) return this.invalid(query.from.position);
    const source = nearby.faces.find(
      (face) =>
        face.surfaceId === query.sourceSurfaceId &&
        this.modelGround(face, query.shape) &&
        face.adherable &&
        face.normal[1] > 0.92,
    );
    if (!source) return this.invalid(query.from.position);
    const proof = this.support(
      {
        pose: query.origin,
        shape: query.shape,
        maxDistance: query.shape.halfExtents[1] + query.shape.clearance + 0.2,
        preferredSurfaceId: query.sourceSurfaceId,
        adhesion: false,
      },
      (face) =>
        this.modelGround(face as TeslaFace, query.shape) &&
        (face as TeslaFace).supportGroup === source.supportGroup,
    );
    if (!proof || proof.surfaceId !== query.sourceSurfaceId)
      return this.invalid(query.from.position);
    // Validate the actual departure origin, including its exact source face,
    // against all current physical bodies before granting the bounded path.
    const originHit = this.sweepBody({
      from: query.origin,
      to: query.origin,
      shape: query.shape,
      ignoreSurfaceId: query.sourceSurfaceId,
    });
    if (originHit) return originHit;
    return this.sweepBody(
      {
        from: query.from,
        to: query.to,
        shape: query.shape,
        ignoreSurfaceId: query.sourceSurfaceId,
      },
      true,
    );
  }
  private sweepBody(
    query: TeslaSweepQuery,
    provenDeparture = false,
  ): TeslaSweepHit | null {
    this.queries++;
    if (
      this.disposed ||
      !finitePose(query.from) ||
      !finitePose(query.to) ||
      !validShape(query.shape) ||
      this.positionAllowed?.(query.to.position) === false
    )
      return this.invalid(query.from.position);
    const radius =
      Math.hypot(...query.shape.halfExtents) + query.shape.clearance;
    const bounds = new THREE.Box3()
      .setFromPoints([
        asVector(query.from.position),
        asVector(query.to.position),
      ])
      .expandByScalar(radius + 0.01);
    const nearby = this.nearby(bounds);
    if (!nearby) return this.invalid(query.from.position);
    if (nearby.solids.some((source) => source.inside?.(query.from.position)))
      return this.invalid(query.from.position);
    const candidates = [
      ...this.modelConnections(query.from, query.shape),
      ...this.modelConnections(query.to, query.shape),
    ];
    const unique = candidates.filter(
      (pair, i) =>
        candidates.findIndex(
          (other) =>
            (pair[0] === other[0] && pair[1] === other[1]) ||
            (pair[0] === other[1] && pair[1] === other[0]),
        ) === i,
    );
    const connections = unique.length <= 4 ? unique : [];
    const currentGround = nearby.faces.find(
      (face) =>
        face.surfaceId === query.ignoreSurfaceId &&
        this.modelGround(face, query.shape, connections),
    );
    let suspensionProven: boolean | undefined;
    let suspensionGroup: string | undefined = currentGround?.supportGroup;
    let suspensionPeers: ReadonlySet<string> = suspensionGroup
      ? this.modelPeers(suspensionGroup, connections)
      : new Set();
    const ordinarySuspension = () => {
      if (suspensionProven !== undefined) return suspensionProven;
      // Strict departure has already proved its original source, complete tyre
      // support and physical body. Its later vertical endpoint is intentionally
      // airborne, so the private validated path retains only that bounded proof.
      if (provenDeparture) return (suspensionProven = true);
      let supportSource: TeslaContact | undefined = currentGround;
      let supportGroup = currentGround?.supportGroup;
      if (
        !supportSource &&
        query.shape.groundSupport &&
        query.ignoreSurfaceId
      ) {
        // A real preferred contact may sit a few millimetres beyond the tight
        // collision AABB while its actual adjacent floor union still supports
        // this complete vehicle. Resolve only that exact source from a fresh
        // wheel/union proof; never widen collision bounds or trust an ID alone.
        const proof = this.support(
          {
            pose: query.from,
            shape: query.shape,
            maxDistance:
              query.shape.halfExtents[1] + query.shape.clearance + 0.2,
            preferredSurfaceId: query.ignoreSurfaceId,
            adhesion: false,
          },
          (face) => {
            if (face.surfaceId === query.ignoreSurfaceId)
              supportGroup = (face as TeslaFace).supportGroup;
            return this.modelGround(
              face as TeslaFace,
              query.shape,
              connections,
            );
          },
        );
        if (proof?.surfaceId === query.ignoreSurfaceId) supportSource = proof;
      }
      if (!supportSource) return (suspensionProven = false);
      suspensionGroup = supportGroup;
      suspensionPeers = suspensionGroup
        ? this.modelPeers(suspensionGroup, connections)
        : new Set();
      const groundIds = new Set(
        nearby.faces
          .filter(
            (face) =>
              this.modelGround(face, query.shape, connections) &&
              suspensionPeers.has(face.supportGroup),
          )
          .map((face) => face.surfaceId),
      );
      return (suspensionProven = [query.from, query.to].every(
        (pose) =>
          !!this.support(
            {
              pose,
              shape: query.shape,
              maxDistance:
                query.shape.halfExtents[1] + query.shape.clearance + 0.2,
              preferredSurfaceId: supportSource.surfaceId,
              adhesion: false,
            },
            (face) => groundIds.has(face.surfaceId),
          ),
      ));
    };
    let connectedGround: Set<string> | undefined;
    const continuousGrade = (target: TeslaFace) => {
      if (!currentGround) return false;
      connectedGround ??= connectedGroundFaces(currentGround, nearby.faces);
      return connectedGround.has(target.surfaceId);
    };
    const suspensionFrames = [basis(query.from), basis(query.to)];
    const q0 = new THREE.Quaternion(...query.from.quaternion).normalize(),
      q1 = new THREE.Quaternion(...query.to.quaternion).normalize();
    const angle = q0.angleTo(q1),
      steps = Math.max(1, Math.ceil(angle / (Math.PI / 90)));
    const angularPadding =
      angle > EPS ? 2 * radius * Math.sin(angle / steps / 2) : 0;
    let first: TeslaSweepHit | null = null;
    for (let step = 0; step < steps; step++) {
      const a =
          angle < EPS
            ? query.from
            : interpolated(query.from, query.to, step / steps),
        b =
          angle < EPS
            ? query.to
            : interpolated(query.from, query.to, (step + 1) / steps);
      const frame = sweepFrame(
          a,
          b,
          angularPadding,
          step === 0 ? suspensionFrames[0] : basis(a),
        ),
        endAxes = step + 1 === steps ? suspensionFrames[1] : basis(b);
      let modelBodies: ReturnType<typeof groundBodyFrame>[] | undefined;
      for (const face of nearby.faces) {
        if (
          face.surfaceId === query.ignoreSurfaceId &&
          !(
            query.shape.groundSupport &&
            this.modelGround(face, query.shape, connections)
          )
        )
          continue;
        let time = triangleSweep(frame, query.shape, face, angularPadding);
        // Model metadata separates real tyre contact proof from the authored
        // non-wheel body envelope. Wheel suspension never raises that body's
        // floor; each section retains its measured clearance and original top.
        // Legacy shapes retain their bounded 5cm tyre skin and connected-grade
        // allowance (at most 20cm). Neither path gives nonadherable paving
        // slivers support permission. All require full ordinary-ground proof
        // at both endpoints; every other obstacle keeps the complete hull.
        if (
          time !== null &&
          this.modelGround(face, query.shape, connections) &&
          ordinarySuspension() &&
          suspensionPeers.has(face.supportGroup)
        ) {
          if (query.shape.groundSupport) {
            modelBodies ??= modelGroundBodies(frame, endAxes, query.shape);
            time = null;
            for (const body of modelBodies) {
              const hit = triangleSweep(
                body.frame,
                body.shape,
                face,
                angularPadding,
              );
              if (hit !== null && (time === null || hit < time)) time = hit;
            }
          } else {
            const normal = faceGeometry(face).rawNormal;
            const gradeTravel = continuousGrade(face)
              ? Math.max(
                  ...suspensionFrames.map(
                    (axes) =>
                      Math.abs(normal.dot(axes[0])) *
                        query.shape.halfExtents[0] +
                      Math.abs(normal.dot(axes[2])) *
                        query.shape.halfExtents[2],
                  ),
                )
              : 0;
            const skin = Math.min(0.2, 0.05 + gradeTravel),
              body = groundBodyFrame(
                frame,
                endAxes,
                query.shape,
                -query.shape.halfExtents[2],
                query.shape.halfExtents[2],
                skin,
              );
            time = triangleSweep(body.frame, body.shape, face, angularPadding);
          }
        }
        if (time === null) continue;
        const fraction = (step + time) / steps;
        const center = asVector(interpolated(a, b, time).position);
        const triangle = faceGeometry(face).triangle;
        const point = triangle.closestPointToPoint(center, new THREE.Vector3());
        const hitNormal = asVector(face.normal);
        if (
          face.kind === 'obstacle' &&
          hitNormal.dot(center.clone().sub(point)) < 0
        )
          hitNormal.negate();
        let acceptedFraction = fraction;
        if (first && first.fraction <= fraction + 1e-9) {
          // Several box faces can meet the body at the same instant. Prefer
          // the opposed normal of that same prop, rather than a tangent side
          // selected by Float64 last bits; tangent faces consume no energy.
          const root = (id: string) =>
            id.match(/^(guardrail:\d+|debris:(?:tree|lamp):\d+)(?::|$)/)?.[1] ??
            id.split(':side:')[0];
          const travel = asVector(b.position).sub(asVector(a.position));
          const tied =
            face.kind === 'obstacle' &&
            first.kind === 'obstacle' &&
            Math.abs(first.fraction - fraction) <= 1e-9 &&
            root(first.surfaceId) === root(face.surfaceId);
          if (tied) {
            acceptedFraction = Math.min(first.fraction, fraction);
            first.fraction = acceptedFraction;
          }
          if (
            face.kind !== 'obstacle' ||
            first.kind !== 'obstacle' ||
            Math.abs(first.fraction - fraction) > 1e-9 ||
            root(first.surfaceId) !== root(face.surfaceId) ||
            hitNormal.dot(travel) >= asVector(first.normal).dot(travel) - 1e-10
          )
            continue;
        }
        first = {
          surfaceId: face.surfaceId,
          kind: face.kind,
          point: tuple(point),
          normal: tuple(hitNormal),
          adherable: face.adherable,
          fraction: acceptedFraction,
        };
      }
      if (first) break;
    }
    return first;
  }
  support(
    query: TeslaSupportQuery,
    accepts?: (face: TeslaContact) => boolean,
  ): TeslaContact | null {
    this.queries++;
    if (
      this.disposed ||
      !finitePose(query.pose) ||
      !validShape(query.shape) ||
      !Number.isFinite(query.maxDistance) ||
      query.maxDistance < 0 ||
      query.maxDistance > 1024
    )
      return null;
    const center = asVector(query.pose.position),
      axes = basis(query.pose),
      up = axes[1];
    const radius =
      Math.hypot(...query.shape.halfExtents) + query.shape.clearance;
    const bounds = new THREE.Box3()
      .setFromPoints([
        center,
        center.clone().addScaledVector(up, -query.maxDistance),
      ])
      .expandByScalar(radius + 0.01);
    const nearby = this.nearby(bounds);
    if (!nearby) return null;
    const connections = this.modelConnections(query.pose, query.shape);
    const peerCache = new Map<string, ReadonlySet<string>>();
    const peersFor = (group: string) => {
      let peers = peerCache.get(group);
      if (!peers) {
        peers = this.modelPeers(group, connections);
        peerCache.set(group, peers);
      }
      return peers;
    };
    const wheelProofs = new Map<string, boolean>();
    const wheelSupport = (group: string) => {
      const proven = wheelProofs.get(group);
      if (proven !== undefined) return proven;
      const ground = query.shape.groundSupport;
      if (!ground) return true;
      const floors = nearby.faces.filter(
        (face) =>
          face.kind === 'ground' &&
          peersFor(group).has(face.supportGroup) &&
          face.adherable &&
          face.normal[1] > 0.92 &&
          accepts?.(face) !== false,
      );
      const triangles = floors.map((face) => face.triangle);
      const provenWheels = ground.wheelContacts.every((wheel) => {
        const p = center
            .clone()
            .addScaledVector(axes[0], wheel[0])
            .addScaledVector(axes[1], wheel[1])
            .addScaledVector(axes[2], wheel[2]),
          height = tyreHeightAt(
            floors,
            triangles,
            p.x,
            p.z,
            axes[2],
            query.shape,
            center.y - radius,
            center.y + radius,
          );
        return (
          height !== null &&
          Math.abs(height - p.y) * Math.abs(up.y) <=
            ground.suspensionTravel + GROUND_SEAM_EPS
        );
      });
      wheelProofs.set(group, provenWheels);
      return provenWheels;
    };
    const scratch = new THREE.Vector3(),
      closest = new THREE.Vector3(),
      probe = new THREE.Vector3();
    const candidates = nearby.faces
      .filter(
        (face) =>
          face.adherable &&
          accepts?.(face) !== false &&
          (query.adhesion || face.normal[1] > 0.92) &&
          faceGeometry(face).rawNormal.dot(up) > 0.96,
      )
      .map((face) => {
        const geometry = faceGeometry(face),
          distance = scratch
            .copy(center)
            .sub(geometry.vertices[0])
            .dot(geometry.rawNormal);
        return {
          face,
          distance,
          gap: distance - extent(geometry.rawNormal, axes, query.shape),
        };
      })
      .filter(
        ({ face, gap, distance }) =>
          // A finite ground triangle can end at a crest while its infinite
          // extension intersects the long OBB. Authored ground uses the actual
          // tyres/union below; finite-body clearance remains a separate sweep.
          // The physical claim must still be below the chassis, never a ceiling.
          (this.modelGround(face, query.shape, connections) &&
          query.shape.groundSupport
            ? distance >= 0
            : gap >=
              (this.modelGround(face, query.shape, connections)
                ? -0.16
                : -0.08)) && distance <= query.maxDistance + 1e-5,
      )
      .sort(
        (a, b) =>
          Number(b.face.surfaceId === query.preferredSurfaceId) -
            Number(a.face.surfaceId === query.preferredSurfaceId) ||
          a.gap - b.gap ||
          a.face.surfaceId.localeCompare(b.face.surfaceId),
      );
    for (const { face, distance } of candidates) {
      const geometry = faceGeometry(face),
        normal = geometry.normal;
      const modelGround = this.modelGround(face, query.shape, connections);
      if (modelGround && !wheelSupport(face.supportGroup)) continue;
      // Ordinary roads and explicit model-road groups prove one physical layer; the source
      // curb is .13m high. This bounded suspension range is never used to join
      // roof/wall planes or different protected floor identities.
      const planeTolerance = modelGround ? 0.15 : 0.012;
      const point = center
        .clone()
        .addScaledVector(
          normal,
          -scratch.copy(center).sub(geometry.vertices[0]).dot(normal),
        );
      const physicalPoint = geometry.triangle.closestPointToPoint(
        point,
        new THREE.Vector3(),
      );
      // At a mild convex crest both infinite-plane projections can fall just
      // outside their finite triangles. Authored tyres have already proved the
      // real height field; permit its nearby physical edge as a new candidate.
      // The full footprint union below still rejects every exposed hole.
      if (
        face.kind === 'ground' &&
        physicalPoint.distanceToSquared(point) >
          (modelGround && query.shape.groundSupport
            ? planeTolerance ** 2
            : 1e-10) &&
        (query.preferredSurfaceId !== face.surfaceId ||
          physicalPoint.distanceToSquared(point) > (radius + 0.01) ** 2)
      )
        continue;
      if (
        modelGround &&
        candidates.some(({ face: other, distance: otherDistance }) => {
          if (
            !peersFor(face.supportGroup).has(other.supportGroup) ||
            otherDistance >= distance - 0.001
          )
            return false;
          const otherGeometry = faceGeometry(other),
            n = otherGeometry.rawNormal,
            p = scratch.copy(center).addScaledVector(n, -otherDistance);
          return otherGeometry.triangle.containsPoint(p);
        })
      )
        continue;
      // Authored model roads prove the actual tyre support rectangle,
      // separately from the larger body whose complete sweeps still apply.
      // Its plane follows the actual wheel frame; the claimed triangle point
      // and normal remain physical source data. Other protected floors, roofs and legacy support
      // keeps its original full-body footprint and plane.
      const tyres = modelGround
        ? query.shape.groundSupport?.wheelContacts
        : undefined;
      const tyreProjectionDeterminant =
        axes[0].x * axes[2].z - axes[2].x * axes[0].z;
      if (
        tyres &&
        (!Number.isFinite(tyreProjectionDeterminant) ||
          tyreProjectionDeterminant <= EPS)
      )
        continue;
      const minX = tyres ? Math.min(...tyres.map((p) => p[0])) : 0;
      const maxX = tyres ? Math.max(...tyres.map((p) => p[0])) : 0;
      const minZ = tyres ? Math.min(...tyres.map((p) => p[2])) : 0;
      const maxZ = tyres ? Math.max(...tyres.map((p) => p[2])) : 0;
      const footprintPoint = tyres
        ? center
            .clone()
            .addScaledVector(axes[0], (minX + maxX) / 2)
            .addScaledVector(
              axes[1],
              tyres.reduce((sum, p) => sum + p[1], 0) / 4,
            )
            .addScaledVector(axes[2], (minZ + maxZ) / 2)
        : point;
      const footprintNormal = tyres ? axes[1] : normal;
      const peers = nearby.faces.filter(
        (other) =>
          other.adherable &&
          accepts?.(other) !== false &&
          peersFor(face.supportGroup).has(other.supportGroup) &&
          (modelGround
            ? other.kind === 'ground' &&
              other.normal[1] > 0.92 &&
              faceGeometry(other).rawNormal.dot(up) > 0.96
            : faceGeometry(other).rawNormal.dot(normal) > 0.97) &&
          Math.abs(
            (modelGround
              ? faceGeometry(other).triangle.closestPointToPoint(
                  footprintPoint,
                  closest,
                )
              : closest.copy(faceGeometry(other).vertices[0])
            )
              .sub(footprintPoint)
              .dot(footprintNormal),
          ) <= planeTolerance,
      );
      let connectedGrades: Set<string> | undefined;
      const covering = (p: THREE.Vector3) =>
        peers.some((other) => {
          const otherGeometry = faceGeometry(other),
            distanceSq = otherGeometry.triangle
              .closestPointToPoint(p, closest)
              .distanceToSquared(p);
          if (distanceSq <= planeTolerance ** 2) return true;
          if (!modelGround) return false;
          connectedGrades ??= connectedGroundFaces(face, nearby.faces);
          if (!connectedGrades.has(other.surfaceId)) return false;
          // A continuous grade can exceed the ordinary .15m curb-plane range
          // at a bumper before the chassis centre reaches the shared edge.
          // Match the existing proven grade suspension envelope, never a
          // larger gap or an unrelated parallel/raised floor.
          const gradeTravel =
            Math.abs(otherGeometry.rawNormal.dot(axes[0])) *
              query.shape.halfExtents[0] +
            Math.abs(otherGeometry.rawNormal.dot(axes[2])) *
              query.shape.halfExtents[2];
          return distanceSq <= Math.min(0.2, 0.05 + gradeTravel) ** 2;
        });
      const halfX = tyres
          ? (maxX - minX) / 2
          : query.shape.halfExtents[0] + query.shape.clearance,
        halfZ = tyres
          ? (maxZ - minZ) / 2
          : query.shape.halfExtents[2] + query.shape.clearance;
      if (tyres && (halfX <= 0.002 || halfZ <= 0.002)) continue;
      if (
        ![-1, 0, 1].every((x) =>
          [-1, 0, 1].every((z) =>
            covering(
              probe
                .copy(footprintPoint)
                .addScaledVector(axes[0], halfX * x)
                .addScaledVector(axes[2], halfZ * z),
            ),
          ),
        )
      )
        continue;
      // Exposed physical mesh edges inside the footprint catch narrow holes,
      // diagonal clipped corners and roof courtyards that corner probes miss.
      const edges = new Map<
        string,
        { a: TeslaVec3; b: TeslaVec3; third: TeslaVec3; count: number }
      >();
      for (const peer of peers)
        for (let i = 0; i < 3; i++) {
          const a = peer.triangle[i],
            b = peer.triangle[(i + 1) % 3],
            key = (
              modelGround
                ? faceGeometry(peer).xzKeys
                : faceGeometry(peer).xyzKeys
            )[i];
          const previous = edges.get(key);
          if (previous) previous.count++;
          else
            edges.set(key, {
              a,
              b,
              third: peer.triangle[(i + 2) % 3],
              count: 1,
            });
        }
      const project = (p: TeslaVec3): [number, number] => {
        const dx = p[0] - footprintPoint.x,
          dy = p[1] - footprintPoint.y,
          dz = p[2] - footprintPoint.z;
        if (tyres) {
          // Each model road group forms one height field. Project its union in XZ onto
          // the actual tyre parallelogram: a curb's vertical rise is not a
          // horizontal hole. Wheel heights and the complete body remain
          // independently proved; true XZ gaps retain their exact intervals.
          return [
            (axes[2].z * dx - axes[2].x * dz) / tyreProjectionDeterminant,
            (axes[0].x * dz - axes[0].z * dx) / tyreProjectionDeterminant,
          ];
        }
        return [
          dx * axes[0].x + dy * axes[0].y + dz * axes[0].z,
          dx * axes[2].x + dy * axes[2].y + dz * axes[2].z,
        ];
      };
      const projectedPeers = modelGround
        ? peers.map((peer) => peer.triangle.map(project))
        : [];
      if (
        [...edges.values()].some((edge) => {
          const a = project(edge.a),
            b = project(edge.b);
          const clipped = rectangleInterval(a, b, halfX - 0.002, halfZ - 0.002);
          if (!clipped) return false;
          if (!modelGround) return edge.count === 1;
          // Road/footway triangles may end underneath an overlapping terrain
          // triangle. That edge is interior to the union, not a physical hole.
          // Prove continuous coverage along its entire outward side using
          // analytic triangle intervals rather than a handful of samples.
          const third = project(edge.third),
            dx = b[0] - a[0],
            dz = b[1] - a[1],
            length = Math.hypot(dx, dz);
          if (length < 1e-9) return false;
          // Intervals parameterize an edge, so a fixed parameter epsilon
          // becomes an arbitrarily small world tolerance on short tessellation
          // edges. Compare coverage in the same spatial units as the SAT.
          const intervalTolerance = EPS / length;
          let nx = dz / length,
            nz = -dx / length;
          if ((third[0] - a[0]) * nx + (third[1] - a[1]) * nz > 0) {
            nx = -nx;
            nz = -nz;
          }
          const outsideA: Point2 = [a[0] + nx * 1e-4, a[1] + nz * 1e-4],
            outsideB: Point2 = [b[0] + nx * 1e-4, b[1] + nz * 1e-4];
          const intervals = projectedPeers
            .map((triangle) =>
              triangleInterval(outsideA, outsideB, triangle, GROUND_SEAM_EPS),
            )
            .filter(
              (interval): interval is [number, number] => interval !== null,
            )
            .sort((a, b) => a[0] - b[0]);
          let covered = clipped[0];
          for (const [lo, hi] of intervals) {
            if (hi < covered - intervalTolerance) continue;
            if (lo > covered + intervalTolerance) return true;
            covered = Math.max(covered, hi);
            if (covered >= clipped[1] - intervalTolerance) return false;
          }
          return covered < clipped[1] - intervalTolerance;
        })
      )
        continue;
      return {
        surfaceId: face.surfaceId,
        kind: face.kind,
        point: tuple(modelGround ? physicalPoint : point),
        normal: face.normal,
        adherable: face.adherable,
      };
    }
    return null;
  }
  /** A driving-frame proposal from four real tyre contacts. It does not grant
   * motion permission: callers must sweep the complete vehicle before applying
   * this pose. The returned contact remains an actual source triangle plane. */
  fitGround(
    query: TeslaGroundFitQuery,
    accepts?: (face: TeslaContact) => boolean,
  ): TeslaGroundFit | null {
    this.queries++;
    const ground = query.shape.groundSupport;
    if (
      this.disposed ||
      !ground ||
      !validShape(query.shape) ||
      !finitePose(query.pose) ||
      (query.from !== undefined &&
        (!finitePose(query.from) ||
          this.positionAllowed?.(query.from.position) === false)) ||
      !Number.isFinite(query.maxAdjustmentM) ||
      query.maxAdjustmentM < 0 ||
      query.maxAdjustmentM > 1
    )
      return null;
    const original = asVector(query.pose.position),
      initialAxes = basis(query.pose),
      radius = Math.hypot(...query.shape.halfExtents) + query.shape.clearance;
    if (initialAxes[1].y < 0.92) return null;
    const nearby = this.nearby(
      new THREE.Box3()
        .setFromCenterAndSize(original, new THREE.Vector3(1, 1, 1))
        .expandByScalar(radius + query.maxAdjustmentM),
    );
    if (!nearby) return null;
    const connections = this.modelConnections(query.pose, query.shape);
    const preferred = nearby.faces.find(
      (face) => face.surfaceId === query.preferredSurfaceId,
    );
    if (!preferred || !this.modelGround(preferred, query.shape, connections))
      return null;
    const group = preferred.supportGroup;
    const peerGroups = this.modelPeers(group, connections);
    const faces = nearby.faces.filter(
      (face) =>
        face.kind === 'ground' &&
        peerGroups.has(face.supportGroup) &&
        face.adherable &&
        face.normal[1] > 0.92 &&
        accepts?.(face) !== false,
    );
    const allowedIds = new Set(faces.map((face) => face.surfaceId));
    if (!allowedIds.has(query.preferredSurfaceId)) return null;
    const triangles = faces.map((face) => face.triangle);
    const sample = (x: number, z: number, forward = initialAxes[2]) => {
      const height = tyreHeightAt(
        faces,
        triangles,
        x,
        z,
        forward,
        query.shape,
        original.y - radius - query.maxAdjustmentM,
        original.y + query.maxAdjustmentM,
      );
      return height === null ? null : new THREE.Vector3(x, height, z);
    };
    const contactFor = (candidate: TeslaPose) =>
      this.support(
        {
          pose: candidate,
          shape: query.shape,
          maxDistance:
            query.shape.halfExtents[1] +
            query.shape.clearance +
            query.maxAdjustmentM,
          preferredSurfaceId: query.preferredSurfaceId,
          adhesion: false,
        },
        (face) => allowedIds.has(face.surfaceId) && accepts?.(face) !== false,
      );
    const bodyCollision = (
      candidate: TeslaPose,
    ): TeslaFace | 'inside' | null => {
      if (nearby.solids.some((source) => source.inside?.(candidate.position)))
        return 'inside';
      const frame = sweepFrame(candidate, candidate, 0),
        bodies = modelGroundBodies(frame, frame.axes, query.shape);
      for (const face of nearby.faces) {
        if (face.enabled?.() === false) continue;
        if (face.kind === 'ground' && peerGroups.has(face.supportGroup)) {
          if (
            bodies.some(
              (body) => triangleSweep(body.frame, body.shape, face, 0) !== null,
            )
          )
            return face;
        } else if (triangleSweep(frame, query.shape, face, 0) !== null)
          return face;
      }
      return null;
    };
    let remainingRouteCandidates = 12;
    const routeFit = (
      candidate: TeslaPose,
      contact: TeslaContact,
      maximumHeave: number,
    ): TeslaGroundFit | null => {
      if (!query.from) return { pose: candidate, contact };
      // A static lowest fit can graze a curb during rotation. Search only the
      // already-proved wheel-travel interval; each candidate must independently
      // prove support, the body and the entire unchanged continuous sweep.
      // These are candidate choices, not sampled collision permission.
      for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
        if (remainingRouteCandidates-- <= 0) return null;
        if (fraction && maximumHeave <= EPS) break;
        const raised: TeslaPose = {
          position: [
            candidate.position[0],
            candidate.position[1] + Math.max(0, maximumHeave) * fraction,
            candidate.position[2],
          ],
          quaternion: candidate.quaternion,
        };
        if (this.positionAllowed?.(raised.position) === false) continue;
        const proof = fraction ? contactFor(raised) : contact;
        if (
          proof &&
          !bodyCollision(raised) &&
          !this.sweep({
            from: query.from,
            to: raised,
            shape: query.shape,
            ignoreSurfaceId: query.preferredSurfaceId,
          })
        )
          return { pose: raised, contact: proof };
      }
      return null;
    };
    const fitOls = (): TeslaGroundFit | null => {
      let fitted: TeslaPose = query.pose,
        axes = initialAxes;
      for (let iteration = 0; iteration < 2; iteration++) {
        const center = asVector(fitted.position),
          points: THREE.Vector3[] = [];
        for (const wheel of ground.wheelContacts) {
          const p = center
            .clone()
            .addScaledVector(axes[0], wheel[0])
            .addScaledVector(axes[1], wheel[1])
            .addScaledVector(axes[2], wheel[2]);
          const hit = sample(p.x, p.z, axes[2]);
          if (!hit) return null;
          points.push(hit);
        }
        const mean = points
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .multiplyScalar(0.25);
        let xx = 0,
          xz = 0,
          zz = 0,
          xy = 0,
          zy = 0;
        for (const p of points) {
          const x = p.x - mean.x,
            y = p.y - mean.y,
            z = p.z - mean.z;
          xx += x * x;
          xz += x * z;
          zz += z * z;
          xy += x * y;
          zy += z * y;
        }
        const determinant = xx * zz - xz * xz;
        if (determinant < 1e-8) return null;
        const slopeX = (xy * zz - zy * xz) / determinant,
          slopeZ = (zy * xx - xy * xz) / determinant,
          normal = new THREE.Vector3(-slopeX, 1, -slopeZ).normalize();
        if (normal.y < 0.92) return null;
        const forward = initialAxes[2]
            .clone()
            .addScaledVector(normal, -initialAxes[2].dot(normal))
            .normalize(),
          right = normal.clone().cross(forward).normalize(),
          quaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(right, normal, forward),
          );
        axes = [right, normal, forward];
        const wheelY =
            ground.wheelContacts.reduce((sum, p) => sum + p[1], 0) / 4,
          y =
            mean.y +
            slopeX * (original.x - mean.x) +
            slopeZ * (original.z - mean.z) -
            wheelY / normal.y;
        fitted = {
          position: [original.x, y, original.z],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        };
      }
      const fittedCenter = asVector(fitted.position);
      if (
        fittedCenter.distanceTo(original) > query.maxAdjustmentM + EPS ||
        this.positionAllowed?.(fitted.position) === false
      )
        return null;
      let maximumHeave = original.y + query.maxAdjustmentM - fittedCenter.y;
      for (const wheel of ground.wheelContacts) {
        const p = fittedCenter
            .clone()
            .addScaledVector(axes[0], wheel[0])
            .addScaledVector(axes[1], wheel[1])
            .addScaledVector(axes[2], wheel[2]),
          actual = sample(p.x, p.z, axes[2]);
        if (
          !actual ||
          Math.abs(actual.y - p.y) * axes[1].y >
            ground.suspensionTravel + GROUND_SEAM_EPS
        )
          return null;
        maximumHeave = Math.min(
          maximumHeave,
          actual.y - p.y + ground.suspensionTravel / axes[1].y,
        );
      }
      const contact = contactFor(fitted);
      if (!contact) return null;
      const blocked = bodyCollision(fitted);
      if (!blocked) return routeFit(fitted, contact, maximumHeave);
      if (
        blocked === 'inside' ||
        blocked.kind !== 'ground' ||
        !peerGroups.has(blocked.supportGroup) ||
        maximumHeave <= EPS
      )
        return null;
      // At fixed orientation/XZ, every physical triangle excludes an exact world-Y
      // interval. Pick the first free height inside all four real tyre-travel
      // intervals, rather than adding clearance or always raising the vehicle.
      const frame = sweepFrame(fitted, fitted, 0),
        bodies = modelGroundBodies(frame, frame.axes, query.shape),
        forbidden: [number, number][] = [];
      for (const face of nearby.faces) {
        if (face.enabled?.() === false) continue;
        const targets =
          face.kind === 'ground' && peerGroups.has(face.supportGroup)
            ? bodies
            : [{ frame, shape: query.shape }];
        for (const body of targets) {
          const interval = verticalCollisionInterval(body, face, maximumHeave);
          if (interval) forbidden.push(interval);
        }
      }
      forbidden.sort((a, b) => a[0] - b[0]);
      let heave = 0;
      for (const [lo, hi] of forbidden) {
        if (hi < heave - EPS) continue;
        if (lo > heave + EPS) break;
        heave = Math.max(heave, hi + EPS);
      }
      if (heave > maximumHeave + EPS) return null;
      const raised: TeslaPose = {
        position: [
          fitted.position[0],
          fitted.position[1] + heave,
          fitted.position[2],
        ],
        quaternion: fitted.quaternion,
      };
      if (this.positionAllowed?.(raised.position) === false) return null;
      const raisedContact = contactFor(raised);
      return raisedContact && !bodyCollision(raised)
        ? routeFit(raised, raisedContact, maximumHeave - heave)
        : null;
    };
    const fitted = fitOls();
    if (fitted) return fitted;

    // A least-squares pitch is a preference, not the only legal suspension
    // attitude. Retain the caller's bounded frame when it can traverse a crease
    // using the existing four-wheel travel; solve height without adding angle.
    const adjustment = Math.min(query.maxAdjustmentM, 0.35);
    let lowerY = original.y - adjustment,
      upperY = original.y + adjustment;
    for (const wheel of ground.wheelContacts) {
      const offset = new THREE.Vector3()
        .addScaledVector(initialAxes[0], wheel[0])
        .addScaledVector(initialAxes[1], wheel[1])
        .addScaledVector(initialAxes[2], wheel[2]);
      const actual = sample(original.x + offset.x, original.z + offset.z);
      if (!actual) return null;
      const travelY = ground.suspensionTravel / initialAxes[1].y;
      lowerY = Math.max(lowerY, actual.y - offset.y - travelY);
      upperY = Math.min(upperY, actual.y - offset.y + travelY);
    }
    if (lowerY > upperY) return null;
    const base: TeslaPose = {
      position: [original.x, lowerY, original.z],
      quaternion: query.pose.quaternion,
    };
    const range = upperY - lowerY,
      frame = sweepFrame(base, base, 0),
      bodies = modelGroundBodies(frame, frame.axes, query.shape),
      forbidden: [number, number][] = [];
    for (const face of nearby.faces) {
      if (face.enabled?.() === false) continue;
      const targets =
        face.kind === 'ground' && peerGroups.has(face.supportGroup)
          ? bodies
          : [{ frame, shape: query.shape }];
      for (const body of targets) {
        const interval = verticalCollisionInterval(body, face, range);
        if (interval) forbidden.push(interval);
      }
    }
    forbidden.sort((a, b) => a[0] - b[0]);
    const clear: [number, number][] = [];
    let cursor = 0;
    for (const [lo, hi] of forbidden) {
      if (hi < cursor - EPS) continue;
      if (lo > cursor + EPS) clear.push([cursor, Math.min(range, lo - EPS)]);
      cursor = Math.max(cursor, hi + EPS);
      if (cursor > range) break;
    }
    if (cursor <= range) clear.push([cursor, range]);
    const desired = Math.max(0, Math.min(range, original.y - lowerY));
    const heights = clear
      .map(([lo, hi]) => Math.max(lo, Math.min(hi, desired)))
      .sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    for (const height of heights) {
      const candidate: TeslaPose = {
        position: [original.x, lowerY + height, original.z],
        quaternion: query.pose.quaternion,
      };
      if (this.positionAllowed?.(candidate.position) === false) continue;
      const contact = contactFor(candidate);
      if (contact && !bodyCollision(candidate)) {
        const routed = routeFit(candidate, contact, range - height);
        if (routed) return routed;
      }
    }
    return null;
  }
  cameraSweep(from: TeslaVec3, to: TeslaVec3, radius = 0.25) {
    return this.sweep({
      from: { position: from, quaternion: [0, 0, 0, 1] },
      to: { position: to, quaternion: [0, 0, 0, 1] },
      shape: {
        halfExtents: [
          Math.max(0.01, radius),
          Math.max(0.01, radius),
          Math.max(0.01, radius),
        ],
        clearance: 0,
      },
    });
  }
  /** Explicit recovery helper only; simulation never teleports on collision. */
  escape(
    pose: TeslaPose,
    shape: TeslaShape,
    maxDistance = 12,
  ): TeslaPose | null {
    if (
      !finitePose(pose) ||
      !validShape(shape) ||
      !Number.isFinite(maxDistance)
    )
      return null;
    if (!this.sweep({ from: pose, to: pose, shape })) return pose;
    for (
      let distance = 0.5;
      distance <= Math.min(32, Math.max(0, maxDistance));
      distance += 0.5
    )
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            if (!x && !y && !z) continue;
            const offset = new THREE.Vector3(x, y, z)
              .normalize()
              .multiplyScalar(distance);
            const candidate: TeslaPose = {
              position: [
                pose.position[0] + offset.x,
                pose.position[1] + offset.y,
                pose.position[2] + offset.z,
              ],
              quaternion: pose.quaternion,
            };
            if (!this.sweep({ from: candidate, to: candidate, shape }))
              return candidate;
          }
    return null;
  }
  stats() {
    return {
      sources: this.sourceCount,
      sourceCells: this.sources.size,
      broadSources: this.broadSources.length,
      cachedTiles: this.cache.size,
      loadedTiles: this.loads,
      cachedFaces: [...this.cache.values()].reduce(
        (n, tile) => n + tile.faces.length,
        0,
      ),
      queries: this.queries,
    };
  }
  dispose() {
    this.disposed = true;
    this.positionAllowed = undefined;
    this.cache.clear();
    this.sources.clear();
    this.broadSources.length = 0;
  }
}

export function triangleFace(
  surfaceId: string,
  triangleId: string,
  kind: TeslaContact['kind'],
  vertices: readonly [TeslaVec3, TeslaVec3, TeslaVec3],
  adherable: boolean,
  supportGroup = surfaceId,
  normalHint?: TeslaVec3,
): TeslaFace {
  const triangle = new THREE.Triangle(
    ...(vertices.map(asVector) as [
      THREE.Vector3,
      THREE.Vector3,
      THREE.Vector3,
    ]),
  );
  const normal = normalHint
    ? asVector(normalHint).normalize()
    : triangle.getNormal(new THREE.Vector3());
  return {
    surfaceId,
    triangleId,
    kind,
    triangle: vertices,
    normal: tuple(normal),
    point: vertices[0],
    adherable,
    supportGroup,
  };
}
export function fixedFacesSource(
  id: string,
  faces: TeslaFace[],
  inside?: TeslaGeometrySource['inside'],
): TeslaGeometrySource {
  return {
    id,
    inside,
    bounds: new THREE.Box3().setFromPoints(
      faces.flatMap((face) => face.triangle.map(asVector)),
    ),
    load: (region) =>
      faces.filter((face) => faceBounds(face).intersectsBox(region)),
  };
}
