import * as THREE from 'three';
export type Aperture = {
  min: [number, number, number];
  max: [number, number, number];
};
export const PUBLIC_APERTURES: Record<'science' | 'canada', Aperture[]> = {
  science: [
    { min: [36, 1.025, -54], max: [44, 4.15, -34] },
    { min: [20, 1.025, -30], max: [42, 5.1, -15] },
    { min: [-34, 1.7, -9], max: [-29, 4.6, 9] },
  ],
  canada: [
    { min: [-36, 1.31, -68], max: [-29, 4.7, -60] },
    { min: [29, 1.31, -68], max: [36, 4.7, -60] },
    { min: [-34, 3.3, -52], max: [-31, 6.7, -32] },
  ],
};
/** Subtract axis-aligned doorway volumes from triangles. Runs at construction,
 * including in the landmark worker. Interpolates every vertex attribute. */
export function carveApertures(root: THREE.Group, boxes: Aperture[]) {
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    // Landmark factories store their model-local transforms in geometry. Respect
    // child transforms as well, then transform back before assigning the result.
    const transform = new THREE.Matrix4()
      .copy(root.matrixWorld)
      .invert()
      .multiply(object.matrixWorld);
    geometry.applyMatrix4(transform);
    geometry.computeBoundingBox();
    if (
      !boxes.some((b) =>
        geometry.boundingBox!.intersectsBox(
          new THREE.Box3(
            new THREE.Vector3(...b.min),
            new THREE.Vector3(...b.max),
          ),
        ),
      )
    ) {
      geometry.dispose();
      return;
    }
    const names = Object.keys(geometry.attributes),
      sizes = names.map((n) => geometry.attributes[n].itemSize);
    const offsets = sizes.map((_, i) =>
      sizes.slice(0, i).reduce((a, b) => a + b, 0),
    );
    const pOffset = offsets[names.indexOf('position')];
    const out: number[][] = names.map(() => []),
      pos = geometry.getAttribute('position');
    let changed = false;
    type Vertex = number[];
    const split = (
      poly: Vertex[],
      axis: number,
      value: number,
      sign: number,
    ) => {
      const inside: Vertex[] = [],
        outside: Vertex[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length];
        const da = sign * (a[pOffset + axis] - value),
          db = sign * (b[pOffset + axis] - value);
        (da >= 0 ? inside : outside).push(a);
        if (da >= 0 !== db >= 0) {
          const t = da / (da - db),
            v = a.map((x, j) => x + (b[j] - x) * t);
          inside.push(v);
          outside.push(v);
        }
      }
      return { inside, outside };
    };
    for (let i = 0; i < pos.count; i += 3) {
      let pieces: Vertex[][] = [
        Array.from({ length: 3 }, (_, j) =>
          names.flatMap((n) => {
            const attr = geometry.getAttribute(n);
            return Array.from(
              { length: attr.itemSize },
              (_, k) => attr.array[(i + j) * attr.itemSize + k],
            );
          }),
        ),
      ];
      for (const box of boxes) {
        const next: Vertex[][] = [];
        for (const poly of pieces) {
          if (
            [0, 1, 2].some(
              (a) =>
                poly.every((v) => v[pOffset + a] <= box.min[a]) ||
                poly.every((v) => v[pOffset + a] >= box.max[a]),
            )
          ) {
            next.push(poly);
            continue;
          }
          let rest = poly;
          for (let axis = 0; axis < 3 && rest.length >= 3; axis++)
            for (const [value, sign] of [
              [box.min[axis], 1],
              [box.max[axis], -1],
            ]) {
              if (rest.length < 3) break;
              const r = split(rest, axis, value, sign);
              if (r.outside.length >= 3) next.push(r.outside);
              rest = r.inside;
            }
          changed = true;
        }
        pieces = next;
      }
      for (const poly of pieces)
        for (let j = 1; j < poly.length - 1; j++)
          for (const v of [poly[0], poly[j], poly[j + 1]])
            names.forEach((_, a) =>
              out[a].push(...v.slice(offsets[a], offsets[a] + sizes[a])),
            );
    }
    if (changed) {
      const result = new THREE.BufferGeometry();
      names.forEach((n, i) =>
        result.setAttribute(
          n,
          new THREE.Float32BufferAttribute(out[i], sizes[i]),
        ),
      );
      result.applyMatrix4(transform.invert());
      result.normalizeNormals();
      result.computeBoundingBox();
      result.computeBoundingSphere();
      source.dispose();
      object.geometry = result;
    }
    geometry.dispose();
  });
}
