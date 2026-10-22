import * as THREE from 'three';
import type { CityEngine } from './engine';
import { inPolygon, project } from './geo';
import { pitchedRoofTriangles, type PitchedRoof } from './building-roof';
import { FURNITURE_FOOTPRINTS } from './street-furniture-placement';
import {
  TeslaWorld,
  triangleFace,
  type TeslaFace,
  type TeslaGeometrySource,
} from './tesla-world';
import type {
  TeslaContact,
  TeslaPose,
  TeslaShape,
  TeslaSupportQuery,
  TeslaVec3,
  TeslaSweepQuery,
  TeslaGroundDepartureQuery,
  TeslaWorld as TeslaWorldContract,
} from './tesla-state';
import { TravelSurfaceIndex } from './travel-surfaces';
import type { SurfaceConnection } from './surface-reachability';
import type { WaterSurface, WaterWorld } from './water-world';
import {
  TeslaRenderedRoofDetailsWorld,
  nearestTeslaRoofDetailHit,
} from './tesla-roof-details-world';

const vector = (p: TeslaVec3) => new THREE.Vector3(...p);
const triple = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
const keyRing = (ring: readonly (readonly number[])[]) =>
  ring
    .map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)
    .sort()
    .join('|');
/** Conservative union of shipped crown LODs: broadleaf foliage starts at
 * .426h in both procedural variants and mature-tree GLBs; near conifer sprays
 * extend down to .0753h. Trunk/branches are separate, never a ground-level crown. */
export const TESLA_TREE_ENVELOPE = {
  trunkRadius: 0.035,
  broadleafCrownBase: 0.425,
  coniferCrownBase: 0.075,
  crownRadius: 0.3,
} as const;
export interface TeslaRoadSpawn {
  pose: TeslaPose;
  contact: TeslaContact;
  identity: {
    surfaceId: string;
    layer: number;
    allowedModes: readonly ('walk' | 'drive')[];
  };
}
export interface TeslaRoadSeam {
  groups: readonly [string, string];
  a: readonly [number, number];
  b: readonly [number, number];
  drive: boolean;
  heightDeltaM: number;
  maxSeamStep: number;
}
/** A physical peer relation exists only while the real tyre rectangle straddles
 * the finite, source-validated seam. It grants no persistent floor identity. */
export function teslaRoadSeamConnections(
  pose: TeslaPose,
  shape: TeslaShape,
  seams: readonly TeslaRoadSeam[],
): readonly (readonly [string, string])[] {
  if (
    !shape.groundSupport ||
    seams.length > 16 ||
    ![...pose.position, ...pose.quaternion].every(Number.isFinite)
  )
    return [];
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)].map(
    (v) =>
      v.applyQuaternion(new THREE.Quaternion(...pose.quaternion).normalize()),
  );
  const wheels = shape.groundSupport.wheelContacts.map((w) =>
    new THREE.Vector3(...w)
      .applyQuaternion(new THREE.Quaternion(...pose.quaternion).normalize())
      .add(vector(pose.position)),
  );
  const result: (readonly [string, string])[] = [];
  for (const seam of seams) {
    if (
      !seam.drive ||
      ![...seam.a, ...seam.b, seam.heightDeltaM, seam.maxSeamStep].every(
        Number.isFinite,
      ) ||
      seam.maxSeamStep < 0 ||
      seam.maxSeamStep > 0.05 ||
      Math.abs(seam.heightDeltaM) > seam.maxSeamStep + 1e-7
    )
      continue;
    const dx = seam.b[0] - seam.a[0],
      dz = seam.b[1] - seam.a[1],
      length = Math.hypot(dx, dz);
    if (length < 0.1 || length > 16) continue;
    const normal = new THREE.Vector3(-dz / length, 0, dx / length);
    const signs = wheels.map(
      (w) => (w.x - seam.a[0]) * normal.x + (w.z - seam.a[1]) * normal.z,
    );
    if (Math.min(...signs) > 1e-6 || Math.max(...signs) < -1e-6) continue;
    if (
      axes.some((axis) => {
        const wheel = wheels.map((w) => w.x * axis.x + w.z * axis.z),
          a = seam.a[0] * axis.x + seam.a[1] * axis.z,
          b = seam.b[0] * axis.x + seam.b[1] * axis.z;
        return (
          Math.max(...wheel) < Math.min(a, b) - 1e-6 ||
          Math.min(...wheel) > Math.max(a, b) + 1e-6
        );
      })
    )
      continue;
    result.push(seam.groups);
    if (result.length > 4) return [];
  }
  return result;
}
export interface TeslaRoadOverlap {
  groups: readonly [string, string];
  center: readonly [number, number];
  radiusM: number;
  maxSeamStepM: number;
  floor: (group: string, x: number, z: number) => number | undefined;
  /** Spatially bounded edges of the actual source paving; never inferred road widths. */
  edges?: (
    x: number,
    z: number,
    radiusM: number,
  ) => readonly {
    a: readonly [number, number];
    b: readonly [number, number];
  }[];
  /** Exact source seam; stripHalfWidthM is physical paving, not suspension tolerance. */
  seam?: {
    a: readonly [number, number];
    b: readonly [number, number];
    stripHalfWidthM: number;
  };
}
/** A real source-owned junction can share physical paving beyond its source
 * graph node. Prove the locally overlapping tops before using body envelopes. */
