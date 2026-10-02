import * as THREE from 'three';
import type { CityEngine } from './engine';

/** Share materials, but give static road geometry local bounds. A street camera
 * should not submit every newly detailed road triangle across the peninsula. */
export function addStreetMeshes(
  e: CityEngine,
  positions: number[],
  material: THREE.Material,
  name: string,
  uv?: number[],
  walkSurface = false,
  asphaltSurface = false,
  protectedSurface = false,
  castShadow = protectedSurface,
  attributes: Record<string, { array: number[]; itemSize: number }> = {},
) {
  const cells = new Map<
    string,
    { positions: number[]; uv: number[]; attributes: Record<string, number[]> }
  >();
  for (let i = 0; i < positions.length; i += 9) {
    const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3,
      z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3,
      key = `${Math.floor(x / 600)},${Math.floor(z / 600)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        positions: [],
        uv: [],
        attributes: Object.fromEntries(
          Object.keys(attributes).map((name) => [name, []]),
        ),
      };
      cells.set(key, cell);
    }
    for (let j = 0; j < 9; j++) cell.positions.push(positions[i + j]);
    if (uv) for (let j = 0; j < 6; j++) cell.uv.push(uv[(i / 3) * 2 + j]);
    for (const [name, attribute] of Object.entries(attributes)) {
      const start = (i / 3) * attribute.itemSize;
      cell.attributes[name].push(
        ...attribute.array.slice(start, start + 3 * attribute.itemSize),
      );
    }
  }
  for (const [key, cell] of cells) {
    const mesh = new THREE.Mesh(
      e.geometry(
        cell.positions,
        undefined,
        undefined,
        uv ? cell.uv : undefined,
      ),
      material,
    );
    for (const [attributeName, attribute] of Object.entries(attributes))
      mesh.geometry.setAttribute(
        attributeName,
        new THREE.Float32BufferAttribute(
          cell.attributes[attributeName],
          attribute.itemSize,
        ),
      );
    mesh.name = `${name} ${key}`;
    mesh.receiveShadow = true;
    mesh.userData.walkSurface = walkSurface;
    mesh.userData.asphaltSurface = asphaltSurface;
    mesh.userData.protectedSurface = protectedSurface;
    mesh.castShadow = castShadow;
    mesh.geometry.computeBoundingSphere();
    e.roads.add(mesh);
  }
}
