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
) {
  const cells = new Map<string, { positions: number[]; uv: number[] }>();
  for (let i = 0; i < positions.length; i += 9) {
    const x = (positions[i] + positions[i + 3] + positions[i + 6]) / 3,
      z = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3,
      key = `${Math.floor(x / 600)},${Math.floor(z / 600)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { positions: [], uv: [] };
      cells.set(key, cell);
    }
    for (let j = 0; j < 9; j++) cell.positions.push(positions[i + j]);
    if (uv) for (let j = 0; j < 6; j++) cell.uv.push(uv[(i / 3) * 2 + j]);
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