export function teslaRoadOverlapConnections(
  pose: TeslaPose,
  shape: TeslaShape,
  overlaps: readonly TeslaRoadOverlap[],
): readonly (readonly [string, string])[] {
  if (
    !shape.groundSupport ||
    overlaps.length > 8 ||
    ![...pose.position, ...pose.quaternion].every(Number.isFinite)
  )
    return [];
  const quaternion = new THREE.Quaternion(...pose.quaternion).normalize(),
    right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
    forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const pairs: (readonly [string, string])[] = [];
  for (const overlap of overlaps) {
    if (
      ![...overlap.center, overlap.radiusM, overlap.maxSeamStepM].every(
        Number.isFinite,
      ) ||
      overlap.radiusM <= 0 ||
      overlap.radiusM > 36 ||
      overlap.maxSeamStepM < 0 ||
      overlap.maxSeamStepM > 0.025 ||
      Math.hypot(
        pose.position[0] - overlap.center[0],
        pose.position[2] - overlap.center[1],
      ) >
        overlap.radiusM + Math.hypot(shape.halfExtents[0], shape.halfExtents[2])
    )
      continue;
    let shared = 0,
      valid = true;
    const probes: THREE.Vector3[] = [];
    const determinant = right.x * forward.z - right.z * forward.x;
    if (Math.abs(determinant) <= 0.5) continue;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
      local = (x: number, z: number) => [
        (x * forward.z - z * forward.x) / determinant,
        (z * right.x - x * right.z) / determinant,
      ],
      upLocal = local(up.x, up.z),
      extents = [
        shape.halfExtents[0] +
          shape.clearance +
          Math.abs(upLocal[0]) * shape.halfExtents[1],
        shape.halfExtents[2] +
          shape.clearance +
          Math.abs(upLocal[1]) * shape.halfExtents[1],
      ];
    const appendSegment = (
      a: readonly [number, number],
      b: readonly [number, number],
    ) => {
      if (![...a, ...b].every(Number.isFinite)) return false;
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 1e-8 || length > 128) return false;
      const start = local(a[0] - pose.position[0], a[1] - pose.position[2]),
        delta = local(dx, dz);
      let lo = 0,
        hi = 1;
      for (let axis = 0; axis < 2; axis++) {
        if (Math.abs(delta[axis]) < 1e-12) {
          if (Math.abs(start[axis]) > extents[axis]) hi = -1;
        } else {
          const t0 = (-extents[axis] - start[axis]) / delta[axis],
            t1 = (extents[axis] - start[axis]) / delta[axis];
          lo = Math.max(lo, Math.min(t0, t1));
          hi = Math.min(hi, Math.max(t0, t1));
        }
      }
      if (lo <= hi)
        for (const t of [lo, (lo + hi) / 2, hi])
          probes.push(
            new THREE.Vector3(a[0] + dx * t, pose.position[1], a[1] + dz * t),
          );
      return true;
    };
    // A diagonal road junction or an 8cm cap can enter one bumper corner
    // between the grid points. Probe actual source edges clipped to this OBB.
    const seam = overlap.seam;
    if (
      seam &&
      [...seam.a, ...seam.b, seam.stripHalfWidthM].every(Number.isFinite) &&
      seam.stripHalfWidthM >= 0 &&
      seam.stripHalfWidthM <= 0.08
    ) {
      const dx = seam.b[0] - seam.a[0],
        dz = seam.b[1] - seam.a[1],
        length = Math.hypot(dx, dz);
      if (length >= 0.1 && length <= 16)
        for (const offset of [-seam.stripHalfWidthM, 0, seam.stripHalfWidthM])
          appendSegment(
            [
              seam.a[0] - (dz / length) * offset,
              seam.a[1] + (dx / length) * offset,
            ],
            [
              seam.b[0] - (dz / length) * offset,
              seam.b[1] + (dx / length) * offset,
            ],
          );
    }
    const edges =
      overlap.edges?.(
        pose.position[0],
        pose.position[2],
        Math.hypot(...extents),
      ) ?? [];
    if (
      edges.length > 1024 ||
      edges.some((edge) => !appendSegment(edge.a, edge.b))
    )
      continue;
    for (const x of [-1, 0, 1])
      for (const z of [-1, 0, 1]) {
        const point = vector(pose.position)
          .addScaledVector(right, x * shape.halfExtents[0])
          .addScaledVector(forward, z * shape.halfExtents[2]);
        probes.push(point);
      }
    for (const point of probes) {
      if (
        Math.hypot(point.x - overlap.center[0], point.z - overlap.center[1]) >
        overlap.radiusM
      )
        continue;
      const a = overlap.floor(overlap.groups[0], point.x, point.z),
        b = overlap.floor(overlap.groups[1], point.x, point.z);
      if (a === undefined || b === undefined) continue;
      shared++;
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        Math.abs(a - b) > overlap.maxSeamStepM + 1e-7
      )
        valid = false;
    }
    if (valid && shared) pairs.push(overlap.groups);
  }
  return pairs;
}
/** Build once; an individual car query visits at most four 8m source cells. */
function roadOverlapEdges(
  surfaces: TravelSurfaceIndex['surfaces'],
): NonNullable<TeslaRoadOverlap['edges']> {
  const cells = new Map<
      string,
      Set<{ a: readonly [number, number]; b: readonly [number, number] }>
    >(),
    unique = new Map<
      string,
      { a: readonly [number, number]; b: readonly [number, number] }
    >();
  for (const surface of surfaces)
    for (let n = 0; n < surface.triangles.length; n += 9)
      for (let edge = 0; edge < 3; edge++) {
        const i = n + edge * 3,
          j = n + ((edge + 1) % 3) * 3,
          a: readonly [number, number] = [
            surface.triangles[i],
            surface.triangles[i + 2],
          ],
          b: readonly [number, number] = [
            surface.triangles[j],
            surface.triangles[j + 2],
          ],
          key = [a.join(','), b.join(',')].sort().join('|');
        if (unique.has(key)) continue;
        if (
          ![...a, ...b].every(Number.isFinite) ||
          Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8
        )
          continue;
        const record = { a, b };
        unique.set(key, record);
        const x0 = Math.floor(Math.min(a[0], b[0]) / 8),
          x1 = Math.floor(Math.max(a[0], b[0]) / 8),
          z0 = Math.floor(Math.min(a[1], b[1]) / 8),
          z1 = Math.floor(Math.max(a[1], b[1]) / 8);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64)
          return () => Array.from({ length: 1025 }, () => record);
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const k = `${x},${z}`,
              cell = cells.get(k) ?? new Set();
            cell.add(record);
            cells.set(k, cell);
          }
      }
  return (x, z, radius) => {
    if (![x, z, radius].every(Number.isFinite) || radius < 0 || radius > 4)
      return [];
    const result = new Set<{
      a: readonly [number, number];
      b: readonly [number, number];
    }>();
    for (
      let cx = Math.floor((x - radius) / 8);
      cx <= Math.floor((x + radius) / 8);
      cx++
    )
      for (
        let cz = Math.floor((z - radius) / 8);
        cz <= Math.floor((z + radius) / 8);
        cz++
      )
        for (const edge of cells.get(`${cx},${cz}`) ?? []) result.add(edge);
    return [...result];
  };
}
export interface TeslaPrism {
  id: string;
  polygon: number[][][];
  minY: number;
  maxY: number;
  wallTop?: number;
  roofTriangles?: readonly {
    vertices: readonly [TeslaVec3, TeslaVec3, TeslaVec3];
    normal: TeslaVec3;
    roof: boolean;
  }[];
  obstacle?: boolean;
  enabled?: () => boolean;
}
/** Same facade edges, holes, foundations and top planes as the rendered body.
 * Triangulation is deferred until this car first approaches the source prism. */
export function teslaPrismSource(prism: TeslaPrism): TeslaGeometrySource {
  const ring = prism.polygon[0];
  const bounds = new THREE.Box3(
    new THREE.Vector3(
      Math.min(...ring.map((p) => p[0])),
      prism.minY,
      Math.min(...ring.map((p) => p[1])),
    ),
    new THREE.Vector3(
      Math.max(...ring.map((p) => p[0])),
      prism.maxY,
      Math.max(...ring.map((p) => p[1])),
    ),
  );
  let faces: TeslaFace[] | undefined;
  const load = () => {
    if (faces) return faces;
    faces = [];
    const add = (
      surface: string,
      id: string,
      kind: TeslaContact['kind'],
      vertices: readonly [TeslaVec3, TeslaVec3, TeslaVec3],
      normal: TeslaVec3,
      adherable: boolean,
      group = surface,
    ) => {
      const face = triangleFace(
        surface,
        id,
        kind,
        vertices,
        adherable,
        group,
        normal,
      );
      face.enabled = prism.enabled;
      faces!.push(face);
    };
    for (const [r, polygon] of prism.polygon.entries())
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 1e-7) continue;
        let nx = dz / length,
          nz = -dx / length;
        if (
          inPolygon(
            [(a[0] + b[0]) / 2 + nx * 0.01, (a[1] + b[1]) / 2 + nz * 0.01],
            prism.polygon,
          )
        ) {
          nx = -nx;
          nz = -nz;
        }
        const top = prism.wallTop ?? prism.maxY;
        const a0: TeslaVec3 = [a[0], prism.minY, a[1]],
          b0: TeslaVec3 = [b[0], prism.minY, b[1]],
          a1: TeslaVec3 = [a[0], top, a[1]],
          b1: TeslaVec3 = [b[0], top, b[1]];
        const surface = `${prism.id}:wall:${r}:${i}`;
        add(
          surface,
          `${surface}:0`,
          prism.obstacle ? 'obstacle' : 'wall',
          [a0, b0, b1],
          [nx, 0, nz],
          !prism.obstacle,
        );
        add(
          surface,
          `${surface}:1`,
          prism.obstacle ? 'obstacle' : 'wall',
          [a0, b1, a1],
          [nx, 0, nz],
          !prism.obstacle,
        );
      }
    if (prism.roofTriangles) {
      for (const [i, triangle] of prism.roofTriangles.entries()) {
        const surface = `${prism.id}:${triangle.roof ? 'roof' : 'gable'}:${triangle.roof ? Math.round(triangle.normal[0] * 1000) + ',' + Math.round(triangle.normal[2] * 1000) : i}`;
        add(
          surface,
          `${prism.id}:pitched:${i}`,
          triangle.roof ? 'roof' : 'wall',
          triangle.vertices,
          triangle.normal,
          !prism.obstacle,
          surface,
        );
      }
    } else {
      const shapes = prism.polygon.map((p) =>
          p.map((v) => new THREE.Vector2(v[0], v[1])),
        ),
        flat = shapes.flat();
      for (const [i, triangle] of THREE.ShapeUtils.triangulateShape(
        shapes[0],
        shapes.slice(1),
      ).entries()) {
        const vertices = triangle.map((j): TeslaVec3 => [
          flat[j].x,
          prism.maxY,
          flat[j].y,
        ]) as [TeslaVec3, TeslaVec3, TeslaVec3];
        add(
          `${prism.id}:roof`,
          `${prism.id}:roof:${i}`,
          prism.obstacle ? 'obstacle' : 'roof',
          vertices,
          [0, 1, 0],
          !prism.obstacle,
        );
        add(
          `${prism.id}:underside`,
          `${prism.id}:underside:${i}`,
          'obstacle',
          vertices.map((p): TeslaVec3 => [p[0], prism.minY, p[2]]) as [
            TeslaVec3,
            TeslaVec3,
            TeslaVec3,
          ],
          [0, -1, 0],
          false,
        );
      }
    }
    return faces;
  };
  return {
    id: prism.id,
    bounds,
    enabled: prism.enabled,
    load: (region) => {
      const result = load().filter((face) =>
        new THREE.Box3()
          .setFromPoints(face.triangle.map(vector))
          .intersectsBox(region),
      );
      faces = undefined; // Only the bounded world tile cache retains triangles.
      return result;
    },
    inside: (p) => {
      if (
        p[1] <= prism.minY + 1e-5 ||
        p[1] >= prism.maxY - 1e-5 ||
        !inPolygon([p[0], p[2]], prism.polygon)
      )
        return false;
      if (!prism.roofTriangles || p[1] < (prism.wallTop ?? prism.maxY))
        return true;
      return prism.roofTriangles
        .filter((triangle) => triangle.roof)
        .every((triangle) => {
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            vector(triangle.normal),
            vector(triangle.vertices[0]),
          );
          return plane.distanceToPoint(vector(p)) < -1e-5;
        });
    },
  };
}
export function boxSource(
  id: string,
  min: TeslaVec3,
  max: TeslaVec3,
  matrix?: THREE.Matrix4,
  enabled?: () => boolean,
): TeslaGeometrySource {
  const local = new THREE.Box3(vector(min), vector(max));
  const inverse = matrix?.clone().invert();
  const bounds = matrix ? local.clone().applyMatrix4(matrix) : local;
  return {
    id,
    bounds,
    enabled,
    inside: (p) =>
      local.containsPoint(
        inverse ? vector(p).applyMatrix4(inverse) : vector(p),
      ),
    load: (region) => {
      const points: TeslaVec3[] = [
        [min[0], min[1], min[2]],
        [max[0], min[1], min[2]],
        [max[0], max[1], min[2]],
        [min[0], max[1], min[2]],
        [min[0], min[1], max[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], max[2]],
        [min[0], max[1], max[2]],
      ].map((p) =>
        matrix
          ? triple(new THREE.Vector3(...p).applyMatrix4(matrix))
          : ([p[0], p[1], p[2]] as const),
      );
      const faces: TeslaFace[] = [];
      for (const [side, indices] of [
        [0, [0, 3, 2, 1]],
        [1, [4, 5, 6, 7]],
        [2, [0, 4, 7, 3]],
        [3, [1, 2, 6, 5]],
        [4, [0, 1, 5, 4]],
        [5, [3, 7, 6, 2]],
      ] as const)
        for (const [part, triangle] of [
          [0, [indices[0], indices[1], indices[2]]],
          [1, [indices[0], indices[2], indices[3]]],
        ] as const) {
          const vertices = triangle.map((i) => points[i]) as [
            TeslaVec3,
            TeslaVec3,
            TeslaVec3,
          ];
          if (
            !new THREE.Box3()
              .setFromPoints(vertices.map(vector))
              .intersectsBox(region)
          )
            continue;
          const face = triangleFace(
            `${id}:side:${side}`,
            `${id}:${side}:${part}`,
            'obstacle',
            vertices,
            false,
          );
          face.enabled = enabled;
          faces.push(face);
        }
      return faces;
    },
  };
}
/** Coarse mesh bounds are indexed once. Vertex/world-plane work is restricted
 * to local cached tiles, preserving source node transforms and actual normals. */
