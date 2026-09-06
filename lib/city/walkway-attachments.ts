/** Original MIT pure prototype. Call only with a verified, contiguous attachment
 * profile. Physical walk/drive permission stays on each path, NOT this sampler.
 * It never changes source XY, invents a connector or falls back to terrain. */
export interface AttachmentSegment {
  a: readonly [number, number];
  b: readonly [number, number];
  h0: number;
  h1: number;
  s0: number;
  s1: number;
  sourceId: number;
}
export interface AttachmentHit {
  y: number;
  chainage: number;
  sourceId: number;
  distance: number;
  endpointOverrunM: number;
}
export function createWalkwayAttachment(
  segments: readonly AttachmentSegment[],
  options: {
    maxDistanceM: number;
    endpointAllowanceM?: number;
    topOffsetM?: number;
  },
) {
  if (
    !segments.length ||
    !Number.isFinite(options.maxDistanceM) ||
    options.maxDistanceM <= 0
  )
    throw new Error('A complete, bounded attachment route is required');
  const ordered = [...segments].sort((a, b) => a.s0 - b.s0);
  const allowance = options.endpointAllowanceM ?? 0;
  const offset = options.topOffsetM ?? 0;
  if (!Number.isFinite(allowance) || allowance < 0 || !Number.isFinite(offset))
    throw new Error('Invalid attachment limits');
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    if (
      ![...s.a, ...s.b, s.h0, s.h1, s.s0, s.s1].every(Number.isFinite) ||
      s.s1 <= s.s0
    )
      throw new Error('Invalid attachment segment');
    if (i) {
      const p = ordered[i - 1];
      if (
        Math.hypot(p.b[0] - s.a[0], p.b[1] - s.a[1]) > 1e-6 ||
        Math.abs(p.h1 - s.h0) > 1e-6 ||
        Math.abs(p.s1 - s.s0) > 1e-6
      )
        throw new Error('Road profile has an unresolved XYZ/chainage seam');
    }
  }
  return (x: number, z: number): AttachmentHit | undefined => {
    if (![x, z].every(Number.isFinite)) return undefined;
    let result: AttachmentHit | undefined;
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i],
        dx = s.b[0] - s.a[0],
        dz = s.b[1] - s.a[1],
        length = Math.hypot(dx, dz);
      if (length < 1e-8) continue;
      const raw = ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / (length * length),
        t = Math.min(1, Math.max(0, raw));
      const distance = Math.hypot(x - s.a[0] - dx * t, z - s.a[1] - dz * t);
      if (
        distance > options.maxDistanceM ||
        (result && distance >= result.distance)
      )
        continue;
      const overrun =
        i === 0 && raw < 0
          ? -raw * length
          : i === ordered.length - 1 && raw > 1
            ? (raw - 1) * length
            : 0;
      result = {
        y: s.h0 + (s.h1 - s.h0) * t + offset,
        chainage: s.s0 + (s.s1 - s.s0) * t,
        sourceId: s.sourceId,
        distance,
        endpointOverrunM: overrun,
      };
    }
    return result && result.endpointOverrunM <= allowance + 1e-9
      ? result
      : undefined;
  };
}

/** Station coordinates for existing straight main bridge; positive offset EAST.
 * This measures path/rail placement, and is NOT permission to replace a path
 * with a straight centreline or infer a real surveyed carriageway alignment. */
export function bridgeStation(
  point: readonly number[],
  start: readonly number[],
  end: readonly number[],
) {
  const dx = end[0] - start[0],
    dz = end[1] - start[1],
    length = Math.hypot(dx, dz);
  if (length <= 0) throw new Error('Invalid bridge spine');
  const x = point[0] - start[0],
    z = point[1] - start[1];
  return {
    s: (x * dx + z * dz) / length,
    offsetEastM: (-x * dz + z * dx) / length,
  };
}
