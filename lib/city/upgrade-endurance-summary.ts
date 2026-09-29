export type EnduranceMemorySample = {
  architecture: { cacheCells: number } | null;
  streetscape: { cacheCells: number } | null;
  geometries: number;
  textures: number;
  heap: { usedJSHeapSize: number } | null;
};

export type EnduranceCorridor = {
  start: readonly [number, number];
  end: readonly [number, number];
  halfWidthMeters: number;
  startCrossing: string;
  crossings: readonly { name: string; distanceMeters: number }[];
  source: string;
};

/** Source crossing gates are perpendicular to the fixed, straight route axis.
 * Projection reports actual progress without moving or steering navigation. */
export function enduranceCorridorPosition(
  position: readonly number[],
  corridor: EnduranceCorridor,
) {
  const dx = corridor.end[0] - corridor.start[0],
    dz = corridor.end[1] - corridor.start[1],
    lengthMeters = Math.hypot(dx, dz),
    x = position[0] - corridor.start[0],
    z = position[2] - corridor.start[1];
  const alongMeters = lengthMeters > 0 ? (x * dx + z * dz) / lengthMeters : 0;
  const lateralMeters = lengthMeters > 0 ? (x * dz - z * dx) / lengthMeters : 0;
  return {
    lengthMeters,
    alongMeters,
    lateralMeters,
    withinCorridor:
      lengthMeters > 0 && Math.abs(lateralMeters) <= corridor.halfWidthMeters,
  };
}

export function enduranceFrameSummary(
  gaps: readonly number[],
  elapsedMs: number,
) {
  const finite = gaps.filter((value) => Number.isFinite(value) && value >= 0);
  const sorted = [...finite].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0;
  return {
    frames: finite.length,
    elapsedMs,
    fps: elapsedMs > 0 ? (finite.length * 1000) / elapsedMs : 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? 0,
    over50Ms: finite.filter((value) => value > 50).length,
    over100Ms: finite.filter((value) => value > 100).length,
  };
}

export function enduranceRange<T>(
  samples: readonly T[],
  read: (sample: T) => number | null | undefined,
) {
  const values = samples
    .map(read)
    .filter(
      (value): value is number =>
        value !== null && value !== undefined && Number.isFinite(value),
    );
  if (!values.length) return null;
  return {
    samples: values.length,
    first: values[0],
    last: values.at(-1)!,
    min: Math.min(...values),
    max: Math.max(...values),
    delta: values.at(-1)! - values[0],
  };
}

/** Counts/GPU resource counters can be bounded here. Optional JS heap values
 * are observations affected by garbage collection, never a leak-free proof. */
export function summarizeEnduranceMemory(
  samples: readonly EnduranceMemorySample[],
  limits: { architectureCells: number; streetscapeCells: number },
) {
  const architecture = enduranceRange(
    samples,
    (row) => row.architecture?.cacheCells,
  );
  const streetscape = enduranceRange(
    samples,
    (row) => row.streetscape?.cacheCells,
  );
  return {
    architectureCacheCells: architecture,
    streetscapeCacheCells: streetscape,
    geometries: enduranceRange(samples, (row) => row.geometries),
    textures: enduranceRange(samples, (row) => row.textures),
    usedJSHeapBytes: enduranceRange(samples, (row) => row.heap?.usedJSHeapSize),
    limits,
    cacheDataAvailable: Boolean(architecture && streetscape),
    withinCellLimits:
      Boolean(architecture && streetscape) &&
      architecture!.max <= limits.architectureCells &&
      streetscape!.max <= limits.streetscapeCells,
  };
}