export function teslaMeshSource(
  mesh: THREE.Mesh,
  id: string,
  kind: TeslaContact['kind'],
  adherable: boolean,
  supportGroup = id,
  enabled?: () => boolean,
): TeslaGeometrySource {
  mesh.updateWorldMatrix(true, false);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const matrix = mesh.matrixWorld.clone();
  const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
  let chunks: { first: number; end: number; bounds: THREE.Box3 }[] | undefined;
  return {
    id,
    bounds,
    enabled,
    load: (region) => {
      const geometry = mesh.geometry,
        positions = geometry.getAttribute('position'),
        index = geometry.index;
      const available = index?.count ?? positions.count;
      const first = Math.max(0, geometry.drawRange.start),
        end = Math.min(available, first + geometry.drawRange.count);
      const faces: TeslaFace[] = [];
      const a = new THREE.Vector3(),
        b = new THREE.Vector3(),
        c = new THREE.Vector3(),
        box = new THREE.Box3();
      // Large merged terrain/path meshes need only one bound per 256 source
      // triangles. Build these lazily, retaining no duplicated triangle data.
      if (!chunks) {
        chunks = [];
        const chunkSize = end - first > 3072 ? 768 : end - first;
        for (let start = first; start < end; start += Math.max(3, chunkSize)) {
          const stop = Math.min(end, start + Math.max(3, chunkSize));
          const chunk = new THREE.Box3();
          for (let i = start; i < stop; i++)
            chunk.expandByPoint(
              a
                .fromBufferAttribute(positions, index ? index.getX(i) : i)
                .applyMatrix4(matrix),
            );
          chunks.push({ first: start, end: stop, bounds: chunk });
        }
      }
      for (const chunk of chunks) {
        if (!chunk.bounds.intersectsBox(region)) continue;
        for (let i = chunk.first; i + 2 < chunk.end; i += 3) {
          a.fromBufferAttribute(
            positions,
            index ? index.getX(i) : i,
          ).applyMatrix4(matrix);
          b.fromBufferAttribute(
            positions,
            index ? index.getX(i + 1) : i + 1,
          ).applyMatrix4(matrix);
          c.fromBufferAttribute(
            positions,
            index ? index.getX(i + 2) : i + 2,
          ).applyMatrix4(matrix);
          if (!box.setFromPoints([a, b, c]).intersectsBox(region)) continue;
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          if (normal.lengthSq() < 0.5) continue;
          if (kind === 'ground' && adherable && normal.y < 0) normal.negate();
          const surfaceId = `${id}:face:${i / 3}`;
          const face = triangleFace(
            surfaceId,
            surfaceId,
            kind,
            [triple(a), triple(b), triple(c)],
            adherable && (kind !== 'ground' || normal.y >= 0.92),
            supportGroup,
            triple(normal),
          );
          face.enabled = enabled;
          faces.push(face);
        }
      }
      return faces;
    },
  };
}

type WaterPoint = [number, number];
/** Exact half-plane split of a convex local tile. Shoreline lines can subdivide
 * a cell unnecessarily; final WaterWorld classification removes every land cell. */
