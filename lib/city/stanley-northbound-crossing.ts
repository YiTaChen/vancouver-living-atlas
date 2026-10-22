/** The primary zebra and connected cycleway approach are at grade. Correct
 * only their intersection with actual exit paving before path merging/indexing. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { Feature } from './types';
import {
  buildCausewayGeometry,
  type GeometryResult,
  type Identity,
} from './causeway-geometry';
import { conformMergePaving } from './stanley-south-ramp';
import source from './stanley-northbound-crossing-source.json';

/** Returns the original object for every other source. The caller disposes its
 * selected original only after receiving a replacement; no scene/permission
 * flags, source coordinates or motor-paving buffers are modified here. */
export function conformStanleyNorthboundCrossing(
  e: CityEngine,
  feature: Feature,
  original: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const sourceId = Number(feature.properties.sourceId ?? feature.properties.id),
    rule =
      sourceId === source.way.id
        ? source
        : sourceId === source.groundApproach.id
          ? source.groundApproach
          : undefined;
  if (!rule) return original;
  if (
    JSON.stringify(feature.geometry) !==
    JSON.stringify(rule.bundledSourceGeometry)
  )
    throw new Error('Northbound zebra crossing bundled source changed');
  const motor = e.data.stanleyNorthboundExit?.geometry as
    | GeometryResult
    | undefined;
  if (!motor || !motor.topTriangles.length)
    throw new Error('Northbound zebra crossing requires actual exit asphalt');
  const position = original.getAttribute('position'),
    index = original.index,
    available = index?.count ?? position?.count ?? 0;
  if (
    !position ||
    position.itemSize !== 3 ||
    !available ||
    available % 3 !== 0 ||
    available / 3 > source.model.inputTriangleCap ||
    original.drawRange.start !== 0 ||
    original.drawRange.count !== Infinity
  )
    throw new Error('Unsupported northbound zebra crossing source geometry');
  const wrapped = buildCausewayGeometry([]),
    parentTriangles: { vertices: number[][]; indices: number[] }[] = [],
    identity: Identity = {
      sourceId,
      routeId: 'stanley:northbound-zebra-crossing',
      surfaceId: 'ground',
      layer: 0,
    };
  for (let i = 0; i < available; i += 3) {
    const indices = [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j));
    const vertices = indices.map((n) => {
      return [position.getX(n), position.getY(n), position.getZ(n)];
    });
    if (!vertices.flat().every(Number.isFinite))
      throw new Error('Nonfinite northbound crossing source triangle');
    // Ribbon/draper winding is not the motor builder's upward convention.
    // Reorder this temporary wrapper only; the original plane/XY is unchanged.
    const [a, b, c] = vertices,
      upward = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (Math.abs(upward) < 1e-9)
      throw new Error('Degenerate northbound crossing source triangle');
    if (upward < 0) {
      [vertices[1], vertices[2]] = [vertices[2], vertices[1]];
      [indices[1], indices[2]] = [indices[2], indices[1]];
    }
    parentTriangles.push({ vertices, indices });
    const offset = wrapped.buffers.asphalt.length;
    wrapped.buffers.asphalt.push(...vertices.flat());
    wrapped.topTriangles.push({
      buffer: 'asphalt',
      offset,
      identities: [identity],
      s0: 0,
      s1: 0,
      role: 'road',
      inputIndex: i / 3,
      minX: Math.min(...vertices.map((p) => p[0])),
      maxX: Math.max(...vertices.map((p) => p[0])),
      minZ: Math.min(...vertices.map((p) => p[2])),
      maxZ: Math.max(...vertices.map((p) => p[2])),
    });
  }
  conformMergePaving(
    wrapped,
    motor,
    () => {
      throw new Error(
        'Crossing outside plane must come from its original triangle',
      );
    },
    new Set([sourceId]),
  );
  if (wrapped.buffers.asphalt.length / 9 > source.model.outputTriangleCap)
    throw new Error('Northbound crossing static triangle budget exceeded');
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(wrapped.buffers.asphalt, 3),
  );
  if (original.getAttribute('normal')) result.computeVertexNormals();
  // Preserve an existing UV contract after subdivision. Current geographic
  // path ribbons are untextured; optional caller UVs retain their parent plane.
  const uv = original.getAttribute('uv');
  if (uv) {
    if (uv.itemSize !== 2 || uv.count !== position.count)
      throw new Error('Unsupported northbound crossing UV attribute');
    const values: number[] = [];
    for (const triangle of wrapped.topTriangles) {
      const parent = parentTriangles[triangle.inputIndex],
        [a, b, c] = parent.vertices,
        determinant =
          (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      for (let j = 0; j < 3; j++) {
        const n = triangle.offset + j * 3,
          x = wrapped.buffers.asphalt[n],
          z = wrapped.buffers.asphalt[n + 2],
          u =
            ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) /
            determinant,
          v =
            ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) /
            determinant;
        for (const component of [0, 1]) {
          const get = (id: number) => (component ? uv.getY(id) : uv.getX(id)),
            [ia, ib, ic] = parent.indices,
            value = get(ia) + u * (get(ib) - get(ia)) + v * (get(ic) - get(ia));
          if (!Number.isFinite(value)) throw new Error('Nonfinite crossing UV');
          values.push(value);
        }
      }
    }
    result.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(values, 2, uv.normalized),
    );
  }
  return result;
}

