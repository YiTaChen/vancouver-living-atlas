/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Asphalt-only display reconciliation against unchanged OSM
 * walkway XY. Station s/offset are an orthonormal frame on raw way 4755915.
 * Clear strips have round joins. The .25m inboard and .45m outboard aprons
 * make a nominal 2.7m main sidewalk around its 2m clear strip. Not a survey.
 * Bake geometry/picking from the resulting actual triangles, not axis distance. */
export interface SideKnot {
  s: number;
  offset: number;
  clearWidth: number;
  sourceId: number;
}
export interface SideLine {
  side: 'east' | 'west';
  knots: SideKnot[];
}
export interface CrossSectionData {
  lengthM: number;
  lines: SideLine[];
}
type Point = readonly [number, number];
type Envelope = {
  polygons: Point[][];
  discs: { s: number; o: number; r: number }[];
};
function envelope(line: SideLine, apron: number): Envelope {
  const polygons: Point[][] = [];
  for (let i = 1; i < line.knots.length; i++) {
    const a = line.knots[i - 1],
      b = line.knots[i],
      ds = b.s - a.s,
      dO = b.offset - a.offset,
      l = Math.hypot(ds, dO);
    if (l < 1e-8) continue;
    const ns = -dO / l,
      no = ds / l,
      ra = a.clearWidth / 2 + apron,
      rb = b.clearWidth / 2 + apron;
    polygons.push([
      [a.s + ns * ra, a.offset + no * ra],
      [b.s + ns * rb, b.offset + no * rb],
      [b.s - ns * rb, b.offset - no * rb],
      [a.s - ns * ra, a.offset - no * ra],
    ]);
  }
  // Conservative rounded joins/end caps, never an invented route centreline.
  return {
    polygons,
    discs: line.knots.map((k) => ({
      s: k.s,
      o: k.offset,
      r: k.clearWidth / 2 + apron,
    })),
  };
}
function slice(e: Envelope, s: number): [number, number] | undefined {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of e.polygons)
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        ds = b[0] - a[0];
      if (s < Math.min(a[0], b[0]) - 1e-9 || s > Math.max(a[0], b[0]) + 1e-9)
        continue;
      if (Math.abs(ds) < 1e-9) {
        lo = Math.min(lo, a[1], b[1]);
        hi = Math.max(hi, a[1], b[1]);
      } else {
        const o = a[1] + ((b[1] - a[1]) * (s - a[0])) / ds;
        lo = Math.min(lo, o);
        hi = Math.max(hi, o);
      }
    }
  for (const d of e.discs) {
    const ds = s - d.s;
    if (Math.abs(ds) <= d.r) {
      const r = Math.sqrt(Math.max(0, d.r * d.r - ds * ds));
      lo = Math.min(lo, d.o - r);
      hi = Math.max(hi, d.o + r);
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : undefined;
}
export function createMainCrossSection(data: CrossSectionData) {
  if (!Number.isFinite(data.lengthM) || data.lengthM <= 0 || !data.lines.length)
    throw new Error('Invalid cross-section data');
  for (const l of data.lines) {
    if (!['east', 'west'].includes(l.side) || l.knots.length < 2)
      throw new Error('Invalid side line');
    for (const k of l.knots)
      if (
        ![k.s, k.offset, k.clearWidth, k.sourceId].every(Number.isFinite) ||
        k.clearWidth <= 0
      )
        throw new Error('Invalid side knot');
  }
  const lines = data.lines.map((l) => ({
    side: l.side,
    inner: envelope(l, 0.25),
    outer: envelope(l, 0.45),
  }));
  return (s: number) => {
    if (!Number.isFinite(s) || s < 0 || s > data.lengthM) return undefined;
    let westLimit = -Infinity,
      eastLimit = Infinity,
      platformOuterWest = Infinity,
      platformOuterEast = -Infinity;
    for (const line of lines) {
      const inner = slice(line.inner, s),
        outer = slice(line.outer, s);
      if (!inner || !outer) continue;
      if (line.side === 'east') {
        eastLimit = Math.min(eastLimit, inner[0]);
        platformOuterEast = Math.max(platformOuterEast, outer[1]);
      } else {
        westLimit = Math.max(westLimit, inner[1]);
        platformOuterWest = Math.min(platformOuterWest, outer[0]);
      }
    }
    if (
      ![westLimit, eastLimit, platformOuterWest, platformOuterEast].every(
        Number.isFinite,
      )
    )
      return undefined;
    const width = Math.min(10.8, eastLimit - westLimit);
    if (width <= 0) return undefined;
    const centerShift = Math.min(
      eastLimit - width / 2,
      Math.max(westLimit + width / 2, 0),
    );
    return {
      s,
      width,
      centerShift,
      asphaltWest: centerShift - width / 2,
      asphaltEast: centerShift + width / 2,
      westLimit,
      eastLimit,
      platformOuterWest,
      platformOuterEast,
      sourceAxisUnchanged: true as const,
    };
  };
}
