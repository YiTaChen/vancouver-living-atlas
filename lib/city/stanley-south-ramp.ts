/** One source-owned North Lagoon -> southbound Causeway motor ramp. The City
 * ROW proxy misses much of its asphalt and the mainline rail crosses its merge.
 * Existing South profile heights and every unrelated railing stay unchanged. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import { addStreetMeshes } from './street-meshes';
import {
  buildCausewayGeometry,
  createCausewayTriangleLookup,
  type GeometryResult,
  type GroundPolygon,
  type Identity,
  type TopTriangle,
} from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { forwardGate, type SurfaceConnection } from './surface-reachability';
import source from './stanley-south-ramp-source.json';

const ROUTE = 'stanley:south-motor-ramp';
const MAIN_IDS = new Set([363687651, 74233349]);
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
function nearest(x: number, z: number, segments: readonly SurfaceSegment[]) {
  let best:
    | {
        distance: number;
        point: XZ;
        y: number;
        width: number;
        segment: SurfaceSegment;
      }
    | undefined;
  for (const s of segments) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      l2 = dx * dx + dz * dz;
    const t = Math.max(
      0,
      Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / l2),
    );
    const d = Math.hypot(x - s.a[0] - dx * t, z - s.a[1] - dz * t);
    if (!best || d < best.distance)
      best = {
        distance: d,
        point: [s.a[0] + dx * t, s.a[1] + dz * t],
        y: s.h0 + (s.h1 - s.h0) * t,
        width: s.width,
        segment: s,
      };
  }
  return best;
}

/** Split only the new ramp at the unchanged main road's real triangle edges.
 * Retopping the corners of a wide ramp triangle alone leaves a slanted sheet
 * up to several centimetres below the main asphalt inside their overlap. */
