import * as THREE from 'three';

/** Trial-only deformation of the authored exterior. Local units are metres;
 * all visible geometry stays inside the existing Drive sweep hull. */
export const ROADSTER_FORM_MAX_LIFT_M = 0.105;
const p = Object.freeze({
  hoodM: ROADSTER_FORM_MAX_LIFT_M,
  deckM: 0.075,
  innerX: 0.58,
  outerX: 0.8,
  lowY: 0.38,
  lowFullY: 0.58,
  highFullY: 0.83,
  highY: 1.08,
  hoodStartZ: 0.72,
  hoodFullZ: 0.95,
  hoodEndFullZ: 1.45,
  hoodEndZ: 1.82,
  deckStartZ: -1.97,
  deckFullZ: -1.72,
  deckEndFullZ: -1.25,
  deckEndZ: -0.95,
});

const smooth = (a: number, b: number, value: number) => {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const smoothSlope = (a: number, b: number, value: number) => {
  if (value <= a || value >= b) return 0;
  const t = (value - a) / (b - a);
  return (6 * t * (1 - t)) / (b - a);
};

/** Returns the full-weight vertical deformation at one car-local position. */
export function roadsterFormLift(x: number, y: number, z: number, weight = 1) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(weight)
  )
    return 0;
  const side = 1 - smooth(p.innerX, p.outerX, Math.abs(x));
  const height =
    smooth(p.lowY, p.lowFullY, y) * (1 - smooth(p.highFullY, p.highY, y));
  const hood =
    smooth(p.hoodStartZ, p.hoodFullZ, z) *
    (1 - smooth(p.hoodEndFullZ, p.hoodEndZ, z));
  const deck =
    smooth(p.deckStartZ, p.deckFullZ, z) *
    (1 - smooth(p.deckEndFullZ, p.deckEndZ, z));
  return (
    (p.hoodM * hood + p.deckM * deck) *
    side *
    height *
    THREE.MathUtils.clamp(weight, 0, 1)
  );
}

/** Exact gradient of roadsterFormLift's full-weight smooth field. The slope
 * is zero at the clamped ends, so position and normal stay continuous when a
 * vertex enters or leaves a bonnet, deck, height or width transition. */
export function roadsterFormGradient(
  x: number,
  y: number,
  z: number,
  target = new THREE.Vector3(),
) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    return target.set(0, 0, 0);
  const side = 1 - smooth(p.innerX, p.outerX, Math.abs(x));
  const low = smooth(p.lowY, p.lowFullY, y);
  const high = smooth(p.highFullY, p.highY, y);
  const height = low * (1 - high);
  if (side === 0 || height === 0) return target.set(0, 0, 0);
  const hoodStart = smooth(p.hoodStartZ, p.hoodFullZ, z);
  const hoodEnd = smooth(p.hoodEndFullZ, p.hoodEndZ, z);
  const deckStart = smooth(p.deckStartZ, p.deckFullZ, z);
  const deckEnd = smooth(p.deckEndFullZ, p.deckEndZ, z);
  const along =
    p.hoodM * hoodStart * (1 - hoodEnd) + p.deckM * deckStart * (1 - deckEnd);
  if (along === 0) return target.set(0, 0, 0);
  const dx = -smoothSlope(p.innerX, p.outerX, Math.abs(x)) * Math.sign(x);
  const dy =
    smoothSlope(p.lowY, p.lowFullY, y) * (1 - high) -
    low * smoothSlope(p.highFullY, p.highY, y);
  const dz =
    p.hoodM *
      (smoothSlope(p.hoodStartZ, p.hoodFullZ, z) * (1 - hoodEnd) -
        hoodStart * smoothSlope(p.hoodEndFullZ, p.hoodEndZ, z)) +
    p.deckM *
      (smoothSlope(p.deckStartZ, p.deckFullZ, z) * (1 - deckEnd) -
        deckStart * smoothSlope(p.deckEndFullZ, p.deckEndZ, z));
  return target.set(along * dx * height, along * side * dy, dz * side * height);
}

/** Add one native relative morph target to the existing source geometry. Native
 * Three morph chunks are shared by the colour, SSAO-normal, depth and shadow
 * passes; no separate pass can accidentally keep the undeformed body. Optional
 * position deltas preserve the paint triangle's interpolated shape on decals. */
export function installRoadsterFormGeometry(
  geometry: THREE.BufferGeometry,
  positionDeltas?: Float32Array,
) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal || position.count !== normal.count)
    throw new Error(
      'Roadster form requires matching position and normal attributes',
    );
  if (positionDeltas && positionDeltas.length !== position.count * 3)
    throw new Error(
      'Roadster decal displacement count must match its positions',
    );
  const displacement = positionDeltas ?? new Float32Array(position.count * 3);
  const normalDelta = new Float32Array(position.count * 3);
  const n = new THREE.Vector3();
  const gradient = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const lift = positionDeltas
      ? displacement[i * 3 + 1]
      : roadsterFormLift(x, y, z);
    if (!positionDeltas) displacement[i * 3 + 1] = lift;
    if (Math.abs(lift) <= 1e-9) continue;
    roadsterFormGradient(x, y, z, gradient);
    const nx = normal.getX(i),
      ny = normal.getY(i),
      nz = normal.getZ(i);
    const invY = 1 / Math.max(0.25, 1 + gradient.y);
    n.set(
      nx - ny * gradient.x * invY,
      ny * invY,
      nz - ny * gradient.z * invY,
    ).normalize();
    normalDelta[i * 3] = n.x - nx;
    normalDelta[i * 3 + 1] = n.y - ny;
    normalDelta[i * 3 + 2] = n.z - nz;
  }
  const shape = new THREE.BufferAttribute(displacement, 3);
  const shapeNormal = new THREE.BufferAttribute(normalDelta, 3);
  shape.name = shapeNormal.name = 'robson-burrard-roadster-form';
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [shape];
  geometry.morphAttributes.normal = [shapeNormal];
  // Three's native bounds encompass both relative target endpoints; their
  // convex box/sphere also bounds every fade value between zero and one.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** r185 packs position and normal into two RGBA Float32 texels per vertex.
 * This is both GPU texture storage and a same-size CPU staging buffer. */
export function roadsterMorphTextureBytes(
  vertices: number,
  maxTextureSize: number,
) {
  if (
    !Number.isSafeInteger(vertices) ||
    vertices <= 0 ||
    !Number.isSafeInteger(maxTextureSize) ||
    maxTextureSize <= 0
  )
    return 0;
  const width = Math.min(vertices * 2, maxTextureSize);
  return (
    width *
    Math.ceil((vertices * 2) / width) *
    4 *
    Float32Array.BYTES_PER_ELEMENT
  );
}
