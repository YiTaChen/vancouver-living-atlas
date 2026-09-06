/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Sparse illustrative concrete support layout, no scene or I/O.
 * Columns support ONLY the solved western entry. No earth fill is emitted.
 * Collision is conservative in plan: complete1m circular footprint+.25m buffer
 * must clear every supplied lower-path/City-road/extra no-fill envelope.
 */
import type {
  SurfaceSegment,
  XZ,
  Elevation,
  Project,
} from './causeway-profile';
export interface SupportCorridor {
  id: string;
  kind: 'path' | 'city-road' | 'source-extra';
  points: readonly XZ[];
  width: number;
}
export interface SupportNoFill {
  id: string;
  outer: readonly XZ[];
  holes?: readonly (readonly XZ[])[];
}
export interface GeoLineFeature {
  properties: {
    id?: number;
    sourceId?: number;
    width?: number;
    name?: string;
    class?: string;
    type?: string;
  };
  geometry: { type: string; coordinates: readonly unknown[] };
}
export interface SupportColumn {
  station: number;
  sourceId: number;
  routeId: string;
  surfaceId: string;
  point: XZ;
  offsetM: number;
  diameterM: number;
  footprintRadiusM: number;
  clearanceBufferM: number;
  bottomY: number;
  topY: number;
  heightM: number;
  center: readonly [number, number, number];
  minPlanClearanceM: number;
  nearestEnvelopeId: string | null;
  material: 'unpainted-concrete';
}
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segmentDistance = (p: XZ, a: XZ, b: XZ) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    l = dx * dx + dz * dz;
  const t = l ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
function inside(p: XZ, ring: readonly XZ[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}
const ringDistance = (p: XZ, ring: readonly XZ[]) =>
  Math.min(
    ...ring.map((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length])),
  );
