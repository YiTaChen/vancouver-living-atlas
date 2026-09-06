/** Original display-width constraint from measured tree positions. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) code.
 * This is NOT a street/curb survey, a lane count, or a traffic design tool.
 * Tree coordinates and the original road centreline are never moved.
 */
export type XZ = readonly [number, number];
export interface TreeCandidate {
  point: XZ;
  id?: string | number;
}
export interface ClearanceOptions {
  endIgnore?: number;
  clearance?: number;
  minWidth?: number;
  minPerSide?: number;
  minSpanFraction?: number;
  quantile?: number;
  candidateExtra?: number;
  maxRowIqr?: number;
}
export interface TreeEvidence {
  id?: string | number;
  point: XZ;
  station: number;
  distance: number;
  side: -1 | 1;
}
export interface SideEvidence {
  candidates: number;
  row: TreeEvidence[];
  span: number;
  spanFraction: number;
  lowDistance?: number;
  spread?: number;
  eligible: boolean;
  reason: 'sparse' | 'short-span' | 'noisy' | 'supported';
}
export interface ClearanceResult {
  /** Undefined means insufficient evidence or no supported narrowing. */
  asphaltWidth?: number;
  originalWidth: number;
  corridorWidth: number;
  /** Constant total corridor, split symmetrically around unchanged centreline. */
  sidewalkEach: number;
  length: number;
  sides: [SideEvidence, SideEvidence];
  reason:
    | 'short-route'
    | 'below-minimum'
    | 'insufficient-rows'
    | 'already-clear'
    | 'constrained';
  /** A 6m floor can prevent the requested clearance from being achieved. */
  limitedByMinimum: boolean;
}
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function quantile(values: readonly number[], q: number): number {
  const a = [...values].sort((a, b) => a - b),
    i = (a.length - 1) * q,
    l = Math.floor(i);
  return a[l] + (a[Math.min(l + 1, a.length - 1)] - a[l]) * (i - l);
}
function sideEvidence(
  points: TreeEvidence[],
  length: number,
  o: Required<ClearanceOptions>,
): SideEvidence {
  const result: SideEvidence = {
    candidates: points.length,
    row: [],
    span: 0,
    spanFraction: 0,
    eligible: false,
    reason: 'sparse',
  };
  if (points.length < o.minPerSide) return result;
  const median = quantile(
    points.map((p) => p.distance),
    0.5,
  );
  const mad = quantile(
    points.map((p) => Math.abs(p.distance - median)),
    0.5,
  );
  // An isolated bad coordinate must not dictate a width. Keep a broad, robust
  // lateral band, then separately require an actual longitudinal row.
  const tolerance = Math.max(1.2, 2.5 * mad);
  const row = points
    .filter((p) => Math.abs(p.distance - median) <= tolerance)
    .sort((a, b) => a.station - b.station || a.distance - b.distance);
  result.row = row;
  if (row.length < o.minPerSide) return result;
  result.span = row.at(-1)!.station - row[0].station;
  result.spanFraction = result.span / length;
  if (result.spanFraction < o.minSpanFraction) {
    result.reason = 'short-span';
    return result;
  }
  result.spread =
    quantile(
      row.map((p) => p.distance),
      0.8,
    ) -
    quantile(
      row.map((p) => p.distance),
      0.2,
    );
  if (result.spread > o.maxRowIqr) {
    result.reason = 'noisy';
    return result;
  }
  result.lowDistance = quantile(
    row.map((p) => p.distance),
    o.quantile,
  );
  result.eligible = true;
  result.reason = 'supported';
  return result;
}