function waterHalfPlane(
  poly: WaterPoint[],
  a: WaterPoint,
  b: WaterPoint,
  sign: number,
) {
  const side = (p: WaterPoint) =>
    sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const result: WaterPoint[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    const d = side(p),
      e = side(q);
    if (d >= -1e-9) result.push(p);
    if ((d > 1e-9 && e < -1e-9) || (d < -1e-9 && e > 1e-9)) {
      const t = d / (d - e);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
}
function waterAt(e: CityEngine, x: number, z: number): WaterSurface | null {
  // WaterWorld.at is a boat-navigability query; small non-navigable rendered
  // ponds are still physical water for an airborne vehicle.
  return (
    (e.data.waterSurfaces as WaterSurface[] | undefined)?.find(
      (surface) => surface.polygon && inPolygon([x, z], surface.polygon),
    ) ??
    e.waterWorld?.at(x, z) ??
    null
  );
}
function waterSource(
  e: CityEngine,
  low: number[],
  high: number[],
): TeslaGeometrySource {
  const water = e.waterWorld as WaterWorld;
  const levels = [
    water?.sea?.level ?? 0.1,
    ...((e.data.waterSurfaces as WaterSurface[] | undefined) ?? []).map(
      (s) => s.level,
    ),
  ];
  return {
    id: 'water',
    bounds: new THREE.Box3(
      new THREE.Vector3(low[0], -15, low[1]),
      new THREE.Vector3(high[0], Math.max(...levels), high[1]),
    ),
    inside: ([x, y, z]) => {
      const surface = waterAt(e, x, z);
      return !!surface && y < surface.level - 1e-5;
    },
    load: (region) => {
      const x0 = Math.max(low[0], region.min.x),
        x1 = Math.min(high[0], region.max.x),
        z0 = Math.max(low[1], region.min.z),
        z1 = Math.min(high[1], region.max.z);
      if (x1 <= x0 || z1 <= z0) return [];
      let cells: WaterPoint[][] = [
        [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ],
      ];
      const edges = new Set<{ a: number[]; b: number[] }>();
      for (let x = Math.floor(x0 / 40); x <= Math.floor(x1 / 40); x++)
        for (let z = Math.floor(z0 / 40); z <= Math.floor(z1 / 40); z++)
          for (const edge of water?.edges?.get(`${x},${z}`) ?? [])
            edges.add(edge);
      const lines = new Set<string>();
      for (const { a, b } of edges) {
        if (
          Math.min(a[0], b[0]) > x1 ||
          Math.max(a[0], b[0]) < x0 ||
          Math.min(a[1], b[1]) > z1 ||
          Math.max(a[1], b[1]) < z0
        )
          continue;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1e-7) continue;
        let nx = (b[1] - a[1]) / length,
          nz = (a[0] - b[0]) / length;
        if (nx < 0 || (Math.abs(nx) < 1e-9 && nz < 0)) {
          nx = -nx;
          nz = -nz;
        }
        const key = [nx, nz, nx * a[0] + nz * a[1]]
          .map((v) => v.toFixed(7))
          .join(',');
        if (lines.has(key)) continue;
        lines.add(key);
        cells = cells.flatMap((poly) =>
          [
            waterHalfPlane(poly, a as WaterPoint, b as WaterPoint, 1),
            waterHalfPlane(poly, a as WaterPoint, b as WaterPoint, -1),
          ].filter((p) => p.length >= 3),
        );
      }
      const faces: TeslaFace[] = [];
      // Boundary walls close the submerged volume without inventing a barrier
      // at a cache-tile seam. Test both real shoreline sides, including ponds.
      for (const [edgeIndex, { a, b }] of [...edges].entries()) {
        const dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 1e-7) continue;
        let enter = 0,
          leave = 1;
        for (const [origin, delta, lo, hi] of [
          [a[0], dx, x0, x1],
          [a[1], dz, z0, z1],
        ]) {
          if (Math.abs(delta) < 1e-12) {
            if (origin < lo || origin > hi) {
              leave = -1;
              break;
            }
          } else {
            const u = (lo - origin) / delta,
              v = (hi - origin) / delta;
            enter = Math.max(enter, Math.min(u, v));
            leave = Math.min(leave, Math.max(u, v));
          }
        }
        if (leave - enter < 1e-8) continue;
        const mx = a[0] + (dx * (enter + leave)) / 2,
          mz = a[1] + (dz * (enter + leave)) / 2,
          nx = dz / length,
          nz = -dx / length;
        const plus = waterAt(e, mx + nx * 0.005, mz + nz * 0.005),
          minus = waterAt(e, mx - nx * 0.005, mz - nz * 0.005);
        if (plus?.id === minus?.id && plus?.level === minus?.level) continue;
        const top = Math.max(plus?.level ?? -15, minus?.level ?? -15),
          bottom = Math.min(plus?.level ?? -15, minus?.level ?? -15);
        if (top - bottom < 1e-7) continue;
        const sign = (plus?.level ?? -15) > (minus?.level ?? -15) ? -1 : 1;
        const p: TeslaVec3 = [a[0] + dx * enter, bottom, a[1] + dz * enter],
          q: TeslaVec3 = [a[0] + dx * leave, bottom, a[1] + dz * leave],
          r: TeslaVec3 = [q[0], top, q[2]],
          s: TeslaVec3 = [p[0], top, p[2]];
        const id = `water:shore:${x0}:${z0}:${edgeIndex}`;
        faces.push(
          triangleFace(id, `${id}:0`, 'obstacle', [p, q, r], false, id, [
            nx * sign,
            0,
            nz * sign,
          ]),
          triangleFace(id, `${id}:1`, 'obstacle', [p, r, s], false, id, [
            nx * sign,
            0,
            nz * sign,
          ]),
        );
      }
      for (const [i, poly] of cells.entries()) {
        const cx = poly.reduce((sum, p) => sum + p[0], 0) / poly.length,
          cz = poly.reduce((sum, p) => sum + p[1], 0) / poly.length,
          surface = waterAt(e, cx, cz);
        if (!surface) continue;
        for (let n = 1; n + 1 < poly.length; n++) {
          const id = `water:${surface.id}:${x0}:${z0}:${i}`;
          const vertices = [poly[0], poly[n], poly[n + 1]].map(
            (p): TeslaVec3 => [p[0], surface.level, p[1]],
          ) as [TeslaVec3, TeslaVec3, TeslaVec3];
          const face = triangleFace(
            id,
            `${id}:${n}`,
            'obstacle',
            vertices,
            false,
            id,
            [0, 1, 0],
          );
          if (
            new THREE.Triangle(
              ...(vertices.map(vector) as [
                THREE.Vector3,
                THREE.Vector3,
                THREE.Vector3,
              ]),
            ).getArea() > 1e-8
          )
            faces.push(face);
        }
      }
      return faces;
    },
  };
}

