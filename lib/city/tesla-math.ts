/** Pure vehicle frame math. +Y up, +Z forward, quaternion XYZW. */
import type { TeslaQuaternion, TeslaVec3 } from './tesla-state';

export const TESLA_UP: TeslaVec3 = [0, 1, 0];
export const TESLA_FORWARD: TeslaVec3 = [0, 0, 1];
export const teslaDot = (a: TeslaVec3, b: TeslaVec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const teslaAdd = (a: TeslaVec3, b: TeslaVec3): TeslaVec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const teslaScale = (a: TeslaVec3, scale: number): TeslaVec3 => [
  a[0] * scale,
  a[1] * scale,
  a[2] * scale,
];
export const teslaSubtract = (a: TeslaVec3, b: TeslaVec3): TeslaVec3 =>
  teslaAdd(a, teslaScale(b, -1));
export const teslaLength = (a: TeslaVec3) => Math.hypot(...a);
export const teslaCross = (a: TeslaVec3, b: TeslaVec3): TeslaVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function teslaUnit(
  a: TeslaVec3,
  fallback: TeslaVec3 = TESLA_UP,
): TeslaVec3 {
  const length = teslaLength(a);
  return Number.isFinite(length) && length > 1e-9
    ? teslaScale(a, 1 / length)
    : [...fallback];
}
export const teslaTangent = (v: TeslaVec3, normal: TeslaVec3) =>
  teslaSubtract(v, teslaScale(normal, teslaDot(v, normal)));
export function teslaLimit(v: TeslaVec3, maximum: number): TeslaVec3 {
  const length = teslaLength(v);
  return length > maximum ? teslaScale(v, maximum / length) : v;
}
export function teslaNormalizeQuaternion(q: TeslaQuaternion): TeslaQuaternion {
  const length = Math.hypot(...q);
  return Number.isFinite(length) && length > 1e-9
    ? [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
    : [0, 0, 0, 1];
}
export function teslaRotate(q: TeslaQuaternion, v: TeslaVec3): TeslaVec3 {
  const vector: TeslaVec3 = [q[0], q[1], q[2]];
  const t = teslaScale(teslaCross(vector, v), 2);
  return teslaAdd(v, teslaAdd(teslaScale(t, q[3]), teslaCross(vector, t)));
}
export function teslaAxisRotation(
  axis: TeslaVec3,
  radians: number,
): TeslaQuaternion {
  const unit = teslaUnit(axis),
    s = Math.sin(radians / 2);
  return [unit[0] * s, unit[1] * s, unit[2] * s, Math.cos(radians / 2)];
}
export function teslaSlerp(
  a: TeslaQuaternion,
  b: TeslaQuaternion,
  t: number,
): TeslaQuaternion {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: TeslaQuaternion = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  dot = Math.abs(dot);
  if (dot > 0.9995)
    return teslaNormalizeQuaternion([
      a[0] + (target[0] - a[0]) * t,
      a[1] + (target[1] - a[1]) * t,
      a[2] + (target[2] - a[2]) * t,
      a[3] + (target[3] - a[3]) * t,
    ]);
  const angle = Math.acos(Math.min(1, dot)),
    sin = Math.sin(angle);
  const fromWeight = Math.sin((1 - t) * angle) / sin;
  const toWeight = Math.sin(t * angle) / sin;
  return teslaNormalizeQuaternion([
    a[0] * fromWeight + target[0] * toWeight,
    a[1] * fromWeight + target[1] * toWeight,
    a[2] * fromWeight + target[2] * toWeight,
    a[3] * fromWeight + target[3] * toWeight,
  ]);
}

/** Parallel transport preserves the heading through floor/wall/roof seams. */
export function teslaTransportForward(
  oldUp: TeslaVec3,
  nextUp: TeslaVec3,
  forward: TeslaVec3,
) {
  const a = teslaUnit(oldUp),
    b = teslaUnit(nextUp);
  const axis = teslaCross(a, b),
    dot = Math.max(-1, Math.min(1, teslaDot(a, b)));
  const rotation =
    dot < -0.999999
      ? teslaAxisRotation(
          teslaUnit(teslaTangent(forward, a), [1, 0, 0]),
          Math.PI,
        )
      : teslaNormalizeQuaternion([axis[0], axis[1], axis[2], 1 + dot]);
  return teslaUnit(
    teslaTangent(teslaRotate(rotation, forward), b),
    TESLA_FORWARD,
  );
}

/** Deterministic orthonormal frame, including a forward hint parallel to up. */
export function teslaFrame(up: TeslaVec3, forwardHint: TeslaVec3) {
  const normal = teslaUnit(up);
  let tangent = teslaTangent(forwardHint, normal);
  if (teslaLength(tangent) < 1e-8)
    tangent = teslaTangent(
      Math.abs(normal[2]) < 0.9 ? TESLA_FORWARD : [1, 0, 0],
      normal,
    );
  const forward = teslaUnit(tangent, TESLA_FORWARD);
  const right = teslaUnit(teslaCross(normal, forward), [1, 0, 0]);
  const correctedForward = teslaUnit(teslaCross(right, normal), forward);
  const m00 = right[0],
    m01 = normal[0],
    m02 = correctedForward[0],
    m10 = right[1],
    m11 = normal[1],
    m12 = correctedForward[1],
    m20 = right[2],
    m21 = normal[2],
    m22 = correctedForward[2];
  const trace = m00 + m11 + m22;
  let quaternion: TeslaQuaternion;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    quaternion = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    quaternion = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    quaternion = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    quaternion = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return {
    up: normal,
    right,
    forward: correctedForward,
    quaternion: teslaNormalizeQuaternion(quaternion),
  };
}
