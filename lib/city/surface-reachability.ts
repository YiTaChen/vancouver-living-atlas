/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) pure surface-identity / explicit-connection prototype.
 * Geometry lookup is injected: it must return only surfaces whose real XZ
 * triangles/footprints contain the query. No renderer, raycast or city scan.
 */
export type XZ = readonly [number, number];
export type TravelMode = 'walk' | 'drive';
export interface SurfaceIdentity {
  surfaceId: string;
  layer: number;
}
export interface SurfaceHit extends SurfaceIdentity {
  /** Final physical surface top, without eye/body offsets. */
  y: number;
  allowedModes: readonly TravelMode[];
  routeId?: string;
  legacySurface?: 'ground' | 'bridge';
}
export interface SurfaceState extends SurfaceIdentity {
  x: number;
  z: number;
  y: number;
}
export type SurfaceLookup = (x: number, z: number) => readonly SurfaceHit[];
export interface SurfaceConnection {
  id: string;
  from: SurfaceIdentity;
  to: SurfaceIdentity;
  allowedModes: readonly TravelMode[];
  twoWay?: boolean;
  /** Verified step height at the physical seam, not inter-floor tolerance. */
  maxSeamStep?: number;
  geometry:
    | { kind: 'gate'; a: XZ; b: XZ; fromSide: 1 | -1 }
    /** Only for an actual shared source graph node, never an XY crossing.
     * It is used after the current footprint ends, not to override overlap. */
    | { kind: 'junction'; center: XZ; radius: number };
}
export type StepResult =
  | { ok: true; hit: SurfaceHit; connectionId?: string }
  | {
      ok: false;
      reason:
        | 'invalid-query'
        | 'no-current-surface'
        | 'surface-ended'
        | 'mode-not-allowed'
        | 'missing-connection-surface'
        | 'discontinuous-seam'
        | 'ambiguous-connection'
        | 'height-discontinuity';
    };
const EPS = 1e-8;
export const sameSurface = (a: SurfaceIdentity, b: SurfaceIdentity) =>
  a.surfaceId === b.surfaceId && a.layer === b.layer;
const finiteIdentity = (s: SurfaceIdentity) =>
  Boolean(s.surfaceId) && Number.isFinite(s.layer);

/** Highest top only INSIDE the exact requested physical floor identity.
 * Multiple overlaid pavement materials on one floor can share this identity;
 * physically stacked floors must never share it, even if layer tags match. */
export function sampleKnownSurface(
  hits: readonly SurfaceHit[],
  identity: SurfaceIdentity,
  mode: TravelMode,
): SurfaceHit | undefined {
  let best: SurfaceHit | undefined;
  for (const h of hits)
    if (
      sameSurface(h, identity) &&
      h.allowedModes.includes(mode) &&
      Number.isFinite(h.y)
    ) {
      if (!best || h.y > best.y) best = h;
    }
  return best;
}

/** Deliberate map/quick-start placement bypasses connection traversal but must
 * carry the EXACT picked surface identity and its mode permission. */
export function stateFromPick(
  x: number,
  z: number,
  hit: SurfaceHit,
  mode: TravelMode,
): SurfaceState | undefined {
  if (
    ![x, z, hit.y].every(Number.isFinite) ||
    !finiteIdentity(hit) ||
    !hit.allowedModes.includes(mode)
  )
    return undefined;
  return { x, z, y: hit.y, surfaceId: hit.surfaceId, layer: hit.layer };
}

/** A gate across a straight road, oriented toward the target surface. */
export function forwardGate(
  center: XZ,
  tangent: XZ,
  width: number,
): Extract<SurfaceConnection['geometry'], { kind: 'gate' }> {
  const len = Math.hypot(...tangent);
  if (
    ![...center, ...tangent, width].every(Number.isFinite) ||
    len < EPS ||
    width <= 0
  )
    throw new Error('Invalid connection gate');
  const nx = -tangent[1] / len,
    nz = tangent[0] / len;
  return {
    kind: 'gate',
    a: [center[0] - (nx * width) / 2, center[1] - (nz * width) / 2],
    b: [center[0] + (nx * width) / 2, center[1] + (nz * width) / 2],
    fromSide: 1,
  };
}
function gateCrossing(
  from: XZ,
  to: XZ,
  g: Extract<SurfaceConnection['geometry'], { kind: 'gate' }>,
  reverse: boolean,
): { point: XZ; t: number } | undefined {
  const dx = g.b[0] - g.a[0],
    dz = g.b[1] - g.a[1],
    len = Math.hypot(dx, dz);
  if (![...g.a, ...g.b].every(Number.isFinite) || len < EPS) return undefined;
  const sign = g.fromSide * (reverse ? -1 : 1);
  const d0 = ((dx * (from[1] - g.a[1]) - dz * (from[0] - g.a[0])) / len) * sign;
  const d1 = ((dx * (to[1] - g.a[1]) - dz * (to[0] - g.a[0])) / len) * sign;
  if (d0 < -EPS || d1 > EPS || d0 - d1 <= EPS) return undefined;
  const t = Math.max(0, Math.min(1, d0 / (d0 - d1)));
  const point: XZ = [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
  ];
  const u = ((point[0] - g.a[0]) * dx + (point[1] - g.a[1]) * dz) / (len * len);
  return u >= -EPS && u <= 1 + EPS ? { point, t } : undefined;
}