export class CityTeslaWorld extends TeslaWorld {
  impact?: TeslaWorldContract['impact'];
  private readonly roofDetails: TeslaRenderedRoofDetailsWorld;
  private readonly identities = new Map<
    string,
    {
      surfaceId: string;
      layer: number;
      allowedModes: readonly ('walk' | 'drive')[];
    }
  >();
  constructor(private readonly e: CityEngine) {
    const sources: TeslaGeometrySource[] = [];
    const pitched = new Map<string, PitchedRoof>();
    for (const roof of (
      e.data.buildingRoofs as Map<string, PitchedRoof> | undefined
    )?.values() ?? [])
      pitched.set(keyRing(roof.ring), roof);
    for (const [i, volume] of (e.data.flightBuildingVolumes ?? []).entries()) {
      const roof = pitched.get(keyRing(volume.polygon[0]));
      const foundation = roof ? volume.maxY - roof.ridgeHeight : 0;
      sources.push(
        teslaPrismSource({
          id: `building:${i}`,
          polygon: volume.polygon,
          minY: volume.minY,
          maxY: volume.maxY,
          wallTop: roof ? foundation + roof.eaveHeight : volume.maxY,
          roofTriangles: roof
            ? pitchedRoofTriangles(roof, foundation)
            : undefined,
        }),
      );
    }
    const groundSources: TeslaGeometrySource[] = [];
    const collectGround = (object: THREE.Object3D) => {
      if (
        object instanceof THREE.Mesh &&
        (object.userData.asphaltSurface || object.userData.walkSurface) &&
        !object.userData.protectedSurface &&
        (object.userData.layer === undefined || object.userData.layer === 0) &&
        (object.userData.level === undefined ||
          object.userData.level === 'ground') &&
        (object.userData.surfaceId === undefined ||
          object.userData.surfaceId === 'ground')
      )
        groundSources.push(
          teslaMeshSource(
            object,
            `ground:${object.userData.asphaltSurface ? 'asphalt' : 'footway'}:${groundSources.length}`,
            'ground',
            true,
            'ground:0',
          ),
        );
    };
    e.roads.traverse(collectGround);
    e.terrain?.traverse(collectGround);
    sources.push(...groundSources);
    const index = e.data.travelSurfaces as TravelSurfaceIndex | undefined;
    const prospectRampGroup = 'protected:prospect:east-exit:1585:1';
    const prospectEntryGroup = 'protected:prospect:entry-main:1';
    const westEntryGroup = 'protected:stanley:west-entry-main:1';
    const northRampGroup = 'protected:stanley:northbound-motor-ramp:1';
    const northEntryGroup = 'protected:stanley:northbound-entry-main:1';
    const entry = e.data.prospectOverpass?.rampEntry as
      | {
          center: readonly [number, number];
          radiusM: number;
          lowerSourceIds: readonly number[];
          rampRouteId: string;
          maxSeamStepM: number;
        }
      | undefined;
    const atRoadEntry = (
      surface: TravelSurfaceIndex['surfaces'][number],
      metadata: typeof entry,
      routeId: string,
      maxRadiusM: number,
    ) => {
      if (
        !metadata ||
        metadata.rampRouteId !== routeId ||
        !Number.isFinite(metadata.radiusM) ||
        metadata.radiusM <= 0 ||
        metadata.radiusM > maxRadiusM ||
        surface.surfaceId !== 'lions:road' ||
        surface.layer !== 1 ||
        !metadata.lowerSourceIds.includes(
          (surface as { sourceId?: number }).sourceId ?? -1,
        )
      )
        return false;
      const radius = metadata.radiusM + 4;
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (let i = 0; i < surface.triangles.length; i += 3) {
        minX = Math.min(minX, surface.triangles[i]);
        maxX = Math.max(maxX, surface.triangles[i]);
        minZ = Math.min(minZ, surface.triangles[i + 2]);
        maxZ = Math.max(maxZ, surface.triangles[i + 2]);
      }
      return (
        minX <= metadata.center[0] + radius &&
        maxX >= metadata.center[0] - radius &&
        minZ <= metadata.center[1] + radius &&
        maxZ >= metadata.center[1] - radius
      );
    };
    const west = e.data.stanleyWestRamp as
      | {
          rampEntry?: NonNullable<typeof entry>;
          connections?: readonly SurfaceConnection[];
        }
      | undefined;
    const northbound = e.data.stanleyNorthboundRamp as
      | {
          rampEntry?: NonNullable<typeof entry>;
          groundEntry?: {
            center: readonly [number, number];
            radiusM: number;
            gateId: string;
          };
          connections?: readonly SurfaceConnection[];
        }
      | undefined;
    const atNorthEntry = (surface: TravelSurfaceIndex['surfaces'][number]) =>
      atRoadEntry(
        surface,
        northbound?.rampEntry,
        'stanley:northbound-motor-ramp',
        20,
      );
    const atEntry = (surface: TravelSurfaceIndex['surfaces'][number]) =>
      atRoadEntry(surface, entry, 'prospect:east-exit', 12);
    const atWestEntry = (surface: TravelSurfaceIndex['surfaces'][number]) =>
      atRoadEntry(surface, west?.rampEntry, 'stanley:west-motor-ramp', 20);
    const southModelGroup = 'protected:stanley:south-main:1';
    const south = e.data.stanleySouthRamp as
      | {
          connections?: readonly SurfaceConnection[];
          merge?: readonly [number, number];
          geometry?: { surfaces: TravelSurfaceIndex['surfaces'] };
        }
      | undefined;
    type MainSection = {
      sourceId: number;
      routeId: string;
      surfaceId: string;
      layer: number;
      s0: number;
      s1: number;
      a: readonly [number, number];
      b: readonly [number, number];
      width: number;
    };
    const westSections = (
      (e.data.causeway?.segments ?? []) as MainSection[]
    ).filter(
      (s) =>
        s.routeId === 'causeway-south-west' &&
        s.surfaceId === 'lions:road' &&
        s.layer === 1,
    );
    const mainSections = westSections.filter((s) =>
      [363687651, 74233349].includes(s.sourceId),
    );
    let mergeStation: number | undefined;
    if (south?.merge)
      for (const segment of mainSections) {
        const dx = segment.b[0] - segment.a[0],
          dz = segment.b[1] - segment.a[1],
          l2 = dx * dx + dz * dz;
        if (l2 < 1e-9) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((south.merge[0] - segment.a[0]) * dx +
              (south.merge[1] - segment.a[1]) * dz) /
              l2,
          ),
        );
        if (
          Math.hypot(
            south.merge[0] - segment.a[0] - dx * t,
            south.merge[1] - segment.a[1] - dz * t,
          ) <= 0.001
        )
          mergeStation = segment.s0 + (segment.s1 - segment.s0) * t;
      }
    const modeledMain =
      mergeStation === undefined
        ? []
        : mainSections
            .filter(
              (segment) =>
                segment.s1 >= mergeStation! - 35 &&
                segment.s0 <= mergeStation! + 35,
            )
            .sort((a, b) => a.s0 - b.s0);
    const modeledInputs = new Set(
      modeledMain.map((section) =>
        (e.data.causeway.segments as MainSection[]).indexOf(section),
      ),
    );
    const boundaryInputs = new Set(
      modeledMain.length
        ? westSections
            .filter((section) =>
              [modeledMain[0].s0, modeledMain.at(-1)!.s1].some(
                (station) =>
                  section.s0 <= station + 3 && section.s1 >= station - 3,
              ),
            )
            .map((section) =>
              (e.data.causeway.segments as MainSection[]).indexOf(section),
            )
        : [],
    );
    // The actual merge also reaches the adjacent central main way. Select
    // only complete original sections whose every road vertex lies inside the
    // declared 20m entry; their real outer section seams stay explicit below.
    const northCentralInputs = new Set<number>();
    if (northbound?.rampEntry?.rampRouteId === 'stanley:northbound-motor-ramp')
      for (const surface of index?.surfaces ?? []) {
        if (
          surface.routeId !== 'causeway-central' ||
          surface.surfaceId !== 'lions:road' ||
          surface.layer !== 1 ||
          (surface as { sourceId?: number }).sourceId !== 257712148 ||
          !surface.allowedModes.includes('drive')
        )
          continue;
        let inside = surface.triangles.length > 0;
        for (let n = 0; n < surface.triangles.length; n += 3)
          if (
            Math.hypot(
              surface.triangles[n] - northbound.rampEntry.center[0],
              surface.triangles[n + 2] - northbound.rampEntry.center[1],
            ) > northbound.rampEntry.radiusM
          )
            inside = false;
        const input = (surface as { inputIndex?: number }).inputIndex;
        if (inside && input !== undefined) northCentralInputs.add(input);
      }
    const surfaceGroup = (surface: TravelSurfaceIndex['surfaces'][number]) =>
      atEntry(surface)
        ? prospectEntryGroup
        : atWestEntry(surface)
          ? westEntryGroup
          : atNorthEntry(surface) ||
              (surface.routeId === 'causeway-central' &&
                (surface as { sourceId?: number }).sourceId === 257712148 &&
                northCentralInputs.has(
                  (surface as { inputIndex?: number }).inputIndex ?? -1,
                ))
            ? northEntryGroup
            : surface.routeId === 'causeway-south-west' &&
                surface.surfaceId === 'lions:road' &&
                surface.layer === 1 &&
                modeledInputs.has(
                  (surface as { inputIndex?: number }).inputIndex ?? -1,
                )
              ? southModelGroup
              : ((surface.routeId === 'prospect:east-exit' &&
                    surface.surfaceId === 'lions:road') ||
                    (surface.routeId === 'causeway-east-path' &&
                      surface.surfaceId === 'lions:east-walk' &&
                      (surface as { sourceId?: number }).sourceId ===
                        1252160599)) &&
                  surface.layer === 1
                ? prospectRampGroup
                : surface.routeId === 'causeway-west-path' &&
                    surface.surfaceId === 'lions:west-upper' &&
                    surface.layer === 1 &&
                    (surface as { sourceId?: number }).sourceId === 1074018477
                  ? 'protected:park:prospect-overpass:2'
                  : surface.layer === 1 &&
                      ((surface.routeId === 'stanley:northbound-motor-ramp' &&
                        surface.surfaceId === 'lions:road') ||
                        (surface.routeId === 'causeway-east-path' &&
                          surface.surfaceId === 'lions:east-walk' &&
                          (surface as { sourceId?: number }).sourceId ===
                            1252160597))
                    ? northRampGroup
                    : `protected:${surface.surfaceId}:${surface.layer}`;
    const approachGroups = new Map<number, string>();
    for (const surface of index?.surfaces ?? []) {
      const group = surfaceGroup(surface),
        input = (surface as { inputIndex?: number }).inputIndex;
      if (
        input !== undefined &&
        [prospectEntryGroup, westEntryGroup, northEntryGroup].includes(group) &&
        surface.allowedModes.includes('drive')
      ) {
        approachGroups.set(input, group);
        for (const neighbor of [input - 1, input + 1])
          if (neighbor >= 0) boundaryInputs.add(neighbor);
      }
    }
    const northJunctionSurfaces: TravelSurfaceIndex['surfaces'][number][] = [];
    for (const [i, surface] of (index?.surfaces ?? []).entries()) {
      const faces: TeslaFace[] = [],
        northJunctionTriangles: number[] = [];
      for (let n = 0; n < surface.triangles.length; n += 9) {
        const p = surface.triangles.slice(n, n + 9),
          id = `protected:${i}:face:${n / 9}`;
        const vertices: [TeslaVec3, TeslaVec3, TeslaVec3] = [
          [p[0], p[1], p[2]],
          [p[3], p[4], p[5]],
          [p[6], p[7], p[8]],
        ];
        // The builder batches unrelated junctions in one surface. Scope this
        // exact North merge cap per physical triangle, never by surface alone.
        const northJunction =
          northbound?.rampEntry?.rampRouteId ===
            'stanley:northbound-motor-ramp' &&
          surface.routeId === 'junction' &&
          surface.surfaceId === 'lions:road' &&
          surface.layer === 1 &&
          (surface as { sourceId?: number }).sourceId === 363651505 &&
          vertices.every(
            (v) =>
              Math.hypot(
                v[0] - northbound.rampEntry!.center[0],
                v[2] - northbound.rampEntry!.center[1],
              ) <= northbound.rampEntry!.radiusM,
          );
        if (northJunction) northJunctionTriangles.push(...p);
        const normal = new THREE.Triangle(
          ...(vertices.map(vector) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
          ]),
        ).getNormal(new THREE.Vector3());
        if (normal.y < 0) normal.negate();
        faces.push(
          triangleFace(
            id,
            id,
            surface.allowedModes.includes('drive') ? 'ground' : 'obstacle',
            vertices,
            surface.allowedModes.includes('drive') && normal.y >= 0.92,
            northJunction ? northEntryGroup : surfaceGroup(surface),
            triple(normal),
          ),
        );
      }
      if (northJunctionTriangles.length)
        northJunctionSurfaces.push({
          ...surface,
          triangles: northJunctionTriangles,
        });
      sources.push({
        id: `protected:${i}`,
        bounds: new THREE.Box3().setFromPoints(
          faces.flatMap((f) => f.triangle.map(vector)),
        ),
        load: (region) =>
          faces.filter((f) =>
            new THREE.Box3()
              .setFromPoints(f.triangle.map(vector))
              .intersectsBox(region),
          ),
      });
    }
    for (const [i, bridge] of (e.data.flightBridgeVolumes ?? []).entries())
      sources.push(
        boxSource(
          `bridge-solid:${i}`,
          bridge.min,
          bridge.max,
          new THREE.Matrix4().fromArray(bridge.matrix),
        ),
      );
    // These are the actual continuous road slab boundaries, never support.
    // Only a complete upper-road tyre proof lets the authored body sections
    // clear a buried end cap; air and all other floors retain the full hull.
    for (const [i, mesh] of (
      (e.data.prospectSlabMeshes ?? []) as THREE.Mesh[]
    ).entries())
      if (mesh.userData.prospectSlab === true)
        sources.push(
          teslaMeshSource(
            mesh,
            `prospect-slab:${i}`,
            'ground',
            false,
            'protected:park:prospect-overpass:2',
          ),
        );
    for (const [i, detail] of e.landmarkDetails.entries()) {
      detail.holder.updateWorldMatrix(true, true);
      let part = 0;
      detail.medium.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh)
          sources.push(
            teslaMeshSource(
              object,
              `landmark:${i}:${part++}`,
              'obstacle',
              false,
            ),
          );
      });
    }
    if (e.vehicleImpacts) sources.push(...e.vehicleImpacts.sources);
    for (const [i, tree] of (e.vehicleImpacts
      ? []
      : (e.detailedTrees?.trees ?? [])
    ).entries()) {
      const base = tree.y ?? e.elevation(tree.x, tree.z),
        radius = Math.max(0.18, tree.h * TESLA_TREE_ENVELOPE.trunkRadius),
        crownRadius = tree.h * TESLA_TREE_ENVELOPE.crownRadius,
        crownBase = tree.conifer
          ? TESLA_TREE_ENVELOPE.coniferCrownBase
          : TESLA_TREE_ENVELOPE.broadleafCrownBase;
      sources.push(
        boxSource(
          `tree:${i}:trunk`,
          [tree.x - radius, base, tree.z - radius],
          [tree.x + radius, base + tree.h, tree.z + radius],
        ),
        boxSource(
          `tree:${i}:crown`,
          [
            tree.x - crownRadius,
            base + tree.h * crownBase,
            tree.z - crownRadius,
          ],
          [tree.x + crownRadius, base + tree.h, tree.z + crownRadius],
        ),
      );
    }
    for (const [i, [x, z]] of (e.vehicleImpacts
      ? []
      : (e.data.streetLampPoints ?? [])
    ).entries()) {
      const base = e.elevation(x, z) + 1;
      sources.push(
        boxSource(
          `lamp:${i}`,
          [x - 0.13, base, z - 0.13],
          [x + 0.13, base + 8, z + 0.13],
        ),
      );
    }
    for (const placement of e.streetFurniture?.placements ?? []) {
      const shape = FURNITURE_FOOTPRINTS[placement.kind];
      const height =
        placement.kind === 'cedar-bench'
          ? 0.986
          : placement.kind === 'garbage-bin'
            ? 0.971
            : 0.841;
      const matrix = new THREE.Matrix4().makeRotationY(placement.yaw);
      matrix.setPosition(placement.x, placement.y, placement.z);
      sources.push(
        boxSource(
          `furniture:${placement.id}`,
          [-shape.halfX, 0, shape.centerZ - shape.halfZ],
          [shape.halfX, height, shape.centerZ + shape.halfZ],
          matrix,
          () => e.settings.buildings && e.streetFurniture?.ready === true,
        ),
      );
    }
    const low = project([-123.225, 49.334]),
      high = project([-123.089, 49.26]);
    if (e.waterWorld) sources.push(waterSource(e, low, high));
    const prospect = e.data.prospectOverpass as
      | {
          gates: readonly SurfaceConnection[];
          rampSegments: {
            a: readonly [number, number];
            b: readonly [number, number];
            width: number;
          }[];
        }
      | undefined;
    const upperGroup = 'protected:park:prospect-overpass:2';
    const floorIndices = new Map<string, TravelSurfaceIndex>();
    for (const group of [
      upperGroup,
      prospectRampGroup,
      'protected:lions:road:1',
      southModelGroup,
      prospectEntryGroup,
      westEntryGroup,
      northEntryGroup,
      northRampGroup,
    ])
      floorIndices.set(
        group,
        new TravelSurfaceIndex([
          ...(index?.surfaces ?? []).filter(
            (surface) =>
              surfaceGroup(surface) === group &&
              (group !== 'protected:lions:road:1' ||
                boundaryInputs.has(
                  (surface as { inputIndex?: number }).inputIndex ?? -1,
                )) &&
              surface.allowedModes.includes('drive'),
          ),
          ...(group === northEntryGroup ? northJunctionSurfaces : []),
        ]),
      );
    const seams: TeslaRoadSeam[] = [];
    for (const [section, point] of modeledMain.length
      ? ([
          [modeledMain[0], modeledMain[0].a],
          [modeledMain.at(-1)!, modeledMain.at(-1)!.b],
        ] as const)
      : []) {
      const dx = section.b[0] - section.a[0],
        dz = section.b[1] - section.a[1],
        length = Math.hypot(dx, dz);
      const before = floorIndices
          .get('protected:lions:road:1')
          ?.lookup(...point)[0]?.y,
        after = floorIndices.get(southModelGroup)?.lookup(...point)[0]?.y;
      if (length < 1e-6 || before === undefined || after === undefined)
        continue;
      seams.push({
        groups: ['protected:lions:road:1', southModelGroup],
        a: [
          point[0] - ((dz / length) * section.width) / 2,
          point[1] + ((dx / length) * section.width) / 2,
        ],
        b: [
          point[0] + ((dz / length) * section.width) / 2,
          point[1] - ((dx / length) * section.width) / 2,
        ],
        drive: true,
        heightDeltaM: after - before,
        maxSeamStep: 0.025,
      });
    }
    // Each bounded lower approach is an exact subset of the original source
    // sections. Its only outside peers are the real adjacent section seams.
    const causewaySections = (e.data.causeway?.segments ?? []) as MainSection[];
    for (let i = 1; i < causewaySections.length; i++) {
      const before = causewaySections[i - 1],
        after = causewaySections[i],
        g0 =
          approachGroups.get(i - 1) ??
          (modeledInputs.has(i - 1)
            ? southModelGroup
            : 'protected:lions:road:1'),
        g1 =
          approachGroups.get(i) ??
          (modeledInputs.has(i) ? southModelGroup : 'protected:lions:road:1');
      if (
        g0 === g1 ||
        (!approachGroups.has(i - 1) && !approachGroups.has(i)) ||
        before.routeId !== after.routeId ||
        before.surfaceId !== 'lions:road' ||
        after.surfaceId !== 'lions:road' ||
        before.layer !== 1 ||
        after.layer !== 1 ||
        Math.hypot(before.b[0] - after.a[0], before.b[1] - after.a[1]) > 0.001
      )
        continue;
      const point = after.a,
        y0 = floorIndices.get(g0)?.lookup(...point)[0]?.y,
        y1 = floorIndices.get(g1)?.lookup(...point)[0]?.y,
        dx = after.b[0] - after.a[0],
        dz = after.b[1] - after.a[1],
        length = Math.hypot(dx, dz),
        width = Math.min(before.width, after.width);
      if (
        y0 === undefined ||
        y1 === undefined ||
        length < 1e-6 ||
        Math.abs(y1 - y0) > 0.025
      )
        continue;
      seams.push({
        groups: [g0, g1],
        a: [
          point[0] - ((dz / length) * width) / 2,
          point[1] + ((dx / length) * width) / 2,
        ],
        b: [
          point[0] + ((dz / length) * width) / 2,
          point[1] - ((dx / length) * width) / 2,
        ],
        drive: true,
        heightDeltaM: y1 - y0,
        maxSeamStep: 0.025,
      });
    }
    const sourceGates = [
      ...(prospect?.gates ?? []),
      ...(south?.connections ?? []),
      ...(west?.connections ?? []),
      ...(northbound?.connections ?? []),
    ];
    for (const gate of sourceGates.length <= 16 ? sourceGates : []) {
      let groups: [string, string],
        a: readonly [number, number],
        b: readonly [number, number];
      if (
        gate.geometry.kind === 'gate' &&
        ['prospect:north-ground', 'prospect:south-ground'].includes(gate.id) &&
        gate.from.surfaceId === 'ground' &&
        gate.from.layer === 0 &&
        gate.to.surfaceId === 'park:prospect-overpass' &&
        gate.to.layer === 2
      ) {
        groups = ['ground:0', upperGroup];
        a = gate.geometry.a;
        b = gate.geometry.b;
      } else if (
        gate.id === 'stanley-northbound-legal-motor-ramp' &&
        gate.geometry.kind === 'gate' &&
        gate.from.surfaceId === 'ground' &&
        gate.from.layer === 0 &&
        gate.to.surfaceId === 'lions:road' &&
        gate.to.layer === 1
      ) {
        groups = ['ground:0', northRampGroup];
        a = gate.geometry.a;
        b = gate.geometry.b;
      } else if (
        gate.id === 'stanley-west-legal-motor-exit' &&
        gate.geometry.kind === 'gate' &&
        gate.from.surfaceId === 'lions:road' &&
        gate.from.layer === 1 &&
        gate.to.surfaceId === 'park:prospect-overpass' &&
        gate.to.layer === 2
      ) {
        groups = [westEntryGroup, upperGroup];
        a = gate.geometry.a;
        b = gate.geometry.b;
      } else if (
        gate.id === 'stanley-south-legal-motor-ramp' &&
        gate.geometry.kind === 'gate' &&
        gate.from.surfaceId === 'ground' &&
        gate.from.layer === 0 &&
        gate.to.surfaceId === 'lions:road' &&
        gate.to.layer === 1
      ) {
        groups = ['ground:0', southModelGroup];
        a = gate.geometry.a;
        b = gate.geometry.b;
      } else if (
        gate.geometry.kind === 'junction' &&
        prospect?.rampSegments.length &&
        ((gate.id === 'prospect:east-exit-main-junction' &&
          gate.from.surfaceId === 'lions:road' &&
          gate.from.layer === 1 &&
          gate.to.surfaceId === 'park:prospect-overpass' &&
          gate.to.layer === 2) ||
          (gate.id === 'prospect:causeway-east-exit' &&
            gate.from.surfaceId === 'lions:road' &&
            gate.from.layer === 1 &&
            gate.to.surfaceId === 'lions:road' &&
            gate.to.layer === 1))
      ) {
        const main = gate.id === 'prospect:east-exit-main-junction';
        const segment = main
          ? prospect.rampSegments.at(-1)!
          : prospect.rampSegments[0];
        const dx = segment.b[0] - segment.a[0],
          dz = segment.b[1] - segment.a[1],
          length = Math.hypot(dx, dz),
          point = gate.geometry.center;
        if (
          length < 1e-6 ||
          Math.hypot(
            point[0] - (main ? segment.b[0] : segment.a[0]),
            point[1] - (main ? segment.b[1] : segment.a[1]),
          ) > 0.001
        )
          continue;
        a = [
          point[0] - ((dz / length) * segment.width) / 2,
          point[1] + ((dx / length) * segment.width) / 2,
        ];
        b = [
          point[0] + ((dz / length) * segment.width) / 2,
          point[1] - ((dx / length) * segment.width) / 2,
        ];
        groups = main
          ? [prospectRampGroup, upperGroup]
          : [prospectEntryGroup, prospectRampGroup];
      } else continue;
      const point: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const floor = (group: string) =>
        floorIndices.get(group)?.lookup(...point)[0]?.y;
      let y0 = floor(groups[0]);
      const y1 = floor(groups[1]);
      if (groups[0] === 'ground:0' && y1 !== undefined)
        y0 = e.data.roadSurface?.sample(...point, y1);
      if (y0 === undefined || y1 === undefined) continue;
      seams.push({
        groups,
        a,
        b,
        drive: gate.allowedModes.includes('drive'),
        heightDeltaM: y1 - y0,
        maxSeamStep: gate.maxSeamStep ?? 0.025,
      });
    }
    const overlaps: TeslaRoadOverlap[] =
      entry && entry.rampRouteId === 'prospect:east-exit'
        ? [
            {
              groups: [prospectEntryGroup, prospectRampGroup],
              center: entry.center,
              radiusM: entry.radiusM,
              maxSeamStepM: entry.maxSeamStepM,
              edges: roadOverlapEdges(
                floorIndices.get(prospectEntryGroup)!.surfaces,
              ),
              floor: (group, x, z) =>
                floorIndices.get(group)?.lookup(x, z)[0]?.y,
            },
          ]
        : [];
    if (west?.rampEntry?.rampRouteId === 'stanley:west-motor-ramp')
      overlaps.push({
        groups: [westEntryGroup, upperGroup],
        center: west.rampEntry.center,
        radiusM: west.rampEntry.radiusM,
        maxSeamStepM: west.rampEntry.maxSeamStepM,
        edges: roadOverlapEdges(floorIndices.get(westEntryGroup)!.surfaces),
        floor: (group, x, z) => floorIndices.get(group)?.lookup(x, z)[0]?.y,
      });
    if (northbound?.rampEntry?.rampRouteId === 'stanley:northbound-motor-ramp')
      overlaps.push({
        groups: [northEntryGroup, northRampGroup],
        center: northbound.rampEntry.center,
        radiusM: northbound.rampEntry.radiusM,
        maxSeamStepM: northbound.rampEntry.maxSeamStepM,
        // Either source can end in a small bumper-corner overlap inside a
        // larger face of its peer. Index both actual edges for that proof.
        edges: roadOverlapEdges([
          ...floorIndices.get(northEntryGroup)!.surfaces,
          ...floorIndices.get(northRampGroup)!.surfaces,
        ]),
        floor: (group, x, z) => floorIndices.get(group)?.lookup(x, z)[0]?.y,
      });
    if (
      northbound?.groundEntry?.gateId === 'stanley-northbound-legal-motor-ramp'
    )
      overlaps.push({
        groups: ['ground:0', northRampGroup],
        center: northbound.groundEntry.center,
        radiusM: northbound.groundEntry.radiusM,
        maxSeamStepM: 0.025,
        edges: roadOverlapEdges(floorIndices.get(northRampGroup)!.surfaces),
        floor: (group, x, z) => {
          const upper = floorIndices.get(northRampGroup)?.lookup(x, z)[0]?.y;
          return group === northRampGroup
            ? upper
            : upper === undefined
              ? undefined
              : e.data.roadSurface?.sample(x, z, upper);
        },
      });
    for (const seam of seams.filter(
      (seam) =>
        seam.drive &&
        seam.groups.includes('ground:0') &&
        seam.groups.includes(upperGroup) &&
        Math.abs(seam.heightDeltaM) <= seam.maxSeamStep,
    )) {
      overlaps.push({
        groups: ['ground:0', upperGroup],
        center: [(seam.a[0] + seam.b[0]) / 2, (seam.a[1] + seam.b[1]) / 2],
        radiusM: 3.5,
        maxSeamStepM: seam.maxSeamStep,
        seam: { a: seam.a, b: seam.b, stripHalfWidthM: 0.04 },
        floor: (group, x, z) => {
          const upper = floorIndices.get(upperGroup)?.lookup(x, z)[0]?.y;
          return group === upperGroup
            ? upper
            : upper === undefined
              ? undefined
              : e.data.roadSurface?.sample(x, z, upper);
        },
      });
    }
    for (const gate of prospect?.gates ?? []) {
      if (
        gate.id !== 'prospect:east-exit-main-junction' ||
        gate.geometry.kind !== 'junction' ||
        !gate.allowedModes.includes('drive') ||
        gate.geometry.radius > 6.1
      )
        continue;
      const seam = seams.find(
        (s) =>
          s.groups.includes(prospectRampGroup) && s.groups.includes(upperGroup),
      );
      if (!seam || Math.abs(seam.heightDeltaM) > 0.025) continue;
      overlaps.push({
        groups: [prospectRampGroup, upperGroup],
        center: gate.geometry.center,
        radiusM: gate.geometry.radius,
        maxSeamStepM: 0.025,
        edges: roadOverlapEdges(floorIndices.get(prospectRampGroup)!.surfaces),
        seam: { a: seam.a, b: seam.b, stripHalfWidthM: 0 },
        floor: (group, x, z) => floorIndices.get(group)?.lookup(x, z)[0]?.y,
      });
    }
    if (south?.merge && south.geometry && modeledMain.length) {
      const terminal = new TravelSurfaceIndex(
        south.geometry.surfaces.filter(
          (surface) =>
            (surface as { sourceId?: number }).sourceId === 116061617 &&
            surface.allowedModes.includes('drive'),
        ),
      );
      overlaps.push({
        groups: ['ground:0', southModelGroup],
        center: south.merge,
        radiusM: 35,
        maxSeamStepM: 0.025,
        edges: roadOverlapEdges(terminal.surfaces),
        floor: (group, x, z) =>
          group === 'ground:0'
            ? terminal.lookup(x, z)[0]?.y
            : floorIndices.get(southModelGroup)?.lookup(x, z)[0]?.y,
      });
    }
    // A movement substep repeatedly proves the same two immutable road poses.
    // Keep only exact inputs, so physical edge intersections are computed once.
    const connectionCache = new Map<
      string,
      readonly (readonly [string, string])[]
    >();
    const roadConnections = (pose: TeslaPose, shape: TeslaShape) => {
      const key = [
        ...pose.position,
        ...pose.quaternion,
        ...shape.halfExtents,
        shape.clearance,
        ...(shape.groundSupport?.wheelContacts.flat() ?? []),
      ].join(',');
      const known = connectionCache.get(key);
      if (known) return known;
      const pairs = [
        ...teslaRoadSeamConnections(pose, shape, seams),
        ...teslaRoadOverlapConnections(pose, shape, overlaps),
      ];
      if (connectionCache.size >= 16)
        connectionCache.delete(connectionCache.keys().next().value!);
      connectionCache.set(key, pairs);
      return pairs;
    };
    super({
      sources,
      modelGroundConnections: roadConnections,
      modelGroundGroups: [
        'protected:park:prospect-overpass:2',
        prospectRampGroup,
        southModelGroup,
        prospectEntryGroup,
        westEntryGroup,
        northRampGroup,
        northEntryGroup,
      ],
      validPosition: ([x, y, z]) =>
        x >= low[0] &&
        x <= high[0] &&
        z >= low[1] &&
        z <= high[1] &&
        y >= -15 &&
        y <= 2000,
    });
    this.roofDetails = new TeslaRenderedRoofDetailsWorld(e);
    for (const [i, surface] of (index?.surfaces ?? []).entries())
      for (let n = 0; n < surface.triangles.length; n += 9)
        this.identities.set(`protected:${i}:face:${n / 9}`, {
          surfaceId: surface.surfaceId,
          layer: surface.layer,
          allowedModes: surface.allowedModes,
        });
  }
  override sweep(query: TeslaSweepQuery) {
    const original = super.sweep(query),
      debris = this.e.vehicleImpacts?.sweepDebris(query);
    const base =
      debris && (!original || debris.fraction < original.fraction)
        ? debris
        : original;
    return base?.fraction === 0
      ? base
      : nearestTeslaRoofDetailHit(base, this.roofDetails.sweep(query));
  }
  override sweepGroundDeparture(query: TeslaGroundDepartureQuery) {
    const original = super.sweepGroundDeparture(query),
      debris = this.e.vehicleImpacts?.sweepDebris(query);
    const base =
      debris && (!original || debris.fraction < original.fraction)
        ? debris
        : original;
    return base?.fraction === 0
      ? base
      : nearestTeslaRoofDetailHit(base, this.roofDetails.sweep(query));
  }
  override stats() {
    return { ...super.stats(), renderedRoofDetails: this.roofDetails.stats() };
  }
  override dispose() {
    this.roofDetails.dispose();
    super.dispose();
  }
  identity(contact: TeslaContact) {
    return (
      this.identities.get(contact.surfaceId) ??
      (contact.surfaceId.startsWith('ground:')
        ? {
            surfaceId: 'ground',
            layer: 0,
            allowedModes: ['walk', 'drive'] as const,
          }
        : null)
    );
  }
  override support(
    query: TeslaSupportQuery,
    accepts?: (face: TeslaContact) => boolean,
  ): TeslaContact | null {
    let waterClear: boolean | undefined;
    return super.support(query, (face) => {
      if (accepts?.(face) === false) return false;
      if (this.identity(face)?.surfaceId !== 'ground') return true;
      if (waterClear === undefined) {
        const quaternion = new THREE.Quaternion(
          ...query.pose.quaternion,
        ).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
        waterClear = [-1, 0, 1].every((x) =>
          [-1, 0, 1].every((z) => {
            const p = vector(query.pose.position)
              .addScaledVector(
                right,
                x * (query.shape.halfExtents[0] + query.shape.clearance),
              )
              .addScaledVector(
                forward,
                z * (query.shape.halfExtents[2] + query.shape.clearance),
              );
            return !waterAt(this.e, p.x, p.z);
          }),
        );
      }
      return waterClear;
    });
  }
  /** Optional placement preference, never a change to simulation collision.
   * Prove a fixed-orientation vertical corridor from a fresh road contact. The
   * first 35cm uses the existing departure contract; the remainder has no face
   * exclusions, so crowns, canopies, ceilings and stacked floors remain solid. */
  hasLaunchClearance(
    spawn: Pick<TeslaRoadSpawn, 'pose' | 'contact'>,
    shape: TeslaShape,
    upM = 20,
  ): boolean {
    if (!Number.isFinite(upM) || upM < 0.35 || upM > 64) return false;
    try {
      const { pose, contact } = spawn;
      const identity = this.identity(contact);
      if (
        contact.kind !== 'ground' ||
        !identity?.allowedModes.includes('drive') ||
        !(
          contact.surfaceId.startsWith('ground:asphalt:') ||
          contact.surfaceId.startsWith('protected:')
        )
      )
        return false;
      const proof = this.support(
        {
          pose,
          shape,
          maxDistance: shape.halfExtents[1] + shape.clearance + 0.2,
          preferredSurfaceId: contact.surfaceId,
          adhesion: false,
        },
        (face) => {
          const actual = this.identity(face);
          return (
            face.kind === 'ground' &&
            (face.surfaceId.startsWith('ground:asphalt:') ||
              face.surfaceId.startsWith('protected:')) &&
            actual?.surfaceId === identity.surfaceId &&
            actual.layer === identity.layer &&
            actual.allowedModes.includes('drive')
          );
        },
      );
      if (
        proof?.surfaceId !== contact.surfaceId ||
        this.sweep({
          from: pose,
          to: pose,
          shape,
          ignoreSurfaceId: proof.surfaceId.startsWith('protected:')
            ? undefined
            : proof.surfaceId,
        })
      )
        return false;
      const clearPose: TeslaPose = {
        position: [pose.position[0], pose.position[1] + 0.35, pose.position[2]],
        quaternion: [...pose.quaternion],
      };
      const firstHit = proof.surfaceId.startsWith('protected:')
        ? this.sweep({
            from: pose,
            to: clearPose,
            shape,
          })
        : this.sweepGroundDeparture({
            origin: pose,
            from: pose,
            to: clearPose,
            shape,
            sourceSurfaceId: proof.surfaceId,
          });
      if (firstHit || this.sweep({ from: clearPose, to: clearPose, shape }))
        return false;
      const top: TeslaPose = {
        position: [pose.position[0], pose.position[1] + upM, pose.position[2]],
        quaternion: [...pose.quaternion],
      };
      return !this.sweep({ from: clearPose, to: top, shape });
    } catch {
      // Failed placement proof never treats an invalid or unavailable world as
      // open sky. The caller may still retain its separately verified road.
      return false;
    }
  }
  /** Explicit bounded recovery to an actual driveable road, never a rooftop,
   * terrain estimate, water plane or pedestrian-only deck. */
  groundPoseNear(
    position: TeslaVec3,
    shape: TeslaShape,
    yaw = 0,
    maxRadius = 80,
    preferredIdentity: { surfaceId: string; layer: number } = {
      surfaceId: 'ground',
      layer: 0,
    },
    acceptsPlacement?: (candidate: TeslaRoadSpawn) => boolean,
  ): TeslaRoadSpawn | null {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw,
    );
    for (
      let radius = 0;
      radius <= Math.min(160, Math.max(0, maxRadius));
      radius += 8
    )
      for (let i = 0; i < (radius ? 16 : 1); i++) {
        const angle = (i * Math.PI) / 8;
        const x = position[0] + Math.cos(angle) * radius,
          z = position[2] + Math.sin(angle) * radius;
        if (
          preferredIdentity.surfaceId === 'ground' &&
          this.e.waterWorld?.solidAt?.(x, z)
        )
          continue;
        const pose: TeslaPose = {
          position: [x, position[1] + 3, z],
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        };
        const acceptsGround = (face: TeslaContact) => {
          const identity = this.identity(face);
          return (
            face.kind === 'ground' &&
            (face.surfaceId.startsWith('ground:asphalt:') ||
              face.surfaceId.startsWith('protected:')) &&
            identity?.surfaceId === preferredIdentity.surfaceId &&
            identity.layer === preferredIdentity.layer &&
            identity.allowedModes.includes('drive')
          );
        };
        // Discover a physical plane with a small probe, then orient and prove
        // the complete vehicle. The probe alone never authorizes placement.
        const probe = this.support(
          {
            pose,
            shape: { halfExtents: [0.02, 0.02, 0.02], clearance: 0 },
            maxDistance: 1024,
            adhesion: false,
          },
          acceptsGround,
        );
        if (!probe) continue;
        if (
          this.identity(probe)?.surfaceId === 'ground' &&
          this.e.waterWorld?.at(x, z)
        )
          continue;
        const normal = vector(probe.normal).normalize();
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
          .projectOnPlane(normal)
          .normalize();
        const right = normal.clone().cross(forward).normalize();
        forward.copy(right.clone().cross(normal).normalize());
        const aligned = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(right, normal, forward),
        );
        const center = vector(probe.point).addScaledVector(
          normal,
          shape.halfExtents[1] + shape.clearance + 0.002,
        );
        const grounded: TeslaPose = {
          position: triple(center),
          quaternion: [aligned.x, aligned.y, aligned.z, aligned.w],
        };
        const contact = this.support(
          {
            pose: grounded,
            shape,
            maxDistance: shape.halfExtents[1] + shape.clearance + 0.12,
            preferredSurfaceId: probe.surfaceId,
            adhesion: false,
          },
          acceptsGround,
        );
        if (!contact) continue;
        if (
          !this.sweep({
            from: grounded,
            to: grounded,
            shape,
            ignoreSurfaceId: contact.surfaceId,
          })
        ) {
          const candidate: TeslaRoadSpawn = {
            pose: grounded,
            contact,
            identity: this.identity(contact)!,
          };
          if (!acceptsPlacement || acceptsPlacement(candidate))
            return candidate;
        }
      }
    return null;
  }
}