export function constrainCarriageway(
  line: readonly XZ[],
  trees: readonly TreeCandidate[],
  originalWidth: number,
  options: ClearanceOptions = {},
): ClearanceResult {
  const o: Required<ClearanceOptions> = {
    endIgnore: 10,
    clearance: 0.8,
    minWidth: 6,
    minPerSide: 3,
    minSpanFraction: 0.35,
    quantile: 0.2,
    candidateExtra: 2,
    maxRowIqr: 3,
    ...options,
  };
  if (!Number.isFinite(originalWidth) || originalWidth <= 0)
    throw new Error('Invalid original width');
  if (
    Object.values(o).some((v) => !Number.isFinite(v)) ||
    o.endIgnore < 0 ||
    o.clearance < 0 ||
    o.minWidth <= 0 ||
    o.minPerSide < 3 ||
    !Number.isInteger(o.minPerSide) ||
    o.minSpanFraction < 0.35 ||
    o.minSpanFraction > 1 ||
    o.quantile < 0 ||
    o.quantile > 0.5 ||
    o.candidateExtra < 0 ||
    o.maxRowIqr <= 0
  )
    throw new Error('Invalid evidence options');
  if (line.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error('Invalid line point');
  const segments: {
    a: XZ;
    dx: number;
    dz: number;
    length: number;
    station: number;
  }[] = [];
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      l = distance(a, b);
    if (l < 1e-7) continue;
    segments.push({
      a,
      dx: b[0] - a[0],
      dz: b[1] - a[1],
      length: l,
      station: length,
    });
    length += l;
  }
  const sides: [TreeEvidence[], TreeEvidence[]] = [[], []];
  const corridorWidth = originalWidth + 4;
  const empty = (): SideEvidence => ({
    candidates: 0,
    row: [],
    span: 0,
    spanFraction: 0,
    eligible: false,
    reason: 'sparse',
  });
  const base: ClearanceResult = {
    originalWidth,
    corridorWidth,
    sidewalkEach: 2,
    length,
    sides: [empty(), empty()],
    reason: 'short-route',
    limitedByMinimum: false,
  };
  if (originalWidth < o.minWidth) {
    base.reason = 'below-minimum';
    return base;
  }
  if (length <= 2 * o.endIgnore) return base;
  const seen = new Map<string, XZ[]>();
  const pad = originalWidth / 2 + o.candidateExtra;
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const [x, z] of line) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  const candidates = trees
    .filter(
      ({ point: p }) =>
        p.length === 2 &&
        p.every(Number.isFinite) &&
        p[0] >= minX - pad &&
        p[0] <= maxX + pad &&
        p[1] >= minZ - pad &&
        p[1] <= maxZ + pad,
    )
    .sort(
      (a, b) =>
        a.point[0] - b.point[0] ||
        a.point[1] - b.point[1] ||
        String(a.id).localeCompare(String(b.id)),
    );
  for (const tree of candidates) {
    const p = tree.point;
    if (p.length !== 2 || !p.every(Number.isFinite)) continue;
    // Small grid + adjacent cells removes duplicate survey records of the same
    // trunk without treating a repeated ID as proof of a different tree.
    const gx = Math.floor(p[0] / 0.35),
      gz = Math.floor(p[1] / 0.35);
    let duplicate = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (
          (seen.get(`${gx + dx}:${gz + dz}`) || []).some(
            (q) => distance(p, q) < 0.35,
          )
        )
          duplicate = true;
      }
    if (duplicate) continue;
    const bucket = seen.get(`${gx}:${gz}`) || [];
    bucket.push(p);
    seen.set(`${gx}:${gz}`, bucket);
    let closest:
      | { station: number; distance: number; side: -1 | 1 }
      | undefined;
    for (const s of segments) {
      const t = clamp(
        ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dz) /
          (s.length * s.length),
        0,
        1,
      );
      const rx = p[0] - s.a[0] - s.dx * t,
        rz = p[1] - s.a[1] - s.dz * t;
      const d = Math.hypot(rx, rz),
        signed = (s.dx * rz - s.dz * rx) / s.length;
      if (!closest || d < closest.distance)
        closest = {
          station: s.station + t * s.length,
          distance: d,
          side: signed < 0 ? -1 : 1,
        };
    }
    if (
      !closest ||
      closest.station < o.endIgnore ||
      closest.station > length - o.endIgnore ||
      closest.distance < 1 ||
      closest.distance > originalWidth / 2 + o.candidateExtra
    )
      continue;
    sides[closest.side < 0 ? 0 : 1].push({ ...closest, id: tree.id, point: p });
  }
  base.sides = [
    sideEvidence(sides[0], length, o),
    sideEvidence(sides[1], length, o),
  ];
  if (base.sides.some((s) => !s.eligible)) {
    base.reason = 'insufficient-rows';
    return base;
  }
  const supported =
    2 *
    (Math.min(base.sides[0].lowDistance!, base.sides[1].lowDistance!) -
      o.clearance);
  base.limitedByMinimum = supported < o.minWidth;
  // Round inward to a display decimetre; never exceed the original asphalt.
  const width = Math.min(
    originalWidth,
    Math.max(o.minWidth, Math.floor((supported + 1e-8) * 10) / 10),
  );
  if (width >= originalWidth - 0.05) {
    base.reason = 'already-clear';
    return base;
  }
  base.reason = 'constrained';
  base.asphaltWidth = width;
  base.sidewalkEach = (corridorWidth - width) / 2;
  return base;
}
