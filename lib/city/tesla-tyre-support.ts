/** Analytic longitudinal tyre tread against finite physical floor triangles.
 * LicenseRef-Vancouver-Living-Atlas-NC-1.0; see LICENSE.
 * This proposes a height only. The caller must prove the floor directly below
 * the tyre datum, floor permissions/union coverage, and the complete body route.
 * It never supplies permission to bridge a hole or ignore a body collision.
 */
export type TeslaTyrePoint = readonly [number, number, number];
export type TeslaTyreTriangle = readonly [
  TeslaTyrePoint,
  TeslaTyrePoint,
  TeslaTyrePoint,
];

export interface TeslaTyreSupportQuery {
  /** Pre-filtered ordinary, allowed, enabled, adherable floor triangles. */
  triangles: readonly TeslaTyreTriangle[];
  /** Chassis-transformed authored tyre-plane datum, not the circle centre. */
  positionXZ: readonly [number, number];
  /** Longitudinal direction; magnitude is immaterial. No lateral radius. */
  headingXZ: readonly [number, number];
  radius: number;
  minY: number;
  maxY: number;
  /** Physical floor directly below positionXZ, freshly proved by the caller. */
  baseHeight: number;
  /** Body forward rise / horizontal run; exact datum correction for pure pitch.
   * This remains a longitudinal tread model, not a rolled 3D tyre rigid body. */
  longitudinalGrade?: number;
  /** Additional rise above the local pitched baseline; never exceeds 16 cm. */
  maxStepHeight?: number;
}

/** Intersect [lo, hi] with a + b*s >= 0, without widening the source edge. */
function clip(interval: [number, number], a: number, b: number): boolean {
  if (b === 0) return a >= 0;
  const boundary = -a / b;
  if (b > 0) interval[0] = Math.max(interval[0], boundary);
  else interval[1] = Math.min(interval[1], boundary);
  return interval[0] <= interval[1];
}

/** Maximum physical floor height plus the lower-circle clearance, expressed as
 * a proposed world-Y for the authored tyre datum. Every triangle is clipped to
 * the actual vertical longitudinal plane and circle radius before its concave
 * maximum is solved. A floor beside the wheel cannot become tread support.
 *
 * A pure pitched circle has centre XZ = datum XZ - heading*R*g/hypot(1,g)
 * and centre Y = datum Y + R/hypot(1,g). Keeping this offset makes a continuous
 * matching grade return exactly its physical floor height, with no false lift.
 */
export function teslaTyreSupportHeight(
  query: TeslaTyreSupportQuery,
): number | null {
  const {
      triangles,
      positionXZ,
      headingXZ,
      radius,
      minY,
      maxY,
      baseHeight,
      longitudinalGrade = 0,
      maxStepHeight = 0.16,
    } = query,
    values = [
      ...positionXZ,
      ...headingXZ,
      radius,
      minY,
      maxY,
      baseHeight,
      longitudinalGrade,
      maxStepHeight,
    ];
  if (
    !values.every(Number.isFinite) ||
    radius <= 0 ||
    minY > maxY ||
    baseHeight < minY ||
    baseHeight > maxY ||
    maxStepHeight < 0 ||
    maxStepHeight > 0.16
  )
    return null;
  const directionLength = Math.hypot(...headingXZ);
  if (directionLength === 0 || !Number.isFinite(directionLength)) return null;
  const hx = headingXZ[0] / directionLength,
    hz = headingXZ[1] / directionLength,
    pitchLength = Math.hypot(1, longitudinalGrade),
    verticalRadius = radius / pitchLength,
    centreShift = -radius * (longitudinalGrade / pitchLength),
    centreX = positionXZ[0] + hx * centreShift,
    centreZ = positionXZ[1] + hz * centreShift;
  let best = -Infinity;
  for (const triangle of triangles) {
    if (
      triangle.length !== 3 ||
      triangle.some((p) => p.length !== 3 || !p.every(Number.isFinite))
    )
      return null;
    // (u,v) are horizontal longitudinal and lateral coordinates relative to the
    // true circle centre. The tread plane is v=0; this is a disc, not a sphere.
    const projected = triangle.map((p) => {
      const x = p[0] - centreX,
        z = p[2] - centreZ;
      return [x * hx + z * hz, -x * hz + z * hx] as const;
    });
    const [a, b, c] = projected,
      area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // Vertical/degenerate triangles supply no physical floor height. Permission
    // and slope checks remain the caller's responsibility.
    if (area === 0 || !Number.isFinite(area)) continue;
    const sign = Math.sign(area),
      interval: [number, number] = [-radius, radius];
    let covered = true;
    for (let i = 0; i < 3; i++) {
      const p = projected[i],
        q = projected[(i + 1) % 3],
        du = q[0] - p[0],
        dv = q[1] - p[1];
      if (!clip(interval, sign * (dv * p[0] - du * p[1]), -sign * dv)) {
        covered = false;
        break;
      }
    }
    if (!covered) continue;
    // Solve the triangle's world-Y plane as H(u,v) = intercept + slope*u + t*v.
    const by = triangle[1][1] - triangle[0][1],
      cy = triangle[2][1] - triangle[0][1],
      slope = (by * (c[1] - a[1]) - cy * (b[1] - a[1])) / area,
      lateralSlope = ((b[0] - a[0]) * cy - (c[0] - a[0]) * by) / area,
      intercept = triangle[0][1] - slope * a[0] - lateralSlope * a[1];
    if (![slope, intercept].every(Number.isFinite)) return null;
    if (
      !clip(interval, intercept - minY, slope) ||
      !clip(interval, maxY - intercept, -slope) ||
      !clip(
        interval,
        baseHeight +
          longitudinalGrade * centreShift +
          maxStepHeight -
          intercept,
        longitudinalGrade - slope,
      )
    )
      continue;
    // H(s)+sqrt(R²-s²) is concave. Its only unconstrained stationary point is
    // R*slope/hypot(1,slope); clamping to the exact interval includes edge/corner
    // contact and never depends on a sampling spacing.
    const optimum = radius * (slope / Math.hypot(1, slope)),
      s = Math.max(interval[0], Math.min(interval[1], optimum)),
      arc = Math.sqrt(Math.max(0, (radius - s) * (radius + s))),
      height = intercept + slope * s + arc - verticalRadius;
    best = Math.max(best, height);
  }
  // baseHeight's separate point proof is a precondition, not a permission this
  // helper can recreate from an empty, excluded or irrelevant triangle set.
  return Number.isFinite(best) ? Math.max(baseHeight, best) : null;
}