export function buildSupportCorridors(options: {
  paths: { features: readonly GeoLineFeature[] };
  cityRoads: { features: readonly GeoLineFeature[] };
  project: Project;
  excludedPathIds: ReadonlySet<number>;
}) {
  const corridors: SupportCorridor[] = [];
  for (const [collection, kind] of [
    [options.paths, 'path'],
    [options.cityRoads, 'city-road'],
  ] as const)
    collection.features.forEach((f, index) => {
      const sourceId = Number(f.properties.sourceId ?? f.properties.id);
      if (kind === 'path' && options.excludedPathIds.has(sourceId)) return;
      const roadClass = String(f.properties.class ?? f.properties.type ?? '');
      const width =
        kind === 'path'
          ? Number(f.properties.width) || 2.5
          : (Number(f.properties.width) ||
              (/lane/i.test(roadClass)
                ? 4
                : /arterial/i.test(roadClass)
                  ? 18
                  : 9)) + 4;
      if (!Number.isFinite(width) || width <= 0)
        throw new Error('Invalid ground corridor width');
      const lines =
        f.geometry.type === 'MultiLineString'
          ? f.geometry.coordinates
          : [f.geometry.coordinates];
      if (!['LineString', 'MultiLineString'].includes(f.geometry.type))
        throw new Error('Support exclusion requires line features');
      lines.forEach((line, part) => {
        const points = (line as readonly (readonly number[])[]).map(
          options.project,
        );
        if (points.length >= 2)
          corridors.push({
            id: kind === 'path' ? `path:${sourceId}` : `city:${index}:${part}`,
            kind,
            points,
            width,
          });
      });
    });
  return corridors;
}
export function proposeWestWalkSupports(options: {
  segments: readonly SurfaceSegment[];
  elevation: Elevation;
  /** Exact actual rendered walkway top; required, never nearest unrelated floor. */
  pathTop: (x: number, z: number) => number | undefined;
  corridors: readonly SupportCorridor[];
  extraNoFill?: readonly SupportNoFill[];
  intervalM?: number;
  diameterM?: number;
  clearanceBufferM?: number;
  slabDepthM?: number;
  minUndersideHeightM?: number;
  embedDepthM?: number;
}) {
  const interval = options.intervalM ?? 22,
    diameter = options.diameterM ?? 1,
    buffer = options.clearanceBufferM ?? 0.25,
    slab = options.slabDepthM ?? 0.75;
  const minHeight = options.minUndersideHeightM ?? 2,
    embed = options.embedDepthM ?? 0.3,
    radius = diameter / 2;
  if (
    ![interval, diameter, buffer, slab, minHeight, embed].every(
      Number.isFinite,
    ) ||
    interval < 20 ||
    interval > 24 ||
    diameter <= 0 ||
    buffer < 0 ||
    slab <= 0 ||
    minHeight < 0 ||
    embed < 0
  )
    throw new Error('Invalid support layout limits');
  const segments = options.segments
    .filter(
      (s) => s.routeId === 'lions:west:walk-entry' && s.sourceId === 70954679,
    )
    .sort((a, b) => a.s0 - b.s0);
  if (!segments.length)
    throw new Error('Missing explicit western source70954679 profile');
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (
      ![...s.a, ...s.b, s.h0, s.h1, s.s0, s.s1, s.width].every(
        Number.isFinite,
      ) ||
      s.s1 <= s.s0 ||
      s.width < diameter
    )
      throw new Error('Invalid support path segment');
    if (
      i &&
      (distance(segments[i - 1].b, s.a) > 1e-6 ||
        Math.abs(segments[i - 1].h1 - s.h0) > 1e-5 ||
        Math.abs(segments[i - 1].s1 - s.s0) > 1e-6)
    )
      throw new Error('Disconnected support path');
  }
  for (const c of options.corridors)
    if (
      !Number.isFinite(c.width) ||
      c.width <= 0 ||
      c.points.length < 2 ||
      c.points.some((p) => !p.every(Number.isFinite))
    )
      throw new Error('Invalid support exclusion');
  for (const p of options.extraNoFill ?? [])
    for (const ring of [p.outer, ...(p.holes ?? [])])
      if (ring.length < 3 || ring.some((v) => !v.every(Number.isFinite)))
        throw new Error('Invalid no-fill polygon');
  const columns: SupportColumn[] = [],
    rejected: { station: number; reasons: string[] }[] = [];
  const pad =
    Math.max(...segments.map((s) => s.width)) / 2 + radius + buffer + 2;
  const bounds = {
    x0: Math.min(...segments.flatMap((s) => [s.a[0], s.b[0]])) - pad,
    x1: Math.max(...segments.flatMap((s) => [s.a[0], s.b[0]])) + pad,
    z0: Math.min(...segments.flatMap((s) => [s.a[1], s.b[1]])) - pad,
    z1: Math.max(...segments.flatMap((s) => [s.a[1], s.b[1]])) + pad,
  };
  const local = options.corridors
    .flatMap((c) =>
      c.points
        .slice(1)
        .map((b, i) => ({ id: c.id, a: c.points[i], b, width: c.width })),
    )
    .filter(
      (c) =>
        Math.max(c.a[0], c.b[0]) + c.width / 2 >= bounds.x0 &&
        Math.min(c.a[0], c.b[0]) - c.width / 2 <= bounds.x1 &&
        Math.max(c.a[1], c.b[1]) + c.width / 2 >= bounds.z0 &&
        Math.min(c.a[1], c.b[1]) - c.width / 2 <= bounds.z1,
    );
  const first = segments[0].s0,
    last = segments.at(-1)!.s1;
  for (
    let station = first + interval;
    station <= last - 6;
    station += interval
  ) {
    const seg = segments.find((s) => station >= s.s0 && station <= s.s1)!;
    const t = (station - seg.s0) / (seg.s1 - seg.s0),
      dx = seg.b[0] - seg.a[0],
      dz = seg.b[1] - seg.a[1],
      length = Math.hypot(dx, dz);
    const anchor: XZ = [seg.a[0] + dx * t, seg.a[1] + dz * t],
      normal: XZ = [dz / length, -dx / length];
    const offsets = [
      0,
      ...(seg.width > diameter + 0.05
        ? [seg.width / 2 - radius, -seg.width / 2 + radius]
        : []),
    ];
    let accepted = false;
    const reasons = new Set<string>();
    for (const offset of offsets) {
      const point: XZ = [
        anchor[0] + normal[0] * offset,
        anchor[1] + normal[1] * offset,
      ];
      const footprint = [
        point,
        ...Array.from(
          { length: 12 },
          (_, i): XZ => [
            point[0] + radius * Math.cos((i * Math.PI) / 6),
            point[1] + radius * Math.sin((i * Math.PI) / 6),
          ],
        ),
      ];
      const tops = footprint.map((p) => options.pathTop(...p));
      if (tops.some((h) => h === undefined || !Number.isFinite(h))) {
        reasons.add('outside-exact-upper-slab');
        continue;
      }
      const ground = footprint.map((p) => options.elevation(...p));
      if (ground.some((y) => !Number.isFinite(y)))
        throw new Error('Non-finite support ground datum');
      const topY = Math.min(...(tops as number[])) - slab;
      if (topY - Math.max(...ground) <= minHeight) {
        reasons.add('underside-not-more-than-2m');
        continue;
      }
      let minClearance = Infinity,
        nearest: string | null = null;
      const blocked: string[] = [];
      for (const c of local) {
        const gap = segmentDistance(point, c.a, c.b) - c.width / 2 - radius;
        if (gap < minClearance) {
          minClearance = gap;
          nearest = c.id;
        }
        if (gap <= buffer + 1e-9) blocked.push(c.id);
      }
      for (const p of options.extraNoFill ?? []) {
        const occupied =
          inside(point, p.outer) &&
          !(p.holes ?? []).some((h) => inside(point, h));
        const distance = Math.min(
          ringDistance(point, p.outer),
          ...(p.holes ?? []).map((h) => ringDistance(point, h)),
        );
        const gap = occupied ? -radius : distance - radius;
        if (gap < minClearance) {
          minClearance = gap;
          nearest = p.id;
        }
        if (gap <= buffer + 1e-9) blocked.push(p.id);
      }
      if (blocked.length) {
        for (const id of blocked) reasons.add(id);
        continue;
      }
      const bottomY = Math.min(...ground) - embed,
        heightM = topY - bottomY;
      columns.push({
        station,
        sourceId: seg.sourceId,
        routeId: seg.routeId,
        surfaceId: seg.surfaceId,
        point,
        offsetM: offset,
        diameterM: diameter,
        footprintRadiusM: radius,
        clearanceBufferM: buffer,
        bottomY,
        topY,
        heightM,
        center: [point[0], (bottomY + topY) / 2, point[1]],
        minPlanClearanceM: minClearance,
        nearestEnvelopeId: nearest,
        material: 'unpainted-concrete',
      });
      accepted = true;
      break;
    }
    if (!accepted) rejected.push({ station, reasons: [...reasons] });
  }
  return {
    columns,
    rejected,
    intervalM: interval,
    sourceId: 70954679,
    slabDepthM: slab,
    localCorridorSegments: local.length,
    allCorridors: options.corridors.length,
    provenance:
      'Original illustrative sparse1m concrete columns; exact upper slab height; conservative lower path/City corridor exclusion. No fill or surveyed footing claim.',
  };
}
