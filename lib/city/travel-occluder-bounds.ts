import * as THREE from 'three';

export const OCCLUDER_MIN = 'aTravelOccluderMin';
export const OCCLUDER_MAX = 'aTravelOccluderMax';

export interface TravelOcclusionPart {
  start: number;
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  minY: number;
  maxY: number;
}

/** An explicit sentinel enrolls a real terrain surface without assigning one
 * city-sized logical object. Its render-only cutaway is bounded per fragment. */
export function terrainOccluderBounds(geometry: THREE.BufferGeometry) {
  const count = geometry.getAttribute('position')?.count ?? 0;
  return {
    min: new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3),
    max: new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    pieces: count ? 1 : 0,
  };
}

/** Repeated per-vertex bounds identify logical pieces without splitting a draw.
 * An absent/all-zero pair is deliberately ineligible in the SSAO override. */
export function occluderBounds(
  geometry: THREE.BufferGeometry,
  parts?: readonly TravelOcclusionPart[],
): { min: THREE.BufferAttribute; max: THREE.BufferAttribute; pieces: number } {
  const positions = geometry.getAttribute('position');
  const count = positions?.count ?? 0;
  const min = new Float32Array(count * 3);
  const max = new Float32Array(count * 3);
  let pieces = 0;
  const write = (
    vertices: Iterable<number>,
    lower: number[],
    upper: number[],
  ) => {
    if (
      !lower.every(Number.isFinite) ||
      !upper.every(Number.isFinite) ||
      lower.some((n, i) => n > upper[i]) ||
      lower.every((n, i) => n === upper[i])
    )
      return;
    pieces++;
    for (const index of vertices) {
      min.set(lower, index * 3);
      max.set(upper, index * 3);
    }
  };
  if (parts !== undefined) {
    // The measured city already supplies exact source part spans. Do not build
    // a city-sized welding graph, nor merge adjacent buildings at shared walls.
    for (const part of parts) {
      if (
        !Number.isInteger(part.start) ||
        !Number.isInteger(part.count) ||
        part.start < 0 ||
        part.count <= 0 ||
        part.start + part.count > count
      )
        continue;
      const end = part.start + part.count;
      const vertices = {
        *[Symbol.iterator]() {
          for (let i = part.start; i < end; i++) yield i;
        },
      };
      write(
        vertices,
        [part.bounds.minX, part.minY, part.bounds.minZ],
        [part.bounds.maxX, part.maxY, part.bounds.maxZ],
      );
    }
  } else if (count) {
    // Weld coincident positions across UV/normal seams, then union triangle
    // islands. Merged landmark material batches retain independent buildings.
    const parent = new Uint32Array(count);
    const first = new Map<string, number>();
    const find = (input: number) => {
      let index = input;
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    const union = (a: number, b: number) => {
      const x = find(a),
        y = find(b);
      if (x !== y) parent[y] = x;
    };
    for (let i = 0; i < count; i++) {
      parent[i] = i;
      const key = `${Math.round(positions.getX(i) * 1e4)},${Math.round(positions.getY(i) * 1e4)},${Math.round(positions.getZ(i) * 1e4)}`;
      const previous = first.get(key);
      if (previous === undefined) first.set(key, i);
      else union(previous, i);
    }
    const index = geometry.index;
    const indexCount = index?.count ?? count;
    for (let i = 0; i + 2 < indexCount; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      union(a, b);
      union(a, c);
    }
    const islands = new Map<
      number,
      { vertices: number[]; min: number[]; max: number[] }
    >();
    for (let i = 0; i < count; i++) {
      const key = find(i);
      let island = islands.get(key);
      if (!island) {
        island = {
          vertices: [],
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        };
        islands.set(key, island);
      }
      island.vertices.push(i);
      const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
      for (let axis = 0; axis < 3; axis++) {
        island.min[axis] = Math.min(island.min[axis], point[axis]);
        island.max[axis] = Math.max(island.max[axis], point[axis]);
      }
    }
    for (const island of islands.values())
      write(island.vertices, island.min, island.max);
  }
  return {
    min: new THREE.BufferAttribute(min, 3),
    max: new THREE.BufferAttribute(max, 3),
    pieces,
  };
}