/** The adjacent protected cycleway remains walk-only. Its historical .45m
 * display offset cannot protrude into the actual same-grade motor corridor. */
export function northboundWalkShoulderOpenings(
  e: CityEngine,
  identity: Identity,
) {
  const rule = source.adjacentProtectedWalk;
  if (
    identity.sourceId !== rule.id ||
    identity.routeId !== rule.runtimeScope.routeId ||
    identity.surfaceId !== rule.runtimeScope.surfaceId ||
    identity.layer !== rule.runtimeScope.layer
  )
    return [];
  const model = e.data.stanleyNorthboundExit;
  if (!model?.geometry)
    throw new Error('Walk opening requires prepared NB asphalt');
  const geometry = model.geometry as GeometryResult,
    sections = new Map(geometry.sections.map((s) => [s.s, s])),
    segments = model.segments as import('./causeway-profile').SurfaceSegment[];
  return segments.map((s) => {
    const a =
        sections.get(s.s0) ??
        geometry.sections.find((q) => Math.abs(q.s - s.s0) < 1e-6),
      b =
        sections.get(s.s1) ??
        geometry.sections.find((q) => Math.abs(q.s - s.s1) < 1e-6);
    if (!a || !b) throw new Error('NB physical ribbon section missing');
    const length = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]),
      dx = (s.b[0] - s.a[0]) / length,
      dz = (s.b[1] - s.a[1]) / length,
      margin = source.model.shoulderNumericalOverlapM;
    const edge = (
      v: typeof a,
      side: -1 | 1,
      endSide: -1 | 1,
    ): [number, number] => {
      const width = Math.hypot(v.right[0] - v.left[0], v.right[2] - v.left[2]),
        p = side < 0 ? v.left : v.right;
      return [
        p[0] +
          ((v.right[0] - v.left[0]) / width) * side * margin +
          dx * endSide * margin,
        p[2] +
          ((v.right[2] - v.left[2]) / width) * side * margin +
          dz * endSide * margin,
      ];
    };
    return {
      outer: [edge(a, -1, -1), edge(a, 1, -1), edge(b, 1, 1), edge(b, -1, 1)],
    };
  });
}

export function conformStanleyNorthboundWalk(
  e: CityEngine,
  paths: GeometryResult,
) {
  const rule = source.adjacentProtectedWalk,
    bundled = e.data.paths.features.find(
      (f: Feature) =>
        Number(f.properties.sourceId ?? f.properties.id) === rule.id,
    );
  if (
    !bundled ||
    JSON.stringify(bundled.geometry) !==
      JSON.stringify(rule.bundledSourceGeometry)
  )
    throw new Error('Protected NB walk bundled source changed');
  const selected = paths.topTriangles.filter((t) =>
    t.identities.some((id) => id.sourceId === rule.id),
  );
  if (!selected.length)
    throw new Error('Expected source-owned protected NB walk entry');
  if (
    selected.some((t) =>
      t.identities.some(
        (id) =>
          id.sourceId === rule.id &&
          (id.routeId !== rule.runtimeScope.routeId ||
            id.surfaceId !== rule.runtimeScope.surfaceId ||
            id.layer !== rule.runtimeScope.layer),
      ),
    )
  )
    throw new Error('Unexpected protected NB walk source scope');
  const model = e.data.stanleyNorthboundExit;
  if (!model?.geometry)
    throw new Error('Protected walk conform requires prepared NB asphalt');
  conformMergePaving(
    paths,
    model.geometry,
    () => {
      throw new Error('Protected NB walk outer plane must remain original');
    },
    new Set([rule.id]),
  );
}