export function conformMergePaving(
  geometry: GeometryResult,
  main: GeometryResult,
  height: (x: number, z: number) => number,
  selectedSourceIds?: ReadonlySet<number>,
) {
  const area = (p: readonly XZ[]) =>
    Math.abs(
      p.reduce((n, a, i) => {
        const b = p[(i + 1) % p.length];
        return n + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2;
  const clip = (p: readonly XZ[], signed: (v: XZ) => number) => {
    const out: XZ[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        da = signed(a),
        db = signed(b);
      if (da >= -1e-9) out.push(a);
      if (da >= 0 !== db >= 0) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out.filter((v, i) => !i || distance(v, out[i - 1]) > 1e-7);
  };
  const mainFaces = main.topTriangles
    .filter((t) => t.buffer === 'asphalt')
    .map((t) => {
      const p = main.buffers.asphalt.slice(t.offset, t.offset + 9),
        points: XZ[] = [0, 3, 6].map((i) => [p[i], p[i + 2]]),
        det = (p[3] - p[0]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[6] - p[0]),
        sign = Math.sign(det);
      return {
        t,
        points,
        signed: points.map((a, i) => {
          const b = points[(i + 1) % points.length];
          return (v: XZ) =>
            sign *
            ((b[0] - a[0]) * (v[1] - a[1]) - (b[1] - a[1]) * (v[0] - a[0]));
        }),
        height: (x: number, z: number) =>
          p[1] +
          (((x - p[0]) * (p[8] - p[2]) - (z - p[2]) * (p[6] - p[0])) / det) *
            (p[4] - p[1]) +
          (((p[3] - p[0]) * (z - p[2]) - (p[5] - p[2]) * (x - p[0])) / det) *
            (p[7] - p[1]),
      };
    });
  // Source-selected shared paths weld only half-millimetre numerical twins.
  // Canonical motor vertices win, avoiding vertical Float32 clipping slivers.
  const weldCells = new Map<string, XZ[]>(),
    weldSize = 0.0005;
  const weld = (point: XZ): XZ => {
    if (!selectedSourceIds) return point;
    const x = Math.floor(point[0] / weldSize),
      z = Math.floor(point[1] / weldSize);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const candidate of weldCells.get(`${x + dx},${z + dz}`) ?? [])
          if (distance(point, candidate) <= weldSize) return candidate;
    const key = `${x},${z}`,
      cell = weldCells.get(key) ?? [];
    cell.push(point);
    weldCells.set(key, cell);
    return point;
  };
  if (selectedSourceIds)
    for (const face of mainFaces) for (const point of face.points) weld(point);
  const asphalt: number[] = [],
    tops: TopTriangle[] = [];
  let emittedSelected = 0;
  const emit = (poly: readonly XZ[], t: TopTriangle, y: typeof height) => {
    if (poly.length < 3 || area(poly) < 1e-7) return;
    for (let i = 1; i < poly.length - 1; i++) {
      const p = [poly[0], poly[i], poly[i + 1]],
        offset = asphalt.length;
      if (area(p) < 1e-7) continue;
      const vertices = p.map((v) => {
        const point = weld(v),
          x = Math.fround(point[0]),
          z = Math.fround(point[1]);
        return [x, Math.fround(selectedSourceIds ? y(x, z) : y(...point)), z];
      });
      const [a, b, c] = vertices,
        upward = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      // Clipping very close to an existing Float32 edge can collapse two
      // distinct double-precision points into the same rendered vertex.
      if (upward <= 1e-9) continue;
      if (emittedSelected >= 8192)
        throw new Error(
          'South merge paving exceeded its static triangle budget',
        );
      emittedSelected++;
      for (const v of vertices) asphalt.push(...v);
      tops.push({
        ...t,
        offset,
        minX: Math.min(...p.map((v) => v[0])),
        maxX: Math.max(...p.map((v) => v[0])),
        minZ: Math.min(...p.map((v) => v[1])),
        maxZ: Math.max(...p.map((v) => v[1])),
      });
    }
  };
  for (const t of geometry.topTriangles) {
    if (t.buffer !== 'asphalt') {
      tops.push(t);
      continue;
    }
    const p = geometry.buffers.asphalt.slice(t.offset, t.offset + 9);
    // A shared path batch may contain many unrelated, already correct sources.
    // Source-scoped crossing conform leaves their actual triangles byte exact.
    if (
      selectedSourceIds &&
      !t.identities.some((id) => selectedSourceIds.has(id.sourceId))
    ) {
      const offset = asphalt.length;
      asphalt.push(...p);
      tops.push({ ...t, offset });
      continue;
    }
    let uncovered: XZ[][] = [[0, 3, 6].map((i) => [p[i], p[i + 2]])];
    const candidates = mainFaces.filter(
      ({ t: q }) =>
        t.minX <= q.maxX &&
        t.maxX >= q.minX &&
        t.minZ <= q.maxZ &&
        t.maxZ >= q.minZ,
    );
    if (candidates.length > 512)
      throw new Error('South merge paving exceeded its static source budget');
    for (const face of candidates) {
      const remaining: XZ[][] = [];
      for (const original of uncovered) {
        let intersection = original;
        for (const signed of face.signed) {
          intersection = clip(intersection, signed);
          if (intersection.length < 3 || area(intersection) < 1e-7) break;
        }
        if (intersection.length < 3 || area(intersection) < 1e-7) {
          remaining.push(original);
          continue;
        }
        let inside = original;
        for (const signed of face.signed) {
          const outside = clip(inside, (v) => -signed(v));
          if (outside.length >= 3 && area(outside) > 1e-7)
            remaining.push(outside);
          inside = clip(inside, signed);
          if (inside.length < 3 || area(inside) < 1e-7) break;
        }
        emit(inside, t, face.height);
      }
      uncovered = remaining;
      if (!uncovered.length) break;
    }
    const determinant =
        (p[3] - p[0]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[6] - p[0]),
      originalPlane = (x: number, z: number) =>
        p[1] +
        (((x - p[0]) * (p[8] - p[2]) - (z - p[2]) * (p[6] - p[0])) /
          determinant) *
          (p[4] - p[1]) +
        (((p[3] - p[0]) * (z - p[2]) - (p[5] - p[2]) * (x - p[0])) /
          determinant) *
          (p[7] - p[1]);
    // Shared cycle paths retain their original outer verge; only the actual
    // overlapping motor footprint receives its canonical road planes.
    for (const poly of uncovered)
      emit(poly, t, selectedSourceIds ? originalPlane : height);
  }
  geometry.buffers.asphalt = asphalt;
  geometry.topTriangles = tops;
  for (const p of geometry.perSegment) {
    p.asphalt = [];
    p.shoulder = [];
    p.topTriangleIndices = [];
  }
  for (const [i, t] of tops.entries()) {
    const p = geometry.perSegment[t.inputIndex];
    if (!p) continue;
    p[t.buffer].push(
      ...geometry.buffers[t.buffer].slice(t.offset, t.offset + 9),
    );
    p.topTriangleIndices.push(i);
  }
  for (const surface of geometry.surfaces) {
    const p = geometry.perSegment[surface.inputIndex];
    if (p) surface.triangles = surface.kind === 'road' ? p.asphalt : p.shoulder;
  }
  geometry.stats.topTriangles = tops.length;
  geometry.stats.triangles = Object.values(geometry.buffers).reduce(
    (n, b) => n + b.length / 9,
    0,
  );
}
export function prepareStanleySouthRamp(options: {
  project: (coordinate: readonly number[]) => XZ;
  segments: readonly SurfaceSegment[];
  groundRoadTop: (x: number, z: number) => number;
}) {
  const main = options.segments.filter(
    (s) => s.routeId === 'causeway-south-west' && MAIN_IDS.has(s.sourceId),
  );
  if (!main.length)
    throw new Error('South motor ramp requires its canonical West merge');
  const ways = source.route.wayIds.map((id) =>
    source.ways.find((w) => w.id === id)!,
  );
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i];
    if (
      !w ||
      w.tags.highway !== 'trunk_link' ||
      w.tags.oneway !== 'yes' ||
      (i && ways[i - 1].nodeIds.at(-1) !== w.nodeIds[0])
    )
      throw new Error('Invalid/disconnected source-owned South motor ramp');
  }
  const points: XZ[] = [];
  for (const w of ways)
    for (const p of w.coordinates.map(options.project))
      if (!points.length || distance(points.at(-1)!, p) > 1e-7) points.push(p);
  const terminal = ways.at(-1)!.coordinates.map(options.project),
    width = source.model.widthM,
    segments: SurfaceSegment[] = [];
  let station = 0,
    terminalStart = 0;
  for (const w of ways.slice(0, -1))
    for (let i = 1; i < w.coordinates.length; i++)
      terminalStart += distance(
        options.project(w.coordinates[i - 1]),
        options.project(w.coordinates[i]),
      );
  let sourceStation = 0;
  const sourceEnds = ways.map((w) => {
    for (let i = 1; i < w.coordinates.length; i++)
      sourceStation += distance(
        options.project(w.coordinates[i - 1]),
        options.project(w.coordinates[i]),
      );
    return sourceStation;
  });
  // Use the unchanged West road's actual mitered triangles, including its
  // existing ground taper. A centre-only Y blend leaves the ramp's inner edge
  // below the road while the car's outside wheels are still on the approach.
  const mainGeometry = buildCausewayGeometry(
    options.segments.filter((s) => s.routeId === 'causeway-south-west'),
    {
      groundRoadTop: options.groundRoadTop,
      rails: false,
      paint: false,
    },
  );
  const mainLookup = createCausewayTriangleLookup(mainGeometry);
  const planeCache = new Map<
    TopTriangle,
    { x: number; z: number; y: number; gx: number; gz: number }
  >();
  const extendPlane = (t: TopTriangle, x: number, z: number) => {
    let p = planeCache.get(t);
    if (!p) {
      const [a, b, c] = mainLookup.vertices(t),
        det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      p = {
        x: a[0],
        z: a[2],
        y: a[1],
        gx:
          ((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / det,
        gz:
          ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / det,
      };
      planeCache.set(t, p);
    }
    return p.y + p.gx * (x - p.x) + p.gz * (z - p.z);
  };
  const height = (x: number, z: number) => {
    const ground = options.groundRoadTop(x, z),
      n = nearest(x, z, main);
    if (!Number.isFinite(ground) || !n)
      throw new Error('Missing South motor ramp datum');
    const fullGradeDistance = n.width / 2 + width / 2 + 0.5,
      blend = smooth((fullGradeDistance + 2.75 - n.distance) / 2.75),
      actual = mainLookup.heightAt(
        x,
        z,
        { surfaceId: 'lions:road', layer: 1 },
        'road',
      ),
      anchor =
        actual ??
        mainLookup.heightAt(
          ...n.point,
          { surfaceId: 'lions:road', layer: 1 },
          'road',
        ),
      top = anchor ? extendPlane(anchor.triangle, x, z) : n.y;
    // Fully adopt the actual main plane before a parent ramp triangle reaches
    // its boundary. Retopping one clipped vertex through a nonlinear blend
    // otherwise creates a narrow ridge beside that unchanged canonical edge.
    return ground + (top - ground) * (actual ? 1 : blend);
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = distance(a, b),
      count = Math.ceil(length / 1.5);
    for (let j = 0; j < count; j++) {
      const t = j / count,
        u = (j + 1) / count,
        p: XZ = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        q: XZ = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      segments.push({
        a: p,
        b: q,
        h0: height(...p),
        h1: height(...q),
        width,
        s0: station + t * length,
        s1: station + u * length,
        sourceId:
          source.route.wayIds[
            sourceEnds.findIndex((end) => station < end - 1e-7)
          ],
        routeId: ROUTE,
        surfaceId: 'ground',
        layer: 0,
      });
    }
    station += length;
  }
  const terminalLength = terminal
    .slice(1)
    .reduce((n, p, i) => n + distance(terminal[i], p), 0);
  let gate:
    | { point: XZ; direction: XZ; height: number; station: number }
    | undefined;
  let walk = 0;
  for (let i = 1; i < terminal.length && !gate; i++) {
    const a = terminal[i - 1],
      b = terminal[i],
      length = distance(a, b),
      dx = (b[0] - a[0]) / length,
      dz = (b[1] - a[1]) / length;
    for (let s = 0; s <= length; s += 0.1) {
      const p: XZ = [a[0] + dx * s, a[1] + dz * s],
        n = nearest(...p, main)!;
      if (n.distance <= n.width / 2 - 0.5 && n.distance >= width / 2 + 0.25) {
        gate = {
          point: p,
          direction: [dx, dz],
          height: n.y,
          station: terminalStart + walk + s,
        };
        break;
      }
    }
    walk += length;
  }
  if (!gate)
    throw new Error('South motor ramp needs a finite off-mainline entry gate');
  const merge = points.at(-1)!,
    join = nearest(...merge, main)!;
  if (join.distance > 0.001)
    throw new Error('South motor ramp must share the actual mainline node');
  const railAllowed = (identity: Identity, x: number, z: number) => {
    if (
      identity.routeId !== 'causeway-south-west' ||
      identity.surfaceId !== 'lions:road' ||
      identity.layer !== 1 ||
      !MAIN_IDS.has(identity.sourceId)
    )
      return true;
    for (let i = 1; i < terminal.length; i++) {
      const a = terminal[i - 1],
        b = terminal[i],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        l2 = dx * dx + dz * dz,
        t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      if (
        Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) <=
        width / 2 + source.model.railClearanceMarginM
      )
        return false;
    }
    return true;
  };
  const connections: SurfaceConnection[] = [
    {
      id: 'stanley-south-legal-motor-ramp',
      from: { surfaceId: 'ground', layer: 0 },
      to: { surfaceId: 'lions:road', layer: 1 },
      allowedModes: ['drive'],
      twoWay: true,
      maxSeamStep: source.model.maxSeamStepM,
      geometry: forwardGate(gate.point, gate.direction, width),
    },
  ];
  const geometry = buildCausewayGeometry(segments, {
    shoulderWidthM: 0.01,
    shoulderRiseM: 0,
    slabDepthM: 0,
    bridgeSourceIds: new Set(),
    rails: false,
    paint: true,
    groundRoadTop: options.groundRoadTop,
    surfaceTop: (_routeId, x, z) => height(x, z),
    tapers: [{ routeId: ROUTE, startM: 8 }],
    allowedModes: () => ['drive'],
  });
  conformMergePaving(geometry, mainGeometry, height);
  const sections = new Map(geometry.sections.map((s) => [s.s, s]));
  const terminalShoulderOpenings: GroundPolygon[] = segments
    .filter((s) => s.sourceId === ways.at(-1)!.id)
    .map((s) => {
      const a = sections.get(s.s0)!,
        b = sections.get(s.s1)!,
        length = distance(s.a, s.b),
        dx = (s.b[0] - s.a[0]) / length,
        dz = (s.b[1] - s.a[1]) / length,
        margin = source.model.shoulderNumericalOverlapM;
      const edge = (section: typeof a, side: -1 | 1, end: -1 | 1): XZ => {
        const crossLength = Math.hypot(
            section.right[0] - section.left[0],
            section.right[2] - section.left[2],
          ),
          p = side === -1 ? section.left : section.right;
        return [
          p[0] +
            ((section.right[0] - section.left[0]) / crossLength) *
              side *
              margin +
            dx * end * margin,
          p[2] +
            ((section.right[2] - section.left[2]) / crossLength) *
              side *
              margin +
            dz * end * margin,
        ];
      };
      // Adjacent physical strips overlap by 2mm at their shared Float32 edge.
      // Repeatedly subtracting every retessellated triangle instead leaves
      // microscopic raised-shoulder slivers inside otherwise continuous road.
      return {
        outer: [edge(a, -1, -1), edge(a, 1, -1), edge(b, 1, 1), edge(b, -1, 1)],
      };
    });
  const shoulderOpenings = (id: Identity): readonly GroundPolygon[] =>
    id.routeId === 'causeway-south-west' &&
    id.surfaceId === 'lions:road' &&
    id.layer === 1 &&
    MAIN_IDS.has(id.sourceId)
      ? terminalShoulderOpenings
      : [];
  const continuation = main
    .filter((s) => s.sourceId === 74233349)
    .sort((a, b) => b.s1 - a.s1);
  const after: XZ[] = [];
  let remain = 20;
  for (const s of continuation) {
    const length = distance(s.a, s.b),
      fraction = Math.min(1, remain / length);
    after.push([
      s.b[0] + (s.a[0] - s.b[0]) * fraction,
      s.b[1] + (s.a[1] - s.b[1]) * fraction,
    ]);
    remain -= length;
    if (remain <= 0) break;
  }
  const fullQA = [...points, ...after];
  const qaFrom = (startM: number) => {
    const route: XZ[] = [];
    let qaStation = 0;
    for (let i = 1; i < fullQA.length; i++) {
      const a = fullQA[i - 1],
        b = fullQA[i],
        length = distance(a, b);
      if (qaStation + length > startM) {
        if (!route.length) {
          const t = Math.max(0, (startM - qaStation) / length);
          route.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        route.push(b);
      }
      qaStation += length;
    }
    return route;
  };
  const qa = (route: XZ[]) => ({
    sourceIds: [...source.route.wayIds, 363687651, 74233349],
    osmSourceIds: source.route.wayIds,
    points: route,
    width,
    identity: { surfaceId: 'ground', layer: 0 },
    reverseIdentity: { surfaceId: 'lions:road', layer: 1 },
  });
  return {
    points,
    segments,
    geometry,
    railAllowed,
    shoulderOpenings,
    connections,
    gate,
    merge,
    mergeTopY: join.y,
    terminalStart,
    terminalLength,
    width,
    qaRoutes: {
      southEntry: qa(fullQA),
      southMerge: qa(qaFrom(85)),
      southRail: qa(qaFrom(104)),
    },
  };
}
export type StanleySouthRamp = ReturnType<typeof prepareStanleySouthRamp>;
/** Ordinary ground asphalt: participates in the existing road/ground index and
 * tree reconciliation, while the unchanged mainline retains its own identity. */
export function addStanleySouthRampMeshes(
  e: CityEngine,
  ramp: StanleySouthRamp,
) {
  const asphalt = ramp.geometry.buffers.asphalt;
  const uv = asphalt.flatMap((x, i) =>
    i % 3 === 0 ? [x / 3, asphalt[i + 2] / 3] : [],
  );
  addStreetMeshes(
    e,
    asphalt,
    e.roadMaterials.get('asphalt-fine')!,
    'North Lagoon legal South motor ramp',
    uv,
    true,
    true,
  );
  // OSM marks a one-way motor ramp; retain white edge lines without inventing
  // a yellow opposing-traffic centreline or an unmeasured cycle-lane division.
  const white = ramp.geometry.buffers.paintWhite;
  if (white.length)
    addStreetMeshes(
      e,
      white,
      new THREE.MeshStandardMaterial({ color: 0xdcdccf, roughness: 0.9 }),
      'South motor ramp white edges',
    );
}
