/** Source-tagged, conservative roof appearance. No source data is rewritten.
 * Generic "Pitched" does not specify a ridge: a simple gable is representative,
 * while the inherited footprint and existing rendering envelope stay unchanged.
 * The retained roof tag/dataset epoch does not imply a new or current survey. */
export type RoofPoint = readonly [number, number];
export type RoofFrame = Readonly<{
  axis: readonly [number, number];
  origin: readonly [number, number];
  edge: number;
}>;
export type PitchedRoof = Readonly<{
  kind: 'representative-gable';
  sourceRoof: string;
  sourceDataset: string;
  sourceEpoch: number | null;
  ridgeHeight: number;
  eaveHeight: number;
  ring: readonly RoofPoint[];
  ridge: readonly [RoofPoint, RoofPoint];
  frame: RoofFrame;
}>;

/** Orientation and metre phase do not depend on the order of source vertices. */
export function roofFrame(ring: readonly RoofPoint[]): RoofFrame {
  let longest = -1;
  let axis: [number, number] = [1, 0];
  let edge = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    let dx = b[0] - a[0],
      dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    dx /= length;
    dz /= length;
    if (dx < -1e-10 || (Math.abs(dx) < 1e-10 && dz < 0)) {
      dx = -dx;
      dz = -dz;
    }
    if (
      length > longest + 1e-6 ||
      (Math.abs(length - longest) < 1e-6 && dx > axis[0] + 1e-10)
    ) {
      longest = length;
      axis = [dx, dz];
      edge = i;
    }
  }
  const x = ring.reduce((sum, p) => sum + p[0] / ring.length, 0);
  const z = ring.reduce((sum, p) => sum + p[1] / ring.length, 0);
  return {
    axis,
    origin: [x * axis[0] + z * axis[1], -x * axis[1] + z * axis[0]],
    edge,
  };
}

export function planPitchedRoof(
  polygon: readonly (readonly RoofPoint[])[],
  height: number,
  minHeight: number,
  sourceRoof: unknown,
  sourceDataset: unknown,
  structureParts: number,
): PitchedRoof | null {
  const tag = String(sourceRoof ?? '')
    .trim()
    .toLowerCase();
  if (
    !['pitched', 'gabled'].includes(tag) ||
    structureParts !== 1 ||
    minHeight !== 0 ||
    !Number.isFinite(height) ||
    height < 3.5 ||
    height > 12 ||
    polygon.length !== 1 ||
    polygon[0].length !== 4
  )
    return null;
  const ring = polygon[0].map((p) => [p[0], p[1]] as [number, number]);
  if (ring.some((p) => p.some((n) => !Number.isFinite(n)))) return null;
  let area =
    ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % 4];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2;
  if (Math.abs(area) < 25 || Math.abs(area) > 350) return null;
  if (area < 0) {
    ring.reverse();
    area = -area;
  }
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % 4];
    return [b[0] - a[0], b[1] - a[1]];
  });
  const lengths = edges.map((p) => Math.hypot(...p));
  if (
    Math.min(...lengths) < 3 ||
    Math.max(...lengths) / Math.min(...lengths) > 4
  )
    return null;
  for (let i = 0; i < 4; i++) {
    const a = edges[i],
      b = edges[(i + 1) % 4];
    // Reject skew/concave shapes; preserve the exact accepted corners, never snap.
    if (
      a[0] * b[1] - a[1] * b[0] <= 0 ||
      Math.abs(a[0] * b[0] + a[1] * b[1]) /
        (lengths[i] * lengths[(i + 1) % 4]) >
        0.08
    )
      return null;
  }
  const frame = roofFrame(ring),
    i = frame.edge;
  const ordered = [0, 1, 2, 3].map((offset) => ring[(i + offset) % 4]);
  const [a, b, c, d] = ordered;
  const ridge: [RoofPoint, RoofPoint] = [
    [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2],
    [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2],
  ];
  const span = (lengths[(i + 1) % 4] + lengths[(i + 3) % 4]) / 2;
  const rise = Math.min(
    2.4,
    height * 0.28,
    height - 2.7,
    Math.max(0.55, span * 0.24),
  );
  if (rise < 0.5) return null;
  const dataset = String(sourceDataset ?? 'unspecified');
  return Object.freeze({
    kind: 'representative-gable',
    sourceRoof: String(sourceRoof),
    sourceDataset: dataset,
    sourceEpoch: dataset === 'cov-2009' ? 2009 : null,
    ridgeHeight: height,
    eaveHeight: height - rise,
    ring: ordered,
    ridge,
    frame,
  });
}

export type RoofVertex = readonly [number, number, number];
export type RoofTriangle = {
  vertices: readonly [RoofVertex, RoofVertex, RoofVertex];
  normal: readonly [number, number, number];
  roof: boolean;
};

/** Four roof triangles + two wall gables, merged into the existing city body. */
export function pitchedRoofTriangles(
  shape: PitchedRoof,
  foundation: number,
): RoofTriangle[] {
  const [a, b, c, d] = shape.ring.map(
    ([x, z]) => [x, foundation + shape.eaveHeight, z] as RoofVertex,
  );
  const [ra, rb] = shape.ridge.map(
    ([x, z]) => [x, foundation + shape.ridgeHeight, z] as RoofVertex,
  );
  const triangles: {
    vertices: [RoofVertex, RoofVertex, RoofVertex];
    roof: boolean;
  }[] = [
    { vertices: [a, ra, rb], roof: true },
    { vertices: [a, rb, b], roof: true },
    { vertices: [d, c, rb], roof: true },
    { vertices: [d, rb, ra], roof: true },
    { vertices: [b, rb, c], roof: false },
    { vertices: [d, ra, a], roof: false },
  ];
  return triangles.map(({ vertices, roof }) => {
    const [p, q, r] = vertices,
      u = q.map((n, i) => n - p[i]),
      v = r.map((n, i) => n - p[i]);
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...n);
    return {
      vertices,
      roof,
      normal: n.map((x) => x / length) as [number, number, number],
    };
  });
}