/** Call once per existing <=1.5m navigation substep and commit only on ok.
 * maxHeightDelta preserves an optional legacy sanity guard; it NEVER chooses
 * a floor. Layer changes require identity-scoped connections regardless of Y.
 */
export function resolveSurfaceStep(p: {
  current: SurfaceState;
  to: XZ;
  mode: TravelMode;
  lookup: SurfaceLookup;
  connections: readonly SurfaceConnection[];
  maxHeightDelta?: number;
}): StepResult {
  const { current, to, mode, lookup } = p,
    maxDelta = p.maxHeightDelta ?? 4;
  if (
    ![current.x, current.z, current.y, ...to, maxDelta].every(
      Number.isFinite,
    ) ||
    maxDelta < 0 ||
    !finiteIdentity(current)
  )
    return { ok: false, reason: 'invalid-query' };
  const destination = lookup(...to),
    same = sampleKnownSurface(destination, current, mode);
  const crossings: {
    connection: SurfaceConnection;
    target: SurfaceIdentity;
    point: XZ;
    t: number;
    gate: boolean;
  }[] = [];
  for (const c of p.connections) {
    const forward = sameSurface(current, c.from),
      reverse = !forward && sameSurface(current, c.to) && c.twoWay !== false;
    if (!forward && !reverse) continue;
    const target = forward ? c.to : c.from,
      g = c.geometry;
    if (!finiteIdentity(target) || sameSurface(current, target)) continue;
    if (g.kind === 'gate') {
      const crossing = gateCrossing([current.x, current.z], to, g, reverse);
      if (crossing)
        crossings.push({ connection: c, target, ...crossing, gate: true });
    } else if (
      !same &&
      Number.isFinite(g.radius) &&
      g.radius > 0 &&
      [...g.center].every(Number.isFinite) &&
      Math.hypot(current.x - g.center[0], current.z - g.center[1]) <=
        g.radius &&
      Math.hypot(to[0] - g.center[0], to[1] - g.center[1]) <= g.radius
    ) {
      crossings.push({
        connection: c,
        target,
        point: g.center,
        t: 1,
        gate: false,
      });
    }
  }
  // A crossed entry gate wins over an overlapping old terrain footprint.
  // Otherwise a ground mesh covering the whole approach would prevent entry.
  crossings.sort(
    (a, b) => a.t - b.t || a.connection.id.localeCompare(b.connection.id),
  );
  if (crossings.length) {
    const first = crossings[0].t,
      relevant = crossings.filter((c) => Math.abs(c.t - first) < EPS);
    const valid: { hit: SurfaceHit; id: string }[] = [];
    let failure: StepResult = {
      ok: false,
      reason: 'missing-connection-surface',
    };
    for (const c of relevant) {
      if (!c.connection.allowedModes.includes(mode)) {
        failure = { ok: false, reason: 'mode-not-allowed' };
        continue;
      }
      const target = sampleKnownSurface(destination, c.target, mode);
      const seam = lookup(...c.point),
        from = sampleKnownSurface(seam, current, mode),
        toHit = sampleKnownSurface(seam, c.target, mode);
      if (!target || !from || !toHit) continue;
      const limit = c.connection.maxSeamStep ?? 0.25;
      if (
        !Number.isFinite(limit) ||
        limit < 0 ||
        Math.abs(from.y - toHit.y) > limit + EPS
      ) {
        failure = { ok: false, reason: 'discontinuous-seam' };
        continue;
      }
      if (Math.abs(target.y - current.y) > maxDelta) {
        failure = { ok: false, reason: 'height-discontinuity' };
        continue;
      }
      valid.push({ hit: target, id: c.connection.id });
    }
    if (new Set(valid.map((v) => `${v.hit.surfaceId}|${v.hit.layer}`)).size > 1)
      return { ok: false, reason: 'ambiguous-connection' };
    if (valid.length)
      return { ok: true, hit: valid[0].hit, connectionId: valid[0].id };
    return failure;
  }
  if (!same) {
    if (destination.some((h) => sameSurface(h, current)))
      return { ok: false, reason: 'mode-not-allowed' };
    return { ok: false, reason: 'surface-ended' };
  }
  if (Math.abs(same.y - current.y) > maxDelta)
    return { ok: false, reason: 'height-discontinuity' };
  return { ok: true, hit: same };
}
