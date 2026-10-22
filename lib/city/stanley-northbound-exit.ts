/** Visible asphalt after the existing northbound exit gate. The original
 * protected floor, permissions, rail openings and endpoint datum stay intact. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project } from './geo';
import { buildCausewayGeometry } from './causeway-geometry';
import type { SurfaceSegment, XZ } from './causeway-profile';
import { addStreetMeshes } from './street-meshes';
import source from './stanley-northbound-exit-source.json';

const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smooth = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};
function nearestTriangle(x: number, z: number, triangles: readonly number[][]) {
  let best = { distance: Infinity, y: 0 };
  for (const t of triangles) {
    const dx = t[3] - t[0],
      dz = t[5] - t[2],
      ex = t[6] - t[0],
      ez = t[8] - t[2];
    const det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-10) continue;
    const u = ((x - t[0]) * ez - (z - t[2]) * ex) / det,
      v = (dx * (z - t[2]) - dz * (x - t[0])) / det;
    if (u >= 0 && v >= 0 && u + v <= 1)
      return { distance: 0, y: t[1] + u * (t[4] - t[1]) + v * (t[7] - t[1]) };
    for (const [a, b] of [
      [0, 3],
      [3, 6],
      [6, 0],
    ]) {
      const ax = t[a],
        az = t[a + 2],
        dx = t[b] - ax,
        dz = t[b + 2] - az;
      const length2 = dx * dx + dz * dz;
      if (length2 < 1e-12) continue;
      const f = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / length2),
      );
      const gap = Math.hypot(x - ax - dx * f, z - az - dz * f);
      if (gap < best.distance)
        best = { distance: gap, y: t[a + 1] + (t[b + 1] - t[a + 1]) * f };
    }
  }
  return best;
}

export function prepareStanleyNorthboundExit(e: CityEngine) {
  const groundTop = (x: number, z: number) => e.data.roadRelief(x, z) + 1.05;
  const canonical = (e.data.causeway.segments as SurfaceSegment[]).filter(
    (s) => s.routeId === source.route.canonicalRouteId,
  );
  if (!canonical.length)
    throw new Error('Northbound exit requires its original protected approach');
  const last = Math.max(...canonical.map((s) => s.s1));
  const original = buildCausewayGeometry(canonical, {
    groundRoadTop: groundTop,
    rails: false,
    paint: false,
  });
  const triangles = original.perSegment
    .filter(
      (p) =>
        p.segment.sourceId === source.route.canonicalLastSourceId &&
        p.segment.s1 >= last - 20,
    )
    .flatMap((p) =>
      Array.from({ length: p.asphalt.length / 9 }, (_, i) =>
        p.asphalt.slice(i * 9, i * 9 + 9),
      ),
    );
  if (!triangles.length || triangles.length > 256)
    throw new Error(
      'Northbound exit requires bounded canonical endpoint triangles',
    );
  const height = (x: number, z: number) => {
    const base = groundTop(x, z),
      near = nearestTriangle(x, z, triangles);
    // Closest physical edge gives a continuous datum even at Float32 seams.
    return base + (near.y - base) * (1 - smooth(near.distance / 4));
  };
  const points: XZ[] = [],
    segments: SurfaceSegment[] = [];
  let station = 0;
  for (const [i, way] of source.ways.entries()) {
    if (
      way.tags.highway !== 'trunk_link' ||
      way.tags.oneway !== 'yes' ||
      (i > 0 && source.ways[i - 1].nodeIds.at(-1) !== way.nodeIds[0])
    )
      throw new Error('Disconnected or non-motor northbound exit source');
    const coordinates = way.coordinates.map(project);
    for (const p of coordinates)
      if (!points.length || distance(points.at(-1)!, p) > 1e-7) points.push(p);
    for (let j = 1; j < coordinates.length; j++) {
      const a = coordinates[j - 1],
        b = coordinates[j],
        length = distance(a, b);
      const start = Math.max(0, source.route.startPavingStationM - station);
      if (start < length) {
        const count = Math.ceil((length - start) / 1.5);
        for (let k = 0; k < count; k++) {
          const from = (start + ((length - start) * k) / count) / length,
            to = (start + ((length - start) * (k + 1)) / count) / length;
          const p: XZ = [
              a[0] + (b[0] - a[0]) * from,
              a[1] + (b[1] - a[1]) * from,
            ],
            q: XZ = [a[0] + (b[0] - a[0]) * to, a[1] + (b[1] - a[1]) * to];
          segments.push({
            a: p,
            b: q,
            h0: height(...p),
            h1: height(...q),
            width: source.route.widthM,
            s0: station + length * from,
            s1: station + length * to,
            sourceId: way.id,
            routeId: 'stanley:northbound-ground-exit',
            surfaceId: 'ground',
            layer: 0,
          });
        }
      }
      station += length;
    }
  }
  const geometry = buildCausewayGeometry(segments, {
    groundRoadTop: groundTop,
    sourceTop: (_id, x, z) => height(x, z),
    tapers: [],
    shoulderWidthM: 0.01,
    shoulderRiseM: 0,
    slabDepthM: 0,
    bridgeSourceIds: new Set(),
    rails: false,
    paint: true,
    allowedModes: () => ['drive'],
  });
  if (geometry.buffers.asphalt.length / 9 > 2048)
    throw new Error('Northbound exit paving cap exceeded');
  const data = {
    points,
    segments,
    geometry,
    height,
    sourceIds: source.route.wayIds,
    fullLengthM: station,
    pavedLengthM: station - source.route.startPavingStationM,
    qaRoutes: {
      northboundExit: {
        sourceIds: source.route.wayIds,
        osmSourceIds: source.route.wayIds,
        points,
        width: source.route.widthM,
        identity: { surfaceId: 'lions:road', layer: 1 },
        reverseIdentity: { surfaceId: 'ground', layer: 0 },
      },
    },
  };
  e.data.stanleyNorthboundExit = data;
  return data;
}

/** Emit the already prepared model only after all protected floors are indexed.
 * Early source-owned path openings consume these exact same road triangles. */
export function addStanleyNorthboundExit(e: CityEngine) {
  const data = e.data.stanleyNorthboundExit ?? prepareStanleyNorthboundExit(e);
  const geometry = data.geometry as ReturnType<typeof buildCausewayGeometry>;
  const asphalt = geometry.buffers.asphalt;
  addStreetMeshes(
    e,
    asphalt,
    e.roadMaterials.get('asphalt-fine')!,
    'Northbound Causeway exit ground continuation',
    asphalt.flatMap((x, i) => (i % 3 === 0 ? [x / 3, asphalt[i + 2] / 3] : [])),
    true,
    true,
  );
  if (geometry.buffers.paintWhite.length)
    addStreetMeshes(
      e,
      geometry.buffers.paintWhite,
      new THREE.MeshStandardMaterial({ color: 0xdcdccf, roughness: 0.9 }),
      'Northbound exit white edges',
    );
  return data;
}
