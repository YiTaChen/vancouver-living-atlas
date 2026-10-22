import * as THREE from 'three';

type Vertex = { point: THREE.Vector3; attributes: Record<string, number[]> };
const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
  point: a.point.clone().lerp(b.point, t),
  attributes: Object.fromEntries(
    Object.keys(a.attributes).map((key) => [
      key,
      a.attributes[key].map((v, i) => v + (b.attributes[key][i] - v) * t),
    ]),
  ),
});
function clip(
  polygon: Vertex[],
  axis: 'x' | 'y' | 'z',
  bound: number,
  sign: number,
) {
  const out: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = (a.point[axis] - bound) * sign,
      db = (b.point[axis] - bound) * sign;
    if (da >= -1e-8) out.push(a);
    if (da >= 0 !== db >= 0) out.push(interpolate(a, b, da / (da - db)));
  }
  return out;
}
function subtract(polygon: Vertex[], box: THREE.Box3): Vertex[][] {
  if (!polygon.length) return [];
  const bounds = new THREE.Box3().setFromPoints(polygon.map((v) => v.point));
  if (!bounds.intersectsBox(box)) return [polygon];
  let pending = polygon;
  const kept: Vertex[][] = [];
  for (const [axis, bound, sign] of [
    ['x', box.min.x, 1],
    ['x', box.max.x, -1],
    ['y', box.min.y, 1],
    ['y', box.max.y, -1],
    ['z', box.min.z, 1],
    ['z', box.max.z, -1],
  ] as const) {
    const outside = clip(pending, axis, bound, -sign);
    if (outside.length >= 3) kept.push(outside);
    pending = clip(pending, axis, bound, sign);
    if (pending.length < 3) break;
  }
  return kept;
}

/** Instance-only adaptation of static exhibition walls into usable train-door
 * apertures. Subtracts exact boxes while interpolating every authored vertex
 * attribute. Original GLB files, materials and all passenger anchors are intact. */
export function openSkyTrainDoorApertures(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    retired = new Set<THREE.BufferGeometry>();
  const boxes: THREE.Box3[] = [];
  for (const side of [-1, 1])
    for (const z of [-4.9, 0, 4.9])
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(side === 1 ? 1.1 : -1.5, 0.025, z - 0.72),
          new THREE.Vector3(side === 1 ? 1.5 : -1.1, 2.12, z + 0.72),
        ),
      );
  root.traverse((node) => {
    if (
      !(node instanceof THREE.Mesh) ||
      !node.geometry.getAttribute('position') ||
      !/batch-(?:panel|rubber|shell|glass)/.test(node.name)
    )
      return;
    const geometry = node.geometry,
      position = geometry.getAttribute('position'),
      matrix = inverse.clone().multiply(node.matrixWorld);
    const count = geometry.index?.count ?? position.count,
      keys = Object.keys(geometry.attributes);
    const output: Record<string, number[]> = Object.fromEntries(
      keys.map((key) => [key, []]),
    );
    let changed = false;
    for (let i = 0; i < count; i += 3) {
      const triangle: Vertex[] = [];
      for (let k = 0; k < 3; k++) {
        const index = geometry.index?.getX(i + k) ?? i + k;
        const attributes: Record<string, number[]> = {};
        for (const key of keys) {
          const attribute = geometry.getAttribute(key);
          attributes[key] = Array.from({ length: attribute.itemSize }, (_, j) =>
            attribute.getComponent(index, j),
          );
        }
        triangle.push({
          point: new THREE.Vector3()
            .fromArray(attributes.position)
            .applyMatrix4(matrix),
          attributes,
        });
      }
      let pieces = [triangle];
      for (const box of boxes)
        pieces = pieces.flatMap((piece) => subtract(piece, box));
      if (
        pieces.length !== 1 ||
        pieces[0].length !== 3 ||
        pieces[0].some((v, k) => v !== triangle[k])
      )
        changed = true;
      for (const polygon of pieces)
        for (let k = 1; k < polygon.length - 1; k++)
          for (const v of [polygon[0], polygon[k], polygon[k + 1]])
            for (const key of keys) output[key].push(...v.attributes[key]);
    }
    if (!changed) return;
    const derived = new THREE.BufferGeometry();
    for (const key of keys)
      derived.setAttribute(
        key,
        new THREE.Float32BufferAttribute(
          output[key],
          geometry.getAttribute(key).itemSize,
        ),
      );
    derived.computeBoundingBox();
    derived.computeBoundingSphere();
    derived.name = `${geometry.name || node.name}:regional-door-apertures`;
    node.geometry = derived;
    retired.add(geometry);
  });
  for (const geometry of retired) {
    let referenced = false;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry === geometry)
        referenced = true;
    });
    if (!referenced) geometry.dispose();
  }
}
